import { fileURLToPath } from "node:url";
import { existsSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { cloudflare } from "@cloudflare/vite-plugin";
import { defineConfig, type Plugin } from "vite";
import { spindlePlugin } from "@spindle/spindle/plugins";

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
  plugins: [
    srcPathsAlias(),
    spindlePlugin({
      fabric: {
        css: {
          sourceDirs: [
            "src/views/tokens",
            "src/views/elements",
            "src/views/components",
            "src/views/routes",
          ],
        },
        handlers: {
          // Handlers are auto-discovered by this glob; no per-handler paths
          // need to be maintained in source.
          include: "src/views/handlers/**/*Handler.ts",
        },
      },
    }),
    cloudflare({ inspectorPort: 9229 }),
  ],
  esbuild: {
    target: "es2022",
    jsx: "automatic",
    jsxImportSource: "hono/jsx",
  },
  build: {
    cssMinify: false,
  }
});
