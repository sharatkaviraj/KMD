import { p, type Pair } from "@/vx/text";

/*
 * The bands a date sheet is drawn in. A school runs one sitting per band, not
 * per class: every class from 6 to 8 sits Science on the same morning.
 */

export const GROUP_KEYS = ["pre", "c1_5", "c6_8", "c9_10", "c11_12"] as const;
export type GroupKey = (typeof GROUP_KEYS)[number];

export const GROUP_LABELS: Record<GroupKey, Pair> = {
  pre: p("Pre-primary", "पूर्व-प्राथमिक"),
  c1_5: p("Classes 1–5", "कक्षा 1–5"),
  c6_8: p("Classes 6–8", "कक्षा 6–8"),
  c9_10: p("Classes 9–10", "कक्षा 9–10"),
  c11_12: p("Classes 11–12", "कक्षा 11–12"),
};

/** How long a sitting usually is, per band, for a new slot. */
export const GROUP_DEFAULT_MINUTES: Record<GroupKey, number> = {
  pre: 45,
  c1_5: 60,
  c6_8: 90,
  c9_10: 90,
  c11_12: 90,
};

const PRE_PRIMARY = /^(nursery|lkg|ukg|jkg|skg|kg|pre|play)/i;

/**
 * Which band a class sits in, from its name: "Nursery", "Class 7",
 * "11 Science". A name with no number and no pre-primary word belongs to no
 * band and is left off the date sheet rather than guessed.
 */
export function groupOf(className: string): GroupKey | null {
  const name = className.trim();
  if (PRE_PRIMARY.test(name)) return "pre";
  const n = Number(name.match(/(\d{1,2})/)?.[1] ?? NaN);
  if (!Number.isFinite(n)) return null;
  if (n >= 1 && n <= 5) return "c1_5";
  if (n >= 6 && n <= 8) return "c6_8";
  if (n >= 9 && n <= 10) return "c9_10";
  if (n >= 11 && n <= 12) return "c11_12";
  return null;
}

export function isGroupKey(value: unknown): value is GroupKey {
  return typeof value === "string" && (GROUP_KEYS as readonly string[]).includes(value);
}
