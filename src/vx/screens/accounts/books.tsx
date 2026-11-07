"use client";

import "./accounts.css";

import Link from "@/ui/link";
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
import { chequeDetailsDraft, withDeskChequeDetails } from "@/modules/finance-controls/vx/domain/cheque-receipt";
import { nextSlipNumber, slipStillAtBank } from "@/modules/finance-controls/vx/domain/books";
import { agoP, amountInWords, initials, rupees } from "@/vx/format";
import { useVx } from "@/vx/i18n";
import { Ic, type IconName } from "@/vx/icons";
import { p, type Pair } from "@/vx/text";
import { Card, Pill } from "@/vx/ui/primitives";
import { Chip, Field, Input, RadioCard, Seg, Select, Textarea } from "@/vx/ui/controls";
import { HelpButton, Sheet, useToast } from "@/vx/ui/overlays";
import { Section, TopBar, VxPage } from "@/vx/ui/page";

import { day, dayRange, schoolDay, time12 } from "./when";

export type BooksView = "cheques" | "upi" | "refunds" | "requests";
export type BooksSheet = "" | "deposit" | "bounce" | "upload" | "refund";

type ChequeTab = "to_deposit" | "deposited" | "cleared" | "bounced";

const delay = (i: number) => `${Math.min(i, 14) * 28}ms`;
const len = (n: number) => ({ "--len": n }) as CSSProperties;
/** The design's four answers; `value` is what `bounceChequeAction` accepts (anything else goes as "Other" with the bank's words). */
const BOUNCE_REASONS = [
  { label: p("Not enough money in the account", "खाते में पैसे कम थे"), value: "Not enough money" },
  { label: p("Signature does not match", "हस्ताक्षर नहीं मिले"), value: "Signature does not match" },
  { label: p("Account closed", "खाता बंद है"), value: "Account closed" },
  { label: p("Some other reason", "कोई और कारण"), value: "Other" },
];
/** `value` is what `requestRefundAction` accepts and stores, so it stays English; the label is what the reader sees. */
const REFUND_REASONS = [
  { value: "Paid twice", label: p("Paid twice", "दो बार भरा") },
  { value: "Left the school", label: p("Left the school", "स्कूल छोड़ दिया") },
  { value: "Paid more than the fee", label: p("Paid more than the fee", "फीस से ज़्यादा भरा") },
  { value: "Fee changed", label: p("Fee changed", "फीस बदली") },
  { value: "Other", label: p("Other", "अन्य") },
];
const METHODS = [
  { value: "cash", label: p("Cash", "नकद") },
  { value: "upi", label: p("UPI", "UPI") },
  { value: "bank_transfer", label: p("Bank transfer", "बैंक ट्रांसफ़र") },
  { value: "cheque", label: p("Cheque", "चेक") },
];
const KIND_LABEL: Record<string, Pair> = { late_fee_waiver: p("Late-fee waiver", "लेट फीस माफ़ी"), reversal: p("Reversal", "रसीद वापसी"), refund: p("Refund", "रिफ़ंड"), fee_change: p("Fee change", "फीस बदलाव"), other: p("Request", "अनुरोध") };
const KIND_ICON: Record<string, IconName> = { late_fee_waiver: "percent", reversal: "undo", refund: "swap", fee_change: "sliders", other: "inbox" };
const ACW: Record<ChequeTab, string> = { to_deposit: "180px", deposited: "310px", cleared: "150px", bounced: "310px" };

/** `hi` is the server's message for a Hindi reader, when it has one. */
type Result = { ok: boolean; message: string; hi?: string };
type Run = (fn: () => Promise<Result>, after?: () => void) => void;

/** A cheque dated after today waits for its date before it can go to the bank. */
const postDated = (c: ChequeRow, today: string) => Boolean(c.chequeDate && c.chequeDate > today);
const waitingForBank = (c: ChequeRow) => !c.reversed && (c.status === "to_deposit" || c.status === "in_bag");
/** The register reads by family: the father's name, then the child and class. */
const family = (c: { studentName: string; fatherName?: string | null; classLabel: string }) =>
  c.fatherName ? { title: c.fatherName, sub: [c.studentName.split(" ")[0], c.classLabel].filter(Boolean).join(" · ") } : { title: c.studentName, sub: c.classLabel };
/** "Today 10:04 am", or "Wed 7 Oct · 7:58 pm"; a pair, so a Hindi reader gets "आज रात 7:58" and a Hindi date. */
const stamp = (iso: string, today: string): Pair => (schoolDay(iso) === today ? p(`Today ${time12(iso)}`, `आज ${time12(iso)}`) : p(`${day(iso)} · ${time12(iso)}`));
const chequesWord = (n: number) => p(`${n} ${n === 1 ? "cheque" : "cheques"}`, `${n} चेक`);
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
      toast.show({ text: r.hi ? tx(p(r.message, r.hi)) : r.message, tone: r.ok ? "ok" : "bad" });
      if (r.ok) {
        after?.();
        router.refresh();
      }
    });

  const pickedRows = ready.filter((c) => picked.includes(c.receiptId));
  const pickedTotal = pickedRows.reduce((s, c) => s + c.amount, 0);
  const openDeposit = () => {
    if (pickedRows.length === 0) {
      toast.show({ text: tx(ready.length ? p("Tick the cheques you are taking to the bank", "बैंक ले जाने वाले चेक चुनें") : p("No cheques are ready to deposit", "जमा करने के लिए कोई चेक तैयार नहीं")), tone: "info" });
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
    { key: "cheques", icon: "file", label: tx(p("Cheques to deposit", "जमा करने के चेक")), value: rupees(toDeposit.reduce((s, c) => s + c.amount, 0)), sub: tx(p(`${toDeposit.length} cheques · ${ready.length} ready today`, `${toDeposit.length} चेक · आज ${ready.length} तैयार`)), tone: ["var(--warns)", "var(--warnfg)"] },
    { key: "upi", icon: "zap", label: tx(p("UPI matched", "UPI मिलान")), value: upiTotal ? tx(p(`${upiDone} of ${upiTotal}`, `${upiTotal} में ${upiDone}`)) : tx(p("No statement", "स्टेटमेंट नहीं")), sub: upiTotal ? (upiOpen.length ? tx(p(`${upiOpen.length} need you`, `${upiOpen.length} आपके लिए`)) : tx(p("All matched", "सब मिल गए"))) : tx(p("Upload the bank’s statement", "बैंक का स्टेटमेंट डालें")), tone: ["var(--oks)", "var(--ok)"] },
    { key: "refunds", icon: "swap", label: tx(p("Advances held", "अग्रिम राशि")), value: rupees(advTotal), sub: tx(p(`${data.advances.length} families${refundsWaiting ? ` · ${refundsWaiting} refund waiting` : ""}`, `${data.advances.length} परिवार${refundsWaiting ? ` · ${refundsWaiting} रिफ़ंड बाकी` : ""}`)), tone: ["var(--accs)", "var(--accfg)"] },
    { key: "requests", icon: "inbox", label: tx(p(requestsLabel, data.canDecide ? "अनुरोध" : "मेरे अनुरोध")), value: tx(p(`${myWaiting.length} waiting`, `${myWaiting.length} बाकी`)), sub: tx(p(`${decidedThisWeek} decided this week`, `इस हफ़्ते ${decidedThisWeek} तय`)), tone: ["var(--infos)", "var(--info)"] },
  ];

  const top = {
    // In the reader's language: a Hindi account read these first-screen lines in English (UX review 6 Nov 2026).
    cheques: { crumb: tx(p("Cheques", "चेक")), mSub: tx(p(`${toDeposit.length} to deposit · ${rupees(toDeposit.reduce((s, c) => s + c.amount, 0))}`, `${toDeposit.length} जमा करने · ${rupees(toDeposit.reduce((s, c) => s + c.amount, 0))}`)), label: tx(p("Make a deposit slip", "जमा पर्ची बनाएँ")), mLabel: tx(p("Slip", "पर्ची")), icon: "file" as IconName, variant: "pri", act: openDeposit, dim: pickedRows.length === 0 },
    upi: { crumb: tx(p("UPI matching", "UPI मिलान")), mSub: upiTotal ? tx(p(`${upiDone} of ${upiTotal} matched`, `${upiTotal} में ${upiDone} मिले`)) : tx(p("No bank statement yet", "अभी बैंक स्टेटमेंट नहीं")), label: tx(p("Upload bank statement", "बैंक स्टेटमेंट डालें")), mLabel: tx(p("Upload", "डालें")), icon: "upload" as IconName, variant: "sec", act: () => openSheet("upload"), dim: false },
    refunds: { crumb: tx(p("Refunds & advances", "रिफ़ंड व अग्रिम")), mSub: tx(p(`${rupees(advTotal)} held for ${data.advances.length} families`, `${data.advances.length} ${data.advances.length === 1 ? "परिवार" : "परिवारों"} के ${rupees(advTotal)} जमा`)), label: tx(p("Request refund", "रिफ़ंड माँगें")), mLabel: tx(p("Refund", "रिफ़ंड")), icon: "swap" as IconName, variant: "pri", act: () => openRefund(null), dim: data.advances.length === 0 },
    requests: { crumb: tx(p(requestsLabel, data.canDecide ? "अनुरोध" : "मेरे अनुरोध")), mSub: tx(p(`${myWaiting.length} waiting for the admin`, `${myWaiting.length} एडमिन के पास बाकी`)), label: "", mLabel: "", icon: "inbox" as IconName, variant: "sec", act: () => undefined, dim: false },
  }[view];
  const hasAction = Boolean(top.label) && canAct;

  const help = [
    { icon: "file" as IconName, title: tx(p("Cheques", "चेक")), body: tx(p("Tick the cheques you take to the bank and print the deposit slip. Mark each one cleared or bounced when the bank says so.", "बैंक ले जाने वाले चेक चुनें और जमा पर्ची छापें। बैंक बताए तो हर चेक को क्लियर या बाउंस करें।")) },
    { icon: "zap" as IconName, title: "UPI", body: tx(p("Upload the bank statement. Each payment is matched to its receipt; anything left over needs a look.", "बैंक स्टेटमेंट डालें। हर भुगतान अपनी रसीद से मिलाया जाता है; जो बचे उसे देखना होगा।")) },
    { icon: "shield" as IconName, title: tx(p("Refunds and reversals", "रिफ़ंड और वापसी")), body: tx(p("Only the admin approves money going back. You ask here and watch the status in My requests.", "पैसा लौटाने की मंज़ूरी सिर्फ़ एडमिन देते हैं। आप यहाँ माँगें और ‘मेरे अनुरोध’ में स्थिति देखें।")) },
  ];

  return (
    <VxPage className="ac-page ac-books">
      <TopBar
        crumb={`${tx(p("Money", "पैसा"))} · ${tx(day(data.today))} · ${top.crumb}`}
        title={tx(p("Cheques, UPI & refunds", "चेक, UPI व रिफंड"))}
        mTitle={top.crumb}
        mSub={top.mSub}
        mBack="/accounts?view=menu"
        actions={
          <>
            <HelpButton title={tx(p("Cheques, UPI & refunds", "चेक, UPI व रिफंड"))} steps={help} />
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
            <HelpButton title={tx(p("Cheques, UPI & refunds", "चेक, UPI व रिफंड"))} steps={help} style={{ width: 44, height: 44, borderRadius: 22 }} />
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
        {readOnly ? <Pill tone="info" icon="eye">{tx(p("Preview · read only", "झलक · सिर्फ़ देखने के लिए"))}</Pill> : null}
        <div className="ac-kp" role="tablist" aria-label={tx(p("Sections", "हिस्से"))}>
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
            onPostDated={(c) => toast.show({ text: tx(p(`Cheque ${c.chequeNo ?? c.receiptNumber} is dated ${day(c.chequeDate ?? c.paymentDate)}. It can go to the bank from that day.`, `चेक ${c.chequeNo ?? c.receiptNumber} पर ${day(c.chequeDate ?? c.paymentDate)} की तारीख है। उसी दिन से बैंक जा सकता है।`)), tone: "info" })}
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

function statusLook(c: ChequeRow, today: string): { label: Pair; bg: string; fg: string; icon: IconName } {
  if (c.reversed && c.status !== "bounced") return { label: p("Receipt reversed", "रसीद वापस"), bg: "var(--s3)", fg: "var(--mut)", icon: "undo" };
  switch (c.status) {
    case "deposited":
      return { label: p("In clearing", "क्लियरिंग में"), bg: "var(--infos)", fg: "var(--info)", icon: "clock" };
    case "cleared":
      return { label: c.statusAt ? p(`Cleared ${day(c.statusAt)}`, `${day(c.statusAt)} को क्लियर`) : p("Cleared", "क्लियर"), bg: "var(--oks)", fg: "var(--ok)", icon: "check" };
    case "bounced":
      return c.reversed ? { label: p("Reversed", "वापस हुआ"), bg: "var(--bads)", fg: "var(--bad)", icon: "alert" } : { label: p("Bounced · waiting for admin", "बाउंस · एडमिन के पास बाकी"), bg: "var(--bads)", fg: "var(--bad)", icon: "alert" };
    default:
      return postDated(c, today) ? { label: p(`Dated ${day(c.chequeDate as string)} · wait`, `${day(c.chequeDate as string)} की तारीख · रुकें`), bg: "var(--warns)", fg: "var(--warnfg)", icon: "file" } : { label: p("Ready", "तैयार"), bg: "var(--oks)", fg: "var(--ok)", icon: "file" };
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
  const { tx } = useVx();
  const inTab = (c: ChequeRow, t: ChequeTab) => (t === "to_deposit" ? waitingForBank(c) : c.status === t);
  const rows = data.cheques.filter((c) => inTab(c, tab));
  const count = (t: ChequeTab) => data.cheques.filter((c) => inTab(c, t)).length;
  const lastSlip = slipStillAtBank(data.slips, data.cheques);
  const hint = tx(
    tab === "to_deposit"
      ? p("Tick the cheques going to the bank. A post-dated cheque waits for its date.", "बैंक जाने वाले चेक चुनें। आगे की तारीख वाला चेक अपनी तारीख तक रुकता है।")
      : tab === "deposited"
        ? p(
            `${lastSlip ? `Slip ${lastSlip.slipNo} went to the bank on ${day(lastSlip.depositedOn)}. ` : ""}Cheques clear in 2–3 working days.`,
            `${lastSlip ? `पर्ची ${lastSlip.slipNo} ${day(lastSlip.depositedOn)} को बैंक गई। ` : ""}चेक 2–3 कामकाजी दिनों में क्लियर होते हैं।`,
          )
        : tab === "cleared"
          ? p("Cleared cheques. The money is in the school account.", "क्लियर हुए चेक। पैसा स्कूल के खाते में है।")
          : p("A bounced cheque is reversed only after the admin approves.", "बाउंस चेक की रसीद एडमिन की मंज़ूरी के बाद ही वापस होती है।"),
  );
  const pickedRows = data.cheques.filter((c) => picked.includes(c.receiptId) && waitingForBank(c) && !postDated(c, data.today));
  const toggle = (c: ChequeRow) => {
    if (postDated(c, data.today)) return onPostDated(c);
    setPicked(picked.includes(c.receiptId) ? picked.filter((x) => x !== c.receiptId) : [...picked, c.receiptId]);
  };
  const empty =
    tab === "to_deposit"
      ? { title: p("No cheques waiting for the bank", "बैंक के लिए कोई चेक बाकी नहीं"), sub: p("Cheque receipts from the Payment Desk show up here.", "फीस जमा पर बनी चेक की रसीदें यहाँ दिखती हैं।") }
      : tab === "deposited"
        ? { title: p("Nothing waiting at the bank", "बैंक में कुछ बाकी नहीं"), sub: p("Every deposited cheque has cleared or bounced.", "जमा हुआ हर चेक क्लियर या बाउंस हो चुका है।") }
        : { title: p("Nothing here", "यहाँ कुछ नहीं"), sub: p("Cheques show up here as their status changes.", "स्थिति बदलने पर चेक यहाँ दिखते हैं।") };
  const seg = (label: string, t: ChequeTab) => <>{label} <span className="num" style={{ fontWeight: 600, color: "var(--sub)" }}>{count(t)}</span></>;
  return (
    <div className="ac-c" style={{ gap: 12, animation: "xIn .32s var(--ease) both" }}>
      <div className="ac-f ac-w" style={{ gap: 10 }}>
        <div className="mfull ac-seg ac-seg-tight" style={{ width: 520, maxWidth: "100%" }}>
          <Seg<ChequeTab>
            label={tx(p("Cheque status", "चेक की स्थिति"))}
            value={tab}
            onChange={setTab}
            style={{ width: "100%" }}
            options={[
              { value: "to_deposit", label: seg(tx(p("To deposit", "जमा करने")), "to_deposit") },
              { value: "deposited", label: seg(tx(p("Deposited", "जमा हुए")), "deposited") },
              { value: "cleared", label: seg(tx(p("Cleared", "क्लियर")), "cleared") },
              { value: "bounced", label: seg(tx(p("Bounced", "बाउंस")), "bounced") },
            ]}
          />
        </div>
        <span className="ac-m" style={{ flex: 1, minWidth: 220 }}>{hint}</span>
      </div>
      {rows.length ? (
        <Card pad={false} className="ac-ctb" style={{ overflow: "hidden", ["--aw" as string]: ACW[tab] } as CSSProperties}>
          <div className="ac-cth">
            <span />
            <span className="sech">{tx(p("Cheque", "चेक"))}</span>
            <span className="sech">{tx(p("Family", "परिवार"))}</span>
            <span className="sech">{tx(p("Bank", "बैंक"))}</span>
            <span className="sech">{tx(p("Dated", "तारीख"))}</span>
            <span className="sech">{tx(p("Receipt", "रसीद"))}</span>
            <span className="sech" style={{ textAlign: "right" }}>{tx(p("Amount", "राशि"))}</span>
            <span className="sech">{tx(p("Status", "स्थिति"))}</span>
          </div>
          {rows.map((r, i) => {
            const look = statusLook(r, data.today);
            const late = postDated(r, data.today);
            const sel = picked.includes(r.receiptId) && !late;
            const selectable = tab === "to_deposit" && canAct;
            const who = family(r);
            // What the cashier typed at the desk is shown until the details are
            // confirmed here (accountant B7); "Add details" still saves the record.
            const shown = withDeskChequeDetails(r);
            const dated = tx(day(shown.chequeDate ?? r.paymentDate));
            return (
              <div key={r.receiptId} className="row ac-ct" style={{ animationDelay: delay(i) }}>
                {selectable ? (
                  <button type="button" className="tap ac-cb c-cb" role="checkbox" aria-checked={sel} aria-label={tx(p(`Select cheque ${r.chequeNo ?? r.receiptNumber}`, `चेक ${r.chequeNo ?? r.receiptNumber} चुनें`))} onClick={() => toggle(r)}>
                    <span style={{ background: sel ? "var(--pri)" : "var(--card)", borderColor: late ? "var(--warn)" : sel ? "var(--pri)" : "var(--bds)", borderStyle: late ? "dashed" : "solid" }}>
                      <Ic n="check" size={14} stroke={3} style={{ opacity: sel ? 1 : 0, transform: `scale(${sel ? 1 : 0})` }} />
                    </span>
                  </button>
                ) : (
                  <span className="c-cb ac-f" style={{ justifyContent: "center", width: 40, height: 40 }}>
                    <span className="ac-ib" style={{ width: 30, height: 30, borderRadius: 10, background: tab === "to_deposit" ? "var(--s2)" : look.bg, color: tab === "to_deposit" ? "var(--mut)" : look.fg }}><Ic n={look.icon} size={16} /></span>
                  </span>
                )}
                <span className="num c-no" style={{ fontSize: 13, fontWeight: 700 }}>{shown.chequeNo ?? "—"}</span>
                <span className="ac-c c-fam">
                  <span className="ac-b ac-e">{who.title}</span>
                  <span className="ac-m ac-e">{who.sub}</span>
                  <span className="ac-m ac-e num only-m">{[shown.chequeNo ? tx(p(`Cheque ${shown.chequeNo}`, `चेक ${shown.chequeNo}`)) : tx(p("No cheque no. yet", "चेक नं. नहीं लिखा")), shown.bank ?? tx(p("bank not written", "बैंक नहीं लिखा")), r.receiptNumber, r.slipNo ? tx(p(`slip ${r.slipNo}`, `पर्ची ${r.slipNo}`)) : null].filter(Boolean).join(" · ")}</span>
                </span>
                <span className="ac-m ac-e c-bank" style={{ fontSize: 13 }}>{shown.bank ?? "—"}</span>
                <span className="num c-dt" style={{ fontSize: 13 }}>{dated}</span>
                <span className="num ac-m ac-e c-rec" style={{ fontSize: 13 }} title={r.receiptNumber}>{r.receiptNumber}</span>
                <span className="c-amt">
                  <span className="num ac-v">{rupees(r.amount)}</span>
                  <span className="num ac-m only-m">{dated}</span>
                </span>
                <span className="c-act">
                  <span className="pill" style={{ height: 24, background: look.bg, color: look.fg }}>{tx(look.label)}</span>
                  {canAct && !r.chequeNo && r.status !== "cleared" ? <button type="button" className="tap btn ghost ac-s" onClick={() => onDetails(r)}><Ic n="edit" size={16} />{tx(p("Add details", "विवरण जोड़ें"))}</button> : null}
                  {canAct && r.status === "deposited" && !r.reversed ? (
                    <>
                      <button type="button" className="tap btn soft ac-s" disabled={busy} onClick={() => onCleared(r.receiptId)}><Ic n="check" size={16} />{tx(p("Cleared", "क्लियर"))}</button>
                      <button type="button" className="tap btn ghost ac-s" style={{ color: "var(--bad)" }} onClick={() => onBounce(r.receiptId)}><Ic n="alert" size={16} />{tx(p("Bounced", "बाउंस"))}</button>
                    </>
                  ) : null}
                  {r.status === "bounced" && !r.reversed ? <button type="button" className="tap btn ghost ac-s" style={{ color: "var(--acc)" }} onClick={onRequests}><Ic n="chevRight" size={16} />{tx(p("See request", "अनुरोध देखें"))}</button> : null}
                </span>
              </div>
            );
          })}
        </Card>
      ) : (
        <Card className="ac-c" style={{ padding: "34px 24px", alignItems: "center", gap: 10, textAlign: "center", animation: "xIn .32s var(--ease) both" }}>
          <span className="ac-ib" style={{ width: 56, height: 56, borderRadius: 28, background: "var(--oks)", color: "var(--ok)", animation: "xPopIn .5s var(--spring) both" }}><Ic n="check" size={26} /></span>
          <span style={{ fontSize: 16, fontWeight: 700 }}>{tx(empty.title)}</span>
          <span className="ac-m" style={{ fontSize: 13 }}>{tx(empty.sub)}</span>
          {tab !== "to_deposit" ? <button type="button" className="tap btn sec" onClick={() => setTab("to_deposit")}>{tx(p("See cheques to deposit", "जमा करने के चेक देखें"))}</button> : null}
        </Card>
      )}
      {pickedRows.length > 0 && tab === "to_deposit" ? (
        <div className="glass ac-f ac-cheque-selection" style={{ position: "sticky", zIndex: 4, flexWrap: "wrap", padding: "10px 12px", borderRadius: 18, border: "1px solid var(--bds)", boxShadow: "var(--shh)", animation: "xToast .32s var(--spring) both" }}>
          <span className="ac-c" style={{ paddingLeft: 4, marginRight: "auto" }}>
            <span className="ac-b" style={{ fontWeight: 700 }}>{tx(chequesWord(pickedRows.length))} · {rupees(pickedRows.reduce((s, c) => s + c.amount, 0))}</span>
            <span className="ac-m">{lastSlip?.bankLabel ?? tx(p("Ready for one deposit slip", "एक जमा पर्ची के लिए तैयार"))}</span>
          </span>
          <button type="button" className="tap btn ghost" onClick={() => setPicked([])}>{tx(p("Clear", "हटाएँ"))}</button>
          <button type="button" className="tap btn pri mfull" onClick={onDeposit} style={{ height: 48 }}>
            <Ic n="file" />
            {tx(p("Make a deposit slip", "जमा पर्ची बनाएँ"))} ({pickedRows.length} · {rupees(pickedRows.reduce((s, c) => s + c.amount, 0))})
          </button>
        </div>
      ) : null}
    </div>
  );
}

function UpiPane({ data, canAct, busy, onUpload, onMatch, onUndo, onNotFee }: { data: BooksData; canAct: boolean; busy: boolean; onUpload: () => void; onMatch: (l: UpiLineRow) => void; onUndo: (id: string) => void; onNotFee: (id: string) => void }) {
  const { tx } = useVx();
  const [filter, setFilter] = useState<"all" | "open" | "matched">("all");
  const total = data.upiLines.length;
  const open = data.upiLines.filter((l) => l.state === "open");
  const done = total - open.length;
  const pct = total ? done / total : 0;
  // What needs a look comes first.
  const sorted = [...open, ...data.upiLines.filter((l) => l.state !== "open")];
  const rows = sorted.filter((l) => (filter === "all" ? true : filter === "open" ? l.state === "open" : l.state !== "open"));
  const days = data.upiLines.map((l) => schoolDay(l.txnAt)).sort();
  const range = dayRange(days[0], days.at(-1));
  const allSorted = total > 0 && done === total;
  const why = (w: "ref" | "amount_day" | "amount") => (w === "ref" ? { en: "same UPI ref", hi: "UPI रेफ़ एक जैसा" } : w === "amount_day" ? { en: "same amount, near the day", hi: "राशि एक जैसी, दिन पास" } : { en: "same amount", hi: "राशि एक जैसी" });
  const unseen = data.upiReceiptsUnmatched;
  return (
    <div className="ac-c" style={{ gap: 12, animation: "xIn .32s var(--ease) both" }}>
      <Card className="ac-f" style={{ padding: "16px 18px", gap: 16, flexWrap: "wrap" }}>
        <svg width="64" height="64" viewBox="0 0 64 64" aria-hidden="true" style={{ flex: "none" }}>
          <circle cx="32" cy="32" r="26" style={{ fill: "none", stroke: "var(--s3)", strokeWidth: 7 }} />
          <circle cx="32" cy="32" r="26" transform="rotate(-90 32 32)" style={{ fill: "none", stroke: "var(--ok)", strokeWidth: 7, strokeLinecap: "round", strokeDasharray: `${(163.4 * pct).toFixed(1)} 163.4`, ...len(163.4), animation: "xDraw .9s .1s var(--ease) both", transition: "stroke-dasharray .6s var(--ease)" }} />
        </svg>
        <span className="ac-c" style={{ flex: 1, minWidth: 200, gap: 4 }}>
          <span className="serif" style={{ fontSize: 22, fontWeight: 600 }}>{tx(total ? p(`${done} of ${total} matched`, `${total} में ${done} मिले`) : p("No bank statement yet", "अभी बैंक स्टेटमेंट नहीं"))}</span>
          <span className="ac-m" style={{ fontSize: 13 }}>{tx(total ? p(`Bank statement for ${range}${unseen ? ` · ${unseen} UPI receipts not yet seen in the bank` : ""}`, `${range} का बैंक स्टेटमेंट${unseen ? ` · ${unseen} UPI रसीदें अभी बैंक में नहीं दिखीं` : ""}`) : p("Upload the bank’s UPI statement (CSV) to match it with receipts.", "रसीदों से मिलाने के लिए बैंक का UPI स्टेटमेंट (CSV) डालें।"))}</span>
          <span style={{ display: "block", height: 8, borderRadius: 4, background: "var(--s3)", overflow: "hidden", marginTop: 4 }}><span style={{ display: "block", height: 8, borderRadius: 4, width: `${(pct * 100).toFixed(0)}%`, background: "var(--ok)", transition: "width .5s var(--ease)" }} /></span>
        </span>
        {canAct ? <button type="button" className="tap btn sec" onClick={onUpload}><Ic n="upload" />{tx(p("New statement", "नया स्टेटमेंट"))}</button> : null}
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
            <span className="ac-v" style={{ color: unseen > 0 ? "var(--warn)" : "var(--ok)" }}>{tx(p("Imported bank payments are sorted", "डाले गए बैंक भुगतान निपट गए"))}</span>
            <span style={{ fontSize: 13, color: unseen > 0 ? "var(--fg)" : "var(--ok)" }}>
              {tx(
                unseen > 0
                  ? p(`${unseen} UPI ${unseen === 1 ? "receipt still needs a bank match. Review it" : "receipts still need a bank match. Review them"} before confirming UPI at day close.`, `${unseen} UPI ${unseen === 1 ? "रसीद" : "रसीदों"} का बैंक से मिलान अभी बाकी है। दिन बंद करते समय UPI पक्का करने से पहले ${unseen === 1 ? "इसे" : "इन्हें"} देखें।`)
                  : p(`Every line of the statement for ${range} is matched or set aside. Review the statement coverage before confirming UPI at day close.`, `${range} के स्टेटमेंट की हर लाइन मिल गई या अलग रखी गई। दिन बंद करते समय UPI पक्का करने से पहले देख लें कि स्टेटमेंट में सब दिन हैं।`),
              )}
            </span>
          </span>
        </Card>
      ) : null}
      <div className="mfull" style={{ width: 420, maxWidth: "100%" }}>
        <Seg value={filter} onChange={setFilter} label={tx(p("Show", "दिखाएँ"))} style={{ width: "100%" }} options={[{ value: "all", label: tx(p(`All ${total}`, `सब ${total}`)) }, { value: "open", label: tx(p(`Needs you · ${open.length}`, `आपके लिए · ${open.length}`)) }, { value: "matched", label: tx(p(`Matched · ${done}`, `मिले · ${done}`)) }]} />
      </div>
      <div className="ac-ur hide-m" style={{ animation: "none" }}><span className="sech">{tx(p("In the bank statement", "बैंक स्टेटमेंट में"))}</span><span /><span className="sech">{tx(p("In VPPS One · receipts", "VPPS One में · रसीदें"))}</span></div>
      {rows.map((r, i) => {
        const matched = r.state === "matched" && r.receipt;
        const notFee = r.state === "not_fee";
        const lineColor = matched ? "var(--ok)" : notFee ? "var(--sub)" : "var(--warn)";
        const best = r.suggestions[0];
        return (
          <div key={r.id} className="ac-ur" style={{ animationDelay: delay(i) }}>
            <div className="card" style={{ borderColor: r.state === "open" ? "var(--warnm)" : undefined }}>
              <span className="ac-ib" style={{ background: "var(--infos)", color: "var(--info)" }}><Ic n="zap" /></span>
              <span className="ac-c ac-1"><span className="ac-b ac-e">{r.payer}</span><span className="ac-m ac-e num">{tx(stamp(r.txnAt, data.today))} · {tx(p("UPI ref", "UPI रेफ़"))} ••{r.utr.slice(-4)}</span></span>
              <span className="num ac-v">{rupees(r.amount)}</span>
            </div>
            <div className={`ac-ul${r.state === "open" ? " dash" : ""}`} style={{ color: lineColor }} aria-hidden="true"><b><Ic n={matched ? "check" : notFee ? "minus" : "help"} size={14} stroke={3} /></b></div>
            {matched && r.receipt ? (
              <div className="card" style={{ background: "var(--card)" }}>
                <span className="ac-ib" style={{ background: "var(--oks)", color: "var(--ok)" }}><Ic n="receipt" /></span>
                <span className="ac-c ac-1"><span className="ac-b ac-e">{r.receipt.receiptNumber} · {r.receipt.studentName}</span><span className="ac-m ac-e">{[r.receipt.classLabel, "UPI"].filter(Boolean).join(" · ")}</span></span>
                <span className="ac-c" style={{ alignItems: "flex-end", gap: 4 }}><span className="num ac-v">{rupees(r.receipt.amount)}</span><Pill tone="ok">{tx(p("Matched", "मिला"))}</Pill></span>
                {canAct ? <button type="button" className="tap btn ghost" aria-label={tx(p("Undo this match", "यह मिलान हटाएँ"))} disabled={busy} onClick={() => onUndo(r.id)} style={{ width: 34, height: 34, padding: 0 }}><Ic n="undo" size={16} /></button> : null}
              </div>
            ) : notFee ? (
              <div className="card" style={{ background: "var(--s2)" }}>
                <span className="ac-ib" style={{ background: "var(--s3)", color: "var(--mut)" }}><Ic n="minus" /></span>
                <span className="ac-c ac-1"><span className="ac-b">{tx(p("Not a fee payment", "फीस का भुगतान नहीं"))}</span><span className="ac-m">{tx(p("Kept out of fee totals", "फीस के जोड़ से बाहर"))}</span></span>
                <span className="ac-c" style={{ alignItems: "flex-end", gap: 4 }}><span className="num ac-v">{rupees(r.amount)}</span><span className="pill" style={{ background: "var(--s3)", color: "var(--mut)" }}>{tx(p("Set aside", "अलग रखा"))}</span></span>
                {canAct ? <button type="button" className="tap btn ghost" aria-label={tx(p("Undo", "वापस लें"))} disabled={busy} onClick={() => onUndo(r.id)} style={{ width: 34, height: 34, padding: 0 }}><Ic n="undo" size={16} /></button> : null}
              </div>
            ) : (
              <div className="card ac-c" style={{ alignItems: "stretch", gap: 8, borderColor: "var(--warnm)", background: "var(--warns)" }}>
                <span className="ac-b" style={{ color: "var(--warnfg)" }}>{tx(p("No receipt found for this payment", "इस भुगतान की कोई रसीद नहीं मिली"))}</span>
                <span className="ac-m" style={{ color: "var(--warnfg)" }}>
                  {tx(
                    best
                      ? p(`Looks like ${best.receiptNumber} · ${best.studentName} · ${why(best.why).en}.${r.suggestions.length > 1 ? ` ${r.suggestions.length - 1} more could be it.` : ""}`, `शायद ${best.receiptNumber} · ${best.studentName} · ${why(best.why).hi}।${r.suggestions.length > 1 ? ` ${r.suggestions.length - 1} और भी हो सकती हैं।` : ""}`)
                      : p("If the parent paid but no receipt was made, make one at the Payment Desk.", "अगर अभिभावक ने भुगतान किया पर रसीद नहीं बनी, तो फीस जमा पर रसीद बनाएँ।"),
                  )}
                </span>
                {canAct ? (
                  <div className="ac-f ac-w" style={{ gap: 6 }}>
                    {r.suggestions.length ? <button type="button" className="tap btn pri ac-s" onClick={() => onMatch(r)}><Ic n="link" size={16} />{tx(p("Match with a receipt", "रसीद से मिलाएँ"))}</button> : null}
                    <Link href="/payments" className="tap btn sec ac-s">{tx(p("Make a receipt", "रसीद बनाएँ"))}</Link>
                    <button type="button" className="tap btn ghost ac-s" style={{ padding: "0 8px" }} disabled={busy} onClick={() => onNotFee(r.id)}>{tx(p("Not a fee payment", "फीस का भुगतान नहीं"))}</button>
                  </div>
                ) : null}
              </div>
            )}
          </div>
        );
      })}
      {rows.length === 0 ? (
        <Card className="ac-c" style={{ padding: 30, alignItems: "center", gap: 8, textAlign: "center" }}>
          <span className="ac-v">{tx(filter === "open" ? p("Nothing needs you", "आपके लिए कुछ नहीं") : p("No bank lines here", "यहाँ कोई बैंक लाइन नहीं"))}</span>
          <span className="ac-m">{tx(total ? p("Matched pairs are under All and Matched.", "मिले हुए जोड़े ‘सब’ और ‘मिले’ में हैं।") : p("Upload this week’s statement from the bank app.", "बैंक ऐप से इस हफ़्ते का स्टेटमेंट डालें।"))}</span>
        </Card>
      ) : null}
    </div>
  );
}

function RefundsPane({ data, canAct, onRequest, onSeeRequests }: { data: BooksData; canAct: boolean; onRequest: (studentId: string) => void; onSeeRequests: () => void }) {
  const { tx } = useVx();
  const refundReqs = data.requests.filter((r) => r.kind === "refund").slice(0, 6);
  const askedFor = new Set(data.requests.filter((r) => r.kind === "refund" && r.status === "waiting" && r.studentId).map((r) => r.studentId as string));
  const refundDone = (status: string) => ["approved", "processed", "paid", "completed", "refunded"].includes(status);
  const reqs = [
    ...refundReqs.map((q) => ({ id: q.id, who: q.studentName ?? q.title, why: reasonP(q.reason), amount: q.amount, done: q.status === "approved", declined: q.status === "declined", status: q.status === "waiting" ? p("Waiting for the admin", "एडमिन के पास बाकी") : q.status === "approved" ? p(`Approved${q.decidedByName ? ` by ${q.decidedByName}` : ""}`, `${q.decidedByName ? `${q.decidedByName} ने ` : ""}मंज़ूर किया`) : q.status === "declined" ? p("Declined", "मना किया") : p("Withdrawn", "वापस लिया") })),
    ...data.feeRefunds.map((r) => ({ id: r.id, who: r.studentName, why: p(`${r.reason} · ${day(r.refundDate)}`), amount: r.amount, done: refundDone(r.status), declined: r.status === "rejected" || r.status === "declined", status: refundStatus(r.status) })),
  ];
  return (
    <div className="stack" style={{ display: "grid", gridTemplateColumns: "minmax(0,1.15fr) minmax(0,1fr)", gap: 16, alignItems: "start", animation: "xIn .32s var(--ease) both" }}>
      <Card className="ac-c" style={{ padding: "16px 18px 8px" }}>
        <div className="ac-f ac-j" style={{ marginBottom: 4 }}>
          <span className="ac-c"><span className="ac-v">{tx(p("Advances held for families", "परिवारों की अग्रिम राशि"))}</span><span className="ac-m">{tx(p("Paid more than the fee. Used for the next fee unless you ask for a refund.", "फीस से ज़्यादा भरा। रिफ़ंड न माँगें तो अगली फीस में लगेगा।"))}</span></span>
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
              <span className="ac-m" style={{ paddingLeft: 50 }}>{tx(a.refundable > 0 ? p(`${rupees(a.refundable)} of it can be refunded.`, `इसमें से ${rupees(a.refundable)} रिफ़ंड हो सकते हैं।`) : p("Held for the next fee.", "अगली फीस के लिए रखा है।"))}</span>
              <div className="ac-f ac-w" style={{ paddingLeft: 50, gap: 6 }}>
                <span className="pill" style={{ height: 26, padding: "0 10px", background: asked ? "var(--warns)" : "var(--infos)", color: asked ? "var(--warnfg)" : "var(--info)", animation: "xPopIn .4s var(--spring) both" }}><Ic n={asked ? "clock" : "calendar"} size={13} />{tx(asked ? p("Refund asked · waiting for admin", "रिफ़ंड माँगा · एडमिन के पास बाकी") : p("Used for the next fee", "अगली फीस में लगेगा"))}</span>
                <span className="ac-1" />
                {asked ? (
                  <button type="button" className="tap btn ghost ac-s" onClick={onSeeRequests}><Ic n="chevRight" size={16} />{tx(p("See request", "अनुरोध देखें"))}</button>
                ) : canAct ? (
                  <button type="button" className="tap btn sec ac-s" onClick={() => onRequest(a.studentId)}><Ic n="swap" size={16} />{tx(p("Request refund", "रिफ़ंड माँगें"))}</button>
                ) : null}
              </div>
            </div>
          );
        })}
        {data.advances.length === 0 ? <span className="ac-m" style={{ padding: "14px 0" }}>{tx(p("No family has paid ahead.", "किसी परिवार ने आगे का नहीं भरा।"))}</span> : null}
      </Card>
      <div className="ac-c" style={{ gap: 16 }}>
        <Card className="ac-c" style={{ padding: "16px 18px 8px" }}>
          <div className="ac-f ac-j" style={{ marginBottom: 4 }}><span className="ac-v">{tx(p("Refund requests", "रिफ़ंड के अनुरोध"))}</span><span className="ac-m">{tx(p("The admin approves every refund", "हर रिफ़ंड एडमिन मंज़ूर करते हैं"))}</span></div>
          {reqs.map((q, i) => {
            const tone = q.done ? ["var(--oks)", "var(--ok)"] : q.declined ? ["var(--bads)", "var(--bad)"] : ["var(--warns)", "var(--warnfg)"];
            return (
              <div key={q.id} className="ac-f" style={{ gap: 12, padding: "12px 0", borderTop: i ? "1px solid var(--bd)" : "0", alignItems: "flex-start", animation: "xIn .32s var(--ease) both", animationDelay: delay(i) }}>
                <span className="ac-ib" style={{ background: tone[0], color: tone[1] }}><Ic n={q.done ? "check" : q.declined ? "x" : "clock"} /></span>
                <span className="ac-c ac-1" style={{ gap: 2 }}><span className="ac-b">{q.who}</span><span className="ac-m">{tx(q.why)}</span><span className="pill" style={{ alignSelf: "flex-start", marginTop: 4, background: tone[0], color: tone[1] }}>{tx(q.status)}</span></span>
                <span className="num ac-v">{rupees(q.amount)}</span>
              </div>
            );
          })}
          {reqs.length === 0 ? <span className="ac-m" style={{ padding: "10px 0" }}>{tx(p("No refund requests yet.", "अभी कोई रिफ़ंड अनुरोध नहीं।"))}</span> : null}
          <button type="button" className="tap btn ghost" onClick={onSeeRequests} style={{ alignSelf: "flex-start", margin: "4px 0 8px", color: "var(--acc)" }}>{tx(p("See all in My requests", "सब ‘मेरे अनुरोध’ में देखें"))}<Ic n="chevRight" size={16} /></button>
        </Card>
        <div className="ac-in" style={{ background: "var(--infos)", color: "var(--info)" }}>
          <Ic n="shield" style={{ marginTop: 2 }} />
          <span>{tx(p("Refunds are never paid from the counter cash without the admin’s OK. After approval the refund is written in Finance controls as its own row; the family’s history keeps both.", "एडमिन की मंज़ूरी के बिना काउंटर की नकदी से कभी रिफ़ंड नहीं दिया जाता। मंज़ूरी के बाद रिफ़ंड फ़ाइनेंस कंट्रोल में अपनी अलग पंक्ति में लिखा जाता है; परिवार के इतिहास में दोनों रहते हैं।"))}</span>
        </div>
      </div>
    </div>
  );
}

function RequestsPane({ data, canAct, busy, onWithdraw, onRemind, onDecide }: { data: BooksData; canAct: boolean; busy: boolean; onWithdraw: (id: string) => void; onRemind: (id: string) => void; onDecide: (r: AccRequestRow) => void }) {
  const { tx } = useVx();
  const [filter, setFilter] = useState<"all" | "waiting" | "done">("all");
  const waiting = data.requests.filter((r) => r.status === "waiting").length;
  const rows = data.requests.filter((r) => (filter === "all" ? true : filter === "waiting" ? r.status === "waiting" : r.status !== "waiting"));
  return (
    <div className="ac-c" style={{ gap: 12, animation: "xIn .32s var(--ease) both" }}>
      <div className="ac-f ac-w" style={{ gap: 10 }}>
        <div className="mfull" style={{ width: 360, maxWidth: "100%" }}>
          <Seg value={filter} onChange={setFilter} label={tx(p("Show", "दिखाएँ"))} style={{ width: "100%" }} options={[{ value: "all", label: tx(p(`All · ${data.requests.length}`, `सब · ${data.requests.length}`)) }, { value: "waiting", label: tx(p(`Waiting · ${waiting}`, `बाकी · ${waiting}`)) }, { value: "done", label: tx(p(`Decided · ${data.requests.length - waiting}`, `तय · ${data.requests.length - waiting}`)) }]} />
        </div>
        <span className="ac-m">{tx(data.canDecide ? p("Approve or decline what the office asks. The fee change itself is made in the fee screens.", "ऑफ़िस जो माँगे उसे मंज़ूर करें या मना करें। फीस का बदलाव फीस वाली स्क्रीन पर ही होता है।") : p("Late-fee waivers, reversals and refunds go to the admin in Needs you.", "लेट फीस माफ़ी, रसीद वापसी और रिफ़ंड एडमिन के ‘आपके लिए’ में जाते हैं।"))}</span>
      </div>
      <div className="stack" style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0,1fr))", gap: 12, alignItems: "start" }}>
        {rows.map((q, i) => {
          const decided = q.status === "approved" || q.status === "declined" || q.status === "withdrawn";
          const tone = q.status === "approved" ? ["var(--oks)", "var(--ok)"] : q.status === "declined" ? ["var(--bads)", "var(--bad)"] : q.status === "withdrawn" ? ["var(--s3)", "var(--mut)"] : ["var(--warns)", "var(--warnfg)"];
          const isNew = q.status === "waiting" && schoolDay(q.requestedAt) === data.today;
          const endColor = q.status === "declined" ? "var(--bad)" : q.status === "withdrawn" ? "var(--mut)" : "var(--ok)";
          // Sent → reminded (or with the admin once decided) → the decision. There is no "seen" record, so the middle step says what is known.
          const steps = [
            { label: tx(p("Sent", "भेजा")), when: tx(stamp(q.requestedAt, data.today)), done: true, color: "var(--ok)", icon: "send" as IconName },
            { label: tx(q.remindedAt || !decided ? p("Reminded", "याद दिलाया") : p("With the admin", "एडमिन के पास")), when: q.remindedAt ? tx(stamp(q.remindedAt, data.today)) : decided ? "" : tx(p("not yet", "अभी नहीं")), done: Boolean(q.remindedAt) || decided, color: "var(--ok)", icon: (q.remindedAt || !decided ? "bell" : "inbox") as IconName },
            decided
              ? { label: tx(q.status === "approved" ? p("Approved", "मंज़ूर") : q.status === "declined" ? p("Declined", "मना") : p("Withdrawn", "वापस लिया")), when: q.decidedAt ? tx(stamp(q.decidedAt, data.today)) : q.withdrawnAt ? tx(stamp(q.withdrawnAt, data.today)) : "", done: true, color: endColor, icon: (q.status === "approved" ? "check" : "x") as IconName }
              : { label: tx(p("Waiting", "बाकी")), when: tx(p("with the admin", "एडमिन के पास")), done: false, color: "var(--ok)", icon: "clock" as IconName },
          ];
          const fill = decided ? "100%" : q.remindedAt ? "50%" : "0%";
          const note = q.decisionNote ? (q.status === "declined" ? `“${q.decisionNote}”${q.decidedByName ? ` — ${q.decidedByName}` : ""}` : `${q.status === "approved" && q.decidedByName ? tx(p(`Approved by ${q.decidedByName}. `, `${q.decidedByName} ने मंज़ूर किया। `)) : ""}${q.decisionNote}`) : null;
          return (
            <Card key={q.id} className="ac-c" style={{ padding: "14px 16px", gap: 12, borderColor: isNew ? "var(--acc)" : undefined, animation: "xIn .32s var(--ease) both", animationDelay: delay(i) }}>
              <div className="ac-f" style={{ gap: 12, alignItems: "flex-start" }}>
                <span className="ac-ib" style={{ background: tone[0], color: tone[1] }}><Ic n={KIND_ICON[q.kind] ?? "inbox"} /></span>
                <span className="ac-c ac-1" style={{ gap: 1 }}>
                  <span className="ac-f ac-w" style={{ gap: 6 }}><span className="ac-b" style={{ fontWeight: 700 }}>{tx(KIND_LABEL[q.kind] ?? KIND_LABEL.other)}</span>{isNew ? <span className="pill" style={{ background: "var(--accs)", color: "var(--accfg)", animation: "xPopIn .4s var(--spring) both" }}>{tx(p("New", "नया"))}</span> : null}</span>
                  <span className="ac-m">{tx(titleP(q.title))}{q.studentName ? ` · ${q.studentName}` : ""}{q.mine ? "" : tx(p(` · asked by ${q.requestedByName}`, ` · ${q.requestedByName} ने माँगा`))}</span>
                  <span className="ac-m" style={{ color: "var(--sub)" }}>{tx(reasonP(q.reason))}</span>
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
              {/* A Receipts-desk request is history here; it is decided on its receipt (B08). */}
              {q.status === "waiting" && canAct && q.source !== "desk" ? (
                <div className="ac-f" style={{ gap: 6, justifyContent: "flex-end" }}>
                  {q.mine ? (
                    <>
                      <button type="button" className="tap btn ghost ac-s" style={{ color: "var(--bad)" }} disabled={busy} onClick={() => onWithdraw(q.id)}>{tx(p("Withdraw", "वापस लें"))}</button>
                      <button type="button" className="tap btn sec ac-s" disabled={busy || !q.canRemind} onClick={() => onRemind(q.id)}><Ic n="bell" size={16} />{tx(q.canRemind ? p("Remind admin", "एडमिन को याद दिलाएँ") : p("Reminded", "याद दिलाया"))}</button>
                    </>
                  ) : null}
                  {data.canDecide ? <button type="button" className="tap btn pri ac-s" onClick={() => onDecide(q)}><Ic n="check" size={16} />{tx(p("Decide", "तय करें"))}</button> : null}
                </div>
              ) : null}
            </Card>
          );
        })}
      </div>
      {rows.length === 0 ? (
        <Card className="ac-c" style={{ padding: 30, alignItems: "center", gap: 8, textAlign: "center" }}>
          <span className="ac-v">{tx(p("Nothing here", "यहाँ कुछ नहीं"))}</span>
          <span className="ac-m">{tx(p("Requests you send to the admin show up here with their status.", "एडमिन को भेजे आपके अनुरोध अपनी स्थिति के साथ यहाँ दिखते हैं।"))}</span>
        </Card>
      ) : null}
    </div>
  );
}

function SheetFooter({ onCancel, onOk, okLabel, okIcon, cancelIcon, disabled, danger, cancelLabel }: { onCancel: () => void; onOk: () => void; okLabel: string; okIcon?: IconName; cancelIcon?: IconName; disabled?: boolean; danger?: boolean; cancelLabel?: string }) {
  const { tx } = useVx();
  return (
    <>
      <button type="button" className="tap btn sec" style={{ flex: 1, height: 48 }} onClick={onCancel}>
        {cancelIcon ? <Ic n={cancelIcon} /> : null}
        {cancelLabel ?? tx(p("Cancel", "रद्द करें"))}
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
  const { tx } = useVx();
  // The slip is written on the bank the school used last time, and today's date; both can be changed on the slip.
  const [bank, setBank] = useState(data.slips[0]?.bankLabel ?? "State Bank of India · school account");
  const [date, setDate] = useState(data.today);
  const dateRef = useRef<HTMLInputElement>(null);
  // The number the server will give it (same rule, `nextSlipNumber`), unless another slip lands first.
  const slipNo = nextSlipNumber(data.slips.map((s) => s.slipNo));
  const count = tx(chequesWord(chosen.length));
  return (
    <Sheet
      open={open}
      onClose={onClose}
      wide
      title={tx(p(`Deposit slip ${slipNo}`, `जमा पर्ची ${slipNo}`))}
      sub={`${count} · ${rupees(total)} · ${tx(day(date))}`}
      footer={
        <SheetFooter
          onCancel={() => window.print()}
          cancelLabel={tx(p("Print", "छापें"))}
          cancelIcon="printer"
          onOk={() => run(() => createDepositSlipAction({ receiptIds: chosen.map((c) => c.receiptId), bankLabel: bank, depositedOn: date }), () => { clearPicked(); onClose(); })}
          okLabel={tx(p("Mark as deposited", "जमा हो गया"))}
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
              <textarea className="ac-inline serif" rows={1} aria-label={tx(p("Bank and account", "बैंक और खाता"))} value={bank} onChange={(e) => setBank(e.target.value.replace(/\n/g, " "))} style={{ fontSize: 16, fontWeight: 600, lineHeight: 1.35 }} />
              <span className="ac-m">{tx(p(`Pay-in slip · cheques · ${slipNo}`, `जमा पर्ची · चेक · ${slipNo}`))}</span>
            </span>
            <span className="num ac-m ac-c" style={{ alignItems: "flex-end", position: "relative" }}>
              {tx(p("Date", "तारीख"))}
              <button
                type="button"
                className="tap ac-inline num"
                aria-label={tx(p(`Deposited on ${slipDate(date)} · change`, `${slipDate(date)} को जमा · बदलें`))}
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
              <input ref={dateRef} type="date" className="sr" tabIndex={-1} aria-label={tx(p("Deposited on", "जमा की तारीख"))} value={date} max={data.today} onChange={(e) => e.target.value && setDate(e.target.value)} />
            </span>
          </div>
          <div className="ac-c" style={{ fontSize: 13 }}>
            <span className="ac-m" style={{ fontSize: 11 }}>{tx(p("Account name", "खाते का नाम"))}</span>
            <span style={{ fontWeight: 600 }}>{process.env.NEXT_PUBLIC_SCHOOL_NAME ?? "School"}</span>
          </div>
          <div className="ac-c">
            <div className="ac-sr" style={{ borderTop: 0, paddingBottom: 4 }}><span className="sech">#</span><span className="sech">{tx(p("Cheque", "चेक"))}</span><span className="sech c3">{tx(p("Drawn on", "किस बैंक का"))}</span><span className="sech" style={{ textAlign: "right" }}>{tx(p("Amount", "राशि"))}</span></div>
            {chosen.map(withDeskChequeDetails).map((d, i) => (
              <div key={d.receiptId} className="ac-sr" style={{ animation: "xIn .3s var(--ease) both", animationDelay: `${i * 60}ms` }}>
                <span className="num ac-m">{i + 1}</span>
                <span className="ac-c"><span className="num" style={{ fontWeight: 700 }}>{d.chequeNo ?? tx(p("no. not written", "नं. नहीं लिखा"))}</span><span className="ac-m ac-e">{family(d).title}</span></span>
                <span className="c3 ac-m ac-e">{d.bank ?? "—"}</span>
                <span className="num" style={{ textAlign: "right", fontWeight: 700 }}>{rupees(d.amount)}</span>
              </div>
            ))}
            {chosen.length === 0 ? <span className="ac-m" style={{ padding: "10px 0" }}>{tx(p("Tick the cheques you are taking to the bank, then make the slip.", "बैंक ले जाने वाले चेक चुनें, फिर पर्ची बनाएँ।"))}</span> : null}
            <div className="ac-f ac-j" style={{ padding: "10px 0 2px", borderTop: "2px solid var(--bd)" }}><span className="ac-b" style={{ fontWeight: 700 }}>{tx(p("Total", "कुल"))} · {count}</span><span className="num" style={{ fontSize: 20, fontWeight: 700 }}>{rupees(total)}</span></div>
            <span style={{ fontSize: 12, color: "var(--mut)", fontStyle: "italic" }}>{amountInWords(total).replace(/^(Rupees )(.*)( only)$/, (_, a: string, words: string, b: string) => `${a}${words.toLowerCase()}${b}`)}</span>
          </div>
          <div className="ac-f ac-j" style={{ paddingTop: 10, borderTop: "1.5px dashed var(--bds)", fontSize: 12, color: "var(--mut)" }}><span>{tx(p(`Deposited by ${staffName}`, `जमाकर्ता: ${staffName}`))}</span><span>{tx(p("Signature", "हस्ताक्षर"))} ____________</span></div>
        </div>
        {chosen.some((c) => !withDeskChequeDetails(c).chequeNo) ? <div className="ac-in" style={{ background: "var(--warns)", color: "var(--warnfg)" }}><Ic n="alert" style={{ marginTop: 2 }} /><span>{tx(p("Some cheques have no number written. Add the details from the list so the bank slip is complete.", "कुछ चेकों पर नंबर नहीं लिखा। बैंक पर्ची पूरी करने के लिए सूची से विवरण जोड़ें।"))}</span></div> : null}
        <div className="ac-in" style={{ background: "var(--infos)", color: "var(--info)" }}><Ic n="info" style={{ marginTop: 2 }} /><span>{tx(p("Print two copies. After the bank stamps the slip, tap ", "दो कॉपी छापें। बैंक की मुहर लगने के बाद "))}<b>{tx(p("Mark as deposited", "जमा हो गया"))}</b>{tx(p(". Cheques usually clear in 2–3 working days.", " दबाएँ। चेक आम तौर पर 2–3 कामकाजी दिनों में क्लियर होते हैं।"))}</span></div>
      </Stack>
    </Sheet>
  );
}

function BounceSheet({ open, onClose, cheque, deposited, pick, canAct, busy, run }: { open: boolean; onClose: () => void; cheque: ChequeRow | null; deposited: ChequeRow[]; pick: (id: string) => void; canAct: boolean; busy: boolean; run: Run }) {
  const { tx } = useVx();
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
      title={tx(cheque ? p(`Cheque ${cheque.chequeNo ?? cheque.receiptNumber} bounced?`, `चेक ${cheque.chequeNo ?? cheque.receiptNumber} बाउंस हुआ?`) : p("Cheque bounced?", "चेक बाउंस हुआ?"))}
      sub={cheque && who ? `${who.title} · ${who.sub} · ${rupees(cheque.amount)} · ${cheque.receiptNumber}` : tx(p("Pick the cheque", "चेक चुनें"))}
      footer={<SheetFooter onCancel={onClose} cancelLabel={tx(p("Not bounced", "बाउंस नहीं हुआ"))} cancelIcon="x" onOk={() => cheque && run(() => bounceChequeAction({ receiptId: cheque.receiptId, reason, note }), onClose)} okLabel={tx(p("Mark bounced", "बाउंस दर्ज करें"))} okIcon="alert" danger disabled={!canAct || busy || !cheque} />}
    >
      <Stack>
        {!cheque ? (
          <Field label={tx(p("Which cheque?", "कौन सा चेक?"))}>
            <Select value="" onChange={(e) => pick(e.target.value)}>
              <option value="">{tx(p("Pick a deposited cheque", "जमा हुआ चेक चुनें"))}</option>
              {deposited.map((c) => (
                <option key={c.receiptId} value={c.receiptId}>{c.chequeNo ?? c.receiptNumber} · {family(c).title} · {rupees(c.amount)}</option>
              ))}
            </Select>
          </Field>
        ) : null}
        <span className="sech">{tx(p("What did the bank say?", "बैंक ने क्या कहा?"))}</span>
        {BOUNCE_REASONS.map((r) => <RadioCard key={r.value} checked={reason === r.value} onSelect={() => setReason(r.value)} title={tx(r.label)} />)}
        {reason === "Other" ? <Field label={tx(p("What the bank wrote", "बैंक ने क्या लिखा"))}><Input value={note} onChange={(e) => setNote(e.target.value)} placeholder={tx(p("For example: date on the cheque has passed", "जैसे: चेक की तारीख निकल गई"))} /></Field> : null}
        <div className="ac-in" style={{ flexDirection: "column", gap: 8, background: "var(--warns)", color: "var(--warnfg)" }}>
          <span style={{ fontWeight: 700 }}>{tx(p("What happens next", "आगे क्या होगा"))}</span>
          <span className="ac-f" style={{ alignItems: "flex-start", gap: 10 }}><Ic n="undo" style={{ marginTop: 2 }} /><span>{tx(p(`Receipt ${cheque?.receiptNumber ?? ""} gets reversed after the admin approves. Nothing changes before that.`, `एडमिन की मंज़ूरी के बाद रसीद ${cheque?.receiptNumber ?? ""} वापस होगी। उससे पहले कुछ नहीं बदलता।`))}</span></span>
          <span className="ac-f" style={{ alignItems: "flex-start", gap: 10 }}><Ic n="rupee" style={{ marginTop: 2 }} /><span>{tx(p(`${cheque ? rupees(cheque.amount) : "The fee"} comes back as pending on the ${surname} family. Late fee stays separate.`, `${cheque ? rupees(cheque.amount) : "फीस"} ${surname} परिवार पर फिर से बकाया हो जाएगी। लेट फीस अलग रहती है।`))}</span></span>
          <span className="ac-f" style={{ alignItems: "flex-start", gap: 10 }}><Ic n="archive" style={{ marginTop: 2 }} /><span>{tx(p("The receipt stays in history with its reversal. Nothing is deleted.", "रसीद अपनी वापसी के साथ इतिहास में रहती है। कुछ भी मिटाया नहीं जाता।"))}</span></span>
        </div>
        <button type="button" role="switch" aria-checked={tell} className="tap card ac-f" onClick={() => setTell(!tell)} style={{ padding: "12px 14px", gap: 12, textAlign: "left", color: "var(--fg)", width: "100%" }}>
          <Ic n="message" />
          <span className="ac-c ac-1"><span className="ac-b">{tx(p("Tell the parent", "अभिभावक को बताएँ"))}</span><span className="ac-m">{tx(tell ? p("Copy it into WhatsApp · nothing is sent from here", "WhatsApp में कॉपी करें · यहाँ से कुछ नहीं भेजा जाता") : p("The parent is not told now. You can call them instead.", "अभिभावक को अभी नहीं बताया जाएगा। आप फ़ोन कर सकते हैं।"))}</span></span>
          <span className={`sw${tell ? " on" : ""}`}><span /></span>
        </button>
        {tell && cheque ? (
          <div className="ac-wa">
            <div className="ac-wab">
              <p>{hi}</p>
              <hr />
              <p>{en}</p>
            </div>
            <button type="button" className="tap btn ghost ac-s" style={{ marginTop: 8 }} onClick={() => void navigator.clipboard?.writeText(`${hi}\n\n${en}`)}><Ic n="copy" size={16} />{tx(p("Copy message", "संदेश कॉपी करें"))}</button>
          </div>
        ) : null}
      </Stack>
    </Sheet>
  );
}

function UploadSheet({ open, onClose, canAct, busy, run }: { open: boolean; onClose: () => void; canAct: boolean; busy: boolean; run: Run }) {
  const { tx } = useVx();
  const [text, setText] = useState("");
  const [bank, setBank] = useState("School account");
  const lines = text.split(/\r?\n/).filter((l) => l.trim()).length;
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={tx(p("New bank statement", "नया बैंक स्टेटमेंट"))}
      sub={tx(p("UPI payments from the bank app, as CSV", "बैंक ऐप से UPI भुगतान, CSV में"))}
      footer={<SheetFooter onCancel={onClose} cancelIcon="x" onOk={() => run(() => uploadStatementAction({ text, bankLabel: bank }), () => { setText(""); onClose(); })} okLabel={tx(p(`Add ${lines || ""} payments`, `${lines || ""} भुगतान जोड़ें`))} okIcon="upload" disabled={!canAct || busy || lines === 0} />}
    >
      <Stack>
        <Field label={tx(p("Choose the CSV file", "CSV फ़ाइल चुनें"))}>
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
        <Field label={tx(p("…or paste the lines", "…या लाइनें चिपकाएँ"))} hint={tx(p("One payment a line: date, amount, payer, UPI ref. For example 08/10/2026 10:41, 3150, RAKESH S, 427815093316", "हर लाइन में एक भुगतान: तारीख, राशि, भरने वाला, UPI रेफ़। जैसे 08/10/2026 10:41, 3150, RAKESH S, 427815093316"))}>
          <Textarea value={text} onChange={(e) => setText(e.target.value)} rows={7} placeholder={tx(p("Date, Amount, Payer, UPI ref", "तारीख, राशि, भरने वाला, UPI रेफ़"))} style={{ fontFamily: "var(--mono, monospace)", fontSize: 13 }} />
        </Field>
        <Field label={tx(p("Account", "खाता"))}><Input value={bank} onChange={(e) => setBank(e.target.value)} /></Field>
        <div className="ac-in" style={{ background: "var(--infos)", color: "var(--info)" }}><Ic n="info" style={{ marginTop: 2 }} /><span>{tx(p("A payment already uploaded (same UPI ref and amount) is skipped, so uploading the same file twice is safe.", "पहले से डाला गया भुगतान (वही UPI रेफ़ और राशि) छोड़ दिया जाता है, इसलिए एक ही फ़ाइल दो बार डालना सुरक्षित है।"))}</span></div>
      </Stack>
    </Sheet>
  );
}

function RefundSheet({ open, onClose, data, studentId: initialStudent, canAct, busy, run }: { open: boolean; onClose: () => void; data: BooksData; studentId: string | null; canAct: boolean; busy: boolean; run: Run }) {
  const { tx } = useVx();
  const [studentId, setStudentId] = useState(initialStudent ?? data.advances[0]?.studentId ?? "");
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState(REFUND_REASONS[0].value);
  const [method, setMethod] = useState("bank_transfer");
  const [note, setNote] = useState("");
  const adv = data.advances.find((a) => a.studentId === studentId);
  const n = Number(amount.replace(/[^\d]/g, ""));
  const tooMuch = Boolean(adv && n > adv.credit);
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={tx(p("Request a refund", "रिफ़ंड माँगें"))}
      sub={tx(adv ? p(`${family(adv).title} · ${family(adv).sub} · ${rupees(adv.credit)} held`, `${family(adv).title} · ${family(adv).sub} · ${rupees(adv.credit)} जमा`) : p("The admin approves every refund", "हर रिफ़ंड एडमिन मंज़ूर करते हैं"))}
      footer={<SheetFooter onCancel={onClose} cancelIcon="x" onOk={() => run(() => requestRefundAction({ studentId, amount: n, reason, method, note }), () => { setAmount(""); setNote(""); onClose(); })} okLabel={tx(p("Send to admin", "एडमिन को भेजें"))} okIcon="send" disabled={!canAct || busy || !adv || !n || tooMuch} />}
    >
      <Stack>
        <Field label={tx(p("For which family?", "किस परिवार के लिए?"))}>
          <Select value={studentId} onChange={(e) => setStudentId(e.target.value)}>
            {data.advances.map((a) => (
              <option key={a.studentId} value={a.studentId}>{`${family(a).title} · ${a.studentName.split(" ")[0]} · ${tx(p(`${rupees(a.credit)} held`, `${rupees(a.credit)} जमा`))}`}</option>
            ))}
          </Select>
        </Field>
        <Field label={tx(p("Amount to give back (₹)", "लौटाने की राशि (₹)"))} error={tooMuch ? tx(p(`Only ${rupees(adv?.credit)} is held for this family.`, `इस परिवार के सिर्फ़ ${rupees(adv?.credit)} जमा हैं।`)) : undefined}>
          <Input inputMode="numeric" value={amount} invalid={tooMuch} onChange={(e) => setAmount(e.target.value)} placeholder={adv ? String(adv.credit) : ""} />
        </Field>
        <span className="sech">{tx(p("Why?", "क्यों?"))}</span>
        <div className="stack" style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0,1fr))", gap: 8 }}>
          {REFUND_REASONS.map((r) => <RadioCard key={r.value} checked={reason === r.value} onSelect={() => setReason(r.value)} title={tx(r.label)} />)}
        </div>
        <span className="sech">{tx(p("Pay back by", "कैसे लौटाएँ"))}</span>
        <div className="ac-f ac-w" style={{ gap: 6 }}>{METHODS.map((m) => <Chip key={m.value} on={method === m.value} onClick={() => setMethod(m.value)}>{tx(m.label)}</Chip>)}</div>
        <Field label={tx(p("Note for the admin (optional)", "एडमिन के लिए नोट (ज़रूरी नहीं)"))}><Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder={tx(p("For example: father asked on the phone, bank details are on file", "जैसे: पिता ने फ़ोन पर कहा, बैंक का विवरण फ़ाइल में है"))} style={{ minHeight: 64 }} /></Field>
        <div className="ac-in" style={{ background: "var(--warns)", color: "var(--warnfg)" }}><Ic n="info" style={{ marginTop: 2 }} /><span>{tx(adv && n ? p(`Nothing is paid yet. After the admin approves, ${rupees(adv.credit - Math.min(n, adv.credit))} stays as advance for ${adv.studentName}.`, `अभी कुछ नहीं दिया गया। एडमिन की मंज़ूरी के बाद ${adv.studentName} के ${rupees(adv.credit - Math.min(n, adv.credit))} अग्रिम में रहेंगे।`) : p("Nothing moves until the admin approves.", "एडमिन की मंज़ूरी तक कुछ नहीं बदलता।"))}</span></div>
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
      title={tx(p("Cheque details", "चेक का विवरण"))}
      sub={`${cheque.receiptNumber} · ${cheque.studentName} · ${rupees(cheque.amount)}`}
      footer={<SheetFooter onCancel={onClose} cancelIcon="x" onOk={() => run(() => saveChequeDetailsAction({ receiptId: cheque.receiptId, chequeNo: no, bank, chequeDate: date }), onClose)} okLabel={tx(p("Save details", "विवरण सहेजें"))} okIcon="check" disabled={!canAct || busy} />}
    >
      <Stack>
        <Field label={tx(p("Cheque number", "चेक नंबर"))}><Input inputMode="numeric" value={no} onChange={(e) => setNo(e.target.value)} /></Field>
        <Field label={tx(p("Bank and branch", "बैंक और शाखा"))}><Input value={bank} onChange={(e) => setBank(e.target.value)} placeholder={tx(p("For example: SBI Amet", "जैसे: SBI आमेट"))} /></Field>
        <Field label={tx(p("Date on the cheque", "चेक पर तारीख"))}><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
        {cheque.receiptNotes?.trim() ? (
          <Card className="ac-c" style={{ padding: 12, gap: 6 }}>
            <span className="ac-b">{tx(p("Recorded on receipt", "रसीद पर दर्ज"))}</span>
            <span className="ac-m" style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{cheque.receiptNotes}</span>
            <span className="ac-m">{tx(draft.suggested ? p("Review the suggested details, then save them for the cheque register.", "सुझाया गया विवरण जाँचें, फिर चेक रजिस्टर के लिए सहेजें।") : p("Check the receipt details before saving them for the cheque register.", "चेक रजिस्टर में सहेजने से पहले रसीद का विवरण जाँचें।"))}</span>
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
  const { tx } = useVx();
  const [pick, setPick] = useState(line.suggestions[0]?.id ?? "");
  return (
    <Sheet
      open
      onClose={onClose}
      title={tx(p(`${rupees(line.amount)} from ${line.payer}`, `${line.payer} से ${rupees(line.amount)}`))}
      sub={tx(p(`${day(line.txnAt)} · ${time12(line.txnAt)} · UPI ref ••${line.utr.slice(-4)}`, `${day(line.txnAt)} · ${time12(line.txnAt)} · UPI रेफ़ ••${line.utr.slice(-4)}`))}
      footer={<SheetFooter onCancel={onClose} cancelIcon="x" onOk={() => run(() => matchUpiAction(line.id, pick), onClose)} okLabel={tx(p("Match", "मिलाएँ"))} okIcon="link" disabled={!canAct || busy || !pick} />}
    >
      <Stack gap={8}>
        <span className="sech">{tx(p("Receipts for the same amount", "इसी राशि की रसीदें"))}</span>
        {line.suggestions.map((s) => (
          <RadioCard
            key={s.id}
            checked={pick === s.id}
            onSelect={() => setPick(s.id)}
            title={`${s.receiptNumber} · ${s.studentName}`}
            sub={tx(p(`${s.classLabel ? `${s.classLabel} · ` : ""}${day(s.paymentDate)}${s.referenceNumber ? ` · ref ${s.referenceNumber}` : ""}`, `${s.classLabel ? `${s.classLabel} · ` : ""}${day(s.paymentDate)}${s.referenceNumber ? ` · रेफ़ ${s.referenceNumber}` : ""}`))}
            trail={<span className="ac-c" style={{ alignItems: "flex-end" }}><span className="num ac-v">{rupees(s.amount)}</span><Pill tone={s.why === "ref" ? "ok" : s.why === "amount_day" ? "info" : "mut"}>{tx(s.why === "ref" ? p("Same UPI ref", "UPI रेफ़ एक जैसा") : s.why === "amount_day" ? p("Same amount, near day", "राशि एक जैसी, दिन पास") : p("Same amount", "राशि एक जैसी"))}</Pill></span>}
          />
        ))}
        <div className="ac-in" style={{ background: "var(--accs)", color: "var(--accfg)" }}><Ic n="info" style={{ marginTop: 2 }} /><span>{tx(p("The bank line and the receipt are linked. No money changes. One UPI payment is one receipt; a receipt already matched to another payment is not offered.", "बैंक की लाइन और रसीद जुड़ जाती हैं। पैसा नहीं बदलता। एक UPI भुगतान की एक रसीद; जो रसीद किसी और भुगतान से मिल चुकी है, वह यहाँ नहीं आती।"))}</span></div>
      </Stack>
    </Sheet>
  );
}

function DecideSheet({ request, onClose, busy, run }: { request: AccRequestRow | null; onClose: () => void; busy: boolean; run: Run }) {
  return request ? <DecideForm key={request.id} request={request} onClose={onClose} busy={busy} run={run} /> : null;
}

function DecideForm({ request, onClose, busy, run }: { request: AccRequestRow; onClose: () => void; busy: boolean; run: Run }) {
  const { tx } = useVx();
  const [note, setNote] = useState("");
  const asked = agoP(request.requestedAt);
  const next =
    request.kind === "reversal"
      ? { text: p("After approving, reverse the receipt in Receipts (a reversal row; the receipt is kept).", "मंज़ूरी के बाद ‘रसीदें’ में रसीद वापस करें (वापसी की अलग पंक्ति बनती है; रसीद बनी रहती है)।"), href: "/receipts" }
      : request.kind === "refund"
        ? { text: p("After approving, write and process the refund in Finance controls.", "मंज़ूरी के बाद फ़ाइनेंस कंट्रोल में रिफ़ंड लिखें और पूरा करें।"), href: "/fees/finance-controls" }
        : request.kind === "late_fee_waiver"
          ? { text: p("After approving, waive the late fee at the Payment Desk with this reason.", "मंज़ूरी के बाद फीस जमा पर इसी कारण से लेट फीस माफ़ करें।"), href: request.studentId ? `/payments?student=${request.studentId}` : "/payments" }
          : { text: p("After approving, make the change in Fee setup and publish it.", "मंज़ूरी के बाद फीस ढांचे में बदलाव करें और लागू करें।"), href: "/fee-setup" };
  return (
    <Sheet
      open
      onClose={onClose}
      title={tx(KIND_LABEL[request.kind] ?? KIND_LABEL.other)}
      sub={`${tx(titleP(request.title))}${request.studentName ? ` · ${request.studentName}` : ""}`}
      footer={
        <>
          <button type="button" className="tap btn sec" style={{ flex: 1, height: 48, color: "var(--bad)" }} disabled={busy} onClick={() => run(() => decideRequestAction(request.id, "declined", note), onClose)}><Ic n="x" />{tx(p("Decline", "मना करें"))}</button>
          <button type="button" className="tap btn pri" style={{ flex: 1.6, height: 48 }} disabled={busy} onClick={() => run(() => decideRequestAction(request.id, "approved", note), onClose)}><Ic n="check" />{tx(p("Approve", "मंज़ूर करें"))}</button>
        </>
      }
    >
      <Stack>
        <div className="ac-in" style={{ background: "var(--s2)", color: "var(--fg)" }}><span><b>{request.requestedByName}</b> {tx(p(`asked ${asked.en}:`, `ने ${asked.hi} माँगा:`))} {tx(reasonP(request.reason))}{request.amount !== null ? ` · ${rupees(request.amount)}` : ""}</span></div>
        <Field label={tx(p("Note (needed to decline)", "नोट (मना करने के लिए ज़रूरी)"))}><Textarea value={note} onChange={(e) => setNote(e.target.value)} style={{ minHeight: 64 }} /></Field>
        <div className="ac-in" style={{ background: "var(--infos)", color: "var(--info)" }}><Ic n="info" style={{ marginTop: 2 }} /><span>{tx(next.text)} <a href={next.href} style={{ color: "inherit", fontWeight: 700 }}>{tx(p("Open", "खोलें"))}</a></span></div>
        <span className="ac-m">{tx(p("Approving records your decision. Money moves only through the fee screens, as reversal or refund rows.", "मंज़ूरी से सिर्फ़ आपका फ़ैसला दर्ज होता है। पैसा सिर्फ़ फीस वाली स्क्रीनों से, वापसी या रिफ़ंड की पंक्ति बनकर, चलता है।"))}</span>
      </Stack>
    </Sheet>
  );
}

/**
 * A write-off request keeps the reason's code ("too_small"), and the queue
 * printed it as typed (day-run 6 Nov 2026, A-05). The same four labels as the
 * write-off action in `app/(app)/dues/actions.ts`.
 */
const REASON_CODE_LABEL: Record<string, { en: string; hi: string }> = {
  moved: { en: "Family moved away", hi: "परिवार दूर चला गया" },
  hardship: { en: "Family in hardship", hi: "परिवार मुश्किल में" },
  too_small: { en: "Too small to chase", hi: "पीछा करने लायक़ नहीं" },
  settled: { en: "Settled by talk", hi: "बातचीत से तय" },
};

/**
 * The reasons this app itself stores in English (`books/actions.ts`, the
 * Receipts desk), said in Hindi for a Hindi reader. Whatever a person typed
 * after them is left as typed.
 */
const STORED_HI: Record<string, string> = {
  "Not enough money": "खाते में पैसे कम थे",
  "Signature does not match": "हस्ताक्षर नहीं मिले",
  "Date or amount wrong": "तारीख या राशि गलत",
  "Account closed": "खाता बंद है",
  "Paid twice": "दो बार भरा",
  "Left the school": "स्कूल छोड़ दिया",
  "Paid more than the fee": "फीस से ज़्यादा भरा",
  "Fee changed": "फीस बदली",
  Other: "अन्य",
  "Wrong amount typed": "गलत राशि लिखी",
  "Wrong student": "गलत छात्र",
  "Cheque bounced": "चेक बाउंस",
  "Entered twice": "दो बार दर्ज",
};

function storedHi(text: string): string {
  const bank = /^Bank returned the cheque: ([\s\S]*)$/.exec(text);
  if (bank) return `बैंक ने चेक लौटाया: ${storedHi(bank[1])}`;
  const head = Object.keys(STORED_HI).find((k) => text === k || text.startsWith(`${k} — `) || text.startsWith(`${k} · `));
  return head ? `${STORED_HI[head]}${text.slice(head.length)}` : text;
}

function reasonP(reason: string | null | undefined): Pair {
  const text = reason?.trim() ?? "";
  if (!text) return p("");
  const m = /^([a-z_]+)\b([\s\S]*)$/.exec(text);
  if (m && m[1] in REASON_CODE_LABEL) return p(`${REASON_CODE_LABEL[m[1]].en}${m[2]}`, `${REASON_CODE_LABEL[m[1]].hi}${m[2]}`);
  return p(text, storedHi(text));
}

/** A request's title, as `books/actions.ts` and the Receipts desk write it; a title someone typed stays as typed. */
function titleP(title: string): Pair {
  const bounced = /^Reverse (\S+) · cheque bounced$/.exec(title);
  if (bounced) return p(title, `${bounced[1]} वापस करें · चेक बाउंस`);
  const refund = /^Refund (₹[\d,]+) from advance$/.exec(title);
  if (refund) return p(title, `अग्रिम से ${refund[1]} रिफ़ंड`);
  const reverse = /^Reverse receipt (.+)$/.exec(title);
  if (reverse) return p(title, `रसीद ${reverse[1]} वापस करें`);
  if (title === "Write off dues") return p(title, "बकाया माफ़ करें");
  if (title === "Request") return KIND_LABEL.other;
  return p(title);
}

/** A Fees refund's status ("pending_approval"), in words. */
function refundStatus(status: string): Pair {
  const en = status.replace(/_/g, " ").replace(/^./, (x) => x.toUpperCase());
  const hi: Record<string, string> = { pending: "बाकी", pending_approval: "मंज़ूरी बाकी", approved: "मंज़ूर", processed: "दिया गया", paid: "दिया गया", completed: "दिया गया", refunded: "दिया गया", rejected: "मना किया", declined: "मना किया", cancelled: "रद्द" };
  return p(en, hi[status]);
}

