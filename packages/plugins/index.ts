import type { Plugin } from "vite";
import { fabricPlugin, FabricPluginOptions } from "fabric/plugins";
import { fiberPlugin, FiberPluginOptions } from "fiber/plugins";
import { ThreadPluginOptions, threadPlugin } from "thread/plugins";

/** Options for the unified `spindlePlugin`, grouped by branch. */
export interface SpindlePluginOptions {
  /** Data-layer generation: schema, seed, and stored-query compilation. */
  fiber?: FiberPluginOptions;
  /** Asset + client layer: CSS bundling and client handler registration. */
  fabric?: FabricPluginOptions;
  /** Client-side TypeScript bundling (esbuild). */
  thread?: ThreadPluginOptions;
}

/**
 * Unified Vite plugin for all three branches.
 *
 * Returns the composed plugin array, so it slots into `plugins: [spindlePlugin(...)]`
 * directly. Each branch plugin (`fiberPlugin`, `fabricPlugin`, `threadPlugin`)
 * remains usable individually.
 */
export function spindlePlugin(options: SpindlePluginOptions = {}): Plugin[] {
  return [
    fiberPlugin(options.fiber),
    fabricPlugin(options.fabric),
    threadPlugin(options.thread),
  ];
}

export { fiberPlugin, type FiberPluginOptions } from "../fiber/plugins";
export { fabricPlugin, type FabricPluginOptions } from "../fabric/plugins";
export { threadPlugin, type ThreadPluginOptions } from "../thread/plugins";
