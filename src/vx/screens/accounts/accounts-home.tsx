"use client";

import "./accounts.css";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState, useSyncExternalStore, useTransition, type CSSProperties } from "react";

import { addToQueueAction, searchFamiliesAction, updateQueueAction } from "@/app/(app)/accounts/actions";
import { remindAdminAction } from "@/app/(app)/accounts/books/actions";
import { logoutAction } from "@/app/login/actions";
import type { AccountsHomeData, FamilyHit } from "@/modules/finance-controls/vx/types";
import { roleLabel, type StaffRole } from "@/platform/auth/permissions";
import { withDeskChequeDetails } from "@/modules/finance-controls/vx/domain/cheque-receipt";
import { initials, rupees } from "@/vx/format";
import { useVx } from "@/vx/i18n";
import { Ic, type IconName } from "@/vx/icons";
import { p } from "@/vx/text";
import { HelpButton, Sheet, useToast } from "@/vx/ui/overlays";
import { Section, TopBar, VxPage } from "@/vx/ui/page";
import { Btn, Card, EmptyState, Pill } from "@/vx/ui/primitives";

import { LangToggle } from "./lang-toggle";
import { day, firstName, minutesSince, time12, timeLeft, whenOn } from "./when";

type View = "home" | "menu" | "evening";

const TONES: [string, string][] = [
  ["var(--accs)", "var(--accfg)"],
  ["var(--infos)", "var(--info)"],
  ["var(--oks)", "var(--ok)"],
  ["var(--warns)", "var(--warnfg)"],
  ["var(--s3)", "var(--fg)"],
];
const MODE_LABEL: Record<string, string> = { upi: "UPI", cash: "Cash", cheque: "Cheque", bank_transfer: "Bank" };
const MODE_COLOR: Record<string, string> = { upi: "var(--c1)", cash: "var(--c2)", cheque: "var(--c3)", bank_transfer: "var(--c4)" };
/** The counter closes at 5:30 pm (the design's "Close by 5:30 pm"). */
const CLOSE_MINUTE = 17 * 60 + 30;
/** "1 receipt", "4 receipts" — the Today card said "1 receipts" (accountant UI). */
const receiptsN = (n: number) => p(`${n} ${n === 1 ? "receipt" : "receipts"}`, `${n} ${n === 1 ? "रसीद" : "रसीदें"}`);

/** The path length the design's `xDraw` animation draws from. */
const len = (n: number) => ({ "--len": n }) as CSSProperties;
const bt = (i: number) => (i ? "1px solid var(--bd)" : "0");
const delay = (i: number) => `${Math.min(i, 12) * 40}ms`;
const weekday = (date: string) => new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", weekday: "long" }).format(new Date(`${date}T12:00:00+05:30`));

type HelpStep = { icon: IconName; title: string; body: string };

function useBagChecklist(day: string) {
  // The evening checklist is a note to self ("it is in the bag"), kept on this
  // device for the day. Where the cheque really is gets recorded when the
  // deposit slip is written in Books.
  const key = `vx:acc-bag:${day}`;
  const read = () => {
    try {
      return window.localStorage.getItem(key) ?? "";
    } catch {
      return "";
    }
  };
  const raw = useSyncExternalStore(
    (cb) => {
      window.addEventListener("storage", cb);
      window.addEventListener("vx-bag", cb);
      return () => {
        window.removeEventListener("storage", cb);
        window.removeEventListener("vx-bag", cb);
      };
    },
    read,
    () => "",
  );
  const set = new Set(raw ? raw.split(",") : []);
  const toggle = (id: string) => {
    const next = new Set(set);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    try {
      window.localStorage.setItem(key, [...next].join(","));
    } catch {
      /* private window: the tick simply does not stick */
    }
    window.dispatchEvent(new Event("vx-bag"));
  };
  return { has: (id: string) => set.has(id), toggle, count: set.size };
}

export function AccountsHome({
  data,
  view,
  staffName,
  canCollect,
  canAccounts = false,
  canManage,
  readOnly,
  greet,
  roleName,
}: {
  greet: string;
  data: AccountsHomeData;
  view: View;
  staffName: string;
  canCollect: boolean;
  /** Back office (`fees:accounts`): pausing reminders. A fee collector counts but does not pause (D-261). */
  canAccounts?: boolean;
  canManage: boolean;
  readOnly: boolean;
  /** The signed-in account's role, so the office is not called "Fee collector" (verification N1). */
  roleName?: StaffRole;
}) {
  const { tx } = useVx();
  const roleWord = (role: StaffRole | undefined, accounts: boolean) => tx(role ? roleLabel(role) : accounts ? roleLabel("accountant") : roleLabel("fee_collector"));
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const first = firstName(staffName);
  const today = day(data.today);
  const closed = data.closure?.status === "closed";
  const canAct = canCollect && !readOnly;

  const run = (fn: () => Promise<{ ok: boolean; message: string }>, undo?: () => Promise<unknown>) =>
    startTransition(async () => {
      const r = await fn();
      toast.show({ text: r.message, tone: r.ok ? "ok" : "bad", undo: r.ok && undo ? async () => { await undo(); router.refresh(); } : undefined });
      if (r.ok) router.refresh();
    });

  const help: HelpStep[] = [
    { icon: "search", title: tx(p("Find the family", "परिवार खोजें")), body: "Type a name, SR no. or the last 3 digits of the phone in the big search box." },
    { icon: "rupee", title: tx(p("Collect", "फीस जमा करें")), body: "Pending today is already worked out. Pick how they pay — the receipt is made at the Payment Desk." },
    ...(canAccounts
      ? [{ icon: "lock" as IconName, title: tx(p("Close the day by 5:30 pm", "शाम 5:30 तक दिन बंद करें")), body: "Count the cash, match UPI, put the cheques in the bag, then close the day in Receipts." }]
      : []),
  ];
  const helpTitle = view === "evening" ? "Closing the day" : "How the counter works";
  // A fee collector takes money at the counter; closing the day, the books and
  // pausing reminders are the accountant's (D-261), so the page says which.
  const role = roleWord(roleName, canAccounts);
  const hello = greet === "Good morning" ? "सुप्रभात" : greet === "Good evening" ? "शुभ संध्या" : "नमस्ते";

  const top =
    view === "menu"
      ? { crumb: `${role} · everything in one place`, title: tx(p("Menu", "मेन्यू")), mTitle: tx(p("Menu", "मेन्यू")), mSub: `${staffName} · ${role}` }
      : view === "evening"
        ? {
            crumb: `${role} · ${today}${data.closure?.closedAt ? ` · ${time12(data.closure.closedAt)}` : ""}`,
            title: tx(p(`Good evening, ${first}`, `शुभ संध्या, ${first} जी`)),
            mTitle: closed ? tx(p("Evening · day closed", "शाम · दिन बंद")) : tx(p("Evening · not closed yet", "शाम · दिन बंद नहीं हुआ")),
            mSub: closed ? `${today}${data.closure?.closedAt ? ` · closed at ${time12(data.closure.closedAt)}` : " · day closed"}` : `${today} · not closed yet`,
          }
        : {
            crumb: `${role} · ${today} · ${closed ? "day closed" : "counter open"}`,
            title: tx(p(`${greet}, ${first}`, `${hello}, ${first} जी`)),
            mTitle: tx(p(`${greet}, ${first}`, `${hello}, ${first} जी`)),
            mSub: `${today} · ${data.queue.length} at the counter`,
          };

  return (
    <VxPage className="ac-page ac-home">
      <TopBar
        crumb={top.crumb}
        title={top.title}
        mTitle={top.mTitle}
        mSub={top.mSub}
        mBack={view === "evening" ? "/accounts?view=home" : undefined}
        actions={
          <>
            {view === "home" ? (
              <Btn variant="ghost" icon="grid" href="/accounts?view=menu">{tx(p("All places", "सभी जगहें"))}</Btn>
            ) : (
              <Btn variant="ghost" icon="chevLeft" href="/accounts?view=home">{tx(p("Back to today", "आज पर वापस"))}</Btn>
            )}
            <LangToggle />
            <HelpButton title={helpTitle} steps={help} style={{ width: 40, height: 40, background: "var(--card)", border: "1px solid var(--bds)" }} />
            {canCollect ? (
              <Link href="/payments" className="tap btn pri" accessKey="c">
                <Ic n="rupee" />
                {tx(p("Collect fee", "फीस जमा करें"))}
                <span className="k" style={{ background: "rgba(255,255,255,.16)", color: "inherit", borderColor: "rgba(255,255,255,.3)" }}>Alt C</span>
              </Link>
            ) : null}
          </>
        }
        mAction={
          <span className="ac-f" style={{ gap: 0 }}>
            <LangToggle phone />
            <HelpButton title={helpTitle} steps={help} style={{ width: 44, height: 44, borderRadius: 22 }} />
          </span>
        }
      />
      {view === "home" ? <HomeView data={data} canAct={canAct} canPause={canAccounts && !readOnly} canClose={canAccounts} canCollect={canCollect} canManage={canManage} run={run} busy={pending} /> : null}
      {view === "menu" ? <MenuView data={data} staffName={staffName} roleText={role} canCollect={canCollect} canAccounts={canAccounts} help={help} helpTitle={helpTitle} /> : null}
      {view === "evening" ? <EveningView data={data} /> : null}
    </VxPage>
  );
}

type Run = (fn: () => Promise<{ ok: boolean; message: string }>, undo?: () => Promise<unknown>) => void;

function HomeView({ data, canAct, canClose, canCollect, canManage, run, busy }: { data: AccountsHomeData; canAct: boolean; canPause: boolean; canClose: boolean; canCollect: boolean; canManage: boolean; run: Run; busy: boolean }) {
  const { tx } = useVx();
  const router = useRouter();
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<FamilyHit[] | null>(null);
  const [searching, startSearch] = useTransition();
  const timer = useRef<number | null>(null);
  const seq = useRef(0);

  const onQ = (value: string) => {
    setQ(value);
    if (timer.current) window.clearTimeout(timer.current);
    if (value.trim().length < 2) {
      setHits(null);
      return;
    }
    timer.current = window.setTimeout(() => {
      seq.current += 1;
      const mine = seq.current;
      startSearch(async () => {
        const r = await searchFamiliesAction(value);
        if (mine === seq.current) setHits(r);
      });
    }, 250);
  };

  const c = data.collected;
  const modes = ["upi", "cash", "cheque", "bank_transfer"].map((m) => data.collected.modes.find((x) => x.mode === m) ?? { mode: m, total: 0, count: 0 });
  // The line runs from 8:00 am to now: carry the last total flat to the right edge.
  const line = `${c.spark.line} 200,${c.spark.endY}`;
  const left = timeLeft(CLOSE_MINUTE);
  const beforeNoon = timeLeft(12 * 60) !== null;
  const steps = [
    { label: tx(p("Count the cash", "नकद गिनें")), sub: tx(p(`expected ${rupees(data.cashExpected.total)} · ${receiptsN(data.cashExpected.count).en}`, `अपेक्षित ${rupees(data.cashExpected.total)} · ${receiptsN(data.cashExpected.count).hi}`)), done: data.cashExpected.count === 0 || data.closure?.status === "closed" },
    { label: tx(p("Match UPI with the bank app", "UPI बैंक ऐप से मिलाएँ")), sub: data.upiOpen.count ? tx(p(`${data.upiOpen.count} left · ${rupees(data.upiOpen.total)}`, `${data.upiOpen.count} बाकी · ${rupees(data.upiOpen.total)}`)) : tx(p("all matched", "सब मिल गए")), done: data.upiOpen.count === 0 },
    { label: tx(p("Cheques to the bank", "चेक बैंक में")), sub: data.chequesToDeposit.count ? `${data.chequesToDeposit.count} · ${rupees(data.chequesToDeposit.total)}` : tx(p("none waiting", "कोई बाकी नहीं")), done: data.chequesToDeposit.count === 0 },
  ];
  const doneN = steps.filter((s) => s.done).length;
  const openRequests = data.requests.filter((r) => r.status === "waiting").length;
  const approvedToday = data.requests.filter((r) => r.status === "approved" && r.decidedAt?.slice(0, 10) === data.today).length;
  // "Try" chips: the families already at the counter, the first name a person would type.
  const tries = [...new Set(data.queue.map((r) => r.familyLabel.split(" · ")[0]?.split(" ")[0]).filter((w): w is string => Boolean(w)))].slice(0, 4);

  const f = data.followUpsToday;
  const jobs = [
    {
      icon: "calCheck" as IconName,
      label: tx(p("Follow-ups due today", "आज के वादे")),
      sub: f.count ? [f.kept ? `${f.kept} paid so far` : null, f.pending ? `${rupees(f.pending)} pending` : null, f.next ? `next: ${f.next}` : null].filter(Boolean).join(" · ") || "Call-backs set for today" : "No call-backs set for today",
      n: f.count,
      tone: "info",
      href: "/dues",
      bar: f.count ? `${Math.round((f.kept / f.count) * 100)}%` : null,
    },
    { icon: "file" as IconName, label: tx(p("Cheques to deposit", "जमा करने के चेक")), sub: data.chequesToDeposit.count ? `${data.chequesToDeposit.count} cheques · ${rupees(data.chequesToDeposit.total)}` : "Nothing waiting for the bank", n: data.chequesToDeposit.count, tone: "warn", href: "/accounts/books", bar: null },
    { icon: "zap" as IconName, label: tx(p("UPI to match", "UPI मिलान")), sub: data.upiOpen.count ? `${data.upiOpen.count} payments · ${rupees(data.upiOpen.total)} not matched to a receipt yet` : "Every bank line is matched", n: data.upiOpen.count, tone: "acc", href: "/accounts/books?view=upi", bar: null },
  ];

  return (
    <Section>
      <div className="ac-lay stack">
        <div className="ac-c" style={{ gap: 16 }}>
          <Card className="ac-c ac-cd" style={{ padding: 18 }}>
            <span className="ac-f ac-j">
              <span className="ac-v">{tx(p("Find a student or family", "छात्र या परिवार खोजें"))}</span>
              <span className="ac-m hide-m">{tx(p("Opens the Payment Desk", "फीस जमा खुलेगा"))}</span>
            </span>
            <label className="ac-q ac-f">
              <Ic n="search" size={22} />
              <span className="sr">Find a student or family</span>
              {/* The counter's first job is finding a family, so the box takes the cursor (Alt F brings it back). */}
              <input type="search" autoFocus accessKey="f" value={q} onChange={(e) => onQ(e.target.value)} placeholder={tx(p("Name, SR no., father, phone", "नाम, SR नं., पिता, फ़ोन"))} autoComplete="off" />
              {searching ? <Ic n="refresh" size={16} className="spin" /> : <span className="k only-d">Alt F</span>}
            </label>
            {hits === null ? (
              tries.length ? (
                <div className="ac-f hs" style={{ gap: 6 }}>
                  <span className="ac-m" style={{ flex: "none" }}>Try</span>
                  {tries.map((t) => (
                    <button key={t} type="button" className="tap chip" onClick={() => onQ(t)}>{t}</button>
                  ))}
                </div>
              ) : (
                <span className="ac-m">Type at least 2 letters, or the last 3 digits of the phone.</span>
              )
            ) : null}
            {hits && hits.length > 0 ? (
              <div className="ac-c fadein">
                {hits.map((h, i) => (
                  <div key={h.studentId} className="row ac-rw ac-an" style={{ borderTop: bt(i), animationDelay: delay(i) }}>
                    <span className="ac-av" style={{ background: TONES[i % 5][0], color: TONES[i % 5][1] }}>{initials(h.studentName)}</span>
                    <span className="ac-c ac-1">
                      <span className="ac-b ac-e">{h.studentName}{h.left ? <Pill tone="bad" style={{ marginLeft: 6 }}>Left</Pill> : null}</span>
                      <span className="ac-m ac-e">{[h.classLabel, h.admissionNo ? `SR ${h.admissionNo}` : null, h.fatherName, h.phoneMasked].filter(Boolean).join(" · ")}</span>
                    </span>
                    <span className="ac-c" style={{ alignItems: "flex-end" }}>
                      <span className="num ac-v" style={{ color: h.pendingToday ? "var(--warnfg)" : "var(--ok)" }}>{h.pendingToday ? rupees(h.pendingToday) : "All paid"}</span>
                      <span className="ac-m">{h.pendingToday ? "pending today" : "up to today"}{h.lateFee ? ` · late fee ${rupees(h.lateFee)} separate` : ""}</span>
                    </span>
                    {canAct ? (
                      <button type="button" className="tap btn ghost hide-m" style={{ position: "relative", zIndex: 2, height: 36, padding: "0 10px" }} disabled={busy} onClick={() => run(() => addToQueueAction(h.studentId))} aria-label={`Add ${h.studentName} to the counter queue`}>
                        <Ic n="userPlus" size={16} /> Queue
                      </button>
                    ) : null}
                    <Ic n="chevRight" style={{ color: "var(--sub)" }} />
                    {canCollect ? <Link className="ac-o" href={`/payments?student=${h.studentId}`} aria-label={`Collect from ${h.studentName}`} /> : null}
                  </div>
                ))}
              </div>
            ) : null}
            {hits && hits.length === 0 && !searching ? (
              <div className="ac-f fadein ac-m" style={{ padding: "6px 4px", fontSize: 13 }}>
                <Ic n="info" size={16} />
                <span className="ac-1">No family found. Try the father’s name or the last 3 digits of the phone.</span>
                <button type="button" className="tap btn ghost" style={{ height: 34 }} onClick={() => onQ("")}>Clear</button>
              </div>
            ) : null}
          </Card>

          <Card className="ac-c ac-cd" style={{ padding: "18px 20px" }}>
            <div className="ac-f ac-j">
              <span className="ac-f">
                <span style={{ width: 10, height: 10, borderRadius: 5, background: "var(--ok)", animation: "xPulse 1.8s ease infinite" }} />
                <span className="ac-v">{tx(p("Collected today", "आज जमा"))}</span>
                <span className="ac-m">· live</span>
              </span>
              <Link href="/receipts" className="tap btn ghost only-d" style={{ height: 34, padding: "0 10px" }}>{tx(p("See receipts", "रसीदें देखें"))}<Ic n="chevRight" size={16} /></Link>
              <Link href="/receipts" className="tap btn ghost only-m" style={{ height: 36, padding: "0 10px" }}>{tx(p("Receipts", "रसीदें"))}<Ic n="chevRight" size={16} /></Link>
            </div>
            <div className="ac-f ac-j ac-w" style={{ alignItems: "flex-end", gap: 12 }}>
              <span className="ac-c">
                <span className="num rise" style={{ fontSize: 38, fontWeight: 700, letterSpacing: "-0.02em", lineHeight: 1.1 }}>{rupees(c.total)}</span>
                <span className="ac-m">{tx(receiptsN(c.count))}{c.lastAt ? tx(p(` · last one at ${time12(c.lastAt)}`, ` · आख़िरी ${time12(c.lastAt)}`)) : tx(p(" · none yet today", " · आज अभी कोई नहीं"))}{c.reversedCount ? tx(p(` · ${c.reversedCount} reversed, not counted`, ` · ${c.reversedCount} वापस, गिनती में नहीं`)) : ""}</span>
                {/* A part-day against a whole usual day read as an alarm every
                    morning ("100% vs usual day" at 8:30 with ₹0): shown from noon (accountant B16). */}
                {c.vsUsual !== null && !beforeNoon ? (
                  <span className="ac-f ac-w" style={{ marginTop: 6 }}>
                    <span className="pill num" style={{ height: 24, background: c.vsUsual >= 0 ? "var(--oks)" : "var(--warns)", color: c.vsUsual >= 0 ? "var(--ok)" : "var(--warnfg)", animation: "xPopIn .45s .4s var(--spring) both" }}>
                      <Ic n={c.vsUsual >= 0 ? "arrowUp" : "arrowDown"} size={12} stroke={3} />
                      {tx(p(`${Math.abs(c.vsUsual)}% vs usual day`, `सामान्य दिन से ${Math.abs(c.vsUsual)}%`))}
                    </span>
                    <span className="ac-m">{tx(p(`Usual ${weekday(data.today)} ${rupees(c.usual)}`, `सामान्य दिन ${rupees(c.usual)}`))}</span>
                  </span>
                ) : null}
              </span>
              <svg viewBox="0 0 200 60" width="210" height="64" aria-hidden="true" style={{ flex: "none", overflow: "visible" }}>
                <polygon points={`0,58 ${line} 200,58`} style={{ fill: "var(--accs)", opacity: 0.8, animation: "xFade .8s .3s ease both" }} />
                <polyline points={line} style={{ fill: "none", stroke: "var(--acc)", strokeWidth: 2.5, strokeLinejoin: "round", strokeLinecap: "round", ...len(320), strokeDasharray: 320, animation: "xDraw 1.1s var(--ease) both" }} />
                {c.count ? <circle cx="200" cy={c.spark.endY} r="4" style={{ fill: "var(--acc)", animation: "xPopIn .4s 1s var(--spring) both" }} /> : null}
              </svg>
            </div>
            <div className="ac-c" style={{ gap: 9, paddingTop: 12, borderTop: "1px solid var(--bd)" }}>
              {modes.map((m, i) => (
                <div key={m.mode} style={{ display: "grid", gridTemplateColumns: "62px minmax(0,1fr) 128px", gap: 10, alignItems: "center" }}>
                  <span className="ac-b" style={{ fontSize: 13 }}>{MODE_LABEL[m.mode]}</span>
                  <span className="ac-bar"><span style={{ width: c.total ? `${((m.total / c.total) * 100).toFixed(1)}%` : "0%", background: MODE_COLOR[m.mode], animationDelay: `${i * 90 + 200}ms` }} /></span>
                  <span className="num" style={{ fontSize: 13, textAlign: "right" }}><b>{rupees(m.total)}</b> <span className="ac-m">· {m.count ? tx(receiptsN(m.count)) : tx(p("none yet", "अभी नहीं"))}</span></span>
                </div>
              ))}
            </div>
          </Card>

          <Card className="ac-c ac-cd">
            <div className="ac-f ac-j">
              <span className="ac-f"><span className="ac-v">{tx(p("At the counter now", "काउंटर पर अभी"))}</span><Pill tone="acc">{data.queue.length} waiting</Pill></span>
              <span className="ac-m hide-m">Oldest first</span>
            </div>
            {data.queue.map((r, i) => {
              const [family, child] = r.familyLabel.split(" · ");
              const mins = minutesSince(r.arrivedAt);
              const since = time12(r.arrivedAt).replace(/ (am|pm)$/, "");
              const wait = r.note ? `${r.note} · ${mins < 1 ? "just came" : `since ${since}`}` : mins < 1 ? "Just came" : `Waiting since ${since} · ${mins} min`;
              return (
                <div key={r.id} className="ac-f ac-an" style={{ gap: 12, paddingTop: 10, borderTop: bt(i), animationDelay: delay(i) }}>
                  <span className="ac-av" style={{ background: TONES[i % 5][0], color: TONES[i % 5][1] }}>{initials(family)}</span>
                  <span className="ac-c ac-1">
                    <span className="ac-b ac-e">{family}</span>
                    <span className="ac-m">{[child?.split(" ")[0], r.classLabel].filter(Boolean).join(" · ")} · <b className="num" style={{ color: "var(--warnfg)" }}>{rupees(r.pendingToday)}</b> pending</span>
                    <span className="ac-m" style={{ color: r.note ? "var(--info)" : "var(--mut)" }}>{wait}</span>
                  </span>
                  {canAct ? (
                    <>
                      <button type="button" className="tap btn ghost hide-m" style={{ height: 40, padding: "0 10px", color: "var(--mut)" }} disabled={busy} onClick={() => run(() => updateQueueAction(r.id, "left"), () => updateQueueAction(r.id, "back"))}>Left</button>
                      <button
                        type="button"
                        className="tap btn pri ac-take"
                        style={{ padding: "0 16px" }}
                        disabled={busy}
                        onClick={() => {
                          void updateQueueAction(r.id, "served");
                          router.push(`/payments?student=${r.studentId}`);
                        }}
                      >
                        {tx(p("Collect", "जमा करें"))}
                      </button>
                    </>
                  ) : null}
                </div>
              );
            })}
            {data.queue.length === 0 ? (
              <div className="ac-c fadein" style={{ alignItems: "center", gap: 6, padding: "12px 0", textAlign: "center" }}>
                <Ic n="checkCircle" size={28} style={{ color: "var(--ok)" }} />
                <span className="ac-b">{tx(p("No one waiting at the counter", "काउंटर पर कोई इंतज़ार में नहीं"))}</span>
                {canCollect ? <Btn href="/payments">{tx(p("Open the Payment Desk", "फीस जमा खोलें"))}</Btn> : null}
              </div>
            ) : null}
          </Card>
        </div>

        <div className="ac-c" style={{ gap: 16 }}>
          <Card className="ac-c ac-cd" style={{ gap: 4 }}>
            <span className="sech" style={{ marginBottom: 4 }}>{tx(p("Today’s jobs", "आज के काम"))}</span>
            {jobs.map((j, i) => {
              const bg = `var(--${j.tone}s)`;
              const fg = j.tone === "warn" ? "var(--warnfg)" : `var(--${j.tone})`;
              return (
                <div key={j.label} className="row ac-rw ac-an" style={{ borderTop: bt(i), borderRadius: 0, animationDelay: delay(i) }}>
                  <span className="ac-av" style={{ background: bg, color: fg }}><Ic n={j.icon} /></span>
                  <span className="ac-c ac-1" style={{ gap: 3 }}>
                    <span className="ac-b">{j.label}</span>
                    <span className="ac-m">{j.sub}</span>
                    {j.bar ? <span className="ac-bar" style={{ height: 6, maxWidth: 220 }}><span style={{ height: 6, width: j.bar, background: "var(--ok)" }} /></span> : null}
                  </span>
                  <span className="pill num" style={{ minWidth: 26, height: 26, justifyContent: "center", fontSize: 13, background: bg, color: fg }}>{j.n}</span>
                  <Ic n="chevRight" style={{ color: "var(--sub)" }} />
                  <Link className="ac-o" href={j.href} aria-label={j.label} />
                </div>
              );
            })}
          </Card>

          <Card className="ac-c ac-cd" style={{ gap: 10 }}>
            <div className="ac-f ac-j">
              <span className="ac-v">{tx(p("Waiting for admin", "एडमिन के पास"))}</span>
              <Link href="/accounts/books?view=requests" className="ac-m" aria-label={canManage ? "All requests" : "My requests"}>{openRequests} waiting{approvedToday ? ` · ${approvedToday} approved` : ""}</Link>
            </div>
            {data.requests.slice(0, 4).map((a, i) => {
              const tone = a.status === "approved" ? ["var(--oks)", "var(--ok)"] : a.status === "declined" ? ["var(--bads)", "var(--bad)"] : a.status === "withdrawn" ? ["var(--s3)", "var(--mut)"] : ["var(--warns)", "var(--warnfg)"];
              const st =
                a.status === "approved"
                  ? `Approved${a.decidedByName ? ` by ${a.decidedByName}` : ""}${a.decidedAt ? ` · ${whenOn(a.decidedAt, data.today)}` : ""}`
                  : a.status === "declined"
                    ? `Declined${a.decidedByName ? ` by ${a.decidedByName}` : ""}`
                    : a.status === "withdrawn"
                      ? "Withdrawn"
                      : a.remindedAt
                        ? `Waiting · reminded ${whenOn(a.remindedAt, data.today)}`
                        : "Waiting for the admin";
              return (
                <div key={a.id} className="ac-f ac-an" style={{ gap: 12, paddingTop: 10, borderTop: bt(i), alignItems: "flex-start", animationDelay: delay(i) }}>
                  <span className="ac-av" style={{ width: 36, height: 36, borderRadius: 11, background: "var(--s2)", color: "var(--mut)" }}><Ic n={a.kind === "late_fee_waiver" ? "percent" : a.kind === "reversal" ? "undo" : a.kind === "refund" ? "swap" : "sliders"} /></span>
                  <span className="ac-c ac-1" style={{ gap: 2 }}>
                    <span className="ac-b">{a.title}{a.studentName ? ` · ${a.studentName}` : ""}</span>
                    <span className="ac-m">Asked {whenOn(a.requestedAt, data.today)}{a.mine ? "" : ` by ${a.requestedByName}`} · {a.reason}</span>
                    <span className="ac-f ac-w" style={{ gap: 6, marginTop: 4 }}>
                      <span className="pill" style={{ height: 24, background: tone[0], color: tone[1], animation: "xPopIn .4s var(--spring) both" }}>{st}</span>
                      {a.mine && a.canRemind && canAct ? (
                        <button type="button" className="tap btn ghost" style={{ height: 30, padding: "0 8px", fontSize: 12, color: "var(--info)" }} disabled={busy} onClick={() => run(() => remindAdminAction(a.id))}>Remind admin</button>
                      ) : null}
                    </span>
                  </span>
                </div>
              );
            })}
            {data.requests.length === 0 ? <span className="ac-m">Nothing waiting. Late-fee waivers, reversals and refunds you ask for show here.</span> : null}
          </Card>

          <Card className="ac-c ac-cd">
            <div className="ac-f" style={{ gap: 12, alignItems: "flex-start" }}>
              <span className="ac-av" style={{ background: "var(--infos)", color: "var(--info)" }}><Ic n="bell" /></span>
              <span className="ac-c ac-1">
                {/* No job sends reminders by itself (vercel.json has none), so the
                    card no longer promises "at 4:00 pm" or offers a pause that
                    nothing reads (accountant B8). They go from Fee reminders. */}
                <span className="ac-v">{tx(p("Fee reminders", "फीस रिमाइंडर"))}</span>
                <span className="ac-m">{tx(p(`${data.reminders.familiesPendingToday} students with fees pending today · sent from Fee reminders`, `आज ${data.reminders.familiesPendingToday} विद्यार्थियों की फीस बाकी · फीस रिमाइंडर से भेजें`))}</span>
              </span>
            </div>
            <div className="ac-f ac-j ac-w" style={{ gap: 8 }}>
              <span className="pill" style={{ height: 26, padding: "0 10px", background: "var(--s2)", color: "var(--mut)" }}>{tx(p("Not sent automatically", "अपने-आप नहीं जाते"))}</span>
              <Link href="/reminders" className="tap btn ghost only-d" style={{ height: 34, padding: "0 10px" }}>See the message<Ic n="chevRight" size={16} /></Link>
              <Link href="/reminders" className="tap btn ghost only-m" style={{ height: 40, padding: "0 10px" }}>See the message<Ic n="chevRight" size={16} /></Link>
            </div>
          </Card>

          {canClose ? (
            <Card className="ac-c ac-cd" style={{ borderColor: "var(--bds)" }}>
              <div className="ac-f" style={{ gap: 12 }}>
                <svg width="52" height="52" viewBox="0 0 52 52" aria-hidden="true" style={{ flex: "none" }}>
                  <circle cx="26" cy="26" r="21" style={{ fill: "none", stroke: "var(--s3)", strokeWidth: 6 }} />
                  <circle cx="26" cy="26" r="21" transform="rotate(-90 26 26)" style={{ fill: "none", stroke: "var(--acc)", strokeWidth: 6, strokeLinecap: "round", strokeDasharray: `${((132 * doneN) / 3).toFixed(1)} 132`, ...len(132), animation: "xDraw .9s .2s var(--ease) both" }} />
                  <text x="26" y="30" textAnchor="middle" style={{ fill: "var(--fg)", fontSize: 12, fontWeight: 700 }}>{doneN}/3</text>
                </svg>
                <span className="ac-c ac-1">
                  <span className="ac-v">{tx(p("Close the day", "दिन बंद करें"))}</span>
                  <span className="ac-m">{data.closure?.status === "closed" ? tx(p("Closed · day summary saved", "बंद · दिन का सारांश सुरक्षित है")) : left ? tx(p(`${left} left · close it in Receipts`, `${left} बाकी · रसीदों में बंद करें`)) : tx(p("Past 5:30 pm · close it in Receipts", "शाम 5:30 बज चुके · रसीदों में बंद करें"))}</span>
                </span>
                <span className="pill" style={{ height: 26, padding: "0 10px", background: "var(--warns)", color: "var(--warnfg)" }}><Ic n="clock" size={16} />{tx(p("Close by 5:30 pm", "शाम 5:30 तक बंद करें"))}</span>
              </div>
              <div className="ac-c" style={{ gap: 2 }}>
                {steps.map((s, i) => (
                  <div key={s.label} className="ac-f" style={{ gap: 10, padding: "7px 0", borderTop: bt(i) }}>
                    <span style={{ flex: "none", width: 22, height: 22, borderRadius: 11, display: "flex", alignItems: "center", justifyContent: "center", background: s.done ? "var(--oks)" : "var(--s2)", color: s.done ? "var(--ok)" : "var(--mut)" }}><Ic n={s.done ? "check" : "clock"} size={13} stroke={3} /></span>
                    <span className="ac-1" style={{ fontSize: 13, fontWeight: 600 }}>{s.label}</span>
                    <span className="ac-m num">{s.sub}</span>
                  </div>
                ))}
              </div>
              <Link href="/receipts" className="tap btn pri ac-close"><Ic n="lock" />{tx(p("Count cash and close the day", "नकद गिनें और दिन बंद करें"))}</Link>
              <Link href="/accounts?view=evening" className="tap btn ghost" style={{ height: 36, fontSize: 13, color: "var(--mut)" }}>{tx(p("After closing: see tonight’s summary", "बंद करने के बाद: आज का सारांश देखें"))}<Ic n="chevRight" size={16} /></Link>
            </Card>
          ) : null}
        </div>
      </div>
    </Section>
  );
}

function MenuView({ data, staffName, roleText, canCollect, canAccounts, help, helpTitle }: { data: AccountsHomeData; staffName: string; roleText: string; canCollect: boolean; canAccounts: boolean; help: HelpStep[]; helpTitle: string }) {
  const { tx } = useVx();
  const [helpOpen, setHelpOpen] = useState(false);
  const closed = data.closure?.status === "closed";
  const tiles: { icon: IconName; en: string; hi: string; sub: string; href: string; badge?: number; big?: boolean }[] = [
    ...(canCollect ? [{ icon: "rupee" as IconName, en: "Collect fee", hi: "फीस जमा करें", sub: "Find a family, tick what they pay, take the money · Alt C", href: "/payments", big: true }] : []),
    canAccounts
      ? { icon: "receipt", en: "Receipts & day close", hi: "रसीदें व दिन बंद", sub: `${data.collected.count} today · close by 5:30 pm`, href: "/receipts" }
      : { icon: "receipt", en: "Receipts", hi: "रसीदें", sub: `${data.collected.count} today`, href: "/receipts" },
    { icon: "phone", en: "Dues & calls", hi: "बकाया व कॉल", sub: `${data.followUpsToday.count} follow-ups due today`, href: "/dues", badge: data.followUpsToday.count },
    { icon: "bell", en: "Fee reminders", hi: "फीस रिमाइंडर", sub: "Send from here", href: "/reminders" },
    { icon: "swap", en: "Cheques, UPI & refunds", hi: "चेक, UPI व रिफंड", sub: `${data.chequesToDeposit.count} cheques · ${data.upiOpen.count} UPI to match`, href: "/accounts/books", badge: data.chequesToDeposit.count },
    { icon: "chart", en: "Reports", hi: "रिपोर्ट", sub: "Day, month and class-wise", href: "/reports" },
    { icon: "sliders", en: "Fee setup — view only", hi: "फीस ढांचा — केवल देखें", sub: "Ask admin to change", href: "/fee-setup" },
  ];
  const tile = (i: number) => ({ animation: "xRise .42s var(--ease) both", animationDelay: delay(i) });
  const iconBox = (i: number, big: boolean, bg?: string, fg?: string) => ({
    width: big ? 56 : 46,
    height: big ? 56 : 46,
    borderRadius: 15,
    background: big ? "rgba(255,255,255,.14)" : (bg ?? TONES[i % 5][0]),
    color: big ? "inherit" : (fg ?? TONES[i % 5][1]),
  });
  return (
    <Section style={{ maxWidth: 1120 }}>
      <Card className="ac-f ac-cd" style={{ gap: 14, flexWrap: "wrap" }}>
        <span className="ac-av" style={{ width: 54, height: 54, borderRadius: 27, fontSize: 18, background: "var(--oks)", color: "var(--ok)" }}>{initials(staffName)}</span>
        <span className="ac-c ac-1" style={{ minWidth: 200 }}>
          <span className="serif" style={{ fontSize: 21, fontWeight: 600 }}>{staffName}</span>
          <span className="ac-m">{roleText} · Office counter · Session {data.sessionLabel.replace("-", "–")}</span>
        </span>
        <span className="pill" style={{ height: 28, padding: "0 12px", fontSize: 12, background: closed ? "var(--s3)" : "var(--oks)", color: closed ? "var(--mut)" : "var(--ok)" }}>
          <span style={{ width: 8, height: 8, borderRadius: 4, background: "currentColor" }} />
          {closed ? "Day closed" : "Counter open"}
        </span>
      </Card>
      <div className="ac-tl">
        {tiles.map((t, i) => (
          <div key={t.href} className={`card ac-c ac-t tap${t.big ? " big" : ""}`} style={tile(i)}>
            <div className="ac-f ac-j" style={{ alignItems: "flex-start" }}>
              <span className="ac-av" style={iconBox(i, Boolean(t.big))}><Ic n={t.icon} size={t.big ? 28 : 22} /></span>
              {t.badge ? <span className="pill num" style={{ height: 24, minWidth: 24, justifyContent: "center", fontSize: 12, background: "var(--bad)", color: "var(--onsolid)" }}>{t.badge}</span> : null}
            </div>
            <span className="ac-1" />
            <span style={{ fontSize: t.big ? 24 : 16, fontWeight: 700, lineHeight: 1.2 }}>{tx(p(t.en, t.hi))}</span>
            <span className="ac-m" style={{ fontWeight: 600 }}>{tx(p(t.hi, t.en))}</span>
            <span className="ac-m">{t.sub}</span>
            <Link className="ac-o" href={t.href} aria-label={t.en} />
          </div>
        ))}
        <div className="card ac-c ac-t tap" style={tile(tiles.length)}>
          <span className="ac-av" style={iconBox(tiles.length, false)}><Ic n="help" size={22} /></span>
          <span className="ac-1" />
          <span style={{ fontSize: 16, fontWeight: 700, lineHeight: 1.2 }}>{tx(p("Help", "मदद"))}</span>
          <span className="ac-m" style={{ fontWeight: 600 }}>{tx(p("मदद", "Help"))}</span>
          <span className="ac-m">3 picture steps for each screen</span>
          <button type="button" className="ac-o" aria-label="Help" onClick={() => setHelpOpen(true)} />
        </div>
        <form action={logoutAction} className="card ac-c ac-t tap" style={tile(tiles.length + 1)}>
          <span className="ac-av" style={iconBox(tiles.length + 1, false, "var(--bads)", "var(--bad)")}><Ic n="logout" size={22} /></span>
          <span className="ac-1" />
          <span style={{ fontSize: 16, fontWeight: 700, lineHeight: 1.2 }}>{tx(p("Sign out", "लॉग आउट"))}</span>
          <span className="ac-m" style={{ fontWeight: 600 }}>{tx(p("लॉग आउट", "Sign out"))}</span>
          <span className="ac-m">Ends this session on this device</span>
          <button type="submit" className="ac-o" aria-label="Sign out" />
        </form>
      </div>
      <span className="ac-m ac-f"><Ic n="info" size={16} />Fee setup is view only for the accountant. To change a fee, use “Ask admin to change” inside it.</span>
      <Sheet open={helpOpen} onClose={() => setHelpOpen(false)} title={helpTitle} icon="help" footer={<button type="button" className="tap btn pri" style={{ flex: 1 }} onClick={() => setHelpOpen(false)}>Got it</button>}>
        <ol style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 12 }}>
          {help.map((s, i) => (
            <li key={s.title} className="fadein" style={{ display: "flex", gap: 14, alignItems: "flex-start", animationDelay: `${i * 80}ms` }}>
              <span className="ac-av" style={{ width: 56, height: 56, borderRadius: 16, background: "var(--accs)", color: "var(--accfg)" }}><Ic n={s.icon} size={26} /></span>
              <span className="ac-c" style={{ gap: 2 }}>
                <strong>{i + 1}. {s.title}</strong>
                <span style={{ color: "var(--mut)", fontSize: 14 }}>{s.body}</span>
              </span>
            </li>
          ))}
        </ol>
      </Sheet>
    </Section>
  );
}

function EveningView({ data }: { data: AccountsHomeData }) {
  const { tx } = useVx();
  const bag = useBagChecklist(data.today);
  const closed = data.closure?.status === "closed";
  const mode = (m: string) => data.collected.modes.find((x) => x.mode === m) ?? { total: 0, count: 0 };
  const sum = [
    { label: "Collected", v: rupees(data.collected.total), sub: tx(p(`${receiptsN(data.collected.count).en} · ${data.collected.reversedCount} reversed`, `${receiptsN(data.collected.count).hi} · ${data.collected.reversedCount} वापस`)), tone: "var(--mut)" },
    { label: "Cash", v: rupees(mode("cash").total), sub: tx(receiptsN(mode("cash").count)), tone: "var(--mut)" },
    { label: "UPI", v: rupees(mode("upi").total), sub: data.upiOpen.count ? `${data.upiOpen.count} bank lines still to match` : "all matched in the bank app ✓", tone: data.upiOpen.count ? "var(--warnfg)" : "var(--ok)" },
    { label: "Cheques", v: rupees(mode("cheque").total + mode("bank_transfer").total), sub: `${mode("cheque").count} new · subject to clearing`, tone: "var(--mut)" },
  ];
  const inBag = data.chequesForBank.filter((c) => bag.has(c.receiptId));
  const bagIds = inBag.map((c) => c.receiptId).join(",");
  const promised = data.tomorrowFollowUps.reduce((s, f) => s + f.pendingToday, 0);
  const closedAt = data.closure?.closedAt ? time12(data.closure.closedAt) : null;
  return (
    <Section style={{ maxWidth: 1120 }}>
      <Card className="ac-f ac-cd" style={{ gap: 18, padding: "20px 22px", flexWrap: "wrap" }}>
        <svg width="88" height="88" viewBox="0 0 96 96" aria-hidden="true" style={{ flex: "none", animation: "xPopIn .5s var(--spring) both" }}>
          <circle cx="48" cy="48" r="44" style={{ fill: closed ? "var(--oks)" : "var(--warns)" }} />
          <circle cx="48" cy="48" r="44" style={{ fill: "none", stroke: closed ? "var(--ok)" : "var(--warnfg)", strokeWidth: 4, ...len(276.5), strokeDasharray: 276.5, animation: "xDraw .7s .1s var(--ease) both" }} />
          {closed ? (
            <path d="M30 49l12 12 24-26" style={{ fill: "none", stroke: "var(--ok)", strokeWidth: 6, strokeLinecap: "round", strokeLinejoin: "round", ...len(60), strokeDasharray: 60, animation: "xDraw .45s .5s var(--ease) both" }} />
          ) : (
            <path d="M48 28v24M48 64v2" style={{ fill: "none", stroke: "var(--warnfg)", strokeWidth: 6, strokeLinecap: "round" }} />
          )}
        </svg>
        <span className="ac-c ac-1" style={{ minWidth: 240 }}>
          <span className="serif" style={{ fontSize: 28, fontWeight: 600, lineHeight: 1.2 }}>{closed ? tx(p(`Day closed · ${day(data.today)}`, `दिन बंद · ${day(data.today)}`)) : tx(p("The day is not closed yet", "आज का हिसाब अभी बंद नहीं हुआ"))}</span>
          <span style={{ fontSize: 14, color: "var(--mut)" }}>
            {closed
              ? tx(p(`Closed${data.closure?.closedByName ? ` by ${data.closure.closedByName}` : ""}${closedAt ? ` at ${closedAt}` : ""} · day summary saved. Review receipts posted afterward in Receipts & day close.`, `दिन का सारांश सुरक्षित है${data.closure?.closedByName ? ` · ${data.closure.closedByName}` : ""}${closedAt ? ` · ${closedAt}` : ""}। इसके बाद जमा हुई रसीदें ‘रसीदें और दिन बंद करें’ में देखें।`))
              : "Close it in Receipts & day close once the cash is counted."}
          </span>
          {closed ? <span style={{ fontSize: 13, color: "var(--sub)" }}>आज का हिसाब बंद हो गया। धन्यवाद!</span> : null}
        </span>
        {!closed ? <Btn variant="pri" icon="lock" href="/receipts">{tx(p("Close the day", "दिन बंद करें"))}</Btn> : null}
      </Card>
      <div className="g4" style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0,1fr))", gap: 12 }}>
        {sum.map((k, i) => (
          <div key={k.label} className="card ac-c rise" style={{ padding: "14px 16px", gap: 2, animationDelay: delay(i) }}>
            <span className="ac-m" style={{ fontWeight: 600 }}>{k.label}</span>
            <span className="num" style={{ fontSize: 22, fontWeight: 700 }}>{k.v}</span>
            <span className="ac-m" style={{ color: k.tone }}>{k.sub}</span>
          </div>
        ))}
      </div>
      <div className="stack" style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(0,1fr)", gap: 16, alignItems: "start" }}>
        <Card className="ac-c ac-cd" style={{ gap: 4 }}>
          <div className="ac-f ac-j" style={{ marginBottom: 4 }}>
            <span className="ac-v">{tx(p(`Tomorrow’s follow-ups · ${day(data.tomorrow)}`, `कल के वादे · ${day(data.tomorrow)}`))}</span>
            <span className="ac-m num">{data.tomorrowFollowUps.length} families{promised ? ` · ${rupees(promised)}` : ""}</span>
          </div>
          {data.tomorrowFollowUps.map((f, i) => (
            <div key={f.studentId} className="ac-f ac-an" style={{ gap: 12, padding: "10px 0", borderTop: bt(i), animationDelay: delay(i) }}>
              <span className="ac-av" style={{ background: TONES[(i + 1) % 5][0], color: TONES[(i + 1) % 5][1] }}>{initials(f.studentName)}</span>
              <span className="ac-c ac-1"><span className="ac-b ac-e">{f.studentName}</span><span className="ac-m ac-e">{f.classLabel}</span></span>
              <span className="ac-c" style={{ alignItems: "flex-end" }}>
                <span className="num ac-v">{rupees(f.pendingToday)}</span>
                {f.note ? <span className="pill" style={{ background: "var(--infos)", color: "var(--info)" }}>{f.note}</span> : null}
              </span>
            </div>
          ))}
          {data.tomorrowFollowUps.length === 0 ? <EmptyState icon="calCheck" title="No call-backs set for tomorrow" body="Set one from Dues & calls when a parent promises a day." style={{ padding: "18px 10px" }} /> : null}
          <Btn href="/dues" style={{ marginTop: 8 }}>Open dues &amp; calls</Btn>
        </Card>
        <Card className="ac-c ac-cd" style={{ gap: 4 }}>
          <div className="ac-f ac-j" style={{ marginBottom: 4 }}>
            <span className="ac-v">{tx(p("Cheques for the bank · morning", "सुबह बैंक ले जाएं"))}</span>
            <span className="ac-m num">{inBag.length} of {data.chequesForBank.length} in the bag · {rupees(data.chequesForBank.reduce((s, c) => s + c.amount, 0))}</span>
          </div>
          {data.chequesForBank.map((row, i) => {
            const c = withDeskChequeDetails(row);
            const on = bag.has(c.receiptId);
            return (
              <button key={c.receiptId} type="button" role="checkbox" aria-checked={on} onClick={() => bag.toggle(c.receiptId)} className="tap ac-f ac-an" style={{ gap: 12, padding: "10px 0", border: 0, borderTop: bt(i), background: "transparent", color: "var(--fg)", textAlign: "left", width: "100%", lineHeight: "normal", animationDelay: delay(i) }}>
                <span style={{ flex: "none", width: 24, height: 24, borderRadius: 7, border: `2px solid ${on ? "var(--ok)" : "var(--bds)"}`, background: on ? "var(--ok)" : "var(--card)", display: "flex", alignItems: "center", justifyContent: "center", color: "#FFFFFF", transition: "background-color .2s ease" }}>
                  <Ic n="check" size={14} stroke={3} style={{ opacity: on ? 1 : 0, transform: `scale(${on ? 1 : 0})`, transition: "transform .25s var(--spring)" }} />
                </span>
                <span className="ac-c ac-1"><span className="ac-b ac-e">{c.studentName} · {c.classLabel}</span><span className="ac-m ac-e num">{c.chequeNo ? tx(p(`Cheque ${c.chequeNo}`, `चेक ${c.chequeNo}`)) : tx(p("No cheque no. yet", "चेक नं. नहीं लिखा"))} · {c.bank ?? tx(p("bank not written", "बैंक नहीं लिखा"))} · {day(c.paymentDate)}</span></span>
                <span className="ac-c" style={{ alignItems: "flex-end" }}><span className="num ac-v">{rupees(c.amount)}</span><span className="ac-m" style={{ color: on ? "var(--ok)" : "var(--warnfg)" }}>{on ? "in the bag" : "put it in the bag"}</span></span>
              </button>
            );
          })}
          {data.chequesForBank.length === 0 ? <EmptyState icon="checkCircle" title="No cheques waiting for the bank" style={{ padding: "18px 10px" }} /> : null}
          <div className="ac-f ac-w" style={{ gap: 8, marginTop: 8 }}>
            <Btn variant="pri" icon="printer" href={`/accounts/books?view=cheques&sheet=deposit${bagIds ? `&pick=${bagIds}` : ""}`} disabled={data.chequesForBank.length === 0}>Deposit slip</Btn>
            <Btn variant="ghost" href="/accounts/books">Cheques, UPI &amp; refunds</Btn>
          </div>
        </Card>
      </div>
      <Card className="ac-f ac-cd ac-w" style={{ gap: 12 }}>
        <span className="ac-av" style={{ background: "var(--infos)", color: "var(--info)" }}><Ic n="bell" /></span>
        <span className="ac-c ac-1"><span className="ac-b">{tx(p("Fee reminders", "फीस रिमाइंडर"))}</span><span className="ac-m">{data.reminders.familiesPendingToday} students had fees pending today{data.reminders.nextInstallment ? ` · next: ${data.reminders.nextInstallment}` : ""}</span></span>
        <Btn variant="ghost" href="/reminders">See replies</Btn>
      </Card>
      <div className="ac-f ac-w ac-noprint" style={{ gap: 8 }}>
        <Btn icon="printer" onClick={() => window.print()}>Day report PDF</Btn>
        <Btn variant="ghost" href={`/reports?view=daybook&date=${data.today}`}>See today’s day book</Btn>
        <span className="ac-1" />
        <Btn variant="ghost" href="/accounts?view=home">Back to today</Btn>
      </div>
    </Section>
  );
}
