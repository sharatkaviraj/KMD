"use server";

import { z } from "zod";

import { resolveSessionLabel } from "@/modules/academics/data/academics-repo";
import { prepareAssistDraft } from "@/modules/assist/data/run";
import { FEATURE_PERMISSIONS } from "@/modules/assist/domain/features";
import { cancelReminder, insertOwn, insertSnooze, mayAskAgain, moveOwn, planState, savePlan, setOwnDone } from "@/modules/needs-you/data/store";
import { PLAN_MAX_ITEMS, planFromAnswer, type PlanFacts } from "@/modules/needs-you/domain/plan";
import type { NeedPlan, NeedReminder } from "@/modules/needs-you/domain/types";
import { NW } from "@/modules/needs-you/domain/words";
import { assertPermission, type CurrentStaff } from "@/platform/auth/current-staff";
import { canAny } from "@/platform/auth/permissions";
import { schoolNow } from "@/platform/auth/qa-clock";
import { assertSessionWritable } from "@/platform/auth/test-session-access";
import { schoolToday } from "@/platform/dates";
import { logWarn } from "@/platform/observability/log";
import type { Pair } from "@/vx/text";
import { assertNotPreviewing } from "@/vx/view-as";

/**
 * Needs you's own writes (D-631..D-633): a person's own to-dos, "Remind me
 * later", and the AI's order for their list. Every one is the person's own
 * row, in the session One is showing them, which a test account may only be
 * the test year; nothing here touches the job itself, which is done on its
 * own screen.
 */

export type NeedsResult<T> = { ok: true; value: T } | { ok: false; error: Pair };

const fail = (error: Pair = NW.failed): { ok: false; error: Pair } => ({ ok: false, error });

/** The session the person is in and the school's clock; refused while only looking, and a real year to a test account. */
async function writerFor(staff: CurrentStaff): Promise<{ sessionLabel: string; now: Date }> {
  await assertNotPreviewing();
  const sessionLabel = await resolveSessionLabel();
  if (!sessionLabel) throw new Error("No session is set up yet.");
  await assertSessionWritable(staff, sessionLabel);
  return { sessionLabel, now: await schoolNow(staff) };
}

/** A reminder time: a real instant, not long gone and not years away. */
const At = z
  .string()
  .max(40)
  .refine((v) => !Number.isNaN(Date.parse(v)), "not a time")
  .transform((v) => new Date(Date.parse(v)).toISOString());

const OwnInput = z.object({
  title: z.string().max(400),
  heard: z.string().max(200).nullable().optional(),
  remindAt: At.nullable().optional(),
});

function sane(at: string | null | undefined, now: Date): boolean {
  if (!at) return true;
  const t = Date.parse(at);
  return t >= now.getTime() - 24 * 60 * 60 * 1000 && t <= now.getTime() + 180 * 24 * 60 * 60 * 1000;
}

/** Add an own to-do, with the time it was read from the person's words or chosen on a chip. */
export async function addOwnNeedAction(raw: unknown): Promise<NeedsResult<NeedReminder>> {
  const parsed = OwnInput.safeParse(raw);
  if (!parsed.success) return fail();
  const title = parsed.data.title.replace(/\s+/g, " ").trim();
  if (!title) return fail(NW.empty);
  if (title.length > 200) return fail(NW.tooLong);
  try {
    const staff = await assertPermission("dashboard:view");
    const { sessionLabel, now } = await writerFor(staff);
    const remindAt = parsed.data.remindAt ?? null;
    if (!sane(remindAt, now)) return fail();
    const heard = parsed.data.heard?.trim().slice(0, 200) || null;
    return { ok: true, value: await insertOwn(staff.id, sessionLabel, { title, heard, remindAt }) };
  } catch (caught) {
    logWarn("needs_you.add_failed", { error: caught instanceof Error ? caught.message.slice(0, 120) : "unknown" });
    return fail();
  }
}

const Id = z.string().uuid();

/** Tick an own to-do, or untick it (Undo). */
export async function ownDoneAction(raw: unknown): Promise<NeedsResult<true>> {
  const parsed = z.object({ id: Id, done: z.boolean() }).safeParse(raw);
  if (!parsed.success) return fail();
  try {
    const staff = await assertPermission("dashboard:view");
    await writerFor(staff);
    return (await setOwnDone(staff.id, parsed.data.id, parsed.data.done)) ? { ok: true, value: true } : fail();
  } catch {
    return fail();
  }
}

/** "Remind me later": put a job off until a time; it comes back to Do now then. */
export async function snoozeNeedAction(raw: unknown): Promise<NeedsResult<NeedReminder>> {
  const parsed = z.object({ itemKey: z.string().min(1).max(160), remindAt: At, heard: z.string().max(200).nullable().optional() }).safeParse(raw);
  if (!parsed.success) return fail();
  try {
    const staff = await assertPermission("dashboard:view");
    const { sessionLabel, now } = await writerFor(staff);
    if (Date.parse(parsed.data.remindAt) <= now.getTime() || !sane(parsed.data.remindAt, now)) return fail();
    // A to-do of their own keeps its row and takes the new time.
    const own = /^own:([0-9a-f-]{36})$/i.exec(parsed.data.itemKey);
    if (own) {
      const moved = await moveOwn(staff.id, own[1], parsed.data.remindAt);
      return moved ? { ok: true, value: moved } : fail();
    }
    return {
      ok: true,
      value: await insertSnooze(staff.id, sessionLabel, { itemKey: parsed.data.itemKey, remindAt: parsed.data.remindAt, heard: parsed.data.heard?.trim().slice(0, 200) || null }),
    };
  } catch {
    return fail();
  }
}

/** Take a put-off back, or remove an own to-do. */
export async function cancelReminderAction(raw: unknown): Promise<NeedsResult<true>> {
  const parsed = z.object({ id: Id }).safeParse(raw);
  if (!parsed.success) return fail();
  try {
    const staff = await assertPermission("dashboard:view");
    await writerFor(staff);
    return (await cancelReminder(staff.id, parsed.data.id)) ? { ok: true, value: true } : fail();
  } catch {
    return fail();
  }
}

const ArrangeInput = z.object({
  signature: z.string().min(1).max(200),
  facts: z.object({
    // The task checks every field again; the AI is shown only these kinds and numbers.
    input: z.object({ role: z.string(), time: z.string(), items: z.array(z.unknown()).min(2).max(PLAN_MAX_ITEMS) }),
    ids: z.record(z.string().regex(/^i\d{1,2}$/), z.string().min(1).max(160)),
  }),
});

/**
 * Ask the AI helper for the order of this person's list. It is shown the
 * kind of each job and a few numbers, never a name (D-633); its answer only
 * orders the list, which the screen checks again. Asked at most every ten
 * minutes and twelve times a day; an order already made for the same list
 * is handed back without asking.
 */
export async function arrangeNeedsAction(raw: unknown): Promise<{ ok: true; plan: NeedPlan } | { ok: false }> {
  const parsed = ArrangeInput.safeParse(raw);
  if (!parsed.success) return { ok: false };
  try {
    const staff = await assertPermission("dashboard:view");
    const { sessionLabel, now } = await writerFor(staff);
    if (!canAny(staff, FEATURE_PERMISSIONS.needs)) return { ok: false };
    const day = schoolToday(now);
    const { signature, facts } = parsed.data;
    const state = await planState(staff.id, sessionLabel, day);
    if (state.ai && state.ai.signature === signature) return { ok: true, plan: { order: state.ai.order, reasons: state.ai.reasons, source: "ai" } };
    if (!mayAskAgain(state, new Date())) return { ok: false };
    const outcome = await prepareAssistDraft(staff.id, "needs.arrange", facts.input, { testMaterial: staff.isTestAccount === true });
    if (!outcome.ok) {
      // Switched off, or a list the task refused: nothing was asked, so nothing is counted.
      if (outcome.problem !== "off" && outcome.problem !== "invalid") await savePlan(staff.id, sessionLabel, day, signature, null).catch(() => undefined);
      return { ok: false };
    }
    const plan = planFromAnswer(outcome.value, facts as PlanFacts);
    await savePlan(staff.id, sessionLabel, day, signature, plan);
    return { ok: true, plan };
  } catch (caught) {
    logWarn("needs_you.arrange_failed", { error: caught instanceof Error ? caught.message.slice(0, 120) : "unknown" });
    return { ok: false };
  }
}
