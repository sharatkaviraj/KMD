"use server";

import { onlineLedgerRecheck } from "@/modules/payments/data/online/service";
import { insertDefaulterContacts } from "@/modules/defaulters/data/contacts";
import { createAdminClient } from "@/modules/fees/platform/supabase/admin";
import { requireAnyStaffPermission, requireStaffPermission } from "@/modules/fees/platform/session";
import { assertStudentsVisible, assertStudentVisible, filterVisibleStudentIds } from "@/platform/auth/test-session-access";
import { renderNoticePreview } from "@/modules/whatsapp/domain/campaign-bodies";
import {
  isParentWhatsAppConfigured,
  payNowButton,
  sendParentTemplate,
} from "@/modules/whatsapp/data/parent-send";
import {
  activeCampaignName,
  activeCampaignNameOrNull,
  approvedV6Campaign,
} from "@/modules/whatsapp/domain/campaign-bodies-v6";
import {
  derivedLastDateIso,
  isFinalNoticeWindow,
  type InstallmentCalendar,
} from "@/modules/whatsapp/domain/installment-calendar";
import {
  istToday,
  parseReminderFilters,
  type ReminderCandidate,
  type ReminderFilters,
} from "@/modules/whatsapp/domain/fee-reminders";
import { resolveReminderSessionLabel } from "@/modules/whatsapp/data/reminder-session";
import { resolveReminderContext } from "@/modules/whatsapp/data/reminder-context";
import { listCampaigns, loadRanScheduleSlots } from "@/modules/whatsapp/data/campaign-store";
import { campaignsDueOn } from "@/modules/whatsapp/domain/campaign-schedule";
import { describeFamilyRun, groupIntoFamilies } from "@/modules/whatsapp/domain/family-grouping";
import { addDays, CADENCE_VALUES } from "@/modules/whatsapp/domain/reminder-cadence";
import { toWhatsappDestination } from "@/modules/whatsapp/domain/phone";
import { loadGuardFacts, recordTestSend } from "@/modules/whatsapp/data/guard-context";
import {
  evaluateSendGuards,
  resolveGuards,
} from "@/modules/whatsapp/domain/send-guards";
import {
  campaignFor,
  describeCampaign,
  isCampaignApproved,
  DEFAULT_LANGUAGE,
  DEFAULT_SITUATION,
  isNoticeLanguage,
  isNoticeSituation,
  type CampaignDescriptor,
} from "@/modules/whatsapp/domain/campaigns";
import { noticeValuesFromSlots } from "@/modules/whatsapp/domain/test-send-values";
import {
  NOTICE_FACT_KEYS,
  REMINDER_QUERY_KEYS,
} from "@/modules/whatsapp/domain/audience";
import { searchSessionStudents } from "@/modules/whatsapp/data/student-lookup";
import { formatDdMmYyyy, isoFromDdMmYyyy } from "@/platform/helpers/date";
import { executeReminderRun } from "@/modules/whatsapp/data/run-sender";
import {
  oneMessagePerFamilyEnabled,
  rememberLastUsedNoticeSettings,
} from "@/modules/whatsapp/data/reminder-settings";
import { redirect } from "next/navigation";

export type SendRemindersState = {
  /**
   * The judgements standing in the way of this run, when it was refused for
   * one. The screen turns each into a tick-box; agreeing to all of them plus a
   * reason lets the run through, and both land on the run record.
   */
  guards?: Array<{ code: string; message: string }>;
  status: "idle" | "success" | "partial" | "error";
  message?: string;
  sent?: number;
  failed?: number;
  alreadySentToday?: number;
  failures?: Array<{ admissionNo: string; studentName: string; error: string }>;
  /**
   * Ticked students the rebuilt list no longer has: paid in full, left with
   * nothing paid, flagged no-call, or no number WhatsApp can use. The failure
   * desk's resend reports them instead of saying "0 sent" with no reason.
   */
  notOnList?: string[];
  /** Dropped by `skipNothingDue`: owe nothing now on what the notice asks for. */
  paidSince?: string[];
};


/**
 * A posted form as a `ParamReader`.
 *
 * `getAll(...).join(",")`, never `get(...)`: the installment control is four
 * checkboxes sharing one name, so a form posts `installments=1&installments=2`
 * and `get` would read "1" — an audience of families who owe on installment 1
 * regardless of installment 2, which is a different set of parents. Joining
 * with a comma lands on the same string the query-string form uses, so the two
 * readers stay interchangeable. `readerFor` does the same on the other side.
 */
/** The slot this saved campaign is due for today, or null when none is. */
async function dueSlotFor(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  sessionLabel: string,
  campaignId: string,
  calendar: InstallmentCalendar,
  today: string,
): Promise<string | null> {
  const [campaigns, ranSlots] = await Promise.all([
    listCampaigns(supabase, sessionLabel),
    loadRanScheduleSlots(supabase, sessionLabel),
  ]);
  const campaign = campaigns.find((entry) => entry.id === campaignId);
  if (!campaign) return null;
  const [due] = campaignsDueOn(
    [
      {
        id: campaign.id,
        name: campaign.name,
        situation: campaign.situation,
        language: campaign.language,
        schedule: campaign.schedule,
        ranForSlots: ranSlots.get(campaign.id) ?? [],
      },
    ],
    calendar,
    today,
  );
  return due?.scheduledFor ?? null;
}

/** A posted form as the query-string reader the screen's parser takes. */
function formReader(formData: FormData) {
  return (key: string) => {
    const values = formData
      .getAll(key)
      .filter((value): value is string => typeof value === "string");
    return values.length > 0 ? values.join(",") : null;
  };
}

function filtersFromForm(
  formData: FormData,
  sessionLabel: string,
  /**
   * What the school's policy charges. `ledger` mode quotes it to a family the
   * ledger has not charged yet, so a send that could not see it would put a
   * different figure in front of a parent than the screen previewed.
   */
  policyLateFeeAmount = 0,
): ReminderFilters {
  return parseReminderFilters(
    formReader(formData),
    sessionLabel,
    undefined,
    undefined,
    undefined,
    null,
    { policyLateFeeAmount },
  );
}

export async function sendRemindersAction(
  _prev: SendRemindersState,
  formData: FormData,
): Promise<SendRemindersState> {
  let staffId: string | null = null;
  try {
    const staff = await requireStaffPermission("settings:write");
    staffId = (staff?.id as string | undefined) ?? null;
  } catch {
    return { status: "error", message: "Permission denied." };
  }

  const today = istToday();

  const selected = new Set(formData.getAll("studentId").map(String).filter(Boolean));
  if (selected.size === 0) {
    return { status: "error", message: "No students selected." };
  }
  try {
    // Phase 3 fence: a test account never messages a real parent. (The
    // audience below is the viewer's session too; this is the second lock.)
    await assertStudentsVisible(null, [...selected]);
  } catch {
    return { status: "error", message: "Some of those students belong to a session you cannot open." };
  }

  const supabase = createAdminClient();

  let sessionLabel: string;
  let filters: ReminderFilters;
  let candidates: ReminderCandidate[];
  let finalWindowOpen: boolean | null = null;
  let calendar: InstallmentCalendar | null = null;
  let notOnList: string[] = [];
  let paidSince: string[] = [];
  try {
    sessionLabel = await resolveReminderSessionLabel(supabase);
    // The SAME resolution the screen ran — the drain, the policy, the
    // remembered settings, the calendar, and the filters parsed with the
    // calendar's tiles and the remembered (else the policy's) late fee.
    //
    // It used to parse the form on its own with the parser's bare defaults.
    // The bulk screen posts every key, so that went unnoticed; the one-tap
    // reminder on a student's page posts only the notice, language, date and
    // the family — and was sent for "Installment 1" (₹0 for most families by
    // October) with a ₹0 late fee, which was then saved as the bulk screen's
    // default for the next morning.
    const context = await resolveReminderContext(supabase, sessionLabel, formReader(formData));
    filters = context.filters;
    const runCalendar = context.calendar;
    calendar = runCalendar;
    // A form that carried no date gets the calendar's, rather than a refusal.
    //
    // The bulk screen has a date field and fills it. The one-tap reminder on a
    // student's page does not, so every send from it hit the BLOCKING "Pick a
    // last date for this notice before sending" — and the screen then offered
    // tick-boxes and a reason box, neither of which can clear a blocking
    // finding. `resolveReminderContext` already opens on the remembered or the
    // derived date; this is the backstop for a date cleared to nothing.
    if (!filters.lastDate) {
      const aboutOverdue = filters.installments.some((installment) =>
        runCalendar.overdue.includes(installment),
      );
      filters = {
        ...filters,
        lastDate: formatDdMmYyyy(derivedLastDateIso(runCalendar, today, { overdue: aboutOverdue })),
      };
    }
    finalWindowOpen = runCalendar.next
      ? isFinalNoticeWindow(runCalendar.next.daysUntilDue)
      : null;
    // Re-derived server-side rather than read off the form. The amount a parent
    // is quoted must come from the ledger at send time, not from a number that
    // was rendered into a checkbox some minutes ago — and a student who has
    // paid since the page loaded drops out here rather than being messaged.
    candidates = context.audience.candidates.filter((candidate) =>
      selected.has(candidate.studentId),
    );
    notOnList = [...selected].filter(
      (studentId) => !candidates.some((candidate) => candidate.studentId === studentId),
    );

    // The failure desk's resend. It names the child the failed message was
    // addressed to; `withFamily` brings in everyone the sender would group onto
    // that message today, so a two-child family is re-quoted as two children
    // and not resent as one.
    if (formData.get("withFamily") === "1") {
      const families = new Set(candidates.map((candidate) => candidate.familyKey));
      const already = new Set(candidates.map((candidate) => candidate.studentId));
      candidates = [
        ...candidates,
        ...context.audience.candidates.filter(
          (candidate) => families.has(candidate.familyKey) && !already.has(candidate.studentId),
        ),
      ];
    }

    // A hand-picked student joins the list whatever the filters say — including
    // one who has paid in full since, who would be quoted ₹0. The resend asks
    // for that to be refused rather than sent.
    if (formData.get("skipNothingDue") === "1") {
      const owesNothing = (candidate: ReminderCandidate) =>
        candidate.dueAmount <= 0 &&
        !(filters.situation === "late_fee_applied" && candidate.lateFeeApplied > 0);
      paidSince = candidates.filter(owesNothing).map((candidate) => candidate.studentId);
      candidates = candidates.filter((candidate) => !owesNothing(candidate));
    }
  } catch (caught) {
    return {
      status: "error",
      message: caught instanceof Error ? caught.message : "Could not rebuild the recipient list.",
    };
  }

  // Every pre-send guard, from the one list the cron reads too.
  //
  // `domain/send-guards` owns them because there are now two ways to start a
  // run, and "the scheduled runner applies every guard the manual path applies"
  // is only true by construction if there is one list. The date rule is in
  // there: every forward-looking notice needs a date parents can still meet;
  // `late_fee_applied` needs none because it prints none, and `promise_due`
  // needs none because it prints each family's own.
  const lastDateIso = isoFromDdMmYyyy(filters.lastDate);
  // The facts only the database can answer — quiet hours, the holiday list, the
  // budget, whether this campaign has ever gone out. Best-effort throughout: a
  // guard that cannot load its data falls back to the value that permits.
  const facts = await loadGuardFacts({
    supabase,
    lastDateIso,
    // The generation that will actually go — a `_v6` template that has never
    // gone out is untested whatever its predecessor's record says.
    campaignName: activeCampaignNameOrNull(filters.situation, filters.language) ?? "",
    requireProvenCampaign: true,
  });

  // What this run will BILL, grouped exactly as the sender groups it: one
  // message per phone when siblings are grouped, plus the second parent's
  // number once escalated. The budget guard counted ticked children, so a
  // sibling-heavy run was refused as over the cap when it was not, and second-
  // number sends went past it uncounted.
  const oneMessagePerFamily = await oneMessagePerFamilyEnabled(supabase);
  const billable = candidates
    .filter((candidate) => !candidate.sentToday)
    .map((candidate) => ({
      studentId: candidate.studentId,
      studentName: candidate.studentName,
      studentClass: candidate.studentClass,
      parentName: candidate.parentName,
      destination: candidate.destination,
      dueAmount: candidate.dueAmount,
      preferredLanguage: candidate.preferredLanguage,
      sentCount: candidate.sentCount,
      secondaryDestination: candidate.secondaryDestination,
      familyKey: candidate.familyKey,
    }));
  const messageCount = describeFamilyRun(
    oneMessagePerFamily
      ? groupIntoFamilies(billable, filters.language)
      : billable.flatMap((member) => groupIntoFamilies([member], filters.language)),
  ).messages;

  const guards = evaluateSendGuards({
    providerReady: isParentWhatsAppConfigured(),
    campaignApproved: isCampaignApproved(filters.situation, filters.language),
    situation: filters.situation,
    lastDateIso,
    lastDateLabel: filters.lastDate,
    today,
    recipientCount: candidates.length,
    messageCount,
    // Since the template stopped deciding the audience, a template can be
    // pointed at families who cannot fill its slots. Counted over the families
    // ACTUALLY selected, not the whole list.
    noticeFactGaps: candidates.filter((candidate) => candidate.missingFacts.length > 0).length,
    // Per fact, so the refusal can name what is actually wrong and how to
    // avoid it rather than listing every fact the app knows about.
    noticeFactBreakdown: NOTICE_FACT_KEYS.map((fact) => ({
      fact,
      count: candidates.filter((candidate) => candidate.missingFacts.includes(fact)).length,
    })),
    // The three-day rule for `upcoming_final`, moved out of the audience query
    // and in here where it belongs — it is a fact about the run, not a family.
    finalWindowOpen: finalWindowOpen,
    ...facts,
  });

  // What the admin ticked, and why. An override is only honoured when both are
  // present — the point is that the decision lands on the run, not that it is
  // easy to get past.
  const overrideCodes = formData.getAll("overrideGuard").map(String).filter(Boolean);
  const overrideReason = String(formData.get("overrideReason") ?? "").trim();
  const resolved = resolveGuards(
    guards,
    overrideCodes.length > 0 ? { codes: overrideCodes, reason: overrideReason } : null,
    {
      // One family, named by hand: the press is the decision, and this is what
      // the run says about it. Withheld from anything larger, where a broadcast
      // outside quiet hours or over budget should still be explained in
      // somebody's own words.
      defaultReason:
        candidates.length === 1
          ? "Sent by hand to one family, from that family's page."
          : undefined,
    },
  );
  if (!resolved.allowed) {
    return {
      status: "error",
      message: resolved.message ?? "This run was refused.",
      notOnList,
      paidSince,
      // So the screen can render the tick-boxes for exactly what is in the way —
      // and NOTHING when the refusal is a blocking one, because no tick-box and
      // no reason can clear those. Offering the override anyway is what made a
      // missing date look like something staff could argue their way past.
      guards: resolved.blocked
        ? undefined
        : guards.overridable.map((finding) => ({
            code: finding.code,
            message: finding.message,
          })),
    };
  }

  // Safe after the approval guard above: `campaignFor` throws for an unapproved
  // notice, and `campaign_unapproved` has already returned by here. The `_v6`
  // name once that generation is approved — the run records what went.
  const campaignName = activeCampaignName(filters.situation, filters.language);

  // The whole run — opening the record, grouping into families, sending, closing
  // and logging — lives in `data/run-sender`, because there are two ways to
  // start one: this action, and the scheduled cron. One executor is what makes
  // "the cron applies every guard the manual path applies" true by construction
  // rather than by remembering.
  // Whichever saved campaign the office loaded, or null for an ad-hoc send.
  // Both are real runs; only one has a name attached.
  const campaignId = (formData.get("campaignId") as string | null)?.trim() || null;

  // A held-back family is money the school does not chase, so the field is
  // admin-only and re-checked here rather than trusted from the form.
  let canHoldOut = false;
  try {
    await requireStaffPermission("settings:write");
    canHoldOut = true;
  } catch {
    canHoldOut = false;
  }
  const holdoutPercent = Math.min(
    50,
    Math.max(0, Number(formData.get("holdoutPercent") ?? 0) || 0),
  );

  const outcome = await executeReminderRun({
    supabase,
    candidates,
    filters,
    sessionLabel,
    today,
    lastDateIso,
    campaignName,
    campaignId,
    staffId,
    source: "manual",
    // Admin-only, off by default, and never persisted: a holdout is a decision
    // about THIS run. The form only renders the field for an admin, and this
    // re-reads the permission rather than trusting that.
    holdoutPercent: canHoldOut ? holdoutPercent : 0,
    overriddenGuards: resolved.overridden,
    // `resolved.reason`, not the raw form field: on a hand-picked single send
    // it is the sentence the resolver supplied, and the run must carry what was
    // actually accepted rather than the empty box that was posted.
    overrideReason: resolved.overridden.length > 0 ? resolved.reason : null,
    logContacts: insertDefaulterContacts,
    // A saved campaign whose slot is due right now is satisfied by this press —
    // from the due card, the plan, or opened by hand. It was always null, so a
    // step sent by hand stayed "due" and would have gone again.
    scheduledFor:
      campaignId && calendar
        ? await dueSlotFor(supabase, sessionLabel, campaignId, calendar, today).catch(() => null)
        : null,
    oneMessagePerFamily,
    // With online payments on, every one-child Pay now message is re-quoted
    // from the ledger in the instant before it goes. Undefined otherwise.
    recheckLedger: await onlineLedgerRecheck(),
  });

  const { sent, failed, alreadySentToday, failures, heldOut } = outcome;

  // What went on this message is what tomorrow's screen opens on. Best-effort,
  // after the send: the messages have gone whatever happens here. Only from a
  // form that CARRIED the late-fee settings (the bulk screen): the one-tap
  // reminder on a student's page has none, and remembering what this action
  // filled in for it is how a ₹0 became the next morning's default.
  if (formData.get("lateFeeAmount") !== null) {
    await rememberLastUsedNoticeSettings(supabase, sessionLabel, {
      lastDate: filters.lastDate,
      lateFeeAmount: filters.lateFeeAmount,
      lateFeeBasis: filters.lateFeeBasis,
    });
  }

  // Deliberately NO revalidatePath here.
  //
  // The page is `export const revalidate = 0` — nothing about it is cached, so
  // there is nothing to invalidate. What revalidatePath DID do was force Next to
  // re-render this route and ship the whole 150-family payload as part of THIS
  // action's response, so `useFormStatus().pending` stayed true through a full
  // re-derivation of the audience. The office watched "Sending…" long after all
  // 141 messages had been delivered, and on a phone that reads as a hang.
  //
  // The client refreshes instead, from useActionFeedback, once it has the
  // result: the button releases, the toast names the count, and the list
  // re-reads a moment later.

  const summary = [
    `${sent} sent`,
    heldOut > 0 ? `${heldOut} held back for comparison` : null,
    failed > 0 ? `${failed} failed` : null,
    alreadySentToday > 0 ? `${alreadySentToday} already messaged today` : null,
  ]
    .filter(Boolean)
    .join(", ");

  return {
    status: failed > 0 ? "partial" : "success",
    message: summary,
    sent,
    failed,
    alreadySentToday,
    failures: failures.slice(0, 20),
    notOnList,
    paidSince,
  };
}

/**
 * Apply on the notice card: remember the date and the late fee, then land on
 * the same URL a GET would have.
 *
 * A plain GET form could not remember anything, and the office was retyping
 * "pay by Saturday, Rs. 2,000 per installment" every morning because the screen
 * opened on the calendar's default. The redirect keeps the notice linkable and
 * the back button honest — the same rule the picker's chips follow.
 */
export async function applyNoticeSettingsAction(formData: FormData): Promise<void> {
  // The canonical key list, from `domain/audience`. It used to be a copy kept
  // here, and a key added to the screen but not to the copy is a key that
  // silently resets the moment somebody presses Apply.
  const params = new URLSearchParams();
  for (const key of REMINDER_QUERY_KEYS) {
    const values = formData
      .getAll(key)
      .filter((value): value is string => typeof value === "string" && value.trim() !== "");
    // Same comma join as `filtersFromForm`, for the same reason: four
    // checkboxes share the `installments` name.
    if (values.length > 0) params.set(key, values.map((value) => value.trim()).join(","));
  }

  // Remembering is a write, so it needs the sending permission; viewing staff
  // still get their filtered list, just not a saved default.
  try {
    await requireStaffPermission("settings:write");
    const supabase = createAdminClient();
    const sessionLabel = await resolveReminderSessionLabel(supabase);
    const filters = filtersFromForm(formData, sessionLabel);
    // Never remember a late fee the form did not carry (see the send action).
    if (filters.lastDate && formData.get("lateFeeAmount") !== null) {
      await rememberLastUsedNoticeSettings(supabase, sessionLabel, {
        lastDate: filters.lastDate,
        lateFeeAmount: filters.lateFeeAmount,
        lateFeeBasis: filters.lateFeeBasis,
      });
    }
  } catch {
    // Best-effort: the list still applies.
  }

  redirect(`/fees/reminders?${params.toString()}`);
}

/**
 * Put one student on the list by hand, whatever the filters say.
 *
 * A server action rather than a typeahead, deliberately. `/fees/reminders`
 * has ~480 gzip bytes of headroom against its bundle ceiling, and a search box
 * that resolves on the server costs the browser nothing — the whole audience
 * builder is GET forms, links and this.
 *
 * An exact admission number adds that child straight away. Anything ambiguous
 * lands back on the screen with `?find=` and the matches rendered as Add links,
 * so the office picks a person rather than trusting a guess. Nobody is ever
 * added by a name that matched two children.
 *
 * Gated on `settings:view`, not `settings:write`: choosing who WOULD be
 * messaged is not sending, and staff who may print the collection list may
 * certainly build it.
 */
export async function addReminderStudentAction(formData: FormData): Promise<void> {
  const params = new URLSearchParams();
  for (const key of REMINDER_QUERY_KEYS) {
    const values = formData
      .getAll(key)
      .filter((value): value is string => typeof value === "string" && value.trim() !== "");
    if (values.length > 0) params.set(key, values.map((value) => value.trim()).join(","));
  }

  const query = String(formData.get("addStudent") ?? "").trim();
  if (!query) redirect(`/fees/reminders?${params.toString()}`);

  try {
    await requireAnyStaffPermission(["settings:view", "settings:write"]);
  } catch {
    redirect(`/fees/reminders?${params.toString()}`);
  }

  const supabase = createAdminClient();
  const sessionLabel = await resolveReminderSessionLabel(supabase);
  const found = await searchSessionStudents(supabase, sessionLabel, query);
  // The search runs inside the viewer's own session already; the child's own
  // session is checked too (Phase 3 fence), so nobody is put on a list by an
  // id this viewer may not open.
  const visible = new Set(await filterVisibleStudentIds(null, found.map((match) => match.studentId)));
  const matches = found.filter((match) => visible.has(match.studentId));

  if (matches.length === 1) {
    const existing = (params.get("include") ?? "").split(",").filter(Boolean);
    params.set("include", [...new Set([...existing, matches[0].studentId])].join(","));
    // An added student is on the list; leaving the search term in the box would
    // re-offer the same person on the next render.
    params.delete("find");
  } else {
    // Zero or many. The screen renders the matches — or says there were none —
    // and the office picks.
    params.set("find", query);
  }

  redirect(`/fees/reminders?${params.toString()}`);
}

export type CadenceState = {
  status: "idle" | "success" | "error";
  message?: string;
};

const SNOOZE_DAYS = 7;

/**
 * Write a WhatsApp cadence / snooze without touching `no_call`.
 *
 * Update first, insert only if there was no row. A plain upsert would be wrong:
 * `student_collection_flags.no_call` DEFAULTS TO TRUE, so an insert that did not
 * name it would quietly drop the family from the Defaulters call queue — the
 * exact opposite of "message them less often, keep calling them".
 */
async function writeReminderFlags(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  studentId: string,
  sessionLabel: string,
  patch: { whatsapp_cadence?: string; whatsapp_snoozed_until?: string | null },
): Promise<void> {
  const { data: updated, error: updateError } = await supabase
    .from("student_collection_flags")
    .update(patch)
    .eq("student_id", studentId)
    .eq("session_label", sessionLabel)
    .select("id");

  if (updateError) throw new Error(updateError.message);
  if (updated && updated.length > 0) return;

  const { error: insertError } = await supabase.from("student_collection_flags").insert({
    student_id: studentId,
    session_label: sessionLabel,
    no_call: false, // never infer this — see above
    ...patch,
  });

  if (insertError) throw new Error(insertError.message);
}

/**
 * "Remind this family every run / weekly / fortnightly / monthly / never."
 *
 * WhatsApp only. The Defaulters call queue reads `no_call`, which this never
 * writes, so a family set to `monthly` still gets called on the usual cadence.
 */
export async function setReminderCadenceAction(
  _prev: CadenceState,
  formData: FormData,
): Promise<CadenceState> {
  try {
    await requireStaffPermission("settings:write");
  } catch {
    return { status: "error", message: "Permission denied." };
  }

  const studentId = String(formData.get("studentId") ?? "").trim();
  const cadence = String(formData.get("cadence") ?? "").trim();
  // Same list the database's check constraint enforces, from one source.
  if (!studentId || !CADENCE_VALUES.includes(cadence)) {
    return { status: "error", message: "Pick a family and a cadence." };
  }

  const supabase = createAdminClient();
  try {
    const sessionLabel = await resolveReminderSessionLabel(supabase);
    await assertStudentVisible(null, studentId);
    // Changing the cadence clears any snooze: the office just made a fresh,
    // more considered decision about this family, and leaving a stale snooze
    // underneath it would silently outrank what they chose.
    await writeReminderFlags(supabase, studentId, sessionLabel, {
      whatsapp_cadence: cadence,
      whatsapp_snoozed_until: null,
    });
  } catch (caught) {
    return {
      status: "error",
      message: caught instanceof Error ? caught.message : "Could not save that.",
    };
  }

  // No revalidatePath — see sendRemindersAction. The control refreshes the
  // router itself once it has the answer.
  return { status: "success", message: "Reminder setting saved." };
}

/** One tap: hold this family back for a week, then let them return on their own. */
export async function snoozeReminderAction(
  _prev: CadenceState,
  formData: FormData,
): Promise<CadenceState> {
  try {
    await requireStaffPermission("settings:write");
  } catch {
    return { status: "error", message: "Permission denied." };
  }

  const studentId = String(formData.get("studentId") ?? "").trim();
  if (!studentId) return { status: "error", message: "No student." };

  const days = Number(formData.get("days")) || SNOOZE_DAYS;
  const until = addDays(istToday(), days);

  const supabase = createAdminClient();
  try {
    const sessionLabel = await resolveReminderSessionLabel(supabase);
    await assertStudentVisible(null, studentId);
    await writeReminderFlags(supabase, studentId, sessionLabel, {
      whatsapp_snoozed_until: until,
    });
  } catch (caught) {
    return {
      status: "error",
      message: caught instanceof Error ? caught.message : "Could not snooze that family.",
    };
  }

  return { status: "success", message: `Held back until ${until}.` };
}

/** Undo: back to every run, no snooze. */
export async function resumeReminderAction(
  _prev: CadenceState,
  formData: FormData,
): Promise<CadenceState> {
  try {
    await requireStaffPermission("settings:write");
  } catch {
    return { status: "error", message: "Permission denied." };
  }

  const studentId = String(formData.get("studentId") ?? "").trim();
  if (!studentId) return { status: "error", message: "No student." };

  const supabase = createAdminClient();
  try {
    const sessionLabel = await resolveReminderSessionLabel(supabase);
    await assertStudentVisible(null, studentId);
    await writeReminderFlags(supabase, studentId, sessionLabel, {
      whatsapp_cadence: "every_run",
      whatsapp_snoozed_until: null,
    });
  } catch (caught) {
    return {
      status: "error",
      message: caught instanceof Error ? caught.message : "Could not resume that family.",
    };
  }

  return { status: "success", message: "Back on the list." };
}

export type TestSendState = {
  status: "idle" | "success" | "error";
  /** One-line human summary. The only field the original UI read. */
  message?: string;
  /**
   * The provider's HTTP status. 0 means the request never completed — a network
   * failure, which is NOT the same as a 4xx WhatsApp actually answered with.
   * Absent when the call was refused here before it was ever made (permission,
   * no API key, unusable number), which is itself the diagnosis.
   */
  httpStatus?: number;
  /** `submitted_message_id` — an acceptance receipt, not proof of delivery. */
  messageId?: string | null;
  /** E.164 exactly as posted, after `toWhatsappDestination`. */
  destination?: string;
  campaignName?: string;
  /** The four slot values as sent, in template order. */
  templateParams?: string[];
  /** The WhatsApp service's own error sentence, verbatim and unwrapped. */
  providerError?: string;
};

/**
 * The test panel's preview, rendered on the server.
 *
 * The panel used to render this in the browser, which meant every per-student
 * template body — twenty-four of them in two languages — shipped in the client
 * bundle of a route with a gzip ceiling that only ratchets down, so that ONE of
 * them could be shown. The bodies now live in `domain/campaign-bodies`, which
 * no `ui/` file may import, and the panel asks here instead.
 *
 * Same mapping as the send (`noticeValuesFromSlots`) and same renderer as the
 * page's preview, so what staff read is what a test would post. Previews an
 * unapproved notice too: the office needs to read what is awaiting Meta.
 *
 * Read-only, and gated on `settings:view` like the page — never `settings:write`,
 * which is the SEND permission.
 */
export async function previewNoticeAction(input: {
  situation: string;
  language: string;
  form: Record<string, string>;
}): Promise<string | null> {
  try {
    await requireAnyStaffPermission(["settings:view", "settings:write"]);
  } catch {
    return null;
  }
  const situation = isNoticeSituation(input.situation) ? input.situation : DEFAULT_SITUATION;
  const language = isNoticeLanguage(input.language) ? input.language : DEFAULT_LANGUAGE;
  const campaign = describeCampaign(situation, language);
  if (!campaign) return null;
  const values = noticeValuesFromSlots(situation, input.form ?? {}, campaign.sample);
  // The same choice the test send makes — v6 once approved — so the preview is
  // the message the test is about to deliver.
  return renderNoticePreview(situation, language, values);
}

/**
 * One message to a number the office controls, using values the caller chose.
 *
 * Deliberately not written to `whatsapp_reminder_sends`: a test is not a
 * reminder to that family, and logging it would claim the student's day and
 * quietly exclude them from the real send. There is no Supabase call anywhere
 * in this function, and that is the whole guarantee — do not add one.
 *
 * Also deliberately free of the `FEE_REMINDER_TEMPLATE_DEADLINE` guard that
 * `sendRemindersAction` carries. A test to a staff phone after the deadline is
 * exactly what you want while a replacement template is in approval: it costs
 * one message and reaches no parent. The screen passes this a `canTest` that
 * omits `templateExpired` for the same reason.
 */
export async function sendTestReminderAction(
  _prev: TestSendState,
  formData: FormData,
): Promise<TestSendState> {
  // Held, because the test is RECORDED against whoever ran it — the
  // untested-campaign guard reads that record before letting a run reach real
  // families.
  let staffId: string | null = null;
  try {
    const staff = await requireStaffPermission("settings:write");
    staffId = (staff?.id as string | undefined) ?? null;
  } catch {
    return { status: "error", message: "Permission denied." };
  }

  if (!isParentWhatsAppConfigured()) {
    return {
      status: "error",
      message: "The school's WhatsApp is not connected on this server yet. Settings → WhatsApp shows what is missing.",
    };
  }
  const situation = String(formData.get("situation") ?? "");
  const language = String(formData.get("language") ?? "");
  let campaign: CampaignDescriptor;
  try {
    campaign = campaignFor(
      isNoticeSituation(situation) ? situation : DEFAULT_SITUATION,
      isNoticeLanguage(language) ? language : DEFAULT_LANGUAGE,
    );
  } catch (caught) {
    return {
      status: "error",
      message: caught instanceof Error ? caught.message : "No campaign for that notice.",
    };
  }
  const campaignName = campaign.campaignName;

  const destination = toWhatsappDestination(formData.get("testPhone") as string | null);
  if (!destination) {
    return {
      status: "error",
      message: "Enter a valid 10-digit Indian mobile number.",
      campaignName,
    };
  }

  // The panel posts the SKELETON slot names, and slots 4-6 mean something
  // different per notice. ONE mapping — `domain/test-send-values.ts` — turns
  // those into named values here and in the panel's preview, so the message
  // staff read and the message they send cannot differ. Fallbacks are the
  // campaign's own Meta-submitted sample, slot by slot, so "leave it blank"
  // still produces a message with the right shape for that template.
  const values = noticeValuesFromSlots(
    campaign.situation,
    Object.fromEntries(
      campaign.slotOrder.map((slot) => [slot, formData.get(slot) as string | null]),
    ),
    campaign.sample,
  );

  // The `_v6` template once it is the live one, built from the SAME values —
  // a test of the template parents no longer receive would prove nothing.
  const v6 = approvedV6Campaign(campaign.situation, campaign.language);
  const sendName = v6?.campaignName ?? campaignName;
  const templateParams = v6 ? v6.buildParams(values) : campaign.buildParams(values);

  const result = await sendParentTemplate({
    campaignName: sendName,
    destination,
    userName: values.parentName || templateParams[0],
    templateParams,
    // A test send goes only to a number on the test-recipient list, wherever
    // it is pressed: the number is typed in, not read from a family.
    gate: { kind: "fee_reminder", sessionLabel: null, actor: staffId ? { userId: staffId } : "unknown", testSend: true },
    // A test has no send row and so no pay code; the button opens the pay
    // page's "no longer valid" state, which is the honest answer for a test.
    ...(v6?.buttons.includes("pay_url") ? { buttons: [payNowButton("test")] } : {}),
  });

  // Recorded in its OWN table, never in the send log.
  //
  // A row in the send log claims a student's day, and the unique index would
  // then drop that family out of the real run — which is why "a test never
  // writes to the send log" is a standing rule, pinned by
  // tests/ui/whatsapp-reminders-screen.test.ts. `recordTestSend` writes to
  // `whatsapp_test_sends`, which has no student_id and no day to claim, so the
  // untested-campaign guard can read it without breaking that rule.
  //
  // (The send log is deliberately not named in this function: the test asserts
  // on the source text, and naming it here would defeat the check.)
  await recordTestSend({
    supabase: createAdminClient(),
    campaignName: sendName,
    destination,
    succeeded: result.ok,
    providerMessageId: result.ok ? result.messageId : null,
    errorMessage: result.ok ? null : result.error,
    staffId,
  });

  // Everything the provider told us, passed through rather than summarised, so
  // staff can tell a template that is not approved yet from a bad number
  // without opening anything else.
  const sent = { destination, campaignName: sendName, templateParams } as const;

  if (result.ok) {
    return {
      status: "success",
      message: `WhatsApp accepted it for ${destination}, from the school's number. Check that phone.`,
      httpStatus: result.status,
      messageId: result.messageId,
      ...sent,
    };
  }
  const message =
    result.refused && result.refusalCode === "dry_run"
      ? "Practice mode is on, so this was written to the WhatsApp log and not sent. Nothing reached that phone."
      : result.refused
        ? result.error
        : result.deliveryUnknown
          ? "WhatsApp did not answer clearly. The message may still arrive: check that phone before trying again."
          : `WhatsApp refused it: ${result.error}`;
  return {
    status: "error",
    message,
    httpStatus: result.status,
    providerError: result.error,
    ...sent,
  };
}
