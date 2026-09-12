import type { GuardDescriptor, MethodDecoratorFactory } from "./index";

/** Shared metadata key used by decorators and ControllerBase. */
export const GUARDS_KEY = Symbol("hono:guards");

/**
 * Base class for guard decorators.
 *
 * A concrete decorator supplies the type-specific descriptor fields (via
 * `build()`) and inherits `decorate()` to produce a callable method
 * decorator factory. `guardDecorator` appends the `handlerName` from the
 * decorated method name automatically.
 *
 * @example
 *   class ExistsDecorator extends GuardDecorator<ExistsGuard> {
 *     constructor(private readonly GuardClass: new () => IExistable) { super(); }
 *     protected build() { return { type: "exists", GuardClass: this.GuardClass }; }
 *   }
 *
 *   export function Exists(GuardClass) {
 *     return new ExistsDecorator(GuardClass).decorate();
 *   }
 */
export abstract class GuardDecorator<G extends GuardDescriptor> {
  /** Type-specific descriptor fields (type + class), without handlerName. */
  protected abstract build(): Omit<G, "handlerName">;

  /**
   * Build a method decorator that registers a guard for the decorated method.
   *
   * Takes the guard's type-specific fields and appends the handlerName
   * automatically from the decorated method name, pushing the completed
   * descriptor into the shared metadata.
   */
  static guardDecorator<G extends GuardDescriptor>(
    guard: Omit<G, "handlerName">,
  ): MethodDecoratorFactory {
    return (_target, context) => {
      const metadata = context.metadata as Record<PropertyKey, unknown>;
      const guards = (metadata[GUARDS_KEY] ??= []) as GuardDescriptor[];
      guards.push({
        ...guard,
        handlerName: String(context.name),
      } as G);
    };
  }

  /** Produce a callable method decorator factory for this guard. */
  decorate(): MethodDecoratorFactory {
    return GuardDecorator.guardDecorator(this.build());
  }
}
