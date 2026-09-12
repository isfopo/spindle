import { fileURLToPath } from "node:url";
import { existsSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";
import type { Plugin } from "vite";
import { fiberPlugin } from "@spindle/spindle/plugins";

const root = fileURLToPath(new URL(".", import.meta.url));

/** Mirrors tsconfig paths `"*": ["./src/*"]`: bare imports like
 *  `views/...`, `domains/...`, `error-handler` resolve under src/ first,
 *  falling back to normal node_modules resolution when no src file matches. */
function srcPathsAlias(): Plugin {
  return {
    name: "src-paths",
    enforce: "pre",
    resolveId(source: string, importer?: string) {
      if (!importer || source.startsWith(".") || source.startsWith("@")) return;
      const candidates = [
        resolve(root, "src", source),
        resolve(root, "src", `${source}.ts`),
        resolve(root, "src", `${source}.tsx`),
        resolve(root, "src", source, "index.ts"),
        resolve(root, "src", source, "index.tsx"),
      ];
      const hit = candidates.find(
        (p) => existsSync(p) && statSync(p).isFile(),
      );
      if (hit) return hit;
    },
  };
}

export default defineConfig({
  esbuild: {
    jsx: "automatic",
    jsxImportSource: "hono/jsx",
  },
  plugins: [
    srcPathsAlias(),
    fiberPlugin(),
    cloudflareTest({
      wrangler: { configPath: "./wrangler.jsonc" },
      miniflare: {
        bindings: {
          GITHUB_CLIENT_ID: "test-client-id",
          GITHUB_CLIENT_SECRET: "test-client-secret",
        },
      },
    }),
  ],
  test: {
    include: [
      "src/**/*.test.ts",
      "src/**/*.test.tsx",
      ".vite/**/*.test.ts"
    ],
  },
});
