"use server";

import { revalidatePath } from "next/cache";

import { resolveSessionLabel } from "@/modules/academics/data/academics-repo";
import {
  checkSettings,
  checkToilet,
  cleanMissed,
  isUuid,
  LIMITS,
  uploadableWeek,
  type SettingsDraft,
  type ToiletDraft,
} from "@/modules/toilets/domain/checks";
import { readToilets } from "@/modules/toilets/data/read";
import { beginChart, finishChart, orderToilets, removeChart, removeToilet, saveSettings, saveToilet, type WriteCode } from "@/modules/toilets/data/writes";
import { assertPermission, type CurrentStaff } from "@/platform/auth/current-staff";
import { schoolNow } from "@/platform/auth/qa-clock";
import { assertSessionWritable } from "@/platform/auth/test-session-access";
import { schoolToday } from "@/vx/format";
import type { Pair } from "@/vx/text";
import { W } from "@/vx/screens/toilets/words";
import { assertNotPreviewing } from "@/vx/view-as";

/*
 * Toilet checks writes (D-652). Every one: its permission (`toilets:upload`
 * to send a chart, `toilets:manage` for the list, the times and taking a
 * photo off), then no "see the app as" preview, then the session the screen
 * showed must be the one this account is on now and one it may write. Then
 * the library in `src/modules/toilets/data/writes.ts`, which names the
 * session in every statement.
 */

export type ToiletResult =
  | { ok: true; message: Pair; id?: string; paths?: string[]; tokens?: string[]; storedAt?: string }
  | { ok: false; message: Pair; fields?: Record<string, string> };

const SESSION = /^(TEST-|UAT-|DEMO-)?\d{4}-\d{2}$/;

type Refusal = Extract<ToiletResult, { ok: false }>;
const refuse = (code: WriteCode | keyof typeof W.answer): Refusal => ({ ok: false, message: W.answer[code] });

type Door = { ok: true; staff: CurrentStaff; session: string } | { ok: false; result: ToiletResult };

/**
 * The checks every write passes, in order. `asking` is the caller's own
 * `assertPermission(...)`, so each action names its permission where it is
 * declared (and tests/action-guards.test.ts can see it there).
 */
async function door(shownSession: unknown, asking: Promise<CurrentStaff>): Promise<Door> {
  let staff: CurrentStaff;
  try {
    staff = await asking;
  } catch {
    return { ok: false, result: refuse("denied") };
  }
  try {
    await assertNotPreviewing();
  } catch {
    return { ok: false, result: refuse("preview") };
  }
  if (typeof shownSession !== "string" || !SESSION.test(shownSession)) return { ok: false, result: refuse("bad_request") };
  const current = await resolveSessionLabel();
  if (current !== shownSession) return { ok: false, result: refuse("session") };
  try {
    await assertSessionWritable(staff, shownSession);
  } catch {
    return { ok: false, result: refuse("session") };
  }
  return { ok: true, staff, session: shownSession };
}

function done(message: Pair, extra: Omit<Extract<ToiletResult, { ok: true }>, "ok" | "message"> = {}): ToiletResult {
  revalidatePath("/toilets");
  revalidatePath("/inbox");
  return { ok: true, message, ...extra };
}

/* ---------------------------------------------------------------- toilets */

export async function saveToiletAction(input: { session: string; id: string | null; draft: ToiletDraft; expected: string | null }): Promise<ToiletResult> {
  const gate = await door(input?.session, assertPermission("toilets:manage"));
  if (!gate.ok) return gate.result;
  if (input.id !== null && !isUuid(input.id)) return refuse("bad_request");
  if (input.expected !== null && (typeof input.expected !== "string" || Number.isNaN(Date.parse(input.expected)))) return refuse("bad_request");
  const checked = checkToilet({ name: String(input.draft?.name ?? ""), place: String(input.draft?.place ?? ""), usedBy: String(input.draft?.usedBy ?? "") });
  if (!checked.ok) return { ok: false, message: W.fixAbove, fields: checked.fields };
  const saved = await saveToilet(gate.session, gate.staff.id, input.id, checked.value, input.expected);
  if (!saved.ok) return saved.code === "duplicate" ? { ok: false, message: W.answer.duplicate, fields: { name: "duplicate" } } : refuse(saved.code);
  return done(W.savedToilet, { id: saved.value.id });
}

export async function removeToiletAction(input: { session: string; id: string }): Promise<ToiletResult> {
  const gate = await door(input?.session, assertPermission("toilets:manage"));
  if (!gate.ok) return gate.result;
  if (!isUuid(input.id)) return refuse("bad_request");
  const removed = await removeToilet(gate.session, gate.staff.id, input.id);
  if (!removed.ok) return refuse(removed.code);
  return done(W.removedToilet);
}

export async function orderToiletsAction(input: { session: string; ids: string[] }): Promise<ToiletResult> {
  const gate = await door(input?.session, assertPermission("toilets:manage"));
  if (!gate.ok) return gate.result;
  if (!Array.isArray(input.ids) || input.ids.length > LIMITS.toilets || !input.ids.every(isUuid) || new Set(input.ids).size !== input.ids.length) return refuse("bad_request");
  const saved = await orderToilets(gate.session, gate.staff.id, input.ids);
  if (!saved.ok) return refuse(saved.code);
  return done(W.savedToilet);
}

export async function saveSettingsAction(input: { session: string; draft: SettingsDraft }): Promise<ToiletResult> {
  const gate = await door(input?.session, assertPermission("toilets:manage"));
  if (!gate.ok) return gate.result;
  const d = input.draft;
  const checked = checkSettings({
    morningAt: String(d?.morningAt ?? ""),
    afternoonAt: String(d?.afternoonAt ?? ""),
    checklist: Array.isArray(d?.checklist) ? d.checklist.slice(0, 20).map((i) => ({ en: String(i?.en ?? ""), hi: String(i?.hi ?? "") })) : [],
  });
  if (!checked.ok) return { ok: false, message: W.fixAbove, fields: checked.fields };
  const saved = await saveSettings(gate.session, gate.staff.id, checked.value);
  if (!saved.ok) return refuse(saved.code);
  return done(W.savedSettings);
}

/* ----------------------------------------------------------------- charts */

/**
 * Step one of an upload: the chart's row and one signed upload link per
 * page. The phone then sends each photo straight to the private shelf and
 * calls `finishChartAction`.
 */
export async function beginChartAction(input: { session: string; chartId: string; toiletId: string; weekStart: string; pages: number }): Promise<ToiletResult> {
  const gate = await door(input?.session, assertPermission("toilets:upload"));
  if (!gate.ok) return gate.result;
  if (!isUuid(input.chartId) || !isUuid(input.toiletId)) return refuse("bad_request");
  if (!Number.isInteger(input.pages) || input.pages < 1 || input.pages > LIMITS.pages) return refuse("bad_request");
  const today = schoolToday(await schoolNow(gate.staff));
  if (!uploadableWeek(input.weekStart, today)) return refuse("week");
  const begun = await beginChart({ sessionLabel: gate.session, actorId: gate.staff.id, chartId: input.chartId, toiletId: input.toiletId, weekStart: input.weekStart, pages: input.pages });
  if (!begun.ok) return refuse(begun.code);
  return { ok: true, message: W.checking, id: input.chartId, paths: begun.value.paths, tokens: begun.value.tokens };
}

/** Step two: the photos are checked and the chart becomes the week's, with its missed checks. */
export async function finishChartAction(input: { session: string; chartId: string; weekStart: string; missed: unknown; note: string | null }): Promise<ToiletResult> {
  const gate = await door(input?.session, assertPermission("toilets:upload"));
  if (!gate.ok) return gate.result;
  if (!isUuid(input.chartId)) return refuse("bad_request");
  const today = schoolToday(await schoolNow(gate.staff));
  if (!uploadableWeek(input.weekStart, today)) return refuse("week");
  const data = await readToilets(gate.session, today).catch(() => null);
  const missed = cleanMissed(input.missed, input.weekStart, data?.ready ? data.isOpen : undefined);
  if (!missed) return refuse("bad_request");
  const note = typeof input.note === "string" ? input.note.replace(/\s+/g, " ").trim().slice(0, LIMITS.note) : null;
  const finished = await finishChart({ sessionLabel: gate.session, actorId: gate.staff.id, chartId: input.chartId, missed, note: note || null });
  if (!finished.ok) return refuse(finished.code);
  return done(W.savedMissed(missed.length), { id: input.chartId, storedAt: finished.value.storedAt });
}

export async function removeChartAction(input: { session: string; chartId: string }): Promise<ToiletResult> {
  const gate = await door(input?.session, assertPermission("toilets:manage"));
  if (!gate.ok) return gate.result;
  if (!isUuid(input.chartId)) return refuse("bad_request");
  const removed = await removeChart(gate.session, gate.staff.id, input.chartId);
  if (!removed.ok) return refuse(removed.code);
  return done(W.removedPhoto);
}
