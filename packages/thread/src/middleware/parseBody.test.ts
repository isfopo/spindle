import { describe, it, expect, vi } from "vitest";
import {
  BODY_KEY,
  parseBody,
  parseRequestBody,
  unflattenFormBody,
} from "./parseBody"

describe("unflattenFormBody", () => {
  it("passes through flat keys unchanged", () => {
    const result = unflattenFormBody({ title: "Test", context: "Hello" });
    expect(result).toEqual({ title: "Test", context: "Hello" });
  });

  it("unflattens single-level bracket notation", () => {
    const result = unflattenFormBody({ "options[0]": "A", "options[1]": "B" });
    expect(result).toEqual({ options: ["A", "B"] });
  });

  it("unflattens two-level bracket notation", () => {
    const result = unflattenFormBody({
      "options[0][title]": "React",
      "options[0][pros]": "Fast",
      "options[1][title]": "Vue",
      "options[1][pros]": "Simple",
    });
    expect(result).toEqual({
      options: [
        { title: "React", pros: "Fast" },
        { title: "Vue", pros: "Simple" },
      ],
    });
  });

  it("handles mixed flat and nested keys", () => {
    const result = unflattenFormBody({
      title: "Test",
      "options[0][title]": "Option A",
    });
    expect(result).toEqual({
      title: "Test",
      options: [{ title: "Option A" }],
    });
  });

  it("handles empty string keys", () => {
    const result = unflattenFormBody({});
    expect(result).toEqual({});
  });

  it("handles a single option", () => {
    const result = unflattenFormBody({
      "options[0][title]": "Only Option",
      "options[0][description]": "Desc",
    });
    expect(result).toEqual({
      options: [{ title: "Only Option", description: "Desc" }],
    });
  });

  it("handles missing intermediate indices gracefully", () => {
    const result = unflattenFormBody({
      "options[2][title]": "Third",
    });
    expect(result).toEqual({
      options: [undefined, undefined, { title: "Third" }],
    });
  });
});

// ── Helpers ─────────────────────────────────────────────────────

function createMockContext(
  options: {
    contentType?: string;
    contentLength?: string;
    transferEncoding?: string;
    parsedBody?: Record<string, unknown>;
  } = {},
) {
  const store = new Map<string, unknown>();

  return {
    req: {
      header: vi.fn((name: string) => {
        if (name === "content-type") return options.contentType ?? "";
        if (name === "content-length") return options.contentLength ?? "";
        if (name === "transfer-encoding") return options.transferEncoding ?? "";
        return undefined;
      }),
      parseBody: vi.fn(async () => options.parsedBody ?? {}),
      json: vi.fn(async () => options.parsedBody ?? {}),
    },
    set: vi.fn((key: string, value: unknown) => store.set(key, value)),
    get: vi.fn((key: string) => store.get(key)),
  } as any;
}

// ── parseBody middleware ────────────────────────────────────────

describe("parseBody middleware", () => {
  it("parses JSON bodies and stores them on the context", async () => {
    const c = createMockContext({
      contentType: "application/json",
      contentLength: "30",
      parsedBody: { title: "Test" },
    });
    const next = vi.fn();

    await parseBody()(c, next);

    expect(c.set).toHaveBeenCalledWith(BODY_KEY, { title: "Test" });
    expect(next).toHaveBeenCalled();
  });

  it("unflattens form bodies and stores them on the context", async () => {
    const c = createMockContext({
      contentType: "application/x-www-form-urlencoded",
      contentLength: "30",
      parsedBody: { "options[0][title]": "React" },
    });
    const next = vi.fn();

    await parseBody()(c, next);

    expect(c.set).toHaveBeenCalledWith(BODY_KEY, {
      options: [{ title: "React" }],
    });
    expect(next).toHaveBeenCalled();
  });

  it("skips requests without a content-type", async () => {
    const c = createMockContext({ contentLength: "30" });
    const next = vi.fn();

    await parseBody()(c, next);

    expect(c.set).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalled();
  });

  it("skips zero-length bodies", async () => {
    const c = createMockContext({
      contentType: "application/x-www-form-urlencoded",
      contentLength: "0",
    });
    const next = vi.fn();

    await parseBody()(c, next);

    expect(c.set).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalled();
  });

  it("parses chunked bodies without a content-length", async () => {
    const c = createMockContext({
      contentType: "application/x-www-form-urlencoded",
      transferEncoding: "chunked",
      parsedBody: { status: "voting" },
    });
    const next = vi.fn();

    await parseBody()(c, next);

    expect(c.set).toHaveBeenCalledWith(BODY_KEY, { status: "voting" });
    expect(next).toHaveBeenCalled();
  });
});

// ── parseRequestBody cache behavior ─────────────────────────────

describe("parseRequestBody", () => {
  it("returns the body stored by the parseBody middleware", () => {
    const c = createMockContext();
    c.set(BODY_KEY, { status: "voting" });

    const body = parseRequestBody(c);

    expect(body).toEqual({ status: "voting" });
    expect(c.req.parseBody).not.toHaveBeenCalled();
    expect(c.req.json).not.toHaveBeenCalled();
  });

  it("returns an empty object when the middleware did not run", () => {
    const c = createMockContext();

    expect(parseRequestBody(c)).toEqual({});
  });
});
