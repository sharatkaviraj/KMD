import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { aiLanes, busiestStation, laneCounts, laneOf, stationCount, type BuiltinRoute } from "@/modules/assist/domain/ai-map";
import { buildOverview, daysFrom, EMPTY_RAW, helperResult, builtinResult, isFreeProvider, modelName, providerOf, readRaw, share, type OverviewRaw } from "@/modules/assist/domain/overview";
import type { AvailableKeys } from "@/modules/assist/domain/routes";
import { isAiView, TASK_WORDS } from "@/vx/screens/settings/ai/words";
import { ASSIST_TASKS } from "@/modules/assist/domain/tasks";

/* D-501: Settings → AI helper, one page for every AI job. Pure; no database, no key value. */

const keys: AvailableKeys = {
  anthropic: true,
  openai: true,
  geminiPaidModel: "gemini-3.5-flash",
  geminiFreeModel: "gemini-3.5-flash-lite",
  nvidiaModel: "nvidia/nemotron-3.5-super-vl",
  openRouterModel: "openrouter/free",
};
const live: BuiltinRoute = {
  mode: "live",
  claudeImageModel: "claude-sonnet-5-5",
  claudeVoiceModel: "claude-haiku-5-5",
  openAiListenModel: "gpt-transcribe",
  geminiPaidModel: "gemini-3.5-flash",
  geminiFreeModel: "gemini-3.5-flash-lite",
};

describe("providerOf", () => {
  it("keeps a logged provider", () => {
    expect(providerOf("claude-haiku-5-5", "anthropic", false)).toBe("anthropic");
    expect(providerOf("anything", "nvidia-free", true)).toBe("nvidia-free");
  });

  it("reads older rows' provider from the model (D-496 added the column)", () => {
    expect(providerOf("claude-haiku-5-5", null, false)).toBe("anthropic");
    expect(providerOf("gpt-6-luna", null, false)).toBe("openai");
    expect(providerOf("gpt-transcribe", "", false)).toBe("openai");
    expect(providerOf("nvidia/nemotron-3.5-super-vl", null, true)).toBe("nvidia-free");
    expect(providerOf("google/gemma-4-31b-it:free", null, true)).toBe("openrouter-free");
    expect(providerOf("openrouter/free", null, true)).toBe("openrouter-free");
    // A Gemini model that cost nothing was the free key; one that cost something was paid.
    expect(providerOf("gemini-3.5-flash-lite", null, true)).toBe("gemini-free");
    expect(providerOf("gemini-3.5-flash-lite", null, false)).toBe("gemini-paid");
    expect(providerOf(null, null, false)).toBeNull();
    expect(providerOf("mystery", "not-a-provider", false)).toBeNull();
  });

  it("knows which are free", () => {
    expect(isFreeProvider("nvidia-free")).toBe(true);
    expect(isFreeProvider("openrouter-free")).toBe(true);
    expect(isFreeProvider("gemini-free")).toBe(true);
    expect(isFreeProvider("anthropic")).toBe(false);
    expect(isFreeProvider("gemini-paid")).toBe(false);
    expect(isFreeProvider(null)).toBe(false);
  });
});

describe("modelName", () => {
  it("names a model the way a person reads it", () => {
    expect(modelName("claude-haiku-5-5")).toBe("Claude Haiku 5.5");
    expect(modelName("claude-opus-5-5")).toBe("Claude Opus 5.5");
    expect(modelName("nvidia/nemotron-3.5-super-vl")).toBe("Nemotron 3.5 Super");
    expect(modelName("google/gemma-4-31b-it:free")).toBe("Gemma 4 31B");
    expect(modelName("gemini-3.5-flash-lite")).toBe("Gemini 3.5 Flash-Lite");
    expect(modelName("gpt-transcribe")).toBe("GPT Transcribe");
    expect(modelName("openrouter/free")).toBe("OpenRouter's pick");
    expect(modelName("")).toBe("—");
    expect(modelName(null)).toBe("—");
  });
});

describe("results", () => {
  it("says what happened to a written draft", () => {
    expect(helperResult("drafted", "kept")).toBe("kept");
    expect(helperResult("drafted", "edited")).toBe("edited");
    expect(helperResult("drafted", "discarded")).toBe("unused");
    expect(helperResult("drafted", null)).toBe("open");
    expect(helperResult("failed", null)).toBe("failed");
    expect(helperResult("refused", null)).toBe("failed");
  });

  it("says what happened to a photo or voice job", () => {
    expect(builtinResult("applied", false)).toBe("kept");
    expect(builtinResult("applied", true)).toBe("edited");
    expect(builtinResult("discarded", false)).toBe("unused");
    expect(builtinResult("proposed", false)).toBe("open");
    expect(builtinResult("failed", false)).toBe("failed");
  });
});

describe("readRaw", () => {
  it("keeps only well-formed rows", () => {
    const raw = readRaw({
      helper: [{ task: "note.sort", n: 2 }, { task: 3, n: 1 }, { task: "x" }, null, "junk"],
      builtin: [{ task: "voice", n: 1 }],
      tries: [{ task: "voice", n: 2 }, { n: "2" }],
      days: [{ day: "2026-11-01", n: 1 }, { n: 1 }],
      recent: [{ at: "2026-11-07T10:00:00Z", task: "voice" }, { at: 1, task: "voice" }],
    });
    expect(raw.helper).toHaveLength(1);
    expect(raw.builtin).toHaveLength(1);
    expect(raw.tries).toHaveLength(1);
    expect(raw.days).toHaveLength(1);
    expect(raw.recent).toHaveLength(1);
  });

  it("survives nothing at all", () => {
    expect(readRaw(null)).toEqual(EMPTY_RAW);
    expect(readRaw("nope")).toEqual(EMPTY_RAW);
  });
});

describe("daysFrom", () => {
  it("lists every day from the first of the month to today", () => {
    expect(daysFrom("2026-11-01", "2026-11-03")).toEqual(["2026-11-01", "2026-11-02", "2026-11-03"]);
    expect(daysFrom("2026-11-05", "2026-11-01")).toEqual([]);
  });
});

describe("buildOverview", () => {
  const raw: OverviewRaw = {
    helper: [
      { task: "note.sort", model: "claude-haiku-5-5", provider: "anthropic", outcome: "drafted", decision: "kept", test: false, n: 10, cost_usd: 0.1, input_tokens: 1000, output_tokens: 500 },
      { task: "note.sort", model: "claude-haiku-5-5", provider: null, outcome: "drafted", decision: "discarded", test: false, n: 2, cost_usd: 0.02, input_tokens: 100, output_tokens: 50 },
      { task: "ask.answer", model: "nvidia/nemotron-3.5-super-vl", provider: "nvidia-free", outcome: "drafted", decision: null, test: true, n: 5, cost_usd: 0, input_tokens: 5000, output_tokens: 1000 },
      { task: "ask.answer", model: "claude-haiku-5-5", provider: "anthropic", outcome: "failed", decision: null, test: false, n: 1, cost_usd: 0, input_tokens: 0, output_tokens: 0 },
    ],
    builtin: [
      { task: "voice", model: "claude-haiku-5-5", provider: "anthropic", status: "applied", edited: true, test: false, n: 3, cost_inr: 1.5 },
      { task: "marks-photo", model: null, provider: null, status: "failed", edited: false, test: false, n: 1, cost_inr: 0 },
    ],
    tries: [
      { task: "voice", provider: "openai", model: "gpt-transcribe", outcome: "ok", n: 3, cost_inr: 0.6 },
      { task: "voice", provider: "anthropic", model: "claude-haiku-5-5", outcome: "ok", n: 3, cost_inr: 0.9 },
    ],
    days: [
      { day: "2026-11-02", kind: "helper", provider: "nvidia-free", model: "x", zero_cost: true, n: 5 },
      { day: "2026-11-02", kind: "helper", provider: null, model: "claude-haiku-5-5", zero_cost: false, n: 12 },
      { day: "2026-11-09", kind: "helper", provider: "anthropic", model: "x", zero_cost: false, n: 99 },
    ],
    recent: [
      {
        at: "2026-11-03T05:00:00Z", kind: "builtin", task: "voice", model: "claude-haiku-5-5", provider: "anthropic", outcome: null, decision: null, status: "applied",
        cost_usd: null, cost_inr: 1.5, test: false, who: "Teacher",
        attempts: [{ provider: "gemini-free", model: "gemini-3.5-flash-lite", outcome: "unavailable", problem: "quota_daily", costInr: 0 }, { provider: "anthropic", model: "claude-haiku-5-5", outcome: "ok", costInr: 0.5 }],
      },
      { at: "2026-11-03T04:00:00Z", kind: "helper", task: "note.sort", model: "claude-haiku-5-5", provider: null, outcome: "drafted", decision: "kept", status: null, cost_usd: 0.01, cost_inr: null, test: false, who: null, attempts: null },
    ],
  };
  const o = buildOverview(raw, { inrPerUsd: 90, from: "2026-11-01", today: "2026-11-03" });

  it("counts answered jobs of both kinds, and failures apart", () => {
    expect(o.jobs).toBe(10 + 2 + 5 + 3);
    expect(o.failed).toBe(1 + 1);
    expect(o.freeJobs).toBe(5);
    expect(o.testJobs).toBe(5);
  });

  it("turns dollars into rupees and charges photo and voice per try", () => {
    expect(o.helperCostUsd).toBeCloseTo(0.12, 6);
    expect(o.builtinCostInr).toBeCloseTo(1.5, 6);
    expect(o.costInr).toBeCloseTo(0.12 * 90 + 1.5, 4);
    const openai = o.providers.find((p) => p.provider === "openai");
    expect(openai?.jobs).toBe(0);
    expect(openai?.costInr).toBeCloseTo(0.6, 6);
  });

  it("prices the free drafts at their tier's Claude model, as an estimate", () => {
    expect(o.savedInr).toBeGreaterThan(0);
  });

  it("groups by kind of job, with who answered", () => {
    const sort = o.tasks.find((t) => t.task === "note.sort")!;
    expect(sort.kind).toBe("helper");
    expect(sort.jobs).toBe(12);
    expect(sort.results.kept).toBe(10);
    expect(sort.results.unused).toBe(2);
    expect(sort.providers).toEqual([{ provider: "anthropic", jobs: 12 }]);
    const voice = o.tasks.find((t) => t.task === "voice")!;
    expect(voice.kind).toBe("builtin");
    expect(voice.results.edited).toBe(3);
    expect(o.tasks.find((t) => t.task === "marks-photo")?.failed).toBe(1);
  });

  it("counts a listening model's good tries as heard, never as 0 answered", () => {
    const listen = buildOverview(
      {
        ...EMPTY_RAW,
        builtin: [{ task: "voice", model: "claude-haiku-5-5", provider: "anthropic", status: "applied", edited: false, test: false, n: 2, cost_inr: 0.4 }],
        tries: [
          { task: "voice", provider: "openai", model: "gpt-transcribe", outcome: "ok", n: 2, cost_inr: 0.1 },
          { task: "voice", provider: "openai", model: "gpt-transcribe", outcome: "unavailable", n: 1, cost_inr: 0 },
          { task: "voice", provider: "anthropic", model: "claude-haiku-5-5", outcome: "ok", n: 2, cost_inr: 0.3 },
        ],
      },
      { inrPerUsd: 90, from: "2026-11-01", today: "2026-11-03" },
    );
    const ear = listen.models.find((m) => m.model === "gpt-transcribe")!;
    expect([ear.answered, ear.heard, ear.tries]).toEqual([0, 2, 3]);
    const claude = listen.models.find((m) => m.model === "claude-haiku-5-5")!;
    expect([claude.answered, claude.heard]).toEqual([2, 0]);
  });

  it("says which count in a station's sheet is this road's and which is every road's", () => {
    const flow = readFileSync("src/vx/screens/settings/ai/ai-flow.tsx", "utf8");
    expect(flow).toContain("here={stationCount(open.station, counts[open.lane])}");
    expect(flow).toContain("W.onThisRoad(here)");
    expect(flow).toContain("W.everyRoad");
  });

  it("fills every day of the month so far, free and paid apart", () => {
    expect(o.days.map((d) => d.day)).toEqual(["2026-11-01", "2026-11-02", "2026-11-03"]);
    expect(o.days[1]).toEqual({ day: "2026-11-02", free: 5, paid: 12 });
  });

  it("keeps each try of a recent photo or voice job, in order", () => {
    expect(o.recent[0].trail.map((s) => [s.provider, s.ok, s.problem])).toEqual([
      ["gemini-free", false, "quota_daily"],
      ["anthropic", true, null],
    ]);
    expect(o.recent[1].trail).toEqual([{ provider: "anthropic", model: "claude-haiku-5-5", ok: true, problem: null }]);
    expect(o.recent[1].costInr).toBeCloseTo(0.9, 6);
  });

  it("is all zeros for an empty month", () => {
    const empty = buildOverview(EMPTY_RAW, { inrPerUsd: 90, from: "2026-11-01", today: "2026-11-01" });
    expect(empty.jobs).toBe(0);
    expect(empty.costInr).toBe(0);
    expect(empty.days).toEqual([{ day: "2026-11-01", free: 0, paid: 0 }]);
  });

  it("shares safely", () => {
    expect(share(1, 4)).toBe(25);
    expect(share(1, 0)).toBe(0);
  });
});

describe("aiLanes", () => {
  const lanes = aiLanes(keys, {}, live);
  const lane = (id: string) => lanes.find((l) => l.id === id)!;

  it("draws four roads", () => {
    expect(lanes.map((l) => l.id)).toEqual(["open", "people", "photo", "voice"]);
  });

  it("starts the open road on the free models, in the order the helper tries them", () => {
    expect(lane("open").stations.map((s) => s.provider)).toEqual(["nvidia-free", "openrouter-free", "gemini-free", "anthropic", "openai", "gemini-paid"]);
    expect(lane("open").stations.every((s) => s.locked === null)).toBe(true);
  });

  it("locks the free models out of drafts about a child: drawn, for test accounts only", () => {
    const people = lane("people").stations;
    const free = people.filter((s) => s.free);
    expect(free.length).toBeGreaterThan(0);
    expect(free.every((s) => s.locked === "test")).toBe(true);
    expect(people.filter((s) => !s.free).every((s) => s.locked === null)).toBe(true);
    // Every paid tier's Claude model is on the road.
    expect(people.find((s) => s.provider === "anthropic")?.models.length).toBeGreaterThan(1);
  });

  it("never lets a photo reach a free model", () => {
    const photo = lane("photo").stations;
    expect(photo.filter((s) => s.free).every((s) => s.locked === "never")).toBe(true);
    expect(lane("photo").tasks).toEqual(["form.read", "marks-photo", "substitution-photo"]);
  });

  it("pairs OpenAI's listening with Claude's understanding for voice", () => {
    const voice = lane("voice").stations;
    expect(voice[0]).toMatchObject({ provider: "openai", partner: { provider: "anthropic", model: "claude-haiku-5-5" } });
    expect(voice.find((s) => s.provider === "gemini-free")?.locked).toBe("test");
    expect(voice.at(-1)?.provider).toBe("gemini-paid");
  });

  it("marks photo and voice off when built-in AI is off", () => {
    const off = aiLanes(keys, {}, { ...live, mode: "off" });
    expect(off.find((l) => l.id === "voice")).toMatchObject({ off: true, stations: [] });
    expect(off.find((l) => l.id === "photo")?.tasks).toEqual(["form.read"]);
  });

  it("puts every job on a road, and every job has words", () => {
    for (const task of [...Object.keys(ASSIST_TASKS), "marks-photo", "substitution-photo", "voice"]) {
      expect(["open", "people", "photo", "voice"]).toContain(laneOf(task));
      expect(TASK_WORDS[task], task).toBeDefined();
    }
    expect(laneOf("form.read")).toBe("photo");
    expect(laneOf("note.sort")).toBe("people");
    expect(laneOf("ask.answer")).toBe("open");
  });
});

describe("laneCounts and busiestStation", () => {
  const lanes = aiLanes(keys, {}, live);
  const tasks = [
    { task: "note.sort", providers: [{ provider: "anthropic" as const, jobs: 40 }, { provider: "gemini-free" as const, jobs: 90 }] },
    { task: "ask.answer", providers: [{ provider: "nvidia-free" as const, jobs: 6 }, { provider: null, jobs: 2 }] },
    { task: "voice", providers: [{ provider: "anthropic" as const, jobs: 3 }] },
  ];
  const counts = laneCounts(tasks);

  it("adds up each road's answers per provider", () => {
    expect(counts.people).toEqual({ anthropic: 40, "gemini-free": 90 });
    expect(counts.open).toEqual({ "nvidia-free": 6 });
    expect(counts.voice).toEqual({ anthropic: 3 });
  });

  it("counts the voice pair together", () => {
    const pair = lanes.find((l) => l.id === "voice")!.stations[0];
    expect(stationCount(pair, counts.voice)).toBe(3);
  });

  it("never calls a locked station the busiest, even when test accounts used it most", () => {
    const people = lanes.find((l) => l.id === "people")!.stations;
    expect(people[busiestStation(people, counts.people)].provider).toBe("anthropic");
    expect(busiestStation(people, {})).toBe(-1);
  });
});

describe("the Settings page", () => {
  const screen = readFileSync("src/vx/screens/settings/settings-screen.tsx", "utf8");

  it("has one AI page and one connector page, and no third AI row", () => {
    expect(screen).toContain('s: "ai", icon: "sparkle"');
    expect(screen).toContain('href: "/settings/ai-connection"');
    expect(screen).not.toContain("/settings/builtin-ai");
  });

  it("sends the old Built-in AI address to the AI page's Cost view", () => {
    expect(readFileSync("src/app/(app)/settings/builtin-ai/page.tsx", "utf8")).toContain('redirect("/settings?s=ai&v=cost")');
  });

  it("knows its four views", () => {
    expect(["used", "how", "cost", "switches"].every(isAiView)).toBe(true);
    expect(isAiView("other")).toBe(false);
  });
});
