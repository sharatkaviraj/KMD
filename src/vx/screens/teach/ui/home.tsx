"use client";

import Link from "@/ui/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, useSyncExternalStore, useTransition, type ReactNode } from "react";

import { draftKey } from "@/platform/drafts/policy";
import { loadDraft } from "@/platform/drafts/store";
import { Ic, type IconName } from "@/vx/icons";
import { useVx } from "@/vx/i18n";
import { initials, shortDayHi, timeHi } from "@/vx/format";
import { p, type Pair } from "@/vx/text";
import { VxPage } from "@/vx/ui/page";
import { Sheet, useToast } from "@/vx/ui/overlays";

import { answerCoverVx, cancelLeaveVx, noticeSeenVx, queueBirthdayWishVx, setTextSizeVx } from "../actions";
import type { HomeData } from "../data";
import { birthdayWish, periodPhases, type AttentionReason, type PeriodPhase } from "../domain/teach";
import { subjectPair } from "@/vx/screens/exams/domain/groups";
import { classesWord, classSubject, classWord, closedTitle, combinedClasses, coverLine, examWord, leaveNow, leaveState, LEAVE_STATE_TEXT, mayCancelLeave, registerOnLeaveLine, teacherKind, type TeacherKind } from "../domain/today";
import { ampm, andList, callName, dLongP, dShort, dShortP, greetingPair, hm12, shortClass, whenSent } from "./fmt";
import { LazyCoverAssist, ReadyForYou } from "@/vx/assist/lazy-ready";
import { LazyAwayReports, LazyCoverReportForm } from "./lazy-cover-report";
import "./today.css";
import { CardTitle, DrawnTick, HelpIcon, HelpPic, HelpSheet, LangSeg, LeaveSheet, LinkRing, TchTop, useUrlState, WithdrawConfirm, type HelpStep } from "./shared";

/*
 * Teacher · Today (design TchHome): the register card, the office's notices,
 * quick actions, the day's periods with any cover, the children who need the
 * teacher today, her marks links and her subjects. Two columns on a desk; on
 * a phone one, in the design's order (register, notices, actions, periods,
 * children, links, subjects). Sheets by `?sheet=news|subs|leave|help|link|wish`.
 */

type SheetKey = "news" | "leave" | "help" | "link" | "wish" | "subs";

const STEP_NOTICE: HelpStep = { title: p("Read notices, tap I have read it", "सूचना पढ़कर “पढ़ लिया” दबाएँ।"), body: p("The office sees that you have read it. No need to reply.", "ऑफ़िस देख लेता है कि आपने पढ़ लिया। जवाब की ज़रूरत नहीं।"), pic: <HelpPic kind="seen" /> };
const STEP_COVER: HelpStep = { title: p("Answer a substitution", "सब्स्टिट्यूशन के लिए हाँ या ना दबाएँ।"), body: p("Tap “I’ll take it” or “I can’t”. The office is told at once.", "“हाँ, ले लेंगे” या “नहीं ले पाएँगे” दबाएँ। ऑफ़िस को तुरंत पता चल जाता है।"), pic: <HelpPic kind="take" /> };
const STEP_LEAVE: HelpStep = { title: p("Ask for leave", "छुट्टी माँगें"), body: p("Tap “Ask for leave”, pick the day and a reason. The office answers on this screen.", "“छुट्टी माँगें” दबाएँ, दिन और कारण चुनें। ऑफ़िस का जवाब इसी स्क्रीन पर आता है।"), pic: <HelpPic kind="leave" /> };

/**
 * Help that matches what is on her screen (smoke 20 Oct: a new teacher was
 * told to "start with the blue card" she did not have). A class teacher
 * starts with her register; a subject teacher with her periods; a new
 * teacher with what she will see once the office gives her a class.
 */
const HELP: Record<TeacherKind, HelpStep[]> = {
  class: [
    { title: p("Start with the attendance card", "हाज़िरी वाले कार्ड से शुरू करें।"), body: p("Tap “Mark attendance”. Everyone is already Present — tap only who is away, then save.", "“हाज़िरी लगाएँ” दबाएँ। सब पहले से उपस्थित हैं — सिर्फ़ अनुपस्थित पर टैप करें, फिर सेव करें।"), pic: <HelpPic kind="mark" /> },
    STEP_NOTICE,
    STEP_COVER,
  ],
  subject: [
    { title: p("See your periods", "अपने पीरियड देखें"), body: p("“My periods today” lists your classes in order. Class teachers take attendance; you do not.", "“आज मेरे पीरियड” में आपकी कक्षाएँ क्रम से हैं। हाज़िरी कक्षा अध्यापक लेते हैं, आप नहीं।"), icon: "clock" },
    STEP_NOTICE,
    STEP_COVER,
  ],
  new: [
    { title: p("Wait for your class and periods", "अपनी कक्षा और पीरियड का इंतज़ार करें"), body: p("Once the office gives you a class or periods, attendance and marks show here. Call the office if it is taking long.", "ऑफ़िस से कक्षा या पीरियड मिलते ही हाज़िरी और अंक यहाँ दिखेंगे। देर हो तो ऑफ़िस को फ़ोन करें।"), icon: "users" },
    STEP_NOTICE,
    STEP_LEAVE,
  ],
};

/** The welcome card is shown once on this phone, then remembered here (no database row needed). */
const WELCOME_KEY = (staffId: string) => `vx.teach.welcome.v1:${staffId}`;
const welcomeListeners = new Set<() => void>();
function readWelcome(staffId: string): boolean {
  try {
    return window.localStorage.getItem(WELCOME_KEY(staffId)) === "1";
  } catch {
    return true;
  }
}
function dismissWelcome(staffId: string) {
  try {
    window.localStorage.setItem(WELCOME_KEY(staffId), "1");
  } catch {
    /* private window: it shows again next time, nothing breaks */
  }
  for (const l of welcomeListeners) l();
}
const subscribeWelcome = (l: () => void) => {
  welcomeListeners.add(l);
  return () => welcomeListeners.delete(l);
};

const WHY_NOT: Pair[] = [p("I have another class", "मेरी दूसरी कक्षा है"), p("Not feeling well", "तबीयत ठीक नहीं"), p("Other duty", "दूसरी ड्यूटी"), p("Other reason", "दूसरा कारण")];

const V = (x: string) => `var(--${x})`;

function subjectIcon(name: string): IconName {
  return /science|physics|chem|bio|evs/i.test(name) ? "flask" : "book";
}

function mins(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

type Row = {
  key: string;
  period: number;
  number: number;
  starts: string;
  ends: string;
  kind: "cls" | "sub" | "free";
  title: string;
  sub: string;
  icon: IconName;
  classId: string | null;
  /** Where tapping the period goes: her subject in that class, or her own class. */
  href?: string;
  coverId?: string;
  acknowledged?: boolean;
  note?: string;
};

export function TeachHome({
  data,
  name,
  shortName,
  initialSheet,
  school,
  officePhone,
  bolo,
  allowed = { attendance: true, marks: true, notes: true },
}: {
  data: HomeData;
  name: string;
  /** The name staff call her by ("Ravina"), for the greeting (BUG-15). */
  shortName?: string;
  initialSheet: string | null;
  school: string;
  /** The school office's number, for help's "Call the office"; none hides it. */
  officePhone?: string;
  bolo?: ReactNode;
  /** Office and coordinators can open this page too; their quick actions stop at what they may open. */
  allowed?: { attendance: boolean; marks: boolean; notes: boolean };
}) {
  const { tx, sub, language } = useVx();
  const router = useRouter();
  const toast = useToast();
  const [sheet, setSheet] = useUrlState<SheetKey>("sheet", (initialSheet as SheetKey) ?? null);
  const [pending, start] = useTransition();
  const [seen, setSeen] = useState<Set<string>>(() => new Set(data.notices.filter((n) => n.seen).map((n) => n.id)));
  const [newsId, setNewsId] = useState<string | null>(null);
  const [linkId, setLinkId] = useState<string | null>(data.links[0]?.paperId ?? null);
  const allCovers = [...data.covers, ...data.upcomingCovers];
  const [coverId, setCoverId] = useState<string | null>(allCovers.find((c) => !c.acknowledged)?.id ?? allCovers[0]?.id ?? null);
  const [cantOpen, setCantOpen] = useState(false);
  // No reason is chosen for the teacher (ST-10): the office gets the one she picks.
  const [why, setWhy] = useState<number | null>(null);
  const [whyNote, setWhyNote] = useState("");
  const todaysBirthdays = data.birthdays.filter((b) => b.inDays === 0);
  const [wishFor, setWishFor] = useState<string | null>(todaysBirthdays[0]?.id ?? null);
  const [wishedNow, setWishedNow] = useState<Set<string>>(() => new Set());

  const reg = data.myClass?.register ?? null;
  const classLabel = data.myClass?.classLabel ?? "";
  // "Class 4" for an English reader, "कक्षा 4" for a Hindi one (verification 21 Oct: "Class 4 की हाज़िरी").
  const classHi = classWord(classLabel).hi ?? classLabel;
  // A cover row on one line in the reader's words: "Class 9 · Physics" / "कक्षा 9 · भौतिकी".
  const coverWhat = (c: { classLabels: string; subjectName: string; subjectHi?: string }) => classSubject(c.classLabels, p(c.subjectName, c.subjectHi));
  const kind = teacherKind({ classes: data.myClasses.length, unassigned: data.unassigned });
  const tel = officePhone ? officePhone.replace(/[^\d+]/g, "") : "";
  const [large, setLarge] = useState(data.largeText);

  // The welcome card, once on this phone (smoke 20 Oct: a new teacher saw nothing that explained the app).
  const welcomeSeen = useSyncExternalStore(subscribeWelcome, () => readWelcome(data.staffId), () => true);

  // A register marked on this phone but never saved (smoke 20 Oct: "the bell rang
  // and I forgot I had not saved"). The register keeps its draft on the phone;
  // Today reads the same key so the teacher is reminded before the office chases her.
  type Unsaved = { classId: string; classLabel: string; day: string; marked: number };
  const [unsaved, setUnsaved] = useState<Unsaved[]>([]);
  const draftTargets = [
    ...(data.schoolOpen ? data.myClasses.filter((c) => !c.saved).map((c) => ({ classId: c.classId, classLabel: c.classLabel, day: data.today })) : []),
    ...(data.lastOpen ? data.lastOpen.unmarked.map((c) => ({ classId: c.classId, classLabel: c.classLabel, day: data.lastOpen!.day })) : []),
  ];
  const draftSig = draftTargets.map((t) => `${t.classId}/${t.day}`).join(",");
  useEffect(() => {
    let live = true;
    const targets = draftSig ? draftSig.split(",").map((x) => { const [classId, day] = x.split("/"); return { classId, day }; }) : [];
    void Promise.all(
      targets.map((t) =>
        loadDraft(draftKey(data.staffId, data.sessionLabel, `attendance-vx/${t.classId}/${t.day}`))
          .then((raw) => {
            const d = raw as { value?: { marks?: Record<string, string>; revision?: number } } | null;
            const marks = d?.value?.marks;
            if (!marks || (d?.value?.revision ?? 0) !== 0) return null;
            const marked = Object.values(marks).filter((m) => m !== "present").length;
            return marked > 0 ? { ...t, marked } : null;
          })
          .catch(() => null),
      ),
    ).then((found) => {
      if (!live) return;
      setUnsaved(found.filter((x): x is { classId: string; day: string; marked: number } => x !== null).map((x) => ({ ...x, classLabel: data.myClasses.find((c) => c.classId === x.classId)?.classLabel ?? "" })));
    });
    return () => {
      live = false;
    };
  }, [draftSig, data.staffId, data.sessionLabel, data.myClasses]);

  // Withdrawing asks once first: one tap used to remove the card with no way
  // back (6 Nov school day).
  const [askWithdraw, setAskWithdraw] = useState<string | null>(null);
  const cancelLeave = (id: string) =>
    start(async () => {
      const res = await cancelLeaveVx(id);
      setAskWithdraw(null);
      if (res.ok) {
        toast.show({ text: tx(p("Leave request withdrawn", "छुट्टी का अनुरोध वापस लिया")) });
        router.refresh();
      } else toast.show({ text: tx(res.error), tone: "bad" });
    });
  const toggleLarge = () =>
    start(async () => {
      const next = !large;
      setLarge(next);
      const res = await setTextSizeVx(next);
      if (!res.ok) {
        setLarge(!next);
        toast.show({ text: tx(res.error), tone: "bad" });
      } else router.refresh();
    });

  /* --------------------------------------------------------- the day */
  // A subject teacher's period opens her subject in that class (marks, children),
  // not the class teacher's "My class" page (20-teacher school day, 6 Nov).
  const periodHref = (per: (typeof data.periods)[number]): string | undefined => {
    // A combined period (12 Arts + 12 Com Economics) has no single classId and
    // was plain text (6 Nov school day). Open her own class if it is one of
    // them, else the first class where she has that subject.
    if (!per.classId) {
      const ids = per.classIds ?? [];
      if (data.myClass && ids.includes(data.myClass.classId)) return `/teach/class?class=${data.myClass.classId}`;
      const hit = ids.map((id) => periodHref({ ...per, classId: id, classIds: [id] })).find((h) => h?.includes("subject="));
      return hit ?? (ids[0] ? `/teach/class?class=${ids[0]}` : undefined);
    }
    if (per.classId === data.myClass?.classId) return `/teach/class?class=${per.classId}`;
    // Match by code, then name, then the only subject she teaches in that class:
    // the timetable said "MATHS" where the subject list said "Mathematics",
    // and her Class 10 Maths period still opened "My class" (6 Nov re-check).
    const inClass = data.subjects.filter((x) => x.classId === per.classId);
    const s = inClass.find((x) => x.code === per.subjectCode) ?? inClass.find((x) => x.name === per.subjectName) ?? (inClass.length === 1 ? inClass[0] : undefined);
    return s ? `/teach/class?subject=${s.classId}.${s.subjectId}` : `/teach/class?class=${per.classId}`;
  };
  const rows: Row[] = [];
  for (const per of data.periods) {
    rows.push({ key: `p${per.period}-${per.subjectCode}`, period: per.period, number: per.number, starts: per.starts, ends: per.ends, kind: "cls", title: tx(p(`${per.classLabel} · ${per.subjectName}`, `${per.combined ? (combinedClasses(per.classLabel).hi ?? per.classLabel) : (classWord(per.classLabel).hi ?? per.classLabel)} · ${per.subjectHi}`)), sub: [`${hm12(per.starts)} – ${hm12(per.ends)}`, per.classId && per.classId === data.myClass?.classId ? tx(p("my class", "मेरी कक्षा")) : null, per.combined ? tx(p("combined", "संयुक्त")) : null].filter(Boolean).join(" · "), icon: subjectIcon(per.subjectName), classId: per.classId, href: periodHref(per) });
  }
  for (const c of data.covers) {
    rows.push({ key: `c${c.id}`, period: c.period, number: c.number, starts: c.starts, ends: c.ends, kind: "sub", title: tx(coverWhat(c)), sub: tx(p(`Substitution · for ${c.forName}`, `सब्स्टिट्यूशन · ${c.forName} की जगह`)), icon: "swap", classId: null, coverId: c.id, acknowledged: c.acknowledged, note: c.reason ? tx(p(`${c.forName} is away. Note: ${c.reason}`, `${c.forName} आज नहीं हैं। नोट: ${c.reason}`)) : tx(p(`${c.forName} is away today.`, `${c.forName} आज नहीं हैं।`)) });
  }
  const busy = new Set(rows.map((r) => r.period));
  for (const b of data.bells) {
    if (busy.has(b.period)) continue;
    rows.push({ key: `f${b.period}`, period: b.period, number: b.number, starts: b.starts, ends: b.ends, kind: "free", title: tx(p("Free period", "खाली पीरियड")), sub: `${hm12(b.starts)} – ${hm12(b.ends)}`, icon: "coffee", classId: null });
  }
  rows.sort((a, b) => a.period - b.period);
  const phases: PeriodPhase[] = periodPhases(rows, data.nowMinutes);
  // Her leave today (approved or waiting): those periods say so, never "Done ✓".
  const myLeave = leaveNow(data.leave, data.today);
  const allOver = rows.length > 0 && phases.every((ph) => ph === "done");
  const later = Boolean(reg) && (rows.length === 0 ? true : allOver) && data.schoolOpen;
  const classCount = rows.filter((r) => r.kind === "cls").length;
  const coverCount = rows.filter((r) => r.kind === "sub").length;
  const freeCount = rows.filter((r) => r.kind === "free").length;

  /* -------------------------------------------------------- actions */
  const gotIt = (ids: string[]) =>
    start(async () => {
      const res = await noticeSeenVx(ids);
      if (res.ok) {
        setSeen((cur) => new Set([...cur, ...ids]));
        toast.show({ text: tx(p("Marked as seen · the office can see it", "देखा गया · ऑफ़िस को पता है")) });
      } else toast.show({ text: tx(res.error), tone: "bad" });
    });

  const answer = (id: string, a: "acknowledge" | "cannot_cover", note = "") =>
    start(async () => {
      const res = await answerCoverVx(id, a, note);
      if (res.ok) {
        const c = allCovers.find((x) => x.id === id);
        const title = c ? p(`${c.day === data.today ? "" : `${dShort(c.day)} · `}P${c.number} · ${coverWhat(c).en}`, `${c.day === data.today ? "" : `${dShortP(c.day).hi} · `}P${c.number} · ${coverWhat(c).hi}`) : p("");
        toast.show({ text: tx(a === "acknowledge" ? p(`Added to your day · ${title.en}`, `आपके दिन में जोड़ा · ${title.hi ?? title.en}`) : p("Told the office you can’t · they will ask someone else", "ऑफ़िस को बता दिया · वे किसी और से कहेंगे")) });
        setCantOpen(false);
        setSheet(null);
        router.refresh();
      } else toast.show({ text: tx(res.error), tone: "bad" });
    });

  const wishKid = todaysBirthdays.find((b) => b.id === wishFor) ?? null;
  const wishText = wishKid ? birthdayWish({ childName: wishKid.name, school }) : null;
  const sendWish = () =>
    start(async () => {
      if (!wishKid) return;
      const res = await queueBirthdayWishVx(wishKid.id);
      if (res.ok) {
        setWishedNow((cur) => new Set([...cur, wishKid.id]));
        toast.show({ text: tx(p(`Birthday wishes queued for ${wishKid.name.split(" ")[0]}’s parents`, `${wishKid.name.split(" ")[0]} के माता-पिता के लिए शुभकामना कतार में`)) });
        setSheet(null);
      } else toast.show({ text: tx(res.error), tone: "bad" });
    });

  const attendHref = data.myClass ? `/teach/attendance?class=${data.myClass.classId}&day=${data.today}` : "/teach/attendance";

  /* ------------------------------------------------------- greeting */
  const greet = greetingPair(data.nowMinutes);
  const bySubject = new Map<string, { hi: string; cls: string[] }>();
  for (const s of data.subjects) bySubject.set(s.name, { hi: s.nameHi, cls: [...(bySubject.get(s.name)?.cls ?? []), shortClass(s.classLabel)] });
  const subjectLine = [...bySubject.entries()].map(([n, v]) => tx(p(`${n} for ${andList(v.cls)}`, `${v.hi} — कक्षा ${andList(v.cls, "और")}`))).join(" · ");
  // Every class she holds, by name, in her language (smoke 20 Oct: only the first class was named).
  const heldWords = data.myClasses.map((c) => classWord(c.classLabel));
  const heldLine = heldWords.length ? p(`${andList(heldWords.map((w) => w.en))} class teacher`, `${andList(heldWords.map((w) => w.hi ?? w.en), "और")} की कक्षा अध्यापक`) : null;
  const context = [tx(dLongP(data.today)), heldLine ? tx(heldLine) : null, subjectLine || null].filter(Boolean).join(" · ");

  /* ---------------------------------------------------------- hero */
  const dots = Math.min(60, data.myClass?.total ?? 0);
  // Closed today: the holiday by name, and the last open day's unsaved registers to finish (smoke 20 Oct).
  const closedHero = data.closed ? (
    <div className="card rise" style={{ order: 1, padding: 22, display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "flex", gap: 16, alignItems: "center" }}>
        <span className="tc-ib" style={{ width: 56, height: 56, borderRadius: 16, background: "var(--s2)", color: "var(--acc)" }}><Ic n="coffee" size={26} /></span>
        <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
          <span className="serif" style={{ fontSize: 24, fontWeight: 600, lineHeight: 1.15 }}>{tx(closedTitle(data.closed))}</span>
          <span className="tc-p" style={{ color: "var(--mut)" }}>{tx(p("School is closed today. No attendance and no periods today.", "आज स्कूल बंद है। आज न हाज़िरी लगेगी, न पीरियड होंगे।"))}</span>
        </span>
      </div>
      {allowed.attendance && data.lastOpen?.unmarked.length ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 8, paddingTop: 10, borderTop: "1px solid var(--bd)" }}>
          <span className="tc-s">{tx(p(`Not saved for ${dShortP(data.lastOpen.day).en} yet:`, `${dShortP(data.lastOpen.day).hi} की हाज़िरी अभी सेव नहीं हुई:`))}</span>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {data.lastOpen.unmarked.map((c) => (
              <Link key={c.classId} href={`/teach/attendance?class=${c.classId}&day=${data.lastOpen!.day}`} className="tap btn pri" style={{ minHeight: 48 }}>
                <Ic n="calCheck" />
                {tx(p(`Mark ${classWord(c.classLabel).en} for ${dShortP(data.lastOpen!.day).en}`, `${dShortP(data.lastOpen!.day).hi} की ${classWord(c.classLabel).hi} हाज़िरी लगाएँ`))}
              </Link>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  ) : null;
  // No class of her own: say why plainly, and who to ask (smoke 20 Oct).
  // A subject teacher who has periods gets one line inside "My periods today"
  // instead of a whole card above it: on a phone that card pushed her periods
  // below the first screen (20-teacher school day, 6 Nov).
  const noClassHero = !data.myClass && (data.unassigned || data.closed || !data.periods.length) ? (
    <div className="card rise" style={{ order: 1, padding: 22, display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "flex", gap: 16, alignItems: "center" }}>
        <span className="tc-ib" style={{ width: 56, height: 56, borderRadius: 16, background: "var(--s2)", color: "var(--acc)" }}><Ic n="users" size={26} /></span>
        <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
          <span className="serif" style={{ fontSize: 24, fontWeight: 600, lineHeight: 1.15 }}>{data.unassigned ? tx(p("You have no class or periods yet", "आपको अभी कोई कक्षा या पीरियड नहीं मिला")) : tx(p("You do not take attendance", "आप हाज़िरी नहीं लेते"))}</span>
          <span className="tc-p" style={{ color: "var(--mut)" }}>
            {data.unassigned
              ? tx(p("The office has not given you a class or periods this session. Call the office to be added to the timetable. Notices and leave work now.", "इस सत्र में ऑफ़िस ने अभी आपको कोई कक्षा या पीरियड नहीं दिया है। समय-सारणी में जुड़ने के लिए ऑफ़िस को फ़ोन करें। सूचनाएँ और छुट्टी अभी से चलती हैं।"))
              : data.periods.length
                ? tx(p("Class teachers take attendance. Your periods are below.", "हाज़िरी कक्षा अध्यापक लेते हैं। आपके पीरियड नीचे हैं।"))
                : tx(p("Class teachers take attendance. You have no periods today.", "हाज़िरी कक्षा अध्यापक लेते हैं। आज आपका कोई पीरियड नहीं।"))}
          </span>
        </span>
      </div>
      {data.unassigned && tel ? (
        <a href={`tel:${tel}`} className="tap btn pri" style={{ alignSelf: "flex-start", minHeight: 48 }}>
          <Ic n="phone" />
          {tx(p("Call the office", "ऑफ़िस को फ़ोन करें"))}
        </a>
      ) : null}
    </div>
  ) : null;
  const hero = closedHero ?? noClassHero ?? (data.myClass === null ? null : reg ? (
    <div className="card rise" style={{ order: 1, padding: 22, display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
        <DrawnTick size={76} />
        <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
          <span className="serif" style={{ fontSize: 26, fontWeight: 600, lineHeight: 1.15 }}>{later ? tx(p("You’re all set for today", "आज का सब काम हो गया")) : tx(p(`${classLabel} attendance is saved`, `${classHi} की हाज़िरी सहेजी गई`))}</span>
          {sub(later ? p("You’re all set for today", "आज का सब काम हो गया") : p(`${classLabel} attendance is saved`, `${classHi} की हाज़िरी सहेजी गई`)) ? (
            <span className="tc-p" style={{ color: "var(--mut)" }}>{sub(later ? p("You’re all set for today", "आज का सब काम हो गया") : p(`${classLabel} attendance is saved`, `${classHi} की हाज़िरी सहेजी गई`))}</span>
          ) : null}
        </span>
      </div>
      <div style={{ display: "flex", flexDirection: "column" }}>
        {[
          [
            // The half day was left out: "3 present · 1 absent" for 5 children (6 Nov).
            tx(p(`Attendance saved · ${reg.present} present · ${reg.absent} absent${reg.halfDay ? ` · ${reg.halfDay} half day` : ""}`, `हाज़िरी सहेजी · ${reg.present} उपस्थित · ${reg.absent} अनुपस्थित${reg.halfDay ? ` · ${reg.halfDay} आधा दिन` : ""}`)),
            [tx(classWord(classLabel)), reg.submittedAt ? tx(p(`saved at ${ampm(reg.submittedAt)}`, `${timeHi(reg.submittedAt)} बजे सहेजी`)) : null, reg.alerts ? tx(p(`parents of ${reg.alerts} get a WhatsApp at 10`, `${reg.alerts} अभिभावकों को 10 बजे व्हाट्सऐप`)) : null].filter(Boolean).join(" · "),
          ] as const,
          ...(data.notices[0] && seen.has(data.notices[0].id) ? [[tx(p(`Notice seen · ${data.notices[0].title}`, `सूचना देखी · ${data.notices[0].title}`)), tx(p("The office knows you have read it", "ऑफ़िस को पता है कि आपने पढ़ लिया"))] as const] : []),
          ...data.covers.filter((c) => c.acknowledged && rows.some((r, i) => r.coverId === c.id && phases[i] === "done")).map((c) => [tx(p(`P${c.number} covered · ${coverWhat(c).en}`, `P${c.number} लिया · ${coverWhat(c).hi}`)), tx(p(`${c.forName}’s class`, `${c.forName} की कक्षा`))] as const),
          ...todaysBirthdays.filter((b) => b.wished || wishedNow.has(b.id)).map((b) => [tx(p("Birthday wishes sent", "जन्मदिन की शुभकामना भेजी")), tx(p(`${b.name}’s parents`, `${b.name} के माता-पिता`))] as const),
        ].map(([t, s], i) => (
          <div key={t} className="tc-in" style={{ display: "flex", alignItems: "center", gap: 12, padding: "9px 0", borderTop: "1px solid var(--bd)", animationDelay: `${300 + i * 90}ms` }}>
            <span className="tc-av" style={{ width: 30, height: 30, background: "var(--oks)", color: "var(--ok)" }}><Ic n="check" size={16} stroke={2.6} /></span>
            <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
              <span className="tc-p" style={{ fontWeight: 600 }}>{t}</span>
              <span className="tc-s">{s}</span>
            </span>
          </div>
        ))}
      </div>
      {later && data.tomorrow ? (
        <div style={{ display: "flex", alignItems: "center", gap: 14, padding: 14, borderRadius: 16, background: "var(--s2)" }}>
          <span className="tc-ib" style={{ width: 48, height: 48, borderRadius: 14, background: "var(--card)", color: "var(--acc)" }}><Ic n="calendar" size={22} /></span>
          <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
            <span className="sech">{tx(p("Tomorrow", "कल"))}{sub(p("Tomorrow", "कल")) ? ` · ${sub(p("Tomorrow", "कल"))}` : ""}</span>
            <span className="tc-p" style={{ fontWeight: 700 }}>
              {data.tomorrow.first ? `P${data.tomorrow.first.number} · ${hm12(data.tomorrow.first.starts)} · ${tx(classSubject(data.tomorrow.first.classLabel, p(data.tomorrow.first.subjectName, data.tomorrow.first.subjectHi)))}` : tx(p("No periods", "कोई पीरियड नहीं"))}
            </span>
            <span className="tc-s">{tx(dShortP(data.tomorrow.day))}</span>
          </span>
        </div>
      ) : null}
      <Link href={later ? `/teach/attendance?class=${data.myClass.classId}&view=history` : attendHref} className="tc-lnk" style={{ alignSelf: "flex-start" }}>
        {later ? tx(p(`See ${classLabel} attendance this month`, `${classHi} की इस महीने की हाज़िरी`)) : tx(p("See or change today’s register", "आज की हाज़िरी देखें या बदलें"))}
        <Ic n="chevRight" />
      </Link>
    </div>
  ) : (
    <div className="card rise tc-hero" style={{ order: 1 }}>
      <Ic n="calCheck" size={150} stroke={1.2} style={{ position: "absolute", right: -18, top: -14, opacity: 0.12 }} />
      <span style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, fontWeight: 700, letterSpacing: ".04em", opacity: 0.85 }}>
        <Ic n="calCheck" size={17} />
        {tx(p(`${classLabel} attendance`, `${classHi} की हाज़िरी`))}
        {sub(p("Attendance", "हाज़िरी")) ? ` · ${sub(p("Attendance", "हाज़िरी"))}` : ""}
      </span>
      <span className="serif" style={{ fontSize: 30, fontWeight: 600, lineHeight: 1.15 }}>{tx(p("Not marked yet", "अभी हाज़िरी नहीं लगी"))}</span>
      <span className="tc-p" style={{ opacity: 0.88, maxWidth: 520 }}>{tx(p("Takes 30 seconds. Everyone starts as Present — you only tap the children who are away.", "सिर्फ़ 30 सेकंड लगेंगे। सब बच्चे पहले से उपस्थित हैं — बस अनुपस्थित बच्चों पर टैप करें।"))}</span>
      {dots ? (
        <div aria-hidden="true" style={{ display: "flex", flexWrap: "wrap", gap: 5, margin: "2px 0 4px" }}>
          {Array.from({ length: dots }, (_, i) => <span key={i} style={{ width: 10, height: 10, borderRadius: 5, border: "1.5px solid currentColor", opacity: 0.45 }} />)}
        </div>
      ) : null}
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 14 }}>
        {allowed.attendance ? (
          <Link href={attendHref} className="tap btn tc-big">
            <Ic n="calCheck" size={22} />
            {tx(p("Mark attendance", "हाज़िरी लगाएँ"))}
            {sub(p("Mark attendance", "हाज़िरी लगाएँ")) ? <span style={{ fontSize: 14, fontWeight: 600, opacity: 0.7 }}>{sub(p("Mark attendance", "हाज़िरी लगाएँ"))}</span> : null}
          </Link>
        ) : null}
        <span className="tc-s" style={{ color: "inherit", opacity: 0.8, flex: "1 1 200px" }}>{tx(p(`Until you save, the office sees ${classLabel} as Not marked.`, `सेव करने तक कार्यालय में ${classHi} “नहीं लगी” दिखेगी।`))}</span>
      </div>
      {registerOnLeaveLine(myLeave) ? <span className="tc-s" role="status" style={{ color: "inherit", fontWeight: 600 }}>{tx(registerOnLeaveLine(myLeave)!)}</span> : null}
    </div>
  ));

  /* --------------------------------------------- every class she holds */
  // One row per class she holds, each with its register (smoke 20 Oct:
  // "where did my Class 3 go?" — the second class sat in a small link at the bottom).
  const classesCard =
    data.schoolOpen && data.myClasses.length > 1 ? (
      <div className="card tc-card" style={{ order: 1 }}>
        <CardTitle t={p("Attendance in your classes today", "आपकी कक्षाओं की आज की हाज़िरी")} />
        {data.myClasses.map((c) => {
          const w = classWord(c.classLabel);
          return (
            <Link key={c.classId} href={`/teach/attendance?class=${c.classId}&day=${data.today}`} className="tap tc-sj" style={{ minHeight: 56 }}>
              <span className="tc-ib" style={{ width: 40, height: 40, borderRadius: 12, background: c.saved ? "var(--oks)" : "var(--warns)", color: c.saved ? "var(--ok)" : "var(--warnfg)" }}><Ic n={c.saved ? "check" : "calCheck"} /></span>
              <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
                <span style={{ fontWeight: 700 }}>{tx(w)}</span>
                {c.total ? <span className="tc-s">{tx(p(`${c.total} children`, `${c.total} बच्चे`))}</span> : null}
              </span>
              <span className="pill" style={{ background: c.saved ? "var(--oks)" : "var(--warns)", color: c.saved ? "var(--ok)" : "var(--warnfg)" }}>
                {c.saved ? tx(p(`Saved${c.savedAt ? ` ${ampm(c.savedAt)}` : ""}`, `सेव${c.savedAt ? ` ${timeHi(c.savedAt)}` : ""}`)) : tx(p("Not marked", "नहीं लगी"))}
              </span>
              <Ic n="chevRight" />
            </Link>
          );
        })}
      </div>
    ) : null;

  /* ------------------------------------------ marked on this phone, not saved */
  const unsavedCard = unsaved.length ? (
    <div className="card rise" role="status" style={{ order: 0, padding: 18, display: "flex", flexDirection: "column", gap: 10, background: "var(--bads)", borderColor: "var(--bad)" }}>
      {unsaved.map((u) => (
        <div key={`${u.classId}/${u.day}`} style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10 }}>
          <span style={{ flex: "1 1 220px", minWidth: 0, display: "flex", flexDirection: "column" }}>
            <span className="tc-p" style={{ fontWeight: 700, color: "var(--bad)" }}>
              {u.day === data.today
                ? tx(p(`${classWord(u.classLabel).en} attendance is not saved yet`, `${classWord(u.classLabel).hi} की हाज़िरी अभी सेव नहीं हुई`))
                : tx(p(`${classWord(u.classLabel).en} attendance for ${dShortP(u.day).en} is not saved yet`, `${classWord(u.classLabel).hi} की ${dShortP(u.day).hi} की हाज़िरी अभी सेव नहीं हुई`))}
            </span>
            <span className="tc-s">{tx(p(`${u.marked} ${u.marked === 1 ? "child" : "children"} marked on this phone. The office still sees “Not marked”. Open it and save.`, `इस फ़ोन पर ${u.marked} बच्चे लगाए हैं। ऑफ़िस को अभी “नहीं लगी” दिख रहा है। खोलकर सेव करें।`))}</span>
          </span>
          <Link href={`/teach/attendance?class=${u.classId}&day=${u.day}`} className="tap btn pri" style={{ minHeight: 46 }}>
            {tx(p("Open and save", "खोलें और सेव करें"))}
            <Ic n="chevRight" />
          </Link>
        </div>
      ))}
    </div>
  ) : null;

  /* ------------------------------------------------------- her leave */
  // Her leave on Today: waiting, approved (and who covers each period) or not approved (smoke 20 Oct).
  const leaveCard = data.leave.length ? (
    <div className="card tc-card" style={{ order: 0 }}>
      <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <span className="tc-ib" style={{ width: 40, height: 40, borderRadius: 12, background: "var(--warns)", color: "var(--warnfg)" }}><Ic n="calMinus" size={20} /></span>
        <CardTitle t={p("Your leave", "आपकी छुट्टी")} />
        <Link href="/teach/more?view=leave" className="tc-lnk">{tx(p("My leave", "मेरी छुट्टी"))}<Ic n="chevRight" /></Link>
      </span>
      {data.leave.map((l) => {
        const st = leaveState(l, data.today);
        const tone = st === "approved" ? ["var(--oks)", "var(--ok)"] : st === "declined" ? ["var(--bads)", "var(--bad)"] : ["var(--warns)", "var(--warnfg)"];
        const span = l.span === "first_half" ? p("first half", "पहली पाली") : l.span === "second_half" ? p("second half", "दूसरी पाली") : p("full day", "पूरा दिन");
        const from = dShortP(l.from_day);
        const to = dShortP(l.to_day);
        const when = l.from_day === l.to_day ? p(`${from.en} · ${span.en}`, `${from.hi} · ${span.hi}`) : p(`${from.en} – ${to.en}`, `${from.hi} – ${to.hi}`);
        return (
          <div key={l.id} style={{ display: "flex", flexDirection: "column", gap: 6, paddingTop: 10, borderTop: "1px solid var(--bd)" }}>
            <span style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
              <span className="tc-p" style={{ fontWeight: 700, flex: 1, minWidth: 0 }}>{tx(when)}</span>
              <span className="pill" style={{ background: tone[0], color: tone[1] }}>{tx(LEAVE_STATE_TEXT[st])}</span>
            </span>
            {st === "approved" ? (
              l.covers.length ? (
                <span style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                  <span className="tc-s" style={{ fontWeight: 600 }}>{tx(p("Who takes your classes:", "आपकी कक्षाएँ कौन लेगा:"))}</span>
                  {l.covers.map((c) => (
                    <span key={`${c.day}-${c.number}`} className="tc-s" style={{ color: c.coverName ? "var(--fg)" : "var(--warnfg)" }}>
                      {l.from_day !== l.to_day ? `${tx(dShortP(c.day))} · ` : ""}
                      {tx(coverLine(c))}
                    </span>
                  ))}
                </span>
              ) : (
                <span className="tc-s">{tx(p("The office has not arranged cover for your periods yet.", "ऑफ़िस ने अभी आपके पीरियड का इंतज़ाम नहीं किया है।"))}</span>
              )
            ) : st === "waiting" ? (
              <span className="tc-s">{tx(p("The office has not answered yet. You will see the answer here.", "ऑफ़िस ने अभी जवाब नहीं दिया। जवाब यहीं दिखेगा।"))}</span>
            ) : st === "declined" ? (
              <span className="tc-s">{tx(p("Talk to the office if you still need the day off.", "अगर छुट्टी अब भी चाहिए तो ऑफ़िस से बात करें।"))}</span>
            ) : null}
            {mayCancelLeave(l) ? (
              askWithdraw === l.id ? (
                <WithdrawConfirm pending={pending} onYes={() => cancelLeave(l.id)} onNo={() => setAskWithdraw(null)} />
              ) : (
                <button type="button" className="tap btn ghost" disabled={pending} onClick={() => setAskWithdraw(l.id)} style={{ alignSelf: "flex-start", minHeight: 44 }}>
                  <Ic n="x" />
                  {tx(p("Withdraw request", "अनुरोध वापस लें"))}
                </button>
              )
            ) : null}
          </div>
        );
      })}
    </div>
  ) : null;

  /* --------------------------------------------------- office tasks */
  // Work the office sent her (smoke 20 Oct: "the office sent work and I never knew").
  const tasksCard = data.tasks.length ? (
    <div className="card tc-card" style={{ order: 2, background: "var(--infos)", borderColor: "transparent" }}>
      <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <span className="tc-ib" style={{ width: 40, height: 40, borderRadius: 12, background: "var(--card)", color: "var(--info)" }}><Ic n="inbox" size={20} /></span>
        <CardTitle t={data.tasks.length === 1 ? p("1 task from the office", "ऑफ़िस से 1 काम") : p(`${data.tasks.length} tasks from the office`, `ऑफ़िस से ${data.tasks.length} काम`)} />
      </span>
      {data.tasks.slice(0, 3).map((t) => (
        <Link key={t.id} href={t.href} className="tap tc-sj" style={{ minHeight: 52 }}>
          <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
            <span style={{ fontWeight: 700 }}>{t.title}</span>
            {t.dueDate ? <span className="tc-s">{tx(p(`Due ${dShortP(t.dueDate).en}`, `${dShortP(t.dueDate).hi} तक`))}</span> : null}
          </span>
          <Ic n="chevRight" />
        </Link>
      ))}
      {data.tasks.length > 3 ? <Link href="/teach/tasks" className="tc-lnk">{tx(p("See all my tasks", "मेरे सभी काम"))}<Ic n="chevRight" /></Link> : null}
    </div>
  ) : null;

  /* -------------------------------------------------------- welcome */
  const welcome = !welcomeSeen ? (
    <div className="card rise" style={{ order: kind === "new" ? 0 : 3, padding: 20, display: "flex", flexDirection: "column", gap: 10, background: "var(--accs)", borderColor: "transparent" }}>
      <span className="serif" style={{ fontSize: 22, fontWeight: 600 }}>{tx(p("Welcome to the school app", "स्कूल ऐप में आपका स्वागत है"))}</span>
      <span className="tc-p">
        {tx(
          kind === "new"
            ? p("Here you read the office’s notices and ask for leave. Once the office gives you a class or periods, you will also take attendance, enter marks and write notes about children here.", "यहाँ आप ऑफ़िस की सूचनाएँ पढ़ते हैं और छुट्टी माँगते हैं। ऑफ़िस से कक्षा या पीरियड मिलने पर हाज़िरी, अंक और बच्चों के नोट्स भी यहीं से होंगे।")
            : kind === "subject"
              ? p("Here you see your periods for the day, enter marks, write notes about children, read the office’s notices and ask for leave.", "यहाँ आप दिन के अपने पीरियड देखते हैं, अंक भरते हैं, बच्चों के नोट्स लिखते हैं, ऑफ़िस की सूचनाएँ पढ़ते हैं और छुट्टी माँगते हैं।")
              : p("Here you take your class’s attendance, enter marks, write notes about children, read the office’s notices and ask for leave.", "यहाँ आप अपनी कक्षा की हाज़िरी लगाते हैं, अंक भरते हैं, बच्चों के नोट्स लिखते हैं, ऑफ़िस की सूचनाएँ पढ़ते हैं और छुट्टी माँगते हैं।"),
        )}
      </span>
      <span className="tc-s">{tx(p("Stuck? Tap “Help” at the top, or call the office.", "कहीं अटकें तो ऊपर “मदद” दबाएँ, या ऑफ़िस को फ़ोन करें।"))}</span>
      <button type="button" className="tap btn pri" onClick={() => dismissWelcome(data.staffId)} style={{ alignSelf: "flex-start", minHeight: 46 }}>
        <Ic n="check" />
        {tx(p("Got it, start", "समझ गए, शुरू करें"))}
      </button>
    </div>
  ) : null;

  /* ------------------------------------------------ cover, at the top */
  // The office asking her to cover comes first on Today (ST-07), and a duty
  // for a later day shows here as soon as it is given (BUG-06).
  const asked = allCovers.filter((c) => !c.acknowledged);
  const laterTaken = data.upcomingCovers.filter((c) => c.acknowledged);
  const coverAsk =
    asked.length || laterTaken.length ? (
      <div className="card rise" style={{ order: 0, padding: 18, display: "flex", flexDirection: "column", gap: 12, background: asked.length ? "var(--warns)" : "var(--card)", borderColor: asked.length ? "var(--warnm)" : "var(--bd)" }}>
        <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span className="tc-ib" style={{ width: 40, height: 40, borderRadius: 12, background: "var(--card)", color: "var(--warnfg)" }}><Ic n="swap" size={20} /></span>
          <CardTitle t={asked.length ? p("The office asks you to cover", "ऑफ़िस आपसे कक्षा लेने को कह रहा है") : p("Cover coming up", "आने वाली ड्यूटी")} />
        </span>
        {[...asked, ...laterTaken].map((c) => (
          <div key={c.id} style={{ display: "flex", flexDirection: "column", gap: 8, paddingTop: 10, borderTop: "1px solid var(--bd)" }}>
            <span style={{ display: "flex", flexDirection: "column" }}>
              <span className="tc-p" style={{ fontWeight: 700 }}>{c.day === data.today ? tx(p("Today", "आज")) : tx(dShortP(c.day))} · P{c.number}{c.starts ? ` · ${hm12(c.starts)}` : ""} · {tx(coverWhat(c))}</span>
              <span className="tc-s">{tx(p(`for ${c.forName}`, `${c.forName} की जगह`))}{c.acknowledged ? ` · ${tx(p("You said you will take it ✓", "आपने हाँ कहा ✓"))}` : ""}</span>
            </span>
            {c.acknowledged ? null : (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                <button type="button" className="tap btn pri" disabled={pending} onClick={() => answer(c.id, "acknowledge")} style={{ flex: "1 1 130px", height: 48, fontSize: 15 }}>
                  <Ic n="check" />
                  {tx(p("I’ll take it", "हाँ, ले लेंगे"))}
                </button>
                <button type="button" className="tap btn sec" disabled={pending} onClick={() => { setCoverId(c.id); setWhy(null); setCantOpen(true); setSheet("subs"); }} style={{ flex: "1 1 100px", height: 48, fontSize: 15 }}>
                  {tx(p("I can’t", "नहीं ले पाएँगे"))}
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
    ) : null;

  /* -------------------------------------------------------- periods */
  const pillText = allOver ? tx(p(`All ${rows.length} periods over`, `सभी ${rows.length} पीरियड पूरे`)) : [tx(p(`${classCount} ${classCount === 1 ? "class" : "classes"}`, `${classCount} कक्षाएँ`)), coverCount ? tx(p(`${coverCount} cover`, `${coverCount} सब्स्टिट्यूशन`)) : null, freeCount ? tx(p(`${freeCount} free`, `${freeCount} खाली`)) : null].filter(Boolean).join(" · ");
  // On a phone the two columns flatten and every card without an order (the
  // welcome, "Ready for you", Bolo, the cover ask) is order 0, so "first"
  // needs -1: at 1 her periods were still the fifth card (6 Nov re-check).
  const subjectOnly = !data.myClass && !noClassHero;
  const periods = (
    <div className="card tc-card" style={{ order: subjectOnly ? -1 : 2, animationDelay: "120ms" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <CardTitle t={p("My periods today", "आज मेरे पीरियड")} />
        {rows.length ? <span className="pill num" style={{ height: 26, padding: "0 10px", fontSize: 12, background: "var(--s2)", color: "var(--mut)" }}>{pillText}</span> : null}
      </div>
      {subjectOnly ? (
        <span className="tc-s" style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <Ic n="info" size={16} />
          {tx(p("Class teachers take attendance, not you.", "हाज़िरी कक्षा अध्यापक लेते हैं, आप नहीं।"))}
        </span>
      ) : null}
      {!data.published ? (
        <span className="tc-s" style={{ padding: "8px 0" }}>{tx(p("The timetable is not published yet.", "समय-सारणी अभी प्रकाशित नहीं।"))}</span>
      ) : rows.length === 0 ? (
        <span className="tc-s" style={{ padding: "8px 0" }}>{data.closed ? tx(p("School is closed today, so there are no periods. Your timetable is the same on the next school day.", "आज स्कूल बंद है, इसलिए कोई पीरियड नहीं। अगले स्कूल के दिन आपकी समय-सारणी वैसी ही रहेगी।")) : data.unassigned ? tx(p("No periods in your name yet. The office adds you to the timetable.", "आपके नाम पर अभी कोई पीरियड नहीं। ऑफ़िस आपको समय-सारणी में जोड़ेगा।")) : tx(p("No periods today.", "आज कोई पीरियड नहीं।"))}</span>
      ) : (
        <div style={{ display: "flex", flexDirection: "column" }}>
          {rows.map((r, i) => {
            const ph = phases[i];
            const done = ph === "done";
            const now = ph === "now";
            const isSub = r.kind === "sub";
            const warm = isSub;
            const leftMin = now ? Math.max(0, mins(r.ends) - data.nowMinutes) : 0;
            const elapsed = now ? Math.min(100, Math.max(0, ((data.nowMinutes - mins(r.starts)) / Math.max(1, mins(r.ends) - mins(r.starts))) * 100)) : 0;
            const tag: [string, string, string] | null = isSub
              ? r.acknowledged
                ? [done ? tx(p("Covered", "लिया")) : tx(p("Covering", "आप ले रहे हैं")), V("ok"), V("onsolid")]
                : [tx(p("Asked you", "आपसे पूछा")), V("warn"), V("onsolid")]
              : r.kind === "cls" && myLeave?.periods.includes(r.number)
                ? myLeave.state === "approved"
                  ? [tx(p("On leave", "छुट्टी पर")), V("infos"), V("info")]
                  : [tx(p("Leave asked", "छुट्टी माँगी")), V("warns"), V("warnfg")]
                : now
                ? [tx(p(`Now · ${leftMin} min left`, `अभी · ${leftMin} मिनट बाकी`)), V("acc"), V("onsolid")]
                : ph === "next"
                  ? [tx(p("Next", "अगला")), V("accs"), V("accfg")]
                  : done && r.kind === "cls"
                    ? [tx(p("Done ✓", "हो गया ✓")), V("s3"), V("mut")]
                    : null;
            const dot = now ? V("acc") : warm && !done ? V("warn") : done ? V("bds") : r.kind === "cls" ? V("c2") : V("s3");
            const bg = now ? V("accs") : warm ? V("warns") : r.kind === "cls" && !done ? V("s2") : "transparent";
            const bd = now ? "1px solid var(--acc)" : warm ? "1px solid var(--warnm)" : r.kind === "free" ? "1px dashed var(--bd)" : "1px solid transparent";
            const ibg = isSub ? V("card") : r.kind === "free" ? V("s2") : V("accs");
            const ifg = isSub ? V("warnfg") : r.kind === "free" ? V("sub") : V("accfg");
            const body = (
              <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "6px 10px" }}>
                <span className="tc-ib hide-m" style={{ width: 34, height: 34, borderRadius: 11, background: ibg, color: ifg }}><Ic n={r.icon} size={17} /></span>
                <span style={{ flex: "1 1 150px", minWidth: 0, display: "flex", flexDirection: "column" }}>
                  <span className="tc-p" style={{ fontWeight: 600 }}>{r.title}</span>
                  <span className="tc-s">{r.sub}</span>
                </span>
                {tag ? <span className="pill tc-pop" style={{ background: tag[1], color: tag[2] }}>{tag[0]}</span> : null}
              </div>
            );
            return (
              <div key={r.key} className="tc-tl" style={{ animationDelay: `${Math.min(i, 12) * 45}ms` }}>
                <span className="num tc-s" style={{ display: "flex", flexDirection: "column", paddingTop: 12, textAlign: "right" }}>
                  <b style={{ color: "var(--fg)", fontSize: 14 }}>P{r.number}</b>
                  {hm12(r.starts)}
                </span>
                <span style={{ position: "relative", display: "flex", justifyContent: "center" }}>
                  <span style={{ position: "absolute", top: i === 0 ? 22 : 0, bottom: i === rows.length - 1 ? "calc(100% - 22px)" : 0, width: 2, background: "var(--bd)" }} />
                  <span style={{ position: "relative", marginTop: 19, width: 12, height: 12, borderRadius: 6, background: dot, boxShadow: "0 0 0 3px var(--card)", animation: now ? "xPulse 2s ease infinite" : "none" }} />
                </span>
                <div className="tc-tlc" style={{ background: bg, border: bd, opacity: done && !isSub ? 0.62 : 1 }}>
                  {r.kind === "cls" && r.href ? (
                    <Link href={r.href} style={{ color: "inherit" }}>{body}</Link>
                  ) : (
                    body
                  )}
                  {now ? (
                    <div className="tc-bar" style={{ height: 5 }}>
                      <span style={{ width: `${elapsed}%`, background: "var(--acc)", transformOrigin: "left", animation: "xGrowX 1s var(--ease) both" }} />
                    </div>
                  ) : null}
                  {isSub && !r.acknowledged ? (
                    <>
                      <span className="tc-s" style={{ color: "var(--warnfg)" }}>{r.note}</span>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                        <button type="button" className="tap btn pri" disabled={pending} onClick={() => r.coverId && answer(r.coverId, "acknowledge")} style={{ flex: "1 1 130px", height: 48, fontSize: 15 }}>
                          <Ic n="check" />
                          {tx(p("I’ll take it", "हाँ, ले लेंगे"))}
                        </button>
                        <button type="button" className="tap btn sec" disabled={pending} onClick={() => { setCoverId(r.coverId ?? null); setCantOpen(true); setSheet("subs"); }} style={{ flex: "1 1 100px", height: 48, fontSize: 15 }}>
                          {tx(p("I can’t", "नहीं ले पाएँगे"))}
                        </button>
                        <button type="button" className="tap btn ghost" aria-label={tx(p("Substitution details", "सब्स्टिट्यूशन की जानकारी"))} onClick={() => { setCoverId(r.coverId ?? null); setCantOpen(false); setSheet("subs"); }} style={{ width: 48, height: 48, padding: 0 }}>
                          <Ic n="info" />
                        </button>
                      </div>
                    </>
                  ) : null}
                  {isSub && r.acknowledged ? (
                    <button type="button" className="tap tc-note tc-pop" onClick={() => { setCoverId(r.coverId ?? null); setCantOpen(false); setSheet("subs"); }} style={{ border: 0, width: "100%", textAlign: "left", padding: "9px 12px", background: "var(--oks)", color: "var(--ok)" }}>
                      <Ic n="check" style={{ marginTop: 2 }} />
                      <span style={{ flex: 1, fontWeight: 600 }}>{done ? tx(p(`You covered P${r.number} · thank you`, `आपने P${r.number} लिया · धन्यवाद`)) : tx(p(`You’re covering P${r.number} · ${r.title}`, `आप P${r.number} ले रहे हैं · ${r.title}`))}</span>
                    </button>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );

  /* ------------------------------------------------- children */
  type KidRow = { key: string; name: string; ini?: string; icon?: IconName; bg: string; fg: string; tag: string; why: string; done?: string | null; acts: ReactNode[] };
  const actBtn = (key: string, href: string, icon: IconName, label: string, cls: string) => (
    <Link key={key} href={href} className={`tap btn ${cls}`} style={{ height: 44 }}>
      <Ic n={icon} />
      {label}
    </Link>
  );
  const noteAct = (id: string) => (allowed.notes ? [actBtn(`n${id}`, `/teach/notes?sheet=add&student=${id}`, "edit", tx(p("Add note", "नोट लिखें")), "sec")] : []);
  const TONE: Record<AttentionReason, [string, string]> = { attendance: [V("bads"), V("bad")], marks: [V("warns"), V("warnfg")], notes: [V("infos"), V("info")] };
  const kidRows: KidRow[] = [
    ...data.kids.map((k) => {
      const first = k.reasons[0] ?? "notes";
      const tag =
        first === "attendance"
          ? tx(p(`Attendance ${k.attendancePct ?? "—"}%`, `उपस्थिति ${k.attendancePct ?? "—"}%`))
          : first === "marks"
            ? tx(p("Below 33% in a subject", "किसी विषय में 33% से कम"))
            : tx(p("Open notes", "खुले नोट्स"));
      return {
        key: `k${k.id}`,
        name: k.classLabel ? `${k.name} · ${tx(classWord(k.classLabel))}` : k.name,
        ini: initials(k.name),
        bg: TONE[first][0],
        fg: TONE[first][1],
        tag,
        why: tx(k.detail),
        acts: [actBtn(`c${k.id}`, `/teach/class?student=${k.id}`, "phone", tx(p("Call parents", "माता-पिता को फ़ोन")), "pri"), ...noteAct(k.id)],
      };
    }),
    ...todaysBirthdays.map((b) => ({
      key: `b${b.id}`,
      name: b.name,
      icon: "cake" as IconName,
      bg: V("warns"),
      fg: V("warnfg"),
      tag: tx(p("Birthday today", "आज जन्मदिन")),
      why: tx(p(`Turns ${b.turning} today${b.rollNo ? ` · Roll ${b.rollNo}` : ""}`, `आज ${b.turning} साल${b.rollNo ? ` · रोल ${b.rollNo}` : ""}`)),
      done: b.wished || wishedNow.has(b.id) ? tx(p("Wishes sent to the parents", "माता-पिता को शुभकामना भेजी")) : null,
      acts:
        b.wished || wishedNow.has(b.id) || data.birthdayWishes === false
          ? []
          : [
              <button key={`w${b.id}`} type="button" className="tap btn soft" style={{ height: 44 }} onClick={() => { setWishFor(b.id); setSheet("wish"); }}>
                <Ic n="cake" />
                {tx(p("Send wishes", "शुभकामना भेजें"))}
              </button>,
            ],
    })),
    ...data.reviews.map((r) => {
      const late = r.followUpOn < data.today;
      const due = r.followUpOn === data.today;
      return {
        key: `r${r.id}`,
        name: tx(r.subject),
        ini: initials(tx(r.subject)),
        bg: late || due ? V("warns") : V("infos"),
        fg: late || due ? V("warnfg") : V("info"),
        tag: due ? tx(p("Review today", "आज समीक्षा")) : late ? tx(p(`Review was ${dShort(r.followUpOn)}`, `समीक्षा ${shortDayHi(r.followUpOn)} थी`)) : tx(p(`Follow-up ${dShort(r.followUpOn).split(" ")[0]}`, `${shortDayHi(r.followUpOn).split(" ")[0]} को फिर देखना`)),
        why: tx(p(`Your note: ${r.body} · follow-up due ${dShort(r.followUpOn)}`, `आपका नोट: ${r.body} · ${shortDayHi(r.followUpOn)} को फिर देखना`)),
        acts: [actBtn(`o${r.id}`, `/teach/notes?note=${r.id}`, "chevRight", tx(p("Open note", "खोलें")), "sec")],
      };
    }),
  ];
  const kids = (
    <div className="card tc-card" style={{ order: 5, animationDelay: "180ms" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <CardTitle t={p("Children who need you today", "आज इन बच्चों पर ध्यान दें")} />
        <span className="pill num tc-pop" style={{ height: 26, minWidth: 26, justifyContent: "center", background: kidRows.length ? V("warns") : V("oks"), color: kidRows.length ? V("warnfg") : V("ok") }}>{kidRows.length}</span>
      </div>
      <span className="tc-s">{tx(p("The app picks these from attendance, birthdays and your notes.", "ऐप इन्हें हाज़िरी, जन्मदिन और आपके नोट्स से चुनता है।"))}</span>
      {kidRows.length === 0 ? (
        <span className="tc-p" style={{ color: "var(--mut)", padding: "4px 0" }}>{tx(p("Nobody needs special attention today.", "आज किसी बच्चे को विशेष ध्यान की ज़रूरत नहीं।"))}</span>
      ) : (
        <div style={{ display: "flex", flexDirection: "column" }} data-support-reviews={data.reviews.length ? "" : undefined}>
          {kidRows.map((k, i) => (
            <div key={k.key} className="tc-kid" style={{ animationDelay: `${Math.min(i, 12) * 45}ms` }}>
              <span className="tc-av" style={{ width: 46, height: 46, background: k.bg, color: k.fg, fontSize: 14 }}>{k.icon ? <Ic n={k.icon} size={21} /> : k.ini}</span>
              <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 6 }}>
                <span style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
                  <span className="tc-p" style={{ fontWeight: 700 }}>{k.name}</span>
                  <span className="pill" style={{ background: k.bg, color: k.fg }}>{k.tag}</span>
                </span>
                <span className="tc-s" style={{ marginTop: -3 }}>{k.why}</span>
                {k.done ? (
                  <span className="pill tc-pop" style={{ alignSelf: "flex-start", height: 30, padding: "0 12px", fontSize: 13, background: "var(--oks)", color: "var(--ok)" }}>
                    <Ic n="check" size={15} />
                    {k.done}
                  </span>
                ) : null}
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8, paddingBottom: 8 }}>{k.acts}</div>
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );

  /* ---------------------------------------------------- the office */
  // The newest notice is the pinned one; it stays pinned, seen or not.
  const pinned = data.notices[0] ?? null;
  const body = (n: { bodyEn: string | null; bodyHi: string | null }) => tx({ en: n.bodyEn ?? n.bodyHi ?? "", hi: n.bodyHi ?? undefined });
  const state = (id: string): [string, string, string, string] => (seen.has(id) ? [V("bds"), tx(p("Seen ✓", "देखा ✓")), V("oks"), V("ok")] : [V("acc"), tx(p("New", "नया")), V("accs"), V("accfg")]);
  const openNews = (id: string) => { setNewsId(id); setSheet("news"); };
  const office = (
    <div className="card tc-card" style={{ order: 3, animationDelay: "60ms" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <span className="tc-ib" style={{ width: 40, height: 40, borderRadius: 12, background: "var(--infos)", color: "var(--info)" }}><Ic n="megaphone" /></span>
        <CardTitle t={p("From the office", "कार्यालय से")} />
        {data.notices.length ? (
          <Link href="/teach/more?view=news" className="tc-lnk">{tx(p("See all notices", "सभी सूचनाएँ"))}<Ic n="chevRight" /></Link>
        ) : null}
      </div>
      {!pinned ? (
        <span className="tc-p" style={{ color: "var(--mut)" }}>{tx(p("No notices from the office.", "ऑफ़िस से कोई सूचना नहीं।"))}</span>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10, padding: 14, borderRadius: 16, background: seen.has(pinned.id) ? "var(--s2)" : "var(--accs)", border: `1px solid ${seen.has(pinned.id) ? "var(--bd)" : "transparent"}`, transition: "background-color .4s ease" }}>
          <span className="tc-s" style={{ display: "flex", alignItems: "center", gap: 6, fontWeight: 600 }}>
            <Ic n="pin" size={15} style={{ color: "var(--acc)" }} />
            {tx(p("Pinned", "पिन"))} · {pinned.fromName} · {tx(whenSent(pinned.createdAt, data.today)).replace(" · ", " ").replace(/^Today/, "today")}
          </span>
          <button type="button" className="tap" onClick={() => openNews(pinned.id)} style={{ border: 0, padding: 0, background: "transparent", color: "var(--fg)", textAlign: "left", font: "inherit" }}>
            <span className="serif" style={{ display: "block", fontSize: 19, fontWeight: 600, lineHeight: 1.3 }}>{pinned.title}</span>
            {body(pinned) ? <span className="tc-s" style={{ display: "block", marginTop: 4 }}>{body(pinned)}</span> : null}
          </button>
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
            {seen.has(pinned.id) ? (
              <>
                <span className="pill tc-pop" style={{ height: 46, padding: "0 16px", borderRadius: 14, fontSize: 14, background: "var(--oks)", color: "var(--ok)" }}>
                  <Ic n="check" size={17} stroke={2.6} />
                  {tx(p("Seen", "देख लिया"))} ✓
                </span>
                <span className="tc-s">{tx(p("The office can see you read it.", "ऑफ़िस देख सकता है कि आपने पढ़ लिया।"))}</span>
              </>
            ) : (
              <button type="button" className="tap btn pri" disabled={pending} onClick={() => gotIt([pinned.id])} style={{ height: 46, padding: "0 20px", fontSize: 15 }}>
                <Ic n="check" />
                {tx(p("I have read it", "पढ़ लिया"))}
                {sub(p("I have read it", "पढ़ लिया")) ? ` · ${sub(p("I have read it", "पढ़ लिया"))}` : ""}
              </button>
            )}
            <button type="button" className="tap btn ghost" onClick={() => openNews(pinned.id)} style={{ height: 46, color: "var(--acc)" }}>{tx(p("Open the notice", "पूरी सूचना खोलें"))}</button>
          </div>
        </div>
      )}
      {data.notices.filter((n) => n.id !== pinned?.id).length ? (
        <div style={{ display: "flex", flexDirection: "column" }}>
          {data.notices
            .filter((n) => n.id !== pinned?.id)
            .slice(0, 3)
            .map((n) => {
              const k = state(n.id);
              return (
                <button key={n.id} type="button" className="tap row" onClick={() => openNews(n.id)} style={{ display: "flex", alignItems: "center", gap: 10, width: "100%", minHeight: 50, padding: "8px 4px", border: 0, borderTop: "1px solid var(--bd)", background: "transparent", color: "var(--fg)", textAlign: "left" }}>
                  <span style={{ flex: "none", width: 9, height: 9, borderRadius: 5, background: k[0] }} />
                  <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
                    <span className="tc-el" style={{ fontWeight: 600 }}>{n.title}</span>
                    <span className="tc-s">{tx(whenSent(n.createdAt, data.today))}</span>
                  </span>
                  <span className="pill" style={{ background: k[2], color: k[3] }}>{k[1]}</span>
                </button>
              );
            })}
        </div>
      ) : null}
    </div>
  );

  /* ------------------------------------------------- quick actions */
  const tile = (key: string, icon: IconName, t: Pair, bg: string, fg: string, href: string | null) => {
    const inner = (
      <>
        <span className="tc-qi" style={{ background: bg, color: fg }}><Ic n={icon} size={23} /></span>
        <span style={{ display: "flex", flexDirection: "column" }}>
          <span className="tc-p" style={{ fontWeight: 700 }}>{tx(t)}</span>
          {sub(t) ? <span className="tc-s">{sub(t)}</span> : null}
        </span>
      </>
    );
    return href ? (
      <Link key={key} href={href} className="tap lift tc-q">{inner}</Link>
    ) : (
      <button key={key} type="button" className="tap lift tc-q" onClick={() => setSheet("leave")}>{inner}</button>
    );
  };
  const quick = (
    <div className="card tc-card" style={{ order: 4, animationDelay: "100ms" }}>
      <CardTitle t={p("Quick actions", "जल्दी के काम")} />
      <div className="tc-g2">
        {allowed.attendance && data.myClass && data.schoolOpen ? tile("att", "calCheck", reg ? p("See attendance", "हाज़िरी देखें") : p("Mark attendance", "हाज़िरी लगाएँ"), V("pri"), V("prifg"), reg && later && data.myClass ? `/teach/attendance?class=${data.myClass.classId}&view=history` : attendHref) : null}
        {allowed.marks && !data.unassigned ? tile("marks", "clipboard", p("Enter marks", "अंक भरें"), V("infos"), V("info"), "/teach/marks") : null}
        {allowed.notes && !data.unassigned ? tile("note", "mic", p("Note about a child", "बच्चे पर नोट"), V("accs"), V("accfg"), "/teach/notes?sheet=add") : null}
        {tile("leave", "calMinus", p("Ask for leave", "छुट्टी माँगें"), V("warns"), V("warnfg"), null)}
        {data.tasks.length ? tile("tasks", "inbox", p("My tasks", "मेरे काम"), V("infos"), V("info"), "/teach/tasks") : null}
      </div>
    </div>
  );

  /* ---------------------------------------------------- marks links */
  const look = (entered: number, total: number): [string, string, string] =>
    total > 0 && entered >= total ? [V("ok"), tx(p(`All ${total} done ✓`, `सभी ${total} पूरे ✓`)), V("ok")] : entered > 0 ? [V("acc"), tx(p(`${entered} of ${total} done`, `${total} में से ${entered} पूरे`)), V("accfg")] : [V("bds"), tx(p("Not started", "शुरू नहीं")), V("mut")];
  const oneSubject = new Set(data.links.map((l) => l.subjectCode)).size <= 1;
  const firstLink = data.links[0];
  const links = data.links.length ? (
    <div className="card tc-card" style={{ order: 6, animationDelay: "160ms" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <CardTitle t={p("Your marks links (Sampark)", "आपके अंक लिंक (संपर्क)")} />
        <Link href="/teach/more?view=links" className="tc-lnk">{tx(p("All links", "सभी लिंक"))}<Ic n="chevRight" /></Link>
      </div>
      {firstLink ? (
        <span className="tc-s" style={{ marginTop: -6 }}>
          {[tx(examWord(firstLink.exam, firstLink.examHi)), oneSubject ? tx(subjectPair(firstLink.subjectCode)) : null, firstLink.maxMarks ? tx(p(`out of ${firstLink.maxMarks}`, `${firstLink.maxMarks} में से`)) : null, tx(p("no login needed", "लॉगिन की ज़रूरत नहीं"))].filter(Boolean).join(" · ")}
        </span>
      ) : null}
      <div className="tc-lk">
        {data.links.map((l, i) => {
          const k = look(l.entered, l.total);
          return (
            <button key={l.paperId} type="button" className="tap lift tc-lt" onClick={() => { setLinkId(l.paperId); setSheet("link"); }} aria-label={`${l.classLabel} ${l.subjectCode} marks link, ${k[1]}`}>
              <LinkRing entered={l.entered} total={l.total} tone={k[0]} mid={`${l.entered}/${l.total}`} delay={200 + i * 120} />
              <span className="tc-p" style={{ fontWeight: 700 }}>{oneSubject ? tx(classWord(l.classLabel)) : tx(classSubject(l.classLabel, subjectPair(l.subjectCode)))}</span>
              <span style={{ fontSize: 12.5, fontWeight: 600, color: k[2] }}>{k[1]}</span>
            </button>
          );
        })}
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 6 }}>
        <span className="tc-s">{tx(p("Tap a class to open or share its link.", "लिंक खोलने या भेजने के लिए कक्षा दबाएँ।"))}</span>
        {allowed.marks ? <Link href="/teach/marks" className="tc-lnk">{tx(p("Enter marks here instead", "यहीं अंक भरें"))}<Ic n="arrowRight" /></Link> : null}
      </div>
    </div>
  ) : null;

  /* ------------------------------------------------------ subjects */
  const SUBJ_TONES: [string, string][] = [[V("accs"), V("accfg")], [V("infos"), V("info")], [V("oks"), V("ok")]];
  const subjects = data.subjects.length ? (
    <div className="card tc-card" style={{ order: 7, animationDelay: "220ms" }}>
      <CardTitle t={p("My subjects", "मेरे विषय")} />
      <div className="hs tc-sjw">
        {data.subjects.map((s, i) => (
          <Link key={`${s.classId}.${s.subjectId}`} href={`/teach/class?subject=${s.classId}.${s.subjectId}`} className="tap lift tc-sj">
            <span className="tc-ib" style={{ width: 40, height: 40, borderRadius: 12, background: SUBJ_TONES[i % 3][0], color: SUBJ_TONES[i % 3][1] }}><Ic n={subjectIcon(s.name)} /></span>
            <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
              <span style={{ fontWeight: 700 }}>{tx(classSubject(s.classLabel, p(s.name, s.nameHi)))}</span>
              <span className="tc-s">{tx(p(`${s.children} children${s.mine ? " · my class" : ""}`, `${s.children} बच्चे${s.mine ? " · मेरी कक्षा" : ""}`))}</span>
            </span>
          </Link>
        ))}
      </div>
    </div>
  ) : null;

  /* ------------------------------------------------------- sheets */
  const cur = data.notices.find((n) => n.id === newsId) ?? pinned;
  const curOther = cur ? (sub({ en: cur.bodyEn ?? "", hi: cur.bodyHi ?? undefined }) ?? null) : null;
  const cover = allCovers.find((c) => c.id === coverId) ?? null;
  // A covered period is over once its bell has rung, or on any earlier day (D-419).
  const coverOver = (c: { day: string; ends: string }) => {
    if (c.day < data.today) return true;
    if (c.day > data.today) return false;
    const m = /^(\d{1,2}):(\d{2})/.exec(c.ends);
    return m ? data.nowMinutes >= Number(m[1]) * 60 + Number(m[2]) : false;
  };
  const link = data.links.find((l) => l.paperId === linkId) ?? firstLink ?? null;
  const lk = link ? look(link.entered, link.total) : null;
  const leftCount = link ? Math.max(0, link.total - link.entered) : 0;
  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.show({ text: tx(p("Link copied · paste it in WhatsApp or a browser", "लिंक कॉपी हुआ · व्हाट्सऐप या ब्राउज़र में चिपकाएँ")) });
    } catch {
      toast.show({ text: tx(p("Could not copy", "कॉपी नहीं हुआ")), tone: "bad" });
    }
  };
  const helpTitle = p("How this screen works", "यह स्क्रीन कैसे चलाएँ");

  return (
    <VxPage className={`tc${large ? " t-large" : ""}`}>
      <TchTop
        crumb={`${tx(p("Teacher", "अध्यापक"))} · ${name} · ${tx(dShortP(data.today))}`}
        title={language === "hi" ? "आज · Today" : "Today"}
        actions={
          <>
            <LangSeg />
            <button type="button" className="tap btn sec" onClick={() => setSheet("help")}><Ic n="help" />{tx(p("Help", "मदद"))}</button>
            <button type="button" className="tap btn sec" aria-pressed={large} onClick={toggleLarge} disabled={pending} title={tx(p("Bigger text", "बड़े अक्षर"))}><Ic n="type" />{large ? tx(p("Normal text", "सामान्य अक्षर")) : tx(p("Bigger text", "बड़े अक्षर"))}</button>
            <button type="button" className="tap btn pri" onClick={() => setSheet("leave")}><Ic n="calMinus" />{tx(p("Ask for leave", "छुट्टी माँगें"))}</button>
          </>
        }
        mLead={
          <Link href="/teach/more" className="tap tc-av" aria-label={tx(p("My menu", "मेरा मेन्यू"))} style={{ width: 40, height: 40, background: "#F6D9A8", color: "#082F49", fontSize: 14 }}>
            {initials(name)}
          </Link>
        }
        mTitle={`${tx(p("Today", "आज"))}${sub(p("Today", "आज")) ? ` · ${sub(p("Today", "आज"))}` : ""}`}
        mSub={later ? `${tx(dShortP(data.today))} · ${hm12(`${Math.floor(data.nowMinutes / 60)}:${String(data.nowMinutes % 60).padStart(2, "0")}`)} ${data.nowMinutes >= 720 ? "pm" : "am"}` : [tx(dShortP(data.today)), classLabel ? tx(classWord(classLabel)) : null, data.subjects[0] ? tx(p(data.subjects[0].name, data.subjects[0].nameHi)) : null].filter(Boolean).join(" · ")}
        mAction={
          <>
            <LangSeg />
            {/* Bigger text one tap away on Today, not deep in My profile (smoke 20 Oct). */}
            <button type="button" className="tap btn ghost tc-x" aria-pressed={large} aria-label={large ? tx(p("Normal text", "सामान्य अक्षर")) : tx(p("Bigger text", "बड़े अक्षर"))} onClick={toggleLarge} disabled={pending} style={{ color: large ? "var(--acc)" : "var(--fg)" }}>
              <span aria-hidden="true" style={{ fontWeight: 800, fontSize: 17 }}>{large ? "A" : "A+"}</span>
            </button>
            <HelpIcon onClick={() => setSheet("help")} label={tx(p("Help", "मदद"))} />
          </>
        }
      />
      <div className="vx-pmain">
        <div className="pad" style={{ padding: "24px 28px 48px", display: "flex", flexDirection: "column", gap: 18, maxWidth: 1260, margin: "0 auto", width: "100%" }}>
          <div className="tc-in" style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            <span className="serif tc-gr" style={{ fontSize: 30, fontWeight: 600, lineHeight: 1.15 }}>{tx(greet)}, {callName(shortName, name)}</span>
            <span className="tc-p hide-m" style={{ color: "var(--mut)" }}>{context}</span>
            {heldLine ? <span className="tc-p only-m" style={{ color: "var(--mut)" }}>{tx(heldLine)}</span> : null}
          </div>
          <div className="stack" style={{ display: "grid", gridTemplateColumns: "minmax(0, 1.25fr) minmax(0, 1fr)", gap: 18, alignItems: "start" }}>
            <div className="tc-col">
              {welcome}
              <ReadyForYou order={3} />
              <LazyAwayReports reports={data.awayReports} today={data.today} />
              {unsavedCard}
              {leaveCard}
              {coverAsk}
              {classesCard}
              {hero}
              {periods}
              {kids}
            </div>
            <div className="tc-col">
              {bolo ? <div style={{ order: 6 }}>{bolo}</div> : null}
              {tasksCard}
              {office}
              {quick}
              {links}
              {subjects}
            </div>
          </div>
        </div>
      </div>

      {/* ------------------------------------------------------- notices */}
      <Sheet
        open={sheet === "news" && Boolean(cur)}
        onClose={() => setSheet(null)}
        title={tx(p("Notice from the office", "कार्यालय की सूचना"))}
        sub={tx(p("Tap “I have read it” so the office knows", "“पढ़ लिया” दबाएँ ताकि ऑफ़िस को पता चले"))}
        footer={
          cur && !seen.has(cur.id) ? (
            <button type="button" className="tap btn pri tc-bb" style={{ flex: 1 }} disabled={pending} onClick={() => gotIt([cur.id])}>
              <Ic n="check" />
              {tx(p("I have read it", "पढ़ लिया"))}
              {sub(p("I have read it", "पढ़ लिया")) ? ` · ${sub(p("I have read it", "पढ़ लिया"))}` : ""}
            </button>
          ) : (
            <button type="button" className="tap btn sec tc-bb" style={{ flex: 1 }} onClick={() => setSheet(null)}>{tx(p("Close", "बंद करें"))}</button>
          )
        }
      >
        {cur ? (
          <div className="tc-sb">
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span className="tc-av" style={{ width: 40, height: 40, background: "#81DAE4", color: "#082F49", fontSize: 13 }}>{initials(cur.fromName)}</span>
              <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
                <span style={{ fontWeight: 600 }}>{cur.fromName}</span>
                <span className="tc-s">{tx(whenSent(cur.createdAt, data.today))} · {tx(p("to all teachers", "सभी शिक्षकों को"))}</span>
              </span>
              {cur.id === pinned?.id ? <span className="pill" style={{ background: "var(--accs)", color: "var(--accfg)" }}>{tx(p("Pinned", "पिन"))}</span> : null}
            </div>
            <span className="serif" style={{ fontSize: 21, fontWeight: 600, lineHeight: 1.3 }}>{cur.title}</span>
            {body(cur) ? <span className="tc-p" style={{ lineHeight: 1.55, whiteSpace: "pre-wrap" }}>{body(cur)}</span> : null}
            {curOther ? (
              <div className="tc-note" style={{ background: "var(--s2)", flexDirection: "column", gap: 4 }}>
                <span style={{ color: "var(--mut)", whiteSpace: "pre-wrap" }}>{curOther}</span>
              </div>
            ) : null}
            {seen.has(cur.id) ? (
              <div className="tc-note tc-pop" style={{ background: "var(--oks)", color: "var(--ok)" }}>
                <Ic n="checkCircle" />
                <span style={{ fontWeight: 600 }}>{tx(p("Seen ✓ · the office can see you have read it", "देख लिया ✓ · ऑफ़िस देख सकता है"))}</span>
              </div>
            ) : null}
            {data.notices.length > 1 ? <span className="sech" style={{ marginTop: 4 }}>{tx(p("Other notices", "दूसरी सूचनाएँ"))}</span> : null}
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {data.notices
                .filter((n) => n.id !== cur.id)
                .map((n) => {
                  const k = state(n.id);
                  return (
                    <button key={n.id} type="button" className="tap tc-opt" onClick={() => setNewsId(n.id)}>
                      <span style={{ flex: "none", width: 9, height: 9, borderRadius: 5, background: k[0] }} />
                      <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
                        <span className="tc-el" style={{ fontWeight: 600 }}>{n.title}</span>
                        <span className="tc-s">{tx(whenSent(n.createdAt, data.today))}</span>
                      </span>
                      <span className="pill" style={{ background: k[2], color: k[3] }}>{k[1]}</span>
                    </button>
                  );
                })}
            </div>
          </div>
        ) : (
          <span />
        )}
      </Sheet>

      {/* ---------------------------------------------------- substitution */}
      <Sheet
        open={sheet === "subs"}
        onClose={() => { setSheet(null); setCantOpen(false); }}
        title={tx(p("Substitution for you", "आपके लिए सब्स्टिट्यूशन"))}
        sub={cover ? tx(p(`${cover.day === data.today ? "Today" : dShort(cover.day)} · P${cover.number} · asked by the office at ${ampm(cover.askedAt)}`, `${cover.day === data.today ? "आज" : shortDayHi(cover.day)} · P${cover.number} · ऑफ़िस ने ${timeHi(cover.askedAt)} बजे पूछा`)) : undefined}
        footer={
          !cover ? undefined : cover.acknowledged ? (
            <button type="button" className="tap btn pri tc-bb" style={{ flex: 1 }} onClick={() => setSheet(null)}>{tx(p("Done", "ठीक है"))}</button>
          ) : cantOpen ? (
            <>
              <button type="button" className="tap btn ghost tc-bb" onClick={() => setCantOpen(false)}>{tx(p("Back", "पीछे"))}</button>
              <button type="button" className="tap btn pri tc-bb" style={{ flex: 1 }} disabled={pending || why === null} onClick={() => why !== null && answer(cover.id, "cannot_cover", [WHY_NOT[why].en, whyNote.trim()].filter(Boolean).join(" — "))}>
                <Ic n="send" />
                {tx(p("Tell the office", "ऑफ़िस को बताएँ"))}
              </button>
            </>
          ) : (
            <>
              <button type="button" className="tap btn sec tc-bb" style={{ flex: 1 }} onClick={() => setCantOpen(true)}>{tx(p("I can’t", "नहीं ले पाएँगे"))}</button>
              <button type="button" className="tap btn pri tc-bb" style={{ flex: 1.4 }} disabled={pending} onClick={() => answer(cover.id, "acknowledge")}>
                <Ic n="check" />
                {tx(p("I’ll take it", "हाँ, ले लेंगे"))}
              </button>
            </>
          )
        }
      >
        {cover ? (
          <div className="tc-sb">
            <div style={{ display: "flex", alignItems: "center", gap: 14, padding: 14, borderRadius: 16, background: "var(--warns)", border: "1px solid var(--warnm)" }}>
              <span className="tc-ib" style={{ width: 52, height: 52, borderRadius: 16, background: "var(--card)", color: "var(--warnfg)" }}><Ic n="swap" size={26} /></span>
              <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
                <span style={{ fontWeight: 700, fontSize: 18 }}>P{cover.number} · {hm12(cover.starts)} – {hm12(cover.ends)}</span>
                <span style={{ fontWeight: 600 }}>{tx(coverWhat(cover))}</span>
                <span className="tc-s">{tx(p(`for ${cover.forName}`, `${cover.forName} की जगह`))}</span>
              </span>
            </div>
            <span className="tc-p">{cover.day === data.today ? tx(p(`${cover.forName} is away today. The office asked you to take P${cover.number}.`, `${cover.forName} आज नहीं हैं। ऑफ़िस ने आपसे P${cover.number} लेने को कहा है।`)) : tx(p(`${cover.forName} will be away on ${dShort(cover.day)}. The office asked you to take P${cover.number} that day.`, `${cover.forName} ${shortDayHi(cover.day)} को नहीं होंगे। ऑफ़िस ने आपसे उस दिन P${cover.number} लेने को कहा है।`))}</span>
            {cover.reason ? (
              <div className="tc-note" style={{ background: "var(--s2)", flexDirection: "column", gap: 4 }}>
                <span className="sech">{tx(p("Note from the office", "ऑफ़िस का नोट"))}</span>
                <span className="tc-p">“{cover.reason}”</span>
              </div>
            ) : null}
            {cantOpen && !cover.acknowledged ? (
              <div className="tc-in" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <span className="sech">{tx(p("Why can’t you take it?", "क्यों नहीं ले पाएँगे?"))}</span>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                  {WHY_NOT.map((w, i) => (
                    <button key={w.en} type="button" className={`tap chip${why === i ? " on" : ""}`} aria-pressed={why === i} onClick={() => setWhy(i)} style={{ height: 44, padding: "0 16px", fontSize: 14 }}>{tx(w)}</button>
                  ))}
                </div>
                <label className="field">
                  <span>{tx(p("Anything else for the office (optional)", "ऑफ़िस के लिए और कुछ (वैकल्पिक)"))}</span>
                  <input className="inp" type="text" maxLength={150} value={whyNote} onChange={(e) => setWhyNote(e.target.value)} placeholder={tx(p("For example: I have Class 8 practical at that time", "जैसे: उस समय कक्षा 8 का प्रैक्टिकल है"))} />
                </label>
              </div>
            ) : null}
            {cover.acknowledged ? (
              <div className="tc-note tc-pop" style={{ background: "var(--oks)", color: "var(--ok)" }}>
                <Ic n="check" />
                <span style={{ fontWeight: 600 }}>{tx(p(`You’re covering P${cover.number} · ${classesWord(cover.classLabels).en}`, `आप P${cover.number} ले रहे हैं · ${classesWord(cover.classLabels).hi}`))}</span>
              </div>
            ) : null}
            {!cantOpen && cover.acknowledged && coverOver(cover) ? (
              <LazyCoverReportForm key={`r${cover.id}`} dutyId={cover.id} forName={cover.forName} existing={data.coverReports[cover.id] ?? null} />
            ) : null}
            {!cantOpen && !(cover.acknowledged && coverOver(cover)) ? <LazyCoverAssist key={cover.id} coverId={cover.id} classLabels={cover.classLabels} subject={cover.subjectName || null} starts={cover.starts} ends={cover.ends} /> : null}
          </div>
        ) : (
          <span className="tc-p" style={{ color: "var(--mut)" }}>{tx(p("No cover duty today.", "आज कोई सब्स्टिट्यूशन नहीं।"))}</span>
        )}
      </Sheet>

      {/* ------------------------------------------------------ marks link */}
      <Sheet open={sheet === "link"} onClose={() => setSheet(null)} title={tx(p("Your marks link", "अंक लिंक"))} sub={link ? `Sampark · ${tx(examWord(link.exam, link.examHi))} · ${tx(subjectPair(link.subjectCode))}` : undefined}>
        {link && lk ? (
          <div className="tc-sb">
            <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
              <LinkRing entered={link.entered} total={link.total} size={84} tone={lk[0]} mid={`${link.entered}/${link.total}`} font={16} />
              <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
                <span style={{ fontWeight: 700, fontSize: 18 }}>{tx(classSubject(link.classLabel, subjectPair(link.subjectCode)))} · {tx(examWord(link.exam, link.examHi))}</span>
                <span style={{ fontWeight: 600, color: lk[2] }}>{lk[1]}</span>
                <span className="tc-s">{[link.maxMarks ? tx(p(`Out of ${link.maxMarks}`, `${link.maxMarks} में से`)) : null, link.url ? tx(p("works without a password", "बिना पासवर्ड खुलता है")) : null].filter(Boolean).join(" · ")}</span>
              </span>
            </div>
            <div className="tc-bar"><span style={{ width: `${link.total ? Math.round((link.entered / link.total) * 100) : 0}%`, background: lk[0] }} /></div>
            <a href={link.url ?? `/teach/marks?paper=${link.paperId}`} className="tap btn pri tc-bb">
              <Ic n="link" />
              {link.total > 0 && link.entered >= link.total ? tx(p("Open to check marks", "अंक जाँचने के लिए खोलें")) : link.entered ? tx(p(`Open and continue · ${leftCount} left`, `खोलें और जारी रखें · ${leftCount} बाकी`)) : tx(p("Open and start", "खोलें और शुरू करें"))}
            </a>
            {link.url ? (
              <>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 10 }} className="tc-g1m">
                  <a href={`https://wa.me/?text=${encodeURIComponent(link.url)}`} target="_blank" rel="noreferrer" className="tap btn soft tc-bb"><Ic n="message" />{tx(p("Share on WhatsApp", "व्हाट्सऐप पर भेजें"))}</a>
                  <button type="button" className="tap btn sec tc-bb" onClick={() => void copy(link.url ?? "")}><Ic n="copy" />{tx(p("Copy link", "लिंक कॉपी करें"))}</button>
                </div>
                <div className="tc-note" style={{ background: "var(--infos)", color: "var(--info)" }}>
                  <Ic n="info" style={{ marginTop: 2 }} />
                  <span>{tx(p("This link is only for you. It opens straight to your marks sheet — no password needed. Share it with yourself to open it on another phone.", "यह लिंक सिर्फ़ आपके लिए है। यह सीधे आपकी अंक शीट खोलता है — पासवर्ड नहीं चाहिए। दूसरे फ़ोन पर खोलने के लिए इसे खुद को भेजें।"))}</span>
                </div>
              </>
            ) : (
              <div className="tc-note" style={{ background: "var(--s2)" }}>
                <Ic n="info" style={{ marginTop: 2, color: "var(--acc)" }} />
                <span>{tx(p("Your no-login link for this exam is not made yet. Make it on the Marks page, or ask the exam office.", "इस परीक्षा का आपका बिना-लॉगिन लिंक अभी नहीं बना। अंक पेज पर बनाएँ, या परीक्षा विभाग से कहें।"))}</span>
              </div>
            )}
            <Link href={`/teach/marks?paper=${link.paperId}`} className="tc-lnk" style={{ alignSelf: "flex-start" }}>
              {tx(p("Enter marks here instead", "यहीं अंक भरें"))}
              {sub(p("Enter marks here instead", "यहीं अंक भरें")) ? ` · ${sub(p("Enter marks here instead", "यहीं अंक भरें"))}` : ""}
              <Ic n="arrowRight" />
            </Link>
          </div>
        ) : (
          <span className="tc-p" style={{ color: "var(--mut)" }}>{tx(p("No papers waiting for marks.", "कोई पेपर बाकी नहीं।"))}</span>
        )}
      </Sheet>

      {/* ------------------------------------------------------ birthday */}
      <Sheet
        open={sheet === "wish"}
        onClose={() => setSheet(null)}
        title={tx(p("Birthday wishes", "जन्मदिन की शुभकामना"))}
        sub={wishKid ? tx(p(`${wishKid.name} · ${classLabel} · turns ${wishKid.turning} today`, `${wishKid.name} · ${classHi} · आज ${wishKid.turning} साल`)) : undefined}
        footer={
          wishKid ? (
            <>
              <button type="button" className="tap btn sec tc-bb" style={{ flex: 1 }} onClick={() => setSheet(null)}>{tx(p("Not now", "अभी नहीं"))}</button>
              <button type="button" className="tap btn pri tc-bb" style={{ flex: 1.4 }} disabled={pending} onClick={sendWish}><Ic n="send" />{tx(p("Send wishes", "शुभकामना भेजें"))}</button>
            </>
          ) : undefined
        }
      >
        {wishKid && wishText ? (
          <div className="tc-sb">
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <span className="tc-av" style={{ width: 44, height: 44, background: "var(--warns)", color: "var(--warnfg)" }}><Ic n="cake" /></span>
              <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
                <span style={{ fontWeight: 600 }}>{tx(p(`To ${wishKid.name.split(" ")[0]}’s parents`, `${wishKid.name.split(" ")[0]} के माता-पिता को`))}</span>
                <span className="tc-s">{tx(p("From the school’s WhatsApp", "स्कूल के व्हाट्सऐप से"))}</span>
              </span>
            </div>
            <div className="tc-wa">
              <div>
                <span style={{ display: "block" }}>{wishText.hi}</span>
                <span style={{ display: "block", marginTop: 6, opacity: 0.8 }}>{wishText.en}</span>
                <span className="num" style={{ display: "block", textAlign: "right", fontSize: 11, opacity: 0.6 }}>now ✓✓</span>
              </div>
            </div>
            <span className="tc-s">{tx(p("Hindi first, English below · 1 parent · the office sends it from the school’s WhatsApp, not your own number.", "पहले हिंदी, नीचे अंग्रेज़ी · 1 अभिभावक · ऑफ़िस इसे स्कूल के व्हाट्सऐप से भेजता है, आपके नंबर से नहीं।"))}</span>
          </div>
        ) : (
          <span className="tc-p" style={{ color: "var(--mut)" }}>{tx(p("No birthdays today.", "आज किसी का जन्मदिन नहीं।"))}</span>
        )}
      </Sheet>

      <LeaveSheet open={sheet === "leave"} onClose={() => setSheet(null)} today={data.today} closedDays={data.closedDays} />
      <HelpSheet open={sheet === "help"} onClose={() => setSheet(null)} title={helpTitle} sub={p("3 easy steps", "यह स्क्रीन 3 आसान कदमों में")} steps={HELP[kind]} phone={officePhone} />
    </VxPage>
  );
}
