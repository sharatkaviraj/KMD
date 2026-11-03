import "server-only";

import { AsyncLocalStorage } from "node:async_hooks";

import { isVerifiedActor, type VerifiedActor } from "@/platform/auth/verified-actor";

/**
 * The verified actor behind a read, for the one place that must name its
 * reader without a cookie: the fees-bridge roster projection
 * (`src/platform/fees-bridge/projection-fetch.ts`), which decides per reader
 * whether a `public` roster read goes to One's own projection. Under the
 * bridge, class names and the session list are such reads, and the AI
 * connection has no cookie. Only `src/modules/mcp/data/` sets it, after the
 * whole per-call check (plan §5.3) has passed. A cookie request never has it.
 */
const context = new AsyncLocalStorage<VerifiedActor>();

export function withVerifiedActor<T>(actor: VerifiedActor, read: () => Promise<T>): Promise<T> {
  if (!isVerifiedActor(actor) || actor.isActive !== true) throw new Error("Not a verified actor.");
  return context.run(actor, read);
}

export function verifiedActorInContext(): VerifiedActor | null {
  const actor = context.getStore();
  return actor && isVerifiedActor(actor) && actor.isActive === true ? actor : null;
}
