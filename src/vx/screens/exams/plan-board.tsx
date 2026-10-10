"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { useVx } from "@/vx/i18n";
import { Ic, type IconName } from "@/vx/icons";
import { p, type Pair } from "@/vx/text";
import { Chip, ChipRow, RadioCard, Select, Seg, Stepper } from "@/vx/ui/controls";
import { HelpButton, Sheet, useToast } from "@/vx/ui/overlays";
import { Banner, TopBar, VxPage } from "@/vx/ui/page";
import { Avatar, avatarColor, Btn, Card, EmptyState, IconTile, Pill, Progress, Ring, SecHead, WhatsAppPreview, type Tone } from "@/vx/ui/primitives";
import { initials } from "@/vx/format";

import { endOf, fixesFor, lengthLabel, minutesOf, slotTimeLabel, timeOf, type Clash, type Slot } from "./domain/datesheet";
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

const TONES: Tone[] = ["info", "warn", "ok", "acc", "mut"];
function subjectTone(subject: string): Tone {
  let h = 0;
  for (let i = 0; i < subject.length; i += 1) h = (h * 31 + subject.charCodeAt(i)) >>> 0;
  return TONES[h % TONES.length];
}
const toneBg = (t: Tone) => (t === "mut" ? "var(--s2)" : `var(--${t}s)`);
const toneFg = (t: Tone) => (t === "mut" ? "var(--fg)" : t === "warn" ? "var(--warnfg)" : t === "acc" ? "var(--accfg)" : `var(--${t})`);

const QP_WORDS: Record<QpStatus, { label: Pair; tone: Tone }> = {
  waiting: { label: p("Being set", "बन रहा है"), tone: "mut" },
  received: { label: p("Received", "आ गया"), tone: "info" },
  checked: { label: p("Checked", "जाँचा"), tone: "acc" },
  printed: { label: p("Printed", "छपा"), tone: "ok" },
};

const START_TIMES = ["08:00", "08:30", "09:00", "09:30", "11:00", "12:00"];

export function PlanBoard(props: PlanProps) {
  const { view, exam, slots, clashes, actions } = props;
  const { tx } = useVx();
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
    { key: "seating", label: p("Seating", "बैठक"), icon: "grid" },
    { key: "duties", label: p("Duties", "ड्यूटी"), icon: "users" },
    { key: "papers", label: p("Papers", "प्रश्न पत्र"), icon: "file" },
  ];
  const activeTab = view === "slot" || view === "clash" || view === "publish" ? "datesheet" : view === "room" ? "seating" : view;

  /* ---------------------------------------------------------- views */
  let body: React.ReactNode = null;
  let detail: React.ReactNode = null;

  if (view === "datesheet" || view === "slot" || view === "clash") {
    body = <DateSheet {...props} onEdit={(slot, groupKey, day) => setEditing({ slot, groupKey, day })} href={href} pending={pending} run={run} />;
    if (view === "clash" && clashes.length) detail = <ClashPanel {...props} href={href} pending={pending} run={run} />;
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
        mSub={clashes.length ? `${clashes.length} ${tx(p("clash to fix", "टकराव ठीक करना है"))}` : `${tx(exam.name)} · ${exam.dates}`}
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
        <div className="stack" style={{ display: "grid", gridTemplateColumns: detail ? "minmax(0,1fr) 400px" : "minmax(0,1fr)", alignItems: "start" }}>
          <section className="pad" style={{ padding: "22px 28px 40px", display: "flex", flexDirection: "column", gap: 16, minWidth: 0 }}>
            {props.exams.length > 1 ? (
              <ChipRow label={tx(p("Exam", "परीक्षा"))}>
                {props.exams.map((e) => (
                  <Chip key={e.id} on={e.id === exam.id} onClick={() => router.push(`/exam-office/plan?exam=${e.id}&view=${activeTab}`)}>
                    {tx(e.name)}
                  </Chip>
                ))}
              </ChipRow>
            ) : null}
            {view !== "publish" && view !== "room" ? (
              <nav aria-label={tx(p("Planning steps", "योजना के चरण"))} className="seg" style={{ display: "grid", gridTemplateColumns: "repeat(4,minmax(0,1fr))", maxWidth: 720 }}>
                {tabs.map((t) => (
                  <Link key={t.key} href={href(t.key)} className={activeTab === t.key ? "on" : ""} style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 6, padding: "8px 6px", borderRadius: 10, textDecoration: "none", color: "inherit", fontWeight: 600, fontSize: 14, background: activeTab === t.key ? "var(--card)" : undefined, boxShadow: activeTab === t.key ? "var(--sh1)" : undefined }}>
                    <Ic n={t.icon} size={16} />
                    {tx(t.label)}
                    <span style={{ width: 7, height: 7, borderRadius: 4, background: `var(--${tabState[t.key as keyof typeof tabState] === "mut" ? "bds" : tabState[t.key as keyof typeof tabState]})` }} />
                  </Link>
                ))}
              </nav>
            ) : null}
            {body}
          </section>
          {detail ? (
            <aside className="unstick" style={{ position: "sticky", top: 64, maxHeight: "calc(100dvh - 64px)", overflowY: "auto", borderLeft: "1px solid var(--bd)", padding: 20, display: "flex", flexDirection: "column", gap: 14 }}>
              {detail}
            </aside>
          ) : null}
        </div>
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

function DateSheet(props: PlanProps & { onEdit: (slot: Slot | null, groupKey: GroupKey, day: string) => void; href: (v: PlanView, extra?: string) => string; pending: boolean; run: Run }) {
  const { exam, slots, clashes, days, bands, actions, run, pending } = props;
  const { tx } = useVx();
  const clashIds = new Set(clashes.flatMap((c) => c.slotIds));

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
  return (
    <>
      {exam.publishedAt ? (
        <Banner tone="ok">{tx(p("This date sheet is published. Changes reach teachers when you publish again.", "यह डेट शीट प्रकाशित है। बदलाव दोबारा प्रकाशित करने पर पहुँचेंगे।"))}</Banner>
      ) : exam.checked ? (
        <Banner tone="ok" action={<Btn variant="ghost" disabled={pending} onClick={() => run(() => actions.check({ examId: exam.id, checked: false }))}>{tx(p("Back to draft", "फिर ड्राफ़्ट"))}</Btn>}>
          {tx(p("Checked and final — publish it when you are ready.", "जाँची और पक्की — तैयार हों तो प्रकाशित करें।"))}
        </Banner>
      ) : (
        <Card style={{ display: "flex", alignItems: "center", gap: 14, border: "1px solid var(--info)", background: "var(--infos)" }}>
          <IconTile icon="copy" tone="info" size={40} />
          <span style={{ flex: 1, display: "flex", flexDirection: "column" }}>
            <strong>{exam.copiedFrom ? tx(p(`Copied from ${exam.copiedFrom} — check and adjust`, `${exam.copiedFrom} से कॉपी — जाँचें और बदलें`)) : tx(p("Draft — check the dates", "ड्राफ़्ट — तिथियाँ जाँचें"))}</strong>
            <span style={{ fontSize: 13, color: "var(--mut)" }}>{tx(p(`Same order, moved onto ${exam.dates}. Sundays and holidays are left out.`, `वही क्रम, ${exam.dates} पर। रविवार और छुट्टियाँ छोड़ी गईं।`))}</span>
          </span>
          <Btn variant="sec" icon="check" disabled={pending || clashes.length > 0} onClick={() => run(() => actions.check({ examId: exam.id, checked: true }))}>
            {tx(p("Looks good", "ठीक है"))}
          </Btn>
        </Card>
      )}
      {first ? (
        <Link href={props.href("clash")} className="tap" style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 16px", borderRadius: 14, background: "var(--bads)", color: "var(--bad)", textDecoration: "none" }}>
          <Ic n="alert" size={20} />
          <span style={{ flex: 1, display: "flex", flexDirection: "column" }}>
            <strong>{clashTitle(first, slots, tx)}</strong>
            <span style={{ fontSize: 13 }}>
              {props.bands.find((b) => b.key === first.groupKey)?.children ?? 0} {tx(p("children", "बच्चे"))} · {props.days.find((d) => d.day === first.day)?.label ?? first.day}
              {clashes.length > 1 ? ` · +${clashes.length - 1} ${tx(p("more", "और"))}` : ""}
            </span>
          </span>
          <strong>{tx(p("See fixes", "सुधार देखें"))}</strong>
          <Ic n="chevRight" size={16} />
        </Link>
      ) : null}
      <Card pad={false} style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 760 }}>
          <thead>
            <tr style={{ background: "var(--s2)" }}>
              <th style={{ textAlign: "left", padding: "12px 14px", fontSize: 12, letterSpacing: ".06em", textTransform: "uppercase", color: "var(--mut)", width: 150 }}>{tx(p("Classes", "कक्षाएँ"))}</th>
              {days.map((d) => (
                <th key={d.day} style={{ padding: "10px 6px", fontSize: 13, color: d.outside ? "var(--bad)" : undefined }}>
                  {d.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {bands.map((b) => (
              <tr key={b.key} style={{ borderTop: "1px solid var(--bd)" }}>
                <td style={{ padding: "10px 14px", verticalAlign: "top" }}>
                  <strong style={{ display: "block" }}>{tx(b.label)}</strong>
                  <span style={{ fontSize: 12, color: "var(--mut)" }}>
                    {b.children} {tx(p("children", "बच्चे"))}
                    <br />
                    {b.start} · {lengthLabel(b.minutes)}
                  </span>
                </td>
                {days.map((d) => {
                  const here = slots.filter((s) => s.groupKey === b.key && s.day === d.day).sort((x, y) => minutesOf(x.start) - minutesOf(y.start));
                  return (
                    <td key={d.day} style={{ padding: 5, verticalAlign: "top" }}>
                      <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                        {here.map((s) => {
                          const tone = subjectTone(s.subject);
                          const bad = clashIds.has(s.id);
                          return (
                            <button
                              key={s.id}
                              type="button"
                              className="tap"
                              onClick={() => props.onEdit(s, s.groupKey, s.day)}
                              style={{ textAlign: "left", padding: "7px 9px", borderRadius: 10, border: bad ? "1.5px solid var(--bad)" : "1px solid transparent", background: bad ? "var(--bads)" : toneBg(tone), color: bad ? "var(--bad)" : toneFg(tone), cursor: "pointer" }}
                            >
                              <strong style={{ display: "block", fontSize: 13 }}>{s.subject}</strong>
                              <span style={{ fontSize: 11, opacity: 0.85 }}>{slotTimeLabel(s)}</span>
                            </button>
                          );
                        })}
                        {here.length === 0 ? (
                          <button
                            type="button"
                            className="tap"
                            onClick={() => props.onEdit(null, b.key, d.day)}
                            style={{ padding: "12px 6px", borderRadius: 10, border: "1.5px dashed var(--bds)", background: "transparent", color: "var(--mut)", fontSize: 12, cursor: "pointer" }}
                          >
                            {tx(p("No paper", "पेपर नहीं"))}
                          </button>
                        ) : null}
                      </div>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      <span style={{ fontSize: 13, color: "var(--mut)" }}>
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
  const fixes = fixesFor(
    clash,
    slots,
    props.days.filter((d) => !d.outside).map((d) => d.day),
  );
  const [pick, setPick] = useState(0);
  const daySlots = slots.filter((s) => s.groupKey === clash.groupKey && s.day === clash.day);
  const from = 8 * 60;
  const to = 14 * 60;
  const dayLabel = (d: string) => props.days.find((x) => x.day === d)?.label ?? d;

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

  return (
    <>
      <div style={{ display: "flex", alignItems: "center" }}>
        <Pill tone="bad">{tx(p(`${clashes.length} clash${clashes.length === 1 ? "" : "es"} found`, `${clashes.length} टकराव`))}</Pill>
        <span style={{ flex: 1 }} />
        <Btn variant="ghost" icon="x" href={props.href("datesheet")} ariaLabel={tx(p("Close", "बंद करें"))} />
      </div>
      <Card style={{ border: "1.5px solid var(--bad)", display: "flex", flexDirection: "column", gap: 10 }}>
        <div style={{ display: "flex", gap: 10 }}>
          <IconTile icon="alert" tone="bad" size={36} />
          <strong className="serif" style={{ fontSize: 20 }}>{clashTitle(clash, slots, tx)}</strong>
        </div>
        <span style={{ fontSize: 13, color: "var(--mut)" }}>
          {clash.kind === "same_day"
            ? tx(p("Children should write one big paper a day. Two papers tire them out and leave no time to revise the evening before.", "बच्चों को दिन में एक ही बड़ा पेपर लिखना चाहिए। दो पेपर थका देते हैं और पिछली शाम दोहराने का समय नहीं बचता।"))
            : tx(p("The school is closed that day.", "उस दिन स्कूल बंद है।"))}
        </span>
        <SecHead>
          {dayLabel(clash.day)} · {props.bands.find((b) => b.key === clash.groupKey)?.children ?? 0} {tx(p("children", "बच्चे"))}
        </SecHead>
        <div style={{ position: "relative", height: 26 * Math.max(1, daySlots.length) + 8, background: "var(--s2)", borderRadius: 10 }}>
          {daySlots.map((s, i) => {
            const left = ((minutesOf(s.start) - from) / (to - from)) * 100;
            const width = (s.minutes / (to - from)) * 100;
            return (
              <span key={s.id} style={{ position: "absolute", top: 4 + i * 26, left: `${Math.max(0, left)}%`, width: `${width}%`, height: 22, borderRadius: 6, background: "var(--oks)", color: "var(--ok)", fontSize: 12, fontWeight: 600, padding: "2px 8px", overflow: "hidden", whiteSpace: "nowrap" }}>
                {s.subject} {s.start}–{endOf(s)}
              </span>
            );
          })}
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "var(--mut)" }}>
          {[8, 9, 10, 11, 12, 13, 14].map((h) => (
            <span key={h}>{timeOf(h * 60)}</span>
          ))}
        </div>
      </Card>
      <SecHead>{tx(p("Ways to fix it", "सुधार के तरीके"))}</SecHead>
      {fixes.map((f, i) => {
        const s = slots.find((x) => x.id === f.slotId);
        return (
          <RadioCard
            key={`${f.slotId}${f.toDay}`}
            checked={pick === i}
            onSelect={() => setPick(i)}
            title={tx(p(`Move ${s?.subject ?? ""} to ${dayLabel(f.toDay)}`, `${s?.subject ?? ""} को ${dayLabel(f.toDay)} पर ले जाएँ`))}
            sub={tx(p(`${dayLabel(f.toDay)} is free for this band · starts ${f.start}`, `${dayLabel(f.toDay)} इस समूह के लिए खाली · ${f.start} से`))}
            trail={i === 0 ? <Pill tone="ok">{tx(p("Best fix", "सबसे अच्छा"))}</Pill> : undefined}
          />
        );
      })}
      <RadioCard
        checked={pick === fixes.length}
        onSelect={() => setPick(fixes.length)}
        title={tx(p(`Keep both on ${dayLabel(clash.day)}`, `दोनों ${dayLabel(clash.day)} को रखें`))}
        sub={tx(p("Allowed, but children sit two papers that day.", "चल सकता है, पर बच्चे उस दिन दो पेपर देंगे।"))}
      />
      <Btn variant="pri" icon="check" full disabled={pending} onClick={apply}>
        {pick < fixes.length ? tx(p("Fix it", "ठीक करें")) : tx(p("Keep as it is", "जैसा है रखें"))}
      </Btn>
    </>
  );
}

function SlotSheet(props: PlanProps & { editing: { slot: Slot | null; groupKey: GroupKey; day: string }; onClose: () => void; pending: boolean; run: Run }) {
  const { editing, exam, slots, actions, run, pending } = props;
  const { tx } = useVx();
  const band = props.bands.find((b) => b.key === editing.groupKey);
  const [subject, setSubject] = useState(editing.slot?.subject ?? props.subjects[editing.groupKey]?.find((s) => !slots.some((x) => x.groupKey === editing.groupKey && x.subject === s)) ?? "");
  const [day, setDay] = useState(editing.day || props.days[0]?.day || "");
  const [start, setStart] = useState(editing.slot?.start ?? band?.start ?? "08:30");
  const [minutes, setMinutes] = useState(editing.slot?.minutes ?? band?.minutes ?? 90);
  const busyDays = new Set(slots.filter((s) => s.groupKey === editing.groupKey && s.id !== editing.slot?.id).map((s) => s.day));
  const sameDay = slots.filter((s) => s.groupKey === editing.groupKey && s.day === day && s.id !== editing.slot?.id);
  const others = slots.filter((s) => s.groupKey === editing.groupKey && s.id !== editing.slot?.id);
  const times = [...new Set([...START_TIMES, start])].sort();

  return (
    <Sheet
      open
      onClose={props.onClose}
      icon="calendar"
      title={`${tx(GROUP_LABELS[editing.groupKey])} · ${subject || tx(p("New paper", "नया पेपर"))}`}
      sub={`${props.days.find((d) => d.day === day)?.label ?? day} · ${start}–${endOf({ start, minutes })} · ${lengthLabel(minutes)}`}
      footer={
        <div style={{ display: "flex", gap: 10, width: "100%" }}>
          {editing.slot ? (
            <Btn variant="danger" icon="trash" disabled={pending} onClick={() => run(() => actions.deleteSlot({ examId: exam.id, slotId: editing.slot!.id }), props.onClose)}>
              <span className="hide-m">{tx(p("Remove", "हटाएँ"))}</span>
            </Btn>
          ) : null}
          <Btn variant="sec" onClick={props.onClose} style={{ flex: 1 }}>
            {tx(p("Cancel", "रद्द करें"))}
          </Btn>
          <Btn
            variant="pri"
            icon="check"
            disabled={pending || !subject.trim() || !day}
            style={{ flex: 2 }}
            onClick={() => run(() => actions.saveSlot({ examId: exam.id, slotId: editing.slot?.id ?? null, groupKey: editing.groupKey, subject: subject.trim(), day, start, minutes }), props.onClose)}
          >
            {editing.slot ? tx(p("Save change", "बदलाव सहेजें")) : tx(p("Add paper", "पेपर जोड़ें"))}
          </Btn>
        </div>
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div>
          <SecHead>{tx(p("Paper", "पेपर"))}</SecHead>
          <ChipRow label={tx(p("Paper", "पेपर"))} style={{ flexWrap: "wrap" }}>
            {[...new Set([...(props.subjects[editing.groupKey] ?? []), ...(subject ? [subject] : [])])].map((s) => (
              <Chip key={s} on={s === subject} onClick={() => setSubject(s)}>
                {s}
              </Chip>
            ))}
          </ChipRow>
        </div>
        {editing.slot && others.length ? (
          <div>
            <SecHead>{tx(p("Or swap days with", "या दिन बदलें"))}</SecHead>
            <ChipRow label={tx(p("Swap with", "से बदलें"))} style={{ flexWrap: "wrap" }}>
              {others.map((o) => (
                <Chip key={o.id} icon="swap" onClick={() => run(() => actions.swapSlots({ examId: exam.id, a: editing.slot!.id, b: o.id }), props.onClose)}>
                  {o.subject} · {props.days.find((d) => d.day === o.day)?.label ?? o.day}
                </Chip>
              ))}
            </ChipRow>
          </div>
        ) : null}
        <div>
          <SecHead>{tx(p("Day", "दिन"))}</SecHead>
          <ChipRow label={tx(p("Day", "दिन"))} style={{ flexWrap: "wrap" }}>
            {props.days.map((d) => (
              <Chip key={d.day} on={d.day === day} onClick={() => setDay(d.day)}>
                {d.label}
                {busyDays.has(d.day) ? <span style={{ width: 6, height: 6, borderRadius: 3, background: "var(--warn)", display: "inline-block" }} /> : null}
              </Chip>
            ))}
          </ChipRow>
        </div>
        <div>
          <SecHead>{tx(p("Starts at", "शुरू"))}</SecHead>
          <ChipRow label={tx(p("Starts at", "शुरू"))} style={{ flexWrap: "wrap" }}>
            {times.map((t) => (
              <Chip key={t} on={t === start} onClick={() => setStart(t)}>
                {t}
              </Chip>
            ))}
          </ChipRow>
        </div>
        <div>
          <SecHead>{tx(p("How long", "कितनी देर"))}</SecHead>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <Stepper value={minutes / 15} min={1} max={16} onChange={(v) => setMinutes(v * 15)} label={tx(p("quarter hours", "पंद्रह मिनट"))} />
            <strong>{lengthLabel(minutes)}</strong>
            <span style={{ fontSize: 13, color: "var(--mut)" }}>
              {tx(p("Ends at", "समाप्त"))} {endOf({ start, minutes })}
            </span>
          </div>
        </div>
        {sameDay.length ? (
          <Banner tone="bad">
            {tx(p(`${GROUP_LABELS[editing.groupKey].en} will have ${sameDay.length + 1} papers that day (${sameDay.map((s) => s.subject).join(", ")} is already there).`, `${GROUP_LABELS[editing.groupKey].hi} के उस दिन ${sameDay.length + 1} पेपर होंगे (${sameDay.map((s) => s.subject).join(", ")} पहले से है)।`))}
          </Banner>
        ) : null}
      </div>
    </Sheet>
  );
}

/* ---------------------------------------------------------- seating */

function Seating(props: PlanProps & { href: (v: PlanView, extra?: string) => string; pending: boolean; run: Run }) {
  const { tx } = useVx();
  const { rooms, seated, totalChildren, exam, actions, run, pending } = props;
  const capacity = rooms.reduce((a, r) => a + r.seats, 0);
  return (
    <>
      <Card style={{ display: "flex", alignItems: "center", gap: 18, flexWrap: "wrap" }}>
        <Ring value={seated} max={Math.max(1, totalChildren)} size={88} stroke={9} tone="var(--ok)">
          <span style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
            <strong className="num" style={{ fontSize: 18 }}>{seated}</strong>
            <span style={{ fontSize: 11, color: "var(--mut)" }}>
              {tx(p("of", "में से"))} {totalChildren}
            </span>
          </span>
        </Ring>
        <span style={{ flex: "1 1 260px", display: "flex", flexDirection: "column", gap: 4 }}>
          <strong className="serif" style={{ fontSize: 22 }}>{seated ? tx(p(`${seated} children have a seat`, `${seated} बच्चों की सीट तय`)) : tx(p("Seating not made yet", "बैठक अभी नहीं बनी"))}</strong>
          <span style={{ fontSize: 13, color: "var(--mut)" }}>
            {tx(p(`${rooms.length} rooms · ${capacity} seats · two classes per room in alternate seats, by roll number.`, `${rooms.length} कमरे · ${capacity} सीटें · एक कमरे में दो कक्षाएँ, बारी-बारी, रोल नंबर से।`))}
          </span>
          {capacity < totalChildren ? <span style={{ fontSize: 13, color: "var(--bad)" }}>{tx(p(`${totalChildren - capacity} more seats are needed — add a room.`, `${totalChildren - capacity} सीटें और चाहिए — कमरा जोड़ें।`))}</span> : null}
        </span>
        <Btn variant="pri" icon="zap" disabled={pending} onClick={() => run(() => actions.fillSeating({ examId: exam.id }))}>
          {seated ? tx(p("Fill again", "फिर से भरें")) : tx(p("Fill seating", "बैठक भरें"))}
        </Btn>
      </Card>
      <div className="g3" style={{ display: "grid", gridTemplateColumns: "repeat(3,minmax(0,1fr))", gap: 12 }}>
        {rooms.map((r) => (
          <Link key={r.id} href={props.href("room", `&room=${r.id}`)} className="card tap lift" style={{ padding: 16, display: "flex", flexDirection: "column", gap: 8, color: "inherit", textDecoration: "none" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <IconTile icon="door" tone={r.used ? "info" : "mut"} size={34} />
              <strong style={{ flex: 1 }}>{r.name}</strong>
              <span className="num" style={{ fontSize: 13, color: "var(--mut)" }}>
                {r.used}/{r.seats}
              </span>
            </div>
            <Progress value={r.used} max={r.seats} tone="var(--info)" height={5} />
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {r.classes.length === 0 ? <span style={{ fontSize: 12, color: "var(--mut)" }}>{tx(p("Empty", "खाली"))}</span> : null}
              {r.classes.map((c, i) => (
                <Pill key={c.classId} tone={i % 2 ? "warn" : "info"}>
                  {c.label} · {c.from}–{c.to}
                </Pill>
              ))}
            </div>
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
  const seat = props.chart.find((s) => s.seatNo === picked) ?? null;
  return (
    <>
      <ChipRow label={tx(p("Rooms", "कमरे"))}>
        {props.rooms.map((r) => (
          <Link key={r.id} href={props.href("room", `&room=${r.id}`)} className={`tap chip${r.id === room.id ? " on" : ""}`}>
            {r.name}
          </Link>
        ))}
      </ChipRow>
      <div className="stack" style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) 340px", gap: 16, alignItems: "start" }}>
        <Card style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div>
            <strong className="serif" style={{ fontSize: 22 }}>{room.name}</strong>
            <span style={{ display: "block", fontSize: 13, color: "var(--mut)" }}>
              {room.used} {tx(p("of", "में से"))} {room.seats} {tx(p("seats", "सीटें"))} · {tx(p("two classes in alternate seats", "दो कक्षाएँ बारी-बारी"))}
            </span>
          </div>
          <div style={{ background: "var(--pri)", color: "var(--onsolid, #fff)", borderRadius: 8, textAlign: "center", padding: 6, fontSize: 13, fontWeight: 600 }}>
            {tx(p("Blackboard", "ब्लैकबोर्ड"))}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: `repeat(${room.cols}, minmax(0,1fr))`, gap: 8 }}>
            {rows.flat().map((s, i) => {
              if (!s) return <span key={`e${i}`} style={{ height: 50, borderRadius: 10, border: "1px dashed var(--bd)" }} />;
              const tone: Tone = classOrder.indexOf(s.classId) % 2 ? "warn" : "info";
              return (
                <button
                  key={s.seatNo}
                  type="button"
                  className="tap"
                  onClick={() => setPicked(s.seatNo)}
                  style={{ height: 50, borderRadius: 10, border: `1.5px solid ${picked === s.seatNo ? "var(--fg)" : `var(--${tone})`}`, background: `var(--${tone}s)`, color: toneFg(tone), display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", cursor: "pointer" }}
                >
                  <strong className="num" style={{ fontSize: 16 }}>{s.roll ?? "—"}</strong>
                  <span style={{ fontSize: 10 }}>{s.classLabel.replace("Class ", "")}</span>
                </button>
              );
            })}
          </div>
          <div style={{ display: "flex", fontSize: 12, color: "var(--mut)" }}>
            <span style={{ flex: 1 }}>
              <Ic n="door" size={14} /> {tx(p("Door", "दरवाज़ा"))}
            </span>
            <span>
              {room.seats} {tx(p("seats", "सीटें"))} · {room.cols} {tx(p("across", "पंक्ति में"))}
            </span>
          </div>
          {seat ? (
            <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", borderRadius: 12, background: "var(--s2)" }}>
              <Ic n="user" size={16} />
              {tx(p(`Seat ${seat.seatNo} · ${seat.classLabel} · Roll ${seat.roll ?? "—"}`, `सीट ${seat.seatNo} · ${seat.classLabel} · रोल ${seat.roll ?? "—"}`))}
            </div>
          ) : null}
        </Card>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <Card style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <SecHead>{tx(p("Door list", "दरवाज़े पर सूची"))}</SecHead>
            <strong className="serif" style={{ fontSize: 22 }}>
              {room.name.replace("Room", "कक्ष")} · {room.name}
            </strong>
            {room.classes.map((c, i) => (
              <div key={c.classId} style={{ display: "flex", alignItems: "center", gap: 10, paddingTop: 8, borderTop: i ? "1px solid var(--bd)" : undefined }}>
                <span style={{ width: 10, height: 10, borderRadius: 3, background: `var(--${i % 2 ? "warn" : "info"})` }} />
                <span style={{ flex: 1, display: "flex", flexDirection: "column" }}>
                  <strong>
                    {c.label} · {tx(p("rolls", "रोल"))} {c.from}–{c.to}
                  </strong>
                </span>
                <strong className="num">{c.count}</strong>
              </div>
            ))}
            {room.classes.length === 0 ? <span style={{ color: "var(--mut)", fontSize: 13 }}>{tx(p("Nobody sits here yet.", "यहाँ अभी कोई नहीं बैठता।"))}</span> : null}
            <span style={{ fontSize: 12, color: "var(--mut)" }}>
              {tx(props.exam.name)} · {props.exam.dates} · {tx(p("reach by", "पहुँचें"))} {props.exam.reportingTime}
            </span>
          </Card>
          <Btn variant="pri" icon="printer" onClick={() => window.print()}>
            {tx(p("Print room chart", "कक्ष चार्ट छापें"))}
          </Btn>
        </div>
      </div>
    </>
  );
}

/* ----------------------------------------------------------- duties */

function Duties(props: PlanProps & { pending: boolean; run: Run }) {
  const { tx } = useVx();
  const { teachers, duties, dutyDays, rooms, spread, exam, actions, run, pending } = props;
  const short = (id: string) => {
    const name = rooms.find((r) => r.id === id)?.name ?? "—";
    return name.replace(/^Room\s*/i, "R");
  };
  const count = new Map<string, number>();
  for (const d of duties) count.set(d.staffId, (count.get(d.staffId) ?? 0) + 1);
  const max = Math.max(1, ...count.values());
  const roomsUsed = new Set(duties.map((d) => d.roomId)).size;
  return (
    <>
      <div className="g2" style={{ display: "grid", gridTemplateColumns: "repeat(2,minmax(0,1fr))", gap: 14 }}>
        <Card style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ display: "flex", alignItems: "flex-start" }}>
            <span style={{ flex: 1 }}>
              <strong style={{ fontSize: 16 }}>{tx(p("Is it fair?", "क्या बराबर है?"))}</strong>
              <span style={{ display: "block", fontSize: 13, color: "var(--mut)" }}>{tx(p("How many duties each teacher has", "हर शिक्षक की कितनी ड्यूटी"))}</span>
            </span>
            {duties.length ? <Pill tone={spread.fair ? "ok" : "warn"}>{spread.fair ? tx(p("Fair", "बराबर")) : tx(p("Not fair yet", "अभी बराबर नहीं"))}</Pill> : null}
          </div>
          <div style={{ display: "flex", fontSize: 13 }}>
            <span style={{ flex: 1 }}>
              {tx(p("Fewest", "सबसे कम"))} <strong>{spread.min}</strong>
            </span>
            <span>
              {tx(p("Most", "सबसे ज़्यादा"))} <strong>{spread.max}</strong>
            </span>
          </div>
          <Progress value={spread.min} max={Math.max(1, spread.max)} tone={spread.fair ? "var(--ok)" : "var(--warn)"} />
          <Btn variant="pri" icon="zap" disabled={pending} onClick={() => run(() => actions.shareDuties({ examId: exam.id }))}>
            {tx(p("Share duties fairly", "ड्यूटी बराबर बाँटें"))}
          </Btn>
        </Card>
        <Card style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <strong style={{ fontSize: 16 }}>{tx(p("Rules the app follows", "ऐप के नियम"))}</strong>
          <div style={{ display: "flex", gap: 10 }}>
            <IconTile icon="users" tone="ok" size={34} />
            <span style={{ display: "flex", flexDirection: "column" }}>
              <strong style={{ fontSize: 14 }}>{tx(p("Every room in use has a guard each day · one per 40 children", "हर उपयोग वाले कमरे में रोज़ निरीक्षक · हर 40 बच्चों पर एक"))}</strong>
              <span style={{ fontSize: 12, color: "var(--mut)" }}>
                {duties.length} {tx(p("duties", "ड्यूटी"))} · {roomsUsed} {tx(p("rooms", "कमरे"))} · {dutyDays.length} {tx(p("days", "दिन"))}
              </span>
            </span>
          </div>
          <div style={{ display: "flex", gap: 10 }}>
            <IconTile icon="clock" tone="info" size={34} />
            <span style={{ display: "flex", flexDirection: "column" }}>
              <strong style={{ fontSize: 14 }}>{tx(p("No one has two rooms on one day; fewest duties go first", "एक दिन एक ही कमरा; कम ड्यूटी वाले पहले"))}</strong>
            </span>
          </div>
        </Card>
      </div>
      {duties.length === 0 ? (
        <Card>
          <EmptyState icon="users" title={tx(p("No duties yet", "अभी कोई ड्यूटी नहीं"))} body={tx(p("Fill the seating, then share duties — it takes a second.", "बैठक भरें, फिर ड्यूटी बाँटें — एक पल लगता है।"))} />
        </Card>
      ) : (
        <Card pad={false} style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 720 }}>
            <thead>
              <tr style={{ background: "var(--s2)" }}>
                <th style={{ textAlign: "left", padding: "12px 16px", fontSize: 12, letterSpacing: ".06em", textTransform: "uppercase", color: "var(--mut)" }}>{tx(p("Teacher", "शिक्षक"))}</th>
                {dutyDays.map((d) => (
                  <th key={d.day} style={{ padding: 8, fontSize: 13 }}>
                    {d.label}
                  </th>
                ))}
                <th style={{ padding: "8px 16px", fontSize: 12, textTransform: "uppercase", color: "var(--mut)", textAlign: "right" }}>{tx(p("Duties", "ड्यूटी"))}</th>
              </tr>
            </thead>
            <tbody>
              {teachers.map((t) => (
                <tr key={t.id} style={{ borderTop: "1px solid var(--bd)" }}>
                  <td style={{ padding: "8px 16px" }}>
                    <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <Avatar text={initials(t.name)} bg={avatarColor(t.id)} size={30} />
                      <span style={{ display: "flex", flexDirection: "column" }}>
                        <strong style={{ fontSize: 14 }}>{t.name}</strong>
                        {t.sub ? <span style={{ fontSize: 12, color: "var(--mut)" }}>{tx(p("Class teacher", "कक्षा अध्यापक"))} · {t.sub}</span> : null}
                      </span>
                    </span>
                  </td>
                  {dutyDays.map((d) => {
                    const duty = duties.find((x) => x.staffId === t.id && x.day === d.day);
                    return (
                      <td key={d.day} style={{ padding: 4 }}>
                        <span style={{ display: "block", textAlign: "center", padding: "8px 4px", borderRadius: 8, fontSize: 13, fontWeight: 600, background: duty ? "var(--infos)" : "transparent", color: duty ? "var(--info)" : "var(--mut)", border: duty ? "none" : "1px solid var(--bd)" }}>
                          {duty ? short(duty.roomId) : "·"}
                        </span>
                      </td>
                    );
                  })}
                  <td style={{ padding: "8px 16px", width: 110 }}>
                    <strong className="num" style={{ display: "block", textAlign: "right" }}>{count.get(t.id) ?? 0}</strong>
                    <Progress value={count.get(t.id) ?? 0} max={max} tone="var(--warn)" height={4} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </>
  );
}

/* ----------------------------------------------------------- papers */

function Papers(props: PlanProps & { onOpen: (slotId: string) => void; onRemind: () => void }) {
  const { tx } = useVx();
  const { papers, slots, bands } = props;
  const [filter, setFilter] = useState<QpStatus | "all">("all");
  const statusOf = (slotId: string): QpStatus => papers.find((x) => x.slotId === slotId)?.status ?? "waiting";
  const received = slots.filter((s) => statusOf(s.id) !== "waiting").length;
  const waitingSetters = new Set(papers.filter((x) => x.status === "waiting" && x.setterId).map((x) => x.setterId)).size;
  return (
    <>
      <div className="g2" style={{ display: "grid", gridTemplateColumns: "repeat(2,minmax(0,1fr))", gap: 14 }}>
        <Card style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <Ring value={received} max={Math.max(1, slots.length)} size={86} stroke={9} tone="var(--acc)">
            <span style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
              <strong className="num" style={{ fontSize: 20 }}>{received}</strong>
              <span style={{ fontSize: 11, color: "var(--mut)" }}>
                {tx(p("of", "में से"))} {slots.length}
              </span>
            </span>
          </Ring>
          <span style={{ flex: 1, display: "flex", flexDirection: "column", gap: 8 }}>
            <strong>{tx(p(`${received} of ${slots.length} papers received`, `${slots.length} में से ${received} पेपर आए`))}</strong>
            <span style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {(Object.keys(QP_WORDS) as QpStatus[]).map((s) => (
                <Pill key={s} tone={QP_WORDS[s].tone}>
                  {slots.filter((x) => statusOf(x.id) === s).length} {tx(QP_WORDS[s].label)}
                </Pill>
              ))}
            </span>
          </span>
        </Card>
        <Card style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <IconTile icon="bell" tone="warn" size={40} />
          <span style={{ flex: 1, display: "flex", flexDirection: "column" }}>
            <strong>{tx(p(`${waitingSetters} teachers still setting papers`, `${waitingSetters} शिक्षक पेपर बना रहे हैं`))}</strong>
            <span style={{ fontSize: 13, color: "var(--mut)" }}>{tx(p("One gentle reminder each, with their list", "हर किसी को उसकी सूची के साथ एक याद"))}</span>
          </span>
          <Btn variant="pri" icon="send" disabled={waitingSetters === 0} onClick={props.onRemind}>
            {tx(p("Remind", "याद दिलाएँ"))}
          </Btn>
        </Card>
      </div>
      <ChipRow label={tx(p("Filter", "छाँटें"))}>
        <Chip on={filter === "all"} onClick={() => setFilter("all")} count={slots.length}>
          {tx(p("All", "सभी"))}
        </Chip>
        {(Object.keys(QP_WORDS) as QpStatus[]).map((s) => (
          <Chip key={s} on={filter === s} onClick={() => setFilter(s)} count={slots.filter((x) => statusOf(x.id) === s).length}>
            {tx(QP_WORDS[s].label)}
          </Chip>
        ))}
      </ChipRow>
      <Card pad={false}>
        {bands.map((b) => {
          const list = slots.filter((s) => s.groupKey === b.key && (filter === "all" || statusOf(s.id) === filter));
          if (!list.length) return null;
          return (
            <div key={b.key} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 16px", borderTop: "1px solid var(--bd)", flexWrap: "wrap" }}>
              <strong style={{ width: 120 }}>{tx(b.label)}</strong>
              <span style={{ flex: 1, display: "flex", flexWrap: "wrap", gap: 6 }}>
                {list.map((s) => {
                  const st = statusOf(s.id);
                  const setter = papers.find((x) => x.slotId === s.id)?.setterName;
                  return (
                    <button key={s.id} type="button" className="tap" onClick={() => props.onOpen(s.id)} title={setter ?? undefined} style={{ padding: "6px 10px", borderRadius: 9, border: "none", background: toneBg(QP_WORDS[st].tone), color: toneFg(QP_WORDS[st].tone), fontWeight: 600, fontSize: 13, cursor: "pointer" }}>
                      {s.subject}
                      {st === "printed" ? " ✓" : ""}
                    </button>
                  );
                })}
              </span>
            </div>
          );
        })}
        {slots.length === 0 ? <EmptyState icon="file" title={tx(p("Make the date sheet first — each paper on it needs a question paper.", "पहले डेट शीट बनाएँ — उसके हर पेपर का प्रश्न पत्र चाहिए।"))} /> : null}
      </Card>
    </>
  );
}

/* ---------------------------------------------------------- publish */

function Publish(props: PlanProps & { href: (v: PlanView, extra?: string) => string; pending: boolean; run: Run }) {
  const { tx } = useVx();
  const toast = useToast();
  const { exam, slots, bands, days, clashes, actions, run, pending } = props;
  const [format, setFormat] = useState<"image" | "pdf">("image");
  const parentText = [
    "प्रिय अभिभावक,",
    `${exam.name.hi ?? exam.name.en} (${exam.dates}) का परीक्षा कार्यक्रम संलग्न है। बच्चे सुबह ${exam.reportingTime} बजे तक स्कूल पहुँचें।`,
    "",
    `Dear parent, the ${exam.name.en} date sheet (${exam.dates}) is attached. Children should reach school by ${exam.reportingTime}.`,
  ];
  const teacherText = [
    "नमस्ते,",
    `${exam.name.hi ?? exam.name.en} का परीक्षा कार्यक्रम संलग्न है। अपने प्रश्न पत्र समय पर जमा करें।`,
    "",
    `The ${exam.name.en} date sheet is attached. Please hand in your question papers on time.`,
    `— ${props.fromName}`,
  ];
  const usedDays = days.filter((d) => slots.some((s) => s.day === d.day) || !d.outside);
  return (
    <>
      {clashes.length ? (
        <Banner tone="warn" action={<Btn variant="sec" href={props.href("clash")}>{tx(p("Fix the clash", "टकराव ठीक करें"))}</Btn>}>
          {tx(p(`${clashes.length} clash still in the date sheet. Parents will see two papers on one day.`, `डेट शीट में ${clashes.length} टकराव बाकी। अभिभावकों को एक दिन दो पेपर दिखेंगे।`))}
        </Banner>
      ) : null}
      {exam.publishedAt ? <Banner tone="ok">{tx(p("Published. Teachers see it on their timetable.", "प्रकाशित। शिक्षकों को उनकी समय-सारणी में दिखती है।"))}</Banner> : null}
      <div className="stack" style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) 420px", gap: 16, alignItems: "start" }}>
        <Card style={{ display: "flex", flexDirection: "column", gap: 12, overflowX: "auto" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, borderBottom: "2px solid var(--fg)", paddingBottom: 10 }}>
            <span style={{ width: 44, height: 44, borderRadius: 10, background: "var(--pri)", color: "var(--prifg)", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700 }} className="serif">
              VP
            </span>
            <span style={{ display: "flex", flexDirection: "column" }}>
              <strong className="serif" style={{ fontSize: 18 }}>श्री वीर पत्ता सीनियर सेकेंडरी स्कूल</strong>
              <span className="serif">{process.env.NEXT_PUBLIC_SCHOOL_NAME ?? "Shri Veer Patta Senior Secondary School"}</span>
            </span>
          </div>
          <div style={{ textAlign: "center", padding: 10, borderRadius: 10, background: "var(--s2)" }}>
            <strong style={{ display: "block" }}>{exam.name.hi ?? exam.name.en} · परीक्षा कार्यक्रम</strong>
            <span style={{ fontSize: 12, letterSpacing: ".08em", textTransform: "uppercase", color: "var(--mut)" }}>
              {exam.name.en} · Date sheet · {exam.dates}
            </span>
          </div>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 560, fontSize: 13 }}>
            <thead>
              <tr style={{ background: "var(--s2)" }}>
                <th style={{ textAlign: "left", padding: 8 }}>दिनांक / Date</th>
                {bands.map((b) => (
                  <th key={b.key} style={{ textAlign: "left", padding: 8 }}>
                    {b.label.hi}
                    <br />
                    <span style={{ fontWeight: 400, color: "var(--mut)" }}>{b.label.en}</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {usedDays.map((d) => (
                <tr key={d.day} style={{ borderTop: "1px solid var(--bd)" }}>
                  <td style={{ padding: 8, verticalAlign: "top" }}>
                    <strong>{d.label}</strong>
                  </td>
                  {bands.map((b) => {
                    const here = slots.filter((s) => s.groupKey === b.key && s.day === d.day);
                    const bad = here.length > 1;
                    return (
                      <td key={b.key} style={{ padding: 8, verticalAlign: "top", color: bad ? "var(--bad)" : undefined }}>
                        {here.length === 0 ? (
                          <span style={{ color: "var(--mut)" }}>— No paper</span>
                        ) : (
                          <>
                            <strong>{here.map((s) => subjectPair(s.subject).hi ?? s.subject).join(" + ")}</strong>
                            <br />
                            <span style={{ color: "var(--mut)" }}>{here.map((s) => s.subject).join(" + ")}</span>
                          </>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
          <Btn variant="sec" icon="printer" onClick={() => window.print()}>
            {tx(p("Print the date sheet", "डेट शीट छापें"))}
          </Btn>
        </Card>
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <Card style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
              <IconTile icon="grad" tone="info" size={38} />
              <span style={{ display: "flex", flexDirection: "column" }}>
                <strong>{tx(p("Send to teachers", "शिक्षकों को भेजें"))}</strong>
                <span style={{ fontSize: 12, color: "var(--mut)" }}>{tx(p("Publishing puts it on every teacher's screen · duties go separately", "प्रकाशित करने पर हर शिक्षक की स्क्रीन पर · ड्यूटी अलग से"))}</span>
              </span>
            </div>
            <WhatsAppPreview title={tx(p("To teachers", "शिक्षकों को"))} lines={teacherText} />
            <Btn variant="soft" icon="copy" onClick={() => void navigator.clipboard?.writeText(teacherText.join("\n")).then(() => toast.show({ text: tx(p("Message copied", "संदेश कॉपी हुआ")) }))}>
              {tx(p("Copy for the staff group", "स्टाफ़ ग्रुप के लिए कॉपी करें"))}
            </Btn>
          </Card>
          <Card style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
              <IconTile icon="users" tone="acc" size={38} />
              <span style={{ display: "flex", flexDirection: "column" }}>
                <strong>{tx(p("Send to parents", "अभिभावकों को भेजें"))}</strong>
                <span style={{ fontSize: 12, color: "var(--mut)" }}>{tx(p("Hindi first, English below", "पहले हिंदी, नीचे अंग्रेज़ी"))}</span>
              </span>
            </div>
            <Seg
              label={tx(p("Format", "रूप"))}
              value={format}
              onChange={setFormat}
              options={[
                { value: "image", label: tx(p("Image · opens in chat", "चित्र · चैट में खुलता")) },
                { value: "pdf", label: tx(p("PDF · for printing", "PDF · छापने के लिए")) },
              ]}
            />
            <WhatsAppPreview title={tx(p("To parents", "अभिभावकों को"))} lines={parentText} footer={`📎 Date sheet · ${exam.name.en}.${format === "image" ? "jpg" : "pdf"}`} />
            <span style={{ fontSize: 13, color: "var(--mut)" }}>
              {tx(p("Messages to families go from Notices, where each send to parents is approved before it leaves.", "परिवारों को संदेश 'सूचनाएँ' से जाते हैं, जहाँ हर भेजने से पहले मंज़ूरी होती है।"))}
            </span>
            <Btn variant="sec" icon="megaphone" href="/messages">
              {tx(p("Open Notices", "सूचनाएँ खोलें"))}
            </Btn>
          </Card>
          <Btn variant="pri" big icon="upload" disabled={pending || slots.length === 0} onClick={() => run(() => actions.publish({ examId: exam.id }))}>
            {exam.publishedAt ? tx(p("Publish again", "फिर प्रकाशित करें")) : tx(p("Publish date sheet", "डेट शीट प्रकाशित करें"))}
          </Btn>
        </div>
      </div>
    </>
  );
}
