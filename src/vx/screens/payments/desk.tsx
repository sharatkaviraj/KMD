"use client";

import "./paydesk.css";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";

import {
  checkDeskPaymentAction,
  loadReceiptAction,
  loadStudentDeskAction,
  loadDeskPreviewAction,
  postDeskPaymentAction,
  removePaymentAction,
  sendReceiptWhatsappAction,
  type DeskPostInput,
} from "@/app/(app)/payments/actions";
import {
  deskProblems,
  deskTotals,
  findRecentDuplicate,
  isOverdueOn,
  lateFeesOn,
  maskPhone,
  matchesDeskSearch,
  orderForSettlement,
  parseAmountInput,
  walkPayment,
  composeReference,
  composeRemarks,
  type DeskMode,
  type WalkLine,
} from "@/modules/payments/vx/domain/desk";
import type { DeskBoot, DeskCheckResult, DeskReceipt, DeskSaveResult, DeskStudent, DeskStudentResult } from "@/modules/payments/vx/types";
import { buildPaymentQuickAmounts } from "@/modules/payments/domain/workflow";
import { MobilePrintedReceipt } from "@/modules/payments/ui/mobile-printed-receipt";
import { clearPaymentAttempt, paymentAttemptKey, readPaymentAttempt, writePaymentAttempt, type PaymentAttempt } from "@/modules/payments/vx/attempt";
import type { DeskLedgerRow } from "@/modules/payments/vx/domain/desk";
import { amountInWords, clock, dateLabel, dayMonth, initials, rupees, shortDay } from "@/vx/format";
import { Bi, useVx } from "@/vx/i18n";
import { Ic } from "@/vx/icons";
import type { Pair } from "@/vx/text";
import { Field, Input, SearchBox, Seg, Chip, Textarea } from "@/vx/ui/controls";
import { Sheet, useToast } from "@/vx/ui/overlays";
import { Banner, TopBar, VxPage } from "@/vx/ui/page";
import { Avatar, Btn, Card, EmptyState, Pill, Skel, SuccessTick, WhatsAppPreview } from "@/vx/ui/primitives";

import { ReceiptCard } from "./receipt-card";
import { W } from "./words";

type DateMode = "today" | "yesterday" | "other";

type Form = {
  amount: string;
  dateMode: DateMode;
  otherDate: string;
  mode: DeskMode;
  reference: string;
  chequeNo: string;
  chequeBank: string;
  chequeDate: string;
  late: "take" | "waive";
  waiveReason: string;
  waiveNote: string;
  notes: string;
  receivedBy: string;
  concession: string;
};

type Saved = {
  receiptId: string;
  receiptNumber: string;
  receipt: DeskReceipt | null;
  balance: { pendingToday: number; dueToday?: number; notDueYet: number; lateFee: number } | null;
  /** What the desk sent, for the moment the receipt itself could not be read. */
  amount: number;
  /** Posted by this desk just now (locked, removable), or an earlier receipt opened. */
  fresh: boolean;
  savedAtMs: number;
  removed: boolean;
  sent: boolean;
  log: { text: string; time: string; tone: string }[];
};

type Dup = {
  kind: "near-duplicate" | "daily-amount" | "client";
  receiptId: string | null;
  receiptNumber: string | null;
  createdAt: string | null;
  amount: number | null;
  mode: string | null;
};

const MODE_PAIR: Record<DeskMode, Pair> = { cash: W.modeCash, upi: W.modeUpi, bank_transfer: W.modeBank, cheque: W.modeCheque };
const MODE_TEXT: Record<string, string> = { cash: "Cash", upi: "UPI", bank_transfer: "Bank transfer", cheque: "Cheque" };
const REMOVE_WINDOW_MS = 10 * 60_000;

/** The time now, for event handlers (never called while rendering). */
function wallClock(): number {
  return Date.now();
}

function shiftDay(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return t.toISOString().slice(0, 10);
}

function firstName(name: string): string {
  return name.split(/\s+/)[0] ?? name;
}

function freshForm(boot: DeskBoot): Form {
  return {
    amount: "",
    dateMode: "today",
    otherDate: shiftDay(boot.today, -2),
    mode: boot.modes.includes("cash") ? "cash" : boot.modes[0],
    reference: "",
    chequeNo: "",
    chequeBank: "",
    chequeDate: boot.today,
    late: "take",
    waiveReason: "",
    waiveNote: "",
    notes: "",
    receivedBy: boot.me.name,
    concession: "",
  };
}

function suggestedForm(boot: DeskBoot, student: DeskStudent | null): Form {
  const form = freshForm(boot);
  if (!student) return form;
  const t = deskTotals(student.rows, boot.today);
  const plan = student.repaymentPlan;
  const suggestion = plan ? Math.min(t.wholeYear, plan.remainingBalance, plan.catchUpAmount || plan.monthlyAmount) : t.canTakeToday;
  return { ...form, amount: suggestion > 0 ? String(suggestion) : "" };
}

function recoveredForm(boot: DeskBoot, pending: PaymentAttempt): Form {
  return { ...freshForm(boot), ...pending.form, dateMode: pending.input.paymentDate === boot.today ? "today" : "other", otherDate: pending.input.paymentDate } as Form;
}

function rowLabel(row: { isCarryForward: boolean; label: string }, tx: (p: Pair | string) => string) {
  return row.isCarryForward ? tx(W.oldBalance) : row.label;
}

export function PaymentDesk({
  boot,
  previewing,
  initialStudentId,
  initialStudent,
  initialReceipt,
}: {
  boot: DeskBoot;
  previewing: boolean;
  initialStudentId: string | null;
  initialStudent: DeskStudentResult | null;
  initialReceipt: DeskReceipt | null;
}) {
  const { tx } = useVx();
  const toast = useToast();
  const listed = boot.students.find((s) => s.id === initialStudentId);
  const firstClass = boot.classes.find((c) => boot.students.some((s) => s.classId === c.id))?.id ?? boot.classes[0]?.id ?? "";

  const [classId, setClassId] = useState(listed?.classId ?? firstClass);
  const [query, setQuery] = useState("");
  const [selId, setSelId] = useState<string | null>(initialStudentId);
  const [result, setResult] = useState<DeskStudentResult | null>(initialStudent);
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState<Form>(() => suggestedForm(boot, initialStudent?.ok ? initialStudent.student : null));
  const [tried, setTried] = useState(false);
  const [sheet, setSheet] = useState<"" | "dup" | "wa" | "rm">("");
  // Review is its own step in the right-hand pane, not a sheet over the form:
  // nothing is saved until "Confirm and save payment", and Back keeps every entry.
  const [reviewing, setReviewing] = useState(false);
  // A save whose answer never arrived. Until the desk has asked the database
  // whether it posted, it will not offer to save again.
  const [uncertain, setUncertain] = useState<{ checking: boolean } | null>(null);
  const [saving, setSaving] = useState(false);
  const [ack, setAck] = useState(false);
  const [dup, setDup] = useState<Dup | null>(null);
  const [saved, setSaved] = useState<Saved | null>(() =>
    initialReceipt
      ? { receiptId: initialReceipt.id, receiptNumber: initialReceipt.receiptNumber, receipt: initialReceipt, balance: null, amount: initialReceipt.total, fresh: false, savedAtMs: 0, removed: initialReceipt.isReversed, sent: false, log: [] }
      : null,
  );
  const [expiredAt, setExpiredAt] = useState<number | null>(null);
  const [todayTotals, setTodayTotals] = useState(boot.todayCollection);
  const [rmReason, setRmReason] = useState("");
  const [rmNote, setRmNote] = useState("");
  const [waLang, setWaLang] = useState<"hi" | "en" | "both">("both");
  const [busy, setBusy] = useState(false);
  const requestId = useRef<string | null>(null);
  const attemptRef = useRef<PaymentAttempt | null>(null);
  const posting = useRef(false);
  const [attempt, setAttempt] = useState<PaymentAttempt | null>(null);
  const [recoveryScope, setRecoveryScope] = useState<string | null>(null);
  const [recoveryError, setRecoveryError] = useState(false);
  const attemptKey = boot.me.id ? paymentAttemptKey(boot.me.id, boot.sessionLabel) : null;
  const recoveryReady = !attemptKey || previewing || recoveryScope === attemptKey;
  const [datePreview, setDatePreview] = useState<{ studentId: string; date: string; rows: DeskLedgerRow[] } | null>(null);
  const [dateError, setDateError] = useState<string | null>(null);
  const [listBalances, setListBalances] = useState<Record<string, { pendingToday: number; lateFee: number }>>({});
  const counted = useRef(new Set<string>());
  const restoredAttempt = useRef(false);
  const loadSeq = useRef(0);

  const student: DeskStudent | null = result && result.ok ? result.student : null;
  const today = boot.today;
  const canAct = boot.canPost && !previewing;

  useEffect(() => {
    let active = true;
    if (!attemptKey || previewing) return;
    void readPaymentAttempt(attemptKey, boot.sessionLabel).then(a => {
      if (!active) return;
      attemptRef.current = a; setAttempt(a); requestId.current = a?.input.clientRequestId ?? null; restoredAttempt.current = Boolean(a);
      if (a && a.input.studentId === initialStudentId) {
        setForm(recoveredForm(boot, a)); setReviewing(true); setUncertain({ checking: false });
      }
      setRecoveryError(false); setRecoveryScope(attemptKey);
    }).catch(() => { if (active) { setRecoveryError(true); setRecoveryScope(attemptKey); } });
    return () => { active = false; };
  }, [attemptKey, boot, initialStudentId, previewing]);

  // The ten-minute removal window closes on its own.
  const savedAtMs = saved?.fresh ? saved.savedAtMs : 0;
  useEffect(() => {
    if (!savedAtMs) return;
    const left = savedAtMs + REMOVE_WINDOW_MS - Date.now();
    const t = window.setTimeout(() => setExpiredAt(savedAtMs), Math.max(0, left));
    return () => window.clearTimeout(t);
  }, [savedAtMs]);

  /* ---------- derived ---------- */
  const paymentDate = form.dateMode === "today" ? today : form.dateMode === "yesterday" ? shiftDay(today, -1) : form.otherDate;
  const amount = parseAmountInput(form.amount);
  const concession = student?.onPlan ? 0 : parseAmountInput(form.concession);
  const dateReady = paymentDate === today || (datePreview?.studentId === student?.id && datePreview?.date === paymentDate);
  const dateFailed = dateError === `${student?.id}|${paymentDate}`;
  const rows = useMemo(() => orderForSettlement(datePreview?.studentId === student?.id && datePreview?.date === paymentDate ? datePreview.rows : student?.rows ?? []), [student, datePreview, paymentDate]);
  useEffect(() => {
    if (!student || paymentDate === today || !/^\d{4}-\d{2}-\d{2}$/.test(paymentDate)) return;
    let active = true;
    void loadDeskPreviewAction({ studentId: student.id, sessionLabel: boot.sessionLabel, paymentDate }).then(res => {
      if (!active) return;
      if (res.ok) { setDatePreview({ studentId: student.id, date: paymentDate, rows: res.rows }); setDateError(null); }
      else setDateError(`${student.id}|${paymentDate}`);
    }).catch(() => { if (active) setDateError(`${student.id}|${paymentDate}`); });
    return () => { active = false; };
  }, [student, paymentDate, today, boot.sessionLabel]);
  const totals = deskTotals(rows, today);
  const waiveAllowed = boot.me.canWaive && Boolean(student) && !student?.onPlan;
  const waiveLate = waiveAllowed && form.late === "waive" && totals.lateFee > 0;
  const walk = walkPayment(rows, Number.isFinite(amount) ? amount : 0, { paymentDate, today, waiveLate, concession: Number.isFinite(concession) ? concession : 0, authoritative: true });
  const firstOwed = rows.find(r => r.feesPending + (waiveLate ? 0 : r.lateFeePending) > 0);
  const chips = buildPaymentQuickAmounts({ totalPending: walk.maxAmount, nextDueAmount: firstOwed ? Math.min(walk.maxAmount, Math.max(0, firstOwed.feesPending + (waiveLate ? 0 : firstOwed.lateFeePending) - concession)) : null, overdueAmount: Math.min(walk.maxAmount, Math.max(0, totals.pendingToday + totals.dueToday + (waiveLate ? 0 : totals.lateFee) - concession)), lateFeeAmount: waiveLate ? 0 : Math.min(walk.maxAmount, totals.lateFee), lastPaidAmount: student?.receipts.find(r => !r.isReversed)?.amount, plan: student?.repaymentPlan });
  const lateOn = lateFeesOn(rows, paymentDate);
  const lateNowAmt = lateOn.due.reduce((s, r) => s + r.lateFeePending, 0);
  const problems = deskProblems(
    { amount, paymentDate, mode: form.mode, chequeNo: form.chequeNo, chequeBank: form.chequeBank, waiveLate, waiveReason: form.waiveReason },
    walk,
    { today, sessionStart: boot.sessionStart, lateFeeOwed: totals.lateFee },
  );
  const has = (key: string) => problems.find((p) => p.key === key);
  const show = (key: string) => (tried ? has(key) : undefined);
  const nextDue = rows.find((r) => !isOverdueOn(r, today) && r.feesPending > 0);

  const searching = query.trim().length > 0;
  const listRows = useMemo(() => {
    const fresh = boot.students.map(s => ({ ...s, ...listBalances[s.id] }));
    if (searching) return fresh.filter((s) => matchesDeskSearch(s, query));
    return fresh.filter((s) => s.classId === classId);
  }, [boot.students, classId, query, searching, listBalances]);
  const className = boot.classes.find((c) => c.id === classId)?.label ?? "";

  /* ---------- handlers ---------- */
  const set = (patch: Partial<Form>) => { if (!attemptRef.current && !posting.current) setForm((f) => ({ ...f, ...patch })); };

  function syncUrl(id: string | null) {
    try {
      const url = new URL(window.location.href);
      if (id) url.searchParams.set("student", id);
      else url.searchParams.delete("student");
      url.searchParams.delete("receipt");
      window.history.replaceState(window.history.state, "", url.pathname + url.search);
    } catch {
      // The URL is a convenience; the desk works without it.
    }
  }

  async function selectStudent(id: string) {
    if (posting.current) return;
    const seq = ++loadSeq.current;
    setSelId(id);
    setSaved(null);
    setForm(freshForm(boot));
    setTried(false);
    setAck(false);
    setSheet("");
    setReviewing(false);
    setDatePreview(null);
    const pending = attemptRef.current;
    setUncertain(pending?.input.studentId === id ? { checking: false } : null);
    if (pending?.input.studentId === id) { setForm(recoveredForm(boot, pending)); setReviewing(true); }
    if (!pending) requestId.current = null;
    setLoading(true);
    syncUrl(id);
    const hit = boot.students.find((s) => s.id === id);
    if (hit) setClassId(hit.classId);
    const res = await loadStudentDeskAction({ studentId: id, sessionLabel: boot.sessionLabel }).catch(
      (): DeskStudentResult => ({ ok: false, message: tx(W.couldNotLoad), repairable: false }),
    );
    if (seq !== loadSeq.current) return;
    setResult(res);
    if (res.ok && !pending) setForm(suggestedForm(boot, res.student));
    setLoading(false);
  }

  function clearStudent() {
    if (posting.current) return;
    loadSeq.current += 1;
    setSelId(null);
    setResult(null);
    setSaved(null);
    setLoading(false);
    setReviewing(false);
    setUncertain(null);
    if (!attemptRef.current) requestId.current = null;
    syncUrl(null);
  }

  /** After a receipt: back to the list for the next family, with a fresh form. */
  function collectAnother() {
    setForm(freshForm(boot));
    setTried(false);
    setAck(false);
    clearStudent();
    window.setTimeout(() => document.querySelector<HTMLInputElement>(".pd-left input")?.focus(), 0);
  }

  async function reloadStudent() {
    if (!student) return;
    const res = await loadStudentDeskAction({ studentId: student.id, sessionLabel: boot.sessionLabel }).catch(() => null);
    if (res && res.ok) setResult(res);
  }

  function review() {
    setTried(true);
    if (!student || !canAct || problems.length || !dateReady || !recoveryReady || recoveryError || attempt || !Number.isSafeInteger(concession) || concession < 0 || concession > totals.wholeYear - (waiveLate ? totals.lateFee : 0) || !form.receivedBy.trim()) {
      if (problems.length) toast.show({ text: tx(W.fix), tone: "bad" });
      return;
    }
    const hit = findRecentDuplicate(student.receipts, { amount, mode: form.mode }, wallClock());
    if (hit && !ack) {
      setDup({ kind: "client", receiptId: hit.id, receiptNumber: hit.receiptNumber, createdAt: hit.createdAt, amount: hit.amount, mode: hit.mode });
      setSheet("dup");
      return;
    }
    setReviewing(true);
  }

  function applySaved(res: Extract<DeskSaveResult, { status: "saved" }>, postedAmount: number) {
    const postedDate = attemptRef.current?.input.paymentDate;
    const studentId = attemptRef.current?.input.studentId ?? res.student?.id;
    if (studentId && res.balanceAfter) setListBalances(b => ({ ...b, [studentId]: { pendingToday: res.balanceAfter!.pendingToday, lateFee: res.balanceAfter!.lateFee } }));
    setDatePreview(null);
    if (attemptKey) void clearPaymentAttempt(attemptKey).catch(() => undefined);
    attemptRef.current = null; setAttempt(null);
    requestId.current = null;
    const now = wallClock();
    const at = new Date(now).toISOString();
    const total = res.receipt?.total ?? postedAmount;
    setSaved({
      receiptId: res.receiptId,
      receiptNumber: res.receiptNumber,
      receipt: res.receipt,
      balance: res.balanceAfter,
      amount: total,
      fresh: true,
      savedAtMs: now,
      removed: false,
      sent: false,
      log: [{ text: tx(W.savedBy(boot.me.name)), time: clock(at), tone: "var(--acc)" }],
    });
    if (res.student) setResult({ ok: true, student: res.student });
    setSheet("");
    setReviewing(false);
    setUncertain(null);
    setAck(false);
    if (postedDate === today && !restoredAttempt.current && !counted.current.has(res.receiptId)) {
      counted.current.add(res.receiptId);
      setTodayTotals((t) => ({ count: t.count + 1, amount: t.amount + total }));
    }
    restoredAttempt.current = false;
    toast.show({ text: tx(W.savedToast(res.receiptNumber, rupees(total))) });
  }

  /** Ask the database whether the save with this request id posted. */
  async function checkSaved() {
    const pending = attemptRef.current;
    if (!pending || !canAct || posting.current) return;
    posting.current = true;
    const postedAmount = pending.input.amount;
    setUncertain({ checking: true });
    const res: DeskCheckResult = await checkDeskPaymentAction({ studentId: pending.input.studentId, clientRequestId: pending.input.clientRequestId, sessionLabel: pending.input.sessionLabel }).catch(
      (error: unknown): DeskCheckResult => ({ status: "unknown", message: error instanceof Error ? error.message : tx(W.uncertainTitle) }),
    );
    posting.current = false;
    if (res.status === "saved") {
      if (selId !== pending.input.studentId) await selectStudent(pending.input.studentId);
      toast.show({ text: tx(W.checkedSaved(res.receiptNumber)) });
      applySaved(res, postedAmount);
      return;
    }
    if (res.status === "not_saved") {
      // Keep the same request id: if the first save lands late after all, a
      // second press returns that receipt instead of writing another.
      setUncertain(null);
      toast.show({ text: tx(W.checkedNotSaved), ms: 8000 });
      return;
    }
    setUncertain({ checking: false });
    toast.show({ text: res.message || tx(W.uncertainTitle), tone: "bad", ms: 8000 });
  }

  async function save() {
    if (!student || posting.current || saving || !canAct || uncertain || !recoveryReady || recoveryError || !attemptKey || (attemptRef.current && attemptRef.current.input.studentId !== student.id)) return;
    if (!attemptRef.current && (!dateReady || problems.length || !Number.isSafeInteger(concession) || concession < 0 || concession > totals.wholeYear - (waiveLate ? totals.lateFee : 0) || !form.receivedBy.trim())) return;
    posting.current = true;
    if (!requestId.current) requestId.current = crypto.randomUUID();
    setSaving(true);
    const input: DeskPostInput = attemptRef.current ? { ...attemptRef.current.input, acknowledgeDuplicate: ack || attemptRef.current.input.acknowledgeDuplicate } : {
      clientRequestId: requestId.current,
      studentId: student.id,
      sessionLabel: boot.sessionLabel,
      paymentDate,
      mode: form.mode,
      amount,
      quickDiscountAmount: concession,
      lateFeeWaiver: walk.waiverAmount,
      reference: composeReference({ mode: form.mode, reference: form.reference, chequeNo: form.chequeNo }),
      remarks: composeRemarks({
        mode: form.mode,
        chequeBank: form.chequeBank,
        chequeDate: form.chequeDate,
        waiveLate,
        waiveReason: form.waiveReason,
        waiveNote: form.waiveNote,
        notes: form.notes,
      }),
      receivedBy: form.receivedBy.trim(),
      acknowledgeDuplicate: ack,
      // No answer at all (dropped connection, timeout) is not "not saved": it
      // may have posted. Say so, and check before anything else is allowed.
    };
    const pending: PaymentAttempt = { input, form: attemptRef.current?.form ?? form };
    try { await writePaymentAttempt(attemptKey, pending); }
    catch { posting.current = false; setSaving(false); toast.show({ text: tx(W.storageBlocked), tone: "bad", ms: 8000 }); return; }
    attemptRef.current = pending; setAttempt(pending);
    const postedAmount = input.amount;
    const res = await postDeskPaymentAction(input).catch((): DeskSaveResult => ({ status: "uncertain", message: tx(W.uncertainTitle) }));
    posting.current = false;
    setSaving(false);

    if (res.status === "saved") {
      applySaved(res, postedAmount);
      return;
    }
    if (res.status === "uncertain") {
      setUncertain({ checking: false });
      void checkSaved();
      return;
    }
    if (res.status === "duplicate") {
      setDup({ kind: res.kind, receiptId: res.receiptId, receiptNumber: res.receiptNumber, createdAt: res.createdAt, amount: res.amount, mode: res.mode });
      setSheet("dup");
      return;
    }
    // A permanent waiver can have completed before the payment was rejected.
    // Keep its request id and financial payload so retry cannot waive twice.
    if (input.lateFeeWaiver === 0) {
      await clearPaymentAttempt(attemptKey).catch(() => undefined);
      attemptRef.current = null; setAttempt(null); requestId.current = null;
    }
    toast.show({ text: res.message || tx(W.notSaved), tone: "bad", ms: 8000 });
  }

  async function openEarlier() {
    if (!dup?.receiptId) return;
    setBusy(true);
    const receipt = await loadReceiptAction(dup.receiptId).catch(() => null);
    setBusy(false);
    setSheet("");
    if (!receipt) {
      toast.show({ text: tx(W.couldNotLoad), tone: "bad" });
      return;
    }
    if (attemptKey) await clearPaymentAttempt(attemptKey).catch(() => undefined);
    attemptRef.current = null; setAttempt(null); requestId.current = null; setUncertain(null);
    setSaved({ receiptId: receipt.id, receiptNumber: receipt.receiptNumber, receipt, balance: null, amount: receipt.total, fresh: false, savedAtMs: 0, removed: receipt.isReversed, sent: false, log: [] });
  }

  function newPayment() {
    if (attemptRef.current || posting.current) return;
    setSaved(null);
    setForm(freshForm(boot));
    setTried(false);
    setAck(false);
    setReviewing(false);
    setUncertain(null);
    requestId.current = null;
  }

  async function retryReceipt() {
    if (!saved || busy) return;
    setBusy(true);
    const receipt = await loadReceiptAction(saved.receiptId).catch(() => null);
    setBusy(false);
    if (!receipt) {
      toast.show({ text: tx(W.couldNotLoad), tone: "bad" });
      return;
    }
    setSaved((cur) => (cur ? { ...cur, receipt, amount: receipt.total } : cur));
  }

  async function remove() {
    if (!saved || !student || busy) return;
    setBusy(true);
    const reason = [rmReason, rmNote.trim()].filter(Boolean).join(" — ");
    const res = await removePaymentAction({ receiptId: saved.receiptId, studentId: student.id, sessionLabel: boot.sessionLabel, reason }).catch(
      (error: unknown) => ({ ok: false, message: error instanceof Error ? error.message : "Not removed." }),
    );
    setBusy(false);
    if (!res.ok) {
      toast.show({ text: res.message, tone: "bad", ms: 8000 });
      return;
    }
    const at = new Date().toISOString();
    const total = saved.receipt?.total ?? 0;
    setSaved((s) => (s ? { ...s, removed: true, log: [...s.log, { text: tx(W.removedBy(boot.me.name)), time: clock(at), tone: "var(--bad)" }] } : s));
    setTodayTotals((t) => ({ count: Math.max(0, t.count - 1), amount: Math.max(0, t.amount - total) }));
    setSheet("");
    setRmReason("");
    setRmNote("");
    toast.show({ text: tx(W.rmDone(saved.receiptNumber)) });
    await reloadStudent();
  }

  async function sendWa() {
    if (!saved || busy) return;
    setBusy(true);
    const res = await sendReceiptWhatsappAction(saved.receiptId).catch((error: unknown) => ({ ok: false, message: error instanceof Error ? error.message : "Not sent." }));
    setBusy(false);
    if (!res.ok) {
      toast.show({ text: res.message, tone: "bad", ms: 8000 });
      return;
    }
    const at = new Date().toISOString();
    setSaved((s) => (s ? { ...s, sent: true, log: [...s.log, { text: tx(W.waSentLog), time: clock(at), tone: "var(--ok)" }] } : s));
    setSheet("");
    toast.show({ text: tx(W.waSent) });
  }

  /* ---------- pieces ---------- */
  const crumb = `${tx(W.money)} · ${tx(W.session)} ${boot.sessionLabel} · ${shortDay(today)}`;
  const todayPill = (
    <Link href="/receipts" className="tap" style={{ display: "inline-flex", alignItems: "center", gap: 8, height: 40, padding: "0 14px", borderRadius: 12, background: "var(--oks)", color: "var(--ok)", fontWeight: 700, fontSize: 14 }}>
      <span className="live-dot" style={{ background: "var(--ok)" }} />
      {tx(W.todayPill)}: <span className="num">{rupees(todayTotals.amount)}</span>
      <span style={{ fontWeight: 500 }}>· {tx(W.receiptsN(todayTotals.count))}</span>
      <Ic n="chevRight" size={16} />
    </Link>
  );
  const manyBtn = (
    <Link href="/payments/bulk" className="tap btn sec">
      <Ic n="table" /> {tx(W.many)}
      <Pill tone="mut">{tx(W.adminOnly)}</Pill>
    </Link>
  );

  const findPane = (
    <section className={`pd-left${selId ? " pd-hide-m" : ""}`} aria-label={tx(W.search)}>
      <SearchBox value={query} onChange={setQuery} placeholder={tx(W.search)} />
      {!searching ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <h2 className="sech">{tx(W.pickClass)}</h2>
            <span style={{ fontSize: 12, color: "var(--mut)" }}>{tx(W.nClasses(boot.classes.length))}</span>
          </div>
          <div className="pd-cls" role="radiogroup" aria-label={tx(W.pickClass)}>
            {boot.classes.map((c) => (
              <button key={c.id} type="button" role="radio" aria-checked={c.id === classId} className={`tap${c.id === classId ? " on" : ""}`} title={c.label} onClick={() => setClassId(c.id)}>
                {c.short}
              </button>
            ))}
          </div>
        </div>
      ) : null}
      <Card pad={false} style={{ overflow: "hidden" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 14px" }}>
          <strong>{searching ? `“${query.trim()}”` : className}</strong>
          <span style={{ fontSize: 12, color: "var(--mut)" }}>{searching ? tx(W.results(listRows.length)) : tx(W.nStudents(listRows.length))}</span>
        </div>
        {listRows.length === 0 ? (
          <EmptyState
            icon="search"
            title={tx(W.noneFound)}
            body={tx(W.noneFoundBody)}
            action={searching ? <Btn variant="soft" onClick={() => setQuery("")}>{tx(W.clearSearch)}</Btn> : undefined}
          />
        ) : (
          <div className="pd-list scroll">
            {listRows.map((s, i) => {
              const amountCell =
                s.pendingToday > 0 ? (
                  <>
                    <b className="num" style={{ color: "var(--bad)" }}>{rupees(s.pendingToday)}</b>
                    <span style={{ fontSize: 12, color: "var(--mut)" }}>{s.lateFee > 0 ? tx(W.pendingPlusLate(rupees(s.lateFee))) : tx(W.pendingToday)}</span>
                  </>
                ) : (
                  <>
                    <b style={{ color: "var(--ok)" }}>{tx(W.paidUp)}</b>
                    <span style={{ fontSize: 12, color: "var(--mut)" }}>{s.lateFee > 0 ? tx(W.lateOnly(rupees(s.lateFee))) : tx(W.upToToday)}</span>
                  </>
                );
              return (
                <button
                  key={s.id}
                  type="button"
                  className={`pd-srow tap${s.id === selId ? " sel" : ""}`}
                  aria-current={s.id === selId ? "true" : undefined}
                  onClick={() => selectStudent(s.id)}
                  style={{ animation: `xIn .3s var(--ease) ${Math.min(i * 18, 300)}ms both` }}
                >
                  <Avatar text={initials(s.name)} seed={s.name} size={38} />
                  <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
                    <span className="clip" style={{ fontWeight: 600 }}>{s.name}</span>
                    <span className="clip" style={{ fontSize: 12, color: "var(--mut)" }}>
                      {searching ? `${s.classLabel} · ` : ""}SR {s.sr}{s.father ? ` · ${s.father}` : ""}
                    </span>
                  </span>
                  <span style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", flex: "none", textAlign: "right" }}>{amountCell}</span>
                </button>
              );
            })}
          </div>
        )}
      </Card>
    </section>
  );

  const studentCard = student ? (
    <StudentCard
      student={student}
      today={today}
      totals={totals}
      nextDue={nextDue ? { no: nextDue.installmentNo, date: dayMonth(nextDue.dueDate) } : null}
      onSibling={(id) => selectStudent(id)}
      hideOnPhone={Boolean(saved)}
    />
  ) : null;

  /* ---------- the form ---------- */
  const modeOptions = boot.modes.map((m) => ({ value: m, label: tx(MODE_PAIR[m]) }));
  const lateBlock =
    student && totals.lateFee > 0 ? (
      lateOn.due.length === 0 && lateOn.avoidable.length > 0 && !waiveLate ? (
        <div className="pd-late" style={{ background: "var(--infos)", borderColor: "transparent", color: "var(--info)" }}>
          <span style={{ display: "flex", gap: 8, fontSize: 13, fontWeight: 600 }}>
            <Ic n="info" size={16} />
            {tx(W.lateNoneOn(dateLabel(paymentDate), lateOn.avoidable.map((r) => r.label).join(", ")))}
          </span>
        </div>
      ) : (
        <div className="pd-late">
          <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
            <Ic n="clock" size={20} />
            <span style={{ display: "flex", flexDirection: "column", gap: 2 }}>
              <strong>{tx(W.lateTitle(rupees(lateNowAmt || totals.lateFee), (lateOn.due.length ? lateOn.due : rows.filter((r) => r.lateFeePending > 0)).map((r) => r.label).join(" + ")))}</strong>
              <span style={{ fontSize: 12 }}>{tx(W.lateKeptApart)}</span>
            </span>
          </div>
          {waiveAllowed ? (
            <Seg
              label={tx(W.lateFee)}
              value={form.late}
              onChange={(v) => set({ late: v })}
              options={[
                { value: "take", label: tx(W.lateTake) },
                { value: "waive", label: tx(W.lateWaive) },
              ]}
            />
          ) : null}
          {waiveLate ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <span style={{ fontSize: 12, fontWeight: 700 }}>{tx(W.whyWaive)}</span>
              <div className="pd-chips">
                {W.waiveReasons.map((r) => (
                  <Chip key={r.en} on={form.waiveReason === r.en} onClick={() => set({ waiveReason: form.waiveReason === r.en ? "" : r.en })}>
                    {tx(r)}
                  </Chip>
                ))}
              </div>
              {show("waive-reason") ? <span role="alert" style={{ color: "var(--bad)", fontSize: 12, fontWeight: 700 }}>{tx(W.pickReason)}</span> : null}
              <Input value={form.waiveNote} onChange={(e) => set({ waiveNote: e.target.value })} placeholder={tx(W.waiveNote)} aria-label={tx(W.waiveNote)} />
              <span style={{ fontSize: 12 }}>{tx(W.waiveFoot)}</span>
            </div>
          ) : (
            <span style={{ fontSize: 12 }}>{student.onPlan && boot.me.canWaive ? tx(W.lateNoWaivePlan) : tx(W.lateTakeNote)}</span>
          )}
        </div>
      )
    ) : null;

  const dateLine = has("date-invalid")
    ? tx(W.errDateInvalid)
    : has("date-future")
      ? tx(W.errDateFuture)
      : has("date-before-session")
        ? tx(W.errDateBefore(dateLabel(boot.sessionStart)))
        : `${form.dateMode === "today" ? `${tx(W.today)} · ` : form.dateMode === "yesterday" ? `${tx(W.yesterday)} · ` : ""}${shortDay(paymentDate)}${paymentDate !== today ? tx(W.lateWorkedOut) : ""}`;
  const dateBad = Boolean(has("date-invalid") || has("date-future") || has("date-before-session"));

  const formCard = student ? (
    <Card className="fadein" style={{ display: "flex", flexDirection: "column", gap: 16 }} aria-label={tx(W.paymentFor(firstName(student.name)))}>
      <div>
        <h2 style={{ margin: 0, fontSize: 17, fontWeight: 700 }}>{tx(W.paymentFor(firstName(student.name)))}</h2>
        <span style={{ fontSize: 13, color: "var(--mut)" }}>{tx(W.anyAmount)}</span>
      </div>
      {walk.maxAmount <= 0 ? <Banner tone="ok">{tx(W.nothingOwed)}</Banner> : null}
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <label htmlFor="pd-amount" className="lbl"><Bi {...W.amountReceived} block={false} /></label>
        <div className={`pd-amt${show("amount") || show("over") ? " err" : ""}`}>
          <span aria-hidden="true">₹</span>
          <input
            id="pd-amount"
            inputMode="numeric"
            autoComplete="off"
            value={form.amount}
            onChange={(e) => set({ amount: e.target.value })}
            placeholder="0"
            aria-invalid={Boolean(show("amount") || show("over")) || undefined}
            aria-describedby="pd-amount-words"
          />
        </div>
        <span id="pd-amount-words" style={{ fontSize: 13, color: show("amount") || show("over") ? "var(--bad)" : "var(--mut)", fontWeight: show("amount") ? 600 : 400 }}>
          {has("over") ? tx(W.overMax(rupees(walk.maxAmount))) : amount ? amountInWords(amount) : tried ? tx(W.typeAmountErr) : tx(W.typeAmount)}
        </span>
        {chips.length ? (
          <div className="pd-chips" role="group" aria-label={tx(W.chipNote)}>
            {chips.map((c) => (
              <button type="button" className={`tap chip${amount === c.amount ? " on" : ""}`} key={c.key} aria-pressed={amount === c.amount} disabled={c.disabled || Boolean(attempt)} onClick={() => set({ amount: c.amount === null ? "" : String(c.amount) })}>
                {tx(({ full: student?.onPlan ? W.everythingOwed : W.fullDue, next: W.nextInstallment, overdue: W.pendingToday, lateFee: W.lateFee, lastAmount: W.lastAmount, clear: W.clearAmount, emiCatchUp: W.planCatchUp, emiMonthly: W.planMonthly, emiFullPlan: W.planBalance })[c.key])} {c.amount !== null ? <b>{rupees(c.amount)}</b> : null}
              </button>
            ))}
          </div>
        ) : null}
        <span style={{ fontSize: 12, color: "var(--mut)" }}>{tx(W.suggested)} · {tx(W.chipNote)}</span>
        {student.repaymentPlan ? <Banner tone="info">
          {tx(W.planMonthly)}: {rupees(student.repaymentPlan.monthlyAmount)} · {tx(W.planCatchUp)}: {rupees(student.repaymentPlan.catchUpAmount)} · {tx(W.planBalance)}: {rupees(student.repaymentPlan.remainingBalance)}
          {student.repaymentPlan.nextDueDate ? ` · ${dateLabel(student.repaymentPlan.nextDueDate)}` : ""}
          {student.repaymentPlan.duesOutsidePlanAmount > 0 ? <div>{tx(W.planOutside)}: {rupees(student.repaymentPlan.duesOutsidePlanAmount)}</div> : null}
          {student.repaymentPlan.planReviewNeeded ? <div>{tx(W.planReview)}</div> : null}
        </Banner> : null}
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {lateBlock}
        <span className="lbl"><Bi {...W.paymentDate} block={false} /></span>
        <Seg
          label={tx(W.paymentDate)}
          value={form.dateMode}
          onChange={(v) => set({ dateMode: v })}
          options={[
            { value: "today", label: tx(W.today) },
            { value: "yesterday", label: tx(W.yesterday) },
            { value: "other", label: tx(W.otherDate) },
          ]}
        />
        {form.dateMode === "other" ? (
          <Field label={tx(W.dateParentPaid)}>
            <Input type="date" value={form.otherDate} min={boot.sessionStart} max={today} onChange={(e) => set({ otherDate: e.target.value })} invalid={dateBad} />
          </Field>
        ) : null}
        <span style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, color: dateBad ? "var(--bad)" : "var(--mut)" }}>
          <Ic n="calendar" size={15} /> {dateLine}
        </span>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <span className="lbl"><Bi {...W.mode} block={false} /></span>
        <Seg label={tx(W.mode)} value={form.mode} onChange={(v) => set({ mode: v })} options={modeOptions} />
        {form.mode === "upi" || form.mode === "bank_transfer" ? (
          <Field label={tx(form.mode === "upi" ? W.upiRef : W.utr)}>
            <Input value={form.reference} onChange={(e) => set({ reference: e.target.value })} placeholder={tx(form.mode === "upi" ? W.upiRefPh : W.utrPh)} inputMode={form.mode === "upi" ? "numeric" : "text"} />
          </Field>
        ) : null}
        {form.mode === "cheque" ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <div className="g3" style={{ display: "grid", gridTemplateColumns: "repeat(3,minmax(0,1fr))", gap: 10 }}>
              <Field label={tx(W.chequeNo)} error={show("cheque-no") ? tx(W.errChequeNo) : undefined}>
                <Input className="num" inputMode="numeric" maxLength={6} value={form.chequeNo} onChange={(e) => set({ chequeNo: e.target.value.replace(/\D/g, "") })} invalid={Boolean(show("cheque-no"))} />
              </Field>
              <Field label={tx(W.bank)} error={show("cheque-bank") ? tx(W.errChequeBank) : undefined}>
                <Input value={form.chequeBank} onChange={(e) => set({ chequeBank: e.target.value })} invalid={Boolean(show("cheque-bank"))} />
              </Field>
              <Field label={tx(W.chequeDate)}>
                <Input type="date" value={form.chequeDate} onChange={(e) => set({ chequeDate: e.target.value })} />
              </Field>
            </div>
            <span style={{ fontSize: 12, color: "var(--mut)" }}>{tx(W.chequeNote)}</span>
          </div>
        ) : null}
      </div>

      <Field label={tx(W.concession)}>
        <Input id="pd-concession" inputMode="numeric" value={form.concession} disabled={student.onPlan || !canAct} onChange={(e) => set({ concession: e.target.value })} placeholder="0" />
        <span style={{ fontSize: 12, color: "var(--mut)" }}>{tx(W.concessionHint)}</span>
        {!Number.isSafeInteger(concession) || concession < 0 || concession > totals.wholeYear - (waiveLate ? totals.lateFee : 0) ? <span role="alert">{tx(W.concessionInvalid)}</span> : null}
      </Field>

      <Field label={tx(W.collector)}>
        <Input id="pd-received-by" value={form.receivedBy} onChange={(e) => set({ receivedBy: e.target.value })} />
        <span style={{ fontSize: 12, color: "var(--mut)" }}>{tx(W.collectorHint)}</span>
      </Field>

      <Field label={tx(W.notes)}>
        <Textarea rows={2} value={form.notes} onChange={(e) => set({ notes: e.target.value })} style={{ minHeight: 64 }} />
      </Field>

      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <Avatar text={initials(boot.me.name)} seed={boot.me.name} size={34} />
        <span style={{ display: "flex", flexDirection: "column" }}>
          <span style={{ fontSize: 12, color: "var(--mut)" }}>{tx(W.receivedBy)}</span>
          <span style={{ fontWeight: 600 }}>{boot.me.name} · {tx(W.signedIn)}</span>
        </span>
      </div>
    </Card>
  ) : null;

  const preview = student && dateReady ? <WherePreview walk={walk} amount={Number.isFinite(amount) ? amount : 0} paymentDate={paymentDate} today={today} /> : null;

  const bar =
    student && !saved && !reviewing ? (
      <div className="pd-pbar glass">
        <span style={{ display: "flex", flexDirection: "column", minWidth: 0, flex: "1 1 auto" }}>
          <span style={{ fontSize: 12, color: "var(--mut)" }}>
            {tx(MODE_PAIR[form.mode])} · {form.dateMode === "today" ? tx(W.today).toLowerCase() : dayMonth(paymentDate)}
          </span>
          <strong className="num" style={{ fontSize: 22 }}>{rupees(Number.isFinite(amount) ? amount : 0)}</strong>
        </span>
        <span className="hide-m" style={{ fontSize: 13, color: "var(--mut)" }}>{previewing ? tx(W.previewing) : tx(W.checkThenSave)}</span>
        <Btn variant="pri" big icon="checkCircle" onClick={review} disabled={!canAct || !attemptKey || !dateReady || !recoveryReady || recoveryError || Boolean(attempt)}>
          {tx(W.review)}
        </Btn>
      </div>
    ) : null;

  /* ---------- saved ---------- */
  const removable = Boolean(saved && saved.fresh && !saved.removed && boot.me.canRemove && expiredAt !== saved.savedAtMs);
  const savedView = saved && student ? (
    <SavedPanel
      saved={saved}
      student={student}
      removable={removable}
      canRemove={boot.me.canRemove}
      canAct={canAct}
      onWa={() => setSheet("wa")}
      onNew={newPayment}
      onAnother={collectAnother}
      onRetryReceipt={retryReceipt}
      busy={busy}
      onRemove={() => setSheet("rm")}
      onSibling={(id) => selectStudent(id)}
    />
  ) : null;

  /* ---------- page ---------- */
  return (
    <VxPage label={tx(W.title)}>
      <TopBar
        crumb={crumb}
        title={tx(W.title)}
        actions={
          <span style={{ display: "flex", gap: 10, alignItems: "center" }}>
            {todayPill}
            {manyBtn}
          </span>
        }
        mTitle={student ? student.name : tx(W.title)}
        mSub={student ? `${student.classLabel} · SR ${student.sr}` : `${tx(W.todayPill)}: ${rupees(todayTotals.amount)} · ${tx(W.receiptsN(todayTotals.count))}`}
        mAction={
          <Link href="/payments/bulk" className="tap icon-btn" aria-label={tx(W.many)} style={{ width: 44, height: 44 }}>
            <Ic n="table" size={20} />
          </Link>
        }
      />
      <main>
        {attempt && attempt.input.studentId !== student?.id ? <div className="pad"><Banner tone="warn" action={<Btn onClick={() => void selectStudent(attempt.input.studentId)}>{tx(W.resumePayment)}</Btn>}>{tx(W.unfinished)}</Banner></div> : null}
        {recoveryError || (canAct && !attemptKey) ? <div className="pad"><Banner tone="bad">{tx(W.storageBlocked)}</Banner></div> : null}
        {previewing || boot.blocking ? (
          <div className="pad" style={{ padding: "16px 28px 0", display: "flex", flexDirection: "column", gap: 8 }}>
            {previewing ? <Banner tone="info">{tx(W.previewing)}</Banner> : null}
            {boot.blocking ? (
              <Banner
                tone="warn"
                action={boot.blocking.actionHref && boot.blocking.actionLabel ? <Btn href={boot.blocking.actionHref} variant="sec">{boot.blocking.actionLabel}</Btn> : undefined}
              >
                {boot.blocking.title} — <span style={{ fontWeight: 500 }}>{boot.blocking.detail}</span>
              </Banner>
            ) : null}
          </div>
        ) : null}
        <div className="pd-grid">
          <div className="pd-left">
            {findPane}
            {selId ? (
              <button type="button" className="tap only-m" onClick={clearStudent} style={{ display: "flex", alignItems: "center", gap: 10, height: 52, padding: "0 16px", borderRadius: 14, border: "1px solid var(--bds)", background: "var(--card)", color: "var(--mut)", fontSize: 15 }}>
                <Ic n="search" /> {tx(W.searchAnother)}
              </button>
            ) : null}
            {loading ? <StudentSkeleton /> : null}
            {!loading && result && !result.ok ? (
              <Card style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                <strong>{tx(W.couldNotLoad)}</strong>
                <span style={{ color: "var(--mut)" }}>{result.message}</span>
                {selId ? <Btn href={`/fees/payments?studentId=${selId}`} variant="soft">{tx(W.openClassic)}</Btn> : null}
              </Card>
            ) : null}
            {!loading && student ? <details className="pd-student-details" open><summary>{tx(W.installmentSummary)}</summary>{studentCard}</details> : null}
          </div>
          <div className={`pd-right${selId ? "" : " pd-hide-m"}`}>
            {!selId ? (
              <Card style={{ minHeight: 420, display: "flex", alignItems: "center", justifyContent: "center" }}>
                <EmptyState icon="rupee" title={<span className="serif" style={{ fontSize: 22 }}>{tx(W.pickTitle)}</span>} body={tx(W.pickBody)} />
              </Card>
            ) : loading ? (
              <Card style={{ display: "flex", flexDirection: "column", gap: 12 }} aria-busy="true" aria-label={tx(W.loading)}>
                <Skel w="40%" h={18} />
                <Skel h={68} r={16} />
                <Skel w="70%" h={12} />
                <Skel h={40} r={12} />
                <Skel h={40} r={12} />
              </Card>
            ) : savedView ? (
              savedView
            ) : student && reviewing ? (
              <Card className="fadein" style={{ display: "flex", flexDirection: "column", gap: 16 }} aria-labelledby="pd-review-title">
                <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                  <span className="sech">{tx(W.reviewStep)}</span>
                  <h2 id="pd-review-title" style={{ margin: 0, fontSize: 20, fontWeight: 700 }}>{tx(W.confirmTitle)}</h2>
                  <span style={{ fontSize: 13, color: "var(--mut)" }}>{tx(W.confirmSub)}</span>
                </div>
                {uncertain ? (
                  <Banner
                    tone="warn"
                    action={
                      <Btn variant="sec" disabled={uncertain.checking} onClick={() => void checkSaved()}>
                        {uncertain.checking ? tx(W.checking) : tx(W.checkAgain)}
                      </Btn>
                    }
                  >
                    <strong>{tx(W.uncertainTitle)}</strong> — <span style={{ fontWeight: 500 }}>{tx(W.uncertainBody)}</span>
                  </Banner>
                ) : null}
                <ConfirmBody
                  student={student}
                  amount={amount}
                  modeText={tx(MODE_PAIR[form.mode])}
                  reference={composeReference({ mode: form.mode, reference: form.reference, chequeNo: form.chequeNo })}
                  paymentDate={paymentDate}
                  walk={walk}
                  receivedBy={form.receivedBy}
                  concession={concession}
                  notes={form.notes}
                />
                <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                  <button type="button" className="tap btn sec" style={{ flex: "1 1 160px" }} disabled={saving || Boolean(attempt)} onClick={() => setReviewing(false)}>
                    <Ic n="chevLeft" size={18} /> {tx(W.backToForm)}
                  </button>
                  <button type="button" className="tap btn pri big" style={{ flex: "2 1 240px" }} disabled={saving || !canAct || Boolean(uncertain)} onClick={save}>
                    {saving ? <Ic n="refresh" size={18} className="spin" /> : <Ic n="lock" size={18} />}
                    {saving ? tx(W.saving) : `${tx(W.confirmSave)} · ${rupees(amount)}`}
                  </button>
                </div>
              </Card>
            ) : student ? (
              <>
                <div className="pd-pin">
                  {formCard}
                  <aside>{preview}</aside>
                </div>
                {!dateReady ? <Banner tone={dateFailed ? "warn" : "info"}>{tx(dateFailed ? W.dateFailed : W.dateLoading)}</Banner> : null}
                {bar}
              </>
            ) : null}
          </div>
        </div>
        <div style={{ height: 28 }} />
      </main>

      {/* Duplicate */}
      <Sheet
        open={sheet === "dup"}
        onClose={() => setSheet("")}
        title={tx(W.dupTitle)}
        sub={tx(W.dupSub)}
        icon="alert"
        footer={
          <div style={{ display: "flex", flexDirection: "column", gap: 8, width: "100%" }}>
            <button type="button" className="tap btn pri" disabled={!dup?.receiptId || busy} onClick={openEarlier}>
              <Ic n="receipt" size={18} /> {tx(W.dupOpen)}
            </button>
            <button
              type="button"
              className="tap btn sec"
              disabled={dup?.kind === "near-duplicate" && !boot.me.isAdmin}
              onClick={() => {
                setAck(true);
                setSheet("");
                setReviewing(true);
              }}
            >
              {tx(W.dupAgain)}
            </button>
            <button type="button" className="tap btn ghost" onClick={() => setSheet("")}>{tx(W.cancel)}</button>
          </div>
        }
      >
        {dup ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <Card style={{ display: "flex", alignItems: "center", gap: 12, background: "var(--warns)", borderColor: "var(--warnm)" }}>
              <Ic n="receipt" size={22} style={{ color: "var(--warnfg)" }} />
              <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
                <strong className="num">{dup.receiptNumber ?? "—"}</strong>
                <span style={{ fontSize: 13, color: "var(--mut)" }}>
                  {tx(W.saved)}{dup.createdAt ? ` · ${clock(dup.createdAt)}` : ""} · {student?.name ?? ""}
                </span>
                <span style={{ fontSize: 13, color: "var(--mut)" }}>{dup.mode ? MODE_TEXT[dup.mode] ?? dup.mode : ""}</span>
              </span>
              <strong className="num" style={{ fontSize: 18 }}>{rupees(dup.amount ?? amount)}</strong>
            </Card>
            {dup.kind === "near-duplicate" && !boot.me.isAdmin ? <Banner tone="warn">{tx(W.dupHard)}</Banner> : null}
            <p style={{ margin: 0, color: "var(--mut)" }}>{tx(W.dupBody)}</p>
          </div>
        ) : null}
      </Sheet>

      {/* WhatsApp */}
      <Sheet
        open={sheet === "wa"}
        onClose={() => setSheet("")}
        title={tx(W.waTitle)}
        sub={tx(W.waSub)}
        icon="send"
        footer={
          <>
            <button type="button" className="tap btn sec" style={{ flex: 1 }} onClick={() => setSheet("")}>{tx(W.cancel)}</button>
            <button type="button" className="tap btn pri" style={{ flex: 2 }} disabled={busy || !canAct || !student?.phone} onClick={sendWa}>
              {busy ? <Ic n="refresh" size={16} className="spin" /> : <Ic n="send" size={16} />} {tx(W.waSend)}
            </button>
          </>
        }
      >
        {saved && student ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <Seg
              label="Language"
              value={waLang}
              onChange={setWaLang}
              options={[
                { value: "hi", label: "हिंदी" },
                { value: "en", label: "English" },
                { value: "both", label: tx(W.langBoth) },
              ]}
            />
            <WhatsAppPreview lines={waLines(saved, student, waLang)} footer={`${saved.receiptNumber}.pdf`} />
            <span style={{ fontSize: 12, color: "var(--mut)" }}>
              {student.phone ? tx(W.waTo(student.father ?? student.name, maskPhone(student.phone))) : tx(W.noPhone)}
            </span>
            <span style={{ fontSize: 12, color: "var(--mut)" }}>{tx(W.waPreviewNote)}</span>
          </div>
        ) : null}
      </Sheet>

      {/* Remove */}
      <Sheet
        open={sheet === "rm"}
        onClose={() => setSheet("")}
        title={tx(W.rmTitle)}
        sub={tx(W.rmSub)}
        icon="trash"
        footer={
          <>
            <button type="button" className="tap btn sec" style={{ flex: 1 }} onClick={() => setSheet("")}>{tx(W.rmKeep)}</button>
            <button type="button" className="tap btn danger" style={{ flex: 2 }} disabled={busy || !rmReason || !removable} onClick={remove}>
              {busy ? <Ic n="refresh" size={16} className="spin" /> : <Ic n="trash" size={16} />} {tx(W.rmGo(rupees(saved?.receipt?.total ?? 0)))}
            </button>
          </>
        }
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <span className="lbl">{tx(W.rmWhy)}</span>
          <div className="pd-chips" role="radiogroup" aria-label={tx(W.rmWhy)}>
            {W.rmReasons.map((r) => (
              <Chip key={r.en} on={rmReason === r.en} onClick={() => setRmReason(r.en)}>{tx(r)}</Chip>
            ))}
          </div>
          <Field label={tx(W.waiveNote)}>
            <Input value={rmNote} onChange={(e) => setRmNote(e.target.value)} />
          </Field>
        </div>
      </Sheet>

    </VxPage>
  );
}

function waLines(saved: Saved, student: DeskStudent, lang: "hi" | "en" | "both"): string[] {
  const r = saved.receipt;
  const after = saved.balance;
  const msg = W.waMsg({
    name: student.name,
    cls: student.classLabel,
    amt: rupees(r?.total ?? 0),
    no: saved.receiptNumber,
    pending: rupees(after?.pendingToday ?? 0),
    late: after && after.lateFee > 0 ? rupees(after.lateFee) : null,
    father: student.father ?? "Parent",
  });
  if (lang === "hi") return msg.hi;
  if (lang === "en") return msg.en;
  return [...msg.hi, "", ...msg.en];
}

function StudentSkeleton() {
  return (
    <Card style={{ display: "flex", flexDirection: "column", gap: 12 }} aria-busy="true">
      <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
        <Skel w={52} h={52} r={16} />
        <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 6 }}>
          <Skel w="60%" h={20} />
          <Skel w="80%" h={12} />
        </div>
      </div>
      <div className="pd-tiles">
        <Skel h={70} r={14} />
        <Skel h={70} r={14} />
        <Skel h={70} r={14} />
        <Skel h={70} r={14} />
      </div>
      <Skel h={14} />
      <Skel h={14} />
    </Card>
  );
}

function StudentCard({
  student,
  today,
  totals,
  nextDue,
  onSibling,
  hideOnPhone,
}: {
  student: DeskStudent;
  today: string;
  totals: ReturnType<typeof deskTotals>;
  nextDue: { no: number; date: string } | null;
  onSibling: (id: string) => void;
  hideOnPhone: boolean;
}) {
  const { tx } = useVx();
  const rows = orderForSettlement(student.rows);
  const lateRows = rows.filter((r) => r.lateFeeRaw > 0 || r.lateFeePending > 0);
  const phone = maskPhone(student.phone);
  const tiles = [
    { k: W.feesPendingToday, v: totals.pendingToday, sub: totals.dueToday ? W.plusDueToday(rupees(totals.dueToday)) : W.overdueOnly, color: totals.pendingToday ? "var(--bad)" : "var(--ok)", hl: false },
    { k: W.notDueYet, v: totals.notDueYet, sub: nextDue ? W.nextInst(nextDue.no, nextDue.date) : W.nothingAhead, color: "var(--fg)", hl: false },
    { k: W.lateFee, v: totals.lateFee, sub: W.lateSeparate, color: totals.lateFee ? "var(--warnfg)" : "var(--ok)", hl: false },
    { k: W.canTakeToday, v: totals.canTakeToday, sub: W.canTakeSub, color: "var(--pri)", hl: true },
  ];
  return (
    <Card className={`fadein${hideOnPhone ? " pd-hide-m" : ""}`} style={{ display: "flex", flexDirection: "column", gap: 14 }} aria-label={student.name}>
      <div style={{ display: "flex", gap: 14, alignItems: "flex-start" }}>
        <span style={{ width: 52, height: 52, borderRadius: 16, background: "var(--accs)", color: "var(--accfg)", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: 18, flex: "none" }}>{initials(student.name)}</span>
        <span style={{ display: "flex", flexDirection: "column", minWidth: 0, gap: 2 }}>
          <span style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <strong className="serif" style={{ fontSize: 22, fontWeight: 600 }}>{student.name}</strong>
            <Pill tone="mut">{tx(student.isNew ? W.newStudent : W.oldStudent)}</Pill>
            {student.onPlan ? <Pill tone="info" icon="layers">{tx(W.onPlan)}</Pill> : null}
          </span>
          <span style={{ fontSize: 13, color: "var(--mut)" }}>{student.classLabel} · SR {student.sr}{phone ? ` · ${phone}` : ""}</span>
          <span style={{ fontSize: 13, color: "var(--mut)" }}>
            {student.father ? `${tx(W.father)} ${student.father} · ` : ""}{student.route ? `${tx(W.bus)}: ${student.route}` : tx(W.noBus)}
          </span>
        </span>
      </div>
      {student.siblings.length ? (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {student.siblings.map((s) => (
            <button key={s.id} type="button" className="tap chip" onClick={() => onSibling(s.id)}>
              <Ic n="users" size={15} /> {s.name} · {s.classLabel} <Ic n="arrowRight" size={15} />
            </button>
          ))}
        </div>
      ) : null}
      <div className="pd-tiles">
        {tiles.map((t) => (
          <div key={t.k.en} className={`pd-tile${t.hl ? " hl" : ""}`}>
            <span style={{ fontSize: 12, fontWeight: 600, color: "var(--mut)" }}>{tx(t.k)}</span>
            <b className="num" style={{ color: t.color }}>{rupees(t.v)}</b>
            <span style={{ fontSize: 12, color: "var(--mut)" }}>{tx(t.sub)}</span>
          </div>
        ))}
      </div>
      <div className="pd-ledger">
        {rows.map((r) => {
          const overdue = isOverdueOn(r, today);
          const st = r.feesPending <= 0 ? (["ok", W.stPaid] as const) : overdue ? (r.feesPaid > 0 ? (["warn", W.stPart] as const) : (["bad", W.stOverdue] as const)) : (["mut", W.stNotDue] as const);
          return (
            <div key={r.id}>
              <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
                <strong>{rowLabel(r, tx)}</strong>
                <span style={{ fontSize: 12, color: "var(--mut)" }}>
                  {r.isCarryForward ? tx(W.unpaidLastSession) : tx(W.due(dayMonth(r.dueDate)))} · {tx(W.charge(rupees(r.charge), rupees(r.feesPaid)))}
                </span>
              </span>
              <span style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 2 }}>
                <b className="num" style={{ color: r.feesPending <= 0 ? "var(--ok)" : overdue ? "var(--bad)" : "var(--fg)" }}>{rupees(r.feesPending)}</b>
                <Pill tone={st[0]}>{tx(st[1])}</Pill>
              </span>
            </div>
          );
        })}
        {lateRows.map((r) => {
          const waived = r.lateFeeStatus === "waived" || (r.lateFeeWaived > 0 && r.lateFeePending <= 0);
          const paid = !waived && r.lateFeePending <= 0;
          return (
            <div key={`late-${r.id}`}>
              <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
                <strong style={{ color: "var(--warnfg)" }}>{tx(W.lateLine(r.installmentNo))}</strong>
                <span style={{ fontSize: 12, color: "var(--mut)" }}>{tx(W.lateSeparate)}</span>
              </span>
              <span style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 2 }}>
                <b className="num" style={{ textDecoration: waived ? "line-through" : "none", color: "var(--warnfg)" }}>{rupees(r.lateFeeRaw || r.lateFeePending)}</b>
                <Pill tone={waived ? "mut" : paid ? "ok" : "warn"}>{tx(waived ? W.lateWaived : paid ? W.latePaid : W.latePending)}</Pill>
              </span>
            </div>
          );
        })}
      </div>
      {student.plan ? (
        <span style={{ fontSize: 12, color: "var(--mut)" }}>
          <b>{tx(W.feePlan)}:</b>{" "}
          {tx(W.planLine(rupees(student.plan.tuition), student.plan.transport ? rupees(student.plan.transport) : null, rupees(student.plan.academic), student.plan.installments))}
        </span>
      ) : null}
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <h3 className="sech">{tx(W.paidThisSession)}</h3>
        {student.receipts.length === 0 ? (
          <span style={{ fontSize: 13, color: "var(--mut)" }}>{tx(W.noPayment)}</span>
        ) : (
          student.receipts.slice(0, 8).map((h) => (
            <div key={h.id} style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 13 }}>
              <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
                <span className="num clip" style={{ fontWeight: 600, textDecoration: h.isReversed ? "line-through" : "none" }}>{h.receiptNumber} · {dayMonth(h.paymentDate)}</span>
                <span style={{ color: "var(--mut)" }}>{MODE_TEXT[h.mode] ?? h.mode}</span>
              </span>
              {h.isReversed ? <Pill tone="bad">{tx(W.removed)}</Pill> : null}
              <b className="num">{rupees(h.amount)}</b>
            </div>
          ))
        )}
      </div>
    </Card>
  );
}

function walkPill(line: WalkLine): ["ok" | "info" | "acc" | "mut", Pair] {
  if (line.state === "cleared") return ["ok", W.wCleared];
  if (line.state === "part") return ["info", W.wPart];
  if (line.state === "ahead") return ["acc", W.wAhead];
  return ["mut", W.wUntouched];
}

function WherePreview({ walk, amount, paymentDate, today }: { walk: ReturnType<typeof walkPayment>; amount: number; paymentDate: string; today: string }) {
  const { tx } = useVx();
  return (
    <Card style={{ display: "flex", flexDirection: "column", gap: 10 }} aria-live="polite">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10 }}>
        <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>{tx(W.whereGoes)}</h2>
        <strong className="num" style={{ color: "var(--acc)", fontSize: 17 }}>{rupees(amount)}</strong>
      </div>
      <span style={{ fontSize: 12, color: "var(--mut)" }}>{tx(W.oldestFirst)}</span>
      {!amount ? <span style={{ fontSize: 13, color: "var(--mut)" }}>{tx(W.typeToSee)}</span> : null}
      <div className="pd-walk">
        {walk.lines.map((l, i) => {
          const pill = walkPill(l);
          const paid = l.feesPaid + l.lateFeePaid;
          const left = l.feesAfter + l.lateFeeAfter;
          const pct = l.before ? Math.round((paid / l.before) * 100) : 100;
          return (
            <div key={l.row.id} style={{ opacity: paid || !amount ? 1 : 0.6, animation: `xIn .3s var(--ease) ${i * 40}ms both` }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "flex-start" }}>
                <span style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
                  <strong>{rowLabel(l.row, tx)}</strong>
                  <span style={{ fontSize: 12, color: "var(--mut)" }}>
                    {l.row.isCarryForward ? tx(W.unpaidLastSession) : isOverdueOn(l.row, paymentDate) ? tx(W.overdueSince(dayMonth(l.row.dueDate))) : tx(W.due(dayMonth(l.row.dueDate)))}
                  </span>
                </span>
                {amount ? <Pill tone={pill[0]}>{tx(pill[1])}</Pill> : null}
              </div>
              <div className="pd-bar" aria-hidden="true">
                <i key={`${amount}`} style={{ width: `${pct}%`, background: l.state === "ahead" ? "var(--acc)" : "var(--ok)" }} />
              </div>
              <span className="num" style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, flexWrap: "wrap" }}>
                {rupees(l.before)} <Ic n="arrowRight" size={13} /> <b>{tx(W.pay(rupees(paid)))}</b> <Ic n="arrowRight" size={13} /> {tx(W.left(rupees(left)))}
              </span>
              {l.lateFeeDropped ? <span style={{ fontSize: 12, color: "var(--ok)", fontWeight: 600 }}>{tx(W.lateDropped)}</span> : null}
              {l.lateFeeWaived ? <span style={{ fontSize: 12, color: "var(--mut)", fontWeight: 600 }}>{tx(W.lateWaivedLine)}</span> : null}
              {l.lateFeePaid > 0 ? <span style={{ fontSize: 12, color: "var(--warnfg)" }}>{tx(W.lateFee)} {rupees(l.lateFeePaid)}</span> : null}
            </div>
          );
        })}
      </div>
      {walk.credit > 0 ? <Banner tone="info">{tx(W.credit(rupees(walk.credit)))}</Banner> : null}
      {walk.alreadyPaid.length ? <span style={{ fontSize: 12, color: "var(--mut)" }}>{tx(W.alreadyPaid(walk.alreadyPaid.join(", ")))}</span> : null}
      <div className="pd-after">
        <span className="sech">{tx(W.afterThis)}</span>
        <div><span>{tx(W.feesPendingToday)}</span><b className="num" style={{ color: walk.after.pendingToday ? "var(--bad)" : "var(--ok)" }}>{rupees(walk.after.pendingToday)}</b></div>
        {walk.after.dueToday ? <div><span>{tx(W.dueToday)}</span><b className="num" style={{ color: "var(--warnfg)" }}>{rupees(walk.after.dueToday)}</b></div> : null}
        <div><span>{tx(W.notDueYet)}</span><b className="num">{rupees(walk.after.notDueYet)}</b></div>
        <div><span>{tx(W.lateFee)}</span><b className="num" style={{ color: walk.after.lateFee ? "var(--warnfg)" : "var(--ok)" }}>{rupees(walk.after.lateFee)}</b></div>
      </div>
      {paymentDate !== today ? <span style={{ fontSize: 12, color: "var(--mut)" }}>{shortDay(paymentDate)}{tx(W.lateWorkedOut)}</span> : null}
    </Card>
  );
}

function ConfirmBody({
  student,
  amount,
  modeText,
  reference,
  paymentDate,
  walk,
  receivedBy,
  concession,
  notes,
}: {
  student: DeskStudent;
  amount: number;
  modeText: string;
  reference: string;
  paymentDate: string;
  walk: ReturnType<typeof walkPayment>;
  receivedBy: string;
  concession: number;
  notes: string;
}) {
  const { tx } = useVx();
  const kv: [Pair, string][] = [
    [W.student, `${student.name} · ${student.classLabel} · SR ${student.sr}`],
    [W.mode, `${modeText}${reference ? ` · ${reference}` : ""}`],
    [W.paidOn, dateLabel(paymentDate)],
    [W.collector, receivedBy],
    ...(concession > 0 ? ([[W.concession, rupees(concession)]] as [Pair, string][]) : []),
    ...(notes.trim() ? ([[W.notes, notes]] as [Pair, string][]) : []),
    ...(walk.waiverAmount > 0 ? ([[W.lateWaiverLine, rupees(walk.waiverAmount)]] as [Pair, string][]) : []),
  ];
  const lines = walk.lines.filter((l) => l.feesPaid + l.lateFeePaid > 0 || l.discountApplied || l.lateFeeWaived || l.lateFeeDropped);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 2, padding: "6px 0" }}>
        <span style={{ fontSize: 12, color: "var(--mut)", fontWeight: 700 }}>{tx(W.amount)}</span>
        <strong className="num" style={{ fontSize: 36 }}>{rupees(amount)}</strong>
        <em style={{ fontSize: 13, color: "var(--mut)" }}>{amountInWords(amount)}</em>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {kv.map(([k, v]) => (
          <div key={k.en} style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
            <span style={{ color: "var(--mut)" }}>{tx(k)}</span>
            <strong style={{ textAlign: "right" }}>{v}</strong>
          </div>
        ))}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6, borderTop: "1px solid var(--bd)", paddingTop: 10 }}>
        <span className="sech">{tx(W.whereItGoes)}</span>
        {lines.map((l) => (
          <div key={l.row.id} style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
            <span style={{ display: "flex", flexDirection: "column" }}>
              <span>{rowLabel(l.row, tx)}</span>
              <span style={{ fontSize: 12, color: "var(--mut)" }}>
                {tx(walkPill(l)[1])}
                {l.lateFeePaid ? ` · ${tx(W.lateFee)} ${rupees(l.lateFeePaid)}` : ""}
                {l.discountApplied ? ` · ${tx(W.concession)} ${rupees(l.discountApplied)}` : ""}
                {l.lateFeeWaived ? ` · ${tx(W.lateWaivedLine)}` : ""}
                {l.lateFeeDropped ? ` · ${tx(W.lateDropped)}` : ""}
              </span>
            </span>
            <b className="num">{rupees(l.feesPaid + l.lateFeePaid)}</b>
          </div>
        ))}
        {walk.credit > 0 ? <span style={{ fontSize: 13, color: "var(--info)" }}>{tx(W.credit(rupees(walk.credit)))}</span> : null}
      </div>
      <div className="pd-after">
        <span className="sech">{tx(W.balanceAfter)}</span>
        <div><span>{tx(W.feesPendingToday)}</span><b className="num">{rupees(walk.after.pendingToday)}</b></div>
        {walk.after.dueToday ? <div><span>{tx(W.dueToday)}</span><b className="num">{rupees(walk.after.dueToday)}</b></div> : null}
        <div><span>{tx(W.notDueYet)}</span><b className="num">{rupees(walk.after.notDueYet)}</b></div>
        <div><span>{tx(W.lateFeeSep)}</span><b className="num">{rupees(walk.after.lateFee)}</b></div>
        <div style={{ borderTop: "1px solid var(--bd)", paddingTop: 6 }}><span>{tx(W.remainingYear)}</span><b className="num">{rupees(walk.after.pendingToday + walk.after.dueToday + walk.after.notDueYet + walk.after.lateFee)}</b></div>
      </div>
    </div>
  );
}

function SavedPanel({
  saved,
  student,
  removable,
  canRemove,
  canAct,
  onWa,
  onNew,
  onAnother,
  onRetryReceipt,
  busy,
  onRemove,
  onSibling,
}: {
  saved: Saved;
  student: DeskStudent;
  removable: boolean;
  canRemove: boolean;
  canAct: boolean;
  onWa: () => void;
  onNew: () => void;
  onAnother: () => void;
  onRetryReceipt: () => void;
  busy: boolean;
  onRemove: () => void;
  onSibling: (id: string) => void;
}) {
  const { tx } = useVx();
  const r = saved.receipt;
  const time = r?.createdAt ? clock(r.createdAt) : saved.savedAtMs ? clock(new Date(saved.savedAtMs)) : "";
  const until = saved.savedAtMs ? clock(new Date(saved.savedAtMs + REMOVE_WINDOW_MS)) : "";
  const gone = saved.removed;
  const title = gone ? tx(W.entryRemoved) : saved.fresh ? tx(W.saved) : tx(W.savedEarlier(time));
  const lock = gone ? tx(W.lockedGone) : saved.fresh ? tx(W.lockedFresh) : tx(W.lockedOld(time));
  const sib = student.siblings[0];
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <Card className="rise" style={{ display: "flex", alignItems: "center", gap: 16, borderColor: gone ? "var(--bad)" : saved.fresh ? "var(--okm)" : "var(--bd)" }}>
        {gone ? (
          <span style={{ width: 64, height: 64, borderRadius: 32, background: "var(--bads)", color: "var(--bad)", display: "flex", alignItems: "center", justifyContent: "center", flex: "none" }}><Ic n="trash" size={28} /></span>
        ) : saved.fresh ? (
          <SuccessTick size={64} />
        ) : (
          <span style={{ width: 64, height: 64, borderRadius: 32, background: "var(--infos)", color: "var(--info)", display: "flex", alignItems: "center", justifyContent: "center", flex: "none" }}><Ic n="info" size={28} /></span>
        )}
        <span style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
          <strong className="serif" style={{ fontSize: 26, fontWeight: 600 }}>{title}</strong>
          <span className="num" style={{ color: "var(--mut)" }}>
            {rupees(r?.total ?? saved.amount)} · {student.name} · {saved.receiptNumber}{time ? ` · ${time}` : ""}
          </span>
          <span style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, color: "var(--mut)" }}>
            <Ic n="lock" size={14} /> {lock}
          </span>
        </span>
      </Card>
      <div className="pd-saved">
        {r ? (
          saved.fresh ? <div style={{ minWidth: 0 }}>
            <MobilePrintedReceipt receiptNumber={r.receiptNumber} studentFullName={r.studentName} fatherName={r.father} admissionNo={r.sr} classLabel={r.classLabel} amountReceived={r.total} lines={r.lines} paymentDate={dateLabel(r.paymentDate)} paymentModeLabel={MODE_TEXT[r.mode] ?? r.mode} referenceNumber={r.reference ?? undefined} receivedBy={r.receivedBy ?? "—"} remainingBalance={r.outstandingAfter} isVoided={gone} countUpTotal />
            <details><summary className="tap" style={{ padding: 12 }}>{tx(W.receiptDetails)}</summary><ReceiptCard receipt={r} balance={saved.balance} frozenAt={time} removed={gone} /></details>
          </div> : <ReceiptCard receipt={r} balance={saved.balance} frozenAt={time} removed={gone} />
        ) : (
          <Card style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <Banner tone="info">{tx(W.receiptPending(saved.receiptNumber))}</Banner>
            <Btn variant="sec" icon="refresh" disabled={busy} onClick={onRetryReceipt}>{tx(W.showReceipt)}</Btn>
          </Card>
        )}
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {!gone ? (
            <>
              <Btn variant="sec" icon="send" full onClick={onWa} disabled={!canAct}>
                {tx(saved.sent ? W.sendWaAgain : W.sendWa)}
              </Btn>
              <span style={{ fontSize: 12, color: "var(--mut)", textAlign: "center" }}>
                {student.phone ? tx(W.waTo(student.father ?? student.name, maskPhone(student.phone))) : tx(W.noPhone)}
              </span>
            </>
          ) : null}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <Btn variant="pri" icon="printer" href={`/receipts/${encodeURIComponent(saved.receiptNumber)}`}>{tx(W.print)}</Btn>
            <Btn variant="sec" icon="download" href={`/fees/receipts/${saved.receiptId}/pdf`} target="_blank" prefetch={false}>{tx(W.pdf)}</Btn>
          </div>
          <Btn variant="pri" icon="search" full onClick={onAnother}>{tx(W.collectAnother)}</Btn>
          <Btn variant="sec" icon="plus" full onClick={onNew}>{tx(W.newPayment)}</Btn>
          {sib ? (
            <Btn variant="soft" full onClick={() => onSibling(sib.id)}>
              {sib.name} <Ic n="arrowRight" size={16} />
            </Btn>
          ) : null}
          {removable ? (
            <Btn variant="ghost" icon="undo" full onClick={onRemove} style={{ color: "var(--bad)" }} disabled={!canAct}>
              {tx(W.removeTill(until))}
            </Btn>
          ) : null}
          {!saved.fresh || gone ? (
            <Btn variant="ghost" icon="receipt" full href={`/receipts/${encodeURIComponent(saved.receiptNumber)}`}>{tx(W.openInReceipts)}</Btn>
          ) : null}
          <Card style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <h3 className="sech">{tx(W.whoDidWhat)}</h3>
            {saved.log.map((l, i) => (
              <div key={`${l.text}-${i}`} style={{ display: "flex", gap: 8, alignItems: "baseline", fontSize: 13 }}>
                <span style={{ width: 8, height: 8, borderRadius: 4, background: l.tone, flex: "none" }} />
                <span style={{ flex: 1 }}>{l.text}</span>
                <span className="num" style={{ color: "var(--mut)" }}>{l.time}</span>
              </div>
            ))}
            {saved.fresh && !gone && !canRemove ? (
              <div style={{ display: "flex", gap: 8, alignItems: "baseline", fontSize: 13 }}>
                <span style={{ width: 8, height: 8, borderRadius: 4, background: "var(--sub)", flex: "none" }} />
                <span style={{ flex: 1 }}>{tx(W.onlyAdminRemoves)}</span>
              </div>
            ) : null}
          </Card>
        </div>
      </div>
    </div>
  );
}
