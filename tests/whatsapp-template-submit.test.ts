import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Send for approval (Settings → WhatsApp, D-566), against a fake hub and an
 * in-memory registry.
 *
 * 9 Nov: 22 templates went one after another at ~5 s each, the button sat on
 * "Sending…" for 100 seconds, and a second press sent the rest again. Meta
 * kept one of each, but nine rows that had gone through then read "Not sent
 * for approval: The hub answered 400." These pin the fix: a row is taken
 * before it is sent, a refusal puts it back, and three go at a time.
 */

vi.mock("server-only", () => ({}));

type Row = { key: string; provider_name: string; language_code: string; status: string; status_reason: string | null; submitted_at: string | null };

const state = vi.hoisted(() => ({
  rows: [] as Row[],
  submit: null as null | ((template: { name: string; language: string }) => Promise<unknown>),
}));

function fakeDb() {
  return {
    from(table: string) {
      expect(table).toBe("whatsapp_templates");
      return {
        select() {
          return {
            in: async (column: keyof Row, values: string[]) => ({
              data: state.rows.filter((row) => values.includes(String(row[column]))).map((row) => ({ ...row })),
              error: null,
            }),
          };
        },
        update(patch: Partial<Row>) {
          const filters: Array<(row: Row) => boolean> = [];
          const run = () => {
            const hit = state.rows.filter((row) => filters.every((keep) => keep(row)));
            for (const row of hit) Object.assign(row, patch);
            return hit.map((row) => ({ key: row.key }));
          };
          const chain = {
            eq(column: keyof Row, value: unknown) {
              filters.push((row) => row[column] === value);
              return chain;
            },
            in(column: keyof Row, values: unknown[]) {
              filters.push((row) => values.includes(row[column]));
              return chain;
            },
            select: async () => ({ data: run(), error: null }),
            then(resolve: (value: { data: null; error: null }) => unknown) {
              run();
              return Promise.resolve(resolve({ data: null, error: null }));
            },
          };
          return chain;
        },
      };
    },
  };
}

vi.mock("@/platform/whatsapp/config", () => ({
  readWhatsAppConfig: () => ({ ok: true, provider: "hub", hubUrl: "https://hub.test", hubKey: "test-key" }),
}));
vi.mock("@/platform/whatsapp/providers", () => ({
  providerFor: () => ({ name: "hub", submitTemplate: (template: { name: string; language: string }) => state.submit!(template) }),
}));
vi.mock("@/platform/whatsapp/store", () => ({
  whatsappDb: () => fakeDb(),
  claimSend: vi.fn(),
  readMessage: vi.fn(),
  readSwitches: vi.fn(),
  readTemplateRow: vi.fn(),
  recordAttempt: vi.fn(),
  recordStatus: vi.fn(),
  takeDue: vi.fn(),
  takePollable: vi.fn(),
  wroteWithin24h: vi.fn(),
}));

import { submitTemplates } from "@/platform/whatsapp/service";
import type { TemplateSubmission } from "@/platform/whatsapp/providers";

const NAMES = Array.from({ length: 8 }, (_, index) => `vpps_app_case${index}_en_v8`);
const SET: TemplateSubmission[] = NAMES.map((name) => ({
  name,
  language: "en",
  category: "UTILITY",
  body: "Test body {{1}}",
  examples: ["x"],
  buttons: [],
}));
const tick = () => new Promise((resolve) => setTimeout(resolve, 5));

beforeEach(() => {
  state.rows = NAMES.map((name, index) => ({
    key: `k${index}`,
    provider_name: name,
    language_code: "en",
    status: "not_submitted",
    status_reason: null,
    submitted_at: null,
  }));
});

describe("Send for approval", () => {
  it("sends each template once when it is pressed twice at the same time", async () => {
    const seen = new Map<string, number>();
    state.submit = async (template) => {
      seen.set(template.name, (seen.get(template.name) ?? 0) + 1);
      await tick();
      // What Meta does with a second copy of a name it already has.
      return seen.get(template.name)! > 1 ? { ok: false, code: null, problem: "template already exists" } : { ok: true, id: "1", status: "PENDING", category: "utility" };
    };
    const [first, second] = await Promise.all([submitTemplates(SET, { staffId: "s1" }), submitTemplates(SET, { staffId: "s1" })]);
    expect([...seen.values()].every((count) => count === 1)).toBe(true);
    expect(seen.size).toBe(NAMES.length);
    const answers = [first, second].filter((answer): answer is Extract<typeof answer, { ok: true }> => answer.ok);
    expect(answers.reduce((sum, answer) => sum + answer.sent, 0)).toBe(NAMES.length);
    expect(answers.flatMap((answer) => answer.failed)).toEqual([]);
    expect(state.rows.every((row) => row.status === "pending" && row.status_reason === "Sent to Meta for approval." && row.submitted_at)).toBe(true);
  });

  it("puts a refused row back, with the hub's own words, so it can be sent again", async () => {
    state.submit = async (template) =>
      template.name === NAMES[2] ? { ok: false, code: null, problem: "Body has a typo" } : { ok: true, id: "1", status: "PENDING", category: "utility" };
    const answer = await submitTemplates(SET, { staffId: "s1" });
    expect(answer).toMatchObject({ ok: true, sent: NAMES.length - 1, failed: [{ name: NAMES[2], problem: "Body has a typo" }] });
    expect(state.rows[2]).toMatchObject({ status: "not_submitted", status_reason: "Not sent for approval: Body has a typo", submitted_at: null });
    // The next press sends only that one.
    const sentAgain: string[] = [];
    state.submit = async (template) => {
      sentAgain.push(template.name);
      return { ok: true, id: "2", status: "PENDING", category: "utility" };
    };
    expect(await submitTemplates(SET, { staffId: "s1" })).toMatchObject({ ok: true, sent: 1, skipped: NAMES.length - 1 });
    expect(sentAgain).toEqual([NAMES[2]]);
  });

  it("an answer that never comes is a refusal, not a stuck row", async () => {
    state.submit = async () => {
      throw new Error("The operation was aborted due to timeout");
    };
    const answer = await submitTemplates(SET.slice(0, 1), { staffId: "s1" });
    expect(answer).toMatchObject({ ok: true, sent: 0, failed: [{ problem: "The operation was aborted due to timeout" }] });
    expect(state.rows[0]).toMatchObject({ status: "not_submitted" });
  });

  it("leaves rows Meta already has alone", async () => {
    state.rows[0]!.status = "pending";
    state.rows[1]!.status = "approved";
    state.rows[2]!.status = "rejected";
    const sent: string[] = [];
    state.submit = async (template) => {
      sent.push(template.name);
      return { ok: true, id: "1", status: "PENDING", category: "utility" };
    };
    await submitTemplates(SET.slice(0, 3), { staffId: "s1" });
    expect(sent).toEqual([NAMES[2]]);
    expect(state.rows[1]!.status).toBe("approved");
  });

  it("sends three at a time, not one after another", async () => {
    let inFlight = 0;
    let most = 0;
    state.submit = async () => {
      inFlight += 1;
      most = Math.max(most, inFlight);
      await tick();
      inFlight -= 1;
      return { ok: true, id: "1", status: "PENDING", category: "utility" };
    };
    await submitTemplates(SET, { staffId: "s1" });
    expect(most).toBe(3);
  });
});
