import { z } from "zod";

import { SMOKE_ASSIST_DAILY_CAP } from "./limits";
import type { SmokeRole } from "./pool";

/*
 * Smoke Lab: what a run is, what each role's agent is asked to do, and what a
 * finding looks like. Pure; unit-tested in tests/smoke-lab.test.ts.
 */

export const MAX_RUN_HOURS = 24;

export type RunStatus = "open" | "closed" | "revoked";
export type PassState = "live" | "expired" | "revoked" | "run_closed";

/** Whether a pass still signs its account in, and why not when it does not. */
export function passState(
  pass: { revokedAt: string | null; expiresAt: string },
  run: { status: RunStatus; expiresAt: string },
  now: Date = new Date(),
): PassState {
  if (pass.revokedAt) return "revoked";
  if (run.status !== "open") return "run_closed";
  const t = now.getTime();
  if (Date.parse(pass.expiresAt) <= t || Date.parse(run.expiresAt) <= t) return "expired";
  return "live";
}

/** Hours a run may last: whole hours, 1 to 24. */
export function runHours(value: unknown): number {
  const n = Math.round(Number(value));
  return Number.isFinite(n) ? Math.min(MAX_RUN_HOURS, Math.max(1, n)) : 8;
}

/** `2026-10-21` + `07:30` → the QA clock's `2026-10-21T07:30`, or null. */
export function clockValue(schoolDay: string | null, clockStart: string | null): string | null {
  if (!schoolDay || !clockStart) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(schoolDay) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(clockStart)) return null;
  return `${schoolDay}T${clockStart}`;
}

/* ------------------------------------------------------------ findings */

export const FINDING_KINDS = ["bug", "improvement", "question"] as const;
export const SEVERITIES = ["P1", "P2", "P3"] as const;
export const FINDING_STATUSES = ["new", "confirmed", "duplicate", "not_a_bug", "fixed", "verified", "regressed"] as const;
export type FindingStatus = (typeof FINDING_STATUSES)[number];

const text = (max: number) => z.string().trim().max(max).optional().transform((v) => (v ? v : null));

/** What an agent sends to file one finding. */
export const findingInput = z.object({
  kind: z.enum(FINDING_KINDS),
  severity: z.enum(SEVERITIES),
  title: z.string().trim().min(3).max(160),
  screen: text(300),
  steps: text(4000),
  expected: text(2000),
  actual: text(2000),
  evidence: text(4000),
  reporter: text(120),
});
export type FindingInput = z.output<typeof findingInput>;

/**
 * The key two reports of one problem share: same role, same screen (path
 * without its query), same title once case, digits and spacing are folded.
 * The data layer hashes it; a repeat raises the count instead of a new row.
 */
export function findingKey(role: string | null, input: Pick<FindingInput, "screen" | "title">): string {
  const screen = (input.screen ?? "").split(/[?#]/, 1)[0].replace(/\/[0-9a-f-]{36}/gi, "/:id").toLowerCase();
  const title = input.title.toLowerCase().replace(/\d+/g, "#").replace(/\s+/g, " ").trim();
  return `${role ?? "-"}|${screen}|${title}`;
}

export type FindingRow = {
  id: string;
  kind: string;
  severity: string;
  status: string;
  title: string;
  role: string | null;
  reporter: string | null;
  screen: string | null;
  steps: string | null;
  expected: string | null;
  actual: string | null;
  evidence: string | null;
  repeats: number;
  createdAt: string;
};

const SEVERITY_RANK: Record<string, number> = { P1: 0, P2: 1, P3: 2 };

/** Most severe first, then most repeated, then oldest. */
export function sortFindings<T extends Pick<FindingRow, "severity" | "repeats" | "createdAt">>(rows: readonly T[]): T[] {
  return [...rows].sort((a, b) => (SEVERITY_RANK[a.severity] ?? 9) - (SEVERITY_RANK[b.severity] ?? 9) || b.repeats - a.repeats || a.createdAt.localeCompare(b.createdAt));
}

/** A run's findings as Markdown, for a fix PR or a hand-off to developer agents. */
export function findingsMarkdown(run: { title: string; id: string; schoolDay: string | null }, rows: readonly FindingRow[]): string {
  const open = sortFindings(rows.filter((r) => !["duplicate", "not_a_bug", "verified"].includes(r.status)));
  const lines = [`# Smoke run: ${run.title}`, "", `Run \`${run.id}\`${run.schoolDay ? ` · school day ${run.schoolDay}` : ""} · ${open.length} open finding(s) of ${rows.length}.`, ""];
  for (const r of open) {
    lines.push(`## [${r.severity}] ${r.title}`, "");
    lines.push(`- **Kind:** ${r.kind} · **Status:** ${r.status} · **Role:** ${r.role ?? "—"}${r.reporter ? ` (${r.reporter})` : ""}${r.repeats > 1 ? ` · seen ${r.repeats}×` : ""}`);
    if (r.screen) lines.push(`- **Screen:** \`${r.screen}\``);
    if (r.steps) lines.push("- **Steps:**", "", indent(r.steps));
    if (r.expected) lines.push(`- **Expected:** ${r.expected}`);
    if (r.actual) lines.push(`- **Actual:** ${r.actual}`);
    if (r.evidence) lines.push("- **Evidence:**", "", indent(r.evidence));
    lines.push("");
  }
  return lines.join("\n");
}

const indent = (s: string) => s.split(/\r?\n/).map((l) => `    ${l}`).join("\n");

/* -------------------------------------------------------- the school day */

export type DayStep = { at: string; role: SmokeRole | "all"; task: string };

/**
 * One school day, in school time. Every agent gets the whole timeline (so it
 * knows what others are doing) and does the steps for its own role. The QA
 * clock starts at the run's start time; an agent moves it with
 * `/smoke/clock?at=HH:MM` as the day goes on.
 */
export const SCHOOL_DAY: readonly DayStep[] = [
  { at: "07:30", role: "admin", task: "Open Today and Needs you; note anything waiting from yesterday. Ask once for the AI weekly brief on Today and check every bold figure against the screen it comes from." },
  { at: "07:40", role: "teacher", task: "One teacher (teacher2) applies for leave today, first half, from Today; check which periods it says will be covered." },
  { at: "07:45", role: "admin", task: "Decide the leave in Needs you → timetable leave tab; arrange cover; check the covering teacher sees the duty." },
  { at: "07:50", role: "teacher", task: "The teacher given that cover opens Today, finds the duty and asks the AI helper for a cover-period plan; say whether it would work in that class and period." },
  { at: "08:00", role: "teacher", task: "Class teachers take attendance for their own class: mark 2–3 absent, one half day, save; reopen and correct one mark with a reason." },
  { at: "08:30", role: "office", task: "Check the attendance board: which classes are not marked; open one register; look at the WhatsApp queue (nothing may be sent)." },
  { at: "09:00", role: "fee_collector", task: "Collect a fee at the Payment desk for 2 different children: amounts of ₹1–₹10 only, Cash and UPI; print/view the receipt." },
  { at: "09:15", role: "fee_collector", task: "Open a family with dues and its AI call script; check every amount and date in the script against the dues screen. Do not call anyone." },
  { at: "09:30", role: "accountant", task: "Look at today's receipts and Accounts; request a reversal of one of the ₹1 test receipts with a reason." },
  { at: "10:00", role: "admin", task: "Decide the reversal request; check the receipt shows Reversed and My requests shows it decided." },
  { at: "10:30", role: "teacher", task: "Enter marks for one open paper: valid numbers, a zero, an absent, an exempt; save a draft; leave one blank and try to submit; then submit when complete." },
  { at: "11:00", role: "exam_coordinator", task: "Open the marks tracker and results board; compare counts with what teachers saved; ask for one class's AI results summary and check each number in it; do not lock any class." },
  { at: "11:30", role: "teacher", task: "Write notes: one team note with a follow-up, one Only me note; type one roughly and let the AI note helper tidy it (keep, edit or discard the draft, and say which); make a support plan from the team note." },
  { at: "12:00", role: "academic_coordinator", task: "Review notes needing action and support plans; check Only me notes are not visible; ask for one class's week of notes in short and check it names only that class's children; open an attendance call script for a child absent this morning." },
  { at: "12:30", role: "office", task: "Students: search, open a Student 360, check details and ask for the child's notes in short; send a missing-detail or photo task to a class teacher (no external link sent); ask a how-to question in the search box in your reading language and follow where it sends you." },
  { at: "13:00", role: "teacher", task: "Answer the office's task from Today; write report-card remarks: ask the AI helper for drafts for 2–3 children, keep one, edit one, discard one, and write one of your own." },
  { at: "13:30", role: "admin", task: "Messages: ask the AI notice writer for a short notice about this week's event from a few words; edit it; do not send it." },
  { at: "14:00", role: "view_only", task: "Walk every screen you can open; confirm nothing offers a change you should not be able to make, including any AI button." },
  { at: "15:00", role: "accountant", task: "Day close preview for today: check totals match the receipts you saw; do not close the day." },
  { at: "15:30", role: "all", task: "Each role: open every screen in your menu once at phone width (390 px) and once at desktop width; file anything clipped, slow (>5 s), confusing or broken." },
];

/** What each role is responsible for exploring, beyond its timeline steps. */
export const ROLE_FOCUS: Record<SmokeRole, string> = {
  admin: "Needs you, Today, Staff, Settings, timetable and cover, receipts and reversals, collection and photo review. AI: the weekly brief on Today, the notice writer in Messages.",
  office: "Attendance board, Students and Student 360, admissions, collection rounds and tasks, messages queue (never send). AI: a child's notes in short, Ask in the search box.",
  accountant: "Accounts home, Books and My requests, receipts, dues and defaulters, day close preview (never close). AI: a family's call script.",
  fee_collector: "Payment desk end to end on a phone: search, amount, mode, review, receipt; the unfinished-payment recovery. AI: the call script before a dues call (never call).",
  academic_coordinator: "Academics: classes, progress, attendance trends, notes and support plans, weekly summary. AI: a class's week of notes in short, attendance call scripts.",
  exam_coordinator: "Exams: marks tracker, results board, report-card preview (weighted), remarks; never lock or publish. AI: a class's results summary.",
  teacher: "Today, attendance, marks, notes and plans, leave, tasks, More — mostly at phone width and in your reading language. AI: note helper, remark drafts, cover-period plan, a child's notes in short.",
  view_only: "Every screen that opens: nothing should let you change anything, and no AI button may lead to a change.",
};

/** Rules every agent follows; also printed on the admin page. */
export const AGENT_RULES: readonly string[] = [
  "This is the TEST database with fake data. Never type a real person's name, phone number or Aadhaar.",
  "Money: amounts of ₹1–₹10 only; never close a day, never refund outside a reversal request.",
  "Never press anything that opens WhatsApp, e-mail or SMS to a real number (wa.me links are blocked by the harness).",
  "Do not lock marks, publish report cards, or delete anything.",
  `The AI helper is a real, paid service: at most ${SMOKE_ASSIST_DAILY_CAP} drafts per account per day, and the app stops you there (that refusal is expected, not a bug). Put no real person's details in it. Check every draft against the screen: a wrong amount, date or name in a draft is a P1.`,
  "File every bug and every improvement as a finding as soon as you see it, with steps a person could repeat.",
  "One finding per problem. If you see it again, file it again with the same title: the lab counts repeats.",
];
