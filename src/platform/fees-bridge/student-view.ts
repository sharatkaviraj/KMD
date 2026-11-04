import type {
  BridgeStudentFees, BridgeStudentFinanceHistory, BridgeStudentHistory, BridgeStudentHousehold, BridgeStudentLedger,
  BridgeStudentReceipts, BridgeWorkspace,
} from "./student-read-contracts";

/**
 * Student 360 from Fees' single-purpose reads (review P02), in the workspace
 * shape the screen already draws. One asks only for the sections its own
 * permissions let it show; a section it did not ask for is null here, exactly
 * as a section Fees refused.
 *
 * Each read is its own snapshot. The money band (summary, breakdown,
 * installments, EMI) is always one of them; the rest must at least agree on the
 * student, the session, the school day and the reader's Fees permissions, or
 * the record is refused rather than drawn from two different answers.
 */
export type StudentViewParts = {
  fees: BridgeStudentFees;
  receipts?: BridgeStudentReceipts | null;
  ledger?: BridgeStudentLedger | null;
  financeHistory?: BridgeStudentFinanceHistory | null;
  household?: BridgeStudentHousehold | null;
  history?: BridgeStudentHistory | null;
};
const NO_HISTORY: BridgeWorkspace["history"] = { contacts: null, collectionFlags: null, recovery: null, attempts: null, reminders: null, notices: null, documents: null };

export function composeStudentView(parts: StudentViewParts): BridgeWorkspace {
  const { fees, receipts, ledger, financeHistory, household, history } = parts;
  const permissions = JSON.stringify(fees.permissions);
  for (const part of [receipts, ledger, financeHistory, household, history]) {
    if (part && (part.studentId !== fees.studentId || part.sessionLabel !== fees.sessionLabel || part.asOfDate !== fees.asOfDate ||
        JSON.stringify(part.permissions) !== permissions)) throw new Error("mixed_reads");
  }
  return {
    ...fees,
    receipts: receipts?.receipts ?? null,
    ledger: ledger?.ledger ?? null,
    family: household?.family ?? null,
    household: household?.household ?? null,
    financeHistory: financeHistory?.financeHistory ?? null,
    history: history?.history ?? NO_HISTORY,
    pagination: {
      receipts: receipts?.pagination ?? null,
      ledgerPayments: ledger?.pagination.payments ?? null,
      ledgerAdjustments: ledger?.pagination.adjustments ?? null,
      financeHistory: financeHistory?.pagination ?? null,
    },
  };
}
