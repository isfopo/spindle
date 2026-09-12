/**
 * Dev-only login picker — bypasses GitHub OAuth for local development.
 * Lists seeded users; each link creates a real session for that user.
 * Only reachable in DEV; the route 404s in production builds.
 */

import { FC } from "hono/jsx";

export interface DevLoginUser {
  login: string;
  name: string | null;
  avatar_url: string | null;
}

interface DevLoginViewModel {
  users: DevLoginUser[];
  redirect?: string;
}

export const DevLoginView: FC<DevLoginViewModel> = ({ users, redirect }) => (
  <main>
    <hgroup>
      <h1>Dev login</h1>
      <p>
        Pick a seeded user to sign in as. This shortcut exists only in the
        development build — production requires GitHub OAuth.
      </p>
    </hgroup>

    {users.length === 0 ? (
      <p>No users found — run the dev server once so the seed sows the database.</p>
    ) : (
      <ul>
        {users.map((u) => (
          <li key={u.login}>
            {u.avatar_url ? <img src={u.avatar_url} alt="" width="32" height="32" /> : null}
            <a
              href={`/auth/dev?as=${encodeURIComponent(u.login)}${redirect ? `&redirect=${encodeURIComponent(redirect)}` : ""}`}
            >
              {u.name ?? u.login}
            </a>
            <small> @{u.login}</small>
          </li>
        ))}
      </ul>
    )}

    <p>
      <a href="/auth/logout">Clear session</a>
    </p>
  </main>
);