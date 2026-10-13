"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition, type ReactNode } from "react";

import { Ic, type IconName } from "@/vx/icons";
import { useVx } from "@/vx/i18n";
import { initials } from "@/vx/format";
import { p, type Pair } from "@/vx/text";
import { VxPage } from "@/vx/ui/page";
import { Sheet, useToast } from "@/vx/ui/overlays";

import { answerCoverVx, noticeSeenVx, queueBirthdayWishVx } from "../actions";
import type { HomeData } from "../data";
import { birthdayWish, periodPhases, type AttentionReason, type PeriodPhase } from "../domain/teach";
import { ampm, andList, dLong, dShort, greetingPair, greetName, hm12, shortClass, whenSent } from "./fmt";
import { CardTitle, DrawnTick, HelpIcon, HelpPic, HelpSheet, LangSeg, LeaveSheet, LinkRing, TchTop, useUrlState, type HelpStep } from "./shared";

/*
 * Teacher · Today (design TchHome): the register card, the office's notices,
 * quick actions, the day's periods with any cover, the children who need the
 * teacher today, her marks links and her subjects. Two columns on a desk; on
 * a phone one, in the design's order (register, notices, actions, periods,
 * children, links, subjects). Sheets by `?sheet=news|subs|leave|help|link|wish`.
 */

type SheetKey = "news" | "leave" | "help" | "link" | "wish" | "subs";

const HELP: HelpStep[] = [
  { title: p("Start with the blue card", "नीले कार्ड से हाज़िरी लगाएँ।"), body: p("Tap “Mark attendance”. Everyone is already Present — tap only who is away.", "“हाज़िरी लगाएँ” दबाएँ। सब पहले से उपस्थित हैं — सिर्फ़ अनुपस्थित पर टैप करें।"), pic: <HelpPic kind="mark" /> },
  { title: p("Read notices, tap Got it", "सूचना पढ़कर “ठीक है” दबाएँ।"), body: p("The office sees that you have read it. No need to reply.", "ऑफ़िस देख लेता है कि आपने पढ़ लिया। जवाब की ज़रूरत नहीं।"), pic: <HelpPic kind="seen" /> },
  { title: p("Answer a substitution", "सब्स्टिट्यूशन के लिए हाँ या ना दबाएँ।"), body: p("Tap “I’ll take it” or “I can’t”. The office is told at once.", "“मैं ले लूँगी” या “नहीं ले सकती” दबाएँ। ऑफ़िस को तुरंत पता चल जाता है।"), pic: <HelpPic kind="take" /> },
];

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
  coverId?: string;
  acknowledged?: boolean;
  note?: string;
};

export function TeachHome({
  data,
  name,
  initialSheet,
  school,
  officePhone,
  allowed = { attendance: true, marks: true, notes: true },
}: {
  data: HomeData;
  name: string;
  initialSheet: string | null;
  school: string;
  /** The school office's number, for help's "Call the office"; none hides it. */
  officePhone?: string;
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
  const [coverId, setCoverId] = useState<string | null>(data.covers.find((c) => !c.acknowledged)?.id ?? data.covers[0]?.id ?? null);
  const [cantOpen, setCantOpen] = useState(false);
  const [why, setWhy] = useState(0);
  const [whyNote, setWhyNote] = useState("");
  const todaysBirthdays = data.birthdays.filter((b) => b.inDays === 0);
  const [wishFor, setWishFor] = useState<string | null>(todaysBirthdays[0]?.id ?? null);
  const [wishedNow, setWishedNow] = useState<Set<string>>(() => new Set());

  const reg = data.myClass?.register ?? null;
  const classLabel = data.myClass?.classLabel ?? "";

  /* --------------------------------------------------------- the day */
  const rows: Row[] = [];
  for (const per of data.periods) {
    rows.push({ key: `p${per.period}-${per.subjectCode}`, period: per.period, number: per.number, starts: per.starts, ends: per.ends, kind: "cls", title: `${per.classLabel} · ${per.subjectName}`, sub: [`${hm12(per.starts)} – ${hm12(per.ends)}`, per.classId && per.classId === data.myClass?.classId ? tx(p("my class", "मेरी कक्षा")) : null, per.combined ? tx(p("combined", "संयुक्त")) : null].filter(Boolean).join(" · "), icon: subjectIcon(per.subjectName), classId: per.classId });
  }
  for (const c of data.covers) {
    rows.push({ key: `c${c.id}`, period: c.period, number: c.number, starts: c.starts, ends: c.ends, kind: "sub", title: `${c.classLabels} · ${c.subjectName}`, sub: tx(p(`Substitution · for ${c.forName}`, `सब्स्टिट्यूशन · ${c.forName} की जगह`)), icon: "swap", classId: null, coverId: c.id, acknowledged: c.acknowledged, note: c.reason ? tx(p(`${c.forName} is away. Note: ${c.reason}`, `${c.forName} आज नहीं हैं। नोट: ${c.reason}`)) : tx(p(`${c.forName} is away today.`, `${c.forName} आज नहीं हैं।`)) });
  }
  const busy = new Set(rows.map((r) => r.period));
  for (const b of data.bells) {
    if (busy.has(b.period)) continue;
    rows.push({ key: `f${b.period}`, period: b.period, number: b.number, starts: b.starts, ends: b.ends, kind: "free", title: tx(p("Free period", "खाली पीरियड")), sub: `${hm12(b.starts)} – ${hm12(b.ends)}`, icon: "coffee", classId: null });
  }
  rows.sort((a, b) => a.period - b.period);
  const phases: PeriodPhase[] = periodPhases(rows, data.nowMinutes);
  const allOver = rows.length > 0 && phases.every((ph) => ph === "done");
  const later = Boolean(reg) && (rows.length === 0 ? true : allOver) && data.schoolOpen;
  const classCount = rows.filter((r) => r.kind === "cls").length;
  const coverCount = rows.filter((r) => r.kind === "sub").length;
  const freeCount = rows.filter((r) => r.kind === "free").length;
  const left = rows.filter((_, i) => phases[i] !== "done" && rows[i].kind !== "free");

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
        const row = rows.find((r) => r.coverId === id);
        toast.show({ text: tx(a === "acknowledge" ? p(`Added to your day · ${row?.title ?? ""} at ${row ? hm12(row.starts) : ""}`, `आपके दिन में जोड़ा · ${row?.title ?? ""}`) : p("Told the office you can’t · they will ask someone else", "ऑफ़िस को बता दिया · वे किसी और से कहेंगे")) });
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
  const bySubject = new Map<string, string[]>();
  for (const s of data.subjects) bySubject.set(s.name, [...(bySubject.get(s.name) ?? []), shortClass(s.classLabel)]);
  const subjectLine = [...bySubject.entries()].map(([n, cls]) => tx(p(`${n} for ${andList(cls)}`, `${n} — ${andList(cls, "और")}`))).join(" · ");
  const context = [dLong(data.today), data.myClass ? tx(p(`${classLabel} class teacher`, `${classLabel} की कक्षा अध्यापिका`)) : null, subjectLine || null].filter(Boolean).join(" · ");

  /* ---------------------------------------------------------- hero */
  const dots = Math.min(60, data.myClass?.total ?? 0);
  const hero = !data.schoolOpen || !data.myClass ? (
    <div className="card rise" style={{ order: 1, padding: 22, display: "flex", gap: 16, alignItems: "center" }}>
      <span className="tc-ib" style={{ width: 56, height: 56, borderRadius: 16, background: "var(--s2)", color: "var(--acc)" }}><Ic n={data.schoolOpen ? "users" : "coffee"} size={26} /></span>
      <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
        <span className="serif" style={{ fontSize: 24, fontWeight: 600, lineHeight: 1.15 }}>{!data.schoolOpen ? tx(p("No school today", "आज स्कूल बंद है")) : tx(p("No class of your own", "आपकी अपनी कक्षा नहीं"))}</span>
        <span className="tc-p" style={{ color: "var(--mut)" }}>{!data.schoolOpen ? tx(p("No register to take. Enjoy the day.", "आज कोई हाज़िरी नहीं। दिन अच्छा बीते।")) : tx(p("Class teachers take the register. Your periods are below.", "हाज़िरी कक्षा अध्यापक लेते हैं। आपके पीरियड नीचे हैं।"))}</span>
      </span>
    </div>
  ) : reg ? (
    <div className="card rise" style={{ order: 1, padding: 22, display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
        <DrawnTick size={76} />
        <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
          <span className="serif" style={{ fontSize: 26, fontWeight: 600, lineHeight: 1.15 }}>{later ? tx(p("You’re all set for today", "आज का सब काम हो गया")) : tx(p(`${classLabel} attendance is saved`, `${classLabel} की हाज़िरी सहेजी गई`))}</span>
          {sub(later ? p("You’re all set for today", "आज का सब काम हो गया") : p(`${classLabel} attendance is saved`, `${classLabel} की हाज़िरी सहेजी गई`)) ? (
            <span className="tc-p" style={{ color: "var(--mut)" }}>{sub(later ? p("You’re all set for today", "आज का सब काम हो गया") : p(`${classLabel} attendance is saved`, `${classLabel} की हाज़िरी सहेजी गई`))}</span>
          ) : null}
        </span>
      </div>
      <div style={{ display: "flex", flexDirection: "column" }}>
        {[
          [
            tx(p(`Attendance saved · ${reg.present} present · ${reg.absent} absent`, `हाज़िरी सहेजी · ${reg.present} उपस्थित · ${reg.absent} अनुपस्थित`)),
            [classLabel, reg.submittedAt ? tx(p(`saved at ${ampm(reg.submittedAt)}`, `${ampm(reg.submittedAt)} बजे सहेजी`)) : null, reg.alerts ? tx(p(`parents of ${reg.alerts} get a WhatsApp at 10`, `${reg.alerts} अभिभावकों को 10 बजे व्हाट्सऐप`)) : null].filter(Boolean).join(" · "),
          ] as const,
          ...(data.notices[0] && seen.has(data.notices[0].id) ? [[tx(p(`Notice seen · ${data.notices[0].title}`, `सूचना देखी · ${data.notices[0].title}`)), tx(p("The office knows you have read it", "ऑफ़िस को पता है कि आपने पढ़ लिया"))] as const] : []),
          ...data.covers.filter((c) => c.acknowledged && rows.some((r, i) => r.coverId === c.id && phases[i] === "done")).map((c) => [tx(p(`P${c.number} covered · ${c.classLabels} ${c.subjectName}`, `P${c.number} लिया · ${c.classLabels} ${c.subjectName}`)), tx(p(`${c.forName}’s class`, `${c.forName} की कक्षा`))] as const),
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
              {data.tomorrow.first ? `P${data.tomorrow.first.number} · ${hm12(data.tomorrow.first.starts)} · ${data.tomorrow.first.classLabel} ${data.tomorrow.first.subjectName}` : tx(p("No periods", "कोई पीरियड नहीं"))}
            </span>
            <span className="tc-s">{dShort(data.tomorrow.day)}</span>
          </span>
        </div>
      ) : null}
      <Link href={later ? `/teach/attendance?class=${data.myClass.classId}&view=history` : attendHref} className="tc-lnk" style={{ alignSelf: "flex-start" }}>
        {later ? tx(p(`See ${classLabel} attendance this month`, `${classLabel} की इस महीने की हाज़िरी`)) : tx(p("See or change today’s register", "आज की हाज़िरी देखें या बदलें"))}
        <Ic n="chevRight" />
      </Link>
    </div>
  ) : (
    <div className="card rise tc-hero" style={{ order: 1 }}>
      <Ic n="calCheck" size={150} stroke={1.2} style={{ position: "absolute", right: -18, top: -14, opacity: 0.12 }} />
      <span style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, fontWeight: 700, letterSpacing: ".04em", opacity: 0.85 }}>
        <Ic n="calCheck" size={17} />
        {tx(p(`${classLabel} attendance`, `${classLabel} की हाज़िरी`))}
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
        <span className="tc-s" style={{ color: "inherit", opacity: 0.8, flex: "1 1 200px" }}>{tx(p(`Until you save, the office sees ${classLabel} as Not marked.`, `सेव करने तक कार्यालय में ${classLabel} “नहीं लगी” दिखेगी।`))}</span>
      </div>
    </div>
  );

  /* -------------------------------------------------------- periods */
  const pillText = allOver ? tx(p(`All ${rows.length} periods over`, `सभी ${rows.length} पीरियड पूरे`)) : [tx(p(`${classCount} ${classCount === 1 ? "class" : "classes"}`, `${classCount} कक्षाएँ`)), coverCount ? tx(p(`${coverCount} cover`, `${coverCount} सब्स्टिट्यूशन`)) : null, freeCount ? tx(p(`${freeCount} free`, `${freeCount} खाली`)) : null].filter(Boolean).join(" · ");
  const periods = (
    <div className="card tc-card" style={{ order: 4, animationDelay: "120ms" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <CardTitle t={p("My periods today", "आज मेरे पीरियड")} />
        {rows.length ? <span className="pill num" style={{ height: 26, padding: "0 10px", fontSize: 12, background: "var(--s2)", color: "var(--mut)" }}>{pillText}</span> : null}
      </div>
      {!data.published ? (
        <span className="tc-s" style={{ padding: "8px 0" }}>{tx(p("The timetable is not published yet.", "समय-सारणी अभी प्रकाशित नहीं।"))}</span>
      ) : rows.length === 0 ? (
        <span className="tc-s" style={{ padding: "8px 0" }}>{tx(p("No periods today.", "आज कोई पीरियड नहीं।"))}</span>
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
                ? [done ? tx(p("Covered", "लिया")) : tx(p("Covering", "आप ले रही हैं")), V("ok"), V("onsolid")]
                : [tx(p("Asked you", "आपसे पूछा")), V("warn"), V("onsolid")]
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
                  {r.kind === "cls" && r.classId ? (
                    <Link href={`/teach/class?class=${r.classId}`} style={{ color: "inherit" }}>{body}</Link>
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
                          {tx(p("I’ll take it", "मैं ले लूँगी"))}
                        </button>
                        <button type="button" className="tap btn sec" disabled={pending} onClick={() => { setCoverId(r.coverId ?? null); setCantOpen(true); setSheet("subs"); }} style={{ flex: "1 1 100px", height: 48, fontSize: 15 }}>
                          {tx(p("I can’t", "नहीं ले सकती"))}
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
                      <span style={{ flex: 1, fontWeight: 600 }}>{done ? tx(p(`You covered P${r.number} · thank you`, `आपने P${r.number} लिया · धन्यवाद`)) : tx(p(`You’re covering P${r.number} · ${r.title}`, `आप P${r.number} ले रही हैं · ${r.title}`))}</span>
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
        name: k.name,
        ini: initials(k.name),
        bg: TONE[first][0],
        fg: TONE[first][1],
        tag,
        why: k.detail,
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
        b.wished || wishedNow.has(b.id)
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
        name: r.studentName,
        ini: initials(r.studentName),
        bg: late || due ? V("warns") : V("infos"),
        fg: late || due ? V("warnfg") : V("info"),
        tag: due ? tx(p("Review today", "आज समीक्षा")) : late ? tx(p(`Review was ${dShort(r.followUpOn)}`, `समीक्षा ${dShort(r.followUpOn)} थी`)) : tx(p(`Follow-up ${dShort(r.followUpOn).split(" ")[0]}`, `${dShort(r.followUpOn).split(" ")[0]} फ़ॉलो-अप`)),
        why: tx(p(`Your note: ${r.body} · follow-up due ${dShort(r.followUpOn)}`, `आपका नोट: ${r.body} · फ़ॉलो-अप ${dShort(r.followUpOn)}`)),
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
    <div className="card tc-card" style={{ order: 2, animationDelay: "60ms" }}>
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
                {tx(p("Got it", "ठीक है"))}
                {sub(p("Got it", "ठीक है")) ? ` · ${sub(p("Got it", "ठीक है"))}` : ""}
              </button>
            )}
            <button type="button" className="tap btn ghost" onClick={() => openNews(pinned.id)} style={{ height: 46, color: "var(--acc)" }}>{tx(p("Read", "पढ़ें"))}</button>
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
    <div className="card tc-card" style={{ order: 3, animationDelay: "100ms" }}>
      <CardTitle t={p("Quick actions", "जल्दी के काम")} />
      <div className="tc-g2">
        {allowed.attendance ? tile("att", "calCheck", reg ? p("See attendance", "हाज़िरी देखें") : p("Mark attendance", "हाज़िरी लगाएँ"), V("pri"), V("prifg"), reg && later && data.myClass ? `/teach/attendance?class=${data.myClass.classId}&view=history` : attendHref) : null}
        {allowed.marks ? tile("marks", "clipboard", p("Enter marks", "अंक भरें"), V("infos"), V("info"), "/teach/marks") : null}
        {allowed.notes ? tile("note", "mic", p("Speak a note", "बोलकर नोट लिखें"), V("accs"), V("accfg"), "/teach/notes?sheet=add") : null}
        {tile("leave", "calMinus", p("Apply leave", "छुट्टी लें"), V("warns"), V("warnfg"), null)}
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
          {[firstLink.exam, oneSubject ? firstLink.subjectCode : null, firstLink.maxMarks ? tx(p(`out of ${firstLink.maxMarks}`, `${firstLink.maxMarks} में से`)) : null, tx(p("no login needed", "लॉगिन की ज़रूरत नहीं"))].filter(Boolean).join(" · ")}
        </span>
      ) : null}
      <div className="tc-lk">
        {data.links.map((l, i) => {
          const k = look(l.entered, l.total);
          return (
            <button key={l.paperId} type="button" className="tap lift tc-lt" onClick={() => { setLinkId(l.paperId); setSheet("link"); }} aria-label={`${l.classLabel} ${l.subjectCode} marks link, ${k[1]}`}>
              <LinkRing entered={l.entered} total={l.total} tone={k[0]} mid={`${l.entered}/${l.total}`} delay={200 + i * 120} />
              <span className="tc-p" style={{ fontWeight: 700 }}>{oneSubject ? l.classLabel : `${l.classLabel} · ${l.subjectCode}`}</span>
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
              <span style={{ fontWeight: 700 }}>{s.classLabel} · {s.name}</span>
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
  const cover = data.covers.find((c) => c.id === coverId) ?? null;
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
  const stillToday: Pair | null = left.length ? p(`Still left today: ${left.map((r) => `P${r.number} ${r.kind === "sub" ? "cover" : r.title}`).join(" and ")}. The office will give them to other teachers.`, `आज बाकी: ${left.map((r) => `P${r.number}`).join(", ")}। ऑफ़िस ये दूसरे शिक्षकों को देगा।`) : null;
  const helpTitle = p("How this screen works", "यह स्क्रीन कैसे चलाएँ");

  return (
    <VxPage className="tc">
      <TchTop
        crumb={`${tx(p("Teacher", "अध्यापक"))} · ${name} · ${dShort(data.today)}`}
        title={language === "hi" ? "आज · Today" : "Today"}
        actions={
          <>
            <LangSeg />
            <button type="button" className="tap btn sec" onClick={() => setSheet("help")}><Ic n="help" />{tx(p("Help", "मदद"))}</button>
            <button type="button" className="tap btn pri" onClick={() => setSheet("leave")}><Ic n="calMinus" />{tx(p("Apply leave", "छुट्टी लें"))}</button>
          </>
        }
        mLead={
          <Link href="/teach/more" className="tap tc-av" aria-label={tx(p("My menu", "मेरा मेन्यू"))} style={{ width: 40, height: 40, background: "#F6D9A8", color: "#082F49", fontSize: 14 }}>
            {initials(name)}
          </Link>
        }
        mTitle={`${tx(p("Today", "आज"))}${sub(p("Today", "आज")) ? ` · ${sub(p("Today", "आज"))}` : ""}`}
        mSub={later ? `${dShort(data.today)} · ${hm12(`${Math.floor(data.nowMinutes / 60)}:${String(data.nowMinutes % 60).padStart(2, "0")}`)} ${data.nowMinutes >= 720 ? "pm" : "am"}` : [dShort(data.today), classLabel || null, data.subjects[0]?.name ?? null].filter(Boolean).join(" · ")}
        mAction={
          <>
            <LangSeg />
            <HelpIcon onClick={() => setSheet("help")} label={tx(p("Help", "मदद"))} />
          </>
        }
      />
      <main>
        <div className="pad" style={{ padding: "24px 28px 48px", display: "flex", flexDirection: "column", gap: 18, maxWidth: 1260, margin: "0 auto", width: "100%" }}>
          <div className="tc-in" style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            <span className="serif tc-gr" style={{ fontSize: 30, fontWeight: 600, lineHeight: 1.15 }}>{tx(greet)}, {greetName(name)}</span>
            <span className="tc-p" style={{ color: "var(--mut)" }}>{context}</span>
          </div>
          <div className="stack" style={{ display: "grid", gridTemplateColumns: "minmax(0, 1.25fr) minmax(0, 1fr)", gap: 18, alignItems: "start" }}>
            <div className="tc-col">
              {hero}
              {periods}
              {kids}
            </div>
            <div className="tc-col">
              {office}
              {quick}
              {links}
              {subjects}
              {data.otherHeld.length ? (
                <div className="card tc-card" style={{ order: 8 }}>
                  <CardTitle t={p("Your other classes", "आपकी दूसरी कक्षाएँ")} />
                  {data.otherHeld.map((c) => (
                    <Link key={c.classId} href={`/teach/attendance?class=${c.classId}&day=${data.today}`} className="tap tc-sj">
                      <span className="tc-ib" style={{ width: 40, height: 40, borderRadius: 12, background: "var(--accs)", color: "var(--accfg)" }}><Ic n="calCheck" /></span>
                      <span style={{ flex: 1, fontWeight: 700 }}>{c.classLabel}</span>
                      <Ic n="chevRight" />
                    </Link>
                  ))}
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </main>

      {/* ------------------------------------------------------- notices */}
      <Sheet
        open={sheet === "news" && Boolean(cur)}
        onClose={() => setSheet(null)}
        title={tx(p("Notice from the office", "कार्यालय की सूचना"))}
        sub={tx(p("Tap Got it so the office knows you have read it", "“ठीक है” दबाएँ ताकि ऑफ़िस को पता चले"))}
        footer={
          cur && !seen.has(cur.id) ? (
            <button type="button" className="tap btn pri tc-bb" style={{ flex: 1 }} disabled={pending} onClick={() => gotIt([cur.id])}>
              <Ic n="check" />
              {tx(p("Got it", "ठीक है"))}
              {sub(p("Got it", "ठीक है")) ? ` · ${sub(p("Got it", "ठीक है"))}` : ""}
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
        sub={cover ? tx(p(`Today · P${cover.number} · asked by the office at ${ampm(cover.askedAt)}`, `आज · P${cover.number} · ऑफ़िस ने ${ampm(cover.askedAt)} बजे पूछा`)) : undefined}
        footer={
          !cover ? undefined : cover.acknowledged ? (
            <button type="button" className="tap btn pri tc-bb" style={{ flex: 1 }} onClick={() => setSheet(null)}>{tx(p("Done", "ठीक है"))}</button>
          ) : cantOpen ? (
            <>
              <button type="button" className="tap btn ghost tc-bb" onClick={() => setCantOpen(false)}>{tx(p("Back", "पीछे"))}</button>
              <button type="button" className="tap btn pri tc-bb" style={{ flex: 1 }} disabled={pending} onClick={() => answer(cover.id, "cannot_cover", [WHY_NOT[why].en, whyNote.trim()].filter(Boolean).join(" — "))}>
                <Ic n="send" />
                {tx(p("Tell the office", "ऑफ़िस को बताएँ"))}
              </button>
            </>
          ) : (
            <>
              <button type="button" className="tap btn sec tc-bb" style={{ flex: 1 }} onClick={() => setCantOpen(true)}>{tx(p("I can’t", "नहीं ले सकती"))}</button>
              <button type="button" className="tap btn pri tc-bb" style={{ flex: 1.4 }} disabled={pending} onClick={() => answer(cover.id, "acknowledge")}>
                <Ic n="check" />
                {tx(p("I’ll take it", "मैं ले लूँगी"))}
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
                <span style={{ fontWeight: 600 }}>{cover.classLabels} · {cover.subjectName}</span>
                <span className="tc-s">{tx(p(`for ${cover.forName}`, `${cover.forName} की जगह`))}</span>
              </span>
            </div>
            <span className="tc-p">{tx(p(`${cover.forName} is away today. The office asked you to take P${cover.number}.`, `${cover.forName} आज नहीं हैं। ऑफ़िस ने आपसे P${cover.number} लेने को कहा है।`))}</span>
            {cover.reason ? (
              <div className="tc-note" style={{ background: "var(--s2)", flexDirection: "column", gap: 4 }}>
                <span className="sech">{tx(p("Note from the office", "ऑफ़िस का नोट"))}</span>
                <span className="tc-p">“{cover.reason}”</span>
              </div>
            ) : null}
            {cantOpen && !cover.acknowledged ? (
              <div className="tc-in" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <span className="sech">{tx(p("Why can’t you take it?", "क्यों नहीं ले सकतीं?"))}</span>
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
                <span style={{ fontWeight: 600 }}>{tx(p(`You’re covering P${cover.number} · ${cover.classLabels}`, `आप P${cover.number} ले रही हैं · ${cover.classLabels}`))}</span>
              </div>
            ) : null}
          </div>
        ) : (
          <span className="tc-p" style={{ color: "var(--mut)" }}>{tx(p("No cover duty today.", "आज कोई सब्स्टिट्यूशन नहीं।"))}</span>
        )}
      </Sheet>

      {/* ------------------------------------------------------ marks link */}
      <Sheet open={sheet === "link"} onClose={() => setSheet(null)} title={tx(p("Your marks link", "अंक लिंक"))} sub={link ? `Sampark · ${link.exam} · ${link.subjectCode}` : undefined}>
        {link && lk ? (
          <div className="tc-sb">
            <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
              <LinkRing entered={link.entered} total={link.total} size={84} tone={lk[0]} mid={`${link.entered}/${link.total}`} font={16} />
              <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
                <span style={{ fontWeight: 700, fontSize: 18 }}>{link.classLabel} · {link.subjectCode} · {link.exam}</span>
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
        sub={wishKid ? tx(p(`${wishKid.name} · ${classLabel} · turns ${wishKid.turning} today`, `${wishKid.name} · ${classLabel} · आज ${wishKid.turning} साल`)) : undefined}
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

      <LeaveSheet open={sheet === "leave"} onClose={() => setSheet(null)} today={data.today} stillToday={stillToday} />
      <HelpSheet open={sheet === "help"} onClose={() => setSheet(null)} title={helpTitle} sub={p("3 easy steps", "यह स्क्रीन 3 आसान कदमों में")} steps={HELP} phone={officePhone} />
    </VxPage>
  );
}
