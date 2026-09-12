import type { Plugin } from "vite";
import { resolve, dirname, join } from "path";
import { createHash } from "node:crypto";
import { writeFile, mkdir, unlink } from "node:fs/promises";
import { build as esbuild } from "esbuild";
import { pathToFileURL } from "node:url";
import { tmpdir } from "node:os";
import { generateDbTypesContent } from "../src/schema";
import {
  serializeSchemaDef,
  serializeSchemaSql,
} from "../src/schema/serialize";
import type { SchemaDef } from "../src/schema";
import { loadSeedSpec } from "./seed-plugin";

// ---------------------------------------------------------------------------
// Options / paths
// ---------------------------------------------------------------------------

export interface SchemaPluginOptions {
  /**
   * Path to the TypeScript schema module (source of truth).
   * @default "src/domains/schema.ts"
   */
  schemaPath?: string;
  /**
   * Path to the seed spec, whose literal `rows()` type `checkRef` columns as
   * unions of the lookup table's primary-key values.
   * @default "src/domains/seed.ts"
   */
  seedPath?: string;
  /**
   * Output path for the generated model types.
   * @default "src/domains/db-types.d.ts"
   */
  dbTypesPath?: string;
  /**
   * Output path for the derived schema.sql (tooling / manual wrangler use).
   * @default "src/migrations/schema.sql"
   */
  schemaSqlPath?: string;
  /**
   * Output path for the generated runtime schema module the Worker imports.
   * @default "src/.generated/schema.ts"
   */
  generatedSchemaPath?: string;
  /** Override automatic table name to type name conversions. */
  tableNameOverrides?: Record<string, string>;
}

interface ResolvedPaths {
  projectRoot: string;
  schemaPath: string;
  seedPath: string;
  dbTypesPath: string;
  schemaSqlPath: string;
  generatedSchemaPath: string;
  tableNameOverrides: Record<string, string>;
}

function resolvePaths(
  projectRoot: string,
  options: SchemaPluginOptions,
): ResolvedPaths {
  const toAbs = (p: string | undefined, fallback: string) =>
    p && p.startsWith("/") ? p : resolve(projectRoot, p ?? fallback);
  return {
    projectRoot,
    schemaPath: toAbs(options.schemaPath, "src/domains/schema.ts"),
    seedPath: toAbs(options.seedPath, "src/domains/seed.ts"),
    dbTypesPath: toAbs(options.dbTypesPath, "src/domains/db-types.d.ts"),
    schemaSqlPath: toAbs(options.schemaSqlPath, "src/migrations/schema.sql"),
    generatedSchemaPath: toAbs(
      options.generatedSchemaPath,
      "src/.generated/schema.ts",
    ),
    tableNameOverrides: options.tableNameOverrides ?? {},
  };
}

// ---------------------------------------------------------------------------
// Load the schema module (bundle TS → ESM, resolve js-mvc/schema alias)
// ---------------------------------------------------------------------------

/**
 * Load the app's schema module: bundle the TS source (resolving the
 * js-mvc/schema import to the framework DSL) and execute it for the SchemaDef.
 * Shared with sqlPlugin, which needs the same schema for type inference.
 */
export async function loadSchemaModule(
  projectRoot: string,
  schemaPath: string,
): Promise<SchemaDef> {
  const result = await esbuild({
    entryPoints: [schemaPath],
    bundle: true,
    write: false,
    format: "esm",
    platform: "node",
    // `@spindle/spindle` resolves through the consumer's node_modules, so the
    // bundled schema module is self-contained (no runtime imports).
  });

  const code = result.outputFiles[0].text;
  const tmpFile = join(
    tmpdir(),
    `js-mvc-schema-${createHash("sha1").update(schemaPath).digest("hex").slice(0, 12)}-${Date.now()}.mjs`,
  );
  await writeFile(tmpFile, code, "utf-8");
  try {
    const mod = (await import(pathToFileURL(tmpFile).href)) as {
      schema: SchemaDef;
    };
    return mod.schema;
  } finally {
    // Clean up the temp file best-effort (may still be referenced in dev).
    await unlink(tmpFile).catch(() => {});
  }
}

// ---------------------------------------------------------------------------
// Generation
// ---------------------------------------------------------------------------

async function generateSchemaOutputs(paths: ResolvedPaths): Promise<void> {
  const schema = await loadSchemaModule(paths.projectRoot, paths.schemaPath);

  // 1. Runtime schema module first — the seed spec imports it, and we read
  //    the seed's literal lookup rows to type `checkRef` columns.
  await mkdir(dirname(paths.generatedSchemaPath), { recursive: true });
  await writeFile(
    paths.generatedSchemaPath,
    serializeSchemaDef(schema),
    "utf-8",
  );

  // 2. Derived schema.sql.
  await mkdir(dirname(paths.schemaSqlPath), { recursive: true });
  await writeFile(paths.schemaSqlPath, serializeSchemaSql(schema), "utf-8");

  // 3. Model types — with lookup unions from the seed spec when available.
  const lookups = await loadLookupRows(paths);
  await mkdir(dirname(paths.dbTypesPath), { recursive: true });
  await writeFile(
    paths.dbTypesPath,
    generateDbTypesContent(schema, paths.tableNameOverrides, lookups),
    "utf-8",
  );
}

/** Table name → literal `rows()` from the seed spec (checkRef union sources). */
async function loadLookupRows(
  paths: ResolvedPaths,
): Promise<Map<string, Record<string, unknown>[]>> {
  const lookups = new Map<string, Record<string, unknown>[]>();
  try {
    const seed = await loadSeedSpec(
      paths.projectRoot,
      paths.seedPath,
      paths.generatedSchemaPath,
      paths.schemaPath,
    );
    for (const [table, spec] of Object.entries(seed.tables)) {
      if ("rows" in spec) lookups.set(table, spec.rows);
    }
  } catch {
    console.warn(
      "⚠ schemaPlugin: no seed spec loaded — checkRef columns fall back to their base type",
    );
  }
  return lookups;
}

// ---------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------

/**
 * Vite plugin that turns the TypeScript schema definition into:
 *   - generated model types (src/domains/db-types.d.ts)
 *   - a derived schema.sql for tooling
 *   - a runtime schema module (src/.generated/schema.ts) for applySchema()
 * Replaces the SQL-parse→types role entirely: the schema shape is now derived
 * from the TS definition, and stored queries (sqlPlugin) feed off the same IR.
 */
export function schemaPlugin(options: SchemaPluginOptions = {}): Plugin {
  let projectRoot: string;
  let paths: ResolvedPaths;

  return {
    name: "js-mvc-schema",
    enforce: "pre",

    configResolved(config) {
      projectRoot = config.root;
      paths = resolvePaths(projectRoot, options);
    },

    async buildStart() {
      console.log("📐 Generating schema outputs (types, sql, runtime)...");
      try {
        await generateSchemaOutputs(paths);
        console.log("✓ Schema outputs generated");
      } catch (e) {
        // Fail the build loudly: a broken schema must not ship with stale
        // generated files (or pass CI with exit 0).
        console.error("✗ Schema generation failed:", (e as Error).message);
        throw e;
      }
    },

    configureServer(server) {
      // The schema is the primary source, but the seed's literal lookup rows
      // also type checkRef columns — regenerate on either changing.
      const sources = [paths.schemaPath, paths.seedPath];
      server.watcher.add(sources);
      const onSourceChange = async (file: string) => {
        if (!sources.includes(file)) return;
        try {
          await generateSchemaOutputs(paths);
          const mods = server.moduleGraph.getModulesByFile(
            paths.generatedSchemaPath,
          );
          for (const mod of mods ?? []) {
            server.moduleGraph.invalidateModule(mod);
          }
          console.log("✓ Schema outputs regenerated");
        } catch (e) {
          console.error("✗ Schema generation failed:", (e as Error).message);
        }
      };
      server.watcher.on("change", onSourceChange);
      server.watcher.on("add", onSourceChange);
    },
  };
}
