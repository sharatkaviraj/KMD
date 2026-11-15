import { NextResponse, type NextRequest } from "next/server";

import { currentChatViewer } from "@/modules/chats/data/people";
import { isUuid } from "@/modules/chats/data/store";
import { loadEarlier, loadThreadUpdate } from "@/vx/screens/chats/load";

/**
 * One chat as it changes (D-616), for the screen that has it open:
 *
 *  - `?c=<chat>&since=<time>&stamp=<heading>` → the lines new or changed since
 *    then (a tick that moved, a failure), and the heading again only when it
 *    changed. `&seen=1` while the person is looking: a new line from the
 *    parent is then read.
 *  - `?c=<chat>&before=<time>` → a page of earlier lines.
 *
 * Only for a person who may read the chat; anything else is the same answer
 * as a chat that does not exist.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

function reply(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: NO_STORE });
}

const validTime = (value: string | null): value is string => Boolean(value) && Number.isFinite(Date.parse(value as string));

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const chatId = params.get("c");
  if (!isUuid(chatId)) return reply({ kind: "none" }, 404);
  const reader = await currentChatViewer().catch(() => null);
  if (!reader) return reply({ kind: "signed_out" }, 401);

  const before = params.get("before");
  if (before !== null) {
    if (!validTime(before)) return reply({ kind: "none" }, 400);
    const earlier = await loadEarlier(reader.viewer, chatId, before).catch(() => undefined);
    if (earlier === undefined) return reply({ kind: "error" }, 503);
    if (!earlier) return reply({ kind: "none" }, 404);
    return reply({ kind: "earlier", ...earlier });
  }

  const since = params.get("since");
  if (!validTime(since)) return reply({ kind: "none" }, 400);
  const stamp = (params.get("stamp") ?? "").slice(0, 2000);
  const update = await loadThreadUpdate(reader.viewer, chatId, since, stamp, { markRead: params.get("seen") === "1" }).catch(() => null);
  if (!update) return reply({ kind: "error" }, 503);
  if (update.kind === "none") return reply(update, 404);
  return reply(update);
}
