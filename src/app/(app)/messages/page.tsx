import { requirePermission } from "@/platform/auth/current-staff";
import { loadMessagesScreen } from "@/vx/screens/messages/data";
import { countOutbox, loadOutbox } from "@/vx/screens/messages/outbox-data";
import { MessagesScreen, type MessagesState } from "@/vx/screens/messages/messages-screen";
import { loadStaffLog } from "@/vx/screens/messages/staff-log-data";
import { staffTransportName } from "@/modules/staff-notices/data/dispatcher";

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
  const view =
    params.view === "replies" || params.view === "templates" || params.view === "outbox" || params.view === "staff"
      ? params.view
      : "sent";
  const [data, outbox, outboxCount, staffLog] = await Promise.all([
    loadMessagesScreen(id),
    view === "outbox" ? loadOutbox() : Promise.resolve(null),
    countOutbox().catch(() => 0),
    view === "staff" ? loadStaffLog(staffTransportName()) : Promise.resolve(null),
  ]);

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

  return <MessagesScreen data={data} state={state} outbox={outbox} outboxCount={outboxCount} staffLog={staffLog} />;
}
