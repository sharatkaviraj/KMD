import { primary, t, type Language, type Localized } from "@/platform/i18n/language";
import { HEALTH_SUMMARY_LABELS } from "@/modules/ops-health/domain/health";

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
  "fee-day-summary",
  "fee-day-not-closed",
  "document-backup",
  "drive-backup",
  "health",
  "ai-connection-purge",
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
      "पहला पीरियड खत्म होने के बाद, जिन कक्षाओं की हाज़िरी अब तक सहेजी नहीं गई, उनके कक्षा-अध्यापक को याद दिलाता है। भेजने से ठीक पहले फिर जाँचता है — तब तक सहेज ली गई हो तो नहीं भेजता।",
      "After the first period ends, reminds the class teacher of every class whose register is still not saved. It checks again just before sending — a register saved meanwhile is not reminded.",
    ),
    // 04:00 UTC is 09:30 in school, after the first period by the default
    // bells; a daily cron may fire up to an hour late, never early. The job
    // itself asks nobody before the first period has ended by the bells.
    schedule: "0 4 * * *",
    when: t("हर दिन पहले पीरियड के बाद (लगभग 9:30)", "Every day after the first period (about 9:30)"),
    // Each reminder is keyed by class, day and person, so running it again —
    // by hand at noon, say — reminds only who is still outstanding.
    oncePerDay: false,
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
    label: t("स्टाफ़ की WhatsApp सूचनाएँ", "Staff WhatsApp notices"),
    what: t(
      "स्टाफ़ की बाकी सूचनाएँ (व्यवस्था, हाज़िरी, फ़ीस…) भेजता है — सिर्फ़ उन्हें जिन्होंने हामी भरी है, सुबह 7 से रात 8 के बीच — और अटकी हुई जाँचता है। हर बदलाव के बाद भी अपने-आप चलता है।",
      "Sends staff notices still waiting (cover, registers, fees…) — only to people who agreed, between 07:00 and 20:00 — and settles stuck ones. Also runs by itself after every change.",
    ),
    schedule: "0 2 * * *",
    when: t("हर सुबह 7:30 बजे, और हर बदलाव के बाद", "Every morning at 7:30, and after every change"),
    // A safety net, not the main path — running it twice only sends what is
    // still due, because every send is claimed under a lease first (P4).
    oncePerDay: false,
  },
  "fee-day-summary": {
    name: "fee-day-summary",
    label: t("दिन के संग्रह की सूचना", "Day's collection to the office"),
    what: t(
      "आज कितनी फ़ीस आई — कुल, रसीदें और किस तरह (नकद, UPI…) — लेखाकार और प्रशासक को WhatsApp पर भेजता है, जिन्होंने हामी भरी है। आज कोई रसीद नहीं तो कुछ नहीं।",
      "WhatsApps the accountant and the admin, if they agreed to it, what came in today: the total, the receipts and how (cash, UPI…). Nothing on a day with no receipts.",
    ),
    // 13:30 UTC is 19:00 in school.
    schedule: "30 13 * * *",
    when: t("हर शाम 7:00 बजे", "Every evening at 19:00"),
    // Keyed by day: a second run queues nothing new.
    oncePerDay: false,
  },
  "fee-day-not-closed": {
    name: "fee-day-not-closed",
    label: t("दिन बंद नहीं हुआ", "Day not closed"),
    what: t(
      "रात 8 बजे देखता है कि आज का दिन (नकद गिनकर) बंद हुआ या नहीं; नहीं हुआ तो लेखाकार और प्रशासक को WhatsApp करता है।",
      "At 20:00, checks whether today was closed (cash counted); if not, WhatsApps the accountant and the admin.",
    ),
    // 14:30 UTC is 20:00 in school, the moment the staff send window closes.
    schedule: "30 14 * * *",
    when: t("हर रात 8:00 बजे", "Every night at 20:00"),
    oncePerDay: false,
  },
  "document-backup": {
    name: "document-backup",
    label: t("कागज़ात की सुरक्षित प्रति", "Document backup"),
    what: t(
      "स्कूल के Google Drive की जाँच करता है, फिर हर नए कागज़ की बंद (एन्क्रिप्टेड) प्रति दूसरी जगह रखता है। Drive चालू न हो तो कुछ नहीं करता।",
      "Checks the school's Google Drive, then keeps a sealed (encrypted) copy of every new document somewhere else. Does nothing while Drive is off.",
    ),
    // 21:30 UTC is 03:00 in school: nobody is uploading.
    schedule: "30 21 * * *",
    when: t("हर रात 3 बजे", "Every night at 3:00"),
    // Running it again only copies what is still missing.
    oncePerDay: false,
  },
  "drive-backup": {
    name: "drive-backup",
    label: t("Google Drive में पूरी सुरक्षित प्रति", "Backup to Google Drive"),
    what: t(
      "सारे रिकॉर्ड (फ़ीस सहित) और हर रखी हुई फ़ाइल की बंद (एन्क्रिप्टेड) प्रति स्कूल के Google Drive फ़ोल्डर में रखता है, साथ में एक सूची जिसमें गिनती और जाँच-अंक होते हैं।",
      "Keeps a sealed (encrypted) copy of every record, fees included, and of every stored file in the school's Google Drive folder, with a list of counts and checksums beside it.",
    ),
    // 22:00 UTC is 03:30 in school, after the document backup.
    schedule: "0 22 * * *",
    when: t("हर रात 3:30 बजे", "Every night at 3:30"),
    // A second run makes a second snapshot and copies only what changed.
    oncePerDay: false,
  },
  health: {
    name: "health",
    label: t("सिस्टम जाँच", "System check"),
    what: t(
      "गिनती से देखता है कि कुछ अटका या विफल तो नहीं — ऑनलाइन भुगतान, रसीद और स्टाफ़ के संदेश, डेटाबेस टाइमर, ऐप के काम, Drive बैकअप, इस महीने के WhatsApp — और कुछ हो तो प्रशासक को WhatsApp करता है।",
      "Counts whether anything is stuck or failing — online payments, receipt and staff messages, database timers, app jobs, the Drive backup, this month's WhatsApp — and WhatsApps the admins if something is.",
    ),
    // 02:30 UTC is 08:00 in school, inside the staff send window. The
    // database timer (docs/cutover/one-live-cron-jobs.sql) runs it again at
    // 16:00; the same problems on the same day are one alert.
    schedule: "30 2 * * *",
    when: t("हर सुबह 8:00 बजे", "Every morning at 8:00"),
    oncePerDay: false,
  },
  "ai-connection-purge": {
    name: "ai-connection-purge",
    label: t("AI कनेक्शन की सफ़ाई", "AI connection clean-up"),
    what: t(
      "AI सहायक कनेक्शन के 180 दिन से पुराने उपयोग-रिकॉर्ड, और समाप्त या उपयोग हो चुके कोड और टोकन हटाता है। जुड़े हुए कनेक्शन नहीं छेड़ता।",
      "Removes AI assistant connection call records older than 180 days, and expired or used codes and tokens. Live connections are untouched.",
    ),
    // 22:15 UTC is 03:45 in school, after the night's backups.
    schedule: "15 22 * * *",
    when: t("हर रात 3:45 बजे", "Every night at 3:45"),
    oncePerDay: true,
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
  // No longer written (D-248), but runs from before it still carry the key.
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
  queued: t("कतार में", "queued"),
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
  // The health job (Phase G) writes one key per check.
  ...HEALTH_SUMMARY_LABELS,
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
