import { NextResponse, type NextRequest } from "next/server";

import { currentUser } from "@/lib/auth/current-user";
import { GENERIC_ERROR, NOT_SIGNED_IN } from "@/lib/echo/messages";
import { MAX_CONTEXT_CHARS, MAX_SPOKEN_CHARS, tidyDictation } from "@/lib/echo/tidy";
import { consume } from "@/lib/rate-limit";

/**
 * "Tidy up" for dictated words: the words they just spoke, and what was already in
 * the message box for context, go in; the same words, corrected, come back.
 *
 * Nothing is stored and nothing the person wrote is logged. The text is theirs,
 * handed to a small model only because they pressed the button.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: NOT_SIGNED_IN }, { status: 401 });

  let body: { before?: unknown; spoken?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: GENERIC_ERROR }, { status: 400 });
  }
  const before = typeof body.before === "string" ? body.before : "";
  const spoken = typeof body.spoken === "string" ? body.spoken : "";
  if (spoken.trim().length === 0 || spoken.length > MAX_SPOKEN_CHARS * 2 || before.length > MAX_CONTEXT_CHARS * 8) {
    return NextResponse.json({ error: GENERIC_ERROR }, { status: 400 });
  }

  const verdict = await consume("tidy", user.id);
  if (!verdict.allowed) {
    return NextResponse.json(
      { error: "Give it a moment before tidying again." },
      { status: 429, headers: { "Retry-After": String(verdict.retryAfterSeconds) } },
    );
  }

  return NextResponse.json(await tidyDictation(before, spoken), { headers: { "Cache-Control": "no-store" } });
}
