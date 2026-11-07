/* eslint-disable jsx-a11y/alt-text -- react-pdf Image is PDF content, not an HTML image. */
import "server-only";
import * as React from "react";
import QRCode from "qrcode";
import { Document, Font, Page, Text, View, Image, Svg, Polygon, Line, renderToBuffer } from "@react-pdf/renderer";
import { ensurePdfFontsRegistered, HI_FONT, loadEmblemImage, loadLogoImage, loadSealImage, loadSignatureImage, type PdfImage } from "@/platform/pdf/document-kit";
import { certificateBodyText, certificateSigned, detailRows, kindOf, placeholderValues, purposeLine, verifyPath, wordingSegments, type CertificateSnapshot, type DetailRowKey, type Segment } from "../domain/certificate";
import { dateLong } from "../domain/date-words";

/*
 * The school's documents, set like the certificates parents frame: a double
 * rule in navy and gold, the school's official letterhead (D-540), a formal
 * title, the child's facts set apart in the wording, and the principal's
 * block. A document prepared or approved by someone allowed to issue it
 * carries the principal's signature and the school seal (D-541); an older
 * one keeps its clean line and empty seal circle for signing by hand.
 *
 * Always one A4 sheet (D-543): the page is drawn at the roomiest size that
 * fits, and a long TC in two languages steps down to a tighter setting rather
 * than spilling a signature onto a second page.
 */

const C = { navy: "#0B2545", gold: "#A67C2E", goldSoft: "#E9DCC0", ink: "#1C2230", muted: "#5C6270", faint: "#8A8F99", red: "#B42318" };
const MM = 2.835;
const DEVANAGARI = /[ऀ-ॿ]/;

/** Three settings of the same page, roomiest first. */
const LEVELS = [
  { crest: 56, nameEn: 19.5, nameHi: 14, meta: 8.8, contact: 7.8, strip: 6.6, title: 22, titleHi: 15, body: 13.5, bodyBoth: 12, purpose: 12.5,
    rowLabel: 10.5, rowValue: 11.5, rowPad: 5.5, titleGap: 18, lead: 1.85, footGap: 24, seal: 104, sign: 46, qr: 56, padTop: 30, ruleGap: 7 },
  { crest: 46, nameEn: 18, nameHi: 12.5, meta: 8.4, contact: 7.5, strip: 6.3, title: 19, titleHi: 14, body: 11, bodyBoth: 11, purpose: 10.5,
    rowLabel: 9.5, rowValue: 10.5, rowPad: 3, titleGap: 10, lead: 1.55, footGap: 12, seal: 92, sign: 40, qr: 48, padTop: 28, ruleGap: 5 },
  { crest: 38, nameEn: 16.5, nameHi: 11.5, meta: 8, contact: 7.1, strip: 6, title: 17, titleHi: 12.5, body: 10, bodyBoth: 10, purpose: 9.5,
    rowLabel: 8.8, rowValue: 9.6, rowPad: 2, titleGap: 6, lead: 1.42, footGap: 8, seal: 84, sign: 34, qr: 42, padTop: 26, ruleGap: 4 },
] as const;
type Level = 0 | 1 | 2;
type Metrics = (typeof LEVELS)[Level];

/** Latin in Times, Devanagari in Noto: react-pdf picks one family per run. */
function Runs({ text, size, bold = false, italic = false, color = C.ink, value = false, sans = false }: { text: string; size: number; bold?: boolean; italic?: boolean; color?: string; value?: boolean; sans?: boolean }) {
  const runs = text.match(/[ऀ-ॿ‌‍]+(?:[\s,.।()-]*[ऀ-ॿ‌‍]+)*|[^ऀ-ॿ‌‍]+/g) ?? [];
  return <>{runs.map((run, index) => {
    const hi = DEVANAGARI.test(run);
    const strong = bold || value;
    const latin = sans ? (strong ? "Helvetica-Bold" : "Helvetica") : strong ? (italic ? "Times-BoldItalic" : "Times-Bold") : italic ? "Times-Italic" : "Times-Roman";
    return <Text key={index} style={{ fontFamily: hi ? HI_FONT : latin, fontWeight: hi && strong ? "bold" : "normal", fontSize: hi ? size * 0.92 : size, color: value ? C.navy : color }}>{run}</Text>;
  })}</>;
}

function Line1({ text, size, bold, italic, color, align = "center", spacing = 0, upper = false, sans = false }: { text: string; size: number; bold?: boolean; italic?: boolean; color?: string; align?: "center" | "left" | "right" | "justify"; spacing?: number; upper?: boolean; sans?: boolean }) {
  return <Text style={{ textAlign: align, letterSpacing: spacing, lineHeight: 1.28 }}><Runs text={upper ? text.toUpperCase() : text} size={size} bold={bold} italic={italic} color={color} sans={sans} /></Text>;
}

function Paragraph({ segments, size, lead }: { segments: Segment[]; size: number; lead: number }) {
  return <Text style={{ textAlign: "justify", lineHeight: lead }}>{segments.map((segment, index) => <Runs key={index} text={segment.text} size={size} value={segment.value} />)}</Text>;
}

function Diamond({ size = 7, color = C.gold }: { size?: number; color?: string }) {
  const h = size / 2;
  return <Svg width={size} height={size}><Polygon points={`${h},0 ${size},${h} ${h},${size} 0,${h}`} fill={color} /></Svg>;
}

/** The letterhead's foot: a navy rule over a gold one, a diamond at the centre. */
function DoubleRule({ gap }: { gap: number }) {
  const half = (side: "l" | "r") => <View style={{ flex: 1, alignItems: side === "l" ? "flex-end" : "flex-start" }}>
    <View style={{ width: "100%", height: 1.3, backgroundColor: C.navy }} /><View style={{ width: "100%", height: 1.6 }} /><View style={{ width: "100%", height: 0.6, backgroundColor: C.gold }} />
  </View>;
  return <View style={{ flexDirection: "row", alignItems: "center", marginTop: gap, marginBottom: gap - 1 }}>
    {half("l")}<View style={{ marginHorizontal: 6 }}><Diamond size={8} /></View>{half("r")}
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

function Details({ snapshot, languages, m }: { snapshot: CertificateSnapshot; languages: ("en" | "hi")[]; m: Metrics }) {
  const primary = languages[0];
  const rows = detailRows(snapshot, primary);
  if (!rows.length) return null;
  const words = languages.includes("hi") && primary === "en" ? placeholderValues(snapshot, "hi", "row").dateOfBirthWords : "";
  return <View style={{ marginTop: 10, borderTopWidth: 0.8, borderColor: C.goldSoft }}>
    {rows.map((row, index) => {
      const [en, hi] = ROW_LABELS[row.key];
      const label = languages.length === 2 ? `${en} / ${hi}` : languages[0] === "hi" ? hi : en;
      const value = row.key === "dateOfBirthWords" && words ? `${row.value} / ${words}` : row.value;
      return <View key={row.key} wrap={false} style={{ flexDirection: "row", paddingVertical: m.rowPad, borderBottomWidth: 0.6, borderColor: C.goldSoft, borderStyle: "dashed" }}>
        <Text style={{ width: 22, fontFamily: "Times-Roman", fontSize: m.rowLabel, color: C.gold }}>{index + 1}.</Text>
        <View style={{ width: "44%", paddingRight: 8 }}><Text><Runs text={label} size={m.rowLabel} color={C.muted} /></Text></View>
        <View style={{ flex: 1 }}><Text><Runs text={value} size={m.rowValue} value /></Text></View>
      </View>;
    })}
  </View>;
}

/** Times-Bold advances (thousandths of an em) for the letters a school's name uses. */
const TIMES_BOLD: Record<string, number> = {
  A: 722, B: 667, C: 722, D: 722, E: 667, F: 611, G: 778, H: 778, I: 389, J: 500, K: 778, L: 667, M: 944, N: 722, O: 778, P: 611, Q: 778, R: 722,
  S: 556, T: 667, U: 722, V: 722, W: 1000, X: 722, Y: 722, Z: 667, " ": 250, ".": 250, ",": 250, "-": 333, "'": 333, "&": 833, "(": 333, ")": 333, "/": 278,
};
/** Width the letterhead can use: A4 less the page's side margins. */
const CONTENT_WIDTH = 595.28 - 2 * 46;

/** The largest size, up to `max`, at which the school's name stays on one line. */
export function nameSize(name: string, max: number, spacing: number): number {
  const upper = name.toUpperCase();
  const em = [...upper].reduce((sum, ch) => sum + (TIMES_BOLD[ch] ?? (/[0-9]/.test(ch) ? 500 : 778)), 0) / 1000;
  const fits = (CONTENT_WIDTH * 0.96 - spacing * upper.length) / Math.max(em, 1);
  return Math.max(11, Math.min(max, Math.floor(fits * 4) / 4));
}

/**
 * The official letterhead: the crest at the head, flanked by the school's
 * registration and codes, then its names on a line each, the trust, the
 * address and how to reach the office, over a navy-and-gold rule.
 */
function Letterhead({ snapshot, crest, m }: { snapshot: CertificateSnapshot; crest: string | PdfImage | null; m: Metrics }) {
  const school = snapshot.school;
  const left = [school.registrationNo ? `Regn. No. ${school.registrationNo}` : "", school.recognitionNo ? `Recognition No. ${school.recognitionNo}` : ""].filter(Boolean);
  const right = [school.udiseCode ? `UDISE Code ${school.udiseCode}` : "", school.pspCode ? `PSP Code ${school.pspCode}` : ""].filter(Boolean);
  const operated = [school.trust ? `Operated by ${school.trust}` : school.affiliation || "", school.recognisedBy ? `Recognised by the ${school.recognisedBy}` : ""].filter(Boolean).join("   ·   ");
  const contact = [school.phone ? `T  ${school.phone}` : "", school.email ? `E  ${school.email}` : "", school.website ? `W  ${school.website}` : ""].filter(Boolean).join("     |     ");
  const crestWidth = m.crest * 1.21;
  const flank = (lines: string[], align: "left" | "right") => <View style={{ flex: 1, alignItems: align === "left" ? "flex-start" : "flex-end" }}>
    {lines.map((line) => <Line1 key={line} text={line} size={m.strip} color={C.muted} spacing={0.6} align={align} upper sans />)}
  </View>;
  const spacing = 0.6;
  return <View>
    <View style={{ flexDirection: "row", alignItems: "center" }}>
      {flank(left, "left")}
      <View style={{ width: crestWidth + 20, alignItems: "center" }}>{crest ? <Image src={crest} style={{ width: crestWidth, height: m.crest }} /> : null}</View>
      {flank(right, "right")}
    </View>
    <View style={{ alignItems: "center", marginTop: 3 }}>
      {school.nameHi ? <Line1 text={school.nameHi} size={m.nameHi} bold color={C.navy} /> : null}
      <Line1 text={school.name} size={nameSize(school.name, m.nameEn, spacing)} bold color={C.navy} spacing={spacing} upper />
      {operated ? <Line1 text={operated} size={m.meta} italic color={C.muted} /> : null}
      {school.address ? <Line1 text={school.address} size={m.meta} color={C.ink} /> : null}
      {contact ? <View style={{ marginTop: 1.5 }}><Line1 text={contact} size={m.contact} color={C.muted} sans /></View> : null}
    </View>
    <DoubleRule gap={m.ruleGap} />
  </View>;
}

type Prepared = { snapshot: CertificateSnapshot; qr: string | null; verifyUrl: string | null; crest: PdfImage | null; seal: PdfImage | null; signature: string | PdfImage | null; level: Level };

function CertificatePage({ snapshot, qr, verifyUrl, crest, seal, signature, level }: Prepared) {
  const m = LEVELS[level];
  const t = snapshot.template, school = snapshot.school, kind = kindOf(snapshot);
  const languages: ("en" | "hi")[] = t.language === "both" ? ["en", "hi"] : [t.language];
  const both = languages.length === 2, hiOnly = t.language === "hi";
  const preprinted = school.layout === "preprinted";
  const roomy = level === 0 && kind !== "tc" && !(both && (t.detailRows ?? []).length > 0);
  const bodySize = both ? m.bodyBoth : m.body;
  const issued = (language: "en" | "hi") => dateLong(snapshot.issuedOn, language) ?? snapshot.issuedOn;
  const say = (en: string, hi: string) => both ? `${en} / ${hi}` : hiOnly ? hi : en;
  const shift = preprinted ? { marginLeft: (school.offsetX ?? 0) * MM, marginTop: (school.offsetY ?? 0) * MM } : {};
  const designation = both ? `${school.principalDesignation || "Principal"} / ${school.principalDesignationHi || "प्रधानाचार्य"}` : hiOnly ? school.principalDesignationHi || "प्रधानाचार्य" : school.principalDesignation || "Principal";
  const crestSrc = school.logo || crest;
  const signed = certificateSigned(snapshot) && Boolean(signature);

  return <Page size="A4" style={{ paddingTop: preprinted ? 150 : m.padTop, paddingBottom: 44, paddingHorizontal: preprinted ? 56 : 46, color: C.ink, fontFamily: "Times-Roman" }}>
    {!preprinted ? <Frame /> : null}
    {!preprinted && crestSrc ? <View fixed style={{ position: "absolute", top: 300, left: 0, right: 0, alignItems: "center" }}><Image src={crestSrc} style={{ width: 300, height: 248, opacity: 0.045 }} /></View> : null}
    {snapshot.isTest ? <View fixed style={{ position: "absolute", top: 380, left: 0, right: 0, alignItems: "center", transform: "rotate(-28deg)" }}><Text style={{ fontFamily: "Helvetica-Bold", fontSize: 44, color: C.red, opacity: 0.16, letterSpacing: 4 }}>TEST · NOT VALID</Text></View> : null}

    <View style={{ ...shift, flexGrow: 1 }}>
      {!preprinted ? <Letterhead snapshot={snapshot} crest={crestSrc} m={m} /> : null}

      <View style={{ flexDirection: "row", justifyContent: "space-between", marginTop: preprinted ? 4 : 9 }}>
        <Text><Runs text={`${say("Ref. No.", "क्रमांक")}  `} size={10} color={C.muted} /><Runs text={snapshot.serial} size={10} value /></Text>
        <Text><Runs text={`${say("Date", "दिनांक")}:  `} size={10} color={C.muted} /><Runs text={issued(hiOnly ? "hi" : "en")} size={10} value /></Text>
      </View>

      <View style={{ alignItems: "center", marginTop: m.titleGap, marginBottom: 6 }}>
        {!hiOnly ? <Line1 text={t.titleEn} size={m.title} bold color={C.navy} spacing={2.4} upper /> : null}
        {hiOnly || both ? <Line1 text={t.titleHi} size={both ? m.titleHi : m.title - 2} bold color={both ? C.gold : C.navy} /> : null}
        <View style={{ flexDirection: "row", alignItems: "center", marginTop: 6 }}>
          <View style={{ width: 46, height: 1, backgroundColor: C.gold }} /><View style={{ marginHorizontal: 5 }}><Diamond size={6} /></View><View style={{ width: 46, height: 1, backgroundColor: C.gold }} />
        </View>
      </View>
      <View style={roomy ? { flexGrow: 1, justifyContent: "center", paddingBottom: 24 } : {}}>
        {kind !== "tc" ? <View style={{ marginTop: 6, marginBottom: 10 }}><Line1 text={say("To whom it may concern", "जिसके लिए भी संबंधित हो")} size={11} italic color={C.muted} /></View> : <View style={{ height: level === 2 ? 4 : 10 }} />}

        {languages.map((language, index) => <View key={language} style={{ marginTop: index ? (level === 2 ? 6 : 12) : 0 }}>
          <Paragraph segments={wordingSegments(certificateBodyText(snapshot, language), placeholderValues(snapshot, language))} size={bodySize} lead={m.lead} />
          {purposeLine(snapshot, language) ? <View style={{ marginTop: 6 }}><Text style={{ lineHeight: 1.6 }}><Runs text={purposeLine(snapshot, language)!} size={m.purpose} italic /></Text></View> : null}
        </View>)}

        <Details snapshot={snapshot} languages={languages} m={m} />
      </View>
    </View>

    <View wrap={false} style={shift}>
      <View style={{ position: "relative", flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between", marginTop: m.footGap }}>
        <View style={{ width: 180 }}>
          {school.place ? <Text style={{ marginBottom: 2 }}><Runs text={`${say("Place", "स्थान")}:  `} size={10.5} color={C.muted} /><Runs text={school.place} size={10.5} value /></Text> : null}
          <Text style={{ marginBottom: level ? 6 : 10 }}><Runs text={`${say("Date", "दिनांक")}:  `} size={10.5} color={C.muted} /><Runs text={issued(hiOnly ? "hi" : "en")} size={10.5} value /></Text>
          {qr && !preprinted ? <View style={{ flexDirection: "row", alignItems: "center" }}>
            <Image src={qr} style={{ width: m.qr, height: m.qr }} />
            <View style={{ marginLeft: 7, width: 108 }}>
              <Text><Runs text={say("Scan to verify", "सत्यापन हेतु स्कैन करें")} size={8} bold color={C.navy} /></Text>
              {verifyUrl ? <Text style={{ fontFamily: "Helvetica", fontSize: 6.5, color: C.faint, marginTop: 2 }}>{verifyUrl.replace(/^https?:\/\//, "")}</Text> : null}
            </View>
          </View> : null}
        </View>
        {!signed && !preprinted ? <View style={{ width: level ? 70 : 82, height: level ? 70 : 82, borderRadius: level ? 35 : 41, borderWidth: 0.9, borderColor: C.goldSoft, borderStyle: "dashed", alignItems: "center", justifyContent: "center" }}>
          <Text><Runs text={say("School seal", "मुहर")} size={8} color={C.faint} /></Text>
        </View> : null}
        <View style={{ width: 196, alignItems: "center" }}>
          {signed && signature ? <Image src={signature} style={{ height: m.sign, maxWidth: 160, objectFit: "contain", marginBottom: 1 }} /> : <View style={{ height: level ? 30 : 42 }} />}
          <Svg width={176} height={2}><Line x1={0} y1={1} x2={176} y2={1} stroke={C.navy} strokeWidth={0.8} /></Svg>
          {school.principalName ? <Text style={{ marginTop: 4 }}><Runs text={school.principalName} size={11} bold color={C.navy} /></Text> : null}
          <Text style={{ marginTop: school.principalName ? 1 : 4 }}><Runs text={designation} size={10.5} bold={!school.principalName} color={school.principalName ? C.muted : C.navy} /></Text>
          <Text style={{ marginTop: 1, textAlign: "center" }}><Runs text={hiOnly ? school.nameHi || school.name : school.name} size={8.5} color={C.faint} /></Text>
        </View>
        {/* The seal is stamped where a clerk stamps it: beside the signature, overlapping its edge. */}
        {signed && seal && school.seal ? <View style={{ position: "absolute", right: 150, bottom: level ? 0 : 4 }}><Image src={seal} style={{ width: m.seal, height: m.seal }} /></View> : null}
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

type Assets = { crest: PdfImage | null; seal: PdfImage | null; signature: PdfImage | null };
async function loadAssets(): Promise<Assets> {
  const [emblem, logo, seal, signature] = await Promise.all([loadEmblemImage(), loadLogoImage(), loadSealImage(), loadSignatureImage()]);
  return { crest: emblem ?? logo, seal, signature };
}

async function prepare(snapshot: CertificateSnapshot, assets: Assets, level: Level): Promise<Prepared> {
  const base = snapshot.school.verifyBase?.replace(/\/$/, "");
  const verifyUrl = snapshot.verifyCode && base ? `${base}${verifyPath(snapshot.verifyCode)}` : null;
  const qr = verifyUrl && !snapshot.isTest ? await QRCode.toDataURL(verifyUrl, { margin: 0, width: 240, errorCorrectionLevel: "M", color: { dark: C.navy, light: "#FFFFFF" } }) : null;
  // An older snapshot may carry its own embedded image; a current one names the receipts' signature.
  const signature = snapshot.school.signature || (snapshot.school.signatureAsset ? assets.signature : null);
  return { snapshot, qr, verifyUrl, crest: assets.crest, seal: snapshot.school.seal ? assets.seal : null, signature, level };
}

/** Where to start: the roomy page, or the compact one for a TC or a two-language table. */
export function startingLevel(snapshot: CertificateSnapshot): Level {
  const both = snapshot.template.language === "both";
  return kindOf(snapshot) === "tc" || (both && (snapshot.template.detailRows ?? []).length > 0) ? 1 : 0;
}

const mayRunLong = (snapshot: CertificateSnapshot) => kindOf(snapshot) === "tc" || snapshot.template.language === "both" || (snapshot.template.detailRows ?? []).length > 0;

/** Pages in a react-pdf document: pdfkit writes each page object uncompressed. */
export function pdfPageCount(bytes: Uint8Array): number {
  return (Buffer.from(bytes).toString("latin1").match(/\/Type\s*\/Page(?![s\w])/g) ?? []).length;
}

const titleOf = (snapshot: CertificateSnapshot) => `${snapshot.template.titleEn} ${snapshot.serial}`;

async function renderOne(snapshot: CertificateSnapshot, assets: Assets, level: Level): Promise<Buffer> {
  const page = await prepare(snapshot, assets, level);
  return renderToBuffer(<Document title={titleOf(snapshot)} author={snapshot.school.name} creationDate={new Date(snapshot.issuedAt)} modificationDate={new Date(snapshot.issuedAt)}><CertificatePage {...page} /></Document>);
}

/** The roomiest setting at which this document is one sheet, and the bytes at that setting. */
async function fitted(snapshot: CertificateSnapshot, assets: Assets): Promise<{ level: Level; bytes: Buffer }> {
  let level = startingLevel(snapshot);
  let bytes = await renderOne(snapshot, assets, level);
  while (pdfPageCount(bytes) > 1 && level < 2) {
    level = (level + 1) as Level;
    bytes = await renderOne(snapshot, assets, level);
  }
  return { level, bytes };
}

/** One stored document: the bytes a reprint returns for ever. */
export async function renderCertificatePdf(snapshot: CertificateSnapshot): Promise<Buffer> {
  ensurePdfFontsRegistered();
  noHyphenation();
  return (await fitted(snapshot, await loadAssets())).bytes;
}

/**
 * Several frozen snapshots in one file for the signing tray. Each page is set
 * the way its stored document is, one sheet each; nothing is re-read.
 */
export async function renderCertificateBundle(snapshots: CertificateSnapshot[], title: string): Promise<Buffer> {
  ensurePdfFontsRegistered();
  noHyphenation();
  const assets = await loadAssets();
  const pages: Prepared[] = [];
  for (const snapshot of snapshots) {
    // Only a document that could run long is measured; a one-language letter fits at its start.
    const level = mayRunLong(snapshot) ? (await fitted(snapshot, assets)).level : startingLevel(snapshot);
    pages.push(await prepare(snapshot, assets, level));
  }
  return renderToBuffer(<Document title={title}>{pages.map((page) => <CertificatePage key={page.snapshot.serial} {...page} />)}</Document>);
}

/** Kept for callers written before kinds existed. */
export const renderStudyCertificatePdf = renderCertificatePdf;
