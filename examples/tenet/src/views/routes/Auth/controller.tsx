import { Context, Env } from "hono";
import { Get, Post, ControllerBase } from "@spindle/spindle/thread";
import { Layout } from "views/routes/Shared/Layout";
import { handleError } from "error-handler";
import { buildAuthorizeUrl, exchangeCode, fetchUser } from "./github";
import { usersRepo } from "domains/user/repo";
import { createSession, destroySession } from "middleware/auth";
import { DevLoginView } from "./views/dev-login";

const DEFAULT_REDIRECT = "/tenets";

/** Only allow same-origin path redirects — blocks open-redirect payloads
 *  (`https://evil.example`, protocol-relative `//evil.example`). */
function safeRedirect(
  dest: string | null | undefined,
  fallback = DEFAULT_REDIRECT,
): string {
  if (dest && dest.startsWith("/") && !dest.startsWith("//")) return dest;
  return fallback;
}

class AuthController<T extends Env> extends ControllerBase<T> {
  override base = "auth";

  constructor() {
    super();
    this.configureRendering({ layout: Layout, handleError });
  }

  @Get("/login")
  async login(c: Context) {
    const clientId = c.env.GITHUB_CLIENT_ID;
    const origin = new URL(c.req.url).origin;
    const redirectUri = `${origin}/auth/callback`;

    // Pass the intended destination as OAuth state so it's round-tripped
    const state = safeRedirect(c.req.query("redirect"));

    const url = buildAuthorizeUrl(clientId, redirectUri, state);
    return c.redirect(url);
  }

  @Get("/dev")
  async devLogin(c: Context) {
    // Strictly local-development: never available in production builds.
    if (!import.meta.env.DEV) return c.text("Not found", 404);

    const env = c.env as CloudflareBindings;

    // ?as=<login> → sign in as that seeded user (real session cookie).
    const as = c.req.query("as");
    if (as) {
      const user = await usersRepo(env.DB).findOneBy({ login: as });
      if (!user) return c.redirect("/auth/dev");
      c.header("Set-Cookie", await createSession(env.SESSIONS, user.id));
      const dest = safeRedirect(c.req.query("redirect"));
      return c.redirect(dest);
    }

    const users = await usersRepo(env.DB).findAll({ orderBy: "id", limit: 50 });
    return c.render(
      <DevLoginView
        users={users.map((u) => ({
          login: u.login,
          name: u.name,
          avatar_url: u.avatar_url,
        }))}
        redirect={
          c.req.query("redirect") ? safeRedirect(c.req.query("redirect")) : undefined
        }
      />,
    );
  }

  @Get("/callback")
  async callback(c: Context) {
    const code = c.req.query("code");
    if (!code) {
      return c.redirect(`/auth/login?redirect=${DEFAULT_REDIRECT}`);
    }

    // The state parameter carries the original destination
    const state = safeRedirect(c.req.query("state"));

    try {
      const clientId = c.env.GITHUB_CLIENT_ID;
      const clientSecret = c.env.GITHUB_CLIENT_SECRET;

      // Exchange code for token
      const token = await exchangeCode(clientId, clientSecret, code);

      // Fetch GitHub user
      const githubUser = await fetchUser(token);

      // Upsert user in D1
      const env = c.env as CloudflareBindings;
      const user = await usersRepo(env.DB).upsertFromGithub(githubUser);

      // Create session
      const cookie = await createSession(c.env.SESSIONS, user.id);
      c.header("Set-Cookie", cookie);

      return c.redirect(state);
    } catch (error) {
      console.error("Auth callback failed:", error);
      return c.redirect(`/auth/login?redirect=${encodeURIComponent(state)}`);
    }
  }

  @Post("/logout")
  async logout(c: Context) {
    await destroySession(c.env.SESSIONS, c);
    c.header(
      "Set-Cookie",
      "tenet_session=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0",
    );
    return c.redirect("/");
  }
}

export default new AuthController();

