/**
 * GitHub OAuth helpers.
 *
 * Exchanges an authorization code for an access token and
 * fetches the authenticated user's profile.
 */

export interface GitHubUser {
  id: number;
  login: string;
  avatar_url: string | null;
  name: string | null;
}

interface TokenResponse {
  access_token: string;
  token_type: string;
  scope: string;
}

/**
 * Exchange an authorization code for a GitHub access token.
 */
export async function exchangeCode(
  clientId: string,
  clientSecret: string,
  code: string,
): Promise<string> {
  const res = await fetch(
    "https://github.com/login/oauth/access_token",
    {
      method: "POST",
      headers: {
        "Accept": "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        client_id: clientId,
        client_secret: clientSecret,
        code,
      }),
    },
  );

  if (!res.ok) {
    throw new Error(`GitHub token exchange failed: ${res.status}`);
  }

  const body = (await res.json()) as TokenResponse;
  return body.access_token;
}

/**
 * Fetch the authenticated GitHub user profile.
 */
export async function fetchUser(token: string): Promise<GitHubUser> {
  const res = await fetch("https://api.github.com/user", {
    headers: {
      Authorization: `Bearer ${token}`,
      "User-Agent": "js-mvc-tenet",
    },
  });

  if (!res.ok) {
    throw new Error(`GitHub user fetch failed: ${res.status}`);
  }

  return res.json() as Promise<GitHubUser>;
}

/**
 * Build the GitHub OAuth authorize URL.
 *
 * The `state` parameter is round-tripped through the OAuth flow;
 * we use it to carry the post-login redirect destination.
 */
export function buildAuthorizeUrl(
  clientId: string,
  redirectUri: string,
  state?: string,
): string {
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: "read:user",
  });
  if (state) params.set("state", state);
  return `https://github.com/login/oauth/authorize?${params}`;
}
