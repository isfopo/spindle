import type { ValidationResult } from "./Validate";

/**
 * Base class for self-validating request/input objects.
 *
 * Requests receive the middleware-parsed request body in the constructor
 * and expose a `validate()` method returning a `ValidationResult`.
 * This base class provides shared helpers for accumulating field-level
 * errors and deciding validity, so concrete request classes only need to
 * add their field extraction and validation rules.
 */
export abstract class RequestGuard {
  /** Field-level error messages keyed by field name. */
  protected readonly errors: Record<string, string> = {};

  constructor(protected readonly body: Record<string, unknown>) {}

  /** Add an error for the given field. */
  protected addError(field: string, message: string): void {
    this.errors[field] = message;
  }

  /** True when no validation errors have been recorded. */
  protected get isValid(): boolean {
    return Object.keys(this.errors).length === 0;
  }

  /** Validate the request, returning the validation result. */
  abstract validate(): ValidationResult | Promise<ValidationResult>;
}
