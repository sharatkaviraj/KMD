import { costUsd } from "./cost";
import { FREE_PROVIDERS, TASK_TIER, tierModels, type AssistProvider } from "./routes";
import type { AssistTaskId } from "./tasks";

/**
 * Settings → AI helper, one page for every AI job in One (D-501): the
 * written drafts (`assist_log`) and the photo and voice jobs (`ai_jobs`),
 * shaped for the screen from `vppsone.ai_overview`. Pure: no database, no
 * network, no React, so it is unit-tested in `tests/ai-overview.test.ts`.
 *
 * Money is shown in rupees. The written drafts are logged in US dollars (the
 * providers' own unit) and turned into rupees at the deployment's rate,
 * `GEMINI_INR_PER_USD` (₹90 unless set), the same rate the photo and voice
 * jobs already use.
 */

export type AiProvider = AssistProvider;

/** Every provider, in the order the free-first route tries them. */
export const AI_PROVIDERS: readonly AiProvider[] = ["nvidia-free", "apinex-free", "openrouter-free", "gemini-free", "anthropic", "openai", "gemini-paid"];

const KNOWN = new Set<string>(AI_PROVIDERS);

export function isFreeProvider(provider: AiProvider | null | undefined): boolean {
  return provider ? FREE_PROVIDERS.has(provider) : false;
}

/**
 * Who wrote a job. Rows logged before 7 Nov 2026 have no provider (D-496), so
 * it is read from the model: a Gemini model that cost nothing was the free
 * key. Null only when nothing is known.
 */
export function providerOf(model: string | null | undefined, provider: string | null | undefined, zeroCost: boolean): AiProvider | null {
  if (provider && KNOWN.has(provider)) return provider as AiProvider;
  const m = (model ?? "").trim().toLowerCase();
  if (!m) return null;
  if (m.endsWith(":free") || m.startsWith("openrouter/")) return "openrouter-free";
  if (m.startsWith("free/")) return "apinex-free";
  if (m.startsWith("claude")) return "anthropic";
  if (m.startsWith("gpt") || m.startsWith("whisper")) return "openai";
  if (m.includes("nemotron") || m.startsWith("nvidia/") || m.startsWith("private/nvidia/")) return "nvidia-free";
  if (m.startsWith("gemini")) return zeroCost ? "gemini-free" : "gemini-paid";
  return null;
}

const MODEL_NAMES: Record<string, string> = {
  "claude-haiku-5-5": "Claude Haiku 5.5",
  "claude-sonnet-5-5": "Claude Sonnet 5.5",
  "claude-opus-5-5": "Claude Opus 5.5",
  "claude-sonnet-5": "Claude Sonnet 5",
  "gpt-6-luna": "GPT-6 Luna",
  "gpt-6.1-sol": "GPT-6.1 Sol",
  "gpt-6.1-terra": "GPT-6.1 Terra",
  "gpt-transcribe": "GPT Transcribe",
  "openrouter/free": "OpenRouter's pick",
};

/** Models that only listen: they hand a voice note to the next model as text. */
const LISTENING_MODELS = new Set(["gpt-transcribe"]);
export function isListeningModel(model: string | null | undefined): boolean {
  return !!model && LISTENING_MODELS.has(model);
}

const cap = (word: string) => (word ? word[0].toUpperCase() + word.slice(1) : word);
const BRAND: Record<string, string> = { deepseek: "DeepSeek", glm: "GLM", gpt: "GPT", qwen: "Qwen", kimi: "Kimi", minimax: "MiniMax", llama: "Llama", grok: "Grok" };

/** A model id as a person reads it: "Claude Haiku 5.5", "Nemotron 3.5 Super", "Gemini 3.5 Flash-Lite". */
export function modelName(model: string | null | undefined): string {
  const raw = (model ?? "").trim();
  if (!raw) return "—";
  const id = raw.toLowerCase();
  if (MODEL_NAMES[id]) return MODEL_NAMES[id];
  const last = id.split("/").at(-1)!.replace(/:free$/, "");
  if (MODEL_NAMES[last]) return MODEL_NAMES[last];
  const nemotron = /^nemotron-(\d[\d.]*)-(super|ultra|nano|lightning)/.exec(last);
  if (nemotron) return `Nemotron ${nemotron[1]} ${cap(nemotron[2])}`;
  const gemma = /^gemma-(\d[\d.]*)-(\d+)b/.exec(last);
  if (gemma) return `Gemma ${gemma[1]} ${gemma[2]}B`;
  const gemini = /^gemini-(\d[\d.]*)-(.+)$/.exec(last);
  if (gemini) return `Gemini ${gemini[1]} ${gemini[2].split("-").map(cap).join("-")}`;
  // APInex's free models (D-567): "free/claude-sonnet-4.6" is "Claude Sonnet 4.6", "free/deepseek-v4.1-flash" "DeepSeek V4.1 Flash".
  return last.split("-").map((word) => BRAND[word] ?? cap(word)).join(" ");
}

/* --------------------------------------------------------------- raw rows */

type Num = number | string | null | undefined;

export type OverviewRaw = {
  helper: { task: string; model: string | null; provider: string | null; outcome: string; decision: string | null; test: boolean; n: number; cost_usd: Num; input_tokens: Num; output_tokens: Num }[];
  builtin: { task: string; model: string | null; provider: string | null; status: string; edited: boolean; test: boolean; n: number; cost_inr: Num }[];
  tries: { task: string; provider: string | null; model: string | null; outcome: string | null; n: number; cost_inr: Num }[];
  days: { day: string; kind: string; provider: string | null; model: string | null; zero_cost: boolean; n: number }[];
  recent: { at: string; kind: string; task: string; model: string | null; provider: string | null; outcome: string | null; decision: string | null; status: string | null; cost_usd: Num; cost_inr: Num; attempts: unknown; test: boolean; who: string | null }[];
};

export const EMPTY_RAW: OverviewRaw = { helper: [], builtin: [], tries: [], days: [], recent: [] };

const num = (v: Num) => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
};

/** Reads whatever came back, keeping only well-formed rows. */
export function readRaw(value: unknown): OverviewRaw {
  const o = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
  const isRow = (r: unknown): r is Record<string, unknown> => Boolean(r) && typeof r === "object";
  const rows = (key: keyof OverviewRaw) => (Array.isArray(o[key]) ? (o[key] as unknown[]).filter(isRow) : []);
  const counted = <T>(key: keyof OverviewRaw) => rows(key).filter((r) => typeof r.n === "number" && Number.isFinite(r.n)) as unknown as T[];
  return {
    helper: counted<OverviewRaw["helper"][number]>("helper").filter((r) => typeof r.task === "string"),
    builtin: counted<OverviewRaw["builtin"][number]>("builtin").filter((r) => typeof r.task === "string"),
    tries: counted<OverviewRaw["tries"][number]>("tries"),
    days: counted<OverviewRaw["days"][number]>("days").filter((r) => typeof r.day === "string"),
    recent: rows("recent").filter((r) => typeof r.at === "string" && typeof r.task === "string") as unknown as OverviewRaw["recent"],
  };
}

/* ---------------------------------------------------------------- results */

/** What happened to a job, in the words the page uses. */
export type JobResult = "kept" | "edited" | "unused" | "open" | "failed";

export function helperResult(outcome: string | null, decision: string | null): JobResult {
  if (outcome !== "drafted") return "failed";
  if (decision === "kept") return "kept";
  if (decision === "edited") return "edited";
  if (decision === "discarded") return "unused";
  return "open";
}

export function builtinResult(status: string | null, edited: boolean): JobResult {
  if (status === "failed") return "failed";
  if (status === "applied") return edited ? "edited" : "kept";
  if (status === "discarded") return "unused";
  return "open";
}

/* --------------------------------------------------------------- overview */

export type JobKind = "helper" | "builtin";
export type Slice = { provider: AiProvider | null; jobs: number };
export type TaskRow = {
  task: string;
  kind: JobKind;
  /** Jobs an AI answered. */
  jobs: number;
  failed: number;
  test: number;
  costInr: number;
  results: Record<JobResult, number>;
  /** Who answered, most first. */
  providers: Slice[];
};
/**
 * `answered` counts jobs this model finished. A listening model never finishes a
 * job: it turns a voice note into text for the next model, so its good tries are
 * counted as `heard` instead, and it would otherwise read "0 answered".
 */
export type ModelRow = { provider: AiProvider | null; model: string; answered: number; heard: number; tries: number; costInr: number };
export type DayRow = { day: string; free: number; paid: number };
export type Step = { provider: AiProvider | null; model: string | null; ok: boolean; problem: string | null };
export type RecentJob = { at: string; task: string; kind: JobKind; provider: AiProvider | null; model: string | null; result: JobResult; costInr: number; test: boolean; who: string | null; trail: Step[] };

export type Overview = {
  /** Jobs an AI answered this month, of both kinds. */
  jobs: number;
  failed: number;
  freeJobs: number;
  testJobs: number;
  costInr: number;
  helperCostUsd: number;
  builtinCostInr: number;
  /** What the free drafts would have cost on their tier's Claude model: an estimate. */
  savedInr: number;
  providers: (Slice & { costInr: number })[];
  tasks: TaskRow[];
  models: ModelRow[];
  days: DayRow[];
  recent: RecentJob[];
};

const ZERO: Record<JobResult, number> = { kept: 0, edited: 0, unused: 0, open: 0, failed: 0 };
const round = (v: number) => Math.round(v * 10_000) / 10_000;

/** Every school day from `from` to `to` (YYYY-MM-DD), inclusive. */
export function daysFrom(from: string, to: string): string[] {
  const out: string[] = [];
  const end = Date.parse(`${to}T00:00:00Z`);
  for (let t = Date.parse(`${from}T00:00:00Z`); Number.isFinite(t) && t <= end && out.length < 62; t += 86_400_000) {
    out.push(new Date(t).toISOString().slice(0, 10));
  }
  return out;
}

function trailOf(attempts: unknown): Step[] {
  if (!Array.isArray(attempts)) return [];
  return attempts
    .filter((a): a is Record<string, unknown> => Boolean(a) && typeof a === "object")
    .map((a) => {
      const model = typeof a.model === "string" ? a.model : null;
      const cost = typeof a.costInr === "number" ? a.costInr : 0;
      return {
        provider: providerOf(model, typeof a.provider === "string" ? a.provider : null, cost === 0),
        model,
        ok: a.outcome === "ok",
        problem: typeof a.problem === "string" ? a.problem : a.outcome === "ok" ? null : typeof a.outcome === "string" ? a.outcome : null,
      };
    })
    .slice(0, 6);
}

export function buildOverview(
  raw: OverviewRaw,
  opts: { inrPerUsd: number; from: string; today: string; env?: Readonly<Record<string, string | undefined>> },
): Overview {
  const rate = opts.inrPerUsd > 0 ? opts.inrPerUsd : 90;
  const models = tierModels(opts.env ?? {});
  const tasks = new Map<string, TaskRow & { by: Map<AiProvider | null, number> }>();
  const byProvider = new Map<AiProvider | null, { jobs: number; costInr: number }>();
  const byModel = new Map<string, ModelRow>();
  let jobs = 0;
  let failed = 0;
  let freeJobs = 0;
  let testJobs = 0;
  let helperCostUsd = 0;
  let builtinCostInr = 0;
  let savedUsd = 0;

  const taskRow = (task: string, kind: JobKind) => {
    let row = tasks.get(task);
    if (!row) {
      row = { task, kind, jobs: 0, failed: 0, test: 0, costInr: 0, results: { ...ZERO }, providers: [], by: new Map() };
      tasks.set(task, row);
    }
    return row;
  };
  const provider = (p: AiProvider | null) => {
    let row = byProvider.get(p);
    if (!row) byProvider.set(p, (row = { jobs: 0, costInr: 0 }));
    return row;
  };
  const model = (p: AiProvider | null, m: string | null) => {
    const key = `${p ?? "?"}|${m ?? "?"}`;
    let row = byModel.get(key);
    if (!row) byModel.set(key, (row = { provider: p, model: m ?? "—", answered: 0, heard: 0, tries: 0, costInr: 0 }));
    return row;
  };

  for (const r of raw.helper) {
    const usd = num(r.cost_usd);
    const p = providerOf(r.model, r.provider, usd === 0);
    const result = helperResult(r.outcome, r.decision);
    const row = taskRow(r.task, "helper");
    const inr = usd * rate;
    row.results[result] += r.n;
    row.costInr += inr;
    helperCostUsd += usd;
    provider(p).costInr += inr;
    const m = model(p, r.model);
    m.costInr += inr;
    m.tries += r.n;
    if (result === "failed") {
      row.failed += r.n;
      failed += r.n;
      continue;
    }
    row.jobs += r.n;
    row.by.set(p, (row.by.get(p) ?? 0) + r.n);
    if (r.test) {
      row.test += r.n;
      testJobs += r.n;
    }
    jobs += r.n;
    provider(p).jobs += r.n;
    m.answered += r.n;
    if (isFreeProvider(p)) {
      freeJobs += r.n;
      const tier = TASK_TIER[r.task as AssistTaskId];
      if (tier) savedUsd += costUsd(models[tier].claude, { input_tokens: num(r.input_tokens), output_tokens: num(r.output_tokens) });
    }
  }

  for (const r of raw.builtin) {
    const inr = num(r.cost_inr);
    const p = providerOf(r.model, r.provider, inr === 0);
    const result = builtinResult(r.status, r.edited);
    const row = taskRow(r.task, "builtin");
    row.results[result] += r.n;
    row.costInr += inr;
    builtinCostInr += inr;
    if (result === "failed") {
      row.failed += r.n;
      failed += r.n;
      continue;
    }
    row.jobs += r.n;
    row.by.set(p, (row.by.get(p) ?? 0) + r.n);
    if (r.test) {
      row.test += r.n;
      testJobs += r.n;
    }
    jobs += r.n;
    provider(p).jobs += r.n;
    model(p, r.model).answered += r.n;
    if (isFreeProvider(p)) freeJobs += r.n;
  }

  // A photo or voice job's money is spent by every attempt, so each provider is charged for its own tries.
  for (const t of raw.tries) {
    const inr = num(t.cost_inr);
    const p = providerOf(t.model, t.provider, inr === 0);
    provider(p).costInr += inr;
    const m = model(p, t.model);
    m.tries += t.n;
    m.costInr += inr;
    if (t.outcome === "ok" && isListeningModel(t.model)) m.heard += t.n;
  }

  const days = new Map(daysFrom(opts.from, opts.today).map((d) => [d, { day: d, free: 0, paid: 0 }]));
  for (const d of raw.days) {
    const row = days.get(d.day);
    if (!row) continue;
    if (isFreeProvider(providerOf(d.model, d.provider, d.zero_cost))) row.free += d.n;
    else row.paid += d.n;
  }

  const recent: RecentJob[] = raw.recent.map((r) => {
    const kind: JobKind = r.kind === "builtin" ? "builtin" : "helper";
    const usd = num(r.cost_usd);
    const inr = kind === "helper" ? usd * rate : num(r.cost_inr);
    const p = providerOf(r.model, r.provider, inr === 0);
    const result = kind === "helper" ? helperResult(r.outcome, r.decision) : builtinResult(r.status, false);
    const trail = kind === "builtin" ? trailOf(r.attempts) : [];
    return {
      at: r.at,
      task: r.task,
      kind,
      provider: p,
      model: r.model,
      result,
      costInr: round(inr),
      test: r.test === true,
      who: r.who,
      trail: trail.length ? trail : [{ provider: p, model: r.model, ok: result !== "failed", problem: null }],
    };
  });

  const taskRows = [...tasks.values()]
    .map(({ by, ...row }) => ({
      ...row,
      costInr: round(row.costInr),
      providers: [...by].map(([p, n]) => ({ provider: p, jobs: n })).sort((a, b) => b.jobs - a.jobs),
    }))
    .sort((a, b) => b.jobs + b.failed - (a.jobs + a.failed) || a.task.localeCompare(b.task));

  const order = (p: AiProvider | null) => (p ? AI_PROVIDERS.indexOf(p) : AI_PROVIDERS.length);
  return {
    jobs,
    failed,
    freeJobs,
    testJobs,
    costInr: round(helperCostUsd * rate + builtinCostInr),
    helperCostUsd: Math.round(helperCostUsd * 1_000_000) / 1_000_000,
    builtinCostInr: round(builtinCostInr),
    savedInr: round(savedUsd * rate),
    providers: [...byProvider]
      .map(([p, v]) => ({ provider: p, jobs: v.jobs, costInr: round(v.costInr) }))
      .filter((s) => s.jobs > 0 || s.costInr > 0)
      .sort((a, b) => b.jobs - a.jobs || order(a.provider) - order(b.provider)),
    tasks: taskRows,
    models: [...byModel.values()]
      .map((m) => ({ ...m, costInr: round(m.costInr) }))
      .sort((a, b) => order(a.provider) - order(b.provider) || b.answered - a.answered),
    days: [...days.values()],
    recent,
  };
}

/** The share of a whole, as a whole percentage; 0 when there is no whole. */
export function share(part: number, whole: number): number {
  return whole > 0 ? Math.round((part / whole) * 100) : 0;
}
