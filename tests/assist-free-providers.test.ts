import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

vi.mock("server-only", () => ({}));

import { isFreeOpenRouterModel, NVIDIA_DEFAULT_MODEL, nvidiaConfig, OPENROUTER_DEFAULT_MODELS, openRouterConfig } from "@/lib/ai/config";
import { chatDraft, jsonFrom } from "@/modules/assist/data/chat-draft";
import { assistChain, FREE_PROVIDERS, OPEN_TASKS, type AvailableKeys } from "@/modules/assist/domain/routes";
import { ASSIST_TASKS, type AssistTaskId } from "@/modules/assist/domain/tasks";

/* D-490: NVIDIA's free Nemotron and OpenRouter's free models join the open quick tasks, never anything personal. */

const every: AvailableKeys = {
  anthropic: true, openai: true, geminiPaidModel: "gemini-3.5-flash-lite", geminiFreeModel: "gemini-3.5-flash-lite",
  nvidiaModel: NVIDIA_DEFAULT_MODEL, openRouterModel: OPENROUTER_DEFAULT_MODELS[0],
};
const ids = Object.keys(ASSIST_TASKS) as AssistTaskId[];

describe("free providers in the assist chain", () => {
  it("puts NVIDIA, then OpenRouter, then Gemini Free ahead of the paid models for an open task", () => {
    expect(assistChain("ask.answer", every).map((s) => s.provider)).toEqual([
      "nvidia-free", "openrouter-free", "gemini-free", "anthropic", "openai", "gemini-paid",
    ]);
  });

  it("never gives a task that can carry a person's data to a free provider", () => {
    for (const task of ids) {
      const free = assistChain(task, every).some((s) => FREE_PROVIDERS.has(s.provider));
      expect(free).toBe(OPEN_TASKS.has(task));
    }
  });

  it("still fits every chain inside the browser's wait", () => {
    for (const task of ids) {
      expect(assistChain(task, every).reduce((sum, s) => sum + s.timeoutMs, 0)).toBeLessThanOrEqual(75_000);
    }
  });
});

describe("openRouterConfig", () => {
  it("is off without a key and free by default", () => {
    expect(openRouterConfig({})).toBeNull();
    expect(openRouterConfig({ OPENROUTER_API_KEY: "k" })?.models).toEqual([...OPENROUTER_DEFAULT_MODELS]);
  });

  it("drops any model that is not free", () => {
    expect(openRouterConfig({ OPENROUTER_API_KEY: "k", VPPSONE_OPENROUTER_MODELS: "openai/gpt-6.1-sol, x/y:free" })?.models).toEqual(["x/y:free"]);
    expect(openRouterConfig({ OPENROUTER_API_KEY: "k", VPPSONE_OPENROUTER_MODELS: "anthropic/claude-opus-5-5" })).toBeNull();
    expect(isFreeOpenRouterModel("openrouter/free")).toBe(true);
    expect(isFreeOpenRouterModel("openrouter/auto")).toBe(false);
    expect(isFreeOpenRouterModel("a/b:free:extra")).toBe(false);
  });
});

describe("nvidiaConfig", () => {
  it("reads Vercel's key name or the alias, with Nemotron by default", () => {
    expect(nvidiaConfig({})).toBeNull();
    expect(nvidiaConfig({ NVIDIA_KIMI_API_KEY: "k" })).toEqual({ apiKey: "k", model: NVIDIA_DEFAULT_MODEL });
    expect(nvidiaConfig({ NVIDIA_API_KEY: "k", VPPSONE_NVIDIA_MODEL: "x/y" })?.model).toBe("x/y");
    expect(nvidiaConfig({ NVIDIA_API_KEY: "k", VPPSONE_NVIDIA_MODEL: "bad model; drop" })?.model).toBe(NVIDIA_DEFAULT_MODEL);
  });
});

describe("chatDraft", () => {
  const output = z.object({ answer: z.string() });
  const reply = (body: unknown, status = 200) => vi.fn(async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;

  it("finds the JSON in a fenced or chatty reply", () => {
    expect(jsonFrom("```json\n{\"answer\":\"hi\"}\n```")).toEqual({ answer: "hi" });
    expect(jsonFrom("Sure! {\"answer\":\"hi\"} Hope that helps")).toEqual({ answer: "hi" });
    expect(jsonFrom("no json here")).toBeUndefined();
  });

  it("returns the candidate at no cost, naming the model that answered", async () => {
    const fetcher = reply({ model: "x/y:free", choices: [{ finish_reason: "stop", message: { content: "{\"answer\":\"hi\"}" } }], usage: { prompt_tokens: 5, completion_tokens: 3 } });
    const result = await chatDraft({ url: "https://example.test", apiKey: "k", model: "openrouter/free", instructions: "i", text: "t", output, maxTokens: 50, timeoutMs: 1_000, fetcher });
    expect(result).toMatchObject({ candidate: { answer: "hi" }, costUsd: 0, refused: false, model: "x/y:free", input: 5, output: 3 });
  });

  it("throws the status for the router, including an error inside a 200", async () => {
    const opts = { url: "https://example.test", apiKey: "k", model: "m/n", instructions: "i", text: "t", output, maxTokens: 50, timeoutMs: 1_000 };
    await expect(chatDraft({ ...opts, fetcher: reply({ error: { code: "rate_limited" } }, 429) })).rejects.toMatchObject({ status: 429 });
    await expect(chatDraft({ ...opts, fetcher: reply({ error: { code: 503 } }) })).rejects.toMatchObject({ status: 503 });
  });

  it("gives no candidate when the answer was cut off", async () => {
    const fetcher = reply({ choices: [{ finish_reason: "length", message: { content: "{\"answer\":" } }] });
    const result = await chatDraft({ url: "https://example.test", apiKey: "k", model: "m/n", instructions: "i", text: "t", output, maxTokens: 5, timeoutMs: 1_000, fetcher });
    expect(result.candidate).toBeUndefined();
  });
});
