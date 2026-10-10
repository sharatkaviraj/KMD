/**
 * "Enter many payments" — the grid the admin types old paper receipts into.
 *
 * Pure. The grid is checked here as the admin types, so the name fills in and
 * a bad row is marked at once; the authoritative check is still the bulk
 * upload's own server validation (`createPaymentImportBatch`), which the grid
 * feeds as a CSV with the template's columns. One path for typed rows and for
 * an uploaded Excel file, and every row still posts through the same RPC.
 */

import type { DeskMode } from "@/modules/payments/vx/domain/desk";

export type GridRow = {
  key: string;
  sr: string;
  amount: string;
  /** YYYY-MM-DD. */
  date: string;
  mode: DeskMode;
  reference: string;
};

export type GridStudent = { id: string; name: string; sr: string; classLabel: string; father: string | null };

export type GridCheck =
  | { status: "ok" }
  | { status: "warn"; reason: "repeat"; row: number }
  | { status: "warn"; reason: "cheque-no" }
  | { status: "err"; reason: "sr-missing" }
  | { status: "err"; reason: "sr-unknown"; sr: string }
  | { status: "err"; reason: "sr-ambiguous"; sr: string }
  | { status: "err"; reason: "amount" }
  | { status: "err"; reason: "date" };

/** SR numbers match the way the bulk upload matches them: case and punctuation ignored. */
export function normalizeSr(value: string): string {
  return String(value ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function indexStudentsBySr(students: readonly GridStudent[]): Map<string, GridStudent[]> {
  const map = new Map<string, GridStudent[]>();
  for (const s of students) {
    const key = normalizeSr(s.sr);
    if (!key) continue;
    map.set(key, [...(map.get(key) ?? []), s]);
  }
  return map;
}

export function lookupSr(index: Map<string, GridStudent[]>, sr: string): GridStudent | null {
  const hits = index.get(normalizeSr(sr)) ?? [];
  return hits.length === 1 ? hits[0] : null;
}

const wholeAmount = (text: string) => {
  const t = String(text ?? "").trim().replace(/[,₹\s]/g, "");
  if (!/^\d+$/.test(t)) return 0;
  return Number(t);
};

export function checkGridRows(
  rows: readonly GridRow[],
  index: Map<string, GridStudent[]>,
  ctx: { today: string; sessionStart: string },
): GridCheck[] {
  return rows.map((row, i): GridCheck => {
    const sr = row.sr.trim();
    if (!sr) return { status: "err", reason: "sr-missing" };
    const hits = index.get(normalizeSr(sr)) ?? [];
    if (hits.length === 0) return { status: "err", reason: "sr-unknown", sr };
    if (hits.length > 1) return { status: "err", reason: "sr-ambiguous", sr };
    if (!wholeAmount(row.amount)) return { status: "err", reason: "amount" };
    if (!/^\d{4}-\d{2}-\d{2}$/.test(row.date) || row.date > ctx.today || row.date < ctx.sessionStart) return { status: "err", reason: "date" };
    const repeat = rows.findIndex((z, j) => j < i && normalizeSr(z.sr) === normalizeSr(row.sr) && wholeAmount(z.amount) === wholeAmount(row.amount));
    if (repeat >= 0) return { status: "warn", reason: "repeat", row: repeat + 1 };
    if (row.mode === "cheque" && !row.reference.trim()) return { status: "warn", reason: "cheque-no" };
    return { status: "ok" };
  });
}

export function gridTotals(rows: readonly GridRow[], checks: readonly GridCheck[]) {
  let ready = 0;
  let toCheck = 0;
  let problems = 0;
  let amount = 0;
  checks.forEach((c, i) => {
    if (c.status === "err") problems += 1;
    else {
      if (c.status === "warn") toCheck += 1;
      else ready += 1;
      amount += wholeAmount(rows[i]?.amount ?? "");
    }
  });
  return { ready, toCheck, problems, saving: ready + toCheck, amount };
}

const MODE_TEXT: Record<DeskMode, string> = { cash: "Cash", upi: "UPI", bank_transfer: "Bank transfer", cheque: "Cheque" };

function csvCell(value: string): string {
  const v = String(value ?? "");
  return /[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

/**
 * The rows the server should validate, as the template's CSV. Rows with a
 * problem are left out (the design: "this row is skipped"); the reference goes
 * into Remarks because the bulk upload has no reference column.
 */
export function gridToCsv(rows: readonly GridRow[], checks: readonly GridCheck[]): { csv: string; included: GridRow[] } {
  const included = rows.filter((_, i) => checks[i]?.status !== "err");
  const lines = ["SR no,Amount,Payment date,Payment mode,Remarks"];
  for (const row of included) {
    const ref = row.reference.trim();
    const remarks = ref ? (row.mode === "cheque" ? `Cheque no. ${ref}` : `Ref ${ref}`) : "";
    lines.push([row.sr.trim(), String(wholeAmount(row.amount)), row.date, MODE_TEXT[row.mode], remarks].map(csvCell).join(","));
  }
  return { csv: `${lines.join("\n")}\n`, included };
}

/** A server-validated row back into the grid, for an uploaded Excel file. */
export function gridRowFromImport(
  row: { admissionNo: string | null; amount: number | null; paymentDate: string | null; paymentMode: string | null; remarks: string | null },
  key: string,
): GridRow {
  const mode: DeskMode = row.paymentMode === "upi" || row.paymentMode === "bank_transfer" || row.paymentMode === "cheque" ? row.paymentMode : "cash";
  const remarks = String(row.remarks ?? "").trim();
  const reference = remarks.replace(/^(cheque no\.|ref)\s*/i, "");
  return { key, sr: row.admissionNo ?? "", amount: row.amount ? String(row.amount) : "", date: row.paymentDate ?? "", mode, reference };
}
