import { NextResponse } from "next/server";

import { currentUser } from "@/lib/auth/current-user";
import { LOCAL_MODE } from "@/lib/local/mode";
import { XTilesHttpAdapter } from "@/lib/xtiles/http";

/**
 * A look at how a real xTiles workspace answers, for bringing the connection up
 * against an account for the first time. It shows the signed-in person their OWN
 * workspace's tool list and the beginning of two replies, and nobody else's.
 *
 * Off unless XTILES_DIAGNOSE=1 is set on the server: it returns content, so it
 * should only ever be switched on while testing with a throwaway account, and
 * switched off again after.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  if (process.env.XTILES_DIAGNOSE !== "1" || LOCAL_MODE) {
    return new NextResponse("Not found", { status: 404 });
  }
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });

  try {
    return NextResponse.json(await new XTilesHttpAdapter().diagnose(user.id), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    // The kind of failure only.
    return NextResponse.json({ failed: error instanceof Error ? error.name : "Error" }, { status: 502 });
  }
}
