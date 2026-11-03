/**
 * A read that got some of its parts and lost others.
 *
 * Thrown with whatever did arrive, so a caller can show those rows and still
 * say that something is missing — instead of either dropping everything (one
 * refused table used to hide every money request) or presenting the rest as
 * the whole truth.
 */
export class PartialReadError<T> extends Error {
  constructor(
    readonly partial: T,
    readonly failedParts: readonly string[],
  ) {
    super(`Some parts could not be read: ${failedParts.join(", ")}`);
    this.name = "PartialReadError";
  }
}

/** Settle named parts together; every part that arrived is kept. */
export async function settleParts<T>(parts: readonly (readonly [string, () => Promise<T[]>])[]): Promise<T[]> {
  const settled = await Promise.allSettled(parts.map(([, read]) => read()));
  const rows: T[] = [];
  const failed: string[] = [];
  settled.forEach((result, i) => {
    if (result.status === "fulfilled") rows.push(...result.value);
    else failed.push(parts[i][0]);
  });
  if (failed.length) throw new PartialReadError(rows, failed);
  return rows;
}
