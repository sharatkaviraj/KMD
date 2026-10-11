"use client";

import Link from "next/link";
import { Suspense, use, useCallback, useState } from "react";

import { dateLabel, dayMonth, initials, rupees } from "@/vx/format";
import { useVx } from "@/vx/i18n";
import { Ic } from "@/vx/icons";
import type { Pair } from "@/vx/text";
import { ChipRow } from "@/vx/ui/controls";
import { Grid, Section, TopBar } from "@/vx/ui/page";
import { ATT_COLORS, Avatar, Btn, Card, CardHead, EmptyState, Pill, Ring, Skel, Stat, toneColors, type Tone } from "@/vx/ui/primitives";
import { feeRibbon, mobileOf, type InstallmentState, type MarkStatus, type StudentMoney, type StudentTab } from "@/vx/screens/admin/logic";
import { T } from "@/vx/screens/admin/text";

/*
 * Student 360 (design F06–F08/D02): one child, every side of them, behind
 * tabs in the URL (`?tab=`). The fee tab and the money tiles exist only for
 * `fees:view`; pending today, not due yet and the late fee are three numbers
 * and never one.
 *
 * Switching tabs never goes back to the server. The page already reads every
 * tab's data in one pass, so a tab is client state, and the URL follows it
 * with `replaceState` — a link to `?tab=fees` still opens on fees, and Back
 * from a child returns to the list instead of walking back through tabs.
 *
 * The fees tab is the fee app's own student page in this app's clothes: its
 * money band, its Dues table (Charged − Paid = Outstanding, with the late fee
 * and any waiver under Charged), its fee breakup and its receipts, from the
 * same rows and the same sums (`studentFees`).
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
  id: string;
  name: string;
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
        /** The fee app's own status word for the Dues table. */
        status: "paid" | "partial" | "overdue" | "pending" | "waived";
        pending: number;
        /** Fees settled on the row — the progress bar. */
        settled: number;
        /** Everything the pool settled here — the Dues table's Paid. */
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
  family: { id: string; name: string; sr: string; classLabel: string; self: boolean }[] | null;
  attendance: { percent: number | null; counted: number; counts: Record<MarkStatus, number>; weeks: Cell[] };
  terms: { term: string; percent: number | null; grade: string | null; missing: number; scored: number; outOf: number }[];
  documents: { id: string; kind: string; fileName: string; size: string; createdAt: string; by: string | null }[];
  notes: { id: string; body: string; kindEn: string; kindHi: string; by: string; createdAt: string }[];
  history: { id: number; label: Pair; from: string | null; to: string | null; blocked: boolean; at: string; by: string | null }[];
  canCollect: boolean;
  canManageDocuments: boolean;
  canManageFees: boolean;
};

/** The fee app's status badge words, in the same tones. */
const STATUS_LOOK: Record<"paid" | "partial" | "overdue" | "pending" | "waived", { tone: Tone; label: Pair }> = {
  paid: { tone: "ok", label: T.stPaid },
  overdue: { tone: "bad", label: T.stOverdue },
  partial: { tone: "warn", label: T.stPartial },
  pending: { tone: "mut", label: T.stNotDue },
  waived: { tone: "mut", label: T.stWaived },
};

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

const STATE_LOOK: Record<InstallmentState, { tone: Tone; label: Pair; bar: string }> = {
  paid: { tone: "ok", label: T.stPaid, bar: "var(--ok)" },
  overdue: { tone: "bad", label: T.stOverdue, bar: "var(--bad)" },
  part: { tone: "warn", label: T.stPart, bar: "var(--warn)" },
  upcoming: { tone: "mut", label: T.stUpcoming, bar: "var(--s3)" },
  waived: { tone: "info", label: T.stWaived, bar: "var(--info)" },
};

const CELL_LOOK: Record<Cell["state"], { bg: string; fg: string; border?: string }> = {
  present: { bg: ATT_COLORS.P.bg, fg: ATT_COLORS.P.fg },
  absent: { bg: ATT_COLORS.A.fg, fg: "#fff" },
  half_day: { bg: ATT_COLORS.H.bg, fg: ATT_COLORS.H.fg },
  late: { bg: ATT_COLORS.H.bg, fg: ATT_COLORS.H.fg },
  leave: { bg: ATT_COLORS.L.bg, fg: ATT_COLORS.L.fg },
  today: { bg: "var(--card)", fg: "var(--fg)", border: "2px solid var(--acc)" },
  future: { bg: "transparent", fg: "var(--sub)", border: "1px dashed var(--bd)" },
  closed: { bg: "var(--s2)", fg: "var(--sub)" },
  none: { bg: "var(--s3)", fg: "var(--mut)" },
};

/** Everything on the card that comes from the fee app's reads. */
export type Student360Fees = Partial<
  Pick<Student360Props, "status" | "address" | "dob" | "joined" | "route" | "money" | "installments" | "feeSummary" | "feeBreakup" | "feeSession" | "receipts" | "family">
>;

/**
 * Student 360, with the fee side streamed in. The school side (name, class,
 * attendance, marks, notes, documents) is on screen as soon as it is read;
 * the fee side is a promise the server keeps resolving after the first bytes
 * have left, so the card no longer waits for its slowest half. The tab is held
 * here, above both renders, so a tab picked while the fees are still loading
 * stays picked when they land.
 */
export function Student360({ p, fees }: { p: Student360Props; fees?: Promise<Student360Fees | null> }) {
  const [tab, setTab] = useState<StudentTab>(p.tab);
  if (!fees) return <Student360View p={p} tab={tab} setTab={setTab} feesLoading={false} />;
  return (
    <Suspense fallback={<Student360View p={p} tab={tab} setTab={setTab} feesLoading />}>
      <WithFees p={p} fees={fees} tab={tab} setTab={setTab} />
    </Suspense>
  );
}

function WithFees({ p, fees, tab, setTab }: { p: Student360Props; fees: Promise<Student360Fees | null>; tab: StudentTab; setTab: (t: StudentTab) => void }) {
  const loaded = use(fees);
  return <Student360View p={loaded ? { ...p, ...loaded } : p} tab={tab} setTab={setTab} feesLoading={false} />;
}

function Student360View({ p, tab, setTab, feesLoading }: { p: Student360Props; tab: StudentTab; setTab: (t: StudentTab) => void; feesLoading: boolean }) {
  const { tx } = useVx();
  const pick = useCallback(
    (next: StudentTab) => (event: React.MouseEvent<HTMLAnchorElement>) => {
      // A new tab or window still gets a real link.
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
      event.preventDefault();
      setTab(next);
      const url = next === "overview" ? `/students/${p.id}` : `/students/${p.id}?tab=${next}`;
      window.history.replaceState(window.history.state, "", url);
    },
    [p.id, setTab],
  );
  const loadingCard = (
    <Card>
      <div role="status" aria-busy="true" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <span className="sr">{tx(T.loadingFees)}</span>
        <Skel w="min(240px, 60%)" h={18} />
        <Skel w="100%" h={14} />
        <Skel w="80%" h={14} />
      </div>
    </Card>
  );
  const mobile = mobileOf(p.phone);
  const siblings = (p.family ?? []).filter((m) => !m.self).length;
  const latest = [...p.terms].reverse().find((t) => t.percent !== null) ?? null;
  const left = p.status === "left" || p.status === "inactive";

  const tile = (label: Pair, value: React.ReactNode, tone?: string, sub?: React.ReactNode) => (
    <Card style={{ padding: "14px 16px" }}>
      <Stat label={tx(label)} value={value} tone={tone} sub={sub} />
    </Card>
  );

  const installmentsCard = p.installments ? (
    <Card>
      <CardHead title={tx(T.installments)} action={<Link href={`/fees/students/${p.id}`} style={{ color: "var(--accfg)", fontWeight: 600, fontSize: 14 }}>{tx(T.ledger)}</Link>} />
      {p.installments.length === 0 ? (
        <p style={{ margin: "12px 0 0", color: "var(--mut)" }}>{tx(T.noFeeRecord)}</p>
      ) : (
        <ul style={{ listStyle: "none", margin: "12px 0 0", padding: 0, display: "flex", flexDirection: "column", gap: 12 }}>
          {p.installments.map((row) => {
            const look = STATE_LOOK[row.state];
            return (
              <li key={`${row.label}-${row.dueDate}`} style={{ display: "grid", gridTemplateColumns: "minmax(64px,auto) minmax(0,1fr) auto", gap: 12, alignItems: "center" }}>
                <span style={{ display: "flex", flexDirection: "column" }}>
                  <strong style={{ fontSize: 14, color: row.state === "overdue" ? "var(--bad)" : undefined }}>{row.label}</strong>
                  <span style={{ fontSize: 11.5, color: "var(--mut)" }}>{dayMonth(row.dueDate)}</span>
                </span>
                <span style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  <span style={{ height: 6, borderRadius: 3, background: "var(--s3)", overflow: "hidden" }}>
                    <span style={{ display: "block", height: "100%", width: `${row.base > 0 ? Math.min(100, (row.settled / row.base) * 100) : 100}%`, background: look.bar }} />
                  </span>
                  {row.pending > 0 ? <span className="num" style={{ fontSize: 12, color: "var(--mut)" }}>{rupees(row.pending)}</span> : null}
                </span>
                <Pill tone={look.tone}>{tx(look.label)}</Pill>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  ) : null;

  const weeksCard = (
    <Card>
      <CardHead title={tx(T.lastWeeks)} action={p.attendance.percent !== null ? <strong className="num">{p.attendance.percent}%</strong> : undefined} />
      <div style={{ display: "grid", gridTemplateColumns: "repeat(6, minmax(0,1fr))", gap: 6, marginTop: 12 }}>
        {p.attendance.weeks.map((cell) => {
          const look = CELL_LOOK[cell.state];
          return (
            <span key={cell.day} title={`${dateLabel(cell.day)}`} className="num" style={{ height: 30, borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 600, background: look.bg, color: look.fg, border: look.border }}>
              {cell.label}
            </span>
          );
        })}
      </div>
    </Card>
  );

  const termsCard = (
    <Card>
      <CardHead title={tx(T.tabMarks)} action={latest?.percent != null ? <strong className="num">{latest.percent}%</strong> : undefined} />
      {p.terms.length === 0 ? (
        <p style={{ margin: "12px 0 0", color: "var(--mut)" }}>{tx(T.noMarks)}</p>
      ) : (
        <ul style={{ listStyle: "none", margin: "12px 0 0", padding: 0, display: "flex", flexDirection: "column", gap: 10 }}>
          {p.terms.map((t) => (
            <li key={t.term} style={{ display: "grid", gridTemplateColumns: "minmax(90px,1fr) minmax(0,2.4fr) 52px", gap: 12, alignItems: "center" }}>
              <span style={{ display: "flex", flexDirection: "column" }}>
                <span style={{ fontSize: 14 }}>{t.term}</span>
                {t.missing > 0 ? <span style={{ fontSize: 11.5, color: "var(--warnfg)" }}>{tx(T.marksMissing(t.missing))}</span> : null}
              </span>
              <span style={{ height: 8, borderRadius: 4, background: "var(--s3)", overflow: "hidden" }}>
                <span style={{ display: "block", height: "100%", width: `${t.percent ?? 0}%`, background: (t.percent ?? 0) < 60 ? "var(--warn)" : "var(--pri)" }} />
              </span>
              <span className="num" style={{ textAlign: "right", fontWeight: 700 }}>
                {t.percent !== null ? `${t.percent}%` : "—"}
                {t.grade ? <span style={{ display: "block", fontSize: 11, color: "var(--mut)", fontWeight: 500 }}>{t.grade}</span> : null}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );

  const notesCard = (limit?: number) => (
    <Card>
      <CardHead title={tx(T.notes)} action={<Link href={`/notes?student=${p.id}`} style={{ color: "var(--accfg)", fontWeight: 600, fontSize: 14 }}>{tx(T.allNotes)}</Link>} />
      {p.notes.length === 0 ? (
        <p style={{ margin: "12px 0 0", color: "var(--mut)" }}>{tx(T.noNotes)}</p>
      ) : (
        <ul style={{ listStyle: "none", margin: "12px 0 0", padding: 0, display: "flex", flexDirection: "column", gap: 10 }}>
          {p.notes.slice(0, limit ?? p.notes.length).map((n) => (
            <li key={n.id} style={{ padding: "12px 14px", borderRadius: 14, background: "var(--s2)" }}>
              <p style={{ margin: 0, fontSize: 15 }}>{n.body}</p>
              <span style={{ fontSize: 12.5, color: "var(--mut)" }}>
                {n.by} · {dayMonth(n.createdAt)} · {tx({ en: n.kindEn, hi: n.kindHi })}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );

  const infoRows: [Pair, string | null][] = [
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

  const receiptsCard = (
    <Card pad={false} style={{ overflow: "hidden" }}>
      <div style={{ padding: "16px 18px 6px" }}>
        <CardHead title={tx(T.receipts)} />
      </div>
      {(p.receipts ?? []).length === 0 ? (
        <EmptyState icon="receipt" title={tx(T.noReceipts)} />
      ) : (
        (p.receipts ?? []).map((r) => (
          <Link key={r.id} href={`/fees/receipts/${r.id}`} className="row tap" style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 18px", borderTop: "1px solid var(--bd)" }}>
            <Ic n="receipt" size={18} style={{ color: "var(--mut)" }} />
            <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
              <strong className="num">{r.number}</strong>
              <span style={{ fontSize: 12.5, color: "var(--mut)" }}>{dateLabel(r.date)} · {MODE_LABEL[r.mode] ?? r.mode}</span>
            </span>
            {r.reversed ? <Pill tone="bad">{tx(T.reversed)}</Pill> : null}
            <strong className="num" style={{ textDecoration: r.reversed ? "line-through" : undefined }}>{rupees(r.amount)}</strong>
          </Link>
        ))
      )}
    </Card>
  );

  let body: React.ReactNode;
  switch (tab) {
    case "overview":
      body = (
        <>
          <Grid cols={3}>
            {feesLoading ? tile(T.pendingToday, <span aria-busy="true" style={{ display: "block" }}><Skel w={90} h={26} /></span>) : null}
            {p.money ? tile(T.pendingToday, rupees(p.money.pendingToday), p.money.pendingToday > 0 ? "var(--bad)" : undefined, p.money.lateFee > 0 ? `${tx(T.lateFee)} ${rupees(p.money.lateFee)} · ${tx(T.lateFeeApart)}` : undefined) : null}
            {tile(T.attendancePct, p.attendance.percent !== null ? `${p.attendance.percent}%` : "—", undefined, p.attendance.counted ? tx(T.daysCounted(p.attendance.counted)) : tx(T.noAttendanceYet))}
            {latest ? tile({ en: latest.term }, latest.percent !== null ? `${latest.percent}%` : "—", undefined, latest.grade ?? undefined) : p.money ? tile(T.notDueYet, rupees(p.money.notDueYet)) : null}
          </Grid>
          <div className="stack" style={{ display: "grid", gridTemplateColumns: installmentsCard ? "minmax(0,1fr) minmax(0,1fr)" : "minmax(0,1fr)", gap: 16 }}>
            {installmentsCard}
            {weeksCard}
          </div>
          {termsCard}
          {p.tabs.includes("notes") ? notesCard(3) : null}
        </>
      );
      break;
    case "fees":
      body = feesLoading ? loadingCard : p.money && p.feeSummary ? (
        <FeesTab p={p} summary={p.feeSummary} receiptsCard={receiptsCard} />
      ) : (
        <Card><p style={{ margin: 0, color: "var(--mut)" }}>{tx(T.noFeeRecord)}</p></Card>
      );
      break;
    case "attendance":
      body = (
        <>
          <Card style={{ display: "flex", alignItems: "center", gap: 18, flexWrap: "wrap" }}>
            <Ring value={p.attendance.percent ?? 0} size={84} stroke={9}>
              <strong className="num" style={{ fontSize: 20 }}>{p.attendance.percent !== null ? `${p.attendance.percent}%` : "—"}</strong>
            </Ring>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              <Pill tone="ok">{tx(T.present)} {p.attendance.counts.present}</Pill>
              <Pill tone="bad">{tx(T.absent)} {p.attendance.counts.absent}</Pill>
              <Pill tone="warn">{tx(T.halfDay)} {p.attendance.counts.half_day}</Pill>
              <Pill tone="mut">{tx(T.late)} {p.attendance.counts.late}</Pill>
              <Pill tone="mut">{tx(T.leave)} {p.attendance.counts.leave}</Pill>
            </div>
            <span style={{ fontSize: 13, color: "var(--mut)" }}>{p.attendance.counted ? tx(T.daysCounted(p.attendance.counted)) : tx(T.noAttendanceYet)}</span>
          </Card>
          {weeksCard}
        </>
      );
      break;
    case "marks":
      body = termsCard;
      break;
    case "family":
      body = feesLoading ? loadingCard : (
        <Card pad={false} style={{ overflow: "hidden" }}>
          {(p.family ?? []).filter((m) => !m.self).length === 0 ? (
            <EmptyState icon="users" title={tx(T.noFamily)} />
          ) : (
            (p.family ?? []).map((m) => (
              <Link key={m.id} href={`/students/${m.id}`} className="row tap" style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 18px", borderTop: "1px solid var(--bd)" }}>
                <Avatar text={initials(m.name)} seed={m.name} size={38} />
                <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
                  <strong className="clip">{m.name}</strong>
                  <span style={{ fontSize: 12.5, color: "var(--mut)" }}>{m.classLabel} · SR {m.sr}</span>
                </span>
                {m.self ? <Pill tone="acc">{tx(T.thisChild)}</Pill> : <Ic n="chevRight" size={18} />}
              </Link>
            ))
          )}
        </Card>
      );
      break;
    case "documents":
      body = (
        <Card pad={false} style={{ overflow: "hidden" }}>
          {p.documents.length === 0 ? (
            <EmptyState icon="file" title={tx(T.noDocuments)} action={p.canManageDocuments ? <Btn href={`/teach/student/${p.id}`}>{tx(T.manageDocuments)}</Btn> : undefined} />
          ) : (
            p.documents.map((d) => (
              <div key={d.id} className="row" style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 18px", borderTop: "1px solid var(--bd)" }}>
                <Ic n="fileText" size={20} style={{ color: "var(--mut)" }} />
                <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
                  <strong className="clip">{d.fileName}</strong>
                  <span style={{ fontSize: 12.5, color: "var(--mut)" }}>{d.kind} · {d.size} · {dateLabel(d.createdAt)}{d.by ? ` · ${d.by}` : ""}</span>
                </span>
              </div>
            ))
          )}
        </Card>
      );
      break;
    case "notes":
      body = notesCard();
      break;
    case "history":
      body = (
        <Card pad={false} style={{ overflow: "hidden" }}>
          {p.history.length === 0 ? (
            <EmptyState icon="history" title={tx(T.noHistory)} />
          ) : (
            p.history.map((h) => (
              <div key={h.id} className="row" style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 18px", borderTop: "1px solid var(--bd)" }}>
                <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
                  <strong>{tx(h.label)}</strong>
                  <span style={{ fontSize: 13, color: "var(--mut)", overflowWrap: "anywhere" }}>
                    {h.from ?? "—"} → {h.to ?? "—"}
                  </span>
                  <span style={{ fontSize: 12, color: "var(--sub)" }}>{dateLabel(h.at)}{h.by ? ` · ${h.by}` : ""}</span>
                </span>
                {h.blocked ? <Pill tone="warn">{tx(T.blocked)}</Pill> : null}
              </div>
            ))
          )}
        </Card>
      );
      break;
    case "info":
      body = (
        <Card pad={false}>
          <dl style={{ margin: 0 }}>
            {infoRows.map(([label, value], i) => (
              <div key={label.en} style={{ display: "grid", gridTemplateColumns: "minmax(120px,32%) minmax(0,1fr)", gap: 12, padding: "12px 18px", borderTop: i ? "1px solid var(--bd)" : 0 }}>
                <dt style={{ color: "var(--mut)", fontSize: 14 }}>{tx(label)}</dt>
                <dd style={{ margin: 0, fontWeight: 600, overflowWrap: "anywhere" }}>{value || "—"}</dd>
              </div>
            ))}
          </dl>
        </Card>
      );
      break;
  }

  const sub = [p.classLabel, p.sr ? tx(T.srRoll(p.sr, p.rollNo)) : null, p.money ? tx(T.yearPaidPct(p.money.percent)) : null].filter(Boolean).join(" · ");

  return (
    <>
      <TopBar crumb={<Link href="/students">{tx(T.students)}</Link>} title={p.name} mTitle={p.name} mSub={p.classLabel} mBack="/students" />
      <main>
        <Section gap={16}>
          <div style={{ display: "flex", gap: 16, alignItems: "flex-start", flexWrap: "wrap" }}>
            <Ring value={p.money?.percent ?? 0} size={80} stroke={5}>
              <Avatar text={initials(p.name)} seed={p.name} size={64} />
            </Ring>
            <div style={{ flex: 1, minWidth: 220, display: "flex", flexDirection: "column", gap: 6 }}>
              <h2 className="serif" style={{ margin: 0, fontSize: 30, fontWeight: 600 }}>{p.name}</h2>
              <span style={{ color: "var(--mut)", fontSize: 14 }}>{sub}</span>
              <span style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                <Pill tone={left ? "mut" : "ok"}>{tx(left ? T.left : T.active)}</Pill>
                {p.route ? <Pill tone="info">{tx(T.bus(p.route))}</Pill> : null}
                {siblings > 0 ? <Pill tone="acc">{tx(T.siblings(siblings))}</Pill> : null}
              </span>
            </div>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {p.canCollect ? (
              <Btn variant="pri" icon="rupee" href={`/payments?student=${p.id}`}>
                {p.money && p.money.pendingToday > 0 ? tx(T.collectAmount(rupees(p.money.pendingToday))) : tx(T.collect)}
              </Btn>
            ) : null}
            {mobile ? (
              <>
                <Btn icon="phone" href={`tel:${mobile}`}>{tx(T.call)}</Btn>
                <Btn icon="message" href={`https://wa.me/91${mobile}`} target="_blank">{tx(T.whatsapp)}</Btn>
              </>
            ) : null}
            {p.money ? <Btn icon="send" href={`/fees/students/${p.id}/statement`}>{tx(T.statement)}</Btn> : null}
          </div>
          <ChipRow label={tx(T.tabOverview)}>
            {p.tabs.map((t) => (
              <a key={t} href={t === "overview" ? `/students/${p.id}` : `/students/${p.id}?tab=${t}`} onClick={pick(t)} className={`tap chip${tab === t ? " on" : ""}`} aria-current={tab === t ? "page" : undefined}>
                {tx(TAB_LABEL[t])}
              </a>
            ))}
          </ChipRow>
          {body}
        </Section>
      </main>
    </>
  );
}

const MODE_LABEL: Record<string, string> = { cash: "Cash", upi: "UPI", bank_transfer: "Bank transfer", cheque: "Cheque", discount: "Written off" };

/**
 * The fee app's student money, figure for figure: the ribbon sentence, the
 * four strips, the Dues table and the fee breakup. Fees and the late fee stay
 * two numbers everywhere; a waiver is shown, never folded into a total.
 */
function FeesTab({ p, summary, receiptsCard }: { p: Student360Props; summary: StudentFeeSummary; receiptsCard: React.ReactNode }) {
  const { tx } = useVx();
  const rows = p.installments ?? [];
  const lastReceipt = (p.receipts ?? []).find((r) => !r.reversed) ?? null;
  const breakup = p.feeBreakup;

  const rb = feeRibbon(summary);
  const ribbon: { tone: Tone; title: string; detail: string } =
    rb.kind === "overdue"
      ? { tone: "bad", title: tx(T.rbOverdue), detail: tx(T.rbOverdueDetail(rupees(rb.overdue), rb.lateFee > 0 ? rupees(rb.lateFee) : null)) }
      : rb.kind === "credit"
        ? { tone: "info", title: tx(T.rbCredit), detail: tx(T.rbCreditDetail(rupees(rb.credit))) }
        : rb.kind === "clear"
          ? { tone: "ok", title: tx(T.rbClear), detail: tx(T.rbClearDetail) }
          : rb.kind === "next"
            ? { tone: "mut", title: tx(T.rbNextDue(dateLabel(rb.dueDate))), detail: tx(T.rbNextDueDetail(rb.label, rupees(rb.amount))) }
            : { tone: "mut", title: tx(T.outstanding), detail: "" };
  const rc = toneColors(ribbon.tone);

  return (
    <>
      <div role="status" style={{ padding: "10px 14px", borderRadius: 14, background: rc.bg, color: rc.fg, fontSize: 14 }}>
        <strong>{ribbon.title}</strong>
        {ribbon.detail ? <span style={{ opacity: 0.9 }}> · {ribbon.detail}</span> : null}
      </div>

      <Grid cols={4}>
        <Card style={{ padding: "14px 16px" }}>
          <Stat
            label={tx(T.outstanding)}
            value={rupees(summary.outstanding)}
            tone={summary.outstanding > 0 ? "var(--bad)" : "var(--ok)"}
            sub={
              summary.lateFeePending > 0
                ? `${tx(T.inclLateFee(rupees(summary.lateFeePending)))} · ${tx(T.installmentsPendingN(summary.installmentsPending))}`
                : tx(T.installmentsPendingN(summary.installmentsPending))
            }
          />
        </Card>
        <Card style={{ padding: "14px 16px" }}>
          <Stat
            label={tx(T.paidThisSession)}
            value={rupees(summary.paidThisSession)}
            tone="var(--ok)"
            sub={summary.discountClosed > 0 ? tx(T.closedAsDiscount(rupees(summary.discountClosed))) : tx(T.acrossReceipts((p.receipts ?? []).length))}
          />
        </Card>
        <Card style={{ padding: "14px 16px" }}>
          <Stat label={tx(T.sessionFee)} value={rupees(summary.sessionFee)} sub={tx(T.settledOf(summary.installmentsPaid, summary.installmentsTotal))} />
        </Card>
        {lastReceipt ? (
          <Link href={`/fees/receipts/${lastReceipt.id}`} className="tap" style={{ display: "block" }}>
            <Card style={{ padding: "14px 16px" }}>
              <Stat label={tx(T.lastReceipt)} value={rupees(lastReceipt.amount)} sub={`${lastReceipt.number} · ${dateLabel(lastReceipt.date)}`} />
            </Card>
          </Link>
        ) : (
          <Card style={{ padding: "14px 16px" }}>
            <Stat label={tx(T.lastReceipt)} value="—" sub={tx(T.noPaymentYet)} />
          </Card>
        )}
      </Grid>

      <Card pad={false} style={{ overflow: "hidden" }}>
        <div style={{ padding: "16px 18px 10px" }}>
          <CardHead
            title={tx(T.dues)}
            sub={p.feeSession ?? undefined}
            action={<Link href={`/fees/students/${p.id}?tab=dues`} style={{ color: "var(--accfg)", fontWeight: 600, fontSize: 14 }}>{tx(T.fullFeeRecord)}</Link>}
          />
        </div>
        {rows.length === 0 ? (
          <p style={{ margin: 0, padding: "0 18px 16px", color: "var(--mut)" }}>{tx(T.noFeeRecord)}</p>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", minWidth: 560, borderCollapse: "collapse", fontSize: 14 }}>
              <thead>
                <tr style={{ background: "var(--s2)", color: "var(--mut)", fontSize: 12, textAlign: "left" }}>
                  <th style={{ padding: "10px 18px", fontWeight: 600 }}>{tx(T.colInstallment)}</th>
                  <th style={{ padding: "10px 12px", fontWeight: 600 }}>{tx(T.colDueDate)}</th>
                  <th style={{ padding: "10px 12px", fontWeight: 600, textAlign: "right" }}>{tx(T.colCharged)}</th>
                  <th style={{ padding: "10px 12px", fontWeight: 600, textAlign: "right" }}>{tx(T.colPaid)}</th>
                  <th style={{ padding: "10px 12px", fontWeight: 600, textAlign: "right" }}>{tx(T.colOutstanding)}</th>
                  <th style={{ padding: "10px 18px 10px 12px", fontWeight: 600 }}>{tx(T.colStatus)}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const look = STATUS_LOOK[row.status] ?? STATUS_LOOK.pending;
                  return (
                    <tr key={row.id} style={{ borderTop: "1px solid var(--bd)", verticalAlign: "top" }}>
                      <td style={{ padding: "12px 18px", fontWeight: 600 }}>
                        {row.label}
                        {row.carry ? <span style={{ display: "block", fontSize: 11.5, color: "var(--mut)", fontWeight: 500 }}>{tx(T.carryForward)}</span> : null}
                      </td>
                      <td className="num" style={{ padding: "12px", color: "var(--mut)" }}>{dateLabel(row.dueDate)}</td>
                      <td className="num" style={{ padding: "12px", textAlign: "right" }}>
                        {rupees(row.base + row.lateFee)}
                        {row.lateFee > 0 ? <span style={{ display: "block", fontSize: 11.5, color: "var(--bad)" }}>{tx(T.rowLateFee(rupees(row.lateFee)))}</span> : null}
                        {row.lateFeeWaived > 0 ? <span style={{ display: "block", fontSize: 11.5, color: "var(--ok)" }}>{tx(T.rowLateFeeWaived(rupees(row.lateFeeWaived)))}</span> : null}
                      </td>
                      <td className="num" style={{ padding: "12px", textAlign: "right", color: "var(--ok)" }}>
                        {rupees(row.paid)}
                        {row.adjusted !== 0 ? <span style={{ display: "block", fontSize: 11.5, color: "var(--mut)" }}>{tx(T.rowAdjusted(rupees(row.adjusted)))}</span> : null}
                        {row.receiptedHere !== row.paid ? <span style={{ display: "block", fontSize: 11.5, color: "var(--mut)" }}>{tx(T.rowReceiptedHere(rupees(row.receiptedHere)))}</span> : null}
                      </td>
                      <td className="num" style={{ padding: "12px", textAlign: "right", fontWeight: 700 }}>
                        {rupees(row.pending)}
                        {row.lateFeePending > 0 ? <span style={{ display: "block", fontSize: 11.5, color: "var(--bad)", fontWeight: 500 }}>{tx(T.rowLateFeeOwed(rupees(row.lateFeePending)))}</span> : null}
                      </td>
                      <td style={{ padding: "12px 18px 12px 12px" }}><Pill tone={look.tone}>{tx(look.label)}</Pill></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {breakup ? (
        <Card pad={false} style={{ overflow: "hidden" }}>
          <div style={{ padding: "16px 18px 10px" }}>
            <CardHead
              title={tx(T.feeBreakup)}
              action={p.canManageFees ? <Link href={`/fees/students/${p.id}?tab=fee-plan`} style={{ color: "var(--accfg)", fontWeight: 600, fontSize: 14 }}>{tx(T.waiveOrEdit)}</Link> : undefined}
            />
          </div>
          <div style={{ padding: "0 18px 14px" }}>
            <Grid cols={4}>
              <Stat label={tx(T.tuitionOverride)} value={breakup.tuitionOverride !== null ? rupees(breakup.tuitionOverride) : tx(T.classDefault)} />
              <Stat label={tx(T.transportOverride)} value={breakup.transportOverride !== null ? rupees(breakup.transportOverride) : tx(T.routeDefault)} />
              <Stat label={tx(T.discount)} value={rupees(breakup.discountTotal)} sub={breakup.discountLabels.length ? breakup.discountLabels.join(", ") : undefined} />
              <Stat label={tx(T.lateFeeWaivedSoFar)} value={rupees(summary.lateFeeWaived)} />
            </Grid>
          </div>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
            <thead>
              <tr style={{ background: "var(--s2)", color: "var(--mut)", fontSize: 12, textAlign: "left" }}>
                <th style={{ padding: "10px 18px", fontWeight: 600 }}>{tx(T.feeHead)}</th>
                <th style={{ padding: "10px 18px", fontWeight: 600, textAlign: "right" }}>{tx(T.amount)}</th>
              </tr>
            </thead>
            <tbody>
              {breakup.rows.map((row) => (
                <tr key={row.id} style={{ borderTop: "1px solid var(--bd)", background: row.kind === "discount" ? "var(--accs)" : undefined }}>
                  <td style={{ padding: "10px 18px" }}>{row.label}</td>
                  <td className="num" style={{ padding: "10px 18px", textAlign: "right", fontWeight: 600 }}>{row.amount < 0 ? `−${rupees(Math.abs(row.amount))}` : rupees(row.amount)}</td>
                </tr>
              ))}
              <tr style={{ borderTop: "1px solid var(--bd)", background: "var(--s2)", fontWeight: 700 }}>
                <td style={{ padding: "10px 18px" }}>{tx(T.annualTotal)}</td>
                <td className="num" style={{ padding: "10px 18px", textAlign: "right" }}>{rupees(breakup.annualTotal)}</td>
              </tr>
            </tbody>
          </table>
        </Card>
      ) : null}

      {receiptsCard}
    </>
  );
}
