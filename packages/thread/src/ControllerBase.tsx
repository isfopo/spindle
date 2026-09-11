/* ------------------------------------------------------------------ */
/*  Stage 3 Decorators & Metadata                                      */
/*                                                                     */
/*  Uses the TC39 decorator proposal (Stage 3) with the companion      */
/*  decorator-metadata proposal.                                       */
/*    https://github.com/tc39/proposal-decorators                      */
/*    https://github.com/tc39/proposal-decorator-metadata              */
/*                                                                     */
/*  We store route descriptors in `context.metadata` so every          */
/*  decorator on the same class shares the same object, and later      */
/*  read them back via `Constructor[Symbol.metadata]`.                 */
/*                                                                     */
/*  At build time esbuild transpiles the decorators down to runtime    */
/*  helpers (the vite config sets `esbuild.target: "es2022"`).         */
/*                                                                     */
/*  Since `Symbol.metadata` is not yet available in every runtime      */
/*  (including Cloudflare Workers / workerd) we define it here as      */
/*  a polyfill if it is missing.                                       */
/* ------------------------------------------------------------------ */

import { Context, Env, Hono } from "hono";
import { renderToString } from "hono/jsx/dom/server";
import type { FC } from "hono/jsx";
import { NotFoundError, ValidationError } from "./errors";
import { parseRequestBody } from "./middleware/parseBody";
import { GUARDS_KEY } from "./guards/GuardDecorator";
import type { GuardDescriptor, MethodDecoratorFactory } from "./guards";
import { ViewBuilderBase } from "./ViewBuilderBase";

/**
 * A render descriptor records that a route handler's return value (a plain
 * view-model object) should be rendered inside the declared View component,
 * and that the handler builds that view-model via the paired builder class.
 */
export interface RenderDescriptor {
  handlerName: string;
  view: FC<any>;
  builder: new () => any;
}

/**
 * Shared metadata key used by `@Render` and read back by
 * `ControllerBase.register()`.
 */
export const RENDER_KEY = Symbol("hono:render");

/**
 * Declare which View component should render this handler's view-model, and
 * which view-builder class builds that view-model.
 *
 * The decorated handler builds its view-model via `this.models` (the shared
 * `ViewBuilderBase.instance()` for the declared builder class) and `return`s
 * the plain object. `ControllerBase.register()` wires the route so that, when
 * the handler returns a non-`Response` object, it is rendered inside the
 * declared View — instead of the handler calling `c.render(...)` itself.
 *
 * Routes not decorated with `@Render` (and handlers returning a `Response`
 * such as `c.redirect(...)`) are left untouched.
 *
 * @example
 *   @Get("/")
 *   @Render(IndexView, TenetViewBuilder)
 *   index(c) {
 *     const result = await services.list(c.env.DB);
 *     return this.models.index(result.tenets, user);
 *   }
 */
export function Render(
  view: FC<any>,
  builder: new () => any,
): MethodDecoratorFactory {
  return function <This>(
    _target: (this: This, ...args: any[]) => any,
    context: ClassMethodDecoratorContext<This>,
  ): void {
    const metadata = context.metadata as Record<PropertyKey, unknown>;
    const renders: RenderDescriptor[] = ((metadata[RENDER_KEY] as
      RenderDescriptor[]) ??= []);
    renders.push({ handlerName: String(context.name), view, builder });
  };
}

/* ---------- Symbol.metadata polyfill ---------- */

if (typeof Symbol !== "undefined" && !Symbol.metadata) {
  (Symbol as { metadata: symbol }).metadata = Symbol("Symbol.metadata");
}

/* ---------- Route descriptor types ---------- */

export interface RouteDescriptor {
  method: "get" | "post" | "put" | "delete" | "patch";
  path: string;
  handlerName: string;
}

/** Well-known key used to store routes inside the decorator metadata. */
const ROUTES_KEY = Symbol("hono:routes");

/* ---------- Decorator factory ---------- */

function httpRoute(method: string, path: string) {
  return function <This>(
    _target: (this: This, ...args: any[]) => any,
    context: ClassMethodDecoratorContext<This>,
  ): void {
    const routes: RouteDescriptor[] = (((context.metadata as any)[
      ROUTES_KEY
    ] as RouteDescriptor[]) ??= []);
    routes.push({
      method: method as RouteDescriptor["method"],
      path,
      handlerName: String(context.name),
    });
  };
}

/* ---------- Exported decorators ---------- */

export const Get = (path: string) => httpRoute("get", path);
export const Post = (path: string) => httpRoute("post", path);
export const Put = (path: string) => httpRoute("put", path);
export const Delete = (path: string) => httpRoute("delete", path);
export const Patch = (path: string) => httpRoute("patch", path);

/* ---------- Render config ---------- */

/**
 * A layout component provided by the project.
 */
export type LayoutComponent = FC;

export type ErrorHandler<T extends Env> = (
  c: Context<T>,
  error: unknown,
) => Response | Promise<Response>;

export interface ControllerRenderConfig<T extends Env> {
  layout: LayoutComponent;
  handleError: ErrorHandler<T>;
}

/* ---------- Controller base class ---------- */

export abstract class ControllerBase<T extends Env> {
  _app: Hono<T>;
  abstract base: string;
  renderConfig?: ControllerRenderConfig<T>;

  /**
   * Per-route view-model builder instance, resolved from the builder class
   * declared on `@Render` by `register()` and set just before the handler
   * runs. A handler on a `@Render`-decorated route reads it via
   * `this.models.<method>(...)`. Routes without `@Render` never touch it.
   *
   * Typed pragmatically: each route may pair with a different concrete
   * builder, so the accessor exposes the base plus any callable builder
   * method (project usage like `this.models.index(...)` type-checks).
   */
  get models(): ViewBuilderBase & Record<string, (...args: any[]) => any> {
    return this._builder as ViewBuilderBase &
      Record<string, (...args: any[]) => any>;
  }
  private _builder?: ViewBuilderBase;

  constructor() {
    this._app = new Hono();
  }

  /** Set render config for this controller instance */
  configureRendering(config: ControllerRenderConfig<T>): void {
    this.renderConfig = config;
  }

  /**
   * Execute a single guard against the current request context.
   *
   * - `exists`   → instantiates the IExistable, calls load(), throws NotFoundError if null, stores on context
   * - `authorize` → instantiates the IAuthorizable, calls authorize() (should throw on failure)
   * - `validate`  → reads the body parsed by the parseBody() middleware,
   *   constructs IValidatable, runs validate(), stores on context
   *
   * Called by register() before each route handler.
   */
  static async executeGuard(
    guard: GuardDescriptor,
    c: Context,
  ): Promise<void> {
    switch (guard.type) {
      case "exists": {
        const instance = new guard.GuardClass();
        const entity = await instance.load(c);
        if (entity == null) throw new NotFoundError();
        c.set(instance.key, entity);
        break;
      }

      case "authorize": {
        const instance = new guard.GuardClass();
        await instance.authorize(c);
        break;
      }

      case "validate": {
        const body = parseRequestBody(c);
        const instance = new guard.RequestClass(body);
        const result = await instance.validate();

        if (!result.valid) {
          throw new ValidationError("Invalid input", result.errors);
        }

        c.set("body", instance);
        break;
      }
    }
  }

  /** Register every collected route on the parent Hono application. */
  register<E extends Env>(app: Hono<E>): void {
    /* Read the route table that the decorators wrote to the shared
       metadata object.  After esbuild has finished transpiling,
       `Constructor[Symbol.metadata]` points to the same object that
       was passed as `context.metadata` to every decorator on this
       class. */
    const metadata = (this.constructor as any)[Symbol.metadata];
    const routes: RouteDescriptor[] = metadata?.[ROUTES_KEY] ?? [];
    const guards: GuardDescriptor[] = metadata?.[GUARDS_KEY] ?? [];
    const renders: RenderDescriptor[] = metadata?.[RENDER_KEY] ?? [];

    /* Map handlerName → View component for fast lookup when wrapping routes. */
    const renderByHandler = new Map<string, FC>();
    const builderByHandler = new Map<string, new () => any>();
    for (const render of renders) {
      renderByHandler.set(render.handlerName, render.view);
      builderByHandler.set(render.handlerName, render.builder);
    }

    /* Attach a renderer that wraps every response in the shared layout.
       This is inherited by all routes registered below. */
    this._app.use("*", async (c: Context, next) => {
      c.setRenderer((content: any) => {
        const doctype = "<!DOCTYPE html>";
        const Layout = this.renderConfig?.layout;
        if (!Layout) {
          return c.html(doctype + renderToString(content));
        }
        // All values set via c.set() are spread as props into the Layout.
        // This means middleware-set values (e.g., c.set("user", ...)) become
        // layout props automatically. Avoid setting internal-only values
        // via c.set() if they should not leak to the layout.
        const body = renderToString(
          <Layout {...c.var} currentPath={c.req.path}>
            {content}
          </Layout>,
        );
        return c.html(doctype + body);
      });
      await next();
    });

    /* Wire each route to the matching handler on this controller. */
    for (const route of routes) {
      const handlerGuards = guards.filter(
        (g) => g.handlerName === route.handlerName,
      );

      this._app[route.method](route.path, async (c: Context) => {
        try {
          /* Execute guards in declaration order before the handler. */
          for (const guard of handlerGuards) {
            await ControllerBase.executeGuard(guard, c);
          }

          /* Resolve the paired view-builder (if any) so `this.models` returns
             the shared instance while this handler runs. Set it before the
             handler and clear it after so undecorated routes never see a
             stale builder. */
          const builderClass = builderByHandler.get(route.handlerName);
          this._builder = builderClass
            ? ViewBuilderBase.instance.call(builderClass)
            : undefined;

          const result = await (this as any)[route.handlerName](c);

          /* If this route declared @Render and the handler returned a plain
             view-model object (not a Response like c.redirect), render it
             inside the declared View. Routes without @Render — and handlers
             that return a Response — pass through untouched. */
          const View = renderByHandler.get(route.handlerName);
          if (
            View &&
            result != null &&
            typeof result === "object" &&
            !(result instanceof Response)
          ) {
            return c.render(<View {...(result as Record<string, unknown>)} />);
          }
          return result;
        } catch (error: unknown) {
          const errorHandler = this.renderConfig?.handleError;
          if (errorHandler) {
            return errorHandler(c, error);
          }
          // Default fallback — prevents unhandled rejections if
          // configureRendering() was never called on this controller.
          return c.html("<!DOCTYPE html><h1>Internal Server Error</h1>", 500);
        }
      });
    }

    app.route(this.base, this._app);
  }
}
