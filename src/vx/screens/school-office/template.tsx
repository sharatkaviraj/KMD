"use client";
import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { saveCertificateIdentityAction, saveCertificateTemplateAction } from "@/app/(app)/school-office/actions";
import { certificateFields, certificateKinds, placeholderValues, templateSchema, wordingSegments, type CertificateKind, type CertificateSnapshot, type CertificateTemplate } from "@/modules/certificates/domain/certificate";
import type { CertificateIdentity } from "@/modules/certificates/domain/identity";
import { useVx } from "@/vx/i18n";
import { p } from "@/vx/text";
import { Btn, Pill } from "@/vx/ui/primitives";
import { useToast } from "@/vx/ui/overlays";
import { EXTRA_LABELS, FIELD_LABELS, KIND_LABELS, O } from "./text";
import "./office.css";
import "./cert.css";

type Tab = "school" | CertificateKind;
type BodyKey = "bodyEn" | "bodyHi" | "historicalBodyEn" | "historicalBodyHi";
const INSERTS = [...certificateFields.map((key) => ({ key, label: FIELD_LABELS[key] })),
  { key: "dateOfBirthWords", label: p("Date of birth in words", "जन्म तिथि शब्दों में") }, { key: "sonDaughter", label: p("son / daughter", "son / daughter") },
  { key: "heShe", label: p("he / she", "he / she") }, { key: "himHer", label: p("him / her", "him / her") }, { key: "putraPutri", label: p("पुत्र / पुत्री", "पुत्र / पुत्री") },
  { key: "conduct", label: EXTRA_LABELS.conduct }, { key: "schoolName", label: p("School name", "विद्यालय का नाम") }] as const;

/** Synthetic facts for the live preview only; nothing here is a real child. */
function sample(template: CertificateTemplate, identity: CertificateIdentity, schoolName: string): CertificateSnapshot {
  return {
    serial: `${template.prefix}/2026-27/0001`, issuedAt: "2026-11-03T05:00:00Z", issuedOn: "2026-11-03", isTest: true, kind: template.kind, purpose: "a scholarship application",
    extras: { conduct: "very_good", reasonForLeaving: "Parent's request", lastResult: "Passed" }, template,
    school: { name: schoolName, address: "", phone: "", email: "", place: identity.place, principalName: identity.principalName },
    facts: { studentId: "", enrolmentId: "", classId: "", studentName: "Sample Student", admissionNo: "01234", classLabel: "8 A", sessionLabel: "2026-27", status: "current",
      enrolledOn: "2019-04-01", leftOn: "2026-10-30", admittedOn: "2019-04-01", dateOfBirth: "2012-08-15", fatherName: "Sample Parent", motherName: "Sample Guardian", gender: "Male",
      identityVerified: true, sourceCurrent: true, sourceRevision: "sample", checkedAt: "" },
  };
}

export function CertificateSettings({ templates, identity, schoolName }: { templates: Partial<Record<CertificateKind, CertificateTemplate>>; identity: CertificateIdentity; schoolName: string }) {
  const { tx } = useVx();
  const [tab, setTab] = useState<Tab>("school");
  const tabs: Tab[] = ["school", ...certificateKinds.filter((kind) => templates[kind])];
  return <div style={{ display: "grid", gap: 16 }}>
    <div className="tpl-tabs" role="tablist">{tabs.map((key) => <button key={key} role="tab" type="button" aria-selected={tab === key} className={`chip${tab === key ? " on" : ""}`} onClick={() => setTab(key)}>{key === "school" ? tx(O.schoolDetails) : tx(KIND_LABELS[key])}</button>)}</div>
    <div key={tab} style={{ animation: "xIn .3s var(--ease) both" }}>
      {tab === "school" ? <IdentityForm identity={identity} /> : <WordingEditor key={templates[tab]!.version} template={templates[tab]!} identity={identity} schoolName={schoolName} />}
    </div>
  </div>;
}

type IdentityText = "principalName" | "principalDesignation" | "principalDesignationHi" | "place" | "udiseCode" | "pspCode" | "recognitionNo"
  | "registrationNo" | "recognisedBy" | "trust" | "nameHi" | "address" | "phone" | "email" | "website";

/**
 * The school's details as every new certificate prints them (D-540, D-541):
 * the letterhead's lines, who signs, and whether the principal's signature and
 * the school seal are printed. The defaults are the official letterhead and
 * the printed signature; a line saved empty is left off the page.
 */
function IdentityForm({ identity }: { identity: CertificateIdentity }) {
  const { tx } = useVx(); const router = useRouter(); const toast = useToast();
  const [value, setValue] = useState(identity); const [busy, setBusy] = useState(false);
  const field = (key: IdentityText, label: ReturnType<typeof p>, max = 80, wide = false) =>
    <label className="field" style={wide ? { gridColumn: "1 / -1" } : undefined}><span>{tx(label)}</span><input className="inp" value={value[key]} maxLength={max} onChange={(e) => setValue({ ...value, [key]: e.target.value })} /></label>;
  const grid = { display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))", gap: 14 } as const;
  async function save(e: React.FormEvent) {
    e.preventDefault(); if (busy) return; setBusy(true);
    try { const result = await saveCertificateIdentityAction(value); toast.show({ text: tx(result.ok ? O.saved : O.saveFailed), tone: result.ok ? "ok" : "bad" }); if (result.ok) router.refresh(); }
    catch { toast.show({ text: tx(O.saveFailed), tone: "bad" }); } finally { setBusy(false); }
  }
  return <form className="office-form card" onSubmit={save} style={{ padding: 22 }}>
    <div className="office-note">{tx(p("These details print on every certificate prepared from now on. Documents already prepared keep what they were printed with. The school's English name and logo come from Settings → School profile.", "ये विवरण अब से बनने वाले हर प्रमाण पत्र पर छपेंगे। पहले बने प्रमाण पत्र वैसे ही रहेंगे। विद्यालय का अंग्रेज़ी नाम और लोगो सेटिंग्स → विद्यालय प्रोफ़ाइल से आते हैं।"))}</div>
    <fieldset className="card" style={{ padding: 16, border: "1px solid var(--bd)", display: "grid", gap: 12 }}>
      <legend style={{ fontWeight: 700, padding: "0 6px" }}>{tx(p("Letterhead", "लेटरहेड"))}</legend>
      <span style={{ fontSize: 13, color: "var(--mut)" }}>{tx(p("As on the school's official letterhead. Leave a line empty to leave it off.", "विद्यालय के आधिकारिक लेटरहेड जैसा। कोई पंक्ति खाली छोड़ें तो वह नहीं छपेगी।"))}</span>
      <div style={grid}>
        {field("nameHi", p("School name in Hindi", "विद्यालय का नाम (हिंदी)"), 100, true)}
        {field("trust", p("Operated by (trust)", "संचालक (ट्रस्ट)"), 100)}
        {field("recognisedBy", p("Recognised by", "मान्यता देने वाला"), 80)}
        {field("address", p("Address", "पता"), 160, true)}
        {field("phone", p("Phone", "फ़ोन"), 40)}
        {field("email", p("Email", "ईमेल"), 80)}
        {field("website", p("Website", "वेबसाइट"), 80)}
        {field("registrationNo", p("Registration number", "पंजीयन क्रमांक"), 40)}
        {field("recognitionNo", p("Recognition number", "मान्यता क्रमांक"), 40)}
        {field("udiseCode", p("UDISE code", "यूडाइस कोड"), 40)}
        {field("pspCode", p("PSP school code (optional)", "पीएसपी विद्यालय कोड (वैकल्पिक)"), 40)}
      </div>
    </fieldset>
    <fieldset className="card" style={{ padding: 16, border: "1px solid var(--bd)", display: "grid", gap: 12 }}>
      <legend style={{ fontWeight: 700, padding: "0 6px" }}>{tx(p("Who signs", "हस्ताक्षरकर्ता"))}</legend>
      <div style={grid}>
        {field("principalName", p("Principal's name (printed under the signature)", "प्रधानाचार्य का नाम (हस्ताक्षर के नीचे)"))}
        {field("place", p("Place", "स्थान"), 60)}
        {field("principalDesignation", p("Designation (English)", "पद (अंग्रेज़ी)"), 60)}
        {field("principalDesignationHi", p("Designation (Hindi)", "पद (हिंदी)"), 60)}
      </div>
    </fieldset>
    <fieldset className="card" style={{ padding: 16, border: "1px solid var(--bd)", display: "grid", gap: 10 }}>
      <legend style={{ fontWeight: 700, padding: "0 6px" }}>{tx(p("Signature and seal on the certificate", "प्रमाण पत्र पर हस्ताक्षर और मुहर"))}</legend>
      {(["facsimile", "manual"] as const).map((policy) => <label key={policy} style={{ display: "flex", gap: 10, alignItems: "flex-start", cursor: "pointer" }}>
        <input type="radio" name="sig" checked={value.signaturePolicy === policy} onChange={() => setValue({ ...value, signaturePolicy: policy })} style={{ marginTop: 4, width: 18, height: 18, accentColor: "var(--pri)" }} />
        <span><strong>{tx(policy === "facsimile" ? p("Print the principal's signature and the school seal", "प्रधानाचार्य के हस्ताक्षर और विद्यालय की मुहर छापें") : p("Sign and stamp by hand", "हाथ से हस्ताक्षर व मुहर"))}</strong>
          <span style={{ display: "block", fontSize: 13, color: "var(--mut)" }}>{tx(policy === "facsimile" ? p("The signature from the receipts and the school seal print on every certificate the office makes or an admin approves. A teacher's request needs an admin's approval first.", "रसीदों वाले हस्ताक्षर और विद्यालय की मुहर हर उस प्रमाण पत्र पर छपेंगे जो कार्यालय बनाए या प्रशासक मंज़ूर करे। अध्यापक के अनुरोध पर पहले प्रशासक की मंज़ूरी चाहिए।") : p("A clean signature line and an empty seal circle. Sign and stamp each print.", "हस्ताक्षर की साफ़ पंक्ति और मुहर का खाली घेरा। हर प्रति पर हस्ताक्षर व मुहर लगाएँ।"))}</span></span>
      </label>)}
      {value.signaturePolicy === "facsimile" && value.facsimileEnabledAt ? <Pill tone="info">{tx(p("Turned on", "चालू किया"))} {value.facsimileEnabledAt.slice(0, 10)}</Pill> : null}
    </fieldset>
    <fieldset className="card" style={{ padding: 16, border: "1px solid var(--bd)", display: "grid", gap: 10 }}>
      <legend style={{ fontWeight: 700, padding: "0 6px" }}>{tx(p("Paper", "कागज़"))}</legend>
      {(["classic", "preprinted"] as const).map((layout) => <label key={layout} style={{ display: "flex", gap: 10, alignItems: "center", cursor: "pointer" }}>
        <input type="radio" name="layout" checked={value.layout === layout} onChange={() => setValue({ ...value, layout })} style={{ width: 18, height: 18, accentColor: "var(--pri)" }} />
        <span>{tx(layout === "classic" ? p("Plain A4: One prints the border and the letterhead", "सादा A4: बॉर्डर और लेटरहेड वन छापेगा") : p("Pre-printed certificate forms: print only the wording", "पहले से छपे प्रमाण पत्र फ़ॉर्म: केवल पाठ छापें"))}</span>
      </label>)}
      {value.layout === "preprinted" ? <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        {(["offsetX", "offsetY"] as const).map((key) => <label key={key} className="field"><span>{tx(key === "offsetX" ? p("Move right (mm)", "दाएँ खिसकाएँ (मिमी)") : p("Move down (mm)", "नीचे खिसकाएँ (मिमी)"))}</span><input className="inp" type="number" min={-20} max={20} step={0.5} value={value[key]} onChange={(e) => setValue({ ...value, [key]: Math.max(-20, Math.min(20, Number(e.target.value) || 0)) })} /></label>)}
      </div> : null}
    </fieldset>
    <Btn type="submit" variant="pri" disabled={busy}>{busy ? tx(O.preparing) : tx(p("Save school details", "विद्यालय विवरण सहेजें"))}</Btn>
  </form>;
}

function WordingEditor({ template, identity, schoolName }: { template: CertificateTemplate; identity: CertificateIdentity; schoolName: string }) {
  const { tx } = useVx(); const router = useRouter(); const toast = useToast();
  const [value, setValue] = useState(template); const [busy, setBusy] = useState(false); const [historical, setHistorical] = useState(false);
  const focused = useRef<{ key: BodyKey; el: HTMLTextAreaElement } | null>(null);
  const valid = templateSchema.safeParse(value).success;
  const snapshot = useMemo(() => sample(value, identity, schoolName), [value, identity, schoolName]);
  const languages: ("en" | "hi")[] = value.language === "both" ? ["en", "hi"] : [value.language];

  function insert(token: string) {
    const target = focused.current;
    const key: BodyKey = target?.key ?? (value.language === "hi" ? (historical ? "historicalBodyHi" : "bodyHi") : (historical ? "historicalBodyEn" : "bodyEn"));
    const el = target?.el; const text = value[key]; const at = el ? el.selectionStart : text.length; const end = el ? el.selectionEnd : at;
    const next = `${text.slice(0, at)}{${token}}${text.slice(end)}`;
    setValue({ ...value, [key]: next });
    requestAnimationFrame(() => { if (el) { el.focus(); el.selectionStart = el.selectionEnd = at + token.length + 2; } });
  }
  const area = (key: BodyKey, label: ReturnType<typeof p>) => <label className="field"><span>{tx(label)}</span>
    <textarea className="inp" value={value[key]} maxLength={4000} onFocus={(e) => { focused.current = { key, el: e.currentTarget }; }} onChange={(e) => setValue({ ...value, [key]: e.target.value })} /></label>;

  async function save(e: React.FormEvent) {
    e.preventDefault(); if (!valid || busy) return; setBusy(true);
    try { const result = await saveCertificateTemplateAction(value); toast.show({ text: tx(result.ok ? O.saved : O.saveFailed), tone: result.ok ? "ok" : "bad" }); if (result.ok) router.refresh(); }
    catch { toast.show({ text: tx(O.saveFailed), tone: "bad" }); } finally { setBusy(false); }
  }
  const shown = { ...snapshot, facts: { ...snapshot.facts, status: historical ? "historical" as const : "current" as const } };

  return <form onSubmit={save} className="tpl-grid">
    <div className="office-form card" style={{ padding: 20, maxWidth: "none" }}>
      <div className="office-note">{tx(O.versionNote)}</div>
      <label style={{ display: "flex", alignItems: "center", gap: 10 }}><input type="checkbox" style={{ width: 18, height: 18, accentColor: "var(--pri)" }} checked={value.active} onChange={(e) => setValue({ ...value, active: e.target.checked })} />{tx(p("Staff can prepare this document", "स्टाफ़ यह प्रमाण पत्र बना सकता है"))}</label>
      <div className="g2" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <label className="field"><span>{tx(p("English title", "अंग्रेज़ी शीर्षक"))}</span><input className="inp" value={value.titleEn} maxLength={120} onChange={(e) => setValue({ ...value, titleEn: e.target.value })} /></label>
        <label className="field"><span>{tx(p("Hindi title", "हिंदी शीर्षक"))}</span><input className="inp" value={value.titleHi} maxLength={150} onChange={(e) => setValue({ ...value, titleHi: e.target.value })} /></label>
        <label className="field"><span>{tx(p("Number series", "संख्या शृंखला"))}</span><input className="inp num" value={value.prefix} maxLength={40} onChange={(e) => setValue({ ...value, prefix: e.target.value.toUpperCase() })} /></label>
        <label className="field"><span>{tx(p("Printed in", "छपाई की भाषा"))}</span><select className="inp" value={value.language} onChange={(e) => setValue({ ...value, language: e.target.value as CertificateTemplate["language"] })}><option value="en">English</option><option value="hi">हिंदी</option><option value="both">English + हिंदी</option></select></label>
      </div>
      <div className="cert-chips" role="group"><button type="button" className="cert-chip" aria-pressed={!historical} onClick={() => setHistorical(false)}>{tx(p("Current student", "वर्तमान विद्यार्थी"))}</button><button type="button" className="cert-chip" aria-pressed={historical} onClick={() => setHistorical(true)}>{tx(p("Former student", "पूर्व विद्यार्थी"))}</button></div>
      <div className="cert-q"><span>{tx(O.insert)}</span><div className="tpl-ins">{INSERTS.map((item) => <button key={item.key} type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => insert(item.key)}>{tx(item.label)}</button>)}</div></div>
      {languages.includes("en") ? area(historical ? "historicalBodyEn" : "bodyEn", historical ? p("Wording for a former student (English)", "पूर्व विद्यार्थी का पाठ (अंग्रेज़ी)") : p("Wording (English)", "पाठ (अंग्रेज़ी)")) : null}
      {languages.includes("hi") ? area(historical ? "historicalBodyHi" : "bodyHi", historical ? p("Wording for a former student (Hindi)", "पूर्व विद्यार्थी का पाठ (हिंदी)") : p("Wording (Hindi)", "पाठ (हिंदी)")) : null}
      {!valid ? <div role="alert" className="office-note" style={{ background: "var(--warns)", color: "var(--warnfg)" }}>{tx(p("Something in the wording isn't recognised. Use the Insert buttons for details.", "पाठ में कुछ पहचाना नहीं गया। विवरण के लिए जोड़ें बटन इस्तेमाल करें।"))}</div> : null}
      <Btn type="submit" variant="pri" disabled={busy || !valid}>{busy ? tx(O.preparing) : tx(O.save)}</Btn>
    </div>
    <div className="tpl-preview" aria-label={tx(O.preview)} style={{ opacity: valid ? 1 : .55 }}>
      <div style={{ textAlign: "center", fontSize: 11, letterSpacing: ".08em", color: "#5C6270", textTransform: "uppercase" }}>{schoolName}</div>
      <div style={{ height: 1, background: "#A67C2E", margin: "8px 20%" }} />
      {value.language !== "hi" ? <h3>{value.titleEn}</h3> : null}
      {value.language !== "en" ? <div className="tpl-hi">{value.titleHi}</div> : null}
      {languages.map((language) => { const text = historical ? (language === "hi" ? value.historicalBodyHi : value.historicalBodyEn) : (language === "hi" ? value.bodyHi : value.bodyEn);
        return <p key={language} lang={language}>{wordingSegments(text, placeholderValues(shown, language)).map((s, i) => s.value ? <mark key={i}>{s.text}</mark> : <span key={i}>{s.text}</span>)}</p>; })}
      <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 26 }}><div style={{ borderTop: "1px solid #0B2545", width: 150, textAlign: "center", fontSize: 12, paddingTop: 4 }}>{identity.principalName || tx(p("Principal", "प्रधानाचार्य"))}</div></div>
      <p style={{ fontSize: 11, color: "#8A8F99", textAlign: "center", marginBottom: 0 }}>{tx(p("Sample details. The real certificate uses the student's record.", "नमूना विवरण। असली प्रमाण पत्र में विद्यार्थी का रिकॉर्ड आएगा।"))}</p>
    </div>
  </form>;
}

/** Kept for any import from before the second pass. */
export { CertificateSettings as CertificateTemplateForm };
