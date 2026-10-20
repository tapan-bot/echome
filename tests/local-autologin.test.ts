import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * ECHOME_LOCAL_AUTOLOGIN: skip the login screen in local development. The risk
 * with any sign-in shortcut is that it works somewhere it must not, so most of
 * this file is about where it does NOT.
 */

async function gateWith(env: Record<string, string | undefined>) {
  vi.resetModules();
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) vi.stubEnv(key, "");
    else vi.stubEnv(key, value);
  }
  return (await import("@/lib/local/gate")).localGate;
}

const visit = (path: string, cookie?: string) =>
  new NextRequest(`http://localhost:3000${path}`, cookie ? { headers: { cookie } } : undefined);

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("with the switch on (local mode only)", () => {
  const ON = { ECHOME_LOCAL_MODE: "1", ECHOME_LOCAL_AUTOLOGIN: "1" };

  it("lets a visitor with no cookie straight in, and gives their browser the cookie", async () => {
    const gate = await gateWith(ON);
    const response = gate(visit("/chat"));
    expect(response.status).toBe(200); // passed through, not redirected to /login
    expect(response.cookies.get("echome_local_email")?.value).toBe("preview@example.com");
  });

  it("sends the login page itself on to the welcome page, since they are already in", async () => {
    const gate = await gateWith(ON);
    const response = gate(visit("/login"));
    expect(response.status).toBe(307);
    expect(new URL(response.headers.get("location")!).pathname).toBe("/welcome");
    expect(response.cookies.get("echome_local_email")?.value).toBe("preview@example.com");
  });

  it("leaves someone who is already signed in as somebody else alone", async () => {
    const gate = await gateWith(ON);
    const response = gate(visit("/chat", "echome_local_email=someone@else.test"));
    expect(response.status).toBe(200);
    expect(response.cookies.get("echome_local_email")).toBeUndefined();
  });
});

describe("with the switch off, or outside local mode", () => {
  it("still sends a visitor with no cookie to the login screen", async () => {
    const gate = await gateWith({ ECHOME_LOCAL_MODE: "1", ECHOME_LOCAL_AUTOLOGIN: undefined });
    const response = gate(visit("/chat"));
    expect(response.status).toBe(307);
    expect(new URL(response.headers.get("location")!).pathname).toBe("/login");
    expect(response.cookies.get("echome_local_email")).toBeUndefined();
  });

  it("ignores the switch entirely when local mode is not on", async () => {
    const gate = await gateWith({ ECHOME_LOCAL_MODE: undefined, ECHOME_LOCAL_AUTOLOGIN: "1" });
    const response = gate(visit("/chat"));
    expect(response.status).toBe(307);
    expect(response.cookies.get("echome_local_email")).toBeUndefined();
  });

  it("only treats the exact value 1 as on", async () => {
    for (const value of ["true", "yes", "0", "on"]) {
      const gate = await gateWith({ ECHOME_LOCAL_MODE: "1", ECHOME_LOCAL_AUTOLOGIN: value });
      expect(gate(visit("/chat")).status).toBe(307);
    }
  });
});
