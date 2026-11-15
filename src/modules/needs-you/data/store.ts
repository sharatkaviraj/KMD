import "server-only";

import { createAdminClient } from "@/platform/supabase/admin";
import type { Pair } from "@/vx/text";

import { isNeedKind, isNeedReason, type DoneItem, type NeedItem, type NeedPlan, type NeedReason, type NeedReminder } from "../domain/types";

/**
 * Needs you's own rows (D-631..D-633), `20261115060835_needs_you.sql`: a
 * person's own to-dos and "remind me later", what each day's list held, and
 * the AI's order. Service role, always scoped by the person's id here; the
 * caller has already checked who they are.
 */

const db = () => createAdminClient();

/** A put-off job is forgotten two days after its time: the job itself has long gone by then. */
const SNOOZE_KEEP_MS = 2 * 24 * 60 * 60 * 1000;

type ReminderRow = {
  id: string;
  kind: "own" | "snooze";
  item_key: string | null;
  title: string | null;
  heard: string | null;
  remind_at: string | null;
  done_at: string | null;
  created_at: string;
};

const toReminder = (r: ReminderRow): NeedReminder => ({
  id: r.id,
  kind: r.kind,
  itemKey: r.item_key,
  title: r.title,
  heard: r.heard,
  remindAt: r.remind_at,
  doneAt: r.done_at,
  createdAt: r.created_at,
});

/** The person's own to-dos and put-off jobs that are still open. */
export async function openReminders(staffId: string, sessionLabel: string, now: Date): Promise<NeedReminder[]> {
  const since = new Date(now.getTime() - SNOOZE_KEEP_MS).toISOString();
  const { data, error } = await db()
    .from("needs_reminders")
    .select("id, kind, item_key, title, heard, remind_at, done_at, created_at")
    .eq("staff_profile_id", staffId)
    .eq("session_label", sessionLabel)
    .is("done_at", null)
    .is("cancelled_at", null)
    .or(`kind.eq.own,remind_at.gte."${since}"`)
    .order("created_at", { ascending: true })
    .limit(200)
    .returns<ReminderRow[]>();
  if (error) throw new Error(`Needs you reminders: ${error.message}`);
  return (data ?? []).map(toReminder);
}

export async function insertOwn(staffId: string, sessionLabel: string, own: { title: string; heard: string | null; remindAt: string | null }): Promise<NeedReminder> {
  const { data, error } = await db()
    .from("needs_reminders")
    .insert({ staff_profile_id: staffId, session_label: sessionLabel, kind: "own", title: own.title, heard: own.heard, remind_at: own.remindAt })
    .select("id, kind, item_key, title, heard, remind_at, done_at, created_at")
    .single<ReminderRow>();
  if (error) throw new Error(`Needs you own to-do: ${error.message}`);
  return toReminder(data);
}

/** Tick an own to-do, or untick it (Undo). Only the person's own. */
export async function setOwnDone(staffId: string, id: string, done: boolean): Promise<boolean> {
  const { data, error } = await db()
    .from("needs_reminders")
    .update({ done_at: done ? new Date().toISOString() : null })
    .eq("id", id)
    .eq("staff_profile_id", staffId)
    .eq("kind", "own")
    .is("cancelled_at", null)
    .select("id")
    .returns<{ id: string }[]>();
  if (error) throw new Error(`Needs you done: ${error.message}`);
  return (data ?? []).length > 0;
}

/** Move an own to-do to a new time ("Remind me later" on a to-do of their own). Only the person's own. */
export async function moveOwn(staffId: string, id: string, remindAt: string): Promise<NeedReminder | null> {
  const { data, error } = await db()
    .from("needs_reminders")
    .update({ remind_at: remindAt })
    .eq("id", id)
    .eq("staff_profile_id", staffId)
    .eq("kind", "own")
    .is("done_at", null)
    .is("cancelled_at", null)
    .select("id, kind, item_key, title, heard, remind_at, done_at, created_at")
    .returns<ReminderRow[]>();
  if (error) throw new Error(`Needs you move: ${error.message}`);
  const row = (data ?? [])[0];
  return row ? toReminder(row) : null;
}

/** Put a job off until `remindAt`. An older put-off of the same job is replaced. */
export async function insertSnooze(staffId: string, sessionLabel: string, snooze: { itemKey: string; remindAt: string; heard: string | null }): Promise<NeedReminder> {
  const client = db();
  const stamp = new Date().toISOString();
  const old = await client
    .from("needs_reminders")
    .update({ cancelled_at: stamp })
    .eq("staff_profile_id", staffId)
    .eq("session_label", sessionLabel)
    .eq("kind", "snooze")
    .eq("item_key", snooze.itemKey)
    .is("done_at", null)
    .is("cancelled_at", null);
  if (old.error) throw new Error(`Needs you snooze: ${old.error.message}`);
  const { data, error } = await client
    .from("needs_reminders")
    .insert({ staff_profile_id: staffId, session_label: sessionLabel, kind: "snooze", item_key: snooze.itemKey, remind_at: snooze.remindAt, heard: snooze.heard })
    .select("id, kind, item_key, title, heard, remind_at, done_at, created_at")
    .single<ReminderRow>();
  if (error) throw new Error(`Needs you snooze: ${error.message}`);
  return toReminder(data);
}

/** Take back a put-off, or remove an own to-do. Only the person's own. */
export async function cancelReminder(staffId: string, id: string): Promise<boolean> {
  const { data, error } = await db()
    .from("needs_reminders")
    .update({ cancelled_at: new Date().toISOString() })
    .eq("id", id)
    .eq("staff_profile_id", staffId)
    .is("cancelled_at", null)
    .select("id")
    .returns<{ id: string }[]>();
  if (error) throw new Error(`Needs you cancel: ${error.message}`);
  return (data ?? []).length > 0;
}

/* ------------------------------------------------------------------ plans */

type PlanRow = { signature: string; item_order: unknown; reasons: unknown; source: "ai" | "none"; created_at: string };

export type PlanState = {
  /** The newest order the AI gave today, if any. */
  ai: (NeedPlan & { signature: string; createdAt: string }) | null;
  /** When the AI was last asked today, whether it answered or not. */
  lastAskedAt: string | null;
  /** How many times it was asked today. */
  asked: number;
};

/** The AI is asked at most this often for one person: a list changes all day, an order does not need to. */
export const PLAN_RETRY_MS = 10 * 60 * 1000;
export const PLAN_DAILY_LIMIT = 12;

function planOf(row: PlanRow): NeedPlan & { signature: string; createdAt: string } {
  const order = Array.isArray(row.item_order) ? row.item_order.filter((k): k is string => typeof k === "string") : [];
  const reasons: Record<string, NeedReason> = {};
  if (row.reasons && typeof row.reasons === "object" && !Array.isArray(row.reasons)) {
    for (const [key, value] of Object.entries(row.reasons as Record<string, unknown>)) if (isNeedReason(value)) reasons[key] = value;
  }
  return { order, reasons, source: "ai", signature: row.signature, createdAt: row.created_at };
}

export async function planState(staffId: string, sessionLabel: string, day: string): Promise<PlanState> {
  const { data, error } = await db()
    .from("needs_plans")
    .select("signature, item_order, reasons, source, created_at")
    .eq("staff_profile_id", staffId)
    .eq("session_label", sessionLabel)
    .eq("day", day)
    .order("created_at", { ascending: false })
    .limit(PLAN_DAILY_LIMIT)
    .returns<PlanRow[]>();
  if (error) throw new Error(`Needs you plans: ${error.message}`);
  const rows = data ?? [];
  const ai = rows.find((r) => r.source === "ai");
  return { ai: ai ? planOf(ai) : null, lastAskedAt: rows[0]?.created_at ?? null, asked: rows.length };
}

/** Whether the AI may be asked again now. */
export function mayAskAgain(state: PlanState, now: Date): boolean {
  if (state.asked >= PLAN_DAILY_LIMIT) return false;
  return !state.lastAskedAt || now.getTime() - Date.parse(state.lastAskedAt) >= PLAN_RETRY_MS;
}

export async function savePlan(staffId: string, sessionLabel: string, day: string, signature: string, plan: NeedPlan | null): Promise<void> {
  const { error } = await db()
    .from("needs_plans")
    .insert({
      staff_profile_id: staffId,
      session_label: sessionLabel,
      day,
      signature: signature.slice(0, 200) || "0:00000000",
      item_order: plan ? plan.order.slice(0, 60) : [],
      reasons: plan ? plan.reasons : {},
      source: plan ? "ai" : "none",
    });
  if (error) throw new Error(`Needs you plan: ${error.message}`);
}

/* ------------------------------------------------------- what the day held */

type SeenRow = { seen_key: string; seen_kind: string; seen_lane: string; seen_title: unknown; seen_done_at: string };

function pairOf(value: unknown): Pair {
  if (value && typeof value === "object") {
    const v = value as { en?: unknown; hi?: unknown };
    const en = typeof v.en === "string" ? v.en : "";
    return typeof v.hi === "string" && v.hi ? { en, hi: v.hi } : { en };
  }
  return { en: "" };
}

/**
 * Record what the list holds now and read back what left it today. Only a
 * complete read (`complete`) may mark a job done: a source that failed to
 * load would otherwise tick off everything it holds.
 */
export async function syncSeen(staffId: string, sessionLabel: string, day: string, items: readonly NeedItem[], complete: boolean): Promise<DoneItem[]> {
  const open = items.slice(0, 200).map((i) => ({
    key: i.key.slice(0, 160),
    kind: i.kind,
    lane: i.lane,
    title: i.title.hi ? { en: i.title.en, hi: i.title.hi } : { en: i.title.en },
    wake_at: i.lane === "later" && i.remindAt ? i.remindAt : null,
  }));
  const { data, error } = await db().rpc("needs_sync", { p_staff: staffId, p_session: sessionLabel, p_day: day, p_open: open, p_complete: complete });
  if (error) throw new Error(`Needs you sync: ${error.message}`);
  return ((data ?? []) as SeenRow[])
    // A job that was waiting on somebody else is answered, not done by this person.
    .filter((r) => r.seen_lane !== "waiting")
    .map((r) => ({ key: r.seen_key, kind: isNeedKind(r.seen_kind) ? r.seen_kind : "task", title: pairOf(r.seen_title), at: r.seen_done_at }));
}

/** The menu's count: today's jobs in Do now and Today, and put-off ones whose time has come. */
export async function needsBadgeCount(staffId: string, sessionLabel: string, day: string, now: Date): Promise<number> {
  const { count, error } = await db()
    .from("needs_seen")
    .select("item_key", { count: "exact", head: true })
    .eq("staff_profile_id", staffId)
    .eq("session_label", sessionLabel)
    .eq("day", day)
    .is("done_at", null)
    .or(`lane.in.(now,today),wake_at.lte."${now.toISOString()}"`);
  if (error) throw new Error(`Needs you count: ${error.message}`);
  return count ?? 0;
}
