/**
 * fiberPlugin — the data-layer Vite plugin for the fiber branch.
 *
 * Merges the former schema, seed, and sql plugins into a single pipeline run
 * from one ordered buildStart (and dev watcher):
 *
 *   1. load the schema definition
 *   2. write the runtime schema module (src/.generated/schema.ts)
 *   3. load the seed spec for literal lookup rows (checkRef unions)
 *   4. write the derived schema.sql and model types
 *   5. compile the seed into a pure-data module (src/.generated/seed.ts)
 *   6. compile every procs.ts into a typed SQL module
 *
 * A single ordered pass removes the concurrent-buildStart workarounds the
 * separate plugins needed (schema ↔ seed ↔ sql all feed off each other).
 */

import type { Plugin, ViteDevServer } from "vite";
import {
  loadSchemaModule,
  writeRuntimeSchema,
  writeSchemaOutputs,
} from "./schema";
import { generateSeedOutput, loadSeedLookups } from "./seed";
import {
  findProcsFiles,
  generateProcs,
  procsOutputFor,
} from "./procs";
import {
  resolveFiberPaths,
  type FiberPluginOptions,
  type ResolvedFiberPaths,
} from "./options";

export type { FiberPluginOptions } from "./options";

export function fiberPlugin(options: FiberPluginOptions = {}): Plugin {
  let paths: ResolvedFiberPaths;

  async function runPipeline(): Promise<void> {
    const schema = await loadSchemaModule(paths.projectRoot, paths.schemaPath);
    await writeRuntimeSchema(paths, schema);
    const lookups = await loadSeedLookups(paths);
    await writeSchemaOutputs(paths, schema, lookups);
    await generateSeedOutput(paths);
    await generateProcs(paths, schema, lookups);
  }

  function invalidateModules(server: ViteDevServer, files: string[]): void {
    for (const file of files) {
      for (const mod of server.moduleGraph.getModulesByFile(file) ?? []) {
        server.moduleGraph.invalidateModule(mod);
      }
    }
  }

  return {
    name: "spindle:fiber",
    enforce: "pre",

    configResolved(config) {
      paths = resolveFiberPaths(config.root, options);
    },

    async buildStart() {
      console.log("🧵 fiber: generating schema, seed, and procs...");
      try {
        await runPipeline();
        console.log("✓ fiber outputs generated");
      } catch (e) {
        // Fail the build loudly: stale generated files must not ship (or pass
        // CI with exit 0) when generation breaks.
        console.error("✗ fiber generation failed:", (e as Error).message);
        throw e;
      }
    },

    configureServer(server) {
      for (const dir of paths.procsDirs) server.watcher.add(dir);
      server.watcher.add(paths.schemaPath);
      server.watcher.add(paths.seedPath);

      const onSourceChange = async (file: string) => {
        try {
          await runPipeline();
          const procsFiles = await findProcsFiles(paths.procsDirs);
          invalidateModules(server, [
            paths.runtimeSchemaPath,
            paths.runtimeSeedPath,
            paths.dbTypesPath,
            ...procsFiles.map(procsOutputFor),
          ]);
          console.log("✓ fiber outputs regenerated");
        } catch (e) {
          console.error(
            "✗ fiber regeneration failed:",
            (e as Error).message,
          );
        }
      };

      server.watcher.on("change", onSourceChange);
      server.watcher.on("add", onSourceChange);
    },
  };
}