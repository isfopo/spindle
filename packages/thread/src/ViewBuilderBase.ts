/**
 * ViewBuilderBase — abstract base for view-model builders.
 *
 * A view builder maps domain/service data to a typed view-model object that
 * is passed to a view component declared via `@Render`. Builders stay
 * decoupled from Hono: each method takes explicit typed arguments and
 * returns a plain view-model object, which the framework renders for us.
 *
 * Controllers reference the builder via `this.models` (see ControllerBase),
 * so project code never constructs an instance or exports a singleton by
 * hand. Each concrete subclass exposes a shared singleton through the
 * inherited `instance()` static:
 *
 * ```ts
 * import { ViewBuilderBase } from "js-mvc/view/ViewBuilderBase";
 *
 * export class TenetViewBuilder extends ViewBuilderBase {
 *   // methods...
 * }
 *
 * // Controllers get the shared instance via `this.models`, resolved from
 * // the builder class declared on `@Render`.
 * ```
 *
 * `instance()` returns one shared instance per concrete subclass, keyed by
 * the subclass constructor, so every caller observes the same object
 * without an explicit singleton export.
 */
export abstract class ViewBuilderBase {
  /* One shared instance per concrete subclass. Keyed by the subclass
     constructor (see `this` below) so we never call `new` from project code. */
  private static instances = new WeakMap<Function, ViewBuilderBase>();

  /**
   * Return the shared singleton instance for the concrete subclass this is
   * called on. `this` is bound to the subclass constructor, which is used
   * as the WeakMap key — so each concrete builder has exactly one instance.
   */
  static instance<T extends ViewBuilderBase>(this: new () => T): T {
    let value = ViewBuilderBase.instances.get(this);
    if (!value) {
      value = new this();
      ViewBuilderBase.instances.set(this, value);
    }
    return value as T;
  }
}
