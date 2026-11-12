import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { STAFF_TEMPLATES, TEACHER_TASK_TEMPLATES } from "@/modules/staff-notices/domain/templates";
import {
  HUB_TEMPLATE_SUBMISSIONS,
  SCHOOL_NOTICE_HUB_SUBMISSIONS,
  V8_HUB_SUBMISSIONS,
  hubExpectedBodies,
  templatesThatCount,
} from "@/modules/whatsapp/domain/hub-templates";
import {
  STAFF_HUB_ENTRIES,
  STAFF_HUB_LANGUAGES,
  STAFF_HUB_SUBMISSIONS,
  TASK_BUTTON_URL,
  staffHubBody,
  staffHubKey,
  staffHubName,
} from "@/modules/whatsapp/domain/staff-hub-templates";

/**
 * One's own templates on the school's WhatsApp hub (owner, 12 Nov 2026:
 * "Yes submit them", D-573): the parents' school notices as they are, and a
 * hub copy of every staff notice and teacher task that Meta will accept and
 * that the existing renderers fill unchanged.
 */

const MIGRATIONS = ["20261109062459_school_whatsapp.sql", "20261112024037_whatsapp_staff_hub_templates.sql"]
  .map((file) => readFileSync(join(process.cwd(), "supabase/migrations", file), "utf8"))
  .join("\n");
const SEED =
  /^\s*\('([a-z0-9_]+)', '([a-z0-9_]+)', '(hi|en)', '([a-z_]+)', (\d+), array\[([^\]]*)\]::text\[\], '(none|document)', (true|false), /gm;
const seeded = new Map(
  [...MIGRATIONS.matchAll(SEED)].map((match) => [
    match[1]!,
    {
      providerName: match[2]!,
      language: match[3]!,
      feature: match[4]!,
      bodyParams: Number(match[5]),
      paramNames: match[6]!.split(",").map((name) => name.trim().replace(/^'|'$/g, "")).filter(Boolean),
      urlButton: match[8] === "true",
    },
  ]),
);

const placeholders = (body: string) => [...body.matchAll(/\{\{(\d+)\}\}/g)].map((match) => Number(match[1]));

/** What Meta checks a template body for before it reviews the words. */
function metaShapeProblems(body: string, examples: readonly string[]): string[] {
  const problems: string[] = [];
  const found = placeholders(body);
  const count = found.length === 0 ? 0 : Math.max(...found);
  if (/^\s*\{\{\d+\}\}/.test(body)) problems.push("starts with a blank");
  if (/\{\{\d+\}\}\s*$/.test(body)) problems.push("ends with a blank");
  if (/\}\}\s*\{\{/.test(body)) problems.push("two blanks side by side");
  if (JSON.stringify(found) !== JSON.stringify(Array.from({ length: count }, (_, index) => index + 1))) problems.push(`blanks out of order: ${found.join(",")}`);
  if (body.length > 1024) problems.push("longer than 1024");
  if (examples.length !== count) problems.push(`${examples.length} examples for ${count} blanks`);
  if (examples.some((example) => !example.trim() || /[\n\t]| {4,}/.test(example))) problems.push("an empty or multi-line example");
  return problems;
}

describe("the staff and teacher-task set on the hub", () => {
  it("has a Hindi and an English copy of every staff template and both teacher tasks", () => {
    const codes = STAFF_HUB_ENTRIES.flatMap((entry) => entry.codes);
    expect(new Set(codes).size).toBe(codes.length);
    expect([...codes].sort()).toEqual([...Object.keys(STAFF_TEMPLATES), ...Object.keys(TEACHER_TASK_TEMPLATES)].sort());
    expect(STAFF_HUB_SUBMISSIONS).toHaveLength(STAFF_HUB_ENTRIES.length * 2);
    expect(STAFF_HUB_SUBMISSIONS).toHaveLength(40);
  });

  it.each(STAFF_HUB_ENTRIES.map((entry) => [entry.slug, entry] as const))("%s keeps the blanks of the message One already renders", (_slug, entry) => {
    for (const code of entry.codes) {
      const old = STAFF_TEMPLATES[code] ?? TEACHER_TASK_TEMPLATES[code];
      expect(old, code).toBeDefined();
      expect([...entry.variables]).toEqual([...old!.variables]);
    }
    for (const language of STAFF_HUB_LANGUAGES) {
      const body = staffHubBody(entry, language);
      expect(Math.max(0, ...placeholders(body))).toBe(entry.variables.length);
      expect(entry.samples[language]).toHaveLength(entry.variables.length);
    }
  });

  it.each(STAFF_HUB_SUBMISSIONS.map((submission) => [submission.name, submission] as const))("%s is a body Meta accepts", (name, submission) => {
    expect(name).toMatch(/^vpps_staff_[a-z_]+_(hi|en)_v1$/);
    expect(submission.category).toBe("UTILITY");
    expect(metaShapeProblems(submission.body, submission.examples)).toEqual([]);
    const lines = submission.body.split("\n");
    expect(lines[0]).toMatch(/^\*[^*{}]+\*$/);
    expect(lines[1]).toBe(submission.language === "hi" ? "श्री वीर पत्ता सी. सै. स्कूल" : "Shri Veer Patta Sr. Sec. School");
    // Hindi words in the Hindi copy, none in the English one.
    expect(/[ऀ-ॿ]/.test(submission.body)).toBe(submission.language === "hi");
    for (const button of submission.buttons) {
      expect(button).toEqual({ type: "URL", text: expect.any(String), url: TASK_BUTTON_URL });
      expect(button.text.length).toBeLessThanOrEqual(25);
      expect(new URL(TASK_BUTTON_URL.replace("{{1}}", "x")).host).toBe("one.vpps.co.in");
    }
  });

  it("only the teacher tasks carry the Open task button", () => {
    for (const entry of STAFF_HUB_ENTRIES) {
      for (const language of STAFF_HUB_LANGUAGES) {
        const submission = STAFF_HUB_SUBMISSIONS.find((candidate) => candidate.name === staffHubName(entry.slug, language))!;
        expect(submission.buttons.length).toBe(entry.feature === "teacher_task" ? 1 : 0);
      }
    }
  });

  it.each(STAFF_HUB_SUBMISSIONS.map((submission) => [submission.name, submission] as const))("%s has a registry row that matches it", (name, submission) => {
    const entry = STAFF_HUB_ENTRIES.find((candidate) => STAFF_HUB_LANGUAGES.some((language) => staffHubName(candidate.slug, language) === name))!;
    expect(seeded.get(name)).toEqual({
      providerName: name,
      language: submission.language,
      feature: entry.feature,
      bodyParams: entry.variables.length,
      paramNames: [...entry.variables],
      urlButton: entry.taskButton,
    });
  });
});

describe("which name a staff message goes out under", () => {
  it("follows the reader: English reads English, Hindi and both read Hindi", () => {
    expect(staffHubKey("vppsone_cover_assigned", "en")).toBe("vpps_staff_cover_assigned_en_v1");
    expect(staffHubKey("vppsone_cover_assigned", "hi")).toBe("vpps_staff_cover_assigned_hi_v1");
    // The renderers fill `both` with the Hindi values (notices.ts fromTemplate).
    expect(staffHubKey("vppsone_cover_assigned", "both")).toBe("vpps_staff_cover_assigned_hi_v1");
    expect(staffHubKey("vx_staff_digest_v1", "en")).toBe("vpps_staff_digest_en_v1");
  });

  it("a teacher task's code carries its language; both is Hindi first", () => {
    expect(staffHubKey("vppsone_teacher_task_en_v1", "hi")).toBe("vpps_staff_task_en_v1");
    expect(staffHubKey("vppsone_teacher_task_hi_v1", null)).toBe("vpps_staff_task_hi_v1");
    expect(staffHubKey("vppsone_teacher_task_both_v1", null)).toBe("vpps_staff_task_hi_v1");
    expect(staffHubKey("vppsone_teacher_task_reminder_en_v1", null)).toBe("vpps_staff_task_reminder_en_v1");
    expect(staffHubKey("vppsone_teacher_task_reminder_both_v1", "en")).toBe("vpps_staff_task_reminder_hi_v1");
  });

  it("with no reader's language, the words decide", () => {
    expect(staffHubKey("vx_staff_notice", null, ["Staff meeting at 2:30 PM."])).toBe("vpps_staff_notice_en_v1");
    expect(staffHubKey("vx_staff_notice", null, ["आज 2:30 बजे स्टाफ़ बैठक है।"])).toBe("vpps_staff_notice_hi_v1");
  });

  it("a code with no hub copy keeps its own name (and is refused as not approved)", () => {
    expect(staffHubKey("vppsone_collection_link", "en")).toBeNull();
    expect(staffHubKey("vx_school_notice", "en")).toBeNull();
    expect(staffHubKey("qa_only", null)).toBeNull();
  });

  it("every name it can give is one the hub is asked to carry", () => {
    const names = new Set(HUB_TEMPLATE_SUBMISSIONS.map((submission) => submission.name));
    for (const entry of STAFF_HUB_ENTRIES) {
      for (const code of entry.codes) {
        for (const language of ["hi", "en", "both", null] as const) expect(names.has(staffHubKey(code, language)!)).toBe(true);
      }
    }
  });
});

describe("the parents' school notices on the hub", () => {
  it("go as they are: four notices, Hindi and English, each with Call office", () => {
    expect(SCHOOL_NOTICE_HUB_SUBMISSIONS).toHaveLength(8);
    for (const submission of SCHOOL_NOTICE_HUB_SUBMISSIONS) {
      expect(submission.name).toMatch(/^vpps_school_(absent|closed|exam_schedule|ptm)_(hi|en)_v1$/);
      expect(metaShapeProblems(submission.body, submission.examples)).toEqual([]);
      expect(submission.buttons).toEqual([{ type: "PHONE_NUMBER", text: expect.any(String), phone_number: "+919352205884" }]);
      // Never the fees app's number.
      expect(JSON.stringify(submission)).not.toMatch(/8047136289/);
      const row = seeded.get(submission.name);
      expect(row, `${submission.name} has no registry row`).toBeDefined();
      expect(row).toMatchObject({ providerName: submission.name, language: submission.language, urlButton: false });
      expect(row!.bodyParams).toBe(Math.max(...placeholders(submission.body)));
    }
  });
});

describe("the whole list the hub is asked to carry", () => {
  it("is the _v8 set, the school notices, the staff set and Veer Patta AI's four, each name once", () => {
    expect(HUB_TEMPLATE_SUBMISSIONS).toHaveLength(V8_HUB_SUBMISSIONS.length + 8 + 40 + 4);
    expect(new Set(HUB_TEMPLATE_SUBMISSIONS.map((submission) => `${submission.name}:${submission.language}`)).size).toBe(HUB_TEMPLATE_SUBMISSIONS.length);
  });

  it("holds every approval to the wording One sends", () => {
    const expected = hubExpectedBodies();
    for (const submission of HUB_TEMPLATE_SUBMISSIONS) expect(expected.get(submission.name)).toBe(submission.body);
  });

  it("counts staff notices against their hub copies once they exist, not the old AiSensy names", () => {
    const rows = [
      { key: "vpps_staff_cover_assigned_en_v1", status: "pending" },
      { key: "vpps_staff_cover_assigned_hi_v1", status: "approved" },
      { key: "vppsone_cover_assigned", status: "not_submitted" },
    ];
    expect(templatesThatCount(rows).map((row) => row.key)).toEqual(["vpps_staff_cover_assigned_en_v1", "vpps_staff_cover_assigned_hi_v1"]);
  });
});
