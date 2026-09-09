/**
 * Confirm handler — shows a native confirm dialog before an action proceeds.
 *
 * Usage with useHandler (Trigger-only, recommended):
 *   const Confirm = useHandler(ConfirmHandler);
 *
 *   <Confirm.Trigger event="click" method="ask" message="Delete this item?">
 *     <button>Delete</button>
 *   </Confirm.Trigger>
 *
 * The event is prevented if the user cancels the confirm dialog.
 */

import { BaseHandler } from "@spindle/spindle/fabric";

export class ConfirmHandler extends BaseHandler {
  override connect(): void {
    // Actions are wired by the runtime on hydration
  }

  /**
   * Called when the trigger element's event fires.
   * Stops the default behavior unless the user confirms.
   */
  ask(event: Event): void {
    const message = this.data("message") ?? "Are you sure?";
    if (!confirm(message)) {
      event.preventDefault();
      event.stopPropagation();
    }
  }
}

