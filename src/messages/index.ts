/**
 * The catalogue as one object, `m`, for code that wants every pair at once
 * (the language tests, server code).
 *
 * Client components import `* as m from "@/messages/pairs"` instead. The pairs
 * are separate named exports there, so the bundler ships only the ones a page
 * actually reads: as one 115 KB object literal it could not drop any, and every
 * page that said one word downloaded all ~960 (6 Nov 2026, docs/ui/PERFORMANCE.md).
 */
import type * as pairs from "./pairs";

export * as m from "./pairs";

export type MessageKey = keyof typeof pairs;
