/**
 * Client-side hydration runtime.
 *
 * Each rendered component instance carries an inline script that calls
 * hydrate(name, id): the runtime looks up the handler class in the
 * registry, instantiates it on the element with that id, runs the
 * lifecycle (beforeConnect → connect → afterConnect), and wires up
 * actions declared via data-action="{event}->{method}" on the element
 * and its descendants.
 *
 * The registry is keyed by the handler's derived name
 * (see BaseHandler.handlerName), which never appears in the HTML.
 *
 * Lifecycle order:
 *   beforeConnect → connect → afterConnect
 *   beforeDisconnect → disconnect
 *   appear / disappear (IntersectionObserver-driven)
 */

import type { ActionDescriptor, Handler, HandlerConstructor, LifecycleName } from "./hooks/useHandler";

// --- Registry ---

const registry = new Map<string, HandlerConstructor>();

/**
 * Register a handler class so hydrate() can find it by its derived name.
 * Called once from the client entry point.
 */
export function register(ctor: HandlerConstructor): void {
  registry.set(ctor.handlerName, ctor);
}

// --- Action parsing ---

const ACTION_RE = /^(\w+)\s*->\s*(\w+)$/;

function parseAction(raw: string): ActionDescriptor | null {
  const m = raw.trim().match(ACTION_RE);
  if (!m) return null;
  return { event: m[1], method: m[2] };
}

// --- Scope tracking for disconnect ---

interface ActiveHandler {
  instance: Handler;
  boundListeners: Map<HTMLElement, Map<string, EventListener>>;
  intersectionObserver?: IntersectionObserver;
}

const activeHandlers = new WeakMap<HTMLElement, ActiveHandler[]>();

interface ActiveEvent {
  event: string;
  listener: EventListener;
  cleanups: (() => void)[];
}

const activeEvents = new WeakMap<HTMLElement, ActiveEvent[]>();

// --- Error handling ---

/** Safely invoke a lifecycle method, catching errors and delegating to handler.error() */
function invokeLifecycle(
  handler: Handler,
  name: LifecycleName,
): void {
  try {
    const fn = (handler as any)[name];
    if (typeof fn === "function") {
      fn.call(handler);
    }
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    try {
      handler.error?.(error, name);
    } catch {
      // If error() itself throws, fall back to console
    }
    console.error(
      `[hydrate] Error in "${name}" for handler "${(handler.constructor as any).handlerName}":`,
      error,
    );
  }
}

// --- Hydration ---

/**
 * Instantiate and wire the handler named `name` onto the element with
 * the given id. Called by the inline script that ships with each
 * rendered handler component.
 */
export function hydrate(name: string, elementId: string): void {
  ensureObserver();
  const element = document.getElementById(elementId);
  if (!element) {
    console.warn(`[hydrate] No element found for id "${elementId}"`);
    return;
  }
  const Ctor = registry.get(name);
  if (!Ctor) {
    console.warn(`[hydrate] No handler registered for "${name}"`);
    return;
  }
  connectElement(element, Ctor);
}

/**
 * Attach a callback to an element and pass it the originating event and
 * element. The callback may return a cleanup function.
 */
export function hydrateEvent(
  eventName: string,
  elementId: string,
  callback: (context: { event: Event; element: HTMLElement }) => void | (() => void),
): void {
  ensureObserver();
  const element = document.getElementById(elementId);
  if (!element) {
    console.warn(`[hydrateEvent] No element found for id "${elementId}"`);
    return;
  }

  const listener: EventListener = (event) => {
    try {
      const cleanup = callback({ event, element });
      if (typeof cleanup === "function") {
        const events = activeEvents.get(element) ?? [];
        const active = events.find((entry) => entry.listener === listener);
        active?.cleanups.push(cleanup);
      }
    } catch (err) {
      console.error(`[hydrateEvent] Error in "${eventName}" callback:`, err);
    }
  };

  element.addEventListener(eventName, listener);
  const events = activeEvents.get(element) ?? [];
  events.push({ event: eventName, listener, cleanups: [] });
  activeEvents.set(element, events);
}

function connectElement(element: HTMLElement, Ctor: HandlerConstructor): void {
  const instance = new Ctor(element);
  const boundListeners = new Map<HTMLElement, Map<string, EventListener>>();

  // Phase 1: beforeConnect — setup, initial state
  invokeLifecycle(instance, "beforeConnect");

  // Phase 2: connect — abstract, must be implemented
  invokeLifecycle(instance, "connect");

  // Phase 3: wire actions declared on the element and its descendants
  function wireAction(target: HTMLElement, raw: string) {
    for (const part of raw.split(";")) {
      const desc = parseAction(part);
      if (!desc) continue;
      const fn = (instance as any)[desc.method];
      if (typeof fn === "function") {
        const bound = fn.bind(instance);

        // Track bound listeners for cleanup
        if (!boundListeners.has(target)) {
          boundListeners.set(target, new Map());
        }
        boundListeners.get(target)!.set(desc.event, bound);

        target.addEventListener(desc.event, bound);
      } else {
        console.warn(
          `[hydrate] Handler "${Ctor.handlerName}" has no method "${desc.method}"`,
        );
      }
    }
  }

  // Check the element itself
  const selfAction = element.getAttribute("data-action");
  if (selfAction) wireAction(element, selfAction);

  // Check descendants
  element
    .querySelectorAll<HTMLElement>("[data-action]")
    .forEach((target) => wireAction(target, target.getAttribute("data-action") ?? ""));

  // Phase 4: afterConnect — safe to interact with fully wired DOM
  invokeLifecycle(instance, "afterConnect");

  // Phase 5: set up IntersectionObserver for appear/disappear
  let intersectionObserver: IntersectionObserver | undefined;
  if (instance.appear || instance.disappear) {
    let isVisible = false;
    intersectionObserver = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          // Only fire once per visibility change to avoid
          // repeated invocations during scrolling.
          if (entry.isIntersecting && !isVisible) {
            isVisible = true;
            invokeLifecycle(instance, "appear");
          } else if (!entry.isIntersecting && isVisible) {
            isVisible = false;
            invokeLifecycle(instance, "disappear");
          }
        }
      },
      { threshold: 0.1 },
    );
    intersectionObserver.observe(element);
  }

  const handlers = activeHandlers.get(element) ?? [];
  handlers.push({ instance, boundListeners, intersectionObserver });
  activeHandlers.set(element, handlers);
}

function disconnectEventElement(element: HTMLElement): void {
  const events = activeEvents.get(element);
  if (!events) return;

  for (const { event, listener, cleanups } of events) {
    element.removeEventListener(event, listener);
    for (const cleanup of cleanups) {
      try {
        cleanup();
      } catch (err) {
        console.error(`[hydrateEvent] Error during "${event}" cleanup:`, err);
      }
    }
  }
  activeEvents.delete(element);
}

function disconnectElement(element: HTMLElement): void {
  disconnectEventElement(element);
  const handlers = activeHandlers.get(element);
  if (!handlers) return;

  for (const { instance, boundListeners, intersectionObserver } of handlers) {
    // Phase 1: beforeDisconnect — pre-cleanup
    invokeLifecycle(instance, "beforeDisconnect");

    // Phase 2: disconnect — abstract cleanup
    invokeLifecycle(instance, "disconnect");

    // Phase 3: remove all bound event listeners
    for (const [target, listeners] of boundListeners) {
      for (const [event, listener] of listeners) {
        target.removeEventListener(event, listener);
      }
    }

    // Phase 4: disconnect IntersectionObserver
    intersectionObserver?.disconnect();
  }

  activeHandlers.delete(element);
}

// --- MutationObserver for dynamic content ---

let observer: MutationObserver | null = null;

/** Lazily start watching for elements removed from the DOM */
function ensureObserver(): void {
  if (observer) return;
  observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      // Disconnect removed elements
      for (const node of Array.from(mutation.removedNodes)) {
        if (node.nodeType === Node.ELEMENT_NODE) {
          const el = node as HTMLElement;
          disconnectElement(el);
          if (el.querySelectorAll) {
            el.querySelectorAll<HTMLElement>("[data-action]").forEach((child) => {
              // Only descendants that were themselves hydrated get disconnected
              disconnectElement(child);
            });
          }
        }
      }
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });
}
