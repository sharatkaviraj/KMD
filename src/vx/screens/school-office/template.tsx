"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { saveCertificateTemplateAction } from "@/app/(app)/school-office/actions";
import { certificateFields, templateSchema, type CertificateTemplate } from "@/modules/certificates/domain/certificate";
import { useVx } from "@/vx/i18n";
import { p } from "@/vx/text";
import { Btn } from "@/vx/ui/primitives";
import { FIELD_LABELS, O } from "./text";
import "./office.css";

export function CertificateTemplateForm({ template }: { template: CertificateTemplate }) {
  const { tx } = useVx(); const router = useRouter();
  const [value, setValue] = useState(template); const [busy, setBusy] = useState(false); const [message, setMessage] = useState<"saved" | "failed" | null>(null);
  function textField(key: "titleEn" | "titleHi" | "prefix" | "bodyEn" | "bodyHi" | "historicalBodyEn" | "historicalBodyHi", en: string, hi: string, multiline = false) {
    const props = { className: "inp", value: value[key], maxLength: multiline ? 4000 : 150, onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setValue((old) => ({ ...old, [key]: e.target.value })) };
    return <label className="field"><span>{tx(p(en, hi))}</span>{multiline ? <textarea {...props} /> : <input {...props} />}</label>;
  }
  async function save(e: React.FormEvent) {
    e.preventDefault(); setMessage(null);
    if (!templateSchema.safeParse(value).success) { setMessage("failed"); return; }
    setBusy(true);
    try { const result = await saveCertificateTemplateAction(value); if (result.ok) { setMessage("saved"); router.refresh(); } else setMessage("failed"); }
    catch { setMessage("failed"); } finally { setBusy(false); }
  }
  return <form className="office-form card" onSubmit={save} style={{ padding: 22 }}>
    <div className="office-note">{tx(O.manual)}<br />{tx(p("Saving creates a new template version. Existing certificates and their PDFs stay as prepared.", "सहेजने पर प्रारूप का नया संस्करण बनेगा। पुराने प्रमाण पत्र और पीडीएफ वैसे ही रहेंगे।"))}</div>
    <label style={{ display: "flex", alignItems: "center", gap: 10 }}><input type="checkbox" checked={value.active} onChange={(e) => setValue({ ...value, active: e.target.checked })} />{tx(p("Allow new certificates using this template", "इस प्रारूप से नए प्रमाण पत्र बनाना चालू रखें"))}</label>
    <div className="g2" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>{textField("titleEn", "English title", "अंग्रेज़ी शीर्षक")}{textField("titleHi", "Hindi title", "हिंदी शीर्षक")}</div>
    <div className="g2" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>{textField("prefix", "Number series prefix", "संख्या का उपसर्ग")}<label className="field"><span>{tx(p("Document language", "दस्तावेज़ की भाषा"))}</span><select className="inp" value={value.language} onChange={(e) => setValue({ ...value, language: e.target.value as CertificateTemplate["language"] })}><option value="en">English</option><option value="hi">हिंदी</option><option value="both">English + हिंदी</option></select></label></div>
    {textField("bodyEn", "Current enrolment wording (English)", "वर्तमान नामांकन का अंग्रेज़ी पाठ", true)}
    {textField("bodyHi", "Current enrolment wording (Hindi)", "वर्तमान नामांकन का हिंदी पाठ", true)}
    {textField("historicalBodyEn", "Historical enrolment wording (English)", "पुराने नामांकन का अंग्रेज़ी पाठ", true)}
    {textField("historicalBodyHi", "Historical enrolment wording (Hindi)", "पुराने नामांकन का हिंदी पाठ", true)}
    <details><summary>{tx(p("Available fields and required details", "उपलब्ध फ़ील्ड और आवश्यक जानकारी"))}</summary><p style={{ fontSize: 13 }}>{tx(p("Use these exact placeholders in braces. A field used in the selected language is also checked before issuing.", "इन फ़ील्ड को ठीक इसी तरह कोष्ठक में लिखें। चुनी हुई भाषा के पाठ में प्रयुक्त जानकारी भी जाँची जाएगी।"))}</p><div style={{ display: "grid", gap: 10 }}>{certificateFields.map((key) => <label key={key} style={{ display: "flex", gap: 10, alignItems: "center" }}><input type="checkbox" checked={value.requiredFields.includes(key)} onChange={(e) => setValue({ ...value, requiredFields: e.target.checked ? [...value.requiredFields, key] : value.requiredFields.filter((field) => field !== key) })} /><span>{tx(FIELD_LABELS[key])} <code>{`{${key}}`}</code></span></label>)}</div><p><code>{"{schoolName} {schoolAddress} {serial} {issueDate}"}</code></p></details>
    {message ? <div role="status" className="office-note">{tx(message === "saved" ? O.saved : O.saveFailed)}</div> : null}
    <Btn type="submit" variant="pri" disabled={busy}>{busy ? tx(O.preparing) : tx(O.save)}</Btn>
  </form>;
}
