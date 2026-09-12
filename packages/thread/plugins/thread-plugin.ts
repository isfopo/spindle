/**
 * threadPlugin — the client-side bundling Vite plugin for the thread branch.
 *
 * Uses esbuild to compile the generated client entry point into a static JS
 * bundle served as a production asset. Skipped during dev mode (Vite handles
 * HMR natively for the entry point).
 */

import type { Plugin } from "vite";
import { build, type BuildOptions } from "esbuild";
import { dirname } from "path";
import { mkdirSync } from "node:fs";

export interface ThreadPluginOptions {
  /**
   * Entry point for the client bundle (relative to project root or absolute).
   * This is the generated client entry written by `fabricPlugin` — the module
   * that imports the generated handler registration and re-exports the
   * framework's hydration functions.
   *
   * @default "src/.generated/client-entry.ts"
   */
  entryPoint?: string;

  /**
   * Output file path for the bundled client JS (relative to project root or absolute).
   * @default "public/.generated/client/index.js"
   */
  outfile?: string;

  /**
   * Additional esbuild options (e.g., external packages, define, etc.).
   */
  esbuildOptions?: Partial<BuildOptions>;
}

export function threadPlugin(options: ThreadPluginOptions = {}): Plugin {
  const {
    entryPoint = "src/.generated/client-entry.ts",
    outfile = "public/.generated/client/index.js",
    esbuildOptions = {},
  } = options;

  let isBuild = false;

  return {
    name: "spindle:thread",

    configResolved(config) {
      isBuild = config.command === "build";
    },

    async closeBundle() {
      // Only run during production builds, not dev
      if (!isBuild) {
        return;
      }

      console.log("🔨 Building client JS...");

      const outDir = dirname(outfile);
      mkdirSync(outDir, { recursive: true });

      try {
        await build({
          entryPoints: [entryPoint],
          outfile,
          bundle: true,
          format: "esm",
          target: "es2020",
          sourcemap: true,
          minify: true,
          ...esbuildOptions,
        });

        console.log("✓ Client JS built\n");
      } catch (err) {
        console.error("✗ Client build failed:", (err as Error).message);
      }
    },
  };
}