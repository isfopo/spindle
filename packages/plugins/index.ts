/**
 * Build-time Vite plugins — kept separate from the runtime entries (fiber,
 * thread, fabric) so consuming apps can import runtime code without dragging
 * Node-only plugin code (fs, clean-css, esbuild) into worker or client bundles.
 */
export {
  schemaPlugin,
  type SchemaPluginOptions,
} from "../fiber/plugins/schema-plugin";
export { seedPlugin, type SeedPluginOptions } from "../fiber/plugins/seed-plugin";
export { sqlPlugin, type SqlPluginOptions } from "../fiber/plugins/sql-plugin";
export { clientBuildPlugin, type ClientBuildPluginOptions } from "../thread/plugins/client-build-plugin";
export {
  cssBuildPlugin,
  type CssBuildPluginOptions,
} from "../fabric/plugins/css-build-plugin";
export {
  handlerRegistryPlugin,
  type HandlerRegistryPluginOptions,
} from "../fabric/plugins/handler-registry-plugin";