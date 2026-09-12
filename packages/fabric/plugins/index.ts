/**
 * fabricPlugin — the asset + client layer Vite plugin for the fabric branch.
 *
 * Merges the former css and handler-registry plugins into a single plugin:
 * a buildStart that bundles CSS and writes the generated handler modules, and
 * one configureServer that watches CSS sources (rebuild + HMR touch) and
 * handler files (regenerate on add/remove).
 */

import type { Plugin, ViteDevServer } from "vite";
import { basename } from "node:path";
import {
  buildCss,
  resolveCssPaths,
  type CssOptions,
  type ResolvedCssPaths,
} from "./css";
import {
  discover,
  includeRoots,
  isUnderInclude,
  resolveHandlersPaths,
  writeHandlerModules,
  type HandlersOptions,
  type ResolvedHandlersPaths,
} from "./handlers";

export interface FabricPluginOptions {
  /** CSS bundling options. */
  css?: CssOptions;
  /** Client handler registration options. */
  handlers?: HandlersOptions;
}

export function fabricPlugin(options: FabricPluginOptions = {}): Plugin {
  let cssPaths: ResolvedCssPaths;
  let handlerPaths: ResolvedHandlersPaths;
  let isBuilding = false;

  const buildCssBundle = () => {
    console.log("🔨 Building CSS...");
    try {
      buildCss(cssPaths);
    } catch (err) {
      console.error("✗ CSS build failed:", (err as Error).message);
    }
  };

  const writeHandlers = async () => {
    try {
      const files = await discover(handlerPaths);
      writeHandlerModules(handlerPaths, files);
    } catch (err) {
      console.error(
        "✗ handler registration build failed:",
        (err as Error).message,
      );
    }
  };

  return {
    name: "spindle:fabric",
    enforce: "pre",

    configResolved(config) {
      cssPaths = resolveCssPaths(config.root, options.css);
      handlerPaths = resolveHandlersPaths(config.root, options.handlers);
    },

    async buildStart() {
      buildCssBundle();
      await writeHandlers();
    },

    configureServer(server: ViteDevServer) {
      // --- CSS: rebuild on source change, then touch the HMR trigger file. ---
      if (cssPaths.runInDev) {
        for (const dir of cssPaths.sourceDirs) {
          server.watcher.add(dir);
        }

        server.watcher.on("change", (file: string) => {
          const isExcluded = cssPaths.excludePaths.some((p) =>
            file.includes(p),
          );
          const isInSourceDir = cssPaths.sourceDirs.some((d) =>
            file.startsWith(d),
          );
          if (
            (file.endsWith(".css") ||
            file.endsWith(".module.css") ||
            file.endsWith(".svg")) &&
            !isExcluded &&
            isInSourceDir &&
            !isBuilding
          ) {
            isBuilding = true;
            console.log(`\n📝 ${basename(file)} changed, rebuilding CSS...`);
            try {
              buildCss(cssPaths);
              // Trigger HMR by touching the configured layout file
              if (cssPaths.hmrTriggerFile) {
                server.watcher.emit("change", cssPaths.hmrTriggerFile);
              }
              console.log("✓ CSS rebuilt\n");
            } catch (err) {
              console.error("✗ CSS build failed:", (err as Error).message);
            } finally {
              isBuilding = false;
            }
          }
        });
      }

      // --- Handlers: regenerate when handler files are added or removed. ---
      server.watcher.add(dirname(handlerPaths.outfile));
      server.watcher.add(dirname(handlerPaths.entryOutfile));
      for (const root of includeRoots(handlerPaths)) {
        server.watcher.add(root);
      }

      let timeout: ReturnType<typeof setTimeout> | null = null;

      const regenerate = async () => {
        try {
          const files = await discover(handlerPaths);
          writeHandlerModules(handlerPaths, files);
          // The module's import graph may have changed; reload the client
          // entry so the browser picks up new registrations.
          server.watcher.emit("change", handlerPaths.entryOutfile);
        } catch (err) {
          console.error(
            "✗ handler registration rebuild failed:",
            (err as Error).message,
          );
        }
      };

      const debounced = () => {
        if (timeout) clearTimeout(timeout);
        timeout = setTimeout(regenerate, 100);
      };

      const onFile = (file: string) => {
        if (isUnderInclude(handlerPaths, file)) debounced();
      };

      server.watcher.on("add", onFile);
      server.watcher.on("unlink", onFile);

      server.httpServer?.on("close", () => {
        if (timeout) clearTimeout(timeout);
      });
    },
  };
}