import type { AuthorizeGuard } from "./Authorize";
import type { ExistsGuard } from "./Exists";
import type { ValidateGuard } from "./Validate";

export * from "./Authorize";
export * from "./Exists";
export * from "./Validate";
export * from "./RequestGuard";
export * from "./GuardDecorator";

export type GuardDescriptor = ExistsGuard | AuthorizeGuard | ValidateGuard;

export type MethodDecoratorFactory = <This>(
  target: (this: This, ...args: any[]) => any,
  context: ClassMethodDecoratorContext<This>,
) => void;
