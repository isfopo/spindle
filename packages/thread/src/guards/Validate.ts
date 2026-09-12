import { MethodDecoratorFactory } from "./index";
import { GuardDecorator } from "./GuardDecorator";

/** Result returned by a request object's validate() method. */
export interface ValidationResult {
  valid: boolean;
  /** Field-level error messages keyed by field name. */
  errors?: Record<string, string>;
}

/** Contract implemented by request/input objects that validate themselves. */
export interface IValidatable {
  validate(): ValidationResult | Promise<ValidationResult>;
}

export interface ValidateGuard {
  type: "validate";
  handlerName: string;
  RequestClass: new (body: Record<string, unknown>) => IValidatable;
}

class ValidateDecorator extends GuardDecorator<ValidateGuard> {
  constructor(
    private readonly RequestClass: new (
      body: Record<string, unknown>,
    ) => IValidatable,
  ) {
    super();
  }

  protected build(): Omit<ValidateGuard, "handlerName"> {
    return { type: "validate", RequestClass: this.RequestClass };
  }
}

/** Register a self-validating request class. */
export function Validate(
  RequestClass: new (body: Record<string, unknown>) => IValidatable,
): MethodDecoratorFactory {
  return new ValidateDecorator(RequestClass).decorate();
}
