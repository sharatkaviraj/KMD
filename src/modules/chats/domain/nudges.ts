import type { ChatDesk, NudgeStep } from "./types";

/**
 * The WhatsApp nudge that brings a person to their chats (D-616).
 *
 * Teachers miss an app's notifications but not a WhatsApp from the school
 * (the owner, 15 Nov 2026). So when a parent waits, the people on that desk
 * get a WhatsApp with a link that opens their whole Chats section in One in
 * one tap:
 *
 *  - two minutes after the parent wrote (a person answering in One meanwhile
 *    stops it), then a reminder three hours later if nobody has answered;
 *  - a day after the parent first wrote, a class teacher's or the accounts
 *    office's chat still unanswered goes in front of the admins too;
 *  - only between 6 am and 9 pm in India, never more than one nudge to a
 *    person in half an hour (several waiting parents make one message), and
 *    only to staff who said yes to WhatsApp from the school app.
 *
 * Pure: the timing and the words. The job that sends them is
 * `data/nudges.ts`.
 */

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

export const REMIND_AFTER_HOURS = 3;
export const PASS_UP_AFTER_HOURS = 24;
/** One nudge per person in this long, however many parents write. */
export const NUDGE_GAP_MINUTES = 30;
/** The people told about one desk's chat at once. */
export const MAX_PEOPLE_PER_NUDGE = 3;

/** The step after one that has just run, or null when nothing more is sent. */
export function nudgeAfter(
  done: NudgeStep,
  input: { at: Date; desk: ChatDesk; waitingSince: Date | null },
): { step: NudgeStep; at: Date } | null {
  if (done === "first") return { step: "remind", at: new Date(input.at.getTime() + REMIND_AFTER_HOURS * HOUR) };
  if (done === "remind") {
    if (input.desk === "admin") return null;
    const since = input.waitingSince ?? input.at;
    const passUp = since.getTime() + PASS_UP_AFTER_HOURS * HOUR;
    // Never sooner than an hour after the reminder, whenever the parent first wrote.
    return { step: "pass_up", at: new Date(Math.max(passUp, input.at.getTime() + HOUR)) };
  }
  return null;
}

/** Who a step goes to: the chat's own desk, or (passed up) the admins. */
export function nudgeAudience(step: NudgeStep): "desk" | "admins" {
  return step === "pass_up" ? "admins" : "desk";
}

/** Whether a person nudged at `lastAt` may be nudged again at `now`. */
export function mayNudgeAgain(lastAt: string | null, now: Date): boolean {
  if (!lastAt) return true;
  const at = Date.parse(lastAt);
  return !Number.isFinite(at) || now.getTime() - at >= NUDGE_GAP_MINUTES * MINUTE;
}

export type NudgeLanguage = "hi" | "en";

/** "2 parents" / "2 अभिभावक": the count in the approved message's blank. */
export function waitingCount(count: number, language: NudgeLanguage): string {
  const n = Math.max(1, Math.round(count));
  if (language === "hi") return `${n} अभिभावक`;
  return n === 1 ? "1 parent" : `${n} parents`;
}

/**
 * The typed nudge, for a person who wrote to the school's number in the last
 * day (their chat is open): the count, who is waiting, and the link.
 */
export function nudgeText(input: {
  language: NudgeLanguage;
  name: string;
  waiting: number;
  /** "Riya · Class 6" for each waiting chat, at most three shown. */
  about: readonly string[];
  link: string;
  passedUp: boolean;
  practice: boolean;
}): string {
  const shown = input.about.filter(Boolean).slice(0, 3);
  const more = input.about.length - shown.length;
  const list = shown.map((line) => `• ${line}`).join("\n");
  const extra = more > 0 ? (input.language === "hi" ? `\n• और ${more}` : `\n• and ${more} more`) : "";
  // Practice: the owner's number stands in for a test account, and is told which.
  const who = input.name.trim() || "-";
  const practice = input.practice
    ? input.language === "hi"
      ? `\n\n_अभ्यास: यह संदेश ${who} के लिए है।_`
      : `\n\n_Practice: this message is for ${who}._`
    : "";
  if (input.language === "hi") {
    const head = input.passedUp
      ? `⏰ *${waitingCount(input.waiting, "hi")} को एक दिन से जवाब नहीं मिला*`
      : `📩 *${waitingCount(input.waiting, "hi")} आपके जवाब की प्रतीक्षा में*`;
    return `${head}\n${list}${extra}\n\nOne में चैट खोलें और जवाब दें:\n${input.link}${practice}`;
  }
  const head = input.passedUp
    ? `⏰ *${waitingCount(input.waiting, "en")} not answered for a day*`
    : `📩 *${waitingCount(input.waiting, "en")} waiting for your answer*`;
  return `${head}\n${list}${extra}\n\nOpen your chats in One and reply:\n${input.link}${practice}`;
}

/**
 * The four blanks of the approved "Your staff alerts" message
 * (`vpps_staff_digest_<hi|en>_v2`): the name, how many, what about, the link.
 * Used until the chats' own message with its button is approved.
 */
export function digestParams(input: { language: NudgeLanguage; name: string; waiting: number; link: string; passedUp: boolean }): string[] {
  const about =
    input.language === "hi"
      ? input.passedUp
        ? "अभिभावकों के संदेश, एक दिन से बिना जवाब"
        : "अभिभावकों के संदेश, आपके जवाब की प्रतीक्षा में"
      : input.passedUp
        ? "Parents' messages not answered for a day"
        : "Parents' messages waiting for your answer";
  return [input.name.trim() || "-", String(Math.max(1, Math.round(input.waiting))), about, input.link];
}

/** The two blanks of the chats' own approved message (`vpps_staff_open_one_<hi|en>_v1`); its button carries the link. */
export function openOneParams(input: { language: NudgeLanguage; name: string; waiting: number }): string[] {
  return [input.name.trim() || "-", waitingCount(input.waiting, input.language)];
}
