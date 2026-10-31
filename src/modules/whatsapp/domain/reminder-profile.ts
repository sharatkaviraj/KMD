/**
 * How hard the school chases one family, as a word the office can say out loud.
 *
 * Cadence answers "how often" and was the only per-family judgement the screen
 * could record. It could not say "this family pays on time — one polite note
 * before the date is plenty" or "this family needs every step of the ladder",
 * so the office kept unticking the same rows by hand. A profile is that
 * judgement, stored once:
 *
 * | Profile  | Who                                                   |
 * |----------|-------------------------------------------------------|
 * | on_time  | Settled every passed installment without a late fee   |
 * | standard | Everyone else, and the default                        |
 * | chronic  | Late on two or more installments                      |
 * | hardship | On a repayment plan — gentle wording only             |
 * | quiet    | No fee messages at all — set by hand, never suggested |
 *
 * **A profile is an AUDIENCE filter, never a property of the template.** The
 * module README forbids a situation branch in `loadReminderAudience`, because
 * that is how the message and the list grew back into one thing. So nothing
 * here says "chronic families get the final notice". The office (or a ladder
 * step it saved) picks which profiles a run goes to under Narrow down, exactly
 * like the class, and the list is built from that.
 *
 * An unset profile is not "standard". It is the SUGGESTION, worked out from the
 * ledger on every load, so a family who starts paying late moves on their own
 * and nobody has to remember to re-file them. Setting one by hand fixes it.
 *
 * Browser-safe: no `server-only`, no Supabase. The audience builder, the
 * families screen and the send list all read the labels.
 */

export type ReminderProfile = "on_time" | "standard" | "chronic" | "hardship" | "quiet";

/** Matches the tonal `Badge` variants, so a pill needs no colour of its own. */
export type ReminderProfileTone = "success" | "info" | "danger" | "accent" | "neutral";

export const REMINDER_PROFILES = [
  {
    value: "on_time",
    label: "On-time",
    hint: "Pays on time. One reminder before the date is enough.",
    tone: "success",
  },
  {
    value: "standard",
    label: "Standard",
    hint: "The usual reminders before and after the date.",
    tone: "info",
  },
  {
    value: "chronic",
    label: "Chronic",
    hint: "Often late. Gets every step, and a call when they read but do not pay.",
    tone: "danger",
  },
  {
    value: "hardship",
    label: "Hardship",
    hint: "On a plan or going through a hard time. Gentle reminders only.",
    tone: "accent",
  },
  {
    value: "quiet",
    label: "Quiet",
    hint: "No fee messages. School notices still reach them.",
    tone: "neutral",
  },
] as const satisfies ReadonlyArray<{
  value: ReminderProfile;
  label: string;
  hint: string;
  tone: ReminderProfileTone;
}>;

/** Every profile value, in screen order. */
export const REMINDER_PROFILE_VALUES: readonly ReminderProfile[] = REMINDER_PROFILES.map(
  (entry) => entry.value,
);

/**
 * Who a fee run reaches when nobody has said otherwise.
 *
 * Hardship and quiet are left OUT by default. That is the point of both: a
 * family on a repayment plan should not be sent a final notice because the
 * office forgot to untick them, and quiet means quiet. Either can be ticked
 * back in for one run, and a family held out this way is counted on the screen
 * rather than silently missing.
 */
export const DEFAULT_PROFILE_SELECTION: readonly ReminderProfile[] = [
  "on_time",
  "standard",
  "chronic",
];

export function isReminderProfile(value: unknown): value is ReminderProfile {
  return typeof value === "string" && (REMINDER_PROFILE_VALUES as readonly string[]).includes(value);
}

export function profileLabel(profile: ReminderProfile): string {
  return REMINDER_PROFILES.find((entry) => entry.value === profile)?.label ?? profile;
}

export function profileTone(profile: ReminderProfile): ReminderProfileTone {
  return REMINDER_PROFILES.find((entry) => entry.value === profile)?.tone ?? "neutral";
}

/**
 * Read the `profiles` query value, a posted form value or a saved campaign's
 * array.
 *
 * Absent, blank or garbage returns null so the caller opens on the default —
 * garbage must never be read as "nobody". An explicit list keeps screen order
 * and drops duplicates.
 */
export function parseProfileSelection(raw: unknown): ReminderProfile[] | null {
  if (raw === null || raw === undefined) return null;
  const tokens = Array.isArray(raw)
    ? raw.map(String)
    : String(raw)
        .split(",")
        .map((token) => token.trim());
  const picked = new Set(tokens.filter(isReminderProfile));
  if (picked.size === 0) return null;
  return REMINDER_PROFILE_VALUES.filter((value) => picked.has(value));
}

/** The `profiles` value `parseProfileSelection` reads back to the same list. */
export function profileSelectionValue(profiles: readonly ReminderProfile[]): string {
  return REMINDER_PROFILE_VALUES.filter((value) => profiles.includes(value)).join(",");
}

/** True when the selection is exactly the default, in any order. */
export function isDefaultProfileSelection(profiles: readonly ReminderProfile[]): boolean {
  return (
    profiles.length === DEFAULT_PROFILE_SELECTION.length &&
    DEFAULT_PROFILE_SELECTION.every((value) => profiles.includes(value))
  );
}

/**
 * What the ledger says about how this family has paid, for the suggestion.
 *
 * Counted over installments whose due date has PASSED (strictly — the row due
 * today is not late yet), so a family at the start of the year with nothing due
 * has no history and is suggested `standard`, not `on_time`.
 */
export type PaymentHistoryFacts = {
  /** Installments whose due date is strictly before today. */
  passedInstallments: number;
  /**
   * Passed installments the ledger ever charged a late fee on — still owed,
   * paid, or waived. A waived late fee still means the money came in late; the
   * waiver forgave the charge, not the lateness.
   */
  lateFeeInstallments: number[];
  /** Passed installments with FEES still pending today. */
  overdueInstallments: number[];
  /** An active repayment plan on file. */
  onRepaymentPlan: boolean;
};

export type ProfileSuggestion = {
  profile: ReminderProfile;
  /** Why, in the office's own terms. Shown beside the suggestion. */
  reason: string;
};

function listInstallments(installments: readonly number[]): string {
  const sorted = [...new Set(installments)].sort((a, b) => a - b);
  if (sorted.length <= 1) return `installment ${sorted[0] ?? "—"}`;
  return `installments ${sorted.slice(0, -1).join(", ")} and ${sorted[sorted.length - 1]}`;
}

/**
 * The profile the ledger would put this family in.
 *
 * Order matters: a plan wins (the office already agreed terms with them), then
 * two or more late installments, then a clean record. `quiet` is never
 * suggested — it is a decision about a family, not a fact about their money.
 */
export function suggestReminderProfile(facts: PaymentHistoryFacts): ProfileSuggestion {
  if (facts.onRepaymentPlan) {
    return { profile: "hardship", reason: "On a repayment plan" };
  }

  const lateOrOwing = [...new Set([...facts.lateFeeInstallments, ...facts.overdueInstallments])];
  if (lateOrOwing.length >= 2) {
    return {
      profile: "chronic",
      reason: `Late on ${listInstallments(lateOrOwing)}`,
    };
  }

  if (
    facts.passedInstallments > 0 &&
    facts.lateFeeInstallments.length === 0 &&
    facts.overdueInstallments.length === 0
  ) {
    return {
      profile: "on_time",
      reason:
        facts.passedInstallments === 1
          ? "Paid installment 1 on time"
          : `Paid all ${facts.passedInstallments} installments so far on time`,
    };
  }

  if (lateOrOwing.length === 1) {
    return { profile: "standard", reason: `Late on ${listInstallments(lateOrOwing)}` };
  }
  return { profile: "standard", reason: "Nothing due yet to judge by" };
}

export type EffectiveProfile = {
  profile: ReminderProfile;
  /** `set` when the office chose it, `suggested` when the ledger did. */
  source: "set" | "suggested";
  reason: string;
};

/**
 * The profile a family is actually treated as: the office's choice when there
 * is one, the suggestion otherwise.
 */
export function effectiveProfile(
  explicit: ReminderProfile | null | undefined,
  suggestion: ProfileSuggestion,
): EffectiveProfile {
  if (explicit) {
    return {
      profile: explicit,
      source: "set",
      reason:
        explicit === suggestion.profile
          ? `Set by the office · ${suggestion.reason.toLowerCase()}`
          : `Set by the office (the ledger suggests ${profileLabel(suggestion.profile)})`,
    };
  }
  return { profile: suggestion.profile, source: "suggested", reason: suggestion.reason };
}
