import { NextResponse } from "next/server";

import { getFeePolicySummary } from "@/modules/fees/data/policy";
import { logError, logInfo, logWarn } from "@/platform/observability/log";
import { insertDefaulterContacts } from "@/modules/defaulters/data/contacts";
import { createAdminClient } from "@/modules/fees/platform/supabase/admin";
import { isAisensyConfigured } from "@/modules/whatsapp/data/aisensy";
import { loadGuardFacts } from "@/modules/whatsapp/data/guard-context";
import {
  getCampaign,
  listCampaigns,
  loadRanScheduleSlots,
} from "@/modules/whatsapp/data/campaign-store";
import { executeReminderRun } from "@/modules/whatsapp/data/run-sender";
import { onlineLedgerRecheck } from "@/modules/payments/data/online/service";
import { oneMessagePerFamilyEnabled } from "@/modules/whatsapp/data/reminder-settings";
import { campaignsDueOn, messageDateFor } from "@/modules/whatsapp/domain/campaign-schedule";
import {
  isCampaignApproved,
  type NoticeLanguage,
  type NoticeSituation,
} from "@/modules/whatsapp/domain/campaigns";
import {
  drainPendingFinancialRefresh,
  istToday,
  loadReminderAudience,
  parseReminderFilters,
  resolveCurrentSessionLabel,
} from "@/modules/whatsapp/domain/fee-reminders";
import {
  buildInstallmentCalendar,
  defaultInstallmentsFor,
  defaultLastYearFor,
} from "@/modules/whatsapp/domain/installment-calendar";
import { evaluateSendGuards, firstBlockingMessage } from "@/modules/whatsapp/domain/send-guards";
import {
  activeCampaignName,
  activeCampaignNameOrNull,
} from "@/modules/whatsapp/domain/campaign-generation";
import { savedAudienceParams } from "@/modules/whatsapp/domain/audience";
import { formatDdMmYyyy, isoFromDdMmYyyy } from "@/platform/helpers/date";

/**
 * The scheduled reminder runner.
 *
 * Sends saved campaigns whose slot has arrived AND whose owner has explicitly
 * turned `auto` on. Everything else it finds due is left for a human to press —
 * a campaign with a schedule but no `auto` is a row on a card, not an instruction.
 *
 * **This is the only thing in the app that sends a message nobody pressed.** The
 * screen says so out loud on any campaign carrying `auto`, and the default is
 * off, because "every send is a press" was a deliberate decision and this is a
 * deliberate, per-campaign exception to it rather than a quiet reversal.
 *
 * It applies the SAME guards the manual path applies, and that is true by
 * construction rather than by remembering: `evaluateSendGuards` is one pure
 * list, and `executeReminderRun` is one executor, both shared with
 * `sendRemindersAction`.
 *
 * `?dryRun=1` reports exactly what would be sent, opens no run, claims no row
 * and calls no provider. It exists so this can be pointed at production and read
 * before it is trusted with it.
 *
 * NOT wired into `vercel.json` — see the note at the bottom of
 * `docs/modules/whatsapp-reminders.md`. The Hobby plan's cron allowance is
 * already spent on the nightly backup and the automatic day close, and a third
 * entry fails the whole deployment rather than just the cron. The route works
 * from any external scheduler in the meantime, and the JSON to paste is in the
 * doc for the day the plan changes.
 */

async function authorize(
  request: Request,
): Promise<{ ok: true } | { ok: false; reason: string; misconfigured: boolean }> {
  // Three ways in. `CRON_SECRET` is the one every cron route here shares;
  // `WHATSAPP_CRON_SECRET` is this route's own; and the database's morning
  // timer (`20261026120020`) sends Vault's `VPPS_WHATSAPP_CRON_SECRET`, which is
  // checked IN the database rather than copied into a Vercel env var — the one
  // place it lives is the one place it is read. A separate secret means the one
  // in Postgres can only ever start a reminder run: it cannot close the day or
  // take a backup.
  const expected = [process.env.CRON_SECRET, process.env.WHATSAPP_CRON_SECRET].filter(
    (value): value is string => Boolean(value),
  );
  const url = new URL(request.url);
  const provided =
    url.searchParams.get("secret") ??
    request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (provided && expected.includes(provided)) return { ok: true };
  // Only a secret shaped like the Vault one (32 random bytes, hex) costs a
  // database round trip, so a prober's junk never reaches Postgres.
  if (provided && /^[0-9a-f]{64}$/.test(provided) && (await vaultSecretMatches(provided))) {
    return { ok: true };
  }
  if (expected.length === 0 && !provided) {
    return { ok: false, reason: "CRON_SECRET is not set on this deployment.", misconfigured: true };
  }
  // One word back to the caller. The reason is for the log: handing an
  // unauthenticated prober the name of a server-only env var is how the
  // day-close route used to answer.
  return { ok: false, reason: "Secret missing or does not match.", misconfigured: false };
}

/**
 * Does `secret` equal Vault's `VPPS_WHATSAPP_CRON_SECRET`? Asked of
 * `public.whatsapp_cron_secret_matches` (`20261027090000`), which answers yes or
 * no and never returns the secret; only the service role may call it. Any
 * failure reads as no.
 */
async function vaultSecretMatches(secret: string): Promise<boolean> {
  try {
    const { data, error } = await createAdminClient().rpc("whatsapp_cron_secret_matches", {
      p_secret: secret,
    });
    return !error && data === true;
  } catch {
    return false;
  }
}

type RunReport = {
  campaignId: string;
  campaignName: string;
  scheduledFor: string;
  status: "sent" | "skipped" | "failed" | "would_send";
  reason?: string;
  sent?: number;
  failed?: number;
  recipients?: number;
};

export async function GET(request: Request) {
  const auth = await authorize(request);
  if (!auth.ok) {
    if (auth.misconfigured) {
      logError("cron.whatsapp-scheduled-runs.unauthorized", { reason: auth.reason });
    } else {
      logWarn("cron.whatsapp-scheduled-runs.unauthorized", { reason: auth.reason });
    }
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const dryRun = url.searchParams.get("dryRun") === "1";
  const today = istToday();
  const supabase = createAdminClient();
  const reports: RunReport[] = [];

  try {
    const sessionLabel = await resolveCurrentSessionLabel(supabase);
    // Before any figure is quoted, exactly as the screen and the action do.
    // Free when nothing is queued.
    await drainPendingFinancialRefresh(supabase);

    const policy = await getFeePolicySummary({ useAdmin: true }).catch(() => null);
    const [campaigns, ranSlots] = await Promise.all([
      listCampaigns(supabase, sessionLabel),
      loadRanScheduleSlots(supabase, sessionLabel),
    ]);

    const calendar = buildInstallmentCalendar({
      schedule: policy?.installmentSchedule ?? [],
      today,
    });

    const due = campaignsDueOn(
      campaigns.map((campaign) => ({
        id: campaign.id,
        name: campaign.name,
        situation: campaign.situation,
        language: campaign.language,
        schedule: campaign.schedule,
        ranForSlots: ranSlots.get(campaign.id) ?? [],
      })),
      calendar,
      today,
    );

    // Only what the owner turned on. A due campaign without `auto` is somebody
    // else's decision and stays on the card.
    const automatic = due.filter((campaign) => campaign.auto);

    for (const entry of automatic) {
      const saved = await getCampaign(supabase, entry.id);
      if (!saved) {
        reports.push({
          campaignId: entry.id,
          campaignName: entry.name,
          scheduledFor: entry.scheduledFor,
          status: "skipped",
          reason: "The campaign was deleted between listing and running.",
        });
        continue;
      }

      // Rebuild the audience from the saved RULE against today's ledger, exactly
      // as loading the campaign on the screen would. The audience is never
      // stored, so a family who paid this morning is simply absent.
      // `savedAudienceParams` emits every key — including `last_year` in
      // `installments` for a Last-year campaign, without which the rule would
      // replay on the calendar's default and chase this year's installments
      // under last year's wording.
      // The date the schedule says this slot's message prints — a waiver window
      // measured from its own installment, an every-morning promise notice —
      // or the saved date for a campaign whose schedule does not move it.
      const messageDateIso =
        messageDateFor(entry.schedule, calendar, entry.scheduledFor) ?? saved.lastDate;
      const search = new URLSearchParams({
        ...savedAudienceParams(saved.filters),
        situation: saved.situation,
        language: saved.language,
        lastDate: messageDateIso ? formatDdMmYyyy(messageDateIso) : "",
        lateFeeAmount: String(saved.lateFeeAmount),
        lateFeeBasis: saved.lateFeeBasis,
        ...(saved.lateFeeSource ? { lateFeeSource: saved.lateFeeSource } : {}),
      });

      const filters = parseReminderFilters(
        (key) => search.get(key),
        sessionLabel,
        formatDdMmYyyy(
          calendar.next?.dueDate ?? calendar.timings[calendar.timings.length - 1]?.dueDate ?? null,
        ),
        Number(policy?.lateFeeFlatAmount ?? 0),
        defaultInstallmentsFor(calendar),
        null,
        {
          // `ledger` mode quotes this to a family with nothing charged yet.
          policyLateFeeAmount: Number(policy?.lateFeeFlatAmount ?? 0),
          // A rule saved with no tiles (the every-morning steps) replays on the
          // screen's own default, last session's balance included.
          defaultLastYear: defaultLastYearFor(calendar),
        },
      );

      const audience = await loadReminderAudience(supabase, filters, calendar);
      const lastDateIso = isoFromDdMmYyyy(filters.lastDate);

      // The facts only the database can answer — quiet hours, the holiday list,
      // the two budget caps.
      //
      // This call used to be missing entirely, and the omission was invisible
      // rather than loud: `evaluateSendGuards` reads those facts off optional
      // fields, so leaving them out did not fail a type check or a test — it
      // silently made quiet hours, both message caps and the holiday check
      // structurally unreachable on a scheduled run. The module doc on
      // `run-sender` says a scheduled run applies every guard the manual path
      // applies; that was only true of the guards that need no IO.
      //
      // Harmless so far only because nothing schedules this yet. `requireProven`
      // is false on purpose and is the one real difference: the cron sends
      // saved campaigns that have already run at least once by hand.
      const facts = await loadGuardFacts({
        supabase,
        lastDateIso,
        campaignName:
          activeCampaignNameOrNull(
            filters.situation as NoticeSituation,
            filters.language as NoticeLanguage,
          ) ?? "",
        requireProvenCampaign: false,
      });

      // The same list the office is held to.
      const guards = evaluateSendGuards({
        providerReady: isAisensyConfigured(),
        campaignApproved: isCampaignApproved(
          filters.situation as NoticeSituation,
          filters.language as NoticeLanguage,
        ),
        situation: filters.situation,
        lastDateIso,
        lastDateLabel: filters.lastDate,
        today,
        recipientCount: audience.candidates.length,
        // Families the template cannot fill (a ₹0 amount, no promise date): the
        // manual Send counts these; the timer did not, so it could send them.
        noticeFactGaps: audience.candidates.filter((candidate) => candidate.missingFacts.length > 0)
          .length,
        ...facts,
      });
      // Nobody is here to override anything, so an OVERRIDABLE finding — the
      // budget cap, quiet hours, a holiday, the final-notice window — stops a
      // scheduled run exactly as a blocking one does. Only the blocking list
      // was read, and the rest were worked out and thrown away.
      const blocked = firstBlockingMessage(guards) ?? guards.overridable[0]?.message ?? null;
      if (blocked) {
        reports.push({
          campaignId: saved.id,
          campaignName: saved.name,
          scheduledFor: entry.scheduledFor,
          status: "skipped",
          reason: blocked,
          recipients: audience.candidates.length,
        });
        continue;
      }

      if (dryRun) {
        reports.push({
          campaignId: saved.id,
          campaignName: saved.name,
          scheduledFor: entry.scheduledFor,
          status: "would_send",
          recipients: audience.candidates.length,
        });
        continue;
      }

      const outcome = await executeReminderRun({
        supabase,
        candidates: audience.candidates,
        filters,
        sessionLabel,
        today,
        lastDateIso,
        campaignName: activeCampaignName(
          filters.situation as NoticeSituation,
          filters.language as NoticeLanguage,
        ),
        campaignId: saved.id,
        // Null, not the campaign's author. Attributing an automatic send to
        // whoever last edited the campaign would be a lie in the record.
        staffId: null,
        source: "cron",
        logContacts: insertDefaulterContacts,
        scheduledFor: entry.scheduledFor,
        // The same switch the manual path reads, so a scheduled run and a
        // pressed Send never disagree about what a two-child phone gets.
        oneMessagePerFamily: await oneMessagePerFamilyEnabled(supabase),
        // The same last look at the ledger a pressed Send gets.
        recheckLedger: await onlineLedgerRecheck(),
      });

      reports.push({
        campaignId: saved.id,
        campaignName: saved.name,
        scheduledFor: entry.scheduledFor,
        status: outcome.failed > 0 && outcome.sent === 0 ? "failed" : "sent",
        sent: outcome.sent,
        failed: outcome.failed,
        recipients: audience.candidates.length,
      });
    }

    logInfo("cron.whatsapp-scheduled-runs.finished", {
      today,
      dryRun,
      due: due.length,
      automatic: automatic.length,
      sent: reports.reduce((total, report) => total + (report.sent ?? 0), 0),
    });

    return NextResponse.json({
      ok: true,
      today,
      dryRun,
      // Everything due, so a reading of this endpoint also answers "what is
      // waiting for somebody to press Send".
      due: due.map((entry) => ({
        campaignId: entry.id,
        name: entry.name,
        scheduledFor: entry.scheduledFor,
        daysOverdue: entry.daysOverdue,
        auto: entry.auto,
      })),
      runs: reports,
    });
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : "Scheduled run failed.";
    logError("cron.whatsapp-scheduled-runs.failed", { error: message });
    return NextResponse.json({ ok: false, error: message, runs: reports }, { status: 500 });
  }
}
