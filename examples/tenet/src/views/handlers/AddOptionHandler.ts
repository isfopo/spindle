/**
 * AddOption handler — clones a template row for dynamic form fields.
 *
 * Used by the create-tenet form to let users add more options.
 * The template uses `__IDX__` as a placeholder for the field index.
 */

import { BaseHandler } from "@spindle/spindle/fabric";

export class AddOptionHandler extends BaseHandler {
  private counter = 1; // template has index 0, so start at 1

  override connect(): void {
    const start = this.data("start");
    if (start) this.counter = parseInt(start, 10);
  }

  add(): void {
    const template = this.element.querySelector<HTMLTemplateElement>("template");
    const container = this.element.querySelector<HTMLElement>("[data-option-container]");
    if (!template || !container) return;

    let raw = template.innerHTML.replace(/__IDX__/g, String(this.counter));
    raw = raw.replace(/__IDX_PLUS_ONE__/g, String(this.counter + 1));
    container.insertAdjacentHTML("beforeend", raw);
    this.counter++;
  }
}

