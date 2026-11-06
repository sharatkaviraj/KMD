"use client";

import { Crest } from "@/vx/screens/system/brand";
import "./reports.css";

import Link from "@/vx/ui/link";
import { useRouter } from "next/navigation";
import { createContext, use, useState, useSyncExternalStore, useTransition, type CSSProperties, type ReactNode } from "react";

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
import { Btn, Card, EmptyState, Kpi, Pill } from "@/vx/ui/primitives";

type Lang = "hi" | "en" | "both";

const MODE_LABEL: Record<string, string> = { upi: "UPI", cash: "Cash", cheque: "Cheque", bank_transfer: "Bank", online: "Online (Razorpay)" };
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

/** Words for the due rule, which every money screen shares (fees/domain/due-rule.ts). */
const W = {
  pendingTodayAsOf: (day: string) => p(`Pending today · ${day}`, `आज तक बकाया · ${day}`),
  pendingStudentsInst: (n: number, inst: string) =>
    p(`${n} ${n === 1 ? "student" : "students"} · installments ${inst}`, `${n} छात्र · किस्त ${inst}`),
  nothingDue: p("Nothing due yet", "अभी कुछ देय नहीं"),
  pendingRule: p("Pending today = due before today; an installment due today is not late yet.", "आज तक बकाया = आज से पहले की देय तारीख वाली फ़ीस; आज देय किस्त अभी देर से नहीं है।"),
  datesVary: p("* A few children have a different due date for this installment; each child is counted by their own date.", "* इस किस्त की देय तारीख कुछ बच्चों की अलग है; हर बच्चा अपनी तारीख से गिना गया है।"),
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

/**
 * Whether this reader may open the detailed fee reports and the exports
 * (the fee app's `reports:view`). The office reads these screens but its fee
 * role does not have it, and the links used to end on "access denied".
 */
const DetailedReports = createContext(true);

export function Reports({
  data,
  initialSheet,
  initialLeft,
  readOnly,
  detailed = true,
}: {
  data: ReportsPageData;
  initialSheet: ReportsSheet;
  initialLeft: boolean;
  readOnly: boolean;
  detailed?: boolean;
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

  return <DetailedReports value={detailed}>{reportView(data, sheet, setSheet, close, initialLeft, readOnly)}</DetailedReports>;
}

function reportView(data: ReportsPageData, sheet: ReportsSheet, setSheet: (s: ReportsSheet) => void, close: () => void, initialLeft: boolean, readOnly: boolean) {
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

/** The phone's row of actions under the top bar (the desktop has them in the top bar). */
function MActs({ items }: { items: { icon: IconName; label: string; onClick?: () => void; href?: string; pri?: boolean }[] }) {
  return (
    <div className="only-m hs rp-noprint" style={{ display: "flex", gap: 8, padding: "12px 16px 0" }}>
      {items.map((a) =>
        a.href ? (
          <Link key={a.label} href={a.href} className={`tap btn ${a.pri ? "pri" : "sec"}`} style={{ flex: "none", height: 40, fontSize: 13 }}>
            <Ic n={a.icon} size={14} />
            {a.label}
          </Link>
        ) : (
          <button key={a.label} type="button" className={`tap btn ${a.pri ? "pri" : "sec"}`} onClick={a.onClick} style={{ flex: "none", height: 40, fontSize: 13 }}>
            <Ic n={a.icon} size={14} />
            {a.label}
          </button>
        ),
      )}
    </div>
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

/** "Thu 8 Oct", as the design writes days (the shared `shortDay` says "Thu, 8 Oct"). */
function dayName(iso: string) {
  const d = new Date(`${iso.slice(0, 10)}T12:00:00Z`);
  return `${["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][d.getUTCDay()]} ${d.getUTCDate()} ${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][d.getUTCMonth()]}`;
}

/* ---------- hub ---------- */

/** The design's 96×32 sparkline: a drawn line, no dot. */
function Spark({ values }: { values: number[] }) {
  const max = Math.max(1, ...values);
  const min = Math.min(...values, max);
  const pts = values.map((v, i) => `${((i / Math.max(1, values.length - 1)) * 94 + 1).toFixed(1)},${(30 - ((v - min) / Math.max(1, max - min)) * 28).toFixed(1)}`);
  let len = 0;
  for (let i = 1; i < pts.length; i += 1) {
    const [x1, y1] = pts[i - 1].split(",").map(Number);
    const [x2, y2] = pts[i].split(",").map(Number);
    len += Math.hypot(x2 - x1, y2 - y1);
  }
  return (
    <svg width="96" height="32" viewBox="0 0 96 32" aria-hidden="true" style={{ flex: "none" }}>
      <polyline points={pts.join(" ")} style={{ fill: "none", stroke: "var(--acc)", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round", ["--len" as string]: len.toFixed(1), strokeDasharray: len.toFixed(1), animation: "xDraw 1.1s .2s var(--ease) both" }} />
    </svg>
  );
}

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
        { key: "collection", group: "money", icon: "chart", tone: ["var(--accs)", "var(--accfg)"], title: T.collection, sub: "Receipts by day, mode and class", value: rupees(h.todayTotal), caption: `today · ${h.todayReceipts} receipts`, href: "/reports?view=collection", extra: <Spark values={h.spark} /> },
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
            <span style={{ display: "flex", flex: "none", width: 96, height: 10, borderRadius: 5, overflow: "hidden", background: "var(--s3)", transformOrigin: "left", animation: "xGrowX .8s .2s var(--ease) both" }}>
              {(["upi", "cash", "cheque", "bank_transfer"] as const).map((m) => (
                <span key={m} style={{ width: `${(share[m] / monthSum) * 100}%`, background: MODE_COLOR[m] }} />
              ))}
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
  const detailed = use(DetailedReports);
  const needle = q.trim().toLowerCase();
  const shown = cards.filter((c) => detailed || c.key !== "all").filter((c) => !needle || `${c.title.en} ${c.title.hi} ${c.sub}`.toLowerCase().includes(needle));
  const pinned = pins.map((k) => cards.find((c) => c.key === k)).filter((c): c is HubCard => Boolean(c) && (detailed || c!.key !== "all"));

  const card = (c: HubCard, i: number) => {
    const on = pins.includes(c.key);
    return (
      <div key={c.key} className="card lift rp-xi" style={{ position: "relative", animationDelay: `${Math.min(i, 14) * 30}ms` }}>
        <Link href={c.href} className="tap rp-rb" style={{ flexDirection: "column", alignItems: "stretch", gap: 12, padding: "14px 16px", borderRadius: 18 }}>
          <span className="rp-f" style={{ gap: 12, paddingRight: 34 }}>
            <span className="rp-ib rp-t36" style={{ background: c.tone[0], color: c.tone[1] }}>
              <Ic n={c.icon} />
            </span>
            <span className="rp-c" style={{ flex: 1 }}>
              <span className="rp-tt">{tx(c.title)}</span>
              <span className="rp-m">{c.sub}</span>
            </span>
          </span>
          <span className="rp-f" style={{ justifyContent: "space-between", alignItems: "flex-end", minHeight: 36 }}>
            <span className="rp-c">
              <span className="num" style={{ fontSize: 19, fontWeight: 700 }}>{c.value}</span>
              <span className="rp-m">{c.caption}</span>
            </span>
            {c.extra}
          </span>
        </Link>
        <button type="button" className={`tap btn ghost rp-sq${on ? " on" : ""}`} aria-pressed={on} aria-label={`${on ? "Unpin" : "Pin"} ${tx(c.title)}`} onClick={() => togglePin(c.key)} style={{ position: "absolute", top: 10, right: 10, color: on ? "var(--acc)" : undefined }}>
          <Ic n="pin" />
        </button>
      </div>
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
            <label className="rp-f" style={{ width: 280, height: 40, borderRadius: 12, border: "1px solid var(--bd)", background: "var(--card)", padding: "0 12px", color: "var(--mut)" }}>
              <Ic n="search" />
              <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={tx(T.find)} aria-label={tx(T.find)} style={{ flex: 1, minWidth: 0, height: 36, border: 0, outline: "none", background: "transparent", color: "var(--fg)", fontSize: 14 }} />
            </label>
            <Btn icon="clock" href="/reports?view=schedule">
              {tx(T.schedule)} <Pill tone="acc">{h?.schedules ?? 0}</Pill>
            </Btn>
          </>
        }
      />
      <Section>
        <label className="only-m rp-f" style={{ height: 46, borderRadius: 23, border: "1px solid var(--bds)", background: "var(--card)", padding: "0 14px", color: "var(--mut)" }}>
          <Ic n="search" />
          <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={tx(T.find)} aria-label={tx(T.find)} style={{ flex: 1, minWidth: 0, height: 40, border: 0, outline: "none", background: "transparent", color: "var(--fg)", fontSize: 16 }} />
        </label>
        {pinned.length && !needle ? (
          <div className="rp-c" style={{ gap: 8 }}>
            <span className="sech">{tx(T.pinned)}</span>
            <div className="hs" style={{ display: "flex", gap: 10, padding: "2px 2px 6px" }}>
              {pinned.map((c, i) => (
                <Link key={c.key} href={c.href} className="tap card lift rp-f rp-xi" style={{ flex: "none", minWidth: 230, padding: "12px 14px", gap: 12, color: "var(--fg)", animationDelay: `${i * 30}ms` }}>
                  <span className="rp-ib rp-t36" style={{ background: c.tone[0], color: c.tone[1] }}>
                    <Ic n={c.icon} />
                  </span>
                  <span className="rp-c">
                    <span style={{ fontSize: 14, fontWeight: 700 }}>{tx(c.title)}</span>
                    <span className="num" style={{ fontSize: 13 }}>
                      <b>{c.value}</b> <span style={{ color: "var(--mut)" }}>{c.caption}</span>
                    </span>
                  </span>
                </Link>
              ))}
            </div>
          </div>
        ) : null}
        {(["money", "more"] as const).map((g) => {
          const list = shown.filter((c) => c.group === g);
          if (!list.length) return null;
          return (
            <div key={g} className="rp-c" style={{ gap: 8 }}>
              <span className="sech">{tx(g === "money" ? T.money : T.more)}</span>
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
  const [bar, setBar] = useState<string | null>(null);
  const receipts = c.receipts.map((r) => ({ paymentDate: r.date, paymentMode: r.mode, amount: r.amount, classId: r.classId, reversed: r.reversed }));
  const buckets = bucketCollection(receipts, c.from, c.to, { mode, classId });
  const monthly = buckets.length > 0 && buckets[0].key.length === 7;
  const past = buckets.filter((b) => b.key <= (monthly ? data.today.slice(0, 7) : data.today));
  const total = sumBuckets(past);
  const working = past.filter((b) => b.total > 0);
  const best = working.reduce<(typeof buckets)[number] | null>((m, b) => (!m || b.total > m.total ? b : m), null);
  const reversed = c.receipts.filter((r) => r.reversed && (!mode || r.mode === mode) && (!classId || r.classId === classId)).length;
  const label = (key: string) => (monthly ? new Intl.DateTimeFormat("en-IN", { month: "short", year: "2-digit" }).format(new Date(`${key}-01T00:00:00Z`)) : dayName(key));
  const go = (preset: CollectionPreset, extra = "") => router.push(`/reports?view=collection&range=${preset}${extra}`);
  const presets: { value: CollectionPreset; label: string }[] = [
    { value: "month", label: "This month" },
    { value: "last", label: "Last month" },
    { value: "session", label: "Session" },
    { value: "custom", label: "Custom" },
  ];
  const isSunday = (d: string) => new Date(`${d}T00:00:00Z`).getUTCDay() === 0;
  const todayKey = monthly ? data.today.slice(0, 7) : data.today;
  const maxV = Math.max(1, ...past.map((b) => b.total));
  const sel = bar ?? (buckets.some((b) => b.key === todayKey) ? todayKey : (past[past.length - 1]?.key ?? null));
  const pi = Math.max(0, presets.findIndex((x) => x.value === c.preset));
  const modes = ["upi", "cash", "cheque", "bank_transfer"] as const;
  const rows = past.filter((b) => b.total > 0 || (!monthly && isSunday(b.key)));
  const span = monthly ? "" : new Intl.DateTimeFormat("en-IN", { month: "long", timeZone: "UTC" }).format(new Date(`${c.from}T00:00:00Z`));
  const kpis: { label: string; v: string; sub: string; fg?: string }[] = [
    { label: "Collected", v: rupees(total.total), sub: `${total.receipts} receipts` },
    { label: monthly ? "Average per month" : "Average per working day", v: rupees(working.length ? Math.round(total.total / working.length) : 0), sub: `${working.length} ${monthly ? "months" : "working days"}` },
    { label: monthly ? "Best month" : "Best day", v: best ? rupees(best.total) : "—", sub: best ? label(best.key) : "no collection" },
    { label: "Reversed receipts", v: String(reversed), sub: "shown · not in the total", fg: reversed ? "var(--bad)" : undefined },
  ];

  return (
    <VxPage className="rp-lh">
      <TopBar
        crumb="Reports"
        title={tx(T.collection)}
        mSub={`${c.preset === "month" || c.preset === "last" ? span : `${dayMonth(c.from)} – ${dayMonth(c.to)}`} · ${rupees(total.total)}`}
        mBack="/reports"
        actions={
          <>
            <BackBtn />
            <Btn icon="printer" onClick={() => window.print()}>{tx(T.print)}</Btn>
            <Btn icon="clock" href="/reports?view=schedule&sheet=newsch">Schedule</Btn>
            <ExportBtn onClick={() => setSheet("export")} />
          </>
        }
      />
      <MActs
        items={[
          { icon: "printer", label: tx(T.print), onClick: () => window.print() },
          { icon: "clock", label: "Schedule", href: "/reports?view=schedule&sheet=newsch" },
          { icon: "download", label: tx(T.export), onClick: () => setSheet("export"), pri: true },
        ]}
      />
      <div className="pad rp-scr">
        <div className="rp-f rp-noprint" style={{ flexWrap: "wrap", gap: 10 }}>
          <div className="seg" role="radiogroup" aria-label="Dates" style={{ gridTemplateColumns: "repeat(4, minmax(0, 1fr))", width: 440, maxWidth: "100%" }}>
            <span className="thumb" aria-hidden="true" style={{ width: "calc((100% - 6px) / 4)", transform: `translateX(${pi * 100}%)` }} />
            {presets.map((o) => (
              <button key={o.value} type="button" role="radio" aria-checked={c.preset === o.value} className={`tap${c.preset === o.value ? " on" : ""}`} onClick={() => (o.value === "custom" ? go("custom", `&from=${from}&to=${to}`) : go(o.value))}>
                {o.label}
              </button>
            ))}
          </div>
          <div className="hs" style={{ display: "flex", gap: 6, flex: 1, minWidth: 0 }} role="group" aria-label="Class">
            <button type="button" className={`tap chip${!classId ? " on" : ""}`} aria-pressed={!classId} onClick={() => setClassId("")}>All classes</button>
            {data.classes.map((k) => (
              <button key={k.id} type="button" className={`tap chip${classId === k.id ? " on" : ""}`} aria-pressed={classId === k.id} onClick={() => setClassId(k.id)}>{k.label}</button>
            ))}
          </div>
        </div>
        <div className="hs rp-noprint" style={{ display: "flex", gap: 6 }} role="group" aria-label="Mode">
          <button type="button" className={`tap chip${!mode ? " on" : ""}`} aria-pressed={!mode} onClick={() => setMode("")}>
            <span className="rp-dt" style={{ width: 8, height: 8, background: "var(--sub)" }} />
            All modes
          </button>
          {modes.map((m) => (
            <button key={m} type="button" className={`tap chip${mode === m ? " on" : ""}`} aria-pressed={mode === m} onClick={() => setMode(m)}>
              <span className="rp-dt" style={{ width: 8, height: 8, background: MODE_COLOR[m] }} />
              {MODE_LABEL[m]}
            </button>
          ))}
        </div>
        {c.preset === "custom" ? (
          <div className="rp-f rp-noprint fadein" style={{ flexWrap: "wrap", gap: 10, alignItems: "flex-end" }}>
            <label className="field"><span>From</span><Input type="date" value={from} max={data.today} onChange={(e) => setFrom(e.target.value)} /></label>
            <label className="field"><span>To</span><Input type="date" value={to} max={data.today} onChange={(e) => setTo(e.target.value)} /></label>
            <Btn variant="pri" onClick={() => go("custom", `&from=${from}&to=${to}`)}>Show</Btn>
          </div>
        ) : null}
        <div className="g4" style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 12 }}>
          {kpis.map((k, i) => (
            <div key={k.label} className="card rise rp-c" style={{ padding: "14px 16px", gap: 2, animationDelay: `${i * 40}ms` }}>
              <span className="rp-m" style={{ fontWeight: 600 }}>{k.label}</span>
              <span className="num" style={{ fontSize: 21, fontWeight: 700, color: k.fg }}>{k.v}</span>
              <span className="rp-m">{k.sub}</span>
            </div>
          ))}
        </div>
        <div className="card" style={{ padding: 16 }}>
          <div className="rp-f" style={{ justifyContent: "space-between", flexWrap: "wrap" }}>
            <span className="rp-c">
              <span className="rp-tt">Collected by {monthly ? "month" : "day"}{span ? ` · ${span}` : ""}</span>
              <span className="rp-m">Hover or tap a bar to see the amount</span>
            </span>
            <span className="rp-f rp-m">
              <span className="rp-dt" style={{ background: "var(--c1)" }} />
              Collected
              <span className="rp-dt" style={{ background: "var(--acc)", marginLeft: 8 }} />
              {monthly ? "This month" : "Today"}
            </span>
          </div>
          <div className="hs" style={{ marginTop: 8 }}>
            <div style={{ minWidth: monthly ? "100%" : Math.max(560, buckets.length * 22), height: 210, display: "flex", alignItems: "flex-end", gap: 4, paddingTop: 40, borderBottom: "1px solid var(--bd)" }}>
              {buckets.map((b, i) => {
                const fut = b.key > todayKey;
                const on = b.key === sel && !fut;
                const h = fut ? "6%" : b.total ? `${Math.max(3, (b.total / maxV) * 100).toFixed(1)}%` : "2%";
                const n = buckets.length;
                return (
                  <button key={b.key} type="button" className="tap" aria-label={fut ? `${label(b.key)} not yet` : `${label(b.key)} ${rupees(b.total)}`} onClick={() => !fut && setBar(b.key)} onMouseEnter={() => !fut && setBar(b.key)} style={{ flex: 1, minWidth: 0, height: "100%", display: "flex", flexDirection: "column", justifyContent: "flex-end", alignItems: "center", border: 0, background: "transparent", padding: 0, position: "relative" }}>
                    {on ? (
                      <span style={{ position: "absolute", bottom: `calc(${h} + 6px)`, left: i < 3 ? "0" : i > n - 4 ? "100%" : "50%", transform: `translateX(${i < 3 ? "0" : i > n - 4 ? "-100%" : "-50%"})`, zIndex: 2 }}>
                        <span className="pill num" style={{ height: 26, padding: "0 10px", fontSize: 12, background: "var(--tbg)", color: "var(--tfg)", animation: "xPopIn .25s var(--spring) both" }}>{label(b.key)} · {rupees(b.total)}</span>
                      </span>
                    ) : null}
                    <span style={{ width: "100%", maxWidth: 28, height: h, borderRadius: "6px 6px 2px 2px", background: fut ? "transparent" : on || b.key === todayKey ? "var(--acc)" : b.total ? "var(--c1)" : "var(--s3)", border: fut ? "1.5px dashed var(--bds)" : 0, transformOrigin: "bottom", animation: "xGrowY .6s var(--ease) both", animationDelay: `${Math.min(i, 14) * 30}ms` }} />
                  </button>
                );
              })}
            </div>
            <div style={{ minWidth: monthly ? "100%" : Math.max(560, buckets.length * 22), display: "flex", gap: 4, paddingTop: 6 }}>
              {buckets.map((b) => (
                <span key={b.key} className="num" style={{ flex: 1, minWidth: 0, textAlign: "center", fontSize: 11, color: b.key === todayKey || b.key === sel ? "var(--accfg)" : "var(--sub)", fontWeight: b.key === todayKey || b.key === sel ? 700 : 500 }}>
                  {monthly ? label(b.key).split(" ")[0] : String(Number(b.key.slice(8)))}
                </span>
              ))}
            </div>
          </div>
          {!total.total ? <EmptyState icon="chart" title="No collection in these dates" body="Pick another range or class." /> : null}
        </div>
        <div className="only-d card" style={{ overflow: "clip" }}>
          <div className="rp-cg" style={{ position: "sticky", top: 64, zIndex: 2, background: "var(--s2)", borderBottom: "1px solid var(--bd)", fontSize: 12, fontWeight: 700, color: "var(--mut)", textTransform: "uppercase", letterSpacing: ".05em" }}>
            <span>{monthly ? "Month" : "Day"}</span>
            <span style={{ textAlign: "right" }}>Receipts</span>
            <span style={{ textAlign: "right" }}>UPI</span>
            <span style={{ textAlign: "right" }}>Cash</span>
            <span style={{ textAlign: "right" }}>Cheque</span>
            <span style={{ textAlign: "right" }}>Bank</span>
            <span style={{ textAlign: "right" }}>Total</span>
          </div>
          <div className="rp-ls">
            {rows.map((b, i) => {
              const note = !b.total && isSunday(b.key) ? "Sunday" : "";
              return (
                <div key={b.key} className="rp-cg row num rp-xi" style={{ fontSize: 13, opacity: note ? 0.55 : 1, animationDelay: `${Math.min(i, 14) * 30}ms` }}>
                  <span className="rp-f" style={{ fontWeight: 600, color: "var(--fg)" }}>
                    {label(b.key)}
                    {note ? <span className="pill" style={{ background: "var(--s3)", color: "var(--mut)" }}>{note}</span> : null}
                  </span>
                  <span style={{ textAlign: "right", color: "var(--mut)" }}>{b.receipts || "—"}</span>
                  {modes.map((m) => (
                    <span key={m} style={{ textAlign: "right" }}>{b.byMode[m] ? rupees(b.byMode[m]) : "—"}</span>
                  ))}
                  <span style={{ textAlign: "right", fontWeight: 700 }}>{b.total ? rupees(b.total) : "—"}</span>
                </div>
              );
            })}
          </div>
          <div className="rp-cg num" style={{ fontSize: 14, fontWeight: 700, background: "var(--s2)", borderTop: "2px solid var(--bd)" }}>
            <span>Total</span>
            <span style={{ textAlign: "right" }}>{total.receipts}</span>
            {modes.map((m) => (
              <span key={m} style={{ textAlign: "right" }}>{rupees(total.byMode[m])}</span>
            ))}
            <span style={{ textAlign: "right" }}>{rupees(total.total)}</span>
          </div>
        </div>
        <div className="only-m card rp-ls" style={{ overflow: "hidden" }}>
          {rows.map((b) => {
            const note = !b.total && isSunday(b.key) ? "Sunday" : "";
            return (
              <div key={b.key} className="rp-c" style={{ gap: 6, padding: "12px 14px", opacity: note ? 0.55 : 1 }}>
                <div className="rp-f" style={{ justifyContent: "space-between" }}>
                  <span className="rp-c">
                    <span style={{ fontSize: 14, fontWeight: 600 }}>{label(b.key)}</span>
                    <span className="rp-m">{note || `${b.receipts} receipts`}</span>
                  </span>
                  <span className="num rp-tt">{b.total ? rupees(b.total) : "—"}</span>
                </div>
                <span style={{ display: "flex", height: 6, borderRadius: 3, overflow: "hidden", background: "var(--s3)" }}>
                  {modes.map((m) => (
                    <span key={m} style={{ width: `${b.total ? (b.byMode[m] / b.total) * 100 : 0}%`, background: MODE_COLOR[m] }} />
                  ))}
                </span>
              </div>
            );
          })}
          <div className="rp-f" style={{ justifyContent: "space-between", padding: "12px 14px", background: "var(--s2)" }}>
            <b>Total · {total.receipts} receipts</b>
            <span className="num rp-tt">{rupees(total.total)}</span>
          </div>
        </div>
        <span className="rp-m">Reversed receipts and discount close-outs are not collection. Late fee is collected inside the receipt and is reported on its own in the defaulter list.</span>
      </div>
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
      <MActs
        items={[
          { icon: "printer", label: tx(T.print), onClick: () => window.print() },
          { icon: "download", label: "PDF", onClick: () => setSheet("export") },
          { icon: "send", label: tx(T.send), onClick: () => setSheet("send"), pri: true },
        ]}
      />
      <Section>
        <Card className="rp-noprint rp-lh" style={{ display: "flex", flexDirection: "column", gap: 12, padding: "14px 16px" }}>
          <div className="rp-f" style={{ flexWrap: "wrap", gap: "10px 18px" }}>
            <Seg<Lang> options={[{ value: "hi", label: "हिंदी" }, { value: "en", label: "English" }, { value: "both", label: "दोनों · Both" }]} value={lang} onChange={setLang} label="Language of the list" />
            <button type="button" className="tap rp-rb" role="switch" aria-checked={includeLeft} onClick={() => setIncludeLeft(!includeLeft)} style={{ width: "auto", gap: 10 }}>
              <span className={`sw${includeLeft ? " on" : ""}`}>
                <span />
              </span>
              <span style={{ fontSize: 14, fontWeight: 600 }}>Include students who left</span>
            </button>
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
              <Crest size={44} radius={10} still />
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
                    <span>{say(lang, PAPER.klass)} {s.classLabel.replace(/^class\s+/i, "")}</span>
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
      <div className="rp-c rp-lh" style={{ gap: 14 }}>
        <div className="rp-f" style={{ padding: "12px 14px", borderRadius: 14, background: "var(--s2)", gap: 12 }}>
          <span className="rp-ib rp-t36" style={{ background: "var(--oks)", color: "var(--ok)" }}><Ic n="users" /></span>
          <span className="rp-c" style={{ flex: 1 }}>
            <span className="rp-tt num">{withTeacher.length} class teachers · {items.length} lists</span>
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
  // Each child is judged by their own due date, by the rule every money screen
  // uses (due before today = pending today), so an installment can have cells
  // on both sides when a few children's dates differ.
  const due = cw.dueNos;
  const notDue = cw.notDueNos;
  const order = new Map(data.classes.map((k, i) => [k.id, i]));
  const rows = [...cw.rows].sort((a, b) => (order.get(a.classId ?? "") ?? 999) - (order.get(b.classId ?? "") ?? 999));
  const teacher = (cid: string | null) => data.classes.find((k) => k.id === cid)?.teacher ?? null;
  const pendingToday = rows.reduce((s, r) => s + r.pendingToday, 0);
  const notDueYet = rows.reduce((s, r) => s + r.notDueYet, 0);
  const instTotal = (n: number, key: "due" | "notDue") => rows.reduce((s, r) => s + (r.cells[n]?.[key]?.amount ?? 0), 0);
  const max = Math.max(1, ...rows.flatMap((r) => due.map((n) => r.cells[n]?.due?.amount ?? 0)));
  const instName = (n: number) => (n === 99 ? "Last year" : `Inst ${n}`);
  const instLong = (n: number) => (n === 99 ? "Last year" : `Installment ${n}`);
  const dm = (iso: string | undefined) => (iso ? dayName(iso).split(" ").slice(1).join(" ") : "");
  // Each child once, however many installments they owe (was 929 for ~583 children).
  const pendingStudents = cw.studentsPendingToday;
  const varies = cw.installmentNos.some((n) => n !== 99 && cw.dueVaries[n]);
  const head = (n: number) => `${instName(n)}${cw.dueDates[n] && n !== 99 ? ` · ${dm(cw.dueDates[n])}${cw.dueVaries[n] ? "*" : ""}` : ""}`;
  const heat = (amount: number): CSSProperties => {
    const k = amount / max;
    return { background: `color-mix(in srgb, var(--acc) ${Math.round(12 + k * 60)}%, var(--card))`, color: k > 0.6 ? "var(--onsolid)" : "var(--fg)" };
  };

  const detail = cell ? (
    <div className="rp-c" style={{ gap: 12, padding: 18 }}>
      <div className="rp-f" style={{ alignItems: "flex-start" }}>
        <span className="rp-c" style={{ flex: 1 }}>
          <span className="serif" style={{ fontSize: 22, fontWeight: 600, lineHeight: 1.2 }}>{cell.classLabel} · {instLong(cell.installmentNo)}</span>
          <span style={{ fontSize: 13, color: "var(--mut)" }}>
            {cell.dueDate ? `Due ${dayName(cell.dueDate)} · ` : ""}
            {cell.students.length} students · {rupees(cell.students.reduce((s, x) => s + x.pending, 0))}
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
        actions={
          <>
            <BackBtn />
            <Btn icon="printer" onClick={() => window.print()}>{tx(T.print)}</Btn>
            <ExportBtn onClick={() => setSheet("export")} />
          </>
        }
      />
      <MActs
        items={[
          { icon: "printer", label: tx(T.print), onClick: () => window.print() },
          { icon: "download", label: tx(T.export), onClick: () => setSheet("export"), pri: true },
        ]}
      />
      <div style={{ display: "grid", gridTemplateColumns: detail ? "minmax(0,1fr) 400px" : "minmax(0,1fr)", alignItems: "start" }} className="stack">
        <Section>
          {detail ? <div className="only-m"><Card pad={false}>{detail}</Card></div> : null}
          <div className="g4" style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 12 }}>
            {[
              { label: tx(W.pendingTodayAsOf(dm(data.today))), v: rupeesShort(pendingToday), sub: due.length ? tx(W.pendingStudentsInst(pendingStudents, due.filter((n) => n !== 99).join("–") || "—")) : tx(W.nothingDue), fg: "var(--warnfg)" },
              ...due
                .filter((n) => n !== 99)
                .slice(-2)
                .map((n) => ({ label: `${instLong(n)} · ${dm(cw.dueDates[n])}`, v: rupeesShort(instTotal(n, "due")), sub: "still unpaid", fg: undefined as string | undefined })),
              { label: "Not due yet", v: rupeesShort(notDueYet), sub: `installments ${notDue.join("–") || "—"} · kept apart`, fg: undefined as string | undefined },
            ].map((k, i) => (
              <div key={k.label} className="card rise rp-c" style={{ padding: "14px 16px", gap: 2, animationDelay: `${i * 40}ms` }}>
                <span className="rp-m" style={{ fontWeight: 600 }}>{k.label}</span>
                <span className="num" style={{ fontSize: 21, fontWeight: 700, color: k.fg }}>{k.v}</span>
                <span className="rp-m">{k.sub}</span>
              </div>
            ))}
          </div>
          <div className="rp-f" style={{ justifyContent: "space-between" }}>
            <span className="rp-m">
              {tx(W.pendingRule)} Tap any cell to see those students. Darker = more pending.
              {varies ? ` ${tx(W.datesVary)}` : ""}
            </span>
            <span className="rp-f rp-m hide-m" style={{ gap: 4 }}>
              Less {[15, 30, 45, 60, 72].map((v) => <span key={v} style={{ width: 16, height: 10, borderRadius: 3, background: `color-mix(in srgb, var(--acc) ${v}%, var(--card))` }} />)} More
            </span>
          </div>
          <Card pad={false} style={{ overflow: "hidden" }}>
            <div className="rp-scroll" style={{ padding: 8 }}>
              <table className="rp-heat">
                <thead>
                  <tr>
                    <th style={{ textTransform: "uppercase" }}>Class</th>
                    <th colSpan={due.length + 1} style={{ textAlign: "right", color: "var(--warnfg)", textTransform: "uppercase", fontWeight: 700 }}>Pending today</th>
                    <th colSpan={notDue.length + 1} style={{ textAlign: "right", textTransform: "uppercase", fontWeight: 700 }}>Not due yet</th>
                  </tr>
                  <tr>
                    <th />
                    {due.map((n) => <th key={n}>{head(n)}</th>)}
                    <th>Total</th>
                    {notDue.map((n) => <th key={n}>{head(n)}</th>)}
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
                      <td className="rp-nd" style={{ color: "var(--warnfg)", fontWeight: 700 }}>{rupees(r.pendingToday)}</td>
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
                  <tr className="rp-ctot">
                    <td>All classes</td>
                    {due.map((n) => (
                      <td key={n} className="rp-nd" style={{ color: "var(--fg)" }}>{rupees(instTotal(n, "due"))}</td>
                    ))}
                    <td className="rp-nd" style={{ color: "var(--warnfg)" }}>{rupees(pendingToday)}</td>
                    {notDue.map((n) => (
                      <td key={n} className="rp-nd">{rupees(instTotal(n, "notDue"))}</td>
                    ))}
                    <td className="rp-nd">{rupees(notDueYet)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </Card>
          <span className="rp-m">Students who left are counted: they still owe. Late fee is never in these cells; it is on the defaulter list on its own line.</span>
        </Section>
        {detail ? <aside className="only-d unstick" style={{ position: "sticky", top: 64, height: "calc(100dvh - 64px)", overflowY: "auto", borderLeft: "1px solid var(--bd)", background: "var(--bg)" }}>{detail}</aside> : null}
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
          <Btn variant="ghost" href={`/receipts?date=${d.date}&view=close`} icon="arrowRight">Day close</Btn>
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
  const detailed = use(DetailedReports);
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
      sub="Pick a format and what to include"
      footer={
        <>
          <button type="button" className="tap btn sec" style={{ flex: 1, height: 48 }} onClick={onClose}>Cancel</button>
          {detailed ? (
            <a className="tap btn pri" style={{ flex: 1.6, height: 48 }} href={href} download onClick={onClose}><Ic n="download" size={18} />Export {label}</a>
          ) : (
            <span style={{ flex: 1.6, alignSelf: "center", fontSize: 13, color: "var(--mut)" }}>Exports are for the admin and the accountant.</span>
          )}
        </>
      }
    >
      <div className="rp-c" style={{ gap: 14 }}>
        <div className="rp-c" style={{ gap: 6 }}>
          <span style={{ fontSize: 12, fontWeight: 700, color: "var(--mut)" }}>Format</span>
          <div role="radiogroup" aria-label="Format" style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 8 }}>
            {(
              [
                ["xlsx", "Excel", ".xlsx · for sums", "table", "var(--oks)", "var(--ok)"],
                ["pdf", "PDF", "Ready to print", "fileText", "var(--bads)", "var(--bad)"],
                ["csv", "CSV", "For other software", "list", "var(--s3)", "var(--mut)"],
              ] as const
            ).map(([k, label, sub, icon, bg, fg]) => {
              const on = format === k;
              return (
                <button key={k} type="button" className="tap" role="radio" aria-checked={on} onClick={() => setFormat(k)} style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 6, padding: 12, borderRadius: 14, border: on ? "2px solid var(--acc)" : "1px solid var(--bd)", background: on ? "var(--accs)" : "var(--card)", color: "var(--fg)", textAlign: "left", lineHeight: "normal" }}>
                  <span className="rp-f" style={{ width: "100%", justifyContent: "space-between" }}>
                    <span className="rp-ib" style={{ width: 32, height: 32, borderRadius: 11, background: bg, color: fg }}><Ic n={icon} /></span>
                    <span className="rp-ib" style={{ width: 18, height: 18, borderRadius: 9, border: `2px solid ${on ? "var(--acc)" : "var(--bds)"}` }}>
                      <span className="rp-dt" style={{ width: 8, height: 8, background: "var(--acc)", transform: `scale(${on ? 1 : 0})`, transition: "transform .25s var(--spring)" }} />
                    </span>
                  </span>
                  <span style={{ fontSize: 14, fontWeight: 700 }}>{label}</span>
                  <span style={{ fontSize: 11, color: "var(--mut)" }}>{sub}</span>
                </button>
              );
            })}
          </div>
        </div>
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

