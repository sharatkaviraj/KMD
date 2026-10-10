"use client";

import "./accounts.css";

import { useRouter } from "next/navigation";
import { useState, useTransition, type ReactNode } from "react";

import {
  bounceChequeAction,
  createDepositSlipAction,
  decideRequestAction,
  markClearedAction,
  matchUpiAction,
  notFeeUpiAction,
  remindAdminAction,
  requestRefundAction,
  saveChequeDetailsAction,
  unmatchUpiAction,
  uploadStatementAction,
  withdrawRequestAction,
} from "@/app/(app)/accounts/books/actions";
import type { AccRequestRow, BooksData, ChequeRow, UpiLineRow } from "@/modules/finance-controls/vx/types";
import { ago, amountInWords, clock, dateLabel, initials, rupees, shortDay } from "@/vx/format";
import { useVx } from "@/vx/i18n";
import { Ic, type IconName } from "@/vx/icons";
import { p } from "@/vx/text";
import { Chip, Field, Input, RadioCard, Seg, Select, Textarea } from "@/vx/ui/controls";
import { HelpButton, Sheet, useToast } from "@/vx/ui/overlays";
import { Section, TopBar, VxPage } from "@/vx/ui/page";
import { Btn, Card, EmptyState, Pill } from "@/vx/ui/primitives";

export type BooksView = "cheques" | "upi" | "refunds" | "requests";
export type BooksSheet = "" | "deposit" | "bounce" | "upload" | "refund";

type ChequeTab = "to_deposit" | "deposited" | "cleared" | "bounced";

const delay = (i: number) => `${Math.min(i, 12) * 30}ms`;
const BOUNCE_REASONS = ["Not enough money", "Signature does not match", "Date or amount wrong", "Account closed", "Other"];
const REFUND_REASONS = ["Paid twice", "Left the school", "Paid more than the fee", "Fee changed", "Other"];
const METHODS = [
  { value: "cash", label: "Cash" },
  { value: "upi", label: "UPI" },
  { value: "bank_transfer", label: "Bank transfer" },
  { value: "cheque", label: "Cheque" },
];

type Result = { ok: boolean; message: string };

export function Books({
  data,
  initialView,
  initialSheet,
  initialPick,
  initialReceipt,
  staffName,
  readOnly,
}: {
  data: BooksData;
  initialView: BooksView;
  initialSheet: BooksSheet;
  initialPick: string[];
  initialReceipt: string | null;
  staffName: string;
  readOnly: boolean;
}) {
  const { tx } = useVx();
  const router = useRouter();
  const toast = useToast();
  const [busy, start] = useTransition();
  const [view, setView] = useState<BooksView>(initialView);
  const [sheet, setSheet] = useState<BooksSheet>(initialSheet);
  const [tab, setTab] = useState<ChequeTab>(initialSheet === "bounce" ? "deposited" : "to_deposit");
  const [picked, setPicked] = useState<string[]>(() => initialPick.filter((id) => data.cheques.some((c) => c.receiptId === id && (c.status === "to_deposit" || c.status === "in_bag"))));
  const [bounceFor, setBounceFor] = useState<string | null>(initialSheet === "bounce" ? (initialReceipt ?? data.cheques.find((c) => c.status === "deposited")?.receiptId ?? null) : null);
  const [detailsFor, setDetailsFor] = useState<ChequeRow | null>(null);
  const [matchFor, setMatchFor] = useState<UpiLineRow | null>(null);
  const [decideFor, setDecideFor] = useState<AccRequestRow | null>(null);
  const canAct = data.canWrite && !readOnly;

  const go = (v: BooksView, s: BooksSheet = "") => {
    setView(v);
    setSheet(s);
    const url = new URL(window.location.href);
    url.searchParams.set("view", v);
    if (s) url.searchParams.set("sheet", s);
    else url.searchParams.delete("sheet");
    url.searchParams.delete("pick");
    url.searchParams.delete("receipt");
    window.history.replaceState(null, "", url);
  };
  const openSheet = (s: BooksSheet) => go(view, s);
  const closeSheet = () => go(view, "");

  const run = (fn: () => Promise<Result>, after?: () => void) =>
    start(async () => {
      const r = await fn();
      toast.show({ text: r.message, tone: r.ok ? "ok" : "bad" });
      if (r.ok) {
        after?.();
        router.refresh();
      }
    });

  const toDeposit = data.cheques.filter((c) => !c.reversed && (c.status === "to_deposit" || c.status === "in_bag"));
  const openUpi = data.upiLines.filter((l) => l.state === "open");
  const myWaiting = data.requests.filter((r) => r.status === "waiting" && (r.mine || data.canDecide));
  const advTotal = data.advances.reduce((s, a) => s + a.credit, 0);

  const kpis: { key: BooksView; icon: IconName; label: string; value: string; sub: string; tone: [string, string] }[] = [
    { key: "cheques", icon: "file", label: tx(p("Cheques to deposit", "जमा करने के चेक")), value: String(toDeposit.length), sub: rupees(toDeposit.reduce((s, c) => s + c.amount, 0)), tone: ["var(--warns)", "var(--warnfg)"] },
    { key: "upi", icon: "zap", label: tx(p("UPI to match", "UPI मिलान")), value: String(openUpi.length), sub: openUpi.length ? rupees(openUpi.reduce((s, l) => s + l.amount, 0)) : `${data.upiLines.length} bank lines`, tone: ["var(--accs)", "var(--accfg)"] },
    { key: "refunds", icon: "swap", label: tx(p("Advances held", "अग्रिम राशि")), value: rupees(advTotal), sub: `${data.advances.length} families`, tone: ["var(--infos)", "var(--info)"] },
    { key: "requests", icon: "inbox", label: tx(p(data.canDecide ? "Requests" : "My requests", "मेरे अनुरोध")), value: String(myWaiting.length), sub: "waiting for the admin", tone: ["var(--s3)", "var(--fg)"] },
  ];

  const topAction =
    view === "cheques"
      ? { label: "Deposit slip", icon: "printer" as IconName, act: () => openSheet("deposit"), on: toDeposit.length > 0 }
      : view === "upi"
        ? { label: "New statement", icon: "upload" as IconName, act: () => openSheet("upload"), on: true }
        : view === "refunds"
          ? { label: "Request a refund", icon: "plus" as IconName, act: () => openSheet("refund"), on: data.advances.length > 0 }
          : null;

  const help = [
    { icon: "file" as IconName, title: "Cheques", body: "Tick the cheques you take to the bank and print the deposit slip. Mark each one cleared or bounced when the bank says so." },
    { icon: "zap" as IconName, title: "UPI", body: "Upload the bank statement. Each payment is matched to its receipt; anything left over needs a look." },
    { icon: "shield" as IconName, title: "Refunds and reversals", body: "Only the admin approves money going back. You ask here and watch the status in My requests." },
  ];

  return (
    <VxPage>
      <TopBar
        crumb={`Money · ${shortDay(data.today)} · ${view === "cheques" ? "Cheques" : view === "upi" ? "UPI matching" : view === "refunds" ? "Refunds & advances" : "Requests"}`}
        title={tx(p("Cheques, UPI & refunds", "चेक, UPI व रिफंड"))}
        mTitle={view === "cheques" ? "Cheques" : view === "upi" ? "UPI matching" : view === "refunds" ? "Refunds & advances" : data.canDecide ? "Requests" : "My requests"}
        mSub="Cheques, UPI & refunds"
        mBack="/accounts?view=menu"
        actions={
          <>
            <HelpButton title="Cheques, UPI & refunds" steps={help} />
            {topAction && canAct ? <Btn variant={topAction.on ? "pri" : "sec"} icon={topAction.icon} onClick={topAction.act} disabled={!topAction.on}>{topAction.label}</Btn> : null}
          </>
        }
        mAction={topAction && canAct ? <Btn variant="soft" icon={topAction.icon} onClick={topAction.act} disabled={!topAction.on} style={{ height: 40, padding: "0 12px", fontSize: 13 }}>{topAction.label.split(" ")[0]}</Btn> : undefined}
      />
      <Section>
        {readOnly ? <Pill tone="info" icon="eye">Preview · read only</Pill> : null}
        <div className="ac-kp" role="tablist" aria-label="Sections">
          {kpis.map((k, i) => (
            <button key={k.key} type="button" role="tab" aria-selected={view === k.key} className="tap card" onClick={() => go(k.key)} style={{ borderColor: view === k.key ? "var(--acc)" : undefined, boxShadow: view === k.key ? "0 0 0 3px var(--accs)" : undefined, animationDelay: delay(i) }}>
              <span className="ac-ib" style={{ background: k.tone[0], color: k.tone[1] }}><Ic n={k.icon} size={20} /></span>
              <span className="ac-c ac-1" style={{ gap: 1 }}>
                <span className="ac-m ac-e" style={{ fontWeight: 600 }}>{k.label}</span>
                <span className="num" style={{ fontSize: 20, fontWeight: 700, whiteSpace: "nowrap" }}>{k.value}</span>
                <span className="ac-m ac-e">{k.sub}</span>
              </span>
            </button>
          ))}
        </div>

        {view === "cheques" ? (
          <ChequesPane
            data={data}
            tab={tab}
            setTab={setTab}
            picked={picked}
            setPicked={setPicked}
            canAct={canAct}
            busy={busy}
            onDeposit={() => openSheet("deposit")}
            onBounce={(id) => {
              setBounceFor(id);
              openSheet("bounce");
            }}
            onCleared={(id) => run(() => markClearedAction([id]))}
            onDetails={setDetailsFor}
          />
        ) : null}
        {view === "upi" ? <UpiPane data={data} canAct={canAct} busy={busy} onUpload={() => openSheet("upload")} onMatch={setMatchFor} onUndo={(id) => run(() => unmatchUpiAction(id))} onNotFee={(id) => run(() => notFeeUpiAction(id))} /> : null}
        {view === "refunds" ? <RefundsPane data={data} canAct={canAct} onRequest={() => openSheet("refund")} onSeeRequests={() => go("requests")} /> : null}
        {view === "requests" ? (
          <RequestsPane
            data={data}
            canAct={!readOnly}
            busy={busy}
            onWithdraw={(id) => run(() => withdrawRequestAction(id))}
            onRemind={(id) => run(() => remindAdminAction(id))}
            onDecide={setDecideFor}
          />
        ) : null}
      </Section>

      <DepositSheet open={sheet === "deposit"} onClose={closeSheet} data={data} picked={picked} setPicked={setPicked} staffName={staffName} canAct={canAct} busy={busy} run={run} />
      <BounceSheet open={sheet === "bounce"} onClose={closeSheet} cheque={data.cheques.find((c) => c.receiptId === bounceFor) ?? null} deposited={data.cheques.filter((c) => c.status === "deposited")} pick={setBounceFor} canAct={canAct} busy={busy} run={run} />
      <UploadSheet open={sheet === "upload"} onClose={closeSheet} canAct={canAct} busy={busy} run={run} />
      <RefundSheet open={sheet === "refund"} onClose={closeSheet} data={data} canAct={canAct} busy={busy} run={run} />
      <DetailsSheet cheque={detailsFor} onClose={() => setDetailsFor(null)} canAct={canAct} busy={busy} run={run} />
      <MatchSheet line={matchFor} onClose={() => setMatchFor(null)} canAct={canAct} busy={busy} run={run} />
      <DecideSheet request={decideFor} onClose={() => setDecideFor(null)} busy={busy} run={run} />
    </VxPage>
  );
}

function statusPill(c: ChequeRow): { label: string; bg: string; fg: string } {
  if (c.reversed) return { label: "Receipt reversed", bg: "var(--s3)", fg: "var(--mut)" };
  switch (c.status) {
    case "deposited":
      return { label: `Deposited${c.slipNo ? ` · ${c.slipNo}` : ""}`, bg: "var(--infos)", fg: "var(--info)" };
    case "cleared":
      return { label: "Cleared", bg: "var(--oks)", fg: "var(--ok)" };
    case "bounced":
      return { label: `Bounced${c.bounceReason ? ` · ${c.bounceReason}` : ""}`, bg: "var(--bads)", fg: "var(--bad)" };
    default:
      return { label: "To deposit", bg: "var(--warns)", fg: "var(--warnfg)" };
  }
}

function ChequesPane({
  data,
  tab,
  setTab,
  picked,
  setPicked,
  canAct,
  busy,
  onDeposit,
  onBounce,
  onCleared,
  onDetails,
}: {
  data: BooksData;
  tab: ChequeTab;
  setTab: (t: ChequeTab) => void;
  picked: string[];
  setPicked: (ids: string[]) => void;
  canAct: boolean;
  busy: boolean;
  onDeposit: () => void;
  onBounce: (id: string) => void;
  onCleared: (id: string) => void;
  onDetails: (c: ChequeRow) => void;
}) {
  const inTab = (c: ChequeRow, t: ChequeTab) => (t === "to_deposit" ? !c.reversed && (c.status === "to_deposit" || c.status === "in_bag") : c.status === t);
  const rows = data.cheques.filter((c) => inTab(c, tab));
  const count = (t: ChequeTab) => data.cheques.filter((c) => inTab(c, t)).length;
  const hint =
    tab === "to_deposit" ? "Tick the cheques going to the bank, then make the deposit slip." : tab === "deposited" ? "Usually clears in 2–3 working days. Mark each one when the bank says." : tab === "cleared" ? "Money is in the school account." : "The admin is asked to reverse each bounced receipt.";
  const pickedRows = data.cheques.filter((c) => picked.includes(c.receiptId));
  const toggle = (id: string) => setPicked(picked.includes(id) ? picked.filter((x) => x !== id) : [...picked, id]);
  return (
    <div className="ac-c" style={{ gap: 12, animation: "xIn .32s var(--ease) both" }}>
      <div className="ac-f ac-w" style={{ gap: 10 }}>
        <Seg<ChequeTab>
          label="Cheque status"
          value={tab}
          onChange={setTab}
          style={{ width: 520, maxWidth: "100%" }}
          options={[
            { value: "to_deposit", label: <>To deposit <span className="num" style={{ fontWeight: 600, color: "var(--sub)" }}>{count("to_deposit")}</span></> },
            { value: "deposited", label: <>Deposited <span className="num" style={{ fontWeight: 600, color: "var(--sub)" }}>{count("deposited")}</span></> },
            { value: "cleared", label: <>Cleared <span className="num" style={{ fontWeight: 600, color: "var(--sub)" }}>{count("cleared")}</span></> },
            { value: "bounced", label: <>Bounced <span className="num" style={{ fontWeight: 600, color: "var(--sub)" }}>{count("bounced")}</span></> },
          ]}
        />
        <span className="ac-m" style={{ flex: 1, minWidth: 220 }}>{hint}</span>
      </div>
      {rows.length ? (
        <Card pad={false} style={{ overflow: "hidden" }}>
          <div className="ac-cth">
            <span />
            <span className="sech">Cheque</span>
            <span className="sech">Family</span>
            <span className="sech">Bank</span>
            <span className="sech">Taken</span>
            <span className="sech">Receipt</span>
            <span className="sech" style={{ textAlign: "right" }}>Amount</span>
            <span className="sech" style={{ textAlign: "right" }}>Status</span>
          </div>
          {rows.map((r, i) => {
            const pill = statusPill(r);
            const sel = picked.includes(r.receiptId);
            const selectable = tab === "to_deposit" && canAct;
            return (
              <div key={r.receiptId} className="row ac-ct ac-an" style={{ animationDelay: delay(i) }}>
                {selectable ? (
                  <button type="button" className="tap ac-cb c-cb" role="checkbox" aria-checked={sel} aria-label={`Select cheque ${r.chequeNo ?? r.receiptNumber}`} onClick={() => toggle(r.receiptId)}>
                    <span style={{ background: sel ? "var(--acc)" : "var(--card)", borderColor: sel ? "var(--acc)" : "var(--bds)" }}>{sel ? <Ic n="check" size={14} stroke={3} /> : null}</span>
                  </button>
                ) : (
                  <span className="c-cb ac-f" style={{ justifyContent: "center", width: 40, height: 40 }}>
                    <span className="ac-ib" style={{ width: 30, height: 30, borderRadius: 10, background: pill.bg, color: pill.fg }}><Ic n={r.status === "cleared" ? "check" : r.status === "bounced" ? "alert" : "file"} size={15} /></span>
                  </span>
                )}
                <span className="num c-no" style={{ fontSize: 13, fontWeight: 700 }}>{r.chequeNo ?? "—"}</span>
                <span className="ac-c c-fam">
                  <span className="ac-b ac-e">{r.studentName}</span>
                  <span className="ac-m ac-e">{r.classLabel}</span>
                  <span className="ac-m ac-e num only-m">{r.chequeNo ? `${r.chequeNo} · ` : ""}{r.bank ?? "bank not written"} · {r.receiptNumber}</span>
                </span>
                <span className="ac-m ac-e c-bank" style={{ fontSize: 13 }}>{r.bank ?? "—"}</span>
                <span className="num c-dt" style={{ fontSize: 13 }}>{shortDay(r.paymentDate)}</span>
                <span className="num ac-m c-rec" style={{ fontSize: 13 }}>{r.receiptNumber}</span>
                <span className="c-amt ac-c" style={{ alignItems: "flex-end" }}>
                  <span className="num ac-v">{rupees(r.amount)}</span>
                  <span className="num ac-m only-m">{shortDay(r.paymentDate)}</span>
                </span>
                <span className="c-act ac-act">
                  <span className="pill" style={{ height: 24, background: pill.bg, color: pill.fg }}>{pill.label}</span>
                  {canAct && !r.chequeNo && r.status !== "cleared" ? <button type="button" className="tap btn ghost ac-s" onClick={() => onDetails(r)}><Ic n="edit" size={15} />Add details</button> : null}
                  {canAct && r.status === "deposited" ? (
                    <>
                      <button type="button" className="tap btn soft ac-s" disabled={busy} onClick={() => onCleared(r.receiptId)}><Ic n="check" size={15} />Cleared</button>
                      <button type="button" className="tap btn ghost ac-s" style={{ color: "var(--bad)" }} onClick={() => onBounce(r.receiptId)}><Ic n="alert" size={15} />Bounced</button>
                    </>
                  ) : null}
                </span>
              </div>
            );
          })}
        </Card>
      ) : (
        <Card className="ac-c" style={{ padding: "34px 24px", alignItems: "center", gap: 10, textAlign: "center" }}>
          <span className="ac-ib" style={{ width: 56, height: 56, borderRadius: 28, background: "var(--oks)", color: "var(--ok)", animation: "xPopIn .5s var(--spring) both" }}><Ic n="checkCircle" size={26} /></span>
          <span style={{ fontSize: 16, fontWeight: 700 }}>{tab === "to_deposit" ? "No cheques waiting for the bank" : tab === "deposited" ? "Nothing waiting to clear" : tab === "cleared" ? "No cleared cheques yet" : "No bounced cheques"}</span>
          <span className="ac-m" style={{ fontSize: 13 }}>Cheque receipts from the Payment Desk show up here.</span>
          {tab !== "to_deposit" ? <Btn onClick={() => setTab("to_deposit")}>See cheques to deposit</Btn> : null}
        </Card>
      )}
      {pickedRows.length > 0 && tab === "to_deposit" ? (
        <div className="glass ac-f" style={{ position: "sticky", bottom: 12, zIndex: 4, flexWrap: "wrap", padding: "10px 12px", borderRadius: 18, border: "1px solid var(--bds)", boxShadow: "var(--shh)", animation: "xToast .32s var(--spring) both" }}>
          <span className="ac-c" style={{ paddingLeft: 4, marginRight: "auto" }}>
            <span className="ac-b" style={{ fontWeight: 700 }}>{pickedRows.length} cheques · {rupees(pickedRows.reduce((s, c) => s + c.amount, 0))}</span>
            <span className="ac-m">Ready for one deposit slip</span>
          </span>
          <Btn variant="ghost" onClick={() => setPicked([])}>Clear</Btn>
          <Btn variant="pri" icon="printer" onClick={onDeposit} style={{ height: 48 }}>Make deposit slip</Btn>
        </div>
      ) : null}
    </div>
  );
}

function UpiPane({ data, canAct, busy, onUpload, onMatch, onUndo, onNotFee }: { data: BooksData; canAct: boolean; busy: boolean; onUpload: () => void; onMatch: (l: UpiLineRow) => void; onUndo: (id: string) => void; onNotFee: (id: string) => void }) {
  const [filter, setFilter] = useState<"open" | "matched" | "all">("open");
  const total = data.upiLines.length;
  const done = data.upiLines.filter((l) => l.state !== "open").length;
  const pct = total ? done / total : 0;
  const rows = data.upiLines.filter((l) => (filter === "all" ? true : filter === "open" ? l.state === "open" : l.state !== "open"));
  const days = data.upiLines.map((l) => l.txnAt.slice(0, 10)).sort();
  return (
    <div className="ac-c" style={{ gap: 12, animation: "xIn .32s var(--ease) both" }}>
      <Card className="ac-f" style={{ padding: "16px 18px", gap: 16, flexWrap: "wrap" }}>
        <svg width="64" height="64" viewBox="0 0 64 64" aria-hidden="true" style={{ flex: "none" }}>
          <circle cx="32" cy="32" r="26" style={{ fill: "none", stroke: "var(--s3)", strokeWidth: 7 }} />
          <circle cx="32" cy="32" r="26" transform="rotate(-90 32 32)" style={{ fill: "none", stroke: "var(--ok)", strokeWidth: 7, strokeLinecap: "round", strokeDasharray: `${(163.4 * pct).toFixed(1)} 163.4`, transition: "stroke-dasharray .6s var(--ease)" }} />
        </svg>
        <span className="ac-c" style={{ flex: 1, minWidth: 200, gap: 4 }}>
          <span className="serif" style={{ fontSize: 20, fontWeight: 600 }}>{total ? `${done} of ${total} bank payments sorted` : "No bank statement yet"}</span>
          <span className="ac-m" style={{ fontSize: 13 }}>{total ? `${days[0] ? dateLabel(days[0]) : ""} – ${days.at(-1) ? dateLabel(days.at(-1) as string) : ""} · ${data.upiReceiptsUnmatched} UPI receipts not yet seen in the bank` : "Upload the bank’s UPI statement (CSV) to match it with receipts."}</span>
          <span style={{ display: "block", height: 8, borderRadius: 4, background: "var(--s3)", overflow: "hidden", marginTop: 4 }}><span style={{ display: "block", height: 8, borderRadius: 4, width: `${(pct * 100).toFixed(0)}%`, background: "var(--ok)", transition: "width .5s var(--ease)" }} /></span>
        </span>
        {canAct ? <Btn icon="upload" onClick={onUpload}>New statement</Btn> : null}
      </Card>
      {total > 0 && done === total ? (
        <Card className="ac-f" style={{ padding: "16px 18px", gap: 14, background: "var(--oks)", borderColor: "var(--okm)" }}>
          <Ic n="checkCircle" size={32} style={{ color: "var(--ok)" }} />
          <span className="ac-c"><span className="ac-v" style={{ color: "var(--ok)" }}>Every UPI payment is sorted</span><span style={{ fontSize: 13, color: "var(--ok)" }}>The bank and the app agree. Day close can use this.</span></span>
        </Card>
      ) : null}
      <Seg value={filter} onChange={setFilter} label="Show" style={{ width: 420, maxWidth: "100%" }} options={[{ value: "open", label: "Needs a look" }, { value: "matched", label: "Matched" }, { value: "all", label: "All" }]} />
      <div className="ac-ur hide-m" style={{ animation: "none" }}><span className="sech">In the bank statement</span><span /><span className="sech">In VPPS One · receipts</span></div>
      {rows.map((r, i) => {
        const matched = r.state === "matched" && r.receipt;
        return (
          <div key={r.id} className="ac-ur" style={{ animationDelay: delay(i) }}>
            <div className="card" style={{ borderColor: matched ? "var(--okm)" : r.state === "open" ? "var(--warnm)" : undefined }}>
              <span className="ac-ib" style={{ background: "var(--infos)", color: "var(--info)" }}><Ic n="zap" size={18} /></span>
              <span className="ac-c ac-1"><span className="ac-b ac-e">{r.payer}</span><span className="ac-m ac-e num">{shortDay(r.txnAt)} {clock(r.txnAt)} · UPI ref {r.utr}</span></span>
              <span className="num ac-v">{rupees(r.amount)}</span>
            </div>
            <div className={`ac-ul${matched ? " ok" : ""}`} style={{ color: matched ? "var(--ok)" : "var(--warnfg)" }} aria-hidden="true"><b><Ic n={matched ? "check" : "minus"} size={13} stroke={3} /></b></div>
            {matched && r.receipt ? (
              <div className="card" style={{ background: "var(--card)" }}>
                <span className="ac-ib" style={{ background: "var(--oks)", color: "var(--ok)" }}><Ic n="receipt" size={18} /></span>
                <span className="ac-c ac-1"><span className="ac-b ac-e">{r.receipt.studentName}{r.receipt.classLabel ? ` · ${r.receipt.classLabel}` : ""}</span><span className="ac-m ac-e">{r.receipt.receiptNumber} · {shortDay(r.receipt.paymentDate)}</span></span>
                <span className="ac-c" style={{ alignItems: "flex-end", gap: 4 }}><span className="num ac-v">{rupees(r.receipt.amount)}</span><Pill tone="ok">Matched</Pill></span>
                {canAct ? <button type="button" className="tap btn ghost" aria-label="Undo this match" disabled={busy} onClick={() => onUndo(r.id)} style={{ width: 34, height: 34, padding: 0 }}><Ic n="undo" size={16} /></button> : null}
              </div>
            ) : r.state === "not_fee" ? (
              <div className="card" style={{ background: "var(--s2)" }}>
                <span className="ac-ib" style={{ background: "var(--s3)", color: "var(--mut)" }}><Ic n="x" size={18} /></span>
                <span className="ac-c ac-1"><span className="ac-b">Not a fee payment</span><span className="ac-m">Left out of fee matching</span></span>
                {canAct ? <button type="button" className="tap btn ghost" aria-label="Undo" disabled={busy} onClick={() => onUndo(r.id)} style={{ width: 34, height: 34, padding: 0 }}><Ic n="undo" size={16} /></button> : null}
              </div>
            ) : (
              <div className="card ac-c" style={{ alignItems: "stretch", gap: 8, borderColor: "var(--warnm)", background: "var(--warns)" }}>
                <span className="ac-b" style={{ color: "var(--warnfg)" }}>{r.suggestions.length ? `${r.suggestions.length} receipt${r.suggestions.length === 1 ? "" : "s"} could be this payment` : "No receipt found for this payment"}</span>
                <span className="ac-m" style={{ color: "var(--warnfg)" }}>{r.suggestions[0] ? `Best: ${r.suggestions[0].receiptNumber} · ${r.suggestions[0].studentName}${r.suggestions[0].why === "ref" ? " · UPI ref on the receipt" : ""}` : "If the parent paid but no receipt was made, make one at the Payment Desk."}</span>
                {canAct ? (
                  <div className="ac-f ac-w" style={{ gap: 6 }}>
                    {r.suggestions.length ? <button type="button" className="tap btn pri ac-s" onClick={() => onMatch(r)}><Ic n="link" size={15} />Match with a receipt</button> : null}
                    <Btn variant="sec" href="/payments" style={{ height: 34, padding: "0 10px", fontSize: 13 }}>Make a receipt</Btn>
                    <button type="button" className="tap btn ghost ac-s" disabled={busy} onClick={() => onNotFee(r.id)}>Not a fee payment</button>
                  </div>
                ) : null}
              </div>
            )}
          </div>
        );
      })}
      {rows.length === 0 ? <EmptyState icon="zap" title={filter === "open" ? "Nothing needs a look" : "No bank lines here"} body={total ? undefined : "Upload this week’s statement from the bank app."} /> : null}
    </div>
  );
}

function RefundsPane({ data, canAct, onRequest, onSeeRequests }: { data: BooksData; canAct: boolean; onRequest: () => void; onSeeRequests: () => void }) {
  const refundReqs = data.requests.filter((r) => r.kind === "refund").slice(0, 6);
  return (
    <div className="stack" style={{ display: "grid", gridTemplateColumns: "minmax(0,1.15fr) minmax(0,1fr)", gap: 16, alignItems: "start", animation: "xIn .32s var(--ease) both" }}>
      <Card className="ac-c" style={{ padding: "16px 18px 8px" }}>
        <div className="ac-f ac-j" style={{ marginBottom: 4 }}>
          <span className="ac-c"><span className="ac-v">Advances held for families</span><span className="ac-m">Paid more than the fee. Used for the next fee unless a refund is approved.</span></span>
          <span className="num ac-v">{rupees(data.advances.reduce((s, a) => s + a.credit, 0))}</span>
        </div>
        {data.advances.map((a, i) => (
          <div key={a.studentId} className="ac-c ac-an" style={{ gap: 8, padding: "12px 0", borderTop: i ? "1px solid var(--bd)" : "1px solid var(--bd)", animationDelay: delay(i) }}>
            <div className="ac-f" style={{ gap: 12 }}>
              <span className="ac-ib" style={{ background: "var(--accs)", color: "var(--accfg)", fontSize: 13, fontWeight: 700 }}>{initials(a.studentName)}</span>
              <span className="ac-c ac-1"><span className="ac-b ac-e">{a.studentName}</span><span className="ac-m ac-e">{a.classLabel}{a.fatherName ? ` · ${a.fatherName}` : ""}</span></span>
              <span className="num ac-v">{rupees(a.credit)}</span>
            </div>
            <span className="ac-m" style={{ paddingLeft: 52 }}>{a.refundable > 0 ? `${rupees(a.refundable)} can be refunded` : "Held for the next fee"}</span>
          </div>
        ))}
        {data.advances.length === 0 ? <EmptyState icon="swap" title="No family has paid ahead" style={{ padding: "18px 10px" }} /> : null}
        {canAct && data.advances.length ? <Btn variant="soft" icon="plus" onClick={onRequest} style={{ margin: "6px 0 10px", alignSelf: "flex-start" }}>Ask to refund an advance</Btn> : null}
      </Card>
      <div className="ac-c" style={{ gap: 16 }}>
        <Card className="ac-c" style={{ padding: "16px 18px 8px" }}>
          <div className="ac-f ac-j" style={{ marginBottom: 4 }}><span className="ac-v">Refund requests</span><span className="ac-m">The admin approves every refund</span></div>
          {refundReqs.map((q, i) => {
            const t = q.status === "approved" ? ["var(--oks)", "var(--ok)"] : q.status === "declined" ? ["var(--bads)", "var(--bad)"] : ["var(--warns)", "var(--warnfg)"];
            return (
              <div key={q.id} className="ac-f ac-an" style={{ gap: 12, padding: "12px 0", borderTop: "1px solid var(--bd)", alignItems: "flex-start", animationDelay: delay(i) }}>
                <span className="ac-ib" style={{ background: t[0], color: t[1] }}><Ic n="swap" size={18} /></span>
                <span className="ac-c ac-1" style={{ gap: 2 }}><span className="ac-b">{q.studentName ?? q.title}</span><span className="ac-m">{q.reason}</span><span className="pill" style={{ alignSelf: "flex-start", marginTop: 4, background: t[0], color: t[1] }}>{q.status === "waiting" ? "Waiting for the admin" : q.status}</span></span>
                <span className="num ac-v">{rupees(q.amount)}</span>
              </div>
            );
          })}
          {data.feeRefunds.map((r, i) => (
            <div key={r.id} className="ac-f ac-an" style={{ gap: 12, padding: "12px 0", borderTop: "1px solid var(--bd)", animationDelay: delay(i + refundReqs.length) }}>
              <span className="ac-ib" style={{ background: "var(--s2)", color: "var(--mut)" }}><Ic n="receipt" size={18} /></span>
              <span className="ac-c ac-1"><span className="ac-b">{r.studentName}</span><span className="ac-m">{r.reason} · {dateLabel(r.refundDate)}</span></span>
              <span className="ac-c" style={{ alignItems: "flex-end" }}><span className="num ac-v">{rupees(r.amount)}</span><span className="ac-m">{r.status.replace(/_/g, " ")}</span></span>
            </div>
          ))}
          {refundReqs.length + data.feeRefunds.length === 0 ? <span className="ac-m" style={{ padding: "10px 0" }}>No refund requests yet.</span> : null}
          <button type="button" className="tap btn ghost" onClick={onSeeRequests} style={{ alignSelf: "flex-start", margin: "4px 0 8px", color: "var(--acc)" }}>See all in My requests<Ic n="chevRight" size={16} /></button>
        </Card>
        <div className="ac-in" style={{ background: "var(--infos)", color: "var(--info)" }}>
          <Ic n="shield" size={18} />
          <span>Refunds are never paid from the counter cash without the admin’s OK. After approval the refund is written in Finance controls as its own row; the family’s history keeps both.</span>
        </div>
      </div>
    </div>
  );
}

const KIND_LABEL: Record<string, string> = { late_fee_waiver: "Late fee waiver", reversal: "Reverse a receipt", refund: "Refund", fee_change: "Fee change", other: "Request" };
const KIND_ICON: Record<string, IconName> = { late_fee_waiver: "percent", reversal: "undo", refund: "swap", fee_change: "sliders", other: "inbox" };

function RequestsPane({ data, canAct, busy, onWithdraw, onRemind, onDecide }: { data: BooksData; canAct: boolean; busy: boolean; onWithdraw: (id: string) => void; onRemind: (id: string) => void; onDecide: (r: AccRequestRow) => void }) {
  const [filter, setFilter] = useState<"waiting" | "done" | "all">("waiting");
  const rows = data.requests.filter((r) => (filter === "all" ? true : filter === "waiting" ? r.status === "waiting" : r.status !== "waiting"));
  return (
    <div className="ac-c" style={{ gap: 12, animation: "xIn .32s var(--ease) both" }}>
      <div className="ac-f ac-w" style={{ gap: 10 }}>
        <Seg value={filter} onChange={setFilter} label="Show" style={{ width: 360, maxWidth: "100%" }} options={[{ value: "waiting", label: "Waiting" }, { value: "done", label: "Decided" }, { value: "all", label: "All" }]} />
        <span className="ac-m">{data.canDecide ? "Approve or decline what the office asks. The fee change itself is made in the fee screens." : "Late-fee waivers, reversals and refunds go to the admin."}</span>
      </div>
      <div className="stack" style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0,1fr))", gap: 12, alignItems: "start" }}>
        {rows.map((q, i) => {
          const tone = q.status === "approved" ? ["var(--oks)", "var(--ok)"] : q.status === "declined" ? ["var(--bads)", "var(--bad)"] : q.status === "withdrawn" ? ["var(--s3)", "var(--mut)"] : ["var(--warns)", "var(--warnfg)"];
          const stepDone = q.status === "waiting" ? 1 : 3;
          const steps = [
            { label: "Asked", when: ago(q.requestedAt), on: true },
            { label: q.remindedAt ? "Reminded" : "With the admin", when: q.remindedAt ? ago(q.remindedAt) : "", on: true },
            { label: q.status === "waiting" ? "Decision" : q.status === "withdrawn" ? "Withdrawn" : q.status === "approved" ? "Approved" : "Declined", when: q.decidedAt ? ago(q.decidedAt) : q.withdrawnAt ? ago(q.withdrawnAt) : "", on: q.status !== "waiting" },
          ];
          return (
            <Card key={q.id} className="ac-c" style={{ padding: "14px 16px", gap: 12, borderColor: q.status === "waiting" ? "var(--warnm)" : undefined, animation: "xIn .32s var(--ease) both", animationDelay: delay(i) }}>
              <div className="ac-f" style={{ gap: 12, alignItems: "flex-start" }}>
                <span className="ac-ib" style={{ background: tone[0], color: tone[1] }}><Ic n={KIND_ICON[q.kind] ?? "inbox"} size={18} /></span>
                <span className="ac-c ac-1" style={{ gap: 1 }}>
                  <span className="ac-f ac-w" style={{ gap: 6 }}><span className="ac-b" style={{ fontWeight: 700 }}>{KIND_LABEL[q.kind] ?? "Request"}</span>{Date.parse(q.requestedAt) > Date.now() - 6 * 3600_000 && q.status === "waiting" ? <Pill tone="acc">New</Pill> : null}</span>
                  <span className="ac-m">{q.title}{q.studentName ? ` · ${q.studentName}` : ""}{q.mine ? "" : ` · asked by ${q.requestedByName}`}</span>
                  <span className="ac-m" style={{ color: "var(--sub)" }}>{q.reason}</span>
                </span>
                {q.amount !== null ? <span className="num ac-v">{rupees(q.amount)}</span> : null}
              </div>
              <div className="ac-tl2">
                <i><b style={{ width: `${(stepDone - 1) * 50}%`, background: q.status === "declined" ? "var(--bad)" : "var(--ok)" }} /></i>
                {steps.map((t, k) => (
                  <div key={k}>
                    <span style={{ borderColor: t.on ? tone[1] : "var(--bds)", background: t.on ? tone[0] : "var(--card)", color: tone[1] }}><Ic n={t.on ? (k === 2 && q.status === "declined" ? "x" : "check") : "clock"} size={13} /></span>
                    <span style={{ fontSize: 12, fontWeight: 700, color: t.on ? "var(--fg)" : "var(--mut)" }}>{t.label}</span>
                    <span className="num" style={{ fontSize: 11, color: "var(--sub)" }}>{t.when}</span>
                  </div>
                ))}
              </div>
              {q.decisionNote ? <div className="ac-in" style={{ padding: "9px 12px", background: tone[0], color: tone[1] }}><span>{q.decidedByName ? `${q.decidedByName}: ` : ""}{q.decisionNote}</span></div> : null}
              {q.status === "waiting" && canAct ? (
                <div className="ac-f" style={{ gap: 6, justifyContent: "flex-end" }}>
                  {q.mine ? (
                    <>
                      <button type="button" className="tap btn ghost ac-s" style={{ color: "var(--bad)" }} disabled={busy} onClick={() => onWithdraw(q.id)}>Withdraw</button>
                      <button type="button" className="tap btn sec ac-s" disabled={busy || !q.canRemind} onClick={() => onRemind(q.id)}><Ic n="bell" size={15} />{q.canRemind ? "Remind admin" : "Reminded"}</button>
                    </>
                  ) : null}
                  {data.canDecide ? <button type="button" className="tap btn pri ac-s" onClick={() => onDecide(q)}><Ic n="check" size={15} />Decide</button> : null}
                </div>
              ) : null}
            </Card>
          );
        })}
      </div>
      {rows.length === 0 ? (
        <Card className="ac-c" style={{ padding: 30, alignItems: "center", gap: 8, textAlign: "center" }}>
          <span className="ac-v">Nothing here</span>
          <span className="ac-m">Requests sent to the admin show up here with their status.</span>
        </Card>
      ) : null}
    </div>
  );
}

function SheetFooter({ onCancel, onOk, okLabel, okIcon, disabled, danger, cancelLabel = "Cancel" }: { onCancel: () => void; onOk: () => void; okLabel: string; okIcon?: IconName; disabled?: boolean; danger?: boolean; cancelLabel?: string }) {
  return (
    <>
      <button type="button" className="tap btn sec" style={{ flex: 1, height: 48 }} onClick={onCancel}>{cancelLabel}</button>
      <button type="button" className={`tap btn ${danger ? "danger" : "pri"}`} style={{ flex: 1.6, height: 48 }} onClick={onOk} disabled={disabled}>
        {okIcon ? <Ic n={okIcon} size={18} /> : null}
        {okLabel}
      </button>
    </>
  );
}

function Stack({ children, gap = 12 }: { children: ReactNode; gap?: number }) {
  return <div style={{ display: "flex", flexDirection: "column", gap }}>{children}</div>;
}

function DepositSheet({ open, onClose, data, picked, setPicked, staffName, canAct, busy, run }: { open: boolean; onClose: () => void; data: BooksData; picked: string[]; setPicked: (ids: string[]) => void; staffName: string; canAct: boolean; busy: boolean; run: (fn: () => Promise<Result>, after?: () => void) => void }) {
  const [bank, setBank] = useState("State Bank of India · school account");
  const [date, setDate] = useState(data.today);
  const available = data.cheques.filter((c) => !c.reversed && (c.status === "to_deposit" || c.status === "in_bag"));
  const chosen = picked.length ? available.filter((c) => picked.includes(c.receiptId)) : [];
  const total = chosen.reduce((s, c) => s + c.amount, 0);
  const toggle = (id: string) => setPicked(picked.includes(id) ? picked.filter((x) => x !== id) : [...picked, id]);
  return (
    <Sheet
      open={open}
      onClose={onClose}
      wide
      title="Deposit slip"
      sub={`${chosen.length} cheques · ${rupees(total)}`}
      footer={
        <SheetFooter
          onCancel={() => window.print()}
          cancelLabel="Print"
          onOk={() => run(() => createDepositSlipAction({ receiptIds: chosen.map((c) => c.receiptId), bankLabel: bank, depositedOn: date }), () => { setPicked([]); onClose(); })}
          okLabel="Mark as deposited"
          okIcon="check"
          disabled={!canAct || busy || chosen.length === 0}
        />
      }
    >
      <Stack>
        {available.length === 0 ? <EmptyState icon="checkCircle" title="No cheques waiting for the bank" /> : null}
        {available.length > 0 ? (
          <div className="ac-f ac-w" style={{ gap: 6 }}>
            <Chip on={chosen.length === available.length} onClick={() => setPicked(chosen.length === available.length ? [] : available.map((c) => c.receiptId))}>All {available.length}</Chip>
            {available.map((c) => (
              <Chip key={c.receiptId} on={picked.includes(c.receiptId)} onClick={() => toggle(c.receiptId)}>{c.chequeNo ?? c.receiptNumber} · {rupees(c.amount)}</Chip>
            ))}
          </div>
        ) : null}
        <div className="g2" style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0,1fr))", gap: 10 }}>
          <Field label="Bank and account"><Input value={bank} onChange={(e) => setBank(e.target.value)} /></Field>
          <Field label="Deposited on"><Input type="date" value={date} max={data.today} onChange={(e) => setDate(e.target.value)} /></Field>
        </div>
        <div className="ac-slip">
          <div className="ac-f" style={{ gap: 12, paddingBottom: 10, borderBottom: "1px solid var(--bd)" }}>
            <span className="ac-ib" style={{ background: "#082F49", color: "#F7F6F3" }}><Ic n="bank" size={20} /></span>
            <span className="ac-c ac-1"><span className="serif" style={{ fontSize: 16, fontWeight: 600 }}>{bank || "Bank"}</span><span className="ac-m">Pay-in slip · cheques</span></span>
            <span className="num ac-m" style={{ textAlign: "right" }}>Date<br /><b style={{ color: "var(--fg)" }}>{dateLabel(date)}</b></span>
          </div>
          <div className="ac-c">
            <span className="ac-m" style={{ fontSize: 11 }}>Account name</span>
            <span style={{ fontWeight: 600 }}>{process.env.NEXT_PUBLIC_SCHOOL_NAME ?? "School"}</span>
          </div>
          <div className="ac-c">
            <div className="ac-sr" style={{ borderTop: 0, paddingBottom: 4 }}><span className="sech">#</span><span className="sech">Cheque</span><span className="sech c3">Drawn on</span><span className="sech" style={{ textAlign: "right" }}>Amount</span></div>
            {chosen.map((d, i) => (
              <div key={d.receiptId} className="ac-sr" style={{ animation: "xIn .3s var(--ease) both", animationDelay: delay(i) }}>
                <span className="num ac-m">{i + 1}</span>
                <span className="ac-c"><span className="num" style={{ fontWeight: 700 }}>{d.chequeNo ?? "no. not written"}</span><span className="ac-m ac-e">{d.studentName} · {d.receiptNumber}</span></span>
                <span className="c3 ac-m ac-e">{d.bank ?? "—"}</span>
                <span className="num" style={{ textAlign: "right", fontWeight: 700 }}>{rupees(d.amount)}</span>
              </div>
            ))}
            <div className="ac-f ac-j" style={{ padding: "10px 0 2px", borderTop: "2px solid var(--bd)" }}><span className="ac-b" style={{ fontWeight: 700 }}>Total · {chosen.length} cheques</span><span className="num" style={{ fontSize: 20, fontWeight: 700 }}>{rupees(total)}</span></div>
            <span style={{ fontSize: 12, color: "var(--mut)", fontStyle: "italic" }}>{amountInWords(total)}</span>
          </div>
          <div className="ac-f ac-j" style={{ paddingTop: 10, borderTop: "1.5px dashed var(--bds)", fontSize: 12, color: "var(--mut)" }}><span>Deposited by {staffName}</span><span>Signature ____________</span></div>
        </div>
        {chosen.some((c) => !c.chequeNo) ? <div className="ac-in" style={{ background: "var(--warns)", color: "var(--warnfg)" }}><Ic n="alert" size={18} /><span>Some cheques have no number written. Add the details from the list so the bank slip is complete.</span></div> : null}
        <div className="ac-in" style={{ background: "var(--infos)", color: "var(--info)" }}><Ic n="info" size={18} /><span>Print two copies. After the bank stamps the slip, tap <b>Mark as deposited</b>. Cheques usually clear in 2–3 working days.</span></div>
      </Stack>
    </Sheet>
  );
}

function BounceSheet({ open, onClose, cheque, deposited, pick, canAct, busy, run }: { open: boolean; onClose: () => void; cheque: ChequeRow | null; deposited: ChequeRow[]; pick: (id: string) => void; canAct: boolean; busy: boolean; run: (fn: () => Promise<Result>, after?: () => void) => void }) {
  const [reason, setReason] = useState(BOUNCE_REASONS[0]);
  const [note, setNote] = useState("");
  const [tell, setTell] = useState(true);
  const hi = cheque ? `नमस्ते, ${cheque.studentName} की फीस का चेक ${cheque.chequeNo ?? ""} (${rupees(cheque.amount)}) बैंक से लौट आया है — कारण: ${reason}. कृपया स्कूल आकर फीस जमा करें।` : "";
  const en = cheque ? `Hello, the cheque ${cheque.chequeNo ?? ""} for ${cheque.studentName}'s fee (${rupees(cheque.amount)}) was returned by the bank — ${reason}. Please pay the fee at the school office.` : "";
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Cheque bounced"
      sub={cheque ? `${cheque.chequeNo ?? cheque.receiptNumber} · ${cheque.studentName} · ${rupees(cheque.amount)}` : "Pick the cheque"}
      footer={<SheetFooter onCancel={onClose} onOk={() => cheque && run(() => bounceChequeAction({ receiptId: cheque.receiptId, reason, note }), onClose)} okLabel="Mark bounced · ask admin" okIcon="alert" danger disabled={!canAct || busy || !cheque} />}
    >
      <Stack>
        {!cheque || deposited.length > 1 ? (
          <Field label="Which cheque?">
            <Select value={cheque?.receiptId ?? ""} onChange={(e) => pick(e.target.value)}>
              <option value="">Pick a deposited cheque</option>
              {deposited.map((c) => (
                <option key={c.receiptId} value={c.receiptId}>{c.chequeNo ?? c.receiptNumber} · {c.studentName} · {rupees(c.amount)}</option>
              ))}
            </Select>
          </Field>
        ) : null}
        <span className="sech">What did the bank say?</span>
        {BOUNCE_REASONS.map((r) => <RadioCard key={r} checked={reason === r} onSelect={() => setReason(r)} title={r} />)}
        <Field label="Note (optional)"><Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="For example: bank charge ₹350 on the slip" /></Field>
        <div className="ac-in" style={{ flexDirection: "column", gap: 8, background: "var(--warns)", color: "var(--warnfg)" }}>
          <span style={{ fontWeight: 700 }}>What happens next</span>
          <span className="ac-f" style={{ alignItems: "flex-start", gap: 10 }}><Ic n="undo" size={16} /><span>The admin is asked to reverse {cheque?.receiptNumber ?? "the receipt"}. The receipt stays on record with a reversal row.</span></span>
          <span className="ac-f" style={{ alignItems: "flex-start", gap: 10 }}><Ic n="rupee" size={16} /><span>The fee goes back to pending for this family once reversed. Late fee stays separate.</span></span>
          <span className="ac-f" style={{ alignItems: "flex-start", gap: 10 }}><Ic n="phone" size={16} /><span>Call the family or send the message below from Dues &amp; calls.</span></span>
        </div>
        <button type="button" role="switch" aria-checked={tell} className="tap card ac-f" onClick={() => setTell(!tell)} style={{ padding: "12px 14px", gap: 12, textAlign: "left", color: "var(--fg)" }}>
          <Ic n="message" size={20} />
          <span className="ac-c ac-1"><span className="ac-b">Message for the parent</span><span className="ac-m">Copy it into WhatsApp · nothing is sent from here</span></span>
          <span className={`sw${tell ? " on" : ""}`}><span /></span>
        </button>
        {tell && cheque ? (
          <div className="ac-wa">
            <div>{hi}<span style={{ display: "block", marginTop: 8, paddingTop: 8, borderTop: "1px solid rgba(0,0,0,.08)", opacity: 0.85 }}>{en}</span></div>
            <button type="button" className="tap btn ghost ac-s" style={{ marginTop: 8 }} onClick={() => void navigator.clipboard?.writeText(`${hi}\n\n${en}`)}><Ic n="copy" size={15} />Copy message</button>
          </div>
        ) : null}
      </Stack>
    </Sheet>
  );
}

function UploadSheet({ open, onClose, canAct, busy, run }: { open: boolean; onClose: () => void; canAct: boolean; busy: boolean; run: (fn: () => Promise<Result>, after?: () => void) => void }) {
  const [text, setText] = useState("");
  const [bank, setBank] = useState("School account");
  const lines = text.split(/\r?\n/).filter((l) => l.trim()).length;
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="New bank statement"
      sub="UPI payments from the bank app, as CSV"
      footer={<SheetFooter onCancel={onClose} onOk={() => run(() => uploadStatementAction({ text, bankLabel: bank }), () => { setText(""); onClose(); })} okLabel={`Add ${lines || ""} payments`} okIcon="upload" disabled={!canAct || busy || lines === 0} />}
    >
      <Stack>
        <Field label="Choose the CSV file">
          <input
            type="file"
            accept=".csv,text/csv,text/plain"
            className="inp"
            onChange={async (e) => {
              const f = e.target.files?.[0];
              if (f) setText(await f.text());
            }}
          />
        </Field>
        <Field label="…or paste the lines" hint="One payment a line: date, amount, payer, UPI ref. For example 08/10/2026 10:41, 3150, RAKESH S, 427815093316">
          <Textarea value={text} onChange={(e) => setText(e.target.value)} rows={7} placeholder="Date, Amount, Payer, UPI ref" style={{ fontFamily: "var(--mono, monospace)", fontSize: 13 }} />
        </Field>
        <Field label="Account"><Input value={bank} onChange={(e) => setBank(e.target.value)} /></Field>
        <div className="ac-in" style={{ background: "var(--infos)", color: "var(--info)" }}><Ic n="info" size={18} /><span>A payment already uploaded (same UPI ref and amount) is skipped, so uploading the same file twice is safe.</span></div>
      </Stack>
    </Sheet>
  );
}

function RefundSheet({ open, onClose, data, canAct, busy, run }: { open: boolean; onClose: () => void; data: BooksData; canAct: boolean; busy: boolean; run: (fn: () => Promise<Result>, after?: () => void) => void }) {
  const [studentId, setStudentId] = useState(data.advances[0]?.studentId ?? "");
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState(REFUND_REASONS[0]);
  const [method, setMethod] = useState("bank_transfer");
  const [note, setNote] = useState("");
  const adv = data.advances.find((a) => a.studentId === studentId);
  const n = Number(amount.replace(/[^\d]/g, ""));
  const tooMuch = Boolean(adv && n > adv.credit);
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Ask to refund an advance"
      sub="The admin approves every refund"
      footer={<SheetFooter onCancel={onClose} onOk={() => run(() => requestRefundAction({ studentId, amount: n, reason, method, note }), () => { setAmount(""); setNote(""); onClose(); })} okLabel="Send to admin" okIcon="send" disabled={!canAct || busy || !adv || !n || tooMuch} />}
    >
      <Stack>
        <Field label="For which family?">
          <Select value={studentId} onChange={(e) => setStudentId(e.target.value)}>
            {data.advances.map((a) => (
              <option key={a.studentId} value={a.studentId}>{a.studentName} · {a.classLabel} · holds {rupees(a.credit)}</option>
            ))}
          </Select>
        </Field>
        <Field label="Amount to give back (₹)" error={tooMuch ? `Only ${rupees(adv?.credit)} is held for this family.` : undefined}>
          <Input inputMode="numeric" value={amount} invalid={tooMuch} onChange={(e) => setAmount(e.target.value)} placeholder={adv ? String(adv.credit) : ""} />
        </Field>
        <span className="sech">Why?</span>
        <div className="stack" style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0,1fr))", gap: 8 }}>
          {REFUND_REASONS.map((r) => <RadioCard key={r} checked={reason === r} onSelect={() => setReason(r)} title={r} />)}
        </div>
        <span className="sech">Pay back by</span>
        <div className="ac-f ac-w" style={{ gap: 6 }}>{METHODS.map((m) => <Chip key={m.value} on={method === m.value} onClick={() => setMethod(m.value)}>{m.label}</Chip>)}</div>
        <Field label="Note for the admin (optional)"><Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="For example: father asked on the phone, bank details are on file" style={{ minHeight: 64 }} /></Field>
        <div className="ac-in" style={{ background: "var(--warns)", color: "var(--warnfg)" }}><Ic n="info" size={18} /><span>{adv && n ? `After approval ${rupees(adv.credit - Math.min(n, adv.credit))} stays as advance for ${adv.studentName}.` : "Nothing moves until the admin approves."}</span></div>
      </Stack>
    </Sheet>
  );
}

function DetailsSheet({ cheque, onClose, canAct, busy, run }: { cheque: ChequeRow | null; onClose: () => void; canAct: boolean; busy: boolean; run: (fn: () => Promise<Result>, after?: () => void) => void }) {
  return cheque ? <DetailsForm key={cheque.receiptId} cheque={cheque} onClose={onClose} canAct={canAct} busy={busy} run={run} /> : null;
}

function DetailsForm({ cheque, onClose, canAct, busy, run }: { cheque: ChequeRow; onClose: () => void; canAct: boolean; busy: boolean; run: (fn: () => Promise<Result>, after?: () => void) => void }) {
  const [no, setNo] = useState(cheque.chequeNo ?? cheque.reference?.replace(/\D/g, "").slice(0, 12) ?? "");
  const [bank, setBank] = useState(cheque.bank ?? "");
  const [date, setDate] = useState(cheque.chequeDate ?? cheque.paymentDate);
  return (
    <Sheet
      open
      onClose={onClose}
      title="Cheque details"
      sub={`${cheque.receiptNumber} · ${cheque.studentName} · ${rupees(cheque.amount)}`}
      footer={<SheetFooter onCancel={onClose} onOk={() => run(() => saveChequeDetailsAction({ receiptId: cheque.receiptId, chequeNo: no, bank, chequeDate: date }), onClose)} okLabel="Save details" okIcon="check" disabled={!canAct || busy} />}
    >
      <Stack>
        <Field label="Cheque number"><Input inputMode="numeric" value={no} onChange={(e) => setNo(e.target.value)} /></Field>
        <Field label="Bank and branch"><Input value={bank} onChange={(e) => setBank(e.target.value)} placeholder="For example: SBI Amet" /></Field>
        <Field label="Date on the cheque"><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
      </Stack>
    </Sheet>
  );
}

function MatchSheet({ line, onClose, canAct, busy, run }: { line: UpiLineRow | null; onClose: () => void; canAct: boolean; busy: boolean; run: (fn: () => Promise<Result>, after?: () => void) => void }) {
  return line ? <MatchForm key={line.id} line={line} onClose={onClose} canAct={canAct} busy={busy} run={run} /> : null;
}

function MatchForm({ line, onClose, canAct, busy, run }: { line: UpiLineRow; onClose: () => void; canAct: boolean; busy: boolean; run: (fn: () => Promise<Result>, after?: () => void) => void }) {
  const [pick, setPick] = useState(line.suggestions[0]?.id ?? "");
  return (
    <Sheet
      open
      onClose={onClose}
      title="Match with a receipt"
      sub={`${line.payer} · ${rupees(line.amount)} · ${shortDay(line.txnAt)}`}
      footer={<SheetFooter onCancel={onClose} onOk={() => run(() => matchUpiAction(line.id, pick), onClose)} okLabel="Match" okIcon="link" disabled={!canAct || busy || !pick} />}
    >
      <Stack gap={8}>
        <span className="sech">Receipts for the same amount</span>
        {line.suggestions.map((s) => (
          <RadioCard
            key={s.id}
            checked={pick === s.id}
            onSelect={() => setPick(s.id)}
            title={`${s.studentName}${s.classLabel ? ` · ${s.classLabel}` : ""}`}
            sub={`${s.receiptNumber} · ${shortDay(s.paymentDate)}${s.referenceNumber ? ` · ref ${s.referenceNumber}` : ""}`}
            trail={<span className="ac-c" style={{ alignItems: "flex-end" }}><span className="num ac-v">{rupees(s.amount)}</span><Pill tone={s.why === "ref" ? "ok" : s.why === "amount_day" ? "info" : "mut"}>{s.why === "ref" ? "Same UPI ref" : s.why === "amount_day" ? "Same amount, near day" : "Same amount"}</Pill></span>}
          />
        ))}
        <div className="ac-in" style={{ background: "var(--accs)", color: "var(--accfg)" }}><Ic n="info" size={18} /><span>One UPI payment is one receipt. A receipt already matched to another payment is not offered.</span></div>
      </Stack>
    </Sheet>
  );
}

function DecideSheet({ request, onClose, busy, run }: { request: AccRequestRow | null; onClose: () => void; busy: boolean; run: (fn: () => Promise<Result>, after?: () => void) => void }) {
  return request ? <DecideForm key={request.id} request={request} onClose={onClose} busy={busy} run={run} /> : null;
}

function DecideForm({ request, onClose, busy, run }: { request: AccRequestRow; onClose: () => void; busy: boolean; run: (fn: () => Promise<Result>, after?: () => void) => void }) {
  const [note, setNote] = useState("");
  const next =
    request.kind === "reversal"
      ? { text: "After approving, reverse the receipt in Receipts (a reversal row; the receipt is kept).", href: "/receipts" }
      : request.kind === "refund"
        ? { text: "After approving, write and process the refund in Finance controls.", href: "/fees/finance-controls" }
        : request.kind === "late_fee_waiver"
          ? { text: "After approving, waive the late fee at the Payment Desk with this reason.", href: request.studentId ? `/payments?student=${request.studentId}` : "/payments" }
          : { text: "After approving, make the change in Fee setup and publish it.", href: "/fee-setup" };
  return (
    <Sheet
      open
      onClose={onClose}
      title={KIND_LABEL[request.kind] ?? "Request"}
      sub={`${request.title}${request.studentName ? ` · ${request.studentName}` : ""}`}
      footer={
        <>
          <button type="button" className="tap btn sec" style={{ flex: 1, height: 48, color: "var(--bad)" }} disabled={busy} onClick={() => run(() => decideRequestAction(request.id, "declined", note), onClose)}>Decline</button>
          <button type="button" className="tap btn pri" style={{ flex: 1.6, height: 48 }} disabled={busy} onClick={() => run(() => decideRequestAction(request.id, "approved", note), onClose)}><Ic n="check" size={18} />Approve</button>
        </>
      }
    >
      <Stack>
        <div className="ac-in" style={{ background: "var(--s2)", color: "var(--fg)" }}><span><b>{request.requestedByName}</b> asked {ago(request.requestedAt)}: {request.reason}{request.amount !== null ? ` · ${rupees(request.amount)}` : ""}</span></div>
        <Field label="Note (needed to decline)"><Textarea value={note} onChange={(e) => setNote(e.target.value)} style={{ minHeight: 64 }} /></Field>
        <div className="ac-in" style={{ background: "var(--infos)", color: "var(--info)" }}><Ic n="info" size={18} /><span>{next.text} <a href={next.href} style={{ color: "inherit", fontWeight: 700 }}>Open</a></span></div>
        <span className="ac-m">Approving records your decision. Money moves only through the fee screens, as reversal or refund rows.</span>
      </Stack>
    </Sheet>
  );
}
