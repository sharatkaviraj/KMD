import { t, type Localized } from "@/platform/i18n/language";

/**
 * What a messaging provider can do to you, and how to ask for each on demand.
 *
 * QA.md wants success, slow, timeout, 429, 500 and a duplicate callback
 * exercised against every screen that sends. Waiting for a real provider to
 * rate-limit you is not a test plan, and pointing the real provider at a made-up
 * number is worse — a test student does not make a recipient phone a test phone
 * (PLAN §1). So the outcome is chosen by the **last digit of the destination**,
 * and the fixture creates recipients whose numbers end in the digit for the
 * case it needs.
 *
 * This file is pure: no fetch, no database, no environment. It decides *what
 * should happen*; `data/message-provider.ts` is what makes it happen.
 */

export const providerOutcomes = [
  "sent",
  "slow",
  "timeout",
  "rate_limited",
  "server_error",
  "duplicate",
] as const;

export type ProviderOutcome = (typeof providerOutcomes)[number];

/**
 * Last digit → outcome.
 *
 * 0–4 succeed, because most messages do and a fixture where half the sends
 * fail teaches a reader to ignore failures. The interesting digits are the
 * rest, and they are contiguous and memorable: 5 slow, 6 timeout, 7 too many,
 * 8 broken, 9 sent twice.
 */
const BY_LAST_DIGIT: Record<string, ProviderOutcome> = {
  "0": "sent",
  "1": "sent",
  "2": "sent",
  "3": "sent",
  "4": "sent",
  "5": "slow",
  "6": "timeout",
  "7": "rate_limited",
  "8": "server_error",
  "9": "duplicate",
};

/**
 * What the mock provider will do when handed this number.
 *
 * Anything that is not a digit-ending string succeeds: an unparseable number
 * is the real provider's problem to reject, and inventing a seventh outcome
 * here would mean the mock disagreed with production about what a bad number
 * is.
 */
export function mockOutcomeFor(phone: string): ProviderOutcome {
  const lastDigit = phone.trim().slice(-1);
  return BY_LAST_DIGIT[lastDigit] ?? "sent";
}

/** Every number the fixture can use to force a given outcome. */
export function digitsForOutcome(outcome: ProviderOutcome): string[] {
  return Object.entries(BY_LAST_DIGIT)
    .filter(([, value]) => value === outcome)
    .map(([digit]) => digit);
}

/**
 * The id the mock hands back, which is **stable for a given send**.
 *
 * That is what makes the duplicate case a real test rather than a coin toss:
 * dispatching twice produces the same provider id, so a second delivery
 * callback is indistinguishable from a replay of the first — which is exactly
 * the situation a receipt-like record has to survive. A random id each time
 * would make every duplicate look like a new message and the test would prove
 * nothing.
 *
 * The `mock:` prefix is not decoration. It lands in
 * `message_sends.provider_message_id`, so a row that was never really sent can
 * never be mistaken for one that was — by a screen, by a later query, or by
 * somebody reading the table at cutover.
 */
export const MOCK_ID_PREFIX = "mock:";

export function mockProviderMessageId(sendId: string): string {
  return `${MOCK_ID_PREFIX}${sendId}`;
}

export function isMockProviderMessageId(id: string | null): boolean {
  return typeof id === "string" && id.startsWith(MOCK_ID_PREFIX);
}

/**
 * How each failure reads to the person looking at the queue.
 *
 * Deliberately about what to do next rather than about HTTP. "Too many at
 * once — wait a minute" is actionable; "429" is a number the office has to ask
 * somebody about.
 */
export const outcomeErrors: Record<
  Exclude<ProviderOutcome, "sent" | "slow" | "duplicate">,
  Localized
> = {
  timeout: t(
    "प्रदाता ने जवाब नहीं दिया। फिर कोशिश करें।",
    "The provider did not answer. Try again.",
  ),
  rate_limited: t(
    "एक साथ बहुत सारे। एक मिनट रुककर फिर भेजें।",
    "Too many at once. Wait a minute and send again.",
  ),
  server_error: t(
    "प्रदाता की ओर से गड़बड़ी। यह संदेश अभी नहीं गया।",
    "Something broke at the provider. This message did not go.",
  ),
};

/**
 * Whether an outcome leaves work to retry.
 *
 * `duplicate` is not retryable and that is the whole point of having it: the
 * message went, the second attempt must change nothing, and a queue that
 * offers "try again" on it would invite somebody to send a parent the same
 * thing twice.
 */
export function isRetryable(outcome: ProviderOutcome): boolean {
  return (
    outcome === "timeout" || outcome === "rate_limited" || outcome === "server_error"
  );
}
