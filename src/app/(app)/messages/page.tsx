import { requirePermission } from "@/platform/auth/current-staff";
import { loadMessagesScreen } from "@/vx/screens/messages/data";
import { MessagesScreen, type MessagesState } from "@/vx/screens/messages/messages-screen";

export const runtime = "nodejs";

export const metadata = { title: "Messages" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Messages & notices (design `Messages`). Notices are queued one row per
 * family through `message_sends`; a family message never leaves the queue
 * from this screen (D-10).
 */
export default async function MessagesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  await requirePermission("messages:send", "/messages");
  const params = await searchParams;
  const id = params.id && UUID.test(params.id) ? params.id : null;
  const data = await loadMessagesScreen(id);

  const view = params.view === "replies" || params.view === "templates" ? params.view : "sent";
  const state: MessagesState = {
    view: params.sheet === "template-new" ? "templates" : view,
    compose: params.compose === "1",
    step: params.step === "preview" ? "preview" : "write",
    id,
    progress: params.progress === "1",
    done: params.done === "1",
    sheet: params.sheet === "template-new" ? "template-new" : null,
    replyId: params.reply && UUID.test(params.reply) ? params.reply : null,
  };

  return <MessagesScreen data={data} state={state} />;
}
