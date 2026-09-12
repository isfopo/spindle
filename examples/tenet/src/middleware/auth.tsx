/**
 * Auth middleware — reads the `tenet_session` cookie, looks up
 * the session in KV, fetches the user from D1, and attaches the
 * user to `c.set("user", ...)`.
 *
 * Redirects to /auth/login if the session is missing or invalid.
 */

import type { Context, MiddlewareHandler } from "hono";
import type { UserRow } from "domains/user/model";

const SESSION_COOKIE = "tenet_session";
const COOKIE_MAX_AGE = 604800; // 7 days

/** Read a cookie value from the Cookie header. */
function readCookie(c: Context, name: string): string | null {
  const header = c.req.header("Cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    const key = part.slice(0, eq).trim();
    if (key === name) return part.slice(eq + 1).trim();
  }
  return null;
}

/** Attach the authenticated user to the context. */
export function requireAuth(): MiddlewareHandler {
  return async (c: Context, next) => {
    const env = c.env as CloudflareBindings;
    const sessionId = readCookie(c, SESSION_COOKIE);

    if (!sessionId) {
      const dest = encodeURIComponent(c.req.path);
      return c.redirect(`/auth/login?redirect=${dest}`);
    }

    const raw = await env.SESSIONS.get(sessionId);
    if (!raw) {
      // Stale cookie — clear it and redirect
      c.header(
        "Set-Cookie",
        `${SESSION_COOKIE}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`,
      );
      const dest = encodeURIComponent(c.req.path);
      return c.redirect(`/auth/login?redirect=${dest}`);
    }

    const session = JSON.parse(raw) as {
      userId: number;
      createdAt: string;
    };

    // Fetch user from D1
    const user = await env.DB.prepare("SELECT * FROM users WHERE id = ?")
      .bind(session.userId)
      .first<UserRow>();

    if (!user) {
      // User was deleted — clear session
      await env.SESSIONS.delete(sessionId);
      c.header(
        "Set-Cookie",
        `${SESSION_COOKIE}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`,
      );
      return c.redirect("/auth/login");
    }

    // Attach user to context (for controller access)
    c.set("user", user as object);

    await next();
  };
}

/**
 * Create a session KV entry and return the Set-Cookie header value.
 */
export async function createSession(
  kv: KVNamespace,
  userId: number,
): Promise<string> {
  const sessionId = crypto.randomUUID();
  const session = { userId, createdAt: new Date().toISOString() };

  await kv.put(sessionId, JSON.stringify(session), {
    expirationTtl: COOKIE_MAX_AGE,
  });

  const cookie = `${SESSION_COOKIE}=${sessionId}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${COOKIE_MAX_AGE}`;
  return cookie;
}

/**
 * Delete a session KV entry.
 */
export async function destroySession(
  kv: KVNamespace,
  c: Context,
): Promise<void> {
  const sessionId = readCookie(c, SESSION_COOKIE);
  if (sessionId) {
    await kv.delete(sessionId);
  }
}
