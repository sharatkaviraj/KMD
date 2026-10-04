import { primary, t, type Language, type Localized } from "@/platform/i18n/language";

/**
 * The jobs, as a list rather than as four route files that grew apart.
 *
 * Every job in this app does the same four things — say what it is for, decide
 * whether it has already run, do the work, write down what it did — so the
 * differences are worth holding in one place where they can be read against
 * each other. `runJob()` in `platform/jobs` is the part that is identical.
 *
 * **Nothing here sends anything to a parent.** Two of these jobs produce
 * messages; both queue them for a member of staff, and D-10/D-76 are why. A
 * job is the worst possible place to relax that rule — the day an automatic
 * send goes out wrong it goes out wrong to four hundred families at once, at
 * whatever hour the schedule says, with nobody watching.
 */

export const jobNames = [
  "open-registers",
  "attendance-reminder",
  "missing-marks-nudge",
  "daily-summary",
  "staff-notices",
] as const;

export type JobName = (typeof jobNames)[number];

export function isJobName(value: string): value is JobName {
  return (jobNames as readonly string[]).includes(value);
}

export type JobDefinition = {
  name: JobName;
  label: Localized;
  /** What it does, in a sentence somebody who is not a programmer can check. */
  what: Localized;
  /**
   * The cron expression **in UTC**, because that is what Vercel reads, and the
   * school is at +05:30. `45 1 * * *` is a quarter past seven in Jaipur, which
   * is why `when` exists beside it: the expression is for the scheduler and
   * the sentence is for the person checking whether it is set to the right
   * time. Displayed here, never parsed.
   */
  schedule: string;
  /** The same thing in words, in the school's own time. */
  when: Localized;
  /**
   * Whether running it twice in one day is pointless rather than harmful.
   *
   * `runJob()` skips a job that has already succeeded for the same day unless
   * somebody asks for it again by hand. That is what makes a cron that fires
   * twice — a retry, a redeploy, two regions — harmless.
   */
  oncePerDay: boolean;
};

export const JOBS: Record<JobName, JobDefinition> = {
  "open-registers": {
    name: "open-registers",
    label: t("आज की हाज़िरी खोलें", "Open today's registers"),
    what: t(
      "हर कक्षा के लिए आज की हाज़िरी खोल देता है, ताकि अध्यापक को बनानी न पड़े।",
      "Opens today's register for every class, so no teacher has to create one.",
    ),
    schedule: "45 1 * * *",
    when: t("हर सुबह 7:15 बजे", "Every morning at 7:15"),
    oncePerDay: true,
  },
  "attendance-reminder": {
    label: t("हाज़िरी की याद", "Attendance reminder"),
    name: "attendance-reminder",
    what: t(
      "जिन कक्षाओं की हाज़िरी अब तक जमा नहीं हुई, उनके कक्षा-अध्यापकों के लिए संदेश तैयार करता है।",
      "Queues a message to the class teacher of every class whose register is still not submitted.",
    ),
    schedule: "30 5 * * *",
    when: t("हर दिन 11:00 बजे", "Every day at 11:00"),
    oncePerDay: true,
  },
  "missing-marks-nudge": {
    name: "missing-marks-nudge",
    label: t("बाकी अंकों की याद", "Missing marks nudge"),
    what: t(
      "खुली परीक्षाओं के जिन पेपरों के अंक बाकी हैं, उनके लिए संदेश तैयार करता है।",
      "Queues a message for every paper in an open exam that still has marks outstanding.",
    ),
    schedule: "30 11 * * 0",
    when: t("हर रविवार शाम 5:00 बजे", "Sundays at 17:00"),
    oncePerDay: true,
  },
  "daily-summary": {
    name: "daily-summary",
    label: t("दिन का सारांश", "Daily summary"),
    what: t(
      "दिन भर का लेखा-जोखा एक जगह दर्ज करता है — हाज़िरी, व्यवस्था, बाकी काम।",
      "Records the day in one place — attendance, cover, and what is still outstanding.",
    ),
    schedule: "0 13 * * *",
    when: t("हर शाम 6:30 बजे", "Every evening at 18:30"),
    oncePerDay: true,
  },
  "staff-notices": {
    name: "staff-notices",
    label: t("व्यवस्था की सूचनाएँ", "Cover notices"),
    what: t(
      "व्यवस्था की बाकी सूचनाएँ भेजता है और अटकी हुई जाँचता है। हर बदलाव के बाद भी अपने-आप चलता है।",
      "Sends any cover notices still waiting and settles stuck ones. Also runs by itself after every cover change.",
    ),
    schedule: "0 2 * * *",
    when: t("हर सुबह 7:30 बजे, और हर बदलाव के बाद", "Every morning at 7:30, and after every change"),
    // A safety net, not the main path — running it twice only sends what is
    // still due, because every send is claimed under a lease first (P4).
    oncePerDay: false,
  },
};

export const jobList: JobDefinition[] = jobNames.map((name) => JOBS[name]);

/* ------------------------------------------------------------- the status */

export const jobStatuses = ["running", "ok", "failed", "skipped"] as const;
export type JobStatus = (typeof jobStatuses)[number];

export const jobStatusLabels: Record<JobStatus, Localized> = {
  running: t("चल रहा है", "Running"),
  ok: t("हो गया", "Done"),
  failed: t("नहीं हो सका", "Failed"),
  skipped: t("पहले ही हो चुका था", "Already done"),
};

export type JobRun = {
  id: string;
  job: string;
  status: JobStatus;
  trigger: "schedule" | "manual";
  triggeredByName: string | null;
  forDay: string | null;
  summary: Record<string, number | string>;
  error: string | null;
  startedAt: string;
  finishedAt: string | null;
};

/**
 * Whether a run counts as "this has already happened today".
 *
 * Only a success does. A failed run must not stop the retry, and a skipped one
 * is not itself the work — it is the record of a retry deciding it had nothing
 * to do, and treating it as the success would make a job that failed once look
 * like a job that worked ever after.
 */
export function alreadyDone(runs: JobRun[], job: JobName, day: string): boolean {
  return runs.some(
    (run) => run.job === job && run.forDay === day && run.status === "ok",
  );
}

/**
 * How long a run took, or how long the current one has been going.
 *
 * A job that has been "running" for an hour has not been running for an hour —
 * it died without writing its ending, and the console should make that look
 * wrong rather than look busy.
 */
export function runDurationMs(run: JobRun, now: number = Date.now()): number {
  const started = new Date(run.startedAt).getTime();
  const ended = run.finishedAt ? new Date(run.finishedAt).getTime() : now;
  return Math.max(0, ended - started);
}

/** Past this, a "running" row is a job that died rather than one that is busy. */
export const STALE_AFTER_MS = 15 * 60 * 1000;

export function isStale(run: JobRun, now: number = Date.now()): boolean {
  return run.status === "running" && runDurationMs(run, now) > STALE_AFTER_MS;
}

/**
 * What each summary key is called, in both languages.
 *
 * Rule 9 does not stop applying because a number came out of a scheduler: an
 * admin who reads Hindi should not be handed a line of English keys. Anything
 * missing here falls back to the raw key with its underscores opened out, so a
 * job added later is readable on the day it is written and translated on the
 * day somebody gets to it.
 */
export const summaryLabels: Record<string, Localized> = {
  already_open: t("पहले से खुली", "already open"),
  answers_to_review: t("जाँचने बाकी जवाब", "answers to review"),
  attendance_percent: t("उपस्थिति %", "attendance %"),
  children: t("बच्चे", "children"),
  classes: t("कक्षाएँ", "classes"),
  classes_merged: t("साथ बैठीं", "classes merged"),
  corrections_waiting: t("सुधार बाकी", "corrections waiting"),
  cover_plan: t("व्यवस्था", "cover plan"),
  covers_arranged: t("व्यवस्था हुई", "covers arranged"),
  cover_duties: t("व्यवस्था के काम", "cover duties"),
  transport: t("माध्यम", "transport"),
  claimed: t("लीं", "claimed"),
  accepted: t("स्वीकार हुईं", "accepted"),
  failed: t("नहीं गईं", "failed"),
  unknown: t("पुष्टि नहीं", "not confirmed"),
  released: t("फिर कतार में", "back in queue"),
  became_unknown: t("अनिश्चित हुईं", "became unconfirmed"),
  stopped: t("रुकीं", "stopped"),
  cover_needs_help: t("व्यवस्था में मदद चाहिए", "cover needing help"),
  drafted: t("संदेश तैयार", "messages drafted"),
  exams_open: t("खुली परीक्षाएँ", "exams open"),
  marks_outstanding: t("अंक बाकी", "marks outstanding"),
  no_class_teacher: t("कक्षा-अध्यापक नहीं", "no class teacher"),
  no_phone: t("नंबर नहीं", "no phone number"),
  note: t("टिप्पणी", "note"),
  opened: t("खोली गईं", "opened"),
  outstanding: t("बाकी", "outstanding"),
  papers: t("पेपर", "papers"),
  papers_outstanding: t("पेपर बाकी", "papers outstanding"),
  registers_outstanding: t("हाज़िरी बाकी", "registers outstanding"),
  registers_submitted: t("हाज़िरी जमा", "registers submitted"),
  school_open: t("विद्यालय खुला", "school open"),
  self_study: t("स्वयं अध्ययन", "self study"),
};

/**
 * The handful of summary values that are words rather than numbers.
 *
 * A count needs no translating; `yes`, `none` and `draft` do. Half a line in
 * Hindi and half in English is the same rule-9 bug as an English label, and it
 * is easier to miss because most of the line looks right.
 */
export const summaryValueLabels: Record<string, Localized> = {
  yes: t("हाँ", "yes"),
  no: t("नहीं", "no"),
  none: t("कोई नहीं", "none"),
  draft: t("अभी तय नहीं", "draft"),
  published: t("जारी", "published"),
};

/**
 * The summary as a line somebody can read, in their own language.
 *
 * Every job counts something different, so the keys are the job's own. Sorted
 * by key rather than by label, so the order is the same in both languages and
 * two identical runs never look different.
 */
export function summaryLine(
  summary: Record<string, number | string>,
  language: Language,
): string {
  const entries = Object.entries(summary).sort(([a], [b]) => a.localeCompare(b, "en"));
  if (entries.length === 0) return "";

  return entries
    .map(([key, value]) => {
      const label = summaryLabels[key];
      const name = label ? primary(label, language) : key.replace(/_/g, " ");

      const word = typeof value === "string" ? summaryValueLabels[value] : undefined;
      const shown = word ? primary(word, language) : value;

      return `${name}: ${shown}`;
    })
    .join(" · ");
}
