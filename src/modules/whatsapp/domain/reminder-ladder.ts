import type { NoticeLanguage, NoticeSituation } from "@/modules/whatsapp/domain/campaigns";
import type { LateFeeSource } from "@/modules/whatsapp/domain/late-fee";
import type { SavedAudience, Tri } from "@/modules/whatsapp/domain/audience";
import { DEFAULT_AUDIENCE_FILTERS } from "@/modules/whatsapp/domain/audience";
import type { ReminderProfile } from "@/modules/whatsapp/domain/reminder-profile";
import type { InstallmentCalendar } from "@/modules/whatsapp/domain/installment-calendar";
import {
  OVERDUE_SLOT_WINDOW_DAYS,
  parseCampaignSchedule,
  type CampaignSchedule,
} from "@/modules/whatsapp/domain/campaign-schedule";
import { addIsoDays, daysBetweenIsoDates } from "@/platform/helpers/date";

/**
 * The reminder plan: the same few steps, around every installment.
 *
 * "Send the T-10 reminder for installment 3, then the final call, then the
 * waiver note the day after" used to be six saved campaigns somebody had to
 * remember to create, each with a date typed by hand. This is that sequence
 * written down once. The plan screen shows it per installment as a timeline,
 * and "Set up" turns the missing steps into ordinary saved campaigns with a
 * schedule — the existing runner and the existing guards then do the rest.
 *
 * Who each step reaches is a PROFILE choice, because that is what profiles are
 * for: an on-time family hears once before the date and once on the waiver's
 * last day; a chronic family hears every step and one more after the final
 * notice. Nothing here gives a template an audience of its own — the steps are
 * saved audiences, exactly what the office could build by hand.
 *
 * Pure. No clock, no Supabase.
 */

export type LadderStepKey =
  | "due_soon"
  | "final_call"
  | "waiver"
  | "waiver_last_day"
  | "final_notice"
  | "chronic_follow_up";

export type LadderStep = {
  key: LadderStepKey;
  /** What the office calls it. Also the campaign's name, after the installment. */
  label: string;
  /** One line: what it does and who it reaches. */
  hint: string;
  /** When it runs, in days from the installment's due date. */
  offsetDays: number;
  situation: NoticeSituation;
  profiles: readonly ReminderProfile[];
  /**
   * The date the message prints, in days from the due date: the last date
   * itself before it, the waiver's end after it.
   */
  messageDateOffsetDays: number;
  /** Only families the ledger is charging a late fee on — the waiver notices. */
  lateFee: Tri;
  /** A courtesy note is the wrong message for a family already late on an earlier installment. */
  skipOverdue: boolean;
  lateFeeSource: LateFeeSource;
};

/**
 * How long the waiver holds after the due date. The office honours it at the
 * counter by pressing Waive, as it already does — nothing automatic touches
 * money. Ten days is what the first waiver run used.
 */
export const WAIVER_WINDOW_DAYS = 10;

export const LADDER_STEPS: readonly LadderStep[] = [
  {
    key: "due_soon",
    label: "Due soon",
    hint: "Ten days before. Standard and chronic families.",
    offsetDays: -10,
    situation: "upcoming",
    profiles: ["standard", "chronic"],
    messageDateOffsetDays: 0,
    lateFee: "any",
    skipOverdue: true,
    lateFeeSource: "ledger",
  },
  {
    key: "final_call",
    label: "Last few days",
    hint: "Three days before. Everyone, on-time families included.",
    offsetDays: -3,
    situation: "upcoming_final",
    profiles: ["on_time", "standard", "chronic"],
    messageDateOffsetDays: 0,
    lateFee: "any",
    skipOverdue: true,
    lateFeeSource: "ledger",
  },
  {
    key: "waiver",
    label: "Late fee, waived if paid",
    hint: `The day after. The late fee is set aside if they pay within ${WAIVER_WINDOW_DAYS} days.`,
    offsetDays: 1,
    situation: "late_fee_waiver",
    profiles: ["standard", "chronic"],
    messageDateOffsetDays: WAIVER_WINDOW_DAYS,
    lateFee: "yes",
    skipOverdue: false,
    lateFeeSource: "ledger",
  },
  {
    key: "waiver_last_day",
    label: "Waiver last day",
    hint: "The waiver's final day. Everyone still owing.",
    offsetDays: WAIVER_WINDOW_DAYS - 1,
    situation: "waiver_last_call",
    profiles: ["on_time", "standard", "chronic"],
    messageDateOffsetDays: WAIVER_WINDOW_DAYS,
    lateFee: "yes",
    skipOverdue: false,
    lateFeeSource: "ledger",
  },
  {
    key: "final_notice",
    label: "Final notice",
    hint: "Twelve days after. Standard and chronic families still owing.",
    offsetDays: 12,
    situation: "overdue_final",
    profiles: ["standard", "chronic"],
    messageDateOffsetDays: 20,
    lateFee: "any",
    skipOverdue: false,
    lateFeeSource: "ledger",
  },
  {
    key: "chronic_follow_up",
    label: "Chronic follow-up",
    hint: "Sixteen days after. Chronic families only, then a phone call.",
    offsetDays: 16,
    situation: "overdue_final",
    profiles: ["chronic"],
    messageDateOffsetDays: 20,
    lateFee: "any",
    skipOverdue: false,
    lateFeeSource: "ledger",
  },
];

/**
 * The two notices that are not about an installment but about a family's own
 * word: a promise falling due today or tomorrow, and a promise that has passed.
 * They run every morning, because whose promise is due changes daily — the
 * audience is rebuilt from the contact log each time.
 */
export type DailyStepKey = "promise_due_daily" | "promise_lapsed_daily";

export type DailyStep = {
  key: DailyStepKey;
  label: string;
  hint: string;
  situation: NoticeSituation;
  promise: "due_soon" | "lapsed";
  profiles: readonly ReminderProfile[];
  /** The "new date" a lapsed-promise notice asks for, in days from the run. */
  messageDateOffsetDays: number | null;
};

export const DAILY_STEPS: readonly DailyStep[] = [
  {
    key: "promise_due_daily",
    label: "Promise due",
    hint: "Every morning, to families whose promised date is today or tomorrow.",
    situation: "promise_due",
    promise: "due_soon",
    // Hardship included: a gentle reminder of the family's own date is exactly
    // the message that profile is for.
    profiles: ["on_time", "standard", "chronic", "hardship"],
    messageDateOffsetDays: null,
  },
  {
    key: "promise_lapsed_daily",
    label: "Promise missed",
    hint: "Every morning, to families whose promised date has passed. Asks for a new date three days out.",
    situation: "promise_lapsed",
    promise: "lapsed",
    profiles: ["standard", "chronic", "hardship"],
    messageDateOffsetDays: 3,
  },
];

export function dailyStepFor(key: string | undefined): DailyStep | null {
  return DAILY_STEPS.find((step) => step.key === key) ?? null;
}

export function dailyCampaignName(step: DailyStep): string {
  return `Every morning · ${step.label}`;
}

/**
 * A daily step as a saved campaign. No installments are stored, so every run
 * opens on the calendar's own default — the money that is overdue that day —
 * rather than on whatever was overdue the day it was set up.
 */
export function dailyCampaignDraft(args: {
  step: DailyStep;
  language: NoticeLanguage;
  policyLateFeeAmount: number;
  auto: boolean;
}): LadderCampaignDraft {
  const { step } = args;
  return {
    name: dailyCampaignName(step),
    situation: step.situation,
    language: args.language,
    filters: {
      installments: [],
      lastYear: false,
      installmentMatch: "any",
      paid: DEFAULT_AUDIENCE_FILTERS.paid,
      minDueAmount: DEFAULT_AUDIENCE_FILTERS.minDueAmount,
      lateFee: "any",
      promise: step.promise,
      skipOverdue: false,
      classId: null,
      includeRte: false,
      profiles: [...step.profiles],
    },
    lastDate: null,
    lateFeeAmount: args.policyLateFeeAmount,
    lateFeeBasis: "per_installment",
    lateFeeSource: "ledger",
    schedule: {
      everyDay: true,
      auto: args.auto,
      ladderStep: step.key,
      ...(step.messageDateOffsetDays === null
        ? {}
        : { messageDateOffsetDays: step.messageDateOffsetDays }),
    },
  };
}

export type DailyStepState = {
  step: DailyStep;
  status: "sent" | "due" | "not_set_up";
  campaign: { id: string; name: string; auto: boolean } | null;
};

/** Has today's run gone out yet, for each every-morning step. */
export function describeDailySteps(
  campaigns: readonly LadderCampaignInput[],
  today: string,
): DailyStepState[] {
  return DAILY_STEPS.map((step) => {
    const found = campaigns.find((campaign) => {
      const schedule = parseCampaignSchedule(campaign.schedule);
      return schedule?.everyDay === true && schedule.ladderStep === step.key;
    });
    if (!found) return { step, status: "not_set_up", campaign: null };
    const schedule = parseCampaignSchedule(found.schedule);
    return {
      step,
      status: found.ranForSlots.includes(today) ? "sent" : "due",
      campaign: { id: found.id, name: found.name, auto: schedule?.auto === true },
    };
  });
}

export function ladderStepFor(key: string | undefined): LadderStep | null {
  return LADDER_STEPS.find((step) => step.key === key) ?? null;
}

/** "Inst 3 · Due soon" — the saved campaign's name. Unique per session by construction. */
export function ladderCampaignName(installment: number, step: LadderStep): string {
  return `Inst ${installment} · ${step.label}`;
}

/** Everything a saved campaign needs to BE this step, for one installment. */
export type LadderCampaignDraft = {
  name: string;
  situation: NoticeSituation;
  language: NoticeLanguage;
  filters: SavedAudience;
  /** ISO, so Postgres can hold it; the schedule's offset keeps it current. */
  lastDate: string | null;
  lateFeeAmount: number;
  lateFeeBasis: "per_installment";
  lateFeeSource: LateFeeSource;
  schedule: CampaignSchedule;
};

export function ladderCampaignDraft(args: {
  installment: number;
  step: LadderStep;
  calendar: InstallmentCalendar;
  language: NoticeLanguage;
  /** The school's late fee, for the fallback amount a custom switch would start from. */
  policyLateFeeAmount: number;
  auto: boolean;
}): LadderCampaignDraft {
  const { installment, step, calendar } = args;
  const dueDate =
    calendar.timings.find((timing) => timing.installmentNo === installment)?.dueDate ?? null;
  return {
    name: ladderCampaignName(installment, step),
    situation: step.situation,
    language: args.language,
    // Every key of a SAVED audience and nothing else — never a hand-picked
    // student, which a standing rule would message every time it replays.
    filters: {
      installments: [installment],
      lastYear: false,
      installmentMatch: DEFAULT_AUDIENCE_FILTERS.installmentMatch,
      paid: DEFAULT_AUDIENCE_FILTERS.paid,
      minDueAmount: DEFAULT_AUDIENCE_FILTERS.minDueAmount,
      lateFee: step.lateFee,
      promise: DEFAULT_AUDIENCE_FILTERS.promise,
      skipOverdue: step.skipOverdue,
      classId: null,
      includeRte: false,
      profiles: [...step.profiles],
    },
    lastDate: dueDate ? addIsoDays(dueDate, step.messageDateOffsetDays) : null,
    lateFeeAmount: args.policyLateFeeAmount,
    lateFeeBasis: "per_installment",
    lateFeeSource: step.lateFeeSource,
    schedule: {
      installment,
      offsetDays: step.offsetDays,
      auto: args.auto,
      messageDateOffsetDays: step.messageDateOffsetDays,
      ladderStep: step.key,
    },
  };
}

export type LadderCampaignInput = {
  id: string;
  name: string;
  schedule: unknown;
  /** The `scheduled_for` dates this campaign has already run for. */
  ranForSlots: readonly string[];
};

export type LadderStepStatus = "sent" | "due" | "upcoming" | "missed" | "not_set_up";

export type LadderStepState = {
  step: LadderStep;
  /** The day it runs, `YYYY-MM-DD`; null when the installment has no due date. */
  runOn: string | null;
  /** The date the message prints. */
  messageDate: string | null;
  status: LadderStepStatus;
  campaign: { id: string; name: string; auto: boolean } | null;
};

export type LadderInstallment = {
  installmentNo: number;
  dueDate: string;
  steps: LadderStepState[];
  /** How many steps have a campaign behind them. */
  setUp: number;
  /** True once every step's day has gone. */
  finished: boolean;
};

/**
 * What the plan looks like today, installment by installment.
 *
 * A step is `sent` when its campaign has a run for that slot, `due` inside the
 * same seven-day window the due-today card uses, `missed` past it, and
 * `upcoming` before its day. `not_set_up` is a step with no campaign — the plan
 * does not invent one; "Set up" does, and only when asked.
 */
export function describeLadder(
  calendar: InstallmentCalendar,
  campaigns: readonly LadderCampaignInput[],
  today: string,
): LadderInstallment[] {
  const byStep = new Map<string, { input: LadderCampaignInput; schedule: CampaignSchedule }>();
  for (const campaign of campaigns) {
    const schedule = parseCampaignSchedule(campaign.schedule);
    if (!schedule?.ladderStep || !schedule.installment) continue;
    byStep.set(`${schedule.installment}:${schedule.ladderStep}`, { input: campaign, schedule });
  }

  return calendar.timings.map((timing) => {
    const steps = LADDER_STEPS.map((step): LadderStepState => {
      const runOn = addIsoDays(timing.dueDate, step.offsetDays);
      const messageDate = addIsoDays(timing.dueDate, step.messageDateOffsetDays);
      const found = byStep.get(`${timing.installmentNo}:${step.key}`);
      if (!found) {
        return { step, runOn, messageDate, status: "not_set_up", campaign: null };
      }
      const campaign = {
        id: found.input.id,
        name: found.input.name,
        auto: found.schedule.auto === true,
      };
      if (runOn && found.input.ranForSlots.includes(runOn)) {
        return { step, runOn, messageDate, status: "sent", campaign };
      }
      const late = runOn ? daysBetweenIsoDates(runOn, today) : null;
      const status: LadderStepStatus =
        late === null || late < 0 ? "upcoming" : late <= OVERDUE_SLOT_WINDOW_DAYS ? "due" : "missed";
      return { step, runOn, messageDate, status, campaign };
    });
    const lastRun = steps[steps.length - 1]?.runOn ?? timing.dueDate;
    return {
      installmentNo: timing.installmentNo,
      dueDate: timing.dueDate,
      steps,
      setUp: steps.filter((entry) => entry.campaign).length,
      finished: lastRun < today,
    };
  });
}
