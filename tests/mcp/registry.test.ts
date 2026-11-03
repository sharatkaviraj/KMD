import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { staffPermissions } from "@/platform/auth/permissions";
import { handleMcp } from "@/modules/mcp/domain/mcp";
import { project, shapePaths } from "@/modules/mcp/domain/projection";
import { toolDescriptor, TOOLS } from "@/modules/mcp/domain/tools";

import { connect, mcpRequest, setup, toolCall } from "./harness";

/**
 * The registry is the AI connection's authorization wrapper (plan §5.3): this
 * walks every entry so a tool cannot be added without a permission, a scope
 * rule, a strict argument schema, a pinned projection and a read-only
 * annotation.
 */

/** The projections, pinned. Changing one is a privacy decision: change it here on purpose. */
const PINNED: Record<string, string[]> = {
  get_context: ["displayName", "role", "sessionLabel", "testSession", "tools"],
  school_day_summary: [
    "date",
    "schoolOpen",
    "timetableRuns",
    "totals.classes",
    "totals.marked",
    "totals.notMarked",
    "totals.present",
    "totals.absent",
    "totals.halfDay",
    "classes[].classLabel",
    "classes[].status",
    "classes[].onRoll",
    "classes[].present",
    "classes[].absent",
    "classes[].halfDay",
    "staffAway",
    "periodsWithoutCover",
    "uncovered[].period",
    "uncovered[].classLabel",
    "unavailable",
  ],
  who_is_away: ["date", "staff[].name", "staff[].span"],
  cover_plan: ["date", "periods[].period", "periods[].classLabel", "periods[].absentTeacher", "periods[].substitute", "periods[].status"],
  pending_leave: ["requests[].staffName", "requests[].fromDay", "requests[].toDay", "requests[].span"],
};

/** Words that must never be a projected field: personal, financial or free-text. */
const FORBIDDEN_FIELD = /reason|note|phone|whatsapp|email|fee|due|amount|balance|receipt|rupee|student|pupil|parent|address|aadhaar|dob|birth|photo|token|password|secret/i;

/** Argument names that would let a caller choose who or where. */
const IDENTITY_ARGUMENT = /staff|teacher|user|role|session|school|act|as_|tenant|admin|permission/i;

describe("the tool registry", () => {
  it("has the five M1 tools and pins each projection", () => {
    expect(TOOLS.map((tool) => tool.name)).toEqual(Object.keys(PINNED));
    for (const tool of TOOLS) expect(shapePaths(tool.output), tool.name).toEqual(PINNED[tool.name]);
  });

  it.each(TOOLS.map((tool) => [tool.name, tool] as const))("%s declares a permission, a scope rule and read-only annotations", (_name, tool) => {
    expect(tool.permission === "active_staff" || (staffPermissions as readonly string[]).includes(tool.permission)).toBe(true);
    expect(["self", "school", "every_class"]).toContain(tool.scope);
    expect(tool.annotations).toEqual({ title: tool.title, readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false });
    expect(tool.maxRows).toBeGreaterThan(0);
    expect(tool.description.length).toBeLessThan(400);
    expect(tool.description).toMatch(/Read-only\./);
  });

  it.each(TOOLS.map((tool) => [tool.name, tool] as const))("%s projects no personal, financial or free-text field", (_name, tool) => {
    for (const field of shapePaths(tool.output)) expect(FORBIDDEN_FIELD.test(field), `${tool.name}: ${field}`).toBe(false);
  });

  it.each(TOOLS.map((tool) => [tool.name, tool] as const))("%s has a strict schema whose arguments cannot name who or where", (_name, tool) => {
    const schema = toolDescriptor(tool).inputSchema as { additionalProperties?: unknown; properties?: Record<string, unknown> };
    expect(schema.additionalProperties).toBe(false);
    for (const name of Object.keys(schema.properties ?? {})) expect(IDENTITY_ARGUMENT.test(name), `${tool.name}.${name}`).toBe(false);
    expect(tool.input.safeParse({ unexpected: true }).success).toBe(false);
  });

  it("matches the ToolScope of the One screens: the school board needs every class", () => {
    const scope = Object.fromEntries(TOOLS.map((tool) => [tool.name, `${tool.permission}/${tool.scope}`]));
    expect(scope).toEqual({
      get_context: "active_staff/self",
      school_day_summary: "dashboard:view/every_class",
      who_is_away: "active_staff/school",
      cover_plan: "substitutions:view/school",
      pending_leave: "substitutions:manage/school",
    });
  });
});

describe("projections drop whatever the readers add", () => {
  it("projection keeps listed fields only and never copies an object under a leaf", () => {
    expect(project({ a: 1, b: { secret: 1 }, c: [{ d: 1, e: 2 }], f: { g: "x", h: "y" } }, { a: true, b: true, c: [{ d: true }], f: { g: true } })).toEqual({ a: 1, b: null, c: [{ d: 1 }], f: { g: "x" } });
  });

  it.each(TOOLS.map((tool) => tool.name))("%s returns only its pinned fields through the real pipeline", async (name) => {
    const h = setup();
    const tokens = await connect(h);
    const response = await handleMcp(mcpRequest(h, tokens.access_token, toolCall(name, {})), h.mcp);
    const json = (await response.json()) as { result: { isError: boolean; structuredContent: Record<string, unknown>; content: { text: string }[] } };
    expect(json.result.isError).toBe(false);
    const text = json.result.content[0].text;
    // The fake readers put a reason, a note, phone numbers, an email, a fee figure and a pupil's name on every row.
    for (const leak of ["Hospital visit", "Private note", "9999999999", "9999999998", "12500", "Pupil Name", "x@y.z", "A Teacher"]) {
      expect(text, `${name} leaked ${leak}`).not.toContain(leak);
    }
    expect(JSON.parse(text)).toEqual(json.result.structuredContent);
    const paths = new Set<string>();
    const walk = (value: unknown, prefix: string) => {
      if (Array.isArray(value)) {
        if (value.length && typeof value[0] === "object" && value[0] !== null) value.forEach((item) => walk(item, `${prefix}[]`));
        else paths.add(prefix);
      } else if (value && typeof value === "object") for (const [key, child] of Object.entries(value)) walk(child, prefix ? `${prefix}.${key}` : key);
      else paths.add(prefix);
    };
    walk(json.result.structuredContent, "");
    for (const pathSeen of paths) expect(PINNED[name], `${name} returned ${pathSeen}`).toContain(pathSeen);
  });

  it("who_is_away says whole day or part of the day, and never why", async () => {
    const h = setup();
    const tokens = await connect(h);
    const response = await handleMcp(mcpRequest(h, tokens.access_token, toolCall("who_is_away", { date: "2026-11-03" })), h.mcp);
    const json = (await response.json()) as { result: { structuredContent: { staff: { name: string; span: string }[] } } };
    expect(json.result.structuredContent.staff).toEqual([
      { name: "Away Whole", span: "whole_day" },
      { name: "Away Part", span: "part_day" },
      { name: "Away All", span: "whole_day" },
    ]);
  });

  it("cover_plan numbers periods as the school does and joins class labels", async () => {
    const h = setup();
    const tokens = await connect(h);
    const response = await handleMcp(mcpRequest(h, tokens.access_token, toolCall("cover_plan")), h.mcp);
    const json = (await response.json()) as { result: { structuredContent: { periods: unknown[] } } };
    expect(json.result.structuredContent.periods).toEqual([
      { period: 1, classLabel: "Class 6 A", absentTeacher: "Away Whole", substitute: "Sub One", status: "covered" },
      { period: 4, classLabel: "Class 7 B, Class 7 C", absentTeacher: "Away Part", substitute: null, status: "needs_cover" },
    ]);
  });

  it("school_day_summary gives counts only, and no counts for an unmarked class", async () => {
    const h = setup();
    const tokens = await connect(h);
    const response = await handleMcp(mcpRequest(h, tokens.access_token, toolCall("school_day_summary")), h.mcp);
    const json = (await response.json()) as { result: { structuredContent: Record<string, unknown> } };
    expect(json.result.structuredContent).toMatchObject({
      totals: { classes: 2, marked: 1, notMarked: 1, present: 27, absent: 2, halfDay: 1 },
      classes: [
        { classLabel: "Class 6 A", status: "marked", onRoll: 30, present: 27, absent: 2, halfDay: 1 },
        { classLabel: "Class 7 B", status: "not_marked", onRoll: 28, present: null, absent: null, halfDay: null },
      ],
      staffAway: 2,
      periodsWithoutCover: 1,
      uncovered: [{ period: 3, classLabel: "Class 7 B" }],
    });
  });
});

describe("the portable core stays portable", () => {
  const domain = path.resolve(__dirname, "../../src/modules/mcp/domain");
  const files = readdirSync(domain).filter((file) => file.endsWith(".ts"));

  it("finds its files", () => {
    expect(files).toEqual(expect.arrayContaining(["mcp.ts", "oauth.ts", "tools.ts", "store.ts", "crypto.ts"]));
  });

  it.each(files)("%s imports no framework, database or Node-only module", (file) => {
    const source = readFileSync(path.join(domain, file), "utf8");
    expect(source).not.toMatch(/from\s+["'](next|next\/[^"']*|react|@supabase\/[^"']*|node:[^"']*|server-only)["']/);
    expect(source).not.toMatch(/@\/platform\/supabase|@\/modules\/mcp\/data|process\.env/);
  });
});
