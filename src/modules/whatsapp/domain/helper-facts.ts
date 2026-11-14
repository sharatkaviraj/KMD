/**
 * What Veer Patta AI knows about one child, shaped from the rows the data
 * layer reads (D-574). Pure: the rows come in, the facts go out, so every
 * rule here is tested without a database.
 *
 * The money rules are the Fees app's, not new ones (CLAUDE.md, "A late fee is
 * not a fee"): the fees still owed never include a late fee, the late fee is
 * its own line, and "paid" is the cash receipted (`applied_amount`), so a
 * write-off is never shown as a payment.
 */

export type AttendanceStatus = "present" | "absent" | "late" | "half_day" | "leave";

export type InstallmentRow = {
  installmentNo: number;
  dueDate: string;
  /** Fees still owed on this row. Never the late fee. */
  pending: number;
  latePending: number;
  /** Cash receipted against this row, net of reversals. */
  applied: number;
  isCarryForward: boolean;
};

export type FeeFacts = {
  /** Fees still owed this year, last year's carried dues included. Never the late fee. */
  feesPending: number;
  /** The late fee still owed, on its own line. */
  lateFeePending: number;
  /** Cash receipted this year. */
  paid: number;
  /** Instalments whose date has passed with fees still owed. */
  overdue: { amount: number; count: number; since: string | null };
  /** The next instalment not yet due, when one is still owed. */
  next: { amount: number; dueDate: string } | null;
  /** Of `feesPending`, what was carried from last year. */
  lastYear: number;
};

export type ReceiptFact = {
  number: string;
  date: string;
  amount: number;
  mode: string;
  reversed: boolean;
};

export type AttendanceFacts = {
  /** Over the days counted (leave days are not counted), as One's attendance view works it out. */
  percent: number | null;
  daysCounted: number;
  absentDays: number;
  lateDays: number;
  /** Today's daily register, when it has been submitted. */
  today: AttendanceStatus | null;
  /** The last few days marked absent, newest first. */
  recentAbsences: string[];
};

export type SubjectMark = {
  name: string;
  nameHi: string | null;
  /** The paper's subject code, as a report card names it (D-613). */
  code?: string | null;
  got: number | null;
  max: number;
  absent: boolean;
  exempt: boolean;
};

export type ResultFacts = {
  exam: string;
  examHi: string | null;
  /** The exam's code ("SA1") and term ("Term 1"), when the read gives them (D-613). */
  code?: string | null;
  term?: string | null;
  subjects: SubjectMark[];
  got: number;
  max: number;
  /** The term's report card as the school issued it, or null when none is (D-613). */
  card?: IssuedCardFacts | null;
};

/**
 * What a report card the school ISSUED says (D-613), for the one line under
 * its PDF: never a preview, never a mark still being entered. `codes` are the
 * exams the card carries, so it goes only when every one is released.
 */
export type IssuedCardFacts = {
  revision: number;
  percent: number | null;
  grade: string | null;
  /** "pending" while a paper holds the result back; "absent" when every paper was missed. */
  status: "complete" | "pending" | "absent" | null;
  passed: boolean | null;
  rank: number | null;
  rankOf: number | null;
  /** Subject codes, at most two each, as the card's effort panel names them. */
  strengths: string[];
  focus: string[];
  trend: "up" | "steady" | "down" | null;
  growth: number | null;
  codes: string[];
};

/** An exam the child sat whose results are not out for the class yet: its name and the day the plan gives, never a mark (D-613). */
export type PendingResult = {
  exam: string;
  examHi: string | null;
  /** The day results are shared, from the exam plan (YYYY-MM-DD in India), or null. */
  on: string | null;
};

export type CalendarFact = { date: string; until: string | null; title: string; titleHi: string | null; kind: string };

export type ChildFacts = {
  /** Short and stable, for buttons: never the student id itself. */
  key: string;
  studentId: string;
  firstName: string;
  /** "Class 6", "Class 11 Science A": as the school writes it, in English. */
  className: string;
  sessionLabel: string;
  /** The day the facts were read for, in India (YYYY-MM-DD). */
  today: string;
  classTeacher: { staffId: string; name: string; isTest: boolean } | null;
  fees: FeeFacts | null;
  receipts: ReceiptFact[];
  attendance: AttendanceFacts | null;
  results: ResultFacts[];
  /** Every exam released for the child's class (D-613): a report card goes only when all of its exams are here. */
  releasedCodes?: string[];
  /** Exams the child sat whose results are not out yet, latest first (D-613). */
  pendingResults?: PendingResult[];
  calendar: CalendarFact[];
};

/** FNV-1a of `text` in base 36: seven letters and digits, the same every time. */
function shortKey(text: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(36).padStart(7, "0");
}

/**
 * A short key for a child, the same every time: FNV-1a of the student id in
 * base 36. A button carries this, not the id.
 */
export function childKey(studentId: string): string {
  return shortKey(studentId);
}

/**
 * A receipt as a button names it (D-597): the child's key and a short key of
 * the receipt's number, fourteen letters and digits. The number itself does
 * not fit a button's id ("SVP20260727-0001" has capitals and a dash). A tap is
 * only ever looked up among this family's own receipts, read afresh for that
 * message, so a key cannot name anybody else's.
 */
export function receiptKey(child: Pick<ChildFacts, "key">, receipt: Pick<ReceiptFact, "number">): string {
  return `${child.key}${shortKey(receipt.number)}`;
}

export type ChildReceipt = { child: ChildFacts; receipt: ReceiptFact };

/**
 * The receipts a parent can have sent (D-597), latest first: every child's,
 * except a reversed one, which was cancelled and is no longer a receipt to
 * keep. A write-off was never read in.
 */
export function sendableReceipts(children: readonly ChildFacts[]): ChildReceipt[] {
  return children
    .flatMap((child) => child.receipts.filter((receipt) => !receipt.reversed).map((receipt) => ({ child, receipt })))
    .sort((a, b) => b.receipt.date.localeCompare(a.receipt.date) || b.receipt.number.localeCompare(a.receipt.number));
}

/** The receipt a button names, among these children's own, or null. */
export function receiptByKey(children: readonly ChildFacts[], key: string | null | undefined): ChildReceipt | null {
  if (!key) return null;
  return sendableReceipts(children).find(({ child, receipt }) => receiptKey(child, receipt) === key) ?? null;
}

/** "RUDRA PRAROOP" -> "Rudra". The family knows the child by the first name. */
export function firstName(fullName: string | null | undefined): string {
  const first = String(fullName ?? "").trim().split(/\s+/)[0] ?? "";
  if (!first) return "";
  return first.charAt(0).toUpperCase() + first.slice(1).toLowerCase();
}

/** Today's date in India, as YYYY-MM-DD. */
export function istDay(now: Date): string {
  return new Date(now.getTime() + 330 * 60_000).toISOString().slice(0, 10);
}

/** The hour in India, 0-23. */
export function istHour(now: Date): number {
  return new Date(now.getTime() + 330 * 60_000).getUTCHours();
}

export function feeFacts(rows: readonly InstallmentRow[], today: string): FeeFacts {
  let feesPending = 0;
  let lateFeePending = 0;
  let paid = 0;
  let lastYear = 0;
  const overdueRows: InstallmentRow[] = [];
  const upcoming: InstallmentRow[] = [];
  for (const row of rows) {
    const pending = Math.max(0, Math.round(row.pending));
    feesPending += pending;
    lateFeePending += Math.max(0, Math.round(row.latePending));
    paid += Math.max(0, Math.round(row.applied));
    if (row.isCarryForward) {
      lastYear += pending;
      continue;
    }
    if (pending <= 0) continue;
    // Overdue is due_date < today; the row due TODAY is due, not overdue (the Fees app's line).
    if (row.dueDate < today) overdueRows.push(row);
    else upcoming.push(row);
  }
  overdueRows.sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  upcoming.sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.installmentNo - b.installmentNo);
  const next = upcoming[0];
  return {
    feesPending,
    lateFeePending,
    paid,
    overdue: {
      amount: overdueRows.reduce((sum, row) => sum + Math.max(0, Math.round(row.pending)), 0),
      count: overdueRows.length,
      since: overdueRows[0]?.dueDate ?? null,
    },
    next: next ? { amount: Math.round(next.pending), dueDate: next.dueDate } : null,
    lastYear,
  };
}

const STATUSES: ReadonlySet<string> = new Set(["present", "absent", "late", "half_day", "leave"]);

export function attendanceFacts(
  summary: { attendance_pct: number | string | null; days_counted: number | null; absent_days: number | null; late_days: number | null } | null,
  days: ReadonlyArray<{ day: string; status: string }>,
  today: string,
): AttendanceFacts | null {
  const marked = days.filter((row) => STATUSES.has(row.status));
  if (!summary && marked.length === 0) return null;
  const todayRow = marked.find((row) => row.day === today);
  const pct = summary?.attendance_pct === null || summary?.attendance_pct === undefined ? null : Number(summary.attendance_pct);
  return {
    percent: pct !== null && Number.isFinite(pct) ? pct : null,
    daysCounted: Number(summary?.days_counted ?? 0),
    absentDays: Number(summary?.absent_days ?? 0),
    lateDays: Number(summary?.late_days ?? 0),
    today: todayRow ? (todayRow.status as AttendanceStatus) : null,
    recentAbsences: marked
      .filter((row) => row.status === "absent")
      .map((row) => row.day)
      .sort((a, b) => b.localeCompare(a))
      .slice(0, 3),
  };
}

/**
 * One exam's marks. The database read hands over only an exam whose results
 * the school has RELEASED and whose class is LOCKED (`parent_helper_child`):
 * a parent sees what the school has finished, never marks still being
 * entered.
 */
export function resultFacts(
  exam: { label: string; labelHi: string | null; code?: string | null; term?: string | null; card?: IssuedCardFacts | null },
  rows: ReadonlyArray<{ name: string; nameHi: string | null; code?: string | null; max: number; value: number | null; absent: boolean; exempt: boolean }>,
): ResultFacts | null {
  if (rows.length === 0) return null;
  const subjects: SubjectMark[] = rows.map((row) => ({
    name: row.name,
    nameHi: row.nameHi,
    ...(row.code ? { code: row.code } : {}),
    got: row.absent || row.exempt || row.value === null ? null : Number(row.value),
    max: Number(row.max),
    absent: row.absent,
    exempt: row.exempt,
  }));
  const counted = subjects.filter((subject) => !subject.exempt);
  return {
    exam: exam.label,
    examHi: exam.labelHi,
    ...(exam.code ? { code: exam.code } : {}),
    ...(exam.term ? { term: exam.term } : {}),
    subjects,
    got: counted.reduce((sum, subject) => sum + (subject.got ?? 0), 0),
    max: counted.reduce((sum, subject) => sum + subject.max, 0),
    card: exam.card ?? null,
  };
}

type CardColumns = { rows?: ReadonlyArray<{ marks?: ReadonlyArray<{ assessmentCode?: string | null }> | null }> | null };

/**
 * The exams an issued report card carries (D-613): every column of every row,
 * the rows printed apart (Robotics) too. The data layer checks these against
 * the exams released for the class before it makes the PDF.
 */
export function cardExamCodes(card: CardColumns & { apart?: CardColumns["rows"] }): string[] {
  const rows = [...(card.rows ?? []), ...(card.apart ?? [])];
  const codes = new Set<string>();
  for (const row of rows) for (const mark of row?.marks ?? []) if (mark?.assessmentCode) codes.add(mark.assessmentCode);
  return [...codes].sort();
}

/** Every exam on the card released for the class: a card with none is never one to send. */
export function cardReleased(codes: readonly string[], released: readonly string[]): boolean {
  const out = new Set(released);
  return codes.length > 0 && codes.every((code) => out.has(code));
}

/** The report card a family may be sent with a result (D-613). */
export type SendableCard = { child: ChildFacts; result: ResultFacts; term: string; card: IssuedCardFacts };

/**
 * The child's report card to send, or null (D-613): the term of the latest
 * released result, as the school ISSUED it, and only when every exam the card
 * carries is released for the class. A Term 1 card reissued after a later
 * exam whose results are not out would show those marks early, so it waits.
 */
export function sendableCard(child: ChildFacts): SendableCard | null {
  const result = child.results[0];
  const card = result?.card ?? null;
  const term = result?.term ?? null;
  if (!result || !card || !term) return null;
  return cardReleased(card.codes, child.releasedCodes ?? []) ? { child, result, term, card } : null;
}

/* ------------------------------------------------------- the database row */

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function list(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.map(record) : [];
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function day(value: unknown): string | null {
  const candidate = text(value);
  return candidate && /^\d{4}-\d{2}-\d{2}/.test(candidate) ? candidate.slice(0, 10) : null;
}

function amount(value: unknown): number {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function words(value: unknown): string[] {
  return Array.isArray(value) ? value.flatMap((item) => (typeof item === "string" && item.trim() ? [item.trim()] : [])) : [];
}

function numberOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

/** A timestamp as its day in India (YYYY-MM-DD), or null. */
function indiaDay(value: unknown): string | null {
  const candidate = text(value);
  if (!candidate) return null;
  const at = Date.parse(candidate);
  return Number.isFinite(at) ? istDay(new Date(at)) : null;
}

const CARD_STATUSES: ReadonlySet<string> = new Set(["complete", "pending", "absent"]);
const TRENDS: ReadonlySet<string> = new Set(["up", "steady", "down"]);

/** An issued card's summary from the read (D-613), or null when it is not one. */
function issuedCard(value: unknown): IssuedCardFacts | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const card = record(value);
  const revision = numberOrNull(card.revision);
  if (revision === null || revision < 1) return null;
  const status = text(card.status);
  const trend = text(card.trend);
  return {
    revision,
    percent: numberOrNull(card.percent),
    grade: text(card.grade),
    status: status && CARD_STATUSES.has(status) ? (status as IssuedCardFacts["status"]) : null,
    passed: typeof card.passed === "boolean" ? card.passed : null,
    rank: numberOrNull(card.rank),
    rankOf: numberOrNull(card.rank_of),
    strengths: words(card.strengths).slice(0, 2),
    focus: words(card.focus).slice(0, 2),
    trend: trend && TRENDS.has(trend) ? (trend as IssuedCardFacts["trend"]) : null,
    growth: numberOrNull(card.growth),
    codes: words(card.codes),
  };
}

/** "Class 11" + "Science" + "A" -> "Class 11 Science A". */
export function classLabel(name: string | null, stream: string | null, section: string | null): string {
  return [name, stream, section].map((part) => (part ?? "").trim()).filter(Boolean).join(" ");
}

/**
 * One child's facts from `vppsone.parent_helper_child`, or null when the row
 * is not one (the database answers null for a child it will not describe).
 * Every field is checked here: a malformed row never becomes a wrong number
 * in front of a parent, only a missing one.
 */
export function childFactsFromRow(row: unknown): ChildFacts | null {
  const top = record(row);
  const student = record(top.student);
  const studentId = text(student.id);
  const sessionLabel = text(student.session_label);
  const today = day(top.today);
  if (!studentId || !sessionLabel || !today) return null;

  const installments: InstallmentRow[] = list(top.installments).flatMap((item) => {
    const dueDate = day(item.due_date);
    if (!dueDate) return [];
    return [{
      installmentNo: amount(item.installment_no),
      dueDate,
      pending: amount(item.pending),
      latePending: amount(item.late_pending),
      applied: amount(item.applied),
      isCarryForward: item.carry_forward === true,
    }];
  });

  const receipts: ReceiptFact[] = list(top.receipts).flatMap((item) => {
    const number = text(item.number);
    const date = day(item.date);
    const mode = text(item.mode);
    // A write-off is never a payment; the read leaves it out, and so does this.
    if (!number || !date || !mode || mode === "discount") return [];
    return [{ number, date, amount: amount(item.amount), mode, reversed: item.reversed === true }];
  });

  const summary = top.attendance === null || top.attendance === undefined ? null : record(top.attendance);
  const days = list(top.days).flatMap((item) => {
    const date = day(item.day);
    const status = text(item.status);
    return date && status ? [{ day: date, status }] : [];
  });
  const attendance = attendanceFacts(
    summary
      ? {
          attendance_pct: (summary.attendance_pct as number | string | null) ?? null,
          days_counted: summary.days_counted === null || summary.days_counted === undefined ? null : amount(summary.days_counted),
          absent_days: summary.absent_days === null || summary.absent_days === undefined ? null : amount(summary.absent_days),
          late_days: summary.late_days === null || summary.late_days === undefined ? null : amount(summary.late_days),
        }
      : null,
    days,
    today,
  );

  const results: ResultFacts[] = list(top.results).flatMap((item) => {
    const label = text(item.label);
    if (!label) return [];
    const facts = resultFacts(
      { label, labelHi: text(item.label_hi), code: text(item.code), term: text(item.term), card: issuedCard(item.card) },
      list(item.subjects).flatMap((subject) => {
        const name = text(subject.name);
        const max = amount(subject.max);
        if (!name || max <= 0) return [];
        return [{
          name,
          nameHi: text(subject.name_hi),
          code: text(subject.code),
          max,
          value: subject.value === null || subject.value === undefined ? null : amount(subject.value),
          absent: subject.absent === true,
          exempt: subject.exempt === true,
        }];
      }),
    );
    return facts ? [facts] : [];
  });

  const releasedCodes = words(top.released_codes);
  const pendingResults: PendingResult[] = list(top.pending_results).flatMap((item) => {
    const label = text(item.label);
    if (!label) return [];
    return [{ exam: label, examHi: text(item.label_hi), on: indiaDay(item.publish_at) ?? day(item.results_on) }];
  });

  const teacher = top.class_teacher === null || top.class_teacher === undefined ? null : record(top.class_teacher);
  const teacherId = teacher ? text(teacher.staff_id) : null;
  const teacherName = teacher ? text(teacher.name) : null;

  const calendar: CalendarFact[] = list(top.calendar).flatMap((item) => {
    const date = day(item.date);
    const title = text(item.title);
    if (!date || !title) return [];
    return [{ date, until: day(item.until), title, titleHi: text(item.title_hi), kind: text(item.kind) ?? "event" }];
  });

  return {
    key: childKey(studentId),
    studentId,
    firstName: firstName(text(student.full_name)) || "—",
    className: classLabel(text(student.class_name), text(student.stream_name), text(student.section)),
    sessionLabel,
    today,
    classTeacher: teacherId && teacherName ? { staffId: teacherId, name: teacherName, isTest: teacher?.is_test === true } : null,
    fees: installments.length > 0 ? feeFacts(installments, today) : null,
    receipts,
    attendance,
    results,
    releasedCodes,
    pendingResults,
    calendar,
  };
}
