import { p, type Pair } from "@/vx/text";

/*
 * The marks tracker draws Classes 11–12 one stream to a band (Science,
 * Commerce, Arts), as the design does: the streams sit different papers, so
 * one band for all of them would be a wide grid of mostly empty cells.
 */

export type Stream = "science" | "commerce" | "arts";

const STREAM_LABELS: Record<Stream, Pair> = {
  science: p("11–12 Science", "11–12 विज्ञान"),
  commerce: p("11–12 Commerce", "11–12 वाणिज्य"),
  arts: p("11–12 Arts", "11–12 कला"),
};

/** The stream named in a class label ("11 Science", "12 Com", "XI Arts"), or null. */
export function streamOf(classLabel: string): Stream | null {
  const s = classLabel.toLowerCase();
  if (/\bsci(ence)?\b|\bbio\b|\bmaths?\b|\bpcm\b|\bpcb\b/.test(s)) return "science";
  if (/\bcom(merce)?\b/.test(s)) return "commerce";
  if (/\barts?\b|\bhumanities\b/.test(s)) return "arts";
  return null;
}

/**
 * Split one band's class labels by stream. Classes with no stream word stay
 * together under the band's own key; a band with a single stream (or none)
 * is returned whole.
 */
export function splitByStream<T extends { classLabel: string }>(items: T[]): { stream: Stream | null; label: Pair | null; items: T[] }[] {
  const order: (Stream | null)[] = ["science", "commerce", "arts", null];
  const groups = new Map<Stream | null, T[]>();
  for (const item of items) {
    const key = streamOf(item.classLabel);
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  if (groups.size <= 1) return [{ stream: null, label: null, items }];
  return order.filter((k) => groups.has(k)).map((k) => ({ stream: k, label: k ? STREAM_LABELS[k] : null, items: groups.get(k)! }));
}
