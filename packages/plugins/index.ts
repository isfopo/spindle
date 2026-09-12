/**
 * Build-time Vite plugins — kept separate from the runtime entries (fiber,
 * thread, fabric) so consuming apps can import runtime code without dragging
 * Node-only plugin code (fs, clean-css, esbuild) into worker or client bundles.
 *
 *   spindlePlugin(options) → all three branches in one call (Plugin[])
 *   fiberPlugin(options)   → schema, seed, and stored-query compilation
 *   fabricPlugin(options)  → CSS bundling and client handler registration
 *   threadPlugin(options)  → client-side TypeScript bundling
 */
export {
  spindlePlugin,
  type SpindlePluginOptions,
} from "./spindle-plugin";
export {
  fiberPlugin,
  type FiberPluginOptions,
} from "../fiber/plugins/fiber-plugin";
export {
  fabricPlugin,
  type FabricPluginOptions,
} from "../fabric/plugins/fabric-plugin";
export {
  threadPlugin,
  type ThreadPluginOptions,
} from "../thread/plugins/thread-plugin";