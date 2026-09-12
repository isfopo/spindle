import type { Context } from "hono";
import { MethodDecoratorFactory } from "./index";
import { GuardDecorator } from "./GuardDecorator";

/** Contract for a guard that rejects unauthorized requests by throwing. */
export interface IAuthorizable {
  authorize(c: Context): Promise<void> | void;
}

export interface AuthorizeGuard {
  type: "authorize";
  handlerName: string;
  GuardClass: new () => IAuthorizable;
}

class AuthorizeDecorator extends GuardDecorator<AuthorizeGuard> {
  constructor(private readonly GuardClass: new () => IAuthorizable) {
    super();
  }

  protected build(): Omit<AuthorizeGuard, "handlerName"> {
    return { type: "authorize", GuardClass: this.GuardClass };
  }
}

/** Register an authorization guard. */
export function Authorize(
  GuardClass: new () => IAuthorizable,
): MethodDecoratorFactory {
  return new AuthorizeDecorator(GuardClass).decorate();
}

