"use client";

import Link from "@/vx/ui/link";
import { useRouter } from "next/navigation";
import { useState, useTransition, type CSSProperties, type ReactNode } from "react";

import { logoutAction } from "@/app/login/actions";
import { useVx } from "@/vx/i18n";
import { Ic, type IconName } from "@/vx/icons";
import { clock, initials, shortDay } from "@/vx/format";
import { p, type Pair } from "@/vx/text";
import { Seg } from "@/vx/ui/controls";
import { useToast } from "@/vx/ui/overlays";
import { VxPage } from "@/vx/ui/page";
import { EmptyState } from "@/vx/ui/primitives";

import type { SetupKey, SetupStep } from "./domain/office";
import { DRing, HelpSheet, OfficeTop, toneAvatar, type HelpContent } from "./office-ui";
import { RemindSheet, type TeacherRowView } from "./remind";
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

export type TimelineItem = {
  id: string;
  name: Pair;
  when: string;
  state: "done" | "now" | "next" | "later";
  /** "4 Aug": the day a finished exam's results went out. */
  doneOn?: string | null;
  /** "17 Oct": results day of the exam being marked. */
  resultsOn?: string | null;
};

export type ActivityItem = { id: string; text: Pair; at: string; kind: string };

const STEP_WORDS: Record<SetupKey, { title: Pair; open: Pair; href: (examId: string) => string }> = {
  created: { title: p("Exam created", "परीक्षा बनी"), open: p("See on calendar", "कैलेंडर पर देखें"), href: () => "/calendar" },
  datesheet: { title: p("Date sheet", "डेट शीट"), open: p("Open date sheet", "डेट शीट खोलें"), href: (id) => `/exam-office/plan?exam=${id}` },
  parents: { title: p("Tell parents the dates", "अभिभावकों को तिथियाँ बताएँ"), open: p("Open publish", "प्रकाशन खोलें"), href: (id) => `/exam-office/plan?exam=${id}&view=publish` },
  seating: { title: p("Seating", "बैठक व्यवस्था"), open: p("Open seating", "बैठक खोलें"), href: (id) => `/exam-office/plan?exam=${id}&view=seating` },
  duties: { title: p("Invigilation duties", "निरीक्षण ड्यूटी"), open: p("Open duties", "ड्यूटी खोलें"), href: (id) => `/exam-office/plan?exam=${id}&view=duties` },
  papers: { title: p("Question papers", "प्रश्न पत्र"), open: p("Open papers", "प्रश्न पत्र खोलें"), href: (id) => `/exam-office/plan?exam=${id}&view=papers` },
  admit: { title: p("Admit slips", "प्रवेश पर्ची"), open: p("Open admit slips", "प्रवेश पर्ची खोलें"), href: (id) => `/exam-office/plan?exam=${id}&view=seating` },
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

const V = (name: string) => `var(--${name})`;

/** The look of a setup step: its pill, its icon and its tones. */
function stepLook(s: SetupStep, papersOf: string): { bg: string; fg: string; label: Pair; icon: IconName; k: SetupStep["state"] } {
  if (s.state === "done") return { k: "done", bg: V("oks"), fg: V("ok"), label: p("Done", "पूरा"), icon: "checkCircle" };
  if (s.state === "doing") return { k: "doing", bg: V("warns"), fg: V("warnfg"), label: s.progress === "draft" ? p("Draft", "कच्चा") : s.key === "papers" ? p(papersOf, papersOf) : p(s.progress ?? "", s.progress ?? ""), icon: "clock" };
  return { k: "todo", bg: V("s2"), fg: V("mut"), label: p("Not started", "शुरू नहीं"), icon: "calendar" };
}

/** "UT2" for "Unit Test 2", as the design shortens it. */
function shortName(name: Pair): Pair {
  return { en: name.en.replace(/^unit test\s*(\d+)/i, "UT$1").replace(/^annual exam/i, "Annual"), hi: name.hi };
}

function dayText(at: string): string {
  return shortDay(at).replace(",", "").replace("Sept", "Sep");
}

/** Which school day an instant falls on: 0 today, 1 yesterday, 2 earlier. */
function daysAgo(at: string): 0 | 1 | 2 {
  const key = (x: Date) => x.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
  const today = new Date();
  const d = new Date(at);
  if (key(d) === key(today)) return 0;
  if (key(d) === key(new Date(today.getTime() - 86_400_000))) return 1;
  return 2;
}

/** "8:12", or "9:30 pm" after noon. */
function timeText(at: string): string {
  const [h, m] = clock(at).split(":").map(Number);
  return h >= 12 ? `${h === 12 ? 12 : h - 12}:${String(m).padStart(2, "0")} pm` : `${h}:${String(m).padStart(2, "0")}`;
}

/** "9:40" today, "Yest." yesterday, "Mon 5 Oct" before that. */
function whenText(at: string, tx: (pair: Pair) => string): string {
  const ago = daysAgo(at);
  if (ago === 0) return clock(at).replace(/^0/, "");
  if (ago === 1) return tx(p("Yest.", "कल"));
  return dayText(at);
}

/** "Opened the link today 8:12", "Never opened · link sent Fri 18 Sep". */
function seenText(t: TeacherRowView, tx: (pair: Pair) => string): string {
  if (t.link?.openedAt) {
    const at = t.link.openedAt;
    const ago = daysAgo(at);
    const when = ago === 0 ? `${tx(p("today", "आज"))} ${timeText(at)}` : ago === 1 ? `${tx(p("yesterday", "कल"))} ${timeText(at)}` : dayText(at);
    return `${tx(p("Opened the link", "लिंक खोला"))} ${when}`;
  }
  if (t.link) return `${tx(p("Never opened · link sent", "कभी नहीं खोला · लिंक भेजा"))} ${dayText(t.link.createdAt)}`;
  return tx(p("Never opened · a link is made when you remind", "कभी नहीं खोला · याद दिलाते समय लिंक बनेगा"));
}

const LOG_DOT: Record<string, string> = {
  locked: V("ok"),
  cards: V("ok"),
  results: V("ok"),
  submitted: V("acc"),
  marks: V("acc"),
  correction: V("acc"),
  reminded: V("warn"),
  call: V("info"),
  papers: V("info"),
  moderation: V("info"),
  grace: V("info"),
};

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
  staffPhone,
  officeLinks,
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
  /** The coordinator's own number, masked, for the menu card. */
  staffPhone?: string | null;
  officeLinks?: ReactNode;
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
  const [helpOpen, setHelpOpen] = useState(false);

  const crumb = `${tx(p("Exams", "परीक्षा"))} · ${tx(p("Session", "सत्र"))} ${sessionLabel}`;
  const remindAll = () => setRemindIds((notReminded.length ? notReminded : teachers).map((t) => t.id));
  const dueLabel = results?.dueLabel ?? "—";
  const papersOf = next ? tx(p(`${next.papersReceived} of ${next.slots}`, `${next.slots} में से ${next.papersReceived}`)) : "";

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
    remind: `${teachers.length} ${tx(p("not finished", "बाकी"))}${results?.dueLabel ? ` · ${tx(p("due", "अंतिम"))} ${results.dueLabel}` : ""}`,
  };

  const help: HelpContent =
    view === "checklist"
      ? {
          title: tx(titles.checklist),
          steps: [
            { icon: "list", title: tx(p("Steps in order", "क्रम से कदम")), body: tx(p("Each step shows who does it and by when.", "हर कदम में कौन और कब तक लिखा है।")) },
            { icon: "arrowRight", title: tx(p("Open the right place", "सही जगह खोलें")), body: tx(p("The button on each step takes you straight there.", "हर कदम का बटन सीधे वहाँ ले जाता है।")) },
            { icon: "checkCircle", title: tx(p("Tick when done", "पूरा होने पर टिक करें")), body: tx(p("Most steps tick themselves. You can undo a tick.", "ज़्यादातर कदम अपने आप टिक होते हैं। टिक वापस भी ले सकते हैं।")) },
          ],
        }
      : view === "late" || view === "remind"
        ? {
            title: tx(titles.late),
            steps: [
              { icon: "users", title: tx(p("Who is behind", "कौन पीछे है")), body: tx(p("Teachers with marks still missing, least done first.", "जिनके अंक बाकी हैं, सबसे कम वाले पहले।")) },
              { icon: "send", title: tx(p("Remind on WhatsApp", "WhatsApp पर याद दिलाएँ")), body: tx(p("The message is Hindi first and carries the teacher's own marks link.", "संदेश पहले हिंदी में, शिक्षक के अपने अंक लिंक के साथ।")) },
              { icon: "phone", title: tx(p("Or call", "या फ़ोन करें")), body: tx(p("Pick how the call went so everyone can see it.", "फ़ोन का नतीजा चुनें ताकि सबको दिखे।")) },
            ],
          }
        : view === "menu"
          ? {
              title: tx(titles.menu),
              steps: [
                { icon: "grid", title: tx(p("Big tiles", "बड़ी टाइलें")), body: tx(p("Each tile opens one part of your work.", "हर टाइल आपके काम का एक हिस्सा खोलती है।")) },
                { icon: "globe", title: "EN | हि", body: tx(p("Switch the main words to Hindi from the top bar.", "ऊपर की पट्टी से मुख्य शब्द हिंदी में बदलें।")) },
                { icon: "logout", title: tx(p("Sign out", "साइन आउट")), body: tx(p("Use it on a shared phone or computer.", "साझा फ़ोन या कंप्यूटर पर इसका प्रयोग करें।")) },
              ],
            }
          : {
              title: tx(p("Your day", "आपका दिन")),
              steps: [
                { icon: "award", title: tx(p("Two big jobs", "दो बड़े काम")), body: tx(p("Results for the exam just sat, and setting up the next one. Each has its own card.", "अभी हुई परीक्षा का परिणाम, और अगली की तैयारी। दोनों का अपना कार्ड है।")) },
                { icon: "send", title: tx(p("Late teachers", "देर वाले शिक्षक")), body: tx(p("One tap reminds them on WhatsApp with their own marks link.", "एक टैप में उनके अंक लिंक के साथ WhatsApp पर याद।")) },
                { icon: "grid", title: tx(p("Quick actions", "जल्दी के काम")), body: tx(p("Date sheet, seating, marks and results are one tap away.", "डेट शीट, बैठक, अंक और परिणाम एक टैप पर।")) },
              ],
            };

  const back = view === "checklist" || view === "late" || view === "remind" ? "/exam-office" : undefined;
  const actions =
    view === "home" ? (
      <>
        <Link href="/exam-office?view=menu" className="tap btn sec">
          <Ic n="grid" size={18} />
          {tx(p("All tools", "सभी काम"))}
        </Link>
        {results && notReminded.length ? (
          <button type="button" className="tap btn pri" onClick={remindAll}>
            <Ic n="send" size={18} />
            {tx(p(`Remind ${notReminded.length} late teachers`, `${notReminded.length} शिक्षकों को याद दिलाएँ`))}
          </button>
        ) : null}
      </>
    ) : null;

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
    body = <MenuView staffName={staffName} staffPhone={staffPhone ?? null} sessionLabel={sessionLabel} results={results} next={next} teachers={teachers} onHelp={() => setHelpOpen(true)} />;
  } else if (view === "checklist") {
    body = !next ? (
      <div className="pad xsc" style={{ maxWidth: 980 }}>
        <div className="card">
          <EmptyState icon="calendar" title={tx(p("No exam to set up", "तैयारी के लिए कोई परीक्षा नहीं"))} body={tx(p("Create the next exam from the marks tracker.", "अगली परीक्षा अंक ट्रैकर से बनाएँ।"))} action={<Link href="/exams?view=create" className="tap btn pri"><Ic n="plus" size={18} />{tx(p("Create exam", "परीक्षा बनाएँ"))}</Link>} />
        </div>
      </div>
    ) : (
      <Checklist next={next} staffName={staffName} filter={filter} setFilter={setFilter} papersOf={papersOf} pending={pending} tick={tick} />
    );
  } else if (view === "late" || view === "remind") {
    body = !results ? (
      <div className="pad xsc" style={{ maxWidth: 1080 }}>
        <div className="card">
          <EmptyState icon="clipboard" title={tx(p("No exam is open for marks", "कोई परीक्षा अंकों के लिए खुली नहीं"))} />
        </div>
      </div>
    ) : (
      <div className="pad xsc" style={{ maxWidth: 1080 }}>
        <div className="card xr xw xp2" style={{ gap: "16px 22px" }}>
          <DRing value={results.percent} size={96} tone="var(--acc)">
            <span className="num xb" style={{ fontSize: 22, lineHeight: 1 }}>{results.percent}%</span>
            <span className="xm x11">{tx(p("entered", "भरे"))}</span>
          </DRing>
          <div className="xc x4 xf" style={{ minWidth: 220 }}>
            <h2 className="xh">{teachers.length === 0 ? tx(p("Everyone has finished", "सबने अंक भर दिए")) : tx(p(`${teachers.length} teachers have not finished`, `${teachers.length} शिक्षकों के अंक बाकी हैं`))}</h2>
            <span className="xm" style={{ lineHeight: 1.5 }}>
              {tx(p(`${results.name.en} marks are due ${dueLabel}`, `${results.name.hi ?? results.name.en} के अंक ${dueLabel} तक`))}
              {results.daysToDue !== null ? ` (${results.daysToDue >= 0 ? `${results.daysToDue} ${tx(p("days", "दिन"))}` : tx(p("overdue", "देर"))})` : ""}.
              {results.resultsLabel ? ` ${tx(p(`Results go home ${results.resultsLabel}.`, `परिणाम ${results.resultsLabel} को घर जाएँगे।`))}` : ""}{" "}
              {tx(p("Each reminder carries the teacher's own Sampark link — no login needed.", "हर रिमाइंडर में शिक्षक का अपना संपर्क लिंक होता है — लॉगिन नहीं चाहिए।"))}
            </span>
          </div>
          {teachers.length ? (
            <button type="button" className={`tap btn ${notReminded.length ? "pri" : "soft"} mfull`} onClick={remindAll} style={{ height: 48 }}>
              <Ic n={notReminded.length ? "send" : "checkCircle"} size={18} />
              {notReminded.length === teachers.length
                ? tx(p(`Remind all ${teachers.length} on WhatsApp`, `सभी ${teachers.length} को WhatsApp पर याद दिलाएँ`))
                : notReminded.length
                  ? tx(p(`Remind the other ${notReminded.length}`, `बाकी ${notReminded.length} को याद दिलाएँ`))
                  : tx(p("All reminded · remind again", "सबको याद दिलाया · फिर से"))}
            </button>
          ) : null}
        </div>
        {teachers.length ? (
          <div className="card xoh">
            <div className="only-d xsr xbb" style={{ minHeight: 42, padding: "0 18px", background: "var(--s2)" }}>
              <span />
              <span className="sech">{tx(p("Teacher · classes", "शिक्षक · कक्षाएँ"))}</span>
              <span className="sech">{tx(p("Entered", "भरे"))}</span>
              <span className="sech xtr">{tx(p("Actions", "काम"))}</span>
            </div>
            <div className="xst">
              {teachers.map((t) => (
                <LateRow
                  key={t.id}
                  t={t}
                  callTag={calls[t.id] ? `${tx(p("Called", "फ़ोन किया"))} · ${calls[t.id]}` : null}
                  callOpen={callOpen === t.id}
                  onCall={() => setCallOpen(callOpen === t.id ? null : t.id)}
                  onRemind={() => setRemindIds([t.id])}
                  onOutcome={(key, label) => pickCall(t, key, label)}
                />
              ))}
            </div>
          </div>
        ) : (
          <div className="card">
            <EmptyState icon="checkCircle" title={tx(p("Nobody is behind", "कोई पीछे नहीं"))} />
          </div>
        )}
        {results.teachersTotal ? (
          <span className="xm">{tx(p(`Teachers who finished: ${results.teachersDone} of ${results.teachersTotal}. Their names are in the Marks tracker.`, `जिन्होंने पूरा किया: ${results.teachersTotal} में से ${results.teachersDone}। उनके नाम अंक ट्रैकर में हैं।`))}</span>
        ) : null}
      </div>
    );
  } else {
    body = <HomeBody hello={hello} staffName={staffName} sessionLabel={sessionLabel} todayLabel={todayLabel} results={results} next={next} teachers={teachers} notReminded={notReminded.length} timeline={timeline} activity={activity} papersOf={papersOf} onRemind={remindAll} />;
  }

  return (
    <VxPage className="eoh">
      <OfficeTop crumb={crumb} title={tx(titles[view])} mSub={mSub[view]} back={back} logo={view === "home" || view === "menu"} lang help={help} actions={actions} />
      <main>{officeLinks ? <div style={{ padding: "16px 20px 0" }}>{officeLinks}</div> : null}{body}</main>
      <HelpSheet open={helpOpen} onClose={() => setHelpOpen(false)} help={help} />
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
  sessionLabel,
  todayLabel,
  results,
  next,
  teachers,
  notReminded,
  timeline,
  activity,
  papersOf,
  onRemind,
}: {
  hello: string;
  staffName: string;
  sessionLabel: string;
  todayLabel: string;
  results: ResultsExamView | null;
  next: NextExamView | null;
  teachers: TeacherRowView[];
  notReminded: number;
  timeline: TimelineItem[];
  activity: ActivityItem[];
  papersOf: string;
  onRemind: () => void;
}) {
  const { tx, sub } = useVx();
  const honorific = staffName.match(/^(Mr|Ms|Mrs|Dr)\.?\s+/i)?.[1];
  const surname = staffName.split(/\s+/).slice(-1)[0] ?? staffName;
  const nameEn = honorific && surname ? `${honorific}. ${surname}` : surname;
  const helloHi = hello === "Good morning" ? "सुप्रभात" : hello === "Good afternoon" ? "नमस्ते" : "शुभ संध्या";

  const needs: { title: string; sub: string; icon: IconName; bg: string; fg: string; href: string }[] = [];
  if (results && teachers.length) {
    needs.push({ title: tx(p(`${teachers.length} teachers not finished`, `${teachers.length} शिक्षकों के अंक बाकी`)), sub: tx(p(`${results.name.en} marks · due ${results.dueLabel ?? "—"}`, `${results.name.hi ?? results.name.en} अंक · अंतिम ${results.dueLabel ?? "—"}`)), icon: "alert", bg: V("bads"), fg: V("bad"), href: "/exam-office?view=late" });
  }
  if (next) {
    const short = shortName(next.name);
    const ds = next.steps.find((s) => s.key === "datesheet");
    const tell = next.steps.find((s) => s.key === "parents");
    if (ds && ds.state !== "done") {
      needs.push({ title: tx(p(`${short.en} date sheet is ${ds.state === "doing" ? "a draft" : "not started"}`, `${short.hi ?? short.en} डेट शीट ${ds.state === "doing" ? "अभी कच्ची है" : "शुरू नहीं"}`)), sub: ds.dueLabel ? tx(p(`Make it final by ${ds.dueLabel}`, `${ds.dueLabel} तक पक्की करें`)) : "", icon: "calendar", bg: V("warns"), fg: V("warnfg"), href: "/exam-office?view=checklist" });
    } else if (ds && tell && tell.state !== "done") {
      needs.push({ title: tx(p(`${short.en} date sheet is final`, `${short.hi ?? short.en} डेट शीट पक्की है`)), sub: tx(p("Next: tell parents the dates", "अगला: अभिभावकों को तिथियाँ बताएँ")), icon: "checkCircle", bg: V("oks"), fg: V("ok"), href: "/exam-office?view=checklist" });
    }
    const seat = next.steps.find((s) => s.key === "seating");
    const duty = next.steps.find((s) => s.key === "duties");
    if (seat?.state !== "done" || duty?.state !== "done") {
      const neither = seat?.state === "todo" && duty?.state === "todo";
      needs.push({ title: tx(neither ? p("Seating and duties not started", "बैठक और ड्यूटी शुरू नहीं") : p("Seating and duties not done", "बैठक और ड्यूटी बाकी")), sub: tx(p("Both fill themselves · about 2 minutes", "दोनों अपने आप भरते हैं · लगभग 2 मिनट")), icon: "grid", bg: V("infos"), fg: V("info"), href: "/exam-office?view=checklist" });
    }
  }

  const resultsSoon = results?.daysToResults !== null && results?.daysToResults !== undefined && results.daysToResults >= 0;
  const helloSub = [
    todayLabel,
    resultsSoon && results ? tx(p(`${results.name.en} results are ${results.daysToResults} days away.`, `${results.name.hi ?? results.name.en} परिणाम ${results.daysToResults} दिन में।`)) : "",
  ]
    .filter(Boolean)
    .join(" · ");
  const setupLine = next ? tx(next.readiness.percent > 0 ? p(`${next.name.en} setup has started.`, `${next.name.hi ?? next.name.en} की तैयारी शुरू हो गई है।`) : p(`${next.name.en} setup has not started.`, `${next.name.hi ?? next.name.en} की तैयारी शुरू नहीं हुई।`)) : "";

  const nowIdx = timeline.findIndex((t) => t.state === "now");
  const lastDone = timeline.map((t) => t.state).lastIndexOf("done");
  const reach = nowIdx >= 0 ? nowIdx : lastDone;
  const tlFill = timeline.length > 1 && reach >= 0 ? `${Math.min(100, (reach / (timeline.length - 1)) * 100 + 1)}%` : "0%";
  const edge = timeline.length ? `${50 / timeline.length}%` : "12.5%";
  const yearTitle = `${tx(p("Exam year", "परीक्षा वर्ष"))} ${sessionLabel}`;

  const stagesNow = results && results.percent >= 100 ? 1 : 0;
  const stages: Pair[] = [
    p("Marks entry", "अंक भरना"),
    p("Check & moderate", "जाँच व मॉडरेशन"),
    p("Lock · report cards", "लॉक · प्रगति पत्र"),
    results?.resultsLabel ? p(`${results.ptmAt ? "PTM" : "Results"} · ${results.resultsLabel.split(" ").slice(0, 2).join(" ")}`, `${results.ptmAt ? "PTM" : "परिणाम"} · ${results.resultsLabel.split(" ").slice(0, 2).join(" ")}`) : p("Results day", "परिणाम दिवस"),
  ];

  const quick: { t: Pair; icon: IconName; bg: string; fg: string; href: string }[] = [
    { t: p("Date sheet", "डेट शीट"), icon: "calendar", bg: V("accs"), fg: V("accfg"), href: next ? `/exam-office/plan?exam=${next.id}` : "/exam-office/plan" },
    { t: p("Seating", "बैठक व्यवस्था"), icon: "grid", bg: V("infos"), fg: V("info"), href: next ? `/exam-office/plan?exam=${next.id}&view=seating` : "/exam-office/plan?view=seating" },
    { t: p("Marks tracker", "अंक प्रगति"), icon: "clipboard", bg: V("warns"), fg: V("warnfg"), href: "/exams?view=grid" },
    { t: p("Results", "परिणाम"), icon: "award", bg: V("oks"), fg: V("ok"), href: "/exam-office/results" },
  ];

  return (
    <div className="pad stack xgd" style={{ padding: "20px 28px 40px", gridTemplateColumns: "minmax(0,1fr) 320px", gap: 20, alignItems: "start" }}>
      <section className="xc x16 xn0">
        <div className="xc" style={{ gap: 2 }}>
          <h2 className="serif" style={{ margin: 0, fontSize: 26, fontWeight: 600, lineHeight: 1.15 }}>
            {tx(p(`${hello}, ${nameEn}`, `${helloHi}, ${surname} जी`))}
          </h2>
          <span className="xm xs">
            {helloSub}
            {setupLine ? ` ${setupLine}` : ""}
          </span>
        </div>

        <div className="stack xgd" style={{ gridTemplateColumns: "repeat(2,minmax(0,1fr))", gap: 14, alignItems: "stretch" }}>
          {results ? (
            <div className="card xc xhero" style={{ borderColor: "var(--acc)", boxShadow: "var(--shh)" }}>
              <div className="xr xj x8">
                <span className="pill" style={{ background: "var(--accs)", color: "var(--accfg)" }}>
                  <span className="xdt" style={{ background: "var(--acc)", animation: "xPulse 1.8s ease infinite" }} />
                  {tx(p(`${results.name.en} results`, `${results.name.hi ?? results.name.en} परिणाम`))}
                </span>
                {results.daysToResults !== null ? (
                  <span className="pill num" style={{ height: 26, padding: "0 10px", fontSize: 12, background: "var(--warns)", color: "var(--warnfg)" }}>
                    {results.daysToResults >= 0 ? tx(p(`${results.daysToResults} days left`, `${results.daysToResults} दिन बाकी`)) : tx(p("Results day passed", "परिणाम दिवस बीता"))}
                  </span>
                ) : null}
              </div>
              <span className="xc" style={{ gap: 2 }}>
                <span className="serif" style={{ fontSize: 24, fontWeight: 600, lineHeight: 1.15 }}>{tx(p(`${results.name.en} results`, `${results.name.hi ?? results.name.en} परिणाम`))}</span>
                <span className="xm">
                  {results.resultsLabel
                    ? `${results.resultsLabel} · ${tx(results.ptmAt ? p("results go home at the PTM", "परिणाम PTM में घर जाएँगे") : p("results go home", "परिणाम घर जाएँगे"))}`
                    : results.dates}
                </span>
              </span>
              <div className="xr x14">
                <DRing value={results.percent} size={96} tone="var(--acc)">
                  <span className="num xb" style={{ fontSize: 22, lineHeight: 1 }}>{results.percent}%</span>
                  <span className="xm x11">{tx(p("entered", "भरे"))}</span>
                </DRing>
                <div className="xc x6 xf">
                  <span className="xs">
                    <b>{tx(p("Marks entry", "अंक भरना"))}</b> · {tx(p("due", "अंतिम"))} {results.dueLabel ?? "—"}
                  </span>
                  {results.lateCount ? (
                    <Link href="/exam-office?view=late" className="tap xr x8 xw1" style={{ height: 40, padding: "0 12px", borderRadius: 12, border: "1px solid var(--bad)", background: "var(--bads)", color: "var(--bad)", fontSize: 13, fontWeight: 700, textAlign: "left" }}>
                      <Ic n="alert" size={16} />
                      <span className="xf">{tx(p(`${results.lateCount} teachers late`, `${results.lateCount} शिक्षक देर से`))}{notReminded < teachers.length ? tx(p(" · reminded", " · याद दिलाया")) : ""}</span>
                      <Ic n="chevRight" size={16} />
                    </Link>
                  ) : null}
                  <span className="xm">
                    {tx(p(`${results.teachersDone} of ${results.teachersTotal} teachers done`, `${results.teachersTotal} में से ${results.teachersDone} शिक्षक पूरे`))}
                    {results.daysToDue !== null && results.daysToDue >= 0 ? ` · ${tx(p(`${results.daysToDue} days to the deadline`, `अंतिम तिथि में ${results.daysToDue} दिन`))}` : ""}
                  </span>
                </div>
              </div>
              {results.bands.length ? (
                <div className="xc x4">
                  {results.bands.map((b) => (
                    <div key={b.key} className="xgd xs" style={{ gridTemplateColumns: "96px minmax(0,1fr) 38px", gap: 10, alignItems: "center" }}>
                      <span className="xm xe">{tx(b.label)}</span>
                      <span className="xbar" style={{ height: 6 }}>
                        <span style={{ width: `${b.percent}%`, background: b.percent < 60 ? "var(--c3)" : "var(--c2)", transformOrigin: "left", animation: "xGrowX .7s var(--ease) both" }} />
                      </span>
                      <span className="num xb xs xtr">{b.percent}%</span>
                    </div>
                  ))}
                </div>
              ) : null}
              <div className="xstep">
                {stages.map((s, i) => (
                  <span key={s.en} style={{ color: i === stagesNow ? "var(--fg)" : "var(--mut)" }}>
                    <i style={{ background: i === stagesNow && stagesNow === 0 ? `linear-gradient(90deg, var(--acc) ${results.percent}%, var(--s3) ${results.percent}%)` : i < stagesNow ? "var(--acc)" : "var(--s3)" }} />
                    {tx(s)}
                  </span>
                ))}
              </div>
              <div className="xgd" style={{ gridTemplateColumns: "minmax(0,1.3fr) minmax(0,1fr)", gap: 8, marginTop: "auto" }}>
                {notReminded ? (
                  <button type="button" className="tap btn pri" onClick={onRemind} style={{ height: 46 }}>
                    <Ic n="send" size={18} />
                    {tx(p(`Remind ${notReminded} late`, `${notReminded} को याद दिलाएँ`))}
                  </button>
                ) : (
                  <Link href="/exam-office?view=late" className="tap btn soft" style={{ height: 46 }}>
                    <Ic n="checkCircle" size={18} />
                    {tx(p("All reminded", "सबको याद दिलाया"))}
                  </Link>
                )}
                <Link href="/exam-office/results" className="tap btn sec xw1" style={{ height: 46 }}>
                  <Ic n="award" size={18} />
                  {tx(p("Open results", "परिणाम खोलें"))}
                </Link>
              </div>
            </div>
          ) : (
            <div className="card xc xhero">
              <EmptyState icon="clipboard" title={tx(p("No exam is being marked", "अभी कोई परीक्षा जाँच में नहीं"))} />
            </div>
          )}

          {next ? (
            <div className="card xc xhero" style={{ animationDelay: ".08s" }}>
              <div className="xr xj x8">
                <span className="pill" style={{ background: "var(--infos)", color: "var(--info)" }}>{tx(p("Next exam · setting up", "अगली परीक्षा · तैयारी"))}</span>
                {next.daysLeft !== null ? (
                  <span className="pill num" style={{ height: 26, padding: "0 10px", fontSize: 12, background: "var(--s2)", color: "var(--fg)" }}>
                    {tx(p(`${next.daysLeft} days left`, `${next.daysLeft} दिन बाकी`))}
                  </span>
                ) : null}
              </div>
              <span className="xc" style={{ gap: 2 }}>
                <span className="serif" style={{ fontSize: 24, fontWeight: 600, lineHeight: 1.15 }}>{tx(next.name)}</span>
                <span className="xm">{next.dates}</span>
              </span>
              <div className="xr x12">
                <div className="xbar xf" style={{ height: 10 }}>
                  <span style={{ width: `${next.readiness.percent}%`, background: "var(--info)" }} />
                </div>
                <span className="num xb xs">{tx(p(`${next.readiness.percent}% ready`, `${next.readiness.percent}% तैयार`))}</span>
              </div>
              <div className="xc">
                {next.steps
                  .filter((s) => s.key !== "created" && s.key !== "parents")
                  .map((s) => {
                    const look = stepLook(s, papersOf);
                    return (
                      <Link key={s.key} href={STEP_WORDS[s.key].href(next.id)} className="tap row xr x10 xd xrl" style={{ minHeight: 44, padding: "0 4px", borderRadius: 10 }}>
                        <span className="xi" style={{ width: 28, height: 28, borderRadius: 14, background: look.bg, color: look.fg }}>
                          <Ic n={look.icon} size={14} />
                        </span>
                        <span className="xf x6w xs xe">{tx(STEP_WORDS[s.key].title)}</span>
                        <span className="pill" style={{ background: look.bg, color: look.fg }}>{tx(look.label)}</span>
                      </Link>
                    );
                  })}
              </div>
              <div className="xgd" style={{ gridTemplateColumns: "minmax(0,1.3fr) minmax(0,1fr)", gap: 8, marginTop: "auto" }}>
                <Link href="/exam-office?view=checklist" className="tap btn pri" style={{ height: 46 }}>
                  <Ic n="list" size={18} />
                  {tx(p("Open checklist", "चेकलिस्ट खोलें"))}
                </Link>
                <Link href={`/exam-office/plan?exam=${next.id}`} className="tap btn sec xw1" style={{ height: 46 }}>
                  <Ic n="calendar" size={18} />
                  {tx(p("Open plan", "योजना खोलें"))}
                </Link>
              </div>
            </div>
          ) : (
            <div className="card xc xhero">
              <EmptyState icon="calendar" title={tx(p("No next exam yet", "अगली परीक्षा अभी नहीं बनी"))} action={<Link href="/exams?view=create" className="tap btn pri"><Ic n="plus" size={18} />{tx(p("Create exam", "परीक्षा बनाएँ"))}</Link>} />
            </div>
          )}
        </div>

        {timeline.length ? (
          <div className="card xc x14 xp2">
            <div className="xr xj x8">
              <span className="xt">{yearTitle}</span>
              <span className="xm">{tx(p("Tap an exam", "किसी परीक्षा पर टैप करें"))}</span>
            </div>
            <div className="xtline" style={{ gridTemplateColumns: `repeat(${timeline.length},minmax(0,1fr))` }}>
              <span className="xtrack" aria-hidden="true" style={{ left: edge, right: edge }}>
                <span style={{ width: tlFill }} />
              </span>
              {timeline.map((t) => {
                const k = t.state;
                const href = k === "now" ? "/exam-office?view=late" : k === "next" ? "/exam-office?view=checklist" : `/exams?exam=${t.id}`;
                const icon: IconName = k === "done" ? "checkCircle" : k === "now" ? "clipboard" : k === "next" ? "calendar" : "flag";
                const bg = V(k === "done" ? "ok" : k === "now" ? "acc" : k === "next" ? "infos" : "s2");
                const fg = k === "done" || k === "now" ? V("onsolid") : V(k === "next" ? "info" : "mut");
                const pbg = V(k === "done" ? "oks" : k === "now" ? "accs" : k === "next" ? "infos" : "s2");
                const pfg = V(k === "done" ? "ok" : k === "now" ? "accfg" : k === "next" ? "info" : "mut");
                const ready = next ? next.readiness.percent : 0;
                const long =
                  k === "done"
                    ? t.doneOn ? tx(p(`Done · results out ${t.doneOn}`, `पूरा · परिणाम ${t.doneOn}`)) : tx(p("Done", "पूरा"))
                    : k === "now"
                      ? t.resultsOn ? tx(p(`Now · results ${t.resultsOn}`, `अभी · परिणाम ${t.resultsOn}`)) : tx(p("Now", "अभी"))
                      : k === "next"
                        ? tx(p(`Setting up · ${ready}%`, `तैयारी · ${ready}%`))
                        : tx(p("Not set up yet", "अभी तय नहीं"));
                const short = k === "done" ? tx(p("Done", "पूरा")) : k === "now" ? tx(p("Now", "अभी")) : k === "next" ? `${ready}%` : tx(p("Later", "बाद में"));
                return (
                  <Link key={t.id} href={href} className="tap xnode" aria-label={`${tx(t.name)} · ${long}`}>
                    <span className="xi" style={{ width: 50, height: 50, borderRadius: 25, background: bg, color: fg, border: "4px solid var(--card)", boxShadow: k === "now" ? "0 0 0 2px var(--acc)" : "0 0 0 1px var(--bd)", animation: k === "now" ? "xPulse 1.8s ease infinite" : "none" }}>
                      <Ic n={icon} size={18} />
                    </span>
                    <span className="xb xs">
                      <span className="hide-m">{tx(t.name)}</span>
                      <span className="only-m">{tx(shortName(t.name))}</span>
                    </span>
                    <span className="xm num" style={{ marginTop: -4 }}>{t.when}</span>
                    <span className="pill" style={{ height: "auto", minHeight: 22, whiteSpace: "normal", padding: "3px 8px", background: pbg, color: pfg }}>
                      <span className="hide-m">{long}</span>
                      <span className="only-m">{short}</span>
                    </span>
                  </Link>
                );
              })}
            </div>
          </div>
        ) : null}

        <span className="sech">{tx(p("Quick actions", "जल्दी के काम"))}</span>
        <div className="xqa">
          {quick.map((q) => (
            <Link key={q.t.en} href={q.href} className="card lift xc xtile">
              <span className="xi" style={{ width: 44, height: 44, borderRadius: 14, background: q.bg, color: q.fg }}>
                <Ic n={q.icon} size={22} />
              </span>
              <span className="xc">
                <span className="xt">{tx(q.t)}</span>
                {sub(q.t) ? <span className="xm">{sub(q.t)}</span> : null}
              </span>
            </Link>
          ))}
        </div>
      </section>

      <aside className="xc x14 xn0">
        <div className="card xc xoh">
          <span className="sech" style={{ padding: "14px 16px 6px" }}>{tx(p("Needs you today", "आज आपके काम"))}</span>
          {needs.length === 0 ? <span className="xm" style={{ padding: "0 16px 16px" }}>{tx(p("Nothing waiting on you.", "आपका कोई काम बाकी नहीं।"))}</span> : null}
          {needs.map((n) => (
            <Link key={n.title} href={n.href} className="tap row xr x12 xd xln" style={{ width: "100%", padding: "12px 16px", color: "var(--fg)", textAlign: "left" }}>
              <span className="xi" style={{ width: 38, height: 38, borderRadius: 12, background: n.bg, color: n.fg }}>
                <Ic n={n.icon} size={18} />
              </span>
              <span className="xc xf">
                <span className="x6w">{n.title}</span>
                {n.sub ? <span className="xm">{n.sub}</span> : null}
              </span>
              <Ic n="chevRight" size={18} style={{ color: "var(--sub)" }} />
            </Link>
          ))}
        </div>
        <div className="card xc xp">
          <span className="sech" style={{ marginBottom: 6 }}>{tx(p("Recent · who did what", "हाल में · किसने क्या किया"))}</span>
          {activity.length === 0 ? <span className="xm">{tx(p("Nothing yet.", "अभी कुछ नहीं।"))}</span> : null}
          <div className="xst">
            {activity.slice(0, 6).map((a) => (
              <div key={a.id} className="xlg">
                <i style={{ background: LOG_DOT[a.kind] ?? V("sub") }} />
                <span>{tx(a.text)}</span>
                <span className="num xm">{whenText(a.at, tx)}</span>
              </div>
            ))}
          </div>
        </div>
      </aside>
    </div>
  );
}

/* --------------------------------------------------------- checklist */

function Checklist({
  next,
  staffName,
  filter,
  setFilter,
  papersOf,
  pending,
  tick,
}: {
  next: NextExamView;
  staffName: string;
  filter: "all" | "mine" | "others";
  setFilter: (f: "all" | "mine" | "others") => void;
  papersOf: string;
  pending: boolean;
  tick: (key: string, done: boolean) => void;
}) {
  const { tx } = useVx();
  const total = next.steps.length || 1;
  const pct = next.readiness.percent;
  const shown = next.steps.filter((s) => filter === "all" || (filter === "mine" ? s.owner === "you" : s.owner !== "you"));
  const mine = toneAvatar(staffName);
  return (
    <div className="pad xsc" style={{ maxWidth: 980 }}>
      <div className="card xr xw xp2" style={{ gap: "16px 22px" }}>
        <DRing value={pct} size={104} tone={pct >= 100 ? "var(--ok)" : "var(--info)"}>
          <span className="num xb" style={{ fontSize: 24, lineHeight: 1 }}>{pct}%</span>
          <span className="xm x11">{tx(p("ready", "तैयार"))}</span>
        </DRing>
        <div className="xc x6 xf" style={{ minWidth: 180 }}>
          <h2 className="xh">{tx(p(`${next.name.en} · setup`, `${next.name.hi ?? next.name.en} · तैयारी`))}</h2>
          <span className="xm">
            {next.dates}
            {next.daysLeft !== null ? ` · ${tx(p(`${next.daysLeft} days left`, `${next.daysLeft} दिन बाकी`))}` : ""} · {tx(p("each step opens the right place", "हर कदम सही जगह खोलता है"))}
          </span>
          <div className="xbar" style={{ height: 10, marginTop: 4 }}>
            <span style={{ width: `${((next.readiness.done / total) * 100).toFixed(1)}%`, background: "var(--ok)" }} />
            <span style={{ width: `${((next.readiness.underWay / total) * 50).toFixed(1)}%`, background: "var(--c3)" }} />
          </div>
          <span className="xs num">
            <b>{tx(p(`${next.readiness.done} of ${next.steps.length} steps done`, `${next.steps.length} में से ${next.readiness.done} कदम पूरे`))}</b> · {tx(p(`${next.readiness.underWay} under way`, `${next.readiness.underWay} जारी`))}
          </span>
        </div>
        <div className="mfull" style={{ width: 300 }}>
          <Seg
            label={tx(p("Whose steps", "किसके कदम"))}
            value={filter}
            onChange={setFilter}
            style={{ width: "100%" }}
            options={[
              { value: "all", label: tx(p("All steps", "सभी")) },
              { value: "mine", label: tx(p("Mine", "मेरे")) },
              { value: "others", label: tx(p("Others", "दूसरों के")) },
            ]}
          />
        </div>
      </div>
      <div className="xc xst">
        {shown.map((s, i) => {
          const words = STEP_WORDS[s.key];
          const look = stepLook(s, papersOf);
          const done = s.state === "done";
          const owner = s.owner === "you" ? { ...mine, ini: initials(staffName) } : toneAvatar(tx(OWNER_WORDS[s.owner]));
          const soon = !done && s.daysLeft !== null && s.daysLeft <= 25;
          return (
            <div key={s.key} className="xgd" style={{ gridTemplateColumns: "34px minmax(0,1fr)", gap: 12 }}>
              <div className="xc" style={{ alignItems: "center" }}>
                <span className="xi" style={{ width: 34, height: 34, marginTop: 18, borderRadius: 17, background: done ? V("ok") : look.k === "doing" ? V("warns") : V("card"), color: done ? V("onsolid") : look.fg, border: `2px solid ${done ? V("ok") : look.k === "doing" ? V("warn") : V("bds")}` }}>
                  {done ? <Ic n="check" size={16} stroke={3} /> : <span className="num xb xs">{next.steps.indexOf(s) + 1}</span>}
                </span>
                <span className="xf1" style={{ width: 2, marginTop: 4, background: i === shown.length - 1 ? "transparent" : done ? V("ok") : V("bd") }} />
              </div>
              <div className="card xc x10 xp" style={{ marginBottom: 12, opacity: done && s.key === "created" ? 0.82 : 1 }}>
                <div className="xr xw x8 xj">
                  <span className="xc xf" style={{ minWidth: 200, gap: 2 }}>
                    <span className="xt">{tx(words.title)}</span>
                    <span className="xm" style={{ lineHeight: 1.45 }}>{tx(stepHelp(s.key, next))}</span>
                  </span>
                  <span className="pill" style={{ height: 26, padding: "0 10px", fontSize: 12, background: look.bg, color: look.fg }}>{tx(look.label)}</span>
                </div>
                {s.key === "papers" && !done ? (
                  <div className="xr x10">
                    <div className="xbar xf">
                      <span style={{ width: `${(s.part * 100).toFixed(1)}%`, background: "var(--c3)" }} />
                    </div>
                    <span className="num xm xb">{papersOf}</span>
                  </div>
                ) : null}
                <div className="xr xw x8">
                  <span className="xpl">
                    <span className="xi xb" style={{ width: 20, height: 20, borderRadius: 10, fontSize: 10, background: owner.bg, color: owner.fg }}>{owner.ini}</span>
                    {tx(OWNER_WORDS[s.owner])}
                  </span>
                  {s.dueLabel ? (
                    <span className="xpl num" style={{ color: soon ? V("warnfg") : V("fg") }}>
                      <Ic n="calendar" size={14} />
                      {s.dueLabel}
                      {!done && s.daysLeft !== null && s.daysLeft > 0 ? ` · ${tx(p(`in ${s.daysLeft} days`, `${s.daysLeft} दिन में`))}` : ""}
                      {!done && s.daysLeft !== null && s.daysLeft < 0 ? ` · ${tx(p(`${-s.daysLeft} days late`, `${-s.daysLeft} दिन देर`))}` : ""}
                    </span>
                  ) : null}
                  <span className="xf" />
                  {s.canTick && s.owner === "you" ? (
                    <button type="button" className="tap btn ghost" disabled={pending} onClick={() => tick(s.key, true)} style={{ height: 36, fontSize: 13 }}>
                      <Ic n="checkCircle" size={15} />
                      {tx(p("Mark done", "पूरा करें"))}
                    </button>
                  ) : null}
                  {done && s.key === "admit" ? (
                    <button type="button" className="tap btn ghost" disabled={pending} onClick={() => tick(s.key, false)} style={{ height: 36, fontSize: 13 }}>
                      <Ic n="undo" size={15} />
                      {tx(p("Undo", "वापस लें"))}
                    </button>
                  ) : null}
                  <Link href={words.href(next.id)} className="tap btn soft xob">
                    {tx(words.open)}
                    <Ic n="arrowRight" size={15} />
                  </Link>
                </div>
              </div>
            </div>
          );
        })}
      </div>
      <span className="xm">{tx(p("Steps owned by others are ticked by them in their own app. Every change is logged with who and when.", "दूसरों के कदम वे अपने ऐप में टिक करते हैं। हर बदलाव किसने और कब के साथ दर्ज होता है।"))}</span>
    </div>
  );
}

/* --------------------------------------------------------- late row */

function LateRow({
  t,
  callTag,
  callOpen,
  onCall,
  onRemind,
  onOutcome,
}: {
  t: TeacherRowView;
  callTag: string | null;
  callOpen: boolean;
  onCall: () => void;
  onRemind: () => void;
  onOutcome: (key: string, label: Pair) => void;
}) {
  const { tx } = useVx();
  const av = toneAvatar(t.name);
  const share = t.total ? (t.entered / t.total) * 100 : 0;
  const tag = callTag ?? (t.remindedAt ? `${tx(p("Reminded", "याद दिलाया"))} ${whenText(t.remindedAt, tx)}` : null);
  const tagStyle: CSSProperties = callTag ? { background: V("oks"), color: V("ok") } : { background: V("accs"), color: V("accfg") };
  return (
    <div className="xd xc" style={{ padding: "14px 18px", gap: 10 }}>
      <div className="xsr">
        <span className="xa" style={{ background: av.bg, color: av.fg }}>{av.ini}</span>
        <span className="xc xn0" style={{ gap: 6 }}>
          <span className="xr xw x8">
            <span className="xt">{t.name}</span>
            <span className="xm num">{t.phoneMasked}</span>
            {tag ? <span className="pill" style={{ ...tagStyle, animation: "xPopIn .4s var(--spring) both" }}>{tag}</span> : null}
          </span>
          <span className="xr xw x6">
            {t.papers.map((x) => {
              const done = x.status === "done";
              return (
                <span key={x.paperId} className="xpl num" style={{ background: V(done ? "oks" : x.entered ? "warns" : "bads"), color: V(done ? "ok" : x.entered ? "warnfg" : "bad") }}>
                  {x.classLabel} {x.subjectCode} <b>{done ? "✓" : `${x.entered}/${x.total}`}</b>
                </span>
              );
            })}
          </span>
          <span className="xm">{seenText(t, tx)}</span>
        </span>
        <span className="xc x4">
          <span className="num xb xs">{tx(p(`${t.entered} of ${t.total} marks`, `${t.total} में से ${t.entered} अंक`))}</span>
          <span className="xbar" style={{ height: 6 }}>
            <span style={{ width: `${share.toFixed(1)}%`, background: share < 25 ? V("bad") : V("c3") }} />
          </span>
        </span>
        <span className="xr x8" style={{ justifyContent: "flex-end" }}>
          {t.phone ? (
            <a className="tap btn sec" href={`tel:${t.phone}`} onClick={onCall} aria-expanded={callOpen}>
              <Ic n="phone" size={18} />
              {tx(p("Call", "फ़ोन"))}
            </a>
          ) : (
            <button type="button" className="tap btn sec" onClick={onCall} aria-pressed={callOpen}>
              <Ic n="phone" size={18} />
              {tx(p("Call", "फ़ोन"))}
            </button>
          )}
          <button type="button" className={`tap btn ${t.remindedAt ? "soft" : "pri"}`} onClick={onRemind}>
            <Ic n={t.remindedAt ? "checkCircle" : "send"} size={18} />
            {t.remindedAt ? tx(p("Reminded", "याद दिलाया")) : tx(p("Remind", "याद दिलाएँ"))}
          </button>
        </span>
      </div>
      {callOpen ? (
        <div className="xno fadein xc" style={{ gap: 8, background: "var(--s2)", color: "var(--fg)" }}>
          <span className="xr x8 xs">
            <Ic n="phone" size={18} style={{ color: "var(--acc)" }} />
            <span>{tx(p(`Calling ${t.phoneMasked || t.name} from your phone… How did it go?`, `आपके फ़ोन से ${t.phoneMasked || t.name} को फ़ोन… क्या बात हुई?`))}</span>
          </span>
          <div className="xr xw x6">
            {CALLS.map((c) => (
              <button key={c.key} type="button" className="tap chip" onClick={() => onOutcome(c.key, c.label)}>
                {tx(c.label)}
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------- menu */

function MenuView({ staffName, staffPhone, sessionLabel, results, next, teachers, onHelp }: { staffName: string; staffPhone: string | null; sessionLabel: string; results: ResultsExamView | null; next: NextExamView | null; teachers: TeacherRowView[]; onHelp: () => void }) {
  const { tx, sub } = useVx();
  const ds = next?.steps.find((s) => s.key === "datesheet");
  const dsWord = !ds ? "" : ds.state === "done" ? tx(p("date sheet is final", "डेट शीट पक्की")) : ds.state === "doing" ? tx(p("date sheet is a draft", "डेट शीट अभी कच्ची है")) : tx(p("date sheet not started", "डेट शीट शुरू नहीं"));
  const tiles: { t: Pair; s: string; icon: IconName; bg: string; fg: string; href: string }[] = [
    { t: p("Date sheet & seating", "डेट शीट और बैठक"), s: next ? `${tx(next.name)}${dsWord ? ` · ${dsWord}` : ""}` : "", icon: "calendar", bg: V("accs"), fg: V("accfg"), href: "/exam-office/plan" },
    { t: p("Marks tracker", "अंक प्रगति"), s: results ? `${tx(results.name)} · ${results.percent}% ${tx(p("entered", "भरे"))} · ${results.lateCount} ${tx(p("late", "देर"))}` : "", icon: "clipboard", bg: V("warns"), fg: V("warnfg"), href: "/exams?view=grid" },
    { t: p("Results & report cards", "परिणाम व प्रगति पत्र"), s: results?.resultsLabel ? `${tx(p("Results day", "परिणाम दिवस"))} ${results.resultsLabel}${results.ptmAt ? " · PTM" : ""}` : "", icon: "award", bg: V("oks"), fg: V("ok"), href: "/exam-office/results" },
    { t: p("Calendar", "कैलेंडर"), s: tx(p("Holidays, PTM and exam days", "छुट्टियाँ, PTM और परीक्षा दिवस")), icon: "calendar", bg: V("infos"), fg: V("info"), href: "/calendar" },
    { t: p("Notices", "सूचनाएँ"), s: tx(p("Send a notice to staff or parents", "स्टाफ़ या अभिभावकों को सूचना भेजें")), icon: "megaphone", bg: V("s2"), fg: V("fg"), href: "/messages" },
  ];
  const tileBody = (q: { t: Pair; s: string; icon: IconName; bg: string; fg: string }, bad?: boolean) => (
    <>
      <span className="xi" style={{ width: 52, height: 52, borderRadius: 16, background: q.bg, color: q.fg }}>
        <Ic n={q.icon} size={26} />
      </span>
      <span className="xc" style={{ gap: 1 }}>
        <span className="xt" style={{ fontSize: 16, color: bad ? V("bad") : V("fg") }}>{tx(q.t)}</span>
        {sub(q.t) ? <span className="xs xmu">{sub(q.t)}</span> : null}
      </span>
      {q.s ? <span className="xm" style={{ lineHeight: 1.4 }}>{q.s}</span> : null}
    </>
  );
  const rows: { t: Pair; s: string; icon: IconName; bg: string; fg: string; href?: string; onClick?: () => void }[] = [
    { t: next ? p(`${next.name.en} checklist`, `${next.name.hi ?? next.name.en} चेकलिस्ट`) : p("Next exam checklist", "अगली परीक्षा चेकलिस्ट"), s: next ? `${next.readiness.percent}% ${tx(p("ready", "तैयार"))} · ${tx(p(`${next.readiness.done} of ${next.steps.length} steps done`, `${next.steps.length} में से ${next.readiness.done} कदम पूरे`))}` : "", icon: "list", bg: V("infos"), fg: V("info"), href: "/exam-office?view=checklist" },
    { t: p("Late teachers", "देर वाले शिक्षक"), s: `${teachers.length} ${tx(p("not finished", "बाकी"))} · ${teachers.filter((t) => !t.remindedAt).length} ${tx(p("not reminded", "को याद नहीं दिलाया"))}`, icon: "alert", bg: V("bads"), fg: V("bad"), href: "/exam-office?view=late" },
    { t: p("Help", "मदद"), s: tx(p("3 quick steps for this screen", "इस स्क्रीन के 3 आसान कदम")), icon: "help", bg: V("s2"), fg: V("mut"), onClick: onHelp },
  ];
  const av = initials(staffName);
  return (
    <div className="pad xsc" style={{ maxWidth: 980 }}>
      <div className="card xr x14 xp2">
        <span className="xa" style={{ width: 56, height: 56, borderRadius: 28, fontSize: 18, background: "#F3C7C7", color: "#082F49" }}>{av}</span>
        <span className="xc xf">
          <h2 className="xh">{staffName}</h2>
          <span className="xm">
            {tx(p("Exam coordinator", "परीक्षा प्रभारी"))} · {tx(p("Session", "सत्र"))} {sessionLabel}
            {staffPhone ? ` · ${staffPhone}` : ""}
          </span>
        </span>
        <Link href="/exam-office" className="tap btn soft hide-m">
          <Ic n="home" size={18} />
          {tx(p("Back to today", "आज पर लौटें"))}
        </Link>
      </div>
      <div className="xmenu xst">
        {tiles.map((q) => (
          <Link key={q.t.en} href={q.href} className="card lift xc xtile" style={{ minHeight: 150, borderColor: V("bd") }}>
            {tileBody(q)}
          </Link>
        ))}
        <form action={logoutAction} className="card lift xc xtile" style={{ minHeight: 150, borderColor: V("bads") }}>
          {tileBody({ t: p("Sign out", "साइन आउट"), s: tx(p("You are signed in on this device", "आप इस डिवाइस पर साइन इन हैं")), icon: "logout", bg: V("bads"), fg: V("bad") }, true)}
          <button type="submit" className="xov tap" aria-label={tx(p("Sign out", "साइन आउट"))} style={{ border: 0, background: "transparent", padding: 0 }} />
        </form>
      </div>
      <div className="card xc xoh">
        {rows.map((r) => {
          const inner = (
            <>
              <span className="xi" style={{ width: 38, height: 38, borderRadius: 12, background: r.bg, color: r.fg }}>
                <Ic n={r.icon} size={18} />
              </span>
              <span className="xc xf">
                <span className="x6w">{tx(r.t)}</span>
                {r.s ? <span className="xm">{r.s}</span> : null}
              </span>
              <Ic n="chevRight" size={18} style={{ color: "var(--sub)" }} />
            </>
          );
          const style: CSSProperties = { width: "100%", minHeight: 60, padding: "10px 16px", border: 0, background: "transparent", color: "var(--fg)", textAlign: "left" };
          return r.href ? (
            <Link key={r.t.en} href={r.href} className="tap row xr x12 xd xln" style={style}>
              {inner}
            </Link>
          ) : (
            <button key={r.t.en} type="button" className="tap row xr x12 xd xln" onClick={r.onClick} style={style}>
              {inner}
            </button>
          );
        })}
      </div>
    </div>
  );
}
