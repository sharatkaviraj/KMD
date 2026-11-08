import { known, settled } from "./student-photos";

/*
 * The asking half of `student-photos.ts`, loaded the first time a face needs
 * a photo its screen did not pass, so a page whose faces all came with their
 * photos carries none of it. The asks of one moment go to
 * `/api/photos/students` together, at most 80 children a request.
 */

const BATCH = 80;
const RETRY_MS = 60_000;
const waiting = new Set<string>();
const asking = new Set<string>();
/** A child whose read failed is not asked again before this time. */
const retryAt = new Map<string, number>();
let timer: ReturnType<typeof setTimeout> | null = null;

function later(ids: readonly string[]) {
  const at = Date.now() + RETRY_MS;
  for (const id of ids) retryAt.set(id, at);
}

async function ask(ids: string[]) {
  try {
    const response = await fetch(`/api/photos/students?ids=${ids.join(",")}`, { credentials: "same-origin" });
    const body = (await response.json()) as { photos?: Record<string, string>; failed?: boolean };
    // A failed read is not "no photo": those children are asked again later.
    if (!response.ok || body.failed) later(ids);
    else for (const id of ids) known.set(id, body.photos?.[id] ?? null);
  } catch {
    later(ids);
  } finally {
    for (const id of ids) asking.delete(id);
    settled();
  }
}

function flush() {
  timer = null;
  const ids = [...waiting];
  waiting.clear();
  for (const id of ids) asking.add(id);
  for (let start = 0; start < ids.length; start += BATCH) void ask(ids.slice(start, start + BATCH));
}

export function want(id: string) {
  if (known.has(id) || waiting.has(id) || asking.has(id) || (retryAt.get(id) ?? 0) > Date.now()) return;
  waiting.add(id);
  // Everything a screen draws in one go asks in one request.
  timer ??= setTimeout(flush, 30);
}
