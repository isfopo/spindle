/**
 * seedPlugin — compiles the seed spec into a pure-data runtime module.
 *
 *   src/domains/seed.ts  →  src/.generated/seed.ts  (rows + hash — no faker)
 *
 * Runs at build time and in dev, mirroring schemaPlugin. The faker library is
 * only ever imported by this plugin's process (project devDependency); the
 * emitted module is plain row data, so the worker bundle stays faker-free.
 */

import type { Plugin } from "vite";
import { resolve, dirname, join } from "path";
import { createHash } from "node:crypto";
import { writeFile, mkdir, unlink, rename } from "node:fs/promises";
import { build as esbuild } from "esbuild";
import { pathToFileURL } from "node:url";
import { tmpdir } from "node:os";
import { compileSeed, SeedSpec } from "../src/seed";

// ---------------------------------------------------------------------------
// Options / paths
// ---------------------------------------------------------------------------

export interface SeedPluginOptions {
  /**
   * Path to the seed spec module (source of truth).
   * @default "src/domains/seed.ts"
   */
  seedPath?: string;
  /**
   * Path to the app's schema definition (source of truth).
   * @default "src/domains/schema.ts"
   */
  schemaSourcePath?: string;
  /**
   * Path to the generated runtime schema module the spec imports.
   * @default "src/.generated/schema.ts"
   */
  schemaModulePath?: string;
  /**
   * Output path for the compiled seed data module.
   * @default "src/.generated/seed.ts"
   */
  outputPath?: string;
}

interface ResolvedPaths {
  projectRoot: string;
  seedPath: string;
  schemaSourcePath: string;
  schemaModulePath: string;
  outputPath: string;
}

function resolvePaths(
  projectRoot: string,
  options: SeedPluginOptions,
): ResolvedPaths {
  const toAbs = (p: string | undefined, fallback: string) =>
    p && p.startsWith("/") ? p : resolve(projectRoot, p ?? fallback);
  return {
    projectRoot,
    seedPath: toAbs(options.seedPath, "src/domains/seed.ts"),
    schemaSourcePath: toAbs(
      options.schemaSourcePath,
      "src/domains/schema.ts",
    ),
    schemaModulePath: toAbs(
      options.schemaModulePath,
      "src/.generated/schema.ts",
    ),
    outputPath: toAbs(options.outputPath, "src/.generated/seed.ts"),
  };
}

// ---------------------------------------------------------------------------
// Load + compile
// ---------------------------------------------------------------------------

/** Bundle the spec and execute it for the SeedSpec.
 *  Shared with schemaPlugin, which reads literal lookup rows from it to type
 *  checkRef columns.
 *
 *  `schemaModulePath` is the plugin's generated `src/.generated/schema.ts`.
 *  The spec imports it by its on-disk relative path (e.g. `../.generated/schema`).
 *  schemaPlugin writes it during the same build, but buildStart hooks run
 *  concurrently — so we ensure it exists here first by serializing the schema
 *  source, then alias the generated import to that file. */
export async function loadSeedSpec(
  projectRoot: string,
  seedPath: string,
  schemaModulePath?: string,
  schemaSourcePath?: string,
): Promise<SeedSpec> {
  const generatedSchemaPath = resolve(
    projectRoot,
    schemaModulePath ?? "src/.generated/schema.ts",
  );

  // Ensure the generated schema module exists before bundling the spec, which
  // imports it (schemaPlugin writes the same file, but hook ordering is not
  // guaranteed). Idempotent: identical content, last writer wins.
  if (schemaSourcePath) {
    const schemaSource = resolve(projectRoot, schemaSourcePath);
    try {
      const { loadSchemaModule } = await import("./schema-plugin");
      const schema = await loadSchemaModule(projectRoot, schemaSource);
      const { serializeSchemaDef } = await import("../src/schema/serialize");
      await mkdir(dirname(generatedSchemaPath), { recursive: true });
      await writeFile(generatedSchemaPath, serializeSchemaDef(schema), "utf-8");
    } catch (e) {
      console.warn(
        "⚠ seedPlugin: could not pre-generate schema module —",
        (e as Error).message,
      );
    }
  }

  const result = await esbuild({
    entryPoints: [seedPath],
    bundle: true,
    write: false,
    format: "esm",
    platform: "node",
    plugins: [
      {
        name: "spindle-generated-schema-alias",
        setup(build) {
          // `../.generated/schema` (or with extension) → the generated file.
          build.onResolve({ filter: /\.generated\/schema(\.ts)?$/ }, (args) => {
            if (args.importer?.startsWith(projectRoot)) {
              return { path: generatedSchemaPath };
            }
            return undefined;
          });
        },
      },
    ],
    // `@spindle/spindle/fiber` resolves through the consumer's node_modules.
  });

  const code = result.outputFiles[0].text;
  const tmpFile = join(
    tmpdir(),
    `js-mvc-seed-${createHash("sha1").update(seedPath).digest("hex").slice(0, 12)}-${Date.now()}.mjs`,
  );
  await writeFile(tmpFile, code, "utf-8");
  try {
    const mod = (await import(pathToFileURL(tmpFile).href)) as {
      seed: SeedSpec;
    };
    return mod.seed;
  } finally {
    await unlink(tmpFile).catch(() => {});
  }
}

async function generateSeedOutput(paths: ResolvedPaths): Promise<void> {
  const spec = await loadSeedSpec(
    paths.projectRoot,
    paths.seedPath,
    paths.schemaModulePath,
    paths.schemaSourcePath,
  );
  const compiled = compileSeed(spec);

  const header = `// AUTO-GENERATED by @spindle/spindle/fiber — do not edit\n// Source of truth: src/domains/seed.ts\n\n`;
  const content = `${header}import type { CompiledSeed } from "@spindle/spindle/fiber";\n\nexport const seedDef: CompiledSeed = ${JSON.stringify(compiled, null, 2)};\n`;

  await mkdir(dirname(paths.outputPath), { recursive: true });
  // Unique temp name: concurrent generators (e.g. a running dev server and a
  // build/test run) can collide on a fixed `.tmp` path. Last writer wins on
  // the final rename, which is safe — content is identical or newer.
  const tmpPath = `${paths.outputPath}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(tmpPath, content, "utf-8");
  await rename(tmpPath, paths.outputPath);
}

// ---------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------

export function seedPlugin(options: SeedPluginOptions = {}): Plugin {
  let paths: ResolvedPaths;

  return {
    name: "js-mvc-seed",
    enforce: "pre",

    configResolved(config) {
      paths = resolvePaths(config.root, options);
    },

    async buildStart() {
      console.log("🌱 Generating seed data...");
      try {
        await generateSeedOutput(paths);
        console.log("✓ Seed data generated");
      } catch (e) {
        console.error("✗ Seed generation failed:", (e as Error).message);
        throw e;
      }
    },

    configureServer(server) {
      const regenerate = async (file: string) => {
        const sources = [paths.seedPath, paths.schemaModulePath];
        if (!sources.some((s) => file === s)) return;
        try {
          await generateSeedOutput(paths);
          for (const mod of server.moduleGraph.getModulesByFile(
            paths.outputPath,
          ) ?? []) {
            server.moduleGraph.invalidateModule(mod);
          }
          console.log("✓ Seed data regenerated");
        } catch (e) {
          console.error("✗ Seed generation failed:", (e as Error).message);
        }
      };
      server.watcher.add(paths.seedPath);
      server.watcher.add(paths.schemaModulePath);
      server.watcher.on("change", regenerate);
      server.watcher.on("add", regenerate);
    },
  };
}
