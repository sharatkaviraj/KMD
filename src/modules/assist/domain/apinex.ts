/**
 * What APInex's refusals mean (D-568). Pure, so the router and the free
 * models' check read a refusal the same way.
 *
 * APInex answers 402 for two different things. A model that is listed as
 * `free/…` but is not free on this account (it is billed from the wallet,
 * and the wallet is empty) says "Insufficient balance": that is the model,
 * and only that model should be skipped. A free model past the account's
 * daily free allowance says "Free daily limit reached": that is the whole
 * account until 00:00 UTC. Its 429 is a per-minute limit for the whole
 * account (15 a minute on a free account), not for one model.
 *
 * Its free models also wait for the account holder's check-in (D-569): until
 * someone signed in to APInex taps "Check in" on apinex.bond that day, every
 * free model answers 402 "Daily check-in required to use free models". That
 * is the whole account, and it lifts by itself once the check-in is done.
 * The check-in sits behind a human check on APInex's own page; One never
 * tries to do it.
 */

export type ApinexRefusal = "not_free" | "quota_daily" | "quota" | "check_in";

/**
 * Findings about a model rather than its answer: billed on this account, or
 * a decision model that cannot write. The card lists them but never counts
 * them among the free models checked.
 */
export const NOT_COUNTED: ReadonlySet<string> = new Set(["not_free", "decision"]);

/** A key-shaped run of characters: never kept, whatever the message. */
const KEYISH = /\b(?:sk|pk|rk|key|api|tok)[-_][A-Za-z0-9_-]{6,}|[A-Za-z0-9+/=_]{24,}/giu;

/**
 * The provider's own words about a refusal, short and with anything shaped
 * like a key taken out. Kept only by the free models' check, whose jobs are
 * invented, so it can never quote a school record; the router reads it to
 * sort the refusal and keeps nothing.
 */
export function cleanSaid(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  const text = raw.replace(KEYISH, "…").replace(/\s+/gu, " ").trim();
  if (!text) return undefined;
  return text.length > 140 ? `${text.slice(0, 139)}…` : text;
}

/** The seconds a 429 asks the caller to wait, when it says, within reason. */
export function retryAfterSeconds(header: string | null | undefined): number | undefined {
  if (!header) return undefined;
  const seconds = Number(header.trim());
  return Number.isInteger(seconds) && seconds >= 1 && seconds <= 300 ? seconds : undefined;
}

/** Which of APInex's refusals this is, from its status and words; null when it is none of them. */
export function apinexRefusal(status: number | undefined, said: string | undefined): ApinexRefusal | null {
  const text = (said ?? "").toLowerCase();
  if (/check-?in/u.test(text)) return "check_in";
  if (/daily limit|daily free|free tier.*(?:exhausted|used)/u.test(text)) return "quota_daily";
  if (status === 402 && /balance|spend limit/u.test(text)) return "not_free";
  if (status === 429 && /per minute|rate limit/u.test(text)) return "quota";
  return null;
}
