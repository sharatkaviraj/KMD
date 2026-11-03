import { z } from "zod";

import { roleLabels, type StaffPermission, type StaffRole } from "@/platform/auth/permissions";
import type { Shape } from "@/modules/mcp/domain/projection";

/**
 * The tool registry — the wrapper plan §5.3 asks for. Each entry names the
 * permission its One screen checks, its scope rule, its argument schema
 * (strict: unknown fields are refused) and its output projection. The
 * functions that read data are injected (`ToolRuntime`); in One they are the
 * screens' own readers, called with the verified actor
 * (`src/modules/mcp/data/runtime.ts`). `tests/mcp/registry.test.ts` walks
 * every entry.
 *
 * No argument can name a staff member, a role, a session, the school or
 * "act as": the only argument any tool takes in this slice is a date.
 * Everything else comes from the verified actor on the server.
 *
 * Read-only by construction: no tool here writes, and no fee data (D10) or
 * pupil-level data is reachable from any of them.
 */

/** The member of staff behind a call, resolved on the server from the connection — never from the request. */
export type McpActor = {
  /** `staff_profiles.id`. */
  id: string;
  /** `auth.users.id`. */
  userId: string;
  displayName: string;
  shortName: string;
  role: StaffRole;
  isActive: boolean;
  /** Profile flag, or every account on a confined deployment. Absent reads as false. */
  isTestAccount?: boolean;
  confined?: boolean;
  /** The role's permissions from the matrix, read on this call. */
  permissions?: readonly string[] | null;
  smokeLab?: boolean;
  qaAccount?: boolean;
};

/** Which rows a tool may reach, beyond its permission. */
export type ToolScope =
  /** Only the caller's own record. */
  | "self"
  /** School-wide rows the permission alone opens on the One screen (who is away, the cover plan, leave asked). */
  | "school"
  /** Every class — `readsEveryClass()`, the admin Today's rule. */
  | "every_class";

export type SchoolDayData = {
  schoolOpen: boolean;
  timetableRuns: boolean;
  rows: readonly { label: string; recorded: boolean; roll: number; present: number; absent: number; halfDay: number }[];
  staffAway: number;
  uncovered: readonly { period: number; classLabels: readonly string[] }[];
  unavailable: readonly string[];
};

export type AbsenceData = {
  periodCount: number;
  absences: readonly { staffName: string; periods: readonly number[] }[];
};

export type CoverData = {
  duties: readonly {
    period: number;
    classLabels: readonly string[];
    absentNames: readonly string[];
    substituteName: string | null;
    status: "assigned" | "needs_help";
  }[];
};

export type LeaveData = readonly { staffName: string; fromDay: string; toDay: string; span: string }[];

/** The screens' readers, called with the verified actor. Each repeats its screen's own check. */
export interface ToolRuntime {
  /** The school's today (IST), `YYYY-MM-DD`. */
  today(): string;
  schoolDay(actor: McpActor, sessionLabel: string, day: string): Promise<SchoolDayData>;
  absences(actor: McpActor, sessionLabel: string, day: string): Promise<AbsenceData>;
  cover(actor: McpActor, sessionLabel: string, day: string): Promise<CoverData>;
  pendingLeave(actor: McpActor, sessionLabel: string): Promise<LeaveData>;
}

export type ToolContext = {
  actor: McpActor;
  sessionLabel: string;
  runtime: ToolRuntime;
  /** Names of the tools this actor may call now. */
  permitted: readonly string[];
};

export type ToolAnnotations = {
  title: string;
  readOnlyHint: true;
  destructiveHint: false;
  idempotentHint: true;
  openWorldHint: false;
};

export type ToolDefinition = {
  name: string;
  title: string;
  description: string;
  /** The permission the One screen checks; `active_staff` where the screen only asks for an active member of staff. */
  permission: StaffPermission | "active_staff";
  scope: ToolScope;
  annotations: ToolAnnotations;
  /** Strict: unknown fields are refused. */
  input: z.ZodType<Record<string, unknown>>;
  /** The output allowlist. Nothing outside it leaves One. */
  output: Shape;
  /** Row cap for the tool's lists. */
  maxRows: number;
  run(context: ToolContext, args: Record<string, unknown>): Promise<{ output: unknown; rows: number }>;
};

const READ_ONLY = (title: string): ToolAnnotations => ({
  title,
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
});

/** Dates a tool will look at: a month back, two weeks ahead. */
export const DATE_WINDOW = { back: 31, ahead: 14 } as const;

const dateArgs = z.strictObject({
  date: z.iso.date().optional().describe("A school day, YYYY-MM-DD. Defaults to today (India time)."),
});

function dayNumber(day: string): number {
  return Date.UTC(Number(day.slice(0, 4)), Number(day.slice(5, 7)) - 1, Number(day.slice(8, 10))) / 86_400_000;
}

/** The asked-for day, or today; null outside the window. */
export function pickDay(asked: unknown, today: string): string | null {
  const day = typeof asked === "string" ? asked : today;
  const offset = dayNumber(day) - dayNumber(today);
  if (!Number.isFinite(offset) || offset < -DATE_WINDOW.back || offset > DATE_WINDOW.ahead) return null;
  return day;
}

export class ToolArgumentError extends Error {}

function dayOrThrow(args: Record<string, unknown>, today: string): string {
  const day = pickDay(args.date, today);
  if (!day) throw new ToolArgumentError(`date must be within ${DATE_WINDOW.back} days before and ${DATE_WINDOW.ahead} days after today`);
  return day;
}

export const TOOLS: readonly ToolDefinition[] = [
  {
    name: "get_context",
    title: "Who am I in VPPS One",
    description:
      "Who you are signed in as in VPPS One: your name, your role, the academic session the tools read, whether this is the TEST session, and which tools you may use. Read-only.",
    permission: "active_staff",
    scope: "self",
    annotations: READ_ONLY("Who am I in VPPS One"),
    input: z.strictObject({}),
    output: { displayName: true, role: true, sessionLabel: true, testSession: true, tools: true },
    maxRows: 20,
    async run({ actor, sessionLabel, permitted }) {
      return {
        output: {
          displayName: actor.displayName,
          role: roleLabels[actor.role].en,
          sessionLabel,
          testSession: actor.isTestAccount === true,
          tools: [...permitted],
        },
        rows: 1,
      };
    },
  },
  {
    name: "school_day_summary",
    title: "School day summary",
    description:
      "For one school day: each class's attendance register — marked or not, with present/absent/half-day counts — the school totals, how many staff are away, and periods still without cover. Counts only; no pupil names. Read-only.",
    permission: "dashboard:view",
    scope: "every_class",
    annotations: READ_ONLY("School day summary"),
    input: dateArgs,
    output: {
      date: true,
      schoolOpen: true,
      timetableRuns: true,
      totals: { classes: true, marked: true, notMarked: true, present: true, absent: true, halfDay: true },
      classes: [{ classLabel: true, status: true, onRoll: true, present: true, absent: true, halfDay: true }],
      staffAway: true,
      periodsWithoutCover: true,
      uncovered: [{ period: true, classLabel: true }],
      unavailable: true,
    },
    maxRows: 120,
    async run({ actor, sessionLabel, runtime }, args) {
      const day = dayOrThrow(args, runtime.today());
      const data = await runtime.schoolDay(actor, sessionLabel, day);
      const rows = data.rows.slice(0, 120);
      const marked = rows.filter((row) => row.recorded);
      const sum = (pick: (row: (typeof rows)[number]) => number) => marked.reduce((total, row) => total + pick(row), 0);
      const uncovered = data.uncovered.slice(0, 120);
      return {
        output: {
          date: day,
          schoolOpen: data.schoolOpen,
          timetableRuns: data.timetableRuns,
          totals: {
            classes: rows.length,
            marked: marked.length,
            notMarked: rows.length - marked.length,
            present: sum((row) => row.present),
            absent: sum((row) => row.absent),
            halfDay: sum((row) => row.halfDay),
          },
          classes: rows.map((row) => ({
            classLabel: row.label,
            status: row.recorded ? "marked" : "not_marked",
            onRoll: row.roll,
            present: row.recorded ? row.present : null,
            absent: row.recorded ? row.absent : null,
            halfDay: row.recorded ? row.halfDay : null,
          })),
          staffAway: data.staffAway,
          periodsWithoutCover: uncovered.length,
          uncovered: uncovered.map((duty) => ({ period: duty.period + 1, classLabel: duty.classLabels.join(", ") })),
          unavailable: [...data.unavailable],
        },
        rows: rows.length,
      };
    },
  },
  {
    name: "who_is_away",
    title: "Who is away",
    description:
      "Staff marked away on a school day, and whether for the whole day or part of it. Never the reason. Read-only.",
    permission: "active_staff",
    scope: "school",
    annotations: READ_ONLY("Who is away"),
    input: dateArgs,
    output: { date: true, staff: [{ name: true, span: true }] },
    maxRows: 100,
    async run({ actor, sessionLabel, runtime }, args) {
      const day = dayOrThrow(args, runtime.today());
      const data = await runtime.absences(actor, sessionLabel, day);
      const staff = data.absences.slice(0, 100).map((absence) => ({
        name: absence.staffName,
        span: absence.periods.length === 0 || absence.periods.length >= data.periodCount ? "whole_day" : "part_day",
      }));
      return { output: { date: day, staff }, rows: staff.length };
    },
  },
  {
    name: "cover_plan",
    title: "Cover plan",
    description:
      "The cover plan for a school day: each period that needs cover, the class, the absent teacher and the substitute (or that it still needs cover). Read-only.",
    permission: "substitutions:view",
    scope: "school",
    annotations: READ_ONLY("Cover plan"),
    input: dateArgs,
    output: { date: true, periods: [{ period: true, classLabel: true, absentTeacher: true, substitute: true, status: true }] },
    maxRows: 200,
    async run({ actor, sessionLabel, runtime }, args) {
      const day = dayOrThrow(args, runtime.today());
      const data = await runtime.cover(actor, sessionLabel, day);
      const periods = data.duties.slice(0, 200).map((duty) => ({
        period: duty.period + 1,
        classLabel: duty.classLabels.join(", "),
        absentTeacher: duty.absentNames.join(", "),
        substitute: duty.substituteName,
        status: duty.status === "assigned" ? "covered" : "needs_cover",
      }));
      return { output: { date: day, periods }, rows: periods.length };
    },
  },
  {
    name: "pending_leave",
    title: "Leave waiting for a decision",
    description:
      "Leave requests staff have asked for that nobody has decided yet: who, from and to which day, and full or half day. Never the note. Decide them in VPPS One. Read-only.",
    permission: "substitutions:manage",
    scope: "school",
    annotations: READ_ONLY("Leave waiting for a decision"),
    input: z.strictObject({}),
    output: { requests: [{ staffName: true, fromDay: true, toDay: true, span: true }] },
    maxRows: 20,
    async run({ actor, sessionLabel, runtime }) {
      const data = await runtime.pendingLeave(actor, sessionLabel);
      const requests = data.slice(0, 20).map((request) => ({
        staffName: request.staffName,
        fromDay: request.fromDay,
        toDay: request.toDay,
        span: request.span,
      }));
      return { output: { requests }, rows: requests.length };
    },
  },
];

export function findTool(name: unknown): ToolDefinition | null {
  return typeof name === "string" ? (TOOLS.find((tool) => tool.name === name) ?? null) : null;
}

/** The `tools/list` entry: JSON Schema from the strict zod schema, read-only annotations. */
export function toolDescriptor(tool: ToolDefinition) {
  const schema = z.toJSONSchema(tool.input) as Record<string, unknown>;
  delete schema.$schema;
  return {
    name: tool.name,
    title: tool.title,
    description: tool.description,
    inputSchema: { type: "object", ...schema },
    annotations: { ...tool.annotations },
  };
}
