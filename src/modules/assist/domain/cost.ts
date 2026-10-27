/**
 * What a draft cost, in US dollars, from the usage the API reports.
 *
 * Per million tokens, October 2026 list prices. Claude Haiku 5.5 has a second
 * rate card above 100K prompt tokens; nothing here sends a prompt that long,
 * but the arithmetic follows the card rather than assuming it. Thinking is
 * billed as output and is already inside `output_tokens`.
 *
 * The figure is an estimate for the admin's usage page and the monthly budget
 * check. The invoice in the Claude Console is the authority.
 */

type Card = { input: number; output: number; cacheRead: number; cacheWrite: number };

const PRICES: Record<string, { base: Card; long?: { above: number; card: Card } }> = {
  "claude-haiku-5-5": {
    base: { input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite: 0.125 },
    long: { above: 100_000, card: { input: 0.5, output: 2.5, cacheRead: 0.05, cacheWrite: 0.625 } },
  },
  "claude-sonnet-5-5": {
    base: { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 },
  },
};

export type Usage = {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
};

export function costUsd(model: string, usage: Usage): number {
  const price = PRICES[model];
  if (!price) return 0;
  const read = usage.cache_read_input_tokens ?? 0;
  const write = usage.cache_creation_input_tokens ?? 0;
  const prompt = usage.input_tokens + read + write;
  const card = price.long && prompt > price.long.above ? price.long.card : price.base;
  const dollars =
    (usage.input_tokens * card.input +
      usage.output_tokens * card.output +
      read * card.cacheRead +
      write * card.cacheWrite) /
    1_000_000;
  // Six places: a Haiku rewrite is a few hundredths of a cent.
  return Math.round(dollars * 1_000_000) / 1_000_000;
}

/** "$0.03", "$12.40", "<$0.01" — for the admin's page, never shown to a teacher. */
export function dollars(value: number): string {
  if (value > 0 && value < 0.01) return "<$0.01";
  return `$${value.toFixed(2)}`;
}

/** The first moment of this month in India, as UTC — budgets reset on the school's calendar. */
export function monthStartIst(now: Date): Date {
  const ist = new Date(now.getTime() + 330 * 60_000);
  return new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), 1) - 330 * 60_000);
}

/** Midnight today in India, as UTC — the daily cap resets at the school's midnight. */
export function dayStartIst(now: Date): Date {
  const ist = new Date(now.getTime() + 330 * 60_000);
  return new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate()) - 330 * 60_000);
}
