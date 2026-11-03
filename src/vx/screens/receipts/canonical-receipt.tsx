import Link from "next/link";
import type { ReactNode } from "react";
import type { BridgeReceiptDetail } from "@/platform/fees-bridge/student-read-contracts";
import type { Language } from "@/platform/i18n/language";
import { lead } from "@/vx/text";
import { rupees } from "@/vx/format";
import { Grid, Section, TopBar, VxPage } from "@/vx/ui/page";
import { Btn, Card, EmptyState, Pill, SecHead } from "@/vx/ui/primitives";
import { RetryButton } from "@/vx/ui/read-state";
import { BridgeReceiptPaper } from "@/modules/receipts/vx/bridge-receipt-paper";
import { receiptDetailFromBridge } from "@/modules/receipts/vx/bridge-receipt";
import { FEES_ORIGIN } from "@/platform/fees-bridge/policy";
import { PrintButton } from "./print-button";
import { ReverseReceiptButton } from "./office-command";
import { feesReceiptExit, sourceReceiptHref } from "./source-receipt";

function Facts({ rows }: { rows: [string, ReactNode][] }) {
  return <dl style={{ margin: 0, display: "grid", gap: 12 }}>{rows.map(([label, value]) => <div key={label} style={{ minWidth: 0 }}>
    <dt style={{ color: "var(--mut)", fontSize: 12 }}>{label}</dt>
    <dd style={{ margin: "3px 0 0", overflowWrap: "anywhere", fontWeight: 600 }}>{value ?? "—"}</dd>
  </div>)}</dl>;
}

/** The Fees template's data, or null when the read has a value the template does not know (then the facts lead). */
function paperOf(detail: BridgeReceiptDetail["detail"]) {
  try { return receiptDetailFromBridge(detail); } catch { return null; }
}

/**
 * A source receipt is read in place (review F03): the Fees receipt itself —
 * the same template, logo, stamp and signature Fees prints — with Print and
 * Download PDF for a role that may print receipts, and reversal through Fees
 * where One's writes are open (F01). Sending to the family stays Fees' own
 * act; the way there is offered only for what Fees would let this person do
 * (`mayReverse`: the role holds `payments:reverse_any`, whether or not One's
 * writes are open). Every fact stays below under one fold.
 */
export function CanonicalReceipt({ receipt, language, canPrint = false, canReverse = false, mayReverse = canReverse }: { receipt: BridgeReceiptDetail; language: Language; canPrint?: boolean; canReverse?: boolean; mayReverse?: boolean }) {
  const d = receipt.detail;
  const t = (en: string, hi: string) => lead({ en, hi }, language);
  const back = `/students/${receipt.studentId}?tab=fees`;
  const receiptHref = (id: string, number: string) => sourceReceiptHref(number, id, receipt.sessionLabel);
  const sourceHref = `${FEES_ORIGIN}/protected/receipts/${receipt.receiptId}?${new URLSearchParams({ session: receipt.sessionLabel })}`;
  const exit = feesReceiptExit({ canPrint, canReverseHere: canReverse, mayReverse, isVoided: Boolean(d.isVoided) });
  const paper = paperOf(d);
  const pdfHref = `/api/fees-bridge/receipts/${receipt.receiptId}/pdf?${new URLSearchParams({ session: receipt.sessionLabel })}`;
  const printing = canPrint && paper ? <>
    <PrintButton label={t("Print", "प्रिंट करें")} />
    <Btn icon="download" href={pdfHref}>{t("Download PDF", "PDF डाउनलोड करें")}</Btn>
  </> : null;
  return <VxPage label={t("Fee receipt", "शुल्क रसीद")}>
    <TopBar title={d.receiptNumber} crumb={t("Fee receipt", "शुल्क रसीद")} mBack={back} mSub={d.studentFullName}
      actions={<span className="print:hidden" style={{ display: "flex", gap: 8 }}>{printing}<Btn href={back}>{t("Student record", "विद्यार्थी विवरण")}</Btn></span>} />
    <Section><div data-student-source-section="receipt" style={{ display: "contents" }}>
      {paper ? <div className="vx-receipt-paper"><BridgeReceiptPaper receipt={paper} /></div> : null}
      {paper ? <div className="print:hidden only-m" style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>{printing}</div> : null}
      <details className="print:hidden vx-receipt-more" open={!paper}>
        <summary>{t("All receipt details", "रसीद का पूरा विवरण")}</summary>
        <div style={{ display: "grid", gap: 16, marginTop: 12 }}>
      <Card>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", marginBottom: 16 }}>
          <div><h2 style={{ margin: 0 }}>{d.studentFullName}</h2><p style={{ margin: "6px 0", color: "var(--mut)" }}>{d.admissionNo} · {d.classLabel} · {d.sessionLabel}</p></div>
          <div style={{ textAlign: "right" }}><strong style={{ fontSize: 28, fontVariantNumeric: "tabular-nums" }}>{rupees(d.totalAmount)}</strong><div>{t("Receipt amount", "रसीद की राशि")}</div></div>
        </div>
        {d.isVoided ? <Pill tone="bad">{t("Voided", "निरस्त")}</Pill> : (d.reversedAmount ?? 0) > 0 ? <Pill tone="warn">{t("Reversed amount", "वापस की गई राशि")}: {rupees(d.reversedAmount)}</Pill> : null}
        <Grid cols={3}><Facts rows={[[t("Payment date", "भुगतान की तारीख"), d.paymentDate], [t("Payment mode", "भुगतान का माध्यम"), d.onlineMethod ?? d.paymentMode], [t("Reference", "संदर्भ"), d.referenceNumber]]} />
          <Facts rows={[[t("Received by", "प्राप्तकर्ता"), d.receivedBy], [t("Recorded by", "दर्जकर्ता"), d.createdByName], [t("Recorded at", "दर्ज करने का समय"), d.createdAt]]} />
          <Facts rows={[[t("Parent", "अभिभावक"), d.fatherName], [t("Father's phone", "पिता का फ़ोन"), d.fatherPhone], [t("Mother's phone", "माता का फ़ोन"), d.motherPhone], [t("Email", "ईमेल"), d.parentEmail]]} /></Grid>
        {d.notes ? <p style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{d.notes}</p> : null}
        {d.voidReason ? <p>{t("Void reason", "निरस्त करने का कारण")}: {d.voidReason}</p> : null}
      </Card>
      <Grid cols={2}>
        <Card><SecHead>{t("Fee summary", "शुल्क सारांश")}</SecHead><Facts rows={[
          ...d.feeSummary.map(row => [row.label, rupees(row.amount)] as [string, ReactNode]),
          [t("Discount", "छूट"), rupees(d.discountAmount)], [t("Late fee", "विलंब शुल्क"), rupees(d.lateFeeAmount)],
          [t("Late fee waived", "माफ़ किया गया विलंब शुल्क"), rupees(d.lateFeeWaived)],
          [t("Transport route", "परिवहन मार्ग"), d.transportRouteLabel],
        ]} /></Card>
        <Card><SecHead>{t("Payment and balance", "भुगतान और बकाया")}</SecHead><Facts rows={[
          [t("Total fees", "कुल शुल्क"), rupees(d.totalDue)], [t("Paid before this receipt", "इस रसीद से पहले भुगतान"), rupees(d.totalPaidBeforeReceipt)],
          [t("Balance after this receipt", "इस रसीद के बाद बकाया"), rupees(d.outstandingAfterReceipt)],
          [t("Paid to date", "अब तक भुगतान"), rupees(d.totalPaidToDate)], [t("Current fee balance", "वर्तमान शुल्क बकाया"), rupees(d.currentOutstanding)],
        ]} /></Card>
      </Grid>
      <Card><SecHead>{t("Payment allocations", "भुगतान का विभाजन")}</SecHead>
        <div style={{ display: "grid", gap: 14 }}>{d.breakdown.map(row => <Card key={row.paymentId} style={{ background: "var(--s2)" }}>
          <strong>{row.installmentLabel}</strong><p>{row.sessionLabel} · {row.dueDate}</p>
          <Grid cols={3}><Facts rows={[[t("Original amount", "मूल राशि"), rupees(row.originalAmount)], [t("Correction", "संशोधन"), rupees(row.adjustmentAmount)], [t("Effective amount", "प्रभावी राशि"), rupees(row.effectiveAmount)]]} />
            <Facts rows={[[t("Discount at collection", "भुगतान के समय छूट"), row.discountAppliedAtPosting === null ? null : rupees(row.discountAppliedAtPosting)], [t("Waiver at collection", "भुगतान के समय माफ़ी"), row.waiverAppliedAtPosting === null ? null : rupees(row.waiverAppliedAtPosting)]]} />
            <Facts rows={[[t("Balance before collection", "भुगतान से पहले बकाया"), row.pendingBeforePosting === null ? null : rupees(row.pendingBeforePosting)], [t("Balance after collection", "भुगतान के बाद बकाया"), row.pendingAfterPosting === null ? null : rupees(row.pendingAfterPosting)]]} /></Grid>
          {row.notes ? <p style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{row.notes}</p> : null}
        </Card>)}</div>
      </Card>
      <Card><SecHead>{t("Instalments", "किस्तें")}</SecHead><div style={{ display: "grid", gap: 14 }}>{d.installmentStatus.map((row, index) => <Card key={`${row.installmentNo}-${index}`} style={{ background: "var(--s2)" }}>
        <strong>{row.label}</strong><p>{row.dueDate} · {row.status}</p><Grid cols={4}>
          <Facts rows={[[t("Fee amount", "शुल्क राशि"), rupees(row.expected)]]} /><Facts rows={[[t("Paid", "भुगतान"), rupees(row.paid)]]} />
          <Facts rows={[[t("Pending fees", "बकाया शुल्क"), rupees(row.pending)]]} /><Facts rows={[[t("Late fee", "विलंब शुल्क"), rupees(row.lateFee)]]} />
        </Grid></Card>)}</div></Card>
      {d.conventionalDiscountAssignments.length ? <Card><SecHead>{t("Concessions", "रियायतें")}</SecHead>{d.conventionalDiscountAssignments.map(row => <p key={row.assignmentId}>
        {row.policyDisplayName} · {rupees(row.beforeTuitionAmount)} → {rupees(row.resultingTuitionAmount)} {row.isWinningPolicy ? `· ${t("Applied", "लागू")}` : ""}
      </p>)}</Card> : null}
      {d.previousReceipts.length ? <Card><SecHead>{t("Previous receipts", "पिछली रसीदें")}</SecHead><div style={{ display: "grid", gap: 12 }}>{d.previousReceipts.map(row => <Link key={row.id} href={receiptHref(row.id, row.receiptNumber)} style={{ minHeight: 44, overflowWrap: "anywhere" }}>
        {row.receiptNumber} · {row.paymentDate} · {rupees(row.totalAmount)} {row.isReversed ? `· ${t("Reversed", "वापस")}` : ""}
      </Link>)}</div></Card> : null}
        </div>
      </details>
      <div className="print:hidden" style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-start" }}>
        <Btn href={back}>{t("Back to student", "विद्यार्थी पर वापस")}</Btn>
        {/* Reversal through Fees (review F01): only where One's fee writes are open, the role may reverse and something is left. */}
        {canReverse && !d.isVoided ? <ReverseReceiptButton receiptId={receipt.receiptId} receiptNumber={d.receiptNumber} sessionLabel={receipt.sessionLabel} amount={d.totalAmount} /> : null}
        {exit ? <Btn href={sourceHref}>{lead(exit, language)}</Btn> : null}
      </div>
    </div></Section>
  </VxPage>;
}

/**
 * Why a receipt cannot be shown here, in words staff can act on (F02) — never
 * a bare "Page not found". `missing_link`: an older link carried only the
 * number; `unreadable`: Fees refused or does not have it — one message for
 * both, so this page never confirms that a refused receipt exists; `access`:
 * this account or session may not use the Fees connection; `error`: Fees did
 * not answer.
 */
export type ReceiptUnavailableReason = "missing_link" | "unreadable" | "access" | "error";

const WHY: Record<ReceiptUnavailableReason, { en: string; hi: string }> = {
  missing_link: { en: "This link has only the receipt number, so One cannot be sure which receipt it means. Open it in Fees, or open it from the student's Fees tab.", hi: "इस लिंक में केवल रसीद नंबर है, इसलिए One यह तय नहीं कर सकता कि कौन-सी रसीद है। इसे Fees में खोलें, या विद्यार्थी के फ़ीस टैब से खोलें।" },
  unreadable: { en: "One cannot show this receipt in any school year your account can open here. Fees may still have it; a mistyped link opens nothing.", hi: "One यह रसीद उन किसी भी सत्रों में नहीं दिखा सकता जो आपका खाता यहाँ खोल सकता है। हो सकता है यह Fees में हो; ग़लत लिखा लिंक कुछ नहीं खोलता।" },
  access: { en: "Your account cannot open receipts for this session here. Ask an administrator if you need it.", hi: "आपका खाता यहाँ इस सत्र की रसीदें नहीं खोल सकता। ज़रूरत हो तो व्यवस्थापक से पूछें।" },
  error: { en: "Fees did not answer just now. Your receipt is not lost — try again in a moment.", hi: "Fees से अभी जवाब नहीं मिला। आपकी रसीद खोई नहीं है — थोड़ी देर में फिर प्रयास करें।" },
};

export function CanonicalReceiptUnavailable({ language, reason = "error", receiptNumber, receiptId, sessionLabel, studentId }: {
  language: Language;
  reason?: ReceiptUnavailableReason;
  receiptNumber?: string;
  receiptId?: string;
  sessionLabel?: string;
  studentId?: string;
}) {
  const t = (en: string, hi: string) => lead({ en, hi }, language);
  // Fees' own receipt page when the exact receipt is known; otherwise its receipt list.
  const fees = receiptId
    ? `${FEES_ORIGIN}/protected/receipts/${receiptId}${sessionLabel ? `?${new URLSearchParams({ session: sessionLabel })}` : ""}`
    : `${FEES_ORIGIN}/protected/receipts`;
  const back = studentId ? `/students/${studentId}?tab=fees` : "/students";
  return <VxPage><TopBar title={receiptNumber || t("Receipt unavailable", "रसीद उपलब्ध नहीं है")} crumb={t("Receipt unavailable", "रसीद उपलब्ध नहीं है")} mBack={back} />
    <Section><EmptyState icon="receipt" title={t("This receipt cannot be shown here", "यह रसीद यहाँ नहीं दिखाई जा सकती")} body={lead(WHY[reason], language)}
      action={<div style={{ display: "flex", gap: 12, flexWrap: "wrap", justifyContent: "center", alignItems: "center" }}>
        {reason === "error" ? <RetryButton /> : null}
        {reason !== "access" ? <Btn href={fees}>{t("Open in Fees", "Fees में खोलें")}</Btn> : null}
        <Btn href={back}>{studentId ? t("Back to student", "विद्यार्थी पर वापस") : t("Students", "विद्यार्थी")}</Btn>
      </div>} /></Section>
  </VxPage>;
}
