export { bounceChequeAction, createDepositSlipAction, decideRequestAction, markClearedAction, matchUpiAction, notFeeUpiAction, remindAdminAction, requestRefundAction, unmatchUpiAction, uploadStatementAction, withdrawRequestAction } from "../accountant-mobile/actions";
export async function saveChequeDetailsAction(input: { receiptId: string; chequeNo: string; bank: string; chequeDate: string }) {
  const attempts = JSON.parse(localStorage.getItem("ops-imp05-save-attempts") ?? "[]");
  localStorage.setItem("ops-imp05-save-attempts", JSON.stringify([...attempts, input]));
  return { ok: true, message: "Synthetic draft confirmed; no database write" };
}
