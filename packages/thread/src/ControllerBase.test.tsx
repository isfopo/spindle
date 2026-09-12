import { describe, it, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";
import type { Context, Env } from "hono";
import { testClient } from "hono/testing";
import { Post, ControllerBase, Validate, IValidatable, ValidationResult, GUARDS_KEY } from "thread";

// ── Test request class ──────────────────────────────────────────────

class TestRequest implements IValidatable {
  static validateCallCount = 0;
  static lastBody: Record<string, unknown> | null = null;

  constructor(body: Record<string, unknown>) {
    TestRequest.lastBody = body;
  }

  validate(): ValidationResult {
    TestRequest.validateCallCount++;
    return { valid: true };
  }
}

// ── Test controller ─────────────────────────────────────────────────

class TestController extends ControllerBase<Env> {
  override base = "test";

  constructor() {
    super();
    // Skip auth middleware for testing
  }

  @Post("/")
  @Validate(TestRequest)
  async create(c: Context) {
    return c.text("ok");
  }
}

// ── Tests ───────────────────────────────────────────────────────────

beforeEach(() => {
  TestRequest.validateCallCount = 0;
  TestRequest.lastBody = null;
});

describe("@Validate guard metadata", () => {
  it("stores the validate guard in decorator metadata", () => {
    // Instantiate the controller so decorators are evaluated
    const _controller = new TestController();

    // Access the decorator metadata
    const metadata = (TestController as any)[Symbol.metadata];

    expect(metadata).toBeDefined();
    expect(metadata[GUARDS_KEY]).toBeDefined();

    const guards = metadata[GUARDS_KEY];
    expect(Array.isArray(guards)).toBe(true);
    expect(guards.length).toBeGreaterThan(0);

    // Find the validate guard
    const validateGuard = guards.find((g: any) => g.type === "validate");
    expect(validateGuard).toBeDefined();
    expect(validateGuard.handlerName).toBe("create");
    expect(validateGuard.RequestClass).toBe(TestRequest);
  });
});

describe("@Validate guard execution", () => {
  it("calls validate() when a POST request is made", async () => {
    const controller = new TestController();
    const app = new Hono();

    controller.register(app);

    const client = testClient(app) as any;

    // POST with form data (the default body parsing path)
    const res = await client.test.$post();

    expect(res.status).toBe(200);
    expect(TestRequest.validateCallCount).toBeGreaterThan(0);
  });

  it("attaches the validated instance to the context", async () => {
    const controller = new TestController();
    const app = new Hono();

    controller.register(app);

    const client = testClient(app) as any;

    const res = await client.test.$post();

    expect(res.status).toBe(200);
    expect(TestRequest.lastBody).toBeDefined();
  });
});
