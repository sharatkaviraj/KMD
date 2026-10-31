import { t, type Localized } from "@/platform/i18n/language";

/**
 * The health pack (go-live Phase G, plan §9.1, critique1 B9): what counts as
 * a problem, decided once.
 *
 * The database answers `vppsone.ops_health_counts()` with counts only — never
 * a row, a name or a phone — and this file says which of those numbers needs
 * a person. It is read by the `health` job (which queues an `ops_alert` staff
 * WhatsApp to every real admin) and by `scripts/migrate/health.mjs` (which
 * prints the same verdict in a terminal), so the two cannot disagree.
 *
 * **A count that could not be read is a finding, never a zero.** The database
 * function returns JSON null for a count it could not read (pg_cron missing,
 * a table renamed); reporting that as "0 failures" is how a monitor goes
 * quiet exactly when it is broken.
 *
 * Pure: no database, no clock (the counts carry their own `at`).
 */

/** The fee reminders' monthly cap when `app_settings.whatsapp_month_message_cap` is unset (whatsapp-settings.ts). */
export const PARENT_REMINDER_CAP_DEFAULT = 4000;
/** School notices' monthly budget (`SCHOOL_NOTICE_MONTHLY_BUDGET`, school-notices.ts). */
export const SCHOOL_NOTICE_BUDGET = 3000;
/** Usage at or above this share of a cap is worth telling someone about before the 1st. */
export const USAGE_WARN_SHARE = 0.8;
/** The Drive backup runs nightly at 03:30 IST; past this many hours a night was missed. */
export const DRIVE_BACKUP_MAX_HOURS = 30;

export type HealthStatus = "ok" | "problem" | "unreadable";

export type HealthFinding = {
  key: string;
  label: Localized;
  status: HealthStatus;
  /** The number the verdict is about (a count, a usage, hours); null when unreadable. */
  value: number | null;
  /** Extra words, already in both languages (the cap, the job names). */
  detail?: Localized;
};

export type HealthResult = {
  findings: HealthFinding[];
  problems: HealthFinding[];
  unreadable: HealthFinding[];
};

type Counts = Record<string, unknown>;

/** A count, or null when the database could not read it (JSON null, absent, or not a number). */
export function countOf(counts: Counts, key: string): number | null {
  const value = counts?.[key];
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && /^-?\d+$/.test(value.trim())) return Number(value.trim());
  return null;
}

type Check = {
  key: string;
  label: Localized;
  evaluate: (counts: Counts) => Omit<HealthFinding, "key" | "label">;
};

/** Anything above zero is a problem: an open item, or a failure in the window. */
const anyIs = (key: string, label: Localized, detail?: (counts: Counts) => Localized | undefined): Check => ({
  key,
  label,
  evaluate: (counts) => {
    const value = countOf(counts, key);
    if (value === null) return { status: "unreadable", value: null };
    return { status: value > 0 ? "problem" : "ok", value, detail: value > 0 ? detail?.(counts) : undefined };
  },
});

/** This month's sends against a cap: a problem from USAGE_WARN_SHARE of it. */
const usage = (key: string, label: Localized, cap: (counts: Counts) => number | null): Check => ({
  key,
  label,
  evaluate: (counts) => {
    const value = countOf(counts, key);
    if (value === null) return { status: "unreadable", value: null };
    const limit = cap(counts);
    // No cap means nothing is sent on that lane (the staff cap off): nothing to warn about.
    if (limit === null || limit <= 0) return { status: "ok", value };
    const detail = t(`${value} / ${limit}`, `${value} of ${limit}`);
    return { status: value >= limit * USAGE_WARN_SHARE ? "problem" : "ok", value, detail };
  },
});

const cronJobs = (counts: Counts): Localized | undefined => {
  const jobs = counts?.cron_failed_jobs;
  if (!Array.isArray(jobs) || jobs.length === 0) return undefined;
  const names = jobs.filter((name): name is string => typeof name === "string").slice(0, 5).join(", ");
  return names ? t(names, names) : undefined;
};

export const HEALTH_CHECKS: readonly Check[] = [
  anyIs("online_events_stuck", t("अटके Razorpay संदेश", "Razorpay events stuck")),
  // A reconciler that never runs (a wrong timer token) never raises attempts.
  anyIs("online_events_pending_old", t("Razorpay संदेश 30 मिनट से रुके", "Razorpay events waiting over 30 minutes")),
  anyIs("online_captures_review", t("ऑनलाइन भुगतान जाँच बाकी", "online payments to review")),
  anyIs("outbox_uncertain", t("रसीद संदेश अनिश्चित", "receipt messages uncertain")),
  anyIs("outbox_failed", t("रसीद संदेश विफल", "receipt messages failed")),
  anyIs("cron_failed", t("डेटाबेस टाइमर विफल", "database timer failures"), cronJobs),
  // pg_cron calls One through pg_net and records "succeeded" whatever One
  // answered: a 401 from a rotated token shows only here.
  anyIs("net_http_failed", t("टाइमर के कॉल पर ऐप ने मना किया", "timer calls One refused or missed")),
  anyIs("job_runs_failed", t("ऐप के काम विफल", "app jobs failed")),
  anyIs("job_runs_stale", t("ऐप के काम अटके", "app jobs stuck")),
  {
    key: "drive_backup_hours",
    label: t("Drive बैकअप पुराना", "Drive backup overdue"),
    evaluate: (counts) => {
      const value = countOf(counts, "drive_backup_hours");
      if (value === null) return { status: "unreadable", value: null };
      // -1: no successful run on record at all.
      if (value < 0) return { status: "problem", value, detail: t("कभी नहीं हुआ", "never ran") };
      return value > DRIVE_BACKUP_MAX_HOURS
        ? { status: "problem", value, detail: t(`${value} घंटे पहले`, `${value} hours ago`) }
        : { status: "ok", value };
    },
  },
  anyIs("staff_failed", t("स्टाफ़ WhatsApp विफल", "staff WhatsApp failed")),
  anyIs("staff_unknown", t("स्टाफ़ WhatsApp अनिश्चित", "staff WhatsApp uncertain")),
  anyIs("parent_reminders_failed", t("फ़ीस रिमाइंडर विफल", "fee reminders failed")),
  anyIs("school_notices_failed", t("स्कूल सूचनाएँ विफल", "school notices failed")),
  anyIs("one_sends_failed", t("अभिभावक संदेश विफल", "parent messages failed")),
  usage(
    "parent_reminders_month",
    t("फ़ीस रिमाइंडर इस महीने", "fee reminders this month"),
    (counts) => countOf(counts, "parent_reminders_cap") ?? PARENT_REMINDER_CAP_DEFAULT,
  ),
  usage("school_notices_month", t("स्कूल सूचनाएँ इस महीने", "school notices this month"), () => SCHOOL_NOTICE_BUDGET),
  usage("staff_month", t("स्टाफ़ WhatsApp इस महीने", "staff WhatsApp this month"), (counts) => countOf(counts, "staff_cap")),
  // Every lane together (receipt notices and One's parent sends included)
  // against the AiSensy plan, when the owner has set its allowance.
  usage("aisensy_month_total", t("AiSensy कुल इस महीने", "AiSensy total this month"), (counts) => countOf(counts, "aisensy_plan_cap")),
];

/* ------------------------------------------------- the webhook probe */

/** The health job's key for the Razorpay webhook probe. */
export const WEBHOOK_PROBE_KEY = "razorpay_webhook_probe";
const WEBHOOK_PROBE_LABEL = t("Razorpay webhook जाँच", "Razorpay webhook probe");

/**
 * What the webhook's answer to a deliberately wrong signature means (plan
 * §9.1; critique1 B9). Only 401 is healthy. A 404 means
 * `RAZORPAY_WEBHOOK_SECRET` is not set on the deployment: expected until C6
 * puts One's webhook in, so before the cutover line it is "not configured
 * yet", and after it a problem — Razorpay disables a webhook that keeps
 * failing, and online payments would stop posting without a sound.
 */
export function probeVerdict(status: number, { cutover = true }: { cutover?: boolean } = {}): { ok: boolean; note: string } {
  if (status === 401) return { ok: true, note: "401 on a bad signature, as it should" };
  if (status === 404) {
    return cutover
      ? { ok: false, note: "404: RAZORPAY_WEBHOOK_SECRET is not set on this deployment (webhook off)" }
      : { ok: true, note: "404: not configured yet (RAZORPAY_WEBHOOK_SECRET is set at cutover step C6)" };
  }
  return { ok: false, note: `unexpected ${status}: a bad signature must be refused with 401` };
}

/**
 * The probe as a finding. `status` null = the request itself failed (no
 * answer): unreadable, never quiet. `cutoverRows` from the counts.
 */
export function webhookProbeFinding(status: number | null, counts: Counts): HealthFinding {
  if (status === null) return { key: WEBHOOK_PROBE_KEY, label: WEBHOOK_PROBE_LABEL, status: "unreadable", value: null };
  const cutover = (countOf(counts, "cutover_rows") ?? 1) > 0;
  const verdict = probeVerdict(status, { cutover });
  return {
    key: WEBHOOK_PROBE_KEY,
    label: WEBHOOK_PROBE_LABEL,
    status: verdict.ok ? "ok" : "problem",
    value: status,
    detail: verdict.ok && status === 404 ? t("अभी लगाया नहीं (C6)", "not configured yet (C6)") : undefined,
  };
}

/** The request the probe sends: a wrong signature, so the route refuses before it reads or writes anything. */
export const WEBHOOK_PROBE_REQUEST = {
  method: "POST",
  headers: { "content-type": "application/json", "x-razorpay-signature": "0".repeat(64) },
  body: JSON.stringify({ event: "health.probe", payload: {} }),
} as const;

/** Every check's verdict, the problems, and what could not be read. */
export function evaluateHealth(counts: Counts | null | undefined, extra: readonly HealthFinding[] = []): HealthResult {
  const source = counts && typeof counts === "object" ? counts : {};
  const findings = [...HEALTH_CHECKS.map((check) => ({ key: check.key, label: check.label, ...check.evaluate(source) })), ...extra];
  return {
    findings,
    problems: findings.filter((finding) => finding.status === "problem"),
    unreadable: findings.filter((finding) => finding.status === "unreadable"),
  };
}

/** Whether anybody needs telling. */
export function needsAttention(result: HealthResult): boolean {
  return result.problems.length > 0 || result.unreadable.length > 0;
}

/**
 * The `job_runs` summary: how many problems and unreadable counts, then each
 * problem's number under its own key. Plain counts, as every job writes.
 */
export function healthSummary(result: HealthResult): Record<string, number | string> {
  const summary: Record<string, number | string> = {
    problems: result.problems.length,
    unreadable: result.unreadable.length,
  };
  for (const finding of result.problems) summary[finding.key] = finding.value ?? "none";
  if (result.unreadable.length > 0) summary.not_read = result.unreadable.map((finding) => finding.key).join(", ");
  return summary;
}

/** The labels for the summary keys, so the Jobs screen reads them in the reader's language (rule 9). */
export const HEALTH_SUMMARY_LABELS: Record<string, Localized> = {
  problems: t("समस्याएँ", "problems"),
  unreadable: t("पढ़ी नहीं जा सकीं", "could not be read"),
  not_read: t("नहीं पढ़ी गईं", "not read"),
  ...Object.fromEntries(HEALTH_CHECKS.map((check) => [check.key, check.label])),
  [WEBHOOK_PROBE_KEY]: WEBHOOK_PROBE_LABEL,
};

/** WhatsApp allows 1,024 characters a variable; the list stays well inside it. */
const WHAT_MAX = 600;

function line(finding: HealthFinding, language: "hi" | "en"): string {
  const label = finding.label[language];
  if (finding.status === "unreadable") return language === "hi" ? `${label}: पढ़ी नहीं जा सकी` : `${label}: could not be read`;
  const detail = finding.detail ? ` (${finding.detail[language]})` : "";
  return `${label} ${finding.value ?? ""}${detail}`.trim();
}

function clip(text: string): string {
  return text.length <= WHAT_MAX ? text : `${text.slice(0, WHAT_MAX - 1)}…`;
}

/**
 * What the `ops_alert` notice carries: the day, how many things, and the list
 * in both languages. Labels and numbers only — `checkPayload` and the render
 * refuse a phone number anyway.
 */
export function alertPayload(result: HealthResult, day: string): Record<string, string | number> {
  const items = [...result.problems, ...result.unreadable];
  return {
    date: day,
    problem_count: items.length,
    what_hi: clip(items.map((finding) => line(finding, "hi")).join(" · ")),
    what_en: clip(items.map((finding) => line(finding, "en")).join(" · ")),
  };
}

/**
 * The outbox key. The same set of problems on the same day is one alert (a
 * second run, or the Vercel cron and the database timer both firing, queues
 * nothing); a new problem later the same day is a new alert.
 */
export function alertKey(result: HealthResult, day: string): string {
  const signature = [...result.problems.map((f) => f.key), ...result.unreadable.map((f) => `?${f.key}`)].sort().join(",");
  return `ops_alert:${day}:${shortHash(signature)}`;
}

/** djb2, as eight hex characters: a label for a set, not a security measure. */
export function shortHash(text: string): string {
  let hash = 5381;
  for (let at = 0; at < text.length; at += 1) hash = ((hash * 33) ^ text.charCodeAt(at)) >>> 0;
  return hash.toString(16).padStart(8, "0");
}
