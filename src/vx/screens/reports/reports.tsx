"use client";

import "./reports.css";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useSyncExternalStore, useTransition, type CSSProperties, type ReactNode } from "react";

import { createScheduleAction, toggleScheduleAction } from "@/app/(app)/reports/actions";
import { bucketCollection, sectionDefaulters, sumBuckets, teacherListText, type DefaulterRow } from "@/modules/reports/vx/domain/reports";
import type { ReportSchedule } from "@/modules/reports/vx/reports-data";
import type { CollectionPreset, ReportsPageData, ReportsSheet } from "@/modules/reports/vx/types";
import { clock, dateLabel, dayMonth, initials, pct, rupees, rupeesShort, shortDay } from "@/vx/format";
import { useVx } from "@/vx/i18n";
import { Ic, type IconName } from "@/vx/icons";
import { p, type Pair } from "@/vx/text";
import { Chip, ChipRow, Field, Input, RadioCard, Seg, Select, Switch } from "@/vx/ui/controls";
import { Sheet, useToast } from "@/vx/ui/overlays";
import { Section, TopBar, VxPage } from "@/vx/ui/page";
import { BarChart, Btn, Card, EmptyState, Kpi, Pill, Sparkline, StackedBar } from "@/vx/ui/primitives";

type Lang = "hi" | "en" | "both";

const MODE_LABEL: Record<string, string> = { upi: "UPI", cash: "Cash", cheque: "Cheque", bank_transfer: "Bank" };
const MODE_COLOR: Record<string, string> = { upi: "var(--pri)", cash: "var(--acc)", cheque: "var(--warn)", bank_transfer: "var(--sub)" };
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

const T = {
  reports: p("Reports", "रिपोर्ट"),
  collection: p("Daily collection", "दैनिक वसूली"),
  daybook: p("Day book", "रोज़नामचा"),
  bymode: p("Collection by mode", "भुगतान के तरीके से"),
  classwise: p("Pending by class", "कक्षावार बकाया"),
  defaulters: p("Defaulter list (हिंदी)", "बकाया सूची"),
  latefee: p("Late fee pending", "विलंब शुल्क बकाया"),
  left: p("Left students who owe", "स्कूल छोड़ चुके, बकाया"),
  all: p("All fee reports", "सभी फीस रिपोर्ट"),
  schedule: p("Scheduled sends", "तय भेजना"),
  find: p("Find a report", "रिपोर्ट खोजें"),
  pinned: p("Pinned", "पिन किए"),
  money: p("Money", "पैसा"),
  more: p("Students & more", "छात्र व अन्य"),
  allReports: p("All reports", "सभी रिपोर्ट"),
  print: p("Print", "प्रिंट"),
  export: p("Export", "निर्यात"),
  send: p("Send to class teachers", "कक्षा अध्यापकों को भेजें"),
};

/* ---------- pins (per device) ---------- */

const PIN_KEY = "vx:report-pins";
const DEFAULT_PINS = "collection,defaulters,classwise";
function readPins(): string {
  try {
    return window.localStorage.getItem(PIN_KEY) ?? DEFAULT_PINS;
  } catch {
    return DEFAULT_PINS;
  }
}
function usePins(): [string[], (key: string) => void] {
  const raw = useSyncExternalStore(
    (cb) => {
      window.addEventListener("storage", cb);
      window.addEventListener("vx-pins", cb);
      return () => {
        window.removeEventListener("storage", cb);
        window.removeEventListener("vx-pins", cb);
      };
    },
    readPins,
    () => DEFAULT_PINS,
  );
  const pins = raw ? raw.split(",").filter(Boolean) : [];
  const toggle = (key: string) => {
    const next = pins.includes(key) ? pins.filter((k) => k !== key) : [...pins, key];
    try {
      window.localStorage.setItem(PIN_KEY, next.join(","));
    } catch {
      /* private window: pins just do not stick */
    }
    window.dispatchEvent(new Event("vx-pins"));
  };
  return [pins, toggle];
}

/* ---------- the screen ---------- */

export function Reports({
  data,
  initialSheet,
  initialLeft,
  readOnly,
}: {
  data: ReportsPageData;
  initialSheet: ReportsSheet;
  initialLeft: boolean;
  readOnly: boolean;
}) {
  const [sheet, setSheetState] = useState<ReportsSheet>(initialSheet);
  const setSheet = (s: ReportsSheet) => {
    setSheetState(s);
    const url = new URL(window.location.href);
    if (s) url.searchParams.set("sheet", s);
    else url.searchParams.delete("sheet");
    window.history.replaceState(null, "", url);
  };
  const close = () => setSheet("");

  switch (data.view) {
    case "collection":
      return <CollectionView data={data} sheet={sheet} setSheet={setSheet} close={close} />;
    case "defaulters":
      return <DefaultersView data={data} sheet={sheet} setSheet={setSheet} close={close} initialLeft={initialLeft} />;
    case "classwise":
      return <ClasswiseView data={data} sheet={sheet} setSheet={setSheet} close={close} />;
    case "daybook":
      return <DayBookView data={data} sheet={sheet} setSheet={setSheet} close={close} />;
    case "schedule":
      return <ScheduleView data={data} sheet={sheet} setSheet={setSheet} close={close} readOnly={readOnly} />;
    default:
      return <HubView data={data} sheet={sheet} setSheet={setSheet} close={close} readOnly={readOnly} />;
  }
}

type ViewProps = { data: ReportsPageData; sheet: ReportsSheet; setSheet: (s: ReportsSheet) => void; close: () => void };

function BackBtn() {
  const { tx } = useVx();
  return (
    <Btn variant="ghost" icon="chevLeft" href="/reports" style={{ fontWeight: 600 }}>
      {tx(T.allReports)}
    </Btn>
  );
}

function ExportBtn({ onClick }: { onClick: () => void }) {
  const { tx } = useVx();
  return (
    <Btn variant="pri" icon="download" onClick={onClick}>
      {tx(T.export)}
    </Btn>
  );
}

/* ---------- hub ---------- */

type HubCard = { key: string; group: "money" | "more"; icon: IconName; tone: [string, string]; title: Pair; sub: string; value: string; caption: string; href: string; extra?: ReactNode };

function HubView({ data, sheet, close, readOnly }: ViewProps & { readOnly: boolean }) {
  const { tx } = useVx();
  const [q, setQ] = useState("");
  const [pins, togglePin] = usePins();
  const h = data.hub;
  const share = h ? h.modeShare : { upi: 0, cash: 0, cheque: 0, bank_transfer: 0 };
  const monthSum = share.upi + share.cash + share.cheque + share.bank_transfer;
  const cards: HubCard[] = h
    ? [
        { key: "collection", group: "money", icon: "chart", tone: ["var(--accs)", "var(--accfg)"], title: T.collection, sub: "Receipts by day, mode and class", value: rupees(h.todayTotal), caption: `today · ${h.todayReceipts} receipts`, href: "/reports?view=collection", extra: <Sparkline values={h.spark} width={100} height={34} /> },
        { key: "daybook", group: "money", icon: "book", tone: ["var(--infos)", "var(--info)"], title: T.daybook, sub: "Every receipt and reversal in time order", value: String(h.todayReceipts), caption: `receipts today · ${h.todayReversed} reversed`, href: "/reports?view=daybook" },
        {
          key: "bymode",
          group: "money",
          icon: "pie",
          tone: ["var(--accs)", "var(--accfg)"],
          title: T.bymode,
          sub: "Cash, UPI, cheque and bank",
          value: monthSum ? `${pct(share.upi, monthSum)}% UPI` : "—",
          caption: `${rupeesShort(monthSum)} this month so far`,
          href: "/reports?view=collection&range=month",
          extra: monthSum ? (
            <span style={{ width: 100 }}>
              <StackedBar showLegend={false} height={8} parts={(["upi", "cash", "cheque", "bank_transfer"] as const).map((m) => ({ label: MODE_LABEL[m], value: share[m], color: MODE_COLOR[m] }))} />
            </span>
          ) : null,
        },
        { key: "classwise", group: "money", icon: "grid", tone: ["var(--warns)", "var(--warnfg)"], title: T.classwise, sub: "Class × installment heat table", value: rupeesShort(h.pendingToday), caption: `pending today · ${h.defaulters} students`, href: "/reports?view=classwise" },
        { key: "defaulters", group: "money", icon: "alert", tone: ["var(--bads)", "var(--bad)"], title: T.defaulters, sub: "Printable list for class teachers", value: String(h.defaulters), caption: "students · pending today", href: "/reports?view=defaulters" },
        { key: "latefee", group: "money", icon: "clock", tone: ["var(--warns)", "var(--warnfg)"], title: T.latefee, sub: "Always kept apart from fees", value: rupees(h.lateFeePending), caption: "this session · not in any fee total", href: "/reports?view=defaulters" },
        { key: "left", group: "more", icon: "door", tone: ["var(--bads)", "var(--bad)"], title: T.left, sub: "TC issued · dues still shown", value: String(h.leftOwing), caption: `${rupeesShort(h.leftOwingAmount)} pending today`, href: "/reports?view=defaulters&left=1" },
        { key: "notdue", group: "more", icon: "calendar", tone: ["var(--s3)", "var(--fg)"], title: p("Not due yet", "अभी देय नहीं"), sub: "Later installments, never added to pending", value: rupeesShort(h.notDueYet), caption: "kept apart", href: "/reports?view=classwise" },
        { key: "all", group: "more", icon: "list", tone: ["var(--s3)", "var(--fg)"], title: T.all, sub: "Outstanding, ledger, receipt register, imports", value: "5", caption: "detailed reports with CSV", href: "/fees/reports" },
      ]
    : [];
  const needle = q.trim().toLowerCase();
  const shown = cards.filter((c) => !needle || `${c.title.en} ${c.title.hi} ${c.sub}`.toLowerCase().includes(needle));
  const pinned = cards.filter((c) => pins.includes(c.key));

  const card = (c: HubCard, i: number) => {
    const on = pins.includes(c.key);
    return (
      <Card key={c.key} className="rp-card lift" pad={false} style={{ animationDelay: `${Math.min(i, 10) * 30}ms` }}>
        <Link href={c.href} className="rp-o" aria-label={tx(c.title)} />
        <div className="rp-f" style={{ alignItems: "flex-start", gap: 12 }}>
          <span className="rp-ib" style={{ background: c.tone[0], color: c.tone[1] }}><Ic n={c.icon} size={18} /></span>
          <span className="rp-c" style={{ flex: 1 }}>
            <b style={{ fontSize: 15 }}>{tx(c.title)}</b>
            <span className="rp-m">{c.sub}</span>
          </span>
          <button type="button" className={`tap rp-pinbtn${on ? " on" : ""}`} aria-pressed={on} aria-label={on ? "Unpin" : "Pin"} onClick={() => togglePin(c.key)}>
            <Ic n="pin" size={17} />
          </button>
        </div>
        <div className="rp-f" style={{ justifyContent: "space-between", alignItems: "flex-end", marginTop: "auto" }}>
          <span className="rp-c">
            <span className="rp-big num">{c.value}</span>
            <span className="rp-m">{c.caption}</span>
          </span>
          {c.extra}
        </div>
      </Card>
    );
  };

  return (
    <VxPage>
      <TopBar
        crumb="Money · Students"
        title={tx(T.reports)}
        mSub={`${cards.length} reports · ${h?.schedules ?? 0} scheduled`}
        mBack="/menu"
        mAction={<Btn variant="ghost" icon="clock" href="/reports?view=schedule" ariaLabel={tx(T.schedule)} />}
        actions={
          <>
            <label className="rp-f" style={{ width: 280, height: 42, borderRadius: 12, border: "1px solid var(--bds)", background: "var(--card)", padding: "0 12px", color: "var(--mut)" }}>
              <Ic n="search" size={18} />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={tx(T.find)} aria-label={tx(T.find)} style={{ flex: 1, border: 0, outline: "none", background: "transparent", color: "var(--fg)", fontSize: 15 }} />
            </label>
            <Btn icon="clock" href="/reports?view=schedule">
              {tx(T.schedule)} <Pill tone="acc">{h?.schedules ?? 0}</Pill>
            </Btn>
          </>
        }
      />
      <Section>
        <label className="only-m rp-f" style={{ height: 48, borderRadius: 14, border: "1px solid var(--bds)", background: "var(--card)", padding: "0 14px", color: "var(--mut)" }}>
          <Ic n="search" size={18} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={tx(T.find)} aria-label={tx(T.find)} style={{ flex: 1, border: 0, outline: "none", background: "transparent", color: "var(--fg)", fontSize: 16 }} />
        </label>
        {pinned.length && !needle ? (
          <>
            <div className="rp-sec">{tx(T.pinned)}</div>
            <div className="rp-pins">
              {pinned.map((c) => (
                <Link key={c.key} href={c.href} className="card tap lift rp-pin">
                  <span className="rp-ib" style={{ background: c.tone[0], color: c.tone[1] }}><Ic n={c.icon} size={18} /></span>
                  <span className="rp-c">
                    <b className="rp-e" style={{ fontSize: 14 }}>{tx(c.title)}</b>
                    <span className="rp-m rp-e"><b style={{ color: "var(--fg)" }}>{c.value}</b> {c.caption}</span>
                  </span>
                </Link>
              ))}
            </div>
          </>
        ) : null}
        {(["money", "more"] as const).map((g) => {
          const list = shown.filter((c) => c.group === g);
          if (!list.length) return null;
          return (
            <div key={g} className="rp-c" style={{ gap: 14 }}>
              <div className="rp-sec">{tx(g === "money" ? T.money : T.more)}</div>
              <div className="rp-cards">{list.map(card)}</div>
            </div>
          );
        })}
        {!shown.length ? <EmptyState icon="search" title="No report by that name" body="Try collection, defaulter, class, day book or late fee." /> : null}
      </Section>
      <ExportSheet data={data} open={sheet === "export"} onClose={close} />
      <NewScheduleSheet open={sheet === "newsch"} onClose={close} readOnly={readOnly} />
    </VxPage>
  );
}

/* ---------- collection ---------- */

function CollectionView({ data, sheet, setSheet, close }: ViewProps) {
  const { tx } = useVx();
  const router = useRouter();
  const c = data.collection!;
  const [mode, setMode] = useState("");
  const [classId, setClassId] = useState("");
  const [from, setFrom] = useState(c.from);
  const [to, setTo] = useState(c.to);
  const receipts = c.receipts.map((r) => ({ paymentDate: r.date, paymentMode: r.mode, amount: r.amount, classId: r.classId, reversed: r.reversed }));
  const buckets = bucketCollection(receipts, c.from, c.to, { mode, classId });
  const monthly = buckets.length > 0 && buckets[0].key.length === 7;
  const total = sumBuckets(buckets);
  const working = buckets.filter((b) => b.total > 0);
  const best = working.reduce<(typeof buckets)[number] | null>((m, b) => (!m || b.total > m.total ? b : m), null);
  const reversed = c.receipts.filter((r) => r.reversed && (!mode || r.mode === mode) && (!classId || r.classId === classId)).length;
  const label = (key: string) => (monthly ? new Intl.DateTimeFormat("en-IN", { month: "short", year: "2-digit" }).format(new Date(`${key}-01T00:00:00Z`)) : shortDay(key));
  const go = (preset: CollectionPreset, extra = "") => router.push(`/reports?view=collection&range=${preset}${extra}`);
  const presets: { value: CollectionPreset; label: string }[] = [
    { value: "month", label: "This month" },
    { value: "last", label: "Last month" },
    { value: "session", label: "Session" },
    { value: "custom", label: "Custom" },
  ];
  const isSunday = (d: string) => new Date(`${d}T00:00:00Z`).getUTCDay() === 0;

  return (
    <VxPage>
      <TopBar
        crumb="Reports"
        title={tx(T.collection)}
        mSub={`${dayMonth(c.from)} – ${dayMonth(c.to)} · ${rupees(total.total)}`}
        mBack="/reports"
        mAction={<Btn variant="ghost" icon="download" onClick={() => setSheet("export")} ariaLabel={tx(T.export)} />}
        actions={
          <>
            <BackBtn />
            <Btn icon="printer" onClick={() => window.print()}>{tx(T.print)}</Btn>
            <Btn icon="clock" href="/reports?view=schedule&sheet=newsch">Schedule</Btn>
            <ExportBtn onClick={() => setSheet("export")} />
          </>
        }
      />
      <Section>
        <div className="rp-f rp-noprint" style={{ flexWrap: "wrap", gap: 10 }}>
          <Seg options={presets} value={c.preset} onChange={(v) => (v === "custom" ? go("custom", `&from=${from}&to=${to}`) : go(v))} label="Dates" style={{ minWidth: 0 }} />
          {c.preset === "custom" ? (
            <span className="rp-f">
              <Input type="date" value={from} max={data.today} onChange={(e) => setFrom(e.target.value)} aria-label="From" style={{ width: 160 }} />
              <span className="rp-m">to</span>
              <Input type="date" value={to} max={data.today} onChange={(e) => setTo(e.target.value)} aria-label="To" style={{ width: 160 }} />
              <Btn variant="pri" onClick={() => go("custom", `&from=${from}&to=${to}`)}>Show</Btn>
            </span>
          ) : null}
        </div>
        <ChipRow label="Class" style={{ marginTop: -4 }}>
          <Chip on={!classId} onClick={() => setClassId("")}>All classes</Chip>
          {data.classes.map((k) => (
            <Chip key={k.id} on={classId === k.id} onClick={() => setClassId(k.id)}>{k.label}</Chip>
          ))}
        </ChipRow>
        <ChipRow label="Mode" style={{ marginTop: -6 }}>
          <Chip on={!mode} onClick={() => setMode("")}>All modes</Chip>
          {Object.keys(MODE_LABEL).map((m) => (
            <Chip key={m} on={mode === m} onClick={() => setMode(m)}>
              <span style={{ width: 8, height: 8, borderRadius: 4, background: MODE_COLOR[m] }} />
              {MODE_LABEL[m]}
            </Chip>
          ))}
        </ChipRow>
        <div className="g4" style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0,1fr))", gap: 12 }}>
          <Kpi label="Collected" value={rupees(total.total)} sub={`${total.receipts} receipts`} />
          <Kpi label={monthly ? "Average per month" : "Average per working day"} value={rupees(working.length ? Math.round(total.total / working.length) : 0)} sub={`${working.length} ${monthly ? "months" : "working days"}`} delay={40} />
          <Kpi label={monthly ? "Best month" : "Best day"} value={best ? rupees(best.total) : "—"} sub={best ? label(best.key) : "no collection"} delay={80} />
          <Kpi label="Reversed receipts" value={String(reversed)} sub="shown · not in the total" tone={reversed ? "var(--bad)" : undefined} delay={120} />
        </div>
        <Card>
          <div className="rp-f" style={{ justifyContent: "space-between", marginBottom: 12 }}>
            <span className="rp-c">
              <b>Collected by {monthly ? "month" : "day"}</b>
              <span className="rp-m">Hover or tap a bar to see the amount</span>
            </span>
            {mode ? <Pill tone="acc">{MODE_LABEL[mode]} only</Pill> : null}
          </div>
          {total.total ? (
            <BarChart
              height={180}
              labelEvery={buckets.length > 16 ? 2 : 1}
              data={buckets.map((b) => ({ label: monthly ? label(b.key) : String(Number(b.key.slice(8))), value: b.total, highlight: b.key === data.today, title: `${label(b.key)} · ${rupees(b.total)}` }))}
            />
          ) : (
            <EmptyState icon="chart" title="No collection in these dates" body="Pick another range or class." />
          )}
        </Card>
        <Card pad={false} style={{ overflow: "hidden" }}>
          <div className="rp-scroll">
            <table className="rp-tbl">
              <thead>
                <tr>
                  <th>{monthly ? "Month" : "Day"}</th>
                  <th>Receipts</th>
                  <th className="hide-p">UPI</th>
                  <th className="hide-p">Cash</th>
                  <th className="hide-p">Cheque</th>
                  <th className="hide-p">Bank</th>
                  <th>Total</th>
                </tr>
              </thead>
              <tbody>
                {[...buckets].reverse().map((b) => (
                  <tr key={b.key}>
                    <td>
                      <b>{label(b.key)}</b>
                      {!monthly && isSunday(b.key) ? <Pill style={{ marginLeft: 8 }}>Sunday</Pill> : null}
                    </td>
                    <td>{b.receipts || "—"}</td>
                    {(["upi", "cash", "cheque", "bank_transfer"] as const).map((m) => (
                      <td key={m} className="hide-p">{b.byMode[m] ? rupees(b.byMode[m]) : "—"}</td>
                    ))}
                    <td><b>{b.total ? rupees(b.total) : "—"}</b></td>
                  </tr>
                ))}
                <tr className="rp-tot">
                  <td>Total</td>
                  <td>{total.receipts}</td>
                  {(["upi", "cash", "cheque", "bank_transfer"] as const).map((m) => (
                    <td key={m} className="hide-p">{rupees(total.byMode[m])}</td>
                  ))}
                  <td>{rupees(total.total)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </Card>
        <span className="rp-m">Reversed receipts and discount close-outs are not collection. Late fee is collected inside the receipt and is reported on its own in the defaulter list.</span>
      </Section>
      <ExportSheet data={data} open={sheet === "export"} onClose={close} filters={{ classId, mode }} />
    </VxPage>
  );
}

/* ---------- defaulters (printable) ---------- */

const PAPER = {
  school: p("Shri Veer Patta Sr. Sec. School, Amet", "श्री वीर पत्ता सीनियर सेकेंडरी स्कूल, आमेट"),
  title: p("Fees pending list", "बकाया शुल्क सूची"),
  only: p("only installments already due", "केवल देय तिथि निकल चुकी किस्तें"),
  date: p("Date", "दिनांक"),
  session: p("Session", "सत्र"),
  klass: p("Class", "कक्षा"),
  teacher: p("Class teacher", "कक्षा अध्यापक"),
  student: p("Student", "छात्र"),
  father: p("Father", "पिता"),
  phone: p("Phone", "फ़ोन"),
  pending: p("Pending today", "आज तक बकाया"),
  late: p("Late fee", "विलंब शुल्क"),
  sign: p("Sign", "हस्ताक्षर"),
  total: p("Total", "कुल"),
  lateSep: p("Late fee (separate)", "विलंब शुल्क (अलग)"),
  left: p("left", "छोड़ चुके"),
};
const say = (lang: Lang, pair: Pair) => (lang === "hi" ? (pair.hi ?? pair.en) : lang === "en" ? pair.en : `${pair.hi ?? pair.en} · ${pair.en}`);

function useDefaulterSections(data: ReportsPageData, includeLeft: boolean, classId: string) {
  const rows = (data.defaulters ?? []).filter((r) => (includeLeft || !r.left) && (!classId || r.classId === classId));
  const order: string[] = [];
  for (const k of data.classes) {
    const hit = rows.find((r) => r.classId === k.id);
    if (hit && !order.includes(hit.classLabel)) order.push(hit.classLabel);
  }
  const byId = new Map(rows.map((r) => [r.studentId, r]));
  const sections = sectionDefaulters(rows.map((r): DefaulterRow => ({ ...r, fatherPhone: null })), order);
  return { rows, sections, phoneOf: (id: string) => byId.get(id)?.phone ?? "" };
}

function DefaultersView({ data, sheet, setSheet, close, initialLeft }: ViewProps & { initialLeft: boolean }) {
  const { tx } = useVx();
  const [lang, setLang] = useState<Lang>("hi");
  const [includeLeft, setIncludeLeft] = useState(initialLeft);
  const [classId, setClassId] = useState("");
  const { rows, sections, phoneOf } = useDefaulterSections(data, includeLeft, classId);
  const all = data.defaulters ?? [];
  const classIds = [...new Set(all.map((r) => r.classId).filter(Boolean))] as string[];
  const classChips = data.classes.filter((k) => classIds.includes(k.id));
  const pending = rows.reduce((s, r) => s + r.pending, 0);
  const late = rows.reduce((s, r) => s + r.lateFee, 0);
  const insts = [...new Set(rows.flatMap((r) => r.installmentsDue))].sort((a, b) => a - b);
  const teacherOf = (cid: string | null) => data.classes.find((k) => k.id === cid)?.teacher ?? null;

  return (
    <VxPage>
      <TopBar
        crumb="Reports"
        title={tx(T.defaulters)}
        mSub={`${rows.length} students · pending today`}
        mBack="/reports"
        actions={
          <>
            <BackBtn />
            <Btn icon="printer" onClick={() => window.print()}>{tx(T.print)}</Btn>
            <Btn icon="download" onClick={() => setSheet("export")}>PDF</Btn>
            <Btn variant="pri" icon="send" onClick={() => setSheet("send")}>{tx(T.send)}</Btn>
          </>
        }
      />
      <Section>
        <div className="only-m rp-f rp-noprint" style={{ gap: 8 }}>
          <Btn icon="printer" onClick={() => window.print()}>{tx(T.print)}</Btn>
          <Btn icon="download" onClick={() => setSheet("export")}>PDF</Btn>
          <Btn variant="pri" icon="send" onClick={() => setSheet("send")} style={{ flex: 1 }}>Send</Btn>
        </div>
        <Card className="rp-noprint" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div className="rp-f" style={{ flexWrap: "wrap", gap: 16 }}>
            <Seg<Lang> options={[{ value: "hi", label: "हिंदी" }, { value: "en", label: "English" }, { value: "both", label: "दोनों · Both" }]} value={lang} onChange={setLang} label="Language of the list" />
            <Switch on={includeLeft} onChange={setIncludeLeft} label="Include students who left" />
          </div>
          <ChipRow label="Class">
            <Chip on={!classId} onClick={() => setClassId("")}>All classes</Chip>
            {classChips.map((k) => (
              <Chip key={k.id} on={classId === k.id} onClick={() => setClassId(k.id)}>{k.label}</Chip>
            ))}
          </ChipRow>
        </Card>
        <div className="rp-noprint rp-f" style={{ alignItems: "flex-start", padding: "10px 14px", borderRadius: 12, background: "var(--infos)", color: "var(--info)", fontSize: 13 }}>
          <Ic n="info" size={18} />
          <span>
            <b>{rows.length} students owe {rupeesShort(pending)} today (late fee {rupees(late)}, separate).</b> Only installments already due{insts.length ? ` (${insts.join(", ")})` : ""} count. Not-due-yet and late fee are never added in.
          </span>
        </div>
        {rows.length ? (
          <div className="rp-paper">
            <div className="rp-ph">
              <span style={{ width: 44, height: 44, borderRadius: 10, background: "#0b3a5b", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: 13, flex: "none" }}>VP</span>
              <span className="rp-c" style={{ flex: 1 }}>
                <b style={{ fontSize: 16 }}>{lang === "en" ? PAPER.school.en : PAPER.school.hi}</b>
                {lang !== "en" ? <span style={{ fontSize: 13 }}>{PAPER.school.en}</span> : null}
              </span>
              <span style={{ fontSize: 11, color: "#555", textAlign: "right" }}>
                {say(lang, PAPER.session)} {data.sessionLabel}
                <br />
                {data.today.split("-").reverse().join("-")}
              </span>
            </div>
            <div style={{ textAlign: "center", margin: "18px 0 6px" }}>
              <h2>{say(lang, PAPER.title)}</h2>
              <span style={{ fontSize: 12, color: "#555" }}>
                {say(lang, PAPER.date)} {data.today.split("-").reverse().join("-")} · {say(lang, PAPER.only)}
                {insts.length ? ` (${insts.join(", ")})` : ""}
              </span>
            </div>
            {sections.map((s) => {
              const t = teacherOf(s.classId);
              return (
                <div key={s.classLabel} style={{ breakInside: "avoid-page" }}>
                  <div className="rp-pc">
                    <span>{say(lang, PAPER.klass)} {s.classLabel}</span>
                    {t ? <span style={{ fontSize: 11, fontWeight: 400, color: "#555" }}>{say(lang, PAPER.teacher)} {t}</span> : null}
                  </div>
                  <table>
                    <thead>
                      <tr>
                        <th>{say(lang, PAPER.student)}</th>
                        <th className="hide-p">{say(lang, PAPER.father)}</th>
                        <th className="hide-p">{say(lang, PAPER.phone)}</th>
                        <th className="r">{say(lang, PAPER.pending)}</th>
                        <th className="r">{say(lang, PAPER.late)}</th>
                        <th className="hide-p">{say(lang, PAPER.sign)}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {s.rows.map((r) => (
                        <tr key={r.studentId}>
                          <td>
                            <b>{r.studentName}</b>
                            {r.left ? <span style={{ fontSize: 11, color: "#a33", marginLeft: 6 }}>({say(lang, PAPER.left)})</span> : null}
                          </td>
                          <td className="hide-p">{r.fatherName ?? ""}</td>
                          <td className="hide-p" style={{ fontVariantNumeric: "tabular-nums" }}>{phoneOf(r.studentId)}</td>
                          <td className="r"><b>{rupees(r.pending)}</b></td>
                          <td className="r lf">{r.lateFee ? rupees(r.lateFee) : "—"}</td>
                          <td className="hide-p"><div className="sig">&nbsp;</div></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <div className="rp-sum">
                    <span>{say(lang, PAPER.total)} {rupees(s.pending)}</span>
                    <span className="lf" style={{ fontWeight: 500 }}>{say(lang, PAPER.lateSep)} {rupees(s.lateFee)}</span>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <EmptyState icon="checkCircle" title="Nobody owes a fee that is due" body="Students who owe only a late fee are not on this list." />
        )}
      </Section>
      <SendSheet open={sheet === "send"} onClose={close} data={data} sections={sections} />
      <ExportSheet data={data} open={sheet === "export"} onClose={close} filters={{ classId }} />
    </VxPage>
  );
}

function SendSheet({ open, onClose, data, sections }: { open: boolean; onClose: () => void; data: ReportsPageData; sections: ReturnType<typeof sectionDefaulters> }) {
  const toast = useToast();
  const [focus, setFocus] = useState(0);
  const byClass = new Map(data.classes.map((k) => [k.id, k]));
  const items = sections.map((s) => ({ s, k: s.classId ? byClass.get(s.classId) ?? null : null }));
  const withTeacher = items.filter((i) => i.k?.teacher);
  const cur = items[Math.min(focus, Math.max(0, items.length - 1))];
  const text = cur ? teacherListText(cur.s, data.today, data.schoolName) : "";
  const waLink = (phone: string | null | undefined, body: string) => {
    const d = (phone ?? "").replace(/\D/g, "");
    if (d.length < 10) return null;
    return `https://wa.me/${d.length === 10 ? `91${d}` : d}?text=${encodeURIComponent(body)}`;
  };
  const copy = async (body: string) => {
    try {
      await navigator.clipboard.writeText(body);
      toast.show({ text: "Copied · paste it in WhatsApp", tone: "ok" });
    } catch {
      toast.show({ text: "Could not copy on this device", tone: "bad" });
    }
  };
  const link = cur ? waLink(cur.k?.teacherPhone, text) : null;
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Send to class teachers"
      sub="Each teacher gets only their own class"
      footer={
        <>
          <button type="button" className="tap btn sec" style={{ flex: 1, height: 48 }} onClick={onClose}>Close</button>
          <button type="button" className="tap btn sec" style={{ flex: 1, height: 48 }} disabled={!cur} onClick={() => copy(text)}><Ic n="copy" size={18} />Copy</button>
          {link ? (
            <a className="tap btn pri" style={{ flex: 1.4, height: 48 }} href={link} target="_blank" rel="noreferrer"><Ic n="send" size={18} />Open WhatsApp</a>
          ) : (
            <button type="button" className="tap btn pri" style={{ flex: 1.4, height: 48 }} disabled>No phone</button>
          )}
        </>
      }
    >
      <div className="rp-c" style={{ gap: 14 }}>
        <div className="rp-f" style={{ padding: 12, borderRadius: 14, background: "var(--s2)", gap: 12 }}>
          <span className="rp-ib" style={{ background: "var(--accs)", color: "var(--accfg)" }}><Ic n="users" size={18} /></span>
          <span className="rp-c">
            <b>{withTeacher.length} class teachers · {items.length} lists</b>
            <span className="rp-m">Opens WhatsApp on this phone and you press send · nothing is sent by the app, no cost</span>
          </span>
        </div>
        <div className="rp-f" style={{ flexWrap: "wrap", gap: 6 }}>
          {items.map((i, n) => (
            <Chip key={i.s.classLabel} on={n === focus} onClick={() => setFocus(n)}>
              {i.k?.teacher ? `${i.k.teacher} · ` : ""}{i.s.classLabel}
            </Chip>
          ))}
        </div>
        {cur ? (
          <div className="rp-wa">
            <div>{text}</div>
          </div>
        ) : (
          <EmptyState icon="checkCircle" title="No lists to send" />
        )}
        {cur && !cur.k?.teacher ? <span className="rp-m" style={{ color: "var(--warnfg)" }}>No class teacher is set for {cur.s.classLabel}. Copy the list and give it by hand.</span> : null}
        <span className="rp-m">Late fee is shown on its own line and is never added to the fee pending.</span>
      </div>
    </Sheet>
  );
}

/* ---------- classwise heat table + cell ---------- */

function ClasswiseView({ data, sheet, setSheet, close }: ViewProps) {
  const { tx } = useVx();
  const cw = data.classwise!;
  const cell = data.cell;
  const due = cw.installmentNos.filter((n) => (cw.dueDates[n] ?? "9999") <= data.today);
  const notDue = cw.installmentNos.filter((n) => !due.includes(n));
  const order = new Map(data.classes.map((k, i) => [k.id, i]));
  const rows = [...cw.rows].sort((a, b) => (order.get(a.classId ?? "") ?? 999) - (order.get(b.classId ?? "") ?? 999) || a.classLabel.localeCompare(b.classLabel, "en", { numeric: true }));
  const teacher = (cid: string | null) => data.classes.find((k) => k.id === cid)?.teacher ?? null;
  const pendingToday = rows.reduce((s, r) => s + r.pendingToday, 0);
  const notDueYet = rows.reduce((s, r) => s + r.notDueYet, 0);
  const instTotal = (n: number, key: "due" | "notDue") => rows.reduce((s, r) => s + (r.cells[n]?.[key]?.amount ?? 0), 0);
  const max = Math.max(1, ...rows.flatMap((r) => due.map((n) => r.cells[n]?.due?.amount ?? 0)));
  const instName = (n: number) => (n === 99 ? "Last year" : `Inst ${n}`);
  const heat = (amount: number): CSSProperties => {
    const k = amount / max;
    return { background: `color-mix(in srgb, var(--acc) ${Math.round(12 + k * 60)}%, var(--card))`, color: k > 0.6 ? "#fff" : "var(--fg)" };
  };

  const detail = cell ? (
    <div className="rp-c" style={{ gap: 12, padding: 18 }}>
      <div className="rp-f" style={{ alignItems: "flex-start" }}>
        <span className="rp-c" style={{ flex: 1 }}>
          <b className="serif" style={{ fontSize: 20 }}>{cell.classLabel} · {instName(cell.installmentNo)}</b>
          <span className="rp-m">
            {cell.dueDate ? `Due ${shortDay(cell.dueDate)} · ` : ""}{cell.students.length} students · {rupees(cell.students.reduce((s, x) => s + x.pending, 0))}
          </span>
        </span>
        <Btn variant="ghost" icon="x" href="/reports?view=classwise" ariaLabel="Close" />
      </div>
      <div className="rp-f" style={{ alignItems: "flex-start", padding: "10px 12px", borderRadius: 12, background: cell.students[0]?.due === false ? "var(--s2)" : "var(--warns)", color: cell.students[0]?.due === false ? "var(--fg)" : "var(--warnfg)", fontSize: 13 }}>
        <Ic n="info" size={16} />
        <span>{cell.students[0]?.due === false ? "Not due yet. Kept apart from the pending today figure." : "Pending today. Late fee is shown on its own and is not part of this amount."}</span>
      </div>
      <Card pad={false} style={{ overflow: "hidden" }}>
        {cell.students.map((s) => (
          <Link key={s.studentId} href={`/fees/students/${s.studentId}`} className="tap rp-f" style={{ padding: "10px 14px", borderTop: "1px solid var(--bd)", color: "var(--fg)", textDecoration: "none", gap: 12 }}>
            <span className="rp-ib" style={{ background: "var(--s3)", fontSize: 12, fontWeight: 700 }}>{initials(s.studentName)}</span>
            <span className="rp-c" style={{ flex: 1 }}>
              <b className="rp-e">{s.studentName}{s.left ? <Pill tone="bad" style={{ marginLeft: 6 }}>left</Pill> : null}</b>
              <span className="rp-m rp-e">{[s.fatherName, s.phone].filter(Boolean).join(" · ")}</span>
            </span>
            <span className="rp-c" style={{ alignItems: "flex-end" }}>
              <b className="num">{rupees(s.pending)}</b>
              {s.lateFee ? <span style={{ fontSize: 11, color: "var(--warnfg)" }}>late fee {rupees(s.lateFee)}</span> : null}
            </span>
            <Ic n="chevRight" size={16} style={{ color: "var(--mut)" }} />
          </Link>
        ))}
        {!cell.students.length ? <EmptyState icon="checkCircle" title="Nothing pending in this cell" /> : null}
      </Card>
      {cell.students.length ? <Btn variant="pri" icon="bell" href="/reminders" big full>Remind these families</Btn> : null}
    </div>
  ) : null;

  const cellLink = (classLabel: string, n: number) => `/reports?view=classwise&class=${encodeURIComponent(classLabel)}&inst=${n}`;

  return (
    <VxPage>
      <TopBar
        crumb="Reports"
        title={tx(T.classwise)}
        mSub={`${rupeesShort(pendingToday)} pending today`}
        mBack="/reports"
        mAction={<Btn variant="ghost" icon="download" onClick={() => setSheet("export")} ariaLabel={tx(T.export)} />}
        actions={
          <>
            <BackBtn />
            <Btn icon="printer" onClick={() => window.print()}>{tx(T.print)}</Btn>
            <ExportBtn onClick={() => setSheet("export")} />
          </>
        }
      />
      <div style={{ display: "grid", gridTemplateColumns: detail ? "minmax(0,1fr) 400px" : "minmax(0,1fr)", alignItems: "start" }} className="stack">
        <Section>
          {detail ? <div className="only-m"><Card pad={false}>{detail}</Card></div> : null}
          <div className="g4" style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0,1fr))", gap: 12 }}>
            <Kpi label="Pending today" value={rupeesShort(pendingToday)} tone="var(--bad)" sub={due.length ? `installments ${due.filter((n) => n !== 99).join("–") || "—"}` : "nothing due yet"} />
            {due.filter((n) => n !== 99).slice(-2).map((n, i) => (
              <Kpi key={n} label={`${instName(n)} · ${dayMonth(cw.dueDates[n])}`} value={rupeesShort(instTotal(n, "due"))} sub="still unpaid" delay={40 * (i + 1)} />
            ))}
            <Kpi label="Not due yet" value={rupeesShort(notDueYet)} sub="kept apart · never added" delay={120} />
          </div>
          <div className="rp-f" style={{ justifyContent: "space-between" }}>
            <span className="rp-m">Tap any cell to see those students. Darker = more pending.</span>
            <span className="rp-f rp-m hide-m" style={{ gap: 4 }}>
              Less {[15, 30, 45, 60, 72].map((v) => <span key={v} style={{ width: 16, height: 10, borderRadius: 3, background: `color-mix(in srgb, var(--acc) ${v}%, var(--card))` }} />)} More
            </span>
          </div>
          <Card pad={false} style={{ overflow: "hidden" }}>
            <div className="rp-scroll" style={{ padding: 8 }}>
              <table className="rp-heat">
                <thead>
                  <tr>
                    <th>Class</th>
                    <th colSpan={due.length + 1} style={{ textAlign: "center", color: "var(--bad)" }}>Pending today</th>
                    <th colSpan={notDue.length + 1} style={{ textAlign: "center" }}>Not due yet</th>
                  </tr>
                  <tr>
                    <th />
                    {due.map((n) => <th key={n}>{instName(n)}{cw.dueDates[n] && n !== 99 ? ` · ${dayMonth(cw.dueDates[n])}` : ""}</th>)}
                    <th>Total</th>
                    {notDue.map((n) => <th key={n}>{instName(n)} · {dayMonth(cw.dueDates[n])}</th>)}
                    <th>Total</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.classLabel}>
                      <td style={{ minWidth: 110 }}>
                        <b>{r.classLabel}</b>
                        <div className="rp-m">{teacher(r.classId) ?? ""}</div>
                      </td>
                      {due.map((n) => {
                        const c = r.cells[n]?.due;
                        const on = cell?.classLabel === r.classLabel && cell?.installmentNo === n;
                        return (
                          <td key={n}>
                            {c ? (
                              <Link href={cellLink(r.classLabel, n)} scroll={false} className={`tap rp-hc${on ? " on" : ""}`} style={heat(c.amount)}>
                                <b>{rupees(c.amount)}</b>
                                <small>{c.students} {c.students === 1 ? "student" : "students"}</small>
                              </Link>
                            ) : (
                              <span className="rp-nd">—</span>
                            )}
                          </td>
                        );
                      })}
                      <td className="rp-nd" style={{ color: "var(--bad)", fontWeight: 700 }}>{rupees(r.pendingToday)}</td>
                      {notDue.map((n) => {
                        const c = r.cells[n]?.notDue;
                        return (
                          <td key={n}>
                            {c ? (
                              <Link href={cellLink(r.classLabel, n)} scroll={false} className="tap rp-nd" style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", color: "var(--fg)", textDecoration: "none" }}>
                                <span>{rupees(c.amount)}</span>
                                <small className="rp-m">{c.students} students</small>
                              </Link>
                            ) : (
                              <span className="rp-nd">—</span>
                            )}
                          </td>
                        );
                      })}
                      <td className="rp-nd">{rupees(r.notDueYet)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
          <span className="rp-m">Students who left are counted: they still owe. Late fee is never in these cells; it is on the defaulter list on its own line.</span>
        </Section>
        {detail ? <aside className="only-d unstick" style={{ position: "sticky", top: 64, height: "calc(100dvh - 64px)", overflowY: "auto", borderLeft: "1px solid var(--bd)", background: "var(--card)" }}>{detail}</aside> : null}
      </div>
      <ExportSheet data={data} open={sheet === "export"} onClose={close} />
    </VxPage>
  );
}

/* ---------- day book ---------- */

function DayBookView({ data, sheet, setSheet, close }: ViewProps) {
  const { tx } = useVx();
  const router = useRouter();
  const d = data.daybook!;
  const shift = (days: number) => {
    const next = new Date(Date.parse(`${d.date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
    if (next <= data.today) router.push(`/reports?view=daybook&date=${next}`);
  };
  const toneOf = (t: string) => (t === "good" ? "ok" : t === "warning" ? "warn" : t === "accent" ? "acc" : "mut") as "ok" | "warn" | "acc" | "mut";
  const closed = d.closure?.status === "closed";
  return (
    <VxPage>
      <TopBar
        crumb="Reports"
        title={tx(T.daybook)}
        mSub={`${shortDay(d.date)} · ${rupees(d.collected)}`}
        mBack="/reports"
        actions={
          <>
            <BackBtn />
            <Btn icon="printer" onClick={() => window.print()}>{tx(T.print)}</Btn>
            <ExportBtn onClick={() => setSheet("export")} />
          </>
        }
      />
      <Section>
        <div className="rp-f rp-noprint" style={{ flexWrap: "wrap", gap: 10 }}>
          <Btn icon="chevLeft" onClick={() => shift(-1)} ariaLabel="Day before" />
          <Input type="date" value={d.date} max={data.today} onChange={(e) => e.target.value && router.push(`/reports?view=daybook&date=${e.target.value}`)} aria-label="Day" style={{ width: 170 }} />
          <Btn icon="chevRight" onClick={() => shift(1)} disabled={d.date >= data.today} ariaLabel="Next day" />
          <span style={{ flex: 1 }} />
          <Pill tone={closed ? "ok" : d.closure ? "warn" : "mut"} icon={closed ? "lock" : "clock"}>
            {closed ? `Day closed${d.closure?.closedByName ? ` by ${d.closure.closedByName}` : ""}${d.closure?.closedAt ? ` · ${clock(d.closure.closedAt)}` : ""}` : d.closure ? `Day close ${d.closure.status.replace("_", " ")}` : "Day not closed"}
          </Pill>
          <Btn variant="ghost" href={`/fees/finance-controls?date=${d.date}`} icon="arrowRight">Day close</Btn>
        </div>
        <div className="g4" style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0,1fr))", gap: 12 }}>
          <Kpi label="Collected" value={rupees(d.collected)} sub={`${d.receiptCount} receipts`} />
          <Kpi label="Reversed" value={String(d.reversedCount)} sub="kept · shown below" tone={d.reversedCount ? "var(--bad)" : undefined} delay={40} />
          <Kpi label="Paid out" value={rupees(d.paidOut)} sub="refunds processed" delay={80} />
          <Kpi label="Entries" value={String(d.rows.length)} sub="in time order" delay={120} />
        </div>
        <Card pad={false} style={{ overflow: "hidden" }}>
          <div className="rp-db rp-dbh">
            <span>Time</span>
            <span className="hide-p">Receipt</span>
            <span>Student</span>
            <span className="hide-p">Mode</span>
            <span style={{ textAlign: "right" }}>In</span>
            <span className="hide-p" style={{ textAlign: "right" }}>Out</span>
            <span className="hide-p">Status</span>
          </div>
          {d.rows.map((r) => (
            <div key={r.id} className="rp-db">
              <span className="num rp-m">{clock(r.postedAt)}</span>
              <span className="hide-p num">{r.receiptNumber ?? "—"}</span>
              <span className="rp-c">
                {r.studentId ? <Link href={`/fees/students/${r.studentId}`} className="rp-e" style={{ fontWeight: 600, color: "var(--fg)" }}>{r.studentName}</Link> : <b className="rp-e">{r.studentName}</b>}
                <span className="rp-m rp-e">{[r.classLabel, r.type !== "collection" ? r.type : null, r.note].filter(Boolean).join(" · ")}</span>
              </span>
              <span className="hide-p">{r.mode ? MODE_LABEL[r.mode] ?? r.mode : "—"}</span>
              <span className="num" style={{ textAlign: "right", fontWeight: 700, color: r.cashOut ? "var(--bad)" : undefined }}>{r.cashIn ? rupees(r.cashIn) : r.cashOut ? `−${rupees(r.cashOut)}` : "—"}</span>
              <span className="hide-p num" style={{ textAlign: "right" }}>{r.cashOut ? rupees(r.cashOut) : "—"}</span>
              <span className="hide-p"><Pill tone={toneOf(r.tone)}>{r.status}</Pill></span>
            </div>
          ))}
          {!d.rows.length ? <EmptyState icon="book" title={`Nothing on ${dateLabel(d.date)}`} body="No receipt, refund or correction was written that day." /> : null}
        </Card>
      </Section>
      <ExportSheet data={data} open={sheet === "export"} onClose={close} />
    </VxPage>
  );
}

/* ---------- schedules ---------- */

const REPORT_KEYS = [
  { key: "collection", label: "Daily collection", icon: "chart" as IconName },
  { key: "defaulters", label: "Defaulter list (हिंदी)", icon: "alert" as IconName },
  { key: "classwise", label: "Pending by class", icon: "grid" as IconName },
  { key: "daybook", label: "Day book", icon: "book" as IconName },
];

function describeSchedule(s: ReportSchedule) {
  const time = new Intl.DateTimeFormat("en-IN", { hour: "numeric", minute: "2-digit", hour12: true, timeZone: "UTC" }).format(new Date(`2000-01-01T${s.sendTime}:00Z`));
  const when = s.frequency === "daily" ? "Every day" : s.frequency === "weekly" ? `${WEEKDAYS[s.weekday ?? 1]}s` : "1st of the month";
  return `${when} · ${time} · ${s.format === "excel" ? "Excel" : "PDF"}`;
}

function ScheduleView({ data, sheet, setSheet, close, readOnly }: ViewProps & { readOnly: boolean }) {
  const { tx } = useVx();
  const router = useRouter();
  const toast = useToast();
  const [busy, start] = useTransition();
  const toggle = (s: ReportSchedule, on: boolean) =>
    start(async () => {
      const r = await toggleScheduleAction(s.id, on);
      toast.show({ text: r.message, tone: r.ok ? "ok" : "bad" });
      if (r.ok) router.refresh();
    });
  return (
    <VxPage>
      <TopBar
        crumb="Reports"
        title={tx(T.schedule)}
        mTitle="Scheduled reports"
        mSub={`${data.schedules.length} scheduled`}
        mBack="/reports"
        actions={
          <>
            <BackBtn />
            <Btn variant="pri" icon="plus" onClick={() => setSheet("newsch")} disabled={readOnly}>Schedule a report</Btn>
          </>
        }
      />
      <Section>
        <div className="only-m">
          <Btn variant="pri" icon="plus" onClick={() => setSheet("newsch")} disabled={readOnly}>Schedule a report</Btn>
        </div>
        <div className="rp-f" style={{ alignItems: "flex-start", padding: "12px 14px", borderRadius: 14, background: "var(--warns)", color: "var(--warnfg)", fontSize: 13 }}>
          <Ic n="info" size={18} />
          <span>Schedules are saved, but nothing is sent yet: sending on WhatsApp costs money per message and the sender is not switched on. Use Send to class teachers on the defaulter list meanwhile.</span>
        </div>
        {data.schedules.map((s, i) => {
          const r = REPORT_KEYS.find((k) => k.key === s.reportKey);
          return (
            <Card key={s.id} className="rise" style={{ display: "flex", gap: 14, alignItems: "flex-start", animationDelay: `${i * 30}ms` }}>
              <span className="rp-ib" style={{ background: "var(--accs)", color: "var(--accfg)" }}><Ic n={r?.icon ?? "file"} size={18} /></span>
              <span className="rp-c" style={{ flex: 1, gap: 2 }}>
                <b style={{ fontSize: 15 }}>{s.title} → {s.recipients.join(", ")}</b>
                <span style={{ fontSize: 14 }}>{describeSchedule(s)}</span>
                <span className="rp-m">{s.active ? "On · waiting for the sender to be switched on" : "Paused · nothing will be sent"}</span>
                {s.lastSentAt ? <span className="rp-m" style={{ color: "var(--ok)" }}>Last sent {shortDay(s.lastSentAt)}</span> : null}
              </span>
              <Switch on={s.active} onChange={(on) => toggle(s, on)} label={s.active ? "Pause" : "Turn on"} disabled={busy || readOnly} />
            </Card>
          );
        })}
        {!data.schedules.length ? <EmptyState icon="clock" title="Nothing scheduled" body="Schedule the daily collection for the principal, or the defaulter list for class teachers." /> : null}
      </Section>
      <NewScheduleSheet open={sheet === "newsch"} onClose={close} readOnly={readOnly} />
    </VxPage>
  );
}

function NewScheduleSheet({ open, onClose, readOnly }: { open: boolean; onClose: () => void; readOnly: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const [busy, start] = useTransition();
  const [report, setReport] = useState("collection");
  const [who, setWho] = useState<string[]>(["Principal"]);
  const [freq, setFreq] = useState<"daily" | "weekly" | "monthly">("daily");
  const [weekday, setWeekday] = useState(1);
  const [time, setTime] = useState("18:00");
  const save = () =>
    start(async () => {
      const r = await createScheduleAction({ reportKey: report, recipients: who, frequency: freq, weekday: freq === "weekly" ? weekday : null, sendTime: time });
      toast.show({ text: r.message, tone: r.ok ? "ok" : "bad" });
      if (r.ok) {
        onClose();
        router.push("/reports?view=schedule");
        router.refresh();
      }
    });
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Schedule a report"
      sub="Saved now · sent once the WhatsApp sender is switched on"
      footer={
        <>
          <button type="button" className="tap btn sec" style={{ flex: 1, height: 48 }} onClick={onClose}>Cancel</button>
          <button type="button" className="tap btn pri" style={{ flex: 1.6, height: 48 }} disabled={busy || readOnly || !who.length} onClick={save}><Ic n="check" size={18} />Save schedule</button>
        </>
      }
    >
      <div className="rp-c" style={{ gap: 14 }}>
        <Field label="Report">
          <div className="rp-c" style={{ gap: 8 }}>
            {REPORT_KEYS.map((k) => <RadioCard key={k.key} checked={report === k.key} onSelect={() => setReport(k.key)} title={k.label} icon={k.icon} />)}
          </div>
        </Field>
        <Field label="Who gets it">
          <div className="rp-f" style={{ flexWrap: "wrap", gap: 6 }}>
            {["Principal", "Admin", "Accountant", "Class teachers"].map((r) => (
              <Chip key={r} on={who.includes(r)} onClick={() => setWho((w) => (w.includes(r) ? w.filter((x) => x !== r) : [...w, r]))}>{r}</Chip>
            ))}
          </div>
        </Field>
        <Field label="How often">
          <Seg options={[{ value: "daily", label: "Every day" }, { value: "weekly", label: "Weekly" }, { value: "monthly", label: "Monthly" }]} value={freq} onChange={setFreq} label="How often" />
        </Field>
        {freq === "weekly" ? (
          <Field label="Day">
            <Select value={String(weekday)} onChange={(e) => setWeekday(Number(e.target.value))}>
              {WEEKDAYS.map((d, i) => <option key={d} value={i}>{d}</option>)}
            </Select>
          </Field>
        ) : null}
        <Field label="Time">
          <Input type="time" value={time} onChange={(e) => setTime(e.target.value)} />
        </Field>
        {who.includes("Class teachers") ? <span className="rp-m">Each class teacher gets only their own class, Hindi first.</span> : null}
      </div>
    </Sheet>
  );
}

/* ---------- export ---------- */

function ExportSheet({ data, open, onClose, filters = {} }: { data: ReportsPageData; open: boolean; onClose: () => void; filters?: { classId?: string; mode?: string } }) {
  const [format, setFormat] = useState<"xlsx" | "pdf" | "csv">("xlsx");
  const c = data.collection;
  const [dates, setDates] = useState<"range" | "session">("range");
  const view = data.view === "hub" || data.view === "schedule" ? "collection" : data.view;
  const qs = (o: Record<string, string | undefined>) => new URLSearchParams(Object.entries(o).filter((e): e is [string, string] => Boolean(e[1]))).toString();
  const session = data.sessionLabel;
  const range =
    view === "daybook" && data.daybook
      ? { from: data.daybook.date, to: data.daybook.date }
      : dates === "session" || !c
        ? { from: data.sessionFrom, to: data.today }
        : { from: c.from, to: c.to };
  let href = "";
  let title = "";
  let note = "";
  if (view === "collection" || view === "daybook") {
    title = view === "daybook" ? "Day book" : "Daily collection";
    if (format === "csv") {
      href = `/fees/reports/export?${qs({ report: "daily-collection", fromDate: range.from, toDate: range.to, classId: filters.classId, paymentMode: filters.mode, sessionLabel: session })}`;
      note = `${dateLabel(range.from)} to ${dateLabel(range.to)}${filters.classId || filters.mode ? " · with your filters" : ""}`;
    } else {
      href = `/fees/exports/receipt-register?${qs({ format, session })}`;
      note = "The receipt register for the whole session, every receipt and reversal.";
    }
  } else if (view === "defaulters") {
    title = "Defaulter list";
    href = format === "csv" ? `/fees/reports/export?${qs({ report: "outstanding", classId: filters.classId, sessionLabel: session })}` : `/fees/exports/defaulters?${qs({ format, session, classId: filters.classId })}`;
    note = "Fees and late fee in separate columns.";
  } else {
    title = "Pending by class";
    href = format === "csv" ? `/fees/reports/export?${qs({ report: "outstanding", sessionLabel: session })}` : `/fees/exports/class-wise-dues?${qs({ format, session })}`;
    note = "Pending today and not due yet stay in separate columns.";
  }
  const label = format === "xlsx" ? "Excel" : format === "pdf" ? "PDF" : "CSV";
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={`Export · ${title}`}
      sub="Pick a format"
      footer={
        <>
          <button type="button" className="tap btn sec" style={{ flex: 1, height: 48 }} onClick={onClose}>Cancel</button>
          <a className="tap btn pri" style={{ flex: 1.6, height: 48 }} href={href} download onClick={onClose}><Ic n="download" size={18} />Export {label}</a>
        </>
      }
    >
      <div className="rp-c" style={{ gap: 14 }}>
        <Field label="Format">
          <div className="g3" style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0,1fr))", gap: 8 }}>
            <RadioCard checked={format === "xlsx"} onSelect={() => setFormat("xlsx")} icon="table" title="Excel" sub=".xlsx · for sums" />
            <RadioCard checked={format === "pdf"} onSelect={() => setFormat("pdf")} icon="fileText" title="PDF" sub="Ready to print" />
            <RadioCard checked={format === "csv"} onSelect={() => setFormat("csv")} icon="list" title="CSV" sub="For other software" />
          </div>
        </Field>
        {view === "collection" && format === "csv" && c ? (
          <Field label="Dates">
            <div className="rp-f" style={{ gap: 6, flexWrap: "wrap" }}>
              <Chip on={dates === "range"} onClick={() => setDates("range")}>{dayMonth(c.from)} – {dayMonth(c.to)}</Chip>
              <Chip on={dates === "session"} onClick={() => setDates("session")}>Whole session</Chip>
            </div>
          </Field>
        ) : null}
        <span className="rp-m">{note}</span>
      </div>
    </Sheet>
  );
}

