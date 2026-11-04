import { t, type Localized } from "@/platform/i18n/language";

/**
 * What a cover command tells the screen (P3). A plain module, not the
 * `"use server"` file: that may export only async functions.
 *
 * Five outcomes, and they are not the same thing to a coordinator:
 *
 *  - **saved** — committed; the receipt says exactly what changed.
 *  - **stale** — somebody else changed this day since the page was drawn.
 *    Nothing was written. The page reloads with the current plan.
 *  - **refused** — the facts say no (a teacher in two rooms, a period that has
 *    begun). Nothing was written; the reason is shown.
 *  - **error** — something failed before a decision. Retrying with the same
 *    submission is safe: if the first one landed, the receipt comes back.
 *  - **unknown** (client only) — the answer never arrived. The screen asks the
 *    server whether this submission committed before offering to try again.
 */

export type CoverReceipt = {
  commandId: string;
  dayRevision: number;
  assigned: number;
  needsHelp: number;
  added: number;
  changed: number;
  cancelled: number;
  unchanged: number;
  /** Unchanged duties a coordinator confirmed by hand — now pinned, nobody re-notified. */
  pinned: number;
  skippedStarted: number;
  noticesQueued: number;
  noticesWithdrawn: number;
  noticeRecipients: number;
  recipientsWithoutPhone: number;
  replayed: boolean;
};

export type CoverState = {
  status: "idle" | "saved" | "stale" | "refused" | "error";
  message: Localized | null;
  receipt: CoverReceipt | null;
};

export const idleCoverState: CoverState = { status: "idle", message: null, receipt: null };

/** `commit_cover_command`'s receipt as the screens read it. */
export function toCoverReceipt(receipt: {
  command_id: string;
  day_revision: number;
  assigned: number;
  needs_help: number;
  new: number;
  changed: number;
  cancelled: number;
  unchanged: number;
  pinned?: number;
  skipped_started: number;
  notices_queued: number;
  notices_withdrawn: number;
  notice_recipients: number;
  recipients_without_phone: number;
  replayed: boolean;
}): CoverReceipt {
  return {
    commandId: receipt.command_id,
    dayRevision: receipt.day_revision,
    assigned: receipt.assigned,
    needsHelp: receipt.needs_help,
    added: receipt.new,
    changed: receipt.changed,
    cancelled: receipt.cancelled,
    unchanged: receipt.unchanged,
    pinned: receipt.pinned ?? 0,
    skippedStarted: receipt.skipped_started,
    noticesQueued: receipt.notices_queued,
    noticesWithdrawn: receipt.notices_withdrawn,
    noticeRecipients: receipt.notice_recipients,
    recipientsWithoutPhone: receipt.recipients_without_phone,
    replayed: receipt.replayed,
  };
}

/** The receipt in one sentence — what the coordinator reads first. */
export function receiptSentence(receipt: CoverReceipt): Localized {
  // Nothing live left on the day: say that, not "0 duties assigned" — a
  // teacher with no lessons, or one who came back, is a day with no cover.
  const nothing = receipt.assigned === 0 && receipt.needsHelp === 0;
  const parts = {
    hi: [
      nothing ? "इस दिन किसी पाठ के लिए व्यवस्था नहीं चाहिए" : `${receipt.assigned} की व्यवस्था हो गई`,
      receipt.needsHelp > 0 ? `${receipt.needsHelp} में मदद चाहिए` : null,
      receipt.pinned > 0 ? `${receipt.pinned} पक्की की गई` : null,
      receipt.cancelled > 0 ? `${receipt.cancelled} रद्द` : null,
      receipt.noticesQueued > 0
        ? `${receipt.noticeRecipients} अध्यापकों को सूचना कतार में`
        : null,
      receipt.recipientsWithoutPhone > 0
        ? `${receipt.recipientsWithoutPhone} का नंबर नहीं — सूचना नहीं जाएगी`
        : null,
    ],
    en: [
      nothing
        ? "No lessons need cover on this day"
        : `${receipt.assigned} ${receipt.assigned === 1 ? "duty" : "duties"} assigned`,
      receipt.needsHelp > 0 ? `${receipt.needsHelp} need${receipt.needsHelp === 1 ? "s" : ""} help` : null,
      receipt.pinned > 0 ? `${receipt.pinned} confirmed and pinned` : null,
      receipt.cancelled > 0 ? `${receipt.cancelled} cancelled` : null,
      receipt.noticesQueued > 0
        ? `notices queued to ${receipt.noticeRecipients} teacher${receipt.noticeRecipients === 1 ? "" : "s"}`
        : null,
      receipt.recipientsWithoutPhone > 0
        ? `${receipt.recipientsWithoutPhone} without a phone — assigned, notice blocked`
        : null,
    ],
  };
  return {
    hi: parts.hi.filter(Boolean).join(" · "),
    en: parts.en.filter(Boolean).join(" · "),
  };
}

/** The database's refusals, in words a coordinator can act on. */
export const refusalMessages: Record<string, Localized> = {
  stale: t(
    "किसी और ने इस दिन की व्यवस्था अभी बदली है। नई स्थिति देखें और फिर सहेजें।",
    "Someone else changed cover for this day. Check the current plan and save again.",
  ),
  not_permitted: t("आपको व्यवस्था बदलने की अनुमति नहीं है।", "You do not have permission to change cover."),
  disabled: t(
    "व्यवस्था अभी बंद है (प्रशासक ने रोकी है)।",
    "Arranging cover is switched off for now by an administrator.",
  ),
  no_timetable: t(
    "कोई प्रकाशित समय-सारणी नहीं — पहले समय-सारणी जाँचें।",
    "No published timetable — check the timetable first.",
  ),
  no_timetable_day: t(
    "समय-सारणी में इस दिन के पाठ नहीं हैं।",
    "The timetable has no lessons on this day.",
  ),
  id_reused: t(
    "यह फ़ॉर्म पहले ही किसी और बदलाव के लिए भेजा जा चुका है। पेज फिर से खोलें।",
    "This form was already used for a different change. Reload the page.",
  ),
  invalid: t(
    "यह व्यवस्था अब सही नहीं है — कोई अध्यापक उसी समय कहीं और है या अनुपस्थित है। पेज फिर से खोलें।",
    "That plan no longer holds — a teacher is now away or elsewhere at that time. Reload the page.",
  ),
  refused_override: t(
    "वह अध्यापक उस पीरियड में नहीं ले सकते — वे पढ़ा रहे हैं, अनुपस्थित हैं या कहीं और लगे हैं।",
    "That teacher cannot take it — they are teaching, away or already covering at that time.",
  ),
  bad_request: t("कुछ अधूरा भेजा गया। पेज फिर से खोलें।", "Something was missing. Reload the page."),
  failed: t(
    "सहेजा नहीं जा सका। फिर से कोशिश करना सुरक्षित है।",
    "Not saved. Trying again is safe — a change that did save will not be made twice.",
  ),
};

/** Why a duty is waiting for a person, in words. */
export const needsHelpReasons: Record<string, Localized> = {
  no_candidate: t(
    "कोई योग्य अध्यापक अपने-आप नहीं मिला",
    "No suitable teacher could be assigned automatically",
  ),
  team_unmapped: t(
    "टीम का नियम तय नहीं — व्यक्ति देखे कि बच्चों के पास कोई है",
    "Team rule not set — a person must check every group is supervised",
  ),
  team_below_minimum: t("टीम में नियम से कम अध्यापक", "The team is below its minimum"),
  whole_team_absent: t("पूरी टीम अनुपस्थित", "The whole team is away"),
  pin_invalid: t(
    "चुने हुए अध्यापक अब उपलब्ध नहीं",
    "The teacher chosen earlier is no longer free",
  ),
  plan_validation: t(
    "दिन भर की जाँच में यह व्यवस्था नियम तोड़ती थी",
    "Checked against the whole day, the obvious choice broke a workload rule",
  ),
  cannot_cover: t("अध्यापक ने कहा वे नहीं ले सकते", "The assigned teacher said they cannot cover it"),
  released: t("हाथ से छोड़ी गई", "Released by hand"),
};
