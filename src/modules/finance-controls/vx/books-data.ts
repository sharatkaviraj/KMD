import "server-only";

/*
 * Reads for the accountant's Today and Books screens.
 *
 * Fee rows (receipts, balances, refunds) come through the fee client; VPPS
 * One's own bookkeeping about them (cheque details, bank lines, requests, the
 * counter queue) through this app's client. Callers have already checked
 * `fees:view` — these functions do not write.
 */

import { createClient as createFeeClient } from "@/modules/fees/platform/supabase/server";
import { getFinanceControlsPageData } from "@/modules/finance-controls/data/queries";
import { getReceiptReversalTotals, isReceiptReversed } from "@/modules/receipts/data/reversals";
import { fetchAllPages, fetchInChunks } from "@/platform/helpers/chunk";
import { IN_FILTER_CHUNK_SIZE } from "@/platform/helpers/in-filter";
import { createVppsoneReader as createAppClient } from "@/modules/finance-controls/vx/app-db";

import {
  canRemind,
  chequeStatus,
  cumulativeSpark,
  isWaitingForBank,
  maskPhone,
  requestStatus,
  suggestUpiMatches,
  upiLineState,
  usualDayTotal,
  versusUsual,
  type ChequeEvent,
  type ReceiptCandidate,
  type RequestKind,
  type UpiEvent,
} from "@/modules/finance-controls/vx/domain/books";
import type {
  AccountsHomeData,
  AccRequestRow,
  AdvanceRow,
  BooksData,
  ChequeRow,
  DepositSlip,
  FamilyHit,
  FeeRefundRow,
  QueueEntry,
  UpiLineRow,
} from "@/modules/finance-controls/vx/types";

type Row = Record<string, unknown>;
const str = (v: unknown) => (v == null ? null : String(v));
const num = (v: unknown) => Number(v ?? 0) || 0;

function addDays(date: string, days: number) {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

async function staffNames(ids: readonly (string | null)[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter((v): v is string => Boolean(v)))];
  const map = new Map<string, string>();
  if (unique.length === 0) return map;
  const app = await createAppClient();
  const { data } = await fetchInChunks<Row>(unique, IN_FILTER_CHUNK_SIZE, (chunk) =>
    app.from("staff_profiles").select("id, display_name").in("id", chunk),
  );
  for (const r of data) map.set(String(r.id), String(r.display_name ?? ""));
  return map;
}

/** Student name and class for a set of fee student ids, chunked. */
async function studentLabels(ids: readonly (string | null)[]) {
  const unique = [...new Set(ids.filter((v): v is string => Boolean(v)))];
  const map = new Map<string, { name: string; classLabel: string; fatherName: string | null; phone: string | null; left: boolean }>();
  if (unique.length === 0) return map;
  const fee = await createFeeClient();
  const { data } = await fetchInChunks<Row>(unique, IN_FILTER_CHUNK_SIZE, (chunk) =>
    fee
      .from("students")
      .select("id, full_name, father_name, primary_phone, status, class_ref:classes(session_label, class_name, section, stream_name)")
      .in("id", chunk),
  );
  for (const r of data) {
    const cls = (r.class_ref ?? null) as Row | null;
    const classLabel = cls ? [cls.class_name, cls.stream_name, cls.section].filter(Boolean).join(" ") : "";
    map.set(String(r.id), {
      name: String(r.full_name ?? ""),
      classLabel,
      fatherName: str(r.father_name),
      phone: str(r.primary_phone),
      left: r.status === "left" || r.status === "inactive" || r.status === "graduated",
    });
  }
  return map;
}

/** Fees pending on installments due by `today`, and late fee, per student — kept apart. */
export async function pendingTodayFor(studentIds: readonly string[], today: string, sessionLabel: string) {
  const out = new Map<string, { pending: number; lateFee: number }>();
  const unique = [...new Set(studentIds)];
  if (unique.length === 0) return out;
  const fee = await createFeeClient();
  const { data } = await fetchInChunks<Row>(unique, IN_FILTER_CHUNK_SIZE, (chunk) =>
    fee
      .from("v_workbook_installment_balances")
      .select("student_id, pending_amount, late_fee_pending, due_date")
      .eq("session_label", sessionLabel)
      .lte("due_date", today)
      .in("student_id", chunk),
  );
  for (const r of data) {
    const id = String(r.student_id);
    const cur = out.get(id) ?? { pending: 0, lateFee: 0 };
    cur.pending += Math.max(0, num(r.pending_amount));
    cur.lateFee += Math.max(0, num(r.late_fee_pending));
    out.set(id, cur);
  }
  return out;
}

/** Strip what PostgREST's `or=(…)` would read as syntax. */
function cleanQuery(q: string) {
  return q.replace(/[,()%*\\:"']/g, " ").replace(/\s+/g, " ").trim().slice(0, 40);
}

/** Find a student or family by name, father, SR number or phone digits. */
export async function searchFamilies(rawQuery: string, today: string, sessionLabel: string): Promise<FamilyHit[]> {
  const q = cleanQuery(rawQuery);
  if (q.length < 2) return [];
  const fee = await createFeeClient();
  const digits = q.replace(/\D/g, "");
  const ors = [`student_name.ilike.%${q}%`, `father_name.ilike.%${q}%`, `admission_no.ilike.%${q}%`];
  if (digits.length >= 3) ors.push(`father_phone.ilike.%${digits}%`, `mother_phone.ilike.%${digits}%`);
  const { data, error } = await fee
    .from("v_workbook_student_financials")
    .select("student_id, student_name, father_name, father_phone, class_label, admission_no, record_status")
    .eq("session_label", sessionLabel)
    .or(ors.join(","))
    .order("student_name")
    .limit(12);
  if (error || !data) return [];
  const rows = data as Row[];
  const pending = await pendingTodayFor(rows.map((r) => String(r.student_id)), today, sessionLabel);
  return rows.map((r) => {
    const p = pending.get(String(r.student_id)) ?? { pending: 0, lateFee: 0 };
    return {
      studentId: String(r.student_id),
      studentName: String(r.student_name ?? ""),
      fatherName: str(r.father_name),
      phoneMasked: maskPhone(str(r.father_phone)),
      classLabel: String(r.class_label ?? ""),
      admissionNo: str(r.admission_no),
      pendingToday: p.pending,
      lateFee: p.lateFee,
      left: r.record_status === "left",
    };
  });
}

async function readRequests(staffId: string, all: boolean, limit = 60): Promise<AccRequestRow[]> {
  const app = await createAppClient();
  let query = app
    .from("acc_requests")
    .select("id, kind, title, reason, amount, student_id, receipt_id, requested_by, requested_at, reminded_at, withdrawn_at, decision, decision_note, decided_by, decided_at")
    .order("requested_at", { ascending: false })
    .limit(limit);
  if (!all) query = query.eq("requested_by", staffId);
  const { data } = await query;
  const rows = (data ?? []) as Row[];
  const names = await staffNames(rows.flatMap((r) => [str(r.requested_by), str(r.decided_by)]));
  const students = await studentLabels(rows.map((r) => str(r.student_id)));
  return rows.map((r) => {
    const decision = (r.decision as "approved" | "declined" | null) ?? null;
    const withdrawnAt = str(r.withdrawn_at);
    const remindedAt = str(r.reminded_at);
    const requestedAt = String(r.requested_at);
    const status = requestStatus({ decision, withdrawnAt, remindedAt });
    return {
      id: String(r.id),
      kind: r.kind as RequestKind,
      title: String(r.title),
      reason: String(r.reason),
      amount: r.amount == null ? null : num(r.amount),
      studentId: str(r.student_id),
      studentName: r.student_id ? (students.get(String(r.student_id))?.name ?? null) : null,
      receiptId: str(r.receipt_id),
      requestedAt,
      requestedByName: names.get(String(r.requested_by)) ?? "",
      mine: r.requested_by === staffId,
      status,
      remindedAt,
      decidedAt: str(r.decided_at),
      decidedByName: r.decided_by ? (names.get(String(r.decided_by)) ?? null) : null,
      decisionNote: str(r.decision_note),
      withdrawnAt,
      canRemind: status === "waiting" && canRemind({ remindedAt, requestedAt }),
    };
  });
}

/** Cheque receipts of the session, with VPPS One's details and where each cheque is. */
async function readCheques(): Promise<{ cheques: ChequeRow[]; slips: DepositSlip[] }> {
  const fee = await createFeeClient();
  const app = await createAppClient();
  const { data: receiptRows } = await fetchAllPages<Row>((from, to) =>
    fee
      .from("receipts")
      .select("id, receipt_number, payment_date, total_amount, reference_number, student_id, student_ref:students(full_name, class_ref:classes(session_label, class_name, section, stream_name))")
      .eq("payment_mode", "cheque")
      .order("payment_date", { ascending: false })
      .range(from, to),
  );
  const ids = receiptRows.map((r) => String(r.id));
  const [details, events, slipsRes, reversals] = await Promise.all([
    fetchInChunks<Row>(ids, IN_FILTER_CHUNK_SIZE, (chunk) => app.from("acc_cheques").select("receipt_id, cheque_no, bank_name, cheque_date").in("receipt_id", chunk)),
    fetchInChunks<Row>(ids, IN_FILTER_CHUNK_SIZE, (chunk) => app.from("acc_cheque_events").select("receipt_id, status, created_at, deposit_slip_id, reason").in("receipt_id", chunk)),
    app.from("acc_deposit_slips").select("id, slip_no, bank_label, deposited_on, total_amount, cheque_count").order("created_at", { ascending: false }).limit(50),
    getReceiptReversalTotals(ids, fee),
  ]);
  const detailBy = new Map(details.data.map((d) => [String(d.receipt_id), d]));
  const eventsBy = new Map<string, ChequeEvent[]>();
  for (const e of events.data) {
    const list = eventsBy.get(String(e.receipt_id)) ?? [];
    list.push({ receiptId: String(e.receipt_id), status: e.status as ChequeEvent["status"], createdAt: String(e.created_at), depositSlipId: str(e.deposit_slip_id), reason: str(e.reason) });
    eventsBy.set(String(e.receipt_id), list);
  }
  const slips: DepositSlip[] = ((slipsRes.data ?? []) as Row[]).map((s) => ({
    id: String(s.id),
    slipNo: String(s.slip_no),
    bankLabel: String(s.bank_label),
    depositedOn: String(s.deposited_on),
    total: num(s.total_amount),
    count: num(s.cheque_count),
  }));
  const slipBy = new Map(slips.map((s) => [s.id, s]));
  // Every cheque, whatever session its student is in now: a cheque in the bag
  // is in the bag whichever class the child was promoted to.
  const cheques = receiptRows
    .map((r): ChequeRow => {
      const id = String(r.id);
      const st = (r.student_ref ?? {}) as Row;
      const cls = (st.class_ref ?? null) as Row | null;
      const evs = eventsBy.get(id) ?? [];
      const latest = [...evs].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
      const d = detailBy.get(id);
      const depositEvent = [...evs].filter((e) => e.status === "deposited").sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
      return {
        receiptId: id,
        receiptNumber: String(r.receipt_number),
        paymentDate: String(r.payment_date),
        amount: num(r.total_amount),
        studentId: String(r.student_id),
        studentName: String(st.full_name ?? ""),
        classLabel: cls ? [cls.class_name, cls.stream_name, cls.section].filter(Boolean).join(" ") : "",
        chequeNo: d ? str(d.cheque_no) : null,
        bank: d ? str(d.bank_name) : null,
        chequeDate: d ? str(d.cheque_date) : null,
        reference: str(r.reference_number),
        status: chequeStatus(evs),
        statusAt: latest?.createdAt ?? null,
        slipNo: depositEvent?.depositSlipId ? (slipBy.get(depositEvent.depositSlipId)?.slipNo ?? null) : null,
        bounceReason: latest?.status === "bounced" ? (latest.reason ?? null) : null,
        reversed: isReceiptReversed(reversals, id, num(r.total_amount)),
      };
    });
  return { cheques, slips };
}

async function readUpi(): Promise<{ lines: UpiLineRow[]; unmatchedReceipts: number }> {
  const app = await createAppClient();
  const fee = await createFeeClient();
  const { data: lineRows } = await app
    .from("acc_upi_lines")
    .select("id, txn_at, amount, payer, utr")
    .order("txn_at", { ascending: false })
    .limit(200);
  const lines = (lineRows ?? []) as Row[];
  const lineIds = lines.map((l) => String(l.id));
  const { data: eventRows } = await fetchInChunks<Row>(lineIds, IN_FILTER_CHUNK_SIZE, (chunk) =>
    app.from("acc_upi_events").select("line_id, action, receipt_id, created_at").in("line_id", chunk),
  );
  const eventsBy = new Map<string, UpiEvent[]>();
  for (const e of eventRows) {
    const list = eventsBy.get(String(e.line_id)) ?? [];
    list.push({ lineId: String(e.line_id), action: e.action as UpiEvent["action"], receiptId: str(e.receipt_id), createdAt: String(e.created_at) });
    eventsBy.set(String(e.line_id), list);
  }
  const states = new Map(lines.map((l) => [String(l.id), upiLineState(eventsBy.get(String(l.id)) ?? [])]));
  const matched = new Set([...states.values()].map((s) => s.receiptId).filter((v): v is string => Boolean(v)));

  // Candidate UPI receipts: the statement's window, ten days either side.
  const txnDays = lines.map((l) => String(l.txn_at).slice(0, 10)).sort();
  const from = addDays(txnDays[0] ?? new Date().toISOString().slice(0, 10), -10);
  const to = addDays(txnDays[txnDays.length - 1] ?? new Date().toISOString().slice(0, 10), 10);
  const { data: receiptRows } = await fetchAllPages<Row>((a, b) =>
    fee
      .from("receipts")
      .select("id, receipt_number, payment_date, total_amount, reference_number, student_ref:students(full_name, class_ref:classes(class_name, section, stream_name))")
      .eq("payment_mode", "upi")
      .gte("payment_date", from)
      .lte("payment_date", to)
      .order("payment_date")
      .range(a, b),
  );
  const reversals = await getReceiptReversalTotals(receiptRows.map((r) => String(r.id)), fee);
  const candidates: ReceiptCandidate[] = receiptRows
    .filter((r) => !isReceiptReversed(reversals, String(r.id), num(r.total_amount)))
    .map((r) => {
      const st = (r.student_ref ?? {}) as Row;
      const cls = (st.class_ref ?? null) as Row | null;
      return {
        id: String(r.id),
        receiptNumber: String(r.receipt_number),
        paymentDate: String(r.payment_date),
        amount: num(r.total_amount),
        referenceNumber: str(r.reference_number),
        studentName: String(st.full_name ?? ""),
        classLabel: cls ? [cls.class_name, cls.stream_name, cls.section].filter(Boolean).join(" ") : null,
      };
    });
  const byId = new Map(candidates.map((c) => [c.id, c]));

  // A matched receipt outside the candidate window still needs its label.
  const missing = [...matched].filter((id) => !byId.has(id));
  if (missing.length) {
    const { data } = await fetchInChunks<Row>(missing, IN_FILTER_CHUNK_SIZE, (chunk) =>
      fee.from("receipts").select("id, receipt_number, payment_date, total_amount, reference_number, student_ref:students(full_name)").in("id", chunk),
    );
    for (const r of data) {
      byId.set(String(r.id), {
        id: String(r.id),
        receiptNumber: String(r.receipt_number),
        paymentDate: String(r.payment_date),
        amount: num(r.total_amount),
        referenceNumber: str(r.reference_number),
        studentName: String(((r.student_ref ?? {}) as Row).full_name ?? ""),
        classLabel: null,
      });
    }
  }

  const out: UpiLineRow[] = lines.map((l) => {
    const id = String(l.id);
    const s = states.get(id) ?? { state: "open" as const, receiptId: null };
    const rec = s.receiptId ? byId.get(s.receiptId) : undefined;
    const line = { txnAt: String(l.txn_at), amount: num(l.amount), utr: String(l.utr) };
    return {
      id,
      ...line,
      payer: String(l.payer),
      state: s.state,
      receipt: rec ? { id: rec.id, receiptNumber: rec.receiptNumber, studentName: rec.studentName, classLabel: rec.classLabel, amount: rec.amount, paymentDate: rec.paymentDate } : null,
      suggestions: s.state === "open" ? suggestUpiMatches(line, candidates, matched) : [],
    };
  });
  const unmatchedReceipts = candidates.filter((c) => !matched.has(c.id)).length;
  return { lines: out, unmatchedReceipts };
}

async function readAdvances(): Promise<AdvanceRow[]> {
  const fee = await createFeeClient();
  const { data } = await fee
    .from("v_student_financial_state")
    .select("student_id, credit_balance, refundable_amount")
    .gt("credit_balance", 0)
    .order("credit_balance", { ascending: false })
    .limit(100);
  const rows = (data ?? []) as Row[];
  const labels = await studentLabels(rows.map((r) => String(r.student_id)));
  return rows.map((r) => {
    const s = labels.get(String(r.student_id));
    return {
      studentId: String(r.student_id),
      studentName: s?.name ?? "",
      classLabel: s?.classLabel ?? "",
      fatherName: s?.fatherName ?? null,
      credit: num(r.credit_balance),
      refundable: num(r.refundable_amount),
    };
  });
}

async function readFeeRefunds(): Promise<FeeRefundRow[]> {
  const fee = await createFeeClient();
  const { data } = await fee
    .from("refund_requests")
    .select("id, refund_date, requested_amount, status, reason, student_ref:students(full_name)")
    .order("created_at", { ascending: false })
    .limit(20);
  return ((data ?? []) as Row[]).map((r) => ({
    id: String(r.id),
    studentName: String(((r.student_ref ?? {}) as Row).full_name ?? ""),
    amount: num(r.requested_amount),
    status: String(r.status),
    reason: String(r.reason ?? ""),
    refundDate: String(r.refund_date),
  }));
}

export async function getBooksData(opts: { staffId: string; today: string; sessionLabel: string; canDecide: boolean; canWrite: boolean }): Promise<BooksData> {
  const [{ cheques, slips }, upi, advances, feeRefunds, requests] = await Promise.all([
    readCheques(),
    readUpi(),
    readAdvances(),
    readFeeRefunds(),
    readRequests(opts.staffId, opts.canDecide),
  ]);
  return {
    today: opts.today,
    sessionLabel: opts.sessionLabel,
    canDecide: opts.canDecide,
    canWrite: opts.canWrite,
    cheques,
    slips,
    upiLines: upi.lines,
    upiReceiptsUnmatched: upi.unmatchedReceipts,
    advances,
    feeRefunds,
    requests,
  };
}

/** Everything the accountant's Today needs, in one request. */
export async function getAccountsHomeData(opts: { staffId: string; today: string; sessionLabel: string; seesAllRequests: boolean }): Promise<AccountsHomeData> {
  const { today, sessionLabel } = opts;
  const tomorrow = addDays(today, 1);
  const fee = await createFeeClient();
  const app = await createAppClient();

  const [finance, history, queueRes, followRes, pauseRes, chequeData, upi, requests, dueRes] = await Promise.all([
    getFinanceControlsPageData(today, sessionLabel),
    fetchAllPages<Row>((a, b) =>
      fee.from("receipts").select("payment_date, total_amount").neq("payment_mode", "discount").gte("payment_date", addDays(today, -56)).lt("payment_date", today).range(a, b),
    ),
    app.from("acc_counter_queue").select("id, student_id, family_label, note, arrived_at").is("served_at", null).is("left_at", null).order("arrived_at").limit(20),
    fee.from("defaulter_contacts").select("student_id, snooze_until, note, contacted_at").eq("session_label", sessionLabel).in("snooze_until", [today, tomorrow]).order("contacted_at", { ascending: false }).limit(200),
    app.from("acc_reminder_pauses").select("paused, created_at").eq("day", today).order("created_at", { ascending: false }).limit(1),
    readCheques(),
    readUpi(),
    readRequests(opts.staffId, opts.seesAllRequests, 8),
    fetchAllPages<Row>((a, b) =>
      fee.from("v_workbook_installment_balances").select("student_id, installment_no, installment_label, due_date, pending_amount").eq("session_label", sessionLabel).gt("pending_amount", 0).range(a, b),
    ),
  ]);

  const collections = finance.dayBookRows.filter((r) => r.entryType === "collection");
  const modes = finance.summary.modeTotals.map((m) => ({ mode: String(m.paymentMode), total: m.totalAmount, count: m.receiptCount }));
  const lastAt = collections.map((r) => r.postedAt).sort().at(-1) ?? null;
  const dayTotals = history.data.map((r) => ({ date: String(r.payment_date), total: num(r.total_amount) }));
  const usual = usualDayTotal(dayTotals, today);

  const queueRows = (queueRes.data ?? []) as Row[];
  const followRows = (followRes.data ?? []) as Row[];
  const ids = [...queueRows.map((r) => String(r.student_id)), ...followRows.map((r) => String(r.student_id))];
  const [pending, labels] = await Promise.all([pendingTodayFor(ids, today, sessionLabel), studentLabels(ids)]);

  const queue: QueueEntry[] = queueRows.map((r) => ({
    id: String(r.id),
    studentId: String(r.student_id),
    familyLabel: String(r.family_label),
    classLabel: labels.get(String(r.student_id))?.classLabel ?? "",
    note: str(r.note),
    arrivedAt: String(r.arrived_at),
    pendingToday: pending.get(String(r.student_id))?.pending ?? 0,
  }));

  // Latest contact per student decides its follow-up day.
  const latestFollow = new Map<string, Row>();
  for (const r of followRows) if (!latestFollow.has(String(r.student_id))) latestFollow.set(String(r.student_id), r);
  const todays = [...latestFollow.values()].filter((r) => r.snooze_until === today);
  const tomorrows = [...latestFollow.values()].filter((r) => r.snooze_until === tomorrow);

  const waiting = chequeData.cheques.filter((c) => isWaitingForBank(c.status) && !c.reversed);
  const openLines = upi.lines.filter((l) => l.state === "open");

  // Families with fees pending on an installment due today or earlier, and the next installment to fall due.
  const dueStudents = new Set<string>();
  let nextInstallment: { date: string; label: string } | null = null;
  for (const r of dueRes.data) {
    const due = String(r.due_date);
    if (due <= today) dueStudents.add(String(r.student_id));
    else if (num(r.installment_no) < 99 && (!nextInstallment || due < nextInstallment.date)) nextInstallment = { date: due, label: `Installment ${num(r.installment_no)}` };
  }

  const closure = finance.closure
    ? { status: finance.closure.status, closedAt: finance.closure.closedAt, closedByName: finance.closure.closedByName }
    : null;
  const pauseRow = ((pauseRes.data ?? []) as Row[])[0];
  const cash = modes.find((m) => m.mode === "cash");

  return {
    today,
    tomorrow,
    sessionLabel,
    collected: {
      total: finance.summary.receiptTotal,
      count: finance.summary.receiptCount,
      lastAt,
      modes,
      spark: cumulativeSpark(collections.map((r) => ({ postedAt: r.postedAt, amount: r.cashIn }))),
      usual,
      vsUsual: versusUsual(finance.summary.receiptTotal, usual),
      reversedCount: finance.summary.reversedReceiptCount,
    },
    closure,
    queue,
    followUpsToday: { count: todays.length, next: todays[0] ? (labels.get(String(todays[0].student_id))?.name ?? null) : null },
    chequesToDeposit: { count: waiting.length, total: waiting.reduce((s, c) => s + c.amount, 0) },
    upiOpen: { count: openLines.length, total: openLines.reduce((s, l) => s + l.amount, 0) },
    requests,
    reminders: { paused: Boolean(pauseRow?.paused), familiesPendingToday: dueStudents.size, nextInstallment: nextInstallment ? `${nextInstallment.label} · ${nextInstallment.date}` : null },
    cashExpected: { total: cash?.total ?? 0, count: cash?.count ?? 0 },
    tomorrowFollowUps: tomorrows.map((r) => ({
      studentId: String(r.student_id),
      studentName: labels.get(String(r.student_id))?.name ?? "",
      classLabel: labels.get(String(r.student_id))?.classLabel ?? "",
      pendingToday: pending.get(String(r.student_id))?.pending ?? 0,
      note: str(r.note),
    })),
    chequesForBank: waiting,
  };
}

/** The family label and class for queueing a student at the counter. */
export async function describeStudentForQueue(studentId: string) {
  const labels = await studentLabels([studentId]);
  const s = labels.get(studentId);
  if (!s) return null;
  return { familyLabel: s.fatherName ? `${s.fatherName} · ${s.name}` : s.name };
}

/** A receipt's amount, mode and student, so an action can check what it is told. */
export async function readReceiptBrief(receiptId: string) {
  const fee = await createFeeClient();
  const { data } = await fee.from("receipts").select("id, receipt_number, payment_mode, total_amount, student_id, payment_date").eq("id", receiptId).maybeSingle();
  if (!data) return null;
  const r = data as Row;
  return { id: String(r.id), receiptNumber: String(r.receipt_number), mode: String(r.payment_mode), amount: num(r.total_amount), studentId: String(r.student_id), paymentDate: String(r.payment_date) };
}

/** Briefs for several receipts at once (deposit slips). */
export async function readReceiptBriefs(receiptIds: readonly string[]) {
  const fee = await createFeeClient();
  const { data } = await fetchInChunks<Row>([...new Set(receiptIds)], IN_FILTER_CHUNK_SIZE, (chunk) =>
    fee.from("receipts").select("id, payment_mode, total_amount").in("id", chunk),
  );
  return data.map((r) => ({ id: String(r.id), mode: String(r.payment_mode), amount: num(r.total_amount) }));
}

/** A student's credit (advance) right now — a refund request may not ask for more. */
export async function readStudentCredit(studentId: string) {
  const fee = await createFeeClient();
  const { data } = await fee.from("v_student_financial_state").select("credit_balance, refundable_amount").eq("student_id", studentId).maybeSingle();
  const r = (data ?? {}) as Row;
  return { credit: num(r.credit_balance), refundable: num(r.refundable_amount) };
}
