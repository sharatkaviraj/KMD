import "server-only";

import * as React from "react";
import { Document, Page, StyleSheet, Text, View, renderToBuffer } from "@react-pdf/renderer";

import { schoolProfile } from "@/platform/config/school";
import { isYearCleared } from "@/modules/fees/domain/year-clear";
import { englishAmountWords } from "@/platform/helpers/amount-in-words";
import { amountInWordsHindi } from "@/platform/helpers/amount-in-words-hi";
import {
  Badge,
  ensurePdfFontsRegistered,
  formatPdfDate,
  HI_FONT,
  inr,
  loadLogoImage,
  loadSignatureImage,
  MONEY_FONT,
  ParentDocumentLetterhead,
  pdfTokens,
  SignatureBlock,
  sharedStyles,
  Th,
} from "@/platform/pdf/document-kit";
import type { ReceiptDetail } from "@/modules/receipts/domain/types";

/**
 * A fee receipt as an actual PDF file.
 *
 * Until now the only way to get a receipt out of this system was to open it in a
 * browser and print. That is fine at the counter and useless everywhere else —
 * an assistant cannot hand a parent a web page, and there was nothing to attach
 * to a message. It is now the document every paying parent receives on WhatsApp
 * within seconds of the cashier posting, which raises the bar for it
 * considerably: this is the school's face, not an export.
 *
 * It mirrors `receipts/ui/receipt-document-v3.tsx` section by section, and since
 * 2026-09-12 that mirroring is close enough to be recognisable side by side:
 * the centred letterhead with the mark above the name, the boxed FEE RECEIPT
 * title, the monospace receipt/session/date line between dashed rules, the
 * saffron-ruled student cell, the green TOTAL PAID panel, the year tiles, and
 * the perforated parent stub.
 *
 * Three deliberate divergences remain, all forced by react-pdf:
 *
 *   - No rotated PAID stamp: react-pdf has no `transform`, so the stamps read
 *     as bordered badges.
 *   - The REVERSED watermark is a wide band rather than a diagonal, same cause.
 *   - The perforation is a dotted rule rather than bitten-out half circles;
 *     there is no mask.
 *
 * The ₹ divergence is gone. Noto Sans Devanagari carries U+20B9, so money reads
 * `₹4,500` here exactly as it does on screen — see `inr` in the document kit.
 *
 * Everything that is a *number* is computed the same way as the screen, from
 * the same helpers, because a receipt that disagrees with the one on the
 * monitor is worse than no PDF at all.
 */

const L = {
  receipt: { en: "FEE RECEIPT", hi: "शुल्क रसीद" },
  receiptNo: { en: "Receipt No", hi: "रसीद संख्या" },
  session: { en: "Session", hi: "सत्र" },
  student: { en: "STUDENT NAME", hi: "विद्यार्थी का नाम" },
  srNo: { en: "SR No", hi: "क्रम संख्या" },
  father: { en: "FATHER NAME", hi: "पिता का नाम" },
  date: { en: "DATE", hi: "दिनांक" },
  mode: { en: "PAYMENT MODE", hi: "भुगतान माध्यम" },
  receivedBy: { en: "Received By", hi: "प्राप्तकर्ता" },
  totalPaid: { en: "TOTAL PAID", hi: "कुल जमा" },
  amountInWords: { en: "Amount in Words", hi: "शब्दों में" },
  paidFor: { en: "What this receipt paid", hi: "इस रसीद से भुगतान" },
  installment: { en: "Installment", hi: "किस्त" },
  dueDate: { en: "Due date", hi: "देय तिथि" },
  // Owed, not "pending": the posting stores the installment's fees AND its late
  // fee when one was charged, and "pending" means fees only (glossary).
  pendingBefore: { en: "Owed before", hi: "पहले देय" },
  paid: { en: "Paid", hi: "जमा" },
  pendingAfter: { en: "Owed after", hi: "बाद में देय" },
  owedNote: { en: "Owed before and after: this installment's fees and its late fee, if one was charged.", hi: "पहले और बाद में देय: इस किस्त का शुल्क और विलंब शुल्क, यदि लगा हो।" },
  total: { en: "Total", hi: "कुल" },
  yearAtGlance: { en: "Year at a glance", hi: "वर्ष का सारांश" },
  totalExpected: { en: "Total expected this year", hi: "इस वर्ष कुल अपेक्षित" },
  paidSoFar: { en: "Paid so far", hi: "अब तक जमा" },
  balanceDue: { en: "Balance due", hi: "शेष राशि" },
  allClear: { en: "All dues cleared", hi: "सभी बकाया चुकता" },
  due: { en: "due", hi: "देय" },
  paidTick: { en: "Paid", hi: "चुकता" },
  discountPolicies: { en: "Discount policies on file", hi: "दर्ज छूट नीतियाँ" },
  policy: { en: "Policy", hi: "नीति" },
  tuitionBefore: { en: "Tuition before", hi: "पूर्व शुल्क" },
  tuitionAfter: { en: "Tuition after", hi: "पश्चात शुल्क" },
  applied: { en: "Applied", hi: "लागू" },
  official: {
    en: "This is an official school fee receipt.",
    hi: "यह विद्यालय की आधिकारिक शुल्क रसीद है।",
  },
  keepRecords: {
    en: "Please keep this receipt for your records.",
    hi: "कृपया इस रसीद को सुरक्षित रखें।",
  },
} as const;

/**
 * One receipt, one sheet of A4 (owner, 7 Nov 2026: "printed in single sheet
 * only"). Every receipt is first set at the ordinary spacing; one that still
 * runs over — eight instalment lines, a previous-year balance, three discount
 * policies — is set again `dense`: the same sections and figures, tighter.
 */
function sheetStyles(dense: boolean) {
  const v = (normal: number, tight: number) => (dense ? tight : normal);
  return StyleSheet.create({
    page: {
      paddingTop: v(24, 18),
      paddingHorizontal: 24,
      // Clear of the fixed footer line at the foot of the sheet.
      paddingBottom: v(32, 28),
      fontSize: v(9, 8),
      color: pdfTokens.ink,
      fontFamily: "Helvetica",
      backgroundColor: pdfTokens.paper,
    },
    /** Receipt no · session · date, monospace between dashed rules — a ledger line. */
    metaBar: {
      flexDirection: "row",
      justifyContent: "space-between",
      borderBottomWidth: 0.5,
      borderBottomColor: pdfTokens.rule,
      borderStyle: "dashed",
      paddingVertical: v(5, 3),
      fontFamily: "Courier",
      fontSize: 8.5,
    },

    /** Four across, as the desktop app lays it out. */
    metaGrid: { flexDirection: "row", marginTop: v(8, 5), gap: 10 },
    metaCell: { flex: 1, paddingLeft: 7, borderLeftWidth: 1, borderLeftColor: pdfTokens.rule },
    /** The student is the subject of the document, so it carries the one saffron. */
    metaCellLead: { borderLeftWidth: 2, borderLeftColor: pdfTokens.accent },
    metaValue: { fontSize: v(10, 9), color: pdfTokens.inkStrong, marginTop: 2, fontFamily: "Helvetica-Bold" },
    metaSub: { fontSize: 7.5, color: pdfTokens.muted, marginTop: 1 },
    metaSubHi: { fontSize: 7.5, color: pdfTokens.muted, fontFamily: HI_FONT },

    /** TOTAL PAID on the left, the amount in words on the right — the screen's hero, side by side. */
    hero: {
      marginTop: v(9, 6),
      borderWidth: 1,
      borderColor: pdfTokens.success,
      borderRadius: 5,
      backgroundColor: pdfTokens.successBg,
      paddingVertical: v(8, 5),
      paddingHorizontal: 10,
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "flex-end",
      gap: 12,
    },
    heroLabel: { fontSize: 6.5, color: pdfTokens.success, fontFamily: "Helvetica-Bold", letterSpacing: 1 },
    heroLabelHi: { fontSize: 7, color: pdfTokens.success, fontFamily: HI_FONT },
    heroAmount: { fontSize: v(22, 18), fontFamily: MONEY_FONT, color: pdfTokens.success, marginTop: 1 },
    heroWords: { fontSize: 7.5, color: pdfTokens.ink, textAlign: "right" },
    heroWordsHi: { fontSize: 7.5, color: pdfTokens.ink, marginTop: 1, fontFamily: HI_FONT, textAlign: "right" },

    /** "What this receipt paid / इस रसीद से भुगतान", on one line. */
    sectionTitle: { flexDirection: "row", alignItems: "baseline", marginTop: v(9, 6), marginBottom: v(4, 2) },
    sectionTitleEn: { fontSize: 8, fontFamily: "Helvetica-Bold", color: pdfTokens.muted, letterSpacing: 0.9 },
    sectionTitleHi: { fontSize: 7.5, fontFamily: HI_FONT, color: pdfTokens.muted },

    tableHeader: { paddingVertical: v(3, 2) },
    tableRow: { paddingVertical: v(3, 1.5) },

    money: { fontFamily: MONEY_FONT },
    moneyRight: { flex: 1, textAlign: "right", fontFamily: MONEY_FONT },

    totalRow: {
      flexDirection: "row",
      paddingVertical: v(5, 3),
      paddingHorizontal: 4,
      borderTopWidth: 1.5,
      borderBottomWidth: 1.5,
      borderColor: pdfTokens.inkStrong,
    },
    note: { fontSize: 6.5, color: pdfTokens.muted, marginTop: v(3, 2) },

    voidBanner: {
      marginTop: v(9, 6),
      borderWidth: 1,
      borderColor: pdfTokens.danger,
      borderRadius: 4,
      backgroundColor: pdfTokens.dangerBg,
      padding: v(8, 5),
    },
    voidBannerText: { color: pdfTokens.danger, fontFamily: "Helvetica-Bold", fontSize: 10 },
    voidWatermark: {
      position: "absolute",
      top: 330,
      left: 0,
      right: 0,
      textAlign: "center",
      fontSize: 46,
      fontFamily: "Helvetica-Bold",
      color: "#f4cdc7",
      letterSpacing: 8,
    },

    /**
     * Four per row, as the desktop app lays them out — five when there are
     * five, so a student carrying a previous-year balance does not spend a
     * whole second row on one tile. The long "Previous year tuition balance
     * from 2025-26" label wraps inside its tile, which is why the tiles are a
     * wrapping grid of fixed fractions rather than a flex row that would
     * squash it.
     */
    tileGrid: { flexDirection: "row", flexWrap: "wrap", marginHorizontal: -3 },
    tile: { paddingHorizontal: 3, paddingBottom: v(5, 3) },
    tileInner: { borderWidth: 0.5, borderColor: pdfTokens.rule, borderRadius: 4, paddingHorizontal: 6, paddingVertical: v(5, 3) },
    tileInnerPaid: { borderColor: pdfTokens.success, backgroundColor: pdfTokens.successBg },
    tileLabel: { fontSize: 6.5, color: pdfTokens.muted, fontFamily: "Helvetica-Bold", letterSpacing: 0.5 },
    tileValueRow: { flexDirection: "row", alignItems: "baseline", marginTop: 2 },
    tileDate: { fontSize: 7, color: pdfTokens.muted, marginTop: 1 },

    strip: {
      marginTop: v(3, 2),
      backgroundColor: pdfTokens.panel,
      paddingVertical: v(5, 4),
      paddingHorizontal: 8,
      borderRadius: 4,
      flexDirection: "row",
      flexWrap: "wrap",
      justifyContent: "space-between",
      alignItems: "baseline",
      gap: 6,
    },
    stripRow: { flexDirection: "row", alignItems: "baseline", flexWrap: "wrap" },

    /** react-pdf has no mask, so the tear line is a dotted rule rather than the
     *  bitten-out half circles the screen draws. Same message, fewer tricks. */
    perforation: {
      marginTop: v(10, 6),
      borderTopWidth: 1,
      borderTopColor: pdfTokens.muted,
      borderStyle: "dotted",
    },
    stub: {
      marginTop: v(7, 5),
      borderWidth: 0.8,
      borderColor: pdfTokens.muted,
      borderStyle: "dashed",
      borderRadius: 4,
      backgroundColor: pdfTokens.stub,
      paddingHorizontal: 10,
      paddingVertical: v(7, 5),
    },
    stubRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "baseline" },
  });
}

type Sheet = ReturnType<typeof sheetStyles>;

const labelStyles = StyleSheet.create({
  en: { fontSize: 6.5, color: pdfTokens.muted, fontFamily: "Helvetica-Bold", letterSpacing: 0.7 },
  hi: { fontSize: 6.5, color: pdfTokens.muted, fontFamily: HI_FONT },
});

function Label({ label }: { label: { en: string; hi: string } }) {
  return (
    <>
      <Text style={labelStyles.en}>{label.en}</Text>
      <Text style={labelStyles.hi}>{label.hi}</Text>
    </>
  );
}

function SectionTitle({ s, label }: { s: Sheet; label: { en: string; hi: string } }) {
  return (
    <View style={s.sectionTitle}>
      <Text style={s.sectionTitleEn}>{label.en.toUpperCase()}</Text>
      {/* A Text node's leading spaces are dropped when it is laid out, so the
          gap before the slash is non-breaking. */}
      <Text style={s.sectionTitleHi}>{`\u00A0\u00A0/\u00A0 ${label.hi}`}</Text>
    </View>
  );
}

/**
 * A money figure beside its words.
 *
 * Split into two <Text> on purpose: the amount needs {@link MONEY_FONT} for the
 * ₹ glyph, and that font has no Latin letters — so "Balance due" and "₹22,000"
 * cannot share one node.
 */
function MoneyWithLabel({
  labelEn,
  labelHi,
  value,
  bold = false,
  color,
  size = 9,
}: {
  labelEn: string;
  labelHi?: string;
  value: number;
  bold?: boolean;
  color?: string;
  size?: number;
}) {
  return (
    <View style={{ flexDirection: "row", alignItems: "baseline" }}>
      <Text style={{ fontSize: size, color: color ?? pdfTokens.muted, fontFamily: bold ? "Helvetica-Bold" : "Helvetica" }}>
        {labelEn}
      </Text>
      {labelHi ? (
        <Text style={{ fontSize: size, color: color ?? pdfTokens.muted, fontFamily: HI_FONT }}>
          {`\u00A0/ ${labelHi}`}
        </Text>
      ) : null}
      <Text style={{ fontSize: size, color: color ?? pdfTokens.muted }}>: </Text>
      <Text style={{ fontSize: size, fontFamily: MONEY_FONT, color: color ?? pdfTokens.inkStrong }}>
        {inr(value)}
      </Text>
    </View>
  );
}

// Re-exported rather than defined here: the share sheet is a client component
// and cannot import this `server-only` module, but the name it downloads must
// match the one this route sends in Content-Disposition.
export { receiptPdfFilename } from "@/modules/receipts/domain/document-names";

export type ReceiptPdfInput = {
  receipt: ReceiptDetail;
  /**
   * Retained so existing call sites need no change, and ignored.
   *
   * The footer QR was removed on 2026-09-12: the office does not verify
   * receipts by scanning them, and the code encoded whatever
   * `NEXT_PUBLIC_SITE_URL` happened to be — which in production was
   * `http://localhost:3000`, so every QR ever printed pointed at nothing.
   * A square that cannot work is worse than no square.
   */
  verifyUrl?: string | null;
};

/** Pages in a rendered PDF: one `/Type /Page` object each (`/Pages` is the tree, not a page). */
export function pdfPageCount(pdf: Buffer): number {
  return (pdf.toString("latin1").match(/\/Type\s*\/Page\b/g) ?? []).length;
}

export async function renderReceiptPdf({ receipt }: ReceiptPdfInput): Promise<Buffer> {
  ensurePdfFontsRegistered();
  const [logo, signature] = await Promise.all([loadLogoImage(), loadSignatureImage()]);
  const first = await renderToBuffer(<ReceiptPdfDocument receipt={receipt} logo={logo} signature={signature} dense={false} />);
  if (pdfPageCount(first) <= 1) return first;
  // Set tighter rather than let the stub fall onto a second sheet. Should a
  // receipt ever outgrow even this, the stamps, signature and stub still move
  // to page two together (`wrap={false}` below), never split.
  return renderToBuffer(<ReceiptPdfDocument receipt={receipt} logo={logo} signature={signature} dense />);
}

function ReceiptPdfDocument({
  receipt,
  logo,
  signature,
  dense,
}: {
  receipt: ReceiptDetail;
  logo: Awaited<ReturnType<typeof loadLogoImage>>;
  signature: Awaited<ReturnType<typeof loadSignatureImage>>;
  dense: boolean;
}) {
  const s = sheetStyles(dense);

  // Same arithmetic as receipt-document-v3: the effective breakdown wins, and
  // totalAmount is only the fallback. A receipt carrying an append-only
  // correction prints the corrected figure, not the original posting.
  const rows = receipt.breakdown.map((item) => ({
    label: item.installmentLabel,
    dueDate: item.dueDate,
    paid: item.amount,
    adjustmentAmount: item.adjustmentAmount,
    pendingBefore: item.pendingBeforePosting,
    pendingAfter: item.pendingAfterPosting,
  }));
  const breakdownTotal = rows.reduce((sum, row) => sum + row.paid, 0);
  const totalPaid = breakdownTotal || receipt.totalAmount;

  const isVoided = receipt.isVoided === true;
  // A reversed receipt is never also stamped PAID or YEAR CLEARED — same rule as
  // the screen. Suppressing them is half of what makes the reversal readable.
  const isYearClear =
    !isVoided &&
    isYearCleared({
      outstandingAmount: receipt.currentOutstanding,
      totalPaid: receipt.totalPaidToDate,
    });

  const nextDue = receipt.installmentStatus.find(
    (row) => row.status !== "paid" && row.pending > 0,
  );
  const outstanding = Math.max(receipt.currentOutstanding, 0);
  // Where this payment leaves the year, as the screen's hero says it.
  const paidShare = receipt.totalDue > 0 ? Math.min(100, Math.round((receipt.totalPaidToDate / receipt.totalDue) * 100)) : null;
  const tileWidth = `${100 / Math.min(Math.max(receipt.installmentStatus.length, 4), 5)}%`;

  const modeLabel = receipt.paymentMode.replace(/_/g, " ");
  // "Online" alone hid how the parent paid; the capture says, so print it.
  const modeTitle =
    receipt.paymentMode === "online"
      ? receipt.onlineMethod === "upi"
        ? "UPI (Razorpay)"
        : "Online (Razorpay)"
      : modeLabel.charAt(0).toUpperCase() + modeLabel.slice(1);
  const title = `${isVoided ? "REVERSED — " : ""}Receipt ${receipt.receiptNumber} — ${receipt.studentFullName}`;

  return (
    <Document title={title} author={schoolProfile.name}>
      <Page size="A4" style={s.page}>
        {isVoided ? <Text style={s.voidWatermark} fixed>REVERSED</Text> : null}

        <ParentDocumentLetterhead
          docTitleEn={L.receipt.en}
          docTitleHi={L.receipt.hi}
          logo={logo}
        />

        <View style={s.metaBar}>
          <Text>{`${L.receiptNo.en} ${receipt.receiptNumber}`}</Text>
          <Text>{`${L.session.en} ${receipt.sessionLabel}`}</Text>
          <Text>{formatPdfDate(receipt.paymentDate)}</Text>
        </View>

        {isVoided ? (
          <View style={s.voidBanner}>
            <Text style={s.voidBannerText}>
              THIS RECEIPT HAS BEEN REVERSED IN FULL
            </Text>
            <Text style={{ fontSize: 8, color: pdfTokens.danger, marginTop: 2 }}>
              {receipt.voidReason ? `Reason: ${receipt.voidReason}. ` : ""}
              It remains on file as a record and is excluded from every collection figure. It is not proof of payment.
            </Text>
          </View>
        ) : null}

        {/* Four across, which is the desktop app's four columns. The phone
            stacks them 2x2 because it is 390px wide; A4 is not, and two rows
            here pushed the parent stub onto a second page. */}
        <View style={s.metaGrid}>
          <View style={[s.metaCell, s.metaCellLead]}>
            <Label label={L.student} />
            <Text style={s.metaValue}>{receipt.studentFullName}</Text>
            <Text style={s.metaSub}>
              {`${L.srNo.en} ${receipt.admissionNo}  ·  ${receipt.classLabel}`}
            </Text>
          </View>
          <View style={s.metaCell}>
            <Label label={L.father} />
            <Text style={s.metaValue}>{receipt.fatherName || "—"}</Text>
            {receipt.fatherPhone ? (
              <Text style={s.metaSub}>{receipt.fatherPhone}</Text>
            ) : null}
          </View>
          <View style={s.metaCell}>
            <Label label={L.date} />
            <Text style={s.metaValue}>{formatPdfDate(receipt.paymentDate)}</Text>
            <Text style={s.metaSub}>
              {`${L.receivedBy.en}: ${receipt.receivedBy || receipt.createdByName || "—"}`}
            </Text>
          </View>
          <View style={s.metaCell}>
            <Label label={L.mode} />
            <Text style={s.metaValue}>{modeTitle}</Text>
            <Text style={s.metaSubHi}>{L.mode.hi}</Text>
          </View>
        </View>

        <View style={s.hero}>
          <View>
            <Text style={s.heroLabel}>{L.totalPaid.en}</Text>
            <Text style={s.heroLabelHi}>{L.totalPaid.hi}</Text>
            <Text style={s.heroAmount}>{inr(totalPaid)}</Text>
          </View>
          <View style={{ flex: 1, alignItems: "flex-end" }}>
            <Text style={s.heroWords}>
              {`${L.amountInWords.en}: ${englishAmountWords(totalPaid, { style: "title" })} Rupees Only`}
            </Text>
            <Text style={s.heroWordsHi}>{amountInWordsHindi(totalPaid)}</Text>
            {paidShare !== null ? (
              <View style={{ flexDirection: "row", alignItems: "baseline", marginTop: 3 }}>
                <Text style={{ fontSize: 7.5, fontFamily: "Helvetica-Bold", color: pdfTokens.success }}>
                  {`${paidShare}% ${L.paidSoFar.en.toLowerCase()} — `}
                </Text>
                <Text style={{ fontSize: 7.5, fontFamily: MONEY_FONT, color: pdfTokens.success }}>
                  {`${inr(receipt.totalPaidToDate)} / ${inr(receipt.totalDue)}`}
                </Text>
              </View>
            ) : null}
          </View>
        </View>

        <SectionTitle s={s} label={L.paidFor} />
        <View style={[sharedStyles.tableHeader, s.tableHeader]}>
          <Th label={L.installment} />
          <Th label={L.dueDate} />
          <Th label={L.pendingBefore} right />
          <Th label={L.paid} right />
          <Th label={L.pendingAfter} right />
        </View>
        {rows.map((row, index) => (
          <View key={`${row.label}-${index}`} style={[sharedStyles.tableRow, s.tableRow]}>
            <Text style={sharedStyles.th}>{row.label}</Text>
            <Text style={sharedStyles.th}>{formatPdfDate(row.dueDate)}</Text>
            <Text style={s.moneyRight}>
              {row.pendingBefore === null ? "—" : inr(row.pendingBefore)}
            </Text>
            <View style={{ flex: 1, alignItems: "flex-end" }}>
              <Text style={s.money}>{inr(row.paid)}</Text>
              {row.adjustmentAmount ? (
                <Text style={{ fontSize: 6.5, color: pdfTokens.muted }}>
                  {`adjustment ${row.adjustmentAmount > 0 ? "+" : "−"}`}
                  <Text style={s.money}>{inr(Math.abs(row.adjustmentAmount))}</Text>
                </Text>
              ) : null}
            </View>
            <Text style={s.moneyRight}>
              {row.pendingAfter === null ? "—" : inr(row.pendingAfter)}
            </Text>
          </View>
        ))}
        <View style={s.totalRow}>
          <Text style={[sharedStyles.th, { fontFamily: "Helvetica-Bold", letterSpacing: 0.6 }]}>
            {L.total.en.toUpperCase()}
          </Text>
          <Text style={sharedStyles.th} />
          <Text style={sharedStyles.thRight} />
          <Text style={[s.moneyRight, { fontSize: v11(dense), color: pdfTokens.inkStrong }]}>
            {inr(totalPaid)}
          </Text>
          <Text style={[s.moneyRight, { color: pdfTokens.muted }]}>
            {inr(Math.max(receipt.outstandingAfterReceipt, 0))}
          </Text>
        </View>

        {rows.some((row) => row.pendingBefore !== null || row.pendingAfter !== null) ? (
          // Two runs: Helvetica has no Devanagari, and one Text printed the
          // Hindi half as mojibake.
          <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "baseline" }}>
            <Text style={s.note}>{`${L.owedNote.en}\u00A0`}</Text>
            <Text style={[s.note, { fontFamily: HI_FONT }]}>{L.owedNote.hi}</Text>
          </View>
        ) : null}

        {receipt.discountAmount > 0 || receipt.lateFeeAmount > 0 || receipt.lateFeeWaived > 0 ? (
          <View style={{ flexDirection: "row", flexWrap: "wrap", marginTop: dense ? 3 : 5, gap: 10 }}>
            {receipt.discountAmount > 0 ? (
              <MoneyWithLabel labelEn="Discount applied" value={receipt.discountAmount} size={7.5} />
            ) : null}
            {receipt.lateFeeAmount > 0 ? (
              <MoneyWithLabel labelEn="Late fee" value={receipt.lateFeeAmount} size={7.5} />
            ) : null}
            {receipt.lateFeeWaived > 0 ? (
              <MoneyWithLabel labelEn="Late fee waived" value={receipt.lateFeeWaived} size={7.5} />
            ) : null}
            <Text style={{ fontSize: 7.5, color: pdfTokens.muted }}>
              A late fee is a separate charge and is never part of fees pending.
            </Text>
          </View>
        ) : null}

        {receipt.conventionalDiscountAssignments.length > 0 ? (
          <>
            <SectionTitle s={s} label={L.discountPolicies} />
            <View style={[sharedStyles.tableHeader, s.tableHeader]}>
              <Th label={L.policy} />
              <Th label={L.tuitionBefore} right />
              <Th label={L.tuitionAfter} right />
              <Th label={L.applied} right />
            </View>
            {/* Every assignment on file, not just the winning one. The school
                rule is that the lowest candidate tuition wins; showing only the
                winner would hide what else was considered. */}
            {receipt.conventionalDiscountAssignments.map((policy) => (
              <View key={policy.assignmentId} style={[sharedStyles.tableRow, s.tableRow]}>
                <Text style={sharedStyles.th}>{policy.policyDisplayName}</Text>
                <Text style={s.moneyRight}>{inr(policy.beforeTuitionAmount)}</Text>
                <Text style={s.moneyRight}>{inr(policy.resultingTuitionAmount)}</Text>
                {/* Under its "Applied" heading, at the right: the badge sets its
                    own alignSelf, so the row places it. */}
                <View style={{ flex: 1, flexDirection: "row", justifyContent: "flex-end" }}>
                  <Badge tone={policy.isWinningPolicy ? "success" : "neutral"}>
                    {policy.isWinningPolicy ? "Applied" : "Superseded"}
                  </Badge>
                </View>
              </View>
            ))}
          </>
        ) : null}

        {receipt.installmentStatus.length > 0 ? (
          <>
            <SectionTitle s={s} label={L.yearAtGlance} />
            <View style={s.tileGrid}>
              {receipt.installmentStatus.map((item) => {
                const settled = item.status === "paid";
                return (
                  <View key={`${item.installmentNo}-${item.label}`} style={[s.tile, { width: tileWidth }]}>
                    <View style={[s.tileInner, settled ? s.tileInnerPaid : {}]}>
                      <Text style={s.tileLabel}>{item.label.toUpperCase()}</Text>
                      {settled ? (
                        <Text
                          style={{
                            fontSize: 10,
                            fontFamily: "Helvetica-Bold",
                            color: pdfTokens.success,
                            marginTop: 2,
                          }}
                        >
                          {/* No tick glyph: U+2713 is in neither Helvetica nor
                              Noto Sans Devanagari, so the screen's "Paid ✓"
                              would print as a blank box. The word alone, in
                              green, says the same thing and always renders. */}
                          {L.paidTick.en.toUpperCase()}
                        </Text>
                      ) : (
                        <View style={s.tileValueRow}>
                          <Text
                            style={{
                              fontSize: 11,
                              fontFamily: MONEY_FONT,
                              color: pdfTokens.inkStrong,
                            }}
                          >
                            {inr(item.pending)}
                          </Text>
                          <Text style={{ fontSize: 8, color: pdfTokens.muted }}>
                            {`\u00A0${L.due.en}`}
                          </Text>
                        </View>
                      )}
                      <Text style={s.tileDate}>{formatPdfDate(item.dueDate)}</Text>
                    </View>
                  </View>
                );
              })}
            </View>
            {/* The screen's totals strip: expected and paid on the left, what is
                still due on the right, on one line. */}
            <View style={s.strip}>
              <View style={s.stripRow}>
                <MoneyWithLabel labelEn={L.totalExpected.en} value={receipt.totalDue} size={8} />
                <Text style={{ fontSize: 8, color: pdfTokens.muted }}>{"   ·   "}</Text>
                <MoneyWithLabel labelEn={L.paidSoFar.en} value={receipt.totalPaidToDate} size={8} />
              </View>
              {outstanding > 0 ? (
                <MoneyWithLabel
                  labelEn={L.balanceDue.en}
                  labelHi={L.balanceDue.hi}
                  value={outstanding}
                  bold
                  color={pdfTokens.warning}
                  size={9}
                />
              ) : (
                <Text style={{ fontSize: 9, fontFamily: "Helvetica-Bold", color: pdfTokens.success }}>
                  {L.allClear.en}
                </Text>
              )}
            </View>
          </>
        ) : null}

        {/* The three figures do not subtract, and a parent who tries gets a
            different answer, so the document has to say why.

            It states the definitions rather than attributing the gap to a single
            cause. An earlier draft asserted the whole difference was late-fee
            money; on a reversed receipt that was flatly wrong — there the gap is
            the reversal. Naming a cause this document has not actually computed
            is how a confident wrong sentence gets printed and handed to a
            parent. */}
        {Math.round(receipt.totalDue - receipt.totalPaidToDate) !==
        Math.round(receipt.currentOutstanding) ? (
          <Text style={{ fontSize: 7, color: pdfTokens.muted, marginTop: 3 }}>
            {/* Four lines of 7pt prose, on a document that has to end with its
                parent stub on page one. The point survives in one sentence: the
                three figures measure different things, and the document says
                which. The full explanation lives on the statement, which has
                room for it. */}
            {`Expected and balance count fees only; paid counts every rupee received, including late fees and reversed receipts — so the three will not subtract.`}
          </Text>
        ) : null}

        {/* Stamps, signature and stub travel together, and are never split —
            a signature at the foot of page one and a tear-off stub at the head
            of page two is two broken halves rather than one document. The
            stamps sit over the statement, beside the signature, rather than on
            a row of their own. */}
        <View wrap={false}>
        <SignatureBlock
          signature={signature}
          statementEn={L.official.en}
          statementHi={L.official.hi}
          tight
          lead={
            <View style={{ flexDirection: "row", gap: 6, marginBottom: 5 }}>
              {isVoided ? <Badge tone="danger">REVERSED</Badge> : <Badge tone="success">PAID</Badge>}
              {isYearClear ? <Badge tone="success">YEAR CLEARED</Badge> : null}
            </View>
          }
        />

        <View style={s.perforation} />
        <View style={s.stub}>
          <View style={s.stubRow}>
            <Text style={{ fontSize: 9, fontFamily: "Helvetica-Bold", color: pdfTokens.inkStrong }}>
              {`${L.receiptNo.en} ${receipt.receiptNumber}`}
            </Text>
            <MoneyWithLabel
              labelEn="Total paid"
              value={totalPaid}
              bold
              color={pdfTokens.success}
              size={9}
            />
          </View>
          <View style={[s.stubRow, { marginTop: 3 }]}>
            <Text style={{ fontSize: 8, color: pdfTokens.muted }}>
              {`${receipt.studentFullName}  ·  ${receipt.classLabel}`}
            </Text>
            <MoneyWithLabel
              labelEn={L.balanceDue.en}
              labelHi={L.balanceDue.hi}
              value={outstanding}
              bold
              color={pdfTokens.inkStrong}
              size={9}
            />
          </View>
          {nextDue && outstanding > 0 ? (
            <View style={{ flexDirection: "row", alignItems: "baseline", marginTop: 3 }}>
              <Text style={{ fontSize: 8, color: pdfTokens.muted }}>{`${L.balanceDue.en}: `}</Text>
              <Text style={{ fontSize: 8, fontFamily: MONEY_FONT, color: pdfTokens.muted }}>
                {inr(outstanding)}
              </Text>
              <Text style={{ fontSize: 8, color: pdfTokens.muted }}>
                {`\u00A0— kindly pay by ${formatPdfDate(nextDue.dueDate)}`}
              </Text>
            </View>
          ) : null}
          <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "baseline", marginTop: 4 }}>
            <Text style={{ fontSize: 7.5, color: pdfTokens.muted }}>{`${L.keepRecords.en}  `}</Text>
            <Text style={{ fontSize: 7.5, color: pdfTokens.muted, fontFamily: HI_FONT }}>
              {L.keepRecords.hi}
            </Text>
          </View>
        </View>
        </View>

        <Text style={sharedStyles.footer} fixed>
          {`${schoolProfile.name} · computer-generated receipt · ${receipt.receiptNumber}`}
        </Text>
      </Page>
    </Document>
  );
}

/** The total's figure, a size smaller when the sheet is set tight. */
function v11(dense: boolean): number {
  return dense ? 10 : 11;
}
