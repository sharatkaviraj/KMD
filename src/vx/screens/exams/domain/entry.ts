import { p, type Pair } from "@/vx/text";

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
 * One press on the pad. Digits append up to as many whole digits as the
 * paper's maximum has; "." only when the paper takes halves; "del" removes the
 * last character.
 *
 * A digit that makes the mark too high is kept and shown, not dropped: 61 on a
 * paper out of 60 used to keep "6", and the 6 was saved for the child without
 * a word (smoke 20 Oct, group 2). `readTyped` names it; nothing is saved.
 */
export function pressKey(text: string, key: string, maxMarks: number, step: number): string {
  if (key === "del") return text.slice(0, -1);
  if (key === ".") {
    if (step >= 1 || text.includes(".")) return text;
    return text === "" ? "0." : `${text}.`;
  }
  if (!/^\d$/.test(key)) return text;
  const next = text === "0" ? key : `${text}${key}`;
  const [whole, part = ""] = next.split(".");
  if (part.length > (step === 0.25 ? 2 : step === 0.5 ? 1 : 0)) return text;
  if (whole.length > String(Math.floor(maxMarks)).length) return text;
  return next;
}

/**
 * What the words in a mark box amount to. Only a finished, valid mark is a
 * `value` the sheet may save. A slip — a letter ("6o"), more than the paper
 * is out of ("85" of 80), a half on a whole-mark paper — is `bad`: the box
 * keeps the words, says what is wrong beside that child, and nothing is saved
 * for the child until it is put right. "72." on a paper that takes halves is
 * `partial`: still being typed.
 */
export type TypedMark =
  | { kind: "blank" }
  | { kind: "value"; value: number }
  | { kind: "partial" }
  | { kind: "bad"; reason: "over" | "step" | "nan" };

export function readTyped(raw: string, maxMarks: number, step: number): TypedMark {
  const t = raw.trim();
  if (t === "") return { kind: "blank" };
  if (cleanTyped(t) === null) return { kind: "bad", reason: "nan" };
  if (/^\d+\.$/.test(t)) {
    if (Number(t.slice(0, -1)) > maxMarks) return { kind: "bad", reason: "over" };
    return step < 1 ? { kind: "partial" } : { kind: "bad", reason: "step" };
  }
  const parsed = parseMark(t, maxMarks, step);
  if (!parsed.ok) return { kind: "bad", reason: parsed.reason };
  return parsed.value === null ? { kind: "blank" } : { kind: "value", value: parsed.value };
}

/** Why the words in a box cannot be saved, said beside that child (never a toast over the send button). */
export function typedProblem(raw: string, reason: "over" | "step" | "nan", maxMarks: number, step: number): Pair {
  const t = raw.trim();
  if (reason === "over") return p(`${t} is more than ${maxMarks}. Fix this mark.`, `${t} — पूर्णांक ${maxMarks} से ज़्यादा है। अंक ठीक करें।`);
  if (reason === "step") {
    return step >= 1
      ? p(`${t} — this paper takes whole marks only. Fix this mark.`, `${t} — इस पेपर में सिर्फ़ पूरे अंक। अंक ठीक करें।`)
      : step === 0.5
        ? p(`${t} — only whole or half marks (like 7.5). Fix this mark.`, `${t} — सिर्फ़ पूरे या आधे अंक (जैसे 7.5)। अंक ठीक करें।`)
        : p(`${t} — only quarter marks (like 7.25). Fix this mark.`, `${t} — सिर्फ़ चौथाई अंक (जैसे 7.25)। अंक ठीक करें।`);
  }
  return p(`"${t}" — type numbers only. Fix this mark.`, `"${t}" — सिर्फ़ अंक लिखें। अंक ठीक करें।`);
}

/** The children whose box holds words that cannot be saved (`readTyped` → bad). */
export function heldIds(order: readonly string[], texts: Readonly<Record<string, string>>, maxMarks: number, step: number): string[] {
  return order.filter((id) => readTyped(texts[id] ?? "", maxMarks, step).kind === "bad");
}

/**
 * Where a paper stands, as the counter says it: what the school has and is
 * fine, what must be fixed (a box with a slip, or a saved mark the paper
 * cannot hold), and what is still blank. "14 of 14 saved · 0 left" while two
 * marks needed correcting was a done state that was not done (smoke 20 Oct).
 */
export function tally(order: readonly string[], saved: Readonly<Record<string, Cell>>, toFix: readonly string[]) {
  const fix = new Set(toFix.filter((id) => order.includes(id)));
  let ready = 0;
  let blank = 0;
  for (const id of order) {
    if (fix.has(id)) continue;
    if (isFilled(saved[id])) ready += 1;
    else blank += 1;
  }
  return { total: order.length, ready, toFix: fix.size, blank };
}

export function tallyLine(t: ReturnType<typeof tally>): Pair {
  const en = [`${t.ready} of ${t.total} saved`, t.toFix ? `${t.toFix} to fix` : null, t.blank ? `${t.blank} left` : null].filter(Boolean).join(" · ");
  const hi = [`${t.total} में से ${t.ready} सहेजे`, t.toFix ? `${t.toFix} ठीक करने हैं` : null, t.blank ? `${t.blank} बाकी` : null].filter(Boolean).join(" · ");
  return p(en, hi);
}

/** "52 out of 80" / "80 में से 52": Hindi says the whole first, so it is one function, never a connector between two values. */
export function outOf(value: number | string, max: number | string): Pair {
  return p(`${value} out of ${max}`, `${max} में से ${value}`);
}

/** "1 child" / "3 children"; "1 बच्चा" / "3 बच्चे". */
export function childCount(n: number): Pair {
  return p(`${n} ${n === 1 ? "child" : "children"}`, `${n} ${n === 1 ? "बच्चा" : "बच्चे"}`);
}

/** The blanks heading on Check and send: "1 child has no mark yet", "1 बच्चे के अंक अभी नहीं भरे". */
export function noMarkYet(n: number): Pair {
  return p(`${n} ${n === 1 ? "child has" : "children have"} no mark yet`, `${n} ${n === 1 ? "बच्चे" : "बच्चों"} के अंक अभी नहीं भरे`);
}

/** The pass line said once, with its unit: "Children below 33% (under 26 of 80)". */
export function belowLine(pass: number, maxMarks: number): Pair {
  const pct = Math.round((pass / Math.max(1, maxMarks)) * 100);
  return p(`Children below ${pct}% (under ${pass} of ${maxMarks})`, `${pct}% से कम वाले बच्चे (${maxMarks} में से ${pass} से कम)`);
}

/**
 * The yellow banner over a sheet whose saved marks the paper cannot hold.
 * It says what is wrong and what to do, in that order — "Kept exactly as
 * saved" left a careful reader asking whether the marks were wrong or not.
 */
export function fixBanner(items: readonly { name: string; value: number }[], maxMarks: number, step: number): Pair {
  const n = items.length;
  const list = items.map((x) => `${x.name} (${x.value})`).join(", ");
  const reasons = new Set(items.map((x) => {
    const r = parseMark(String(x.value), maxMarks, step);
    return r.ok ? "ok" : r.reason;
  }));
  const only = reasons.size === 1 ? [...reasons][0] : null;
  const whyEn = only === "step" && step >= 1 ? "This paper takes whole marks only — change each to a whole number." : only === "over" ? `This paper is out of ${maxMarks}.` : "";
  const whyHi = only === "step" && step >= 1 ? "इस पेपर में सिर्फ़ पूरे अंक हैं — हर एक को पूरा अंक करें।" : only === "over" ? `यह पेपर ${maxMarks} अंक का है।` : "";
  return p(
    `${n} ${n === 1 ? "mark must" : "marks must"} be fixed before you can send: ${list}. ${whyEn}`.trim(),
    `भेजने से पहले ${n} अंक ठीक करने हैं: ${list}। ${whyHi}`.trim(),
  );
}

/** How long Undo has left, in whole minutes, never the wall clock (the lab clock and the phone's clock can both disagree with it). */
export function undoLine(minutes: number): Pair {
  const m = Math.max(1, Math.ceil(minutes));
  return p(`Made a mistake? You can take these marks back for ${m} more ${m === 1 ? "minute" : "minutes"}.`, `गलती हुई? अगले ${m} मिनट तक ये अंक वापस ले सकते हैं।`);
}

/**
 * Whether a typed mark is complete enough that the pad should move on.
 *
 * A single digit never moves on by itself on a paper out of 20 or more: "9"
 * on a paper out of 80 is far more often the start of a slip like "95" than
 * a mark of 9, and moving on split "95" into a 9 for one child and a 5 for
 * the next with no warning. The teacher presses Enter for a one-digit mark,
 * as the help already says; "95" is then refused with "Highest mark is 80".
 *
 * On a paper that takes halves or quarters a whole number is never finished
 * while it could still take a point: moving on at "72" sent the ".5" of
 * "72.5" to the next child (verification run, N1). It moves on once the
 * decimals the paper allows are typed, or at the paper's maximum.
 */
export function shouldAdvance(text: string, maxMarks: number, step = 1): boolean {
  if (text === "" || text.endsWith(".")) return false;
  const value = Number(text);
  if (!Number.isFinite(value)) return false;
  if (text.includes(".")) {
    const decimals = text.split(".")[1].length;
    return decimals >= (step === 0.25 ? 2 : 1);
  }
  if (step < 1 && value < maxMarks) return false;
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

/**
 * The first pupil whose mark would stop a final submit (B03/B04): the saved
 * column with what this command sends laid over it, held to the paper's
 * whole rule. Drafts send only what changed, so the command alone cannot
 * prove the column is valid; the server checks this before it submits.
 * Nothing is rounded or rewritten — an invalid mark is only named.
 */
export function submitMisfit(
  roster: readonly string[],
  saved: Readonly<Record<string, Cell>>,
  sent: readonly { studentId: string; state: CellState; value: number | null }[],
  maxMarks: number,
  step: number,
): string | null {
  const cells: Record<string, Cell> = { ...saved };
  for (const e of sent) cells[e.studentId] = { state: e.state, value: e.value };
  return misfits(roster, cells, maxMarks, step)[0] ?? null;
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

/**
 * What a draft save sends: only the cells that changed since the last
 * confirmed save, each checked on its own. A saved mark nobody touched — an
 * old 7.5 on a paper that now takes whole marks — is neither sent nor
 * checked, so it cannot refuse a new mark for another child (B03).
 * `blocked` names the changed cells the paper cannot hold; nothing is sent
 * while there are any.
 */
export function draftEntries(order: string[], cells: Record<string, Cell>, saved: Record<string, Cell>, maxMarks: number, step: number) {
  const changed = changedIds(order, cells, saved);
  const blocked = misfits(changed, cells, maxMarks, step);
  return { changed, blocked, entries: blocked.length ? [] : toEntries(changed, cells) };
}

/** Sending is strict: every child in the column whose mark the paper cannot hold, by id. */
export function submitBlockers(order: string[], cells: Record<string, Cell>, maxMarks: number, step: number): string[] {
  return misfits(order, cells, maxMarks, step);
}

/**
 * What is saved after a confirmed command: what was saved before with the
 * sent cells laid over it. A row the command did not carry keeps its saved
 * cell exactly — it is the same object, never re-read, rounded or rebuilt.
 */
export function afterSave(saved: Record<string, Cell>, entries: readonly { studentId: string; state: CellState; value: number | null }[]): Record<string, Cell> {
  const next = { ...saved };
  for (const e of entries) next[e.studentId] = { state: e.state, value: e.state === "value" ? e.value : null };
  return next;
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
