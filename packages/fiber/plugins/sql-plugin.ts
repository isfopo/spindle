/**
 * sqlPlugin — compiles TS-authored stored queries (`procs.ts` files) into
 * static SQL modules with schema-derived types.
 *
 *   src/domains/<domain>/procs.ts  →  src/domains/<domain>/procs.generated.ts
 *
 * For each `procs.ts` the plugin: loads the schema singleton (same loader as
 * schemaPlugin) for type inference, bundles + executes the procs block,
 * runs compileProcs to render SQL + ProcMap, validates the rendered SQL with
 * node-sql-parser (warnings only), and writes the module atomically.
 */
import type { Plugin } from "vite";
import { resolve, dirname, join, relative } from "path";
import { readdir, writeFile, mkdir, rename, unlink } from "node:fs/promises";
import { createHash } from "node:crypto";
import { build as esbuild } from "esbuild";
import { pathToFileURL } from "node:url";
import { tmpdir } from "node:os";
import sqlParserPkg from "node-sql-parser";
import { ProcDefs, compileProcs } from "../src";
import { loadSchemaModule } from "./schema-plugin";
import { loadSeedSpec } from "./seed-plugin";

const { Parser } = sqlParserPkg;

export interface SqlPluginOptions {
  /** Path to the TypeScript schema module (source of truth).
   *  @default "src/domains/schema.ts" */
  schemaPath?: string;
  /** Path to the seed spec, whose literal lookup rows type checkRef columns.
   *  @default "src/domains/seed.ts" */
  seedPath?: string;
  /** Directories scanned recursively for `procs.ts` files.
   *  @default ["src/domains"] */
  dirs?: string[];
}

interface ResolvedPaths {
  projectRoot: string;
  schemaPath: string;
  seedPath: string;
  dirs: string[];
}

function resolvePaths(
  projectRoot: string,
  options: SqlPluginOptions,
): ResolvedPaths {
  const toAbs = (p: string | undefined, fallback: string) =>
    p && p.startsWith("/") ? p : resolve(projectRoot, p ?? fallback);
  return {
    projectRoot,
    schemaPath: toAbs(options.schemaPath, "src/domains/schema.ts"),
    seedPath: toAbs(options.seedPath, "src/domains/seed.ts"),
    dirs: (options.dirs ?? ["src/domains"]).map((d) =>
      d.startsWith("/") ? d : resolve(projectRoot, d),
    ),
  };
}

/** Find every `procs.ts` under the given roots. */
async function findProcsFiles(roots: string[]): Promise<string[]> {
  const out: string[] = [];
  async function walk(dir: string): Promise<void> {
    let entries: import("node:fs").Dirent[];
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (
          !entry.name.startsWith(".") &&
          entry.name !== "node_modules" &&
          entry.name !== ".generated"
        ) {
          await walk(full);
        }
      } else if (entry.isFile() && entry.name === "procs.ts") {
        out.push(full);
      }
    }
  }
  for (const root of roots) await walk(root);
  return out;
}

/** Bundle + execute a procs.ts (resolving the fiber DSL) to the ProcDefs. */
async function loadProcs(
  procsPath: string,
  projectRoot: string,
): Promise<ProcDefs> {
  const result = await esbuild({
    entryPoints: [procsPath],
    bundle: true,
    write: false,
    format: "esm",
    platform: "node",
    // `@spindle/spindle` resolves through the consumer's node_modules.
  });
  const code = result.outputFiles[0].text;
  const tmpFile = join(
    tmpdir(),
    `js-mvc-procs-${createHash("sha1").update(procsPath).digest("hex").slice(0, 12)}-${Date.now()}.mjs`,
  );
  await writeFile(tmpFile, code, "utf-8");
  try {
    const mod = (await import(pathToFileURL(tmpFile).href)) as {
      procs?: ProcDefs;
      default?: ProcDefs;
    };
    const procs = mod.procs ?? mod.default;
    if (!procs) throw new Error(`No "procs" export found in ${procsPath}`);
    return procs;
  } finally {
    await unlink(tmpFile).catch(() => {});
  }
}

const sqlParser = new Parser();

/** Best-effort validation of the rendered SQL (warnings only — node-sql-parser
 *  has SQLite coverage gaps, so a failure may be a parser gap, not bad SQL). */
function validateSql(queries: Record<string, string>): void {
  for (const [name, sql] of Object.entries(queries)) {
    try {
      sqlParser.astify(sql.replace(/@\w+/g, "0"), { database: "SQLite" });
    } catch (e) {
      console.warn(
        `⚠ [sql-plugin] "${name}" did not parse cleanly (may be a parser gap): ${(e as Error).message}`,
      );
    }
  }
}

/** Table name → literal `rows()` from the seed spec (checkRef union sources). */
async function loadLookupRows(
  paths: ResolvedPaths,
): Promise<Map<string, Record<string, unknown>[]>> {
  const lookups = new Map<string, Record<string, unknown>[]>();
  try {
    const seed = await loadSeedSpec(paths.projectRoot, paths.seedPath);
    for (const [table, spec] of Object.entries(seed.tables)) {
      if ("rows" in spec) lookups.set(table, spec.rows);
    }
  } catch {
    console.warn(
      "⚠ sql-plugin: no seed spec loaded — checkRef columns fall back to their base type",
    );
  }
  return lookups;
}

async function generateForFile(
  paths: ResolvedPaths,
  procsPath: string,
  lookups: Map<string, Record<string, unknown>[]>,
): Promise<void> {
  const schema = await loadSchemaModule(paths.projectRoot, paths.schemaPath);
  const procs = await loadProcs(procsPath, paths.projectRoot);
  const sourcePath = relative(paths.projectRoot, procsPath).replace(/\\/g, "/");

  const compiled = compileProcs(schema, procs, {}, { sourcePath, lookups });
  validateSql(compiled.queries);

  const outputPath = join(dirname(procsPath), "procs.generated.ts");
  await mkdir(dirname(outputPath), { recursive: true });
  // Sweep orphaned temp files from interrupted writers, then write atomically.
  const dir = dirname(outputPath);
  for (const entry of await readdir(dir)) {
    if (entry.startsWith("procs.generated.ts.tmp-")) {
      await unlink(join(dir, entry)).catch(() => {});
    }
  }
  const tmp = `${outputPath}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(tmp, compiled.moduleText, "utf-8");
  await rename(tmp, outputPath);
  console.log(
    `✓ Generated ${relative(paths.projectRoot, outputPath).replace(/\\/g, "/")}`,
  );
}

export function sqlPlugin(options: SqlPluginOptions = {}): Plugin {
  let paths: ResolvedPaths;
  let procsFiles: string[] = [];

  return {
    name: "js-mvc-sql",
    enforce: "pre",

    configResolved(config) {
      paths = resolvePaths(config.root, options);
    },

    async buildStart() {
      console.log("🔌 Compiling stored queries (procs)...");
      procsFiles = await findProcsFiles(paths.dirs);
      const lookups = await loadLookupRows(paths);
      for (const file of procsFiles) {
        try {
          await generateForFile(paths, file, lookups);
        } catch (e) {
          // Fail the build loudly: a broken procs file must not ship stale SQL.
          console.error(
            `✗ procs compile failed (${file}):`,
            (e as Error).message,
          );
          throw e;
        }
      }
    },

    configureServer(server) {
      for (const dir of paths.dirs) server.watcher.add(dir);
      const onProcs = async (file: string) => {
        if (file.endsWith("procs.ts")) {
          try {
            await generateForFile(paths, file, await loadLookupRows(paths));
            for (const mod of server.moduleGraph.getModulesByFile(
              join(dirname(file), "procs.generated.ts"),
            ) ?? []) {
              server.moduleGraph.invalidateModule(mod);
            }
          } catch (e) {
            console.error(
              `✗ procs compile failed (${file}):`,
              (e as Error).message,
            );
          }
        }
      };
      server.watcher.on("change", onProcs);
      server.watcher.on("add", onProcs);
    },
  };
}
