import "server-only";

import { createHash, randomBytes } from "node:crypto";

/**
 * Signing a member in to their xTiles, the way xTiles' MCP server asks for it.
 *
 * xTiles lets an app register itself (OAuth "dynamic client registration"), so
 * nobody at xTiles has to set anything up for us. The member then signs in on
 * xTiles' own page and clicks Allow; we never see their xTiles password. The
 * code exchange uses PKCE, which means no client secret exists to leak.
 *
 * Everything is discovered from the server's own published metadata rather than
 * hard-coded, so if xTiles moves an endpoint this keeps working.
 *
 * Errors carry an OAuth error CODE only ("invalid_grant"), never a response body.
 */

/** The MCP server's address. Overridable so tests can point at a local stand-in. */
export function mcpUrl(): string {
  return process.env.XTILES_MCP_URL ?? "https://mcp.xtiles.app/mcp";
}

/** offline_access is what makes xTiles issue a refresh token. */
export const SCOPE = "openid profile email offline_access";
const TIMEOUT_MS = 15_000;

export class XTilesAuthError extends Error {
  override readonly name = "XTilesAuthError";
  constructor(
    readonly code: string,
    /** Whether trying again might work. A revoked grant is not worth retrying. */
    readonly retryable: boolean,
  ) {
    super(`xTiles sign-in failed: ${code}`);
  }
}

export interface AuthServerMetadata {
  readonly authorization_endpoint: string;
  readonly token_endpoint: string;
  readonly registration_endpoint: string;
}

export interface TokenSet {
  readonly accessToken: string;
  readonly refreshToken: string | null;
  readonly expiresAt: Date | null;
}

let cachedMetadata: { origin: string; at: number; value: AuthServerMetadata } | null = null;

/** Only https, except a local stand-in during tests. */
function isAllowedUrl(value: string, origin: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  // Every endpoint must live on the server we were pointed at. A metadata
  // document that sends sign-in somewhere else is not one we follow.
  if (url.origin !== origin) return false;
  const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  return url.protocol === "https:" || (local && url.protocol === "http:");
}

export async function discover(): Promise<AuthServerMetadata> {
  const origin = new URL(mcpUrl()).origin;
  if (cachedMetadata && cachedMetadata.origin === origin && Date.now() - cachedMetadata.at < 3_600_000) {
    return cachedMetadata.value;
  }

  let response: Response;
  try {
    response = await fetch(`${origin}/.well-known/oauth-authorization-server`, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
  } catch {
    throw new XTilesAuthError("discovery_unreachable", true);
  }
  if (!response.ok) throw new XTilesAuthError(`discovery_${response.status}`, response.status >= 500);

  const body = (await response.json().catch(() => null)) as Partial<AuthServerMetadata> | null;
  const authorize = body?.authorization_endpoint;
  const token = body?.token_endpoint;
  const register = body?.registration_endpoint;
  if (
    typeof authorize !== "string" ||
    typeof token !== "string" ||
    typeof register !== "string" ||
    ![authorize, token, register].every((u) => isAllowedUrl(u, origin))
  ) {
    throw new XTilesAuthError("discovery_invalid", false);
  }

  const value = { authorization_endpoint: authorize, token_endpoint: token, registration_endpoint: register };
  cachedMetadata = { origin, at: Date.now(), value };
  return value;
}

/**
 * Register EchoMe as a sign-in client for this redirect address. Public client
 * (no secret): PKCE protects the exchange instead. Returns the client id.
 */
export async function registerClient(redirectUri: string): Promise<string> {
  const meta = await discover();
  let response: Response;
  try {
    response = await fetch(meta.registration_endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_name: "EchoMe",
        redirect_uris: [redirectUri],
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
        token_endpoint_auth_method: "none",
        scope: SCOPE,
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    throw new XTilesAuthError("register_unreachable", true);
  }
  if (!response.ok) throw new XTilesAuthError(`register_${response.status}`, response.status >= 500);

  const body = (await response.json().catch(() => null)) as { client_id?: unknown } | null;
  if (typeof body?.client_id !== "string" || body.client_id.length === 0) {
    throw new XTilesAuthError("register_invalid", false);
  }
  return body.client_id;
}

/** A random one-time secret and the hash the server is shown instead (S256). */
export function pkcePair(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

export function newState(): string {
  return randomBytes(24).toString("base64url");
}

export async function authorizeUrl(params: {
  clientId: string;
  redirectUri: string;
  state: string;
  challenge: string;
}): Promise<string> {
  const meta = await discover();
  const url = new URL(meta.authorization_endpoint);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", params.clientId);
  url.searchParams.set("redirect_uri", params.redirectUri);
  url.searchParams.set("scope", SCOPE);
  url.searchParams.set("state", params.state);
  url.searchParams.set("code_challenge", params.challenge);
  url.searchParams.set("code_challenge_method", "S256");
  // Says which server the token is for (RFC 8707), as MCP asks.
  url.searchParams.set("resource", mcpUrl());
  return url.toString();
}

async function tokenRequest(form: Record<string, string>): Promise<TokenSet> {
  const meta = await discover();
  let response: Response;
  try {
    response = await fetch(meta.token_endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: new URLSearchParams({ ...form, resource: mcpUrl() }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    throw new XTilesAuthError("token_unreachable", true);
  }

  const body = (await response.json().catch(() => null)) as {
    access_token?: unknown;
    refresh_token?: unknown;
    expires_in?: unknown;
    error?: unknown;
  } | null;

  if (!response.ok) {
    // The OAuth error code ("invalid_grant") is safe; nothing else is read.
    const code = typeof body?.error === "string" ? body.error : `token_${response.status}`;
    throw new XTilesAuthError(code, response.status >= 500);
  }
  if (typeof body?.access_token !== "string" || body.access_token.length === 0) {
    throw new XTilesAuthError("token_invalid", false);
  }
  return {
    accessToken: body.access_token,
    refreshToken: typeof body.refresh_token === "string" ? body.refresh_token : null,
    expiresAt: typeof body.expires_in === "number" ? new Date(Date.now() + body.expires_in * 1000) : null,
  };
}

export function exchangeCode(params: {
  code: string;
  verifier: string;
  clientId: string;
  redirectUri: string;
}): Promise<TokenSet> {
  return tokenRequest({
    grant_type: "authorization_code",
    code: params.code,
    code_verifier: params.verifier,
    client_id: params.clientId,
    redirect_uri: params.redirectUri,
  });
}

export function refreshTokens(params: { refreshToken: string; clientId: string }): Promise<TokenSet> {
  return tokenRequest({
    grant_type: "refresh_token",
    refresh_token: params.refreshToken,
    client_id: params.clientId,
  });
}
