import { CalendarClock, Check, CircleDashed, Clock, Send, TriangleAlert } from "lucide-react";

import { PageHeader } from "@/ui/shell/page-header";
import { OfficeNotice } from "@/ui/office/office-ui";
import { PendingSubmitButton } from "@/ui/shell/pending-submit-button";
import { SelectNative } from "@/ui/primitives/select-native";
import { createAdminClient } from "@/modules/fees/platform/supabase/admin";
import { hasStaffPermission, requireAnyStaffPermission } from "@/modules/fees/platform/session";
import { getFeePolicySummary } from "@/modules/fees/data/policy";
import { istToday } from "@/modules/whatsapp/domain/fee-reminders";
import { resolveReminderSessionLabel } from "@/modules/whatsapp/data/reminder-session";
import {
  listCampaigns,
  loadRanScheduleSlots,
  type SavedCampaign,
} from "@/modules/whatsapp/data/campaign-store";
import { buildInstallmentCalendar } from "@/modules/whatsapp/domain/installment-calendar";
import {
  messageDateFor,
  parseCampaignSchedule,
  SCHEDULED_SENDS_LIVE,
} from "@/modules/whatsapp/domain/campaign-schedule";
import { savedCampaignHref } from "@/modules/whatsapp/domain/campaign-links";
import {
  describeDailySteps,
  describeLadder,
  type DailyStepState,
  type LadderInstallment,
  type LadderStepState,
} from "@/modules/whatsapp/domain/reminder-ladder";
import { NOTICE_SITUATIONS, type NoticeSituation } from "@/modules/whatsapp/domain/campaigns";
import { REMINDER_PROFILES } from "@/modules/whatsapp/domain/reminder-profile";
import { RemindersNav } from "@/modules/whatsapp/ui/reminders-nav";
import { ProfileBadge } from "@/modules/whatsapp/ui/profile-badge";
import { daysBetweenIsoDates, formatDdMmYyyy } from "@/platform/helpers/date";
import { cn } from "@/platform/utils";
import {
  removeStepAction,
  setStepAutoAction,
  setUpDailyStepsAction,
  setUpInstallmentPlanAction,
} from "@/app/(app)/fees/reminders/ladder/actions";
import { NavLink } from "@/ui/shell/nav-link";

/**
 * The reminder plan — the same steps around every installment.
 *
 * One timeline per installment: ten days before, three days before, the day
 * after (late fee, waived if paid within ten days), the waiver's last day, a
 * final notice, and one more for chronic payers. Each step is an ordinary
 * saved campaign with a schedule, so the due-to-run card, the scheduled runner
 * and every send guard treat it exactly as they treat one built by hand. "Set
 * up" creates the missing ones; nothing is created by looking at this page.
 *
 * A SUB-PAGE, so a mobile takeover; bottom spacing is the safe area only.
 * Server-rendered forms and links throughout — no client JavaScript.
 */

export const revalidate = 0;

type PageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

function one(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value)?.trim() ?? "";
}

function noticeLabel(situation: NoticeSituation): string {
  return NOTICE_SITUATIONS.find((entry) => entry.value === situation)?.label ?? situation;
}

/** "Sat 10 Oct" — a step's day reads faster as a weekday than as digits. */
function dayLabel(iso: string | null): string {
  if (!iso) return "—";
  const date = new Date(`${iso}T00:00:00Z`);
  return date.toLocaleDateString("en-IN", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
}

function relative(iso: string | null, today: string): string {
  if (!iso) return "";
  const days = daysBetweenIsoDates(today, iso);
  if (days === null) return "";
  if (days === 0) return "today";
  if (days === 1) return "tomorrow";
  if (days === -1) return "yesterday";
  return days > 0 ? `in ${days} days` : `${-days} days ago`;
}

const STATUS: Record<
  LadderStepState["status"],
  { label: string; className: string; icon: typeof Check }
> = {
  sent: { label: "Sent", className: "bg-success-soft text-success-soft-foreground", icon: Check },
  due: { label: "Due now", className: "bg-warning-soft text-warning-soft-foreground", icon: Send },
  missed: { label: "Missed", className: "bg-destructive-soft text-destructive-soft-foreground", icon: TriangleAlert },
  upcoming: { label: "Coming up", className: "bg-info-soft text-info-soft-foreground", icon: Clock },
  not_set_up: { label: "Not set up", className: "bg-surface-2 text-muted-foreground", icon: CircleDashed },
};

function StatusPill({ status }: { status: LadderStepState["status"] }) {
  const entry = STATUS[status];
  const Icon = entry.icon;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-bold",
        entry.className,
      )}
    >
      <Icon className="size-3" aria-hidden="true" />
      {entry.label}
    </span>
  );
}

export default async function ReminderPlanPage({ searchParams }: PageProps) {
  const staff = await requireAnyStaffPermission(["settings:view", "settings:write"], {
    onDenied: "redirect",
  });
  const canEdit = hasStaffPermission(staff, "settings:write");
  const params = (await searchParams) ?? {};
  const done = one(params.done);
  const error = one(params.error);

  const supabase = createAdminClient();
  const sessionLabel = await resolveReminderSessionLabel(supabase);
  const today = istToday();
  const policy = await getFeePolicySummary({ useAdmin: true }).catch(() => null);
  const calendar = buildInstallmentCalendar({
    schedule: policy?.installmentSchedule ?? [],
    today,
  });

  let campaigns: SavedCampaign[] = [];
  let ranSlots = new Map<string, string[]>();
  let loadError: string | null = null;
  try {
    [campaigns, ranSlots] = await Promise.all([
      listCampaigns(supabase, sessionLabel),
      loadRanScheduleSlots(supabase, sessionLabel),
    ]);
  } catch (caught) {
    loadError = caught instanceof Error ? caught.message : "Could not read the saved campaigns.";
  }

  const inputs = campaigns.map((campaign) => ({
    id: campaign.id,
    name: campaign.name,
    schedule: campaign.schedule,
    ranForSlots: ranSlots.get(campaign.id) ?? [],
  }));
  const ladder = describeLadder(calendar, inputs, today);
  const daily = describeDailySteps(inputs, today);
  const byId = new Map(campaigns.map((campaign) => [campaign.id, campaign]));

  /** The send screen, opened on this step's campaign and the date it prints. */
  const openHref = (campaignId: string, runOn: string | null) => {
    const saved = byId.get(campaignId);
    if (!saved) return "/fees/reminders";
    const schedule = parseCampaignSchedule(saved.schedule);
    const messageDate = schedule && runOn ? messageDateFor(schedule, calendar, runOn) : null;
    return savedCampaignHref(saved, messageDate);
  };

  const current = ladder.filter((entry) => !entry.finished);
  const past = ladder.filter((entry) => entry.finished);
  const autoCount = campaigns.filter(
    (campaign) => parseCampaignSchedule(campaign.schedule)?.auto === true,
  ).length;

  return (
    <div
      className="flex flex-col gap-5"
      style={{ paddingBottom: "calc(var(--mobile-safe-area-bottom, 0px) + 0.75rem)" }}
    >
      <PageHeader
        eyebrow="Reminders"
        title="Reminder plan"
        description={`The same steps around every installment. Families drop off the moment they pay. Session ${sessionLabel}.`}
        mobileEyebrow={
          SCHEDULED_SENDS_LIVE
            ? `${autoCount} step${autoCount === 1 ? "" : "s"} send themselves`
            : "Due steps wait on the Send tab"
        }
      />
      <RemindersNav active="ladder" />

      {done ? (
        <OfficeNotice title="Done" tone="success">
          {done}
        </OfficeNotice>
      ) : null}
      {error ? (
        <OfficeNotice title="Not done" tone="danger">
          {error}
        </OfficeNotice>
      ) : null}
      {loadError ? (
        <OfficeNotice title="Could not load the plan" tone="danger">
          {loadError}
        </OfficeNotice>
      ) : null}

      <section className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4">
        <h2 className="flex items-center gap-2 text-sm font-bold text-foreground">
          <CalendarClock className="size-4" aria-hidden="true" />
          How the plan works
        </h2>
        <p className="text-[13px] leading-relaxed text-muted-foreground">
          Each step reaches only the profiles shown on it, so an on-time family hears twice and a
          chronic family hears every step.{" "}
          {SCHEDULED_SENDS_LIVE ? (
            <>
              A step marked <strong>Sends itself</strong> goes out at 9:30 every morning it is
              due, under the same checks as pressing Send — quiet hours, the holiday list and the
              monthly budget. Every other step waits on the Fee reminders screen for somebody to
              press Send.
            </>
          ) : (
            <>
              The 9:30 timer is off, so nothing here sends by itself: when a step is due it appears
              at the top of the Send tab, and it goes when somebody presses Send.
            </>
          )}{" "}
          The late fee is waived at the counter, by hand, as always.
        </p>
        <div className="flex flex-wrap gap-1.5">
          {REMINDER_PROFILES.map((entry) => (
            <span key={entry.value} title={entry.hint}>
              <ProfileBadge profile={entry.value} />
            </span>
          ))}
          <NavLink
            href="/fees/reminders/families"
            className="tap focus-ring ml-1 rounded text-[12px] font-semibold text-accent underline-offset-2 hover:underline"
          >
            See who is in each profile
          </NavLink>
        </div>
      </section>

      <DailySection daily={daily} canEdit={canEdit} openHref={openHref} today={today} />

      {calendar.timings.length === 0 ? (
        <OfficeNotice title="No installment dates yet" tone="warning">
          This session&rsquo;s fee policy has no installment schedule, so there is nothing to plan
          around. Set the due dates in Fee Setup.
        </OfficeNotice>
      ) : null}

      {current.map((installment) => (
        <InstallmentSection
          key={installment.installmentNo}
          installment={installment}
          canEdit={canEdit}
          openHref={openHref}
          today={today}
        />
      ))}

      {past.length > 0 ? (
        <details className="rounded-xl border border-border bg-card p-4">
          <summary className="focus-ring flex min-h-11 cursor-pointer list-none items-center justify-between rounded-lg text-sm font-bold md:min-h-0">
            Installments already finished ({past.length})
            <span className="text-xs font-semibold text-muted-foreground">Tap to see what went out</span>
          </summary>
          <div className="mt-3 flex flex-col gap-4">
            {past.map((installment) => (
              <InstallmentSection
                key={installment.installmentNo}
                installment={installment}
                canEdit={canEdit}
                openHref={openHref}
                today={today}
                compact
              />
            ))}
          </div>
        </details>
      ) : null}
    </div>
  );
}

function LanguagePicker() {
  return (
    <label className="flex items-center gap-2 text-[12px] font-semibold text-muted-foreground">
      Language
      <SelectNative name="language" defaultValue="hi" className="h-11 w-28 text-sm md:h-9">
        <option value="hi">Hindi</option>
        <option value="en">English</option>
      </SelectNative>
    </label>
  );
}

function AutoCheckbox() {
  return (
    <label className="flex min-h-11 items-center gap-2 text-[12.5px] font-semibold md:min-h-0">
      <input type="checkbox" name="auto" className="size-4 rounded border-border-strong accent-accent" />
      Let these send themselves at 9:30
    </label>
  );
}

function StepActions({
  campaign,
  canEdit,
  href,
}: {
  campaign: { id: string; auto: boolean };
  canEdit: boolean;
  href: string;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <NavLink
        href={href}
        prefetch={false}
        className="tap focus-ring inline-flex min-h-11 items-center rounded-lg border border-border px-3 text-[12px] font-semibold hover:border-border-strong md:min-h-8"
      >
        Open
      </NavLink>
      {canEdit ? (
        <>
          {/* "Send itself" only while the timer runs; "Stop auto" always, so a
              step marked earlier can still be put back to waiting. */}
          {SCHEDULED_SENDS_LIVE || campaign.auto ? (
          <form action={setStepAutoAction}>
            <input type="hidden" name="campaignId" value={campaign.id} />
            {campaign.auto ? null : <input type="hidden" name="auto" value="on" />}
            <PendingSubmitButton
              variant="ghost"
              size="sm"
              className="min-h-11 px-2.5 text-[12px] md:min-h-8"
              pendingLabel="Saving…"
            >
              {campaign.auto ? "Stop auto" : "Send itself"}
            </PendingSubmitButton>
          </form>
          ) : null}
          <form action={removeStepAction}>
            <input type="hidden" name="campaignId" value={campaign.id} />
            <PendingSubmitButton
              variant="ghost"
              size="sm"
              className="min-h-11 px-2.5 text-[12px] text-muted-foreground md:min-h-8"
              pendingLabel="Removing…"
            >
              Remove
            </PendingSubmitButton>
          </form>
        </>
      ) : null}
    </div>
  );
}

function InstallmentSection({
  installment,
  canEdit,
  openHref,
  today,
  compact = false,
}: {
  installment: LadderInstallment;
  canEdit: boolean;
  openHref: (campaignId: string, runOn: string | null) => string;
  today: string;
  compact?: boolean;
}) {
  const missing = installment.steps.length - installment.setUp;
  const dueNow = installment.steps.filter((step) => step.status === "due").length;

  return (
    <section
      className={cn("flex flex-col gap-3", !compact && "rounded-xl border border-border bg-card p-4")}
      aria-labelledby={`inst-${installment.installmentNo}`}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h2 id={`inst-${installment.installmentNo}`} className="text-base font-extrabold text-foreground">
          Installment {installment.installmentNo}
          <span className="ml-2 text-sm font-semibold text-muted-foreground">
            due {formatDdMmYyyy(installment.dueDate)} · {relative(installment.dueDate, today)}
          </span>
        </h2>
        <p className="text-[12px] text-muted-foreground">
          {installment.setUp} of {installment.steps.length} steps set up
          {dueNow > 0 ? ` · ${dueNow} due now` : ""}
        </p>
      </div>

      {/* A vertical rail on a phone, six columns at the desk. An ordered list
          either way: the steps ARE a sequence. */}
      <ol className="relative grid grid-cols-1 gap-2 border-l-2 border-border pl-4 md:grid-cols-6 md:border-l-0 md:pl-0">
        {installment.steps.map((entry) => (
          <li
            key={entry.step.key}
            className={cn(
              "relative flex flex-col gap-1.5 rounded-xl border p-3",
              entry.status === "due"
                ? "border-warning/60 bg-warning-soft/40"
                : entry.status === "not_set_up"
                  ? "border-dashed border-border bg-surface-2"
                  : "border-border bg-background",
            )}
          >
            <span
              aria-hidden="true"
              className="absolute -left-[1.4rem] top-4 size-3 rounded-full border-2 border-background bg-border-strong md:hidden"
            />
            <div className="flex items-center justify-between gap-2">
              <span className="text-[12px] font-extrabold tabular-nums text-foreground">
                {dayLabel(entry.runOn)}
              </span>
              <StatusPill status={entry.status} />
            </div>
            <p className="text-[11px] text-muted-foreground">{relative(entry.runOn, today)}</p>
            <p className="text-[13px] font-bold leading-tight text-foreground">{entry.step.label}</p>
            <p className="text-[11.5px] leading-snug text-muted-foreground">
              {noticeLabel(entry.step.situation)}
              {entry.messageDate && entry.step.messageDateOffsetDays !== 0
                ? ` · pay by ${formatDdMmYyyy(entry.messageDate)}`
                : ""}
            </p>
            <div className="flex flex-wrap gap-1">
              {entry.step.profiles.map((profile) => (
                <ProfileBadge key={profile} profile={profile} className="text-[10px]" />
              ))}
            </div>
            {entry.campaign ? (
              <>
                {entry.campaign.auto ? (
                  <span className="w-fit rounded-full border border-warning/40 bg-warning/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-warning-foreground">
                    {SCHEDULED_SENDS_LIVE ? "Sends itself" : "Auto · timer off"}
                  </span>
                ) : null}
                <StepActions
                  campaign={entry.campaign}
                  canEdit={canEdit}
                  href={openHref(entry.campaign.id, entry.runOn)}
                />
              </>
            ) : null}
          </li>
        ))}
      </ol>

      {canEdit && missing > 0 && !installment.finished ? (
        <form
          action={setUpInstallmentPlanAction}
          className="flex flex-wrap items-center gap-3 rounded-lg border border-dashed border-accent/40 bg-accent/[0.04] p-3"
        >
          <input type="hidden" name="installment" value={installment.installmentNo} />
          <LanguagePicker />
          {SCHEDULED_SENDS_LIVE ? <AutoCheckbox /> : null}
          <PendingSubmitButton className="h-11 px-5 md:h-9" pendingLabel="Setting up…">
            Set up {missing} missing step{missing === 1 ? "" : "s"}
          </PendingSubmitButton>
        </form>
      ) : null}
    </section>
  );
}

function DailySection({
  daily,
  canEdit,
  openHref,
  today,
}: {
  daily: DailyStepState[];
  canEdit: boolean;
  openHref: (campaignId: string, runOn: string | null) => string;
  today: string;
}) {
  const missing = daily.filter((entry) => !entry.campaign).length;
  return (
    <section className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4" aria-labelledby="daily-steps">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h2 id="daily-steps" className="text-base font-extrabold text-foreground">
          Every morning
        </h2>
        <p className="text-[12px] text-muted-foreground">Families&rsquo; own promised dates, from the call log</p>
      </div>
      <ul className="grid grid-cols-1 gap-2 md:grid-cols-2">
        {daily.map((entry) => (
          <li
            key={entry.step.key}
            className={cn(
              "flex flex-col gap-1.5 rounded-xl border p-3",
              entry.campaign ? "border-border bg-background" : "border-dashed border-border bg-surface-2",
            )}
          >
            <div className="flex items-center justify-between gap-2">
              <p className="text-[13px] font-bold text-foreground">{entry.step.label}</p>
              <StatusPill status={entry.status === "sent" ? "sent" : entry.campaign ? "due" : "not_set_up"} />
            </div>
            <p className="text-[11.5px] leading-snug text-muted-foreground">{entry.step.hint}</p>
            <div className="flex flex-wrap gap-1">
              {entry.step.profiles.map((profile) => (
                <ProfileBadge key={profile} profile={profile} className="text-[10px]" />
              ))}
            </div>
            {entry.campaign ? (
              <>
                {entry.campaign.auto ? (
                  <span className="w-fit rounded-full border border-warning/40 bg-warning/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-warning-foreground">
                    {SCHEDULED_SENDS_LIVE ? "Sends itself" : "Auto · timer off"}
                  </span>
                ) : null}
                <StepActions campaign={entry.campaign} canEdit={canEdit} href={openHref(entry.campaign.id, today)} />
              </>
            ) : null}
          </li>
        ))}
      </ul>
      {canEdit && missing > 0 ? (
        <form
          action={setUpDailyStepsAction}
          className="flex flex-wrap items-center gap-3 rounded-lg border border-dashed border-accent/40 bg-accent/[0.04] p-3"
        >
          <LanguagePicker />
          {SCHEDULED_SENDS_LIVE ? <AutoCheckbox /> : null}
          <PendingSubmitButton className="h-11 px-5 md:h-9" pendingLabel="Setting up…">
            Set up {missing} every-morning step{missing === 1 ? "" : "s"}
          </PendingSubmitButton>
        </form>
      ) : null}
    </section>
  );
}
