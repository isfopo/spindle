import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";
import {
  schemaPlugin,
  seedPlugin,
  sqlPlugin,
} from "../../package/plugins/index.ts";

export default defineConfig({
  esbuild: {
    jsx: "automatic",
    jsxImportSource: "hono/jsx",
  },
  plugins: [
    schemaPlugin(),
    seedPlugin(),
    sqlPlugin(),
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
      ".vite/**/*.test.ts",
      "package/**/*.test.ts",
      "package/**/*.test.tsx",
    ],
  },
});
