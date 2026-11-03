import { returnTable, safeSpreadsheetText, type GovernmentAdapter, type ReturnStudent } from "./exchange";

/*
 * Manual entry assistant ("Portal Copilot"). The operator types into the
 * official portal; One shows one prepared row at a time, copies values and
 * remembers which rows a person marked entered. Pure: nothing here logs in,
 * submits, or decides acceptance — "entered" is a human's own record of what
 * they typed, never the portal's answer.
 */

export type CopilotState = "entered" | "mismatch";
export type CopilotMark = { state: CopilotState; note: string | null; updatedAt: string };
export type CopilotRow = { key: string; name: string; classLabel: string; values: string[] };
export type CopilotSheet = { headers: string[]; rows: CopilotRow[] };

/**
 * The prepared rows exactly as the reference sheet formats them, in the
 * batch's own column order — minus One's internal student UUID, which no
 * portal asks for and which would push every shortcut number along by one.
 */
export function copilotSheet(rows: ReturnStudent[], adapter: GovernmentAdapter): CopilotSheet {
  const table = returnTable(rows, adapter);
  const keep = adapter.columns.map((column, index) => ({ column, index })).filter(({ column }) => column.field !== "studentId").map(({ index }) => index);
  return {
    headers: keep.map((index) => table[0][index]),
    rows: rows.map((row, i) => ({ key: row.studentId, name: row.studentName, classLabel: row.classLabel, values: keep.map((index) => table[i + 1][index]) })),
  };
}

/**
 * One row for a portal that accepts a pasted row: tab-separated, with any
 * tab or line break inside a value flattened (it would split the row), and
 * formula-like text neutralised the same way the reference sheet does it.
 */
export function copilotRowText(values: string[]): string {
  return values.map((value) => safeSpreadsheetText(value.replace(/[\t\r\n]+/g, " "))).join("\t");
}

/**
 * Where a returning operator starts: the first row nobody has touched; then
 * the first mismatch still waiting on a fix; then the last row when every
 * row is entered. A mismatch is deliberately not "untouched" — reopening on
 * the same mismatch every morning would hide the work behind it.
 */
export function copilotResume(keys: string[], marks: Record<string, Pick<CopilotMark, "state"> | undefined>): number {
  if (!keys.length) return 0;
  const untouched = keys.findIndex((key) => !marks[key]);
  if (untouched >= 0) return untouched;
  const mismatch = keys.findIndex((key) => marks[key]?.state === "mismatch");
  return mismatch >= 0 ? mismatch : keys.length - 1;
}
/** Next/previous without wrapping: J at the last row stays on the last row. */
export function copilotStep(index: number, length: number, delta: number): number {
  if (length <= 0) return 0;
  return Math.min(length - 1, Math.max(0, index + delta));
}
/** After marking a row: the next row nobody has touched, else simply the next one. */
export function copilotAfterMark(index: number, keys: string[], marks: Record<string, Pick<CopilotMark, "state"> | undefined>): number {
  for (let i = index + 1; i < keys.length; i += 1) if (!marks[keys[i]]) return i;
  return copilotStep(index, keys.length, 1);
}
export function copilotProgress(keys: string[], marks: Record<string, Pick<CopilotMark, "state"> | undefined>) {
  let entered = 0, mismatch = 0;
  for (const key of keys) { const state = marks[key]?.state; if (state === "entered") entered += 1; else if (state === "mismatch") mismatch += 1; }
  return { total: keys.length, entered, mismatch, remaining: keys.length - entered - mismatch };
}

export type CopilotKeyAction = { kind: "next" } | { kind: "prev" } | { kind: "copy"; index: number };
/**
 * Keyboard shortcuts: J / → next, K / ← previous, 1–9 copy field n. Never
 * while typing (the mismatch note), never with a modifier (Ctrl+1 is the
 * browser's), and a digit past the last field does nothing.
 */
export function copilotKey(event: { key: string; ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean; inField?: boolean }, fieldCount: number): CopilotKeyAction | null {
  if (event.inField || event.ctrlKey || event.metaKey || event.altKey) return null;
  const key = event.key;
  if (key === "j" || key === "J" || key === "ArrowRight") return { kind: "next" };
  if (key === "k" || key === "K" || key === "ArrowLeft") return { kind: "prev" };
  if (/^[1-9]$/.test(key)) { const index = Number(key) - 1; return index < fieldCount ? { kind: "copy", index } : null; }
  return null;
}
