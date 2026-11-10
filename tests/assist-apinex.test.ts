import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

vi.mock("server-only", () => ({}));
const saved = vi.hoisted(() => ({ checks: [] as unknown[] }));
vi.mock("@/modules/assist/data/settings", () => ({ saveFreeCheck: async (check: unknown) => void saved.checks.push(check) }));
vi.mock("@/modules/assist/data/run", async () => {
  const { APINEX_MODELS } = await import("@/modules/assist/domain/routes");
  return { apinexModels: () => APINEX_MODELS, taskInstructions: () => "Write the draft." };
});

import { APINEX_CATALOG_URL, APINEX_CHAT_URL, APINEX_MODELS_URL, apinexConfig, isFreeApinexModel } from "@/lib/ai/config";
import { chatDraft } from "@/modules/assist/data/chat-draft";
import { runFreeCheck } from "@/modules/assist/data/free-check";
import { apinexRefusal, cleanSaid, retryAfterSeconds } from "@/modules/assist/domain/apinex";
import { FREE_CHECK_BUDGET_MS, FREE_CHECK_PROBES, freeCheckRows, NOT_FREE_KEPT_MS, paced, readFreeCheck } from "@/modules/assist/domain/free-check";
import { failureOf } from "@/lib/ai/router";
import { modelName, providerOf } from "@/modules/assist/domain/overview";
import {
  APINEX_MODELS,
  APINEX_TIMEOUT_MS,
  assistChain,
  FREE_CHECK_BLOCKED_MS,
  FREE_CHECK_FRESH_MS,
  FREE_JOB,
  FREE_PROVIDERS,
  OPEN_TASKS,
  pickApinexModels,
  restsWholeProvider,
  type AvailableKeys,
  type FreeCheck,
  type FreeCheckResult,
} from "@/modules/assist/domain/routes";
import { ASSIST_TASKS, type AssistTaskId } from "@/modules/assist/domain/tasks";

/*
 * D-567: APInex's free models in the AI helper. Each kind of job has its own
 * order of free providers and its own APInex models; a check from the server
 * decides which of those models answer; and nothing about a real child ever
 * reaches them.
 */

const KEY = "sk-apx-test0000000000";
const every: AvailableKeys = {
  anthropic: true, openai: true, geminiPaidModel: "gemini-3.5-flash-lite", geminiFreeModel: "gemini-3.5-flash-lite",
  nvidiaModel: "nvidia/nemotron-3.5-super-vl", openRouterModel: "openrouter/free", apinexModels: APINEX_MODELS,
};
const ids = Object.keys(ASSIST_TASKS) as AssistTaskId[];
const NOW = Date.parse("2026-11-10T08:00:00Z");
const at = (msAgo: number) => new Date(NOW - msAgo).toISOString();
const ok = (model: string, probe: "writing" | "quick", ms: number): FreeCheckResult => ({ model, probe, ok: true, ms });
const bad = (model: string, probe: "writing" | "quick", problem: string, ms = 2_000): FreeCheckResult => ({ model, probe, ok: false, ms, problem });
/** The D-567 picks, kept as a fixed list so these tests do not move with the defaults. */
const PICKS = {
  quick: ["free/deepseek-v4.1-flash", "free/claude-sonnet-4.6"],
  writing: ["free/claude-sonnet-4.6", "free/glm-5.3"],
  careful: ["free/claude-opus-4.6", "free/claude-sonnet-4.6"],
} as const;
const instant = { gapMs: 0, sleep: async () => {} };

afterEach(() => {
  vi.unstubAllEnvs();
  saved.checks.length = 0;
});

describe("the APInex key", () => {
  it("is read from APINEX_API_KEY, or from the vault's FREE_API_KEY only when it is shaped like an APInex key", () => {
    expect(apinexConfig({})).toBeNull();
    expect(apinexConfig({ APINEX_API_KEY: ` ${KEY} ` })?.apiKey).toBe(KEY);
    expect(apinexConfig({ FREE_API_KEY: KEY })?.apiKey).toBe(KEY);
    expect(apinexConfig({ FREE_API_KEY: "AIza-some-other-free-key" })).toBeNull();
  });

  it("takes model overrides per job, free models only, at most three", () => {
    const config = apinexConfig({ APINEX_API_KEY: KEY, VPPSONE_APINEX_WRITING: "free/glm-5.3, paid/claude-opus, FREE/Kimi-K2.5,free/a,free/b", VPPSONE_APINEX_QUICK: "gpt-6" });
    expect(config?.overrides).toEqual({ writing: ["free/glm-5.3", "free/kimi-k2.5", "free/a"] });
    expect(isFreeApinexModel("free/claude-sonnet-4.6")).toBe(true);
    expect(isFreeApinexModel("claude-sonnet-4.6")).toBe(false);
    expect(isFreeApinexModel("free/../x")).toBe(false);
  });
});

describe("free providers per kind of job", () => {
  it("gives every text task a kind of job", () => {
    for (const task of ids) if (task !== "form.read") expect(FREE_JOB[task as Exclude<AssistTaskId, "form.read">]).toMatch(/^(quick|writing|careful)$/);
  });

  it("starts notices and summaries on APInex, two models at most, and quick jobs on NVIDIA", () => {
    expect(assistChain("message.write", every).map((s) => `${s.provider}:${s.model}`)).toEqual([
      "apinex-free:free/qwen-3.8-max", "apinex-free:free/gemini-3.8-flash",
      "nvidia-free:nvidia/nemotron-3.5-super-vl", "openrouter-free:openrouter/free", "gemini-free:gemini-3.5-flash-lite",
      expect.stringMatching(/^anthropic:/), expect.stringMatching(/^openai:/), expect.stringMatching(/^gemini-paid:/),
    ]);
    expect(assistChain("results.summary", every).slice(0, 3).map((s) => s.model)).toEqual(["free/deepseek-v4-pro-0813", "free/kimi-k3", "nvidia/nemotron-3.5-super-vl"]);
    expect(assistChain("cover.plan", every).slice(0, 3).map((s) => s.model)).toEqual(["nvidia/nemotron-3.5-super-vl", "free/deepseek-v4.1-flash", "free/glm-5.3-flash"]);
  });

  it("defaults only to models APInex does not bill on a $0 account (D-568)", () => {
    const billed = ["claude-sonnet-4.6", "claude-opus-4.6", "gemini-3.1-pro", "kimi-k2.8", "minimax-m3", "mimo-v2.6-flash", "mimo-v2.6-pro", "glm-5.3-flashx", "jev-1.13"];
    for (const model of Object.values(APINEX_MODELS).flat()) expect(billed.map((m) => `free/${m}`)).not.toContain(model);
  });

  it("gives each APInex stage its job's time limit", () => {
    const stages = (task: AssistTaskId) => assistChain(task, every).filter((s) => s.provider === "apinex-free").map((s) => s.timeoutMs);
    expect(stages("cover.plan")).toEqual([APINEX_TIMEOUT_MS.quick, APINEX_TIMEOUT_MS.quick]);
    expect(stages("message.write")).toEqual([APINEX_TIMEOUT_MS.writing, APINEX_TIMEOUT_MS.writing]);
    expect(stages("results.summary")).toEqual([APINEX_TIMEOUT_MS.careful, APINEX_TIMEOUT_MS.careful]);
  });

  it("never sends a real child's task or any photo to APInex", () => {
    for (const task of ids) {
      expect(assistChain(task, every).some((s) => FREE_PROVIDERS.has(s.provider))).toBe(OPEN_TASKS.has(task));
      const practice = assistChain(task, every, {}, { testMaterial: true });
      expect(practice.some((s) => s.provider === "apinex-free")).toBe(task !== "form.read");
    }
  });

  it("leaves the chain as it was without the key", () => {
    const without = { ...every, apinexModels: null };
    expect(assistChain("message.write", without).map((s) => s.provider).slice(0, 3)).toEqual(["nvidia-free", "openrouter-free", "gemini-free"]);
  });

  it("rests one APInex model for its own failures, and the whole of APInex for the account's", () => {
    expect(restsWholeProvider("apinex-free", "timeout")).toBe(false);
    expect(restsWholeProvider("apinex-free", "model")).toBe(false);
    // The per-minute limit counts the whole account (D-568).
    for (const problem of ["credential", "permission", "billing", "quota_daily", "quota", "network"] as const) expect(restsWholeProvider("apinex-free", problem)).toBe(true);
    expect(restsWholeProvider("nvidia-free", "timeout")).toBe(true);
  });
});

describe("which APInex models a job uses after the check", () => {
  const models = ["free/claude-opus-4.6", "free/claude-sonnet-4.6", "free/deepseek-v4.1-flash", "free/glm-5.3", "free/kimi-k2.5"];
  const check = (results: FreeCheckResult[], extra: Partial<FreeCheck> = {}): FreeCheck => ({ at: at(60_000), blocked: false, models, results, ...extra });

  it("uses the job's own list without a recent check", () => {
    expect(pickApinexModels("writing", PICKS.writing, null, NOW)).toEqual(["free/claude-sonnet-4.6", "free/glm-5.3"]);
    const old = check([bad("free/claude-sonnet-4.6", "writing", "timeout")], { at: at(FREE_CHECK_FRESH_MS + 1) });
    expect(pickApinexModels("writing", PICKS.writing, old, NOW)).toEqual(["free/claude-sonnet-4.6", "free/glm-5.3"]);
  });

  it("drops a model that failed, was too slow or is no longer listed", () => {
    const c = check([bad("free/claude-sonnet-4.6", "writing", "not_hindi"), ok("free/glm-5.3", "writing", 9_000), ok("free/kimi-k2.5", "writing", 4_000)]);
    expect(pickApinexModels("writing", PICKS.writing, c, NOW)).toEqual(["free/glm-5.3"]);
    const slow = check([ok("free/deepseek-v4.1-flash", "quick", APINEX_TIMEOUT_MS.quick + 1), ok("free/claude-sonnet-4.6", "quick", 3_000)]);
    expect(pickApinexModels("quick", PICKS.quick, slow, NOW)).toEqual(["free/claude-sonnet-4.6"]);
    const gone = check([], { models: ["free/glm-5.3"] });
    expect(pickApinexModels("writing", PICKS.writing, gone, NOW)).toEqual(["free/glm-5.3"]);
  });

  it("keeps the job's models when the check met only the account's check-in or limits (D-569)", () => {
    const waiting = check(models.flatMap((m) => [bad(m, "writing", "check_in"), bad(m, "quick", "quota_daily")]));
    expect(pickApinexModels("writing", PICKS.writing, waiting, NOW)).toEqual(["free/claude-sonnet-4.6", "free/glm-5.3"]);
    expect(pickApinexModels("quick", PICKS.quick, waiting, NOW)).toEqual(PICKS.quick.slice(0, 2));
  });

  it("keeps a model a rate limit stopped from being checked", () => {
    const c = check([bad("free/claude-sonnet-4.6", "writing", "quota"), ok("free/glm-5.3", "writing", 5_000)]);
    expect(pickApinexModels("writing", PICKS.writing, c, NOW)).toEqual(["free/claude-sonnet-4.6", "free/glm-5.3"]);
  });

  it("falls back to the fastest models that passed when none of the list did", () => {
    const c = check([
      bad("free/claude-sonnet-4.6", "writing", "timeout"), bad("free/glm-5.3", "writing", "schema"),
      ok("free/kimi-k2.5", "writing", 6_000), ok("free/deepseek-v4.1-flash", "writing", 3_000), ok("free/claude-opus-4.6", "writing", 20_000),
    ]);
    expect(pickApinexModels("writing", PICKS.writing, c, NOW)).toEqual(["free/deepseek-v4.1-flash", "free/kimi-k2.5"]);
    // The careful job is judged on the writing probe, with its own longer limit.
    expect(pickApinexModels("careful", ["free/glm-5.3"], c, NOW)).toEqual(["free/deepseek-v4.1-flash", "free/kimi-k2.5"]);
  });

  it("lets a quick job read a model's notice until its plan is checked (D-568)", () => {
    const c = check([ok("free/deepseek-v4.1-flash", "writing", 4_000), bad("free/claude-sonnet-4.6", "writing", "not_free", 200)]);
    expect(pickApinexModels("quick", PICKS.quick, c, NOW)).toEqual(["free/deepseek-v4.1-flash"]);
    const slowNotice = check([ok("free/deepseek-v4.1-flash", "writing", APINEX_TIMEOUT_MS.quick + 1), ok("free/kimi-k2.5", "writing", 3_000)]);
    expect(pickApinexModels("quick", ["free/deepseek-v4.1-flash"], slowNotice, NOW)).toEqual(["free/kimi-k2.5"]);
    // The plan's own result wins once there is one.
    const both = check([bad("free/deepseek-v4.1-flash", "writing", "not_hindi"), ok("free/deepseek-v4.1-flash", "quick", 2_000)]);
    expect(pickApinexModels("quick", ["free/deepseek-v4.1-flash"], both, NOW)).toEqual(["free/deepseek-v4.1-flash"]);
  });

  it("keeps APInex out for six hours after its firewall turned the server away", () => {
    const blocked = check([], { blocked: true, models: [] });
    expect(pickApinexModels("writing", PICKS.writing, blocked, NOW)).toEqual([]);
    expect(assistChain("message.write", every, {}, { freeCheck: blocked, now: NOW })[0].provider).toBe("nvidia-free");
    const later = { ...blocked, at: at(FREE_CHECK_BLOCKED_MS + 1) };
    expect(pickApinexModels("writing", PICKS.writing, later, NOW)).toEqual(["free/claude-sonnet-4.6", "free/glm-5.3"]);
  });
});

describe("the stored check", () => {
  const good: FreeCheck = { at: at(0), blocked: false, models: ["free/glm-5.3"], results: [ok("free/glm-5.3", "writing", 4_200), bad("free/glm-5.3", "quick", "timeout", 10_000)] };

  it("reads a check back, and refuses anything that is not one", () => {
    expect(readFreeCheck(good)).toEqual(good);
    expect(readFreeCheck(null)).toBeNull();
    expect(readFreeCheck({ ...good, models: ["gpt-6"] })).toBeNull();
    expect(readFreeCheck({ ...good, results: [{ ...good.results[0], problem: "The model said: …" }] })).toBeNull();
    expect(readFreeCheck({ ...good, at: "yesterday" })).toBeNull();
  });

  it("lists the models in use first, then the others that answered, fastest first", () => {
    const check: FreeCheck = {
      at: at(0), blocked: false,
      models: ["free/a", "free/b", "free/c", "free/claude-sonnet-4.6", "free/glm-5.3"],
      results: [ok("free/a", "writing", 9_000), ok("free/b", "writing", 2_000), bad("free/c", "writing", "schema"), ok("free/claude-sonnet-4.6", "writing", 5_000), ok("free/glm-5.3", "quick", 4_000)],
    };
    const rows = freeCheckRows(check, PICKS, NOW);
    expect(rows.map((r) => r.model)).toEqual(["free/claude-sonnet-4.6", "free/glm-5.3", "free/b", "free/a", "free/c"]);
    expect(rows[0].jobs).toEqual(["writing", "careful", "quick"]);
    expect(rows[0].writing?.ms).toBe(5_000);
    expect(rows[1].quick?.ok).toBe(true);
  });

  it("puts models APInex bills, and ones that cannot write, below the ones that are only waiting", () => {
    const check: FreeCheck = {
      at: at(0), blocked: false,
      models: ["free/a-billed", "free/b-decides", "free/c-waits"],
      results: [bad("free/a-billed", "writing", "not_free"), bad("free/b-decides", "writing", "decision"), bad("free/c-waits", "writing", "check_in")],
    };
    expect(freeCheckRows(check, PICKS, NOW).map((r) => r.model)).toEqual(["free/c-waits", "free/a-billed", "free/b-decides"]);
  });

  it("keeps APInex's own words for a refusal, short and with nothing shaped like a key", () => {
    const c: FreeCheck = { ...good, results: [{ ...bad("free/glm-5.3", "writing", "not_free", 200), httpStatus: 402, said: "Insufficient balance" }] };
    expect(readFreeCheck(c)).toEqual(c);
    expect(readFreeCheck({ ...c, results: [{ ...c.results[0], said: "x".repeat(161) }] })).toBeNull();
  });
});

describe("a paced run", () => {
  function clock() {
    let t = 0;
    const starts: number[] = [];
    return { now: () => t, sleep: async (ms: number) => void (t += ms), starts, tick: (ms: number) => void (t += ms), at: () => t };
  }

  it("runs a few at a time and starts none once told to stop", async () => {
    let running = 0, most = 0, done = 0;
    const out = await paced([1, 2, 3, 4, 5, 6, 7], { parallel: 3, gapMs: 0, stop: () => done >= 4, now: Date.now, sleep: async () => {} }, async (n) => {
      running++; most = Math.max(most, running);
      await new Promise((r) => setTimeout(r, 5));
      running--; done++;
      return { result: n * 2 };
    });
    expect(most).toBeLessThanOrEqual(3);
    expect(out.length).toBeGreaterThanOrEqual(4);
    expect(out.length).toBeLessThan(7);
  });

  it("starts each probe at least the gap after the one before", async () => {
    const c = clock();
    const out = await paced([1, 2, 3, 4, 5, 6, 7], { parallel: 1, gapMs: 4_000, stop: () => c.at() > 13_000, now: c.now, sleep: c.sleep }, async (n) => {
      c.starts.push(c.at());
      return { result: n };
    });
    expect(c.starts).toEqual([0, 4_000, 8_000, 12_000]);
    expect(out).toEqual([1, 2, 3, 4]);
  });

  it("waits as long as a 429 asks, tries once more, and queues the work an answer leads to", async () => {
    const c = clock();
    const seen: string[] = [];
    const out = await paced(["a", "b"], { parallel: 1, gapMs: 1_000, stop: () => false, now: c.now, sleep: c.sleep }, async (item) => {
      seen.push(`${item}@${c.at()}`);
      if (item === "b") return { result: `${item}:busy`, retryAfterMs: 20_000 };
      return { result: `${item}:ok`, then: item === "a" ? ["a2"] : [] };
    });
    // b is tried twice, the second time 20 s later; its second answer stands. a's follow-up runs after b.
    expect(seen).toEqual(["a@0", "b@1000", "b@21000", "a2@22000"]);
    expect(out).toEqual(["a:ok", "b:busy", "a2:ok"]);
  });
});

describe("APInex's refusals", () => {
  it("tells a model that is billed on the account from the day's free allowance and the minute's limit", () => {
    expect(apinexRefusal(402, "Insufficient balance")).toBe("not_free");
    expect(apinexRefusal(402, "API key spend limit reached")).toBe("not_free");
    expect(apinexRefusal(402, "Free daily limit reached. Buy a subscription to continue: https://apinex.bond/subscriptions")).toBe("quota_daily");
    expect(apinexRefusal(429, "Rate limit exceeded. Max 15 requests per minute for this account. Retry in 4s.")).toBe("quota");
    expect(apinexRefusal(402, "Daily check-in required to use free models. Please visit https://apinex.bond/overview to check in.")).toBe("check_in");
    expect(apinexRefusal(402, undefined)).toBeNull();
    expect(apinexRefusal(500, "Insufficient balance")).toBeNull();
  });

  it("keeps a short message and takes out anything shaped like a key", () => {
    expect(cleanSaid("Invalid key sk-apx-abcdef0123456789 for free/glm-5.3")).toBe("Invalid key … for free/glm-5.3");
    expect(cleanSaid("token " + "A".repeat(40))).toBe("token …");
    expect(cleanSaid("  Insufficient\n balance ")).toBe("Insufficient balance");
    expect(cleanSaid("limit ".repeat(60))?.length).toBe(140);
    expect(cleanSaid(42)).toBeUndefined();
    expect(retryAfterSeconds("4")).toBe(4);
    expect(retryAfterSeconds("soon")).toBeUndefined();
    expect(retryAfterSeconds("9999")).toBeUndefined();
  });

  it("lets a caller that knows what a refusal meant say so", () => {
    expect(failureOf(Object.assign(new Error("Free model unavailable"), { status: 402 })).problem).toBe("billing");
    expect(failureOf(Object.assign(new Error("Free model unavailable"), { status: 402, problem: "model" }))).toEqual({ httpStatus: 402, problem: "model" });
    expect(failureOf(Object.assign(new Error("x"), { status: 402, problem: "nonsense" })).problem).toBe("billing");
  });
});

describe("chatDraft against APInex", () => {
  const output = z.object({ answer: z.string() });
  const opts = { url: APINEX_CHAT_URL, apiKey: KEY, model: "free/glm-5.3", instructions: "i", text: "t", output, maxTokens: 50, timeoutMs: 1_000 };

  it("calls a firewall's web page a firewall, not a refused key", async () => {
    const fetcher = vi.fn(async () => new Response("<html>Just a moment…</html>", { status: 403, headers: { "content-type": "text/html" } })) as unknown as typeof fetch;
    await expect(chatDraft({ ...opts, fetcher })).rejects.toMatchObject({ status: 403, firewall: true });
    const json403 = vi.fn(async () => new Response(JSON.stringify({ error: { code: "forbidden" } }), { status: 403, headers: { "content-type": "application/json" } })) as unknown as typeof fetch;
    await expect(chatDraft({ ...opts, fetcher: json403 })).rejects.not.toMatchObject({ firewall: true });
  });

  it("carries APInex's words and a 429's Retry-After on the error, never the key", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ error: { message: `Insufficient balance for ${KEY}`, type: "billing_error" } }), { status: 402, headers: { "content-type": "application/json" } })) as unknown as typeof fetch;
    const error = (await chatDraft({ ...opts, fetcher }).then(() => null, (e: unknown) => e)) as { status: number; said?: string; message: string };
    expect(error).toMatchObject({ status: 402, said: "Insufficient balance for …" });
    expect(JSON.stringify(error) + error.message).not.toContain(KEY);
    const busy = vi.fn(async () => new Response(JSON.stringify({ error: { message: "Rate limit exceeded." } }), { status: 429, headers: { "content-type": "application/json", "retry-after": "7" } })) as unknown as typeof fetch;
    await expect(chatDraft({ ...opts, fetcher: busy })).rejects.toMatchObject({ status: 429, retryAfterSec: 7 });
  });

  it("takes Anthropic's end_turn as finished", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ choices: [{ finish_reason: "end_turn", message: { content: "{\"answer\":\"हाँ\"}" } }] }), { headers: { "content-type": "application/json" } })) as unknown as typeof fetch;
    expect((await chatDraft({ ...opts, fetcher })).candidate).toEqual({ answer: "हाँ" });
  });
});

describe("the free models check", () => {
  const notice = { title: "शुक्रवार को अवकाश", hi: "प्रिय {parent}, स्थानीय अवकाश के कारण शुक्रवार को विद्यालय बंद रहेगा। शनिवार को कक्षाएँ सामान्य समय पर लगेंगी।", en: "Dear {parent}, school stays closed on Friday for a local holiday. Classes start again on Saturday at the usual time." };
  const plan = { title: "विज्ञान का दोहराव खेल", steps: [{ minutes: 10, text: "बोर्ड पर पाँच प्रश्न लिखें।" }, { minutes: 20, text: "बच्चे जोड़ियों में उत्तर लिखें।" }, { minutes: 10, text: "उत्तर मिलकर जाँचें।" }], tip: "शांत रहकर हर जोड़ी के पास जाएँ।" };
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  const answer = (value: unknown) => json({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify(value) } }] });

  function fakeApinex(listed: string[], behave: (model: string, probe: "writing" | "quick") => Response, catalog?: () => Response) {
    const calls: { url: string; model?: string; auth?: string }[] = [];
    const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
      const auth = new Headers(init?.headers).get("authorization") ?? undefined;
      if (url === APINEX_MODELS_URL) {
        calls.push({ url, auth });
        return json({ data: listed.map((id) => ({ id })) });
      }
      if (url === APINEX_CATALOG_URL) {
        calls.push({ url, auth });
        return catalog ? catalog() : new Response("not found", { status: 404 });
      }
      const body = JSON.parse(String(init?.body)) as { model: string; messages: { content: string }[] };
      calls.push({ url, model: body.model, auth });
      const probe = body.messages[1].content.includes("Class 7 A") ? "quick" : "writing";
      return behave(body.model, probe);
    }) as unknown as typeof fetch;
    return { fetcher, calls };
  }

  it("asks every free model for an invented notice and plan, keeps only names, times and problem words", async () => {
    vi.stubEnv("APINEX_API_KEY", KEY);
    const listed = ["free/claude-sonnet-4.6", "free/glm-5.3", "free/kimi-k2.5", "paid/claude-opus-4.6"];
    const { fetcher, calls } = fakeApinex(listed, (model, probe) => {
      if (model === "free/kimi-k2.5") return probe === "writing" ? answer({ ...notice, hi: notice.en }) : json({ error: { code: "rate_limited" } }, 429);
      if (model === "free/glm-5.3" && probe === "quick") return answer({ nope: true });
      return answer(probe === "writing" ? notice : plan);
    });
    const outcome = await runFreeCheck(fetcher, () => NOW, instant);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    const { check } = outcome;
    expect(check.blocked).toBe(false);
    expect(check.models).toEqual(["free/claude-sonnet-4.6", "free/glm-5.3", "free/kimi-k2.5"]);
    const of = (model: string, probe: string) => check.results.find((r) => r.model === model && r.probe === probe);
    expect(of("free/claude-sonnet-4.6", "writing")).toMatchObject({ ok: true });
    expect(of("free/claude-sonnet-4.6", "quick")).toMatchObject({ ok: true });
    expect(of("free/glm-5.3", "quick")).toMatchObject({ ok: false, problem: "schema" });
    expect(of("free/kimi-k2.5", "writing")).toMatchObject({ ok: false, problem: "not_hindi" });
    expect(of("free/kimi-k2.5", "quick")).toMatchObject({ ok: false, problem: "quota", httpStatus: 429 });
    // The models One prefers go first; a paid model is never asked; every call carries the key.
    expect(calls.filter((c) => c.model).map((c) => c.model)[0]).toBe("free/claude-sonnet-4.6");
    expect(calls.some((c) => c.model?.startsWith("paid/"))).toBe(false);
    expect(calls.filter((c) => c.url !== APINEX_CATALOG_URL).every((c) => c.auth === `Bearer ${KEY}`)).toBe(true);
    // What is kept is what the settings page reads back: no answer text anywhere.
    expect(readFreeCheck(saved.checks[0])).toEqual(check);
    expect(JSON.stringify(saved.checks[0])).not.toMatch(/विद्यालय|Saturday|बोर्ड/u);
  });

  it("asks a model APInex bills on the account for nothing more, and skips it for a week (D-568)", async () => {
    vi.stubEnv("APINEX_API_KEY", KEY);
    const listed = ["free/claude-sonnet-4.6", "free/glm-5.3", "free/kimi-k2.8"];
    const { fetcher, calls } = fakeApinex(listed, (model, probe) => {
      if (model === "free/claude-sonnet-4.6" || model === "free/kimi-k2.8") return json({ error: { message: "Insufficient balance", type: "billing_error" } }, 402);
      return answer(probe === "writing" ? notice : plan);
    });
    const first = await runFreeCheck(fetcher, () => NOW, instant);
    if (!first.ok) throw new Error("check failed");
    const of = (check: FreeCheck, model: string, probe: string) => check.results.find((r) => r.model === model && r.probe === probe);
    expect(of(first.check, "free/claude-sonnet-4.6", "writing")).toMatchObject({ ok: false, problem: "not_free", httpStatus: 402, said: "Insufficient balance" });
    // Not free reads the same for its plan, which is never asked for.
    expect(of(first.check, "free/claude-sonnet-4.6", "quick")).toMatchObject({ problem: "not_free" });
    expect(calls.filter((c) => c.model === "free/claude-sonnet-4.6")).toHaveLength(1);
    expect(of(first.check, "free/glm-5.3", "quick")).toMatchObject({ ok: true });
    // The next check, two days on, carries the finding over and asks only the free model.
    calls.length = 0;
    const later = NOW + 2 * 24 * 60 * 60_000;
    const second = await runFreeCheck(fetcher, () => later, { ...instant, previous: first.check });
    if (!second.ok) throw new Error("check failed");
    expect(calls.filter((c) => c.model).map((c) => c.model)).toEqual(["free/glm-5.3", "free/glm-5.3"]);
    expect(of(second.check, "free/kimi-k2.8", "writing")).toMatchObject({ problem: "not_free" });
    // After a week it is asked again.
    calls.length = 0;
    await runFreeCheck(fetcher, () => NOW + NOT_FREE_KEPT_MS + 1, { ...instant, previous: first.check });
    expect(calls.some((c) => c.model === "free/kimi-k2.8")).toBe(true);
    // A job whose models are all billed falls back to the free one that answered.
    expect(pickApinexModels("writing", ["free/claude-sonnet-4.6", "free/kimi-k2.8"], first.check, NOW)).toEqual(["free/glm-5.3"]);
  });

  it("reads APInex's public catalogue first, and asks only the models it serves free (D-568)", async () => {
    vi.stubEnv("APINEX_API_KEY", KEY);
    const listed = ["free/claude-sonnet-4.6", "free/glm-5.3-flash", "free/jev-1.13", "free/qwen-3.8-max", "free/unlisted"];
    const { fetcher, calls } = fakeApinex(
      listed,
      (_model, probe) => answer(probe === "writing" ? notice : plan),
      () => json({ models: [
        { id: "free/claude-sonnet-4.6", provider: "Free", allowFree: false },
        { id: "free/glm-5.3-flash", provider: "Free", allowFree: true },
        { id: "free/jev-1.13", provider: "Free", allowFree: true, tags: ["decision", "free"] },
        { id: "free/qwen-3.8-max", provider: "Free", allowFree: true },
        { id: "gpt-paid", provider: "GPT", allowFree: true },
      ] }),
    );
    const outcome = await runFreeCheck(fetcher, () => NOW, { ...instant, previous: null });
    if (!outcome.ok) throw new Error("check failed");
    const of = (model: string, probe: string) => outcome.check.results.find((r) => r.model === model && r.probe === probe);
    // Billed, decision and uncatalogued models are recorded without a single call.
    const asked = new Set(calls.filter((c) => c.model).map((c) => c.model));
    expect([...asked].sort()).toEqual(["free/glm-5.3-flash", "free/qwen-3.8-max"]);
    for (const probe of ["writing", "quick"]) {
      expect(of("free/claude-sonnet-4.6", probe)).toMatchObject({ ok: false, problem: "not_free" });
      expect(of("free/unlisted", probe)).toMatchObject({ ok: false, problem: "not_free" });
      expect(of("free/jev-1.13", probe)).toMatchObject({ ok: false, problem: "decision" });
    }
    expect(of("free/qwen-3.8-max", "quick")).toMatchObject({ ok: true });
    // The catalogue is public: no key is sent for it.
    const catalogCall = calls.find((c) => c.url === APINEX_CATALOG_URL);
    expect(catalogCall && catalogCall.auth).toBeUndefined();
    expect(readFreeCheck(saved.checks[0])).toEqual(outcome.check);
  });

  it("asks every model when the catalogue cannot be read or names none of them", async () => {
    vi.stubEnv("APINEX_API_KEY", KEY);
    const listed = ["free/glm-5.3-flash", "free/qwen-3.8-max"];
    for (const catalog of [() => new Response("<html>wall</html>", { status: 403, headers: { "content-type": "text/html" } }), () => json({ models: [{ id: "free/other", allowFree: false }] }), () => json({ nope: 1 })]) {
      const { fetcher, calls } = fakeApinex(listed, (_model, probe) => answer(probe === "writing" ? notice : plan), catalog);
      const outcome = await runFreeCheck(fetcher, () => NOW, instant);
      expect(outcome.ok && outcome.check.results.every((r) => r.ok)).toBe(true);
      expect(new Set(calls.filter((c) => c.model).map((c) => c.model)).size).toBe(2);
    }
  });

  it("records a check-in still to do as the account's, with APInex's words, and asks no plan (D-569)", async () => {
    vi.stubEnv("APINEX_API_KEY", KEY);
    const said = "Daily check-in required to use free models. Please visit https://apinex.bond/overview to check in.";
    const { fetcher, calls } = fakeApinex(["free/glm-5.3-flash", "free/qwen-3.8-max"], () => json({ error: { message: said, type: "billing_error" } }, 402));
    const outcome = await runFreeCheck(fetcher, () => NOW, instant);
    if (!outcome.ok) throw new Error("check failed");
    expect(outcome.check.results).toHaveLength(2);
    for (const r of outcome.check.results) expect(r).toMatchObject({ probe: "writing", ok: false, problem: "check_in", httpStatus: 402, said });
    expect(calls.filter((c) => c.model)).toHaveLength(2);
    // Nothing about the models was learnt, so the jobs keep their usual ones.
    expect(pickApinexModels("writing", ["free/qwen-3.8-max", "free/glm-5.3-flash"], outcome.check, NOW)).toEqual(["free/qwen-3.8-max", "free/glm-5.3-flash"]);
  });

  it("probes only invented, nameless jobs", () => {
    expect(FREE_CHECK_PROBES.writing.task).toBe("message.write");
    expect(FREE_CHECK_PROBES.quick.task).toBe("cover.plan");
    for (const probe of Object.values(FREE_CHECK_PROBES)) expect(OPEN_TASKS.has(probe.task)).toBe(true);
  });

  it("records a firewall's page as blocked, and asks no model", async () => {
    vi.stubEnv("APINEX_API_KEY", KEY);
    const fetcher = vi.fn(async () => new Response("<html>Attention required</html>", { status: 403, headers: { "content-type": "text/html" } })) as unknown as typeof fetch;
    const outcome = await runFreeCheck(fetcher, () => NOW, instant);
    expect(outcome).toMatchObject({ ok: true, check: { blocked: true, models: [], results: [] } });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("says so when there is no key, or the key is refused", async () => {
    vi.stubEnv("APINEX_API_KEY", "");
    vi.stubEnv("FREE_API_KEY", "");
    expect(await runFreeCheck(vi.fn() as unknown as typeof fetch)).toEqual({ ok: false, problem: "no_key" });
    vi.stubEnv("APINEX_API_KEY", KEY);
    const refused = vi.fn(async () => json({ error: { code: "invalid_api_key" } }, 401)) as unknown as typeof fetch;
    expect(await runFreeCheck(refused, Date.now, instant)).toEqual({ ok: false, problem: "credential" });
    expect(saved.checks).toHaveLength(0);
  });

  it("starts no probe once its time is up", async () => {
    vi.stubEnv("APINEX_API_KEY", KEY);
    let clock = NOW;
    const { fetcher, calls } = fakeApinex(["free/claude-sonnet-4.6", "free/glm-5.3", "free/x", "free/y"], (_model, probe) => {
      clock += FREE_CHECK_BUDGET_MS / 2;
      return answer(probe === "writing" ? notice : plan);
    });
    const outcome = await runFreeCheck(fetcher, () => clock, instant);
    expect(outcome.ok && outcome.check.results.length).toBeLessThan(8);
    expect(calls.filter((c) => c.model).length).toBeLessThan(8);
  });
});

describe("APInex in the AI page's words", () => {
  it("names the provider and the model as a person reads them", () => {
    expect(providerOf("free/glm-5.3", null, true)).toBe("apinex-free");
    expect(modelName("free/claude-sonnet-4.6")).toBe("Claude Sonnet 4.6");
    expect(modelName("free/deepseek-v4.1-flash")).toBe("DeepSeek V4.1 Flash");
    expect(modelName("free/glm-5.3")).toBe("GLM 5.3");
  });
});
