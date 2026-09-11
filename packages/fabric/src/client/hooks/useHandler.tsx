/**
 * useHandler — server-side component factory for wiring up client-side handlers.
 *
 * Keeps handler classes and their rendered HTML together. Each rendered
 * instance gets a generated id plus an inline script that hydrates the
 * handler onto that element — the handler "ships with" its HTML, and the
 * handler name never appears in the markup or in the component interface.
 *
 * Usage:
 *
 *   // Wrapper + Trigger — handler scoped to a container element
 *   const Dismiss = useHandler(DismissHandler);
 *
 *   <Dismiss class="card">
 *     <span>Content</span>
 *     <Dismiss.Trigger event="click" method="hide">
 *       <button>✕</button>
 *     </Dismiss.Trigger>
 *   </Dismiss>
 *
 *   // Trigger only — handler lives on the interactive element itself
 *   const Confirm = useHandler(ConfirmHandler);
 *
 *   <Confirm.Trigger event="click" method="ask" message="Are you sure?">
 *     <a href="/">Proceed</a>
 *   </Confirm.Trigger>
 *
 * Params passed to Wrapper or Trigger (like `message`) are automatically
 * converted to data-{key} attributes on the element, readable in the
 * handler via this.data("key"). Known HTML attributes (class, style,
 * data-*, aria-*, ...) pass through untouched.
 */

import { genId } from "../../utils";
import { JSX } from "react";

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

/** Module URL of the client bundle that exports hydrate() */
const CLIENT_MODULE_URL =
  typeof import.meta.env !== "undefined" && import.meta.env.DEV
    ? "/src/.generated/client-entry.ts"
    : "/.generated/client/index.js";

/** Inline script that hydrates one handler instance onto its element */
const HydrateScript = ({ name, id }: { name: string; id: string | null }) => (
    <script
      type="module"
      dangerouslySetInnerHTML={{
        __html: `import { hydrate } from ${JSON.stringify(CLIENT_MODULE_URL)};hydrate(${JSON.stringify(name)},${JSON.stringify(id ?? genId())});`,
      }}
    />
  );

/** HTML attributes passed through as-is; everything else becomes data-{key} */
const HTML_ATTRS = new Set(["class", "style", "role", "title", "hidden", "name"]);

/** Convert component props to element attributes */
const toAttrs = (props: Record<string, any>): Record<string, any> => {
  const attrs: Record<string, any> = {};
  for (const key of Object.keys(props)) {
    if (
      HTML_ATTRS.has(key) ||
      key.startsWith("data-") ||
      key.startsWith("aria-")
    ) {
      attrs[key] = props[key];
    } else {
      attrs[`data-${key}`] = String(props[key]);
    }
  }
  return attrs;
}

/**
 * Re-render a single JSX child element with extra attributes merged in.
 * Falls back to wrapping in a span when there is no single child.
 */
function renderChild(children: any, inject: Record<string, string | null>): any {
  if (
    children != null &&
    typeof children === "object" &&
    "props" in children &&
    !Array.isArray(children)
  ) {
    const Tag = (children as any).tag as keyof JSX.IntrinsicElements;
    const childProps = (children as any).props || {};
    const childChildren = (children as any).children;
    return (
      <Tag {...childProps} {...inject}>
        {childChildren}
      </Tag>
    );
  }
  return <span {...inject}>{children}</span>;
}

// ---------------------------------------------------------------------------
// Component factory
// ---------------------------------------------------------------------------

type TriggerProps<HA extends Record<string, string>, E extends keyof HA> = {
  /** DOM event to listen for */
  event: keyof GlobalEventHandlersEventMap | (string & {});
  /** Method name on the handler class */
  method: HA[E];
  children?: any;
} & Record<string, any>;

type WrapperProps = {
  /** HTML tag to render (default: "div") */
  tag?: string;
  children?: any;
} & Record<string, any>;

/**
 * Abstract base class for client-side handlers.
 *
 * Mirrors the server-side ControllerBase pattern. Subclasses implement
 * `connect()`; the handler name is derived from the class name at runtime
 * (e.g. `DismissHandler` → `"dismiss"`), so no decorator or static
 * declaration is needed.
 *
 * Usage is via the useHandler component factory:
 *
 *   const Confirm = useHandler(ConfirmHandler);
 *   <Confirm.Trigger event="click" method="ask" message="Delete?">
 *     <button>Delete</button>
 *   </Confirm.Trigger>
 *
 * This renders the button with a generated id, `data-action="click->ask"`,
 * a `data-message="Delete?"` param, and an inline script that hydrates
 * ConfirmHandler onto that button:
 *
 *   <button id="..." data-action="click->ask" data-message="Delete?">Delete</button>
 *   <script type="module">
 *     import { hydrate } from "...";
 *     hydrate("confirm", "...");
 *   </script>
 */

/**
 * Shared types for the client-side handler system.
 */

/** The action descriptor parsed from a data-action attribute */
export interface ActionDescriptor {
  /** DOM event name (click, submit, change, etc.) */
  event: string;
  /** Method name on the handler instance */
  method: string;
}

/** A constructor for a Handler subclass */
export interface HandlerConstructor {
  new (element: HTMLElement): Handler;
  /** Handler name derived from the class name (e.g. "dismiss" for DismissHandler) */
  readonly handlerName: string;
}

/** Names of lifecycle methods that can emit errors */
export type LifecycleName =
  | "beforeConnect"
  | "connect"
  | "afterConnect"
  | "beforeDisconnect"
  | "disconnect"
  | "appear"
  | "disappear";

/** Minimal handler interface used by the runtime */
export interface Handler {
  /** Called before the handler is wired up (setup, initial state) */
  beforeConnect?(): void;

  /** Called after the handler is instantiated and targets are resolved */
  connect?(): void;

  /** Called after all wiring is complete (safe to interact with DOM) */
  afterConnect?(): void;

  /** Called before the handler is torn down */
  beforeDisconnect?(): void;

  /** Called when the element is removed from the DOM (cleanup) */
  disconnect?(): void;

  /** Called when the element enters the viewport */
  appear?(): void;

  /** Called when the element leaves the viewport */
  disappear?(): void;

  /** Called when an error occurs in any lifecycle method */
  error?(error: Error, lifecycle: LifecycleName): void;
}

export abstract class BaseHandler implements Handler {
  /** The root element the handler is bound to */
  readonly element: HTMLElement;

  constructor(element: HTMLElement) {
    this.element = element;
  }

  // --- Name ---

  /**
   * The handler name, derived from the class name:
   * "DismissHandler" → "dismiss", "ConfirmHandler" → "confirm".
   * Used internally to key the client registry; it never appears in the
   * rendered HTML or in the component interface.
   */
  static get handlerName(): string {
    const raw = this.name; // the class's own Function.name
    return raw.endsWith("Handler")
      ? raw.slice(0, -7).toLowerCase()
      : raw.toLowerCase();
  }

  /** Alias of the handler name, for instance methods like data()/target() */
  get name(): string {
    return (this.constructor as typeof BaseHandler).handlerName;
  }

  // --- Lifecycle ---

  /** Called before the handler is wired up (setup, initial state) */
  beforeConnect(): void {}

  /** Called automatically after the handler is wired up */
  connect(): void {}

  /** Called after all wiring is complete (safe to interact with DOM) */
  afterConnect(): void {}

  /** Called before the handler is torn down */
  beforeDisconnect(): void {}

  /** Called when the element is removed from the DOM (cleanup) */
  disconnect(): void {}

  /** Called when the element enters the viewport */
  appear(): void {}

  /** Called when the element leaves the viewport */
  disappear(): void {}

  /** Called when an error occurs in any lifecycle method */
  error(_error: Error, _lifecycle: LifecycleName): void {}

  // --- Helpers ---

  /**
   * Find a single target element within the handler's scope.
   * Targets are declared as data-ref="{name}" on child elements.
   *
   * Example: <input data-ref="input" />  →  this.target("input")
   */
  target<T extends HTMLElement = HTMLElement>(name: string): T | null {
    return this.element.querySelector<T>(`[data-ref="${name}"]`);
  }

  /**
   * Find all target elements within the handler's scope.
   */
  targets<T extends HTMLElement = HTMLElement>(name: string): NodeListOf<T> {
    return this.element.querySelectorAll<T>(`[data-ref="${name}"]`);
  }

  /**
   * Read a configuration value from a data-{key} attribute on the root
   * element, falling back to the first matching attribute on a descendant.
   * Params passed to Wrapper/Trigger are converted to these attributes.
   *
   * Example: <div data-message="Sure?">  →  this.data("message")  // "Sure?"
   */
  data(key: string): string | null {
    const attr = `data-${key}`;
    const root = this.element.getAttribute(attr);
    if (root !== null) return root;
    return (
      this.element
        .querySelector<HTMLElement>(`[${attr}]`)
        ?.getAttribute(attr) ?? null
    );
  }
}


/**
 * Create a scoped Wrapper + Trigger pair for a client-side handler class.
 *
 * Call at the component level:
 *
 *   const Confirm = useHandler(ConfirmHandler);
 *
 * Wrapper renders a container element and hydrates the handler on it —
 * use when the handler must be scoped to a container (e.g. dismiss,
 * where hide() hides the container itself).
 *
 * Trigger renders its child element with a data-action and any params as
 * data-{key} attributes. Used alone (no Wrapper), the interactive element
 * itself is hydrated (e.g. confirm). Used inside a Wrapper, it just
 * declares an action for the wrapper's handler instance.
 */
export function useHandler<
  H extends HandlerConstructor,
  HA extends Record<string, string> = Record<string, string>,
  E extends keyof HA & string = string
>(handler: H) {
  let uid: string;

  function Wrapper({ tag, children, ...dataProps }: WrapperProps) {
    const Tag = (tag ?? "div") as keyof JSX.IntrinsicElements;
    const attrs = toAttrs(dataProps);

    uid = genId();

    return (
      <>
        <Tag id={uid} {...attrs}>
          {children}
        </Tag>
        <HydrateScript name={handler.handlerName} id={uid} />
      </>
    );
  }

  function Trigger({
    event,
    method,
    children,
    ...dataProps
  }: TriggerProps<HA, E>) {
    const inject: Record<string, string> = {
      "data-action": `${event}->${method}`,
      ...toAttrs(dataProps),
    };

    if (!uid) {
      // Standalone Trigger — the element itself is hydrated
      uid = genId();

      return (
        <>
          {renderChild(children, { ...inject, id: uid})}
          <HydrateScript name={handler.handlerName} id={uid} />
        </>
      );
    } else {
      // Inside a Wrapper — belongs to the wrapper's handler instance
      return renderChild(children, inject);
    }
  }

  Wrapper.Trigger = Trigger;
  return Wrapper;
}
