import { NextResponse, type NextRequest } from "next/server";

import { currentUser } from "@/lib/auth/current-user";
import { discardStranded, reopenStranded } from "@/lib/echo/sessions";
import { sessionStore } from "@/lib/echo/store-factory";
import { classifyError } from "@/lib/echo/telemetry";
import { siteUrl } from "@/lib/site-url";

/**
 * What to do with a conversation that was left part-way through closing: pick it
 * up, or start fresh. Starting fresh destroys it, and only happens because the
 * person pressed the button that says so.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const user = await currentUser();
  const base = await siteUrl();
  if (!user) return NextResponse.redirect(`${base}/login?next=/chat`, { status: 303 });

  const choice = (await request.formData()).get("choice");
  if (choice !== "resume" && choice !== "fresh") {
    return NextResponse.redirect(`${base}/chat`, { status: 303 });
  }

  try {
    const store = await sessionStore();
    if (choice === "resume") await reopenStranded(store, user.id);
    else await discardStranded(store, user.id);
  } catch (error) {
    console.error(`[chat] stranded conversation (${choice}) failed: ${classifyError(error)}`);
  }
  return NextResponse.redirect(`${base}/chat`, { status: 303 });
}
