/**
 * useEvent — server-side component factory for wiring a callback to a DOM event.
 *
 * The callback is embedded in the hydration script, so it must be self-contained
 * and must not close over server-only values. It receives the originating event
 * and the element as an object and may return a cleanup function.
 */

import { JSX } from "react";
import { genId } from "../../utils";

const CLIENT_MODULE_URL =
  typeof import.meta.env !== "undefined" && import.meta.env.DEV
    ? "/src/.generated/client-entry.ts"
    : "/.generated/client/index.js";

const HTML_ATTRS = new Set(["class", "style", "role", "title", "hidden", "name"]);

type EventContext<E extends Event = Event> = {
  event: E;
  element: HTMLElement;
};

type EventCallback<E extends Event = Event> = (
  context: EventContext<E>,
) => void | (() => void);

type EventProps = {
  children?: any;
} & Record<string, any>;

function toAttrs(props: Record<string, any>): Record<string, any> {
  const attrs: Record<string, any> = {};
  for (const key of Object.keys(props)) {
    if (HTML_ATTRS.has(key) || key.startsWith("data-") || key.startsWith("aria-")) {
      attrs[key] = props[key];
    } else {
      attrs[`data-${key}`] = String(props[key]);
    }
  }
  return attrs;
}

function renderChild(children: any, inject: Record<string, string>): any {
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

function HydrateScript<E extends Event = Event>({
  event,
  id,
  callback,
}: {
  event: string;
  id: string;
  callback: EventCallback<E>;
}) {
  const callbackSource = callback.toString();
  return (
    <script
      type="module"
      dangerouslySetInnerHTML={{
        __html: `import { hydrateEvent } from ${JSON.stringify(CLIENT_MODULE_URL)};hydrateEvent(${JSON.stringify(event)},${JSON.stringify(id)},(${callbackSource}));`,
      }}
    />
  );
}

/**
 * Create a component that invokes a callback for an event on its child.
 *
 * @example
 * const Delete = useEvent("click", ({ event, element }) => {
 *   event.preventDefault();
 *   element.remove();
 * });
 *
 * <Delete class="danger"><button>Delete</button></Delete>
 */
export function useEvent<E extends Event = Event>(
  event: keyof GlobalEventHandlersEventMap | (string & {}),
  callback: EventCallback<E>,
) {
  return function EventComponent({ children, ...props }: EventProps) {
    const id = genId();
    return (
      <>
        {renderChild(children, { ...toAttrs(props), id })}
        <HydrateScript event={event} id={id} callback={callback} />
      </>
    );
  };
}

export type { EventCallback, EventContext };
