/**
 * Vote handler — handles approve/abstain/block button clicks.
 *
 * For "block", prompts for a reason before submitting the form.
 */

import { BaseHandler } from "@spindle/spindle/fabric";

export class VoteHandler extends BaseHandler {
  override connect(): void {
    // Actions are wired by the runtime on hydration
  }

  submit(event: Event): void {
    const target = event.currentTarget as HTMLElement;
    const choice = target.getAttribute("data-choice");
    const form = this.element.closest("form") as HTMLFormElement | null;
    if (!form || !choice) return;

    if (choice === "block") {
      const reason = prompt("Why are you blocking this tenet?");
      if (!reason) {
        event.preventDefault();
        return;
      }
      (form.querySelector("[name=reason]") as HTMLInputElement).value = reason;
    }

    (form.querySelector("[name=choice]") as HTMLInputElement).value = choice;
    form.requestSubmit();
  }
}

