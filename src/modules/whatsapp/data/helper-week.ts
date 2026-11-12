import "server-only";

import { weekReport, type WeekAnswer, type WeekHandoff, type WeekReport, type WeekTurn } from "@/modules/whatsapp/domain/helper-week";
import type { HandoffTarget } from "@/modules/whatsapp/domain/helper-replies";
import { fetchAllPages, fetchInChunks } from "@/platform/helpers/chunk";
import { IN_FILTER_CHUNK_SIZE } from "@/platform/helpers/in-filter";
import { whatsappDb } from "@/platform/whatsapp/store";

/**
 * The reads behind Veer Patta AI's week (D-590), all in `vppsone` through the
 * service role and all of one kind: the practice family's or real families'.
 * The ledger (`parent_helper_turns`) holds no words; the hand-offs and the
 * answers to them are read for their times and who answered, never their text.
 */

type Db = ReturnType<typeof whatsappDb>;

const TARGETS = new Set<HandoffTarget>(["class_teacher", "accounts", "office", "principal"]);

type TurnRow = {
  id: string;
  status: string;
  intent: string | null;
  route: string | null;
  handoff: string | null;
  cost_usd: number | string | null;
  latency_ms: number | null;
  lesson_role: string | null;
};

type HandoffRow = {
  id: string;
  parent_reply_id: string;
  target: string;
  created_at: string;
  answered_at: string | null;
  closed_at: string | null;
};

const HANDOFF_COLUMNS = "id, parent_reply_id, target, created_at, answered_at, closed_at";

function handoffFromRow(row: HandoffRow, assigned: ReadonlyMap<string, string | null>): WeekHandoff | null {
  if (!TARGETS.has(row.target as HandoffTarget)) return null;
  return {
    id: row.id,
    replyId: row.parent_reply_id,
    target: row.target as HandoffTarget,
    createdAt: row.created_at,
    assignedTo: assigned.get(row.parent_reply_id) ?? null,
    answeredAt: row.answered_at,
    closedAt: row.closed_at,
  };
}

export type HelperWeek = {
  report: WeekReport;
  /** Names of the staff in the report, by id: only staff of the week's own kind are named. */
  names: Record<string, string>;
};

/** One week of one kind. Null when a read failed: a week built on half the rows would mislead. */
export async function readHelperWeek(practice: boolean, week: { from: Date; to: Date }, db: Db = whatsappDb()): Promise<HelperWeek | null> {
  const from = week.from.toISOString();
  const to = week.to.toISOString();
  try {
    const [turns, handoffs, rated, open] = await Promise.all([
      fetchAllPages<TurnRow>((start, end) =>
        db
          .from("parent_helper_turns")
          .select("id, status, intent, route, handoff, cost_usd, latency_ms, lesson_role")
          .eq("practice", practice)
          .gte("received_at", from)
          .lt("received_at", to)
          .order("received_at", { ascending: true })
          .order("id", { ascending: true })
          .range(start, end),
      ),
      db
        .from("parent_helper_handoffs")
        .select(HANDOFF_COLUMNS)
        .eq("practice", practice)
        .gte("created_at", from)
        .lt("created_at", to)
        .order("created_at", { ascending: true })
        .limit(1000)
        .returns<HandoffRow[]>(),
      db
        .from("parent_helper_handoffs")
        .select("rating")
        .eq("practice", practice)
        .gte("rated_at", from)
        .lt("rated_at", to)
        .limit(1000)
        .returns<Array<{ rating: string | null }>>(),
      db
        .from("parent_helper_handoffs")
        .select(HANDOFF_COLUMNS)
        .eq("practice", practice)
        .is("answered_at", null)
        .is("closed_at", null)
        .order("created_at", { ascending: true })
        .limit(500)
        .returns<HandoffRow[]>(),
    ]);
    if (turns.error || handoffs.error || rated.error || open.error) return null;

    const weekRows = handoffs.data ?? [];
    const openRows = open.data ?? [];
    const replyIds = [...new Set([...weekRows, ...openRows].map((row) => row.parent_reply_id))];
    const weekReplyIds = [...new Set(weekRows.map((row) => row.parent_reply_id))];
    const [replies, answers] = await Promise.all([
      fetchInChunks<{ id: string; assigned_staff_id: string | null }>(replyIds, IN_FILTER_CHUNK_SIZE, (chunk) =>
        db.from("parent_replies").select("id, assigned_staff_id").in("id", chunk),
      ),
      fetchInChunks<{ reply_id: string; answered_by: string; created_at: string }>(weekReplyIds, IN_FILTER_CHUNK_SIZE, (chunk) =>
        db.from("parent_reply_answers").select("reply_id, answered_by, created_at").in("reply_id", chunk),
      ),
    ]);
    if (replies.error || answers.error) return null;

    const assigned = new Map(replies.data.map((row) => [row.id, row.assigned_staff_id]));
    const weekAnswers: WeekAnswer[] = answers.data.map((row) => ({ replyId: row.reply_id, answeredBy: row.answered_by, createdAt: row.created_at }));
    const weekTurns: WeekTurn[] = turns.data.map((row) => ({
      status: row.status,
      intent: row.intent,
      route: row.route,
      handoff: row.handoff,
      costUsd: Number(row.cost_usd ?? 0),
      latencyMs: row.latency_ms,
      lessonRole: row.lesson_role,
    }));
    const report = weekReport({
      turns: weekTurns,
      handoffs: weekRows.map((row) => handoffFromRow(row, assigned)).filter((row): row is WeekHandoff => row !== null),
      answers: weekAnswers,
      ratings: (rated.data ?? []).map((row) => row.rating ?? ""),
      open: openRows.map((row) => handoffFromRow(row, assigned)).filter((row): row is WeekHandoff => row !== null),
    });

    const staffIds = [
      ...new Set([...report.people.map((row) => row.staffId), ...report.waiting.byPerson.map((row) => row.staffId)].filter((id): id is string => Boolean(id))),
    ];
    const names: Record<string, string> = {};
    if (staffIds.length > 0) {
      const staff = await fetchInChunks<{ id: string; display_name: string | null; short_name: string | null; is_test_account: boolean | null }>(
        staffIds,
        IN_FILTER_CHUNK_SIZE,
        (chunk) => db.from("staff_profiles").select("id, display_name, short_name, is_test_account").in("id", chunk),
      );
      // Practice accounts are named only in the practice view, real staff only in the real one (8 Nov 2026).
      for (const row of staff.error ? [] : staff.data) {
        if ((row.is_test_account === true) !== practice) continue;
        const name = (row.display_name ?? row.short_name ?? "").trim();
        if (name) names[row.id] = name.slice(0, 60);
      }
    }
    return { report, names };
  } catch {
    return null;
  }
}
