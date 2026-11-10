import { z } from "zod";

import { NOT_COUNTED } from "./apinex";
import { APINEX_TIMEOUT_MS, pickApinexModels, type FreeCheck, type FreeCheckProbe, type FreeCheckResult, type FreeJob } from "./routes";
import type { AssistTaskId } from "./tasks";

/**
 * The free models' check (D-567). Pure: which jobs a model is tried on, the
 * shape the check is kept in, and how a check reads on the settings page.
 * `assist/data/free-check.ts` runs it.
 *
 * Every model gets the same two jobs, built from One's own tasks so the
 * check measures what staff will see: a notice to all parents in Hindi and
 * English (writing) and a cover-period plan in Hindi (quick, held to a
 * shape). The inputs are invented and name nobody, so the check sends no
 * school record, and an admin of either kind may run it.
 */

export const FREE_CHECK_PROBES: Record<FreeCheckProbe, { task: AssistTaskId; input: unknown }> = {
  writing: {
    task: "message.write",
    input: { brief: "School stays closed on Friday for a local holiday. Classes start again on Saturday at the usual time.", audience: "parents", kind: "holiday" },
  },
  quick: {
    task: "cover.plan",
    input: { classLabel: "Class 7 A", subject: "Science", minutes: 40, language: "hi" },
  },
};

/** How long one probe may take: past the slowest job's limit there is nothing more to learn. */
export const FREE_CHECK_PROBE_MS = Math.max(...Object.values(APINEX_TIMEOUT_MS));
/**
 * APInex lets a free account make 15 requests a minute, counted for the
 * whole account (D-568). The first check sent eight at once and most of
 * them came back 429, so probes now start at least this far apart (about
 * 14 a minute), a few at a time.
 */
export const FREE_CHECK_GAP_MS = 4_200;
/** Probes in flight at once. */
export const FREE_CHECK_PARALLEL = 3;
/** The longest a 429's Retry-After holds the check before the probe is tried once more. */
export const FREE_CHECK_HOLD_MS = 30_000;
/**
 * No probe starts after this; the rest are left out, as not checked, and a
 * second check reaches them. With the model list's 8 s and the last probe's
 * 18 s it stays inside the settings page's 150 s.
 */
export const FREE_CHECK_BUDGET_MS = 100_000;
/** At most this many models are checked. */
export const FREE_CHECK_MAX_MODELS = 24;
/** A model the last check found not free on the account is skipped for this long, its result carried over. */
export const NOT_FREE_KEPT_MS = 7 * 24 * 60 * 60_000;
/**
 * After these, a model's plan is not asked for: the model cannot answer at
 * all, or not on this account. A notice that was merely slow or not right
 * still lets the plan be tried.
 */
export const NO_PLAN_AFTER: ReadonlySet<string> = new Set(["not_free", "decision", "check_in", "model", "credential", "billing", "permission", "firewall", "quota_daily"]);

const PROBLEM = /^[a-z_]{1,24}$/u;
const MODEL = /^free\/[a-z0-9][a-z0-9._-]{0,60}$/u;

const resultSchema = z.object({
  model: z.string().regex(MODEL),
  probe: z.enum(["writing", "quick"]),
  ok: z.boolean(),
  ms: z.number().int().min(0).max(600_000),
  problem: z.string().regex(PROBLEM).optional(),
  httpStatus: z.number().int().min(100).max(599).optional(),
  said: z.string().max(160).optional(),
});

const checkSchema = z.object({
  at: z.string().refine((v) => Number.isFinite(Date.parse(v))),
  blocked: z.boolean(),
  models: z.array(z.string().regex(MODEL)).max(200),
  results: z.array(resultSchema).max(400),
});

/** The stored check, or null when there is none or it is not one. */
export function readFreeCheck(raw: unknown): FreeCheck | null {
  const parsed = checkSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

export type FreeCheckRow = {
  model: string;
  writing: FreeCheckResult | null;
  quick: FreeCheckResult | null;
  /** The kinds of work that use this model now, after the check. */
  jobs: FreeJob[];
};

/**
 * The check as the settings page lists it: the models in use first (in the
 * order the jobs try them), then every other model that answered, fastest
 * first, then the ones that did not.
 */
export function freeCheckRows(check: FreeCheck, preferred: Readonly<Record<FreeJob, readonly string[]>>, now = Date.now()): FreeCheckRow[] {
  const jobsOf = new Map<string, FreeJob[]>();
  const used: string[] = [];
  for (const job of ["writing", "careful", "quick"] as const) {
    for (const model of pickApinexModels(job, preferred[job], check, now)) {
      jobsOf.set(model, [...(jobsOf.get(model) ?? []), job]);
      if (!used.includes(model)) used.push(model);
    }
  }
  const models = [...new Set([...used, ...check.models, ...check.results.map((r) => r.model)])];
  const rows = models.map((model): FreeCheckRow => ({
    model,
    writing: check.results.find((r) => r.model === model && r.probe === "writing") ?? null,
    quick: check.results.find((r) => r.model === model && r.probe === "quick") ?? null,
    jobs: jobsOf.get(model) ?? [],
  }));
  const ok = (r: FreeCheckRow) => (r.writing?.ok ? 1 : 0) + (r.quick?.ok ? 1 : 0);
  const best = (r: FreeCheckRow) => Math.min(r.writing?.ok ? r.writing.ms : Infinity, r.quick?.ok ? r.quick.ms : Infinity);
  // A model APInex bills on this account, or one that cannot write, goes to the bottom: it is never used.
  const unusable = (r: FreeCheckRow) => (NOT_COUNTED.has(r.writing?.problem ?? "") || NOT_COUNTED.has(r.quick?.problem ?? "") ? 1 : 0);
  return rows.sort((a, b) => {
    const ua = used.indexOf(a.model), ub = used.indexOf(b.model);
    if (ua >= 0 || ub >= 0) return (ua < 0 ? Infinity : ua) - (ub < 0 ? Infinity : ub);
    return unusable(a) - unusable(b) || ok(b) - ok(a) || best(a) - best(b) || a.model.localeCompare(b.model);
  });
}

export type PacedStep<T, R> = {
  result: R;
  /** The provider asked to wait this long first: the item is tried once more after it. */
  retryAfterMs?: number;
  /** More work this item leads to, queued behind what is waiting. */
  then?: readonly T[];
};

/**
 * Run `work` over a queue that may grow, at most `parallel` at once, each
 * start at least `gapMs` after the one before, and none once `stop()` says
 * so (D-568). A step that asks to wait holds every start for that long (at
 * most `FREE_CHECK_HOLD_MS`) and is tried once more; the second answer
 * stands. Results come back in the order they finished.
 */
export async function paced<T, R>(
  items: readonly T[],
  opts: { parallel: number; gapMs: number; stop: () => boolean; now: () => number; sleep: (ms: number) => Promise<void> },
  work: (item: T) => Promise<PacedStep<T, R>>,
): Promise<R[]> {
  const queue = items.map((item) => ({ item, retried: false }));
  const out: R[] = [];
  let nextStart = opts.now();
  let inFlight = 0;
  const lane = async (): Promise<void> => {
    while (!opts.stop()) {
      const job = queue.shift();
      if (!job) {
        if (inFlight === 0) return;
        // Another lane's answer may still queue more work.
        await opts.sleep(200);
        continue;
      }
      const at = Math.max(opts.now(), nextStart);
      nextStart = at + opts.gapMs;
      const wait = at - opts.now();
      if (wait > 0) await opts.sleep(wait);
      if (opts.stop()) return;
      inFlight += 1;
      try {
        const step = await work(job.item);
        if (step.retryAfterMs !== undefined && !job.retried) {
          nextStart = Math.max(nextStart, opts.now() + Math.min(step.retryAfterMs, FREE_CHECK_HOLD_MS));
          queue.unshift({ item: job.item, retried: true });
          continue;
        }
        out.push(step.result);
        for (const item of step.then ?? []) queue.push({ item, retried: false });
      } finally {
        inFlight -= 1;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(opts.parallel, items.length)) }, lane));
  return out;
}
