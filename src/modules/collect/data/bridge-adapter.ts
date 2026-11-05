/**
 * The bridge adapter (plan §5): Collect for real staff, on the Fees ledger.
 * Every call is a server action in `app/(app)/payments/collect-actions.ts`.
 *
 * "Likely today" has no Fees read yet (plan §4: a Fees-side "likely today"
 * read is still to build), so it lists only the children this browser
 * collected from recently, and their siblings who still owe.
 */

import {
  collectDuesAction,
  collectPostAction,
  collectQuoteAction,
  collectSearchAction,
  collectStatusAction,
} from "@/app/(app)/payments/collect-actions";
import { bridgeQuery, inClass, queryShape } from "@/modules/collect/domain/search";
import type { LikelyRow } from "@/modules/collect/domain/types";

import type { MoneyPort, MoneyPortInfo } from "./money-port";

const LOST = "The answer did not come back. It may have been saved.";

export function bridgeAdapter(info: MoneyPortInfo, recall: () => readonly LikelyRow[]): MoneyPort {
  const session = info.sessionLabel;
  return {
    ...info,
    async search(raw) {
      const shape = queryShape(raw);
      const asked = bridgeQuery(shape, raw);
      if (!asked) return { ok: true, rows: [] };
      try {
        const answer = await collectSearchAction(session, asked);
        if (!answer.ok || shape.kind !== "class") return answer;
        return { ok: true, rows: answer.rows.filter((row) => inClass(row.classLabel, shape)) };
      } catch {
        return { ok: false, message: "The search did not come back." };
      }
    },
    async likely() {
      return [...recall()];
    },
    async dues(studentId) {
      try {
        return await collectDuesAction(studentId, session);
      } catch {
        return { ok: false, message: "This child's dues could not be loaded." };
      }
    },
    async prepare(input) {
      try {
        return await collectQuoteAction({ ...input, sessionLabel: session });
      } catch {
        return { ok: false, message: "Fees could not quote this payment." };
      }
    },
    async post(input) {
      try {
        return await collectPostAction({ ...input, sessionLabel: session });
      } catch {
        // The request left this browser and no answer came back: it may have been saved.
        return { kind: "uncertain", message: LOST };
      }
    },
    async status(input) {
      try {
        return await collectStatusAction({ commandId: input.commandId, sessionLabel: session });
      } catch {
        return { kind: "unknown", message: "Fees could not be asked about this payment." };
      }
    },
  };
}
