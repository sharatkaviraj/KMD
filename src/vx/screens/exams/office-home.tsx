"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { useVx } from "@/vx/i18n";
import { Ic, type IconName } from "@/vx/icons";
import { ago, initials } from "@/vx/format";
import { p, type Pair } from "@/vx/text";
import { Chip, ChipRow, Seg } from "@/vx/ui/controls";
import { HelpButton, useToast } from "@/vx/ui/overlays";
import { TopBar, VxPage } from "@/vx/ui/page";
import { Avatar, avatarColor, Btn, Card, EmptyState, IconTile, Pill, Progress, Ring, SecHead, type Tone } from "@/vx/ui/primitives";

import type { SetupKey, SetupStep } from "./domain/office";
import { RemindSheet, TeacherLateRow, type TeacherRowView } from "./remind";
import type { ActionResult } from "./save-types";

export type HomeView = "home" | "menu" | "checklist" | "late" | "remind";

export type ResultsExamView = {
  id: string;
  name: Pair;
  dates: string;
  percent: number;
  entered: number;
  total: number;
  teachersDone: number;
  teachersTotal: number;
  lateCount: number;
  dueLabel: string | null;
  daysToDue: number | null;
  resultsLabel: string | null;
  daysToResults: number | null;
  ptmAt: string | null;
  bands: { key: string; label: Pair; percent: number }[];
};

export type NextExamView = {
  id: string;
  name: Pair;
  dates: string;
  daysLeft: number | null;
  copiedFrom: string | null;
  slots: number;
  papersReceived: number;
  steps: (SetupStep & { dueLabel: string | null; daysLeft: number | null })[];
  readiness: { percent: number; done: number; underWay: number };
};

export type TimelineItem = { id: string; name: Pair; when: string; state: "done" | "now" | "next" | "later" };

export type ActivityItem = { id: string; text: Pair; at: string; kind: string };

const STEP_WORDS: Record<SetupKey, { title: Pair; open: Pair; href: (examId: string) => string }> = {
  created: { title: p("Exam created", "परीक्षा बनी"), open: p("See exams", "परीक्षाएँ देखें"), href: () => "/exams" },
  datesheet: { title: p("Date sheet", "डेट शीट"), open: p("Open date sheet", "डेट शीट खोलें"), href: (id) => `/exam-office/plan?exam=${id}` },
  parents: { title: p("Tell parents the dates", "अभिभावकों को तिथियाँ बताएँ"), open: p("Open publish", "प्रकाशन खोलें"), href: (id) => `/exam-office/plan?exam=${id}&view=publish` },
  seating: { title: p("Seating", "बैठक व्यवस्था"), open: p("Open seating", "बैठक खोलें"), href: (id) => `/exam-office/plan?exam=${id}&view=seating` },
  duties: { title: p("Invigilation duties", "निरीक्षण ड्यूटी"), open: p("Open duties", "ड्यूटी खोलें"), href: (id) => `/exam-office/plan?exam=${id}&view=duties` },
  papers: { title: p("Question papers", "प्रश्न पत्र"), open: p("Open papers", "प्रश्न पत्र खोलें"), href: (id) => `/exam-office/plan?exam=${id}&view=papers` },
  admit: { title: p("Admit slips", "प्रवेश पर्ची"), open: p("Open seating", "बैठक खोलें"), href: (id) => `/exam-office/plan?exam=${id}&view=seating` },
};

function stepHelp(key: SetupKey, next: NextExamView): Pair {
  switch (key) {
    case "created":
      return p(`${next.dates} · ${next.slots} papers on the date sheet`, `${next.dates} · डेट शीट पर ${next.slots} पेपर`);
    case "datesheet":
      return next.copiedFrom
        ? p(`Copied from ${next.copiedFrom}. Check the dates, then make it final.`, `${next.copiedFrom} से कॉपी किया। तिथियाँ जाँचें, फिर पक्का करें।`)
        : p("Put each band's papers on its days, then make it final.", "हर समूह के पेपर उसके दिनों पर रखें, फिर पक्का करें।");
    case "parents":
      return p("Publish the date sheet once it is final; the notice to families goes from Notices.", "डेट शीट पक्की होने पर प्रकाशित करें; परिवारों को सूचना 'सूचनाएँ' से जाती है।");
    case "seating":
      return p("Fills itself by roll numbers · two classes per room.", "रोल नंबर से अपने आप भरती है · एक कमरे में दो कक्षाएँ।");
    case "duties":
      return p("The app shares duties fairly among the teachers. You only check it.", "ऐप ड्यूटी सबमें बराबर बाँटता है। आप बस जाँचें।");
    case "papers":
      return p(`${next.papersReceived} of ${next.slots} papers received from subject teachers.`, `विषय-अध्यापकों से ${next.slots} में से ${next.papersReceived} पेपर आए।`);
    case "admit":
      return p("Made from the seating plan. The office prints them.", "बैठक योजना से बनती है। कार्यालय छापता है।");
  }
}

const OWNER_WORDS: Record<SetupStep["owner"], Pair> = {
  you: p("You", "आप"),
  teachers: p("Subject teachers", "विषय-अध्यापक"),
  office: p("Office desk", "कार्यालय"),
};

const CALLS: { key: string; label: Pair }[] = [
  { key: "today", label: p("Will finish today", "आज पूरा करेंगे") },
  { key: "saturday", label: p("Will finish by Saturday", "शनिवार तक") },
  { key: "help", label: p("Needs help with the link", "लिंक में मदद चाहिए") },
  { key: "no_answer", label: p("No answer", "जवाब नहीं") },
];

export function ExamHome({
  view,
  hello,
  staffName,
  sessionLabel,
  todayLabel,
  results,
  next,
  teachers,
  timeline,
  activity,
  remind,
  logCall,
  markStep,
}: {
  view: HomeView;
  hello: string;
  staffName: string;
  sessionLabel: string;
  todayLabel: string;
  results: ResultsExamView | null;
  next: NextExamView | null;
  teachers: TeacherRowView[];
  timeline: TimelineItem[];
  activity: ActivityItem[];
  remind: (input: { examId: string; staffIds: string[] }) => Promise<ActionResult>;
  logCall: (input: { examId: string; staffId: string; outcome: string }) => Promise<ActionResult>;
  markStep: (input: { examId: string; key: string; done: boolean }) => Promise<ActionResult>;
}) {
  const { tx } = useVx();
  const toast = useToast();
  const router = useRouter();
  const [pending, start] = useTransition();
  const notReminded = teachers.filter((t) => !t.remindedAt);
  const [remindIds, setRemindIds] = useState<string[] | null>(view === "remind" ? (notReminded.length ? notReminded : teachers).map((t) => t.id) : null);
  const [callOpen, setCallOpen] = useState<string | null>(null);
  const [calls, setCalls] = useState<Record<string, string>>({});
  const [filter, setFilter] = useState<"all" | "mine" | "others">("all");

  const crumb = `${tx(p("Exams", "परीक्षा"))} · ${tx(p("Session", "सत्र"))} ${sessionLabel}`;
  const remindAll = () => setRemindIds((notReminded.length ? notReminded : teachers).map((t) => t.id));
  const dueLabel = results?.dueLabel ?? "—";

  const titles: Record<HomeView, Pair> = {
    home: p("Today", "आज"),
    menu: p("Menu", "मेनू"),
    checklist: next ? p(`${next.name.en} checklist`, `${next.name.hi ?? next.name.en} चेकलिस्ट`) : p("Checklist", "चेकलिस्ट"),
    late: p("Late teachers", "देर वाले शिक्षक"),
    remind: p("Late teachers", "देर वाले शिक्षक"),
  };
  const mSub: Record<HomeView, string> = {
    home: `${todayLabel} · ${staffName}`,
    menu: `${tx(p("Exam coordinator", "परीक्षा प्रभारी"))} · ${sessionLabel}`,
    checklist: next ? `${next.readiness.percent}% ${tx(p("ready", "तैयार"))}${next.daysLeft !== null ? ` · ${next.daysLeft} ${tx(p("days left", "दिन बाकी"))}` : ""}` : "",
    late: `${teachers.length} ${tx(p("not finished", "बाकी"))}${results?.dueLabel ? ` · ${tx(p("due", "अंतिम"))} ${results.dueLabel}` : ""}`,
    remind: `${teachers.length} ${tx(p("not finished", "बाकी"))}`,
  };

  const help = (
    <HelpButton
      title={tx(titles[view])}
      steps={
        view === "checklist"
          ? [
              { icon: "list", title: tx(p("Steps in order", "क्रम से कदम")), body: tx(p("Each step shows who does it and by when.", "हर कदम में कौन और कब तक लिखा है।")) },
              { icon: "arrowRight", title: tx(p("Open the right place", "सही जगह खोलें")), body: tx(p("The button on each step takes you straight there.", "हर कदम का बटन सीधे वहाँ ले जाता है।")) },
              { icon: "checkCircle", title: tx(p("Tick when done", "पूरा होने पर टिक करें")), body: tx(p("Most steps tick themselves. You can undo a tick.", "ज़्यादातर कदम अपने आप टिक होते हैं। टिक वापस भी ले सकते हैं।")) },
            ]
          : view === "late" || view === "remind"
            ? [
                { icon: "users", title: tx(p("Who is behind", "कौन पीछे है")), body: tx(p("Teachers with marks still missing, least done first.", "जिनके अंक बाकी हैं, सबसे कम वाले पहले।")) },
                { icon: "send", title: tx(p("Remind on WhatsApp", "WhatsApp पर याद दिलाएँ")), body: tx(p("The message is Hindi first and carries the teacher's own marks link.", "संदेश पहले हिंदी में, शिक्षक के अपने अंक लिंक के साथ।")) },
                { icon: "phone", title: tx(p("Or call", "या फ़ोन करें")), body: tx(p("Pick how the call went so everyone can see it.", "फ़ोन का नतीजा चुनें ताकि सबको दिखे।")) },
              ]
            : [
                { icon: "award", title: tx(p("Two big jobs", "दो बड़े काम")), body: tx(p("Results for the exam just sat, and setting up the next one.", "अभी हुई परीक्षा का परिणाम, और अगली की तैयारी।")) },
                { icon: "send", title: tx(p("Late teachers", "देर वाले शिक्षक")), body: tx(p("One tap reminds them on WhatsApp with their own marks link.", "एक टैप में उनके अंक लिंक के साथ WhatsApp पर याद।")) },
                { icon: "grid", title: tx(p("Quick actions", "जल्दी के काम")), body: tx(p("Date sheet, seating, marks and results are one tap away.", "डेट शीट, बैठक, अंक और परिणाम एक टैप पर।")) },
              ]
      }
    />
  );

  const back = view === "checklist" || view === "late" || view === "remind";
  const actions = (
    <>
      {back ? <Btn variant="ghost" icon="chevLeft" href="/exam-office">{tx(p("Today", "आज"))}</Btn> : null}
      {help}
      {view === "home" ? (
        <>
          <Btn variant="sec" icon="grid" href="/exam-office?view=menu">{tx(p("All tools", "सभी काम"))}</Btn>
          {results && notReminded.length ? (
            <Btn variant="pri" icon="send" onClick={remindAll}>
              {tx(p(`Remind ${notReminded.length} late teachers`, `${notReminded.length} शिक्षकों को याद दिलाएँ`))}
            </Btn>
          ) : null}
        </>
      ) : null}
    </>
  );

  const tick = (key: string, done: boolean) => {
    if (!next) return;
    start(async () => {
      const r = await markStep({ examId: next.id, key, done }).catch(() => null);
      if (!r?.ok) {
        toast.show({ text: tx(r && !r.ok ? r.message : p("Not saved", "सहेजा नहीं गया")), tone: "bad" });
        return;
      }
      router.refresh();
      if (done) {
        toast.show({ text: `“${tx(STEP_WORDS[key as SetupKey].title)}” ${tx(p("marked done", "पूरा किया"))}` });
      }
    });
  };

  const pickCall = (t: TeacherRowView, key: string, label: Pair) => {
    if (!results) return;
    setCallOpen(null);
    setCalls((c) => ({ ...c, [t.id]: tx(label) }));
    start(async () => {
      const r = await logCall({ examId: results.id, staffId: t.id, outcome: key }).catch(() => null);
      if (r?.ok) toast.show({ text: `${tx(p("Call saved", "फ़ोन दर्ज"))} · ${t.name} · ${tx(label)}` });
      else toast.show({ text: tx(r && !r.ok ? r.message : p("Not saved", "सहेजा नहीं गया")), tone: "bad" });
    });
  };

  /* ------------------------------------------------------------ views */

  let body: React.ReactNode;
  if (view === "menu") {
    body = <MenuView staffName={staffName} sessionLabel={sessionLabel} results={results} next={next} teachers={teachers} />;
  } else if (view === "checklist") {
    body = !next ? (
      <Card>
        <EmptyState icon="calendar" title={tx(p("No exam to set up", "तैयारी के लिए कोई परीक्षा नहीं"))} body={tx(p("Create the next exam from the marks tracker.", "अगली परीक्षा अंक ट्रैकर से बनाएँ।"))} action={<Btn variant="pri" icon="plus" href="/exams?view=create">{tx(p("Create exam", "परीक्षा बनाएँ"))}</Btn>} />
      </Card>
    ) : (
      <div style={{ display: "flex", flexDirection: "column", gap: 14, maxWidth: 920 }}>
        <Card style={{ display: "flex", alignItems: "center", gap: 20, flexWrap: "wrap" }}>
          <Ring value={next.readiness.percent} max={100} size={96} stroke={9} tone="var(--info)">
            <span style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
              <strong className="num" style={{ fontSize: 22 }}>{next.readiness.percent}%</strong>
              <span style={{ fontSize: 11, color: "var(--mut)" }}>{tx(p("ready", "तैयार"))}</span>
            </span>
          </Ring>
          <span style={{ flex: "1 1 260px", display: "flex", flexDirection: "column", gap: 6 }}>
            <strong className="serif" style={{ fontSize: 22 }}>{tx(next.name)} · {tx(p("setup", "तैयारी"))}</strong>
            <span style={{ fontSize: 13, color: "var(--mut)" }}>
              {next.dates}
              {next.daysLeft !== null ? ` · ${next.daysLeft} ${tx(p("days left", "दिन बाकी"))}` : ""} · {tx(p("each step opens the right place", "हर कदम सही जगह खोलता है"))}
            </span>
            <Progress value={next.readiness.percent} max={100} tone="var(--ok)" />
            <span style={{ fontSize: 13 }}>
              <strong>{next.readiness.done} {tx(p("of", "में से"))} {next.steps.length} {tx(p("steps done", "कदम पूरे"))}</strong> · {next.readiness.underWay} {tx(p("under way", "जारी"))}
            </span>
          </span>
          <Seg
            label={tx(p("Whose steps", "किसके कदम"))}
            value={filter}
            onChange={setFilter}
            options={[
              { value: "all", label: tx(p("All steps", "सभी")) },
              { value: "mine", label: tx(p("Mine", "मेरे")) },
              { value: "others", label: tx(p("Others", "दूसरों के")) },
            ]}
          />
        </Card>
        {next.steps
          .filter((s) => filter === "all" || (filter === "mine" ? s.owner === "you" : s.owner !== "you"))
          .map((s, i, list) => {
            const words = STEP_WORDS[s.key];
            const tone: Tone = s.state === "done" ? "ok" : s.state === "doing" ? "warn" : "mut";
            const label = s.state === "done" ? tx(p("Done", "पूरा")) : s.state === "doing" ? (s.progress === "draft" ? tx(p("Draft", "ड्राफ़्ट")) : (s.progress ?? "")) : tx(p("Not started", "शुरू नहीं"));
            return (
              <div key={s.key} style={{ display: "flex", gap: 14 }}>
                <span className="hide-m" style={{ display: "flex", flexDirection: "column", alignItems: "center", width: 34 }}>
                  <span
                    style={{
                      width: 34,
                      height: 34,
                      borderRadius: 17,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontWeight: 700,
                      background: s.state === "done" ? "var(--ok)" : s.state === "doing" ? "var(--warns)" : "var(--card)",
                      color: s.state === "done" ? "var(--onsolid)" : s.state === "doing" ? "var(--warnfg)" : "var(--mut)",
                      border: `2px solid ${s.state === "done" ? "var(--ok)" : s.state === "doing" ? "var(--warn)" : "var(--bds)"}`,
                    }}
                  >
                    {s.state === "done" ? <Ic n="check" size={16} /> : i + 1}
                  </span>
                  {i < list.length - 1 ? <span style={{ flex: 1, width: 2, background: s.state === "done" ? "var(--ok)" : "var(--bd)", marginTop: 4 }} /> : null}
                </span>
                <Card style={{ flex: 1, display: "flex", flexDirection: "column", gap: 10 }}>
                  <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
                    <span style={{ flex: 1, display: "flex", flexDirection: "column" }}>
                      <strong style={{ fontSize: 16 }}>{tx(words.title)}</strong>
                      <span style={{ fontSize: 13, color: "var(--mut)" }}>{tx(stepHelp(s.key, next))}</span>
                    </span>
                    <Pill tone={tone}>{label}</Pill>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                    <Pill tone="mut">
                      <strong style={{ fontSize: 10, marginRight: 4 }}>{s.owner === "you" ? initials(staffName) : ""}</strong>
                      {tx(OWNER_WORDS[s.owner])}
                    </Pill>
                    {s.dueLabel ? (
                      <Pill tone={s.state !== "done" && s.daysLeft !== null && s.daysLeft <= 25 ? "warn" : "mut"} icon="calendar">
                        {s.dueLabel}
                        {s.state !== "done" && s.daysLeft !== null ? (s.daysLeft >= 0 ? ` · ${tx(p("in", ""))} ${s.daysLeft} ${tx(p("days", "दिन में"))}` : ` · ${-s.daysLeft} ${tx(p("days late", "दिन देर"))}`) : ""}
                      </Pill>
                    ) : null}
                    {s.key === "papers" && s.state !== "done" ? <Progress value={s.part * 100} max={100} tone="var(--info)" style={{ width: 120 }} /> : null}
                    <span style={{ flex: 1 }} />
                    {s.canTick && s.owner === "you" ? (
                      <Btn variant="ghost" icon="checkCircle" disabled={pending} onClick={() => tick(s.key, true)}>
                        {tx(p("Mark done", "पूरा करें"))}
                      </Btn>
                    ) : null}
                    {s.state === "done" && next.steps.find((x) => x.key === s.key) && s.key !== "created" && s.key !== "datesheet" && s.key !== "seating" && s.key !== "duties" && s.key !== "papers" && s.key !== "parents" ? (
                      <Btn variant="ghost" icon="undo" disabled={pending} onClick={() => tick(s.key, false)}>
                        {tx(p("Undo", "वापस लें"))}
                      </Btn>
                    ) : null}
                    <Btn variant="soft" href={words.href(next.id)}>
                      {tx(words.open)} <Ic n="arrowRight" size={16} />
                    </Btn>
                  </div>
                </Card>
              </div>
            );
          })}
      </div>
    );
  } else if (view === "late" || view === "remind") {
    body = !results ? (
      <Card>
        <EmptyState icon="clipboard" title={tx(p("No exam is open for marks", "कोई परीक्षा अंकों के लिए खुली नहीं"))} />
      </Card>
    ) : (
      <div style={{ display: "flex", flexDirection: "column", gap: 14, maxWidth: 1040 }}>
        <Card style={{ display: "flex", alignItems: "center", gap: 18, flexWrap: "wrap" }}>
          <Ring value={results.percent} max={100} size={90} stroke={9} tone="var(--pri)">
            <span style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
              <strong className="num" style={{ fontSize: 20 }}>{results.percent}%</strong>
              <span style={{ fontSize: 11, color: "var(--mut)" }}>{tx(p("entered", "भरे"))}</span>
            </span>
          </Ring>
          <span style={{ flex: "1 1 280px", display: "flex", flexDirection: "column", gap: 4 }}>
            <strong className="serif" style={{ fontSize: 22 }}>
              {teachers.length === 0 ? tx(p("Everyone has finished", "सबने अंक भर दिए")) : tx(p(`${teachers.length} teachers have not finished`, `${teachers.length} शिक्षकों के अंक बाकी हैं`))}
            </strong>
            <span style={{ fontSize: 13, color: "var(--mut)" }}>
              {tx(results.name)} {tx(p("marks are due", "अंक"))} {dueLabel}
              {results.daysToDue !== null ? ` (${results.daysToDue >= 0 ? `${results.daysToDue} ${tx(p("days", "दिन"))}` : tx(p("overdue", "देर"))})` : ""}.{" "}
              {tx(p("Each reminder carries the teacher's own marks link — no login needed.", "हर रिमाइंडर में शिक्षक का अपना अंक लिंक होता है — लॉगिन नहीं चाहिए।"))}
            </span>
          </span>
          {teachers.length ? (
            <Btn variant={notReminded.length ? "pri" : "soft"} icon={notReminded.length ? "send" : "checkCircle"} onClick={remindAll}>
              {notReminded.length === teachers.length
                ? tx(p(`Remind all ${teachers.length} on WhatsApp`, `सभी ${teachers.length} को WhatsApp पर याद दिलाएँ`))
                : notReminded.length
                  ? tx(p(`Remind the other ${notReminded.length}`, `बाकी ${notReminded.length} को याद दिलाएँ`))
                  : tx(p("All reminded · remind again", "सबको याद दिलाया · फिर से"))}
            </Btn>
          ) : null}
        </Card>
        {teachers.length ? (
          <Card pad={false} style={{ overflow: "hidden" }}>
            <div className="hide-m" style={{ display: "flex", padding: "12px 18px", fontSize: 12, fontWeight: 600, letterSpacing: ".06em", textTransform: "uppercase", color: "var(--mut)", background: "var(--s2)" }}>
              <span style={{ flex: 1, paddingLeft: 54 }}>{tx(p("Teacher · classes", "शिक्षक · कक्षाएँ"))}</span>
              <span style={{ width: 340 }}>{tx(p("Entered", "भरे"))}</span>
            </div>
            {teachers.map((t) => (
              <div key={t.id} style={{ borderTop: "1px solid var(--bd)" }}>
                <TeacherLateRow t={t} callTag={calls[t.id] ? `${tx(p("Called", "फ़ोन किया"))} · ${calls[t.id]}` : null} onRemind={() => setRemindIds([t.id])} onCall={() => setCallOpen(callOpen === t.id ? null : t.id)} />
                {callOpen === t.id ? (
                  <div style={{ padding: "0 18px 14px 72px", display: "flex", flexDirection: "column", gap: 6 }}>
                    <span style={{ fontSize: 12, color: "var(--mut)" }}>{tx(p("How did the call go?", "फ़ोन पर क्या बात हुई?"))}</span>
                    <ChipRow label={tx(p("Call outcome", "फ़ोन का नतीजा"))}>
                      {CALLS.map((c) => (
                        <Chip key={c.key} onClick={() => pickCall(t, c.key, c.label)}>
                          {tx(c.label)}
                        </Chip>
                      ))}
                    </ChipRow>
                  </div>
                ) : null}
              </div>
            ))}
          </Card>
        ) : (
          <Card>
            <EmptyState icon="checkCircle" title={tx(p("Nobody is behind", "कोई पीछे नहीं"))} />
          </Card>
        )}
      </div>
    );
  } else {
    body = <HomeBody hello={hello} staffName={staffName} todayLabel={todayLabel} results={results} next={next} teachers={teachers} notReminded={notReminded.length} timeline={timeline} activity={activity} onRemind={remindAll} />;
  }

  return (
    <VxPage>
      <TopBar crumb={crumb} title={tx(titles[view])} mSub={mSub[view]} mBack={back ? "/exam-office" : undefined} actions={actions} mAction={help} />
      <main>
        <section className="pad" style={{ padding: "22px 28px 40px", display: "flex", flexDirection: "column", gap: 16, minWidth: 0 }}>{body}</section>
      </main>
      {results ? (
        <RemindSheet
          open={remindIds !== null}
          onClose={() => setRemindIds(null)}
          teachers={teachers.filter((t) => remindIds?.includes(t.id))}
          exam={{ id: results.id, en: results.name.en, hi: results.name.hi ?? results.name.en }}
          dueLabel={dueLabel}
          from={staffName}
          remind={remind}
        />
      ) : null}
    </VxPage>
  );
}

/* ------------------------------------------------------------- home */

function HomeBody({
  hello,
  staffName,
  todayLabel,
  results,
  next,
  teachers,
  notReminded,
  timeline,
  activity,
  onRemind,
}: {
  hello: string;
  staffName: string;
  todayLabel: string;
  results: ResultsExamView | null;
  next: NextExamView | null;
  teachers: TeacherRowView[];
  notReminded: number;
  timeline: TimelineItem[];
  activity: ActivityItem[];
  onRemind: () => void;
}) {
  const { tx } = useVx();
  const surname = staffName.split(/\s+/).slice(-1)[0] ?? staffName;
  const helloHi = hello === "Good morning" ? "सुप्रभात" : hello === "Good afternoon" ? "नमस्ते" : "शुभ संध्या";
  const needs: { title: string; sub: string; icon: IconName; tone: Tone; href: string }[] = [];
  if (results && teachers.length) {
    needs.push({ title: tx(p(`${teachers.length} teachers not finished`, `${teachers.length} शिक्षकों के अंक बाकी`)), sub: `${tx(results.name)} · ${tx(p("due", "अंतिम"))} ${results.dueLabel ?? "—"}`, icon: "alert", tone: "bad", href: "/exam-office?view=late" });
  }
  if (next) {
    const ds = next.steps.find((s) => s.key === "datesheet");
    if (ds && ds.state !== "done") {
      needs.push({ title: tx(p(`${next.name.en} date sheet is ${ds.state === "doing" ? "a draft" : "not started"}`, `${next.name.hi ?? next.name.en} डेट शीट ${ds.state === "doing" ? "ड्राफ़्ट है" : "शुरू नहीं"}`)), sub: ds.dueLabel ? `${tx(p("Make it final by", "पक्की करें"))} ${ds.dueLabel}` : "", icon: "calendar", tone: "warn", href: `/exam-office/plan?exam=${next.id}` });
    }
    const seat = next.steps.find((s) => s.key === "seating");
    const duty = next.steps.find((s) => s.key === "duties");
    if (seat?.state !== "done" || duty?.state !== "done") {
      needs.push({ title: tx(p("Seating and duties not done", "बैठक और ड्यूटी बाकी")), sub: tx(p("Both fill themselves · about 2 minutes", "दोनों अपने आप भरते हैं · लगभग 2 मिनट")), icon: "grid", tone: "info", href: "/exam-office?view=checklist" });
    }
  }

  return (
    <div className="stack" style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) 320px", gap: 20, alignItems: "start" }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 16, minWidth: 0 }}>
        <div>
          <h2 className="serif" style={{ margin: 0, fontSize: 28 }}>
            {tx(p(`${hello}, ${surname}`, `${helloHi}, ${surname} जी`))}
          </h2>
          <span style={{ color: "var(--mut)" }}>
            {todayLabel}
            {results?.daysToResults !== null && results?.daysToResults !== undefined && results.daysToResults >= 0 ? ` · ${tx(p(`${results.name.en} results are ${results.daysToResults} days away.`, `${results.name.hi ?? results.name.en} परिणाम ${results.daysToResults} दिन में।`))}` : ""}
            {next ? ` ${tx(p(`${next.name.en} setup is ${next.readiness.percent}% ready.`, `${next.name.hi ?? next.name.en} की तैयारी ${next.readiness.percent}% है।`))}` : ""}
          </span>
        </div>

        <div className="g2" style={{ display: "grid", gridTemplateColumns: "repeat(2,minmax(0,1fr))", gap: 14 }}>
          {results ? (
            <Card className="rise" style={{ display: "flex", flexDirection: "column", gap: 12, border: "2px solid var(--pri)" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <Pill tone="ok">{tx(p("Results", "परिणाम"))}</Pill>
                <span style={{ flex: 1 }} />
                {results.daysToResults !== null ? <Pill tone="warn">{results.daysToResults >= 0 ? `${results.daysToResults} ${tx(p("days left", "दिन बाकी"))}` : tx(p("Results day passed", "परिणाम दिवस बीता"))}</Pill> : null}
              </div>
              <div>
                <strong className="serif" style={{ fontSize: 24, display: "block" }}>{tx(results.name)}</strong>
                <span style={{ fontSize: 13, color: "var(--mut)" }}>
                  {results.resultsLabel ? `${results.resultsLabel} · ${tx(p("results go home", "परिणाम घर जाएँगे"))}${results.ptmAt ? ` · PTM ${results.ptmAt}` : ""}` : results.dates}
                </span>
              </div>
              <div style={{ display: "flex", gap: 14, alignItems: "center" }}>
                <Ring value={results.percent} max={100} size={88} stroke={9} tone="var(--pri)">
                  <span style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
                    <strong className="num" style={{ fontSize: 20 }}>{results.percent}%</strong>
                    <span style={{ fontSize: 11, color: "var(--mut)" }}>{tx(p("entered", "भरे"))}</span>
                  </span>
                </Ring>
                <span style={{ flex: 1, display: "flex", flexDirection: "column", gap: 6 }}>
                  <span style={{ fontSize: 13 }}>
                    <strong>{tx(p("Marks entry", "अंक प्रविष्टि"))}</strong> · {tx(p("due", "अंतिम"))} {results.dueLabel ?? "—"}
                  </span>
                  {results.lateCount ? (
                    <Link href="/exam-office?view=late" className="tap" style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", borderRadius: 12, border: "1px solid var(--bad)", color: "var(--bad)", background: "var(--bads)", fontWeight: 600, fontSize: 14 }}>
                      <Ic n="alert" size={16} /> <span style={{ flex: 1 }}>{tx(p(`${results.lateCount} teachers late`, `${results.lateCount} शिक्षक देर से`))}</span> <Ic n="chevRight" size={16} />
                    </Link>
                  ) : null}
                  <span style={{ fontSize: 12, color: "var(--mut)" }}>
                    {results.teachersDone} {tx(p("of", "में से"))} {results.teachersTotal} {tx(p("teachers done", "शिक्षक पूरे"))}
                    {results.daysToDue !== null && results.daysToDue >= 0 ? ` · ${results.daysToDue} ${tx(p("days to the deadline", "दिन बाकी"))}` : ""}
                  </span>
                </span>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {results.bands.map((b) => (
                  <div key={b.key} style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 13 }}>
                    <span style={{ width: 96, color: "var(--mut)" }}>{tx(b.label)}</span>
                    <Progress value={b.percent} max={100} tone={b.percent < 60 ? "var(--warn)" : "var(--c2, var(--info))"} style={{ flex: 1 }} />
                    <strong className="num" style={{ width: 40, textAlign: "right" }}>{b.percent}%</strong>
                  </div>
                ))}
              </div>
              <div style={{ display: "flex", gap: 10 }}>
                {notReminded ? (
                  <Btn variant="pri" icon="send" onClick={onRemind} style={{ flex: 1 }}>
                    {tx(p(`Remind ${notReminded} late`, `${notReminded} को याद दिलाएँ`))}
                  </Btn>
                ) : (
                  <Btn variant="soft" icon="checkCircle" href="/exam-office?view=late" style={{ flex: 1 }}>
                    {tx(p("All reminded", "सबको याद दिलाया"))}
                  </Btn>
                )}
                <Btn variant="sec" icon="award" href="/exam-office/results" style={{ flex: 1 }}>
                  {tx(p("Open results", "परिणाम खोलें"))}
                </Btn>
              </div>
            </Card>
          ) : (
            <Card>
              <EmptyState icon="clipboard" title={tx(p("No exam is being marked", "अभी कोई परीक्षा जाँच में नहीं"))} />
            </Card>
          )}

          {next ? (
            <Card className="rise" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <Pill tone="info">{tx(p("Next exam · setting up", "अगली परीक्षा · तैयारी"))}</Pill>
                <span style={{ flex: 1 }} />
                {next.daysLeft !== null ? <Pill tone="mut">{next.daysLeft} {tx(p("days left", "दिन बाकी"))}</Pill> : null}
              </div>
              <div>
                <strong className="serif" style={{ fontSize: 24, display: "block" }}>{tx(next.name)}</strong>
                <span style={{ fontSize: 13, color: "var(--mut)" }}>{next.dates}</span>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <Progress value={next.readiness.percent} max={100} tone="var(--pri)" style={{ flex: 1 }} />
                <strong style={{ fontSize: 13 }}>{next.readiness.percent}% {tx(p("ready", "तैयार"))}</strong>
              </div>
              <div style={{ display: "flex", flexDirection: "column" }}>
                {next.steps
                  .filter((s) => s.key !== "created" && s.key !== "parents")
                  .map((s) => (
                    <Link key={s.key} href={STEP_WORDS[s.key].href(next.id)} className="tap row" style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 4px", borderTop: "1px solid var(--bd)", color: "inherit", textDecoration: "none" }}>
                      <IconTile icon={s.state === "done" ? "checkCircle" : s.state === "doing" ? "clock" : "calendar"} tone={s.state === "done" ? "ok" : s.state === "doing" ? "warn" : "mut"} size={28} />
                      <span style={{ flex: 1, fontWeight: 600, fontSize: 14 }}>{tx(STEP_WORDS[s.key].title)}</span>
                      <Pill tone={s.state === "done" ? "ok" : s.state === "doing" ? "warn" : "mut"}>
                        {s.state === "done" ? tx(p("Done", "पूरा")) : s.state === "doing" ? (s.progress === "draft" ? tx(p("Draft", "ड्राफ़्ट")) : s.progress) : tx(p("Not started", "शुरू नहीं"))}
                      </Pill>
                    </Link>
                  ))}
              </div>
              <div style={{ display: "flex", gap: 10 }}>
                <Btn variant="pri" icon="list" href="/exam-office?view=checklist" style={{ flex: 1 }}>
                  {tx(p("Open checklist", "चेकलिस्ट खोलें"))}
                </Btn>
                <Btn variant="sec" icon="calendar" href={`/exam-office/plan?exam=${next.id}`} style={{ flex: 1 }}>
                  {tx(p("Open plan", "योजना खोलें"))}
                </Btn>
              </div>
            </Card>
          ) : (
            <Card style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <EmptyState icon="calendar" title={tx(p("No next exam yet", "अगली परीक्षा अभी नहीं बनी"))} action={<Btn variant="pri" icon="plus" href="/exams?view=create">{tx(p("Create exam", "परीक्षा बनाएँ"))}</Btn>} />
            </Card>
          )}
        </div>

        {timeline.length ? (
          <Card style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div style={{ display: "flex", alignItems: "center" }}>
              <strong style={{ flex: 1, fontSize: 16 }}>{tx(p("Exam year", "परीक्षा वर्ष"))}</strong>
              <span style={{ fontSize: 12, color: "var(--mut)" }}>{tx(p("Tap an exam", "किसी परीक्षा पर टैप करें"))}</span>
            </div>
            <div style={{ display: "flex", gap: 8, overflowX: "auto" }} className="hs">
              {timeline.map((t) => {
                const tone: Tone = t.state === "done" ? "ok" : t.state === "now" ? "acc" : t.state === "next" ? "info" : "mut";
                const href = t.state === "now" ? "/exam-office/results" : t.state === "next" ? "/exam-office?view=checklist" : `/exams?exam=${t.id}`;
                return (
                  <Link key={t.id} href={href} className="tap" style={{ flex: "1 0 130px", display: "flex", flexDirection: "column", alignItems: "center", gap: 6, padding: 8, textAlign: "center", color: "inherit", textDecoration: "none" }}>
                    <IconTile icon={t.state === "done" ? "checkCircle" : t.state === "now" ? "clipboard" : t.state === "next" ? "calendar" : "flag"} tone={tone} size={42} />
                    <strong style={{ fontSize: 14 }}>{tx(t.name)}</strong>
                    <span style={{ fontSize: 12, color: "var(--mut)" }}>{t.when}</span>
                    <Pill tone={tone}>{t.state === "done" ? tx(p("Done", "पूरा")) : t.state === "now" ? tx(p("Now", "अभी")) : t.state === "next" ? `${tx(p("Setting up", "तैयारी"))}${next ? ` · ${next.readiness.percent}%` : ""}` : tx(p("Later", "बाद में"))}</Pill>
                  </Link>
                );
              })}
            </div>
          </Card>
        ) : null}

        <SecHead>{tx(p("Quick actions", "जल्दी के काम"))}</SecHead>
        <div className="g4" style={{ display: "grid", gridTemplateColumns: "repeat(4,minmax(0,1fr))", gap: 12 }}>
          {[
            { t: p("Date sheet", "डेट शीट"), icon: "calendar" as IconName, tone: "acc" as Tone, href: next ? `/exam-office/plan?exam=${next.id}` : "/exam-office/plan" },
            { t: p("Seating", "बैठक व्यवस्था"), icon: "grid" as IconName, tone: "info" as Tone, href: next ? `/exam-office/plan?exam=${next.id}&view=seating` : "/exam-office/plan?view=seating" },
            { t: p("Marks tracker", "अंक प्रगति"), icon: "clipboard" as IconName, tone: "warn" as Tone, href: "/exams?view=grid" },
            { t: p("Results", "परिणाम"), icon: "award" as IconName, tone: "ok" as Tone, href: "/exam-office/results" },
          ].map((q) => (
            <Link key={q.t.en} href={q.href} className="card tap lift" style={{ padding: 16, display: "flex", flexDirection: "column", gap: 10, color: "inherit", textDecoration: "none" }}>
              <IconTile icon={q.icon} tone={q.tone} size={40} />
              <strong>{tx(q.t)}</strong>
            </Link>
          ))}
        </div>
      </div>

      <aside style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <Card pad={false} style={{ overflow: "hidden" }}>
          <div style={{ padding: "14px 16px 4px" }}>
            <SecHead>{tx(p("Needs you today", "आज आपके काम"))}</SecHead>
          </div>
          {needs.length === 0 ? <div style={{ padding: "0 16px 16px", color: "var(--mut)", fontSize: 13 }}>{tx(p("Nothing waiting on you.", "आपका कोई काम बाकी नहीं।"))}</div> : null}
          {needs.map((n) => (
            <Link key={n.title} href={n.href} className="tap row" style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 16px", borderTop: "1px solid var(--bd)", color: "inherit", textDecoration: "none" }}>
              <IconTile icon={n.icon} tone={n.tone} size={36} />
              <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
                <strong style={{ fontSize: 14 }}>{n.title}</strong>
                <span style={{ fontSize: 12, color: "var(--mut)" }}>{n.sub}</span>
              </span>
              <Ic n="chevRight" size={16} />
            </Link>
          ))}
        </Card>
        <Card style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <SecHead>{tx(p("Recent · who did what", "हाल में · किसने क्या किया"))}</SecHead>
          {activity.length === 0 ? <span style={{ fontSize: 13, color: "var(--mut)" }}>{tx(p("Nothing yet.", "अभी कुछ नहीं।"))}</span> : null}
          {activity.map((a) => (
            <div key={a.id} style={{ display: "flex", gap: 10, fontSize: 13 }}>
              <span style={{ width: 9, height: 9, borderRadius: 5, marginTop: 5, flex: "none", background: a.kind === "locked" ? "var(--ok)" : a.kind === "reminded" ? "var(--warn)" : a.kind === "submitted" ? "var(--acc)" : "var(--info)" }} />
              <span style={{ flex: 1 }}>{tx(a.text)}</span>
              <span style={{ color: "var(--mut)", whiteSpace: "nowrap" }}>{ago(a.at)}</span>
            </div>
          ))}
        </Card>
      </aside>
    </div>
  );
}

/* ------------------------------------------------------------- menu */

function MenuView({ staffName, sessionLabel, results, next, teachers }: { staffName: string; sessionLabel: string; results: ResultsExamView | null; next: NextExamView | null; teachers: TeacherRowView[] }) {
  const { tx, sub } = useVx();
  const tiles: { t: Pair; s: string; icon: IconName; tone: Tone; href: string; bad?: boolean }[] = [
    { t: p("Date sheet & seating", "डेट शीट और बैठक"), s: next ? `${tx(next.name)} · ${next.readiness.percent}% ${tx(p("ready", "तैयार"))}` : "", icon: "calendar", tone: "acc", href: "/exam-office/plan" },
    { t: p("Marks tracker", "अंक प्रगति"), s: results ? `${tx(results.name)} · ${results.percent}% ${tx(p("entered", "भरे"))} · ${results.lateCount} ${tx(p("late", "देर"))}` : "", icon: "clipboard", tone: "warn", href: "/exams?view=grid" },
    { t: p("Results & report cards", "परिणाम व प्रगति पत्र"), s: results?.resultsLabel ? `${tx(p("Results day", "परिणाम दिवस"))} ${results.resultsLabel}` : "", icon: "award", tone: "ok", href: "/exam-office/results" },
    { t: p("Calendar", "कैलेंडर"), s: tx(p("Holidays, PTM and exam days", "छुट्टियाँ, PTM और परीक्षा दिवस")), icon: "calendar", tone: "info", href: "/calendar" },
    { t: p("Notices", "सूचनाएँ"), s: tx(p("Send a notice to staff or parents", "स्टाफ़ या अभिभावकों को सूचना")), icon: "megaphone", tone: "mut", href: "/messages" },
    { t: p("Account & sign out", "खाता व साइन आउट"), s: tx(p("Language, password, sign out", "भाषा, पासवर्ड, साइन आउट")), icon: "logout", tone: "bad", href: "/menu", bad: true },
  ];
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14, maxWidth: 860 }}>
      <Card style={{ display: "flex", alignItems: "center", gap: 14 }}>
        <Avatar text={initials(staffName)} bg={avatarColor(staffName)} size={56} />
        <span style={{ display: "flex", flexDirection: "column" }}>
          <strong className="serif" style={{ fontSize: 22 }}>{staffName}</strong>
          <span style={{ fontSize: 13, color: "var(--mut)" }}>
            {tx(p("Exam coordinator", "परीक्षा प्रभारी"))} · {tx(p("Session", "सत्र"))} {sessionLabel}
          </span>
        </span>
      </Card>
      <div className="g3" style={{ display: "grid", gridTemplateColumns: "repeat(3,minmax(0,1fr))", gap: 12 }}>
        {tiles.map((q) => (
          <Link key={q.t.en} href={q.href} className="card tap lift" style={{ padding: 16, display: "flex", flexDirection: "column", gap: 8, color: q.bad ? "var(--bad)" : "inherit", textDecoration: "none" }}>
            <IconTile icon={q.icon} tone={q.tone} size={44} />
            <strong style={{ fontSize: 17 }}>{tx(q.t)}</strong>
            {sub(q.t) ? <span style={{ fontSize: 12, color: "var(--mut)" }}>{sub(q.t)}</span> : null}
            <span style={{ fontSize: 13, color: "var(--mut)" }}>{q.s}</span>
          </Link>
        ))}
      </div>
      <Card pad={false} style={{ overflow: "hidden" }}>
        {[
          { t: p("Next exam checklist", "अगली परीक्षा चेकलिस्ट"), s: next ? `${next.readiness.percent}% ${tx(p("ready", "तैयार"))} · ${next.readiness.done} ${tx(p("of", "में से"))} ${next.steps.length} ${tx(p("steps done", "कदम पूरे"))}` : "", icon: "list" as IconName, tone: "info" as Tone, href: "/exam-office?view=checklist" },
          { t: p("Late teachers", "देर वाले शिक्षक"), s: `${teachers.length} ${tx(p("not finished", "बाकी"))} · ${teachers.filter((t) => !t.remindedAt).length} ${tx(p("not reminded", "को याद नहीं दिलाया"))}`, icon: "alert" as IconName, tone: "bad" as Tone, href: "/exam-office?view=late" },
        ].map((r) => (
          <Link key={r.t.en} href={r.href} className="tap row" style={{ display: "flex", alignItems: "center", gap: 12, padding: "14px 16px", borderTop: "1px solid var(--bd)", color: "inherit", textDecoration: "none" }}>
            <IconTile icon={r.icon} tone={r.tone} size={36} />
            <span style={{ flex: 1, display: "flex", flexDirection: "column" }}>
              <strong>{tx(r.t)}</strong>
              <span style={{ fontSize: 12, color: "var(--mut)" }}>{r.s}</span>
            </span>
            <Ic n="chevRight" size={16} />
          </Link>
        ))}
      </Card>
    </div>
  );
}
