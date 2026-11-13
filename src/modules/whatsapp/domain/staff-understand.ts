import { z } from "zod";

import type { StaffRole } from "@/platform/auth/permissions";

import { STAFF_COMMANDS, type StaffCommand } from "./staff-words";

/**
 * What a member of staff typed, read by Claude against their desk (D-607),
 * when it is not one of the desk's own words. Claude only chooses which ask
 * the message is; it never writes the answer, and it sees nothing but the
 * words and the names of the asks. Pure: the call is in `data/staff-claude.ts`.
 */

/** The asks Claude may choose, plus "parent" (a parent's message about their own child) and "unclear". */
export const UNDERSTOOD_ASKS = [
  "menu",
  "today",
  "questions",
  "absent",
  "needs_you",
  "school",
  "staff_away",
  "cover",
  "leave",
  "collection",
  "dues",
  "roles",
  "parent",
  "unclear",
] as const satisfies readonly (StaffCommand | "parent" | "unclear")[];

export const staffUnderstandingSchema = z.object({
  ask: z.enum(UNDERSTOOD_ASKS),
  /** For *dues* about one child: the name or SR number exactly as the message wrote it, else null. */
  student: z.string().nullable(),
});

export type StaffUnderstanding = z.infer<typeof staffUnderstandingSchema>;

const ABOUT: Record<StaffCommand, string> = {
  menu: "a greeting, thanks, or asking what the helper can do",
  today: "their own periods, cover duties and leave today",
  questions: "parents waiting for their answer",
  absent: "who is absent in their own class today",
  needs_you: "parents' suggestions waiting for their decision (approvals)",
  school: "the whole school today: registers marked, absences, staff away, periods without cover",
  staff_away: "which staff are away today",
  cover: "who is covering whose period today (substitutions, arrangements)",
  leave: "staff leave requests waiting for a decision",
  collection: "fees collected: today, this month, this year",
  dues: "fees still due, for the school or for one student",
  roles: "trying another role (only on the testing number)",
};

/** The same for every message, so Anthropic keeps it cached between messages. */
export function staffUnderstandSystemPrompt(helperName: string): string {
  return [
    `You read one WhatsApp message that a member of staff of Shri Veer Patta Senior Secondary School sent to ${helperName}, the school's WhatsApp helper.`,
    "Decide which ask it is. You never answer the message yourself, and you never invent anything.",
    "",
    "The asks:",
    ...STAFF_COMMANDS.map((command) => `- ${command}: ${ABOUT[command]}`),
    "- parent: the message reads like a parent writing to the school about their own child (their child's leave or illness, their child's fee or receipt, a complaint), not a staff question",
    "- unclear: anything else",
    "",
    "Choose the ask the message is about even when it is not on their desk; the helper tells them so.",
    "Messages may be in English, in Hindi, or in Hindi typed in Roman letters (aaj = today, kitna/kitni = how much, jama = collected, baki/bakaya = due, chutti = leave, kaun = who, hazri = attendance).",
    "For dues about one student, copy the student's name or SR (admission) number into `student` exactly as the message wrote it; otherwise null. Never put anything there that is not in the message.",
    "Reply with the JSON only.",
  ].join("\n");
}

/** The person's role and desk, and their words. */
export function staffUnderstandUserText(input: { role: StaffRole; commands: readonly StaffCommand[]; owner: boolean; text: string }): string {
  return [
    `Their role: ${input.role}`,
    `On their desk: ${input.commands.join(", ") || "nothing"}`,
    `The testing number (may try other roles): ${input.owner ? "yes" : "no"}`,
    "Their message:",
    input.text.slice(0, 500),
  ].join("\n");
}

export type Understood =
  | { kind: "command"; command: StaffCommand; query: string | null }
  | { kind: "parent" }
  | { kind: "unclear" };

/** Claude's choice as the desk uses it; a student's name only where the message has it. */
export function readUnderstanding(answer: StaffUnderstanding, text: string): Understood {
  if (answer.ask === "parent") return { kind: "parent" };
  if (answer.ask === "unclear") return { kind: "unclear" };
  const student = answer.ask === "dues" ? (answer.student ?? "").replace(/\s+/g, " ").trim() : "";
  const written = student.length >= 2 && student.length <= 40 && text.toLowerCase().includes(student.toLowerCase());
  return { kind: "command", command: answer.ask, query: written ? student : null };
}
