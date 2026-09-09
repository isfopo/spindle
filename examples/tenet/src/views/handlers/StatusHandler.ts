/**
 * Status handler — confirms before changing tenet status.
 */

import { BaseHandler } from "@spindle/spindle/fabric";

export class StatusHandler extends BaseHandler {
  override connect(): void {
    // Actions are wired by the runtime on hydration
  }

  transition(event: Event): void {
    const target = event.currentTarget as HTMLElement;
    const status = target.getAttribute("data-status");
    const message = target.getAttribute("data-message") ?? "Change status?";

    if (!confirm(message)) {
      event.preventDefault();
      return;
    }

    const form = this.element.closest("form") as HTMLFormElement | null;
    if (!form || !status) return;

    (form.querySelector("[name=status]") as HTMLInputElement).value = status;
    form.requestSubmit();
  }
}

