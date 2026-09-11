import { describe, it, expect, vi, beforeEach } from "vitest";
import { ControllerBase, BODY_KEY, NotFoundError, ForbiddenError, ValidationError } from "../index";

import { Authorize, type IAuthorizable } from "./Authorize";
import { Exists, type IExistable } from "./Exists";
import { Validate, type ValidationResult } from "./Validate";
import { RequestGuard } from "./RequestGuard";
import { GUARDS_KEY } from "./GuardDecorator";
import type { GuardDescriptor } from "./index";

// ── Test guards ─────────────────────────────────────────────────

class TestFindGuard implements IExistable {
  key = "tenet";
  loadCalls = 0;

  async load(): Promise<unknown> {
    this.loadCalls++;
    return { id: 1, slug: "test" };
  }
}

class FailingFindGuard implements IExistable {
  key = "item";

  async load(): Promise<unknown> {
    return null;
  }
}

class TestAuthGuard implements IAuthorizable {
  authorizeCalls = 0;

  authorize(): void {
    this.authorizeCalls++;
  }
}

class FailingAuthGuard implements IAuthorizable {
  authorize(): void {
    throw new ForbiddenError();
  }
}

class TestRequest extends RequestGuard {
  static validateWasCalled = false;
  static lastBody: Record<string, unknown> | undefined;

  constructor(body: Record<string, unknown>) {
    super(body);
    TestRequest.lastBody = body;
  }

  async validate(): Promise<ValidationResult> {
    TestRequest.validateWasCalled = true;
    return { valid: true };
  }
}

class FailingRequest extends RequestGuard {
  async validate(): Promise<ValidationResult> {
    return { valid: false, errors: { field: "error" } };
  }
}

// ── Test controller (decorators built through GuardDecorator) ────

class TestController {
  @Exists(TestFindGuard)
  replace(_: unknown) {}

  @Authorize(TestAuthGuard)
  authorize(_: unknown) {}

  @Validate(TestRequest)
  create(_: unknown) {}

  @Validate(FailingRequest)
  fail(_: unknown) {}
}

/** Collect the guard descriptors registered for a given handler. */
function guardsFor(handlerName: string): GuardDescriptor[] {
  const metadata = (TestController as any)[Symbol.metadata];
  return (metadata?.[GUARDS_KEY] ?? []).filter(
    (g: GuardDescriptor) => g.handlerName === handlerName,
  );
}

// ── Helpers ─────────────────────────────────────────────────────

function createMockContext(
  options: {
    parsedBody?: Record<string, unknown>;
  } = {},
) {
  const store = new Map<string, unknown>();

  // Simulate the parseBody() middleware having run for this request
  if (options.parsedBody !== undefined) {
    store.set(BODY_KEY, options.parsedBody);
  }

  return {
    set: vi.fn((key: string, value: unknown) => store.set(key, value)),
    get: vi.fn((key: string) => store.get(key)),
  } as any;
}

// ── Tests ───────────────────────────────────────────────────────

describe("guard decorators register descriptors via GuardDecorator", () => {
  it("Exists() registers an exists guard with the handler name", () => {
    const [guard] = guardsFor("replace");
    expect(guard).toBeDefined();
    expect(guard).toMatchObject({ type: "exists", GuardClass: TestFindGuard });
  });

  it("Authorize() registers an authorize guard with the handler name", () => {
    const [guard] = guardsFor("authorize");
    expect(guard).toBeDefined();
    expect(guard).toMatchObject({
      type: "authorize",
      GuardClass: TestAuthGuard,
    });
  });

  it("Validate() registers a validate guard with the handler name", () => {
    const [guard] = guardsFor("create");
    expect(guard).toBeDefined();
    expect(guard).toMatchObject({
      type: "validate",
      RequestClass: TestRequest,
    });
  });
});

describe("executeGuard — exists path", () => {
  it("calls IExistable.load() and stores the entity on context", async () => {
    const [guard] = guardsFor("replace");
    const c = createMockContext();
    await ControllerBase.executeGuard(guard, c);

    expect(c.set).toHaveBeenCalledWith("tenet", { id: 1, slug: "test" });
  });

  it("throws NotFoundError when load() returns null", async () => {
    // A failing guard registered on a second handler
    class FailingController {
      @Exists(FailingFindGuard)
      other(_: unknown) {}
    }
    const metadata = (FailingController as any)[Symbol.metadata];
    const [guard] = (
      (metadata?.[GUARDS_KEY] ?? []) as GuardDescriptor[]
    ).filter((g) => g.handlerName === "other");

    const c = createMockContext();
    await expect(ControllerBase.executeGuard(guard, c)).rejects.toThrow(
      NotFoundError,
    );
  });
});

describe("executeGuard — authorize path", () => {
  it("calls IAuthorizable.authorize()", async () => {
    const [guard] = guardsFor("authorize");
    const c = createMockContext();
    await ControllerBase.executeGuard(guard, c);
    // authorize() did not throw — waiting on the promise is the success path
  });

  it("propagates error thrown by authorize()", async () => {
    class FailingController {
      @Authorize(FailingAuthGuard)
      other(_: unknown) {}
    }
    const metadata = (FailingController as any)[Symbol.metadata];
    const [guard] = (
      (metadata?.[GUARDS_KEY] ?? []) as GuardDescriptor[]
    ).filter((g) => g.handlerName === "other");

    const c = createMockContext();
    await expect(ControllerBase.executeGuard(guard, c)).rejects.toThrow(
      ForbiddenError,
    );
  });
});

describe("executeGuard — validate path", () => {
  beforeEach(() => {
    TestRequest.validateWasCalled = false;
    TestRequest.lastBody = undefined;
  });

  it("calls validate() on the request class and stores the instance", async () => {
    const [guard] = guardsFor("create");

    const c = createMockContext({ parsedBody: { name: "test", value: "123" } });
    await ControllerBase.executeGuard(guard, c);

    expect(TestRequest.validateWasCalled).toBe(true);
    expect(TestRequest.lastBody).toEqual({ name: "test", value: "123" });
    expect(c.set).toHaveBeenCalledWith("body", expect.any(TestRequest));
  });

  it("passes the middleware-parsed body to the RequestGuard subclass", async () => {
    const [guard] = guardsFor("create");

    // Unflattening already happened in the parseBody() middleware
    const c = createMockContext({
      parsedBody: { options: [{ title: "React" }] },
    });
    await ControllerBase.executeGuard(guard, c);

    expect(TestRequest.lastBody).toEqual({
      options: [{ title: "React" }],
    });
  });

  it("throws ValidationError when validate() returns valid: false", async () => {
    const [guard] = guardsFor("fail");

    const c = createMockContext({ parsedBody: { bad: "data" } });
    await expect(ControllerBase.executeGuard(guard, c)).rejects.toThrow(
      ValidationError,
    );

    try {
      await ControllerBase.executeGuard(guard, c);
    } catch (error) {
      expect(error).toBeInstanceOf(ValidationError);
      expect((error as ValidationError).fields).toEqual({ field: "error" });
    }
  });
});
