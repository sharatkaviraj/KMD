import type { ChequeRow } from "@/modules/finance-controls/vx/types";

type Suggestion = { bank: string | null; chequeDate: string | null };

/** Draft hints only: receipt text never creates or changes bookkeeping metadata. */
export function chequeReceiptSuggestion(notes: string | null | undefined): Suggestion | null {
  // The composer truncates at 1000 characters. Legacy or ambiguous free text
  // stays visible for a person to review, rather than becoming guessed fields.
  if (!notes || notes.length >= 1000 || (notes.match(/Cheque:/g)?.length ?? 0) !== 1 || (notes.match(/; subject to clearing\./g)?.length ?? 0) !== 1) return null;
  const match = /^Cheque: ([^\r\n]+?); subject to clearing\.(?: |$)/.exec(notes);
  if (!match) return null;
  const head = match[1];
  const dated = /, dated (\d{4}-\d{2}-\d{2})$/.exec(head);
  const bank = dated ? head.slice(0, dated.index) : head;
  if (!bank || bank !== bank.trim() || bank.includes(", dated ") || (!dated && head.includes(", dated "))) return null;
  const chequeDate = dated?.[1] ?? null;
  if (chequeDate) {
    const parsed = new Date(`${chequeDate}T00:00:00.000Z`);
    if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== chequeDate) return null;
  }
  return { bank: bank === "bank not given" ? null : bank, chequeDate };
}

/**
 * What the cheque list and the deposit slip show: the cheque's own details
 * when they were entered on Cheques, else what the cashier typed at the
 * Payment Desk (the number is the receipt's reference; the bank and date are
 * in its "Cheque: …; subject to clearing." note). Display only — nothing is
 * written. Before this, every desk cheque read "— / —" with "Add details" and
 * had to be typed again before a deposit slip (school-day run, accountant B7).
 */
export function withDeskChequeDetails<T extends Pick<ChequeRow, "chequeNo" | "bank" | "chequeDate" | "reference" | "receiptNotes">>(cheque: T): T {
  if (cheque.chequeNo && cheque.bank && cheque.chequeDate) return cheque;
  const suggestion = chequeReceiptSuggestion(cheque.receiptNotes);
  const fromReference = cheque.reference?.replace(/\D/g, "").slice(0, 12) || null;
  return {
    ...cheque,
    chequeNo: cheque.chequeNo ?? fromReference,
    bank: cheque.bank ?? suggestion?.bank ?? null,
    chequeDate: cheque.chequeDate ?? suggestion?.chequeDate ?? null,
  };
}

export function chequeDetailsDraft(cheque: Pick<ChequeRow, "chequeNo" | "bank" | "chequeDate" | "reference" | "paymentDate" | "receiptNotes">) {
  const suggestion = chequeReceiptSuggestion(cheque.receiptNotes);
  return {
    chequeNo: cheque.chequeNo ?? cheque.reference?.replace(/\D/g, "").slice(0, 12) ?? "",
    bank: cheque.bank ?? suggestion?.bank ?? "",
    chequeDate: cheque.chequeDate ?? suggestion?.chequeDate ?? cheque.paymentDate,
    suggested: Boolean((cheque.bank == null && suggestion?.bank) || (cheque.chequeDate == null && suggestion?.chequeDate)),
  };
}
