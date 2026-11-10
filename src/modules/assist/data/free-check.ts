import "server-only";

import { APINEX_CATALOG_URL, APINEX_CHAT_URL, APINEX_MODELS_URL, apinexConfig, isFreeApinexModel } from "@/lib/ai/config";
import { failureOf } from "@/lib/ai/router";

import { apinexRefusal } from "../domain/apinex";
import {
  FREE_CHECK_BUDGET_MS,
  FREE_CHECK_GAP_MS,
  FREE_CHECK_MAX_MODELS,
  FREE_CHECK_PARALLEL,
  FREE_CHECK_PROBE_MS,
  FREE_CHECK_PROBES,
  NO_PLAN_AFTER,
  NOT_FREE_KEPT_MS,
  paced,
  type PacedStep,
} from "../domain/free-check";
import { readsAsHindi } from "../domain/hindi-check";
import { hasStrayToken } from "../domain/redact";
import type { FreeCheck, FreeCheckProbe, FreeCheckResult } from "../domain/routes";
import { ASSIST_TASKS, type TaskSpec } from "../domain/tasks";
import { chatDraft } from "./chat-draft";
import { apinexModels, taskInstructions } from "./run";
import { saveFreeCheck } from "./settings";

/**
 * Check APInex's free models from this server (D-567): which answer, how
 * fast, and whether the answer is a usable draft. Run by an admin from
 * Settings → AI in One → Cost. It has to run here, on Vercel, because the
 * key is only here and APInex's firewall decides by who is calling.
 *
 * Each model gets the two invented jobs in `FREE_CHECK_PROBES`, through the
 * same instructions and the same checks as a real draft (schema, finish,
 * placeholders, Hindi). Only the model, the time, a fixed problem word and,
 * for a refusal, APInex's own short words are kept; never an answer.
 *
 * APInex counts 15 requests a minute for the whole account (D-568), so the
 * probes are paced: every model's notice first, then the plan of each model
 * that could answer at all. A model the last check found not free on this
 * account is not asked again for a week.
 *
 * Before asking anything, the check reads APInex's public catalogue (no key
 * sent). A `free/…` model counts as free only when the catalogue lists it
 * with `allowFree: true` and without the `decision` tag, the vault's rule
 * too; the others are recorded without a call. If the catalogue cannot be
 * read, or names none of the listed models, every model is asked and its
 * refusal read instead.
 */

export type FreeCheckOutcome =
  | { ok: true; check: FreeCheck }
  | { ok: false; problem: "no_key" | "credential" | "unavailable" };

function strings(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(strings);
  if (value && typeof value === "object") return Object.values(value).flatMap(strings);
  return [];
}

async function listFreeModels(apiKey: string, fetcher: typeof fetch): Promise<{ blocked: true } | { blocked: false; models: string[] }> {
  const response = await fetcher(APINEX_MODELS_URL, {
    headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
    signal: AbortSignal.timeout(8_000),
    redirect: "error",
  });
  const json = (response.headers.get("content-type") ?? "").toLowerCase().includes("json");
  if (!response.ok && !json && response.status === 403) return { blocked: true };
  if (!response.ok) throw Object.assign(new Error("APInex models unavailable"), { status: response.status });
  const body = (await response.json().catch(() => null)) as { data?: { id?: unknown }[] } | null;
  const ids = (body?.data ?? []).map((m) => (typeof m.id === "string" ? m.id.trim().toLowerCase() : "")).filter(isFreeApinexModel);
  return { blocked: false, models: [...new Set(ids)].sort() };
}

/** What the catalogue says of a model: free, billed on the account, or a decision model chat cannot use. */
type Catalogued = "free" | "not_free" | "decision";

/** APInex's public catalogue, or null when it cannot be read: then nothing is decided from it. */
async function readCatalog(fetcher: typeof fetch): Promise<Map<string, Catalogued> | null> {
  try {
    const response = await fetcher(APINEX_CATALOG_URL, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(8_000),
      redirect: "error",
    });
    if (!response.ok) return null;
    const body = (await response.json()) as unknown;
    const rows = Array.isArray(body) ? body : (body as { models?: unknown } | null)?.models;
    if (!Array.isArray(rows)) return null;
    const catalog = new Map<string, Catalogued>();
    for (const row of rows as { id?: unknown; allowFree?: unknown; tags?: unknown }[]) {
      const id = typeof row?.id === "string" ? row.id.trim().toLowerCase() : "";
      if (!isFreeApinexModel(id)) continue;
      const decision = Array.isArray(row.tags) && row.tags.includes("decision");
      catalog.set(id, decision ? "decision" : row.allowFree === true ? "free" : "not_free");
    }
    return catalog;
  } catch {
    return null;
  }
}

type Job = { model: string; kind: FreeCheckProbe };

/** A 429 without a Retry-After still waits this long before its one more try. */
const DEFAULT_HOLD_MS = 10_000;

async function probe(apiKey: string, { model, kind }: Job, fetcher: typeof fetch): Promise<PacedStep<Job, FreeCheckResult>> {
  const { task, input: raw } = FREE_CHECK_PROBES[kind];
  const spec = ASSIST_TASKS[task] as unknown as TaskSpec<unknown, unknown>;
  const input = spec.input.parse(raw);
  const started = Date.now();
  const ms = () => Date.now() - started;
  // Every model's notice comes first; its plan is asked for only if the model could answer at all.
  const plan = (problem?: string, httpStatus?: number) =>
    kind === "writing" && !(problem && NO_PLAN_AFTER.has(problem)) && httpStatus !== 400 ? [{ model, kind: "quick" as const }] : [];
  try {
    const reply = await chatDraft({
      url: APINEX_CHAT_URL, apiKey, model, fetcher,
      instructions: taskInstructions(spec), text: spec.prompt(input), output: spec.output, maxTokens: spec.maxTokens, timeoutMs: FREE_CHECK_PROBE_MS,
    });
    const failed = (problem: string): PacedStep<Job, FreeCheckResult> => ({ result: { model, probe: kind, ok: false, ms: ms(), problem }, then: plan(problem) });
    if (reply.candidate === undefined) return failed("no_answer");
    const parsed = spec.output.safeParse(reply.candidate);
    const finished = parsed.success ? (spec.finish ? spec.finish(parsed.data, input) : parsed.data) : null;
    if (!finished || strings(finished).some(hasStrayToken)) return failed("schema");
    if (!readsAsHindi(finished, input)) return failed("not_hindi");
    return { result: { model, probe: kind, ok: true, ms: ms() }, then: plan() };
  } catch (error) {
    const failure = failureOf(error);
    const e = (error as { firewall?: boolean; said?: string; retryAfterSec?: number } | null) ?? {};
    const problem = e.firewall === true ? "firewall" : (apinexRefusal(failure.httpStatus, e.said) ?? failure.problem);
    const result: FreeCheckResult = {
      model, probe: kind, ok: false, ms: ms(), problem,
      ...(failure.httpStatus ? { httpStatus: failure.httpStatus } : {}),
      ...(e.said ? { said: e.said } : {}),
    };
    const retryAfterMs = problem === "quota" ? (e.retryAfterSec ? e.retryAfterSec * 1_000 : DEFAULT_HOLD_MS) : undefined;
    return { result, retryAfterMs, then: plan(problem, failure.httpStatus) };
  }
}

/** A model the last check found not free on the account, while that is recent enough to trust. */
function knownNotFree(previous: FreeCheck | null | undefined, now: number): FreeCheckResult[] {
  if (!previous || !(now - Date.parse(previous.at) <= NOT_FREE_KEPT_MS)) return [];
  return previous.results.filter((r) => r.problem === "not_free");
}

/**
 * List APInex's free models, give each the two jobs (paced, for at most
 * `FREE_CHECK_BUDGET_MS`), and keep the result. The models One prefers are
 * checked first, so they are never the ones left unchecked.
 */
export async function runFreeCheck(
  fetcher: typeof fetch = fetch,
  now = () => Date.now(),
  options: { previous?: FreeCheck | null; gapMs?: number; sleep?: (ms: number) => Promise<void> } = {},
): Promise<FreeCheckOutcome> {
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const config = apinexConfig();
  const preferred = apinexModels();
  if (!config || !preferred) return { ok: false, problem: "no_key" };
  const started = now();

  let listed: Awaited<ReturnType<typeof listFreeModels>>;
  try {
    listed = await listFreeModels(config.apiKey, fetcher);
  } catch (error) {
    const { problem } = failureOf(error);
    return { ok: false, problem: problem === "credential" ? "credential" : "unavailable" };
  }

  let check: FreeCheck;
  if (listed.blocked) {
    check = { at: new Date(started).toISOString(), blocked: true, models: [], results: [] };
  } else {
    // The catalogue decides when it names the listed models; otherwise last week's refusals do.
    const catalog = await readCatalog(fetcher);
    const decides = catalog !== null && listed.models.some((m) => catalog.has(m));
    const told: FreeCheckResult[] = decides
      ? listed.models.flatMap((model) => {
          const said = catalog.get(model) ?? "not_free";
          if (said === "free") return [];
          return (["writing", "quick"] as const).map((probe) => ({ model, probe, ok: false, ms: 0, problem: said }));
        })
      : [];
    const carried = decides ? told : knownNotFree(options.previous, started).filter((r) => listed.models.includes(r.model));
    const skip = new Set(carried.map((r) => r.model));
    const first = [...new Set([...preferred.writing, ...preferred.careful, ...preferred.quick])].filter((m) => listed.models.includes(m));
    const models = [...first, ...listed.models.filter((m) => !first.includes(m))].filter((m) => !skip.has(m)).slice(0, FREE_CHECK_MAX_MODELS);
    const results = await paced(
      models.map((model): Job => ({ model, kind: "writing" })),
      { parallel: FREE_CHECK_PARALLEL, gapMs: options.gapMs ?? FREE_CHECK_GAP_MS, stop: () => now() - started > FREE_CHECK_BUDGET_MS, now, sleep },
      (job) => probe(config.apiKey, job, fetcher),
    );
    // Not free is a fact about the model, not about one job: its plan reads the same.
    const plans = results.filter((r) => r.problem === "not_free" && r.probe === "writing").map((r) => ({ ...r, probe: "quick" as const }));
    check = { at: new Date(started).toISOString(), blocked: false, models: listed.models, results: [...results, ...plans, ...carried] };
  }
  await saveFreeCheck(check);
  return { ok: true, check };
}
