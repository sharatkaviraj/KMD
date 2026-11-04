/**
 * Built-in AI's provider order and failover rules (docs/ai/README.md). Pure:
 * no database and no network; `providers.ts` runs the stages and
 * `provider-status.ts` remembers what each key last did.
 *
 *   Image tasks (marks sheets, substitution slips):
 *     1. Gemini FREE   2. Claude Sonnet (Anthropic credits)   3. Gemini PAID
 *   Voice tasks:
 *     1. Gemini FREE (audio in)   2. OpenAI transcription, then Claude to understand   3. Gemini PAID
 *
 * Real-session records never use the free key (D-401): Google's unpaid tier
 * uses submitted content to improve its products. TEST material starts free.
 *
 * A stage is left at once on a quota, rate, billing, permission or credential
 * error; a timeout or an answer that fails the schema is retried once, then
 * left. A free-key daily quota blocks the free key until midnight Pacific,
 * when Google resets it, so later requests skip straight to the next stage.
 */

export type AiKey = "gemini-free" | "gemini-paid" | "anthropic" | "openai";
export type KeyType = "free" | "paid" | "credits";

/** How each key is paid for: the free AI Studio tier, Google billing, or prepaid API credits. */
export const KEY_TYPE: Record<AiKey, KeyType> = {
  "gemini-free": "free",
  "gemini-paid": "paid",
  anthropic: "credits",
  openai: "credits",
};

export const PROVIDER_TIMEOUT_MS = 25_000;

export type FailureProblem =
  | "quota_daily" | "quota" | "billing" | "credential" | "permission" | "model"
  | "timeout" | "schema" | "server" | "network" | "other";

/**
 * A provider error as a fixed category. Only the HTTP status and this
 * category are kept; an upstream message can quote the request or a key.
 */
export function failureOf(error: unknown): { httpStatus?: number; problem: FailureProblem } {
  const raw = (error as { status?: unknown; code?: unknown } | null) ?? {};
  const status = typeof raw.status === "number" ? raw.status : typeof raw.code === "number" ? raw.code : undefined;
  const httpStatus = status !== undefined && Number.isInteger(status) && status >= 400 && status <= 599 ? status : undefined;
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  const text = message.toLowerCase();
  if (/timed out|timeout|aborted/u.test(text) && httpStatus === undefined) return { problem: "timeout" };
  if (httpStatus === 402 || /billing|insufficient_quota|credit balance|payment required|prepayment/u.test(text)) return { httpStatus, problem: "billing" };
  if (httpStatus === 429 || /resource_exhausted|rate limit|quota/u.test(text)) {
    return { httpStatus, problem: /perday|per_day|per day|daily/u.test(text) ? "quota_daily" : "quota" };
  }
  if (httpStatus === 401 || /api_key_invalid|invalid api key|incorrect api key|access_token_type_unsupported|unauthenticated/u.test(text)) return { httpStatus, problem: "credential" };
  if (httpStatus === 403) return { httpStatus, problem: "permission" };
  if (httpStatus === 404 || /not found for api version|model .* (?:does not exist|not found)|model_not_found/u.test(text)) return { httpStatus, problem: "model" };
  if (httpStatus === 400 && /schema/u.test(text)) return { httpStatus, problem: "schema" };
  if (error instanceof SyntaxError) return { problem: "schema" };
  if (httpStatus !== undefined && httpStatus >= 500) return { httpStatus, problem: "server" };
  if (/fetch failed|network|econn|enotfound|socket/u.test(text)) return { httpStatus, problem: "network" };
  return { httpStatus, problem: "other" };
}

/** Failures that mean "this key cannot answer now": go straight to the next stage. */
export function leaveStageAt(problem: FailureProblem, httpStatus?: number) {
  if (["quota_daily", "quota", "billing", "credential", "permission", "model"].includes(problem)) return true;
  return httpStatus !== undefined && httpStatus !== 408 && httpStatus < 500;
}

/** What a key's last answer means for the admin page: working, out of quota, or failing. */
export function keyState(problem: FailureProblem | null): "ok" | "quota" | "failing" {
  if (!problem) return "ok";
  return problem === "quota_daily" || problem === "quota" ? "quota" : "failing";
}

const PACIFIC = "America/Los_Angeles";

function pacificParts(at: number) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
    timeZone: PACIFIC, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23",
  }).formatToParts(new Date(at)).map((part) => [part.type, part.value]));
  return { y: Number(parts.year), m: Number(parts.month), d: Number(parts.day), h: Number(parts.hour) };
}

/** The next midnight in Pacific time, when Google resets free-tier daily quotas. */
export function nextPacificMidnight(now: Date = new Date()): Date {
  const { y, m, d } = pacificParts(now.valueOf());
  // Midnight Pacific is 07:00 or 08:00 UTC depending on daylight saving.
  for (const hour of [7, 8]) {
    const candidate = Date.UTC(y, m - 1, d + 1, hour);
    const at = pacificParts(candidate);
    if (at.h === 0 && candidate > now.valueOf()) return new Date(candidate);
  }
  return new Date(Date.UTC(y, m - 1, d + 1, 8));
}
