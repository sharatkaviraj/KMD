"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";

import { draftKey } from "@/platform/drafts/policy";
import { loadDraft, removeDraft, saveDraft } from "@/platform/drafts/store";
import { useOnline } from "@/platform/drafts/use-durable-draft";
import { Ic } from "@/vx/icons";
import { Bi, useVx } from "@/vx/i18n";
import { clock, dayMonth, initials, longDay, shortDay } from "@/vx/format";
import { p, type Pair } from "@/vx/text";
import { Chip, ChipRow, Field, SearchBox, Switch, Textarea } from "@/vx/ui/controls";
import { Sheet, useToast } from "@/vx/ui/overlays";
import { Banner, Section, TopBar, VxPage } from "@/vx/ui/page";
import { Avatar, Btn, Card, EmptyState, Pill, SuccessTick, WhatsAppPreview } from "@/vx/ui/primitives";
import { LangButton } from "@/vx/shell/sidebar";

import { checkRegisterVx, saveRegisterVx, type VxSaveState } from "../actions";
import type { AttendChoices, AttendData } from "../data";
import {
  absentAlert,
  absentOften,
  copyYesterday,
  countMarks,
  monthGrid,
  nextTap,
  shiftMonth,
  type Mark,
} from "../domain/teach";
import { HelpIcon, HelpSheet, useUrlState, type HelpStep } from "./shared";

type SheetKey = "save" | "help";
type ViewKey = "history";

const HELP: HelpStep[] = [
  { icon: "users", title: p("Everyone starts Present", "सब उपस्थित से शुरू"), body: p("Tap a child once for Absent, twice for Half-day, three times for Present again.", "एक बार टैप = अनुपस्थित, दो बार = आधा दिन, तीन बार = फिर उपस्थित।") },
  { icon: "check", title: p("Save when you are done", "हो जाए तो सहेजें"), body: p("Until you save, the office sees your class as Not marked.", "सहेजने तक ऑफ़िस को कक्षा 'दर्ज नहीं' दिखती है।") },
  { icon: "edit", title: p("Change it any time", "कभी भी बदलें"), body: p("A class teacher can change a saved register whenever needed. Choose a reason; it is kept in the history.", "कक्षा अध्यापक सहेजी हुई हाज़िरी कभी भी बदल सकते हैं। कारण चुनें; वह इतिहास में रहेगा।") },
];

const MARK_TEXT: Record<Mark, Pair> = {
  present: p("Present", "उपस्थित"),
  absent: p("Absent", "अनुपस्थित"),
  half_day: p("Half-day", "आधा दिन"),
  late: p("Late", "देर से"),
  leave: p("Leave", "छुट्टी"),
};
const MARK_LETTER: Record<Mark, string> = { present: "P", absent: "A", half_day: "H", late: "L", leave: "Lv" };
const MARK_CLASS: Record<Mark, string> = { present: "p", absent: "a", half_day: "h", late: "p", leave: "h" };

// Why a saved register is being changed. A correction needs a reason (D-219).
const WHY: Pair[] = [p("Came late", "देर से आया"), p("Went home sick", "बीमार होकर घर गया"), p("Marked by mistake", "गलती से दर्ज"), p("Was on a school trip", "स्कूल ट्रिप पर था")];

function newId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : "10000000-1000-4000-8000-100000000000".replace(/[018]/g, (c) => (Number(c) ^ ((Math.random() * 16) >> (Number(c) / 4))).toString(16));
}

type Outbox = { payload: string; alerts: boolean; commandId: string; at: number };

/* --------------------------------------------------------- choose a class */

/** The time a draft was written; called from event handlers only. */
function stamp(): number {
  return Date.now();
}

export function AttendChoose({ data }: { data: AttendChoices }) {
  const { tx } = useVx();
  return (
    <VxPage>
      <TopBar title={<Bi en="Attendance" hi="हाज़िरी" />} mBack="/teach" />
      <main>
        <Section>
          {data.choices.length === 0 ? (
            <EmptyState icon="calCheck" title={tx(p("You do not take a register", "आप हाज़िरी नहीं लेते"))} body={tx(p("Class teachers take the daily register.", "दैनिक हाज़िरी कक्षा अध्यापक लेते हैं।"))} />
          ) : (
            <Card pad={false}>
              <div style={{ padding: "14px 16px" }}><strong><Bi en="Choose a class" hi="कक्षा चुनें" /></strong></div>
              {data.choices.map((c) => (
                <Link key={c.classId} href={`/teach/attendance?class=${c.classId}&day=${data.day}`} className="row tap" style={{ display: "flex", alignItems: "center", gap: 12, padding: "14px 16px", borderTop: "1px solid var(--bd)", minHeight: 56 }}>
                  <Ic n="users" /> <span style={{ flex: 1, fontWeight: 600 }}>{c.classLabel}</span> <Ic n="chevRight" size={18} />
                </Link>
              ))}
            </Card>
          )}
        </Section>
      </main>
    </VxPage>
  );
}

/* -------------------------------------------------------------- the screen */

export function TeachAttend({
  data,
  ownerId,
  initialSheet,
  initialView,
  school,
}: {
  data: AttendData;
  ownerId: string;
  initialSheet: string | null;
  initialView: string | null;
  school: string;
}) {
  const { tx, sub } = useVx();
  const router = useRouter();
  const toast = useToast();
  const online = useOnline();
  const [sheet, setSheet] = useUrlState<SheetKey>("sheet", (initialSheet as SheetKey) ?? null);
  const [view, setView] = useUrlState<ViewKey>("view", initialView === "history" ? "history" : null);

  const recorded = data.revision >= 1;
  const ids = useMemo(() => data.roll.map((r) => r.id), [data.roll]);
  const fresh = useMemo(() => Object.fromEntries(ids.map((id) => [id, "present" as Mark])), [ids]);

  const [editing, setEditing] = useState<"mark" | "change" | null>(!recorded && data.canSave && !data.closed ? "mark" : null);
  const [marks, setMarks] = useState<Record<string, Mark>>(recorded ? { ...fresh, ...data.saved } : fresh);
  const [flash, setFlash] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [alerts, setAlerts] = useState(true);
  const [state, setState] = useState<VxSaveState | null>(null);
  const [outbox, setOutbox] = useState<Outbox | null>(null);
  const [outboxDurable, setOutboxDurable] = useState(true);
  const [pending, start] = useTransition();
  const sending = useRef(false);

  const draftId = draftKey(ownerId, data.sessionLabel, `attendance-vx/${data.classId}/${data.day}`);
  const outboxId = draftKey(ownerId, data.sessionLabel, `attendance-outbox/${data.classId}/${data.day}`);
  const markScope = `${draftId}:${data.revision}`;
  const changedMarks = useRef({ scope: markScope, ids: new Set<string>() });
  const rememberChanges = (changed: readonly string[]) => {
    if (changedMarks.current.scope !== markScope) changedMarks.current = { scope: markScope, ids: new Set<string>() };
    for (const id of changed) changedMarks.current.ids.add(id);
  };

  // Restore an unsent register and a waiting save after a reload.
  useEffect(() => {
    let live = true;
    if (changedMarks.current.scope !== markScope) changedMarks.current = { scope: markScope, ids: new Set<string>() };
    const touched = changedMarks.current.ids;
    void loadDraft(draftId)
      .then((raw) => {
        const d = raw as { value?: { marks?: Record<string, Mark>; revision?: number } } | null;
        if (!live || !d?.value?.marks || d.value.revision !== data.revision) return;
        // A slow phone-storage read must not replace marks changed since opening.
        setMarks((cur) => ({ ...cur, ...Object.fromEntries(Object.entries(d.value?.marks ?? {}).filter(([id]) => ids.includes(id) && !touched.has(id))) }));
      })
      .catch(() => undefined);
    void loadDraft(outboxId)
      .then((raw) => {
        const d = raw as { value?: Outbox } | null;
        if (live && d?.value?.payload) setOutbox(d.value);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [draftId, outboxId, data.revision, ids, markScope]);

  const counts = countMarks(ids, marks);
  const absentKids = data.roll.filter((r) => marks[r.id] === "absent");
  const often = useMemo(() => new Map(absentOften(data.monthMarks, 3).map((o) => [o.studentId, o.absent])), [data.monthMarks]);
  const yesterdayAbsent = Object.values(data.yesterday).filter((m) => m === "absent").length;
  // The class teacher changes her own register whenever she needs to, and the
  // office any register; nobody approves it (D-248).
  const mayChangeHere = data.canCorrect && !data.closed;

  const tap = (id: string) => {
    if (!editing) return;
    rememberChanges([id]);
    const next = { ...marks, [id]: nextTap(marks[id]) };
    setMarks(next);
    setFlash(id);
    void saveDraft(draftId, { version: 1, baseline: String(data.revision), value: { marks: next, revision: data.revision }, updatedAt: stamp() }).catch(() => undefined);
  };

  const settle = (res: VxSaveState) => {
    setState(res);
    if (res.status === "saved") {
      void removeDraft(draftId).catch(() => undefined);
      void removeDraft(outboxId).catch(() => undefined);
      setOutbox(null);
      setEditing(null);
      setSheet(null);
      toast.show({ text: tx(p(`Saved at ${clock(res.receipt.savedAt)}. The office can see it now.`, `${clock(res.receipt.savedAt)} बजे सहेजा। ऑफ़िस अब देख सकता है।`)) });
      if (res.queueWarning) toast.show({ text: tx(res.queueWarning), tone: "bad" });
      router.refresh();
    } else if (res.status !== "idle") {
      if (res.status !== "error") {
        // Terminal refusals require another review, never automatic delivery.
        setOutbox(null);
        void removeDraft(outboxId).catch(() => undefined);
      }
      toast.show({ text: tx(res.message), tone: "bad" });
    }
  };

  const deliver = (box: Outbox, recover = false) =>
    start(async () => {
      if (sending.current) return;
      sending.current = true;
      try {
        if (recover) {
          const check = await checkRegisterVx(box.commandId).catch(() => null);
          if (check?.status === "saved") return settle(check);
        }
        const res = await saveRegisterVx(box.payload, box.alerts);
        if (res.status === "error") {
          const check = await checkRegisterVx(box.commandId).catch(() => null);
          if (check?.status === "saved") return settle(check);
        }
        settle(res);
      } catch {
        // No answer: keep it in the outbox and try again when the phone is back online.
        setOutbox(box);
        try {
          await saveDraft(outboxId, { version: 1, baseline: String(data.revision), value: box, updatedAt: stamp() });
          setOutboxDurable(true);
        } catch {
          setOutboxDurable(false);
          toast.show({ text: tx(p("The save could not be confirmed or stored on this phone. Keep this page open and check again when online.", "सहेजने की पुष्टि नहीं हुई और फ़ोन पर कॉपी नहीं बनी। यह पेज खुला रखें और इंटरनेट आने पर फिर जाँचें।")), tone: "bad" });
        }
      } finally {
        sending.current = false;
      }
    });

  // Back online with a save waiting: send it again, with the same id.
  useEffect(() => {
    if (!online || !outbox || sending.current) return;
    const t = window.setTimeout(() => deliver(outbox, true), 400);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [online, outbox]);

  const submit = (kind: "save" | "correction", reason: string | null) => {
    const commandId = newId();
    const payload = JSON.stringify({
      commandId,
      classId: data.classId,
      day: data.day,
      kind,
      expectedRevision: data.revision,
      reason,
      marks: ids.map((id) => ({ studentId: id, status: marks[id] ?? "present" })),
    });
    const box: Outbox = { payload, alerts, commandId, at: Date.now() };
    if (!online) {
      start(async () => {
        try {
          await saveDraft(outboxId, { version: 1, baseline: String(data.revision), value: box, updatedAt: stamp() });
          setOutboxDurable(true);
          setOutbox(box);
          setSheet(null);
          toast.show({ text: tx(p("No internet. Saved on this phone — it will be sent when you are back online.", "इंटरनेट नहीं। फ़ोन पर रखा है — इंटरनेट आते ही भेज देंगे।")), tone: "info" });
        } catch {
          toast.show({ text: tx(p("Not saved on this phone. Keep this page open and save when the internet returns.", "फ़ोन पर नहीं सहेजा गया। यह पेज खुला रखें और इंटरनेट आने पर सहेजें।")), tone: "bad" });
        }
      });
      return;
    }
    deliver(box);
  };

  /* ----------------------------------------------------- why it changed */
  const [why, setWhy] = useState<string>(WHY[0].en);
  const [whyNote, setWhyNote] = useState("");
  const changeReason = [why, whyNote.trim()].filter(Boolean).join(" — ");

  const shown = data.roll.filter((r) => !query || r.name.toLowerCase().includes(query.toLowerCase()) || (r.rollNo ?? "") === query);
  const preview = absentKids[0] ? absentAlert({ childName: absentKids[0].name, classLabel: data.classLabel, dayLabel: dayMonth(data.day), school }) : null;

  /* ------------------------------------------------------------- pieces */

  const countsRow = (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(3,minmax(0,1fr))", gap: 10 }}>
      {[
        { t: MARK_TEXT.present, v: counts.present + counts.late, c: "var(--ok)" },
        { t: MARK_TEXT.absent, v: counts.absent, c: "var(--bad)" },
        { t: MARK_TEXT.half_day, v: counts.halfDay + counts.leave, c: "var(--warn)" },
      ].map((x) => (
        <div key={x.t.en} className="t-count">
          <span style={{ display: "flex", alignItems: "center", gap: 6, fontWeight: 700, fontSize: 13 }}><span className="t-dot" style={{ background: x.c }} />{tx(x.t)}</span>
          <b className="num" style={{ color: x.c }}>{x.v}</b>
          {sub(x.t) ? <span style={{ fontSize: 12, color: "var(--mut)" }}>{sub(x.t)}</span> : null}
        </div>
      ))}
    </div>
  );

  const grid = (
    <div className="t-kids">
      {shown.map((r, i) => {
        const m = marks[r.id] ?? "present";
        const hint = often.get(r.id) ? tx(p(`${often.get(r.id)} days absent this month`, `इस महीने ${often.get(r.id)} दिन अनुपस्थित`)) : null;
        return (
          <button
            key={r.id}
            type="button"
            disabled={!editing}
            onClick={() => tap(r.id)}
            className={`t-kid tap ${MARK_CLASS[m]}${flash === r.id ? " flash" : ""}`}
            aria-label={`${r.name}: ${tx(MARK_TEXT[m])}`}
            aria-pressed={m !== "present"}
            style={{ animation: `xIn .3s var(--ease) ${Math.min(i * 12, 300)}ms both` }}
          >
            <span className="t-roll num">{r.rollNo ?? i + 1}</span>
            <Avatar text={initials(r.name)} seed={r.id} size={38} />
            <span style={{ minWidth: 0, display: "flex", flexDirection: "column" }}>
              <strong className="clip">{r.name}</strong>
              <span style={{ fontSize: 12, fontWeight: 600, color: m === "absent" ? "var(--bad)" : m === "present" || m === "late" ? "var(--ok)" : "var(--warnfg)" }}>
                {hint && m === "present" ? <span style={{ color: "var(--warnfg)" }}>{hint}</span> : tx(MARK_TEXT[m])}
              </span>
            </span>
            <span className="t-mark">{m === "present" || m === "late" ? <Ic n="check" size={18} /> : MARK_LETTER[m]}</span>
          </button>
        );
      })}
    </div>
  );

  const savedCard = recorded ? (
    <Card style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10, textAlign: "center", padding: 22 }}>
      <SuccessTick size={84} />
      <strong className="serif" style={{ fontSize: 24 }}>{tx(p(`Saved at ${data.receipt ? clock(data.receipt.savedAt) : "—"}.`, `${data.receipt ? clock(data.receipt.savedAt) : "—"} बजे सहेजा।`))}</strong>
      <span style={{ color: "var(--mut)" }}>
        <Bi en="The office can see it now." hi="कार्यालय अब इसे देख सकता है।" />
      </span>
      <div style={{ width: "100%" }}>{countsRow}</div>
      {data.queuedAlerts.length ? (
        <span style={{ fontSize: 13, color: "var(--mut)", display: "flex", gap: 6, alignItems: "center" }}>
          <Ic n="message" size={16} /> {tx(p(`WhatsApp to ${data.queuedAlerts.length} parents is queued for 10 am · Hindi first`, `${data.queuedAlerts.length} अभिभावकों को सुबह 10 बजे का व्हाट्सऐप कतार में`))}
        </span>
      ) : null}
      {data.receipt?.actorName ? <span style={{ fontSize: 12, color: "var(--sub)" }}>{tx(p(`By ${data.receipt.actorName} · revision ${data.receipt.revision}`, `${data.receipt.actorName} द्वारा · संशोधन ${data.receipt.revision}`))}</span> : null}
    </Card>
  ) : null;

  const changeCard = recorded && mayChangeHere ? (
    <Card style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div>
        <strong>{tx(p("You can change this register", "आप यह हाज़िरी बदल सकते हैं"))}</strong>
        <div style={{ fontSize: 13, color: "var(--mut)" }}>
          {tx(p("Any time, with a reason. The change is kept in the history.", "कभी भी, कारण के साथ। बदलाव इतिहास में रहेगा।"))}
        </div>
      </div>
      {!editing ? (
        <Btn big full icon="edit" onClick={() => { rememberChanges(ids); setMarks({ ...fresh, ...data.saved }); setEditing("change"); }}>{tx(p("Change attendance", "हाज़िरी बदलें"))}</Btn>
      ) : null}
    </Card>
  ) : null;

  const nextStep = recorded && often.size ? (
    <Card style={{ background: "var(--warns)", borderColor: "var(--warnm)", display: "flex", flexDirection: "column", gap: 8 }}>
      <span className="sech" style={{ color: "var(--warnfg)" }}>{tx(p("Next step", "अगला कदम"))}{sub(p("Next step", "अगला कदम")) ? ` · ${sub(p("Next step", "अगला कदम"))}` : ""}</span>
      {[...often.entries()].slice(0, 3).map(([id, n]) => {
        const kid = data.roll.find((r) => r.id === id);
        if (!kid) return null;
        return (
          <Link key={id} href={`/teach/class?student=${id}`} className="tap" style={{ display: "flex", alignItems: "center", gap: 12, padding: "6px 0" }}>
            <Avatar text={initials(kid.name)} seed={id} size={40} bg="var(--bads)" />
            <span style={{ flex: 1 }}>
              <strong style={{ display: "block" }}>{tx(p(`${kid.name}: absent ${n} days this month`, `${kid.name}: इस महीने ${n} दिन अनुपस्थित`))}</strong>
              <span style={{ fontSize: 13, color: "var(--warnfg)" }}>{tx(p("Call the parents?", "माता-पिता को फ़ोन करें?"))}</span>
            </span>
            <Ic n="phone" />
          </Link>
        );
      })}
    </Card>
  ) : null;

  /* ----------------------------------------------------------- history */
  const grid_ = monthGrid(data.month);
  const byDay = new Map<string, { absent: string[]; marked: number }>();
  for (const m of data.monthMarks) {
    const d = byDay.get(m.day) ?? { absent: [], marked: 0 };
    d.marked += 1;
    if (m.status === "absent") d.absent.push(m.studentId);
    byDay.set(m.day, d);
  }
  const [pickDay, setPickDay] = useState<string>(data.day.startsWith(data.month) ? data.day : `${data.month}-01`);
  const picked = byDay.get(pickDay);
  const nameOf = new Map(data.roll.map((r) => [r.id, r.name]));
  const history = (
    <div className="stack" style={{ display: "grid", gridTemplateColumns: "minmax(0,1.4fr) minmax(0,1fr)", gap: 16, alignItems: "start" }}>
      <Card style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <Link className="tap icon-btn" aria-label={tx(p("Previous month", "पिछला महीना"))} href={`/teach/attendance?class=${data.classId}&day=${data.day}&view=history&month=${shiftMonth(data.month, -1)}`}><Ic n="chevLeft" /></Link>
          <strong>{new Intl.DateTimeFormat("en-IN", { month: "long", year: "numeric" }).format(new Date(`${data.month}-15T12:00:00+05:30`))}</strong>
          <Link className="tap icon-btn" aria-label={tx(p("Next month", "अगला महीना"))} href={`/teach/attendance?class=${data.classId}&day=${data.day}&view=history&month=${shiftMonth(data.month, 1)}`}><Ic n="chevRight" /></Link>
        </div>
        <div className="t-cal" style={{ fontSize: 11, color: "var(--mut)", fontWeight: 700, textAlign: "center" }}>
          {["M", "T", "W", "T", "F", "S", "S"].map((d, i) => <span key={i}>{d}</span>)}
        </div>
        <div className="t-cal">
          {grid_.map((c, i) => {
            if (!c) return <span key={`b${i}`} />;
            const d = byDay.get(c.day);
            const off = c.weekday === 0 || data.closedDays.includes(c.day);
            const pct = d && d.marked ? Math.round(((d.marked - d.absent.length) / d.marked) * 100) : null;
            return (
              <button key={c.day} type="button" className={`tap t-calDay${off ? " off" : ""}${pickDay === c.day ? " sel" : ""}`} onClick={() => setPickDay(c.day)} aria-label={`${shortDay(c.day)}${pct !== null ? ` ${pct}%` : ""}`}>
                <span>{c.date}</span>
                {pct !== null ? <small style={{ color: pct >= 90 ? "var(--ok)" : pct >= 75 ? "var(--warnfg)" : "var(--bad)" }}>{pct}%</small> : off ? <small>—</small> : null}
              </button>
            );
          })}
        </div>
      </Card>
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <Card style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <strong>{longDay(pickDay)}</strong>
          {!picked ? (
            <span style={{ color: "var(--mut)" }}>{tx(p("No register saved for this day.", "इस दिन की हाज़िरी नहीं।"))}</span>
          ) : (
            <>
              <span style={{ color: "var(--mut)" }}>{tx(p(`${picked.marked - picked.absent.length} present · ${picked.absent.length} absent`, `${picked.marked - picked.absent.length} उपस्थित · ${picked.absent.length} अनुपस्थित`))}</span>
              {picked.absent.map((id) => (
                <div key={id} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <Avatar text={initials(nameOf.get(id) ?? "?")} seed={id} size={30} bg="var(--bads)" />
                  <span>{nameOf.get(id) ?? "—"}</span>
                </div>
              ))}
            </>
          )}
        </Card>
        <Card style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <strong><Bi en="Absent often this month" hi="इस महीने अक्सर अनुपस्थित" /></strong>
          {often.size === 0 ? <span style={{ color: "var(--mut)" }}>{tx(p("Nobody absent 3 days or more.", "कोई भी 3 या ज़्यादा दिन अनुपस्थित नहीं।"))}</span> : null}
          {[...often.entries()].map(([id, n]) => (
            <Link key={id} href={`/teach/class?student=${id}`} className="row tap" style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 0" }}>
              <Avatar text={initials(nameOf.get(id) ?? "?")} seed={id} size={30} />
              <span style={{ flex: 1 }}>{nameOf.get(id) ?? "—"}</span>
              <Pill tone="bad">{tx(p(`${n} days`, `${n} दिन`))}</Pill>
            </Link>
          ))}
          <Btn href={`/teach/register?class=${data.classId}&month=${data.month}`} icon="printer">{tx(p("Monthly register", "मासिक रजिस्टर"))}</Btn>
        </Card>
      </div>
    </div>
  );

  /* -------------------------------------------------------------- page */
  const title = `${data.classLabel} · ${shortDay(data.day)}`;
  return (
    <VxPage>
      <TopBar
        crumb={`${tx(p("Attendance", "हाज़िरी"))}${sub(p("Attendance", "हाज़िरी")) ? ` · ${sub(p("Attendance", "हाज़िरी"))}` : ""}`}
        title={title}
        actions={
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            {outbox ? <Pill tone="warn" icon="cloud">{tx(p("Waiting to sync", "भेजना बाकी"))}</Pill> : null}
            <LangButton tone="page" />
            <Btn icon={view === "history" ? "calCheck" : "calendar"} onClick={() => setView(view === "history" ? null : "history")}>{view === "history" ? tx(p("Today's register", "आज की हाज़िरी")) : tx(p("Past days", "पिछले दिन"))}</Btn>
            <Btn icon="help" onClick={() => setSheet("help")}>{tx(p("Help", "मदद"))}</Btn>
          </div>
        }
        mTitle={recorded && !editing ? tx(p("Attendance saved", "हाज़िरी सहेजी गई")) : `${data.classLabel} · ${tx(p("Attendance", "हाज़िरी"))}`}
        mSub={`${shortDay(data.day)} · ${tx(p(`${data.roll.length} children`, `${data.roll.length} बच्चे`))}`}
        mBack="/teach"
        mAction={
          <div style={{ display: "flex", alignItems: "center", gap: 2 }}>
            <button type="button" className="tap icon-btn" style={{ width: 44, height: 44 }} aria-label={tx(p("Past days", "पिछले दिन"))} onClick={() => setView(view === "history" ? null : "history")}><Ic n="calendar" size={20} /></button>
            <HelpIcon onClick={() => setSheet("help")} label={tx(p("Help", "मदद"))} />
          </div>
        }
      />
      <main>
        <Section>
          {!online ? <Banner tone="warn">{tx(p("No internet. You can still mark — saving will wait for the connection.", "इंटरनेट नहीं। हाज़िरी लगा सकते हैं — सहेजना कनेक्शन का इंतज़ार करेगा।"))}</Banner> : null}
          {outbox ? (
            <Banner tone="warn" action={online ? <Btn variant="sec" disabled={pending} onClick={() => deliver(outbox, true)}>{tx(p("Send now", "अभी भेजें"))}</Btn> : undefined}>
              {outboxDurable ? tx(p("Waiting to sync — this register is saved on this phone and will be sent when you are online.", "भेजना बाकी — यह हाज़िरी फ़ोन पर रखी है, इंटरनेट आते ही भेजी जाएगी।")) : tx(p("The save is waiting only on this open page. Keep it open and check again when online.", "सहेजना केवल इस खुले पेज पर बाकी है। इसे खुला रखें और इंटरनेट आने पर फिर जाँचें।"))}
            </Banner>
          ) : null}
          {data.closed ? <Banner tone="info">{tx(p("School is closed on this day, or it has not come yet. There is no register to take.", "इस दिन स्कूल बंद है या दिन अभी नहीं आया।"))}</Banner> : null}
          {data.reason && !data.canSave && !data.canCorrect ? <Banner tone="info">{tx(data.reason)}</Banner> : null}
          {state && (state.status === "stale" || state.status === "roster_changed" || state.status === "refused") ? (
            <Banner tone="bad" action={<Btn variant="sec" onClick={() => router.refresh()}>{tx(p("Reload", "फिर खोलें"))}</Btn>}>
              {tx(state.message)}
              {state.status === "roster_changed" ? ` ${[...state.joined.map((n) => `+${n}`), ...state.left.map((n) => `−${n}`)].join(", ")}` : ""}
            </Banner>
          ) : null}

          {view === "history" ? (
            history
          ) : data.roll.length === 0 ? (
            <EmptyState icon="users" title={tx(p("Nobody is on this class's roll for this day", "इस दिन कक्षा में कोई बच्चा नहीं"))} />
          ) : editing ? (
            <div className="stack" style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) 300px", gap: 16, alignItems: "start" }}>
              <div style={{ display: "flex", flexDirection: "column", gap: 14, minWidth: 0 }}>
                <Banner tone="ok">
                  {editing === "change" ? tx(p("Change the marks, then save the change.", "हाज़िरी बदलें, फिर सहेजें।")) : tx(p("Everyone is marked Present. Tap only the children who are absent.", "सब उपस्थित हैं। सिर्फ़ अनुपस्थित बच्चों पर टैप करें।"))}
                </Banner>
                {countsRow}
                <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                  {editing === "mark" && yesterdayAbsent > 0 ? (
                    <Btn icon="refresh" onClick={() => { rememberChanges(ids); setMarks(copyYesterday(ids, data.yesterday)); }}>{tx(p(`Same as yesterday (${yesterdayAbsent})`, `कल जैसा (${yesterdayAbsent})`))}</Btn>
                  ) : null}
                  {editing === "change" ? <Btn icon="x" onClick={() => { rememberChanges(ids); setEditing(null); setMarks({ ...fresh, ...data.saved }); }}>{tx(p("Cancel change", "बदलाव रद्द"))}</Btn> : null}
                  <SearchBox value={query} onChange={setQuery} placeholder={tx(p("Find a child", "बच्चा खोजें"))} style={{ flex: 1, minWidth: 200 }} />
                </div>
                <span style={{ fontSize: 13, color: "var(--mut)" }}>{tx(p("Tap once for Absent, twice for Half-day, three times for Present again", "एक बार टैप = अनुपस्थित, दो बार = आधा दिन, तीन बार = उपस्थित"))}</span>
                {grid}
              </div>
              <Card className="hide-m" style={{ position: "sticky", top: 80, display: "flex", flexDirection: "column", gap: 10 }}>
                <span className="sech">{tx(p("Today so far", "अब तक"))}</span>
                <div style={{ height: 10, borderRadius: 5, background: "var(--s3)", overflow: "hidden", display: "flex" }}>
                  <span style={{ width: `${(counts.present / Math.max(1, counts.total)) * 100}%`, background: "var(--ok)" }} />
                  <span style={{ width: `${((counts.halfDay + counts.leave) / Math.max(1, counts.total)) * 100}%`, background: "var(--warn)" }} />
                  <span style={{ width: `${(counts.absent / Math.max(1, counts.total)) * 100}%`, background: "var(--bad)" }} />
                </div>
                <strong className="num" style={{ fontSize: 30 }}>{Math.round(((counts.present + counts.late) / Math.max(1, counts.total)) * 100)}% <span style={{ fontSize: 14, color: "var(--mut)", fontWeight: 500 }}>{tx(p("present", "उपस्थित"))}</span></strong>
                <span style={{ color: "var(--mut)", fontSize: 13 }}>{counts.absent === 0 ? tx(p("No one marked absent yet.", "अभी कोई अनुपस्थित नहीं।")) : absentKids.map((k) => k.name).join(", ")}</span>
                <div style={{ borderRadius: 12, background: "var(--s2)", padding: 12, fontSize: 13, display: "flex", gap: 8 }}>
                  <Ic n="message" size={16} />
                  {tx(p("Parents of absent children can get a WhatsApp at 10 am. You choose before saving.", "अनुपस्थित बच्चों के माता-पिता को सुबह 10 बजे व्हाट्सऐप जा सकता है। सहेजने से पहले चुनें।"))}
                </div>
              </Card>
            </div>
          ) : (
            <div className="stack" style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(0,1fr)", gap: 16, alignItems: "start" }}>
              <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>{savedCard}{changeCard}</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                {nextStep}
                <Card pad={false}>
                  <div style={{ padding: "14px 16px" }}><strong><Bi en="Absent today" hi="आज अनुपस्थित" /></strong></div>
                  {data.roll.filter((r) => data.saved[r.id] && data.saved[r.id] !== "present" && data.saved[r.id] !== "late").map((r) => (
                    <Link key={r.id} href={`/teach/class?student=${r.id}`} className="row tap" style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 16px", borderTop: "1px solid var(--bd)" }}>
                      <Avatar text={initials(r.name)} seed={r.id} size={36} />
                      <span style={{ flex: 1 }}>{r.name}</span>
                      <Pill tone={data.saved[r.id] === "absent" ? "bad" : "warn"}>{tx(MARK_TEXT[data.saved[r.id]])}</Pill>
                    </Link>
                  ))}
                  {!recorded ? <div style={{ padding: 16, color: "var(--mut)" }}>{tx(p("Not marked yet.", "अभी दर्ज नहीं।"))}</div> : null}
                </Card>
              </div>
            </div>
          )}
        </Section>

        {editing && view !== "history" && data.roll.length > 0 ? (
          <div className="t-savebar">
            <div style={{ flex: 1, minWidth: 0 }}>
              <strong style={{ display: "block" }}>{tx(p(`${data.classLabel} · ${counts.present + counts.late} present · ${counts.absent} absent`, `${data.classLabel} · ${counts.present + counts.late} उपस्थित · ${counts.absent} अनुपस्थित`))}</strong>
              <span className="hide-m" style={{ fontSize: 12, color: "var(--mut)" }}>{tx(p(`Until you save, the office sees ${data.classLabel} as Not marked.`, `सहेजने तक ऑफ़िस को ${data.classLabel} 'दर्ज नहीं' दिखेगी।`))}</span>
            </div>
            <Btn variant="pri" big icon="check" disabled={pending} onClick={() => setSheet("save")} style={{ minWidth: 220 }}>
              {editing === "change" ? tx(p("Save the change", "बदलाव सहेजें")) : tx(p("Save attendance", "हाज़िरी सहेजें"))}
            </Btn>
          </div>
        ) : null}
      </main>

      {/* ------------------------------------------------------ save sheet */}
      <Sheet
        open={sheet === "save"}
        onClose={() => setSheet(null)}
        title={tx(p(`Save ${data.classLabel} attendance?`, `${data.classLabel} की हाज़िरी सहेजें?`))}
        sub={`${shortDay(data.day)} · ${tx(p(`${counts.present + counts.late} present · ${counts.absent} absent`, `${counts.present + counts.late} उपस्थित · ${counts.absent} अनुपस्थित`))}`}
        footer={
          <>
            <button type="button" className="tap btn sec big" style={{ flex: 1 }} onClick={() => setSheet(null)}>{tx(p("Check again", "फिर देखें"))}</button>
            <button type="button" className="tap btn pri big" style={{ flex: 2 }} disabled={pending || !editing || (editing === "change" && changeReason.length < 3)} onClick={() => submit(editing === "change" ? "correction" : "save", editing === "change" ? changeReason : null)}>
              {pending ? <Ic n="refresh" size={18} className="spin" /> : <Ic n="check" size={18} />}
              {editing === "change" ? tx(p("Save the change", "बदलाव सहेजें")) : tx(p("Save attendance", "हाज़िरी सहेजें"))}
            </button>
          </>
        }
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {countsRow}
          <span className="sech">{tx(p(`Absent today (${absentKids.length})`, `आज अनुपस्थित (${absentKids.length})`))}</span>
          {absentKids.length === 0 ? <span style={{ color: "var(--mut)" }}>{tx(p("Everyone is here.", "सब उपस्थित हैं।"))}</span> : null}
          {absentKids.map((k) => (
            <div key={k.id} style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <Avatar text={initials(k.name)} seed={k.id} size={36} bg="var(--bads)" />
              <span style={{ flex: 1 }}>
                <strong style={{ display: "block" }}>{k.name}</strong>
                <span style={{ fontSize: 12, color: "var(--mut)" }}>{tx(p(`Roll ${k.rollNo ?? "—"}`, `रोल ${k.rollNo ?? "—"}`))}{data.yesterday[k.id] === "absent" ? ` · ${tx(p("absent yesterday too", "कल भी अनुपस्थित"))}` : ""}</span>
              </span>
            </div>
          ))}
          {absentKids.length ? (
            <>
              <div style={{ display: "flex", alignItems: "center", gap: 12, padding: 14, borderRadius: 16, border: "1px solid var(--bd)", background: "var(--s2)" }}>
                <Ic n="message" size={20} />
                <span style={{ flex: 1 }}>
                  <strong style={{ display: "block" }}>{tx(p("Send WhatsApp to their parents at 10 am", "उनके माता-पिता को सुबह 10 बजे व्हाट्सऐप"))}</strong>
                  <span style={{ fontSize: 12, color: "var(--mut)" }}>{tx(p(`${absentKids.length} parents · Hindi first · queued for the office`, `${absentKids.length} अभिभावक · हिंदी पहले · ऑफ़िस की कतार में`))}</span>
                </span>
                <Switch on={alerts} onChange={setAlerts} label={tx(p("Send WhatsApp to parents", "माता-पिता को व्हाट्सऐप"))} />
              </div>
              {alerts && preview ? (
                <>
                  <WhatsAppPreview lines={[preview.hi, "", preview.en]} />
                  {absentKids.length > 1 ? <span style={{ fontSize: 12, color: "var(--mut)" }}>{tx(p(`The same message goes to ${absentKids.length - 1} more families with their child's name.`, `यही संदेश ${absentKids.length - 1} और परिवारों को उनके बच्चे के नाम से।`))}</span> : null}
                </>
              ) : null}
            </>
          ) : null}
          {editing === "change" ? (
            <>
              <Field label={<Bi en="Why are you changing it?" hi="क्यों बदल रहे हैं?" />}>
                <ChipRow label="Why">
                  {WHY.map((w) => (
                    <Chip key={w.en} on={why === w.en} onClick={() => setWhy(w.en)}>{tx(w)}</Chip>
                  ))}
                </ChipRow>
              </Field>
              <Field label={<Bi en="Note (optional)" hi="नोट (वैकल्पिक)" />}>
                <Textarea rows={2} maxLength={150} value={whyNote} onChange={(e) => setWhyNote(e.target.value)} />
              </Field>
            </>
          ) : (
            <span style={{ fontSize: 12, color: "var(--mut)" }}>{tx(p("After saving you can still change it whenever needed.", "सहेजने के बाद भी ज़रूरत हो तो कभी भी बदल सकते हैं।"))}</span>
          )}
        </div>
      </Sheet>

      <HelpSheet open={sheet === "help"} onClose={() => setSheet(null)} title={p("How to mark attendance", "हाज़िरी कैसे लगाएँ")} steps={HELP} />
    </VxPage>
  );
}
