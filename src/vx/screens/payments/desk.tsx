"use client";

import "./paydesk.css";

import Link from "next/link";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";

import {
  checkDeskPaymentAction,
  loadReceiptAction,
  loadStudentDeskAction,
  loadDeskPreviewAction,
  postDeskPaymentAction,
  removePaymentAction,
  sendReceiptWhatsappAction,
  settleDeskSaveAction,
  deskDayStateAction,
  type DeskPostInput,
} from "@/app/(app)/payments/actions";
import {
  COUNTER_CONCESSION,
  deskChips,
  deskProblems,
  deskTotals,
  findRecentDuplicate,
  hasPaise,
  isDueOn,
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
  type DeskProblem,
  type WalkLine,
} from "@/modules/payments/vx/domain/desk";
import type { DeskBoot, DeskCheckResult, DeskReceipt, DeskSaveResult, DeskStudent, DeskStudentResult } from "@/modules/payments/vx/types";
import { buildPaymentQuickAmounts } from "@/modules/payments/domain/workflow";
import { clearPaymentAttempt, paymentAttemptKey, restorePaymentAttempt, writePaymentAttempt, PaymentAttemptConflict, PaymentRecoveryUnavailable, type PaymentAttempt } from "@/modules/payments/vx/attempt";
import type { DeskLedgerRow } from "@/modules/payments/vx/domain/desk";
import { daysBetween, dayMonth, initials, rupees } from "@/vx/format";
import { useVx } from "@/vx/i18n";
import { Ic, type IconName } from "@/vx/icons";
import type { Pair } from "@/vx/text";
import { Chip, Input, Seg } from "@/vx/ui/controls";
import { BackLink } from "@/vx/ui/back-link";
import { Sheet, useToast } from "@/vx/ui/overlays";
import { Banner, TopBar, VxPage } from "@/vx/ui/page";
import { Btn, Pill, Skel, WhatsAppPreview } from "@/vx/ui/primitives";

import { ampm, dueDay, oldBalanceLabel, sessionDash, shortDate, wordsOf } from "./look";
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
  /** Posted and answered; the receipt and the balance are still being read (accountant B2). */
  settling?: boolean;
};

type Dup = {
  kind: "near-duplicate" | "daily-amount" | "client";
  receiptId: string | null;
  receiptNumber: string | null;
  createdAt: string | null;
  amount: number | null;
  mode: string | null;
};

/**
 * The server actions the desk calls. The page never passes this; the design
 * fidelity fixture passes synthetic answers so every state of the approved
 * design can be drawn without a database.
 */
const SERVER = {
  checkDeskPaymentAction,
  loadReceiptAction,
  loadStudentDeskAction,
  loadDeskPreviewAction,
  postDeskPaymentAction,
  removePaymentAction,
  sendReceiptWhatsappAction,
  settleDeskSaveAction,
  deskDayStateAction,
};
type OptionalActions = "settleDeskSaveAction" | "deskDayStateAction";
/** The settle and day-state calls are optional, so a fixture need not supply them. */
export type DeskActions = Omit<typeof SERVER, OptionalActions> & Partial<Pick<typeof SERVER, OptionalActions>>;

const MODE_PAIR: Record<DeskMode, Pair> = { cash: W.modeCash, upi: W.modeUpi, bank_transfer: W.modeBank, cheque: W.modeCheque };
const MODE_ICON: Record<DeskMode, IconName> = { cash: "rupee", upi: "zap", bank_transfer: "bank", cheque: "file" };
const MODE_TEXT: Record<string, string> = { cash: "Cash", upi: "UPI", bank_transfer: "Bank transfer", cheque: "Cheque" };
const REMOVE_WINDOW_MS = 10 * 60_000;
/** The design's avatar tones, cycled down the class list. */
const TONES: [string, string][] = [["var(--accs)", "var(--accfg)"], ["var(--infos)", "var(--info)"], ["var(--oks)", "var(--ok)"], ["var(--warns)", "var(--warnfg)"], ["var(--s3)", "var(--fg)"]];

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

function recoveredForm(boot: DeskBoot, pending: PaymentAttempt): Form {
  return { ...freshForm(boot), ...pending.form, dateMode: pending.input.paymentDate === boot.today ? "today" : "other", otherDate: pending.input.paymentDate } as Form;
}

function earlierReceipt(receipt: DeskReceipt | null): Saved | null {
  return receipt ? { receiptId: receipt.id, receiptNumber: receipt.receiptNumber, receipt, balance: null, amount: receipt.total, fresh: false, savedAtMs: 0, removed: receipt.isReversed, sent: false, log: [] } : null;
}

function problemText(problem: DeskProblem | undefined, tx: (p: Pair | string) => string, sessionStart: string): string | null {
  if (!problem) return null;
  switch (problem.key) {
    case "nothing-owed":
      return tx(W.nothingOwed);
    case "amount":
      return tx(W.errAmount);
    case "over":
      return tx(W.overMax(rupees(problem.max)));
    case "date-invalid":
      return tx(W.errDateInvalid);
    case "date-future":
      return tx(W.errDateFuture);
    case "date-before-session":
      return tx(W.errDateBefore(shortDate(sessionStart)));
    case "waive-reason":
      return tx(W.pickReason);
    default:
      return tx(W.fix);
  }
}

export function PaymentDesk({
  boot,
  previewing,
  initialStudentId,
  initialStudent,
  initialReceipt,
  actions,
}: {
  boot: DeskBoot;
  previewing: boolean;
  initialStudentId: string | null;
  initialStudent: DeskStudentResult | null;
  initialReceipt: DeskReceipt | null;
  /** Synthetic answers for the design fixture; production omits it. */
  actions?: Partial<DeskActions>;
}) {
  const { tx } = useVx();
  const toast = useToast();
  const api = useMemo(() => ({ ...SERVER, ...actions }), [actions]);
  const listed = boot.students.find((s) => s.id === initialStudentId);
  const firstClass = boot.classes.find((c) => boot.students.some((s) => s.classId === c.id))?.id ?? boot.classes[0]?.id ?? "";

  const [classId, setClassId] = useState(listed?.classId ?? firstClass);
  const [query, setQuery] = useState("");
  const [selId, setSelId] = useState<string | null>(initialStudentId);
  const [result, setResult] = useState<DeskStudentResult | null>(initialStudent);
  const [loading, setLoading] = useState(false);
  // The amount box starts empty: the cashier types what the parent paid
  // (RULES B; the design's student state shows ₹0 and "Type what the parent gave").
  const [form, setForm] = useState<Form>(() => freshForm(boot));
  const [tried, setTried] = useState(false);
  const [sheet, setSheet] = useState<"" | "dup" | "wa" | "rm">("");
  // Review is its own step (the design's confirm sheet): nothing is saved
  // until "Save payment", and Change keeps every entry.
  const [reviewing, setReviewing] = useState(false);
  // On a phone the form is three steps — dues, amount, date & save — so no
  // step needs scrolling (UI-95). A desk shows all three side by side and
  // never reads this.
  const [step, setStep] = useState<1 | 2 | 3>(1);
  // A save whose answer never arrived. Until the desk has asked the database
  // whether it posted, it will not offer to save again.
  const [uncertain, setUncertain] = useState<{ checking: boolean } | null>(null);
  const [saving, setSaving] = useState(false);
  const [ack, setAck] = useState(false);
  const [dup, setDup] = useState<Dup | null>(null);
  const [saved, setSaved] = useState<Saved | null>(() => earlierReceipt(initialReceipt));
  const [expiredAt, setExpiredAt] = useState<number | null>(null);
  const [todayTotals, setTodayTotals] = useState<DeskBoot["todayCollection"] | null>(boot.todayCollection);
  const [rmReason, setRmReason] = useState<string>(W.rmReasons[0].label.en);
  const [rmNote, setRmNote] = useState("");
  const [waLang, setWaLang] = useState<"hi" | "en" | "both">("both");
  const [busy, setBusy] = useState(false);
  const requestId = useRef<string | null>(null);
  const attemptRef = useRef<PaymentAttempt | null>(null);
  const posting = useRef(false);
  const [attempt, setAttempt] = useState<PaymentAttempt | null>(null);
  const [recoveryScope, setRecoveryScope] = useState<string | null>(null);
  const [recoveryError, setRecoveryError] = useState<"locks" | "storage" | null>(null);
  const [recoveryRetry, setRecoveryRetry] = useState(0);
  const attemptKey = boot.me.id ? paymentAttemptKey(boot.me.id, boot.sessionLabel) : null;
  const loadedRecoveryKey = useRef<string | null>(attemptKey);
  const currentRecoveryScope = useRef<string | null>(previewing ? null : attemptKey);
  const recoveryReady = !attemptKey || previewing || recoveryScope === attemptKey;
  const [datePreview, setDatePreview] = useState<{ studentId: string; date: string; rows: DeskLedgerRow[] } | null>(null);
  const [dateError, setDateError] = useState<string | null>(null);
  const [listBalances, setListBalances] = useState<Record<string, { pendingToday: number; lateFee: number }>>({});
  const counted = useRef(new Set<string>());
  const restoredAttempt = useRef(false);
  const loadSeq = useRef(0);

  const student: DeskStudent | null = result && result.ok ? result.student : null;
  const today = boot.today;
  const canAct = boot.canPost && !previewing && recoveryReady && !recoveryError;

  useLayoutEffect(() => { currentRecoveryScope.current = previewing ? null : attemptKey; }, [attemptKey, previewing]);

  useEffect(() => {
    let active = true;
    void (async () => {
      const a = attemptKey && !previewing ? await restorePaymentAttempt(attemptKey, boot.sessionLabel) : null;
      if (!active) return;
      if (loadedRecoveryKey.current !== attemptKey) {
        loadSeq.current += 1;
        setSelId(initialStudentId); setResult(initialStudent);
        setLoading(false); setSaved(earlierReceipt(initialReceipt)); setReviewing(false); setStep(1); setUncertain(null); setAck(false); setSheet("");
        setTodayTotals(boot.todayCollection); setListBalances({}); counted.current.clear();
        setDatePreview(null); setDateError(null); setForm(freshForm(boot));
      }
      loadedRecoveryKey.current = attemptKey;
      attemptRef.current = a; setAttempt(a); requestId.current = a?.input.clientRequestId ?? null; restoredAttempt.current = Boolean(a);
      if (a && a.input.studentId === initialStudentId) {
        setForm(recoveredForm(boot, a)); setReviewing(true); setUncertain({ checking: false });
      }
      setRecoveryError(null); setRecoveryScope(attemptKey);
    })().catch(error => {
      if (active) {
        if (loadedRecoveryKey.current !== attemptKey) {
          loadSeq.current += 1; setLoading(false); setSelId(initialStudentId); setResult(initialStudent);
          attemptRef.current = null; setAttempt(null); requestId.current = null;
          setReviewing(false); setStep(1); setUncertain(null); setSaved(earlierReceipt(initialReceipt)); setForm(freshForm(boot));
          setTodayTotals(boot.todayCollection); setListBalances({}); counted.current.clear();
        }
        loadedRecoveryKey.current = attemptKey;
        setRecoveryError(error instanceof PaymentRecoveryUnavailable ? "locks" : "storage"); setRecoveryScope(attemptKey);
      }
    });
    return () => { active = false; };
  }, [attemptKey, boot, initialStudentId, initialStudent, initialReceipt, previewing, recoveryRetry]);

  function retryRecovery() {
    if (posting.current) return;
    setRecoveryScope(null); setRecoveryError(null); setRecoveryRetry(n => n + 1);
  }

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
  // The counter concession is off (accountant B1, see COUNTER_CONCESSION). It
  // stays a value so the walk and the review sheet read exactly as before.
  const concession = COUNTER_CONCESSION;
  const dateReady = paymentDate === today || (datePreview?.studentId === student?.id && datePreview?.date === paymentDate);
  const dateFailed = dateError === `${student?.id}|${paymentDate}`;
  const rows = useMemo(() => orderForSettlement(datePreview?.studentId === student?.id && datePreview?.date === paymentDate ? datePreview.rows : student?.rows ?? []), [student, datePreview, paymentDate]);
  const loadPreview = api.loadDeskPreviewAction;
  useEffect(() => {
    if (!student || paymentDate === today || !/^\d{4}-\d{2}-\d{2}$/.test(paymentDate)) return;
    let active = true;
    void loadPreview({ studentId: student.id, sessionLabel: boot.sessionLabel, paymentDate }).then(res => {
      if (!active) return;
      if (res.ok) { setDatePreview({ studentId: student.id, date: paymentDate, rows: res.rows }); setDateError(null); }
      else setDateError(`${student.id}|${paymentDate}`);
    }).catch(() => { if (active) setDateError(`${student.id}|${paymentDate}`); });
    return () => { active = false; };
  }, [student, paymentDate, today, boot.sessionLabel, loadPreview]);
  // Is the payment date already closed on Receipts? Warned on the review sheet
  // (accountant B17); posting is still allowed, and Receipts flags it after.
  const [closedDay, setClosedDay] = useState<{ date: string; session: string } | null>(null);
  const dayState = api.deskDayStateAction;
  const studentId = student?.id;
  useEffect(() => {
    if (!studentId || !dayState || !/^\d{4}-\d{2}-\d{2}$/.test(paymentDate)) return;
    let active = true;
    void Promise.resolve()
      .then(() => dayState({ date: paymentDate, sessionLabel: boot.sessionLabel }))
      .then((res) => { if (active) setClosedDay(res?.closed ? { date: paymentDate, session: boot.sessionLabel } : null); })
      .catch(() => undefined);
    return () => { active = false; };
  }, [studentId, paymentDate, boot.sessionLabel, dayState]);
  const dayClosed = closedDay?.date === paymentDate && closedDay.session === boot.sessionLabel;
  const totals = deskTotals(rows, today);
  const waiveAllowed = boot.me.canWaive && Boolean(student) && !student?.onPlan;
  const waiveLate = waiveAllowed && form.late === "waive" && totals.lateFee > 0;
  const walk = walkPayment(rows, Number.isFinite(amount) ? amount : 0, { paymentDate, today, waiveLate, concession: Number.isFinite(concession) ? concession : 0, authoritative: true });
  const cut = Number.isFinite(concession) ? concession : 0;
  const chips: { key: string; label: string; amount: number | null; disabled?: boolean }[] = student?.repaymentPlan
    ? buildPaymentQuickAmounts({ totalPending: walk.maxAmount, nextDueAmount: null, overdueAmount: 0, plan: student.repaymentPlan }).map((c) => ({
        key: c.key,
        label: tx(({ emiCatchUp: W.planCatchUp, emiMonthly: W.planMonthly, emiFullPlan: W.planBalance, full: W.everythingOwed, clear: W.clearAmount } as Record<string, Pair>)[c.key] ?? c.label),
        amount: c.amount,
        disabled: c.disabled,
      }))
    : (() => {
        const seen = new Set<number>();
        return deskChips(rows, today, { waiveLate })
          .map((c) => ({
            key: `${c.kind}-${"installmentNo" in c ? c.installmentNo : ""}`,
            label: `${tx(c.kind === "overdue" ? W.chipOverdue : c.kind === "installment" ? W.chipInstallment(c.installmentNo) : c.kind === "upto" ? W.chipUpto(c.installmentNo) : W.chipYear)}${c.withLate ? tx(W.plusLate) : ""}`,
            amount: Math.max(0, Math.min(walk.maxAmount, c.amount - cut)),
          }))
          .filter((c) => c.amount > 0 && !seen.has(c.amount) && Boolean(seen.add(c.amount)));
      })();
  const lateOn = lateFeesOn(rows, paymentDate);
  const lateNowAmt = lateOn.due.reduce((s, r) => s + r.lateFeePending, 0);
  const problems = deskProblems(
    { amount, paymentDate, mode: form.mode, chequeNo: form.chequeNo, chequeBank: form.chequeBank, waiveLate, waiveReason: form.waiveReason },
    walk,
    { today, sessionStart: boot.sessionStart, lateFeeOwed: totals.lateFee },
  );
  const has = (key: string) => problems.find((p) => p.key === key);
  const show = (key: string) => (tried ? has(key) : undefined);
  const nextDue = rows.find((r) => !isOverdueOn(r, today) && !isDueOn(r, today) && r.feesPending > 0);
  const lateTaken = walk.lines.some((l) => l.lateFeePaid > 0);

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
    if (posting.current || !recoveryReady) return;
    const scope = previewing ? null : attemptKey;
    const seq = ++loadSeq.current;
    setSelId(id);
    setSaved(null);
    setForm(freshForm(boot));
    setTried(false);
    setAck(false);
    setSheet("");
    setReviewing(false);
    setStep(1);
    setDatePreview(null);
    const pending = attemptRef.current;
    setUncertain(pending?.input.studentId === id ? { checking: false } : null);
    if (pending?.input.studentId === id) { setForm(recoveredForm(boot, pending)); setReviewing(true); }
    if (!pending) requestId.current = null;
    setLoading(true);
    syncUrl(id);
    const hit = boot.students.find((s) => s.id === id);
    if (hit) setClassId(hit.classId);
    const res = await api.loadStudentDeskAction({ studentId: id, sessionLabel: boot.sessionLabel }).catch(
      (): DeskStudentResult => ({ ok: false, message: tx(W.couldNotLoad), repairable: false }),
    );
    if (seq !== loadSeq.current) return;
    if (currentRecoveryScope.current !== scope) return;
    setResult(res);
    setLoading(false);
  }

  /** Back to the class list for the next family (the phone's back arrow). */
  function clearStudent() {
    if (posting.current) return;
    loadSeq.current += 1;
    setSelId(null);
    setResult(null);
    setSaved(null);
    setLoading(false);
    setReviewing(false);
    setStep(1);
    setUncertain(null);
    if (!attemptRef.current) requestId.current = null;
    syncUrl(null);
  }

  async function reloadStudent() {
    if (!student || !recoveryReady) return;
    const scope = previewing ? null : attemptKey;
    const res = await api.loadStudentDeskAction({ studentId: student.id, sessionLabel: boot.sessionLabel }).catch(() => null);
    if (currentRecoveryScope.current !== scope) return;
    if (res && res.ok) setResult(res);
  }

  function review() {
    setTried(true);
    if (!student || !canAct || problems.length || !dateReady || !recoveryReady || recoveryError || attempt || !Number.isSafeInteger(concession) || concession < 0 || concession > totals.wholeYear - (waiveLate ? totals.lateFee : 0) || !form.receivedBy.trim()) {
      if (problems.length) toast.show({ text: problemText(problems[0], tx, boot.sessionStart) ?? tx(W.fix), tone: "bad" });
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

  // An unfinished save for this child always reopens on the last step, where its sheet lives.
  const stepLocked = Boolean(attempt && attempt.input.studentId === student?.id);
  const phoneStep: 1 | 2 | 3 = reviewing || stepLocked ? 3 : step;

  /**
   * Move between the phone's steps. Leaving the amount needs an amount the
   * ledger can take (and a reason for a waiver), so step 3 never opens on a
   * problem that only step 2 can fix; the date's own problems stay on step 3.
   */
  function goStep(next: 1 | 2 | 3) {
    if (next === 3 && phoneStep < 3) {
      const own = problems.find((p) => p.key === "nothing-owed" || p.key === "amount" || p.key === "over" || p.key === "waive-reason");
      if (own) {
        setTried(true);
        setStep(2);
        toast.show({ text: problemText(own, tx, boot.sessionStart) ?? tx(W.fix), tone: "bad" });
        return;
      }
    }
    setStep(next);
    try {
      window.scrollTo({ top: 0 });
    } catch {
      // Older browsers: the step still changes, only the scroll stays.
    }
  }

  /** The phone's back arrow: a step back while collecting, else back to the class list. */
  function phoneBack() {
    if (student && !saved && !loading && phoneStep > 1 && !stepLocked && !reviewing) goStep((phoneStep - 1) as 1 | 2);
    else clearStudent();
  }

  function applySaved(res: Extract<DeskSaveResult, { status: "saved" }>, postedAmount: number) {
    const postedDate = attemptRef.current?.input.paymentDate;
    const studentId = attemptRef.current?.input.studentId ?? res.student?.id;
    if (studentId && res.balanceAfter) setListBalances(b => ({ ...b, [studentId]: { pendingToday: res.balanceAfter!.pendingToday, lateFee: res.balanceAfter!.lateFee } }));
    setDatePreview(null);
    if (attemptKey && attemptRef.current) void clearPaymentAttempt(attemptKey, attemptRef.current.input.clientRequestId).catch(() => undefined);
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
      log: [{ text: tx(W.savedBy(boot.me.name)), time: ampm(res.receipt?.createdAt ?? at), tone: "var(--acc)" }],
      settling: Boolean(res.settling),
    });
    if (res.student) setResult({ ok: true, student: res.student });
    setSheet("");
    setReviewing(false);
    setUncertain(null);
    setAck(false);
    if (res.todayCollection !== undefined) setTodayTotals(res.todayCollection);
    else if (postedDate === today && !restoredAttempt.current && !counted.current.has(res.receiptId)) {
      counted.current.add(res.receiptId);
      setTodayTotals((t) => t ? ({ count: t.count + 1, amount: t.amount + total }) : null);
    }
    restoredAttempt.current = false;
    toast.show({ text: tx(W.savedToast(res.receiptNumber, rupees(total))) });
    if (res.settling && studentId) void settle({ receiptId: res.receiptId, receiptNumber: res.receiptNumber, studentId, sessionLabel: boot.sessionLabel });
  }

  /**
   * The receipt number is on screen; now read the receipt and the balance,
   * which wait for the balance views to catch up (accountant B2, D-271).
   * Nothing here can undo the save: a failure only leaves "Show the receipt".
   */
  async function settle(input: { receiptId: string; receiptNumber: string; studentId: string; sessionLabel: string }) {
    const call = api.settleDeskSaveAction;
    const res = call ? ((await Promise.resolve().then(() => call(input)).catch(() => null)) ?? null) : null;
    setSaved((cur) => (cur && cur.receiptId === input.receiptId
      ? { ...cur, settling: false, receipt: res?.receipt ?? cur.receipt, balance: res?.balanceAfter ?? cur.balance, amount: res?.receipt?.total ?? cur.amount }
      : cur));
    if (!res) return;
    const balance = res.balanceAfter;
    if (balance) setListBalances(b => ({ ...b, [input.studentId]: { pendingToday: balance.pendingToday, lateFee: balance.lateFee } }));
    const fresh = res.student;
    if (fresh) setResult((cur) => (cur && cur.ok && cur.student.id === input.studentId ? { ok: true, student: fresh } : cur));
    if (res.todayCollection !== undefined) setTodayTotals(res.todayCollection);
  }

  /** Ask the database whether the save with this request id posted. */
  async function checkSaved() {
    const pending = attemptRef.current;
    if (!pending || !canAct || posting.current || !recoveryReady || recoveryError || !attemptKey) return;
    const scope = attemptKey;
    posting.current = true;
    const postedAmount = pending.input.amount;
    setUncertain({ checking: true });
    const res: DeskCheckResult = await api.checkDeskPaymentAction({ studentId: pending.input.studentId, clientRequestId: pending.input.clientRequestId, sessionLabel: pending.input.sessionLabel }).catch(
      (error: unknown): DeskCheckResult => ({ status: "unknown", message: error instanceof Error ? error.message : tx(W.uncertainTitle) }),
    );
    posting.current = false;
    if (currentRecoveryScope.current !== scope) return;
    if (res.status === "saved") {
      if (selId !== pending.input.studentId) await selectStudent(pending.input.studentId);
      if (currentRecoveryScope.current !== scope) return;
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
    const scope = attemptKey;
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
    catch (error) {
      posting.current = false; setSaving(false);
      if (currentRecoveryScope.current !== scope) return;
      if (error instanceof PaymentAttemptConflict) {
        attemptRef.current = error.attempt; setAttempt(error.attempt); requestId.current = error.attempt.input.clientRequestId;
        setReviewing(false);
        if (error.attempt.input.studentId === student.id) { setForm(recoveredForm(boot, error.attempt)); setReviewing(true); setUncertain({ checking: false }); }
        toast.show({ text: tx(W.otherTabAttempt), tone: "bad", ms: 8000 });
      } else {
        setRecoveryError(error instanceof PaymentRecoveryUnavailable ? "locks" : "storage");
        toast.show({ text: tx(W.storageBlocked), tone: "bad", ms: 8000 });
      }
      return;
    }
    if (currentRecoveryScope.current !== scope) { posting.current = false; setSaving(false); return; }
    attemptRef.current = pending; setAttempt(pending);
    const postedAmount = input.amount;
    const res = await api.postDeskPaymentAction(input).catch((): DeskSaveResult => ({ status: "uncertain", message: tx(W.uncertainTitle) }));
    posting.current = false;
    setSaving(false);
    if (currentRecoveryScope.current !== scope) return;

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
      await clearPaymentAttempt(attemptKey, input.clientRequestId).catch(() => undefined);
      if (currentRecoveryScope.current !== scope) return;
      attemptRef.current = null; setAttempt(null); requestId.current = null;
    }
    toast.show({ text: res.message || tx(W.notSaved), tone: "bad", ms: 8000 });
  }

  async function openEarlier() {
    if (!dup?.receiptId || !canAct) return;
    const scope = attemptKey;
    setBusy(true);
    const receipt = await api.loadReceiptAction(dup.receiptId).catch(() => null);
    setBusy(false);
    if (currentRecoveryScope.current !== scope) return;
    setSheet("");
    if (!receipt) {
      toast.show({ text: tx(W.couldNotLoad), tone: "bad" });
      return;
    }
    if (attemptRef.current?.input.lateFeeWaiver) {
      await reloadStudent();
      if (currentRecoveryScope.current !== scope) return;
      setUncertain({ checking: false }); setReviewing(true);
      toast.show({ text: tx(W.waiverAttemptPending), tone: "bad", ms: 8000 });
      return;
    }
    if (attemptKey && attemptRef.current) await clearPaymentAttempt(attemptKey, attemptRef.current.input.clientRequestId).catch(() => undefined);
    if (currentRecoveryScope.current !== scope) return;
    attemptRef.current = null; setAttempt(null); requestId.current = null; setUncertain(null); setReviewing(false);
    setSaved({ receiptId: receipt.id, receiptNumber: receipt.receiptNumber, receipt, balance: null, amount: receipt.total, fresh: false, savedAtMs: 0, removed: receipt.isReversed, sent: false, log: [] });
  }

  function newPayment() {
    if (attemptRef.current || posting.current) return;
    setSaved(null);
    setForm(freshForm(boot));
    setTried(false);
    setAck(false);
    setReviewing(false);
    setStep(1);
    setUncertain(null);
    requestId.current = null;
  }

  async function retryReceipt() {
    if (!saved || busy || !recoveryReady) return;
    const scope = previewing ? null : attemptKey;
    setBusy(true);
    const receipt = await api.loadReceiptAction(saved.receiptId).catch(() => null);
    setBusy(false);
    if (currentRecoveryScope.current !== scope) return;
    if (!receipt) {
      toast.show({ text: tx(W.couldNotLoad), tone: "bad" });
      return;
    }
    setSaved((cur) => (cur ? { ...cur, receipt, amount: receipt.total } : cur));
  }

  async function remove() {
    if (!saved || !student || busy || !canAct || !boot.me.canRemove) return;
    const scope = attemptKey;
    setBusy(true);
    const reason = [rmReason, rmNote.trim()].filter(Boolean).join(" — ");
    const res = await api.removePaymentAction({ receiptId: saved.receiptId, studentId: student.id, sessionLabel: boot.sessionLabel, reason }).catch(
      (error: unknown) => ({ ok: false, message: error instanceof Error ? error.message : "Not removed." }),
    );
    setBusy(false);
    if (currentRecoveryScope.current !== scope) return;
    if (!res.ok) {
      toast.show({ text: res.message, tone: "bad", ms: 8000 });
      return;
    }
    const at = new Date().toISOString();
    const total = saved.receipt?.total ?? 0;
    setSaved((s) => (s ? { ...s, removed: true, log: [...s.log, { text: tx(W.removedBy(boot.me.name)), time: ampm(at), tone: "var(--bad)" }] } : s));
    if (saved.receipt?.paymentDate === today) setTodayTotals((t) => t ? ({ count: Math.max(0, t.count - 1), amount: Math.max(0, t.amount - total) }) : null);
    setSheet("");
    setRmNote("");
    toast.show({ text: tx(W.rmDone(saved.receiptNumber)) });
    await reloadStudent();
  }

  async function sendWa() {
    if (!saved || busy || !canAct) return;
    const scope = attemptKey;
    setBusy(true);
    const res = await api.sendReceiptWhatsappAction(saved.receiptId).catch((error: unknown) => ({ ok: false, message: error instanceof Error ? error.message : "Not sent." }));
    setBusy(false);
    if (currentRecoveryScope.current !== scope) return;
    if (!res.ok) {
      toast.show({ text: res.message, tone: "bad", ms: 8000 });
      return;
    }
    const at = new Date().toISOString();
    setSaved((s) => (s ? { ...s, sent: true, log: [...s.log, { text: tx(W.waSentLog), time: ampm(at), tone: "var(--ok)" }] } : s));
    setSheet("");
    toast.show({ text: tx(W.waSent) });
  }

  /* ---------- pieces ---------- */
  const crumb = `${tx(W.money)} · ${tx(W.session)} ${sessionDash(boot.sessionLabel)} · ${shortDate(today)}`;
  const todayLine = todayTotals ? (
    <>
      {tx(W.todayPill)}: <b className="num">{rupees(todayTotals.amount)}</b> · {tx(W.receiptsN(todayTotals.count))}
    </>
  ) : (
    tx(W.collectionUnavailable)
  );
  const todayPill = (
    <Link href="/receipts" className="tap pd-today">
      <span className="pd-dot" />
      <span>{todayLine}</span>
      <Ic n="chevRight" size={16} />
    </Link>
  );
  // Only for those who can use it: a full-size "Enter many payments · Admin
  // only" button sat in the accountant's top bar (accountant UI).
  const manyBtn = boot.me.canBulk ? (
    <Link href="/payments/bulk" className="tap btn sec">
      <Ic n="table" /> {tx(W.many)}
    </Link>
  ) : null;

  const listMaxH = selId ? 292 : undefined;
  const findPane = (
    <div className={`pd-find${selId ? " hide-m" : ""}`}>
      <Link href="/receipts" className="only-m tap card pd-f" style={{ padding: "12px 14px", gap: 10 }}>
        <span className="pd-dot" />
        <span className="pd-b" style={{ flex: 1, minWidth: 0 }}>{todayLine}</span>
        <span className="pd-m">{tx(W.receiptsLink)}</span>
        <Ic n="chevRight" size={16} />
      </Link>
      <label className="pd-sr">
        <Ic n="search" />
        <span className="sr">{tx(W.searchLabel)}</span>
        <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={tx(W.search)} autoComplete="off" />
        {query ? (
          <button type="button" className="tap btn ghost" aria-label={tx(W.clearSearch)} onClick={() => setQuery("")} style={{ width: 36, height: 36, padding: 0 }}>
            <Ic n="x" />
          </button>
        ) : null}
      </label>
      {!searching ? (
        <div className="pd-c" style={{ gap: 8 }}>
          <span className="pd-f pd-j">
            <span className="sech">{tx(W.pickClass)}</span>
            <span className="pd-m">{tx(W.nClasses(boot.classes.length))}</span>
          </span>
          <div className="pd-cls" role="group" aria-label={tx(W.pickClass)}>
            {boot.classes.map((c) => (
              <button key={c.id} type="button" aria-pressed={c.id === classId} aria-label={c.label} className={`tap${c.id === classId ? " on" : ""}`} title={c.label} onClick={() => setClassId(c.id)}>
                {c.short}
              </button>
            ))}
          </div>
        </div>
      ) : null}
      <div className="card" style={{ overflow: "hidden" }}>
        <div className="pd-f pd-j" style={{ padding: "12px 14px 10px" }}>
          <span className="pd-v">{searching ? tx(W.matches) : className}</span>
          <span className="pd-m">{searching ? tx(W.results(listRows.length)) : tx(W.nStudents(listRows.length))}</span>
        </div>
        {listRows.length === 0 ? (
          <div className="pd-c fadein" style={{ alignItems: "center", textAlign: "center", gap: 6, padding: "24px 16px" }}>
            <span className="pd-b">{tx(W.noneFound)}</span>
            <span className="pd-m">{tx(W.noneFoundBody)}</span>
            {searching ? <button type="button" className="tap btn sec" onClick={() => setQuery("")}>{tx(W.clearSearch)}</button> : null}
          </div>
        ) : (
          <div className="pd-list scroll" style={{ maxHeight: listMaxH }}>
            {listRows.map((s, i) => {
              const tone = TONES[i % TONES.length];
              return (
                <button
                  key={s.id}
                  type="button"
                  className={`pd-row row tap${s.id === selId ? " sel" : ""}`}
                  disabled={!recoveryReady || saving || Boolean(uncertain?.checking)}
                  aria-current={s.id === selId ? "true" : undefined}
                  onClick={() => selectStudent(s.id)}
                  style={{ animationDelay: `${Math.min(i, 12) * 32}ms` }}
                >
                  <span className="pd-av" style={{ borderRadius: 20, background: tone[0], color: tone[1] }}>{initials(s.name)}</span>
                  <span className="pd-c" style={{ flex: 1 }}>
                    <span className="pd-b pd-e">{s.name}</span>
                    <span className="pd-m pd-e">{searching ? `${s.classLabel} · ` : ""}SR {s.sr}{s.father ? ` · ${s.father}` : ""}</span>
                  </span>
                  <span className="pd-end" style={{ gap: 0 }}>
                    <span className="num pd-v" style={{ color: s.pendingToday > 0 ? "var(--warnfg)" : "var(--ok)" }}>{s.pendingToday > 0 ? rupees(s.pendingToday) : tx(W.paidUp)}</span>
                    <span className="pd-m">
                      {s.pendingToday > 0 ? (s.lateFee > 0 ? tx(W.pendingPlusLate(rupees(s.lateFee))) : tx(W.pendingToday)) : s.lateFee > 0 ? tx(W.lateOnly(rupees(s.lateFee))) : tx(W.upToToday)}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );

  /* ---------- the form ---------- */
  const lateBlock =
    student && totals.lateFee > 0 ? (
      lateOn.due.length === 0 && lateOn.avoidable.length > 0 && !waiveLate ? (
        <div className="pd-dg" style={{ padding: "10px 12px", background: "var(--oks)", color: "var(--ok)" }}>
          <Ic n="checkCircle" size={16} style={{ marginTop: 2, flex: "none" }} />
          <span>{tx(W.lateNoneOn(shortDate(paymentDate), lateOn.avoidable.map((r) => r.label).join(", ")))}</span>
        </div>
      ) : (
        <div className="pd-late">
          <div className="pd-f" style={{ gap: 10, alignItems: "flex-start", color: "var(--warnfg)" }}>
            <Ic n="clock" style={{ marginTop: 2, flex: "none" }} />
            <span className="pd-c" style={{ flex: 1 }}>
              <span className="pd-b">{tx(W.lateTitle(rupees(lateNowAmt || totals.lateFee), (lateOn.due.length ? lateOn.due : rows.filter((r) => r.lateFeePending > 0)).map((r) => r.label).join(" + ")))}</span>
              <span className="hide-m" style={{ fontSize: 12 }}>{tx(W.lateKeptApart)}</span>
            </span>
          </div>
          {waiveAllowed ? (
            <div className="pd-seg40">
              <Seg
                label={tx(W.lateFee)}
                value={form.late}
                onChange={(v) => set({ late: v })}
                options={[
                  { value: "take", label: tx(W.lateTake) },
                  { value: "waive", label: tx(W.lateWaive) },
                ]}
              />
            </div>
          ) : (
            <span className="hide-m" style={{ fontSize: 12, color: "var(--warnfg)" }}>{student.onPlan && boot.me.canWaive ? tx(W.lateNoWaivePlan) : tx(W.lateTakeNote)}</span>
          )}
          {waiveLate ? (
            <div className="pd-c fadein" style={{ gap: 8, color: "var(--warnfg)" }}>
              <span style={{ fontSize: 12, fontWeight: 700 }}>{tx(W.whyWaive)}</span>
              <div className="pd-chips">
                {W.waiveReasons.map((r) => (
                  <Chip key={r.en} on={form.waiveReason === r.en} onClick={() => set({ waiveReason: form.waiveReason === r.en ? "" : r.en })}>
                    {tx(r)}
                  </Chip>
                ))}
              </div>
              {show("waive-reason") ? <span role="alert" style={{ color: "var(--bad)", fontSize: 13, fontWeight: 600 }}>{tx(W.pickReason)}</span> : null}
              <input className="inp" value={form.waiveNote} onChange={(e) => set({ waiveNote: e.target.value })} placeholder={tx(W.waiveNote)} aria-label={tx(W.waiveNote)} />
              <span style={{ fontSize: 12 }}>{tx(W.waiveFoot)}</span>
            </div>
          ) : null}
        </div>
      )
    ) : null;

  const dateBad = Boolean(has("date-invalid") || has("date-future") || has("date-before-session"));
  const dateLine = dateBad
    ? problemText(has("date-invalid") ?? has("date-future") ?? has("date-before-session"), tx, boot.sessionStart)
    : `${form.dateMode === "today" ? `${tx(W.today)} · ${shortDate(paymentDate)}` : `${shortDate(paymentDate)}${tx(form.dateMode === "yesterday" ? W.yesterdayTag : W.backDated)}`}${paymentDate !== today ? tx(W.lateWorkedOut) : ""}`;
  const amountShown = Number.isSafeInteger(amount) && amount > 0 && /^[\d,\s]+$/.test(form.amount.trim()) ? amount.toLocaleString("en-IN") : form.amount;
  const amountBad = Boolean(show("amount") || show("over"));

  // What the walk does with the amount, in one line for step 3's summary.
  const goesTo = walk.lines.filter((l) => l.feesPaid + l.lateFeePaid > 0).map((l) => (l.row.isCarryForward ? oldBalanceLabel(tx(W.oldBalance), boot.sessionLabel) : l.row.label));

  const formCards = student ? (
    <div className="pd-col">
      <div className="card pd-cd fadein" data-st="2" aria-label={tx(W.paymentFor(firstName(student.name)))}>
        {/* The phone's header already names the child; its step 2 starts at the dues. */}
        <span className="pd-c hide-m">
          <span className="pd-v">{tx(W.paymentFor(firstName(student.name)))}</span>
          <span className="pd-m">{tx(W.anyAmount)}</span>
        </span>
        {/* Step 2 on a phone: the dues stay in sight while the amount is typed (UI-95). */}
        <div className="only-m pd-dues num">
          <span><span className="pd-m">{tx(W.feesPendingToday)}</span> <b style={{ color: totals.pendingToday ? "var(--bad)" : "var(--ok)" }}>{rupees(totals.pendingToday)}</b></span>
          {totals.lateFee > 0 ? <span><span className="pd-m">{tx(W.lateFee)}</span> <b style={{ color: "var(--warnfg)" }}>{rupees(totals.lateFee)}</b></span> : null}
        </div>
        {walk.maxAmount <= 0 ? <Banner tone="ok">{tx(W.nothingOwed)}</Banner> : null}
        {lateBlock}
        <label className="field" htmlFor="pd-amount">
          <span>{W.amountReceived.en} · {W.amountReceived.hi}</span>
          <span className={`pd-amt${amountBad ? " err" : ""}`}>
            <span className="num" aria-hidden="true" style={{ fontSize: 30, fontWeight: 700, color: "var(--sub)" }}>₹</span>
            <input
              id="pd-amount"
              inputMode="numeric"
              autoComplete="off"
              value={amountShown}
              onChange={(e) => set({ amount: e.target.value })}
              // Enter on a phone's keypad goes on to the date, as the Next button does.
              onKeyDown={(e) => { if (e.key === "Enter" && phoneStep === 2) { e.preventDefault(); goStep(3); } }}
              enterKeyHint="next"
              placeholder="0"
              aria-invalid={amountBad || undefined}
              aria-describedby="pd-amount-words"
            />
          </span>
        </label>
        <span id="pd-amount-words" style={{ fontSize: 13, fontWeight: 600, color: amountBad ? "var(--bad)" : "var(--mut)" }}>
          {has("over") ? tx(W.overMax(rupees(walk.maxAmount))) : hasPaise(form.amount) ? tx(W.wholeRupees) : amount ? wordsOf(amount) : tried ? tx(W.typeAmountErr) : tx(W.typeAmount)}
        </span>
        {chips.length ? (
          <div className="pd-chips pd-qchips" role="group" aria-label={tx(W.chipNote)}>
            {chips.map((c) => (
              <button type="button" className={`tap chip${c.amount !== null && amount === c.amount ? " on" : ""}`} key={c.key} aria-pressed={c.amount !== null && amount === c.amount} disabled={c.disabled || Boolean(attempt)} onClick={() => set({ amount: c.amount === null ? "" : String(c.amount) })}>
                {c.label}
                {c.amount !== null ? <span className="num" style={{ opacity: 0.8 }}>{rupees(c.amount)}</span> : null}
              </button>
            ))}
          </div>
        ) : null}
        <span className="pd-m hide-m">{tx(W.chipNote)}</span>
        {/* A phone's "where it goes", in one line; the review sheet lists it in full. */}
        {goesTo.length ? (
          <span className="only-m pd-bx" style={{ fontSize: 13, gap: 2 }}>
            <span><b>{tx(W.goesTo)}:</b> {goesTo.join(", ")}{lateTaken ? tx(W.inclLate) : ""}</span>
            <span className="num" style={{ color: "var(--mut)" }}>{tx(W.feesPendingToday)} → <b style={{ color: walk.after.pendingToday ? "var(--bad)" : "var(--ok)" }}>{rupees(walk.after.pendingToday)}</b></span>
          </span>
        ) : null}
        {student.repaymentPlan ? (
          <div className="pd-bx" style={{ background: "var(--infos)", color: "var(--info)", fontSize: 13, fontWeight: 600 }}>
            <span>
              {tx(W.planMonthly)}: {rupees(student.repaymentPlan.monthlyAmount)} · {tx(W.planCatchUp)}: {rupees(student.repaymentPlan.catchUpAmount)} · {tx(W.planBalance)}: {rupees(student.repaymentPlan.remainingBalance)}
              {student.repaymentPlan.nextDueDate ? ` · ${shortDate(student.repaymentPlan.nextDueDate)}` : ""}
            </span>
            {student.repaymentPlan.duesOutsidePlanAmount > 0 ? <span>{tx(W.planOutside)}: {rupees(student.repaymentPlan.duesOutsidePlanAmount)}</span> : null}
            {student.repaymentPlan.planReviewNeeded ? <span>{tx(W.planReview)}</span> : null}
          </div>
        ) : null}
      </div>

      {/* Step 3 on a phone opens on what is being saved; a tap goes back to change it. */}
      <button type="button" className="only-m tap card pd-cd pd-sum" data-st="3" onClick={() => goStep(2)} disabled={saving || Boolean(attempt)}>
        <span className="pd-f pd-j" style={{ width: "100%" }}>
          <span className="pd-c">
            <span className="pd-m" style={{ fontWeight: 600 }}>{tx(W.amountReceived)}</span>
            <span className="num" style={{ fontSize: 24, fontWeight: 700 }}>{rupees(Number.isFinite(amount) ? amount : 0)}</span>
          </span>
          <span className="pd-f" style={{ gap: 4, color: "var(--pri)", fontSize: 13, fontWeight: 700 }}>
            <Ic n="edit" size={16} /> {tx(W.changeAmount)}
          </span>
        </span>
        {goesTo.length ? <span className="pd-m" style={{ textAlign: "left" }}>{tx(W.goesTo)}: {goesTo.join(", ")}{lateTaken ? tx(W.inclLate) : ""}</span> : null}
      </button>

      <div className="card pd-cd fadein" data-st="3">
        <div className="field">
          <span>{tx(W.paymentDate)}</span>
          <div className="pd-seg40">
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
          </div>
        </div>
        {form.dateMode === "other" ? (
          <label className="field fadein">
            <span>{tx(W.dateParentPaid)}</span>
            <Input type="date" value={form.otherDate} min={boot.sessionStart} max={today} onChange={(e) => set({ otherDate: e.target.value })} invalid={dateBad} />
          </label>
        ) : null}
        <span className="pd-f" style={{ fontSize: 13, color: dateBad ? "var(--bad)" : "var(--mut)" }}>
          <Ic n="calendar" size={16} /> {dateLine}
        </span>
        <div className="field">
          <span>{tx(W.mode)}</span>
          <div className="pd-mo">
            <Seg
              label={tx(W.mode)}
              value={form.mode}
              onChange={(v) => set({ mode: v })}
              options={boot.modes.map((m) => ({ value: m, label: <><Ic n={MODE_ICON[m]} /><span>{tx(MODE_PAIR[m])}</span></> }))}
            />
          </div>
        </div>
        {form.mode === "upi" || form.mode === "bank_transfer" ? (
          <label className="field fadein">
            <span>{tx(form.mode === "upi" ? W.upiRef : W.utr)}</span>
            <input className="inp num" value={form.reference} onChange={(e) => set({ reference: e.target.value })} placeholder={tx(form.mode === "upi" ? W.upiRefPh : W.utrPh)} inputMode={form.mode === "upi" ? "numeric" : "text"} />
          </label>
        ) : null}
        {form.mode === "cheque" ? (
          <div className="pd-c fadein" style={{ gap: 10 }}>
            <div className="g3" style={{ display: "grid", gridTemplateColumns: "repeat(3,minmax(0,1fr))", gap: 10 }}>
              <label className="field">
                <span>{tx(W.chequeNo)}</span>
                <input className="inp num" inputMode="numeric" maxLength={6} value={form.chequeNo} onChange={(e) => set({ chequeNo: e.target.value.replace(/\D/g, "") })} placeholder={tx(W.chequeNoPh)} />
              </label>
              <label className="field">
                <span>{tx(W.bank)}</span>
                <input className="inp" value={form.chequeBank} onChange={(e) => set({ chequeBank: e.target.value })} placeholder={tx(W.bankPh)} />
              </label>
              <label className="field">
                <span>{tx(W.chequeDate)}</span>
                <input className="inp" type="date" value={form.chequeDate} onChange={(e) => set({ chequeDate: e.target.value })} />
              </label>
            </div>
            <span className="pd-m">{tx(W.chequeNote)}</span>
          </div>
        ) : null}
        <label className="field">
          <span>{tx(W.notes)}</span>
          <textarea className="inp" rows={2} value={form.notes} onChange={(e) => set({ notes: e.target.value })} placeholder={tx(W.notesPh)} style={{ minHeight: 64 }} />
        </label>
        <div className="field hide-m" id="pd-concession-off">
          <span>{tx(W.concession)}</span>
          <span className="pd-m">{tx(W.concessionOff)}</span>
        </div>
        <div className="pd-bx pd-by" style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
          <span className="pd-av" style={{ width: 32, height: 32, borderRadius: 16, fontSize: 11, background: "var(--okm)", color: "var(--ok)" }}>{initials(form.receivedBy || boot.me.name)}</span>
          <span className="pd-c" style={{ flex: 1 }}>
            <label htmlFor="pd-received-by" className="pd-m" style={{ fontWeight: 600 }}>{tx(W.receivedBy)}</label>
            <input id="pd-received-by" value={form.receivedBy} onChange={(e) => set({ receivedBy: e.target.value })} title={tx(W.editCollector)} autoComplete="off" />
          </span>
          <Ic n="edit" style={{ color: "var(--sub)", flex: "none" }} />
        </div>
      </div>
    </div>
  ) : null;

  const preview = student && dateReady ? <WherePreview walk={walk} amount={Number.isFinite(amount) ? amount : 0} paymentDate={paymentDate} today={today} sessionLabel={boot.sessionLabel} /> : null;

  const firstProblem = problemText(problems[0], tx, boot.sessionStart);
  const bar =
    student && !saved ? (
      <div className="pd-pbar glass">
        <span className="pd-c" style={{ flex: 1 }}>
          <span className="pd-m" style={{ fontWeight: 600 }}>
            {Number.isFinite(amount) && amount > 0 ? `${tx(MODE_PAIR[form.mode])} · ${form.dateMode === "today" ? tx(W.today).toLowerCase() : dayMonth(paymentDate)}${lateTaken ? tx(W.inclLate) : ""}` : tx(W.amountReceived)}
          </span>
          <span className="num" style={{ fontSize: 22, fontWeight: 700 }}>{rupees(Number.isFinite(amount) ? amount : 0)}</span>
        </span>
        <span className="pd-m hide-m" style={{ maxWidth: 260, textAlign: "right" }}>{previewing ? tx(W.previewing) : firstProblem ?? tx(W.checkThenSave)}</span>
        {/* A phone's steps: Back, and Next until the last, where Review & save takes its place (UI-95). */}
        {phoneStep > 1 && !stepLocked ? (
          <button type="button" className="only-m tap btn sec pd-sback" onClick={() => goStep((phoneStep - 1) as 1 | 2)} aria-label={tx(W.back)}>
            <Ic n="chevLeft" size={20} />
          </button>
        ) : null}
        {phoneStep < 3 ? (
          // Held while another child's save is unresolved: the form is frozen until it is resumed.
          <button type="button" className="only-m tap btn pri pd-big pd-snext" disabled={Boolean(attempt)} onClick={() => goStep((phoneStep + 1) as 2 | 3)} style={{ opacity: phoneStep === 2 && problems.some((p) => p.key === "amount" || p.key === "over" || p.key === "nothing-owed") ? 0.55 : undefined }}>
            {tx(phoneStep === 1 ? W.toAmount : W.toSave)} <Ic n="arrowRight" size={20} />
          </button>
        ) : null}
        <button
          type="button"
          className={`tap btn pri pd-big${phoneStep < 3 ? " hide-m" : " pd-snext"}`}
          onClick={review}
          style={{ opacity: problems.length ? 0.55 : undefined }}
          disabled={!canAct || !attemptKey || !dateReady || !recoveryReady || Boolean(recoveryError) || Boolean(attempt)}
        >
          <Ic n="checkCircle" size={20} /> {tx(W.review)}
        </button>
      </div>
    ) : null;

  /* ---------- saved ---------- */
  const removable = Boolean(saved && saved.fresh && !saved.removed && canAct && boot.me.canRemove && expiredAt !== saved.savedAtMs);
  const savedView = saved && student ? (
    <SavedPanel
      saved={saved}
      student={student}
      removable={removable}
      canRemove={boot.me.canRemove}
      canAct={canAct}
      onWa={() => setSheet("wa")}
      onNew={newPayment}
      onRetryReceipt={retryReceipt}
      busy={busy}
      onRemove={() => setSheet("rm")}
      onSibling={(id) => selectStudent(id)}
    />
  ) : null;

  /* ---------- page ---------- */
  const shownName = student?.name ?? boot.students.find((s) => s.id === selId)?.name ?? tx(W.title);
  const mTitle = saved ? tx(saved.removed ? W.removedTitle : W.saved) : selId ? shownName : tx(W.title);
  const mSub = saved ? saved.receiptNumber : selId ? (student ? `${student.classLabel} · SR ${student.sr}` : "") : `${shortDate(today)} · ${boot.me.name}`;
  const reviewOpen = Boolean(student) && reviewing && sheet === "" && !saved;
  const locked = saving || Boolean(attempt);
  // The phone's steps apply while one child's payment is being entered; a saved receipt is one screen.
  const stepping = Boolean(student) && !saved && !loading;

  return (
    <VxPage label={tx(W.title)}>
      <div className="pd-top" style={{ display: "contents" }}>
        <TopBar
          crumb={crumb}
          title={tx(W.title)}
          actions={
            <span style={{ display: "flex", gap: 12, alignItems: "center" }}>
              {todayPill}
              {manyBtn}
            </span>
          }
        />
      </div>
      <header className="only-m glass vx-top" style={{ flex: "none", minHeight: 58, display: "flex", alignItems: "center", gap: 4, padding: "6px 8px", borderBottom: "1px solid var(--bd)" }}>
        {selId ? (
          <button type="button" className="tap pd-phb" aria-label={tx(W.back)} onClick={phoneBack}>
            <Ic n="chevLeft" size={24} />
          </button>
        ) : (
          <BackLink href="/menu" className="tap pd-phb" label={tx(W.menu)}>
            <Ic n="chevLeft" size={24} />
          </BackLink>
        )}
        <span className="pd-c" style={{ flex: 1, paddingLeft: 4 }}>
          <span className="pd-e" style={{ fontSize: 17, fontWeight: 700 }}>{mTitle}</span>
          {mSub ? <span className="pd-m pd-e">{mSub}</span> : null}
        </span>
        {/* Bulk entry is for those who may post it (main's rule); the short label keeps the design's header. */}
        {!selId && boot.me.canBulk ? (
          <Link href="/payments/bulk" className="tap btn soft" aria-label={tx(W.many)} style={{ height: 40, padding: "0 12px", fontSize: 13 }}>
            <Ic n="table" size={16} /> {tx(W.manyShort)}
          </Link>
        ) : null}
      </header>
      <main>
        {!recoveryReady || attempt || recoveryError || (canAct && !attemptKey) || previewing || boot.blocking ? (
          <div className="pad" style={{ padding: "16px 24px 0", display: "flex", flexDirection: "column", gap: 8 }}>
            {!recoveryReady ? <Banner tone="info">{tx(W.recoveryChecking)}</Banner> : null}
            {attempt?.input.lateFeeWaiver ? <Banner tone="warn">{tx(W.waiverAttemptPending)} <b>{rupees(attempt.input.lateFeeWaiver)}</b></Banner> : null}
            {/* An unresolved payment never blocks the counter: close its sheet, help the next parent, and come back here. */}
            {attempt && (attempt.input.studentId !== student?.id || !reviewing) ? <Banner tone="warn" action={<Btn onClick={() => { if (attempt.input.studentId === student?.id) setReviewing(true); else void selectStudent(attempt.input.studentId); }}>{tx(W.resumePayment)}</Btn>}>{tx(W.unfinished)}</Banner> : null}
            {recoveryError || (canAct && !attemptKey) ? <Banner tone="bad" action={attemptKey ? <Btn disabled={!recoveryReady || saving} onClick={retryRecovery}>{tx(W.retryRecovery)}</Btn> : undefined}>{tx(!attemptKey ? W.recoveryIdentity : recoveryError === "locks" ? W.recoveryBrowser : W.recoveryStorage)}</Banner> : null}
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
        <div className="pd-desk pad" data-step={stepping ? phoneStep : undefined}>
          {stepping ? (
            <nav className="only-m pd-steps" aria-label={tx(W.steps)}>
              {([[1, W.stepDues], [2, W.stepAmount], [3, W.stepSave]] as const).map(([n, label]) => (
                <button
                  key={n}
                  type="button"
                  className="tap"
                  data-on={n === phoneStep ? "" : undefined}
                  data-done={n < phoneStep ? "" : undefined}
                  aria-current={n === phoneStep ? "step" : undefined}
                  aria-label={tx(W.stepOf(n, tx(label)))}
                  disabled={stepLocked || n === phoneStep}
                  onClick={() => goStep(n)}
                >
                  <span className="num pd-stn">{n < phoneStep ? <Ic n="check" size={14} stroke={3} /> : n}</span>
                  <span className="pd-stl">{tx(label)}</span>
                </button>
              ))}
            </nav>
          ) : null}
          <div className="pd-grid">
            <section className="pd-left" aria-label={tx(W.searchLabel)}>
              {findPane}
              {selId ? (
                <>
                  {/* Not on the phone's steps: the header's back arrow goes to the same list, and step 1 needs the room. */}
                  <button type="button" className="only-m tap pd-sr" data-st="desk" onClick={clearStudent} style={{ width: "100%", textAlign: "left" }}>
                    <Ic n="search" />
                    <span style={{ flex: 1, fontSize: 15 }}>{tx(W.searchAnother)}</span>
                  </button>
                  {loading ? <StudentSkeleton /> : null}
                  {!loading && result && !result.ok ? (
                    <div className="card pd-cd">
                      <strong>{tx(W.couldNotLoad)}</strong>
                      <span style={{ color: "var(--mut)" }}>{result.message}</span>
                      <Btn href={`/fees/payments?studentId=${selId}`} variant="soft">{tx(W.openClassic)}</Btn>
                    </div>
                  ) : null}
                  {!loading && student ? (
                    <StudentCard
                      key={student.id}
                      student={student}
                      today={today}
                      totals={totals}
                      sessionLabel={boot.sessionLabel}
                      nextDue={nextDue ? { no: nextDue.installmentNo, date: dueDay(nextDue.dueDate, today) } : null}
                      onSibling={(id) => selectStudent(id)}
                    />
                  ) : null}
                </>
              ) : null}
            </section>
            <section className={`pd-right${!selId ? " hide-m" : saved ? " pd-first" : ""}`}>
              {!selId ? (
                <div className="card pd-c fadein" style={{ alignItems: "center", justifyContent: "center", textAlign: "center", gap: 10, minHeight: 440, padding: 32 }}>
                  <span className="pd-av" style={{ width: 64, height: 64, borderRadius: 22, background: "var(--accs)", color: "var(--accfg)" }}>
                    <Ic n="rupee" size={30} />
                  </span>
                  <span className="serif" style={{ fontSize: 22, fontWeight: 600 }}>{tx(W.pickTitle)}</span>
                  <span className="pd-m" style={{ fontSize: 14, maxWidth: 440, lineHeight: 1.5 }}>{tx(W.pickBody)}</span>
                </div>
              ) : loading ? (
                <div className="card pd-cd" aria-busy="true" aria-label={tx(W.loading)}>
                  <Skel w="40%" h={18} />
                  <Skel h={72} r={18} />
                  <Skel w="70%" h={12} />
                  <Skel h={40} r={12} />
                  <Skel h={40} r={12} />
                </div>
              ) : savedView ? (
                savedView
              ) : student ? (
                <>
                  <div className="pd-pin">
                    {formCards}
                    {preview}
                  </div>
                  {!dateReady ? <div style={{ marginTop: 14 }}><Banner tone={dateFailed ? "warn" : "info"}>{tx(dateFailed ? W.dateFailed : W.dateLoading)}</Banner></div> : null}
                </>
              ) : null}
            </section>
          </div>
          {bar}
        </div>
      </main>

      {/* Review — nothing is saved until "Save payment"; Change keeps every entry. */}
      <Sheet
        open={reviewOpen}
        // While a save is on the wire the sheet stays; an unresolved one can be
        // closed and resumed from the banner, as on the fee app's desk (PR77).
        onClose={() => { if (!saving) setReviewing(false); }}
        dismissable={!saving}
        title={student ? tx(W.confirmTitle(rupees(amount))) : undefined}
        sub={student ? `${student.name} · ${student.classLabel} · SR ${student.sr}` : undefined}
        footer={
          <>
            <button type="button" className="tap btn sec" style={{ flex: 1, height: 52 }} disabled={locked} onClick={() => setReviewing(false)}>
              {tx(W.change)}
            </button>
            <button type="button" className="tap btn pri pd-big" style={{ flex: 1.8 }} disabled={saving || !canAct || !recoveryReady || Boolean(recoveryError) || Boolean(uncertain)} onClick={save}>
              {saving ? <span className="pd-spin" /> : <Ic n="check" size={20} />}
              {saving ? tx(W.saving) : tx(W.confirmSave)}
            </button>
          </>
        }
      >
        {student ? (
          <div className="pd-c" style={{ gap: 10 }}>
            {uncertain ? (
              <Banner
                tone="warn"
                action={
                  <Btn variant="sec" disabled={uncertain.checking || !recoveryReady || Boolean(recoveryError)} onClick={() => void checkSaved()}>
                    {uncertain.checking ? tx(W.checking) : tx(W.checkAgain)}
                  </Btn>
                }
              >
                <strong>{tx(W.uncertainTitle)}</strong> — <span style={{ fontWeight: 500 }}>{tx(W.uncertainBody)}</span>
              </Banner>
            ) : null}
            {recoveryError ? <Banner tone="bad" action={attemptKey ? <Btn disabled={!recoveryReady || saving} onClick={retryRecovery}>{tx(W.retryRecovery)}</Btn> : undefined}>{tx(recoveryError === "locks" ? W.recoveryBrowser : W.recoveryStorage)}</Banner> : null}
            {dayClosed ? <Banner tone="warn"><span id="pd-day-closed">{tx(W.dayClosedWarn(shortDate(paymentDate)))}</span></Banner> : null}
            <ConfirmBody
              student={student}
              amount={amount}
              modeText={tx(MODE_PAIR[form.mode])}
              reference={form.mode === "cheque" ? [form.chequeNo.trim(), form.chequeBank.trim(), /^\d{4}-\d{2}-\d{2}$/.test(form.chequeDate) ? shortDate(form.chequeDate) : ""].filter(Boolean).join(" · ") : composeReference({ mode: form.mode, reference: form.reference, chequeNo: form.chequeNo })}
              dateLine={dateLine ?? ""}
              walk={walk}
              receivedBy={form.receivedBy}
              concession={concession}
              notes={form.notes}
              waiveReason={form.waiveReason}
              sessionLabel={boot.sessionLabel}
            />
          </div>
        ) : null}
      </Sheet>

      {/* Duplicate */}
      <Sheet
        open={sheet === "dup"}
        onClose={() => setSheet("")}
        title={tx(W.dupTitle)}
        sub={dup?.receiptNumber ? (dup.createdAt ? tx(W.dupSub(ampm(dup.createdAt), dup.receiptNumber)) : dup.receiptNumber) : tx(W.dupSubNoTime)}
        footer={
          <div className="pd-c" style={{ gap: 8, flex: 1 }}>
            <button type="button" className="tap btn pri pd-big" disabled={!dup?.receiptId || busy} onClick={openEarlier}>
              <Ic n="receipt" size={20} /> {tx(W.dupOpen)}
            </button>
            <button
              type="button"
              className="tap btn ghost"
              style={{ color: "var(--bad)", height: 44 }}
              disabled={dup?.kind === "near-duplicate" && !boot.me.isAdmin}
              onClick={() => {
                setAck(true);
                setSheet("");
                setReviewing(true);
              }}
            >
              {tx(W.dupAgain)}
            </button>
          </div>
        }
      >
        {dup ? (
          <div className="pd-c" style={{ gap: 10 }}>
            <div className="pd-dg" style={{ background: "var(--warns)", color: "var(--warnfg)", fontSize: 14 }}>
              <Ic n="alert" style={{ marginTop: 2, flex: "none" }} />
              <span>{dup.receiptNumber && dup.createdAt ? tx(W.dupText(ampm(dup.createdAt), dup.receiptNumber)) : tx(W.dupSubNoTime)}</span>
            </div>
            <div className="card pd-c" style={{ gap: 6, padding: "14px 16px" }}>
              <div className="pd-f pd-j">
                <span className="num pd-v">{dup.receiptNumber ?? "—"}</span>
                {dup.createdAt ? <span className="pill" style={{ background: "var(--oks)", color: "var(--ok)" }}>{tx(W.savedAt(ampm(dup.createdAt)))}</span> : null}
              </div>
              <span className="pd-b">{student ? `${student.name} · ${student.classLabel}` : ""}</span>
              <div className="pd-f pd-j">
                <span className="pd-m">{dup.mode ? (MODE_TEXT[dup.mode] ?? dup.mode) : ""}</span>
                <span className="num" style={{ fontSize: 20, fontWeight: 700 }}>{rupees(dup.amount ?? amount)}</span>
              </div>
            </div>
            {dup.kind === "near-duplicate" && !boot.me.isAdmin ? <Banner tone="warn">{tx(W.dupHard)}</Banner> : null}
            <span className="pd-m">{tx(W.dupBody)}</span>
          </div>
        ) : null}
      </Sheet>

      {/* WhatsApp */}
      <Sheet
        open={sheet === "wa"}
        onClose={() => setSheet("")}
        title={tx(W.waTitle)}
        sub={tx(W.waSub)}
        footer={
          <>
            <button type="button" className="tap btn sec" style={{ flex: 1, height: 52 }} onClick={() => setSheet("")}>{tx(W.cancel)}</button>
            <button type="button" className="tap btn pri pd-big" style={{ flex: 1.8 }} disabled={busy || !canAct || !student?.phone} onClick={sendWa}>
              {busy ? <span className="pd-spin" /> : <Ic n="send" size={20} />} {tx(W.waSend)}
            </button>
          </>
        }
      >
        {saved && student ? (
          <div className="pd-c" style={{ gap: 10 }}>
            <Seg
              label={tx(W.waTitle)}
              value={waLang}
              onChange={setWaLang}
              options={[
                { value: "both", label: tx(W.langBoth) },
                { value: "hi", label: "हिंदी" },
                { value: "en", label: "English" },
              ]}
            />
            <WhatsAppPreview lines={waLines(saved, student, waLang)} footer={`${saved.receiptNumber}.pdf`} />
            <span className="pd-m">{student.phone ? tx(W.waTo(student.father ?? student.name, maskPhone(student.phone))) : tx(W.noPhone)}</span>
            <span className="pd-m">{tx(W.waPreviewNote)}</span>
          </div>
        ) : null}
      </Sheet>

      {/* Remove (admin, first ten minutes) */}
      <Sheet
        open={sheet === "rm"}
        onClose={() => setSheet("")}
        title={saved ? tx(W.rmTitle(saved.receiptNumber)) : undefined}
        sub={saved && student ? `${rupees(saved.receipt?.total ?? saved.amount)} · ${student.name}${saved.receipt?.createdAt ? ` · ${ampm(saved.receipt.createdAt)}` : ""}` : undefined}
        footer={
          <>
            <button type="button" className="tap btn sec" style={{ flex: 1, height: 52 }} onClick={() => setSheet("")}>{tx(W.rmKeep)}</button>
            <button type="button" className="tap btn danger pd-big" style={{ flex: 1.5 }} disabled={busy || !rmReason || !removable} onClick={remove}>
              {busy ? <span className="pd-spin" /> : null} {tx(W.rmGo)}
            </button>
          </>
        }
      >
        <div className="pd-c" style={{ gap: 10 }}>
          <span className="sech">{tx(W.rmWhy)}</span>
          <div className="pd-c" role="radiogroup" aria-label={tx(W.rmWhy)} style={{ gap: 8 }}>
            {W.rmReasons.map((r) => {
              const on = rmReason === r.label.en;
              return (
                <button key={r.label.en} type="button" role="radio" aria-checked={on} className="tap pd-rad" onClick={() => setRmReason(r.label.en)} style={{ border: on ? "2px solid var(--acc)" : "1px solid var(--bd)", background: on ? "var(--accs)" : "var(--card)" }}>
                  <i style={{ borderColor: on ? "var(--acc)" : "var(--bds)" }}><b style={{ transform: `scale(${on ? 1 : 0})` }} /></i>
                  <span className="pd-c">
                    <span className="pd-b">{tx(r.label)}</span>
                    <span className="pd-m">{tx(r.sub)}</span>
                  </span>
                </button>
              );
            })}
          </div>
          <label className="field" style={{ marginTop: 4 }}>
            <span>{tx(W.waiveNote)}</span>
            <textarea className="inp" value={rmNote} onChange={(e) => setRmNote(e.target.value)} placeholder={tx(W.rmNotePh)} style={{ minHeight: 64 }} />
          </label>
          {saved && student ? (
            <div className="pd-dg" style={{ background: "var(--warns)", color: "var(--warnfg)" }}>
              <Ic n="info" style={{ marginTop: 2, flex: "none" }} />
              <span>{tx(W.rmImpact(saved.receiptNumber, rupees(saved.receipt?.total ?? saved.amount), firstName(student.name)))}</span>
            </div>
          ) : null}
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
    <div className="card pd-cd" aria-busy="true">
      <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
        <Skel w={50} h={50} r={17} />
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
    </div>
  );
}

function StudentCard({
  student,
  today,
  totals,
  sessionLabel,
  nextDue,
  onSibling,
}: {
  student: DeskStudent;
  today: string;
  totals: ReturnType<typeof deskTotals>;
  sessionLabel: string;
  nextDue: { no: number; date: string } | null;
  onSibling: (id: string) => void;
}) {
  const { tx } = useVx();
  const rows = orderForSettlement(student.rows);
  const lateRows = rows.filter((r) => r.lateFeeRaw > 0 || r.lateFeePending > 0);
  const phone = maskPhone(student.phone);
  const tiles: { k: Pair; v: number; sub: Pair; color: string; ring?: boolean }[] = [
    { k: W.feesPendingToday, v: totals.pendingToday, sub: totals.dueToday ? W.plusDueToday(rupees(totals.dueToday)) : W.overdueOnly, color: totals.pendingToday ? "var(--bad)" : "var(--ok)" },
    { k: W.notDueYet, v: totals.notDueYet, sub: nextDue ? W.nextInst(nextDue.no, nextDue.date) : W.nothingAhead, color: "var(--fg)" },
    { k: W.lateFee, v: totals.lateFee, sub: W.lateSeparate, color: totals.lateFee ? "var(--warnfg)" : "var(--fg)" },
    { k: W.canTakeToday, v: totals.canTakeToday, sub: totals.dueToday ? W.canTakeSubDue : W.canTakeSub, color: "var(--pri)", ring: true },
  ];
  const paidSoFar = student.receipts.filter((h) => !h.isReversed).reduce((s, h) => s + h.amount, 0);
  // On a phone the tiles are the summary; the installments and receipts wait one tap away (UI-95).
  const [more, setMore] = useState(false);
  return (
    <div className="card pd-cd fadein" data-st="1" aria-label={student.name}>
      <div className="pd-f" style={{ gap: 12, alignItems: "flex-start" }}>
        <span className="pd-av" style={{ width: 50, height: 50, borderRadius: 17, fontSize: 17, background: "var(--accs)", color: "var(--accfg)" }}>{initials(student.name)}</span>
        <span className="pd-c" style={{ flex: 1 }}>
          <span className="pd-f" style={{ gap: 6, flexWrap: "wrap" }}>
            <span className="serif" style={{ fontSize: 21, fontWeight: 600, lineHeight: 1.2 }}>{student.name}</span>
            <span className="pill" style={{ background: "var(--s3)", color: "var(--mut)" }}>{tx(student.isNew ? W.newStudent : W.oldStudent)}</span>
            {student.onPlan ? <Pill tone="info" icon="layers">{tx(W.onPlan)}</Pill> : null}
          </span>
          <span className="pd-m num">{student.classLabel} · SR {student.sr}{phone ? ` · ${phone}` : ""}</span>
          <span className="pd-m">
            {student.father ? `${tx(W.father)} ${student.father} · ` : ""}{student.route ? `${tx(W.bus)}: ${student.route}` : tx(W.noBus)}
          </span>
        </span>
      </div>
      {student.siblings.map((s) => (
        <button key={s.id} type="button" className="tap chip" onClick={() => onSibling(s.id)} style={{ alignSelf: "flex-start" }}>
          <Ic n="users" size={16} /> {s.name} · {s.classLabel} <Ic n="arrowRight" size={16} />
        </button>
      ))}
      <div className="pd-tiles">
        {tiles.map((t, i) => (
          <div key={t.k.en} className="pd-tile" style={{ animationDelay: `${i * 32}ms`, boxShadow: t.ring ? "inset 0 0 0 1.5px var(--acc)" : "none" }}>
            <span className="pd-m" style={{ fontWeight: 600 }}>{tx(t.k)}</span>
            <span className="num" style={{ fontSize: 20, fontWeight: 700, color: t.color }}>{rupees(t.v)}</span>
            <span className="pd-m">{tx(t.sub)}</span>
          </div>
        ))}
      </div>
      <button type="button" className="only-m tap btn soft pd-more" aria-expanded={more} aria-controls="pd-fold" onClick={() => setMore((m) => !m)}>
        <Ic n={more ? "chevUp" : "chevDown"} size={18} /> {tx(more ? W.lessRows : W.moreRows(rows.length + lateRows.length))}
      </button>
      <div id="pd-fold" className={`pd-fold${more ? " open" : ""}`}>
      <div className="pd-c">
        {rows.map((r) => {
          const overdue = isOverdueOn(r, today);
          const left = Math.max(0, r.feesPending);
          const st = left <= 0 ? (["var(--oks)", "var(--ok)", W.stPaid] as const) : overdue ? (["var(--bads)", "var(--bad)", W.stOverdue] as const) : r.feesPaid > 0 ? (["var(--infos)", "var(--info)", W.stPart] as const) : (["var(--s3)", "var(--mut)", W.stNotDue] as const);
          const days = !overdue && left > 0 ? daysBetween(today, r.dueDate) : 0;
          return (
            <div key={r.id} className="pd-lrow">
              <span className="pd-c" style={{ flex: 1 }}>
                <span className="pd-b">{r.isCarryForward ? oldBalanceLabel(tx(W.oldBalance), sessionLabel) : r.label}</span>
                <span className="pd-m">
                  {r.isCarryForward ? tx(W.unpaidLastSession) : tx(W.due(dueDay(r.dueDate, today)))} · {tx(W.charge(rupees(r.charge), rupees(r.feesPaid)))}{days > 0 ? tx(W.dueIn(days)) : ""}
                </span>
              </span>
              <span className="pd-end">
                <span className="num pd-v" style={{ color: left > 0 && overdue ? "var(--bad)" : left > 0 ? "var(--fg)" : "var(--ok)" }}>{rupees(left)}</span>
                <span className="pill" style={{ background: st[0], color: st[1] }}>{tx(st[2])}</span>
              </span>
            </div>
          );
        })}
        {lateRows.map((r) => {
          const waived = r.lateFeeStatus === "waived" || (r.lateFeeWaived > 0 && r.lateFeePending <= 0);
          const paid = !waived && r.lateFeePending <= 0;
          const flat = rupees(r.lateFeeRaw || r.lateFeePending);
          const st = waived ? (["var(--s3)", "var(--mut)", W.lateWaived] as const) : paid ? (["var(--oks)", "var(--ok)", W.latePaid] as const) : (["var(--warns)", "var(--warnfg)", W.latePending] as const);
          return (
            <div key={`late-${r.id}`} className="pd-lrow late">
              <Ic n="clock" style={{ color: "var(--warn)", flex: "none" }} />
              <span className="pd-c" style={{ flex: 1 }}>
                <span className="pd-b">{tx(W.lateLine(r.installmentNo))}</span>
                <span className="pd-m">{tx(waived ? W.lateFlatWaived(flat) : paid ? W.lateFlatPaid(flat) : W.lateFlat(flat, dueDay(r.dueDate, today)))}</span>
              </span>
              <span className="pd-end">
                <span className="num pd-v" style={{ textDecoration: waived ? "line-through" : "none" }}>{flat}</span>
                <span className="pill" style={{ background: st[0], color: st[1] }}>{tx(st[2])}</span>
              </span>
            </div>
          );
        })}
      </div>
      {student.plan ? (
        <span className="pd-m" style={{ lineHeight: 1.5 }}>
          {tx(W.planLine(rupees(student.plan.tuition), student.plan.transport ? rupees(student.plan.transport) : null, rupees(student.plan.academic), student.plan.installments))}
        </span>
      ) : null}
      <div className="pd-c" style={{ gap: 4, paddingTop: 10, borderTop: "1px solid var(--bd)" }}>
        <span className="sech">{tx(W.paidThisSession)}</span>
        {student.receipts.length === 0 ? (
          <span className="pd-m">{tx(W.noPayment)}</span>
        ) : (
          student.receipts.slice(0, 8).map((h) => (
            <div key={h.id} className="pd-f pd-j num" style={{ fontSize: 13, padding: "3px 0" }}>
              <span className="pd-e">{h.receiptNumber} · {dayMonth(h.paymentDate)}{h.isReversed ? tx(W.histRemoved) : ""}</span>
              <span className="pd-f">
                <span className="pd-m">{MODE_TEXT[h.mode] ?? h.mode}</span>
                <b style={{ textDecoration: h.isReversed ? "line-through" : "none" }}>{rupees(h.amount)}</b>
              </span>
            </div>
          ))
        )}
        {paidSoFar > 0 && student.receipts.length > 8 ? <span className="pd-m">{rupees(paidSoFar)}</span> : null}
      </div>
      </div>
    </div>
  );
}

const WALK_LOOK: Record<WalkLine["state"], { bg: string; fg: string; pair: Pair }> = {
  cleared: { bg: "var(--oks)", fg: "var(--ok)", pair: W.wCleared },
  part: { bg: "var(--warns)", fg: "var(--warnfg)", pair: W.wPart },
  ahead: { bg: "var(--infos)", fg: "var(--info)", pair: W.wAhead },
  untouched: { bg: "var(--s3)", fg: "var(--mut)", pair: W.wUntouched },
};

function WherePreview({ walk, amount, paymentDate, today, sessionLabel }: { walk: ReturnType<typeof walkPayment>; amount: number; paymentDate: string; today: string; sessionLabel: string }) {
  const { tx } = useVx();
  const after: [Pair | string, number, string][] = [
    [W.feesPendingToday, walk.after.pendingToday, walk.after.pendingToday ? "var(--bad)" : "var(--ok)"],
    ...(walk.after.dueToday ? ([[W.dueToday, walk.after.dueToday, "var(--warnfg)"]] as [Pair, number, string][]) : []),
    [W.notDueYet, walk.after.notDueYet, "var(--fg)"],
    [`${tx(W.lateFee)}${walk.waiverAmount > 0 ? tx(W.lateWaivedTag) : ""}`, walk.after.lateFee, walk.after.lateFee ? "var(--warnfg)" : "var(--ok)"],
  ];
  return (
    // On a phone this card is a line in step 2 and the review sheet's own table (UI-95); it is a desk's side panel.
    <div className="card pd-cd pd-stk" data-st="desk" aria-live="polite">
      <div className="pd-f pd-j">
        <span className="pd-v">{tx(W.whereGoes)}</span>
        <span className="num pd-v" style={{ color: "var(--acc)" }}>{rupees(amount)}</span>
      </div>
      <span className="pd-m">{tx(W.oldestFirst)}</span>
      {!amount ? (
        <div className="pd-bx" style={{ alignItems: "center", textAlign: "center", padding: "16px 8px" }}>
          <Ic n="layers" size={24} style={{ color: "var(--sub)" }} />
          <span className="pd-m">{tx(W.typeToSee)}</span>
        </div>
      ) : null}
      <div className="pd-c">
        {walk.lines.map((l, i) => {
          const look = WALK_LOOK[l.state];
          const paid = l.feesPaid + l.lateFeePaid;
          const left = l.feesAfter + l.lateFeeAfter;
          const pct = l.before ? Math.round((paid / l.before) * 100) : 0;
          return (
            <div key={l.row.id} className="pd-c" style={{ gap: 6, padding: "10px 0", borderTop: i ? "1px solid var(--bd)" : 0, opacity: paid || !amount ? 1 : 0.6, animation: `xIn .3s var(--ease) ${Math.min(i, 12) * 32}ms both` }}>
              <div className="pd-f pd-j">
                <span className="pd-c" style={{ flex: 1 }}>
                  <span className="pd-b pd-e">{l.row.isCarryForward ? oldBalanceLabel(tx(W.oldBalance), sessionLabel) : l.row.label}</span>
                  <span className="pd-m">
                    {l.row.isCarryForward ? tx(W.lastSessionFees) : isOverdueOn(l.row, paymentDate) ? tx(W.overdueSince(dueDay(l.row.dueDate, today))) : tx(W.due(dueDay(l.row.dueDate, today)))}
                  </span>
                </span>
                <span className="pill" style={{ background: look.bg, color: look.fg }}>{tx(look.pair)}</span>
              </div>
              <div className="pd-tr" aria-hidden="true">
                <span style={{ width: `${pct}%`, background: paid ? (left > 0 ? "var(--acc)" : "var(--ok)") : "transparent" }} />
              </div>
              <div className="pd-f num" style={{ gap: 6, fontSize: 13 }}>
                <span style={{ color: "var(--mut)" }}>{rupees(l.before)}</span>
                <Ic n="arrowRight" size={13} style={{ color: "var(--sub)" }} />
                <b style={{ color: paid ? "var(--fg)" : "var(--sub)" }}>{tx(W.pay(rupees(paid)))}</b>
                <Ic n="arrowRight" size={13} style={{ color: "var(--sub)" }} />
                <span>{tx(W.left(rupees(left)))}</span>
              </div>
              {l.lateFeeDropped ? <span style={{ fontSize: 12, color: "var(--ok)", fontWeight: 600 }}>{tx(W.lateDropped)}</span> : null}
              {l.lateFeeWaived ? <span style={{ fontSize: 12, color: "var(--mut)", fontWeight: 600 }}>{tx(W.lateWaivedLine)}</span> : null}
              {l.lateFeePaid > 0 ? <span style={{ fontSize: 12, color: "var(--warnfg)" }}>{tx(W.lateFee)} {rupees(l.lateFeePaid)}</span> : null}
            </div>
          );
        })}
      </div>
      {walk.credit > 0 ? (
        <div className="pd-bx" style={{ flexDirection: "row", alignItems: "center", gap: 8, background: "var(--infos)", color: "var(--info)", fontSize: 13, fontWeight: 600 }}>
          <Ic n="star" size={16} /> {tx(W.credit(rupees(walk.credit)))}
        </div>
      ) : null}
      {walk.alreadyPaid.length ? <span className="pd-m">{tx(W.alreadyPaid(walk.alreadyPaid.join(", "), walk.alreadyPaid.length > 1))}</span> : null}
      <div className="pd-bx" style={{ gap: 6, padding: 12, borderRadius: 14 }}>
        <span className="sech">{tx(W.afterThis)}</span>
        {after.map(([k, v, c]) => (
          <div key={typeof k === "string" ? k : k.en} className="pd-f pd-j" style={{ fontSize: 13 }}>
            <span>{tx(k)}</span>
            <b className="num" style={{ color: c }}>{rupees(v)}</b>
          </div>
        ))}
      </div>
      {paymentDate !== today ? <span className="pd-m">{shortDate(paymentDate)}{tx(W.lateWorkedOut)}</span> : null}
    </div>
  );
}

function ConfirmBody({
  student,
  amount,
  modeText,
  reference,
  dateLine,
  walk,
  receivedBy,
  concession,
  notes,
  waiveReason,
  sessionLabel,
}: {
  student: DeskStudent;
  amount: number;
  modeText: string;
  reference: string;
  dateLine: string;
  walk: ReturnType<typeof walkPayment>;
  receivedBy: string;
  concession: number;
  notes: string;
  waiveReason: string;
  sessionLabel: string;
}) {
  const { tx } = useVx();
  const kv: [Pair, string][] = [
    [W.student, `${student.name} · ${student.classLabel}`],
    [W.amount, rupees(amount)],
    [W.mode, modeText],
    [W.dateK, dateLine],
    [W.reference, reference || tx(W.none)],
    ...(notes.trim() ? ([[W.notesK, notes.trim()]] as [Pair, string][]) : []),
    [W.collector, receivedBy],
    ...(concession > 0 ? ([[W.concession, rupees(concession)]] as [Pair, string][]) : []),
  ];
  const lines: { key: string; k: string; sub: string; v: string }[] = walk.lines
    .filter((l) => l.feesPaid + l.lateFeePaid > 0 || l.discountApplied || l.lateFeeDropped)
    .map((l) => {
      const left = l.feesAfter + l.lateFeeAfter;
      const state = tx(l.state === "ahead" ? W.wAhead : W.wPart);
      const extra = [
        l.lateFeePaid ? `${tx(W.lateFee)} ${rupees(l.lateFeePaid)}` : "",
        l.discountApplied ? `${tx(W.concession)} ${rupees(l.discountApplied)}` : "",
        l.lateFeeDropped ? tx(W.lateDropped) : "",
      ].filter(Boolean);
      return {
        key: l.row.id,
        k: l.row.isCarryForward ? oldBalanceLabel(tx(W.oldBalance), sessionLabel) : l.row.label,
        sub: [left > 0 ? tx(W.cfLeft(state, rupees(left))) : tx(W.wCleared), ...extra].join(" · "),
        v: rupees(l.feesPaid + l.lateFeePaid),
      };
    });
  if (walk.waiverAmount > 0) lines.push({ key: "waiver", k: `${tx(W.lateFee)} ${rupees(walk.waiverAmount)}`, sub: `${tx(W.lateWaived)}${waiveReason ? ` · ${waiveReason}` : ""}`, v: rupees(0) });
  if (walk.credit > 0) lines.push({ key: "credit", k: tx(W.creditK), sub: tx(W.creditSub), v: rupees(walk.credit) });
  return (
    <>
      <div className="pd-c">
        {kv.map(([k, v]) => (
          <div key={k.en} className="pd-kv">
            <span className="pd-m" style={{ fontSize: 13 }}>{tx(k)}</span>
            <span className="pd-b num" style={{ textAlign: "right" }}>{v}</span>
          </div>
        ))}
      </div>
      <span className="sech" style={{ marginTop: 4 }}>{tx(W.whereItGoes)}</span>
      <div className="pd-c">
        {lines.map((l) => (
          <div key={l.key} className="pd-ln" style={{ fontSize: 14 }}>
            <span className="pd-c">
              <span>{l.k}</span>
              <span className="pd-m">{l.sub}</span>
            </span>
            <b className="num">{l.v}</b>
          </div>
        ))}
      </div>
      <div className="pd-bx">
        <span className="sech">{tx(W.balanceAfter)}</span>
        <div className="pd-f pd-j" style={{ fontSize: 13 }}><span>{tx(W.feesPendingToday)}</span><b className="num">{rupees(walk.after.pendingToday)}</b></div>
        {walk.after.dueToday ? <div className="pd-f pd-j" style={{ fontSize: 13 }}><span>{tx(W.dueToday)}</span><b className="num">{rupees(walk.after.dueToday)}</b></div> : null}
        <div className="pd-f pd-j" style={{ fontSize: 13 }}><span>{tx(W.notDueYet)}</span><b className="num">{rupees(walk.after.notDueYet)}</b></div>
        <div className="pd-f pd-j" style={{ fontSize: 13 }}><span>{tx(W.lateFee)}</span><b className="num">{rupees(walk.after.lateFee)}</b></div>
      </div>
    </>
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
  onRetryReceipt: () => void;
  busy: boolean;
  onRemove: () => void;
  onSibling: (id: string) => void;
}) {
  const { tx } = useVx();
  const r = saved.receipt;
  const time = r?.createdAt ? ampm(r.createdAt) : saved.savedAtMs ? ampm(new Date(saved.savedAtMs)) : "";
  const until = saved.savedAtMs ? ampm(new Date(saved.savedAtMs + REMOVE_WINDOW_MS)) : "";
  const gone = saved.removed;
  const title = gone ? tx(W.entryRemoved) : saved.fresh ? tx(W.saved) : tx(W.savedEarlier(time));
  const lock = gone ? tx(W.lockedGone) : saved.fresh ? tx(W.lockedFresh) : tx(W.lockedOld(time));
  const sib = student.siblings[0];
  const receiptHref = `/receipts/${encodeURIComponent(saved.receiptNumber)}`;
  const log: ReactNode[] = saved.log.map((l, i) => <LogLine key={`${l.text}-${i}`} dot={l.tone} text={l.text} time={l.time} delay={i} />);
  if (saved.fresh && !gone) {
    log.push(<LogLine key="window" dot="var(--sub)" text={canRemove ? (removable ? tx(W.youCanRemove(until)) : "") : tx(W.onlyAdminRemoves)} time="" delay={log.length} />);
  }
  return (
    <div className="pd-c" style={{ gap: 14, paddingBottom: 24, animation: "xPush .36s var(--ease) both" }}>
      <div className="card pd-f" style={{ gap: 16, padding: "16px 18px", borderColor: gone ? "var(--bad)" : saved.fresh ? "var(--okm)" : "var(--bd)" }}>
        {saved.fresh && !gone ? (
          <svg width="72" height="72" viewBox="0 0 96 96" aria-hidden="true" style={{ flex: "none", animation: "xPopIn .5s var(--spring) both" }}>
            <circle cx="48" cy="48" r="44" className="pd-tk0" />
            <circle cx="48" cy="48" r="44" className="pd-tk1" />
            <path d="M30 49l12 12 24-26" className="pd-tk2" />
          </svg>
        ) : (
          <span className="pd-av" style={{ width: 56, height: 56, borderRadius: 28, background: gone ? "var(--bads)" : "var(--infos)", color: gone ? "var(--bad)" : "var(--info)" }}>
            <Ic n={gone ? "trash" : "info"} size={26} />
          </span>
        )}
        <span className="pd-c" style={{ flex: 1 }}>
          <span className="serif" style={{ fontSize: 28, fontWeight: 600, lineHeight: 1.15 }}>{title}</span>
          <span className="num" style={{ fontSize: 14, color: "var(--mut)" }}>{tx(W.savedFor(rupees(r?.total ?? saved.amount), student.name, saved.receiptNumber, time))}</span>
          <span className="pd-f pd-m" style={{ gap: 6, marginTop: 4, alignItems: "flex-start" }}>
            <Ic n="lock" size={16} style={{ marginTop: 1, flex: "none" }} /> {lock}
          </span>
        </span>
      </div>
      <div className="pd-p2">
        {r ? (
          <ReceiptCard receipt={r} balance={saved.balance} frozenAt={time} removed={gone} />
        ) : (
          saved.settling ? (
            <div className="card pd-cd" aria-live="polite">
              <Banner tone="ok">{tx(W.receiptSettling(saved.receiptNumber))}</Banner>
              <Skel h={120} />
            </div>
          ) : (
            <div className="card pd-cd">
              <Banner tone="info">{tx(W.receiptPending(saved.receiptNumber))}</Banner>
              <Btn variant="sec" icon="refresh" disabled={busy} onClick={onRetryReceipt}>{tx(W.showReceipt)}</Btn>
            </div>
          )
        )}
        <div className="pd-c" style={{ gap: 10 }}>
          {!gone ? (
            <>
              <button type="button" className="tap btn pri pd-big" onClick={onWa} disabled={!canAct}>
                <Ic n="send" size={20} /> {tx(saved.sent ? W.sendWaAgain : W.sendWa)}
              </button>
              <span className="pd-m" style={{ textAlign: "center" }}>
                {student.phone ? tx(W.waTo(student.father ?? student.name, maskPhone(student.phone))) : tx(W.noPhone)}
              </span>
            </>
          ) : null}
          <div className="pd-tiles">
            <Btn variant="sec" icon="printer" href={receiptHref}>{tx(W.print)}</Btn>
            <Btn variant="sec" icon="download" href={`/fees/receipts/${saved.receiptId}/pdf`} target="_blank" prefetch={false}>{tx(W.pdf)}</Btn>
          </div>
          <Btn variant="sec" icon="plus" full onClick={onNew} style={{ height: 48 }}>{tx(W.newPayment)}</Btn>
          {sib ? (
            <Btn variant="soft" full onClick={() => onSibling(sib.id)} style={{ height: 48 }}>
              {sib.name} <Ic n="arrowRight" size={18} />
            </Btn>
          ) : null}
          {removable ? (
            <Btn variant="ghost" icon="trash" full onClick={onRemove} style={{ color: "var(--bad)" }} disabled={!canAct}>
              {tx(W.removeTill(until))}
            </Btn>
          ) : null}
          {saved.fresh && !gone && !canRemove ? (
            <Btn variant="ghost" icon="undo" full href={receiptHref} style={{ color: "var(--bad)" }}>{tx(W.askRemove)}</Btn>
          ) : null}
          {!saved.fresh || gone ? (
            <Btn variant="ghost" full href={receiptHref}>{tx(W.openInReceipts)}</Btn>
          ) : null}
          <div className="card pd-c" style={{ gap: 6, padding: "12px 14px" }}>
            <span className="sech">{tx(W.whoDidWhat)}</span>
            {log}
          </div>
        </div>
      </div>
    </div>
  );
}

function LogLine({ dot, text, time, delay }: { dot: string; text: string; time: string; delay: number }) {
  if (!text) return null;
  return (
    <div style={{ display: "grid", gridTemplateColumns: "12px minmax(0,1fr) auto", gap: 10, alignItems: "start", animation: `xIn .3s var(--ease) ${delay * 60}ms both` }}>
      <span style={{ width: 10, height: 10, marginTop: 4, borderRadius: 5, background: dot }} />
      <span style={{ fontSize: 13 }}>{text}</span>
      <span className="num pd-m">{time}</span>
    </div>
  );
}
