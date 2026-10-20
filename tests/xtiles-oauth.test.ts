import { createHash, randomBytes } from "node:crypto";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  authorizeUrl,
  discover,
  exchangeCode,
  newState,
  pkcePair,
  refreshTokens,
  registerClient,
  SCOPE,
  XTilesAuthError,
} from "@/lib/xtiles/oauth";
import { openOAuthState, sealOAuthState, statesMatch, type OAuthState } from "@/lib/xtiles/oauth-state";
import { startFakeXTiles, type FakeXTiles } from "./helpers/fake-xtiles-server";

/**
 * Signing a member in to xTiles: the pieces, against a stand-in server that
 * speaks the real protocol. The browser leg (the member clicking Allow on
 * xTiles' own page) cannot be exercised here; everything either side of it can.
 */

const USER = "33333333-3333-4333-8333-333333333333";
const OTHER_USER = "44444444-4444-4444-8444-444444444444";

let xtiles: FakeXTiles;

beforeEach(async () => {
  process.env.SESSION_MASTER_KEY = randomBytes(32).toString("base64");
  xtiles = await startFakeXTiles();
  process.env.XTILES_MCP_URL = xtiles.mcpUrl;
});

afterEach(async () => {
  delete process.env.XTILES_MCP_URL;
  await xtiles.close();
});

describe("PKCE", () => {
  it("shows the server only the SHA-256 hash of the one-time secret", () => {
    const { verifier, challenge } = pkcePair();
    expect(challenge).toBe(createHash("sha256").update(verifier).digest("base64url"));
    expect(challenge).not.toBe(verifier);
    // Long enough to be unguessable, within the 43-128 characters the spec allows.
    expect(verifier.length).toBeGreaterThanOrEqual(43);
    expect(verifier.length).toBeLessThanOrEqual(128);
  });

  it("makes a fresh secret and state every time", () => {
    expect(pkcePair().verifier).not.toBe(pkcePair().verifier);
    expect(newState()).not.toBe(newState());
  });
});

describe("discovery and registration", () => {
  it("finds the endpoints from the server's own metadata", async () => {
    const meta = await discover();
    expect(meta.authorization_endpoint).toBe(`${xtiles.origin}/api/oauth2/auth`);
    expect(meta.token_endpoint).toBe(`${xtiles.origin}/api/oauth2/token`);
    expect(meta.registration_endpoint).toBe(`${xtiles.origin}/api/oauth2/register`);
  });

  it("does not follow metadata that sends sign-in to another site", async () => {
    const evil = createServer((_, response) => {
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(
        JSON.stringify({
          authorization_endpoint: "https://evil.example/auth",
          token_endpoint: "https://evil.example/token",
          registration_endpoint: "https://evil.example/register",
        }),
      );
    });
    await new Promise<void>((resolve) => evil.listen(0, "127.0.0.1", resolve));
    process.env.XTILES_MCP_URL = `http://127.0.0.1:${(evil.address() as AddressInfo).port}/mcp`;
    try {
      await expect(discover()).rejects.toMatchObject({ code: "discovery_invalid" });
    } finally {
      await new Promise<void>((resolve) => evil.close(() => resolve()));
    }
  });

  it("registers EchoMe as a public client for exactly the return address it will use", async () => {
    const id = await registerClient("https://app.echomechat.ai/api/xtiles/callback");
    expect(id).toBe("client-1");
    expect(xtiles.state.registered[0]).toMatchObject({
      client_name: "EchoMe",
      redirect_uris: ["https://app.echomechat.ai/api/xtiles/callback"],
      token_endpoint_auth_method: "none", // PKCE instead of a secret
      grant_types: ["authorization_code", "refresh_token"],
      scope: SCOPE,
    });
  });

  it("asks for offline_access, which is what makes xTiles issue a refresh token", () => {
    expect(SCOPE.split(" ")).toContain("offline_access");
  });
});

describe("the sign-in link", () => {
  it("carries the PKCE challenge, state, scope and which server the token is for", async () => {
    const link = new URL(
      await authorizeUrl({
        clientId: "client-9",
        redirectUri: "https://app.echomechat.ai/api/xtiles/callback",
        state: "state-abc",
        challenge: "challenge-xyz",
      }),
    );
    expect(link.origin + link.pathname).toBe(`${xtiles.origin}/api/oauth2/auth`);
    const p = link.searchParams;
    expect(p.get("response_type")).toBe("code");
    expect(p.get("client_id")).toBe("client-9");
    expect(p.get("redirect_uri")).toBe("https://app.echomechat.ai/api/xtiles/callback");
    expect(p.get("state")).toBe("state-abc");
    expect(p.get("code_challenge")).toBe("challenge-xyz");
    expect(p.get("code_challenge_method")).toBe("S256");
    expect(p.get("scope")).toBe(SCOPE);
    expect(p.get("resource")).toBe(xtiles.mcpUrl);
  });
});

describe("exchanging the code", () => {
  it("sends the one-time secret, never a client secret, and returns the tokens", async () => {
    const tokens = await exchangeCode({
      code: "code-1",
      verifier: "verifier-1",
      clientId: "client-1",
      redirectUri: "https://app.echomechat.ai/api/xtiles/callback",
    });
    expect(tokens.accessToken).toBe("access-2");
    expect(tokens.refreshToken).toBe("refresh-1");
    // expires_in: 3600 -> about an hour from now
    const secondsLeft = (tokens.expiresAt!.getTime() - Date.now()) / 1000;
    expect(secondsLeft).toBeGreaterThan(3500);
    expect(secondsLeft).toBeLessThanOrEqual(3600);

    expect(xtiles.state.tokenRequests[0]).toMatchObject({
      grant_type: "authorization_code",
      code: "code-1",
      code_verifier: "verifier-1",
      client_id: "client-1",
      redirect_uri: "https://app.echomechat.ai/api/xtiles/callback",
    });
    expect(xtiles.state.tokenRequests[0]).not.toHaveProperty("client_secret");
  });

  it("reports an OAuth error by its code only, and says a refused grant is not worth retrying", async () => {
    xtiles.state.tokenError = "invalid_grant";
    const error = await exchangeCode({
      code: "used",
      verifier: "v",
      clientId: "client-1",
      redirectUri: "https://app.echomechat.ai/api/xtiles/callback",
    }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(XTilesAuthError);
    expect((error as XTilesAuthError).code).toBe("invalid_grant");
    expect((error as XTilesAuthError).retryable).toBe(false);
  });
});

describe("refreshing", () => {
  it("trades the refresh token for a new access token", async () => {
    const tokens = await refreshTokens({ refreshToken: "refresh-1", clientId: "client-1" });
    expect(tokens.accessToken).toBe("access-2");
    expect(xtiles.state.tokenRequests[0]).toMatchObject({
      grant_type: "refresh_token",
      refresh_token: "refresh-1",
      client_id: "client-1",
    });
  });

  it("returns a rotated refresh token when the server issues one", async () => {
    xtiles.state.rotateRefreshTo = "refresh-ROTATED";
    const tokens = await refreshTokens({ refreshToken: "refresh-1", clientId: "client-1" });
    expect(tokens.refreshToken).toBe("refresh-ROTATED");
  });

  it("fails with invalid_grant for a token that has been revoked", async () => {
    await expect(refreshTokens({ refreshToken: "revoked", clientId: "client-1" })).rejects.toMatchObject({
      code: "invalid_grant",
      retryable: false,
    });
  });
});

describe("the sealed state cookie", () => {
  const state = (): OAuthState => ({
    state: "state-1",
    verifier: "verifier-1",
    clientId: "client-1",
    redirectUri: "https://app.echomechat.ai/api/xtiles/callback",
    exp: Date.now() + 60_000,
  });

  it("opens for the person it was sealed for", () => {
    const sealed = sealOAuthState(USER, state());
    expect(openOAuthState(USER, sealed)).toMatchObject({ state: "state-1", verifier: "verifier-1", clientId: "client-1" });
  });

  it("does not show the one-time secret to anyone reading the cookie", () => {
    const sealed = sealOAuthState(USER, state());
    expect(sealed).not.toContain("verifier-1");
    expect(Buffer.from(sealed.replaceAll(".", ""), "base64url").toString("utf8")).not.toContain("verifier-1");
  });

  it("does not open for a different signed-in person", () => {
    expect(openOAuthState(OTHER_USER, sealOAuthState(USER, state()))).toBeNull();
  });

  it("does not open once it has expired", () => {
    const sealed = sealOAuthState(USER, { ...state(), exp: Date.now() - 1 });
    expect(openOAuthState(USER, sealed)).toBeNull();
  });

  it("does not open if any part of it was altered", () => {
    const [wrapped, nonce, ciphertext] = sealOAuthState(USER, state()).split(".") as [string, string, string];
    const flip = (value: string) => value.slice(0, -2) + (value.endsWith("A") ? "B" : "A") + value.slice(-1);
    expect(openOAuthState(USER, [wrapped, nonce, flip(ciphertext)].join("."))).toBeNull();
    expect(openOAuthState(USER, [flip(wrapped), nonce, ciphertext].join("."))).toBeNull();
  });

  it("treats a missing or malformed cookie as nothing at all", () => {
    expect(openOAuthState(USER, undefined)).toBeNull();
    expect(openOAuthState(USER, "")).toBeNull();
    expect(openOAuthState(USER, "not.a.cookie")).toBeNull();
    expect(openOAuthState(USER, "one-part-only")).toBeNull();
  });

  it("compares state values in constant time and rejects any difference", () => {
    expect(statesMatch("abc", "abc")).toBe(true);
    expect(statesMatch("abc", "abd")).toBe(false);
    expect(statesMatch("abc", "abcd")).toBe(false);
  });
});
