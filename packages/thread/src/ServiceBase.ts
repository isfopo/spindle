import {
  ValidationError,
  NotFoundError,
  ForbiddenError,
  ConflictError,
} from "./errors";

/**
 * ServiceBase — abstract base for business-logic services.
 *
 * Provides standard error-throwing helpers so subclasses can
 * concisely enforce validation rules and permissions.
 */
export abstract class ServiceBase {
  // ── Error helpers ──────────────────────────────

  /** Throw a ValidationError with optional field-level messages. */
  protected validationError(
    message: string,
    fields?: Record<string, string>,
  ): never {
    throw new ValidationError(message, fields);
  }

  /** Throw a NotFoundError. */
  protected notFound(message = "Resource not found"): never {
    throw new NotFoundError(message);
  }

  /** Throw a ForbiddenError. */
  protected forbidden(message = "You don't have permission"): never {
    throw new ForbiddenError(message);
  }

  /** Throw a ConflictError. */
  protected conflict(message = "Resource already exists"): never {
    throw new ConflictError(message);
  }

  // ── Validation helper ──────────────────────────

  /** Assert a condition, throwing ValidationError if false. */
  protected require(condition: boolean, message: string): void {
    if (!condition) throw new ValidationError(message);
  }
}
