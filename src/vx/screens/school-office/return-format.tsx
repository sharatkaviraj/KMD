"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { inspectReturnSpecimenAction, saveReturnAdapterAction } from "@/app/(app)/school-office/returns/actions";
import type { AdapterRow } from "@/modules/government-records/data/repo";
import { portals, returnFields, type GovernmentAdapter, type ReturnField } from "@/modules/government-records/domain/exchange";
import { useVx } from "@/vx/i18n";
import { p, type Pair } from "@/vx/text";
import { Btn } from "@/vx/ui/primitives";
import { O } from "./text";
import { G, PORTAL_LABELS } from "./return-text";
import "./office.css";

const FIELDS: Record<ReturnField, Pair> = { studentId: p("One student UUID", "वन विद्यार्थी पहचान"), admissionNo: p("Admission / SR number", "प्रवेश / एसआर संख्या"), studentName: p("Student name", "विद्यार्थी का नाम"), classLabel: p("Class", "कक्षा"), sessionLabel: p("Academic session", "शैक्षणिक सत्र"), schoolCode: p("School code", "विद्यालय कोड"), externalId: p("External registration ID", "बाहरी पंजीकरण पहचान"), registrationStatus: p("Registration status", "पंजीकरण स्थिति") };
export function ReturnFormatForm({ sessionLabel, adapters }: { sessionLabel: string; adapters: AdapterRow[] }) {
  const { tx } = useVx(); const router = useRouter(); const form = useRef<HTMLFormElement>(null);
  const [portal, setPortal] = useState<GovernmentAdapter["portal"]>("psp"), [module, setModule] = useState("Student records"), [code, setCode] = useState(""), [format, setFormat] = useState<"csv" | "xlsx">("xlsx"), [sheet, setSheet] = useState("Sheet1");
  const [headers, setHeaders] = useState<string[]>([]), [mapping, setMapping] = useState<Record<string, ReturnField | "">>({}), [required, setRequired] = useState<string[]>([]), [codes, setCodes] = useState<Record<string, string>>({}), [matchField, setMatch] = useState<GovernmentAdapter["matchField"]>("admissionNo");
  const [busy, setBusy] = useState(false), [failed, setFailed] = useState(false);
  async function inspect() { if (!form.current || busy) return; setBusy(true); setFailed(false); try { const data = new FormData(form.current); data.set("format", format); data.set("sheetName", sheet); const result = await inspectReturnSpecimenAction(data); if (result.ok) { setHeaders(result.headers); setMapping({}); setRequired([]); } else setFailed(true); } catch { setFailed(true); } finally { setBusy(false); } }
  async function save(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault(); if (!headers.length || busy) return; setBusy(true); setFailed(false);
    try {
      const columns = headers.map((header) => {
        const pairs = (codes[header] ?? "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map((line) => { const at = line.indexOf("="); if (at < 1) throw new Error("Invalid code mapping"); return [line.slice(0, at).trim(), line.slice(at + 1).trim()]; });
        return { header, field: mapping[header], required: required.includes(header), ...(pairs.length ? { codeMap: Object.fromEntries(pairs) } : {}) };
      });
      const previous = Math.max(0, ...adapters.filter(row => row.adapter.portal === portal && row.adapter.module === module && row.adapter.schoolCode === code).map(row => row.version));
      const data = new FormData(e.currentTarget);
      data.set("adapter", JSON.stringify({ portal, module, sessionLabel, schoolCode: code, version: previous + 1, mode: "verified_upload", format, sheetName: sheet, matchField, sourceReference: String(data.get("sourceReference")), specimenSha256: null, verifiedOn: null, columns }));
      const result = await saveReturnAdapterAction(data); if (result.ok) { router.push("/school-office/returns"); router.refresh(); } else setFailed(true);
    } catch { setFailed(true); } finally { setBusy(false); }
  }
  return <form ref={form} onSubmit={save} className="card office-form" style={{ padding: 22 }}>
    <div className="office-note">{tx(G.supported)}<br />{tx(p("If any required column has no matching field, keep using a reference sheet. The school verifies portal compatibility.", "यदि किसी आवश्यक कॉलम का मिलान नहीं है, संदर्भ सूची उपयोग करें। पोर्टल से अनुकूलता विद्यालय जाँचता है।"))}</div>
    <div className="g2" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}><label className="field"><span>{tx(G.destination)}</span><select className="inp" value={portal} onChange={(e) => setPortal(e.target.value as typeof portal)}>{portals.map(key => <option key={key} value={key}>{tx(PORTAL_LABELS[key])}</option>)}</select></label><label className="field"><span>{tx(G.module)}</span><input className="inp" required maxLength={80} value={module} onChange={(e) => setModule(e.target.value)} /></label></div>
    <label className="field"><span>{tx(G.schoolCode)} · {sessionLabel}</span><input className="inp" required maxLength={50} value={code} onChange={(e) => setCode(e.target.value)} /></label>
    <div className="g2" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}><label className="field"><span>{tx(G.format)}</span><select className="inp" value={format} onChange={(e) => { setFormat(e.target.value as typeof format); setHeaders([]); }}><option value="xlsx">XLSX</option><option value="csv">CSV (UTF-8)</option></select></label><label className="field"><span>{tx(G.sheet)}</span><input className="inp" maxLength={31} value={sheet} onChange={(e) => { setSheet(e.target.value); setHeaders([]); }} /></label></div>
    <label className="field"><span>{tx(G.specimen)} · {tx(G.importHint)}</span><input className="inp" style={{ paddingTop: 8 }} name="file" type="file" accept={format === "xlsx" ? ".xlsx" : ".csv"} required onChange={() => setHeaders([])} /></label>
    <Btn onClick={inspect} disabled={busy}>{tx(G.inspect)}</Btn>
    {headers.length ? <>
      <label className="field"><span>{tx(p("Match returned rows using", "वापस मिली पंक्तियों का मिलान"))}</span><select className="inp" value={matchField} onChange={(e) => setMatch(e.target.value as typeof matchField)}><option value="admissionNo">{tx(FIELDS.admissionNo)}</option><option value="studentId">{tx(FIELDS.studentId)}</option><option value="externalId">{tx(FIELDS.externalId)}</option></select></label>
      {headers.map((header) => <div key={header} style={{ display: "grid", gap: 8, padding: 14, border: "1px solid var(--bd)", borderRadius: 12 }}><strong>{header}</strong><select className="inp" required aria-label={`${header}: ${tx(G.mapField)}`} value={mapping[header] ?? ""} onChange={(e) => setMapping({ ...mapping, [header]: e.target.value as ReturnField })}><option value="">{tx(G.selectField)}</option>{returnFields.map(field => <option key={field} value={field}>{tx(FIELDS[field])}</option>)}</select><label><input type="checkbox" checked={required.includes(header)} onChange={(e) => setRequired(e.target.checked ? [...required, header] : required.filter(h => h !== header))} /> {tx(G.required)}</label><details><summary>{tx(p("Value codes, if the portal requires them", "पोर्टल के लिए मान का कोड, यदि आवश्यक हो"))}</summary><label className="field"><span>{tx(p("One value = portal code, one mapping per line", "वन का मान = पोर्टल का कोड, हर पंक्ति में एक मिलान"))}</span><textarea className="inp" maxLength={3000} value={codes[header] ?? ""} onChange={(e) => setCodes({ ...codes, [header]: e.target.value })} /></label></details></div>)}
      <label className="field"><span>{tx(G.source)}</span><textarea className="inp" name="sourceReference" required minLength={10} maxLength={600} /></label>
      <label style={{ display: "flex", alignItems: "start", gap: 10 }}><input type="checkbox" name="confirmed" value="yes" required />{tx(G.confirm)}</label><Btn variant="pri" type="submit" disabled={busy}>{tx(G.saveFormat)}</Btn>
    </> : null}
    {failed ? <div role="alert" className="office-note">{tx(G.checkFailed)}</div> : null}<Btn href="/school-office/returns">{tx(O.register)}</Btn>
  </form>;
}
