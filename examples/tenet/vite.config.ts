import { cloudflare } from "@cloudflare/vite-plugin";
import { defineConfig } from "vite";
import {
  clientBuildPlugin,
  cssBuildPlugin,
  handlerRegistryPlugin,
  schemaPlugin,
  seedPlugin,
  sqlPlugin,
} from "@spindle/spindle/fiber";

export default defineConfig({
  plugins: [
    schemaPlugin(),
    seedPlugin(),
    sqlPlugin(),
    cssBuildPlugin({
      sourceDirs: [
        "src/views/tokens",
        "src/views/elements",
        "src/views/components",
        "src/views/routes",
      ],
    }),
    clientBuildPlugin(),
    handlerRegistryPlugin({
      // Handlers are auto-discovered by this glob; no per-handler paths
      // need to be maintained in source.
      include: "src/views/handlers/**/*Handler.ts",
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
