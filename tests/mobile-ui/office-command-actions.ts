// Fees office commands (reverse, refund decide/process) the Inbox and receipt
// screens import; the synthetic browser fixture never reaches Fees.
const refuse = async () => ({ ok: false as const, code: "forbidden", uncertain: false });
export const reverseFeesReceiptAction = refuse;
export const decideFeesRefundAction = refuse;
export const processFeesRefundAction = refuse;
export const checkFeesOfficeCommandAction = refuse;
