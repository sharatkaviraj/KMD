"use client";

import { Crest } from "@/vx/screens/system/brand";
import Link from "@/ui/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { useVx } from "@/vx/i18n";
import { Ic, type IconName } from "@/vx/icons";
import { p, type Pair } from "@/vx/text";
import { Chip, ChipRow, RadioCard, Select, Seg } from "@/vx/ui/controls";
import { HelpButton, Sheet, useToast } from "@/vx/ui/overlays";
import { Banner, TopBar, VxPage } from "@/vx/ui/page";
import { Avatar, avatarColor, Btn, Card, EmptyState, Pill, SecHead, type Tone } from "@/vx/ui/primitives";
import { initials } from "@/vx/format";

import { clockShort, endOf, fixesFor, lengthLabel, minutesOf, slotTimeLabel, type Clash, type Slot } from "./domain/datesheet";
import { GROUP_LABELS, subjectPair, type GroupKey } from "./domain/groups";
import { waLink } from "./domain/messages";
import { chartRows } from "./domain/rooms";
import type { ActionResult } from "./save-types";
import { useAct } from "./use-act";

export type PlanView = "datesheet" | "slot" | "clash" | "seating" | "room" | "duties" | "papers" | "publish";

export type RoomView = { id: string; name: string; seats: number; cols: number; used: number; classes: { classId: string; label: string; count: number; from: number; to: number }[] };

type Act<I> = (input: I) => Promise<ActionResult>;

type QpStatus = "waiting" | "received" | "checked" | "printed";

export type PlanProps = {
  view: PlanView;
  slotId: string | null;
  exam: { id: string; name: Pair; dates: string; daysLeft: number | null; checked: boolean; publishedAt: string | null; copiedFrom: string | null; reportingTime: string };
  exams: { id: string; name: Pair }[];
  days: { day: string; label: string; outside: boolean }[];
  holidays: string[];
  bands: { key: GroupKey; label: Pair; children: number; start: string; minutes: number }[];
  slots: Slot[];
  clashes: Clash[];
  subjects: Record<string, string[]>;
  sources: { id: string; name: Pair; slots: number }[];
  rooms: RoomView[];
  roomId: string | null;
  chart: { seatNo: number; classId: string; classLabel: string; roll: string | null }[];
  totalChildren: number;
  seated: number;
  teachers: { id: string; name: string; phone: string | null; sub: string | null }[];
  dutyDays: { day: string; label: string }[];
  duties: { day: string; roomId: string; staffId: string }[];
  spread: { min: number; max: number; fair: boolean };
  papers: { slotId: string; status: QpStatus; setterId: string | null; setterName: string | null; setterPhone: string | null }[];
  fromName: string;
  actions: {
    saveSlot: Act<{ examId: string; slotId: string | null; groupKey: string; subject: string; day: string; start: string; minutes: number }>;
    swapSlots: Act<{ examId: string; a: string; b: string }>;
    deleteSlot: Act<{ examId: string; slotId: string }>;
    copy: Act<{ examId: string; fromExamId: string }>;
    check: Act<{ examId: string; checked: boolean }>;
    publish: Act<{ examId: string }>;
    fillSeating: Act<{ examId: string }>;
    shareDuties: Act<{ examId: string }>;
    setPaperStatus: Act<{ examId: string; slotId: string; status: string }>;
    setPaperSetter: Act<{ examId: string; slotId: string; staffId: string | null }>;
  };
};

const QP_WORDS: Record<QpStatus, { label: Pair; tone: Tone }> = {
  waiting: { label: p("Being set", "बन रहा है"), tone: "mut" },
  received: { label: p("Received", "आ गया"), tone: "info" },
  checked: { label: p("Checked", "जाँचा"), tone: "acc" },
  printed: { label: p("Printed", "छपा"), tone: "ok" },
};

const START_TIMES = ["08:00", "08:30", "09:00", "11:00"];

export function PlanBoard(props: PlanProps) {
  const { view, exam, slots, clashes, actions } = props;
  const { tx, sub } = useVx();
  const router = useRouter();
  const { pending, run } = useAct();
  const base = `/exam-office/plan?exam=${exam.id}`;
  const href = (v: PlanView, extra = "") => `${base}&view=${v}${extra}`;

  const initialSlot = view === "slot" ? (slots.find((s) => s.id === props.slotId) ?? slots[0] ?? null) : null;
  const [editing, setEditing] = useState<{ slot: Slot | null; groupKey: GroupKey; day: string } | null>(
    initialSlot ? { slot: initialSlot, groupKey: initialSlot.groupKey, day: initialSlot.day } : null,
  );
  const [dutySheet, setDutySheet] = useState(false);
  const [paperSheet, setPaperSheet] = useState<string | null>(null);
  const [setterSheet, setSetterSheet] = useState(false);

  const titles: Record<PlanView, Pair> = {
    datesheet: p("Date sheet", "डेट शीट"),
    slot: p("Date sheet", "डेट शीट"),
    clash: p("Date sheet", "डेट शीट"),
    seating: p("Seating", "बैठक व्यवस्था"),
    room: (() => {
      const r = props.rooms.find((x) => x.id === props.roomId);
      return r ? { en: r.name, hi: r.name.replace("Room", "कक्ष") } : p("Room", "कक्ष");
    })(),
    duties: p("Invigilation duties", "निरीक्षण ड्यूटी"),
    papers: p("Question papers", "प्रश्न पत्र"),
    publish: p("Publish date sheet", "डेट शीट प्रकाशित करें"),
  };
  const crumb = `${tx(p("Exam planning", "परीक्षा योजना"))} · ${tx(exam.name)} · ${exam.dates}`;
  const badge = exam.daysLeft !== null && exam.daysLeft >= 0 ? <Pill tone="ok">{tx(p(`Starts in ${exam.daysLeft} days`, `${exam.daysLeft} दिन में शुरू`))}</Pill> : null;

  const help = (
    <HelpButton
      title={tx(titles[view])}
      steps={[
        { icon: "copy", title: tx(p("Start from the last exam", "पिछली परीक्षा से शुरू करें")), body: tx(p("Copy its order onto this exam's days, then adjust.", "उसका क्रम इस परीक्षा के दिनों पर कॉपी करें, फिर बदलें।")) },
        { icon: "alert", title: tx(p("Fix clashes", "टकराव ठीक करें")), body: tx(p("Two papers on one day for a band is flagged with ways to fix it.", "एक समूह के एक दिन दो पेपर हों तो सुधार के तरीके दिखते हैं।")) },
        { icon: "grid", title: tx(p("Seating and duties fill themselves", "बैठक और ड्यूटी अपने आप")), body: tx(p("Two classes per room by roll number; duties shared fairly.", "रोल नंबर से एक कमरे में दो कक्षाएँ; ड्यूटी बराबर।")) },
      ]}
    />
  );

  const topAction =
    view === "datesheet" || view === "clash" || view === "slot" ? (
      <Btn variant="pri" icon="upload" href={href("publish")}>
        {tx(p("Publish date sheet", "डेट शीट प्रकाशित करें"))}
      </Btn>
    ) : view === "room" && props.rooms.some((r) => r.id === props.roomId) ? (
      <Btn variant="pri" icon="printer" full onClick={() => window.print()}>
        {tx(p("Print room chart", "कक्ष चार्ट छापें"))}
      </Btn>
    ) : view === "duties" && props.duties.length ? (
      <Btn variant="pri" icon="send" onClick={() => setDutySheet(true)}>
        {tx(p("Send duties on WhatsApp", "ड्यूटी WhatsApp पर भेजें"))}
      </Btn>
    ) : null;

  const tabState = {
    datesheet: clashes.length ? "bad" : exam.checked || exam.publishedAt ? "ok" : slots.length ? "warn" : "mut",
    seating: props.seated ? "ok" : "warn",
    duties: props.duties.length ? (props.spread.fair ? "ok" : "warn") : "warn",
    papers: props.papers.length && props.papers.every((x) => x.status !== "waiting") ? "ok" : "warn",
  } as const;
  const tabs: { key: PlanView; label: Pair; icon: IconName }[] = [
    { key: "datesheet", label: p("Date sheet", "डेट शीट"), icon: "calendar" },
    { key: "seating", label: p("Seating", "बैठक व्यवस्था"), icon: "grid" },
    { key: "duties", label: p("Duties", "ड्यूटी"), icon: "users" },
    { key: "papers", label: p("Papers", "प्रश्न पत्र"), icon: "file" },
  ];
  const activeTab = view === "slot" || view === "clash" || view === "publish" ? "datesheet" : view === "room" ? "seating" : view;
  const dot = (k: keyof typeof tabState) => (tabState[k] === "mut" ? "var(--bds)" : `var(--${tabState[k]})`);
  const tabIndex = Math.max(0, tabs.findIndex((t) => t.key === activeTab));

  /* ---------------------------------------------------------- views */
  let body: React.ReactNode = null;
  let detail: React.ReactNode = null;

  if (view === "datesheet" || view === "slot" || view === "clash") {
    body = <DateSheet {...props} onEdit={(slot, groupKey, day) => setEditing({ slot, groupKey, day })} href={href} pending={pending} run={run} narrow={view === "clash" && clashes.length > 0} />;
    if (view === "clash") detail = <ClashPanel {...props} href={href} pending={pending} run={run} />;
  } else if (view === "seating") {
    body = <Seating {...props} href={href} pending={pending} run={run} />;
  } else if (view === "room") {
    body = <RoomChart {...props} href={href} />;
  } else if (view === "duties") {
    body = <Duties {...props} pending={pending} run={run} />;
  } else if (view === "papers") {
    body = <Papers {...props} onOpen={setPaperSheet} onRemind={() => setSetterSheet(true)} />;
  } else if (view === "publish") {
    body = <Publish {...props} href={href} pending={pending} run={run} />;
  }

  const editingPaper = props.papers.find((x) => x.slotId === paperSheet) ?? null;
  const editingSlot = slots.find((s) => s.id === paperSheet) ?? null;
  const waitingSetters = props.teachers.filter((t) => props.papers.some((x) => x.setterId === t.id && x.status === "waiting"));
  const mSub: Record<PlanView, string> = {
    datesheet: clashes.length ? tx(p(`${clashes.length} clash${clashes.length === 1 ? "" : "es"} to fix`, `${clashes.length} टकराव ठीक करना है`)) : `${tx(exam.name)} · ${exam.dates}`,
    slot: clashes.length ? tx(p(`${clashes.length} clash${clashes.length === 1 ? "" : "es"} to fix`, `${clashes.length} टकराव ठीक करना है`)) : `${tx(exam.name)} · ${exam.dates}`,
    clash: tx(p(`${clashes.length} clash${clashes.length === 1 ? "" : "es"} to fix`, `${clashes.length} टकराव ठीक करना है`)),
    seating: props.seated ? tx(p(`${props.seated} of ${props.totalChildren} seated`, `${props.totalChildren} में ${props.seated} बैठे`)) : tx(p("Not seated yet", "अभी बैठक नहीं")),
    room: (() => {
      const r = props.rooms.find((x) => x.id === props.roomId);
      return r ? tx(p(`${r.used} of ${r.seats} seats`, `${r.seats} में ${r.used} सीटें`)) : "";
    })(),
    duties: (() => {
      const need = props.rooms.filter((r) => r.used > 0).length * props.dutyDays.length;
      return props.duties.length ? tx(p(`${props.teachers.length} teachers · ${props.duties.length}/${need} duties`, `${props.teachers.length} शिक्षक · ${props.duties.length}/${need} ड्यूटी`)) : tx(p("Not shared yet", "अभी नहीं बँटी"));
    })(),
    papers: tx(p(`${props.papers.filter((x) => x.status !== "waiting").length} of ${slots.length} received`, `${slots.length} में ${props.papers.filter((x) => x.status !== "waiting").length} आए`)),
    publish: `${tx(exam.name)} · ${exam.dates}`,
  };
  const stickyPhone =
    view === "datesheet" ? (
      <Btn variant="pri" icon="upload" href={href("publish")} full>
        {tx(p("Publish date sheet", "डेट शीट प्रकाशित करें"))}
      </Btn>
    ) : view === "seating" ? (
      <Btn variant="pri" icon="zap" full disabled={pending} onClick={() => run(() => actions.fillSeating({ examId: exam.id }))}>
        {props.seated ? tx(p("Seat everyone again", "फिर से सबको बैठाएँ")) : tx(p("Seat everyone", "सबको बैठाएँ"))}
      </Btn>
    ) : view === "room" && props.rooms.some((r) => r.id === props.roomId) ? (
      <Btn variant="pri" icon="printer" full onClick={() => window.print()}>
        {tx(p("Print room chart", "कक्ष चार्ट छापें"))}
      </Btn>
    ) : view === "duties" && props.duties.length ? (
      <Btn variant="pri" icon="send" full onClick={() => setDutySheet(true)}>
        {tx(p("Send duties on WhatsApp", "ड्यूटी WhatsApp पर भेजें"))}
      </Btn>
    ) : view === "papers" && waitingSetters.length ? (
      <Btn variant="pri" icon="send" full onClick={() => setSetterSheet(true)}>
        {tx(p(`Remind ${waitingSetters.length} teachers`, `${waitingSetters.length} शिक्षकों को याद दिलाएँ`))}
      </Btn>
    ) : null;

  return (
    <VxPage>
      <TopBar
        crumb={crumb}
        title={
          <span style={{ display: "inline-flex", alignItems: "center", gap: 10 }}>
            {tx(titles[view])} {badge}
          </span>
        }
        mTitle={tx(titles[view])}
        mSub={mSub[view]}
        mBack={view === "room" ? href("seating") : view === "clash" || view === "publish" ? href("datesheet") : "/exam-office"}
        actions={
          <>
            {help}
            {topAction}
          </>
        }
        mAction={help}
      />
      <main>
        {props.exams.length > 1 ? (
          <div className="pad" style={{ padding: "16px 28px 0" }}>
            <ChipRow label={tx(p("Exam", "परीक्षा"))}>
              {props.exams.map((e) => (
                <Chip key={e.id} on={e.id === exam.id} onClick={() => router.push(`/exam-office/plan?exam=${e.id}&view=${activeTab}`)}>
                  {tx(e.name)}
                </Chip>
              ))}
            </ChipRow>
          </div>
        ) : null}
        {view !== "publish" && view !== "room" ? (
          <div className={`pad${detail ? " hide-m" : ""}`} style={{ padding: "16px 28px 0" }}>
            <nav aria-label={tx(p("Planning steps", "योजना के चरण"))} className="seg only-d" style={{ gridTemplateColumns: "repeat(4,minmax(0,1fr))", width: 720, maxWidth: "100%" }}>
              <span className="thumb" aria-hidden="true" style={{ width: "calc((100% - 6px) / 4)", transform: `translateX(${tabIndex * 100}%)` }} />
              {tabs.map((t) => (
                <Link key={t.key} href={href(t.key)} className="tap" aria-current={activeTab === t.key ? "page" : undefined} style={{ position: "relative", height: 50, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", lineHeight: 1.2, fontSize: 13, fontWeight: 700, color: activeTab === t.key ? "var(--fg)" : "var(--mut)" }}>
                  <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <Ic n={t.icon} size={15} />
                    {tx(t.label)}
                    <span style={{ width: 8, height: 8, borderRadius: 4, background: dot(t.key as keyof typeof tabState) }} />
                  </span>
                  {sub(t.label) ? <span style={{ fontSize: 11, fontWeight: 500 }}>{sub(t.label)}</span> : null}
                </Link>
              ))}
            </nav>
            <div className="hs only-m" style={{ display: "flex", gap: 6 }}>
              {tabs.map((t) => (
                <Link key={t.key} href={href(t.key)} className={`tap chip${activeTab === t.key ? " on" : ""}`} aria-current={activeTab === t.key ? "page" : undefined}>
                  <Ic n={t.icon} size={16} />
                  {tx(t.label)}
                  <span style={{ width: 8, height: 8, borderRadius: 4, background: dot(t.key as keyof typeof tabState) }} />
                </Link>
              ))}
            </div>
          </div>
        ) : null}
        <div className="stack" style={{ display: "grid", gridTemplateColumns: detail ? "minmax(0,1fr) 400px" : "minmax(0,1fr)", alignItems: "start" }}>
          <section className={`pad${detail ? " hide-m" : ""}`} style={{ padding: "16px 28px 40px", display: "flex", flexDirection: "column", gap: 14, minWidth: 0 }}>
            {body}
          </section>
          {detail ? (
            <aside className="unstick" style={{ position: "sticky", top: 64, maxHeight: "calc(100dvh - 64px)", overflowY: "auto", borderLeft: "1px solid var(--bd)", background: "var(--bg)", padding: "18px 22px 28px", display: "flex", flexDirection: "column", gap: 14, animation: "xPush .36s var(--ease) both" }}>
              {detail}
            </aside>
          ) : null}
        </div>
        {stickyPhone ? (
          <div className="only-m glass" style={{ position: "sticky", bottom: "var(--vx-bottom-h, calc(76px + env(safe-area-inset-bottom)))", zIndex: 4, padding: "10px 16px 12px", borderTop: "1px solid var(--bd)" }}>
            {stickyPhone}
          </div>
        ) : null}
      </main>

      {editing ? <SlotSheet {...props} editing={editing} onClose={() => setEditing(null)} pending={pending} run={run} /> : null}

      <Sheet open={dutySheet} onClose={() => setDutySheet(false)} icon="send" title={tx(p("Send each teacher her duties", "हर शिक्षक को उसकी ड्यूटी भेजें"))} sub={tx(p("From your WhatsApp · one chat each", "आपके WhatsApp से · हर किसी को अलग"))}>
        {props.teachers
          .filter((t) => props.duties.some((d) => d.staffId === t.id))
          .map((t) => {
            const mine = props.duties.filter((d) => d.staffId === t.id).sort((a, b) => a.day.localeCompare(b.day));
            const roomName = (id: string) => props.rooms.find((r) => r.id === id)?.name ?? "—";
            const dayLabel = (d: string) => props.dutyDays.find((x) => x.day === d)?.label ?? d;
            const text = [
              `नमस्ते ${t.name} जी, ${exam.name.hi ?? exam.name.en} में आपकी निरीक्षण ड्यूटी:`,
              ...mine.map((d) => `• ${dayLabel(d.day)} — ${roomName(d.roomId)}`),
              `कृपया ${exam.reportingTime} तक पहुँचें।`,
              "",
              `Your invigilation duties for ${exam.name.en}: ${mine.map((d) => `${dayLabel(d.day)} ${roomName(d.roomId)}`).join(", ")}. Please reach by ${exam.reportingTime}.`,
              `— ${props.fromName}`,
            ].join("\n");
            return (
              <div key={t.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 0", borderTop: "1px solid var(--bd)" }}>
                <Avatar text={initials(t.name)} bg={avatarColor(t.id)} size={34} />
                <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
                  <strong className="clip">{t.name}</strong>
                  <span style={{ fontSize: 12, color: "var(--mut)" }}>
                    {mine.length} {tx(p("duties", "ड्यूटी"))}
                  </span>
                </span>
                <a className="tap btn pri" href={waLink(t.phone, text)} target="_blank" rel="noopener noreferrer">
                  <Ic n="send" size={16} /> WhatsApp
                </a>
              </div>
            );
          })}
      </Sheet>

      <Sheet open={setterSheet} onClose={() => setSetterSheet(false)} icon="bell" title={tx(p("Remind teachers still setting papers", "प्रश्न पत्र बना रहे शिक्षकों को याद दिलाएँ"))} sub={tx(p("One gentle reminder each, with their list", "हर किसी को उसकी सूची के साथ एक याद"))}>
        {waitingSetters.length === 0 ? <span style={{ color: "var(--mut)" }}>{tx(p("Every paper with a setter has come in.", "जिनके बनाने वाले तय हैं, सब पेपर आ गए।"))}</span> : null}
        {waitingSetters.map((t) => {
          const list = props.papers
            .filter((x) => x.setterId === t.id && x.status === "waiting")
            .map((x) => slots.find((s) => s.id === x.slotId))
            .filter(Boolean) as Slot[];
          const text = [
            `नमस्ते ${t.name} जी, ${exam.name.hi ?? exam.name.en} के ये प्रश्न पत्र अभी बाकी हैं:`,
            ...list.map((s) => `• ${tx(GROUP_LABELS[s.groupKey])} ${s.subject}`),
            "",
            `${exam.name.en} question papers still to come: ${list.map((s) => `${GROUP_LABELS[s.groupKey].en} ${s.subject}`).join(", ")}.`,
            `— ${props.fromName}`,
          ].join("\n");
          return (
            <div key={t.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 0", borderTop: "1px solid var(--bd)" }}>
              <Avatar text={initials(t.name)} bg={avatarColor(t.id)} size={34} />
              <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
                <strong className="clip">{t.name}</strong>
                <span style={{ fontSize: 12, color: "var(--mut)" }}>
                  {list.length} {tx(p("papers", "पेपर"))}
                </span>
              </span>
              <a className="tap btn pri" href={waLink(t.phone, text)} target="_blank" rel="noopener noreferrer">
                <Ic n="send" size={16} /> WhatsApp
              </a>
            </div>
          );
        })}
      </Sheet>

      <Sheet
        open={Boolean(editingSlot)}
        onClose={() => setPaperSheet(null)}
        icon="file"
        title={editingSlot ? `${tx(GROUP_LABELS[editingSlot.groupKey])} · ${editingSlot.subject}` : ""}
        sub={editingSlot ? props.days.find((d) => d.day === editingSlot.day)?.label : ""}
      >
        {editingSlot ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <SecHead>{tx(p("Where it has got to", "कहाँ तक पहुँचा"))}</SecHead>
            {(Object.keys(QP_WORDS) as QpStatus[]).map((s) => (
              <RadioCard
                key={s}
                checked={(editingPaper?.status ?? "waiting") === s}
                title={tx(QP_WORDS[s].label)}
                onSelect={() => run(() => actions.setPaperStatus({ examId: exam.id, slotId: editingSlot.id, status: s }))}
              />
            ))}
            <SecHead>{tx(p("Set by", "बनाने वाले"))}</SecHead>
            <Select
              aria-label={tx(p("Set by", "बनाने वाले"))}
              value={editingPaper?.setterId ?? ""}
              disabled={pending}
              onChange={(e) => run(() => actions.setPaperSetter({ examId: exam.id, slotId: editingSlot.id, staffId: e.target.value || null }))}
            >
              <option value="">{tx(p("Not decided", "तय नहीं"))}</option>
              {props.teachers.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </Select>
          </div>
        ) : null}
      </Sheet>
    </VxPage>
  );
}

type Run = ReturnType<typeof useAct>["run"];

/* ------------------------------------------------------- date sheet */

/** The design's subject colours: English blue, Hindi amber, Maths teal, sciences green, the rest grey. */
const SUBJECT_TONE: Record<string, Tone> = {
  English: "info",
  Hindi: "warn",
  "Hindi Lit.": "warn",
  Maths: "acc",
  "Maths / Bio": "acc",
  "Maths/Bio": "acc",
  Accountancy: "acc",
  Accounts: "acc",
  EVS: "ok",
  Science: "ok",
  Physics: "ok",
  Chemistry: "ok",
};
function subjectTone(subject: string): Tone {
  return SUBJECT_TONE[subject.split(" · ")[0].trim()] ?? "mut";
}
const toneBg = (t: Tone) => (t === "mut" ? "var(--s3)" : `var(--${t}s)`);
const toneFg = (t: Tone) => (t === "mut" ? "var(--fg)" : t === "warn" ? "var(--warnfg)" : t === "acc" ? "var(--accfg)" : `var(--${t})`);

/** "Thu 10 Dec" and "गुरु 10" for a date-sheet day. */
function dayLong(day: string): string {
  return new Intl.DateTimeFormat("en-IN", { timeZone: "UTC", weekday: "short", day: "numeric", month: "short" }).format(new Date(`${day}T12:00:00Z`)).replace(",", "");
}
function dayHi(day: string): string {
  return `${new Intl.DateTimeFormat("hi-IN", { timeZone: "UTC", weekday: "short" }).format(new Date(`${day}T12:00:00Z`))} ${Number(day.slice(8))}`;
}

function dayHiLong(day: string): string {
  return `${dayHi(day)} ${new Intl.DateTimeFormat("hi-IN", { timeZone: "UTC", month: "short" }).format(new Date(`${day}T12:00:00Z`))}`;
}
/** A combined sitting ("Physics · Accountancy · History") in Hindi, one subject at a time. */
function subjectHi(subject: string): string {
  return subject
    .split(" · ")
    .map((x) => subjectPair(x).hi ?? x)
    .join(" / ");
}

function DateSheet(props: PlanProps & { onEdit: (slot: Slot | null, groupKey: GroupKey, day: string) => void; href: (v: PlanView, extra?: string) => string; pending: boolean; run: Run; narrow: boolean }) {
  const { exam, slots, clashes, days, bands, actions, run, pending } = props;
  const { tx } = useVx();
  const clashIds = new Set(clashes.flatMap((c) => c.slotIds));
  const firstClashDay = days.findIndex((d) => clashes.some((c) => c.day === d.day));
  const [mDay, setMDay] = useState(Math.max(0, firstClashDay));

  if (slots.length === 0) {
    return (
      <Card style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <EmptyState
          icon="calendar"
          title={tx(p("No date sheet yet", "अभी कोई डेट शीट नहीं"))}
          body={tx(p("Start from an earlier exam's order, or add papers one by one.", "पिछली परीक्षा के क्रम से शुरू करें, या एक-एक पेपर जोड़ें।"))}
        />
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10, justifyContent: "center" }}>
          {props.sources.map((s) => (
            <Btn key={s.id} variant="pri" icon="copy" disabled={pending} onClick={() => run(() => actions.copy({ examId: exam.id, fromExamId: s.id }))}>
              {tx(p(`Copy from ${s.name.en}`, `${s.name.hi ?? s.name.en} से कॉपी करें`))} ({s.slots})
            </Btn>
          ))}
          <Btn variant="sec" icon="plus" onClick={() => props.onEdit(null, bands[0]?.key ?? "c1_5", days[0]?.day ?? "")}>
            {tx(p("Add a paper", "पेपर जोड़ें"))}
          </Btn>
        </div>
      </Card>
    );
  }

  const first = clashes[0];
  const cols = `${props.narrow ? 104 : 150}px repeat(${days.length},minmax(0,1fr))`;
  const bad = (g: GroupKey, d: string) => clashes.some((c) => c.groupKey === g && c.day === d);
  const paper = (s: Slot, big = false) => {
    const tone = subjectTone(s.subject);
    const isBad = clashIds.has(s.id);
    return (
      <button
        key={s.id}
        type="button"
        className="tap"
        aria-label={`${tx(GROUP_LABELS[s.groupKey])} ${s.subject} · ${dayLong(s.day)}${isBad ? ` · ${tx(p("clash", "टकराव"))}` : ""}`}
        onClick={() => props.onEdit(s, s.groupKey, s.day)}
        style={{ width: "100%", minHeight: big ? 48 : undefined, display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 1, padding: "7px 9px", borderRadius: 10, border: `1.5px solid ${isBad ? "var(--bad)" : "transparent"}`, background: isBad ? "var(--bads)" : toneBg(tone), color: isBad ? "var(--bad)" : toneFg(tone), textAlign: "left", lineHeight: 1.25, cursor: "pointer" }}
      >
        <b style={{ fontSize: big ? 15 : 13 }}>{s.subject}</b>
        <span className="num" style={{ fontSize: big ? 13 : 11, opacity: 0.8 }}>{slotTimeLabel(s)}</span>
      </button>
    );
  };
  const empty = (b: GroupKey, d: string, big = false) => (
    <button type="button" className="tap" aria-label={tx(p("Add a paper", "पेपर जोड़ें"))} onClick={() => props.onEdit(null, b, d)} style={{ width: "100%", minHeight: big ? 48 : 46, flex: 1, borderRadius: 10, border: "1.5px dashed var(--bd)", background: "transparent", color: "var(--sub)", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
      {big ? tx(p("No paper · tap to add", "पेपर नहीं · जोड़ने को टैप करें")) : tx(p("No paper", "पेपर नहीं"))}
    </button>
  );
  const mday = days[mDay] ?? days[0];

  return (
    <>
      {exam.publishedAt ? (
        <Banner tone="ok">{tx(p("This date sheet is published. Changes reach teachers when you publish again.", "यह डेट शीट प्रकाशित है। बदलाव दोबारा प्रकाशित करने पर पहुँचेंगे।"))}</Banner>
      ) : exam.checked ? (
        <Banner tone="ok" action={<Btn variant="ghost" disabled={pending} onClick={() => run(() => actions.check({ examId: exam.id, checked: false }))}>{tx(p("Back to draft", "फिर से कच्ची करें"))}</Btn>}>
          {tx(p("Checked and final — publish it when you are ready.", "जाँची और पक्की — तैयार हों तो प्रकाशित करें।"))}
        </Banner>
      ) : (
        <div className="card" style={{ padding: "14px 16px", display: "flex", flexWrap: "wrap", alignItems: "center", gap: 12, borderColor: "var(--acc)", background: "var(--accs)", color: "var(--accfg)", animation: "xIn .3s var(--ease) both" }}>
          <span style={{ flex: "none", width: 42, height: 42, borderRadius: 13, background: "var(--card)", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Ic n="copy" size={18} />
          </span>
          <span style={{ flex: 1, minWidth: 220, display: "flex", flexDirection: "column" }}>
            <b style={{ fontSize: 15 }}>{exam.copiedFrom ? tx(p(`Copied from ${exam.copiedFrom} — check and adjust`, `${exam.copiedFrom} से कॉपी — जाँचें और बदलें`)) : tx(p("Draft — check the dates", "अभी कच्ची — तिथियाँ जाँचें"))}</b>
            <span style={{ fontSize: 13 }}>{tx(p(`Same order${exam.copiedFrom ? ` as ${exam.copiedFrom}` : ""}, moved to ${exam.dates}. Sundays and holidays are left out.`, `वही क्रम, ${exam.dates} पर। रविवार और छुट्टियाँ छोड़ी गईं।`))}</span>
          </span>
          <button type="button" className="tap btn sec mfull" disabled={pending || clashes.length > 0} onClick={() => run(() => actions.check({ examId: exam.id, checked: true }))} style={{ flex: "none" }}>
            <Ic n="check" size={18} />
            {tx(p("Looks good", "ठीक है"))}
          </button>
        </div>
      )}
      {first ? (
        <Link href={props.href("clash")} className="tap" style={{ display: "flex", alignItems: "center", gap: 10, width: "100%", padding: "12px 14px", borderRadius: 14, fontSize: 13, lineHeight: 1.5, background: "var(--bads)", color: "var(--bad)", textDecoration: "none", animation: "xIn .3s var(--ease) both" }}>
          <Ic n="alert" size={18} />
          <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
            <b>{clashTitle(first, slots, tx)}</b>
            <span style={{ fontSize: 13 }}>
              {props.bands.find((b) => b.key === first.groupKey)?.children ?? 0} {tx(p("children", "बच्चे"))} · {dayLong(first.day)} · {first.slotIds.map((id) => slots.find((s) => s.id === id)).filter(Boolean).map((s) => clockShort((s as Slot).start)).join(tx(p(" and ", " और ")))}
              {clashes.length > 1 ? ` · +${clashes.length - 1} ${tx(p("more", "और"))}` : ""}
            </span>
          </span>
          <b style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 13 }}>
            {tx(p("See fixes", "सुधार देखें"))}
            <Ic n="chevRight" size={16} />
          </b>
        </Link>
      ) : null}

      <div className="only-d card" style={{ overflow: "hidden", padding: 0 }}>
        <div style={{ display: "grid", gridTemplateColumns: cols, gap: 8, alignItems: "stretch", padding: "10px 12px", background: "var(--s2)", borderBottom: "1px solid var(--bd)" }}>
          <span className="sech" style={{ alignSelf: "center" }}>{tx(p("Classes", "कक्षाएँ"))}</span>
          {days.map((d) => (
            <span key={d.day} style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
              <b style={{ fontSize: 13, color: d.outside ? "var(--bad)" : undefined }}>{d.label}</b>
              <span style={{ fontSize: 11, color: "var(--mut)" }}>{dayHi(d.day)}</span>
            </span>
          ))}
        </div>
        {bands.map((b, i) => (
          <div key={b.key} style={{ display: "grid", gridTemplateColumns: cols, gap: 8, alignItems: "stretch", padding: "8px 12px", borderTop: i ? "1px solid var(--bd)" : undefined, animation: `xIn .3s var(--ease) ${Math.min(i * 30, 150)}ms both` }}>
            <span style={{ display: "flex", flexDirection: "column", alignSelf: "center", minWidth: 0 }}>
              <b className="clip">{tx(b.label)}</b>
              <span className="clip" style={{ fontSize: 12, color: "var(--mut)" }}>{b.children} {tx(p("children", "बच्चे"))}</span>
              <span className="clip num" style={{ fontSize: 12, color: "var(--mut)" }}>{clockShort(b.start)} · {lengthLabel(b.minutes)}</span>
            </span>
            {days.map((d) => {
              const here = slots.filter((s) => s.groupKey === b.key && s.day === d.day).sort((x, y) => minutesOf(x.start) - minutesOf(y.start));
              return (
                <div key={d.day} style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0, padding: 3, borderRadius: 12, background: bad(b.key, d.day) ? "var(--bads)" : "transparent" }}>
                  {here.map((s) => paper(s))}
                  {here.length === 0 ? empty(b.key, d.day) : null}
                </div>
              );
            })}
          </div>
        ))}
      </div>

      <div className="only-m" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <div className="seg" role="group" aria-label={tx(p("Day", "दिन"))} style={{ gridTemplateColumns: `repeat(${days.length},minmax(0,1fr))` }}>
          <span className="thumb" aria-hidden="true" style={{ width: `calc((100% - 6px) / ${days.length})`, transform: `translateX(${mDay * 100}%)` }} />
          {days.map((d, i) => (
            <button key={d.day} type="button" className={i === mDay ? "tap on" : "tap"} aria-pressed={i === mDay} onClick={() => setMDay(i)} style={{ height: 50, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", lineHeight: 1.2 }}>
              <span>{d.label.split(" ")[0]}</span>
              <span style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11, fontWeight: 500 }}>
                {d.label.split(" ")[1] ?? ""}
                <span style={{ width: 6, height: 6, borderRadius: 3, background: clashes.some((c) => c.day === d.day) ? "var(--bad)" : "transparent" }} />
              </span>
            </button>
          ))}
        </div>
        {mday ? (
          <div className="card" style={{ overflow: "hidden", padding: 0 }}>
            {bands.map((b, i) => {
              const here = slots.filter((s) => s.groupKey === b.key && s.day === mday.day).sort((x, y) => minutesOf(x.start) - minutesOf(y.start));
              return (
                <div key={b.key} style={{ display: "flex", alignItems: "flex-start", gap: 12, padding: "12px 14px", borderTop: i ? "1px solid var(--bd)" : undefined, background: bad(b.key, mday.day) ? "var(--bads)" : "transparent" }}>
                  <span style={{ flex: "none", width: 96, display: "flex", flexDirection: "column" }}>
                    <b>{tx(b.label).replace(/^Classes\s+/, "").replace(/^कक्षा\s+/, "")}</b>
                    <span className="num" style={{ fontSize: 12, color: "var(--mut)" }}>{clockShort(b.start)} · {lengthLabel(b.minutes)}</span>
                  </span>
                  <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 6 }}>
                    {here.map((s) => paper(s, true))}
                    {here.length === 0 ? empty(b.key, mday.day, true) : null}
                  </span>
                </div>
              );
            })}
          </div>
        ) : null}
      </div>
      <span style={{ fontSize: 12, color: "var(--mut)" }}>
        {tx(p(`Tap any paper to change its day, time or length. Reporting time is ${exam.reportingTime} every day.`, `दिन, समय या अवधि बदलने के लिए पेपर पर टैप करें। रोज़ पहुँचने का समय ${exam.reportingTime}।`))}
      </span>
    </>
  );
}

function clashTitle(c: Clash, slots: Slot[], tx: (pair: Pair) => string): string {
  const band = tx(GROUP_LABELS[c.groupKey]);
  const names = c.slotIds.map((id) => slots.find((s) => s.id === id)?.subject ?? "").filter(Boolean);
  if (c.kind === "same_day") return tx(p(`${band} have ${names.join(" and ")} on the same day`, `${band} में ${names.join(" और ")} एक ही दिन`));
  if (c.kind === "sunday") return tx(p(`${band} have a paper on a Sunday`, `${band} का पेपर रविवार को`));
  return tx(p(`${band} have a paper on a holiday`, `${band} का पेपर छुट्टी के दिन`));
}

function ClashPanel(props: PlanProps & { href: (v: PlanView, extra?: string) => string; pending: boolean; run: Run }) {
  const { clashes, slots, exam, actions, run, pending } = props;
  const { tx } = useVx();
  const router = useRouter();
  const clash = clashes[0];
  const [pick, setPick] = useState(0);
  if (!clash) {
    return (
      <div className="card fadein" style={{ padding: "28px 22px", display: "flex", flexDirection: "column", alignItems: "center", gap: 10, textAlign: "center" }}>
        <span style={{ width: 80, height: 80, borderRadius: 40, background: "var(--oks)", color: "var(--ok)", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <Ic n="check" size={36} />
        </span>
        <span className="serif" style={{ fontSize: 22, fontWeight: 600 }}>{tx(p("No clashes left", "कोई टकराव नहीं बचा"))}</span>
        <span style={{ color: "var(--mut)" }}>{tx(p("Every class has one paper a day.", "हर कक्षा का दिन में एक पेपर।"))}</span>
        <Btn variant="pri" icon="upload" href={props.href("publish")} full>{tx(p("Publish date sheet", "डेट शीट प्रकाशित करें"))}</Btn>
        <Btn variant="ghost" href={props.href("datesheet")} full>{tx(p("Back to the date sheet", "डेट शीट पर वापस"))}</Btn>
      </div>
    );
  }
  const fixes = fixesFor(
    clash,
    slots,
    props.days.filter((d) => !d.outside).map((d) => d.day),
  );
  const daySlots = slots.filter((s) => s.groupKey === clash.groupKey && s.day === clash.day).sort((a, b) => minutesOf(a.start) - minutesOf(b.start));
  const from = 8 * 60;
  const to = 13 * 60;
  const band = props.bands.find((b) => b.key === clash.groupKey);

  const apply = () => {
    const fix = fixes[pick];
    if (!fix) {
      router.push(props.href("datesheet"));
      return;
    }
    const slot = slots.find((s) => s.id === fix.slotId);
    if (!slot) return;
    run(
      () => actions.saveSlot({ examId: exam.id, slotId: slot.id, groupKey: slot.groupKey, subject: slot.subject, day: fix.toDay, start: fix.start, minutes: slot.minutes }),
      () => router.push(props.href(clashes.length > 1 ? "clash" : "datesheet")),
    );
  };
  const options = [
    ...fixes.map((f, i) => {
      const s = slots.find((x) => x.id === f.slotId);
      const other = daySlots.find((x) => x.id !== f.slotId);
      return {
        key: `${f.slotId}${f.toDay}`,
        title: tx(p(`Move ${s?.subject ?? ""} to ${dayLong(f.toDay)}`, `${s?.subject ?? ""} को ${dayLong(f.toDay)} पर ले जाएँ`)),
        sub: tx(p(`${dayLong(f.toDay)} is free for ${tx(GROUP_LABELS[clash.groupKey])}.${other ? ` ${other.subject} stays on ${dayLong(clash.day)}.` : ""}`, `${dayLong(f.toDay)} इस समूह के लिए खाली।${other ? ` ${other.subject} ${dayLong(clash.day)} को रहेगा।` : ""}`)),
        best: i === 0,
      };
    }),
    { key: "keep", title: tx(p(`Keep both on ${dayLong(clash.day)}`, `दोनों ${dayLong(clash.day)} को रखें`)), sub: tx(p("Allowed, but children sit two papers that day.", "चल सकता है, पर बच्चे उस दिन दो पेपर देंगे।")), best: false },
  ];

  return (
    <>
      <div className="only-d" style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span className="pill" style={{ height: 26, padding: "0 10px", fontSize: 12, background: "var(--bads)", color: "var(--bad)" }}>{tx(p(`${clashes.length} clash${clashes.length === 1 ? "" : "es"} found`, `${clashes.length} टकराव`))}</span>
        <Btn variant="ghost" icon="x" href={props.href("datesheet")} ariaLabel={tx(p("Close the clash panel", "टकराव पैनल बंद करें"))} style={{ width: 40, height: 36, padding: 0 }} />
      </div>
      <div className="card" style={{ padding: "16px 18px", display: "flex", flexDirection: "column", gap: 12, borderColor: "var(--bad)" }}>
        <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ flex: "none", width: 40, height: 40, borderRadius: 12, background: "var(--bads)", color: "var(--bad)", display: "flex", alignItems: "center", justifyContent: "center", animation: "xShake .5s ease" }}>
            <Ic n="alert" size={18} />
          </span>
          <span className="serif" style={{ fontSize: 19, fontWeight: 600, lineHeight: 1.15 }}>{clashTitle(clash, slots, tx)}</span>
        </span>
        <span style={{ fontSize: 13, lineHeight: 1.5, color: "var(--mut)" }}>
          {clash.kind === "same_day"
            ? tx(p("Children should write one big paper a day. Two papers tire them out and leave no time to revise the evening before.", "बच्चों को दिन में एक ही बड़ा पेपर लिखना चाहिए। दो पेपर थका देते हैं और पिछली शाम दोहराने का समय नहीं बचता।"))
            : tx(p("The school is closed that day.", "उस दिन स्कूल बंद है।"))}
        </span>
        <span className="sech">
          {dayLong(clash.day)} · {band?.children ?? 0} {tx(p("children", "बच्चे"))}
        </span>
        <div style={{ position: "relative", height: 74, borderRadius: 12, background: "var(--s2)" }}>
          {daySlots.map((s, i) => {
            const left = ((minutesOf(s.start) - from) / (to - from)) * 100;
            const width = (s.minutes / (to - from)) * 100;
            const tone = subjectTone(s.subject);
            return (
              <span key={s.id} style={{ position: "absolute", top: 8 + i * 32, left: `${Math.max(0, left)}%`, width: `${Math.min(100 - Math.max(0, left), width)}%`, height: 26, borderRadius: 7, padding: "0 8px", display: "flex", alignItems: "center", fontSize: 11, fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", background: toneBg(tone), color: toneFg(tone), transformOrigin: "left", animation: "xGrowX .5s var(--ease) both" }}>
                {s.subject}
              </span>
            );
          })}
        </div>
        <div className="num" style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "var(--mut)" }}>
          {[8, 9, 10, 11, 12, 13].map((h) => (
            <span key={h}>{h > 12 ? h - 12 : h}:00</span>
          ))}
        </div>
      </div>
      <span className="sech">{tx(p("Ways to fix it", "सुधार के तरीके"))}</span>
      {options.map((o, i) => {
        const on = pick === i;
        return (
          <button key={o.key} type="button" role="radio" aria-checked={on} className="tap" onClick={() => setPick(i)} style={{ width: "100%", display: "flex", alignItems: "center", gap: 12, minHeight: 58, padding: "10px 14px", borderRadius: 14, border: on ? "2px solid var(--acc)" : "1px solid var(--bd)", background: on ? "var(--accs)" : "var(--card)", color: "var(--fg)", textAlign: "left" }}>
            <span style={{ flex: "none", width: 20, height: 20, borderRadius: 10, border: `2px solid ${on ? "var(--acc)" : "var(--bds)"}`, display: "flex", alignItems: "center", justifyContent: "center" }}>
              <span style={{ width: 10, height: 10, borderRadius: 5, background: "var(--acc)", transform: `scale(${on ? 1 : 0})`, transition: "transform .25s var(--spring)" }} />
            </span>
            <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
              <span style={{ fontWeight: 600 }}>{o.title}</span>
              <span style={{ fontSize: 12, color: "var(--mut)" }}>{o.sub}</span>
            </span>
            {o.best ? <span className="pill" style={{ background: "var(--oks)", color: "var(--ok)" }}>{tx(p("Best fix", "सबसे अच्छा"))}</span> : null}
          </button>
        );
      })}
      <Btn variant="pri" icon="check" full disabled={pending} onClick={apply} style={{ height: 48, fontSize: 15 }}>
        {pick < fixes.length ? tx(p("Fix it", "ठीक करें")) : tx(p("Keep as it is", "जैसा है रखें"))}
      </Btn>
      <span style={{ fontSize: 12, color: "var(--mut)" }}>{tx(p("You can change it again any time from the date sheet.", "डेट शीट से कभी भी फिर बदल सकते हैं।"))}</span>
    </>
  );
}

function SlotSheet(props: PlanProps & { editing: { slot: Slot | null; groupKey: GroupKey; day: string }; onClose: () => void; pending: boolean; run: Run }) {
  const { editing, exam, slots, actions, run, pending } = props;
  const { tx } = useVx();
  const X = editing.slot;
  const band = props.bands.find((b) => b.key === editing.groupKey);
  const bandName = tx(GROUP_LABELS[editing.groupKey]);
  const inBand = slots.filter((s) => s.groupKey === editing.groupKey).sort((a, b) => a.day.localeCompare(b.day) || a.start.localeCompare(b.start));
  const firstFree = props.subjects[editing.groupKey]?.find((s) => !inBand.some((x) => x.subject === s));
  const [subject, setSubject] = useState(X?.subject ?? inBand[0]?.subject ?? firstFree ?? "");
  const [day, setDay] = useState(editing.day || props.days[0]?.day || "");
  const [start, setStart] = useState(X?.start ?? band?.start ?? "08:30");
  const [minutes, setMinutes] = useState(X?.minutes ?? band?.minutes ?? 90);
  /** The paper the chip picks. Another paper of this band means a swap (or a move to an empty day). */
  const Y = inBand.find((s) => s.subject === subject && s.id !== X?.id) ?? null;
  const busyDays = new Set(inBand.filter((s) => s.id !== X?.id && s.id !== Y?.id).map((s) => s.day));
  const sameDay = inBand.filter((s) => s.day === day && s.id !== X?.id && s.id !== Y?.id);
  const subjectChoices = [...new Set([...inBand.map((s) => s.subject), ...(props.subjects[editing.groupKey] ?? []), ...(subject ? [subject] : [])])];
  const times = [...new Set([...START_TIMES, start])].sort();
  const label = (t: string) => {
    const [h, m] = t.split(":").map(Number);
    return `${h > 12 ? h - 12 : h}:${String(m).padStart(2, "0")} ${h >= 12 ? "pm" : "am"}`;
  };
  const subNote = X
    ? Y
      ? tx(p(`Swap: ${Y.subject} comes here and ${X.subject} moves to ${dayLong(Y.day)}.`, `अदला-बदली: ${Y.subject} यहाँ आएगा और ${X.subject} ${dayLong(Y.day)} को जाएगा।`))
      : tx(p("Pick another paper to swap the two days.", "दोनों दिन बदलने के लिए दूसरा पेपर चुनें।"))
    : Y
      ? tx(p(`${Y.subject} moves here from ${dayLong(Y.day)}.`, `${Y.subject} ${dayLong(Y.day)} से यहाँ आएगा।`))
      : tx(p("A new paper on this day.", "इस दिन नया पेपर।"));
  const save = () => {
    if (X && Y) return run(() => actions.swapSlots({ examId: exam.id, a: X.id, b: Y.id }), props.onClose);
    const slotId = X?.id ?? Y?.id ?? null;
    return run(() => actions.saveSlot({ examId: exam.id, slotId, groupKey: editing.groupKey, subject: subject.trim(), day, start, minutes }), props.onClose);
  };

  return (
    <Sheet
      open
      onClose={props.onClose}
      title={X ? `${bandName} · ${X.subject}` : `${bandName} · ${day ? dayLong(day) : ""}`}
      sub={X ? `${dayLong(X.day)} · ${clockShort(X.start)}–${clockShort(endOf(X))} · ${lengthLabel(X.minutes)}` : tx(p("No paper on this day yet · pick one to move here", "इस दिन अभी कोई पेपर नहीं · यहाँ लाने के लिए एक चुनें"))}
      footer={
        <div style={{ display: "flex", gap: 10, width: "100%" }}>
          <button type="button" className="tap btn sec" onClick={props.onClose} style={{ flex: 1 }}>
            {tx(p("Cancel", "रद्द करें"))}
          </button>
          <button type="button" className="tap btn pri" disabled={pending || !subject.trim() || !day} onClick={save} style={{ flex: 1.6 }}>
            <Ic n="check" size={18} />
            {X || Y ? tx(p("Save change", "बदलाव सहेजें")) : tx(p("Add paper", "पेपर जोड़ें"))}
          </button>
        </div>
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <div className="field">
          <span>{tx(p("Paper", "पेपर"))}</span>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {subjectChoices.map((s) => (
              <button key={s} type="button" className={`tap chip${s === subject ? " on" : ""}`} aria-pressed={s === subject} onClick={() => setSubject(s)}>
                {s}
              </button>
            ))}
          </div>
          <span style={{ fontSize: 12, fontWeight: 500, color: "var(--mut)" }}>{subNote}</span>
        </div>
        <div className="field">
          <span>{tx(p("Day", "दिन"))}</span>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {props.days.map((d) => (
              <button key={d.day} type="button" className={`tap chip${d.day === day ? " on" : ""}`} aria-pressed={d.day === day} onClick={() => setDay(d.day)}>
                {d.label}
                <span style={{ width: 7, height: 7, borderRadius: 4, background: busyDays.has(d.day) ? (d.day === day ? "var(--prifg)" : "var(--warn)") : "transparent" }} />
              </button>
            ))}
          </div>
        </div>
        <div className="field">
          <span>{tx(p("Starts at", "शुरू"))}</span>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {times.map((t) => (
              <button key={t} type="button" className={`tap chip${t === start ? " on" : ""}`} aria-pressed={t === start} onClick={() => setStart(t)}>
                {label(t)}
              </button>
            ))}
          </div>
        </div>
        <div className="field">
          <span>{tx(p("How long", "कितनी देर"))}</span>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <button type="button" className="tap btn sec" aria-label={tx(p("Shorter by 15 minutes", "15 मिनट कम"))} disabled={minutes <= 30} onClick={() => setMinutes(Math.max(30, minutes - 15))} style={{ width: 44, padding: 0 }}>
              <Ic n="minus" size={18} />
            </button>
            <b className="num" style={{ minWidth: 104, textAlign: "center", fontSize: 17 }}>{lengthLabel(minutes)}</b>
            <button type="button" className="tap btn sec" aria-label={tx(p("Longer by 15 minutes", "15 मिनट ज़्यादा"))} disabled={minutes >= 240} onClick={() => setMinutes(Math.min(240, minutes + 15))} style={{ width: 44, padding: 0 }}>
              <Ic n="plus" size={18} />
            </button>
            <span style={{ fontSize: 12, color: "var(--mut)" }}>
              {tx(p("Ends at", "समाप्त"))} {clockShort(endOf({ start, minutes }))}
            </span>
          </div>
        </div>
        <div style={{ display: "flex", gap: 10, padding: "12px 14px", borderRadius: 14, fontSize: 13, lineHeight: 1.5, background: sameDay.length ? "var(--bads)" : "var(--oks)", color: sameDay.length ? "var(--bad)" : "var(--ok)", animation: sameDay.length ? "xShake .4s ease" : undefined }}>
          <Ic n={sameDay.length ? "alert" : "checkCircle"} size={18} style={{ flex: "none", marginTop: 1 }} />
          <span>
            {sameDay.length
              ? tx(p(`${GROUP_LABELS[editing.groupKey].en} will have ${sameDay.length + 1} papers on ${dayLong(day)} (${sameDay.map((s) => s.subject).join(", ")} is already there).`, `${GROUP_LABELS[editing.groupKey].hi} के ${dayLong(day)} को ${sameDay.length + 1} पेपर होंगे (${sameDay.map((s) => s.subject).join(", ")} पहले से है)।`))
              : tx(p(`No clash · one paper that day for ${GROUP_LABELS[editing.groupKey].en}.`, `कोई टकराव नहीं · ${GROUP_LABELS[editing.groupKey].hi} का उस दिन एक पेपर।`))}
          </span>
        </div>
        {X ? (
          <button type="button" className="tap btn ghost" disabled={pending} onClick={() => run(() => actions.deleteSlot({ examId: exam.id, slotId: X.id }), props.onClose)} style={{ alignSelf: "flex-start", color: "var(--bad)" }}>
            <Ic n="trash" size={17} />
            {tx(p("Remove this paper", "यह पेपर हटाएँ"))}
          </button>
        ) : null}
      </div>
    </Sheet>
  );
}

/* ---------------------------------------------------------- seating */

/** Seat colours (the design's PC): first class teal, second amber. */
const SEAT_TONE = [
  { bg: "var(--accs)", fg: "var(--accfg)", bd: "var(--acc)" },
  { bg: "var(--warns)", fg: "var(--warnfg)", bd: "var(--warn)" },
];

function Seating(props: PlanProps & { href: (v: PlanView, extra?: string) => string; pending: boolean; run: Run }) {
  const { tx } = useVx();
  const { rooms, seated, totalChildren, exam, actions, run, pending } = props;
  const capacity = rooms.reduce((a, r) => a + r.seats, 0);
  const done = seated > 0 && seated >= totalChildren;
  return (
    <>
      <div className="card" style={{ padding: "18px 20px", display: "flex", flexWrap: "wrap", alignItems: "center", gap: 14 }}>
        <span style={{ flex: "none", width: 52, height: 52, borderRadius: 15, background: "var(--accs)", color: "var(--accfg)", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <Ic n="grid" size={24} />
        </span>
        <span style={{ flex: 1, minWidth: 240, display: "flex", flexDirection: "column", gap: 2 }}>
          <span style={{ fontSize: 15, fontWeight: 700 }}>{tx(p("Seat by roll numbers · two classes per room", "रोल नंबर से बैठक · एक कमरे में दो कक्षाएँ"))}</span>
          <span style={{ fontSize: 12, lineHeight: 1.5, color: "var(--mut)" }}>{tx(p("Two classes sit in alternate columns, so no child sits next to a classmate.", "दो कक्षाएँ बारी-बारी कॉलम में, ताकि कोई बच्चा अपने सहपाठी के पास न बैठे।"))}</span>
          <span className="num" style={{ fontSize: 13, fontWeight: 700, color: done ? "var(--ok)" : "var(--fg)" }}>
            {tx(p(`${seated} of ${totalChildren} seated · ${capacity} seats in ${rooms.length} rooms`, `${totalChildren} में ${seated} बैठे · ${rooms.length} कमरों में ${capacity} सीटें`))}
          </span>
          {capacity < totalChildren ? <span style={{ fontSize: 13, color: "var(--bad)" }}>{tx(p(`${totalChildren - capacity} more seats are needed — add a room.`, `${totalChildren - capacity} सीटें और चाहिए — कमरा जोड़ें।`))}</span> : null}
        </span>
        {done ? (
          <span className="mfull" style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 700, color: "var(--ok)" }}>
            <Ic n="checkCircle" size={18} />
            {tx(p("Everyone has a seat", "सबकी सीट तय"))}
            <Btn variant="ghost" icon="refresh" disabled={pending} onClick={() => run(() => actions.fillSeating({ examId: exam.id }))} style={{ height: 36, marginLeft: "auto" }}>
              {tx(p("Redo", "फिर से"))}
            </Btn>
          </span>
        ) : (
          <button type="button" className="tap btn pri mfull" disabled={pending} onClick={() => run(() => actions.fillSeating({ examId: exam.id }))} style={{ height: 48, fontSize: 15 }}>
            <Ic n="zap" size={18} />
            {seated ? tx(p("Seat everyone again", "फिर से सबको बैठाएँ")) : tx(p("Seat everyone", "सबको बैठाएँ"))}
          </button>
        )}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(210px,1fr))", gap: 12 }}>
        {rooms.map((r, i) => (
          <Link key={r.id} href={props.href("room", `&room=${r.id}`)} className="card tap lift" style={{ padding: "14px 16px", display: "flex", flexDirection: "column", gap: 8, color: "var(--fg)", textDecoration: "none", animation: `xIn .3s var(--ease) ${Math.min(i * 25, 300)}ms both` }}>
            <span style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
              <b style={{ fontSize: 15 }}>{r.name}</b>
              <span className="num" style={{ fontSize: 12, fontWeight: 700, color: "var(--mut)" }}>{r.used}/{r.seats}</span>
            </span>
            <span style={{ display: "flex", height: 8, borderRadius: 4, background: "var(--s3)", overflow: "hidden" }}>
              <span style={{ width: `${(r.used / Math.max(1, r.seats)) * 100}%`, height: "100%", background: r.used / Math.max(1, r.seats) > 0.9 ? "var(--c1)" : "var(--c2)", transition: "width .5s var(--ease)" }} />
            </span>
            {r.classes.map((c, ci) => (
              <span key={c.classId} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}>
                <span style={{ width: 8, height: 8, borderRadius: 4, background: SEAT_TONE[ci % 2].bd }} />
                {tx(p(`${c.label} · rolls ${c.from}–${c.to}`, `${c.label} · रोल ${c.from}–${c.to}`))}
              </span>
            ))}
            <span style={{ fontSize: 12, color: "var(--mut)" }}>{r.classes.length === 0 ? tx(p("Not seated yet", "अभी बैठक नहीं")) : r.classes.length > 1 ? tx(p("Two classes · alternate columns", "दो कक्षाएँ · बारी-बारी कॉलम")) : tx(p("One class", "एक कक्षा"))}</span>
          </Link>
        ))}
      </div>
    </>
  );
}

function RoomChart(props: PlanProps & { href: (v: PlanView, extra?: string) => string }) {
  const { tx } = useVx();
  const room = props.rooms.find((r) => r.id === props.roomId);
  const [picked, setPicked] = useState<number | null>(null);
  if (!room) return <EmptyState icon="door" title={tx(p("No rooms yet", "अभी कोई कमरा नहीं"))} />;
  const classOrder = room.classes.map((c) => c.classId);
  const rows = chartRows(props.chart, room.seats, room.cols);
  const fallback = props.chart.find((s) => s.seatNo === room.cols * 1 + Math.min(3, room.cols)) ?? props.chart[0] ?? null;
  const seat = props.chart.find((s) => s.seatNo === picked) ?? fallback;
  const where = (n: number) => ({ col: ((n - 1) % room.cols) + 1, row: Math.floor((n - 1) / room.cols) + 1 });
  const hall = room.seats > 60;
  const hiName = room.name.replace(/^Room/, "कक्ष").replace(/^Hall$/, "हॉल");
  return (
    <>
      <div className="hs" style={{ display: "flex", gap: 6 }}>
        {props.rooms.filter((r) => r.used > 0 || r.id === room.id).map((r) => (
          <Link key={r.id} href={props.href("room", `&room=${r.id}`)} scroll={false} replace className={`tap chip${r.id === room.id ? " on" : ""}`}>
            {r.name}
          </Link>
        ))}
      </div>
      <div className="stack" style={{ display: "grid", gridTemplateColumns: "minmax(0,1.5fr) minmax(0,1fr)", gap: 16, alignItems: "start" }}>
        <div className="card" style={{ padding: 18, display: "flex", flexDirection: "column", gap: 12 }}>
          <span style={{ display: "flex", flexDirection: "column" }}>
            <span className="serif" style={{ fontSize: 22, fontWeight: 600, lineHeight: 1.15 }}>{room.name}</span>
            <span style={{ fontSize: 12, color: "var(--mut)" }}>
              {room.used ? tx(p(`${room.used} of ${room.seats} seats · ${room.classes.length > 1 ? "two classes in alternate columns" : "one class"}`, `${room.seats} में ${room.used} सीटें · ${room.classes.length > 1 ? "दो कक्षाएँ बारी-बारी" : "एक कक्षा"}`)) : tx(p("Spare room · nobody seated", "खाली कमरा · कोई नहीं"))}
            </span>
          </span>
          <div style={{ height: 30, borderRadius: 8, background: "var(--nav)", color: "var(--navfg)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 600, letterSpacing: ".04em" }}>Blackboard · ब्लैकबोर्ड</div>
          <div style={{ display: "grid", gridTemplateColumns: `repeat(${room.cols}, minmax(0,1fr))`, gap: hall ? 4 : 8 }}>
            {rows.flat().map((s, i) => {
              if (!s) return <span key={`e${i}`} style={{ height: hall ? 30 : 50, borderRadius: 9, border: "1.5px dashed var(--bd)" }} />;
              const tone = SEAT_TONE[classOrder.indexOf(s.classId) % 2 === 1 ? 1 : 0];
              const on = seat?.seatNo === s.seatNo;
              return (
                <button
                  key={s.seatNo}
                  type="button"
                  className="tap"
                  aria-label={tx(p(`Seat ${s.seatNo} · ${s.classLabel} · roll ${s.roll ?? "—"}`, `सीट ${s.seatNo} · ${s.classLabel} · रोल ${s.roll ?? "—"}`))}
                  onClick={() => setPicked(s.seatNo)}
                  style={{ height: hall ? 30 : 50, minWidth: 0, padding: 0, borderRadius: 9, border: `${on ? 2 : 1.5}px solid ${on ? "var(--fg)" : tone.bd}`, background: tone.bg, color: tone.fg, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", lineHeight: 1.05, cursor: "pointer", animation: `xPopIn .35s var(--spring) ${Math.min(i * 8, 300)}ms both` }}
                >
                  <b className="num" style={{ fontSize: hall ? 11 : 16 }}>{s.roll ?? "—"}</b>
                  {hall ? null : <span style={{ fontSize: 9, fontWeight: 600, opacity: 0.75 }}>{s.classLabel.replace(/^Class\s+/, "")}</span>}
                </button>
              );
            })}
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "var(--mut)" }}>
            <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <Ic n="door" size={15} /> {tx(p("Door", "दरवाज़ा"))}
            </span>
            <span className="num">{tx(p(`${room.seats} seats · ${room.cols} columns × ${Math.ceil(room.seats / room.cols)} rows`, `${room.seats} सीटें · ${room.cols} कॉलम × ${Math.ceil(room.seats / room.cols)} पंक्तियाँ`))}</span>
          </div>
          {seat ? (
            <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 14px", borderRadius: 14, fontSize: 13, background: "var(--s2)" }}>
              <Ic n="user" size={18} />
              <span style={{ flex: 1 }}>{tx(p(`Column ${where(seat.seatNo).col}, row ${where(seat.seatNo).row} · ${seat.classLabel} · Roll ${seat.roll ?? "—"}`, `कॉलम ${where(seat.seatNo).col}, पंक्ति ${where(seat.seatNo).row} · ${seat.classLabel} · रोल ${seat.roll ?? "—"}`))}</span>
            </div>
          ) : null}
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div className="card" style={{ padding: "18px 20px", display: "flex", flexDirection: "column", gap: 8, borderStyle: "dashed", borderWidth: 1.5 }}>
            <span className="sech">Door list · दरवाज़े पर</span>
            <span className="serif" style={{ fontSize: 26, fontWeight: 600, lineHeight: 1.1 }}>
              {hiName} · {room.name}
            </span>
            {room.classes.map((c, i) => (
              <div key={c.classId} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 0", borderTop: i ? "1px solid var(--bd)" : undefined }}>
                <span style={{ width: 12, height: 12, borderRadius: 4, background: SEAT_TONE[i % 2].bd }} />
                <span style={{ flex: 1, display: "flex", flexDirection: "column" }}>
                  <b>{`${c.label.replace(/^Class\s+/, "कक्षा ")} · रोल ${c.from}–${c.to}`}</b>
                  <span style={{ fontSize: 12, color: "var(--mut)" }}>{`${c.label} · rolls ${c.from} to ${c.to}`}</span>
                </span>
                <b className="num">{c.count}</b>
              </div>
            ))}
            {room.classes.length === 0 ? <span style={{ color: "var(--mut)", fontSize: 13 }}>{tx(p("Nobody sits here yet.", "यहाँ अभी कोई नहीं बैठता।"))}</span> : null}
            <span style={{ fontSize: 12, color: "var(--mut)" }}>
              {tx(props.exam.name)} · {props.exam.dates} · {tx(p("reach by", "पहुँचें"))} {props.exam.reportingTime}
            </span>
          </div>
          <div className="g2" style={{ display: "grid", gridTemplateColumns: "repeat(2,minmax(0,1fr))", gap: 8 }}>
            <Btn variant="pri" icon="printer" onClick={() => window.print()}>
              {tx(p("Print room chart", "कक्ष चार्ट छापें"))}
            </Btn>
            <Btn variant="sec" icon="door" onClick={() => window.print()}>
              {tx(p("Print door list", "दरवाज़े की सूची छापें"))}
            </Btn>
          </div>
        </div>
      </div>
    </>
  );
}

/* ----------------------------------------------------------- duties */

function Duties(props: PlanProps & { pending: boolean; run: Run }) {
  const { tx } = useVx();
  const { teachers, duties, dutyDays, rooms, spread, exam, actions, run, pending } = props;
  const short = (id: string, m = false) => {
    const name = rooms.find((r) => r.id === id)?.name ?? "—";
    if (/^hall$/i.test(name)) return m ? "H" : "Hall";
    return name.replace(/^Room\s*/i, m ? "" : "R");
  };
  const count = new Map<string, number>();
  for (const d of duties) count.set(d.staffId, (count.get(d.staffId) ?? 0) + 1);
  const max = Math.max(1, ...count.values());
  const roomsUsed = new Set(duties.map((d) => d.roomId)).size;
  const perDay = dutyDays.map((d) => duties.filter((x) => x.day === d.day).length);
  const need = rooms.filter((r) => r.used > 0).length;
  const span = Math.max(1, spread.max);
  const cols = `230px repeat(${dutyDays.length},minmax(0,1fr)) 96px`;
  return (
    <>
      <style>{`@container vx (max-width:899px){.acad-dm{grid-template-columns:minmax(0,1fr) repeat(${dutyDays.length},30px) 22px!important;gap:4px!important;padding:6px 10px!important}.acad-dm .acad-dc{height:32px!important}}`}</style>
      <div className="stack" style={{ display: "grid", gridTemplateColumns: "minmax(0,1.25fr) minmax(0,1fr)", gap: 14 }}>
        <div className="card" style={{ padding: "16px 18px", display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
            <span style={{ display: "flex", flexDirection: "column" }}>
              <span style={{ fontSize: 15, fontWeight: 700 }}>{tx(p("Is it fair?", "क्या बराबर है?"))}</span>
              <span style={{ fontSize: 12, color: "var(--mut)" }}>{tx(p("How many duties each teacher has", "हर शिक्षक की कितनी ड्यूटी"))}</span>
            </span>
            {duties.length ? <span className="pill" style={{ height: 28, padding: "0 11px", fontSize: 12, background: spread.fair ? "var(--oks)" : "var(--warns)", color: spread.fair ? "var(--ok)" : "var(--warnfg)" }}>{spread.fair ? tx(p("Fair", "बराबर")) : tx(p("Not fair yet", "अभी बराबर नहीं"))}</span> : null}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "var(--mut)" }}>
              <span>{tx(p("Fewest", "सबसे कम"))} <b className="num" style={{ color: "var(--fg)" }}>{spread.min}</b></span>
              <span>{tx(p("Most", "सबसे ज़्यादा"))} <b className="num" style={{ color: "var(--fg)" }}>{spread.max}</b></span>
            </div>
            <div style={{ display: "flex", height: 12, borderRadius: 6, background: "var(--s3)", overflow: "hidden" }}>
              <span style={{ width: `${((Math.max(1, spread.min) - 1) / span) * 100}%` }} />
              <span style={{ width: `${(Math.max(0.6, spread.max - spread.min) / span) * 100}%`, background: spread.max - spread.min <= 1 ? "var(--ok)" : "var(--warn)", borderRadius: 6 }} />
            </div>
          </div>
          <button type="button" className={`tap btn ${spread.fair && duties.length ? "soft" : "pri"}`} disabled={pending} onClick={() => run(() => actions.shareDuties({ examId: exam.id }))} style={{ height: 48, fontSize: 15 }}>
            <Ic n={spread.fair && duties.length ? "checkCircle" : "zap"} size={18} />
            {spread.fair && duties.length ? tx(p(`Shared fairly · ${spread.min}${spread.max > spread.min ? ` or ${spread.max}` : ""} each`, `बराबर बँटी · ${spread.min}${spread.max > spread.min ? `–${spread.max}` : ""} हर एक`)) : tx(p("Share duties fairly", "ड्यूटी बराबर बाँटें"))}
          </button>
        </div>
        <div className="card" style={{ padding: "16px 18px", display: "flex", flexDirection: "column", gap: 10 }}>
          <span style={{ fontSize: 15, fontWeight: 700 }}>{tx(p("Rules the app follows", "ऐप के नियम"))}</span>
          {[
            ["shield", tx(p("No one has two rooms on one day; fewest duties go first", "एक दिन एक ही कमरा; कम ड्यूटी वाले पहले")), tx(p(`${teachers.length} teachers share the duties`, `${teachers.length} शिक्षकों में बँटी`)), "ok"],
            ["users", tx(p("Every room in use has a guard each day · one per 40 children", "हर उपयोग वाले कमरे में रोज़ निरीक्षक · हर 40 बच्चों पर एक")), tx(p(`${duties.length} duties · ${roomsUsed} rooms · ${dutyDays.length} days`, `${duties.length} ड्यूटी · ${roomsUsed} कमरे · ${dutyDays.length} दिन`)), duties.length ? "ok" : "warn"],
          ].map(([icon, t, s, tone]) => (
            <div key={t} style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
              <span style={{ flex: "none", width: 34, height: 34, borderRadius: 11, background: `var(--${tone}s)`, color: tone === "warn" ? "var(--warnfg)" : `var(--${tone})`, display: "flex", alignItems: "center", justifyContent: "center" }}>
                <Ic n={icon as IconName} size={17} />
              </span>
              <span style={{ display: "flex", flexDirection: "column" }}>
                <b style={{ fontSize: 13 }}>{t}</b>
                <span style={{ fontSize: 12, color: "var(--mut)" }}>{s}</span>
              </span>
            </div>
          ))}
        </div>
      </div>
      {duties.length === 0 ? (
        <Card>
          <EmptyState icon="users" title={tx(p("No duties yet", "अभी कोई ड्यूटी नहीं"))} body={tx(p("Fill the seating, then share duties — it takes a second.", "बैठक भरें, फिर ड्यूटी बाँटें — एक पल लगता है।"))} />
        </Card>
      ) : (
        <div className="card" style={{ overflow: "hidden", padding: 0 }}>
          <div className="acad-dm" style={{ display: "grid", gridTemplateColumns: cols, gap: 8, alignItems: "center", padding: "6px 16px", minHeight: 44, background: "var(--s2)" }}>
            <span className="sech">{tx(p("Teacher", "शिक्षक"))}</span>
            {dutyDays.map((d) => (
              <span key={d.day} style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
                <b style={{ fontSize: 13 }}>{d.label.split(" ")[0]}</b>
                <span className="num" style={{ fontSize: 11, color: "var(--mut)" }}>{d.label.split(" ")[1] ?? ""}</span>
              </span>
            ))}
            <span className="sech" style={{ textAlign: "right" }}>
              <span className="hide-m">{tx(p("Duties", "ड्यूटी"))}</span>
              <span className="only-m">#</span>
            </span>
          </div>
          {teachers.map((t, ti) => {
            const n = count.get(t.id) ?? 0;
            const tc = spread.fair ? "var(--ok)" : n > spread.min + 1 || n < spread.max - 1 ? "var(--warn)" : "var(--acc)";
            const tone = avatarTone(t.name);
            return (
              <div key={t.id} className="acad-dm" style={{ display: "grid", gridTemplateColumns: cols, gap: 8, alignItems: "center", padding: "6px 16px", minHeight: 50, borderTop: "1px solid var(--bd)", animation: `xIn .3s var(--ease) ${Math.min(ti * 25, 200)}ms both` }}>
                <span style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
                  <span className="hide-m" style={{ flex: "none", width: 34, height: 34, borderRadius: 17, background: tone.bg, color: tone.fg, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 700 }}>
                    {t.name.split(" ").slice(-1)[0].slice(0, 2)}
                  </span>
                  <span style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
                    <span className="clip" style={{ fontWeight: 600 }}>{t.name}</span>
                    {t.sub ? <span className="clip" style={{ fontSize: 12, color: "var(--mut)" }}>{tx(p(`Class teacher · ${t.sub}`, `कक्षा अध्यापक · ${t.sub}`))}</span> : null}
                  </span>
                </span>
                {dutyDays.map((d) => {
                  const duty = duties.find((x) => x.staffId === t.id && x.day === d.day);
                  return (
                    <span key={d.day} className="acad-dc" style={{ height: 34, minWidth: 0, borderRadius: 9, border: `1.5px solid ${duty ? "transparent" : "var(--bd)"}`, background: duty ? "var(--accs)" : "var(--card)", color: duty ? "var(--accfg)" : "var(--sub)", fontSize: 12, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center" }}>
                      <span className="only-d">{duty ? short(duty.roomId) : "·"}</span>
                      <span className="only-m">{duty ? short(duty.roomId, true) : "·"}</span>
                    </span>
                  );
                })}
                <span style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4 }}>
                  <b className="num" style={{ color: tc }}>{n}</b>
                  <span className="hide-m" style={{ display: "flex", width: "100%", height: 5, borderRadius: 3, background: "var(--s3)", overflow: "hidden" }}>
                    <span style={{ width: `${(n / max) * 100}%`, background: tc }} />
                  </span>
                </span>
              </div>
            );
          })}
          <div className="acad-dm" style={{ display: "grid", gridTemplateColumns: cols, gap: 8, alignItems: "center", padding: "6px 16px", minHeight: 42, background: "var(--s2)", borderTop: "1px solid var(--bd)" }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: "var(--mut)" }}>{tx(p(`Guards given · ${need} a day`, `निरीक्षक · रोज़ ${need}`))}</span>
            {perDay.map((n, i) => (
              <span key={i} className="num" style={{ fontSize: 13, fontWeight: 700, textAlign: "center", color: n >= need ? "var(--ok)" : "var(--warnfg)" }}>
                {n}/{need}
              </span>
            ))}
            <span className="num" style={{ fontSize: 13, fontWeight: 700, textAlign: "right" }}>{duties.length}/{need * dutyDays.length}</span>
          </div>
        </div>
      )}
      <span style={{ fontSize: 12, color: "var(--mut)" }}>{tx(p("The box shows the room (H = Hall). Share again to rebalance after a change.", "खाने में कमरा है (H = हॉल)। बदलाव के बाद फिर से बाँटें।"))}</span>
    </>
  );
}

function avatarTone(name: string): { bg: string; fg: string } {
  const tones = [
    ["var(--infos)", "var(--info)"],
    ["var(--warns)", "var(--warnfg)"],
    ["var(--accs)", "var(--accfg)"],
    ["var(--oks)", "var(--ok)"],
  ];
  let h = 0;
  for (let i = 0; i < name.length; i += 1) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  const [bg, fg] = tones[h % tones.length];
  return { bg, fg };
}

/* ----------------------------------------------------------- papers */

const QP_LOOK: Record<QpStatus, { bg: string; fg: string; icon: IconName }> = {
  waiting: { bg: "var(--s3)", fg: "var(--mut)", icon: "edit" },
  received: { bg: "var(--infos)", fg: "var(--info)", icon: "inbox" },
  checked: { bg: "var(--accs)", fg: "var(--accfg)", icon: "check" },
  printed: { bg: "var(--warns)", fg: "var(--warnfg)", icon: "printer" },
};

/** Three letters a phone tile can hold, as the paper tracker shows them. */
function subjectCode(subject: string): string {
  const name = subject.split(" · ")[0].trim();
  const known: Record<string, string> = { Computer: "Cmp", "Social Sci.": "SSc", "Social Science": "SSc", Science: "Sci", Drawing: "Drw", Accountancy: "Acc", Economics: "Eco" };
  return known[name] ?? name.replace(/[^A-Za-z]/g, "").slice(0, 3);
}

function Papers(props: PlanProps & { onOpen: (slotId: string) => void; onRemind: () => void }) {
  const { tx } = useVx();
  const { papers, slots, bands } = props;
  const [filter, setFilter] = useState<QpStatus | "all">("all");
  const statusOf = (slotId: string): QpStatus => papers.find((x) => x.slotId === slotId)?.status ?? "waiting";
  const received = slots.filter((s) => statusOf(s.id) !== "waiting").length;
  const waitingSetters = new Set(papers.filter((x) => x.status === "waiting" && x.setterId).map((x) => x.setterId)).size;
  const L = Math.max(0.5, (263.9 * received) / Math.max(1, slots.length));
  return (
    <>
      <style>{`.acad-pm{grid-template-columns:130px repeat(6,minmax(0,1fr))}@container vx (max-width:899px){.acad-pm{grid-template-columns:66px repeat(6,minmax(0,1fr))!important;gap:4px!important;padding:6px 10px!important}.acad-pm .acad-pq{height:36px!important;font-size:11px!important;padding:0 2px!important}}`}</style>
      <div className="stack" style={{ display: "grid", gridTemplateColumns: "minmax(0,1.5fr) minmax(0,1fr)", gap: 14 }}>
        <div className="card" style={{ padding: "16px 18px", display: "flex", flexWrap: "wrap", alignItems: "center", gap: 14 }}>
          <div style={{ position: "relative", flex: "none", width: 84, height: 84 }}>
            <svg width={84} height={84} viewBox="0 0 100 100" aria-hidden="true">
              <circle cx={50} cy={50} r={42} fill="none" stroke="var(--s3)" strokeWidth={11} />
              <circle cx={50} cy={50} r={42} fill="none" stroke="var(--acc)" strokeWidth={11} strokeLinecap="round" strokeDasharray={`${L.toFixed(1)} 263.9`} style={{ transform: "rotate(-90deg)", transformOrigin: "50% 50%", ["--len" as string]: L.toFixed(1), animation: "xDraw .9s var(--ease) both" }} />
            </svg>
            <span style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
              <b className="num" style={{ fontSize: 20, lineHeight: 1 }}>{received}</b>
              <span style={{ fontSize: 11, color: "var(--mut)" }}>{tx(p(`of ${slots.length}`, `${slots.length} में`))}</span>
            </span>
          </div>
          <span style={{ flex: 1, minWidth: 220, display: "flex", flexDirection: "column", gap: 8 }}>
            <span style={{ display: "flex", flexDirection: "column" }}>
              <span style={{ fontSize: 15, fontWeight: 700 }}>{tx(p(`${received} of ${slots.length} papers received`, `${slots.length} में से ${received} पेपर आए`))}</span>
              <span style={{ fontSize: 12, color: "var(--mut)" }}>{tx(p("Each paper on the date sheet needs a question paper.", "डेट शीट के हर पेपर का प्रश्न पत्र चाहिए।"))}</span>
            </span>
            <span style={{ display: "flex", gap: 4 }}>
              {(Object.keys(QP_WORDS) as QpStatus[]).map((s) => (
                <span key={s} style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", alignItems: "center", padding: "6px 2px", borderRadius: 10, background: QP_LOOK[s].bg }}>
                  <b className="num" style={{ fontSize: 17, color: QP_LOOK[s].fg }}>{slots.filter((x) => statusOf(x.id) === s).length}</b>
                  <span className="clip" style={{ maxWidth: "100%", fontSize: 11, textAlign: "center", color: QP_LOOK[s].fg }}>{tx(QP_WORDS[s].label)}</span>
                </span>
              ))}
            </span>
          </span>
        </div>
        <div className="card" style={{ padding: "16px 18px", display: "flex", flexDirection: "column", gap: 10 }}>
          <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ flex: "none", width: 40, height: 40, borderRadius: 12, background: "var(--warns)", color: "var(--warnfg)", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <Ic n="bell" size={18} />
            </span>
            <span style={{ flex: 1, display: "flex", flexDirection: "column" }}>
              <b>{tx(p(`${waitingSetters} ${waitingSetters === 1 ? "teacher" : "teachers"} still setting papers`, `${waitingSetters} शिक्षक पेपर बना रहे हैं`))}</b>
              <span style={{ fontSize: 12, color: "var(--mut)" }}>{tx(p("One gentle reminder each, with their list", "हर किसी को उसकी सूची के साथ एक याद"))}</span>
            </span>
          </span>
          <button type="button" className="tap btn pri" disabled={waitingSetters === 0} onClick={props.onRemind} style={{ height: 48, fontSize: 15 }}>
            <Ic n="send" size={18} />
            {tx(p(`Remind ${waitingSetters} ${waitingSetters === 1 ? "teacher" : "teachers"}`, `${waitingSetters} शिक्षकों को याद दिलाएँ`))}
          </button>
        </div>
      </div>
      <div className="hs" style={{ display: "flex", gap: 6 }}>
        {[["all", tx(p("All", "सभी")), slots.length, "var(--bds)"] as const, ...(Object.keys(QP_WORDS) as QpStatus[]).map((s) => [s, tx(QP_WORDS[s].label), slots.filter((x) => statusOf(x.id) === s).length, s === "waiting" ? "var(--bds)" : QP_LOOK[s].fg] as const)].map(([key, label, n, dot]) => (
          <button key={key} type="button" className={`tap chip${filter === key ? " on" : ""}`} aria-pressed={filter === key} onClick={() => setFilter(key as QpStatus | "all")}>
            <span style={{ width: 8, height: 8, borderRadius: 4, background: filter === key ? "var(--prifg)" : dot }} />
            {label}
            <span className="num" style={{ opacity: 0.7 }}>{n}</span>
          </button>
        ))}
      </div>
      <div className="card" style={{ overflow: "hidden", padding: 0 }}>
        {bands.flatMap((b) => {
          const list = slots.filter((s) => s.groupKey === b.key);
          const rows: Slot[][] = [];
          for (let i = 0; i < list.length; i += 6) rows.push(list.slice(i, i + 6));
          return rows.map((row, ri) => (
            <div key={`${b.key}${ri}`} className="acad-pm" style={{ display: "grid", gap: 6, alignItems: "center", padding: "6px 14px", minHeight: 50, borderTop: "1px solid var(--bd)" }}>
              <b className="clip">
                <span className="only-d">{ri === 0 ? tx(b.label) : ""}</span>
                <span className="only-m">{ri === 0 ? (b.key === "pre" ? tx(p("Pre-pri.", "पूर्व-प्रा.")) : b.key.slice(1).replace("_", "–")) : ""}</span>
              </b>
              {row.map((s) => {
                const st = statusOf(s.id);
                const look = QP_LOOK[st];
                const shown = filter === "all" || filter === st;
                const setter = papers.find((x) => x.slotId === s.id)?.setterName;
                return (
                  <button key={s.id} type="button" className="tap acad-pq" aria-label={`${tx(b.label)} ${s.subject} · ${tx(QP_WORDS[st].label)}${setter ? ` · ${setter}` : ""}`} onClick={() => props.onOpen(s.id)} style={{ height: 38, minWidth: 0, borderRadius: 10, border: 0, background: look.bg, color: look.fg, opacity: shown ? 1 : 0.25, display: "flex", alignItems: "center", justifyContent: "center", gap: 5, fontSize: 12, fontWeight: 700, padding: "0 6px", cursor: "pointer" }}>
                    <span className="hide-m" style={{ display: "flex" }}>
                      <Ic n={look.icon} size={14} />
                    </span>
                    <span className="clip only-d">{s.subject.split(" · ")[0]}</span>
                    <span className="only-m">{subjectCode(s.subject)}</span>
                  </button>
                );
              })}
            </div>
          ));
        })}
        {slots.length === 0 ? <EmptyState icon="file" title={tx(p("Make the date sheet first — each paper on it needs a question paper.", "पहले डेट शीट बनाएँ — उसके हर पेपर का प्रश्न पत्र चाहिए।"))} /> : null}
      </div>
    </>
  );
}

/* ---------------------------------------------------------- publish */

/** The printed date sheet carries both names, as the design and the notice board do. */
const SCHOOL = p("Shri Veer Patta Sr. Sec. School, Amet", "श्री वीर पत्ता सीनियर सेकेंडरी स्कूल, आमेट");

function Publish(props: PlanProps & { href: (v: PlanView, extra?: string) => string; pending: boolean; run: Run }) {
  const { tx } = useVx();
  const toast = useToast();
  const { exam, slots, bands, days, clashes, actions, run, pending } = props;
  const [format, setFormat] = useState<"image" | "pdf">("image");
  const parentHi = `प्रिय अभिभावक,\n${exam.name.hi ?? exam.name.en} (${exam.dates}) का परीक्षा कार्यक्रम संलग्न है। बच्चे सुबह ${exam.reportingTime} तक स्कूल पहुँचें।`;
  const parentEn = `Dear parent, the ${exam.name.en} date sheet (${exam.dates}) is attached. Children should reach school by ${exam.reportingTime}.`;
  const teacherHi = `नमस्ते,\n${exam.name.hi ?? exam.name.en} का परीक्षा कार्यक्रम संलग्न है। अपने प्रश्न पत्र समय पर जमा करें।\n— ${props.fromName}`;
  const teacherEn = `The ${exam.name.en} date sheet is attached. Please hand in your question papers on time. — ${props.fromName}`;
  const usedDays = days.filter((d) => slots.some((s) => s.day === d.day) || !d.outside);
  const bubble = (to: string, att: string, attIcon: IconName, hi: string, en: string) => (
    <div style={{ display: "flex", flexDirection: "column", gap: 6, padding: 12, borderRadius: 16, background: "var(--wabg)" }}>
      <span style={{ fontSize: 11, fontWeight: 700, color: "var(--wafg)", opacity: 0.7 }}>{to}</span>
      <div style={{ alignSelf: "flex-start", maxWidth: "94%", padding: "9px 12px 5px", borderRadius: "4px 14px 14px 14px", background: "var(--wab)", color: "var(--wafg)", lineHeight: 1.5, whiteSpace: "pre-line", fontSize: 13, boxShadow: "0 1px 1px rgba(0,0,0,.08)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 10px", marginBottom: 6, borderRadius: 8, background: "rgba(0,0,0,.06)", fontSize: 13, fontWeight: 600 }}>
          <Ic n={attIcon} size={18} />
          {att}
        </div>
        {hi}
        <div style={{ marginTop: 6, opacity: 0.78 }}>{en}</div>
      </div>
    </div>
  );
  return (
    <>
      {clashes.length ? (
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10, padding: "12px 14px", borderRadius: 14, fontSize: 13, lineHeight: 1.5, background: "var(--warns)", color: "var(--warnfg)" }}>
          <Ic n="alert" size={18} />
          <span style={{ flex: 1, minWidth: 200 }}>{tx(p(`${clashes.length} clash still in the date sheet. Parents will see two papers on one day.`, `डेट शीट में ${clashes.length} टकराव बाकी। अभिभावकों को एक दिन दो पेपर दिखेंगे।`))}</span>
          <Btn variant="sec" href={props.href("clash")} style={{ height: 36 }}>{tx(p("Fix the clash", "टकराव ठीक करें"))}</Btn>
        </div>
      ) : null}
      {exam.publishedAt ? <Banner tone="ok">{tx(p("Published. Teachers see it on their timetable.", "प्रकाशित। शिक्षकों को उनकी समय-सारणी में दिखती है।"))}</Banner> : null}
      <div className="stack" style={{ display: "grid", gridTemplateColumns: "minmax(0,1.35fr) minmax(0,1fr)", gap: 16, alignItems: "start" }}>
        <article className="card" style={{ padding: "24px 26px", display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 14, paddingBottom: 12, borderBottom: "2px solid var(--fg)" }}>
            <Crest size={50} radius={14} still />
            <span style={{ flex: 1, display: "flex", flexDirection: "column" }}>
              <span style={{ fontSize: 16, fontWeight: 600 }}>{SCHOOL.hi}</span>
              <span className="serif" style={{ fontSize: 16, fontWeight: 600, lineHeight: 1.25 }}>{SCHOOL.en}</span>
            </span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center", padding: 8, borderRadius: 8, background: "var(--s2)" }}>
            <span style={{ fontSize: 15, fontWeight: 700 }}>{exam.name.hi ?? exam.name.en} · परीक्षा कार्यक्रम</span>
            <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".08em", textTransform: "uppercase", color: "var(--mut)" }}>
              {exam.name.en} · Date sheet · {exam.dates}
            </span>
          </div>
          <div style={{ overflow: "hidden", border: "1px solid var(--bds)", borderRadius: 8 }}>
            <div className="hide-m" style={{ display: "grid", gridTemplateColumns: `96px repeat(${bands.length},minmax(0,1fr))`, gap: 6, padding: "8px 10px", background: "var(--s2)", fontSize: 11, fontWeight: 700, color: "var(--mut)", lineHeight: 1.3 }}>
              <span style={{ display: "flex", flexDirection: "column" }}>
                <span>दिनांक</span>
                <span>Date</span>
              </span>
              {bands.map((b) => (
                <span key={b.key} style={{ display: "flex", flexDirection: "column" }}>
                  <span>{b.label.hi}</span>
                  <span>{b.label.en}</span>
                </span>
              ))}
            </div>
            {usedDays.map((d) => (
              <div key={d.day} style={{ display: "grid", gridTemplateColumns: `96px repeat(${bands.length},minmax(0,1fr))`, gap: 6, padding: "8px 10px", borderTop: "1px solid var(--bd)" }}>
                <span style={{ display: "flex", flexDirection: "column" }}>
                  <b style={{ fontSize: 13 }}>{dayHiLong(d.day)}</b>
                  <span style={{ fontSize: 12, color: "var(--mut)" }}>{dayLong(d.day)}</span>
                </span>
                {bands.map((b) => {
                  const here = slots.filter((s) => s.groupKey === b.key && s.day === d.day);
                  const bad = here.length > 1;
                  return (
                    <span key={b.key} style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
                      {here.length === 0 ? (
                        <>
                          <b style={{ fontSize: 13 }}>—</b>
                          <span style={{ fontSize: 11, color: "var(--mut)" }}>No paper</span>
                        </>
                      ) : (
                        <>
                          <b style={{ fontSize: 13, color: bad ? "var(--bad)" : undefined }}>{here.map((s) => subjectHi(s.subject)).join(" + ")}</b>
                          <span style={{ fontSize: 11, color: "var(--mut)" }}>{here.map((s) => s.subject).join(" + ")}</span>
                        </>
                      )}
                    </span>
                  );
                })}
              </div>
            ))}
          </div>
          <span style={{ fontSize: 12, lineHeight: 1.6, color: "var(--mut)" }}>
            बच्चे {exam.reportingTime} तक पहुँचें।
            <br />
            Children reach by {exam.reportingTime}.
          </span>
          <div style={{ display: "flex", justifyContent: "space-between", paddingTop: 18, fontSize: 12, color: "var(--mut)" }}>
            <span>{props.fromName} · परीक्षा प्रभारी</span>
            <span>प्रधानाचार्य</span>
          </div>
        </article>
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div className="card" style={{ padding: "16px 18px", display: "flex", flexDirection: "column", gap: 10 }}>
            <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ flex: "none", width: 40, height: 40, borderRadius: 12, background: "var(--accs)", color: "var(--accfg)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <Ic n="users" size={18} />
              </span>
              <span style={{ flex: 1, display: "flex", flexDirection: "column" }}>
                <b style={{ fontSize: 15 }}>{tx(p("Send to parents", "अभिभावकों को भेजें"))}</b>
                <span style={{ fontSize: 12, color: "var(--mut)" }}>{tx(p("Hindi first, English below · approved in Notices before it goes", "पहले हिंदी, नीचे अंग्रेज़ी · सूचनाएँ में मंज़ूरी के बाद"))}</span>
              </span>
            </span>
            <Seg
              label={tx(p("Format", "रूप"))}
              value={format}
              onChange={setFormat}
              options={[
                { value: "image", label: tx(p("Image · opens in chat", "चित्र · चैट में खुलता")) },
                { value: "pdf", label: tx(p("PDF · for printing", "PDF · छापने के लिए")) },
              ]}
            />
            {bubble(tx(p("Preview · to parents", "नमूना · अभिभावकों को")), `Date sheet · ${exam.name.en}.${format === "image" ? "jpg" : "pdf"}`, format === "image" ? "image" : "file", parentHi, parentEn)}
            <span style={{ fontSize: 12, color: "var(--mut)" }}>
              {tx(p("Messages to families go from Notices, where the count and cost are shown and each send is approved before it leaves.", "परिवारों को संदेश 'सूचनाएँ' से जाते हैं, जहाँ गिनती और खर्च दिखता है और हर भेजने से पहले मंज़ूरी होती है।"))}
            </span>
            <Link href="/messages" className="tap btn pri" style={{ height: 48, fontSize: 15 }}>
              <Ic n="megaphone" size={18} />
              {tx(p("Open Notices to send", "भेजने के लिए सूचनाएँ खोलें"))}
            </Link>
          </div>
          <div className="card" style={{ padding: "16px 18px", display: "flex", flexDirection: "column", gap: 10 }}>
            <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ flex: "none", width: 40, height: 40, borderRadius: 12, background: "var(--accs)", color: "var(--accfg)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <Ic n="grad" size={18} />
              </span>
              <span style={{ flex: 1, display: "flex", flexDirection: "column" }}>
                <b style={{ fontSize: 15 }}>{tx(p("Send to teachers", "शिक्षकों को भेजें"))}</b>
                <span style={{ fontSize: 12, color: "var(--mut)" }}>{tx(p("Publishing puts it on every teacher's screen · duties go separately", "प्रकाशित करने पर हर शिक्षक की स्क्रीन पर · ड्यूटी अलग से"))}</span>
              </span>
            </span>
            {bubble(tx(p("Preview · to the staff group", "नमूना · स्टाफ़ ग्रुप को")), `Date sheet · ${exam.name.en}.pdf`, "file", teacherHi, teacherEn)}
            <Btn variant="soft" icon="copy" onClick={() => void navigator.clipboard?.writeText(`${teacherHi}\n\n${teacherEn}`).then(() => toast.show({ text: tx(p("Message copied", "संदेश कॉपी हुआ")) }))}>
              {tx(p("Copy for the staff group", "स्टाफ़ ग्रुप के लिए कॉपी करें"))}
            </Btn>
          </div>
          <button type="button" className="tap btn pri" disabled={pending || slots.length === 0} onClick={() => run(() => actions.publish({ examId: exam.id }))} style={{ height: 48, fontSize: 15 }}>
            <Ic n="upload" size={18} />
            {exam.publishedAt ? tx(p("Publish again", "फिर प्रकाशित करें")) : tx(p("Publish date sheet", "डेट शीट प्रकाशित करें"))}
          </button>
          <Btn variant="sec" icon="printer" onClick={() => window.print()}>
            {tx(p("Print for the notice board", "नोटिस बोर्ड के लिए छापें"))}
          </Btn>
        </div>
      </div>
    </>
  );
}
