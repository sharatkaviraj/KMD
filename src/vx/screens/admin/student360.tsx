"use client";

import { ProfilePhotoControl, type PhotoControlHandle } from "@/modules/collection/ui/profile-photo-editor";
import Link from "next/link";
import { AssignmentLauncher, type AssignmentHandle } from "@/modules/teacher-tasks/ui/assignment-sheet";
import { ms, photoMessages as photoWords } from "@/messages/setup";
import { useRouter } from "next/navigation";
import { Suspense, use, useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";

import { dateLabel, dayMonth, initials, rupees } from "@/vx/format";
import { useVx } from "@/vx/i18n";
import { Ic } from "@/vx/icons";
import { p as pair, type Pair } from "@/vx/text";
import { CloseLink, useCloseTo } from "@/vx/ui/back-link";
import { Sheet } from "@/vx/ui/overlays";
import { Btn, EmptyState, Pill, Skel, type Tone } from "@/vx/ui/primitives";
import { mobileOf, parseTab, provisionalLabel, type InstallmentState, type MarkStatus, type MonthCell, type StudentMoney, type StudentTab } from "@/vx/screens/admin/logic";
import { SupportActions } from "@/vx/screens/admin/support-actions";
import { T } from "@/vx/screens/admin/text";
import { studentProfileHref, studentReturnHref } from "@/vx/screens/admin/students-logic";
import { excerpt, openSupportActions, TAG_TEXT, type FollowOwner, type NoteStatus, type NoteTag } from "@/vx/screens/notes/domain/notes";
import type { ContactEntry } from "@/vx/screens/family-contact/domain";
import { FamilyContactLog, type ContactRecoveryScope } from "@/vx/screens/family-contact/ui";

import "./student360.css";
import { ChildSummary } from "@/vx/assist/summary-assist";

/*
 * Student 360 as the design draws it (F06–F08 on a phone, D02 on a desk).
 *
 * A layer over the page: the whole screen on a phone, a 640px drawer from the
 * right on a desk. The hero carries the year's fee ring (attendance for a
 * reader who sees no money), the tiles say pending today, attendance and the
 * latest term, and the tabs are chips. Pending today, not due yet and the
 * late fee are three numbers everywhere and never one.
 *
 * Switching tabs never goes back to the server: every tab's data is read in
 * one pass, the tab is client state, and the URL follows it with
 * `replaceState` — a link to `?tab=fees` still opens on fees, and closing goes
 * back to wherever the reader came from.
 *
 * The fee side is streamed in (UI-70): the card renders with the school side
 * and a promise the server keeps resolving.
 */

/** The fee app's money band for one child (`studentFees().summary`). */
type StudentFeeSummary = {
  outstanding: number;
  overdue: number;
  lateFeePending: number;
  lateFeeWaived: number;
  paidThisSession: number;
  discountClosed: number;
  sessionFee: number;
  creditBalance: number;
  installmentsPaid: number;
  installmentsTotal: number;
  installmentsPending: number;
  nextDue: { label: string; amount: number; dueDate: string } | null;
};

/** The fee app's fee breakup for one child (`studentFees().breakup`). */
type StudentFeeBreakup = {
  rows: { id: string; label: string; amount: number; kind: "charge" | "discount" }[];
  annualTotal: number;
  discountTotal: number;
  discountLabels: string[];
  tuitionOverride: number | null;
  transportOverride: number | null;
};

type Cell = { day: string; label: string; state: MarkStatus | "today" | "future" | "closed" | "none" };

export type Student360Props = {
  canEditPhoto?: boolean;
  canAssignTasks?: boolean;
  id: string;
  returnTo?: string;
  name: string;
  /** Only a signed URL from the private collection photo store, after its permission check. */
  photoUrl?: string | null;
  unavailable?: string[];
  classLabel: string;
  sr: string | null;
  rollNo: string | null;
  status: string | null;
  father: string | null;
  mother: string | null;
  phone: string | null;
  address: string | null;
  dob: string | null;
  joined: string | null;
  route: string | null;
  tab: StudentTab;
  tabs: StudentTab[];
  money: StudentMoney | null;
  installments:
    | {
        id: string;
        label: string;
        dueDate: string;
        state: InstallmentState;
        /** The fee app's own status word. */
        status: "paid" | "partial" | "overdue" | "pending" | "waived";
        pending: number;
        /** Fees settled on the row — the progress bar. */
        settled: number;
        /** Everything the pool settled here. */
        paid: number;
        receiptedHere: number;
        adjusted: number;
        base: number;
        lateFee: number;
        lateFeeWaived: number;
        lateFeePending: number;
        carry: boolean;
      }[]
    | null;
  feeSummary: StudentFeeSummary | null;
  feeBreakup: StudentFeeBreakup | null;
  feeSession: string | null;
  receipts: { id: string; number: string; date: string; amount: number; mode: string; reversed: boolean }[] | null;
  /** The family's children; money only from the fee read: the year's fee, paid, and what remains this year (never "pending today"). */
  family: { id: string; name: string; sr: string; classLabel: string; self: boolean; total?: number | null; paid?: number | null; remaining?: number | null }[] | null;
  familyGroupId?: string | null;
  attendance: {
    percent: number | null;
    counted: number;
    counts: Record<MarkStatus, number>;
    weeks: Cell[];
    /** This month, Monday first (`monthGrid`); absent on an older card. */
    month?: { month: string; cells: MonthCell[]; present: number; marked: number; percent: number | null; lastAbsent: string | null };
  };
  /** `missing` blank papers out of `papers` (every paper but the excused ones). */
  terms: {
    term: string;
    percent: number | null;
    grade: string | null;
    missing: number;
    papers: number;
    scored: number;
    outOf: number;
    subjects?: { subjectId: string; en: string; hi: string; percent: number | null; state: "value" | "absent" | "exempt" | "blank" }[];
  }[];
  documents: { id: string; kind: string; fileName: string; size: string; createdAt: string; by: string | null }[];
  notes: {
    id: string;
    body: string;
    tags: NoteTag[];
    status: NoteStatus;
    needsFollowUp: boolean;
    followUpOn: string | null;
    followUpOwner: FollowOwner | null;
    followUpName: string | null;
    by: string;
    createdAt: string;
    /** May this reader mark it working or done (`canWorkOnNote`). */
    canWork?: boolean;
  }[];
  history: { id: number; label: Pair; from: string | null; to: string | null; blocked: boolean; at: string; by: string | null }[];
  /** The school day, for "2 days late" on a follow-up. */
  today: string;
  canCollect: boolean;
  canManageDocuments: boolean;
  canManageFees: boolean;
  canAddNote: boolean;
  /** Family contacts this session, newest first; null when the reader may not see them (D-265). */
  contacts: ContactEntry[] | null;
  contactRecoveryScope?: ContactRecoveryScope;
};

/** Everything on the card that comes from the fee app's reads. */
export type Student360Fees = Partial<
  Pick<Student360Props, "status" | "address" | "dob" | "joined" | "route" | "money" | "installments" | "feeSummary" | "feeBreakup" | "feeSession" | "receipts" | "family" | "familyGroupId">
> & { unavailable?: boolean };

const TAB_LABEL: Record<StudentTab, Pair> = {
  overview: T.tabOverview,
  fees: T.tabFees,
  attendance: T.tabAttendance,
  marks: T.tabMarks,
  family: T.tabFamily,
  documents: T.tabDocuments,
  notes: T.tabNotes,
  history: T.tabHistory,
  info: T.tabInfo,
};

/** The design's order of chips: overview, fees, attendance, marks, family, info, then this app's extra records. */
const TAB_ORDER: StudentTab[] = ["overview", "fees", "attendance", "marks", "family", "info", "notes", "documents", "history"];

/** Heat and calendar cells, as the design colours them (P, A, H, closed, today, not yet). */
const LOOK: Record<Cell["state"] | "blank", { bg: string; fg: string; bd?: string }> = {
  present: { bg: "var(--okm)", fg: "var(--ok)" },
  late: { bg: "var(--okm)", fg: "var(--ok)" },
  absent: { bg: "var(--bad)", fg: "var(--onsolid)" },
  half_day: { bg: "var(--warnm)", fg: "var(--warnfg)" },
  leave: { bg: "var(--infos)", fg: "var(--info)" },
  closed: { bg: "var(--s3)", fg: "var(--mut)" },
  today: { bg: "var(--card)", fg: "var(--fg)", bd: "2px solid var(--pri)" },
  future: { bg: "transparent", fg: "var(--sub)", bd: "1px dashed var(--bd)" },
  none: { bg: "transparent", fg: "var(--mut)", bd: "1px solid var(--bd)" },
  blank: { bg: "transparent", fg: "transparent" },
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * The short name each installment row goes by: its month, unless two rows
 * fall in the same month — last year's balance and April's installment both
 * read "Apr" (smoke 20 Oct) — when each is named instead.
 */
function rowNames(rows: NonNullable<Student360Props["installments"]>, tx: (p: Pair) => string): string[] {
  const month = (r: (typeof rows)[number]) => MONTHS[Number(r.dueDate.slice(5, 7)) - 1] ?? "";
  const seen = new Map<string, number>();
  for (const r of rows) seen.set(month(r), (seen.get(month(r)) ?? 0) + 1);
  return rows.map((r) => {
    if ((seen.get(month(r)) ?? 0) < 2) return month(r);
    if (r.carry) return tx(pair("Old", "पुराना"));
    const n = /(\d+)/.exec(r.label)?.[1];
    return n ? tx(pair(`Inst ${n}`, `किस्त ${n}`)) : r.label.split(/\s+/)[0]?.slice(0, 8) ?? month(r);
  });
}

/** An installment as the design shows it: status words, bar and its one-line story. */
function installmentLook(row: NonNullable<Student360Props["installments"]>[number], tx: (p: Pair) => string) {
  const overdue = row.state === "overdue";
  const charged = row.base;
  const left = Math.max(0, row.pending);
  const settled = Math.max(0, Math.min(charged, row.settled));
  const status: { label: Pair; short: Pair; bg: string; fg: string; bar: string } =
    row.status === "paid" || left === 0
      ? { label: T.stPaid, short: T.stPaid, bg: "var(--oks)", fg: "var(--ok)", bar: "var(--ok)" }
      : row.status === "waived"
        ? { label: T.stWaived, short: T.stWaived, bg: "var(--s3)", fg: "var(--mut)", bar: "var(--bds)" }
        : settled > 0 && overdue
          ? { label: T.stPartOverdue, short: T.stOverdue, bg: "var(--bads)", fg: "var(--bad)", bar: "var(--bad)" }
          : overdue
            ? { label: T.stOverdue, short: T.stOverdue, bg: "var(--bads)", fg: "var(--bad)", bar: "var(--bads)" }
            : settled > 0
              ? { label: T.stPart, short: T.stPart, bg: "var(--accs)", fg: "var(--accfg)", bar: "var(--acc)" }
              : { label: T.stUpcoming, short: T.stUpcoming, bg: "var(--s3)", fg: "var(--mut)", bar: "var(--bds)" };
  const width = left === 0 ? 100 : settled > 0 && charged > 0 ? (settled / charged) * 100 : overdue ? 100 : 0;
  const line = [
    left === 0 ? tx(T.paidInFull) : settled > 0 ? tx(T.paidLeft(rupees(settled), rupees(left))) : tx(T.toPay(rupees(left))),
    row.lateFeePending > 0 ? tx(T.lateFeeKeptApart(rupees(row.lateFeePending))) : null,
  ]
    .filter(Boolean)
    .join(" · ");
  const month = MONTHS[Number(row.dueDate.slice(5, 7)) - 1] ?? "";
  return { status, width, line, month, overdue, labelColor: overdue && left > 0 ? "var(--bad)" : "var(--mut)" };
}

/**
 * Student 360, with the fee side streamed in. The tab is held here, above
 * both renders, so a tab picked while the fees are still loading stays picked
 * when they land.
 */
export function Student360({ p, fees }: { p: Student360Props; fees?: Promise<Student360Fees | null> }) {
  const [pickedTab, setTab] = useState<StudentTab>(() => {
    // Back can reuse an Overview server model after a client-only tab pick.
    // The address is authoritative when this student's card mounts again.
    if (typeof window !== "undefined" && window.location.pathname === `/students/${p.id}`) {
      return parseTab(new URLSearchParams(window.location.search).get("tab"), p.tabs);
    }
    return p.tab;
  });
  const tab = parseTab(pickedTab, p.tabs);
  useEffect(() => {
    const restore = () => {
      if (window.location.pathname !== `/students/${p.id}`) return;
      setTab(parseTab(new URLSearchParams(window.location.search).get("tab"), p.tabs));
    };
    window.addEventListener("popstate", restore);
    return () => window.removeEventListener("popstate", restore);
  }, [p.id, p.tabs]);
  if (!fees) return <Student360View p={p} tab={tab} setTab={setTab} feesLoading={false} />;
  return (
    <Suspense fallback={<Student360View p={p} tab={tab} setTab={setTab} feesLoading />}>
      <WithFees p={p} fees={fees} tab={tab} setTab={setTab} />
    </Suspense>
  );
}

function WithFees({ p, fees, tab, setTab }: { p: Student360Props; fees: Promise<Student360Fees | null>; tab: StudentTab; setTab: (t: StudentTab) => void }) {
  const loaded = use(fees);
  const { unavailable: feesUnavailable, ...details } = loaded ?? {};
  return <Student360View p={loaded ? { ...p, ...details } : p} tab={tab} setTab={setTab} feesLoading={false} feesUnavailable={feesUnavailable === true} />;
}

function Student360View({ p, tab, setTab, feesLoading, feesUnavailable = false }: { p: Student360Props; tab: StudentTab; setTab: (t: StudentTab) => void; feesLoading: boolean; feesUnavailable?: boolean }) {
  const { tx, language } = useVx();
  const router = useRouter();
  const closeHref = studentReturnHref(p.returnTo);
  const close = useCloseTo(closeHref);
  const panel = useRef<HTMLElement>(null);
  const [more, setMore] = useState(false);
  const [asking, setAsking] = useState(false);
  // The sheets these open live outside the menus that open them, so closing a menu cannot unmount them.
  const photo = useRef<PhotoControlHandle>(null);
  const askDetails = useRef<AssignmentHandle>(null);
  const askMarks = useRef<AssignmentHandle>(null);
  useEffect(() => {
    panel.current?.focus({ preventScroll: true });
  }, []);

  const pick = useCallback(
    (next: StudentTab) => (event: React.MouseEvent<HTMLAnchorElement | HTMLButtonElement>) => {
      // A new tab or window still gets a real link.
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
      event.preventDefault();
      setTab(next);
      window.history.replaceState(window.history.state, "", studentProfileHref(p.id, p.returnTo, next));
    },
    [p.id, p.returnTo, setTab],
  );

  const mobile = mobileOf(p.phone);
  const siblings = (p.family ?? []).filter((m) => !m.self);
  // The newest term with anything to divide by; a term with no paper entered
  // yet is shown only when there is no other.
  const latest = [...p.terms].reverse().find((t) => t.percent !== null) ?? p.terms[p.terms.length - 1] ?? null;
  const latestLabel = latest ? provisionalLabel(latest.missing, latest.papers) : null;
  const seesMoney = p.tabs.includes("fees");
  const money = feesUnavailable ? null : p.money;
  const notesHref = `/notes?student=${p.id}`;
  const ringValue = seesMoney ? (money?.percent ?? 0) : (p.attendance.percent ?? 0);
  const ringLen = 2 * Math.PI * 44;
  const ringLenD = 2 * Math.PI * 38;
  const avaBg = "var(--accs)";
  // Active only when the record says so: an unread or unknown status is said plainly, never assumed.
  const status = p.status === "left" ? { tone: "mut" as Tone, label: T.left } : p.status === "inactive" ? { tone: "mut" as Tone, label: T.profileInactive } : p.status === "active" || p.status === "enrolled" ? { tone: "ok" as Tone, label: T.active } : { tone: "mut" as Tone, label: T.profileStatusUnknown };
  const meta = [p.classLabel, p.sr ? `SR ${p.sr}` : null, p.rollNo ? `${tx(T.roll)} ${p.rollNo}` : null].filter(Boolean).join(" · ");
  // Not overdue yet by the fee database, but due on this very day (UI-74).
  const dueToday = (p.installments ?? []).filter((r) => r.dueDate.slice(0, 10) === p.today && r.state !== "overdue" && r.pending > 0).reduce((s, r) => s + r.pending, 0);
  const pctText = seesMoney && money ? tx(T.yearFeesPaid(money.percent)) : null;
  const collectLabel = money && money.pendingToday > 0 ? tx(T.collectAmount(rupees(money.pendingToday))) : tx(T.collect);
  const payHref = `/payments?student=${p.id}`;
  const tabs = TAB_ORDER.filter((t) => p.tabs.includes(t));
  const unread = (key: string) => p.unavailable?.includes(key) ?? false;

  const kpis: { key: StudentTab; label: string; value: string; tone?: string }[] = [];
  if (seesMoney) kpis.push({ key: "fees", label: tx(T.pendingToday), value: feesLoading ? "…" : money ? rupees(money.pendingToday) : "—", tone: money && money.pendingToday > 0 ? "var(--bad)" : undefined });
  kpis.push({ key: "attendance", label: tx(T.tabAttendance), value: p.attendance.percent !== null ? `${p.attendance.percent}%` : "—" });
  if (p.tabs.includes("marks")) kpis.push({ key: "marks", label: latest?.term ?? tx(T.tabMarks), value: latest?.percent != null ? `${latest.percent}%` : "—", tone: latestLabel ? "var(--warnfg)" : undefined });
  const kpiRow = (where: "phone" | "desk") => (
    <div className={`s360-kpis ${where}${kpis.length === 2 ? " two" : ""}`}>
      {kpis.map((k) => (
        <button key={k.key} type="button" className="tap card s360-kpi" onClick={pick(k.key)}>
          <span>{k.label}</span>
          <span className="num" style={{ color: k.tone }}>{k.value}</span>
        </button>
      ))}
    </div>
  );

  const loadingCard = (
    <div className="card s360-card" role="status" aria-busy="true">
      <span className="sr">{tx(T.loadingFees)}</span>
      <Skel w="min(240px, 60%)" h={18} />
      <Skel w="100%" h={14} />
      <Skel w="80%" h={14} />
    </div>
  );
  const unreadCard = <div className="card s360-card"><p style={{ margin: 0, color: "var(--mut)" }}>{tx(T.couldNotRead)}</p></div>;

  /* ------------------------------------------------------------- overview */
  const rows = p.installments ?? [];
  const names = rowNames(rows, tx);
  const feesCardPhone = !seesMoney || feesUnavailable ? null : feesLoading ? loadingCard : money ? (
    <button type="button" className="tap card s360-card s360-m-only" onClick={pick("fees")}>
      <span className="s360-card-h"><span>{p.feeSession ? tx(T.feesFor(p.feeSession.replace("-", "–"))) : tx(T.tabFees)}</span><span style={{ fontSize: 13, fontWeight: 600, color: "var(--acc)" }}>{tx(T.ledger)}</span></span>
      {rows.length ? (
        <span style={{ display: "grid", gridTemplateColumns: `repeat(${rows.length}, minmax(0,1fr))`, gap: 6, width: "100%" }}>
          {rows.map((row, i) => {
            const look = installmentLook(row, tx);
            return (
              <span key={row.id} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <span className="s360-bar8"><span style={{ width: `${look.width.toFixed(0)}%`, background: look.status.bar, animationDelay: `${i * 80}ms` }} /></span>
                <span style={{ fontSize: 11, color: look.labelColor, fontWeight: 600 }}>{names[i]}</span>
              </span>
            );
          })}
        </span>
      ) : null}
      <span style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0,1fr))", gap: 8, width: "100%" }}>
        <span style={{ display: "flex", flexDirection: "column" }}><span className="s360-k">{tx(T.pendingToday)}</span><span className="num s360-v" style={{ color: money.pendingToday > 0 ? "var(--bad)" : undefined }}>{rupees(money.pendingToday)}</span></span>
        <span style={{ display: "flex", flexDirection: "column" }}><span className="s360-k">{tx(T.notDueYet)}</span><span className="num s360-v">{rupees(money.notDueYet)}</span>{dueToday > 0 ? <span className="s360-k">{tx(T.inclDueToday(rupees(dueToday)))}</span> : null}</span>
        <span style={{ display: "flex", flexDirection: "column" }}><span className="s360-k">{tx(T.paidShort)}</span><span className="num s360-v" style={{ color: "var(--ok)" }}>{rupees(money.paid)}</span></span>
      </span>
      {money.lateFee > 0 ? <span style={{ fontSize: 12, color: "var(--mut)" }}>{tx(T.lateFeeKeptApart(rupees(money.lateFee)))}</span> : null}
    </button>
  ) : (
    <div className="card s360-card s360-m-only"><p style={{ margin: 0, color: "var(--mut)" }}>{tx(T.noFeeRecord)}</p></div>
  );
  const installmentsCardDesk = !seesMoney || feesUnavailable ? null : feesLoading ? <div className="s360-d-only">{loadingCard}</div> : money ? (
    <button type="button" className="tap lift card s360-card s360-d-only" onClick={pick("fees")}>
      <span className="s360-card-h"><span>{tx(T.installments)}</span><span style={{ fontSize: 13, fontWeight: 600, color: "var(--acc)" }}>{tx(T.ledger)}</span></span>
      {rows.map((row, i) => {
        const look = installmentLook(row, tx);
        return (
          <span key={row.id} style={{ display: "grid", gridTemplateColumns: "minmax(34px, auto) minmax(0,1fr) 80px", gap: 10, alignItems: "center", width: "100%" }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: look.labelColor, whiteSpace: "nowrap" }}>{names[i]}</span>
            <span className="s360-bar8"><span style={{ width: `${look.width.toFixed(0)}%`, background: look.status.bar, animationDelay: `${i * 80}ms` }} /></span>
            <span className="pill" style={{ justifySelf: "end", background: look.status.bg, color: look.status.fg }}>{tx(look.status.short)}</span>
          </span>
        );
      })}
      {rows.length === 0 ? <span style={{ fontSize: 13, color: "var(--mut)" }}>{tx(T.noFeeRecord)}</span> : null}
    </button>
  ) : null;

  const heatCard = unread("attendance") || unread("calendar") ? unreadCard : (
    <button type="button" className="tap lift card s360-card" onClick={pick("attendance")}>
      <span className="s360-card-h">
        <span><span className="s360-m-only">{tx(T.attendanceLast4)}</span><span className="s360-d-only">{tx(T.lastWeeks)}</span></span>
        <span className="num" style={{ fontSize: 14, fontWeight: 700 }}>{p.attendance.percent !== null ? `${p.attendance.percent}%` : "—"}</span>
      </span>
      {p.attendance.counted === 0 ? <span style={{ fontSize: 13, color: "var(--mut)" }}>{tx(T.noAttendanceRecorded)}</span> : null}
      <span className="s360-heat" hidden={p.attendance.counted === 0}>
        {p.attendance.weeks.map((cell, i) => {
          const look = LOOK[cell.state];
          return (
            <span key={cell.day} title={dateLabel(cell.day)} className="num" style={{ background: look.bg, color: look.fg, border: cell.day === p.today ? "2px solid var(--pri)" : look.bd, animationDelay: `${i * 18}ms` }}>
              {cell.label}
            </span>
          );
        })}
      </span>
    </button>
  );

  const subjectsOf = (t: Student360Props["terms"][number] | null) => (t?.subjects ?? []).filter((s) => s.state !== "exempt");
  const marksCard = !p.tabs.includes("marks") ? null : unread("marks") ? unreadCard : latest ? (
    <button type="button" className="tap lift card s360-card" onClick={pick("marks")} style={{ gap: 9 }}>
      <span className="s360-card-h">
        <span>{latest.term}{latestLabel ? <Pill tone="warn" style={{ marginLeft: 8 }}>{tx(latestLabel)}</Pill> : null}</span>
        <span className="num" style={{ fontSize: 14, fontWeight: 700 }}>{latest.percent !== null ? `${latest.percent}%` : "—"}</span>
      </span>
      {subjectsOf(latest).length ? (
        subjectsOf(latest).map((s, i) => <SubjectBar key={s.subjectId} s={s} i={i} />)
      ) : (
        <span style={{ fontSize: 13, color: "var(--mut)" }}>{tx(T.noSubjectMarks)}</span>
      )}
    </button>
  ) : (
    <div className="card s360-card"><span style={{ fontSize: 15, fontWeight: 700 }}>{tx(T.tabMarks)}</span><span style={{ fontSize: 13, color: "var(--mut)" }}>{tx(T.noMarks)}</span></div>
  );

  const seesNotes = p.tabs.includes("notes");
  const openActions = seesNotes ? openSupportActions(p.notes) : [];
  const notesCard = !seesNotes ? null : (
    <div className="card s360-card" style={{ gap: 10 }}>
      <div className="s360-card-h" style={{ alignItems: "center" }}>
        <span>{tx(T.notesFromTeachers)}</span>
        <span className="s360-m-only">
          <span style={{ display: "flex", gap: 14 }}>
            <Link href={notesHref} className="tap" style={{ minHeight: 44, display: "flex", alignItems: "center", color: "var(--mut)", fontSize: 14, fontWeight: 600 }}>{tx(T.allNotes)}</Link>
            {p.canAddNote ? <Link href={`${notesHref}&sheet=add`} className="tap" style={{ minHeight: 44, display: "flex", alignItems: "center", color: "var(--acc)", fontSize: 14, fontWeight: 600 }}>{tx(T.speakNote)}</Link> : null}
          </span>
        </span>
        <Link href={p.canAddNote ? `${notesHref}&sheet=add` : notesHref} className="tap btn ghost s360-d-only" style={{ height: 32, color: "var(--acc)", fontSize: 13 }}>{tx(p.canAddNote ? T.allNotesSpeak : T.allNotes)}</Link>
      </div>
      {unread("notes") ? (
        <span style={{ fontSize: 13, color: "var(--mut)" }}>{tx(T.couldNotRead)}</span>
      ) : p.notes.length === 0 ? (
        <span style={{ fontSize: 13, color: "var(--mut)" }}>{tx(T.noNotesYet)}</span>
      ) : (
        p.notes.slice(0, 2).map((n) => (
          <Link key={n.id} href={`${notesHref}&note=${n.id}`} className="tap s360-note" style={{ color: "var(--fg)" }}>
            <span>{excerpt(n.body, 200)}</span>
            <span>{[n.by, dayMonth(n.createdAt), ...n.tags.map((tag) => tx(TAG_TEXT[tag]))].join(" · ")}</span>
          </Link>
        ))
      )}
      {!unread("notes") && p.notes.length > 0 ? (
        <ChildSummary
          childName={p.name}
          notes={p.notes}
          facts={[
            p.attendance.percent !== null ? `Attendance this session: ${Math.round(p.attendance.percent)}%` : "",
            latest && latest.percent !== null ? `${latest.term} result so far: ${Math.round(latest.percent)}%` : "",
          ].filter(Boolean)}
        />
      ) : null}
    </div>
  );
  const supportCard = openActions.length > 0 && !unread("notes") ? (
    <div className="card s360-card">
      <span style={{ fontSize: 15, fontWeight: 700 }}>{tx(T.support)}</span>
      {/* Every open action, worked here: the same notes the board and Today read (D-266). */}
      <SupportActions actions={openActions} today={p.today} notesHref={notesHref} />
    </div>
  ) : null;

  const overview = (
    <>
      {kpiRow("desk")}
      <div className={`s360-ov${seesMoney && !feesUnavailable ? "" : " one"}`}>
        {feesCardPhone}
        {installmentsCardDesk}
        {heatCard}
      </div>
      {marksCard}
      {notesCard}
      {supportCard}
      {seesMoney ? (
        <div className="s360-foot">
          <Ic n="shield" size={14} style={{ marginTop: 2 }} />
          <span>{tx(T.moneyFootnote)}</span>
        </div>
      ) : null}
    </>
  );

  let body: ReactNode;
  switch (tab) {
    case "overview":
      body = overview;
      break;
    case "fees":
      body = feesLoading ? loadingCard : feesUnavailable ? null : money && p.feeSummary ? (
        <FeesTab p={p} money={money} summary={p.feeSummary} collectLabel={collectLabel} payHref={payHref} />
      ) : (
        <div className="card s360-card"><p style={{ margin: 0, color: "var(--mut)" }}>{tx(T.noFeeRecord)}</p></div>
      );
      break;
    case "attendance":
      body = unread("attendance") || unread("rules") ? unreadCard : <AttendanceTab p={p} />;
      break;
    case "marks":
      body = unread("marks") ? unreadCard : <MarksTab p={p} />;
      break;
    case "family":
      body = <FamilyTab p={p} siblings={siblings} feesLoading={feesLoading} feesUnavailable={feesUnavailable} loadingCard={loadingCard} />;
      break;
    case "documents":
      body = (
        <div className="card" style={{ overflow: "hidden" }}>
          {unread("documents") ? (
            <p style={{ padding: 18, margin: 0 }}>{tx(T.couldNotRead)}</p>
          ) : p.documents.length === 0 ? (
            <EmptyState icon="file" title={tx(T.noDocuments)} action={p.canManageDocuments ? <Btn href={`/teach/student/${p.id}`}>{tx(T.manageDocuments)}</Btn> : undefined} />
          ) : (
            p.documents.map((d) => (
              <div key={d.id} className="s360-row">
                <span className="s360-sq40" style={{ background: "var(--s2)", color: "var(--pri)" }}><Ic n="fileText" size={18} /></span>
                <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
                  <span className="clip" style={{ fontSize: 15, fontWeight: 600 }}>{d.fileName}</span>
                  <span style={{ fontSize: 12, color: "var(--mut)" }}>{d.kind} · {d.size} · {dateLabel(d.createdAt)}{d.by ? ` · ${d.by}` : ""}</span>
                </span>
              </div>
            ))
          )}
        </div>
      );
      break;
    case "notes":
      body = (
        <>
          <div className="card s360-card" style={{ gap: 10 }}>
            <div className="s360-card-h" style={{ alignItems: "center" }}>
              <span>{tx(T.notesFromTeachers)}</span>
              <Link href={notesHref} className="tap" style={{ minHeight: 44, display: "flex", alignItems: "center", color: "var(--acc)", fontSize: 14, fontWeight: 600 }}>{tx(T.allNotes)}</Link>
            </div>
            {unread("notes") ? (
              <span style={{ fontSize: 13, color: "var(--mut)" }}>{tx(T.couldNotRead)}</span>
            ) : p.notes.length === 0 ? (
              <span style={{ fontSize: 13, color: "var(--mut)" }}>{tx(T.noNotesYet)}</span>
            ) : (
              p.notes.map((n) => (
                <Link key={n.id} href={`${notesHref}&note=${n.id}`} className="tap s360-note" style={{ color: "var(--fg)" }}>
                  <span>{n.body}</span>
                  <span>{[n.by, dayMonth(n.createdAt), ...n.tags.map((tag) => tx(TAG_TEXT[tag]))].join(" · ")}</span>
                </Link>
              ))
            )}
          </div>
          {supportCard}
        </>
      );
      break;
    case "history":
      body = (
        <div className="card" style={{ overflow: "hidden" }}>
          {unread("history") ? (
            <p style={{ padding: 18, margin: 0 }}>{tx(T.couldNotRead)}</p>
          ) : p.history.length === 0 ? (
            <EmptyState icon="history" title={tx(T.noHistory)} />
          ) : (
            p.history.map((h) => (
              <div key={h.id} className="s360-row">
                <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
                  <span style={{ fontSize: 15, fontWeight: 600 }}>{tx(h.label)}</span>
                  <span style={{ fontSize: 13, color: "var(--mut)", overflowWrap: "anywhere" }}>{h.from ?? "—"} → {h.to ?? "—"}</span>
                  <span style={{ fontSize: 12, color: "var(--sub)" }}>{dateLabel(h.at)}{h.by ? ` · ${h.by}` : ""}</span>
                </span>
                {h.blocked ? <Pill tone="warn">{tx(T.blocked)}</Pill> : null}
              </div>
            ))
          )}
        </div>
      );
      break;
    case "info":
      body = <InfoTab p={p} />;
      break;
  }

  // A row either goes somewhere or opens a sheet that outlives the menu.
  type Launch = "photo" | "details" | "marks";
  const launch = (what: Launch) => {
    if (what === "photo") photo.current?.open();
    else (what === "marks" ? askMarks : askDetails).current?.show();
  };
  const moreItems: ({ label: Pair; icon: "send" | "edit" | "file" | "note" | "receipt" | "camera" | "users" | "book" } & ({ href: string; run?: never } | { run: Launch; href?: never }))[] = [];
  if (p.canEditPhoto) moreItems.push({ label: photoWords.edit, icon: "camera", run: "photo" });
  // The same words as the desk's "Ask a teacher" button and its two choices (smoke 20 Oct:
  // the phone called it "Request details from a teacher").
  const askAs = (what: Pair): Pair => pair(`${ms.taskAsk.en}: ${what.en}`, `${ms.taskAsk.hi}: ${what.hi ?? what.en}`);
  if (p.canAssignTasks) moreItems.push({ label: askAs(ms.taskAskDetails), icon: "users", run: "details" });
  if (p.canAssignTasks) moreItems.push({ label: askAs(ms.taskAskMarks), icon: "book", run: "marks" });
  if (p.canAddNote) moreItems.push({ label: T.addNote, href: `${notesHref}&sheet=add`, icon: "note" });
  if (seesMoney) moreItems.push({ label: T.statement, href: `/fees/students/${p.id}/statement`, icon: "send" });
  if (seesMoney) moreItems.push({ label: T.fullFeeRecord, href: `/fees/students/${p.id}?tab=dues`, icon: "receipt" });
  if (p.canManageFees) moreItems.push({ label: T.editDetails, href: `/fees/students/${p.id}/edit`, icon: "edit" });
  if (p.tabs.includes("documents")) moreItems.push({ label: T.tabDocuments, href: studentProfileHref(p.id, p.returnTo, "documents"), icon: "file" });

  return (
    <div className="vxt s360-layer">
      <button type="button" className="s360-scrim" aria-label={tx(T.closeStudent)} onClick={close} />
      <section
        ref={panel}
        className="vx s360"
        role="dialog"
        aria-modal="true"
        aria-label={`${tx(T.student360)} · ${p.name}`}
        tabIndex={-1}
        onKeyDown={(event) => {
          if (event.key === "Escape" && !more) {
            event.stopPropagation();
            close();
          }
        }}
      >
        <div className="s360-top">
          <CloseLink fallback={closeHref} className="tap s360-round" label={tx(T.back)}>
            <Ic n="chevLeft" size={24} />
          </CloseLink>
          <span>{tx(T.student360)}</span>
          {moreItems.length ? (
            <button type="button" className="tap s360-round" aria-label={tx(T.moreActions)} onClick={() => setMore(true)}>
              <Ic n="more" size={20} />
            </button>
          ) : (
            <span style={{ width: 44 }} />
          )}
        </div>

        <header className="s360-head">
          <div className="s360-id">
            <div className="s360-ring">
              <svg viewBox="0 0 96 96" width="100%" height="100%" aria-hidden="true" className="s360-m-only">
                <circle cx="48" cy="48" r="44" style={{ fill: "none", stroke: "var(--s3)", strokeWidth: 6 }} />
                <circle className="arc" cx="48" cy="48" r="44" style={{ fill: "none", stroke: "var(--acc)", strokeWidth: 6, strokeLinecap: "round", strokeDasharray: ringLen, strokeDashoffset: ringLen * (1 - Math.min(100, Math.max(0, ringValue)) / 100), ["--len" as string]: ringLen } as CSSProperties} />
              </svg>
              <svg viewBox="0 0 84 84" width="100%" height="100%" aria-hidden="true" className="s360-d-only">
                <circle cx="42" cy="42" r="38" style={{ fill: "none", stroke: "var(--s3)", strokeWidth: 5 }} />
                <circle className="arc" cx="42" cy="42" r="38" style={{ fill: "none", stroke: "var(--acc)", strokeWidth: 5, strokeLinecap: "round", strokeDasharray: ringLenD, strokeDashoffset: ringLenD * (1 - Math.min(100, Math.max(0, ringValue)) / 100), ["--len" as string]: ringLenD } as CSSProperties} />
              </svg>
              <StudentFace name={p.name} url={p.photoUrl} bg={avaBg} />
              {p.canEditPhoto ? (
                <button type="button" className="tap s360-cam" aria-label={tx(photoWords.edit)} title={tx(photoWords.edit)} onClick={() => launch("photo")}>
                  <Ic n="camera" size={16} />
                </button>
              ) : null}
            </div>
            <div className="s360-who">
              <h1 className="serif s360-name">{p.name}</h1>
              <span className="s360-meta">
                {meta}
                {pctText ? <span className="s360-d-only">{` · ${pctText}`}</span> : null}
              </span>
              <div className="s360-chips">
                <Pill tone={status.tone}>{tx(status.label)}</Pill>
                {p.route ? <Pill tone="info">{tx(T.bus(p.route))}</Pill> : null}
                {siblings.length > 0 ? <span className="pill" style={{ background: "var(--s3)", color: "var(--fg)" }}>{tx(T.siblings(siblings.length))}</span> : null}
              </div>
              {pctText ? <span className="s360-pct">{pctText}</span> : null}
            </div>
            <CloseLink fallback={closeHref} className="tap btn ghost s360-x" label={tx(T.close360)}>
              <Ic n="x" size={20} />
            </CloseLink>
          </div>
          <div className="s360-acts">
            {p.canCollect ? <Btn variant="pri" icon="rupee" href={payHref}>{collectLabel}</Btn> : null}
            {mobile ? <Btn icon="phone" href={`tel:${mobile}`} style={{ color: "var(--info)" }}>{tx(T.call)}</Btn> : null}
            {mobile ? <Btn icon="message" href={`https://wa.me/91${mobile}`} target="_blank" style={{ color: "var(--ok)" }}>{tx(T.whatsapp)}</Btn> : null}
            {seesMoney ? <Btn icon="send" href={`/fees/students/${p.id}/statement`}>{tx(T.statement)}</Btn> : null}
            {!p.canCollect && p.canAddNote ? <Btn icon="note" href={`${notesHref}&sheet=add`}>{tx(T.addNote)}</Btn> : null}
            {p.canAssignTasks ? <Btn icon="users" onClick={() => setAsking(true)}>{tx(ms.taskAsk)}</Btn> : null}
          </div>
          {kpiRow("phone")}
          <nav className="s360-tabs" aria-label={tx(T.studentSections)}>
            {tabs.map((t) => (
              <a key={t} href={studentProfileHref(p.id, p.returnTo, t)} onClick={pick(t)} className={`tap chip${tab === t ? " on" : ""}`} aria-current={tab === t ? "page" : undefined}>
                {tx(TAB_LABEL[t])}
              </a>
            ))}
          </nav>
        </header>

        <div className="s360-body" key={tab}>
          {feesUnavailable || (p.unavailable?.length ?? 0) > 0 ? (
            <div className="card s360-card" role="alert">
              <p style={{ margin: 0 }}>{tx(feesUnavailable ? T.feesUnavailable : T.couldNotRead)}</p>
              <span><Btn variant="sec" onClick={() => router.refresh()}>{tx(T.retryFees)}</Btn></span>
            </div>
          ) : null}
          {body}
        </div>

      </section>

      {/* Beside the panel, not in it: the panel is a size container that scrolls,
          and a fixed bar inside it would scroll with it. */}
      <div className="s360-bar">
        {mobile ? (
          <>
            <a href={`tel:${mobile}`} className="tap sq" aria-label={tx(T.callParent)} style={{ color: "var(--info)" }}><Ic n="phone" size={20} /></a>
            <a href={`https://wa.me/91${mobile}`} target="_blank" rel="noreferrer" className="tap sq" aria-label={tx(T.whatsappParent)} style={{ color: "var(--ok)" }}><Ic n="message" size={20} /></a>
          </>
        ) : null}
        {p.canCollect ? (
          <Link href={payHref} className="tap btn pri go"><Ic n="rupee" size={20} />{collectLabel}</Link>
        ) : p.canAddNote ? (
          <Link href={`${notesHref}&sheet=add`} className="tap btn pri go"><Ic n="note" size={20} />{tx(T.addNote)}</Link>
        ) : null}
      </div>

      <Sheet open={more} onClose={() => setMore(false)} title={p.name} sub={meta}>
        <div style={{ display: "flex", flexDirection: "column", gap: 8, padding: "4px 0 8px" }}>
          {moreItems.map(({ run, ...item }) =>
            run ? (
              <Btn key={item.label.en} icon={item.icon} full onClick={() => { setMore(false); launch(run); }}>{tx(item.label)}</Btn>
            ) : (
              <Btn key={item.href} icon={item.icon} href={item.href} full>{tx(item.label)}</Btn>
            ),
          )}
        </div>
      </Sheet>

      {/* The desk has no ⋯ menu; "Ask a teacher" there opens this choice. */}
      <Sheet open={asking} onClose={() => setAsking(false)} title={tx(ms.taskAsk)} sub={tx(ms.taskAskSub)} icon="users">
        <div style={{ display: "flex", flexDirection: "column", gap: 8, padding: "4px 0 8px" }}>
          <Btn icon="users" full onClick={() => { setAsking(false); launch("details"); }}>{tx(ms.taskAskDetails)}</Btn>
          <Btn icon="book" full onClick={() => { setAsking(false); launch("marks"); }}>{tx(ms.taskAskMarks)}</Btn>
        </div>
      </Sheet>
      {p.canEditPhoto ? <ProfilePhotoControl ref={photo} sheet trigger={null} credential={{ kind: "student", id: p.id }} language={language} /> : null}
      {p.canAssignTasks ? (
        <>
          <AssignmentLauncher ref={askDetails} trigger={null} language={language} selectedIds={[p.id]} />
          <AssignmentLauncher ref={askMarks} trigger={null} language={language} selectedIds={[p.id]} initialKind="marks" />
        </>
      ) : null}
    </div>
  );
}

/** The child's face in the ring: the school photograph when there is one, the initials otherwise. */
function StudentFace({ name, url, bg }: { name: string; url?: string | null; bg: string }) {
  const [failed, setFailed] = useState<string | null>(null);
  const { tx } = useVx();
  return (
    <span className="serif s360-ava" style={{ background: bg, color: "var(--accfg)" }}>
      {url && failed !== url ? (
        // Signed private URLs are short-lived; do not cache them in an image proxy.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt={tx(T.studentPortrait(name))} onError={() => setFailed(url)} />
      ) : (
        <span role="img" aria-label={tx(T.studentInitials(name))}>{initials(name)}</span>
      )}
    </span>
  );
}

function SubjectBar({ s, i, big = false }: { s: NonNullable<Student360Props["terms"][number]["subjects"]>[number]; i: number; big?: boolean }) {
  const { tx } = useVx();
  const pct = s.percent;
  const color = pct !== null && pct < 60 ? "var(--warn)" : "var(--pri)";
  return (
    <span className="s360-marks" style={big ? { gridTemplateColumns: "82px minmax(0,1fr) 30px" } : undefined}>
      <span style={big ? { fontSize: 14 } : undefined}>{tx({ en: s.en, hi: s.hi })}</span>
      <span className="s360-bar8" style={big ? { height: 10, borderRadius: 5 } : undefined}>
        <span style={{ width: `${pct ?? 0}%`, background: color, animationDelay: `${i * 60}ms` }} />
      </span>
      <span className="num" style={{ color: pct !== null ? color : "var(--mut)", ...(big ? { fontSize: 14 } : null) }}>
        {pct !== null ? pct : s.state === "absent" ? "AB" : "—"}
      </span>
    </span>
  );
}

/** A parent's number as the design shows it on screen (98••• ••246); Call and WhatsApp still dial the whole number. */
function maskPhone(phone: string | null): string | null {
  const digits = (phone ?? "").replace(/D/g, "");
  if (digits.length < 7) return phone;
  const last10 = digits.slice(-10);
  return `${last10.slice(0, 2)}••• ••${last10.slice(-3)}`;
}

const MODE_LABEL: Record<string, string> = { cash: "Cash", upi: "UPI", bank_transfer: "Bank transfer", cheque: "Cheque", discount: "Written off", online: "Online (Razorpay)" };

/**
 * Fees, as the design draws it: on a phone the ring with pending today and
 * the year's story, Collect and Statement, then the installments and the
 * receipts; on a desk four figures, the installment table and the receipts.
 * The late fee is its own line on every installment that has one, and the
 * fee breakup the fee app shows follows below, unchanged in what it says.
 */
function FeesTab({ p, money, summary, collectLabel, payHref }: { p: Student360Props; money: StudentMoney; summary: StudentFeeSummary; collectLabel: string; payHref: string }) {
  const { tx } = useVx();
  const rows = p.installments ?? [];
  const receipts = p.receipts ?? [];
  const breakup = p.feeBreakup;
  const total = summary.sessionFee;
  const ringLen = 2 * Math.PI * 26;
  const pct = Math.min(100, Math.max(0, money.percent));
  return (
    <>
      <div className="card s360-card s360-m-only">
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <svg width="64" height="64" viewBox="0 0 64 64" aria-hidden="true" style={{ flex: "none", transform: "rotate(-90deg)" }}>
            <circle cx="32" cy="32" r="26" style={{ fill: "none", stroke: "var(--s3)", strokeWidth: 8 }} />
            <circle className="arc" cx="32" cy="32" r="26" style={{ fill: "none", stroke: "var(--acc)", strokeWidth: 8, strokeLinecap: "round", strokeDasharray: ringLen, strokeDashoffset: ringLen * (1 - pct / 100), animation: "xDraw 1s var(--ease) both", ["--len" as string]: ringLen } as CSSProperties} />
          </svg>
          <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
            <span style={{ fontSize: 12, color: "var(--mut)" }}>{tx(T.pendingToday)}</span>
            <span className="num" style={{ fontSize: 28, fontWeight: 700, lineHeight: 1.1, color: money.pendingToday > 0 ? "var(--bad)" : undefined }}>{rupees(money.pendingToday)}</span>
            <span className="num" style={{ fontSize: 13, color: "var(--mut)" }}>{tx(T.paidOfTotal(rupees(money.paid), rupees(total), rupees(money.notDueYet)))}</span>
            {money.lateFee > 0 ? <span style={{ fontSize: 13, color: "var(--mut)" }}>{tx(T.lateFeeKeptApart(rupees(money.lateFee)))}</span> : null}
          </div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          {p.canCollect ? <Link href={payHref} className="tap btn pri" style={{ flex: 1 }}>{collectLabel}</Link> : null}
          <Link href={`/fees/students/${p.id}/statement`} className="tap btn sec" style={{ flex: 1 }}><Ic n="send" size={18} />{tx(T.statement)}</Link>
        </div>
      </div>

      <div className="s360-kpis desk" style={{ gridTemplateColumns: "repeat(4, minmax(0,1fr))" }}>
        {[
          { k: T.pendingToday, v: rupees(money.pendingToday), tone: money.pendingToday > 0 ? "var(--bad)" : undefined },
          { k: T.notDueYet, v: rupees(money.notDueYet) },
          { k: T.paidShort, v: rupees(money.paid), tone: "var(--ok)" },
          { k: T.yearTotal, v: rupees(total) },
        ].map((x) => (
          <div key={x.k.en} className="card s360-kpi" style={{ cursor: "default" }}>
            <span>{tx(x.k)}</span>
            <span className="num" style={{ color: x.tone, fontSize: 20 }}>{x.v}</span>
          </div>
        ))}
      </div>
      {money.lateFee > 0 ? <span className="s360-d-only" style={{ fontSize: 13, color: "var(--mut)" }}>{tx(T.lateFeeKeptApart(rupees(money.lateFee)))}</span> : null}

      <h2 className="sech s360-m-only" style={{ padding: "6px 4px 0" }}>{tx(T.installments)}</h2>
      <div className="card" style={{ overflow: "hidden" }}>
        {rows.length === 0 ? <p style={{ margin: 0, padding: 16, fontSize: 13, color: "var(--mut)" }}>{tx(T.noFeeRecord)}</p> : null}
        <div className="s360-d-only" hidden={rows.length === 0}>
          <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1.4fr) 90px 100px minmax(0,1fr) 140px", gap: 10, padding: "10px 16px", background: "var(--s2)", borderBottom: "1px solid var(--bd)" }}>
            <span className="sech">{tx(T.colInstallment)}</span>
            <span className="sech">{tx(T.colDueDate)}</span>
            <span className="sech" style={{ textAlign: "right" }}>{tx(T.amount)}</span>
            <span className="sech">{tx(T.colPaid)}</span>
            <span className="sech" style={{ textAlign: "right" }}>{tx(T.colStatus)}</span>
          </div>
          {rows.map((row, i) => {
            const look = installmentLook(row, tx);
            return (
              <div key={row.id} style={{ display: "grid", gridTemplateColumns: "minmax(0,1.4fr) 90px 100px minmax(0,1fr) 140px", gap: 10, alignItems: "center", padding: "12px 16px", borderTop: i ? "1px solid var(--bd)" : 0 }}>
                <span style={{ fontSize: 14, fontWeight: 600 }}>{row.label}{row.carry ? <span style={{ display: "block", fontSize: 11.5, color: "var(--mut)", fontWeight: 500 }}>{tx(T.carryForward)}</span> : null}</span>
                <span style={{ fontSize: 13, color: "var(--mut)" }}>{dayMonth(row.dueDate)}</span>
                <span className="num" style={{ fontSize: 14, textAlign: "right" }}>{rupees(row.base)}</span>
                <span style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  <span className="s360-bar8" style={{ height: 6 }}><span style={{ width: `${look.width.toFixed(0)}%`, background: look.status.bar, animationDelay: `${i * 80}ms` }} /></span>
                  <span className="num" style={{ fontSize: 11, color: "var(--mut)" }}>{look.line}</span>
                </span>
                <span className="pill" style={{ justifySelf: "end", background: look.status.bg, color: look.status.fg }}>{tx(look.status.label)}</span>
              </div>
            );
          })}
        </div>
        <div className="s360-m-only">
          {rows.map((row, i) => {
            const look = installmentLook(row, tx);
            return (
              <div key={row.id} style={{ padding: "14px 16px", borderTop: i ? "1px solid var(--bd)" : 0, display: "flex", flexDirection: "column", gap: 8 }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                  <span style={{ display: "flex", flexDirection: "column" }}>
                    <span style={{ fontSize: 15, fontWeight: 600 }}>{row.label}</span>
                    <span style={{ fontSize: 12, color: "var(--mut)" }}>{tx(T.dueOn(dayMonth(row.dueDate), rupees(row.base)))}</span>
                  </span>
                  <span className="pill" style={{ background: look.status.bg, color: look.status.fg }}>{tx(look.status.label)}</span>
                </div>
                <div className="s360-bar8" style={{ height: 6 }}><span style={{ width: `${look.width.toFixed(0)}%`, background: look.status.bar, animationDelay: `${i * 80}ms` }} /></div>
                <span className="num" style={{ fontSize: 12, color: "var(--mut)" }}>{look.line}</span>
              </div>
            );
          })}
        </div>
      </div>

      <h2 className="sech" style={{ padding: "6px 4px 0" }}>{tx(T.receipts)}</h2>
      <div className="card" style={{ overflow: "hidden" }}>
        {receipts.length === 0 ? (
          <div style={{ padding: 16, fontSize: 13, color: "var(--mut)" }}>{tx(T.noReceipts)}</div>
        ) : (
          receipts.map((r) => (
            <div key={r.id} className="s360-row">
              <span className="s360-sq40" style={{ background: "var(--s2)", color: "var(--pri)" }}><Ic n="receipt" size={18} /></span>
              <Link href={`/receipts/${encodeURIComponent(r.number)}`} className="tap" style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", color: "var(--fg)" }}>
                <span style={{ fontSize: 15, fontWeight: 600, display: "flex", alignItems: "center", gap: 6 }}>
                  <span className="num">{r.number}</span>
                  {r.reversed ? <Pill tone="bad">{tx(T.reversed)}</Pill> : null}
                </span>
                <span style={{ fontSize: 12, color: "var(--mut)" }}>{dayMonth(r.date)} · {MODE_LABEL[r.mode] ?? r.mode}</span>
              </Link>
              <span className="num" style={{ fontSize: 15, fontWeight: 700, textDecoration: r.reversed ? "line-through" : undefined }}>{rupees(r.amount)}</span>
              {!r.reversed ? (
                <Link href={`/receipts/${encodeURIComponent(r.number)}`} className="tap btn soft s360-d-only" style={{ height: 34, fontSize: 13 }}>
                  <Ic n="send" size={15} />{tx(T.sendReceipt)}
                </Link>
              ) : null}
              {!r.reversed ? (
                <Link href={`/receipts/${encodeURIComponent(r.number)}`} aria-label={tx(T.sendReceiptTo)} className="tap s360-m-only" style={{ flex: "none", width: 44, height: 44, borderRadius: 22, background: "var(--oks)", color: "var(--ok)" }}>
                  <span style={{ display: "flex", width: 44, height: 44, alignItems: "center", justifyContent: "center" }}><Ic n="send" size={18} /></span>
                </Link>
              ) : null}
            </div>
          ))
        )}
      </div>

      {breakup ? (
        <div className="card" style={{ overflow: "hidden" }}>
          <div className="s360-card" style={{ paddingBottom: 8 }}>
            <span className="s360-card-h">
              <span>{tx(T.feeBreakup)}</span>
              {p.canManageFees ? <Link href={`/fees/students/${p.id}?tab=fee-plan`} style={{ color: "var(--acc)", fontWeight: 600, fontSize: 13 }}>{tx(T.waiveOrEdit)}</Link> : null}
            </span>
            <span style={{ fontSize: 12, color: "var(--mut)" }}>{tx(T.profileConcessions)}</span>
          </div>
          {breakup.rows.map((row) => (
            <div key={row.id} style={{ display: "flex", justifyContent: "space-between", gap: 12, padding: "10px 16px", borderTop: "1px solid var(--bd)", background: row.kind === "discount" ? "var(--accs)" : undefined, fontSize: 14 }}>
              <span>{row.label}</span>
              <span className="num" style={{ fontWeight: 600 }}>{row.amount < 0 ? `−${rupees(Math.abs(row.amount))}` : rupees(row.amount)}</span>
            </div>
          ))}
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, padding: "10px 16px", borderTop: "1px solid var(--bd)", background: "var(--s2)", fontSize: 14, fontWeight: 700 }}>
            <span>{tx(T.annualTotal)}</span>
            <span className="num">{rupees(breakup.annualTotal)}</span>
          </div>
          {summary.lateFeeWaived > 0 ? (
            <div style={{ padding: "10px 16px", borderTop: "1px solid var(--bd)", fontSize: 13, color: "var(--mut)" }}>{tx(T.lateFeeWaivedSoFar)} · <span className="num">{rupees(summary.lateFeeWaived)}</span></div>
          ) : null}
        </div>
      ) : null}
      <Link href={`/fees/students/${p.id}?tab=dues`} style={{ alignSelf: "flex-start", color: "var(--acc)", fontWeight: 600, fontSize: 14, minHeight: 44, display: "flex", alignItems: "center" }}>{tx(T.fullFeeRecord)}</Link>
    </>
  );
}

/** This month's register, as the design's attendance tab draws it, and the latest absence. */
function AttendanceTab({ p }: { p: Student360Props }) {
  const { tx, language } = useVx();
  // Without the school calendar a closed day cannot be told from an unmarked one: no cells then.
  const month = p.unavailable?.includes("calendar") ? undefined : p.attendance.month;
  const noCalendar = p.unavailable?.includes("calendar") ?? false;
  const head = language === "hi" ? ["सो", "मं", "बु", "गु", "शु", "श", "र"] : ["M", "T", "W", "T", "F", "S", "S"];
  const title = month ? new Date(`${month.month}-01T12:00:00Z`).toLocaleString(language === "hi" ? "hi-IN" : "en-IN", { month: "long", year: "numeric", timeZone: "UTC" }) : tx(T.lastWeeks);
  return (
    <>
      <div className="card s360-card">
        <div className="s360-card-h">
          <span style={{ fontSize: 16, fontWeight: 700 }}>{title}</span>
          {month ? <span className="num" style={{ fontSize: 13, color: "var(--mut)" }}>{tx(T.monthDays(month.present, month.marked, month.percent))}</span> : null}
        </div>
        {month ? (
          <div className="s360-cal">
            {head.map((h, i) => <span key={`h${i}`} className="h">{h}</span>)}
            {month.cells.map((cell, i) => {
              const look = LOOK[cell.state];
              return (
                <span key={cell.day ?? `b${i}`} title={cell.day ? dateLabel(cell.day) : undefined} className="num" style={{ background: look.bg, color: look.fg, border: cell.day === p.today ? "2px solid var(--pri)" : look.bd, animationDelay: `${i * 12}ms` }}>
                  {cell.label}
                </span>
              );
            })}
          </div>
        ) : noCalendar ? (
          <p style={{ margin: 0, color: "var(--mut)" }}>{tx(T.couldNotRead)}</p>
        ) : (
          <div className="s360-heat">
            {p.attendance.weeks.map((cell) => {
              const look = LOOK[cell.state];
              return <span key={cell.day} title={dateLabel(cell.day)} className="num" style={{ background: look.bg, color: look.fg, border: look.bd }}>{cell.label}</span>;
            })}
          </div>
        )}
        <div className="s360-legend">
          <span><i style={{ background: "var(--okm)" }} />{tx(T.present)}</span>
          <span><i style={{ background: "var(--bad)" }} />{tx(T.absent)}</span>
          <span><i style={{ background: "var(--warnm)" }} />{tx(T.halfDay)}</span>
          <span><i style={{ background: "var(--s3)" }} />{tx(T.holidaySunday)}</span>
        </div>
      </div>
      <div className="card s360-card" style={{ flexDirection: "row", alignItems: "center", padding: "14px 16px" }}>
        <span className="s360-sq40" style={{ background: month?.lastAbsent ? "var(--bads)" : "var(--oks)", color: month?.lastAbsent ? "var(--bad)" : "var(--ok)" }}>
          <Ic n={month?.lastAbsent ? "alert" : "check"} size={18} />
        </span>
        <span style={{ display: "flex", flexDirection: "column" }}>
          <span style={{ fontSize: 14, fontWeight: 600 }}>{month?.lastAbsent ? tx(T.absentOn(dateLabel(month.lastAbsent))) : tx(T.noAbsenceThisMonth)}</span>
          <span style={{ fontSize: 13, color: "var(--mut)" }}>
            {p.attendance.percent !== null ? tx(T.sessionSoFar(p.attendance.percent)) : tx(T.noAttendanceYet)}
            {p.attendance.counted ? ` · ${tx(T.daysCounted(p.attendance.counted))}` : ""}
          </span>
        </span>
      </div>
    </>
  );
}

/** Marks: one term at a time on the design's segmented control, subject by subject. */
function MarksTab({ p }: { p: Student360Props }) {
  const { tx } = useVx();
  const usable = p.terms.filter((t) => t.percent !== null || (t.subjects ?? []).some((s) => s.state === "value"));
  const list = usable.length ? usable : p.terms;
  const [picked, setPicked] = useState(list.length - 1);
  const term = list[Math.min(picked, list.length - 1)] ?? null;
  if (!term) return <div className="card s360-card"><span style={{ fontSize: 13, color: "var(--mut)" }}>{tx(T.noMarks)}</span></div>;
  const label = provisionalLabel(term.missing, term.papers);
  const subjects = (term.subjects ?? []).filter((s) => s.state !== "exempt");
  const shown = list.slice(-2);
  const offset = list.length - shown.length;
  return (
    <>
      {shown.length > 1 ? (
        <div className="seg" style={{ gridTemplateColumns: `repeat(${shown.length}, minmax(0,1fr))`, borderRadius: 16, padding: 4 }}>
          <span className="thumb" aria-hidden="true" style={{ top: 4, bottom: 4, left: 4, borderRadius: 12, width: `calc((100% - 8px) / ${shown.length})`, transform: `translateX(${(picked - offset) * 100}%)` }} />
          {shown.map((t, i) => (
            <button key={t.term} type="button" aria-pressed={picked === offset + i} className={picked === offset + i ? "on" : ""} onClick={() => setPicked(offset + i)} style={{ height: 40 }}>
              {t.term}
            </button>
          ))}
        </div>
      ) : null}
      <div className="card s360-card" style={{ gap: 11 }}>
        <div className="s360-card-h">
          <span>{term.term}{label ? <Pill tone="warn" style={{ marginLeft: 8 }}>{tx(label)}</Pill> : null}</span>
          <span className="num" style={{ fontSize: 22, fontWeight: 700 }}><span>{term.percent !== null ? `${term.percent}%` : "—"}</span>{term.grade ? <span style={{ fontSize: 14, color: "var(--mut)", marginLeft: 6 }}>{term.grade}</span> : null}</span>
        </div>
        {subjects.length ? subjects.map((s, i) => <SubjectBar key={s.subjectId} s={s} i={i} big />) : <span style={{ fontSize: 13, color: "var(--mut)" }}>{tx(T.noSubjectMarks)}</span>}
        <span style={{ fontSize: 12, color: "var(--mut)" }}>{tx(T.marksFootnote)}</span>
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <Link href={`/exams/report-card?student=${p.id}&term=${encodeURIComponent(term.term)}`} target="_blank" className="tap btn sec" style={{ flex: 1 }}>
          <Ic n="receipt" size={18} />{tx(T.reportCard)}
        </Link>
      </div>
    </>
  );
}

/** Family: the parents with Call and WhatsApp, the brothers and sisters in school, and the contact log (D-265). */
function FamilyTab({ p, siblings, feesLoading, feesUnavailable, loadingCard }: { p: Student360Props; siblings: NonNullable<Student360Props["family"]>; feesLoading: boolean; feesUnavailable: boolean; loadingCard: ReactNode }) {
  const { tx } = useVx();
  const mobile = mobileOf(p.phone);
  const parents: [Pair, string][] = [];
  if (p.father) parents.push([T.father, p.father]);
  if (p.mother) parents.push([T.mother, p.mother]);
  const seesFamily = p.family !== null || feesLoading || feesUnavailable;
  // Only when every child's figures were read: a total over some of them is not a family total.
  const members = p.family ?? [];
  const familyTotal = siblings.length > 0 && members.every((m) => m.total != null && m.paid != null && m.remaining != null)
    ? members.reduce((sum, m) => ({ total: sum.total + (m.total ?? 0), paid: sum.paid + (m.paid ?? 0), remaining: sum.remaining + (m.remaining ?? 0) }), { total: 0, paid: 0, remaining: 0 })
    : null;
  return (
    <>
      {parents.length ? (
        <div className="card" style={{ overflow: "hidden" }}>
          {parents.map(([role, name]) => (
            <div key={role.en} className="s360-row">
              <span style={{ flex: "none", width: 42, height: 42, borderRadius: 21, background: "var(--s3)", color: "var(--fg)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, fontWeight: 700 }}>{initials(name)}</span>
              <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
                <span className="clip" style={{ fontSize: 15, fontWeight: 600 }}>{name}</span>
                <span style={{ fontSize: 12, color: "var(--mut)" }}>{tx(T.parentRole(role, maskPhone(p.phone)))}</span>
              </span>
              {mobile ? (
                <>
                  <a href={`tel:${mobile}`} aria-label={tx(T.callName(name))} className="tap" style={{ flex: "none", width: 44, height: 44, borderRadius: 22, background: "var(--infos)", color: "var(--info)", display: "flex", alignItems: "center", justifyContent: "center" }}><Ic n="phone" size={18} /></a>
                  <a href={`https://wa.me/91${mobile}`} target="_blank" rel="noreferrer" aria-label={tx(T.whatsappName(name))} className="tap" style={{ flex: "none", width: 44, height: 44, borderRadius: 22, background: "var(--oks)", color: "var(--ok)", display: "flex", alignItems: "center", justifyContent: "center" }}><Ic n="message" size={18} /></a>
                </>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}
      {seesFamily ? (
        <>
          <h2 className="sech" style={{ padding: "6px 4px 0" }}>{tx(T.siblingsInSchool)}</h2>
          {feesLoading ? loadingCard : feesUnavailable ? null : siblings.length === 0 ? (
            <div className="card s360-card" style={{ flexDirection: "row", alignItems: "center" }}>
              <span style={{ fontSize: 13, color: "var(--mut)" }}>{tx(T.noSiblingsLinked)}</span>
            </div>
          ) : (
            siblings.map((m) => (
              <Link key={m.id} href={studentProfileHref(m.id, p.returnTo)} className="tap card s360-row" style={{ color: "var(--fg)", padding: "12px 14px" }}>
                <span style={{ flex: "none", width: 46, height: 46, borderRadius: 23, background: "var(--warns)", color: "var(--warnfg)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 15, fontWeight: 700 }}>{initials(m.name)}</span>
                <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
                  <span className="clip" style={{ fontSize: 15, fontWeight: 600 }}>{m.name}</span>
                  <span style={{ fontSize: 12, color: "var(--mut)" }}>{m.classLabel} · SR {m.sr}</span>
                </span>
                {m.remaining != null ? <span className="num" style={{ fontSize: 14, fontWeight: 700, color: m.remaining > 0 ? "var(--mut)" : "var(--ok)" }}>{m.remaining > 0 ? tx(T.leftThisYear(rupees(m.remaining))) : tx(T.paidInFull)}</span> : null}
                <Ic n="chevRight" size={18} style={{ color: "var(--mut)" }} />
              </Link>
            ))
          )}
        </>
      ) : null}
      {!feesLoading && !feesUnavailable && familyTotal ? (
        <div className="card s360-card">
          <span style={{ fontSize: 15, fontWeight: 700 }}>{tx(T.familyTotal)}</span>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0,1fr))", gap: 8 }}>
            <span style={{ display: "flex", flexDirection: "column" }}><span className="s360-k">{tx(T.yearTotal)}</span><span className="num s360-v">{rupees(familyTotal.total)}</span></span>
            <span style={{ display: "flex", flexDirection: "column" }}><span className="s360-k">{tx(T.paidShort)}</span><span className="num s360-v" style={{ color: "var(--ok)" }}>{rupees(familyTotal.paid)}</span></span>
            <span style={{ display: "flex", flexDirection: "column" }}><span className="s360-k">{tx(T.remainingYear)}</span><span className="num s360-v">{rupees(familyTotal.remaining)}</span></span>
          </div>
          {p.familyGroupId ? (
            <Link href={`/fees/students/family/${p.familyGroupId}/statement`} className="tap btn sec"><Ic n="receipt" size={18} />{tx(T.familyStatement)}</Link>
          ) : null}
        </div>
      ) : null}
      {p.contacts ? (
        <div className="card s360-card">
          <FamilyContactLog studentId={p.id} contacts={p.contacts} canLog today={p.today} recoveryScope={p.contactRecoveryScope} />
        </div>
      ) : null}
    </>
  );
}

/** Info: the record as key and value, and Edit for those who may (the fee app's student form). */
function InfoTab({ p }: { p: Student360Props }) {
  const { tx } = useVx();
  const rows: [Pair, string | null][] = [
    [T.admissionNo, p.sr],
    [T.rollNo, p.rollNo],
    [T.colClass, p.classLabel],
    [T.father, p.father],
    [T.mother, p.mother],
    [T.phone, p.phone],
    [T.dob, p.dob ? dateLabel(p.dob) : null],
    [T.joined, p.joined ? dateLabel(p.joined) : null],
    [T.route, p.route],
    [T.address, p.address],
    [T.status, p.status],
  ];
  const missing = rows.filter(([, v]) => !v).length;
  return (
    <>
      <div className="card" style={{ overflow: "hidden" }}>
        <dl style={{ margin: 0 }}>
          {rows.map(([label, value], i) => (
            <div key={label.en} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "13px 16px", borderTop: i ? "1px solid var(--bd)" : 0 }}>
              <dt style={{ fontSize: 13, color: "var(--mut)" }}>{tx(label)}</dt>
              <dd style={{ margin: 0, fontSize: 14, fontWeight: 600, textAlign: "right", overflowWrap: "anywhere", color: value ? undefined : "var(--sub)" }}>{value || "—"}</dd>
            </div>
          ))}
        </dl>
      </div>
      {p.canManageFees ? (
        <Link href={`/fees/students/${p.id}/edit`} className="tap btn sec">
          <Ic n="edit" size={18} />
          {tx(T.editDetails)}
          {missing ? ` · ${missing}` : ""}
        </Link>
      ) : null}
    </>
  );
}


/** No such child, or no session: the same layer, saying so, with the way back. */
export function Student360Missing({ returnTo, title, action }: { returnTo: string; title: string; action: string }) {
  const { tx } = useVx();
  const close = useCloseTo(returnTo);
  return (
    <div className="vxt s360-layer">
      <button type="button" className="s360-scrim" aria-label={tx(T.closeStudent)} onClick={close} />
      <section className="vx s360" role="dialog" aria-modal="true" aria-label={title}>
        <div className="s360-top">
          <CloseLink fallback={returnTo} className="tap s360-round" label={tx(T.back)}>
            <Ic n="chevLeft" size={24} />
          </CloseLink>
          <span>{tx(T.student360)}</span>
          <span style={{ width: 44 }} />
        </div>
        <div className="s360-body">
          <EmptyState icon="user" title={title} action={<Btn href={returnTo}>{action}</Btn>} />
        </div>
      </section>
    </div>
  );
}

/** The layer's skeleton in the card's own shape, shown the moment a row is tapped. */
export function Student360Skeleton() {
  const { tx } = useVx();
  return (
    <div className="vxt s360-layer">
      <span className="s360-scrim" aria-hidden="true" />
      <section className="vx s360" role="status" aria-busy="true" aria-live="polite">
        <span className="sr">{tx(T.loadingFees)}</span>
        <div className="s360-top"><span style={{ width: 44 }} /><Skel w={110} h={16} /><span style={{ width: 44 }} /></div>
        <div className="s360-head">
          <div className="s360-id">
            <div className="s360-ring"><Skel w="100%" h="100%" r={48} /></div>
            <div className="s360-who">
              <Skel w={200} h={28} />
              <Skel w={220} h={14} />
              <div className="s360-chips"><Skel w={60} h={24} r={12} /><Skel w={90} h={24} r={12} /></div>
            </div>
          </div>
          <div className="s360-kpis phone">
            {[0, 1, 2].map((i) => <div key={i} className="card s360-kpi"><Skel w="60%" h={10} /><Skel w="70%" h={18} /></div>)}
          </div>
          <div className="s360-tabs">{[84, 56, 96, 66, 70].map((w, i) => <Skel key={i} w={w} h={34} r={17} />)}</div>
        </div>
        <div className="s360-body">
          {[0, 1].map((i) => (
            <div key={i} className="card s360-card"><Skel w="40%" h={14} /><Skel w="100%" h={10} /><Skel w="80%" h={22} /></div>
          ))}
        </div>
      </section>
    </div>
  );
}

/**
 * What sits behind the drawer when Student 360 is opened on its own: a quiet
 * stand-in for the Students list, under the scrim, so the page is the picture
 * the design draws (D02) without reading the whole list again.
 */
export function Student360Backdrop() {
  const { tx } = useVx();
  return (
    <div className="vx vx-page" aria-hidden="true">
      <header className="only-d glass vx-top" style={{ flex: "none", height: 64, display: "flex", alignItems: "center", padding: "0 28px", borderBottom: "1px solid var(--bd)" }}>
        <h2 className="serif" style={{ margin: 0, fontSize: 22, fontWeight: 600 }}>{tx(T.students)}</h2>
      </header>
      <div className="vx-pmain">
        <div className="pad" style={{ padding: "22px 28px", display: "flex", flexDirection: "column", gap: 12 }}>
          <Skel w="min(420px, 100%)" h={44} r={12} />
          <div className="card" style={{ padding: 0, overflow: "hidden" }}>
            {Array.from({ length: 10 }, (_, i) => (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: 12, padding: "14px 16px", borderTop: i ? "1px solid var(--bd)" : 0 }}>
                <Skel w={36} h={36} r={18} />
                <Skel w="30%" h={14} />
                <Skel w="18%" h={14} style={{ marginLeft: "auto" }} />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
