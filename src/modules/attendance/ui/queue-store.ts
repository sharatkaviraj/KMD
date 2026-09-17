import {
  QUEUE_KEY,
  type QueuedRegister,
} from "@/modules/attendance/domain/attendance";

/**
 * The offline queue, as an external store React can subscribe to.
 *
 * `localStorage` is exactly what `useSyncExternalStore` is for: a thing
 * outside React that holds state, can change without React knowing, and is
 * read on mount. Modelling it as component state instead means reading it in
 * an effect and calling `setState` — which is a cascading render, and which
 * the lint rule that caught this correctly refuses.
 *
 * Every access is wrapped. Storage throws in a private window, when site data
 * is blocked, and on some Android WebViews with no space left; the register
 * has to keep working in all three, just without the safety net.
 */

type Queue = Record<string, QueuedRegister>;

const EMPTY = "{}";

let listeners: (() => void)[] = [];

/**
 * The snapshot must be referentially stable between changes or React
 * re-renders forever, so this caches the raw string and hands back the same
 * one until something writes.
 */
let cached: string | null = null;

function emit() {
  for (const listener of listeners) listener();
}

export function subscribeQueue(onChange: () => void): () => void {
  listeners = [...listeners, onChange];

  // Another tab marking the same register is a real case in the office, where
  // one person has the laptop and the phone open.
  const onStorage = (event: StorageEvent) => {
    if (event.key === null || event.key === QUEUE_KEY) {
      cached = null;
      onChange();
    }
  };

  window.addEventListener("storage", onStorage);

  return () => {
    listeners = listeners.filter((entry) => entry !== onChange);
    window.removeEventListener("storage", onStorage);
  };
}

export function queueSnapshot(): string {
  if (cached !== null) return cached;

  try {
    cached = window.localStorage.getItem(QUEUE_KEY) ?? EMPTY;
  } catch {
    cached = EMPTY;
  }

  return cached;
}

/** The server renders an empty queue: there is no storage there to read. */
export function serverQueueSnapshot(): string {
  return EMPTY;
}

export function parseQueue(snapshot: string): Queue {
  try {
    const parsed: unknown = JSON.parse(snapshot);
    return parsed && typeof parsed === "object" ? (parsed as Queue) : {};
  } catch {
    // A corrupted queue is dropped rather than crashing the register. The
    // work in it is lost either way; a screen that will not open loses the
    // rest of the morning too.
    return {};
  }
}

export function readQueue(): Queue {
  return parseQueue(queueSnapshot());
}

export function writeQueue(queue: Queue): void {
  const serialised = JSON.stringify(queue);

  try {
    window.localStorage.setItem(QUEUE_KEY, serialised);
    cached = serialised;
  } catch {
    // Storage is unavailable or full. Keep the value in memory so the rest of
    // this marking session still behaves, and let the flush do the real work.
    cached = serialised;
  }

  emit();
}
