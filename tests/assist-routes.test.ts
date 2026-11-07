import { describe, expect, it } from "vitest";

import { ASSIST_MODELS } from "@/modules/assist/domain/features";
import {
  assistChain,
  CHAIN_DEADLINE_MS,
  describeChains,
  FREE_PROVIDERS,
  FREE_SHARE_MS,
  OPEN_TASKS,
  TASK_TIER,
  tierModels,
  type AvailableKeys,
} from "@/modules/assist/domain/routes";
import { ASSIST_TASKS, type AssistTaskId } from "@/modules/assist/domain/tasks";

/* D-416, D-417: which model writes each draft, and who takes over. Pure; no key value is read. */

const all: AvailableKeys = { anthropic: true, openai: true, geminiPaidModel: "gemini-3.5-flash-lite", geminiFreeModel: "gemini-3.5-flash-lite" };
const ids = Object.keys(ASSIST_TASKS) as AssistTaskId[];
const providers = (task: AssistTaskId, keys: AvailableKeys = all) => assistChain(task, keys).map((s) => `${s.provider}:${s.model}`);

describe("assistChain", () => {
  it("gives every task a tier", () => {
    expect(Object.keys(TASK_TIER).sort()).toEqual([...ids].sort());
  });

  it("starts quick open tasks on the free key, then Haiku, OpenAI Luna and Gemini Paid", () => {
    expect(providers("ask.answer")).toEqual([
      "gemini-free:gemini-3.5-flash-lite",
      "anthropic:claude-haiku-5-5",
      "openai:gpt-6-luna",
      "gemini-paid:gemini-3.5-flash-lite",
    ]);
  });

  it("never sends a task that can carry a person's data to the free key (D-401)", () => {
    for (const task of ids) {
      const free = assistChain(task, all).some((s) => s.provider === "gemini-free");
      expect(free).toBe(OPEN_TASKS.has(task));
    }
    for (const task of ["note.polish", "text.translate", "message.reply", "child.summary", "class.digest", "form.read", "remarks.class", "call.script"] as const) {
      expect(OPEN_TASKS.has(task)).toBe(false);
    }
  });

  it("writes for parents with Sonnet and keeps Opus for records, each with OpenAI then Gemini behind", () => {
    expect(providers("message.reply")).toEqual(["anthropic:claude-sonnet-5-5", "openai:gpt-6.1-sol", "gemini-paid:gemini-3.5-flash-lite"]);
    expect(providers("remarks.class")).toEqual(["anthropic:claude-opus-5-5", "openai:gpt-6.1-sol", "gemini-paid:gemini-3.5-flash-lite"]);
  });

  it("tries Gemini before OpenAI for a handwritten form photo", () => {
    expect(providers("form.read")).toEqual(["anthropic:claude-opus-5-5", "gemini-paid:gemini-3.5-flash-lite", "openai:gpt-6.1-sol"]);
  });

  it("leaves out what the deployment does not have", () => {
    expect(providers("ask.answer", { anthropic: false, openai: false, geminiPaidModel: "gemini-3.5-flash-lite", geminiFreeModel: null })).toEqual(["gemini-paid:gemini-3.5-flash-lite"]);
    expect(assistChain("note.polish", { anthropic: false, openai: false, geminiPaidModel: null, geminiFreeModel: "gemini-3.5-flash-lite" })).toEqual([]);
  });

  it("fits each chain inside the browser's wait", () => {
    for (const task of ids) {
      const stages = assistChain(task, all, {}, { testMaterial: true });
      const paid = stages.filter((s) => !FREE_PROVIDERS.has(s.provider));
      // The paid models alone fit the browser's 75 s, as before the free ones joined.
      expect(paid.reduce((sum, s) => sum + s.timeoutMs, 0)).toBeLessThanOrEqual(75_000);
      // However slowly the free models fail, the first paid model still gets all its time, with room after it.
      expect(FREE_SHARE_MS[TASK_TIER[task]] + (paid[0]?.timeoutMs ?? 0)).toBeLessThanOrEqual(CHAIN_DEADLINE_MS - 6_000);
    }
  });
});

describe("tierModels", () => {
  it("defaults to the tier's Claude model and takes a well-formed override", () => {
    expect(tierModels().careful.claude).toBe(ASSIST_MODELS.careful);
    expect(tierModels({ VPPSONE_ASSIST_CLAUDE_CAREFUL: "claude-sonnet-5-5", VPPSONE_ASSIST_OPENAI_QUICK: "gpt-6.1-terra" })).toMatchObject({
      careful: { claude: "claude-sonnet-5-5" },
      quick: { openai: "gpt-6.1-terra" },
    });
  });

  it("ignores a malformed override", () => {
    expect(tierModels({ VPPSONE_ASSIST_CLAUDE_QUICK: "claude haiku; drop" }).quick.claude).toBe(ASSIST_MODELS.quick);
  });

  it("describes the open chain and one paid chain per tier for the settings page (D-496)", () => {
    const chains = describeChains(all);
    expect(Object.keys(chains)).toEqual(["open", "quick", "writing", "careful"]);
    expect(chains.open[0].provider).toBe("gemini-free");
    for (const tier of ["quick", "writing", "careful"] as const) {
      expect(chains[tier].some((s) => FREE_PROVIDERS.has(s.provider))).toBe(false);
      expect(chains[tier][0].model).toBe(ASSIST_MODELS[tier]);
    }
  });
});
