"use client";

import Link from "next/link";

import { dateLabel, dayMonth, initials, rupees } from "@/vx/format";
import { useVx } from "@/vx/i18n";
import { Ic } from "@/vx/icons";
import type { Pair } from "@/vx/text";
import { ChipRow } from "@/vx/ui/controls";
import { Grid, Section, TopBar } from "@/vx/ui/page";
import { ATT_COLORS, Avatar, Btn, Card, CardHead, EmptyState, Pill, Ring, Stat, type Tone } from "@/vx/ui/primitives";
import { mobileOf, type InstallmentState, type MarkStatus, type StudentMoney, type StudentTab } from "@/vx/screens/admin/logic";
import { T } from "@/vx/screens/admin/text";

/*
 * Student 360 (design F06–F08/D02): one child, every side of them, behind
 * tabs in the URL (`?tab=`). The fee tab and the money tiles exist only for
 * `fees:view`; pending today, not due yet and the late fee are three numbers
 * and never one.
 */

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
  installments: { label: string; dueDate: string; state: InstallmentState; pending: number; settled: number; base: number; carry: boolean }[] | null;
  receipts: { id: string; number: string; date: string; amount: number; mode: string; reversed: boolean }[] | null;
  family: { id: string; name: string; sr: string; classLabel: string; self: boolean }[] | null;
  attendance: { percent: number | null; counted: number; counts: Record<MarkStatus, number>; weeks: Cell[] };
  terms: { term: string; percent: number | null; grade: string | null; missing: number; scored: number; outOf: number }[];
  documents: { id: string; kind: string; fileName: string; size: string; createdAt: string; by: string | null }[];
  notes: { id: string; body: string; kindEn: string; kindHi: string; by: string; createdAt: string }[];
  history: { id: number; label: Pair; from: string | null; to: string | null; blocked: boolean; at: string; by: string | null }[];
  canCollect: boolean;
  canManageDocuments: boolean;
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

export function Student360({ p }: { p: Student360Props }) {
  const { tx } = useVx();
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

  let body: React.ReactNode;
  switch (p.tab) {
    case "overview":
      body = (
        <>
          <Grid cols={3}>
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
      body = p.money ? (
        <>
          <Card>
            <Grid cols={4}>
              <Stat label={tx(T.pendingToday)} value={rupees(p.money.pendingToday)} tone={p.money.pendingToday > 0 ? "var(--bad)" : undefined} />
              <Stat label={tx(T.notDueYet)} value={rupees(p.money.notDueYet)} />
              <Stat label={tx(T.lateFee)} value={rupees(p.money.lateFee)} sub={tx(T.lateFeeApart)} />
              <Stat label={tx(T.paidYear)} value={rupees(p.money.paid)} sub={tx(T.yearPaidPct(p.money.percent))} />
            </Grid>
          </Card>
          {installmentsCard}
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
                    <span style={{ fontSize: 12.5, color: "var(--mut)", textTransform: "capitalize" }}>{dateLabel(r.date)} · {r.mode}</span>
                  </span>
                  {r.reversed ? <Pill tone="bad">{tx(T.reversed)}</Pill> : null}
                  <strong className="num" style={{ textDecoration: r.reversed ? "line-through" : undefined }}>{rupees(r.amount)}</strong>
                </Link>
              ))
            )}
          </Card>
        </>
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
      body = (
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
            {p.tabs.map((tab) => (
              <Link key={tab} href={tab === "overview" ? `/students/${p.id}` : `/students/${p.id}?tab=${tab}`} className={`tap chip${p.tab === tab ? " on" : ""}`} aria-current={p.tab === tab ? "page" : undefined}>
                {tx(TAB_LABEL[tab])}
              </Link>
            ))}
          </ChipRow>
          {body}
        </Section>
      </main>
    </>
  );
}
