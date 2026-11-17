import "server-only";

import { classifyError } from "@/lib/echo/telemetry";
import { LOCAL_MODE } from "@/lib/local/mode";
import { summariseSeason, SummaryFailedError } from "@/lib/echo/summarise";
import {
  PAGE_TURN_AFTER,
  buildTurnPage,
  countConversations,
  countTurns,
  entriesAsText,
  isTurnDue,
  pageProjectTitle,
  type TurnSummary,
} from "@/lib/echo/turn";
import { XTilesNotConnectedError, XTilesWriteError, type XTilesAdapter } from "@/lib/xtiles/adapter";
import { stripCompassTemplate } from "@/lib/xtiles/template";

/**
 * Turning the page, server side. Three steps, and the person decides each:
 *
 *   status  → how many conversations the EchoMap holds, and whether the page can be turned
 *   propose → read the trail, write the summary, show it. Nothing is written anywhere.
 *   commit  → only with the summary they approved: make the next EchoHub, beside the old one
 *
 * The old EchoHub is never changed or deleted. Nothing here logs what the entries say.
 */

export type TurnFailure = "not-connected" | "no-hub" | "not-due" | "summary-failed" | "write-failed";

export class TurnError extends Error {
  override readonly name = "TurnError";
  constructor(
    message: string,
    readonly kind: TurnFailure,
  ) {
    super(message);
  }
}

export interface TurnStatus {
  readonly conversations: number;
  readonly threshold: number;
  readonly due: boolean;
}

/** Read the current EchoHub, turning every failure into something the person can act on. */
async function readTrail(xtiles: XTilesAdapter, userId: string) {
  if (!(await xtiles.isConnected(userId).catch(() => false))) {
    throw new TurnError("Your xTiles workspace isn't connected. Connect it from your account first.", "not-connected");
  }
  try {
    return await xtiles.readTrail(userId);
  } catch (error) {
    if (error instanceof XTilesNotConnectedError) {
      throw new TurnError("Your xTiles workspace isn't connected. Connect it from your account first.", "not-connected");
    }
    // By name: the real adapter's module is not loaded in local mode.
    if (error instanceof Error && error.name === "HubNotFoundError") {
      throw new TurnError("I couldn't find your EchoHub in xTiles, so there is nothing to turn yet.", "no-hub");
    }
    console.warn(`[turn] could not read the trail — ${classifyError(error)}`);
    throw new TurnError("I couldn't read your EchoHub just now. Nothing has changed — try again in a moment.", "write-failed");
  }
}

export async function turnStatus(xtiles: XTilesAdapter, userId: string): Promise<TurnStatus> {
  const trail = await readTrail(xtiles, userId);
  const conversations = countConversations(trail.entries);
  return { conversations, threshold: PAGE_TURN_AFTER, due: isTurnDue(conversations) };
}

/** Read the trail and write the summary. Nothing is saved. */
export async function proposeTurn(xtiles: XTilesAdapter, userId: string): Promise<{ summary: TurnSummary; conversations: number }> {
  const trail = await readTrail(xtiles, userId);
  const conversations = countConversations(trail.entries);
  if (!isTurnDue(conversations)) {
    throw new TurnError(`The page can be turned after ${PAGE_TURN_AFTER} conversations. You have ${conversations} so far.`, "not-due");
  }

  try {
    const text = entriesAsText(trail.entries);
    const summary =
      LOCAL_MODE && !process.env.ANTHROPIC_API_KEY
        ? (await import("@/lib/local/summarise")).summariseLocally(trail.entries)
        : await summariseSeason(text);
    return { summary, conversations };
  } catch (error) {
    const reason = error instanceof SummaryFailedError ? error.reason : classifyError(error);
    console.warn(`[turn] summary failed — ${reason}`);
    throw new TurnError("I couldn't gather your trail together just now. Nothing has changed — try again in a moment.", "summary-failed");
  }
}

/** Make the next EchoHub from the summary they approved. The page is checked to be due again first. */
export async function commitTurn(
  xtiles: XTilesAdapter,
  userId: string,
  summary: TurnSummary,
  options: { timeZone?: string; now?: Date } = {},
): Promise<{ title: string }> {
  const trail = await readTrail(xtiles, userId);
  const conversations = countConversations(trail.entries);
  if (!isTurnDue(conversations)) {
    throw new TurnError("This page has already been turned, or isn't ready yet.", "not-due");
  }

  const title = pageProjectTitle(countTurns(trail.entries));
  const turnPage = buildTurnPage(summary, options.now ?? new Date(), options.timeZone);
  const previousCompass = stripCompassTemplate(trail.compass ?? "");

  try {
    await xtiles.startNextPage(userId, {
      title,
      turnPage,
      previousCompass: previousCompass.length > 0 ? previousCompass : null,
    });
  } catch (error) {
    const failure = error instanceof XTilesWriteError ? `XTilesWriteError: ${error.reason}` : classifyError(error);
    console.warn(`[turn] next page failed — ${failure}`);
    throw new TurnError(
      "I couldn't start your next EchoHub just now. Nothing has changed, and your current one is exactly as it was. You can try again.",
      "write-failed",
    );
  }
  return { title };
}
