import type { Pair } from "@/vx/text";

/*
 * Lines a report card prints. A card is a bilingual document: both languages
 * print on every copy, whatever the reader's own setting, so these return one
 * string with both halves rather than a pair.
 */

/**
 * The result line when a child has not passed: which subjects, so a parent
 * reads "Needs support in Maths", not a bare "Needs support" beside a card
 * that otherwise looks fine (smoke 20 Oct).
 */
export function supportLine(subjects: Pair[]): string {
  if (subjects.length === 0) return "Needs support · पूरक कक्षाएँ";
  const en = subjects.map((s) => s.en).join(", ");
  const hi = subjects.map((s) => s.hi ?? s.en).join(", ");
  return `Needs support in ${en} · ${hi} में सहायता चाहिए`;
}

/**
 * Why the percentage is not the total divided by the maximum: each exam's
 * weight, printed under it so a parent with a calculator can check it
 * (smoke 20 Oct: 262.5/380 is 69.1%, the card said 70.8% "weighted by exam").
 * Empty when every exam counts the same.
 */
export function weightsLine(weights: { name: Pair; weight: number }[]): string {
  if (new Set(weights.map((w) => w.weight)).size < 2) return "";
  const en = weights.map((w) => `${w.name.en} ×${w.weight}`).join(", ");
  const hi = weights.map((w) => `${w.name.hi ?? w.name.en} ×${w.weight}`).join(", ");
  return `Each exam's marks count: ${en} · हर परीक्षा के अंकों का भार: ${hi}`;
}
