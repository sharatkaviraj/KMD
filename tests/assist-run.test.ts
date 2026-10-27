import { beforeEach, describe, expect, it, vi } from "vitest";

/* Test data only (rule 6). Claude and the database are mocked; nothing is sent. */

const state = vi.hoisted(() => ({
  parse: vi.fn(),
  settings: vi.fn(),
  budget: vi.fn(),
  log: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/modules/assist/data/settings", () => ({
  getAssistSettings: state.settings,
  isAssistConfigured: () => Boolean(process.env.ANTHROPIC_API_KEY),
}));
vi.mock("@/modules/assist/data/log", () => ({ budgetState: state.budget, writeLog: state.log }));
vi.mock("@anthropic-ai/sdk/helpers/beta/zod", () => ({ betaZodOutputFormat: () => ({ type: "json_schema" }) }));
vi.mock("@anthropic-ai/sdk", () => {
  class APIError extends Error {
    status = 500;
  }
  class RateLimitError extends APIError {}
  class InternalServerError extends APIError {}
  class APIConnectionError extends APIError {}
  class AuthenticationError extends APIError {}
  class PermissionDeniedError extends APIError {}
  class Anthropic {
    static APIError = APIError;
    static RateLimitError = RateLimitError;
    static InternalServerError = InternalServerError;
    static APIConnectionError = APIConnectionError;
    static AuthenticationError = AuthenticationError;
    static PermissionDeniedError = PermissionDeniedError;
    beta = { messages: { parse: state.parse } };
  }
  return { default: Anthropic };
});

import { runAssistTask } from "@/modules/assist/data/run";
import type { CurrentStaff } from "@/platform/auth/current-staff";

const teacher: CurrentStaff = {
  id: "11111111-1111-4111-8111-111111111111",
  userId: "qa-user",
  email: null,
  displayName: "QA Teacher",
  shortName: "QA",
  role: "teacher",
  isTeaching: true,
  isActive: true,
  language: "hi",
  preferredStart: null,
};

const note = { text: "Qatest ko bhinn mein dikkat, phone 98765 43210", tags: [{ code: "studies", label: "Studies" }], childName: "Qatest Kumar" };
const settings = { enabled: true, monthlyBudgetUsd: 25, dailyCapPerStaff: 60, disabledFeatures: [], updatedAt: null, updatedBy: null };
const usage = { input_tokens: 1500, output_tokens: 300, cache_read_input_tokens: 0 };

beforeEach(() => {
  vi.resetAllMocks();
  process.env.ANTHROPIC_API_KEY = "qa-test-key-not-real";
  state.settings.mockResolvedValue(settings);
  state.budget.mockResolvedValue({ spentUsd: 1, staffToday: 0 });
  state.log.mockResolvedValue("22222222-2222-4222-8222-222222222222");
});

describe("runAssistTask refuses before spending a token", () => {
  it("is off without the school's key", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    expect(await runAssistTask(teacher, "note.polish", note)).toEqual({ ok: false, problem: "off" });
    expect(state.parse).not.toHaveBeenCalled();
  });

  it("never widens what a person may do", async () => {
    expect(await runAssistTask(teacher, "form.read", { image: { mediaType: "image/jpeg", data: "x".repeat(200) }, classes: [] })).toEqual({ ok: false, problem: "denied" });
    expect(await runAssistTask({ ...teacher, role: "view_only" }, "note.polish", note)).toEqual({ ok: false, problem: "denied" });
    expect(state.parse).not.toHaveBeenCalled();
  });

  it("honours the admin's switch and per-feature switches", async () => {
    state.settings.mockResolvedValue({ ...settings, enabled: false });
    expect((await runAssistTask(teacher, "note.polish", note)).ok).toBe(false);
    state.settings.mockResolvedValue({ ...settings, disabledFeatures: ["note"] });
    expect(await runAssistTask(teacher, "note.polish", note)).toEqual({ ok: false, problem: "off" });
    expect(state.parse).not.toHaveBeenCalled();
  });

  it("stops at the monthly budget and the daily cap, and when they cannot be read", async () => {
    state.budget.mockResolvedValue({ spentUsd: 25, staffToday: 0 });
    expect(await runAssistTask(teacher, "note.polish", note)).toEqual({ ok: false, problem: "budget" });
    state.budget.mockResolvedValue({ spentUsd: 0, staffToday: 60 });
    expect(await runAssistTask(teacher, "note.polish", note)).toEqual({ ok: false, problem: "daily_cap" });
    state.budget.mockRejectedValue(new Error("QA table missing"));
    expect(await runAssistTask(teacher, "note.polish", note)).toEqual({ ok: false, problem: "failed" });
    expect(state.parse).not.toHaveBeenCalled();
  });

  it("rejects input of the wrong shape", async () => {
    expect(await runAssistTask(teacher, "note.polish", { text: "" })).toEqual({ ok: false, problem: "invalid" });
    expect(state.parse).not.toHaveBeenCalled();
  });
});

describe("runAssistTask asks Claude carefully", () => {
  it("sends Haiku the masked text and restores names in the answer", async () => {
    state.parse.mockImplementation(async (params: { messages: { content: { type: string; text?: string }[] }[] }) => {
      const sent = params.messages[0].content.find((b) => b.type === "text")!.text!;
      expect(sent).not.toContain("Qatest");
      expect(sent).not.toContain("98765");
      return { stop_reason: "end_turn", usage, parsed_output: { text: "[[N1]] को भिन्न में दिक्कत है।", tags: ["studies"] } };
    });
    const result = await runAssistTask(teacher, "note.polish", note);
    expect(result).toEqual({ ok: true, value: { text: "Qatest को भिन्न में दिक्कत है।", tags: ["studies"] }, logId: "22222222-2222-4222-8222-222222222222" });
    const params = state.parse.mock.calls[0][0];
    expect(params.model).toBe("claude-haiku-5-5");
    expect(params.output_config.effort).toBe("low");
    expect(params).not.toHaveProperty("temperature");
    expect(params).not.toHaveProperty("fallbacks");
    expect(state.log).toHaveBeenCalledWith(expect.objectContaining({ feature: "note", task: "note.polish", outcome: "drafted", inputTokens: 1500, outputTokens: 300 }));
  });

  it("uses Sonnet with the server-side fallback for remarks", async () => {
    state.parse.mockResolvedValue({ stop_reason: "end_turn", usage, parsed_output: { remarks: [{ ref: "C1", en: "Steady work.", hi: "नियमित काम।" }] } });
    const result = await runAssistTask({ ...teacher }, "remarks.class", { exam: "Term 1", classLabel: "6 A", children: [{ ref: "C1", percent: 70, attendance: 90, strongest: "Maths", weakest: null }] });
    expect(result.ok).toBe(true);
    const params = state.parse.mock.calls[0][0];
    expect(params.model).toBe("claude-sonnet-5-5");
    expect(params.fallbacks).toBe("default");
    expect(params.betas).toEqual(["server-side-fallback-2026-07-01"]);
  });

  it("reports a refusal and logs it", async () => {
    state.parse.mockResolvedValue({ stop_reason: "refusal", usage, parsed_output: null });
    expect(await runAssistTask(teacher, "note.polish", note)).toEqual({ ok: false, problem: "refused" });
    expect(state.log).toHaveBeenCalledWith(expect.objectContaining({ outcome: "refused" }));
  });

  it("never shows a draft with a placeholder the model invented", async () => {
    state.parse.mockResolvedValue({ stop_reason: "end_turn", usage, parsed_output: { text: "[[N4]] was quiet", tags: [] } });
    expect(await runAssistTask(teacher, "note.polish", note)).toEqual({ ok: false, problem: "failed" });
  });

  it("calls a busy API busy, not broken", async () => {
    const Anthropic = (await import("@anthropic-ai/sdk")).default as unknown as { RateLimitError: new () => Error };
    state.parse.mockRejectedValue(new Anthropic.RateLimitError());
    expect(await runAssistTask(teacher, "note.polish", note)).toEqual({ ok: false, problem: "busy" });
  });
});
