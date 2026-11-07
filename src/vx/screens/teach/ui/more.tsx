"use client";

import { PrivatePhoto } from "@/modules/collection/ui/private-photo";
import { ProfilePhotoControl } from "@/modules/collection/ui/profile-photo-editor";
import Link from "@/ui/link";
import * as m from "@/messages/pairs";
import { useRouter } from "next/navigation";
import { useSyncExternalStore, useState, useTransition, type ReactNode } from "react";
import { useTheme } from "next-themes";

import { logoutAction } from "@/app/login/actions";
import { saveLanguageAction } from "@/app/(app)/preferences/actions";
import { Ic, type IconName } from "@/vx/icons";
import { useVx } from "@/vx/i18n";
import { agoP, initials, shortDayHi, timeHi } from "@/vx/format";
import { p, type Pair } from "@/vx/text";
import { FeedbackSwitches } from "@/vx/ui/feedback-switches";
import { useToast } from "@/vx/ui/overlays";
import { VxPage } from "@/vx/ui/page";

import { cancelLeaveVx, noticeSeenVx, setAlertVx, setTextSizeVx } from "../actions";
import type { MoreData } from "../data";
import { spanPeriods } from "@/vx/screens/timetable/domain/timetable";
import { classesWord, classSubject, classWord, closedTitle, combinedClasses, coverLine, examWord, leaveState, LEAVE_STATE_TEXT, marksTileLine, mayCancelLeave, subjectWord } from "../domain/today";
import { ampm, callName, dShort, dShortP, greetingPair, hm12, shortClass, andList } from "./fmt";
import { DeskHelp, HelpIcon, LangSeg, LeaveSheet, TchTop, useUrlState, WithdrawConfirm } from "./shared";
import "./today.css";
import { sessionText } from "@/platform/helpers/session-text";

/*
 * Teacher · Notices, links & more (design TchMore): the phone's More menu as
 * tiles, the office's notices with Got it, her marks links (open, share,
 * copy, or make one), her week, her leave, picture help and her profile
 * (language, text size, dark mode, alerts, sign out). `?view=` picks one;
 * `?sheet=leave` opens the leave form over My leave.
 */

export type MoreView = "menu" | "news" | "links" | "timetable" | "leave" | "help" | "profile";

const V = (x: string) => `var(--${x})`;
type Tone = [string, string];
const TA: Tone = [V("accs"), V("accfg")];
const TI: Tone = [V("infos"), V("info")];
const TO: Tone = [V("oks"), V("ok")];
const TW: Tone = [V("warns"), V("warnfg")];
const TS: Tone = [V("s3"), V("fg")];

const LEAVE_STATUS: Record<string, { text: Pair; tone: Tone; icon: IconName }> = {
  asked: { text: p("Waiting for the office", "ऑफ़िस का जवाब बाकी"), tone: TW, icon: "clock" },
  approved: { text: p("Approved", "मंज़ूर"), tone: TO, icon: "check" },
  declined: { text: p("Declined", "नामंज़ूर"), tone: [V("bads"), V("bad")], icon: "x" },
  cancelled: { text: p("Cancelled", "रद्द"), tone: TS, icon: "x" },
};

const SPAN: Record<string, Pair> = { full: p("Full day", "पूरा दिन"), first_half: p("First half", "पहली पाली"), second_half: p("Second half", "दूसरी पाली") };

const ALERTS: { key: string; icon: IconName; text: Pair; sub: Pair; tone: Tone }[] = [
  { key: "notices", icon: "bell", text: p("WhatsApp alerts for notices", "सूचनाओं के व्हाट्सऐप अलर्ट"), sub: p("WhatsApp when a notice comes", "सूचना आने पर व्हाट्सऐप"), tone: TO },
  { key: "cover", icon: "swap", text: p("Cover requests", "सब्स्टिट्यूशन"), sub: p("When you are asked to take a class", "जब आपको कक्षा लेने को कहा जाए"), tone: TW },
  { key: "followups", icon: "flag", text: p("Follow-ups due", "फ़ॉलो-अप"), sub: p("Notes you said you would follow up", "जिन नोट्स पर फ़ॉलो-अप करना है"), tone: TI },
  { key: "marks", icon: "clipboard", text: p("Marks deadlines", "अंक की अंतिम तिथि"), sub: p("Before marks entry closes", "अंक भरना बंद होने से पहले"), tone: TA },
];

const DAY_ORDER = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
const DAY_HI: Record<string, string> = { mon: "सोम", tue: "मंगल", wed: "बुध", thu: "गुरु", fri: "शुक्र", sat: "शनि", sun: "रवि" };
const dayKey = (d: string) => d.trim().toLowerCase().slice(0, 3);
const mins = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
};
const CLASS_TONES: [string, string, string][] = [[V("accs"), V("accfg"), V("c2")], [V("infos"), V("info"), V("c1")], [V("oks"), V("ok"), V("ok")], [V("warns"), V("warnfg"), V("warn")], [V("s3"), V("fg"), V("c4")]];

const noSubscribe = () => () => {};

export function TeachMore({
  data,
  initialView,
  initialSheet,
  makeLink,
  officePhone,
}: {
  data: MoreData;
  initialView: MoreView;
  initialSheet: string | null;
  /** Make her own no-login marks link for an exam (UI-56), when she may enter marks. */
  makeLink?: (examId: string) => Promise<{ ok: boolean; message?: Pair }>;
  officePhone?: string;
}) {
  const { tx, sub, language } = useVx();
  const router = useRouter();
  const toast = useToast();
  const [view, setView] = useUrlState<MoreView>("view", initialView === "menu" ? null : initialView);
  const [sheet, setSheet] = useUrlState<"leave">("sheet", initialSheet === "leave" ? "leave" : null);
  const [seen, setSeen] = useState<Set<string>>(() => new Set(data.notices.filter((n) => n.seen).map((n) => n.id)));
  const [nf, setNf] = useState<"all" | "unread">("all");
  const [large, setLarge] = useState(data.profile.largeText);
  const [alerts, setAlerts] = useState<Record<string, boolean>>(data.profile.alerts);
  // Help opens on what this teacher does: attendance only for a class teacher,
  // marks for a subject teacher, leave for one with nothing assigned yet (smoke 6 Nov).
  const [topic, setTopic] = useState<HelpTopic>(() => (data.profile.classes.some((c) => c.held) ? "att" : data.profile.classes.length ? "marks" : "leave"));
  const [pending, start] = useTransition();
  // Withdrawing a leave request asks once first (6 Nov school day).
  const [askWithdraw, setAskWithdraw] = useState<string | null>(null);
  const current: MoreView = view ?? "menu";
  const unread = data.notices.filter((n) => !seen.has(n.id));

  // A new view opens at its top (smoke 20 Oct: the timetable opened scrolled to P3, its day buttons out of sight).
  const go = (v: MoreView) => {
    setView(v === "menu" ? null : v);
    if (typeof window !== "undefined") {
      window.scrollTo({ top: 0 });
      document.querySelectorAll<HTMLElement>(".vx-main, .vx-page > main").forEach((el) => el.scrollTo?.({ top: 0 }));
    }
  };

  const gotIt = (ids: string[]) =>
    start(async () => {
      const res = await noticeSeenVx(ids);
      if (res.ok) {
        setSeen((cur) => new Set([...cur, ...ids]));
        if (ids.length > 1) toast.show({ text: tx(p(`${ids.length} notices marked as seen`, `${ids.length} सूचनाएँ देख लीं`)) });
      } else toast.show({ text: tx(res.error), tone: "bad" });
    });

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.show({ text: tx(p("Copied", "कॉपी हो गया")) });
    } catch {
      toast.show({ text: tx(p("Could not copy", "कॉपी नहीं हुआ")), tone: "bad" });
    }
  };

  /* ---------------------------------------------------- the week */
  const todayKey = dayKey(new Date(`${data.today}T12:00:00+05:30`).toLocaleDateString("en-GB", { weekday: "short", timeZone: "Asia/Kolkata" }));
  const days = [...new Set(data.week.map((w) => w.day))].sort((a, b) => DAY_ORDER.indexOf(dayKey(a)) - DAY_ORDER.indexOf(dayKey(b)));
  const numbers = [...new Set([...data.periodTimes.map((t) => t.number), ...data.week.map((w) => w.number)])].sort((a, b) => a - b);
  const timeOf = (n: number) => data.periodTimes.find((t) => t.number === n);
  const classOrder = [...new Set(data.week.map((w) => w.classLabel))];
  const toneOf = (label: string) => CLASS_TONES[Math.max(0, classOrder.indexOf(label)) % CLASS_TONES.length];
  // No period is "now" on a closed day, or in the part of the day she is on approved leave (smoke 20 Oct).
  const onLeave = (period: number) => data.leaveToday !== null && spanPeriods(data.leaveToday as "full" | "first_half" | "second_half").includes(period);
  const teachingToday = data.closed === null;
  const nowSlot = teachingToday ? (data.week.find((w) => dayKey(w.day) === todayKey && w.starts && w.ends && data.nowMinutes >= mins(w.starts) && data.nowMinutes < mins(w.ends) && !onLeave(w.period)) ?? null) : null;
  const subjectNames = new Map(Object.entries(data.subjectNames));
  const subj = (code: string) => tx(subjectWord(code, subjectNames));
  const slotWho = (label: string) => (label.includes("·") ? tx(combinedClasses(label)) : held.some((h) => h.classLabel === label) ? tx(p("my class", "मेरी कक्षा")) : tx(classWord(label)));
  const subjectsLine = (() => {
    const bySubject = new Map<string, string[]>();
    for (const w of data.week) bySubject.set(w.subjectCode, [...new Set([...(bySubject.get(w.subjectCode) ?? []), shortClass(w.classLabel)])]);
    return [...bySubject.entries()].map(([s, cls]) => tx(p(`${subjectWord(s, subjectNames).en} for Classes ${andList(cls)}`, `कक्षा ${andList(cls, "और")} ${subjectWord(s, subjectNames).hi}`))).join(" · ");
  })();
  const held = data.profile.classes.filter((c) => c.held);
  const roleLine = [held.length ? tx(p(`${held.map((c) => c.classLabel).join(", ")} class teacher`, `${held.map((c) => classWord(c.classLabel).hi ?? c.classLabel).join(", ")} की कक्षा अध्यापक`)) : null, subjectsLine || null].filter(Boolean).join(" · ");

  /* ---------------------------------------------------- top bar */
  const helpFor: Partial<Record<MoreView, HelpTopic>> = { news: "news", links: "link", leave: "leave", timetable: "leave", profile: "me" };
  const T: Record<MoreView, [string, Pair, string]> = {
    menu: [tx(p(`Teacher · ${sessionText(data.sessionLabel)}`, `अध्यापक · ${data.sessionLabel}`)), p("More", "और"), `${data.profile.name}${held[0] ? ` · ${tx(classWord(held[0].classLabel))}` : ""}`],
    news: [tx(p("More · Notices", "और · सूचनाएँ")), p("Notices", "सूचनाएँ"), unread.length ? tx(p(`${unread.length} new`, `${unread.length} नई`)) : tx(p("All read", "सब पढ़ लीं"))],
    links: [tx(p("More · Marks links", "और · अंक लिंक")), p("Marks links", "अंक लिंक"), tx(p("Sampark · no login needed", "संपर्क · लॉगिन नहीं चाहिए"))],
    timetable: [tx(p("More · Timetable", "और · समय-सारणी")), p("My timetable", "मेरी समय-सारणी"), tx(p(`${data.week.length} periods a week`, `हफ़्ते में ${data.week.length} पीरियड`))],
    leave: [tx(p("More · Leave", "और · छुट्टी")), p("My leave", "मेरी छुट्टियाँ"), tx(p(`${data.leave.filter((l) => l.status === "asked").length} waiting for approval`, `${data.leave.filter((l) => l.status === "asked").length} मंज़ूरी बाकी`))],
    help: [tx(p("More · Help", "और · मदद")), p("Help", "मदद"), tx(p("How do I…", "कैसे करें…"))],
    profile: [tx(p("More · My profile", "और · मेरी प्रोफ़ाइल")), p("My profile", "मेरी प्रोफ़ाइल"), tx(p("Language, text size, dark mode", "भाषा, आकार, डार्क मोड"))],
  };
  const [crumb, titleP, mSub] = T[current];
  const openHelp = () => { setTopic(helpFor[current] ?? topic); go("help"); };
  const helpLabel = tx(p("Help", "मदद"));
  const back = (
    <button type="button" className="tap btn ghost tc-x" aria-label={tx(p("Back", "पीछे"))} onClick={() => go("menu")} style={{ color: "var(--fg)" }}>
      <Ic n="chevLeft" size={22} />
    </button>
  );
  const me = (size: number, font: number, extra?: React.CSSProperties) => (
    <span className="tc-av serif" style={{ width: size, height: size, fontSize: font, background: "#F6D9A8", color: "#082F49", ...extra }}>{data.profile.photoUrl ? <PrivatePhoto src={data.profile.photoUrl} alt="" style={{width:"100%",height:"100%",objectFit:"cover",borderRadius:"inherit"}} /> : initials(data.profile.name)}</span>
  );

  /* ---------------------------------------------------- menu */
  const firstOpen = data.links.find((l) => !l.submitted && l.entered < l.total) ?? null;
  const asked = data.leave.filter((l) => l.status === "asked").length;
  type Tile = { k: string; icon: IconName; t: Pair; info: string; tone: Tone; href?: string; onClick?: () => void; badge?: number; wide?: boolean; news?: string };
  const tiles: Tile[] = [
    { k: "home", icon: "home", t: p("Today", "आज"), info: data.closed ? tx(closedTitle(data.closed)) : nowSlot ? tx(p(`P${nowSlot.number} ${nowSlot.classLabel} ${subj(nowSlot.subjectCode)} now`, `अभी P${nowSlot.number} ${classesWord(nowSlot.classLabel).hi} ${subjectWord(nowSlot.subjectCode, subjectNames).hi}`)) : tx(p("Your day at a glance", "आपका दिन एक नज़र में")), tone: TA, href: "/teach" },
    { k: "att", icon: "calCheck", t: p("Attendance", "हाज़िरी"), info: held[0] ? tx(p(`${held[0].classLabel}${data.classSizes[held[0].classId] ? ` · ${data.classSizes[held[0].classId]} children` : ""}`, `${classWord(held[0].classLabel).hi}${data.classSizes[held[0].classId] ? ` · ${data.classSizes[held[0].classId]} बच्चे` : ""}`)) : tx(p("Class registers", "कक्षा हाज़िरी")), tone: TO, href: "/teach/attendance" },
    { k: "class", icon: "users", t: p("My class", "मेरी कक्षा"), info: held[0] ? tx(p(`${held[0].classLabel} and my subjects`, `${classWord(held[0].classLabel).hi} और विषय`)) : tx(p("My subjects", "मेरे विषय")), tone: TI, href: "/teach/class" },
    { k: "marks", icon: "clipboard", t: p("Marks", "अंक"), info: tx(marksTileLine(firstOpen, data.remarks)), tone: TW, href: "/teach/marks" },
    { k: "notes", icon: "note", t: p("Notes", "नोट्स"), info: tx(p("Notes on children", "बच्चों के नोट्स")), tone: TS, href: "/teach/notes" },
    { k: "tasks", icon: "inbox", t: m.teacherTasks, info: data.tasks.length ? tx(p(`${data.tasks.length} waiting for you`, `${data.tasks.length} काम बाकी`)) : tx(p("Work sent by the office", "ऑफ़िस से भेजा गया काम")), tone: TW, href: "/teach/tasks", badge: data.tasks.length },
    { k: "news", icon: "megaphone", t: p("Notices", "सूचनाएँ"), info: unread.length ? tx(p(`${unread.length} new`, `${unread.length} नई`)) : tx(p("All read", "सब पढ़ लीं")), tone: TA, onClick: () => go("news"), badge: unread.length, wide: true, news: data.notices[0]?.title },
    { k: "links", icon: "link", t: p("Marks links", "अंक लिंक"), info: tx(p(`${data.links.length} ${data.links.length === 1 ? "link" : "links"}`, `${data.links.length} लिंक`)), tone: TI, onClick: () => go("links") },
    { k: "tt", icon: "clock", t: p("Timetable", "समय-सारणी"), info: tx(p(`${data.week.length} periods a week`, `हफ़्ते में ${data.week.length} पीरियड`)), tone: TS, onClick: () => go("timetable") },
    { k: "leave", icon: "calendar", t: p("My leave", "मेरी छुट्टी"), info: asked ? tx(p(`${asked} waiting for the office`, `${asked} पर ऑफ़िस का जवाब बाकी`)) : tx(p("See your requests or ask for leave", "अपने अनुरोध देखें या छुट्टी माँगें")), tone: TW, onClick: () => go("leave") },
    { k: "help", icon: "help", t: p("Help", "मदद"), info: tx(p("How do I…", "कैसे करें…")), tone: TO, onClick: () => go("help") },
    { k: "me", icon: "user", t: p("My profile", "मेरी प्रोफ़ाइल"), info: tx(p("Language, text size", "भाषा, अक्षर का आकार")), tone: TS, onClick: () => go("profile") },
  ];
  const tileBody = (t: Tile) => (
    <>
      <span className="tc-ibx" style={{ background: t.tone[0], color: t.tone[1] }}><Ic n={t.icon} size={22} /></span>
      <span style={{ display: "flex", flexDirection: "column" }}>
        <span style={{ fontSize: 16, fontWeight: 700 }}>{tx(t.t)}</span>
        {sub(t.t) ? <span className="tc-mi">{sub(t.t)}</span> : null}
      </span>
      <span style={{ fontSize: 12, color: "var(--mut)" }}>{t.info}</span>
      {t.news ? <span className="tc-tb" style={{ fontWeight: 600, paddingTop: 8, borderTop: "1px solid var(--bd)" }}>{t.news}</span> : null}
      {t.badge ? <span className="tc-bdg tc-pop num">{t.badge}</span> : null}
    </>
  );
  const greet = greetingPair(data.nowMinutes);
  const menu = (
    <div className="tc-scr" style={{ maxWidth: 1120 }}>
      <div className="card" style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 14, padding: "18px 20px", background: "var(--nav)", color: "var(--navfg)", borderColor: "transparent" }}>
        {me(56, 16)}
        <span style={{ flex: 1, minWidth: 190, display: "flex", flexDirection: "column" }}>
          <span className="serif" style={{ fontSize: 22, fontWeight: 600 }}>{tx(greet)}, {callName(data.profile.shortName, data.profile.name)}</span>
          <span className="tc-ts" style={{ color: "var(--navm)" }}>{roleLine}</span>
        </span>
        {nowSlot ? (
          <span className="tc-ts" style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 600, padding: "8px 12px", borderRadius: 12, background: "var(--navs)" }}>
            <span className="tc-dot" style={{ background: "#81DAE4", animation: "xPulse 2s ease infinite" }} />
            {tx(p(`Now · P${nowSlot.number} ${nowSlot.classLabel} ${subjectWord(nowSlot.subjectCode, subjectNames).en} till ${hm12(nowSlot.ends)}`, `अभी · P${nowSlot.number} ${classesWord(nowSlot.classLabel).hi} ${subjectWord(nowSlot.subjectCode, subjectNames).hi}, ${hm12(nowSlot.ends)} तक`))}
          </span>
        ) : null}
      </div>
      <div className="tc-tls">
        {tiles.map((t, i) =>
          t.href ? (
            <Link key={t.k} href={t.href} className="tap lift card tc-tile tc-in" style={{ gridColumn: t.wide ? "span 2" : "auto", animationDelay: `${Math.min(i, 14) * 30}ms` }}>{tileBody(t)}</Link>
          ) : (
            <button key={t.k} type="button" className="tap lift card tc-tile tc-in" onClick={t.onClick} style={{ gridColumn: t.wide ? "span 2" : "auto", animationDelay: `${Math.min(i, 14) * 30}ms` }}>{tileBody(t)}</button>
          ),
        )}
      </div>
    </div>
  );

  /* ---------------------------------------------------- notices */
  const shownN = data.notices.filter((n) => nf === "all" || !seen.has(n.id));
  const newsView = (
    <div className="stack tc-scr" style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) 300px", alignItems: "start", maxWidth: 1120 }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 14, minWidth: 0 }}>
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
          <span style={{ display: "flex", flexDirection: "column" }}>
            <span className="tc-h1">{tx(p("Notices", "सूचनाएँ"))}</span>
            <span className="tc-tb" style={{ color: "var(--mut)" }}>{tx(p("From the school office · tap “I have read it” after reading", "स्कूल ऑफ़िस से · पढ़कर “पढ़ लिया” दबाएँ"))}</span>
          </span>
          <div className="seg tc-mw" role="radiogroup" aria-label="Show" style={{ gridTemplateColumns: "repeat(2, minmax(0, 1fr))", width: 240 }}>
            <span className="thumb" aria-hidden="true" style={{ width: "calc((100% - 6px) / 2)", transform: `translateX(${nf === "unread" ? "100%" : "0%"})` }} />
            <button type="button" role="radio" aria-checked={nf === "all"} className={`tap${nf === "all" ? " on" : ""}`} onClick={() => setNf("all")}>{tx(p("All", "सभी"))} · {data.notices.length}</button>
            <button type="button" role="radio" aria-checked={nf === "unread"} className={`tap${nf === "unread" ? " on" : ""}`} onClick={() => setNf("unread")}>{tx(p("Unread", "नहीं पढ़ीं"))} · {unread.length}</button>
          </div>
        </div>
        {shownN.map((n, i) => {
          const u = !seen.has(n.id);
          const pin = n.id === data.notices[0]?.id;
          const lead = tx({ en: n.bodyEn ?? n.bodyHi ?? "", hi: n.bodyHi ?? undefined });
          const other = sub({ en: n.bodyEn ?? "", hi: n.bodyHi ?? undefined });
          return (
            <article key={n.id} className="card tc-in" style={{ padding: "16px 18px", display: "flex", flexDirection: "column", gap: 10, border: pin && u ? "2px solid var(--warnm)" : "1px solid var(--bd)", animationDelay: `${Math.min(i, 14) * 30}ms` }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                {pin ? <span className="pill" style={{ background: "var(--warns)", color: "var(--warnfg)" }}><Ic n="pin" size={12} />{tx(p("Pinned", "ज़रूरी"))}</span> : null}
                {u ? <span className="tc-dot" style={{ background: "var(--acc)" }} aria-label={tx(p("Not read yet", "अभी नहीं पढ़ी"))} /> : null}
                <span className="tc-el" style={{ flex: 1, fontSize: 12, color: "var(--mut)" }}>{n.fromName} · {tx(agoP(n.createdAt))}</span>
              </div>
              <span className="tc-h2">{n.title}</span>
              {lead ? <span className="tc-tb" style={{ lineHeight: 1.55, whiteSpace: "pre-wrap" }}>{lead}</span> : null}
              {other ? <span className="tc-ts" style={{ color: "var(--mut)", whiteSpace: "pre-wrap" }}>{other}</span> : null}
              <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
                <span style={{ flex: 1 }} />
                {u ? (
                  <button type="button" className="tap btn pri tc-mw" disabled={pending} onClick={() => gotIt([n.id])} style={{ height: 46, fontSize: 15 }}><Ic n="check" />{tx(p("I have read it", "पढ़ लिया"))}</button>
                ) : (
                  <span className="pill" style={{ height: 34, padding: "0 12px", fontSize: 13, background: "var(--oks)", color: "var(--ok)" }}><Ic n="check" size={16} stroke={3} className="tc-pop" />{tx(p("Seen", "देख लिया"))}</span>
                )}
              </div>
            </article>
          );
        })}
        {shownN.length === 0 ? (
          <div className="card fadein" style={{ padding: "40px 24px", display: "flex", flexDirection: "column", alignItems: "center", gap: 10, textAlign: "center" }}>
            <span className="tc-av tc-pop" style={{ width: 64, height: 64, background: "var(--oks)", color: "var(--ok)" }}><Ic n="check" size={30} /></span>
            <span className="tc-h2">{data.notices.length ? tx(p("All caught up!", "सब पढ़ लिया!")) : tx(p("No notices yet", "अभी कोई सूचना नहीं"))}</span>
            <span className="tc-ts" style={{ color: "var(--mut)" }}>{tx(p("No unread notices. New ones show up here.", "कोई नई सूचना नहीं। नई सूचनाएँ यहाँ आएँगी।"))}</span>
            {data.notices.length ? <button type="button" className="tap btn sec tc-mbg" onClick={() => setNf("all")}>{tx(p("Show all notices", "सभी सूचनाएँ दिखाएँ"))}</button> : null}
          </div>
        ) : null}
      </div>
      <aside className="hide-m" style={{ position: "sticky", top: 84, display: "flex", flexDirection: "column", gap: 12 }}>
        <div className="card" style={{ padding: 18, display: "flex", flexDirection: "column", gap: 10 }}>
          <span className="sech">{tx(p("To read", "पढ़ना बाकी"))}</span>
          <span className="num" style={{ fontSize: 34, fontWeight: 700, lineHeight: 1, color: unread.length ? V("acc") : V("ok") }}>{unread.length}</span>
          <span className="tc-ts" style={{ color: "var(--mut)" }}>{unread.length ? tx(p("notices are waiting for you", "सूचनाएँ बाकी हैं")) : tx(p("You are up to date ✓", "सब पढ़ लिया ✓"))}</span>
          {unread.length ? <button type="button" className="tap btn soft" disabled={pending} onClick={() => gotIt(unread.map((n) => n.id))}><Ic n="checkCircle" />{tx(p("Mark all as seen", "सब देख लिया"))}</button> : null}
        </div>
        <div className="tc-note" style={{ background: "var(--infos)", color: "var(--info)" }}>
          <Ic n="eye" style={{ marginTop: 2 }} />
          <span>{tx(p("When you tap “I have read it”, the office can see that you have read the notice.", "“पढ़ लिया” दबाने पर ऑफ़िस को पता चलता है कि आपने सूचना पढ़ ली।"))}</span>
        </div>
      </aside>
    </div>
  );

  /* ---------------------------------------------------- marks links */
  const linksView = (
    <div className="tc-scr" style={{ maxWidth: 1120 }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <span className="tc-h1">{tx(p("Your marks links (Sampark)", "आपके अंक लिंक (संपर्क)"))}</span>
        <span className="tc-tb" style={{ color: "var(--mut)" }}>{[...new Set(data.links.map((l) => tx(examWord(l.exam, l.examHi))))].join(" · ") || tx(p("No exam is open for marks", "कोई परीक्षा खुली नहीं"))}</span>
      </div>
      <div className="tc-note" style={{ background: "var(--accs)", color: "var(--accfg)", alignItems: "center" }}>
        <span className="tc-ibx" style={{ background: "var(--card)", color: "var(--acc)" }}><Ic n="link" size={22} /></span>
        <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
          <span className="tc-tb" style={{ fontWeight: 700 }}>{tx(p("Opens a simple page where you type marks. No password needed.", "एक आसान पेज खुलता है जहाँ आप अंक लिखते हैं। पासवर्ड नहीं चाहिए।"))}</span>
          <span className="tc-ts">{tx(p("The marks land in the same place as the app. Keep the link to yourself.", "अंक ऐप वाली जगह ही पहुँचते हैं। लिंक किसी और को न दें।"))}</span>
        </span>
      </div>
      {data.links.length === 0 ? (
        <div className="card" style={{ padding: "36px 20px", display: "flex", flexDirection: "column", alignItems: "center", gap: 10, textAlign: "center" }}>
          <span className="tc-av" style={{ width: 64, height: 64, background: "var(--s2)", color: "var(--mut)" }}><Ic n="link" size={28} /></span>
          <span className="tc-h2">{tx(p("No papers for your subjects yet", "आपके विषयों का कोई पेपर नहीं"))}</span>
          <span className="tc-ts" style={{ color: "var(--mut)" }}>{tx(p("Links appear when an exam is set up.", "परीक्षा बनने पर लिंक दिखेंगे।"))}</span>
        </div>
      ) : null}
      <div className="g2" style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 14 }}>
        {data.links.map((l, i) => {
          // Sent with blanks is not done: the review found "Done ✓" on a paper with 0 marks entered (6 Nov 2026).
          const blank = Math.max(0, l.total - l.entered);
          const st: [Pair, string, string, string] = l.submitted && blank > 0 ? [p(`Sent · ${blank} blank`, `भेजा · ${blank} खाली`), V("warns"), V("warnfg"), V("warn")] : l.submitted ? [p("Done ✓", "पूरा ✓"), V("oks"), V("ok"), V("ok")] : l.entered ? [p("In progress", "चल रहा है"), V("accs"), V("accfg"), V("acc")] : [p("Not started", "शुरू नहीं"), V("s3"), V("mut"), V("acc")];
          const frac = l.total ? Math.min(1, l.entered / l.total) : 0;
          return (
            <div key={l.paperId} className="card tc-in" style={{ padding: "18px 20px", display: "flex", flexDirection: "column", gap: 12, animationDelay: `${Math.min(i, 14) * 30}ms` }}>
              <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                <div style={{ position: "relative", flex: "none", width: 84, height: 84 }}>
                  <svg viewBox="0 0 100 100" width="84" height="84" aria-hidden="true">
                    <circle cx="50" cy="50" r="42" style={{ fill: "none", strokeWidth: 9, stroke: "var(--s3)" }} />
                    <circle cx="50" cy="50" r="42" style={{ fill: "none", strokeWidth: 9, strokeLinecap: "round", stroke: st[3], strokeDasharray: `${(frac * 263.9).toFixed(1)} 263.9`, ["--len" as string]: "263.9", opacity: l.entered ? 1 : 0, transform: "rotate(-90deg)", transformOrigin: "50% 50%", animation: "xDraw .9s var(--ease) both" }} />
                  </svg>
                  <span style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
                    <span className="num" style={{ fontSize: 16, fontWeight: 700 }}>{l.entered}</span>
                    <span style={{ fontSize: 11, color: "var(--mut)" }}>{tx(p(`of ${l.total}`, `/ ${l.total}`))}</span>
                  </span>
                </div>
                <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 4 }}>
                  <span style={{ fontSize: 12, fontWeight: 600, color: "var(--mut)" }}>{tx(examWord(l.exam, l.examHi))}{l.maxMarks ? ` · ${tx(p(`out of ${l.maxMarks}`, `${l.maxMarks} में से`))}` : ""}</span>
                  <span className="tc-h2">{tx(classSubject(l.classLabel, subjectWord(l.subjectCode, subjectNames)))}</span>
                  <span className="pill" style={{ alignSelf: "flex-start", background: st[1], color: st[2] }}>{tx(st[0])}</span>
                </span>
              </div>
              <span className="tc-ts" style={{ color: "var(--mut)" }}>{l.submitted && blank > 0 ? tx(p(`Sent to the exam office with ${blank} of ${l.total} blank`, `परीक्षा विभाग को भेजे, ${l.total} में से ${blank} खाली`)) : l.submitted ? tx(p("Sent to the exam office", "परीक्षा विभाग को भेजे गए")) : tx(p(`${l.entered} of ${l.total} entered`, `${l.total} में से ${l.entered} भरे`))}</span>
              {l.url ? (
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  <a href={l.url} className="tap btn pri tc-mbg"><Ic n="globe" />{tx(p("Open link", "लिंक खोलें"))}</a>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <a href={`https://wa.me/?text=${encodeURIComponent(l.url)}`} target="_blank" rel="noreferrer" className="tap btn soft" style={{ flex: 1, height: 46 }}><Ic n="message" />{tx(p("Share on WhatsApp", "व्हाट्सऐप पर भेजें"))}</a>
                    <button type="button" className="tap btn sec" onClick={() => void copy(l.url ?? "")} style={{ height: 46 }}><Ic n="copy" />{tx(p("Copy", "कॉपी करें"))}</button>
                  </div>
                </div>
              ) : makeLink ? (
                <button
                  type="button"
                  className="tap btn pri tc-mbg"
                  disabled={pending}
                  onClick={() =>
                    start(async () => {
                      const r = await makeLink(l.examId).catch(() => null);
                      if (r?.ok) {
                        toast.show({ text: tx(p("Your link is ready", "आपका लिंक तैयार है")) });
                        router.refresh();
                      } else toast.show({ text: tx(r?.message ?? p("Could not make the link", "लिंक नहीं बना")), tone: "bad" });
                    })
                  }
                >
                  <Ic n="refresh" />
                  {tx(p("Make my link", "मेरा लिंक बनाएँ"))}
                </button>
              ) : (
                <Link href={`/teach/marks?paper=${l.paperId}`} className="tap btn sec tc-mbg"><Ic n="clipboard" />{tx(p("Enter marks in the app", "ऐप में अंक भरें"))}</Link>
              )}
            </div>
          );
        })}
      </div>
      <span className="tc-ts" style={{ color: "var(--mut)" }}>{tx(p("Links stop working when the exam office locks the marks. Lost a link? Make a new one on the Marks page.", "अंक लॉक होने पर लिंक बंद हो जाते हैं। लिंक खो गया? अंक पेज पर नया बनाएँ।"))}</span>
    </div>
  );

  /* ---------------------------------------------------- timetable */
  const [pickDay, setPickDay] = useState<string>(() => days.find((d) => dayKey(d) === todayKey) ?? days[0] ?? "");
  const rowsFor = (n: number, i: number): ReactNode[] => {
    const out: ReactNode[] = [];
    const prev = timeOf(numbers[i - 1]);
    const cur = timeOf(n);
    if (prev && cur && prev.ends && cur.starts && prev.ends < cur.starts) out.push(<span key={`brk${n}`} className="tc-ib" style={{ gridColumn: "1 / -1", height: 30, background: "var(--s2)", fontSize: 12, fontWeight: 700, color: "var(--mut)", letterSpacing: ".06em" }}>{tx(p(`BREAK · ${hm12(prev.ends)} – ${hm12(cur.starts)}`, `मध्यांतर · ${hm12(prev.ends)} – ${hm12(cur.starts)}`))}</span>);
    return out;
  };
  const cellOf = (d: string, n: number) => {
    const slot = data.week.find((w) => w.day === d && w.number === n) ?? null;
    const isToday = dayKey(d) === todayKey;
    const t = timeOf(n);
    const live = isToday && teachingToday;
    const now = Boolean(live && t && data.nowMinutes >= mins(t.starts) && data.nowMinutes < mins(t.ends) && !(slot && onLeave(slot.period)));
    const past = Boolean(live && t && data.nowMinutes >= mins(t.ends));
    return { slot, isToday, now, past };
  };
  const ttView = (
    <div className="tc-scr">
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
        <span style={{ display: "flex", flexDirection: "column" }}>
          <span className="tc-h1">{tx(p("My timetable", "मेरी समय-सारणी"))}</span>
          <span className="tc-tb" style={{ color: "var(--mut)" }}>{tx(p(`${data.week.length} periods a week · today is ${new Date(`${data.today}T12:00:00+05:30`).toLocaleDateString("en-GB", { weekday: "long", timeZone: "Asia/Kolkata" })}`, `हफ़्ते में ${data.week.length} पीरियड · आज ${new Date(`${data.today}T12:00:00+05:30`).toLocaleDateString("hi-IN", { weekday: "long", timeZone: "Asia/Kolkata" })} है`))}</span>
        </span>
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8, fontSize: 12 }}>
          {/* Five colours: past five classes a dot names nothing, and the class is written under every period anyway (teacher day, 6 Nov, teacher 16). */}
          {classOrder.length <= CLASS_TONES.length ? classOrder.map((c) => <span key={c} style={{ display: "flex", alignItems: "center", gap: 6 }}><span className="tc-dot" style={{ background: toneOf(c)[2] }} />{c}</span>) : null}
          <span style={{ display: "flex", alignItems: "center", gap: 6 }}><span className="tc-dot" style={{ border: "1.5px dashed var(--bds)" }} />{tx(p("Free", "खाली"))}</span>
        </div>
      </div>
      {data.closed ? (
        <div className="tc-note" role="status" style={{ background: "var(--warns)", color: "var(--warnfg)" }}>
          <Ic n="coffee" style={{ marginTop: 2 }} />
          <span style={{ display: "flex", flexDirection: "column" }}>
            <b>{tx(closedTitle(data.closed))}</b>
            <span>{tx(p("No periods today. This is your usual week.", "आज कोई पीरियड नहीं। नीचे आपका सामान्य हफ़्ता है।"))}</span>
          </span>
        </div>
      ) : data.leaveToday ? (
        <div className="tc-note" role="status" style={{ background: "var(--infos)", color: "var(--info)" }}>
          <Ic n="calendar" style={{ marginTop: 2 }} />
          <span>{tx(p("You are on approved leave today. The office has your periods.", "आज आपकी छुट्टी मंज़ूर है। आपके पीरियड ऑफ़िस संभाल रहा है।"))}</span>
        </div>
      ) : null}
      {data.week.length === 0 ? (
        <div className="card" style={{ padding: "36px 20px", display: "flex", flexDirection: "column", alignItems: "center", gap: 10, textAlign: "center" }}>
          <span className="tc-av" style={{ width: 64, height: 64, background: "var(--s2)", color: "var(--mut)" }}><Ic n="calendar" size={28} /></span>
          {/* Not "not published": a new teacher sees this while the school's
              timetable is live, she simply has no periods in it (ST-15). */}
          <span className="tc-h2">{tx(p("No periods in your name yet", "आपके नाम पर अभी कोई पीरियड नहीं"))}</span>
          <span className="tc-s">{tx(p("Ask the office to add you to the timetable.", "ऑफ़िस से कहें कि आपको समय-सारणी में जोड़ दें।"))}</span>
        </div>
      ) : (
        <>
          <div className="card only-d tc-tt" style={{ overflow: "hidden", ["--days" as string]: String(days.length) }}>
            <span style={{ background: "var(--s2)", borderTop: 0 }} />
            {days.map((d) => {
              const isToday = dayKey(d) === todayKey;
              return (
                <span key={d} className="tc-ib tc-ts" style={{ gap: 6, height: 46, fontWeight: 700, background: isToday ? V("accs") : V("s2"), color: isToday ? V("accfg") : V("fg"), borderTop: 0 }}>
                  {language === "hi" ? DAY_HI[dayKey(d)] ?? d : d.slice(0, 3)}
                  {isToday ? <span className="pill" style={{ background: "var(--acc)", color: "var(--onsolid)" }}>{tx(p("Today", "आज"))}</span> : null}
                </span>
              );
            })}
            {numbers.map((n, i) => (
              <span key={n} style={{ display: "contents" }}>
                {rowsFor(n, i)}
                <span className="num" style={{ display: "flex", flexDirection: "column", justifyContent: "center", padding: "0 14px" }}>
                  <span className="tc-ts" style={{ fontWeight: 700 }}>P{n}</span>
                  <span style={{ fontSize: 11, color: "var(--mut)" }}>{timeOf(n) ? hm12(timeOf(n)!.starts) : ""}</span>
                </span>
                {days.map((d, j) => {
                  const c = cellOf(d, n);
                  const tone = c.slot ? toneOf(c.slot.classLabel) : null;
                  return (
                    <div key={d} style={{ background: c.isToday ? V("s2") : "transparent" }}>
                      <div className="tc-cel tc-in" style={{ background: tone ? tone[0] : "transparent", color: tone ? tone[1] : V("sub"), border: tone ? "1px solid transparent" : "1px dashed var(--bd)", opacity: c.past ? 0.55 : 1, boxShadow: c.now ? "0 0 0 2px var(--acc)" : "none", animationDelay: `${Math.min(i * 6 + j, 40) * 8}ms` }}>
                        <span className="tc-ts tc-el" style={{ fontWeight: 700 }}>{c.slot ? subj(c.slot.subjectCode) : tx(p("Free", "खाली"))}</span>
                        <span className="tc-el" style={{ fontSize: 11, opacity: 0.85 }}>{c.slot ? slotWho(c.slot.classLabel) : tx(p("Staff room", "स्टाफ़ रूम"))}</span>
                        {c.now ? <span className="tc-dot" style={{ position: "absolute", top: 8, right: 8, background: "var(--acc)", animation: "xPulse 2s ease infinite" }} /> : null}
                      </div>
                    </div>
                  );
                })}
              </span>
            ))}
          </div>
          <div className="only-m" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div className="seg tc-days" role="radiogroup" aria-label={tx(p("Day", "दिन"))} style={{ gridTemplateColumns: `repeat(${days.length}, minmax(0, 1fr))` }}>
              <span className="thumb" aria-hidden="true" style={{ width: `calc((100% - 6px) / ${days.length})`, transform: `translateX(${Math.max(0, days.indexOf(pickDay)) * 100}%)` }} />
              {days.map((d) => <button key={d} type="button" role="radio" aria-checked={pickDay === d} className={`tap${pickDay === d ? " on" : ""}`} onClick={() => setPickDay(d)}>{language === "hi" ? DAY_HI[dayKey(d)] ?? d : d.slice(0, 3)}</button>)}
            </div>
            <div className="card" style={{ overflow: "hidden" }}>
              {numbers.map((n, i) => {
                const c = cellOf(pickDay, n);
                const tone = c.slot ? toneOf(c.slot.classLabel) : null;
                const prev = timeOf(numbers[i - 1]);
                const cur = timeOf(n);
                const brk = prev && cur && prev.ends < cur.starts;
                const tag = c.now ? [tx(p("Now", "अभी")), V("acc"), V("onsolid")] : c.past ? [tx(p("Done", "हो गया")), V("s3"), V("mut")] : null;
                return (
                  <span key={n} style={{ display: "contents" }}>
                    {brk ? <div className="tc-ib" style={{ height: 34, background: "var(--s2)", borderTop: "1px solid var(--bd)", fontSize: 12, fontWeight: 700, color: "var(--mut)" }}>{tx(p(`BREAK · ${hm12(prev.ends)} – ${hm12(cur.starts)}`, `मध्यांतर · ${hm12(prev.ends)} – ${hm12(cur.starts)}`))}</div> : null}
                    <div className="tc-in" style={{ display: "flex", alignItems: "center", gap: 12, minHeight: 68, padding: "10px 14px", borderTop: i ? "1px solid var(--bd)" : 0, background: c.now ? V("accs") : "transparent", opacity: c.past ? 0.55 : 1, animationDelay: `${Math.min(i, 14) * 30}ms` }}>
                      <span className="num" style={{ width: 46, display: "flex", flexDirection: "column" }}><span className="tc-tb" style={{ fontWeight: 700 }}>P{n}</span><span style={{ fontSize: 11, color: "var(--mut)" }}>{cur ? hm12(cur.starts) : ""}</span></span>
                      <span className="tc-dot" style={{ background: tone ? tone[2] : V("bds"), animation: c.now ? "xPulse 2s ease infinite" : "none" }} />
                      <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
                        <span className="tc-tb tc-el" style={{ fontWeight: 600 }}>{c.slot ? subj(c.slot.subjectCode) : tx(p("Free", "खाली"))}</span>
                        <span className="tc-el" style={{ fontSize: 12, color: "var(--mut)" }}>{c.slot ? slotWho(c.slot.classLabel) : tx(p("Staff room", "स्टाफ़ रूम"))}</span>
                      </span>
                      {tag ? <span className="pill" style={{ background: tag[1], color: tag[2] }}>{tag[0]}</span> : null}
                    </div>
                  </span>
                );
              })}
            </div>
          </div>
        </>
      )}
    </div>
  );

  /* ---------------------------------------------------- leave */
  const cancelLeave = (id: string) =>
    start(async () => {
      const res = await cancelLeaveVx(id);
      setAskWithdraw(null);
      if (res.ok) {
        toast.show({ text: tx(p("Leave request withdrawn", "छुट्टी का अनुरोध वापस लिया")) });
        router.refresh();
      } else toast.show({ text: tx(res.error), tone: "bad" });
    });
  const leaveView = (
    <div className="tc-scr" style={{ maxWidth: 860 }}>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
        <span style={{ display: "flex", flexDirection: "column" }}>
          <span className="tc-h1">{tx(p("My leave", "मेरी छुट्टियाँ"))}</span>
          <span className="tc-tb" style={{ color: "var(--mut)" }}>{tx(p("Ask for leave in two taps. The office sees it at once.", "दो टैप में छुट्टी माँगें। ऑफ़िस तुरंत देखता है।"))}</span>
        </span>
        <button type="button" className="tap btn pri tc-mbg tc-mw" onClick={() => setSheet("leave")}><Ic n="calendar" />{tx(p("Apply leave", "छुट्टी माँगें"))}</button>
      </div>
      <span className="sech">{tx(p("My requests and the office’s answers", "मेरे अनुरोध और ऑफ़िस के जवाब"))}</span>
      {data.leave.length === 0 ? <span className="tc-ts" style={{ color: "var(--mut)" }}>{tx(p("No leave asked for yet.", "अभी कोई छुट्टी नहीं माँगी।"))}</span> : null}
      {data.leave.map((l) => {
        const state = leaveState(l, data.today);
        const st = state === "passed" ? { text: LEAVE_STATE_TEXT.passed, tone: TS, icon: "clock" as IconName } : (LEAVE_STATUS[l.status] ?? LEAVE_STATUS.asked);
        return (
          <div key={l.id} className="card" style={{ padding: "14px 16px", display: "flex", flexWrap: "wrap", alignItems: "center", gap: 12 }}>
            <span className="tc-ibx" style={{ background: st.tone[0], color: st.tone[1] }}><Ic n={st.icon} /></span>
            <span style={{ flex: 1, minWidth: 170, display: "flex", flexDirection: "column" }}>
              <span className="tc-tb" style={{ fontWeight: 700 }}>{l.from_day === l.to_day ? tx(dShortP(l.from_day)) : `${tx(dShortP(l.from_day))} – ${tx(dShortP(l.to_day))}`}</span>
              <span className="tc-ts" style={{ color: "var(--mut)" }}>{[tx(SPAN[l.span] ?? SPAN.full), l.note].filter(Boolean).join(" · ")}</span>
              <span style={{ fontSize: 12, color: "var(--sub)" }}>{tx(p(`Sent ${dShort(l.created_at)}`, `${shortDayHi(l.created_at)} को भेजा`))}</span>
              {l.decided_at && (l.status === "approved" || l.status === "declined") ? (
                <span style={{ fontSize: 12, color: "var(--sub)" }}>
                  {l.status === "approved"
                    ? tx(p(`Approved${l.decided_by_name ? ` by ${l.decided_by_name}` : ""} · ${dShort(l.decided_at)} ${ampm(l.decided_at)}`, `${l.decided_by_name ? `${l.decided_by_name} ने ` : ""}मंज़ूर की · ${shortDayHi(l.decided_at)} ${timeHi(l.decided_at)}`))
                    : tx(p(`Declined${l.decided_by_name ? ` by ${l.decided_by_name}` : ""} · ${dShort(l.decided_at)} ${ampm(l.decided_at)}`, `${l.decided_by_name ? `${l.decided_by_name} ने ` : ""}अस्वीकार की · ${shortDayHi(l.decided_at)} ${timeHi(l.decided_at)}`))}
                </span>
              ) : null}
            </span>
            <span className="pill" style={{ height: 28, padding: "0 12px", fontSize: 12, background: st.tone[0], color: st.tone[1] }}>{tx(st.text)}</span>
            {l.status === "approved" ? (
              <span style={{ flexBasis: "100%", display: "flex", flexDirection: "column", gap: 2, fontSize: 13 }}>
                <b>{tx(p("Who takes your classes", "आपकी कक्षाएँ कौन लेगा"))}</b>
                {l.covers.length ? l.covers.map((c) => <span key={`${c.day}-${c.number}`} style={{ color: c.coverName ? "var(--fg)" : "var(--warnfg)" }}>{l.from_day !== l.to_day ? `${tx(dShortP(c.day))} · ` : ""}{tx(coverLine(c))}</span>) : <span style={{ color: "var(--mut)" }}>{tx(p("The office has not arranged cover yet.", "ऑफ़िस ने अभी इंतज़ाम नहीं किया है।"))}</span>}
              </span>
            ) : null}
            {state === "passed" ? <span style={{ flexBasis: "100%", fontSize: 13, color: "var(--mut)" }}>{tx(p("These days have passed and the office never answered. Withdraw it, and talk to the office if needed.", "ये दिन निकल गए और ऑफ़िस ने जवाब नहीं दिया। अनुरोध वापस लें, ज़रूरत हो तो ऑफ़िस से बात करें।"))}</span> : null}
            {mayCancelLeave(l) ? (askWithdraw === l.id ? <WithdrawConfirm pending={pending} onYes={() => cancelLeave(l.id)} onNo={() => setAskWithdraw(null)} /> : <button type="button" className="tap btn ghost" disabled={pending} onClick={() => setAskWithdraw(l.id)} style={{ minHeight: 44 }}><Ic n="x" />{tx(p("Withdraw", "वापस लें"))}</button>) : null}
          </div>
        );
      })}
    </div>
  );

  /* ---------------------------------------------------- help */
  const tp = HELP[topic];
  const helpView = (
    <div className="tc-scr" style={{ maxWidth: 1120 }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <span className="tc-h1">{tx(p("How do I…", "कैसे करें…"))}</span>
        <span className="tc-tb" style={{ color: "var(--mut)" }}>{tx(p("Pick a task. Each one is 3 easy steps.", "कोई काम चुनें। हर काम 3 आसान कदम।"))}</span>
      </div>
      <div className="tc-tg" style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 10 }}>
        {(Object.keys(HELP) as HelpTopic[]).map((k) => {
          const h = HELP[k];
          const on = k === topic;
          return (
            <button key={k} type="button" role="radio" aria-checked={on} className="tap card" onClick={() => setTopic(k)} style={{ display: "flex", alignItems: "center", gap: 12, padding: 12, textAlign: "left", color: "var(--fg)", border: on ? "2px solid var(--acc)" : "1px solid var(--bd)", background: on ? V("accs") : V("card") }}>
              <span className="tc-ibx" style={{ width: 40, height: 40, background: h.tone[0], color: h.tone[1] }}><Ic n={h.icon} /></span>
              <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
                <span className="tc-tb" style={{ fontWeight: 600 }}>{tx(h.t)}</span>
                {sub(h.t) ? <span className="tc-mi">{sub(h.t)}</span> : null}
              </span>
            </button>
          );
        })}
      </div>
      <div className="card" style={{ padding: "18px 20px", display: "flex", flexDirection: "column", gap: 14 }}>
        <span className="tc-h2">{tx(tp.t)}</span>
        <div className="g3" style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 16 }}>
          {tp.steps.map((s, i) => (
            <div key={s.t.en} className="tc-in" style={{ display: "flex", flexDirection: "column", gap: 10, animationDelay: `${i * 90}ms` }}>
              <div className="tc-ill">{s.pic}</div>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span className="tc-av" style={{ width: 30, height: 30, fontSize: 13, background: "var(--pri)", color: "var(--prifg)" }}>{i + 1}</span>
                <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
                  <span style={{ fontSize: 16, fontWeight: 700 }}>{tx(s.t)}</span>
                  {sub(s.t) ? <span className="tc-mi">{sub(s.t)}</span> : null}
                </span>
              </div>
              <span className="tc-ts" style={{ color: "var(--mut)" }}>{tx(s.d)}</span>
            </div>
          ))}
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {tp.href ? (
            <Link href={tp.href} className="tap btn pri tc-mbg tc-mw">{tx(p("Try it now", "अभी करके देखें"))}<Ic n="arrowRight" /></Link>
          ) : (
            <button type="button" className="tap btn pri tc-mbg tc-mw" onClick={() => { if (topic === "leave") { go("leave"); setSheet("leave"); } else go(topic === "link" ? "links" : topic === "me" ? "profile" : "news"); }}>{tx(p("Try it now", "अभी करके देखें"))}<Ic n="arrowRight" /></button>
          )}
        </div>
      </div>
      {officePhone ? (
        <div className="card" style={{ padding: "16px 18px", display: "flex", flexWrap: "wrap", alignItems: "center", gap: 14 }}>
          <span className="tc-ibx" style={{ background: "var(--oks)", color: "var(--ok)" }}><Ic n="phone" size={22} /></span>
          <span style={{ flex: 1, minWidth: 180, display: "flex", flexDirection: "column" }}>
            <span className="tc-tb" style={{ fontWeight: 700 }}>{tx(p("Still stuck? Call the office", "फिर भी दिक्कत? ऑफ़िस को फ़ोन करें"))}</span>
            <span className="tc-ts" style={{ color: "var(--mut)" }}>{officePhone}</span>
          </span>
          <a href={`tel:${officePhone.replace(/[^\d+]/g, "")}`} className="tap btn sec tc-mbg tc-mw"><Ic n="phone" />{tx(p("Call the office", "ऑफ़िस को फ़ोन"))}</a>
        </div>
      ) : null}
    </div>
  );

  /* ---------------------------------------------------- profile */
  const { resolvedTheme, setTheme } = useTheme();
  const ready = useSyncExternalStore(noSubscribe, () => true, () => false);
  const dark = ready && resolvedTheme === "dark";
  const setLanguage = (lang: "en" | "hi" | "both") =>
    start(async () => {
      const fd = new FormData();
      fd.set("language", lang);
      await saveLanguageAction({ status: "idle", message: null }, fd);
      router.refresh();
    });
  const toggleLarge = (on: boolean) =>
    start(async () => {
      setLarge(on);
      const res = await setTextSizeVx(on);
      if (!res.ok) {
        setLarge(!on);
        toast.show({ text: tx(res.error), tone: "bad" });
      } else router.refresh();
    });
  const toggleAlert = (key: string, on: boolean) =>
    start(async () => {
      setAlerts((cur) => ({ ...cur, [key]: on }));
      const res = await setAlertVx(key, on);
      if (!res.ok) {
        setAlerts((cur) => ({ ...cur, [key]: !on }));
        toast.show({ text: tx(res.error), tone: "bad" });
      }
    });
  const seg2 = (value: number, opts: [string, () => void][]) => (
    <div className="seg tc-mw" role="radiogroup" style={{ gridTemplateColumns: "repeat(2, minmax(0, 1fr))", width: 220 }}>
      <span className="thumb" aria-hidden="true" style={{ width: "calc((100% - 6px) / 2)", transform: `translateX(${value * 100}%)` }} />
      {opts.map(([l, f], i) => <button key={l} type="button" role="radio" aria-checked={value === i} className={`tap${value === i ? " on" : ""}`} onClick={f}>{l}</button>)}
    </div>
  );
  const switchRow = (key: string, icon: IconName, tone: Tone, t: Pair, s: Pair, on: boolean, flip: () => void) => (
    <button key={key} type="button" role="switch" aria-checked={on} className="tap" onClick={flip} style={{ display: "flex", alignItems: "center", gap: 12, width: "100%", padding: "14px 0", border: 0, borderTop: "1px solid var(--bd)", background: "transparent", color: "var(--fg)", textAlign: "left" }}>
      <span className="tc-ibx" style={{ width: 40, height: 40, background: tone[0], color: tone[1] }}><Ic n={icon} /></span>
      <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
        <span className="tc-tb" style={{ fontWeight: 600 }}>{tx(t)}</span>
        <span className="tc-mi">{sub(s) || tx(s)}</span>
      </span>
      <span className={`sw${on ? " on" : ""}`}><span /></span>
    </button>
  );
  const profileView = (
    <div className="tc-scr" style={{ maxWidth: 760 }}>
      <div className="card" style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 16, padding: 20 }}>
        {me(72, 24, { animation: "xPopIn .45s var(--spring) both" })}
        <span style={{ flex: 1, minWidth: 200, display: "flex", flexDirection: "column", gap: 4 }}>
          <span className="tc-h1" style={{ fontSize: 26 }}>{data.profile.name}</span>
          <span className="tc-ts" style={{ color: "var(--mut)" }}>{roleLine}</span>
          {data.profile.email ? <span className="tc-ts num" style={{ color: "var(--mut)" }}>{data.profile.email}</span> : null}
        </span>
        <ProfilePhotoControl sheet credential={{ kind: "staff" }} language={language} />
      </div>
      <div className="card" style={{ padding: "16px 18px", display: "flex", flexDirection: "column", gap: 10 }}>
        <span className="sech">{tx(p("My classes", "मेरी कक्षाएँ"))}</span>
        {data.profile.classes.length === 0 && data.profile.subjects.length === 0 ? <span className="tc-ts" style={{ color: "var(--mut)" }}>{tx(p("No class or subject yet. The office adds you to the timetable.", "अभी कोई कक्षा या विषय नहीं। ऑफ़िस आपको समय-सारणी में जोड़ेगा।"))}</span> : null}
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {data.profile.classes.map((c) => <span key={c.classId} className="pill" style={{ height: 34, padding: "0 14px", fontSize: 13, background: c.held ? V("accs") : V("s3"), color: c.held ? V("accfg") : V("fg") }}>{c.held ? tx(p(`${c.classLabel} · class teacher`, `${classWord(c.classLabel).hi} · कक्षा अध्यापक`)) : tx(classWord(c.classLabel))}</span>)}
          {data.profile.subjects.map((s) => <span key={s} className="pill" style={{ height: 34, padding: "0 14px", fontSize: 13, background: V("s3"), color: V("fg") }}>{s}</span>)}
        </div>
      </div>
      <div className="card" style={{ padding: "6px 18px", display: "flex", flexDirection: "column" }}>
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 12, padding: "14px 0" }}>
          <span className="tc-ibx" style={{ width: 40, height: 40, background: "var(--accs)", color: "var(--accfg)" }}><Ic n="globe" /></span>
          <span style={{ flex: 1, minWidth: 140, display: "flex", flexDirection: "column" }}>
            <span className="tc-tb" style={{ fontWeight: 600 }}>{tx(p("Language", "भाषा"))}</span>
            <span className="tc-mi">{tx(p("भाषा · English, Hindi or both", "Language · हिंदी, English या दोनों"))}</span>
          </span>
          {/* Three choices: a reader of both languages can get that view back (smoke 20 Oct).
              Platform's <LanguageChoices/> (fix/smoke-platform) can replace this at merge. */}
          <div className="seg tc-mw" role="radiogroup" aria-label={tx(p("Language", "भाषा"))} style={{ gridTemplateColumns: "repeat(3, minmax(0, 1fr))", width: 300 }}>
            <span className="thumb" aria-hidden="true" style={{ width: "calc((100% - 6px) / 3)", transform: `translateX(${(language === "hi" ? 1 : language === "both" ? 2 : 0) * 100}%)` }} />
            {([["en", "English"], ["hi", "हिंदी"], ["both", "दोनों · Both"]] as const).map(([v, l]) => (
              <button key={v} type="button" role="radio" aria-checked={language === v} className={`tap${language === v ? " on" : ""}`} disabled={pending} onClick={() => language !== v && setLanguage(v)}>{l}</button>
            ))}
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 10, padding: "14px 0", borderTop: "1px solid var(--bd)" }}>
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 12 }}>
            <span className="tc-ibx" style={{ width: 40, height: 40, background: "var(--infos)", color: "var(--info)" }}><Ic n="type" /></span>
            <span style={{ flex: 1, minWidth: 140, display: "flex", flexDirection: "column" }}>
              <span className="tc-tb" style={{ fontWeight: 600 }}>{tx(p("Text size", "अक्षर का आकार"))}</span>
              <span className="tc-mi">{tx(p("अक्षर का आकार · bigger is easier to read", "Text size · बड़ा पढ़ने में आसान"))}</span>
            </span>
            {seg2(large ? 1 : 0, [[tx(p("Normal", "सामान्य")), () => toggleLarge(false)], [tx(p("Large", "बड़ा")), () => toggleLarge(true)]])}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 4, padding: "12px 14px", borderRadius: 14, background: "var(--s2)", border: "1px dashed var(--bds)" }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: "var(--mut)", letterSpacing: ".06em", textTransform: "uppercase" }}>{tx(p("Preview", "झलक"))}</span>
            <span style={{ fontWeight: 700, fontSize: large ? 19 : 16, transition: "font-size .3s var(--ease)" }}>{firstOpen ? tx(p(`${classSubject(firstOpen.classLabel, subjectWord(firstOpen.subjectCode, subjectNames)).en} — ${firstOpen.entered} of ${firstOpen.total} entered`, `${classSubject(firstOpen.classLabel, subjectWord(firstOpen.subjectCode, subjectNames)).hi} — ${firstOpen.total} में से ${firstOpen.entered} भरे`)) : tx(p("Your marks and registers", "आपके अंक और हाज़िरी"))}</span>
            <span style={{ fontSize: large ? 16 : 13, color: "var(--mut)", transition: "font-size .3s var(--ease)" }}>{tx(p("This is how text looks in the app.", "ऐप में अक्षर ऐसे दिखेंगे।"))}</span>
          </div>
        </div>
        {switchRow("dark", "moon", TS, p("Dark mode", "डार्क मोड"), p("डार्क मोड · easier on the eyes at night", "Dark mode · रात में आँखों को आराम"), dark, () => setTheme(dark ? "light" : "dark"))}
        <FeedbackSwitches row={(r) => switchRow(r.key, r.icon, TI, r.title, r.sub, r.on, r.flip)} />
        {ALERTS.map((a) => switchRow(a.key, a.icon, a.tone, a.text, a.sub, alerts[a.key] !== false, () => toggleAlert(a.key, alerts[a.key] === false)))}
      </div>
      <Link href="/preferences/password?from=teach" className="tap btn sec tc-mbg tc-mw"><Ic n="lock" />{tx(p("Change password", "पासवर्ड बदलें"))}</Link>
      <form action={logoutAction} style={{ display: "flex" }}>
        <button type="submit" className="tap btn sec tc-mbg tc-mw" style={{ color: "var(--bad)" }}><Ic n="logout" />{tx(p("Sign out", "साइन आउट"))}</button>
      </form>
      <span style={{ fontSize: 12, color: "var(--mut)" }}>{tx(p("VPPS One · Teacher app", "VPPS One · शिक्षक ऐप"))}</span>
    </div>
  );

  const action = current === "timetable" ? <button type="button" className="tap btn sec" onClick={() => { go("leave"); setSheet("leave"); }}><Ic n="calendar" />{tx(p("Apply leave", "छुट्टी माँगें"))}</button> : null;

  return (
    <VxPage label="More" className={`tc${large ? " t-large" : ""}`}>
      <TchTop
        crumb={crumb}
        title={tx(titleP)}
        actions={
          <>
            <LangSeg />
            {current === "help" ? null : <DeskHelp onClick={openHelp} label={helpLabel} />}
            {action}
          </>
        }
        mLead={current === "menu" ? <button type="button" className="tap" aria-label={tx(p("My profile", "मेरी प्रोफ़ाइल"))} onClick={() => go("profile")} style={{ border: 0, padding: 0, margin: "0 4px", background: "transparent" }}>{me(40, 13)}</button> : back}
        mTitle={tx(titleP)}
        mSub={mSub}
        mAction={
          <>
            <LangSeg />
            {current === "help" ? null : <HelpIcon onClick={openHelp} label={helpLabel} />}
          </>
        }
      />
      <main>
        {current === "menu" ? menu : current === "news" ? newsView : current === "links" ? linksView : current === "timetable" ? ttView : current === "leave" ? leaveView : current === "help" ? helpView : profileView}
      </main>
      <LeaveSheet open={sheet === "leave"} onClose={() => { setSheet(null); router.refresh(); }} today={data.today} closedDays={data.closedDays} />
    </VxPage>
  );
}

/* ------------------------------------------------------------------ help */

type HelpTopic = "att" | "marks" | "note" | "link" | "news" | "leave" | "me";

function Mini({ rows }: { rows: { t: string | Pair; tone?: "row" | "soft" | "btn" | "ok" | "bad" | "good" | "mic" | "wa"; r?: string; hl?: boolean }[] }) {
  const { tx } = useVx();
  const K = { row: [24, "card", "fg"], soft: [24, "accs", "accfg"], btn: [30, "pri", "prifg"], ok: [44, "oks", "ok"], bad: [24, "bads", "bad"], good: [24, "oks", "ok"], mic: [56, "pri", "prifg"], wa: [40, "wab", "wafg"] } as const;
  return (
    <>
      {rows.map((x, i) => {
        const k = x.tone ?? "row";
        const [h, bg, fg] = K[k];
        const center = k === "btn" || k === "ok" || k === "mic";
        return (
          <div key={i} style={{ display: "flex", alignItems: "center", gap: 6, height: h, padding: "0 9px", borderRadius: k === "mic" ? 28 : k === "wa" ? "10px 10px 2px 10px" : 8, background: V(bg), color: V(fg), border: x.hl ? "2px solid var(--acc)" : k === "row" ? "1px solid var(--bd)" : "1px solid transparent", justifyContent: center ? "center" : "flex-start", fontSize: 11, fontWeight: k === "row" || k === "good" ? 600 : k === "wa" ? 500 : 700, animation: x.hl ? "xPulse 1.8s ease infinite" : k === "mic" ? "xPulse 2s ease infinite" : "none", alignSelf: k === "mic" ? "center" : k === "wa" ? "flex-end" : "stretch", width: k === "mic" ? 56 : k === "wa" ? "84%" : "auto" }}>
            {k === "ok" ? <Ic n="check" size={22} stroke={2.6} /> : k === "mic" ? <Ic n="mic" size={26} stroke={2.6} /> : null}
            {x.t ? <span className="tc-el" style={{ flex: center ? "0 1 auto" : 1 }}>{typeof x.t === "string" ? x.t : tx(x.t)}</span> : null}
            {x.r ? <span className="num" style={{ fontWeight: 700, padding: "1px 7px", borderRadius: 6, background: "var(--s3)", color: "var(--fg)" }}>{x.r}</span> : null}
          </div>
        );
      })}
    </>
  );
}

const step = (t: Pair, d: Pair, pic: ReactNode) => ({ t, d, pic });
const HELP: Record<HelpTopic, { icon: IconName; t: Pair; tone: Tone; href?: string; steps: { t: Pair; d: Pair; pic: ReactNode }[] }> = {
  att: {
    icon: "calCheck", t: p("Mark attendance", "हाज़िरी लगाएँ"), tone: TO, href: "/teach/attendance",
    steps: [
      step(p("Open Attendance", "हाज़िरी खोलें"), p("On Today, tap “Mark attendance”.", "“आज” पर “हाज़िरी लगाएँ” दबाएँ।"), <Mini rows={[{ t: p("Mark attendance", "हाज़िरी लगाएँ"), tone: "btn", hl: true }, { t: p("My class", "मेरी कक्षा") }, { t: p("Marks", "अंक") }]} />),
      step(p("Tap who is absent", "अनुपस्थित पर टैप करें"), p("Everyone starts Present. Tap once for Absent, again for Half-day.", "सब उपस्थित से शुरू। एक बार अनुपस्थित, दोबारा आधा दिन।"), <Mini rows={[{ t: p("Aadhya · Present", "आध्या · उपस्थित"), tone: "good" }, { t: p("Om · Absent", "ओम · अनुपस्थित"), tone: "bad", hl: true }, { t: p("Pari · Present", "परी · उपस्थित"), tone: "good" }]} />),
      step(p("Save attendance", "हाज़िरी सेव करें"), p("Until you save, the office sees “Not marked”.", "सेव करने तक ऑफ़िस को “नहीं लगी” दिखती है।"), <Mini rows={[{ t: p("Save attendance", "हाज़िरी सेव करें"), tone: "btn", hl: true }, { t: "", tone: "ok" }]} />),
    ],
  },
  marks: {
    icon: "clipboard", t: p("Enter marks", "अंक भरें"), tone: TW, href: "/teach/marks",
    steps: [
      step(p("Pick the class", "कक्षा चुनें"), p("Tap Continue on the class you want.", "जिस कक्षा के अंक भरने हैं उस पर “जारी रखें” दबाएँ।"), <Mini rows={[{ t: p("Class 7 Science", "कक्षा 7 विज्ञान"), r: "12/27" }, { t: p("Continue", "जारी रखें"), tone: "btn", hl: true }, { t: p("Class 8 Science", "कक्षा 8 विज्ञान"), r: "0/28" }]} />),
      step(p("Type the mark", "अंक लिखें"), p("After two numbers it jumps to the next child by itself.", "दो अंक लिखते ही अगला बच्चा अपने आप आ जाता है।"), <Mini rows={[{ t: p("Lokesh", "लोकेश"), r: "38" }, { t: p("Muskan", "मुस्कान"), tone: "soft", r: "5_", hl: true }, { t: p("Nidhi", "निधि") }]} />),
      step(p("Check and send", "जाँचें और भेजें"), p("See the summary, then send it to the exam office.", "सारांश देखें, फिर परीक्षा विभाग को भेजें।"), <Mini rows={[{ t: p("Average", "औसत"), r: "56" }, { t: p("Send marks", "अंक भेजें"), tone: "btn", hl: true }, { t: "", tone: "ok" }]} />),
    ],
  },
  note: {
    icon: "edit", t: p("Write a note", "नोट लिखें"), tone: TI, href: "/teach/notes?sheet=add",
    steps: [
      step(p("Pick the child", "बच्चा चुनें"), p("In Notes, tap New note, then the child’s name. Type two letters to find a child.", "नोट्स में “नया नोट” दबाएँ, फिर बच्चे का नाम। बच्चा ढूँढने के लिए दो अक्षर लिखें।"), <Mini rows={[{ t: p("Riya · Aarav · Kabir", "रिया · आरव · कबीर"), hl: true }]} />),
      step(p("Type or speak", "लिखें या बोलें"), p("A line or two in Hindi or English. Tap Speak to talk instead.", "हिंदी या अंग्रेज़ी में एक-दो लाइन। बोलना हो तो “बोलें” दबाएँ।"), <Mini rows={[{ t: p("Riya finds fractions…", "रिया को भिन्न…") }, { t: "", tone: "mic" }]} />),
      step(p("Check and save", "जाँचें और सहेजें"), p("The app sorts the note for you. Check it and tap Save note.", "ऐप नोट को खुद छाँट देता है। जाँचें और “नोट सहेजें” दबाएँ।"), <Mini rows={[{ t: p("Save note", "नोट सहेजें"), tone: "btn", hl: true }, { t: "", tone: "ok" }]} />),
    ],
  },
  link: {
    icon: "link", t: p("Share a marks link", "अंक लिंक भेजें"), tone: TA,
    steps: [
      step(p("Open Marks links", "अंक लिंक खोलें"), p("More → Marks links. One card for each class.", "और → अंक लिंक। हर कक्षा का एक कार्ड।"), <Mini rows={[{ t: p("Class 7 Science", "कक्षा 7 विज्ञान"), tone: "soft", r: "12/27", hl: true }, { t: p("Class 8 Science", "कक्षा 8 विज्ञान"), r: "0/28" }]} />),
      step(p("Tap Share on WhatsApp", "व्हाट्सऐप पर भेजें दबाएँ"), p("Send it to yourself to open it on any phone.", "किसी भी फ़ोन पर खोलने के लिए इसे खुद को भेजें।"), <Mini rows={[{ t: p("Share on WhatsApp", "व्हाट्सऐप पर भेजें"), tone: "btn", hl: true }, { t: p("Copy", "कॉपी") }]} />),
      step(p("Open it and type marks", "खोलें और अंक लिखें"), p("No password. Marks land in the same place.", "पासवर्ड नहीं। अंक उसी जगह पहुँचते हैं।"), <Mini rows={[{ t: p("Your marks link · Class 7", "आपका अंक लिंक · कक्षा 7"), tone: "wa" }, { t: "", tone: "ok" }]} />),
    ],
  },
  news: {
    icon: "megaphone", t: p("Read notices", "सूचनाएँ पढ़ें"), tone: TS,
    steps: [
      step(p("Open Notices", "सूचनाएँ खोलें"), p("The red number shows how many are new.", "लाल अंक बताता है कितनी नई हैं।"), <Mini rows={[{ t: p("Notices", "सूचनाएँ"), tone: "soft", r: "2", hl: true }, { t: p("Marks links", "अंक लिंक") }]} />),
      step(p("Read the notice", "सूचना पढ़ें"), p("The newest one is pinned on top.", "सबसे नई सूचना सबसे ऊपर रहती है।"), <Mini rows={[{ t: p("PTM Sat 17 Oct", "पीटीएम शनि 17 अक्टू"), hl: true }, { t: p("Marks by Wed 14", "अंक बुध 14 तक") }]} />),
      step(p("Tap I have read it", "“पढ़ लिया” दबाएँ"), p("The office can see you have read it.", "ऑफ़िस देख सकता है कि आपने पढ़ ली।"), <Mini rows={[{ t: p("I have read it", "पढ़ लिया"), tone: "btn", hl: true }, { t: "", tone: "ok" }]} />),
    ],
  },
  leave: {
    icon: "calendar", t: p("Ask for leave", "छुट्टी माँगें"), tone: TW,
    steps: [
      step(p("Pick the day", "दिन चुनें"), p("Tap Today, Tomorrow or Pick days, then how long.", "आज, कल या “दिन चुनें” दबाएँ, फिर कितनी देर।"), <Mini rows={[{ t: p("Today", "आज"), tone: "soft", hl: true }, { t: p("Tomorrow", "कल") }]} />),
      step(p("Pick a reason", "कारण चुनें"), p("Unwell, Family function, Personal work or Other.", "बीमार, पारिवारिक कार्यक्रम, निजी काम या अन्य।"), <Mini rows={[{ t: p("Unwell", "बीमार"), hl: true }, { t: p("Family function", "पारिवारिक कार्यक्रम") }]} />),
      step(p("Send to office", "ऑफ़िस को भेजें"), p("The office arranges your classes.", "आपकी कक्षाएँ ऑफ़िस संभालता है।"), <Mini rows={[{ t: p("Send to office", "ऑफ़िस को भेजें"), tone: "btn", hl: true }, { t: "", tone: "ok" }]} />),
    ],
  },
  me: {
    icon: "user", t: p("My profile", "मेरी प्रोफ़ाइल"), tone: TS,
    steps: [
      step(p("Pick your language", "अपनी भाषा चुनें"), p("Under Language, tap English, हिंदी or Both. Every screen changes at once.", "“भाषा” में English, हिंदी या दोनों दबाएँ। हर स्क्रीन तुरंत बदल जाती है।"), <Mini rows={[{ t: "English" }, { t: "हिंदी", tone: "soft", hl: true }, { t: "दोनों · Both" }]} />),
      step(p("Make text bigger", "अक्षर बड़े करें"), p("Under Text size, tap Large. The preview shows how it looks.", "“अक्षर का आकार” में “बड़ा” दबाएँ। नमूने में देखें कैसा दिखेगा।"), <Mini rows={[{ t: p("Normal", "सामान्य") }, { t: p("Large", "बड़ा"), tone: "soft", hl: true }]} />),
      step(p("Change password", "पासवर्ड बदलें"), p("Tap Change password, type the new one twice, and save.", "“पासवर्ड बदलें” दबाएँ, नया पासवर्ड दो बार लिखें और सेव करें।"), <Mini rows={[{ t: p("Change password", "पासवर्ड बदलें"), tone: "btn", hl: true }, { t: "", tone: "ok" }]} />),
    ],
  },
};
