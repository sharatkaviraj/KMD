/* eslint-disable jsx-a11y/alt-text -- react-pdf Image is PDF content, not an HTML image. */
import "server-only";
import * as React from "react";
import { Document, Page, Text, View, Image, renderToBuffer } from "@react-pdf/renderer";
import { ensurePdfFontsRegistered, HI_FONT, loadLogoImage } from "@/platform/pdf/document-kit";
import { renderCertificateBody, type CertificateSnapshot } from "../domain/certificate";

/** Font runs keep both Latin names and Devanagari shaping in mixed wording. */
function ScriptText({ text, size = 12, bold = false }: { text: string; size?: number; bold?: boolean }) {
  const runs = text.match(/[\u0900-\u097f]+|[^\u0900-\u097f]+/g) ?? [];
  return <Text style={{ fontSize: size, lineHeight: 1.8 }}>{runs.map((run, index) => <Text key={index} style={{ fontFamily: /[\u0900-\u097f]/.test(run) ? HI_FONT : bold ? "Helvetica-Bold" : "Helvetica", fontWeight: bold ? "bold" : "normal" }}>{run}</Text>)}</Text>;
}

export async function renderStudyCertificatePdf(snapshot: CertificateSnapshot): Promise<Buffer> {
  ensurePdfFontsRegistered();
  const logo = await loadLogoImage();
  const t = snapshot.template;
  const languages: ("en" | "hi")[] = t.language === "both" ? ["en", "hi"] : [t.language];
  const date = new Intl.DateTimeFormat("en-IN", { day: "2-digit", month: "long", year: "numeric", timeZone: "Asia/Kolkata" }).format(new Date(`${snapshot.issuedOn}T12:00:00Z`));
  return renderToBuffer(
    <Document title={`${t.titleEn} ${snapshot.serial}`} author={snapshot.school.name} creationDate={new Date(snapshot.issuedAt)} modificationDate={new Date(snapshot.issuedAt)}>
      <Page size="A4" style={{ padding: 44, color: "#151923", fontFamily: "Helvetica", fontSize: 11 }}>
        {snapshot.isTest ? <Text fixed style={{ color: "#B41D1D", textAlign: "center", fontSize: 12, marginBottom: 12 }}>TEST DOCUMENT - NOT VALID FOR OFFICIAL USE</Text> : null}
        <View style={{ alignItems: "center", borderBottomWidth: 1.5, borderColor: "#082F49", paddingBottom: 18 }}>
          {snapshot.school.logo || logo ? <Image src={snapshot.school.logo || logo!} style={{ width: 46, height: 46, marginBottom: 8 }} /> : null}
          <ScriptText text={t.language === "hi" ? snapshot.school.nameHi || snapshot.school.name : snapshot.school.name} size={18} bold />
          {snapshot.school.affiliation ? <ScriptText text={snapshot.school.affiliation} size={9} /> : null}
          {snapshot.school.address ? <ScriptText text={snapshot.school.address} size={10} /> : null}
          {[snapshot.school.phone, snapshot.school.email].filter(Boolean).length ? <ScriptText text={[snapshot.school.phone, snapshot.school.email].filter(Boolean).join(" | ")} size={9} /> : null}
        </View>
        <View style={{ flexDirection: "row", justifyContent: "space-between", marginTop: 17, marginBottom: 24 }}>
          <Text style={{ fontSize: 9 }}>No. {snapshot.serial}</Text><Text style={{ fontSize: 9 }}>Date: {date}</Text>
        </View>
        {languages.map((language) => <View key={language} style={{ marginBottom: 24 }}>
          <View style={{ alignItems: "center", marginBottom: 18 }}><ScriptText text={language === "hi" ? t.titleHi : t.titleEn} size={17} bold /></View>
          <ScriptText text={renderCertificateBody(snapshot, language)} size={13} />
        </View>)}
        <View wrap={false} style={{ marginTop: 54 }}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", paddingTop: 20 }}>
            <View style={{ borderTopWidth: 0.7, borderColor: "#6B7280", width: 150, paddingTop: 7 }}><ScriptText text={t.language === "en" ? "School seal" : "School seal / विद्यालय की मुहर"} size={10} /></View>
            <View style={{ borderTopWidth: 0.7, borderColor: "#6B7280", width: 190, paddingTop: 7 }}><ScriptText text={t.language === "en" ? "Principal / Authorized signatory" : "Principal / प्रधानाचार्य के हस्ताक्षर"} size={10} /></View>
          </View>
          <View style={{ marginTop: 24, padding: 10, backgroundColor: "#F0F6F9" }}><ScriptText text={t.language === "en" ? "Print copy - physical signature and school seal required." : "Print copy - signature required. इस प्रति पर हस्ताक्षर और विद्यालय की मुहर आवश्यक है।"} size={9} /></View>
        </View>
        <Text fixed style={{ position: "absolute", bottom: 22, left: 44, right: 44, fontSize: 7, color: "#5C6270" }} render={({ pageNumber, totalPages }) => `${snapshot.serial} | ${pageNumber} / ${totalPages}`} />
      </Page>
    </Document>,
  );
}
