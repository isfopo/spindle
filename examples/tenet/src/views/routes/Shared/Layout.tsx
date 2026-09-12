import type { FC, JSXNode, PropsWithChildren } from "hono/jsx";
import type { UserRow } from "domains/user/model";

interface LayoutProps extends PropsWithChildren {
  head?: JSXNode;
  /** Current authenticated user (undefined when not logged in). */
  user?: Pick<UserRow, "login" | "avatar_url"> | null;
  /** Current request path (for active nav highlighting). */
  currentPath?: string;
}

export const Layout: FC<LayoutProps> = ({
  children,
  head = "",
  user,
  currentPath = "/",
}) => {
  const isHome = currentPath === "/" || currentPath.startsWith("/tenets");

  return (
    <html lang="en">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <meta name="description" content="Tenet — Team Decision Journal" />
        <title>Tenet</title>
        <link rel="stylesheet" href="/.generated/styles/index.css" />

        {import.meta.env.DEV ? (
          <>
            <script type="module" src="/@vite/client"></script>
            <script
              type="module"
              src="/src/.generated/client-entry.ts"
            ></script>
          </>
        ) : (
          <script type="module" src="/.generated/client/index.js"></script>
        )}

        {head}
      </head>
      <body>
        <header>
          <nav>
            <ul>
              <li>
                <strong>
                  <a href="/tenets" style="text-decoration: none;">
                    Tenet
                  </a>
                </strong>
              </li>
              {isHome && (
                <li>
                  <a href="/tenets">Decisions</a>
                </li>
              )}
            </ul>

            <ul>
              {user ? (
                <>
                  <li>
                    <a href="/tenets/new" role="button">
                      Propose
                    </a>
                  </li>
                  <li>
                    {user.avatar_url ? (
                      <img
                        src={user.avatar_url}
                        alt={user.login}
                        width="32"
                        height="32"
                        style="border-radius: 50%; vertical-align: middle;"
                      />
                    ) : (
                      <span>{user.login}</span>
                    )}
                  </li>
                  <li>
                    <form action="/auth/logout" method="post">
                      <button type="submit" class="outline secondary">
                        Logout
                      </button>
                    </form>
                  </li>
                </>
              ) : (
                <li>
                  <a href="/auth/login" role="button">
                    Login with GitHub
                  </a>
                </li>
              )}
            </ul>
          </nav>
        </header>
        <main>{children}</main>
      </body>
    </html>
  );
};
