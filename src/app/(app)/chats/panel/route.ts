import { NextResponse } from "next/server";

import { currentChatViewer } from "@/modules/chats/data/people";
import { parseChatFilter } from "@/modules/chats/domain/filters";
import { can } from "@/platform/auth/permissions";
import { loadChatList } from "@/vx/screens/chats/load";

/**
 * The chat bubble's panel (D-641): the chats that are this person's to
 * answer ("For you", the same list Chats opens on), waiting ones first, so a
 * teacher can open one and reply without leaving the screen they are on.
 * The full Chats screen keeps the tabs, the filters and the search.
 *
 * Only for a person who answers parents; an administrator seeing One as
 * somebody else (D-544) gets that person's list, marked look-only.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

/** The most rows the panel draws: anything past them is one tap away on Chats. */
const PANEL_ROWS = 30;

export async function GET() {
  const reader = await currentChatViewer().catch(() => null);
  if (!reader) return NextResponse.json({ kind: "signed_out" }, { status: 401, headers: NO_STORE });
  const { staff, viewer } = reader;
  const list = await loadChatList(staff, viewer, parseChatFilter({}, viewer)).catch(() => null);
  if (!list) return NextResponse.json({ kind: "error" }, { status: 503, headers: NO_STORE });
  const items = list.items.slice(0, PANEL_ROWS);
  return NextResponse.json(
    {
      kind: "list",
      enabled: list.enabled,
      items,
      waiting: list.items.filter((item) => item.status === "waiting").length,
      more: list.items.length - items.length + list.hidden,
      viewingTest: list.viewingTest,
      me: {
        name: staff.displayName,
        previewing: Boolean(staff.viewedBy),
        canOpenChild: can(staff, "students:view"),
        seesAll: viewer.seesAll,
      },
    },
    { headers: NO_STORE },
  );
}
