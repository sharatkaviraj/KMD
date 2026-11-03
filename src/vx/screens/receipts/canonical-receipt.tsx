import Link from "next/link";
import type { ReactNode } from "react";
import type { BridgeReceiptDetail } from "@/platform/fees-bridge/student-read-contracts";
import type { Language } from "@/platform/i18n/language";
import { lead } from "@/vx/text";
import { rupees } from "@/vx/format";
import { Grid, Section, TopBar, VxPage } from "@/vx/ui/page";
import { Btn, Card, EmptyState, Pill, SecHead } from "@/vx/ui/primitives";

function Facts({ rows }: { rows: [string, ReactNode][] }) {
  return <dl style={{ margin: 0, display: "grid", gap: 12 }}>{rows.map(([label, value]) => <div key={label} style={{ minWidth: 0 }}>
    <dt style={{ color: "var(--mut)", fontSize: 12 }}>{label}</dt>
    <dd style={{ margin: "3px 0 0", overflowWrap: "anywhere", fontWeight: 600 }}>{value ?? "—"}</dd>
  </div>)}</dl>;
}

/** A source receipt is read in place; no local reversal, send or write controls. */
export function CanonicalReceipt({ receipt, language }: { receipt: BridgeReceiptDetail; language: Language }) {
  const d = receipt.detail;
  const t = (en: string, hi: string) => lead({ en, hi }, language);
  const back = `/students/${receipt.studentId}?tab=fees`;
  const receiptHref = (id: string, number: string) => `/receipts/${encodeURIComponent(number)}?${new URLSearchParams({ receiptId: id, session: receipt.sessionLabel })}`;
  const sourceHref = `https://fees.vpps.co.in/protected/receipts/${receipt.receiptId}?${new URLSearchParams({ session: receipt.sessionLabel })}`;
  return <VxPage label={t("Fee receipt", "शुल्क रसीद")}>
    <TopBar title={d.receiptNumber} crumb={t("Fee receipt", "शुल्क रसीद")} mBack={back} mSub={d.studentFullName}
      actions={<Btn href={back}>{t("Student record", "विद्यार्थी विवरण")}</Btn>} />
    <Section><div data-student-source-section="receipt" style={{ display: "contents" }}>
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
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}><Btn href={back}>{t("Back to student", "विद्यार्थी पर वापस")}</Btn><Btn href={sourceHref}>{t("Open receipt in Fees", "Fees में रसीद खोलें")}</Btn></div>
    </div></Section>
  </VxPage>;
}

export function CanonicalReceiptUnavailable({ language }: { language: Language }) {
  return <VxPage><TopBar title={lead({ en: "Receipt unavailable", hi: "रसीद उपलब्ध नहीं है" }, language)} mBack="/students" />
    <Section><EmptyState icon="receipt" title={lead({ en: "The receipt could not be loaded. Please try again.", hi: "रसीद लोड नहीं हो सकी। कृपया फिर प्रयास करें।" }, language)} action={<Btn href="/students">{lead({ en: "Students", hi: "विद्यार्थी" }, language)}</Btn>} /></Section>
  </VxPage>;
}
