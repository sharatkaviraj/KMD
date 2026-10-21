import "server-only";

import * as React from "react";
import { Document, Page, Text, View, renderToBuffer } from "@react-pdf/renderer";

import { cardWeights, markIn, reportColumns, type ReportCard } from "@/modules/assessments/domain/report-card";
import { ensurePdfFontsRegistered, HI_FONT, loadLogoImage, loadSignatureImage, ParentDocumentLetterhead, pdfTokens, sharedStyles, SignatureBlock, type PdfImage } from "@/platform/pdf/document-kit";

import { subjectPair } from "./domain/groups";

/*
 * The report card a family is handed, one A4 page per child: the term's
 * marks by exam, grace shown beside the mark it lifted (never added into it),
 * attendance, the class teacher's remark, and whether this is the issued
 * card or a draft that will still move.
 */

export type CardForPdf = {
  card: ReportCard;
  /** Grace marks by subject code. */
  grace: Record<string, number>;
  remark: string | null;
  issued: boolean;
};

const s = {
  label: { fontSize: 7, color: pdfTokens.muted },
  labelHi: { fontSize: 7, color: pdfTokens.muted, fontFamily: HI_FONT },
  value: { fontSize: 10, fontFamily: "Helvetica-Bold", color: pdfTokens.inkStrong },
  cellHi: { fontSize: 7, color: pdfTokens.muted, fontFamily: HI_FONT },
};

function Fact({ en, hi, value }: { en: string; hi: string; value: string }) {
  return (
    <View style={{ width: "50%", marginBottom: 6 }}>
      <Text style={s.labelHi}>
        {hi} <Text style={s.label}>/ {en}</Text>
      </Text>
      <Text style={s.value}>{value}</Text>
    </View>
  );
}

function markText(m: ReportCard["rows"][number]["marks"][number]): string {
  if (m.exempt) return "EX";
  if (m.absent) return "AB";
  if (m.value === null) return "—";
  return String(m.value);
}

function CardPage({ entry, title, logo, signature }: { entry: CardForPdf; title: { en: string; hi: string }; logo: PdfImage | null; signature: PdfImage | null }) {
  const { card } = entry;
  // Every exam any subject sat, not the first row's — or a subject with one
  // exam fewer shifts every mark under the wrong heading (coordinators B5).
  const exams = reportColumns(card.rows).map((c) => ({ code: c.assessmentCode, en: c.assessmentLabelEn, hi: c.assessmentLabelHi, max: c.maxMarks }));
  const graceTotal = Object.values(entry.grace).reduce((a, b) => a + b, 0);
  const [remarkEn, remarkHi] = (entry.remark ?? "").split("\n");
  // Which subjects a child needs support in (`cardResult`): a bare "Needs support" told a parent nothing.
  const short = [...new Set([...(card.shortIn ?? []), ...(card.absentIn ?? [])])].map(subjectPair);
  const result = short.length
    ? { en: `Needs support in ${short.map((x) => x.en).join(", ")}`, hi: `${short.map((x) => x.hi ?? x.en).join(", ")} में सहायता चाहिए` }
    : { en: "Needs support", hi: "पूरक कक्षाएँ" };
  const weighted = cardWeights(card);
  const weights = weighted.length
    ? { en: `Each exam's marks count: ${weighted.map((w) => `${w.en} ×${w.weight}`).join(", ")}`, hi: `हर परीक्षा का भार: ${weighted.map((w) => `${w.hi || w.en} ×${w.weight}`).join(", ")}` }
    : { en: "", hi: "" };
  return (
    <Page size="A4" style={sharedStyles.page}>
      <ParentDocumentLetterhead docTitleEn={title.en.toUpperCase()} docTitleHi={title.hi} logo={logo} />
      {!entry.issued ? (
        <Text style={{ marginTop: 6, textAlign: "center", color: pdfTokens.warning, fontFamily: "Helvetica-Bold" }}>
          NOT ISSUED YET — marks may still change <Text style={{ fontFamily: HI_FONT }}>· अभी जारी नहीं, अंक बदल सकते हैं</Text>
        </Text>
      ) : null}
      <View style={{ flexDirection: "row", flexWrap: "wrap", marginTop: 12 }}>
        <Fact en="Student" hi="छात्र" value={card.studentName} />
        <Fact en="Father" hi="पिता" value={card.fatherName ?? "—"} />
        <Fact en="Class" hi="कक्षा" value={`${card.classLabel}${card.rollNo ? ` · Roll ${card.rollNo}` : ""}`} />
        <Fact en="SR no." hi="एस.आर. नं." value={card.admissionNo ?? "—"} />
      </View>

      <View style={{ borderWidth: 0.8, borderColor: pdfTokens.rule, marginTop: 6 }}>
        <View style={sharedStyles.tableHeader}>
          <View style={{ flex: 2.2 }}>
            <Text style={s.labelHi}>विषय</Text>
            <Text style={sharedStyles.thEn}>Subject</Text>
          </View>
          {exams.map((e) => (
            <View key={e.code} style={{ flex: 1, alignItems: "flex-end" }}>
              <Text style={s.labelHi}>{e.hi}</Text>
              <Text style={sharedStyles.thEn}>{e.code}</Text>
            </View>
          ))}
          <View style={{ flex: 1.2, alignItems: "flex-end" }}>
            <Text style={s.labelHi}>प्राप्तांक</Text>
            <Text style={sharedStyles.thEn}>Marks</Text>
          </View>
          <View style={{ flex: 0.8, alignItems: "flex-end" }}>
            <Text style={s.labelHi}>ग्रेड</Text>
            <Text style={sharedStyles.thEn}>Grade</Text>
          </View>
        </View>
        {card.rows.map((row) => {
          const g = entry.grace[row.subjectCode] ?? 0;
          const name = subjectPair(row.subjectCode);
          return (
            <View key={row.subjectCode} style={[sharedStyles.tableRow, { paddingVertical: 5 }]} wrap={false}>
              <View style={{ flex: 2.2 }}>
                <Text style={{ fontFamily: "Helvetica-Bold" }}>{name.en}</Text>
                {name.hi ? <Text style={s.cellHi}>{name.hi}</Text> : null}
              </View>
              {exams.map((e) => {
                const m = markIn(row, e.code);
                return (
                  <Text key={e.code} style={{ flex: 1, textAlign: "right" }}>
                    {m ? `${markText(m)}/${m.maxMarks}` : ""}
                  </Text>
                );
              })}
              <Text style={{ flex: 1.2, textAlign: "right", fontFamily: "Helvetica-Bold" }}>
                {row.scored}
                {g ? ` +${g}G` : ""}/{row.outOf}
              </Text>
              <Text style={{ flex: 0.8, textAlign: "right", fontFamily: "Helvetica-Bold" }}>{row.grade ?? "—"}</Text>
            </View>
          );
        })}
        <View style={[sharedStyles.tableHeader, { paddingVertical: 6 }]}>
          <Text style={{ flex: 2.2 + exams.length, fontFamily: "Helvetica-Bold" }}>Total · कुल</Text>
          <Text style={{ flex: 1.2, textAlign: "right", fontFamily: "Helvetica-Bold" }}>
            {card.totals.scored}
            {graceTotal ? ` +${graceTotal}G` : ""}/{card.totals.outOf}
          </Text>
          <Text style={{ flex: 0.8, textAlign: "right", fontFamily: "Helvetica-Bold" }}>{card.grade ?? "—"}</Text>
        </View>
      </View>

      <View style={{ flexDirection: "row", marginTop: 10, gap: 12 }}>
        <View style={{ flex: 1, backgroundColor: pdfTokens.panel, padding: 8 }}>
          <Text style={s.labelHi}>प्रतिशत / Percentage</Text>
          <Text style={s.value}>
            {card.totals.percent === null ? "—" : `${card.totals.percent}%`}
            {card.passed === null ? "" : card.passed ? " · Pass" : ` · ${result.en}`}
          </Text>
          {card.passed === false && result.hi ? <Text style={s.cellHi}>{result.hi}</Text> : card.passed ? <Text style={s.cellHi}>उत्तीर्ण</Text> : null}
          {card.gradeDescription ? <Text style={s.cellHi}>{card.gradeDescription.hi}</Text> : null}
          {/* The exams count differently, so the percentage is not the total divided by the maximum: say by how much. */}
          {weights.en ? (
            <Text style={s.label}>
              {weights.en} <Text style={s.labelHi}>/ {weights.hi}</Text>
            </Text>
          ) : null}
        </View>
        <View style={{ flex: 1, backgroundColor: pdfTokens.panel, padding: 8 }}>
          <Text style={s.labelHi}>उपस्थिति / Attendance</Text>
          <Text style={s.value}>{card.attendance ? `${card.attendance.present} / ${card.attendance.counted}${card.attendance.percent === null ? "" : ` · ${card.attendance.percent}%`}` : "—"}</Text>
        </View>
      </View>

      {entry.remark ? (
        <View style={{ marginTop: 10, borderLeftWidth: 2, borderLeftColor: pdfTokens.accent, paddingLeft: 8 }}>
          <Text style={s.labelHi}>कक्षा अध्यापक की टिप्पणी / Class teacher&apos;s remark</Text>
          {remarkHi ? <Text style={{ fontFamily: HI_FONT, fontSize: 9, marginTop: 2 }}>{remarkHi}</Text> : null}
          <Text style={{ fontSize: 9, marginTop: 2 }}>{remarkEn}</Text>
        </View>
      ) : null}

      {graceTotal ? <Text style={[s.label, { marginTop: 8 }]}>G = grace marks given under the school&apos;s rule, shown beside the mark and not added into it.</Text> : null}

      <SignatureBlock signature={entry.issued ? signature : null} statementEn={`Session ${card.sessionLabel} · ${card.term}`} statementHi={`सत्र ${card.sessionLabel}`} captionEn="PRINCIPAL" captionHi="प्रधानाचार्य" />
    </Page>
  );
}

export async function renderReportCardsPdf(input: { cards: CardForPdf[]; title: { en: string; hi: string } }): Promise<Buffer> {
  ensurePdfFontsRegistered();
  const [logo, signature] = await Promise.all([loadLogoImage(), loadSignatureImage()]);
  return renderToBuffer(
    <Document title={input.title.en}>
      {input.cards.map((entry) => (
        <CardPage key={entry.card.studentId} entry={entry} title={input.title} logo={logo} signature={signature} />
      ))}
    </Document>,
  );
}
