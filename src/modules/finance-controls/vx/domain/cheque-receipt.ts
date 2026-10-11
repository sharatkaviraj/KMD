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

export function chequeDetailsDraft(cheque: Pick<ChequeRow, "chequeNo" | "bank" | "chequeDate" | "reference" | "paymentDate" | "receiptNotes">) {
  const suggestion = chequeReceiptSuggestion(cheque.receiptNotes);
  return {
    chequeNo: cheque.chequeNo ?? cheque.reference?.replace(/\D/g, "").slice(0, 12) ?? "",
    bank: cheque.bank ?? suggestion?.bank ?? "",
    chequeDate: cheque.chequeDate ?? suggestion?.chequeDate ?? cheque.paymentDate,
    suggested: Boolean((cheque.bank == null && suggestion?.bank) || (cheque.chequeDate == null && suggestion?.chequeDate)),
  };
}
