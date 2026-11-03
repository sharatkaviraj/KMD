import Link from "next/link";
import { loadSchoolOfficeAttention, type SchoolOfficeAttentionItem } from "@/modules/certificates/data/attention";
import { lead, p, under, type Pair } from "@/vx/text";
import { Card, CardHead } from "@/vx/ui/primitives";

const title = p("School Office", "विद्यालय कार्यालय");
const labels: Record<SchoolOfficeAttentionItem["kind"], Pair> = {
  certificate_blocked: p("Fix certificate details", "प्रमाण पत्र के विवरण सुधारें"),
  certificate_artifact: p("Resume certificate file", "प्रमाण पत्र की फ़ाइल फिर तैयार करें"),
  return_conflict: p("Review returned-file differences", "वापस मिली फ़ाइल के अंतर जाँचें"),
  return_artifact: p("Resume government file", "सरकारी फ़ाइल फिर तैयार करें"),
};
const fields: Record<string, Pair> = {
  studentName: p("Student name", "विद्यार्थी का नाम"), admissionNo: p("Admission / SR number", "प्रवेश / एसआर संख्या"),
  classLabel: p("Class", "कक्षा"), sessionLabel: p("Session", "सत्र"), enrolledOn: p("Enrolment date", "प्रवेश की तारीख"),
  leftOn: p("Leaving date", "विद्यालय छोड़ने की तारीख"), dateOfBirth: p("Date of birth", "जन्म तिथि"),
  fatherName: p("Father's name", "पिता का नाम"), motherName: p("Mother's name", "माता का नाम"),
  identity: p("Identity needs review", "पहचान की जाँच ज़रूरी है"), template: p("Certificate format needs review", "प्रमाण पत्र के प्रारूप की जाँच ज़रूरी है"),
};

export async function SchoolOfficeAttention({ sessionLabel }: { sessionLabel: string }) {
  const attention = await loadSchoolOfficeAttention(sessionLabel);
  if (!attention || (!attention.unavailable && !attention.items.length)) return null;
  const { language } = attention;
  return <Card as="section" aria-label={lead(title, language)} style={{ minWidth: 0 }}>
    <CardHead title={<span>{lead(title, language)}{under(title, language) ? <small lang="hi" style={{ display: "block", fontSize: 12, color: "var(--mut)", fontWeight: 500 }}>{under(title, language)}</small> : null}</span>} sub={sessionLabel} />
    {attention.unavailable ? <p role="status" style={{ margin: "12px 0 0", fontSize: 13, color: "var(--mut)" }}>{lead(p("School Office records are temporarily unavailable. Try again.", "विद्यालय कार्यालय के रिकॉर्ड अभी उपलब्ध नहीं हैं। फिर प्रयास करें।"), language)}</p> : null}
    <div style={{ display: "grid", minWidth: 0 }}>
      {attention.items.map(item => <Link key={`${item.kind}:${item.id}`} href={item.href} style={{ display: "flex", flexDirection: "column", minHeight: 44, gap: 3, padding: "12px 0", borderBottom: "1px solid var(--bd)", overflowWrap: "anywhere" }}>
        <strong style={{ fontSize: 13 }}>{item.studentName || lead(labels[item.kind], language)}</strong>
        {item.studentName ? <span style={{ fontSize: 12, color: "var(--pri)", fontWeight: 600 }}>{lead(labels[item.kind], language)}</span> : null}
        {under(labels[item.kind], language) ? <span lang="hi" style={{ fontSize: 12, color: "var(--mut)" }}>{under(labels[item.kind], language)}</span> : null}
        {item.blockerCodes?.length ? <span style={{ fontSize: 12, color: "var(--mut)" }}>{item.blockerCodes.map(code => lead(fields[code.split(":")[0]] ?? p("Record needs review", "रिकॉर्ड की जाँच ज़रूरी है"), language)).join(" · ")}</span> : null}
      </Link>)}
    </div>
  </Card>;
}
