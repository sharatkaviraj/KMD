/* eslint-disable jsx-a11y/alt-text -- react-pdf Image is PDF content, not an HTML image. */
import "server-only";
import * as React from "react";
import QRCode from "qrcode";
import { Document, Font, Page, Text, View, Image, Svg, Polygon, Line, renderToBuffer } from "@react-pdf/renderer";
import { ensurePdfFontsRegistered, HI_FONT, loadLogoImage, type PdfImage } from "@/platform/pdf/document-kit";
import { certificateBodyText, detailRows, kindOf, placeholderValues, purposeLine, verifyPath, wordingSegments, type CertificateSnapshot, type DetailRowKey, type Segment } from "../domain/certificate";
import { dateLong } from "../domain/date-words";

/*
 * The school's documents, set like the certificates parents frame: a double
 * rule in navy and gold, the letterhead, a formal title, the child's facts set
 * apart in the wording, and a signatory block with the principal's name. The
 * page itself carries no workflow notice; whether it has been signed is the
 * register's business, not the paper's.
 */

const C = { navy: "#0B2545", gold: "#A67C2E", goldSoft: "#E9DCC0", ink: "#1C2230", muted: "#5C6270", faint: "#8A8F99", red: "#B42318" };
const MM = 2.835;
const DEVANAGARI = /[ऀ-ॿ]/;

/** Latin in Times, Devanagari in Noto: react-pdf picks one family per run. */
function Runs({ text, size, bold = false, italic = false, color = C.ink, value = false }: { text: string; size: number; bold?: boolean; italic?: boolean; color?: string; value?: boolean }) {
  const runs = text.match(/[ऀ-ॿ‌‍]+(?:[\s,.।()-]*[ऀ-ॿ‌‍]+)*|[^ऀ-ॿ‌‍]+/g) ?? [];
  return <>{runs.map((run, index) => {
    const hi = DEVANAGARI.test(run);
    const strong = bold || value;
    return <Text key={index} style={{ fontFamily: hi ? HI_FONT : strong ? (italic ? "Times-BoldItalic" : "Times-Bold") : italic ? "Times-Italic" : "Times-Roman", fontWeight: hi && strong ? "bold" : "normal", fontSize: hi ? size * 0.92 : size, color: value ? C.navy : color }}>{run}</Text>;
  })}</>;
}

function Line1({ text, size, bold, italic, color, align = "center", spacing = 0, upper = false }: { text: string; size: number; bold?: boolean; italic?: boolean; color?: string; align?: "center" | "left" | "right" | "justify"; spacing?: number; upper?: boolean }) {
  return <Text style={{ textAlign: align, letterSpacing: spacing, lineHeight: 1.28 }}><Runs text={upper ? text.toUpperCase() : text} size={size} bold={bold} italic={italic} color={color} /></Text>;
}

function Paragraph({ segments, size, compact = false }: { segments: Segment[]; size: number; compact?: boolean }) {
  return <Text style={{ textAlign: "justify", lineHeight: compact ? 1.55 : 1.85 }}>{segments.map((segment, index) => <Runs key={index} text={segment.text} size={size} value={segment.value} />)}</Text>;
}

function Diamond({ size = 7, color = C.gold }: { size?: number; color?: string }) {
  const h = size / 2;
  return <Svg width={size} height={size}><Polygon points={`${h},0 ${size},${h} ${h},${size} 0,${h}`} fill={color} /></Svg>;
}

function Rule({ width = 180, gap = 8 }: { width?: number; gap?: number }) {
  return <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", marginVertical: gap }}>
    <View style={{ width, height: 0.8, backgroundColor: C.gold }} /><View style={{ marginHorizontal: 6 }}><Diamond /></View><View style={{ width, height: 0.8, backgroundColor: C.gold }} />
  </View>;
}

/** Double frame with corner ornaments, drawn behind everything else. */
function Frame() {
  const corner = (style: Record<string, number>) => <View fixed style={{ position: "absolute", ...style }}>
    <Svg width={22} height={22}><Polygon points="11,0 22,11 11,22 0,11" fill="#FFFFFF" stroke={C.gold} strokeWidth={0.8} /><Polygon points="11,5 17,11 11,17 5,11" fill={C.gold} /></Svg>
  </View>;
  return <>
    <View fixed style={{ position: "absolute", top: 16, left: 16, right: 16, bottom: 16, borderWidth: 2.2, borderColor: C.navy }} />
    <View fixed style={{ position: "absolute", top: 22, left: 22, right: 22, bottom: 22, borderWidth: 0.7, borderColor: C.gold }} />
    {corner({ top: 11, left: 11 })}{corner({ top: 11, right: 11 })}{corner({ bottom: 11, left: 11 })}{corner({ bottom: 11, right: 11 })}
  </>;
}

const ROW_LABELS: Record<DetailRowKey, [string, string]> = {
  studentName: ["Name of the student", "विद्यार्थी का नाम"], fatherName: ["Father's name", "पिता का नाम"], motherName: ["Mother's name", "माता का नाम"],
  dateOfBirth: ["Date of birth (in figures)", "जन्म तिथि (अंकों में)"], dateOfBirthWords: ["Date of birth (in words)", "जन्म तिथि (शब्दों में)"],
  admissionNo: ["Admission / SR number", "प्रवेश / एसआर संख्या"], admittedOn: ["Date of admission", "प्रवेश की तिथि"], enrolledOn: ["Date of enrolment", "नामांकन की तिथि"],
  classLabel: ["Class last studied", "अंतिम अध्ययनरत कक्षा"], sessionLabel: ["Academic session", "शैक्षणिक सत्र"], lastResult: ["Result of last examination", "अंतिम परीक्षा का परिणाम"],
  leftOn: ["Date of leaving", "विद्यालय छोड़ने की तिथि"], reasonForLeaving: ["Reason for leaving", "विद्यालय छोड़ने का कारण"], conduct: ["Conduct and character", "आचरण एवं चरित्र"],
  remarks: ["Remarks", "टिप्पणी"],
};

function Details({ snapshot, languages, compact }: { snapshot: CertificateSnapshot; languages: ("en" | "hi")[]; compact: boolean }) {
  const primary = languages[0];
  const rows = detailRows(snapshot, primary);
  if (!rows.length) return null;
  const words = languages.includes("hi") && primary === "en" ? placeholderValues(snapshot, "hi", "row").dateOfBirthWords : "";
  return <View style={{ marginTop: 10, borderTopWidth: 0.8, borderColor: C.goldSoft }}>
    {rows.map((row, index) => {
      const [en, hi] = ROW_LABELS[row.key];
      const label = languages.length === 2 ? `${en} / ${hi}` : languages[0] === "hi" ? hi : en;
      const value = row.key === "dateOfBirthWords" && words ? `${row.value} / ${words}` : row.value;
      return <View key={row.key} wrap={false} style={{ flexDirection: "row", paddingVertical: compact ? 3 : 5.5, borderBottomWidth: 0.6, borderColor: C.goldSoft, borderStyle: "dashed" }}>
        <Text style={{ width: 22, fontFamily: "Times-Roman", fontSize: 10.5, color: C.gold }}>{index + 1}.</Text>
        <View style={{ width: "44%", paddingRight: 8 }}><Text><Runs text={label} size={compact ? 9.5 : 10.5} color={C.muted} /></Text></View>
        <View style={{ flex: 1 }}><Text><Runs text={value} size={compact ? 10.5 : 11.5} value /></Text></View>
      </View>;
    })}
  </View>;
}

type Prepared = { snapshot: CertificateSnapshot; qr: string | null; verifyUrl: string | null; logo: PdfImage | null };

function CertificatePage({ snapshot, qr, verifyUrl, logo }: Prepared) {
  const t = snapshot.template, school = snapshot.school, kind = kindOf(snapshot);
  const languages: ("en" | "hi")[] = t.language === "both" ? ["en", "hi"] : [t.language];
  const both = languages.length === 2, hiOnly = t.language === "hi";
  const preprinted = school.layout === "preprinted";
  const compact = kind === "tc" || (both && (t.detailRows ?? []).length > 0);
  const bodySize = compact ? 11 : both ? 12 : 13.5;
  const issued = (language: "en" | "hi") => dateLong(snapshot.issuedOn, language) ?? snapshot.issuedOn;
  const say = (en: string, hi: string) => both ? `${en} / ${hi}` : hiOnly ? hi : en;
  const shift = preprinted ? { marginLeft: (school.offsetX ?? 0) * MM, marginTop: (school.offsetY ?? 0) * MM } : {};
  const designation = both ? `${school.principalDesignation || "Principal"} / ${school.principalDesignationHi || "प्रधानाचार्य"}` : hiOnly ? school.principalDesignationHi || "प्रधानाचार्य" : school.principalDesignation || "Principal";
  const logoSrc = school.logo || logo;
  const codes = [school.udiseCode ? `UDISE: ${school.udiseCode}` : "", school.recognitionNo ? say(`Recognition No. ${school.recognitionNo}`, `मान्यता क्र. ${school.recognitionNo}`) : "", school.pspCode ? `PSP: ${school.pspCode}` : ""].filter(Boolean).join("   •   ");

  return <Page size="A4" style={{ paddingTop: preprinted ? 150 : compact ? 34 : 40, paddingBottom: 46, paddingHorizontal: preprinted ? 56 : 50, color: C.ink, fontFamily: "Times-Roman" }}>
    {!preprinted ? <Frame /> : null}
    {!preprinted && logoSrc ? <View fixed style={{ position: "absolute", top: 260, left: 0, right: 0, alignItems: "center" }}><Image src={logoSrc} style={{ width: 290, height: 290, opacity: 0.05 }} /></View> : null}
    {snapshot.isTest ? <View fixed style={{ position: "absolute", top: 380, left: 0, right: 0, alignItems: "center", transform: "rotate(-28deg)" }}><Text style={{ fontFamily: "Helvetica-Bold", fontSize: 44, color: C.red, opacity: 0.16, letterSpacing: 4 }}>TEST · NOT VALID</Text></View> : null}

    <View style={{ ...shift, flexGrow: 1 }}>
      {!preprinted ? <View style={{ flexDirection: "row", alignItems: "center", marginTop: 6 }}>
        <View style={{ width: 62, alignItems: "flex-start" }}>{logoSrc ? <Image src={logoSrc} style={{ width: compact ? 48 : 58, height: compact ? 48 : 58 }} /> : null}</View>
        <View style={{ flex: 1, alignItems: "center", paddingHorizontal: 4 }}>
          {school.nameHi ? <Line1 text={school.nameHi} size={16} bold color={C.navy} /> : null}
          <Line1 text={school.name} size={school.name.length > 40 ? 16.5 : 19} bold color={C.navy} spacing={0.6} upper />
          {school.affiliation ? <Line1 text={school.affiliation} size={9.5} italic color={C.muted} /> : null}
          {school.address ? <Line1 text={school.address} size={9.5} color={C.muted} /> : null}
          {[school.phone, school.email].filter(Boolean).length ? <Line1 text={[school.phone ? `Phone: ${school.phone}` : "", school.email].filter(Boolean).join("   |   ")} size={9} color={C.muted} /> : null}
        </View>
        <View style={{ width: 62 }} />
      </View> : null}
      {!preprinted && codes ? <Line1 text={codes} size={8.5} color={C.faint} spacing={0.3} /> : null}
      {!preprinted ? <Rule width={205} gap={compact ? 5 : 8} /> : null}

      <View style={{ flexDirection: "row", justifyContent: "space-between", marginTop: 4 }}>
        <Text><Runs text={`${say("Ref. No.", "क्रमांक")}  `} size={10} color={C.muted} /><Runs text={snapshot.serial} size={10} value /></Text>
        <Text><Runs text={`${say("Date", "दिनांक")}:  `} size={10} color={C.muted} /><Runs text={issued(hiOnly ? "hi" : "en")} size={10} value /></Text>
      </View>

      <View style={{ alignItems: "center", marginTop: compact ? 12 : 20, marginBottom: 6 }}>
        {!hiOnly ? <Line1 text={t.titleEn} size={22} bold color={C.navy} spacing={2.4} upper /> : null}
        {hiOnly || both ? <Line1 text={t.titleHi} size={both ? 15 : 20} bold color={both ? C.gold : C.navy} /> : null}
        <View style={{ flexDirection: "row", alignItems: "center", marginTop: 6 }}>
          <View style={{ width: 46, height: 1, backgroundColor: C.gold }} /><View style={{ marginHorizontal: 5 }}><Diamond size={6} /></View><View style={{ width: 46, height: 1, backgroundColor: C.gold }} />
        </View>
      </View>
      <View style={compact ? {} : { flexGrow: 1, justifyContent: "center", paddingBottom: 30 }}>
      {kind !== "tc" ? <View style={{ marginTop: 6, marginBottom: 10 }}><Line1 text={say("To whom it may concern", "जिसके लिए भी संबंधित हो")} size={11} italic color={C.muted} /></View> : <View style={{ height: 10 }} />}

      {languages.map((language, index) => <View key={language} style={{ marginTop: index ? 12 : 0 }}>
        <Paragraph segments={wordingSegments(certificateBodyText(snapshot, language), placeholderValues(snapshot, language))} size={bodySize} compact={compact} />
        {purposeLine(snapshot, language) ? <View style={{ marginTop: 6 }}><Text style={{ lineHeight: 1.7 }}><Runs text={purposeLine(snapshot, language)!} size={bodySize - 1} italic /></Text></View> : null}
      </View>)}

      <Details snapshot={snapshot} languages={languages} compact={compact} />
      </View>
    </View>

    <View wrap={false} style={shift}>
      <View style={{ flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between", marginTop: compact ? 14 : 26 }}>
        <View style={{ width: 170 }}>
          {school.place ? <Text style={{ marginBottom: 2 }}><Runs text={`${say("Place", "स्थान")}:  `} size={10.5} color={C.muted} /><Runs text={school.place} size={10.5} value /></Text> : null}
          <Text style={{ marginBottom: compact ? 6 : 10 }}><Runs text={`${say("Date", "दिनांक")}:  `} size={10.5} color={C.muted} /><Runs text={issued(hiOnly ? "hi" : "en")} size={10.5} value /></Text>
          {qr && !preprinted ? <View style={{ flexDirection: "row", alignItems: "center" }}>
            <Image src={qr} style={{ width: compact ? 46 : 54, height: compact ? 46 : 54 }} />
            <View style={{ marginLeft: 7, width: 104 }}>
              <Text><Runs text={say("Scan to verify", "सत्यापन हेतु स्कैन करें")} size={8} bold color={C.navy} /></Text>
              {verifyUrl ? <Text style={{ fontFamily: "Helvetica", fontSize: 6.5, color: C.faint, marginTop: 2 }}>{verifyUrl.replace(/^https?:\/\//, "")}</Text> : null}
            </View>
          </View> : null}
        </View>
        {!preprinted ? <View style={{ width: compact ? 66 : 82, height: compact ? 66 : 82, borderRadius: compact ? 33 : 41, borderWidth: 0.9, borderColor: C.goldSoft, borderStyle: "dashed", alignItems: "center", justifyContent: "center" }}>
          <Text><Runs text={say("School seal", "मुहर")} size={8} color={C.faint} /></Text>
        </View> : null}
        <View style={{ width: 178, alignItems: "center" }}>
          {school.signaturePolicy === "facsimile" && school.signature ? <Image src={school.signature} style={{ height: compact ? 32 : 40, maxWidth: 150, objectFit: "contain", marginBottom: 2 }} /> : <View style={{ height: compact ? 30 : 42 }} />}
          <Svg width={170} height={2}><Line x1={0} y1={1} x2={170} y2={1} stroke={C.navy} strokeWidth={0.8} /></Svg>
          {school.principalName ? <Text style={{ marginTop: 4 }}><Runs text={school.principalName} size={11} bold color={C.navy} /></Text> : null}
          <Text style={{ marginTop: school.principalName ? 1 : 4 }}><Runs text={designation} size={10} color={C.muted} /></Text>
          <Text style={{ marginTop: 1, textAlign: "center" }}><Runs text={hiOnly ? school.nameHi || school.name : school.name} size={8.5} color={C.faint} /></Text>
        </View>
      </View>
    </View>

    {!preprinted ? <Text fixed style={{ position: "absolute", bottom: 27, left: 40, right: 40, textAlign: "center", fontSize: 7, color: C.faint, fontFamily: "Helvetica" }}
      render={({ pageNumber, totalPages }) => `${snapshot.serial}${totalPages > 1 ? `   ·   ${pageNumber} / ${totalPages}` : ""}   ·   Issued from the school's records${snapshot.verifyCode ? "; scan the code to confirm it is genuine" : ""}`} /> : null}
  </Page>;
}

let hyphenationOff = false;
function noHyphenation() {
  if (hyphenationOff) return;
  Font.registerHyphenationCallback((word) => [word]);
  hyphenationOff = true;
}

async function prepare(snapshot: CertificateSnapshot, logo: PdfImage | null): Promise<Prepared> {
  const base = snapshot.school.verifyBase?.replace(/\/$/, "");
  const verifyUrl = snapshot.verifyCode && base ? `${base}${verifyPath(snapshot.verifyCode)}` : null;
  const qr = verifyUrl && !snapshot.isTest ? await QRCode.toDataURL(verifyUrl, { margin: 0, width: 240, errorCorrectionLevel: "M", color: { dark: C.navy, light: "#FFFFFF" } }) : null;
  return { snapshot, qr, verifyUrl, logo };
}

const titleOf = (snapshot: CertificateSnapshot) => `${snapshot.template.titleEn} ${snapshot.serial}`;

/** One stored document: the bytes a reprint returns for ever. */
export async function renderCertificatePdf(snapshot: CertificateSnapshot): Promise<Buffer> {
  ensurePdfFontsRegistered();
  noHyphenation();
  const page = await prepare(snapshot, await loadLogoImage());
  return renderToBuffer(<Document title={titleOf(snapshot)} author={snapshot.school.name} creationDate={new Date(snapshot.issuedAt)} modificationDate={new Date(snapshot.issuedAt)}><CertificatePage {...page} /></Document>);
}

/**
 * Several frozen snapshots in one file for the signing tray. Each page is the
 * same deterministic layout as its stored document; nothing is re-read.
 */
export async function renderCertificateBundle(snapshots: CertificateSnapshot[], title: string): Promise<Buffer> {
  ensurePdfFontsRegistered();
  noHyphenation();
  const logo = await loadLogoImage();
  const pages = await Promise.all(snapshots.map((snapshot) => prepare(snapshot, logo)));
  return renderToBuffer(<Document title={title}>{pages.map((page) => <CertificatePage key={page.snapshot.serial} {...page} />)}</Document>);
}

/** Kept for callers written before kinds existed. */
export const renderStudyCertificatePdf = renderCertificatePdf;
