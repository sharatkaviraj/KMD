import "server-only";

import { AsyncLocalStorage } from "node:async_hooks";

import { isTestSessionLabel } from "@/platform/auth/test-session-policy";

/**
 * A read of one TEST child's own records with nobody signed in behind it
 * (D-597).
 *
 * The roster projection (`projection-fetch.ts`) names the reader of every
 * `public` read through the fee clients, from the cookie or an AI
 * connection's verified actor, and refuses a read with neither. Veer Patta AI
 * has neither when a parent asks it for a receipt on WhatsApp: the request is
 * the school hub's webhook. While it practises, the family's children are
 * TEST children, whose records are One's own (the local TEST engine), so the
 * read it needs is the one a TEST account's would be. This context says that
 * and nothing more:
 *
 *  - It is set only by `src/modules/whatsapp/data/helper-receipt.ts`, after
 *    the child was read as a TEST child through the helper's TEST-only RPC
 *    (`tests/fees-bridge-projection-fetch.test.ts` pins the caller).
 *  - Only reads pass, and only to One's own database, as a TEST account's
 *    would; a write or an RPC is refused exactly as before.
 *  - It cannot name a real year: `withTestRecordRead` refuses one, so it can
 *    never reach a projection of real children or the Fees app.
 */

export type TestRecordRead = { studentId: string; sessionLabel: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const context = new AsyncLocalStorage<TestRecordRead>();

export function withTestRecordRead<T>(scope: TestRecordRead, read: () => Promise<T>): Promise<T> {
  if (!UUID.test(scope.studentId) || !isTestSessionLabel(scope.sessionLabel)) throw new Error("Not a TEST child's record.");
  return context.run({ studentId: scope.studentId.toLowerCase(), sessionLabel: scope.sessionLabel }, read);
}

export function testRecordReadInContext(): TestRecordRead | null {
  const scope = context.getStore();
  return scope && UUID.test(scope.studentId) && isTestSessionLabel(scope.sessionLabel) ? scope : null;
}
