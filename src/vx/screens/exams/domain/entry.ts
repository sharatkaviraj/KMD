/*
 * Typing marks: the number pad, the jump to the next child, and what the
 * sheet sends. A blank is never a zero (P7); the pad never writes a mark the
 * paper cannot hold.
 */

export type CellState = "blank" | "value" | "absent" | "exempt";
export type Cell = { state: CellState; value: number | null };

export const BLANK: Cell = { state: "blank", value: null };

export type MarkParse =
  | { ok: true; value: number | null }
  | { ok: false; reason: "over" | "step" | "nan" };

/** Read what was typed into a cell: "" is blank, otherwise a number within the paper. */
export function parseMark(text: string, maxMarks: number, step: number): MarkParse {
  const t = text.trim();
  if (t === "") return { ok: true, value: null };
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return { ok: false, reason: "nan" };
  const value = Number(t);
  if (value > maxMarks) return { ok: false, reason: "over" };
  const units = value / step;
  if (Math.abs(units - Math.round(units)) > 1e-9) return { ok: false, reason: "step" };
  return { ok: true, value };
}

/**
 * One press on the pad. Digits append unless the result could not be a mark
 * on this paper (61 on a paper out of 60 keeps "6"); "." only when the paper
 * takes halves; "del" removes the last character.
 */
export function pressKey(text: string, key: string, maxMarks: number, step: number): string {
  if (key === "del") return text.slice(0, -1);
  if (key === ".") {
    if (step >= 1 || text.includes(".")) return text;
    return text === "" ? "0." : `${text}.`;
  }
  if (!/^\d$/.test(key)) return text;
  const next = text === "0" ? key : `${text}${key}`;
  const decimals = next.includes(".") ? next.split(".")[1].length : 0;
  if (decimals > (step === 0.25 ? 2 : step === 0.5 ? 1 : 0)) return text;
  if (Number(next) > maxMarks) return text;
  return next;
}

/**
 * Whether a typed mark is complete enough that the pad should move on.
 *
 * A single digit never moves on by itself on a paper out of 20 or more: "9"
 * on a paper out of 80 is far more often the start of a slip like "95" than
 * a mark of 9, and moving on split "95" into a 9 for one child and a 5 for
 * the next with no warning. The teacher presses Enter for a one-digit mark,
 * as the help already says; "95" is then refused with "Highest mark is 80".
 */
export function shouldAdvance(text: string, maxMarks: number): boolean {
  if (text === "" || text.endsWith(".")) return false;
  const value = Number(text);
  if (!Number.isFinite(value)) return false;
  if (text.includes(".")) return true;
  // Another digit would overflow the paper, so this mark is finished.
  if (value * 10 <= maxMarks) return false;
  return text.length > 1 || maxMarks < 20;
}

/**
 * What was typed into a mark box, as the box may keep it. Only digits and one
 * point are a mark; anything else ("-5", "7a") is refused whole rather than
 * stripped, which turned "-5" into a saved 5.
 */
export function cleanTyped(raw: string): string | null {
  const t = raw.trim();
  return /^[\d.]*$/.test(t) ? t : null;
}

/**
 * The children whose stored mark this paper cannot hold — a half mark on a
 * whole-mark paper, or more than the paper is out of — so the sheet can name
 * every one of them at once instead of the database refusing one per save.
 */
export function misfits(order: readonly string[], cells: Readonly<Record<string, Cell>>, maxMarks: number, step: number): string[] {
  return order.filter((id) => {
    const c = cells[id];
    if (!c || c.state !== "value" || c.value === null) return false;
    return !parseMark(String(c.value), maxMarks, step).ok;
  });
}

export function isFilled(cell: Cell | undefined): boolean {
  return Boolean(cell && cell.state !== "blank");
}

/** The next child without a mark after `from`, wrapping round; -1 when every child has one. */
export function nextBlank(order: string[], cells: Record<string, Cell>, from: number): number {
  for (let k = 1; k <= order.length; k += 1) {
    const i = (from + k) % order.length;
    if (!isFilled(cells[order[i]])) return i;
  }
  return -1;
}

export function counts(order: string[], cells: Record<string, Cell>) {
  let entered = 0;
  let absent = 0;
  let exempt = 0;
  for (const id of order) {
    const c = cells[id];
    if (!c) continue;
    if (c.state === "value") entered += 1;
    else if (c.state === "absent") absent += 1;
    else if (c.state === "exempt") exempt += 1;
  }
  const filled = entered + absent + exempt;
  return { entered, absent, exempt, filled, blank: order.length - filled, total: order.length };
}

export function sameCell(a: Cell | undefined, b: Cell | undefined): boolean {
  const x = a ?? BLANK;
  const y = b ?? BLANK;
  return x.state === y.state && (x.state !== "value" || x.value === y.value);
}

/** The cells that differ from what was last saved. */
export function changedIds(order: string[], cells: Record<string, Cell>, saved: Record<string, Cell>): string[] {
  return order.filter((id) => !sameCell(cells[id], saved[id]));
}

/** The whole column as `save_marks` takes it. */
export function toEntries(order: string[], cells: Record<string, Cell>) {
  return order.map((studentId) => {
    const c = cells[studentId] ?? BLANK;
    return { studentId, state: c.state, value: c.state === "value" ? c.value : null };
  });
}

/** What the teacher reads before sending: highest, lowest, average, who is below the pass mark. */
export function checkSummary(order: string[], cells: Record<string, Cell>, passMarks: number | null) {
  const values = order.map((id) => cells[id]).filter((c): c is Cell => Boolean(c && c.state === "value" && c.value !== null)).map((c) => c.value as number);
  const below = passMarks === null ? [] : order.filter((id) => cells[id]?.state === "value" && (cells[id]?.value ?? 0) < passMarks);
  return {
    highest: values.length ? Math.max(...values) : null,
    lowest: values.length ? Math.min(...values) : null,
    average: values.length ? Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 10) / 10 : null,
    below,
    blanks: order.filter((id) => !isFilled(cells[id])),
    absent: order.filter((id) => cells[id]?.state === "absent"),
  };
}

/** Marks that look like a slip of the finger: far from this child's last test. */
export function looksOff(value: number | null, previousPct: number | null, maxMarks: number): boolean {
  if (value === null || previousPct === null || maxMarks <= 0) return false;
  return Math.abs((value / maxMarks) * 100 - previousPct) >= 40;
}
