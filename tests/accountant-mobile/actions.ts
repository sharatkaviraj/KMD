import { parseUpiStatement } from "@/modules/finance-controls/vx/domain/books";

// Isolated component harness: no server, authentication, database or provider.
const blocked = async (..._input: unknown[]) => ({ ok: false, message: "Synthetic bookkeeping save unavailable — no database mutation" });
export const bounceChequeAction = blocked;
export const createDepositSlipAction = blocked;
export const decideRequestAction = blocked;
export const markClearedAction = blocked;
export const matchUpiAction = blocked;
export const notFeeUpiAction = blocked;
export const remindAdminAction = blocked;
export const requestRefundAction = blocked;
export const saveChequeDetailsAction = blocked;
export const unmatchUpiAction = blocked;
export const withdrawRequestAction = blocked;
export const addToQueueAction = blocked;
export const updateQueueAction = blocked;
export const setRemindersPausedAction = blocked;
export const searchFamiliesAction = async (..._input: unknown[]) => [];
export const logoutAction = blocked;
export async function uploadStatementAction(input: { text: string; bankLabel?: string }) {
  const parsed = parseUpiStatement(input.text);
  return { ok: false, message: parsed.errors.length ? `Line ${parsed.errors[0].line}: ${parsed.errors[0].reason}` : "Synthetic upload unavailable — no database mutation" };
}
