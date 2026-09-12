import type { Context, MiddlewareHandler } from "hono";

/** Context key where the parsed request body is stored by `parseBody()`. */
export const BODY_KEY = "body";

/**
 * Read the request body parsed by the `parseBody()` middleware.
 *
 * The middleware is the only place bodies are parsed; this accessor
 * returns the canonical body stored on the context (empty object when
 * the request carried no body or the middleware did not run).
 */
export function parseRequestBody(c: Context): Record<string, unknown> {
  return (c.get(BODY_KEY) ?? {}) as Record<string, unknown>;
}

/**
 * Middleware that parses the request body once, correctly, and stores the
 * result on the context under `BODY_KEY`.
 *
 * JSON bodies are parsed as-is; form bodies are unflattened so keys like
 * `options[0][title]` become `body.options[0].title`. Handlers and guards
 * then read `parseRequestBody(c)` / `c.get(BODY_KEY)` instead of re-parsing,
 * which circumvents Hono's gotcha of the request body being readable only
 * once, and only through the parser matching the content type.
 *
 * Requests without a body (no content-type, or zero-length) are skipped.
 *
 * Mount globally (e.g. `app.use("*", parseBody())`) or per controller.
 */
export function parseBody(): MiddlewareHandler {
  return async (c, next) => {
    if (hasRequestBody(c)) {
      c.set(BODY_KEY, await parseBodyByMimeType(c));
    }
    await next();
  };
}

/** Parse a request body exactly once into the shape expected by requests. */
async function parseBodyByMimeType(
  c: Context,
): Promise<Record<string, unknown>> {
  const contentType = c.req.header("content-type") ?? "";

  if (contentType.includes("application/json")) {
    return c.req.json<Record<string, unknown>>();
  }

  const raw = await c.req.parseBody();
  return unflattenFormBody(raw as Record<string, unknown>);
}

/** True when the request carries a body worth parsing. */
function hasRequestBody(c: Context): boolean {
  if (!c.req.header("content-type")) return false;
  const length = c.req.header("content-length");
  if (length !== undefined && parseInt(length, 10) > 0) return true;
  return !!c.req.header("transfer-encoding");
}

/**
 * Unflatten bracket-notation form keys into nested objects/arrays.
 *
 * HTML forms use keys like `options[0][title]` which Hono's `parseBody()`
 * returns as flat string keys. This utility converts them into properly
 * nested structures so request classes receive `body.options[0].title`.
 *
 * Example:
 *   { "options[0][title]": "React", "options[0][pros]": "Fast" }
 *   → { options: [{ title: "React", pros: "Fast" }] }
 */

export function unflattenFormBody(
  flat: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(flat)) {
    // If key has no bracket notation, assign directly
    if (!key.includes("[")) {
      result[key] = value;
      continue;
    }

    // Parse "options[0][title]" → segments ["options", "0", "title"]
    const segments: string[] = [];
    let remaining = key;
    // Match the first segment (before any bracket)
    const head = remaining.match(/^([^[]+)/);
    if (head) {
      segments.push(head[1]);
      remaining = remaining.slice(head[1].length);
    }
    // Match bracket-wrapped segments like [0], [title]
    while (remaining.length > 0) {
      const match = remaining.match(/^\[([^\]]*)\]/);
      if (!match) break;
      segments.push(match[1]);
      remaining = remaining.slice(match[0].length);
    }

    // Walk segments, creating nested objects/arrays as needed
    let current: any = result;
    for (let i = 0; i < segments.length - 1; i++) {
      const seg = segments[i];
      const nextSeg = segments[i + 1];
      const nextIsNumeric = /^\d+$/.test(nextSeg);

      if (current[seg] == null) {
        current[seg] = nextIsNumeric ? [] : {};
      }
      current = current[seg];
    }

    // Set the value at the final segment
    const lastSeg = segments[segments.length - 1];
    if (Array.isArray(current) && /^\d+$/.test(lastSeg)) {
      current[parseInt(lastSeg, 10)] = value;
    } else {
      current[lastSeg] = value;
    }
  }

  // Compact sparse arrays (e.g., { "0": ..., "1": ... } → [...] )
  return compactArrays(result) as Record<string, unknown>;
}

/** Recursively convert array-like objects into true arrays. */
function compactArrays(obj: unknown): unknown {
  if (Array.isArray(obj)) {
    return obj.map(compactArrays);
  }
  if (obj !== null && typeof obj === "object") {
    const keys = Object.keys(obj);
    // If all keys are non-negative integers, convert to array
    if (keys.length > 0 && keys.every((k) => /^\d+$/.test(k))) {
      const maxIdx = Math.max(...keys.map(Number));
      const arr: unknown[] = [];
      for (let i = 0; i <= maxIdx; i++) {
        arr.push(compactArrays((obj as Record<string, unknown>)[String(i)]));
      }
      return arr;
    }
    // Regular object — recurse values
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) {
      result[k] = compactArrays(v);
    }
    return result;
  }
  return obj;
}
