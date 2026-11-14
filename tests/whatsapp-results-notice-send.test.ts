import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * "Tell parents" in Exam office → Results (D-615): "Results are out" for a
 * released class, one message per practice child with an issued, fully
 * released card, to the owner's number only. Made-up names only (rule 6).
 */

vi.mock("server-only", () => ({}));

const AARAV = "11111111-1111-4111-8111-111111111111";
const RUDRA = "22222222-2222-4222-8222-222222222222";
const OTHER = "33333333-3333-4333-8333-333333333333";
const OWNER = "+919999900001";

type Issue = { id: string; revision: number; student_name: string | null; class_label: string | null };

const state = vi.hoisted(() => ({
  settings: null as null | { helperName: string; practiceStudentIds: string[] },
  switches: null as null | Record<string, unknown>,
  chatLanguage: "hx" as string | null,
  children: [] as unknown[],
  issues: new Map<string, Issue>(),
  sends: [] as Array<{ phone: string; template: string; language: string | null; variables: readonly string[]; options: Record<string, unknown> }>,
  outcome: { outcome: "accepted", logId: "log-1", providerMessageId: "wamid.1" } as Record<string, unknown>,
}));

vi.mock("@/modules/whatsapp/data/helper-store", () => ({
  readHelperSettings: async () => state.settings,
  readChildFacts: async (ids: readonly string[]) => (state.children as Array<{ studentId: string }>).filter((child) => ids.includes(child.studentId)),
  readChat: async () => ({ language: state.chatLanguage, awaiting: null, awaitingUntil: null, greetedAt: null, lastTurnAt: null }),
}));

vi.mock("@/platform/whatsapp/service", () => ({
  sendTemplate: async (phone: string, template: string, language: string | null, variables: readonly string[], options: Record<string, unknown>) => {
    state.sends.push({ phone, template, language, variables, options });
    return state.outcome;
  },
}));

vi.mock("@/platform/whatsapp/store", () => ({
  readSwitches: async () => state.switches,
  readTemplateRow: async () => null,
  whatsappDb: () => ({
    from(table: string) {
      expect(table).toBe("report_card_issues");
      const filters: Record<string, unknown> = {};
      const chain = {
        select: () => chain,
        eq(column: string, value: unknown) {
          filters[column] = value;
          return chain;
        },
        order: () => chain,
        limit: () => chain,
        returns: async () => {
          const issue = state.issues.get(String(filters.student_id));
          return { data: issue && filters.status === "issued" ? [issue] : [], error: null };
        },
      };
      return chain;
    },
  }),
}));

import { childKey } from "@/modules/whatsapp/domain/helper-facts";
import { sendResultsOutNotices } from "@/modules/whatsapp/data/report-card-notice-send";

function child(studentId: string, firstName: string, options: { term?: string; codes?: string[]; released?: string[]; revision?: number } = {}) {
  const codes = options.codes ?? ["FA1", "SA1"];
  return {
    key: childKey(studentId),
    studentId,
    firstName,
    className: "Class 6",
    sessionLabel: "TEST-2026-27",
    today: "2026-11-14",
    classTeacher: null,
    fees: null,
    receipts: [],
    attendance: null,
    results: [
      {
        exam: "Half Yearly",
        examHi: "अर्धवार्षिक",
        code: "SA1",
        term: options.term ?? "Term 1",
        subjects: [],
        got: 470,
        max: 600,
        card: { revision: options.revision ?? 2, percent: 78.3, grade: "B1", status: "complete", passed: true, rank: 1, rankOf: 4, strengths: [], focus: [], trend: "up", growth: 6, codes },
      },
    ],
    releasedCodes: options.released ?? ["FA1", "SA1"],
    pendingResults: [],
    calendar: [],
  };
}

const input = (studentIds: string[], sessionLabel = "TEST-2026-27") => ({
  sessionLabel,
  term: "Term 1",
  exam: { en: "Half Yearly", hi: "अर्धवार्षिक" },
  studentIds,
  requestedBy: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
});

beforeEach(() => {
  state.settings = { helperName: "Veer Patta AI", practiceStudentIds: [AARAV, RUDRA] };
  state.switches = { dryRun: false, features: { report_delivery: true }, realRecipients: false, ownerTestNumber: OWNER, dailyLimit: 50 };
  state.chatLanguage = "hx";
  state.children = [child(AARAV, "Aarav"), child(RUDRA, "Rudra")];
  state.issues = new Map([
    [AARAV, { id: "issue-aarav", revision: 2, student_name: "Aarav Test", class_label: "Class 6" }],
    [RUDRA, { id: "issue-rudra", revision: 2, student_name: "Rudra Test", class_label: "Class 1" }],
  ]);
  state.sends = [];
  state.outcome = { outcome: "accepted", logId: "log-1", providerMessageId: "wamid.1" };
});

describe("Tell parents: who is told (D-615)", () => {
  it("sends nothing in a real year", async () => {
    expect(await sendResultsOutNotices(input([AARAV], "2026-27"))).toEqual({ ok: false, why: "real_year" });
    expect(state.sends).toHaveLength(0);
  });

  it("tells only the practice children on the class's roll, each once, to the owner's number", async () => {
    const run = await sendResultsOutNotices(input([AARAV, OTHER]));
    expect(run).toMatchObject({ ok: true, sent: 1, noCard: 0, already: 0 });
    expect(state.sends).toHaveLength(1);
    const [sent] = state.sends;
    expect(sent!.phone).toBe(OWNER);
    // A family writing Hinglish gets the Hindi copy.
    expect(sent!.template).toBe("vpps_parent_report_card_hi_v1");
    expect(sent!.language).toBe("hi");
    expect(sent!.variables).toEqual(["Aarav Test", "Class 6", "अर्धवार्षिक"]);
    expect(sent!.options).toMatchObject({
      feature: "report_delivery",
      sessionLabel: "TEST-2026-27",
      link: { table: "report_card_issues", id: "issue-aarav" },
      idempotencyKey: `results-out:${AARAV}:Term_1:2:${OWNER}`,
      quickReplies: [`vpai:report_card:${childKey(AARAV)}`],
    });
  });

  it("says so when no practice child is in the class, or the owner's number is not set", async () => {
    expect(await sendResultsOutNotices(input([OTHER]))).toEqual({ ok: false, why: "no_practice_child" });
    state.switches = { ...state.switches, ownerTestNumber: null };
    expect(await sendResultsOutNotices(input([AARAV]))).toEqual({ ok: false, why: "no_owner" });
    expect(state.sends).toHaveLength(0);
  });

  it("writes in English to a family that writes English", async () => {
    state.chatLanguage = "en";
    await sendResultsOutNotices(input([AARAV]));
    expect(state.sends[0]).toMatchObject({ template: "vpps_parent_report_card_en_v1", language: "en", variables: ["Aarav Test", "Class 6", "Half Yearly"] });
  });
});

describe("Tell parents: a card that may not go yet (D-615)", () => {
  it("leaves out a card carrying an exam whose results are not out", async () => {
    state.children = [child(AARAV, "Aarav", { codes: ["FA1", "SA1", "FA2"] })];
    expect(await sendResultsOutNotices(input([AARAV]))).toMatchObject({ ok: true, sent: 0, noCard: 1 });
    expect(state.sends).toHaveLength(0);
  });

  it("leaves out a card of another term, a card not issued, and one reissued since the facts were read", async () => {
    state.children = [child(AARAV, "Aarav", { term: "Term 2" })];
    expect(await sendResultsOutNotices(input([AARAV]))).toMatchObject({ ok: true, sent: 0, noCard: 1 });
    state.children = [child(AARAV, "Aarav")];
    state.issues.delete(AARAV);
    expect(await sendResultsOutNotices(input([AARAV]))).toMatchObject({ ok: true, sent: 0, noCard: 1 });
    state.issues.set(AARAV, { id: "issue-aarav", revision: 3, student_name: "Aarav Test", class_label: "Class 6" });
    expect(await sendResultsOutNotices(input([AARAV]))).toMatchObject({ ok: true, sent: 0, noCard: 1 });
    expect(state.sends).toHaveLength(0);
  });
});

describe("Tell parents: what the office is told back (D-615)", () => {
  it("counts a second press as already told", async () => {
    state.outcome = { outcome: "duplicate", logId: "log-1", status: "delivered", providerMessageId: "wamid.1" };
    expect(await sendResultsOutNotices(input([AARAV]))).toMatchObject({ ok: true, sent: 0, already: 1 });
  });

  it("passes on the first check that stopped it, such as Meta not having approved the message", async () => {
    state.outcome = { outcome: "refused", logId: null, code: "template_not_approved", reason: "This template is not approved on the school's WhatsApp yet." };
    expect(await sendResultsOutNotices(input([AARAV]))).toMatchObject({ ok: true, sent: 0, stopped: { count: 1, code: "template_not_approved" } });
  });

  it("counts practice mode as written to the log, not sent", async () => {
    state.outcome = { outcome: "dry_run", logId: "log-1", reason: "Practice mode is on" };
    expect(await sendResultsOutNotices(input([AARAV]))).toMatchObject({ ok: true, sent: 0, logged: 1 });
  });
});
