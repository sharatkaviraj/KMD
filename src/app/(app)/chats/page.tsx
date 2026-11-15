import { redirect } from "next/navigation";

import { currentChatViewer } from "@/modules/chats/data/people";
import { isUuid } from "@/modules/chats/data/store";
import { parseChatFilter } from "@/modules/chats/domain/filters";
import { requireAnyPermission } from "@/platform/auth/current-staff";
import { can } from "@/platform/auth/permissions";
import { ChatsScreen } from "@/vx/screens/chats/chats-screen";
import { loadChatList, loadChatThread, type ChatThreadData } from "@/vx/screens/chats/load";
import { chatsHref } from "@/vx/screens/chats/logic";
import { getViewer } from "@/vx/view-as";

export const runtime = "nodejs";

export const metadata = { title: "Chats" };

/**
 * Chats with parents (D-616): every chat a parent's WhatsApp message started
 * that needs a person at school, for the person whose desk it is — the class
 * teacher, the accounts office, the office — and all of them for an admin.
 *
 * The address carries the list's filter (`view`, `show`, `teacher`, `dues`,
 * `q`) and the open chat (`c`), so a WhatsApp link opens one chat and Back
 * returns to the list. `link=old` is a link that had expired (`/go/<code>`).
 */
export default async function ChatsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireAnyPermission(["chats:reply", "chats:all"], "/chats");
  const params = await searchParams;
  const who = await currentChatViewer();
  if (!who) redirect("/access-denied?permission=chats:reply");
  const { staff, viewer } = who;
  const filter = parseChatFilter(params, viewer);
  const one = (key: string) => {
    const value = params[key];
    return (Array.isArray(value) ? value[0] : value) ?? "";
  };

  // The open chat is read first, and read as seen: its row in the list then has nothing unread.
  const asked = one("c");
  const chatId = isUuid(asked) ? asked : null;
  let thread: ChatThreadData | null = null;
  let notice: "old_link" | "gone" | null = one("link") === "old" ? "old_link" : null;
  if (chatId) {
    const read = await loadChatThread(viewer, chatId, { markRead: true }).catch(() => null);
    if (read?.kind === "moved") redirect(chatsHref(filter, { chat: read.to }));
    if (read?.kind === "chat") thread = read.data;
    else notice = "gone";
  }

  const [list, look] = await Promise.all([loadChatList(staff, viewer, filter).catch(() => null), getViewer()]);

  return (
    <ChatsScreen
      list={list}
      thread={thread}
      filter={filter}
      openId={thread ? chatId : null}
      now={new Date().toISOString()}
      myName={staff.displayName}
      previewing={look.previewing !== null}
      canOpenChild={can(staff, "students:view")}
      notice={notice}
    />
  );
}
