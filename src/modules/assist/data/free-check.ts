import "server-only";

import { APINEX_CHAT_URL, APINEX_MODELS_URL, apinexConfig, isFreeApinexModel } from "@/lib/ai/config";
import { failureOf } from "@/lib/ai/router";

import {
  FREE_CHECK_BUDGET_MS,
  FREE_CHECK_MAX_MODELS,
  FREE_CHECK_PARALLEL,
  FREE_CHECK_PROBE_MS,
  FREE_CHECK_PROBES,
  inBatches,
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
 * placeholders, Hindi). Only the model, the time and a fixed problem word
 * are kept; never an answer.
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

async function probe(apiKey: string, model: string, kind: FreeCheckProbe, fetcher: typeof fetch): Promise<FreeCheckResult> {
  const { task, input: raw } = FREE_CHECK_PROBES[kind];
  const spec = ASSIST_TASKS[task] as unknown as TaskSpec<unknown, unknown>;
  const input = spec.input.parse(raw);
  const started = Date.now();
  const ms = () => Date.now() - started;
  try {
    const reply = await chatDraft({
      url: APINEX_CHAT_URL, apiKey, model, fetcher,
      instructions: taskInstructions(spec), text: spec.prompt(input), output: spec.output, maxTokens: spec.maxTokens, timeoutMs: FREE_CHECK_PROBE_MS,
    });
    if (reply.candidate === undefined) return { model, probe: kind, ok: false, ms: ms(), problem: "no_answer" };
    const parsed = spec.output.safeParse(reply.candidate);
    const finished = parsed.success ? (spec.finish ? spec.finish(parsed.data, input) : parsed.data) : null;
    if (!finished || strings(finished).some(hasStrayToken)) return { model, probe: kind, ok: false, ms: ms(), problem: "schema" };
    if (!readsAsHindi(finished, input)) return { model, probe: kind, ok: false, ms: ms(), problem: "not_hindi" };
    return { model, probe: kind, ok: true, ms: ms() };
  } catch (error) {
    const failure = failureOf(error);
    const firewall = (error as { firewall?: boolean } | null)?.firewall === true;
    return {
      model, probe: kind, ok: false, ms: ms(),
      problem: firewall ? "firewall" : failure.problem,
      ...(failure.httpStatus ? { httpStatus: failure.httpStatus } : {}),
    };
  }
}

/**
 * List APInex's free models, give each the two jobs (a few at a time, for
 * at most `FREE_CHECK_BUDGET_MS`), and keep the result. The models One
 * prefers are checked first, so they are never the ones left unchecked.
 */
export async function runFreeCheck(fetcher: typeof fetch = fetch, now = () => Date.now()): Promise<FreeCheckOutcome> {
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
    const first = [...new Set([...preferred.writing, ...preferred.careful, ...preferred.quick])].filter((m) => listed.models.includes(m));
    const models = [...first, ...listed.models.filter((m) => !first.includes(m))].slice(0, FREE_CHECK_MAX_MODELS);
    const jobs = models.flatMap((model) => (["writing", "quick"] as const).map((kind) => ({ model, kind })));
    const results = await inBatches(jobs, FREE_CHECK_PARALLEL, (job) => probe(config.apiKey, job.model, job.kind, fetcher), () => now() - started > FREE_CHECK_BUDGET_MS);
    check = { at: new Date(started).toISOString(), blocked: false, models: listed.models, results: results.filter((r): r is FreeCheckResult => r !== null) };
  }
  await saveFreeCheck(check);
  return { ok: true, check };
}
