import "server-only";
import { assertPermission } from "@/platform/auth/current-staff";
import { createAdminClient } from "@/platform/supabase/admin";
import { fetchAllRows } from "@/platform/supabase/paginate";
import { chunkArray, mapConcurrently } from "@/platform/helpers/chunk";
import { IN_FILTER_CHUNK_SIZE } from "@/platform/helpers/in-filter";
import { getSiteUrl } from "@/platform/env";
import { classLabelMap, resolveSessionLabel } from "@/modules/academics/data/academics-repo";
import { schoolToday } from "@/vx/format";
import { toldOf, type BoardTask, type SendRecord } from "../domain/collect";
import type { DeliveryReason } from "../domain/delivery";
import type { SendEntry, SendKind } from "../domain/send-queue";
import type { TaskKind, TaskSummary } from "../domain/tasks";

/*
 * The office's board and send list (D-520). Reads only, except
 * `recordTaskSent`, which writes the same message row the task sheet's
 * "Prepare WhatsApp link" always wrote, through the same three functions.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The school's today, as the database's `school_today()` names a reminder round. */
export function collectToday(now = new Date()): string {
  return schoolToday(now);
}

/** Who each task belongs to, said the way the office names it ("Class 7 A", a house). */
function groupOf(t: TaskSummary, classes: Map<string, string>): string | null {
  const scope = t.scope;
  if (t.kind !== "collection") return t.classId ? classes.get(t.classId) ?? null : null;
  if (!scope || scope.kind === "common" || scope.kind === "route") return null;
  if (scope.kind === "house") return scope.value;
  return classes.get(scope.value) ?? null;
}

/** The office's tasks with what has been done about telling each teacher. */
export async function loadCollectBoard(tasks: TaskSummary[], now = new Date()): Promise<BoardTask[]> {
  await assertPermission("collection:manage");
  const ids = tasks.map((t) => t.id).filter((id) => UUID.test(id));
  const db = createAdminClient();
  const records: SendRecord[] = [];
  for (const chunk of chunkArray(ids, IN_FILTER_CHUNK_SIZE)) {
    const rows = await fetchAllRows<{ id: string; task_id: string; task_delivery_state: string | null; task_round: string | null; requested_at: string | null; sent_at: string | null }>(
      (from, to) => db.from("message_sends").select("id,task_id,task_delivery_state,task_round,requested_at,sent_at").in("task_id", chunk).order("id").range(from, to),
      "task messages",
    );
    for (const r of rows) records.push({ taskId: r.task_id, state: r.task_delivery_state, round: r.task_round, at: r.sent_at ?? r.requested_at });
  }
  const session = await resolveSessionLabel();
  const classes = session ? await classLabelMap(session).catch(() => new Map<string, string>()) : new Map<string, string>();
  const today = collectToday(now);
  const byTask = new Map<string, SendRecord[]>();
  for (const r of records) byTask.set(r.taskId, [...(byTask.get(r.taskId) ?? []), r]);
  return tasks.map((t) => ({ ...t, told: toldOf(byTask.get(t.id) ?? [], today), group: groupOf(t, classes) }));
}

type Snapshot = {
  taskId?: string; name?: string; phone?: string; title?: string; due?: string | null; language?: string;
  studentCount?: number; fields?: { id: string; hi: string; en: string }[]; pending?: boolean; expected?: number; answered?: number;
  openedAt?: string | null; scope?: { classLabel?: string | null; subject?: { hi: string; en: string } | null; day?: string | null };
  deliveries?: { state: string; round: string; at: string }[];
};

const DELIVERED = new Set(["manual_opened", "accepted", "human_confirmed"]);

/**
 * Everything one WhatsApp message needs, for the tasks the office picked.
 * Each task is read through the delivery summary the task sheet already
 * trusts (its phone rule, its language, its counts), and its link through
 * `teacher_task_share_link`, which refuses a task the teacher no longer owns
 * or one whose last send nobody has checked. The office already copies these
 * links from the task sheet; this reads them only when the list is opened.
 */
export async function loadSendQueue(kind: SendKind, ids: readonly string[], now = new Date()): Promise<SendEntry[]> {
  const actor = await assertPermission("collection:manage");
  const wanted = [...new Set(ids)].filter((id) => UUID.test(id)).slice(0, 200);
  if (!wanted.length) return [];
  const db = createAdminClient();
  const today = collectToday(now);
  const tasks = await fetchAllRows<{ id: string; kind: TaskKind; assigned_staff_id: string; revoked_at: string | null }>(
    (from, to) => db.from("teacher_tasks").select("id,kind,assigned_staff_id,revoked_at").in("id", wanted).order("id").range(from, to),
    "tasks to send",
  );
  const order = new Map(wanted.map((id, i) => [id, i]));
  const live = tasks.filter((t) => !t.revoked_at).sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
  const site = getSiteUrl().replace(/\/$/, "");
  return mapConcurrently(live, 4, async (t): Promise<SendEntry> => {
    const [summary, link] = await Promise.all([
      db.rpc("teacher_task_delivery_summary", { p_actor: actor.id, p_task: t.id }),
      db.rpc("teacher_task_share_link", { p_actor: actor.id, p_task: t.id }),
    ]);
    const s = (summary.error ? {} : summary.data ?? {}) as Snapshot;
    const deliveries = s.deliveries ?? [];
    const check = deliveries.some((d) => d.state === "unknown");
    const sent = deliveries.some((d) => DELIVERED.has(d.state));
    const doneThisRound = kind === "initial" ? sent : deliveries.some((d) => DELIVERED.has(d.state) && d.round === `reminder:${today}`);
    const mobile = typeof s.phone === "string" && /^[6-9]\d{9}$/.test(s.phone) ? s.phone : null;
    const path = !link.error && typeof link.data === "string" && link.data.startsWith("/t/tasks/") ? link.data : null;
    const language = s.language === "hi" || s.language === "en" ? s.language : "both";
    const blocked: SendEntry["blocked"] = summary.error || !s.name ? "no-link" : check ? "check" : !path ? "no-link" : s.pending === false ? "finished" : null;
    return {
      taskId: t.id,
      teacherName: s.name ?? "—",
      mobile,
      language,
      work: t.kind,
      title: s.title ?? "",
      group: s.scope?.classLabel ?? null,
      due: s.due ?? null,
      students: Number(s.studentCount ?? 0),
      fields: (s.fields ?? []).map((f) => ({ en: f.en, hi: f.hi })),
      answered: Number(s.answered ?? 0),
      expected: Number(s.expected ?? 0),
      url: path ? `${site}${path}` : null,
      blocked,
      done: doneThisRound,
      opened: !!s.openedAt,
    };
  });
}

export type RecordResult = { ok: true; already: boolean } | { ok: false; reason: DeliveryReason };

/**
 * Records that the office opened WhatsApp for this teacher: the message row
 * the task sheet's manual send writes (prepare → queue → claim), so the board,
 * the task sheet and the history agree. A second press in the same round is
 * already recorded, which is not a failure.
 */
export async function recordTaskSent(id: string, kind: SendKind): Promise<RecordResult> {
  const actor = await assertPermission("collection:manage");
  if (!UUID.test(id) || (kind !== "initial" && kind !== "reminder")) return { ok: false, reason: "changed" };
  const db = createAdminClient();
  const prepared = await db.rpc("prepare_teacher_task_delivery", { p_actor: actor.id, p_task: id, p_kind: kind });
  if (prepared.error || !prepared.data) return { ok: false, reason: "unavailable" };
  const preview = prepared.data as { ok: boolean; id?: string; digest?: string; reason?: DeliveryReason };
  if (!preview.ok || !preview.id || !preview.digest) return { ok: false, reason: preview.reason ?? "changed" };
  const queued = await db.rpc("queue_teacher_task_delivery", { p_actor: actor.id, p_preview: preview.id, p_digest: preview.digest });
  if (queued.error || !queued.data) return { ok: false, reason: "reconcile" };
  const queue = queued.data as { ok: boolean; id?: string; reason?: DeliveryReason };
  if (!queue.ok || !queue.id) return { ok: false, reason: queue.reason ?? "changed" };
  const claimed = await db.rpc("claim_teacher_task_delivery", { p_actor: actor.id, p_id: queue.id, p_attempt: "manual", p_transport: "manual", p_manual: true });
  if (claimed.error || !claimed.data) return { ok: false, reason: "reconcile" };
  const claim = claimed.data as { ok: boolean; reason?: DeliveryReason };
  if (claim.ok) return { ok: true, already: false };
  if (claim.reason === "already_handled") return { ok: true, already: true };
  return { ok: false, reason: claim.reason ?? "changed" };
}
