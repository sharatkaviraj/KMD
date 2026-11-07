import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

vi.mock("server-only", () => ({}));

import { isFreeOpenRouterModel, NVIDIA_DEFAULT_MODEL, nvidiaConfig, nvidiaGuidedJson, OPENROUTER_DEFAULT_MODELS, openRouterConfig } from "@/lib/ai/config";
import { chatDraft, jsonFrom } from "@/modules/assist/data/chat-draft";
import { costUsd } from "@/modules/assist/domain/cost";
import { freeUsageOf } from "@/modules/assist/domain/free-usage";
import { readsAsHindi } from "@/modules/assist/domain/hindi-check";
import { assistChain, FREE_PROVIDERS, OPEN_TASKS, restAfter, type AvailableKeys } from "@/modules/assist/domain/routes";
import { ASSIST_TASKS, type AssistTaskId } from "@/modules/assist/domain/tasks";

/*
 * D-490, D-496: NVIDIA's free Nemotron, OpenRouter's free models and Gemini
 * Free write the open tasks first, and a test account's every text task;
 * never a real child's, family's or parent's details.
 */

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
    for (const task of ["note.polish", "note.sort", "text.translate", "message.reply", "child.summary", "class.digest", "remarks.class", "form.read"] as const) {
      expect(OPEN_TASKS.has(task)).toBe(false);
    }
  });

  it("opens class results and notices to all, and keeps the Today brief and call scripts on the paid models", () => {
    for (const task of ["results.summary", "message.write", "message.polish"] as const) {
      expect(assistChain(task, every)[0].provider).toBe("nvidia-free");
    }
    for (const task of ["brief.today", "call.script"] as const) expect(OPEN_TASKS.has(task)).toBe(false);
    // A class's results come from careful-tier Opus otherwise: the free models go first, the same Opus behind them.
    expect(assistChain("results.summary", every).map((s) => s.provider)).toEqual([
      "nvidia-free", "openrouter-free", "gemini-free", "anthropic", "openai", "gemini-paid",
    ]);
  });

  it("starts a test account's every text task on the free models, and never a photo", () => {
    for (const task of ids) {
      const chain = assistChain(task, every, {}, { testMaterial: true }).map((s) => s.provider);
      // The form someone photographs to try the reader is usually a real one, and a photo cannot be masked.
      if (task === "form.read") expect(chain).toEqual(["anthropic", "gemini-paid", "openai"]);
      else expect(chain.slice(0, 3)).toEqual(["nvidia-free", "openrouter-free", "gemini-free"]);
    }
  });
});

describe("freeUsageOf", () => {
  it("counts the free drafts and prices each at the Claude model its task would have started on", () => {
    const usage = freeUsageOf([
      { provider: "nvidia-free", task: "ask.answer", drafts: 3, inputTokens: 3_000, outputTokens: 600 },
      { provider: "openrouter-free", task: "results.summary", drafts: 1, inputTokens: 2_000, outputTokens: 500 },
      { provider: "anthropic", task: "note.polish", drafts: 4, inputTokens: 4_000, outputTokens: 800 },
      // Written before the provider was logged: counted in the month, never as free.
      { provider: null, task: "note.sort", drafts: 2, inputTokens: 1_000, outputTokens: 200 },
    ]);
    expect(usage).toMatchObject({ drafts: 4, all: 10 });
    expect(usage.providers).toEqual([
      { provider: "anthropic", drafts: 4 },
      { provider: "nvidia-free", drafts: 3 },
      { provider: "openrouter-free", drafts: 1 },
    ]);
    const expected = costUsd("claude-haiku-5-5", { input_tokens: 3_000, output_tokens: 600 })
      + costUsd("claude-opus-5-5", { input_tokens: 2_000, output_tokens: 500 });
    expect(expected).toBeGreaterThan(0);
    expect(usage.savedUsd).toBeCloseTo(expected, 6);
  });

  it("follows a tier's Claude override, and shows nothing saved when nothing was free", () => {
    const row = { provider: "gemini-free" as const, task: "ask.answer", drafts: 1, inputTokens: 1_000, outputTokens: 1_000 };
    expect(freeUsageOf([row], { VPPSONE_ASSIST_CLAUDE_QUICK: "claude-sonnet-5-5" }).savedUsd)
      .toBeCloseTo(costUsd("claude-sonnet-5-5", { input_tokens: 1_000, output_tokens: 1_000 }), 6);
    expect(freeUsageOf([{ ...row, provider: "openai" }])).toMatchObject({ drafts: 0, all: 1, savedUsd: 0 });
    expect(freeUsageOf([])).toEqual({ drafts: 0, all: 0, savedUsd: 0, providers: [] });
  });
});

describe("restAfter", () => {
  it("rests a free provider for as long as its failure lasts, and not at all for a bad answer", () => {
    expect(restAfter("quota")).toBe(60_000);
    expect(restAfter("quota_daily")).toBe(3_600_000);
    expect(restAfter("model")).toBe(1_800_000);
    expect(restAfter("credential")).toBe(1_800_000);
    expect(restAfter("timeout")).toBe(120_000);
    expect(restAfter("server")).toBe(120_000);
    expect(restAfter("schema")).toBe(0);
    expect(restAfter("other")).toBe(0);
  });
});

describe("readsAsHindi", () => {
  it("passes Hindi, and Hindi with English page names or slots in it", () => {
    expect(readsAsHindi({ title: "कक्षा 7-A गणित", steps: [{ minutes: 10, text: "ब्लैकबोर्ड पर सवाल लिखें।" }], tip: "शांति रखें।" }, { language: "hi" })).toBe(true);
    expect(readsAsHindi({ answer: "Students पेज पर जाकर बच्चे की प्रोफ़ाइल खोलें।", links: ["/students"], search: null }, { language: "hi" })).toBe(true);
    expect(readsAsHindi({ points: ["आज <<absent_today>> बच्चे अनुपस्थित हैं।"] }, { language: "hi" })).toBe(true);
    expect(readsAsHindi({ remarks: [{ ref: "C1", en: "Steady work.", hi: "नियमित काम।" }] }, {})).toBe(true);
  });

  it("fails English or Roman letters where Hindi was asked for", () => {
    expect(readsAsHindi({ headline: "Today 14 classes have attendance marked.", points: ["37 children absent."] }, { language: "hi" })).toBe(false);
    expect(readsAsHindi({ tags: ["studies"], followUp: "next_monday", tidy: "aaj homework nahi kiya, ghar pe kuch pareshani hai" }, { language: "hi" })).toBe(false);
    expect(readsAsHindi({ title: "Notice", hi: "Dear parents, school is closed.", en: "Dear parents, school is closed." }, {})).toBe(false);
  });

  it("leaves English and both-language answers alone", () => {
    expect(readsAsHindi({ answer: "Open Attendance." }, { language: "en" })).toBe(true);
    expect(readsAsHindi({ title: "Cover / कवर", steps: [], tip: "Keep calm / शांत रखें" }, { language: "both" })).toBe(true);
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

  it("holds only Super VL to the schema while it writes (Ultra stalled with it)", () => {
    expect(nvidiaGuidedJson(NVIDIA_DEFAULT_MODEL)).toBe(true);
    expect(nvidiaGuidedJson("nvidia/nemotron-3-ultra-550b-a55b")).toBe(false);
    expect(nvidiaGuidedJson("google/gemma-4-31b-it")).toBe(false);
  });
});

describe("OpenRouter defaults (D-496)", () => {
  it("are all free, Super VL first and a different company's model behind it", () => {
    expect(OPENROUTER_DEFAULT_MODELS[0]).toBe("nvidia/nemotron-3.5-super-vl:free");
    expect(OPENROUTER_DEFAULT_MODELS.some((m) => m.startsWith("google/"))).toBe(true);
    for (const model of OPENROUTER_DEFAULT_MODELS) expect(isFreeOpenRouterModel(model)).toBe(true);
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

  it("drops a model's thinking before looking for the answer", () => {
    expect(jsonFrom("<think>maybe {\"answer\":\"no\"}</think>\n{\"answer\":\"hi\"}")).toEqual({ answer: "hi" });
    expect(jsonFrom("<think>still thinking {\"answer\":")).toBeUndefined();
  });

  it("can hold the model to the task's schema, and passes thinking switches through", async () => {
    const fetcher = reply({ choices: [{ finish_reason: "stop", message: { content: "{\"answer\":\"hi\"}" } }] });
    await chatDraft({
      url: "https://example.test", apiKey: "k", model: "m/n", instructions: "i", text: "t", output, maxTokens: 50, timeoutMs: 1_000, fetcher,
      jsonSchema: true, jsonMode: true, extra: { chat_template_kwargs: { enable_thinking: false } },
    });
    const body = JSON.parse(String((fetcher as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls[0][1].body));
    expect(body.response_format).toMatchObject({ type: "json_schema", json_schema: { name: "draft", strict: true, schema: { type: "object", required: ["answer"] } } });
    expect(body.chat_template_kwargs).toEqual({ enable_thinking: false });
  });

  it("gives no candidate when the answer was cut off", async () => {
    const fetcher = reply({ choices: [{ finish_reason: "length", message: { content: "{\"answer\":" } }] });
    const result = await chatDraft({ url: "https://example.test", apiKey: "k", model: "m/n", instructions: "i", text: "t", output, maxTokens: 5, timeoutMs: 1_000, fetcher });
    expect(result.candidate).toBeUndefined();
  });
});
