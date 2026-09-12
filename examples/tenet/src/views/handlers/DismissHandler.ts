/**
 * Dismiss handler — hides or removes an element on a trigger event.
 *
 * Useful for dismissible alerts, banners, toasts, modals.
 *
 * Usage with useHandler (Wrapper + Trigger):
 *   const Dismiss = useHandler(DismissHandler);
 *
 *   <Dismiss role="alert">
 *     <span>Something happened.</span>
 *     <Dismiss.Trigger event="click" method="hide">
 *       <button>✕</button>
 *     </Dismiss.Trigger>
 *   </Dismiss>
 *
 * The handler is hydrated on the Wrapper because hide() hides the
 * container element itself (this.element). Set remove="true" on the
 * Trigger to remove the element from the DOM instead:
 *   <Dismiss.Trigger event="click" method="hide" remove="true">
 *     <button>✕</button>
 *   </Dismiss.Trigger>
 */

import { BaseHandler } from "@spindle/spindle/fabric";

export class DismissHandler extends BaseHandler {
  override connect(): void {
    // no-op — actions are wired by the runtime on hydration
  }

  /** Hide the handler's root element */
  hide(): void {
    const shouldRemove = this.data("remove") === "true";
    if (shouldRemove) {
      this.element.remove();
    } else {
      this.element.style.display = "none";
    }
  }
}

