import type { PaymentMode } from "@/platform/db/types";
import type { ReceiptDetail, ReceiptInstallmentStatusItem } from "@/modules/receipts/domain/types";

/**
 * A Fees receipt read through the live Fees connection, in the shape the Fees
 * receipt template takes (review F03). The two contracts match field for
 * field; only three plain strings on the wire are narrowed here. A value the
 * template does not know is refused, never mapped to a neighbour: a receipt
 * that silently printed "Cash" for an unknown mode would be a false receipt.
 */
export type BridgeReceiptInput = Omit<ReceiptDetail, "paymentMode" | "studentStatusLabel" | "installmentStatus"> & {
  paymentMode: string;
  studentStatusLabel: string;
  installmentStatus: (Omit<ReceiptInstallmentStatusItem, "status"> & { status: string })[];
};

const MODES: readonly PaymentMode[] = ["cash", "upi", "bank_transfer", "cheque", "discount", "online"];
const TIERS = ["New", "Old"] as const;
const STATUSES: readonly ReceiptInstallmentStatusItem["status"][] = ["paid", "partial", "overdue", "pending"];

export class BridgeReceiptShapeError extends Error {
  constructor(readonly field: string, readonly value: string) {
    super(`The Fees receipt has a ${field} the receipt template does not know: ${value}`);
    this.name = "BridgeReceiptShapeError";
  }
}

function known<T extends string>(field: string, value: string, allowed: readonly T[]): T {
  if ((allowed as readonly string[]).includes(value)) return value as T;
  throw new BridgeReceiptShapeError(field, value);
}

export function receiptDetailFromBridge(detail: BridgeReceiptInput): ReceiptDetail {
  return {
    ...detail,
    paymentMode: known("payment mode", detail.paymentMode, MODES),
    studentStatusLabel: known("fee tier", detail.studentStatusLabel, TIERS),
    installmentStatus: detail.installmentStatus.map((row) => ({ ...row, status: known("instalment status", row.status, STATUSES) })),
  };
}
