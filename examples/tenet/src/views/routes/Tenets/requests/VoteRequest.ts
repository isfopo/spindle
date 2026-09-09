import { RequestGuard, type ValidationResult } from "@spindle/spindle/thread";

export class VoteRequest extends RequestGuard {
  readonly choice: string;
  readonly reason: string;

  constructor(body: Record<string, unknown>) {
    super(body);
    this.choice = String(body.choice ?? "");
    this.reason = String(body.reason ?? "");
  }

  validate(): ValidationResult {
    const valid = ["approve", "abstain", "block"];

    if (!valid.includes(this.choice)) {
      this.addError("choice", "Must be approve, abstain, or block");
    }
    if (this.choice === "block" && !this.reason.trim()) {
      this.addError("reason", "Blocking requires a reason");
    }

    return { valid: this.isValid, errors: this.errors };
  }
}

