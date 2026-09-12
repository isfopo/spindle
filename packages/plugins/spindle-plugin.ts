import type { Plugin } from "vite";
import { fiberPlugin, type FiberPluginOptions } from "../fiber/plugins/fiber-plugin";
import { fabricPlugin, type FabricPluginOptions } from "../fabric/plugins/fabric-plugin";
import { threadPlugin, type ThreadPluginOptions } from "../thread/plugins/thread-plugin";

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