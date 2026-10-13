"use client";

import "./accounts.css";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition, type CSSProperties, type ReactNode } from "react";

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
import { chequeDetailsDraft } from "@/modules/finance-controls/vx/domain/cheque-receipt";
import { nextSlipNumber } from "@/modules/finance-controls/vx/domain/books";
import { ago, amountInWords, initials, rupees } from "@/vx/format";
import { useVx } from "@/vx/i18n";
import { Ic, type IconName } from "@/vx/icons";
import { p } from "@/vx/text";
import { Card, Pill } from "@/vx/ui/primitives";
import { Chip, Field, Input, RadioCard, Seg, Select, Textarea } from "@/vx/ui/controls";
import { HelpButton, Sheet, useToast } from "@/vx/ui/overlays";
import { Section, TopBar, VxPage } from "@/vx/ui/page";

import { day, schoolDay, time12 } from "./when";

export type BooksView = "cheques" | "upi" | "refunds" | "requests";
export type BooksSheet = "" | "deposit" | "bounce" | "upload" | "refund";

type ChequeTab = "to_deposit" | "deposited" | "cleared" | "bounced";

const delay = (i: number) => `${Math.min(i, 14) * 28}ms`;
const len = (n: number) => ({ "--len": n }) as CSSProperties;
/** The design's four answers; `value` is what `bounceChequeAction` accepts (anything else goes as "Other" with the bank's words). */
const BOUNCE_REASONS = [
  { label: "Not enough money in the account", value: "Not enough money" },
  { label: "Signature does not match", value: "Signature does not match" },
  { label: "Account closed", value: "Account closed" },
  { label: "Some other reason", value: "Other" },
];
const REFUND_REASONS = ["Paid twice", "Left the school", "Paid more than the fee", "Fee changed", "Other"];
const METHODS = [
  { value: "cash", label: "Cash" },
  { value: "upi", label: "UPI" },
  { value: "bank_transfer", label: "Bank transfer" },
  { value: "cheque", label: "Cheque" },
];
const KIND_LABEL: Record<string, string> = { late_fee_waiver: "Late-fee waiver", reversal: "Reversal", refund: "Refund", fee_change: "Fee change", other: "Request" };
const KIND_ICON: Record<string, IconName> = { late_fee_waiver: "percent", reversal: "undo", refund: "swap", fee_change: "sliders", other: "inbox" };
const ACW: Record<ChequeTab, string> = { to_deposit: "180px", deposited: "310px", cleared: "150px", bounced: "310px" };

type Result = { ok: boolean; message: string };
type Run = (fn: () => Promise<Result>, after?: () => void) => void;

/** A cheque dated after today waits for its date before it can go to the bank. */
const postDated = (c: ChequeRow, today: string) => Boolean(c.chequeDate && c.chequeDate > today);
const waitingForBank = (c: ChequeRow) => !c.reversed && (c.status === "to_deposit" || c.status === "in_bag");
/** The register reads by family: the father's name, then the child and class. */
const family = (c: { studentName: string; fatherName?: string | null; classLabel: string }) =>
  c.fatherName ? { title: c.fatherName, sub: [c.studentName.split(" ")[0], c.classLabel].filter(Boolean).join(" · ") } : { title: c.studentName, sub: c.classLabel };
/** "Today 10:04 am", or "Wed 7 Oct · 7:58 pm". */
const stamp = (iso: string, today: string) => (schoolDay(iso) === today ? `Today ${time12(iso)}` : `${day(iso)} · ${time12(iso)}`);
/** "08/10/2026", as a bank's pay-in slip writes it. */
const slipDate = (date: string) => date.split("-").reverse().join("/");

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
  const canAct = data.canWrite && !readOnly;
  const toDeposit = data.cheques.filter(waitingForBank);
  const ready = toDeposit.filter((c) => !postDated(c, data.today));
  const [view, setView] = useState<BooksView>(initialView);
  const [sheet, setSheet] = useState<BooksSheet>(initialSheet);
  const [tab, setTab] = useState<ChequeTab>(initialSheet === "bounce" ? "deposited" : "to_deposit");
  // Nothing is ticked until the accountant ticks it (or the evening checklist's link names the cheques in the bag):
  // "Mark as deposited" writes every ticked cheque, so it only ever writes what someone chose.
  const [picked, setPicked] = useState<string[]>(() => initialPick.filter((id) => ready.some((c) => c.receiptId === id)));
  const [bounceFor, setBounceFor] = useState<string | null>(initialSheet === "bounce" ? (initialReceipt ?? data.cheques.find((c) => c.status === "deposited")?.receiptId ?? null) : null);
  const [refundFor, setRefundFor] = useState<string | null>(null);
  const [detailsFor, setDetailsFor] = useState<ChequeRow | null>(null);
  const [matchFor, setMatchFor] = useState<UpiLineRow | null>(null);
  const [decideFor, setDecideFor] = useState<AccRequestRow | null>(null);

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

  const run: Run = (fn, after) =>
    start(async () => {
      const r = await fn();
      toast.show({ text: r.message, tone: r.ok ? "ok" : "bad" });
      if (r.ok) {
        after?.();
        router.refresh();
      }
    });

  const pickedRows = ready.filter((c) => picked.includes(c.receiptId));
  const pickedTotal = pickedRows.reduce((s, c) => s + c.amount, 0);
  const openDeposit = () => {
    if (pickedRows.length === 0) {
      toast.show({ text: ready.length ? "Tick the cheques you are taking to the bank" : "No cheques are ready to deposit", tone: "info" });
      return;
    }
    openSheet("deposit");
  };
  const openRefund = (studentId: string | null) => {
    setRefundFor(studentId);
    openSheet("refund");
  };

  const upiTotal = data.upiLines.length;
  const upiOpen = data.upiLines.filter((l) => l.state === "open");
  const upiDone = upiTotal - upiOpen.length;
  const myWaiting = data.requests.filter((r) => r.status === "waiting" && (r.mine || data.canDecide));
  const weekAgo = new Date(Date.parse(`${data.today}T00:00:00Z`) - 6 * 86_400_000).toISOString().slice(0, 10);
  const decidedThisWeek = data.requests.filter((r) => r.decidedAt && schoolDay(r.decidedAt) >= weekAgo).length;
  const advTotal = data.advances.reduce((s, a) => s + a.credit, 0);
  const refundsWaiting = data.requests.filter((r) => r.kind === "refund" && r.status === "waiting").length;
  const requestsLabel = data.canDecide ? "Requests" : "My requests";

  const kpis: { key: BooksView; icon: IconName; label: string; value: string; sub: string; tone: [string, string] }[] = [
    { key: "cheques", icon: "file", label: tx(p("Cheques to deposit", "जमा करने के चेक")), value: rupees(toDeposit.reduce((s, c) => s + c.amount, 0)), sub: `${toDeposit.length} cheques · ${ready.length} ready today`, tone: ["var(--warns)", "var(--warnfg)"] },
    { key: "upi", icon: "zap", label: tx(p("UPI matched", "UPI मिलान")), value: upiTotal ? `${upiDone} of ${upiTotal}` : "No statement", sub: upiTotal ? (upiOpen.length ? `${upiOpen.length} need you` : "All matched") : "Upload the bank’s statement", tone: ["var(--oks)", "var(--ok)"] },
    { key: "refunds", icon: "swap", label: tx(p("Advances held", "अग्रिम राशि")), value: rupees(advTotal), sub: `${data.advances.length} families${refundsWaiting ? ` · ${refundsWaiting} refund waiting` : ""}`, tone: ["var(--accs)", "var(--accfg)"] },
    { key: "requests", icon: "inbox", label: tx(p(requestsLabel, data.canDecide ? "अनुरोध" : "मेरे अनुरोध")), value: `${myWaiting.length} waiting`, sub: `${decidedThisWeek} decided this week`, tone: ["var(--infos)", "var(--info)"] },
  ];

  const top = {
    cheques: { crumb: "Cheques", mSub: `${toDeposit.length} to deposit · ${rupees(toDeposit.reduce((s, c) => s + c.amount, 0))}`, label: "Make a deposit slip", mLabel: "Slip", icon: "file" as IconName, variant: "pri", act: openDeposit, dim: pickedRows.length === 0 },
    upi: { crumb: "UPI matching", mSub: upiTotal ? `${upiDone} of ${upiTotal} matched` : "No bank statement yet", label: "Upload bank statement", mLabel: "Upload", icon: "upload" as IconName, variant: "sec", act: () => openSheet("upload"), dim: false },
    refunds: { crumb: "Refunds & advances", mSub: `${rupees(advTotal)} held for ${data.advances.length} families`, label: "Request refund", mLabel: "Refund", icon: "swap" as IconName, variant: "pri", act: () => openRefund(null), dim: data.advances.length === 0 },
    requests: { crumb: requestsLabel, mSub: `${myWaiting.length} waiting for the admin`, label: "", mLabel: "", icon: "inbox" as IconName, variant: "sec", act: () => undefined, dim: false },
  }[view];
  const hasAction = Boolean(top.label) && canAct;

  const help = [
    { icon: "file" as IconName, title: "Cheques", body: "Tick the cheques you take to the bank and print the deposit slip. Mark each one cleared or bounced when the bank says so." },
    { icon: "zap" as IconName, title: "UPI", body: "Upload the bank statement. Each payment is matched to its receipt; anything left over needs a look." },
    { icon: "shield" as IconName, title: "Refunds and reversals", body: "Only the admin approves money going back. You ask here and watch the status in My requests." },
  ];

  return (
    <VxPage className="ac-page ac-books">
      <TopBar
        crumb={`Money · ${day(data.today)} · ${top.crumb}`}
        title={tx(p("Cheques, UPI & refunds", "चेक, UPI व रिफंड"))}
        mTitle={top.crumb}
        mSub={top.mSub}
        mBack="/accounts?view=menu"
        actions={
          <>
            <HelpButton title="Cheques, UPI & refunds" steps={help} />
            {hasAction ? (
              <button type="button" className={`tap btn ${top.variant}`} onClick={top.act} style={{ opacity: top.dim ? 0.5 : 1 }}>
                <Ic n={top.icon} />
                {top.label}
              </button>
            ) : null}
          </>
        }
        mAction={
          <span className="ac-f" style={{ gap: 4 }}>
            <HelpButton title="Cheques, UPI & refunds" steps={help} style={{ width: 44, height: 44, borderRadius: 22 }} />
            {hasAction ? (
              <button type="button" className="tap btn soft" onClick={top.act} style={{ height: 40, padding: "0 12px", fontSize: 13, opacity: top.dim ? 0.5 : 1 }}>
                <Ic n={top.icon} size={16} />
                {top.mLabel}
              </button>
            ) : null}
          </span>
        }
      />
      <Section>
        {readOnly ? <Pill tone="info" icon="eye">Preview · read only</Pill> : null}
        <div className="ac-kp" role="tablist" aria-label="Sections">
          {kpis.map((k, i) => (
            <button key={k.key} type="button" role="tab" aria-selected={view === k.key} className="tap card" onClick={() => go(k.key)} style={{ borderColor: view === k.key ? "var(--acc)" : undefined, boxShadow: view === k.key ? "0 0 0 1px var(--acc), var(--sh)" : undefined, animationDelay: delay(i) }}>
              <span className="ac-ib" style={{ background: k.tone[0], color: k.tone[1] }}><Ic n={k.icon} /></span>
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
            onDeposit={openDeposit}
            onBounce={(id) => {
              setBounceFor(id);
              openSheet("bounce");
            }}
            onCleared={(id) => run(() => markClearedAction([id]))}
            onDetails={setDetailsFor}
            onRequests={() => go("requests")}
            onPostDated={(c) => toast.show({ text: `Cheque ${c.chequeNo ?? c.receiptNumber} is dated ${day(c.chequeDate ?? c.paymentDate)}. It can go to the bank from that day.`, tone: "info" })}
          />
        ) : null}
        {view === "upi" ? <UpiPane data={data} canAct={canAct} busy={busy} onUpload={() => openSheet("upload")} onMatch={setMatchFor} onUndo={(id) => run(() => unmatchUpiAction(id))} onNotFee={(id) => run(() => notFeeUpiAction(id))} /> : null}
        {view === "refunds" ? <RefundsPane data={data} canAct={canAct} onRequest={openRefund} onSeeRequests={() => go("requests")} /> : null}
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

      <DepositSheet open={sheet === "deposit"} onClose={closeSheet} data={data} chosen={pickedRows} total={pickedTotal} clearPicked={() => setPicked([])} staffName={staffName} canAct={canAct} busy={busy} run={run} />
      <BounceSheet open={sheet === "bounce"} onClose={closeSheet} cheque={data.cheques.find((c) => c.receiptId === bounceFor) ?? null} deposited={data.cheques.filter((c) => c.status === "deposited")} pick={setBounceFor} canAct={canAct} busy={busy} run={run} />
      <UploadSheet open={sheet === "upload"} onClose={closeSheet} canAct={canAct} busy={busy} run={run} />
      <RefundSheet key={refundFor ?? "first"} open={sheet === "refund"} onClose={closeSheet} data={data} studentId={refundFor} canAct={canAct} busy={busy} run={run} />
      <DetailsSheet cheque={detailsFor} onClose={() => setDetailsFor(null)} canAct={canAct} busy={busy} run={run} />
      <MatchSheet line={matchFor} onClose={() => setMatchFor(null)} canAct={canAct} busy={busy} run={run} />
      <DecideSheet request={decideFor} onClose={() => setDecideFor(null)} busy={busy} run={run} />
    </VxPage>
  );
}

function statusLook(c: ChequeRow, today: string): { label: string; bg: string; fg: string; icon: IconName } {
  if (c.reversed && c.status !== "bounced") return { label: "Receipt reversed", bg: "var(--s3)", fg: "var(--mut)", icon: "undo" };
  switch (c.status) {
    case "deposited":
      return { label: "In clearing", bg: "var(--infos)", fg: "var(--info)", icon: "clock" };
    case "cleared":
      return { label: `Cleared${c.statusAt ? ` ${day(c.statusAt)}` : ""}`, bg: "var(--oks)", fg: "var(--ok)", icon: "check" };
    case "bounced":
      return c.reversed ? { label: "Reversed", bg: "var(--bads)", fg: "var(--bad)", icon: "alert" } : { label: "Bounced · waiting for admin", bg: "var(--bads)", fg: "var(--bad)", icon: "alert" };
    default:
      return postDated(c, today) ? { label: `Dated ${day(c.chequeDate as string)} · wait`, bg: "var(--warns)", fg: "var(--warnfg)", icon: "file" } : { label: "Ready", bg: "var(--oks)", fg: "var(--ok)", icon: "file" };
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
  onRequests,
  onPostDated,
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
  onRequests: () => void;
  onPostDated: (c: ChequeRow) => void;
}) {
  const inTab = (c: ChequeRow, t: ChequeTab) => (t === "to_deposit" ? waitingForBank(c) : c.status === t);
  const rows = data.cheques.filter((c) => inTab(c, tab));
  const count = (t: ChequeTab) => data.cheques.filter((c) => inTab(c, t)).length;
  const lastSlip = data.slips[0];
  const hint =
    tab === "to_deposit"
      ? "Tick the cheques going to the bank. A post-dated cheque waits for its date."
      : tab === "deposited"
        ? `${lastSlip ? `Slip ${lastSlip.slipNo} went to the bank on ${day(lastSlip.depositedOn)}. ` : ""}Cheques clear in 2–3 working days.`
        : tab === "cleared"
          ? "Cleared cheques. The money is in the school account."
          : "A bounced cheque is reversed only after the admin approves.";
  const pickedRows = data.cheques.filter((c) => picked.includes(c.receiptId) && waitingForBank(c) && !postDated(c, data.today));
  const toggle = (c: ChequeRow) => {
    if (postDated(c, data.today)) return onPostDated(c);
    setPicked(picked.includes(c.receiptId) ? picked.filter((x) => x !== c.receiptId) : [...picked, c.receiptId]);
  };
  const empty =
    tab === "to_deposit"
      ? { title: "No cheques waiting for the bank", sub: "Cheque receipts from the Payment Desk show up here." }
      : tab === "deposited"
        ? { title: "Nothing waiting at the bank", sub: "Every deposited cheque has cleared or bounced." }
        : { title: "Nothing here", sub: "Cheques show up here as their status changes." };
  const seg = (label: string, t: ChequeTab) => <>{label} <span className="num" style={{ fontWeight: 600, color: "var(--sub)" }}>{count(t)}</span></>;
  return (
    <div className="ac-c" style={{ gap: 12, animation: "xIn .32s var(--ease) both" }}>
      <div className="ac-f ac-w" style={{ gap: 10 }}>
        <div className="mfull ac-seg ac-seg-tight" style={{ width: 520, maxWidth: "100%" }}>
          <Seg<ChequeTab>
            label="Cheque status"
            value={tab}
            onChange={setTab}
            style={{ width: "100%" }}
            options={[
              { value: "to_deposit", label: seg("To deposit", "to_deposit") },
              { value: "deposited", label: seg("Deposited", "deposited") },
              { value: "cleared", label: seg("Cleared", "cleared") },
              { value: "bounced", label: seg("Bounced", "bounced") },
            ]}
          />
        </div>
        <span className="ac-m" style={{ flex: 1, minWidth: 220 }}>{hint}</span>
      </div>
      {rows.length ? (
        <Card pad={false} className="ac-ctb" style={{ overflow: "hidden", ["--aw" as string]: ACW[tab] } as CSSProperties}>
          <div className="ac-cth">
            <span />
            <span className="sech">Cheque</span>
            <span className="sech">Family</span>
            <span className="sech">Bank</span>
            <span className="sech">Dated</span>
            <span className="sech">Receipt</span>
            <span className="sech" style={{ textAlign: "right" }}>Amount</span>
            <span className="sech" style={{ textAlign: "right" }}>Status</span>
          </div>
          {rows.map((r, i) => {
            const look = statusLook(r, data.today);
            const late = postDated(r, data.today);
            const sel = picked.includes(r.receiptId) && !late;
            const selectable = tab === "to_deposit" && canAct;
            const who = family(r);
            const dated = day(r.chequeDate ?? r.paymentDate);
            return (
              <div key={r.receiptId} className="row ac-ct" style={{ animationDelay: delay(i) }}>
                {selectable ? (
                  <button type="button" className="tap ac-cb c-cb" role="checkbox" aria-checked={sel} aria-label={`Select cheque ${r.chequeNo ?? r.receiptNumber}`} onClick={() => toggle(r)}>
                    <span style={{ background: sel ? "var(--pri)" : "var(--card)", borderColor: late ? "var(--warn)" : sel ? "var(--pri)" : "var(--bds)", borderStyle: late ? "dashed" : "solid" }}>
                      <Ic n="check" size={14} stroke={3} style={{ opacity: sel ? 1 : 0, transform: `scale(${sel ? 1 : 0})` }} />
                    </span>
                  </button>
                ) : (
                  <span className="c-cb ac-f" style={{ justifyContent: "center", width: 40, height: 40 }}>
                    <span className="ac-ib" style={{ width: 30, height: 30, borderRadius: 10, background: tab === "to_deposit" ? "var(--s2)" : look.bg, color: tab === "to_deposit" ? "var(--mut)" : look.fg }}><Ic n={look.icon} size={16} /></span>
                  </span>
                )}
                <span className="num c-no" style={{ fontSize: 13, fontWeight: 700 }}>{r.chequeNo ?? "—"}</span>
                <span className="ac-c c-fam">
                  <span className="ac-b ac-e">{who.title}</span>
                  <span className="ac-m ac-e">{who.sub}</span>
                  <span className="ac-m ac-e num only-m">{[r.chequeNo ? `Cheque ${r.chequeNo}` : "No cheque no. yet", r.bank ?? "bank not written", r.receiptNumber, r.slipNo ? `slip ${r.slipNo}` : null].filter(Boolean).join(" · ")}</span>
                </span>
                <span className="ac-m ac-e c-bank" style={{ fontSize: 13 }}>{r.bank ?? "—"}</span>
                <span className="num c-dt" style={{ fontSize: 13 }}>{dated}</span>
                <span className="num ac-m ac-e c-rec" style={{ fontSize: 13 }} title={r.receiptNumber}>{r.receiptNumber}</span>
                <span className="c-amt">
                  <span className="num ac-v">{rupees(r.amount)}</span>
                  <span className="num ac-m only-m">{dated}</span>
                </span>
                <span className="c-act">
                  <span className="pill" style={{ height: 24, background: look.bg, color: look.fg }}>{look.label}</span>
                  {canAct && !r.chequeNo && r.status !== "cleared" ? <button type="button" className="tap btn ghost ac-s" onClick={() => onDetails(r)}><Ic n="edit" size={16} />Add details</button> : null}
                  {canAct && r.status === "deposited" && !r.reversed ? (
                    <>
                      <button type="button" className="tap btn soft ac-s" disabled={busy} onClick={() => onCleared(r.receiptId)}><Ic n="check" size={16} />Cleared</button>
                      <button type="button" className="tap btn ghost ac-s" style={{ color: "var(--bad)" }} onClick={() => onBounce(r.receiptId)}><Ic n="alert" size={16} />Bounced</button>
                    </>
                  ) : null}
                  {r.status === "bounced" && !r.reversed ? <button type="button" className="tap btn ghost ac-s" style={{ color: "var(--acc)" }} onClick={onRequests}><Ic n="chevRight" size={16} />See request</button> : null}
                </span>
              </div>
            );
          })}
        </Card>
      ) : (
        <Card className="ac-c" style={{ padding: "34px 24px", alignItems: "center", gap: 10, textAlign: "center", animation: "xIn .32s var(--ease) both" }}>
          <span className="ac-ib" style={{ width: 56, height: 56, borderRadius: 28, background: "var(--oks)", color: "var(--ok)", animation: "xPopIn .5s var(--spring) both" }}><Ic n="check" size={26} /></span>
          <span style={{ fontSize: 16, fontWeight: 700 }}>{empty.title}</span>
          <span className="ac-m" style={{ fontSize: 13 }}>{empty.sub}</span>
          {tab !== "to_deposit" ? <button type="button" className="tap btn sec" onClick={() => setTab("to_deposit")}>See cheques to deposit</button> : null}
        </Card>
      )}
      {pickedRows.length > 0 && tab === "to_deposit" ? (
        <div className="glass ac-f ac-cheque-selection" style={{ position: "sticky", zIndex: 4, flexWrap: "wrap", padding: "10px 12px", borderRadius: 18, border: "1px solid var(--bds)", boxShadow: "var(--shh)", animation: "xToast .32s var(--spring) both" }}>
          <span className="ac-c" style={{ paddingLeft: 4, marginRight: "auto" }}>
            <span className="ac-b" style={{ fontWeight: 700 }}>{pickedRows.length} {pickedRows.length === 1 ? "cheque" : "cheques"} · {rupees(pickedRows.reduce((s, c) => s + c.amount, 0))}</span>
            <span className="ac-m">{lastSlip?.bankLabel ?? "Ready for one deposit slip"}</span>
          </span>
          <button type="button" className="tap btn ghost" onClick={() => setPicked([])}>Clear</button>
          <button type="button" className="tap btn pri mfull" onClick={onDeposit} style={{ height: 48 }}>
            <Ic n="file" />
            Make a deposit slip ({pickedRows.length} · {rupees(pickedRows.reduce((s, c) => s + c.amount, 0))})
          </button>
        </div>
      ) : null}
    </div>
  );
}

function UpiPane({ data, canAct, busy, onUpload, onMatch, onUndo, onNotFee }: { data: BooksData; canAct: boolean; busy: boolean; onUpload: () => void; onMatch: (l: UpiLineRow) => void; onUndo: (id: string) => void; onNotFee: (id: string) => void }) {
  const [filter, setFilter] = useState<"all" | "open" | "matched">("all");
  const total = data.upiLines.length;
  const open = data.upiLines.filter((l) => l.state === "open");
  const done = total - open.length;
  const pct = total ? done / total : 0;
  // What needs a look comes first.
  const sorted = [...open, ...data.upiLines.filter((l) => l.state !== "open")];
  const rows = sorted.filter((l) => (filter === "all" ? true : filter === "open" ? l.state === "open" : l.state !== "open"));
  const days = data.upiLines.map((l) => schoolDay(l.txnAt)).sort();
  const range = days.length ? (days[0] === days.at(-1) ? day(days[0]) : `${day(days[0])} – ${day(days.at(-1) as string)}`) : "";
  const allSorted = total > 0 && done === total;
  const why = (w: "ref" | "amount_day" | "amount") => (w === "ref" ? "same UPI ref" : w === "amount_day" ? "same amount, near the day" : "same amount");
  return (
    <div className="ac-c" style={{ gap: 12, animation: "xIn .32s var(--ease) both" }}>
      <Card className="ac-f" style={{ padding: "16px 18px", gap: 16, flexWrap: "wrap" }}>
        <svg width="64" height="64" viewBox="0 0 64 64" aria-hidden="true" style={{ flex: "none" }}>
          <circle cx="32" cy="32" r="26" style={{ fill: "none", stroke: "var(--s3)", strokeWidth: 7 }} />
          <circle cx="32" cy="32" r="26" transform="rotate(-90 32 32)" style={{ fill: "none", stroke: "var(--ok)", strokeWidth: 7, strokeLinecap: "round", strokeDasharray: `${(163.4 * pct).toFixed(1)} 163.4`, ...len(163.4), animation: "xDraw .9s .1s var(--ease) both", transition: "stroke-dasharray .6s var(--ease)" }} />
        </svg>
        <span className="ac-c" style={{ flex: 1, minWidth: 200, gap: 4 }}>
          <span className="serif" style={{ fontSize: 22, fontWeight: 600 }}>{total ? `${done} of ${total} matched` : "No bank statement yet"}</span>
          <span className="ac-m" style={{ fontSize: 13 }}>{total ? `Bank statement for ${range}${data.upiReceiptsUnmatched ? ` · ${data.upiReceiptsUnmatched} UPI receipts not yet seen in the bank` : ""}` : "Upload the bank’s UPI statement (CSV) to match it with receipts."}</span>
          <span style={{ display: "block", height: 8, borderRadius: 4, background: "var(--s3)", overflow: "hidden", marginTop: 4 }}><span style={{ display: "block", height: 8, borderRadius: 4, width: `${(pct * 100).toFixed(0)}%`, background: "var(--ok)", transition: "width .5s var(--ease)" }} /></span>
        </span>
        {canAct ? <button type="button" className="tap btn sec" onClick={onUpload}><Ic n="upload" />New statement</button> : null}
      </Card>
      {allSorted ? (
        <Card className="ac-f" style={{ padding: "16px 18px", gap: 14, background: data.upiReceiptsUnmatched > 0 ? "var(--warns)" : "var(--oks)", borderColor: data.upiReceiptsUnmatched > 0 ? "var(--warnm)" : "var(--okm)", animation: "xIn .4s var(--ease) both" }}>
          {data.upiReceiptsUnmatched > 0 ? (
            <Ic n="alert" size={32} style={{ color: "var(--warn)" }} />
          ) : (
            <svg width="52" height="52" viewBox="0 0 96 96" aria-hidden="true" style={{ flex: "none", animation: "xPopIn .5s var(--spring) both" }}>
              <circle cx="48" cy="48" r="44" style={{ fill: "var(--card)" }} />
              <circle cx="48" cy="48" r="44" style={{ fill: "none", stroke: "var(--ok)", strokeWidth: 5, ...len(276.5), strokeDasharray: 276.5, animation: "xDraw .7s .1s var(--ease) both" }} />
              <path d="M30 49l12 12 24-26" style={{ fill: "none", stroke: "var(--ok)", strokeWidth: 7, strokeLinecap: "round", strokeLinejoin: "round", ...len(60), strokeDasharray: 60, animation: "xDraw .45s .5s var(--ease) both" }} />
            </svg>
          )}
          <span className="ac-c">
            {/* Not "every payment is sorted": the statement may not cover every UPI receipt, so the card says what was imported. */}
            <span className="ac-v" style={{ color: data.upiReceiptsUnmatched > 0 ? "var(--warn)" : "var(--ok)" }}>Imported bank payments are sorted</span>
            <span style={{ fontSize: 13, color: data.upiReceiptsUnmatched > 0 ? "var(--fg)" : "var(--ok)" }}>{data.upiReceiptsUnmatched > 0 ? `${data.upiReceiptsUnmatched} UPI ${data.upiReceiptsUnmatched === 1 ? "receipt still needs a bank match. Review it" : "receipts still need a bank match. Review them"} before confirming UPI at day close.` : `Every line of the statement for ${range} is matched or set aside. Review the statement coverage before confirming UPI at day close.`}</span>
          </span>
        </Card>
      ) : null}
      <div className="mfull" style={{ width: 420, maxWidth: "100%" }}>
        <Seg value={filter} onChange={setFilter} label="Show" style={{ width: "100%" }} options={[{ value: "all", label: `All ${total}` }, { value: "open", label: `Needs you · ${open.length}` }, { value: "matched", label: `Matched · ${done}` }]} />
      </div>
      <div className="ac-ur hide-m" style={{ animation: "none" }}><span className="sech">In the bank statement</span><span /><span className="sech">In VPPS One · receipts</span></div>
      {rows.map((r, i) => {
        const matched = r.state === "matched" && r.receipt;
        const notFee = r.state === "not_fee";
        const lineColor = matched ? "var(--ok)" : notFee ? "var(--sub)" : "var(--warn)";
        const best = r.suggestions[0];
        return (
          <div key={r.id} className="ac-ur" style={{ animationDelay: delay(i) }}>
            <div className="card" style={{ borderColor: r.state === "open" ? "var(--warnm)" : undefined }}>
              <span className="ac-ib" style={{ background: "var(--infos)", color: "var(--info)" }}><Ic n="zap" /></span>
              <span className="ac-c ac-1"><span className="ac-b ac-e">{r.payer}</span><span className="ac-m ac-e num">{stamp(r.txnAt, data.today)} · UPI ref ••{r.utr.slice(-4)}</span></span>
              <span className="num ac-v">{rupees(r.amount)}</span>
            </div>
            <div className={`ac-ul${r.state === "open" ? " dash" : ""}`} style={{ color: lineColor }} aria-hidden="true"><b><Ic n={matched ? "check" : notFee ? "minus" : "help"} size={14} stroke={3} /></b></div>
            {matched && r.receipt ? (
              <div className="card" style={{ background: "var(--card)" }}>
                <span className="ac-ib" style={{ background: "var(--oks)", color: "var(--ok)" }}><Ic n="receipt" /></span>
                <span className="ac-c ac-1"><span className="ac-b ac-e">{r.receipt.receiptNumber} · {r.receipt.studentName}</span><span className="ac-m ac-e">{[r.receipt.classLabel, "UPI"].filter(Boolean).join(" · ")}</span></span>
                <span className="ac-c" style={{ alignItems: "flex-end", gap: 4 }}><span className="num ac-v">{rupees(r.receipt.amount)}</span><Pill tone="ok">Matched</Pill></span>
                {canAct ? <button type="button" className="tap btn ghost" aria-label="Undo this match" disabled={busy} onClick={() => onUndo(r.id)} style={{ width: 34, height: 34, padding: 0 }}><Ic n="undo" size={16} /></button> : null}
              </div>
            ) : notFee ? (
              <div className="card" style={{ background: "var(--s2)" }}>
                <span className="ac-ib" style={{ background: "var(--s3)", color: "var(--mut)" }}><Ic n="minus" /></span>
                <span className="ac-c ac-1"><span className="ac-b">Not a fee payment</span><span className="ac-m">Kept out of fee totals</span></span>
                <span className="ac-c" style={{ alignItems: "flex-end", gap: 4 }}><span className="num ac-v">{rupees(r.amount)}</span><span className="pill" style={{ background: "var(--s3)", color: "var(--mut)" }}>Set aside</span></span>
                {canAct ? <button type="button" className="tap btn ghost" aria-label="Undo" disabled={busy} onClick={() => onUndo(r.id)} style={{ width: 34, height: 34, padding: 0 }}><Ic n="undo" size={16} /></button> : null}
              </div>
            ) : (
              <div className="card ac-c" style={{ alignItems: "stretch", gap: 8, borderColor: "var(--warnm)", background: "var(--warns)" }}>
                <span className="ac-b" style={{ color: "var(--warnfg)" }}>No receipt found for this payment</span>
                <span className="ac-m" style={{ color: "var(--warnfg)" }}>{best ? `Looks like ${best.receiptNumber} · ${best.studentName} · ${why(best.why)}.${r.suggestions.length > 1 ? ` ${r.suggestions.length - 1} more could be it.` : ""}` : "If the parent paid but no receipt was made, make one at the Payment Desk."}</span>
                {canAct ? (
                  <div className="ac-f ac-w" style={{ gap: 6 }}>
                    {r.suggestions.length ? <button type="button" className="tap btn pri ac-s" onClick={() => onMatch(r)}><Ic n="link" size={16} />Match with a receipt</button> : null}
                    <Link href="/payments" className="tap btn sec ac-s">Make a receipt</Link>
                    <button type="button" className="tap btn ghost ac-s" style={{ padding: "0 8px" }} disabled={busy} onClick={() => onNotFee(r.id)}>Not a fee payment</button>
                  </div>
                ) : null}
              </div>
            )}
          </div>
        );
      })}
      {rows.length === 0 ? (
        <Card className="ac-c" style={{ padding: 30, alignItems: "center", gap: 8, textAlign: "center" }}>
          <span className="ac-v">{filter === "open" ? "Nothing needs you" : "No bank lines here"}</span>
          <span className="ac-m">{total ? "Matched pairs are under All and Matched." : "Upload this week’s statement from the bank app."}</span>
        </Card>
      ) : null}
    </div>
  );
}

function RefundsPane({ data, canAct, onRequest, onSeeRequests }: { data: BooksData; canAct: boolean; onRequest: (studentId: string) => void; onSeeRequests: () => void }) {
  const refundReqs = data.requests.filter((r) => r.kind === "refund").slice(0, 6);
  const askedFor = new Set(data.requests.filter((r) => r.kind === "refund" && r.status === "waiting" && r.studentId).map((r) => r.studentId as string));
  const refundDone = (status: string) => ["approved", "processed", "paid", "completed", "refunded"].includes(status);
  const reqs = [
    ...refundReqs.map((q) => ({ id: q.id, who: q.studentName ?? q.title, why: q.reason, amount: q.amount, done: q.status === "approved", declined: q.status === "declined", status: q.status === "waiting" ? "Waiting for the admin" : q.status === "approved" ? `Approved${q.decidedByName ? ` by ${q.decidedByName}` : ""}` : q.status === "declined" ? "Declined" : "Withdrawn" })),
    ...data.feeRefunds.map((r) => ({ id: r.id, who: r.studentName, why: `${r.reason} · ${day(r.refundDate)}`, amount: r.amount, done: refundDone(r.status), declined: r.status === "rejected" || r.status === "declined", status: r.status.replace(/_/g, " ").replace(/^./, (s) => s.toUpperCase()) })),
  ];
  return (
    <div className="stack" style={{ display: "grid", gridTemplateColumns: "minmax(0,1.15fr) minmax(0,1fr)", gap: 16, alignItems: "start", animation: "xIn .32s var(--ease) both" }}>
      <Card className="ac-c" style={{ padding: "16px 18px 8px" }}>
        <div className="ac-f ac-j" style={{ marginBottom: 4 }}>
          <span className="ac-c"><span className="ac-v">Advances held for families</span><span className="ac-m">Paid more than the fee. Used for the next fee unless you ask for a refund.</span></span>
          <span className="num ac-v">{rupees(data.advances.reduce((s, a) => s + a.credit, 0))}</span>
        </div>
        {data.advances.map((a, i) => {
          const who = family(a);
          const asked = askedFor.has(a.studentId);
          return (
            <div key={a.studentId} className="ac-c" style={{ gap: 8, padding: "12px 0", borderTop: i ? "1px solid var(--bd)" : "0", animation: "xIn .32s var(--ease) both", animationDelay: delay(i) }}>
              <div className="ac-f" style={{ gap: 12 }}>
                <span className="ac-ib" style={{ background: "var(--accs)", color: "var(--accfg)" }}>{initials(who.title)}</span>
                <span className="ac-c ac-1"><span className="ac-b ac-e">{who.title}</span><span className="ac-m ac-e">{who.sub}</span></span>
                <span className="num ac-v">{rupees(a.credit)}</span>
              </div>
              <span className="ac-m" style={{ paddingLeft: 50 }}>{a.refundable > 0 ? `${rupees(a.refundable)} of it can be refunded.` : "Held for the next fee."}</span>
              <div className="ac-f ac-w" style={{ paddingLeft: 50, gap: 6 }}>
                <span className="pill" style={{ height: 26, padding: "0 10px", background: asked ? "var(--warns)" : "var(--infos)", color: asked ? "var(--warnfg)" : "var(--info)", animation: "xPopIn .4s var(--spring) both" }}><Ic n={asked ? "clock" : "calendar"} size={13} />{asked ? "Refund asked · waiting for admin" : "Used for the next fee"}</span>
                <span className="ac-1" />
                {asked ? (
                  <button type="button" className="tap btn ghost ac-s" onClick={onSeeRequests}><Ic n="chevRight" size={16} />See request</button>
                ) : canAct ? (
                  <button type="button" className="tap btn sec ac-s" onClick={() => onRequest(a.studentId)}><Ic n="swap" size={16} />Request refund</button>
                ) : null}
              </div>
            </div>
          );
        })}
        {data.advances.length === 0 ? <span className="ac-m" style={{ padding: "14px 0" }}>No family has paid ahead.</span> : null}
      </Card>
      <div className="ac-c" style={{ gap: 16 }}>
        <Card className="ac-c" style={{ padding: "16px 18px 8px" }}>
          <div className="ac-f ac-j" style={{ marginBottom: 4 }}><span className="ac-v">Refund requests</span><span className="ac-m">The admin approves every refund</span></div>
          {reqs.map((q, i) => {
            const tone = q.done ? ["var(--oks)", "var(--ok)"] : q.declined ? ["var(--bads)", "var(--bad)"] : ["var(--warns)", "var(--warnfg)"];
            return (
              <div key={q.id} className="ac-f" style={{ gap: 12, padding: "12px 0", borderTop: i ? "1px solid var(--bd)" : "0", alignItems: "flex-start", animation: "xIn .32s var(--ease) both", animationDelay: delay(i) }}>
                <span className="ac-ib" style={{ background: tone[0], color: tone[1] }}><Ic n={q.done ? "check" : q.declined ? "x" : "clock"} /></span>
                <span className="ac-c ac-1" style={{ gap: 2 }}><span className="ac-b">{q.who}</span><span className="ac-m">{q.why}</span><span className="pill" style={{ alignSelf: "flex-start", marginTop: 4, background: tone[0], color: tone[1] }}>{q.status}</span></span>
                <span className="num ac-v">{rupees(q.amount)}</span>
              </div>
            );
          })}
          {reqs.length === 0 ? <span className="ac-m" style={{ padding: "10px 0" }}>No refund requests yet.</span> : null}
          <button type="button" className="tap btn ghost" onClick={onSeeRequests} style={{ alignSelf: "flex-start", margin: "4px 0 8px", color: "var(--acc)" }}>See all in My requests<Ic n="chevRight" size={16} /></button>
        </Card>
        <div className="ac-in" style={{ background: "var(--infos)", color: "var(--info)" }}>
          <Ic n="shield" style={{ marginTop: 2 }} />
          <span>Refunds are never paid from the counter cash without the admin’s OK. After approval the refund is written in Finance controls as its own row; the family’s history keeps both.</span>
        </div>
      </div>
    </div>
  );
}

function RequestsPane({ data, canAct, busy, onWithdraw, onRemind, onDecide }: { data: BooksData; canAct: boolean; busy: boolean; onWithdraw: (id: string) => void; onRemind: (id: string) => void; onDecide: (r: AccRequestRow) => void }) {
  const [filter, setFilter] = useState<"all" | "waiting" | "done">("all");
  const waiting = data.requests.filter((r) => r.status === "waiting").length;
  const rows = data.requests.filter((r) => (filter === "all" ? true : filter === "waiting" ? r.status === "waiting" : r.status !== "waiting"));
  return (
    <div className="ac-c" style={{ gap: 12, animation: "xIn .32s var(--ease) both" }}>
      <div className="ac-f ac-w" style={{ gap: 10 }}>
        <div className="mfull" style={{ width: 360, maxWidth: "100%" }}>
          <Seg value={filter} onChange={setFilter} label="Show" style={{ width: "100%" }} options={[{ value: "all", label: `All · ${data.requests.length}` }, { value: "waiting", label: `Waiting · ${waiting}` }, { value: "done", label: `Decided · ${data.requests.length - waiting}` }]} />
        </div>
        <span className="ac-m">{data.canDecide ? "Approve or decline what the office asks. The fee change itself is made in the fee screens." : "Late-fee waivers, reversals and refunds go to the admin in Needs you."}</span>
      </div>
      <div className="stack" style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0,1fr))", gap: 12, alignItems: "start" }}>
        {rows.map((q, i) => {
          const decided = q.status === "approved" || q.status === "declined" || q.status === "withdrawn";
          const tone = q.status === "approved" ? ["var(--oks)", "var(--ok)"] : q.status === "declined" ? ["var(--bads)", "var(--bad)"] : q.status === "withdrawn" ? ["var(--s3)", "var(--mut)"] : ["var(--warns)", "var(--warnfg)"];
          const isNew = q.status === "waiting" && schoolDay(q.requestedAt) === data.today;
          const endColor = q.status === "declined" ? "var(--bad)" : q.status === "withdrawn" ? "var(--mut)" : "var(--ok)";
          // Sent → reminded (or with the admin once decided) → the decision. There is no "seen" record, so the middle step says what is known.
          const steps = [
            { label: "Sent", when: stamp(q.requestedAt, data.today), done: true, color: "var(--ok)", icon: "send" as IconName },
            { label: q.remindedAt || !decided ? "Reminded" : "With the admin", when: q.remindedAt ? stamp(q.remindedAt, data.today) : decided ? "" : "not yet", done: Boolean(q.remindedAt) || decided, color: "var(--ok)", icon: (q.remindedAt || !decided ? "bell" : "inbox") as IconName },
            decided
              ? { label: q.status === "approved" ? "Approved" : q.status === "declined" ? "Declined" : "Withdrawn", when: q.decidedAt ? stamp(q.decidedAt, data.today) : q.withdrawnAt ? stamp(q.withdrawnAt, data.today) : "", done: true, color: endColor, icon: (q.status === "approved" ? "check" : "x") as IconName }
              : { label: "Waiting", when: "with the admin", done: false, color: "var(--ok)", icon: "clock" as IconName },
          ];
          const fill = decided ? "100%" : q.remindedAt ? "50%" : "0%";
          const note = q.decisionNote ? (q.status === "declined" ? `“${q.decisionNote}”${q.decidedByName ? ` — ${q.decidedByName}` : ""}` : `${q.status === "approved" && q.decidedByName ? `Approved by ${q.decidedByName}. ` : ""}${q.decisionNote}`) : null;
          return (
            <Card key={q.id} className="ac-c" style={{ padding: "14px 16px", gap: 12, borderColor: isNew ? "var(--acc)" : undefined, animation: "xIn .32s var(--ease) both", animationDelay: delay(i) }}>
              <div className="ac-f" style={{ gap: 12, alignItems: "flex-start" }}>
                <span className="ac-ib" style={{ background: tone[0], color: tone[1] }}><Ic n={KIND_ICON[q.kind] ?? "inbox"} /></span>
                <span className="ac-c ac-1" style={{ gap: 1 }}>
                  <span className="ac-f ac-w" style={{ gap: 6 }}><span className="ac-b" style={{ fontWeight: 700 }}>{KIND_LABEL[q.kind] ?? "Request"}</span>{isNew ? <span className="pill" style={{ background: "var(--accs)", color: "var(--accfg)", animation: "xPopIn .4s var(--spring) both" }}>New</span> : null}</span>
                  <span className="ac-m">{q.title}{q.studentName ? ` · ${q.studentName}` : ""}{q.mine ? "" : ` · asked by ${q.requestedByName}`}</span>
                  <span className="ac-m" style={{ color: "var(--sub)" }}>{q.reason}</span>
                </span>
                {q.amount !== null ? <span className="num ac-v">{rupees(q.amount)}</span> : null}
              </div>
              <div className="ac-tline">
                <i><b style={{ width: fill, background: endColor }} /></i>
                {steps.map((t, k) => (
                  <div key={k} style={{ alignItems: k === 0 ? "flex-start" : k === 1 ? "center" : "flex-end", textAlign: k === 0 ? "left" : k === 1 ? "center" : "right" }}>
                    <span style={{ borderColor: t.done ? t.color : "var(--bds)", background: t.done ? t.color : "var(--card)", color: t.done ? "var(--onsolid)" : "var(--sub)" }}><Ic n={t.icon} size={12} stroke={3} /></span>
                    <span style={{ fontSize: 12, fontWeight: 700, color: t.done ? t.color : "var(--sub)" }}>{t.label}</span>
                    <span className="num" style={{ fontSize: 11, color: "var(--sub)" }}>{t.when}</span>
                  </div>
                ))}
              </div>
              {note ? <div className="ac-in" style={{ padding: "9px 12px", background: q.status === "declined" ? "var(--bads)" : "var(--s2)", color: q.status === "declined" ? "var(--bad)" : "var(--mut)" }}><span>{note}</span></div> : null}
              {q.status === "waiting" && canAct ? (
                <div className="ac-f" style={{ gap: 6, justifyContent: "flex-end" }}>
                  {q.mine ? (
                    <>
                      <button type="button" className="tap btn ghost ac-s" style={{ color: "var(--bad)" }} disabled={busy} onClick={() => onWithdraw(q.id)}>Withdraw</button>
                      <button type="button" className="tap btn sec ac-s" disabled={busy || !q.canRemind} onClick={() => onRemind(q.id)}><Ic n="bell" size={16} />{q.canRemind ? "Remind admin" : "Reminded"}</button>
                    </>
                  ) : null}
                  {data.canDecide ? <button type="button" className="tap btn pri ac-s" onClick={() => onDecide(q)}><Ic n="check" size={16} />Decide</button> : null}
                </div>
              ) : null}
            </Card>
          );
        })}
      </div>
      {rows.length === 0 ? (
        <Card className="ac-c" style={{ padding: 30, alignItems: "center", gap: 8, textAlign: "center" }}>
          <span className="ac-v">Nothing here</span>
          <span className="ac-m">Requests you send to the admin show up here with their status.</span>
        </Card>
      ) : null}
    </div>
  );
}

function SheetFooter({ onCancel, onOk, okLabel, okIcon, cancelIcon, disabled, danger, cancelLabel = "Cancel" }: { onCancel: () => void; onOk: () => void; okLabel: string; okIcon?: IconName; cancelIcon?: IconName; disabled?: boolean; danger?: boolean; cancelLabel?: string }) {
  return (
    <>
      <button type="button" className="tap btn sec" style={{ flex: 1, height: 48 }} onClick={onCancel}>
        {cancelIcon ? <Ic n={cancelIcon} /> : null}
        {cancelLabel}
      </button>
      <button type="button" className={`tap btn ${danger ? "danger" : "pri"}`} style={{ flex: 1.6, height: 48 }} onClick={onOk} disabled={disabled}>
        {okIcon ? <Ic n={okIcon} /> : null}
        {okLabel}
      </button>
    </>
  );
}

function Stack({ children, gap = 10 }: { children: ReactNode; gap?: number }) {
  return <div style={{ display: "flex", flexDirection: "column", gap }}>{children}</div>;
}

function DepositSheet({ open, onClose, data, chosen, total, clearPicked, staffName, canAct, busy, run }: { open: boolean; onClose: () => void; data: BooksData; chosen: ChequeRow[]; total: number; clearPicked: () => void; staffName: string; canAct: boolean; busy: boolean; run: Run }) {
  // The slip is written on the bank the school used last time, and today's date; both can be changed on the slip.
  const [bank, setBank] = useState(data.slips[0]?.bankLabel ?? "State Bank of India · school account");
  const [date, setDate] = useState(data.today);
  const dateRef = useRef<HTMLInputElement>(null);
  // The number the server will give it (same rule, `nextSlipNumber`), unless another slip lands first.
  const slipNo = nextSlipNumber(data.slips.map((s) => s.slipNo));
  const count = `${chosen.length} ${chosen.length === 1 ? "cheque" : "cheques"}`;
  return (
    <Sheet
      open={open}
      onClose={onClose}
      wide
      title={`Deposit slip ${slipNo}`}
      sub={`${count} · ${rupees(total)} · ${day(date)}`}
      footer={
        <SheetFooter
          onCancel={() => window.print()}
          cancelLabel="Print"
          cancelIcon="printer"
          onOk={() => run(() => createDepositSlipAction({ receiptIds: chosen.map((c) => c.receiptId), bankLabel: bank, depositedOn: date }), () => { clearPicked(); onClose(); })}
          okLabel="Mark as deposited"
          okIcon="check"
          disabled={!canAct || busy || chosen.length === 0}
        />
      }
    >
      <Stack>
        <div className="ac-slip">
          <div className="ac-f" style={{ gap: 12, paddingBottom: 10, borderBottom: "1px solid var(--bd)" }}>
            <span className="ac-ib" style={{ background: "#082F49", color: "#F7F6F3" }}><Ic n="bank" /></span>
            <span className="ac-c ac-1">
              <input className="ac-inline serif" aria-label="Bank and account" value={bank} onChange={(e) => setBank(e.target.value)} style={{ fontSize: 16, fontWeight: 600 }} />
              <span className="ac-m">Pay-in slip · cheques · {slipNo}</span>
            </span>
            <span className="num ac-m ac-c" style={{ alignItems: "flex-end", position: "relative" }}>
              Date
              <button
                type="button"
                className="tap ac-inline num"
                aria-label={`Deposited on ${slipDate(date)} · change`}
                onClick={() => {
                  const el = dateRef.current;
                  if (!el) return;
                  try {
                    el.showPicker();
                  } catch {
                    el.focus();
                  }
                }}
                style={{ width: "auto", fontWeight: 700, color: "var(--fg)", textAlign: "right" }}
              >
                {slipDate(date)}
              </button>
              <input ref={dateRef} type="date" className="sr" tabIndex={-1} aria-label="Deposited on" value={date} max={data.today} onChange={(e) => e.target.value && setDate(e.target.value)} />
            </span>
          </div>
          <div className="ac-c" style={{ fontSize: 13 }}>
            <span className="ac-m" style={{ fontSize: 11 }}>Account name</span>
            <span style={{ fontWeight: 600 }}>{process.env.NEXT_PUBLIC_SCHOOL_NAME ?? "School"}</span>
          </div>
          <div className="ac-c">
            <div className="ac-sr" style={{ borderTop: 0, paddingBottom: 4 }}><span className="sech">#</span><span className="sech">Cheque</span><span className="sech c3">Drawn on</span><span className="sech" style={{ textAlign: "right" }}>Amount</span></div>
            {chosen.map((d, i) => (
              <div key={d.receiptId} className="ac-sr" style={{ animation: "xIn .3s var(--ease) both", animationDelay: `${i * 60}ms` }}>
                <span className="num ac-m">{i + 1}</span>
                <span className="ac-c"><span className="num" style={{ fontWeight: 700 }}>{d.chequeNo ?? "no. not written"}</span><span className="ac-m ac-e">{family(d).title}</span></span>
                <span className="c3 ac-m ac-e">{d.bank ?? "—"}</span>
                <span className="num" style={{ textAlign: "right", fontWeight: 700 }}>{rupees(d.amount)}</span>
              </div>
            ))}
            {chosen.length === 0 ? <span className="ac-m" style={{ padding: "10px 0" }}>Tick the cheques you are taking to the bank, then make the slip.</span> : null}
            <div className="ac-f ac-j" style={{ padding: "10px 0 2px", borderTop: "2px solid var(--bd)" }}><span className="ac-b" style={{ fontWeight: 700 }}>Total · {count}</span><span className="num" style={{ fontSize: 20, fontWeight: 700 }}>{rupees(total)}</span></div>
            <span style={{ fontSize: 12, color: "var(--mut)", fontStyle: "italic" }}>{amountInWords(total)}</span>
          </div>
          <div className="ac-f ac-j" style={{ paddingTop: 10, borderTop: "1.5px dashed var(--bds)", fontSize: 12, color: "var(--mut)" }}><span>Deposited by {staffName}</span><span>Signature ____________</span></div>
        </div>
        {chosen.some((c) => !c.chequeNo) ? <div className="ac-in" style={{ background: "var(--warns)", color: "var(--warnfg)" }}><Ic n="alert" style={{ marginTop: 2 }} /><span>Some cheques have no number written. Add the details from the list so the bank slip is complete.</span></div> : null}
        <div className="ac-in" style={{ background: "var(--infos)", color: "var(--info)" }}><Ic n="info" style={{ marginTop: 2 }} /><span>Print two copies. After the bank stamps the slip, tap <b>Mark as deposited</b>. Cheques usually clear in 2–3 working days.</span></div>
      </Stack>
    </Sheet>
  );
}

function BounceSheet({ open, onClose, cheque, deposited, pick, canAct, busy, run }: { open: boolean; onClose: () => void; cheque: ChequeRow | null; deposited: ChequeRow[]; pick: (id: string) => void; canAct: boolean; busy: boolean; run: Run }) {
  const [reason, setReason] = useState(BOUNCE_REASONS[0].value);
  const [note, setNote] = useState("");
  const [tell, setTell] = useState(true);
  const who = cheque ? family(cheque) : null;
  const child = cheque?.studentName.split(" ")[0] ?? "";
  const surname = cheque ? (cheque.fatherName ?? cheque.studentName).split(" ").slice(-1)[0] : "";
  const hi = cheque ? `आदरणीय अभिभावक,\n${child} (${cheque.classLabel}) की फीस के लिए दिया गया चेक नं. ${cheque.chequeNo ?? ""} (${rupees(cheque.amount)}) बैंक से वापस आ गया है। कृपया 7 दिनों में नकद, UPI या नया चेक जमा करें।\n— श्री वीर पत्ता स्कूल, आमेट` : "";
  const en = cheque ? `Dear ${who?.title}, cheque no. ${cheque.chequeNo ?? ""} (${rupees(cheque.amount)}) for ${child}’s fee has come back from the bank unpaid. Please pay by cash, UPI or a new cheque within 7 days.\n— VPPS, Amet` : "";
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={cheque ? `Cheque ${cheque.chequeNo ?? cheque.receiptNumber} bounced?` : "Cheque bounced?"}
      sub={cheque && who ? `${who.title} · ${who.sub} · ${rupees(cheque.amount)} · ${cheque.receiptNumber}` : "Pick the cheque"}
      footer={<SheetFooter onCancel={onClose} cancelLabel="Not bounced" cancelIcon="x" onOk={() => cheque && run(() => bounceChequeAction({ receiptId: cheque.receiptId, reason, note }), onClose)} okLabel="Mark bounced" okIcon="alert" danger disabled={!canAct || busy || !cheque} />}
    >
      <Stack>
        {!cheque ? (
          <Field label="Which cheque?">
            <Select value="" onChange={(e) => pick(e.target.value)}>
              <option value="">Pick a deposited cheque</option>
              {deposited.map((c) => (
                <option key={c.receiptId} value={c.receiptId}>{c.chequeNo ?? c.receiptNumber} · {family(c).title} · {rupees(c.amount)}</option>
              ))}
            </Select>
          </Field>
        ) : null}
        <span className="sech">What did the bank say?</span>
        {BOUNCE_REASONS.map((r) => <RadioCard key={r.value} checked={reason === r.value} onSelect={() => setReason(r.value)} title={r.label} />)}
        {reason === "Other" ?<Field label="What the bank wrote"><Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="For example: date on the cheque has passed" /></Field> : null}
        <div className="ac-in" style={{ flexDirection: "column", gap: 8, background: "var(--warns)", color: "var(--warnfg)" }}>
          <span style={{ fontWeight: 700 }}>What happens next</span>
          <span className="ac-f" style={{ alignItems: "flex-start", gap: 10 }}><Ic n="undo" style={{ marginTop: 2 }} /><span>Receipt {cheque?.receiptNumber ?? ""} gets reversed after the admin approves. Nothing changes before that.</span></span>
          <span className="ac-f" style={{ alignItems: "flex-start", gap: 10 }}><Ic n="rupee" style={{ marginTop: 2 }} /><span>{cheque ? rupees(cheque.amount) : "The fee"} comes back as pending on the {surname} family. Late fee stays separate.</span></span>
          <span className="ac-f" style={{ alignItems: "flex-start", gap: 10 }}><Ic n="archive" style={{ marginTop: 2 }} /><span>The receipt stays in history with its reversal. Nothing is deleted.</span></span>
        </div>
        <button type="button" role="switch" aria-checked={tell} className="tap card ac-f" onClick={() => setTell(!tell)} style={{ padding: "12px 14px", gap: 12, textAlign: "left", color: "var(--fg)", width: "100%" }}>
          <Ic n="message" />
          <span className="ac-c ac-1"><span className="ac-b">Tell the parent</span><span className="ac-m">{tell ? "Copy it into WhatsApp · nothing is sent from here" : "The parent is not told now. You can call them instead."}</span></span>
          <span className={`sw${tell ? " on" : ""}`}><span /></span>
        </button>
        {tell && cheque ? (
          <div className="ac-wa">
            <div className="ac-wab">
              <p>{hi}</p>
              <hr />
              <p>{en}</p>
            </div>
            <button type="button" className="tap btn ghost ac-s" style={{ marginTop: 8 }} onClick={() => void navigator.clipboard?.writeText(`${hi}\n\n${en}`)}><Ic n="copy" size={16} />Copy message</button>
          </div>
        ) : null}
      </Stack>
    </Sheet>
  );
}

function UploadSheet({ open, onClose, canAct, busy, run }: { open: boolean; onClose: () => void; canAct: boolean; busy: boolean; run: Run }) {
  const [text, setText] = useState("");
  const [bank, setBank] = useState("School account");
  const lines = text.split(/\r?\n/).filter((l) => l.trim()).length;
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="New bank statement"
      sub="UPI payments from the bank app, as CSV"
      footer={<SheetFooter onCancel={onClose} cancelIcon="x" onOk={() => run(() => uploadStatementAction({ text, bankLabel: bank }), () => { setText(""); onClose(); })} okLabel={`Add ${lines || ""} payments`} okIcon="upload" disabled={!canAct || busy || lines === 0} />}
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
        <div className="ac-in" style={{ background: "var(--infos)", color: "var(--info)" }}><Ic n="info" style={{ marginTop: 2 }} /><span>A payment already uploaded (same UPI ref and amount) is skipped, so uploading the same file twice is safe.</span></div>
      </Stack>
    </Sheet>
  );
}

function RefundSheet({ open, onClose, data, studentId: initialStudent, canAct, busy, run }: { open: boolean; onClose: () => void; data: BooksData; studentId: string | null; canAct: boolean; busy: boolean; run: Run }) {
  const [studentId, setStudentId] = useState(initialStudent ?? data.advances[0]?.studentId ?? "");
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
      title="Request a refund"
      sub={adv ? `${family(adv).title} · ${family(adv).sub} · ${rupees(adv.credit)} held` : "The admin approves every refund"}
      footer={<SheetFooter onCancel={onClose} cancelIcon="x" onOk={() => run(() => requestRefundAction({ studentId, amount: n, reason, method, note }), () => { setAmount(""); setNote(""); onClose(); })} okLabel="Send to admin" okIcon="send" disabled={!canAct || busy || !adv || !n || tooMuch} />}
    >
      <Stack>
        <Field label="For which family?">
          <Select value={studentId} onChange={(e) => setStudentId(e.target.value)}>
            {data.advances.map((a) => (
              <option key={a.studentId} value={a.studentId}>{family(a).title} · {a.studentName.split(" ")[0]} · {rupees(a.credit)} held</option>
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
        <div className="ac-in" style={{ background: "var(--warns)", color: "var(--warnfg)" }}><Ic n="info" style={{ marginTop: 2 }} /><span>{adv && n ? `Nothing is paid yet. After the admin approves, ${rupees(adv.credit - Math.min(n, adv.credit))} stays as advance for ${adv.studentName}.` : "Nothing moves until the admin approves."}</span></div>
      </Stack>
    </Sheet>
  );
}

function DetailsSheet({ cheque, onClose, canAct, busy, run }: { cheque: ChequeRow | null; onClose: () => void; canAct: boolean; busy: boolean; run: Run }) {
  return cheque ? <DetailsForm key={cheque.receiptId} cheque={cheque} onClose={onClose} canAct={canAct} busy={busy} run={run} /> : null;
}

function DetailsForm({ cheque, onClose, canAct, busy, run }: { cheque: ChequeRow; onClose: () => void; canAct: boolean; busy: boolean; run: Run }) {
  const { tx } = useVx();
  const draft = chequeDetailsDraft(cheque);
  const [no, setNo] = useState(draft.chequeNo);
  const [bank, setBank] = useState(draft.bank);
  const [date, setDate] = useState(draft.chequeDate);
  return (
    <Sheet
      open
      onClose={onClose}
      title="Cheque details"
      sub={`${cheque.receiptNumber} · ${cheque.studentName} · ${rupees(cheque.amount)}`}
      footer={<SheetFooter onCancel={onClose} cancelIcon="x" onOk={() => run(() => saveChequeDetailsAction({ receiptId: cheque.receiptId, chequeNo: no, bank, chequeDate: date }), onClose)} okLabel="Save details" okIcon="check" disabled={!canAct || busy} />}
    >
      <Stack>
        <Field label="Cheque number"><Input inputMode="numeric" value={no} onChange={(e) => setNo(e.target.value)} /></Field>
        <Field label="Bank and branch"><Input value={bank} onChange={(e) => setBank(e.target.value)} placeholder="For example: SBI Amet" /></Field>
        <Field label="Date on the cheque"><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
        {cheque.receiptNotes?.trim() ? (
          <Card className="ac-c" style={{ padding: 12, gap: 6 }}>
            <span className="ac-b">{tx(p("Recorded on receipt", "रसीद पर दर्ज"))}</span>
            <span className="ac-m" style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{cheque.receiptNotes}</span>
            <span className="ac-m">{tx(p(draft.suggested ? "Review the suggested details, then save them for the cheque register." : "Check the receipt details before saving them for the cheque register.", "चेक रजिस्टर में सहेजने से पहले रसीद के विवरण जाँचें।"))}</span>
          </Card>
        ) : null}
      </Stack>
    </Sheet>
  );
}

function MatchSheet({ line, onClose, canAct, busy, run }: { line: UpiLineRow | null; onClose: () => void; canAct: boolean; busy: boolean; run: Run }) {
  return line ? <MatchForm key={line.id} line={line} onClose={onClose} canAct={canAct} busy={busy} run={run} /> : null;
}

function MatchForm({ line, onClose, canAct, busy, run }: { line: UpiLineRow; onClose: () => void; canAct: boolean; busy: boolean; run: Run }) {
  const [pick, setPick] = useState(line.suggestions[0]?.id ?? "");
  return (
    <Sheet
      open
      onClose={onClose}
      title={`${rupees(line.amount)} from ${line.payer}`}
      sub={`${day(line.txnAt)} · ${time12(line.txnAt)} · UPI ref ••${line.utr.slice(-4)}`}
      footer={<SheetFooter onCancel={onClose} cancelIcon="x" onOk={() => run(() => matchUpiAction(line.id, pick), onClose)} okLabel="Match" okIcon="link" disabled={!canAct || busy || !pick} />}
    >
      <Stack gap={8}>
        <span className="sech">Receipts for the same amount</span>
        {line.suggestions.map((s) => (
          <RadioCard
            key={s.id}
            checked={pick === s.id}
            onSelect={() => setPick(s.id)}
            title={`${s.receiptNumber} · ${s.studentName}`}
            sub={`${s.classLabel ? `${s.classLabel} · ` : ""}${day(s.paymentDate)}${s.referenceNumber ? ` · ref ${s.referenceNumber}` : ""}`}
            trail={<span className="ac-c" style={{ alignItems: "flex-end" }}><span className="num ac-v">{rupees(s.amount)}</span><Pill tone={s.why === "ref" ? "ok" : s.why === "amount_day" ? "info" : "mut"}>{s.why === "ref" ? "Same UPI ref" : s.why === "amount_day" ? "Same amount, near day" : "Same amount"}</Pill></span>}
          />
        ))}
        <div className="ac-in" style={{ background: "var(--accs)", color: "var(--accfg)" }}><Ic n="info" style={{ marginTop: 2 }} /><span>The bank line and the receipt are linked. No money changes. One UPI payment is one receipt; a receipt already matched to another payment is not offered.</span></div>
      </Stack>
    </Sheet>
  );
}

function DecideSheet({ request, onClose, busy, run }: { request: AccRequestRow | null; onClose: () => void; busy: boolean; run: Run }) {
  return request ? <DecideForm key={request.id} request={request} onClose={onClose} busy={busy} run={run} /> : null;
}

function DecideForm({ request, onClose, busy, run }: { request: AccRequestRow; onClose: () => void; busy: boolean; run: Run }) {
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
          <button type="button" className="tap btn sec" style={{ flex: 1, height: 48, color: "var(--bad)" }} disabled={busy} onClick={() => run(() => decideRequestAction(request.id, "declined", note), onClose)}><Ic n="x" />Decline</button>
          <button type="button" className="tap btn pri" style={{ flex: 1.6, height: 48 }} disabled={busy} onClick={() => run(() => decideRequestAction(request.id, "approved", note), onClose)}><Ic n="check" />Approve</button>
        </>
      }
    >
      <Stack>
        <div className="ac-in" style={{ background: "var(--s2)", color: "var(--fg)" }}><span><b>{request.requestedByName}</b> asked {ago(request.requestedAt)}: {request.reason}{request.amount !== null ? ` · ${rupees(request.amount)}` : ""}</span></div>
        <Field label="Note (needed to decline)"><Textarea value={note} onChange={(e) => setNote(e.target.value)} style={{ minHeight: 64 }} /></Field>
        <div className="ac-in" style={{ background: "var(--infos)", color: "var(--info)" }}><Ic n="info" style={{ marginTop: 2 }} /><span>{next.text} <a href={next.href} style={{ color: "inherit", fontWeight: 700 }}>Open</a></span></div>
        <span className="ac-m">Approving records your decision. Money moves only through the fee screens, as reversal or refund rows.</span>
      </Stack>
    </Sheet>
  );
}
