import { TenetStatus } from "domains/tenet/model";
import { RequestGuard, type ValidationResult } from "@spindle/spindle/thread";

export class TransitionRequest extends RequestGuard {
  readonly status: TenetStatus;
  constructor(body: Record<string, unknown>) {
    super(body);
    this.status = body.status as TenetStatus;
  }

  validate(): ValidationResult {
    return { valid: true, errors: {} };
  }
}

