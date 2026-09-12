import type { Context } from "hono";
import { MethodDecoratorFactory } from "./index";
import { GuardDecorator } from "./GuardDecorator";

/** Contract for a guard that loads an entity into the request context. */
export interface IExistable {
  key: string;
  load(c: Context): Promise<unknown>;
}

export interface ExistsGuard {
  type: "exists";
  handlerName: string;
  GuardClass: new () => IExistable;
}

class ExistsDecorator extends GuardDecorator<ExistsGuard> {
  constructor(private readonly GuardClass: new () => IExistable) {
    super();
  }

  protected build(): Omit<ExistsGuard, "handlerName"> {
    return { type: "exists", GuardClass: this.GuardClass };
  }
}

/** Register an entity loader guard. */
export function Exists(
  GuardClass: new () => IExistable,
): MethodDecoratorFactory {
  return new ExistsDecorator(GuardClass).decorate();
}
