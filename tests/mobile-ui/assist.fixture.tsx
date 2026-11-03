import type { ReactNode } from "react";
import { createRoot } from "react-dom/client";

import { assistFeatures } from "@/modules/assist/domain/features";
import { LanguageProvider } from "@/platform/i18n/use-language";
import type { Language } from "@/platform/i18n/language";
import { AskRow } from "@/vx/assist/ask-assist";
import { TodayBrief } from "@/vx/assist/brief-assist";
import { CallScript } from "@/vx/assist/call-script";
import { ColumnsAssist } from "@/vx/assist/columns-assist";
import { AssistProvider } from "@/vx/assist/context";
import { CoverAssist } from "@/vx/assist/cover-assist";
import { FormScan } from "@/vx/assist/form-assist";
import { MessageAssist, ReplyAssist } from "@/vx/assist/message-assist";
import { NoteAssist } from "@/vx/assist/note-assist";
import { AiRemarkCard, AiRemarksBar, useAiRemarks } from "@/vx/assist/remarks-assist";
import { ResultsAssist } from "@/vx/assist/results-assist";
import { ChildSummary, ClassDigest } from "@/vx/assist/summary-assist";
import { TemplateAssist } from "@/vx/assist/template-assist";
import { ToastProvider } from "@/vx/ui/overlays";
import "../../src/app/globals.css";
import "../../src/vx/vx.css";

/*
 * The AI helper's buttons and suggestions on their own (D-330), drawn at a
 * phone's width and a desk's to check touch targets, wrapping and layout.
 * `/api/assist` is answered here with canned drafts: no request leaves the
 * page, and every name and figure is test data (rule 6).
 *
 *   npx vite --config tests/mobile-ui/design.vite.config.ts
 *   http://127.0.0.1:3202/assist.html            (?locale=hi, ?offline=1)
 */

const params = new URLSearchParams(location.search);
const language: Language = params.get("locale") === "hi" ? "hi" : params.get("locale") === "both" ? "both" : "en";

const CANNED: Record<string, unknown> = {
  "note.polish": { text: "Finds fractions hard; needs extra practice with equivalent fractions this week.", tags: ["studies"] },
  "text.translate": { text: "भिन्न में कठिनाई है; इस हफ़्ते समतुल्य भिन्न का अभ्यास चाहिए।" },
  "message.write": { title: "School closed on Monday", hi: "प्रिय {parent}, होली के कारण सोमवार को विद्यालय बंद रहेगा। मंगलवार से कक्षाएँ सामान्य रहेंगी।", en: "Dear {parent}, the school will be closed on Monday for Holi. Classes resume on Tuesday." },
  "message.polish": { title: "School closed on Monday", hi: "प्रिय {parent}, सोमवार को विद्यालय बंद रहेगा।", en: "Dear {parent}, the school is closed on Monday." },
  "message.reply": { hi: "धन्यवाद, आपका संदेश मिल गया। कक्षा अध्यापक आपसे बात करेंगे।", en: "Thank you, we got your message. The class teacher will call you." },
  "cover.plan": {
    title: "Quick revision quiz",
    steps: [
      { minutes: 5, text: "Settle the class and write five questions from last week's chapter on the board." },
      { minutes: 20, text: "Children answer in their notebooks; walk around and help anyone stuck." },
      { minutes: 10, text: "Go through the answers together; children mark their own work." },
      { minutes: 5, text: "Ask two children to explain one answer each." },
    ],
    tip: "Keep the noise low by asking for hands up, not calling out.",
  },
  "call.script": {
    opening: "Namaste <<parent>>, this is the school office calling about <<children>>.",
    points: ["<<amount_due>> is due for <<installments>>.", "When would it be possible to pay?", "If it is hard right now, we can talk about paying in parts."],
    close: "Thank you, we will note what you said.",
  },
  "child.summary": {
    points: ["Reads fluently and enjoys stories.", "Finds fractions hard; extra practice has started.", "Homework was missed twice this month."],
    opener: "Thank you for coming — your child has been reading really well this term.",
  },
  "class.digest": {
    themes: ["Homework was missed by several children.", "Good effort in the reading hour."],
    attention: [{ ref: "C1", line: "Missed homework three times." }],
    praise: [{ ref: "C2", line: "Helped classmates with reading." }],
  },
  "brief.today": {
    headline: "<<classes_marked>> classes are marked and <<present_today>> of children are in today.",
    points: ["<<staff_away>> teachers are away; <<cover_arranged>> periods have cover.", "<<collected_today>> collected so far."],
    actions: ["Remind the class teachers who have not marked yet.", "Arrange the last cover period."],
  },
  "form.read": {
    values: [
      { field: "fullName", value: "Qatest Kumar", sure: true },
      { field: "dob", value: "21-08-2019", sure: false },
      { field: "fatherName", value: "Qaparent Kumar", sure: true },
      { field: "phone", value: "9000000001", sure: true },
    ],
  },
  "columns.match": { matches: [{ header: "Pita ka naam", field: "fatherName" }, { header: "Mob. No.", field: "phone" }] },
  "template.draft": { name: "Fee due reminder", hi: "विद्यालय की ओर से सूचना: प्रिय {parent}, {student} की फीस {amount} {date} तक जमा करें।", en: "A message from the school: Dear {parent}, please pay {student}'s fee of {amount} by {date}." },
  "results.summary": {
    en: "Most children passed every subject. Maths was the lowest subject and needs attention; English was strong.",
    hi: "अधिकतर बच्चे सभी विषयों में उत्तीर्ण हुए। गणित सबसे कमज़ोर रहा; अंग्रेज़ी अच्छी रही।",
    focus: ["Add two practice periods for Maths.", "Pair strong readers with those who struggle."],
  },
  "remarks.class": { remarks: [{ ref: "C1", en: "Steady work this term; daily reading will help even more.", hi: "इस सत्र नियमित काम; रोज़ पढ़ना और मदद करेगा।" }] },
  "ask.answer": { answer: "Open Notes on children, pick the child and tap Speak a note. You can type or speak in Hindi or English.", links: ["/teach/notes"], search: null },
};

const realFetch = window.fetch.bind(window);
window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (!url.endsWith("/api/assist")) return realFetch(input, init);
  if (init?.method === "PATCH") return new Response(JSON.stringify({ ok: true }), { status: 200 });
  const { task } = JSON.parse(String(init?.body ?? "{}")) as { task: string };
  await new Promise((r) => setTimeout(r, 500));
  return new Response(JSON.stringify({ ok: true, value: CANNED[task], logId: null }), { status: 200 });
};
if (params.get("offline") === "1") Object.defineProperty(navigator, "onLine", { get: () => false });

function Block({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section style={{ display: "flex", flexDirection: "column", gap: 8, padding: "16px", borderBottom: "1px solid var(--bd)" }}>
      <h2 style={{ margin: 0, fontSize: 13, fontWeight: 700, color: "var(--mut)", textTransform: "uppercase", letterSpacing: ".05em" }}>{title}</h2>
      {children}
    </section>
  );
}

const kids = [
  { id: "c-1", percent: 72, attendance: 91, strongest: "Maths", weakest: "English" },
  { id: "c-2", percent: 55, attendance: 70, strongest: null, weakest: null },
];

function Remarks() {
  const ai = useAiRemarks({ exam: "Term 1", classLabel: "6 A" });
  return (
    <>
      <AiRemarksBar ai={ai} missing={kids} />
      <AiRemarkCard ai={ai} child={kids[0]} current="" onPick={() => undefined} />
    </>
  );
}

const today = new Date().toISOString().slice(0, 10);
const recent = new Date().toISOString();

function Fixture() {
  return (
    <div className="vx" style={{ minHeight: "100dvh", background: "var(--bg)", color: "var(--fg)" }}>
      <Block title="Note helper">
        <textarea className="inp" defaultValue="quiet today finds fractions hard needs practice" style={{ minHeight: 80 }} />
        <NoteAssist body="quiet today finds fractions hard needs practice" childName="Qatest Kumar" onApply={() => undefined} />
      </Block>
      <Block title="Notice writer">
        <MessageAssist audience="parents" kindLabel={{ en: "Holiday", hi: "छुट्टी" }} current={{ title: "", hi: "", en: "" }} language="both" onApply={() => undefined} />
      </Block>
      <Block title="Reply">
        <ReplyAssist incoming="Sir my son is not well today" regarding={null} notice={null} names={[]} onApply={() => undefined} />
      </Block>
      <Block title="Cover plan">
        <CoverAssist classLabels="7 B" subject="Science" starts="10:20" ends="11:00" />
      </Block>
      <Block title="Dues call">
        <CallScript
          topic="dues"
          facts={[
            { key: "parent", label: "parent's name", value: "Qaparent Kumar" },
            { key: "children", label: "children's first names", value: "Qatest" },
            { key: "amount_due", label: "fees due today", value: "₹4,500" },
            { key: "installments", label: "installments overdue", value: "Inst 2" },
          ]}
          situation={["the fees have been overdue for more than a week"]}
        />
      </Block>
      <Block title="Child summary">
        <ChildSummary childName="Qatest Kumar" notes={[{ body: "Reads fluently in class.", tags: ["studies"], createdAt: recent }]} facts={["Attendance this session: 91%"]} />
      </Block>
      <Block title="Class digest">
        <ClassDigest
          classLabel="6 A"
          today={today}
          notes={[
            { body: "Did not bring homework again.", tags: ["behaviour"], createdAt: recent, studentId: "c-1", studentName: "Qatest One" },
            { body: "Helped others read.", tags: ["talent"], createdAt: recent, studentId: "c-2", studentName: "Qatest Two" },
          ]}
          onOpen={() => undefined}
        />
      </Block>
      <Block title="Today brief">
        <TodayBrief
          facts={[
            { key: "classes_marked", label: "Classes marked", value: "17 of 19" },
            { key: "present_today", label: "Present today", value: "94%" },
            { key: "staff_away", label: "Teachers away", value: "2" },
            { key: "cover_arranged", label: "Cover", value: "3 of 4 arranged" },
            { key: "collected_today", label: "Collected today", value: "₹12,500 in 9 receipts" },
          ]}
        />
      </Block>
      <Block title="Report-card remarks">
        <Remarks />
      </Block>
      <Block title="Admission form">
        <FormScan classes={["6 A", "7 B"]} onApply={() => undefined} />
      </Block>
      <Block title="Import columns">
        <ColumnsAssist headers={["Name", "Pita ka naam", "Mob. No."]} fields={[{ key: "fullName", label: "Full name", description: "" }, { key: "fatherName", label: "Father name", description: "" }, { key: "phone", label: "Phone", description: "" }]} map={{ fullName: "Name" }} onApply={() => undefined} />
      </Block>
      <Block title="WhatsApp template">
        <TemplateAssist category="utility" onApply={() => undefined} />
      </Block>
      <Block title="Results summary">
        <ResultsAssist facts={{ exam: "Term 1", classLabel: "6 A", children: 32, counted: 30, passedAll: 26, belowCount: 4, passPct: 33, previousExam: null, subjects: [{ name: { en: "Maths" }, avgPct: 48, sat: 30 }] }} />
      </Block>
      <Block title="Ask (search)">
        <AskRow question="how do I write a note about a child who was absent for many days?" pages={[{ href: "/teach/notes", label: { en: "Notes on children", hi: "बच्चों के नोट्स" }, icon: "note" }]} onGo={() => undefined} onSearch={() => undefined} />
      </Block>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <LanguageProvider language={language}>
    <ToastProvider>
      <AssistProvider features={assistFeatures}>
        <div className="vxt">
          <Fixture />
          <div id="vx-layer" className="vxt vx-layer" />
        </div>
      </AssistProvider>
    </ToastProvider>
  </LanguageProvider>,
);
