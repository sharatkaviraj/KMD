import { NextResponse } from "next/server";

import { readChatPulse } from "@/modules/chats/data/list";
import { currentChatViewer } from "@/modules/chats/data/people";
import { previewWords } from "@/modules/chats/domain/words";

/**
 * "Parents waiting for you" (D-616) for the chat bubble every screen carries
 * (D-641): how many, and who wrote last, so the bubble can say it and pop up
 * when somebody new writes or One opens with parents waiting. Nothing for a
 * person whose chats these are not; `enabled` false while chats are switched
 * off, and the bubble then goes away.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

export async function GET() {
  const reader = await currentChatViewer().catch(() => null);
  if (!reader) return NextResponse.json({ waiting: 0, latest: null, enabled: false }, { headers: NO_STORE });
  const pulse = await readChatPulse(reader.viewer).catch(() => null);
  if (!pulse) return NextResponse.json({ waiting: 0, latest: null, failed: true }, { headers: NO_STORE });
  const latest = pulse.latest
    ? {
        chatId: pulse.latest.chatId,
        name: pulse.latest.fromName.trim() || "—",
        children: pulse.latest.studentLabel,
        preview: previewWords(pulse.latest.preview),
        at: pulse.latest.at,
      }
    : null;
  return NextResponse.json({ waiting: pulse.waiting, latest, enabled: pulse.enabled }, { headers: NO_STORE });
}
