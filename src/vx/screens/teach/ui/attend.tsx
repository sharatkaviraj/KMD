"use client";

import Link from "@/ui/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore, useTransition } from "react";

import { dayRuns, type ChooserContext, type ClosedWhy, type RegisterContext } from "@/modules/attendance/domain/register-day";
import { isTestSessionLabel } from "@/platform/auth/test-session-policy";
import { draftKey } from "@/platform/drafts/policy";
import { loadDraft, removeDraft, saveDraft } from "@/platform/drafts/store";
import { useOnline } from "@/platform/drafts/use-durable-draft";
import { Ic, type IconName } from "@/vx/icons";
import { useVx } from "@/vx/i18n";
import { initials } from "@/vx/format";
import { p, type Pair } from "@/vx/text";
import { Textarea } from "@/vx/ui/controls";
import { Sheet, useToast } from "@/vx/ui/overlays";
import { VxPage } from "@/vx/ui/page";
import { SAVE_IDLE, SaveStatus, useSlowSave, type SaveState } from "@/vx/ui/save-status";

import { checkRegisterVx, saveRegisterVx, type VxSaveState } from "../actions";
import type { AttendChoices, AttendData } from "../data";
import {
  absentAlert,
  absentOften,
  alertsDefault,
  childMatches,
  classLabelP,
  copyYesterday,
  countMarks,
  dayShortP,
  draftChanges,
  halfDaySwap,
  markedLine,
  monthGrid,
  monthTitleP,
  nextTap,
  shiftMonth,
  timeP,
  WEEK_HEADS,
  type Mark,
} from "../domain/teach";
import { andList } from "./fmt";
import { DrawnTick, HelpIcon, HelpSheet, LangSeg, TchTop, useUrlState, type HelpStep } from "./shared";

/*
 * Teacher · Attendance (design TchAttend). Everyone starts Present; a tap
 * makes a child Absent and a second tap Present again. Half-day is its own
 * button on an away child's card (RULES C; the old third tap saved half days
 * nobody meant — 20 Oct smoke run). Until the teacher presses Save, the
 * office sees the class as Not marked — never as present. After saving: the
 * saved card, with Change any time (D-248: no window, no request to the
 * office). The month view by `?view=history`. Saves wait in the phone's
 * outbox when offline and are sent with the same id when the phone is back
 * online. Taps not yet saved are kept on the phone and offered back, never
 * shown under a green tick.
 */

type SheetKey = "save" | "help";

/** The shared saving line (U01) in the register's words: the teacher screens say सेव. */
const REGISTER_SAVE = {
  saving: p("Saving…", "सेव हो रही है…"),
  slow: p("Still saving — please wait. Pressing again will not save it twice.", "अभी सेव हो रही है — थोड़ा रुकें। दोबारा दबाने से दो बार सेव नहीं होगी।"),
  failed: p("Could not save", "सेव नहीं हुई"),
};
type ViewKey = "history";
type S = "P" | "A" | "H";

const V = (x: string) => `var(--${x})`;

const MINI = (rows: [string, string][]) => (
  <div style={{ width: "100%", display: "flex", flexDirection: "column", gap: 5 }}>
    {rows.map(([bg, c], i) => (
      <span key={i} className="tc-mini" style={{ background: bg }}>
        <span className="tc-msk" />
        <span style={{ width: 18, height: 12, borderRadius: 6, background: c }} />
      </span>
    ))}
  </div>
);

const HELP: HelpStep[] = [
  { title: p("Everyone starts as Present", "सब बच्चे पहले से उपस्थित हैं।"), body: p("You do not need to tap the children who came.", "जो बच्चे आए उन पर टैप करने की ज़रूरत नहीं।"), pic: MINI([[V("oks"), V("ok")], [V("oks"), V("ok")], [V("oks"), V("ok")]]) },
  {
    title: p("Tap a child who is away", "जो बच्चा नहीं आया, उस पर टैप करें।"),
    body: p("Once = Absent (red). Tap again = Present again. For a half day, press “Half-day” on the red card.", "एक बार = अनुपस्थित (लाल)। फिर टैप = फिर उपस्थित। आधे दिन के लिए लाल कार्ड पर “आधा दिन” दबाएँ।"),
    pic: MINI([[V("card"), V("ok")], [V("bads"), V("bad")], [V("warns"), V("warn")]]),
  },
  {
    title: p("Press Save attendance", "सेव दबाएँ — कार्यालय तुरंत देख लेगा।"),
    body: p("The office sees it at once. You can change it later if you need to.", "कार्यालय तुरंत देख लेता है। ज़रूरत हो तो बाद में बदल सकते हैं।"),
    pic: (
      <div style={{ width: "100%", display: "flex", flexDirection: "column", gap: 5 }}>
        <span className="tc-mini"><span className="tc-msk" /><span style={{ width: 18, height: 12, borderRadius: 6, background: V("ok") }} /></span>
        <span className="tc-ib" style={{ height: 30, borderRadius: 9, background: V("pri"), color: V("prifg"), fontSize: 11, fontWeight: 700 }}>Save attendance</span>
      </div>
    ),
  },
];

const LOOK: Record<S, { t: Pair; bg: string; bd: string; sbg: string; sfg: string; fg: string; icon: IconName; cls: string }> = {
  P: { t: p("Present", "उपस्थित"), bg: V("card"), bd: V("bd"), sbg: V("oks"), sfg: V("ok"), fg: V("ok"), icon: "check", cls: "p" },
  A: { t: p("Absent", "अनुपस्थित"), bg: V("bads"), bd: V("bad"), sbg: V("bad"), sfg: V("onsolid"), fg: V("bad"), icon: "x", cls: "a" },
  H: { t: p("Half-day", "आधा दिन"), bg: V("warns"), bd: V("warnm"), sbg: V("warn"), sfg: V("onsolid"), fg: V("warnfg"), icon: "calMinus", cls: "h" },
};
const sOf = (m: Mark | undefined): S => (m === "absent" ? "A" : m === "half_day" || m === "leave" ? "H" : "P");
const TONES: [string, string][] = [[V("accs"), V("accfg")], [V("infos"), V("info")], [V("oks"), V("ok")], [V("warns"), V("warnfg")], [V("s3"), V("fg")]];

// Why a saved register is being changed. A correction needs a reason (D-219).
const WHY: Pair[] = [p("Came late", "देर से आए"), p("Went home sick", "बीमार होकर घर गए"), p("Marked by mistake", "गलती से दर्ज"), p("Was on a school trip", "स्कूल ट्रिप पर थे")];

function newId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : "10000000-1000-4000-8000-100000000000".replace(/[018]/g, (c) => (Number(c) ^ ((Math.random() * 16) >> (Number(c) / 4))).toString(16));
}

type Outbox = { payload: string; alerts: boolean; commandId: string; at: number };
type Draft = { marks?: Record<string, Mark>; revision?: number; alerts?: boolean | null };

/** The time a draft was written; called from event handlers only. */
function stamp(): number {
  return Date.now();
}

/** True once the page has hydrated: a tap before that is lost, so the cards say they are not ready yet. */
const noop = () => () => undefined;
function useHydrated(): boolean {
  return useSyncExternalStore(noop, () => true, () => false);
}

/**
 * Why there is no register on a day, as a heading and a line (group 6): a
 * holiday by its name, Sunday, or a day still to come — never "closed or not
 * come yet".
 */
function closedText(why: ClosedWhy | null, day: string, isToday: boolean): { title: Pair; body: Pair } {
  const d = dayShortP(day);
  const dh = d.hi ?? d.en;
  if (why?.kind === "future") return { title: p("This day has not come yet", "यह दिन अभी नहीं आया"), body: p(`You can mark ${d.en} on the day.`, `${dh} की हाज़िरी उसी दिन लगेगी।`) };
  if (why?.kind === "sunday") return { title: isToday ? p("Today is Sunday — school is closed", "आज रविवार है — स्कूल बंद है") : p(`${d.en} was a Sunday — school was closed`, `${dh} को रविवार था — स्कूल बंद था`), body: p("There is no register on a Sunday.", "रविवार को हाज़िरी नहीं लगती।") };
  if (why?.kind === "holiday" || why?.kind === "vacation") {
    const en = why.en ?? why.hi;
    const hi = why.hi ?? why.en;
    const word = why.kind === "vacation" ? p("vacation", "छुट्टियाँ") : p("holiday", "छुट्टी");
    const title = isToday
      ? p(`Today is a ${word.en}${en ? ` — ${en}` : ""}`, `आज ${word.hi}${hi ? ` है — ${hi}` : " है"}`)
      : p(`${d.en} was a ${word.en}${en ? ` — ${en}` : ""}`, `${dh} को ${word.hi}${hi ? ` थी — ${hi}` : " थी"}`);
    return { title, body: p("There is no register to take on a holiday.", "छुट्टी के दिन हाज़िरी नहीं लगती।") };
  }
  return { title: isToday ? p("School is closed today", "आज स्कूल बंद है") : p(`School was closed on ${d.en}`, `${dh} को स्कूल बंद था`), body: p("There is no register to take on this day.", "इस दिन हाज़िरी नहीं लगती।") };
}

/* --------------------------------------------------------- choose a class */

export function AttendChoose({ data, ownerId, context }: { data: AttendChoices; ownerId?: string; context?: ChooserContext | null }) {
  const { tx, sub, language } = useVx();
  const T = (t: Pair) => `${tx(t)}${language !== "hi" && sub(t) ? ` · ${sub(t)}` : ""}`;
  const day = context?.day ?? data.day;
  const isToday = context ? day === context.today : true;
  // Registers with taps kept on this phone but not saved (group 19).
  const [unsaved, setUnsaved] = useState<Record<string, number>>({});
  const keys = useMemo(
    () => (ownerId && context ? data.choices.map((c) => [c.classId, draftKey(ownerId, context.sessionLabel, `attendance-vx/${c.classId}/${day}`)] as const) : []),
    [ownerId, context, data.choices, day],
  );
  useEffect(() => {
    let live = true;
    for (const [classId, key] of keys) {
      void loadDraft(key)
        .then((raw) => {
          const d = (raw as { value?: Draft } | null)?.value;
          if (!live || !d?.marks) return;
          const n = Object.values(d.marks).filter((m) => m !== "present").length;
          // A saved register's kept change is offered back on its own screen; here only taps never saved.
          if (n > 0 && context?.savedAt[classId] == null) setUnsaved((cur) => ({ ...cur, [classId]: n }));
        })
        .catch(() => undefined);
    }
    return () => {
      live = false;
    };
  }, [keys, context]);

  const closed = context?.closedWhy ? closedText(context.closedWhy, data.day, data.day === context.today) : null;
  return (
    <VxPage className="tc">
      <TchTop crumb={T(p("Attendance", "हाज़िरी"))} title={tx(p("Choose a class", "कक्षा चुनें"))} mBack="/teach" actions={<LangSeg />} mAction={<LangSeg />} />
      <main>
        <div className="pad" style={{ padding: "20px 28px 40px", maxWidth: 720, display: "flex", flexDirection: "column", gap: 14 }}>
          {data.choices.length === 0 ? (
            <div className="card" style={{ padding: "32px 20px", display: "flex", flexDirection: "column", alignItems: "center", gap: 10, textAlign: "center" }}>
              <span className="tc-av" style={{ width: 56, height: 56, background: "var(--s2)", color: "var(--mut)" }}><Ic n="calCheck" size={26} /></span>
              <span className="tc-p" style={{ fontWeight: 700 }}>{T(p("You do not take attendance", "आप हाज़िरी नहीं लगाते"))}</span>
              <span className="tc-s">{T(p("Each class teacher marks their own class every morning. If you should have a class, ask the office.", "हर कक्षा अध्यापक सुबह अपनी कक्षा की हाज़िरी लगाते हैं। अगर आपकी कोई कक्षा होनी चाहिए, तो ऑफ़िस से पूछें।"))}</span>
              <Link href="/teach" className="tap btn sec" style={{ height: 48 }}><Ic n="home" />{tx(p("Back to Today", "आज पर वापस"))}</Link>
            </div>
          ) : (
            <>
              {closed ? (
                <div className="tc-note" role="status" style={{ background: "var(--infos)", color: "var(--info)" }}>
                  <Ic n="info" style={{ marginTop: 2 }} />
                  <span style={{ display: "flex", flexDirection: "column" }}>
                    <span style={{ fontWeight: 700 }}>{tx(closed.title)}</span>
                    <span>{tx(p(`Showing ${dayShortP(day).en}, the last school day.`, `पिछला स्कूल का दिन, ${dayShortP(day).hi}, दिखा रहे हैं।`))}</span>
                  </span>
                </div>
              ) : null}
              <div className="card" style={{ overflow: "hidden" }}>
                {data.choices.map((c, i) => {
                  const savedAt = context ? context.savedAt[c.classId] ?? null : undefined;
                  const kept = unsaved[c.classId];
                  const pill: { t: Pair; bg: string; fg: string } | null =
                    kept !== undefined
                      ? { t: p(`Not saved · ${kept} marked away`, `सेव नहीं · ${kept} अनुपस्थित लगाए`), bg: V("bads"), fg: V("bad") }
                      : savedAt === undefined
                        ? null
                        : savedAt !== null
                          ? { t: savedAt ? p(`Saved ${timeP(savedAt).en}`, `सेव · ${timeP(savedAt).hi}`) : p("Saved", "सेव है"), bg: V("oks"), fg: V("ok") }
                          : { t: p("Not marked", "बाकी है"), bg: V("warns"), fg: V("warnfg") };
                  return (
                    <Link key={c.classId} href={`/teach/attendance?class=${c.classId}&day=${day}`} className="row tap" style={{ display: "flex", alignItems: "center", gap: 12, padding: "14px 18px", borderTop: i ? "1px solid var(--bd)" : 0, minHeight: 64 }}>
                      <span className="tc-ib" style={{ width: 40, height: 40, borderRadius: 12, background: "var(--accs)", color: "var(--accfg)" }}><Ic n="users" /></span>
                      <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
                        <span className="tc-p" style={{ fontWeight: 700 }}>{tx(classLabelP(c.classLabel))}</span>
                        <span className="tc-s">{isToday ? tx(p(`Today · ${dayShortP(day).en}`, `आज · ${dayShortP(day).hi}`)) : tx(dayShortP(day))}</span>
                      </span>
                      {pill ? <span className="pill" style={{ height: 28, padding: "0 10px", fontSize: 13, fontWeight: 700, background: pill.bg, color: pill.fg }}>{tx(pill.t)}</span> : null}
                      <Ic n="chevRight" />
                    </Link>
                  );
                })}
              </div>
            </>
          )}
        </div>
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
  officePhone,
  context,
}: {
  data: AttendData;
  ownerId: string;
  initialSheet: string | null;
  initialView: string | null;
  school: string;
  officePhone?: string;
  /** The page's own reads: the school's today, why a day is closed, other classes. */
  context?: RegisterContext;
}) {
  const { tx, sub, language } = useVx();
  const router = useRouter();
  const toast = useToast();
  const online = useOnline();
  const ready = useHydrated();
  const [sheet, setSheet] = useUrlState<SheetKey>("sheet", (initialSheet as SheetKey) ?? null);
  const [view, setView] = useUrlState<ViewKey>("view", initialView === "history" ? "history" : null);

  // The school's today. A register for any other day is a past (or future)
  // day and says so — it used to say "today" everywhere (group 7).
  const today = context?.today ?? data.day;
  const isToday = data.day === today;
  const D = (day: string) => tx(dayShortP(day));
  const cls = tx(classLabelP(data.classLabel));
  const clsP = classLabelP(data.classLabel);

  // The save's own answer, kept until the page's data catches up with it, so
  // the saved card shows the moment the save lands instead of "Not marked
  // yet" for as long as the refresh takes (BUG-01, ST-05).
  const [justSaved, setJustSaved] = useState<{ revision: number; savedAt: string; actorName: string | null; marks: Record<string, Mark>; queued: number | null; warning: Pair | null } | null>(null);
  const local = justSaved && justSaved.revision > data.revision ? justSaved : null;
  const revision = local ? local.revision : data.revision;
  const savedMarks = local ? local.marks : data.saved;
  const receipt = local ? { savedAt: local.savedAt, actorName: local.actorName, revision: local.revision } : data.receipt;
  const queuedCount = local ? (local.queued ?? 0) : data.queuedAlerts.length;
  const recorded = revision >= 1;
  const ids = useMemo(() => data.roll.map((r) => r.id), [data.roll]);
  const fresh = useMemo(() => Object.fromEntries(ids.map((id) => [id, "present" as Mark])), [ids]);
  // The number on each card: the roll number, or the child's place in the
  // full list when the class has none — never renumbered by a search.
  const serialOf = useMemo(() => new Map(data.roll.map((r, i) => [r.id, i + 1])), [data.roll]);
  const hasRoll = data.roll.some((r) => r.rollNo);
  // The class teacher changes her own register whenever she needs to, and the
  // office any register; nobody approves it (D-248).
  const mayChangeHere = data.canCorrect && !data.closed;

  const [editing, setEditing] = useState<"mark" | "change" | null>(!recorded && data.canSave && !data.closed ? "mark" : null);
  const [marks, setMarks] = useState<Record<string, Mark>>(recorded ? { ...fresh, ...data.saved } : fresh);
  const [query, setQuery] = useState("");
  // The teacher's own answer to "WhatsApp to parents?"; null until she
  // touches the switch, and then it stays what she chose (group 8).
  const [alertsChoice, setAlertsChoice] = useState<boolean | null>(null);
  const alerts = alertsDefault({ mode: editing === "change" ? "change" : "mark", isToday, queued: queuedCount, chosen: alertsChoice });
  // Taps from an earlier visit that were never saved, offered back (group 1).
  const [restored, setRestored] = useState<number | null>(null);
  const [state, setState] = useState<VxSaveState | null>(null);
  const [outbox, setOutbox] = useState<Outbox | null>(null);
  const [outboxDurable, setOutboxDurable] = useState(true);
  const [pending, start] = useTransition();
  const sending = useRef(false);
  const typedAt = useRef(0);

  const draftId = draftKey(ownerId, data.sessionLabel, `attendance-vx/${data.classId}/${data.day}`);
  const outboxId = draftKey(ownerId, data.sessionLabel, `attendance-outbox/${data.classId}/${data.day}`);
  const markScope = `${draftId}:${revision}`;
  const changedMarks = useRef({ scope: markScope, ids: new Set<string>() });
  const rememberChanges = (changed: readonly string[]) => {
    if (changedMarks.current.scope !== markScope) changedMarks.current = { scope: markScope, ids: new Set<string>() };
    for (const id of changed) changedMarks.current.ids.add(id);
  };

  // Restore an unsent register and a waiting save after a reload. A kept
  // draft of a saved register reopens as a change, with a banner — never as
  // the saved card's numbers: the office does not have them (P1, 20 Oct).
  useEffect(() => {
    let live = true;
    if (changedMarks.current.scope !== markScope) changedMarks.current = { scope: markScope, ids: new Set<string>() };
    const touched = changedMarks.current.ids;
    void loadDraft(draftId)
      .then((raw) => {
        const d = raw as { value?: Draft } | null;
        if (!live || !d?.value?.marks || d.value.revision !== revision) return;
        // Only a register this reader can still save or change takes taps back.
        if (recorded ? !mayChangeHere : !(data.canSave && !data.closed)) return;
        // A slow phone-storage read must not replace marks changed since opening.
        const kept = Object.fromEntries(Object.entries(d.value.marks).filter(([id]) => ids.includes(id) && !touched.has(id))) as Record<string, Mark>;
        const base = recorded ? { ...fresh, ...savedMarks } : fresh;
        const changes = draftChanges(ids, base, kept);
        if (!changes.length) return;
        setMarks((cur) => ({ ...cur, ...Object.fromEntries(changes.map((id) => [id, kept[id]])) }));
        if (recorded) setEditing((e) => e ?? "change");
        if (typeof d.value.alerts === "boolean") setAlertsChoice(d.value.alerts);
        setRestored(changes.length);
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
  }, [draftId, outboxId, revision, ids, markScope, recorded, mayChangeHere, fresh, savedMarks, data.canSave, data.closed]);

  // A save still going after three seconds says so, so nobody presses twice (smoke run: ~10 s with only a spinner).
  const showSlow = useSlowSave(pending);

  const counts = countMarks(ids, marks);
  const nP = counts.present + counts.late;
  const nA = counts.absent;
  const nH = counts.halfDay + counts.leave;
  const total = Math.max(1, counts.total);
  const absentKids = data.roll.filter((r) => marks[r.id] === "absent");
  const halfKids = data.roll.filter((r) => sOf(marks[r.id]) === "H");
  const often = useMemo(() => new Map(absentOften(data.monthMarks, 3).map((o) => [o.studentId, o.absent])), [data.monthMarks]);
  const yesterdayIds = Object.entries(data.yesterday).filter(([, m]) => m === "absent").map(([id]) => id);

  // The marks as last set, so two taps in one frame both count.
  const latest = useRef(marks);
  useEffect(() => {
    latest.current = marks;
  }, [marks]);
  const keep = (next: Record<string, Mark>, chosen: boolean | null = alertsChoice) => {
    void saveDraft(draftId, { version: 1, baseline: String(revision), value: { marks: next, revision, alerts: chosen }, updatedAt: stamp() }).catch(() => undefined);
  };
  const setMark = (id: string, to: (m: Mark | undefined) => Mark) => {
    if (!editing) return;
    rememberChanges([id]);
    const next = { ...latest.current, [id]: to(latest.current[id]) };
    latest.current = next;
    setMarks(next);
    keep(next);
  };
  const tap = (id: string) => setMark(id, nextTap);
  const halfDay = (id: string) => setMark(id, halfDaySwap);
  const throwAway = () => {
    rememberChanges(ids);
    const base = recorded ? { ...fresh, ...savedMarks } : fresh;
    latest.current = base;
    setMarks(base);
    if (recorded) setEditing(null);
    setRestored(null);
    setAlertsChoice(null);
    void removeDraft(draftId).catch(() => undefined);
  };

  const scrollTop = () => {
    try {
      document.querySelector(".vx-page main")?.scrollTo?.({ top: 0 });
      if (window.scrollY > 0) window.scrollTo({ top: 0 });
    } catch {
      // Nothing to scroll.
    }
  };

  const settle = (res: VxSaveState) => {
    setState(res);
    if (res.status === "saved") {
      void removeDraft(draftId).catch(() => undefined);
      void removeDraft(outboxId).catch(() => undefined);
      setJustSaved({
        revision: res.receipt.revision,
        savedAt: res.receipt.savedAt,
        actorName: res.receipt.actorName,
        marks: { ...latest.current },
        queued: typeof res.queued === "number" ? res.queued : null,
        warning: res.queueWarning ?? null,
      });
      setOutbox(null);
      setEditing(null);
      setRestored(null);
      setAlertsChoice(null);
      setSheet(null);
      scrollTop();
      const at = timeP(res.receipt.savedAt);
      // One toast: the queue warning already says the attendance was saved.
      toast.show(res.queueWarning ? { text: tx(res.queueWarning), tone: "bad" } : { text: tx(p(`Saved at ${at.en}. The office can see it now.`, `${at.hi} बजे सेव हुई। ऑफ़िस अब देख सकता है।`)) });
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
          await saveDraft(outboxId, { version: 1, baseline: String(revision), value: box, updatedAt: stamp() });
          setOutboxDurable(true);
        } catch {
          setOutboxDurable(false);
          toast.show({ text: tx(p("The save could not be confirmed or stored on this phone. Keep this page open and check again when online.", "सेव होने की पक्की खबर नहीं मिली और फ़ोन में भी नहीं रखी जा सकी। यह पेज खुला रखें और इंटरनेट आने पर फिर देखें।")), tone: "bad" });
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
    // A new attempt: the last one's refusal no longer describes it.
    setState(null);
    const commandId = newId();
    const payload = JSON.stringify({
      commandId,
      classId: data.classId,
      day: data.day,
      kind,
      expectedRevision: revision,
      reason,
      marks: ids.map((id) => ({ studentId: id, status: marks[id] ?? "present" })),
    });
    const box: Outbox = { payload, alerts, commandId, at: Date.now() };
    if (!online) {
      start(async () => {
        try {
          await saveDraft(outboxId, { version: 1, baseline: String(revision), value: box, updatedAt: stamp() });
          setOutboxDurable(true);
          setOutbox(box);
          setSheet(null);
          toast.show({ text: tx(p("No internet. Saved on this phone — it will be sent when you are back online.", "इंटरनेट नहीं। फ़ोन पर रखा है — इंटरनेट आते ही भेज देंगे।")), tone: "info" });
        } catch {
          toast.show({ text: tx(p("Not saved on this phone. Keep this page open and save when the internet returns.", "फ़ोन में नहीं रखी जा सकी। यह पेज खुला रखें और इंटरनेट आने पर सेव करें।")), tone: "bad" });
        }
      });
      return;
    }
    deliver(box);
  };

  /* ----------------------------------------------------- why it changed */
  const [why, setWhy] = useState<string>("");
  const [whyNote, setWhyNote] = useState("");
  const changeReason = [why, whyNote.trim()].filter(Boolean).join(" — ");
  // What this change does, child by child, for the change sheet (BUG-13).
  const changed = editing === "change" ? data.roll.filter((r) => (marks[r.id] ?? "present") !== (savedMarks[r.id] ?? "present")) : [];

  const shown = data.roll.filter((r) => childMatches({ ...r, serial: serialOf.get(r.id) ?? null }, query));
  const preview = absentKids[0] ? absentAlert({ childName: absentKids[0].name, classLabel: data.classLabel, day: data.day, today, school }) : null;
  const nameOf = new Map(data.roll.map((r) => [r.id, r.name]));
  const rollOf = new Map(data.roll.map((r) => [r.id, r.rollNo]));
  // "Roll 4", or "No. 4" — the child's place in the list — when the class has
  // no roll numbers ("Roll —" told the teacher nothing, smoke run).
  const numLabel = (id: string) => {
    const roll = rollOf.get(id);
    if (roll) return tx(p(`Roll ${roll}`, `रोल ${roll}`));
    const n = serialOf.get(id);
    return n ? tx(p(`No. ${n}`, `क्रम ${n}`)) : "";
  };
  // The number, and the SR and father for children who share a name (BUG-05).
  const whoLine = (k: AttendData["roll"][number]) => [numLabel(k.id), k.hint ? tx(k.hint) : null].filter(Boolean).join(" · ");
  // A Hindi reader is not given the English underneath (smoke run: English
  // lines under every heading doubled the reading).
  const T = (t: Pair) => `${tx(t)}${language !== "hi" && sub(t) ? ` · ${sub(t)}` : ""}`;
  const subOf = (t: Pair) => (language === "hi" ? null : sub(t));

  /* ------------------------------------------------------------- pieces */

  const tiles = (size: number, source: Record<string, Mark>) => {
    const c = countMarks(ids, source);
    return (
      <div style={{ width: "100%", display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 8 }}>
        {([["P", c.present + c.late, V("oks"), V("ok")], ["A", c.absent, V("bads"), V("bad")], ["H", c.halfDay + c.leave, V("warns"), V("warnfg")]] as const).map(([k, n, bg, fg], i) => (
          <div key={k} className="tc-ctile tc-pop" style={{ background: bg, color: fg, animationDelay: `${200 + i * 90}ms` }}>
            <span className="num" style={{ fontSize: size, fontWeight: 700, lineHeight: 1.1 }}>{n}</span>
            <span style={{ fontSize: 13, fontWeight: 700 }}>{tx(LOOK[k].t)}</span>
          </div>
        ))}
      </div>
    );
  };

  const kidCard = (r: AttendData["roll"][number], i: number) => {
    const s = sOf(marks[r.id]);
    const lk = LOOK[s];
    const n = often.get(r.id);
    const num = r.rollNo ?? String(serialOf.get(r.id) ?? i + 1);
    const hint: { text: string; icon: IconName; color: string } | null = n
      ? { text: tx(p(`${n} days absent · call parents?`, `${n} दिन अनुपस्थित · माता-पिता को फ़ोन?`)), icon: "phone", color: V("warnfg") }
      : r.birthday
        ? { text: tx(p("Birthday today", "आज जन्मदिन")), icon: "cake", color: V("acc") }
        : yesterdayIds.includes(r.id) && s === "P"
          ? { text: tx(p("Absent on the last school day", "पिछले स्कूल दिन अनुपस्थित")), icon: "info", color: V("mut") }
          : null;
    const tone = TONES[(Number(r.rollNo) || serialOf.get(r.id) || i + 1) % 5];
    return (
      <div key={r.id} style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 0 }}>
        <button
          type="button"
          disabled={!editing || !ready}
          onClick={() => tap(r.id)}
          className={`tap tc-akid ${lk.cls}`}
          aria-label={`${r.name}, ${r.rollNo ? tx(p(`roll ${r.rollNo}`, `रोल ${r.rollNo}`)) : tx(p(`number ${num}`, `क्रम ${num}`))}${r.hint ? `, ${tx(r.hint)}` : ""}, ${tx(lk.t)}. ${tx(p("Tap to change.", "बदलने के लिए टैप करें।"))}`}
          aria-pressed={s !== "P"}
          style={{ background: lk.bg, borderColor: lk.bd, opacity: editing && !ready ? 0.6 : 1, animationDelay: `${Math.min(i, 16) * 22}ms` }}
        >
          <span className="num" style={{ flex: "none", minWidth: 22, fontSize: 13, fontWeight: 700, textAlign: "right", color: "var(--mut)" }}>{num}</span>
          <span className="tc-av" style={{ width: 40, height: 40, fontSize: 13, background: tone[0], color: tone[1] }}>{initials(r.name)}</span>
          <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 1 }}>
            <span className="tc-el" style={{ fontSize: 15, fontWeight: 600 }}>{r.name}</span>
            {r.hint ? <span className="tc-el" style={{ fontSize: 12, color: "var(--mut)" }}>{tx(r.hint)}</span> : null}
            <span className="only-d" style={{ fontSize: 12, fontWeight: 600, lineHeight: 1.3, color: s === "P" && hint ? hint.color : lk.fg }}>{s === "P" && hint ? hint.text : tx(lk.t)}</span>
            {hint ? (
              <span className="only-m" style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 12.5, fontWeight: 600, color: hint.color }}>
                <Ic n={hint.icon} size={13} />
                <span className="tc-el">{hint.text}</span>
              </span>
            ) : null}
          </span>
          <span className="tc-st" style={{ background: lk.sbg, color: lk.sfg }}>
            <Ic n={lk.icon} size={17} stroke={s === "H" ? 2 : 2.6} className="tc-pop" />
            <span className="tc-stw">{tx(lk.t)}</span>
          </span>
        </button>
        {editing && s !== "P" ? (
          <button type="button" className="tap chip" aria-pressed={s === "H"} onClick={() => halfDay(r.id)} style={{ alignSelf: "flex-end", height: 40, padding: "0 14px", fontSize: 14, background: s === "H" ? V("warns") : V("card"), color: s === "H" ? V("warnfg") : V("fg") }}>
            <Ic n={s === "H" ? "x" : "calMinus"} size={16} />
            {s === "H" ? tx(p(`${r.name.split(" ")[0]}: absent all day instead`, `${r.name.split(" ")[0]}: पूरे दिन अनुपस्थित करें`)) : tx(p(`${r.name.split(" ")[0]}: half-day instead`, `${r.name.split(" ")[0]}: आधा दिन करें`))}
          </button>
        ) : null}
      </div>
    );
  };

  /* ---------------------------------------------------------- mark view */
  const allYesterday = yesterdayIds.length > 0 && yesterdayIds.every((id) => marks[id] === "absent");
  const parts = [tx(p(`${nP} present`, `${nP} उपस्थित`)), tx(p(`${nA} absent`, `${nA} अनुपस्थित`))].concat(nH ? [tx(p(`${nH} half-day`, `${nH} आधा दिन`))] : []).join(" · ");
  const savedTime = receipt ? timeP(receipt.savedAt) : null;
  const when: Pair = data.alertWhen ?? p("at 10 am", "सुबह 10 बजे");
  const classBadge = (
    <span className="pill" style={{ flex: "none", height: 28, padding: "0 10px", fontSize: 13, fontWeight: 700, background: "var(--card)", color: "var(--fg)", border: "1px solid var(--bd)" }}>
      <Ic n="users" size={14} />
      {cls}
    </span>
  );
  const officeLine = editing === "change" ? tx(p("Until you save again, the office keeps what you saved before.", "दोबारा सेव करने तक ऑफ़िस पहले वाली हाज़िरी रखेगा।")) : tx(p(`Until you save, the office sees ${data.classLabel} as Not marked.`, `सेव करने तक ऑफ़िस को ${clsP.hi} “नहीं लगी” दिखेगी।`));
  const markView = (
    <div style={{ display: "flex", flexDirection: "column", minHeight: "100%" }}>
      <div className="pad stack" style={{ flex: 1, display: "grid", gridTemplateColumns: "minmax(0, 1fr) 300px", gap: 20, alignItems: "start", padding: "20px 28px 24px" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 14, minWidth: 0 }}>
          {restored ? (
            <div className="tc-note tc-in" role="status" style={{ background: "var(--warns)", color: "var(--warnfg)", alignItems: "center", flexWrap: "wrap" }}>
              <Ic n="alert" />
              <span style={{ flex: "1 1 200px", fontWeight: 600 }}>
                {editing === "change"
                  ? tx(p(`You changed ${restored} ${restored === 1 ? "child" : "children"} earlier and did not save it. The office still has the old attendance.`, `आपने पहले ${restored} बच्चों की हाज़िरी बदली थी पर सेव नहीं की। ऑफ़िस के पास अभी पुरानी हाज़िरी है।`))
                  : tx(p(`Your ${restored} earlier ${restored === 1 ? "tap is" : "taps are"} back. Not saved yet.`, `पहले लगाई ${restored} हाज़िरी वापस आ गई है। अभी सेव नहीं हुई।`))}
              </span>
              <span style={{ display: "flex", gap: 8 }}>
                <button type="button" className="tap btn pri" style={{ height: 44 }} onClick={() => setSheet("save")}>{editing === "change" ? tx(p("Save changes", "बदलाव सेव करें")) : tx(p("Save attendance", "हाज़िरी सेव करें"))}</button>
                <button type="button" className="tap btn sec" style={{ height: 44 }} onClick={throwAway}>{tx(p("Throw away", "छोड़ दें"))}</button>
              </span>
            </div>
          ) : null}
          {!isToday ? (
            <div className="tc-note" style={{ background: "var(--infos)", color: "var(--info)" }}>
              <Ic n="calendar" style={{ marginTop: 2 }} />
              <span style={{ fontWeight: 600 }}>{tx(p(`This is the register for ${dayShortP(data.day).en}, not today.`, `यह आज की नहीं, ${dayShortP(data.day).hi} की हाज़िरी है।`))}</span>
            </div>
          ) : null}
          <div className="tc-note tc-in" style={{ background: editing === "change" ? V("warns") : V("accs"), color: editing === "change" ? V("warnfg") : V("accfg"), padding: "14px 16px", alignItems: "center" }}>
            <span className="tc-ib" style={{ width: 42, height: 42, borderRadius: 13, background: "var(--card)" }}><Ic n={editing === "change" ? "edit" : "sun"} size={22} /></span>
            <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
              {classBadge}
              <span className="tc-p" style={{ fontWeight: 700 }} aria-live="polite">
                {editing === "change"
                  ? isToday
                    ? tx(p("You are changing today’s attendance", "आप आज की हाज़िरी बदल रहे हैं"))
                    : tx(p(`You are changing the attendance for ${dayShortP(data.day).en}`, `आप ${dayShortP(data.day).hi} की हाज़िरी बदल रहे हैं`))
                  : nA + nH === 0
                    ? tx(p("Everyone is marked Present.", "सभी बच्चे उपस्थित माने गए हैं।"))
                    : tx(markedLine(nP, nA, nH))}
              </span>
              <span style={{ fontSize: 13, opacity: 0.85 }}>
                {editing === "change"
                  ? tx(p(`The office still sees what you saved${savedTime ? ` at ${savedTime.en}` : ""} until you save again.`, `दोबारा सेव करने तक ऑफ़िस को पहले वाली हाज़िरी दिखेगी।`))
                  : nA + nH === 0
                    ? T(p("Tap only the children who are absent.", "सिर्फ़ अनुपस्थित बच्चों पर टैप करें।"))
                    : T(p("Not saved yet. Tap more children if needed, then save.", "अभी सेव नहीं हुई। ज़रूरत हो तो और बच्चों पर टैप करें, फिर सेव करें।"))}
              </span>
            </span>
          </div>
          <div className="tc-cnt hide-m">
            {([["P", nP, V("ok"), V("okm")], ["A", nA, V("bad"), V("bad")], ["H", nH, V("warn"), V("warnm")]] as const).map(([k, n, c, bd]) => (
              <div key={k} className="card" style={{ padding: "12px 14px", display: "flex", flexDirection: "column", gap: 2, borderColor: n && k !== "P" ? bd : "var(--bd)", overflow: "hidden" }}>
                <span style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, fontWeight: 600 }}>
                  <span style={{ flex: "none", width: 9, height: 9, borderRadius: 5, background: c }} />
                  <span className="tc-el">{tx(LOOK[k].t)}</span>
                </span>
                <span className="num" style={{ color: c }}><span key={n} className="tc-n">{n}</span></span>
                {subOf(LOOK[k].t) ? <span className="tc-s tc-el">{subOf(LOOK[k].t)}</span> : null}
              </div>
            ))}
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10 }}>
            <div className="hs" style={{ display: "flex", alignItems: "center", gap: 8 }}>
              {editing === "mark" && yesterdayIds.length > 0 ? (
                <button
                  type="button"
                  className={`tap chip${allYesterday ? " on" : ""}`}
                  aria-pressed={allYesterday}
                  onClick={() => {
                    const names = andList(yesterdayIds.map((id) => nameOf.get(id) ?? ""));
                    const namesHi = andList(yesterdayIds.map((id) => nameOf.get(id) ?? ""), "और");
                    if (allYesterday) {
                      toast.show({ text: tx(p(`${names} already marked Absent`, `${namesHi} पहले से अनुपस्थित`)) });
                      return;
                    }
                    rememberChanges(ids);
                    const next = copyYesterday(ids, data.yesterday);
                    latest.current = next;
                    setMarks(next);
                    keep(next);
                    toast.show({ text: tx(p(`${names} marked Absent, like the last school day`, `${namesHi} को पिछले स्कूल दिन जैसा अनुपस्थित किया`)) });
                  }}
                  style={{ height: 42, padding: "0 16px", fontSize: 14 }}
                >
                  <Ic n={allYesterday ? "check" : "undo"} size={16} />
                  {tx(p(`Same as ${dayShortP(data.prevDay).en}`, `${dayShortP(data.prevDay).hi} जैसा`))} ({yesterdayIds.length})
                </button>
              ) : null}
              {editing === "change" ? (
                <button type="button" className="tap chip" onClick={throwAway} style={{ height: 42, padding: "0 16px", fontSize: 14 }}>
                  <Ic n="x" size={16} />
                  {tx(p("Cancel change", "बदलाव रद्द"))}
                </button>
              ) : null}
              <button type="button" className="tap chip only-m" onClick={() => setView("history")} style={{ height: 42, padding: "0 16px", fontSize: 14 }}>
                <Ic n="calendar" size={16} />
                {tx(p("Past days", "पिछले दिन"))}
              </button>
            </div>
            <label style={{ flex: "1 1 220px", maxWidth: 420, position: "relative", height: 46, borderRadius: 23, border: "1px solid var(--bds)", background: "var(--card)", display: "flex", alignItems: "center", gap: 8, padding: "0 14px", color: "var(--mut)" }}>
              <Ic n="search" />
              <span className="sr">{tx(p("Find a child by name or number", "नाम या नंबर से बच्चा खोजें"))}</span>
              <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={tx(p("Name or number", "नाम या नंबर"))} style={{ flex: 1, minWidth: 0, height: 40, border: 0, outline: "none", background: "transparent", fontSize: 16, color: "var(--fg)" }} />
            </label>
          </div>
          <span className="tc-s">{T(p("Tap once for Absent, again for Present. For a half day, press “Half-day” on the red card.", "एक बार टैप = अनुपस्थित, फिर टैप = उपस्थित। आधे दिन के लिए लाल कार्ड पर “आधा दिन” दबाएँ।"))}</span>
          <div className="tc-agrid" aria-busy={!ready || undefined}>{shown.map(kidCard)}</div>
          {shown.length === 0 ? (
            <div className="card tc-in" style={{ padding: "32px 20px", display: "flex", flexDirection: "column", alignItems: "center", gap: 10, textAlign: "center" }}>
              <span className="tc-av" style={{ width: 56, height: 56, background: "var(--s2)", color: "var(--mut)" }}><Ic n="search" size={26} /></span>
              <span className="tc-p" style={{ fontWeight: 700 }}>{tx(p(`No child called “${query}”`, `“${query}” नाम का कोई बच्चा नहीं`))}</span>
              <span className="tc-s">{hasRoll ? tx(p("Type a part of the name, or the roll number on the card.", "नाम का कुछ हिस्सा लिखें, या कार्ड पर लिखा रोल नंबर।")) : tx(p("Type a part of the name, or the number on the card.", "नाम का कुछ हिस्सा लिखें, या कार्ड पर लिखा नंबर।"))}</span>
              <button type="button" className="tap btn sec" onClick={() => setQuery("")} style={{ height: 48 }}>{tx(p(`Show all ${data.roll.length}`, `सभी ${data.roll.length} दिखाएँ`))}</button>
            </div>
          ) : null}
        </div>

        <aside className="only-d card" style={{ position: "sticky", top: 84, padding: "18px 20px", display: "flex", flexDirection: "column", gap: 14 }}>
          {/* Not saved yet: grey, and named so — a full green bar read as done (group 24). */}
          <span className="sech">{editing === "change" ? T(p("Your changes · not saved", "आपके बदलाव · सेव नहीं")) : T(p("Before saving", "सेव से पहले"))}</span>
          <div className="tc-stk">
            <span style={{ width: `${((nP / total) * 100).toFixed(1)}%`, background: V("s3") }} />
            <span style={{ width: `${((nA / total) * 100).toFixed(1)}%`, background: V("bad") }} />
            <span style={{ width: `${((nH / total) * 100).toFixed(1)}%`, background: V("warn") }} />
          </div>
          <span className="tc-s">{tx(p("Not saved — this is what you have tapped so far.", "सेव नहीं — अभी तक जो टैप किया वह।"))}</span>
          <span className="num" style={{ fontSize: 26, fontWeight: 700, color: "var(--mut)" }}>
            {Math.round((nP / total) * 100)}%<span className="tc-s" style={{ fontWeight: 500 }}> {tx(p("present", "उपस्थित"))}</span>
          </span>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <span style={{ fontWeight: 600 }}>
              {absentKids.length + halfKids.length
                ? isToday
                  ? tx(p("Away today", "आज अनुपस्थित"))
                  : tx(p(`Away on ${dayShortP(data.day).en}`, `${dayShortP(data.day).hi} को अनुपस्थित`))
                : tx(p("Everyone is here", "सब उपस्थित हैं"))}
            </span>
            {[...absentKids, ...halfKids].map((k) => {
              const a = marks[k.id] === "absent";
              return (
                <span key={k.id} className="tc-in" style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span className="tc-av" style={{ width: 30, height: 30, fontSize: 11, background: a ? V("bads") : V("warns"), color: a ? V("bad") : V("warnfg") }}>{initials(k.name)}</span>
                  <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
                    <span className="tc-el" style={{ fontWeight: 600 }}>{k.name}</span>
                    <span className="tc-s">{[a ? tx(p("Absent", "अनुपस्थित")) : tx(p("Half-day", "आधा दिन")), whoLine(k)].filter(Boolean).join(" · ")}</span>
                  </span>
                </span>
              );
            })}
            {absentKids.length + halfKids.length === 0 ? <span className="tc-s">{tx(p("No one marked absent yet. Tap a child to mark them away.", "अभी कोई अनुपस्थित नहीं। अनुपस्थित बच्चे पर टैप करें।"))}</span> : null}
          </div>
          <div className="tc-note" style={{ background: "var(--s2)", fontSize: 13 }}>
            <Ic n="message" style={{ marginTop: 1, color: "var(--acc)" }} />
            <span>
              {alerts
                ? tx(p(`Parents of absent children get a WhatsApp ${when.en}. You can turn it off before saving.`, `अनुपस्थित बच्चों के माता-पिता को ${when.hi ?? when.en} व्हाट्सऐप जाता है। सेव से पहले बंद कर सकते हैं।`))
                : tx(p("No WhatsApp goes to parents for this unless you turn it on before saving.", "जब तक आप सेव से पहले चालू न करें, अभिभावकों को कोई व्हाट्सऐप नहीं जाएगा।"))}
            </span>
          </div>
          {yesterdayIds.length ? <span className="tc-s">{tx(p(`${dayShortP(data.prevDay).en}: ${andList(yesterdayIds.map((id) => nameOf.get(id) ?? "—"))} ${yesterdayIds.length === 1 ? "was" : "were"} absent.`, `${dayShortP(data.prevDay).hi}: ${andList(yesterdayIds.map((id) => nameOf.get(id) ?? "—"), "और")} अनुपस्थित थे।`))}</span> : null}
        </aside>
      </div>

      <div className="glass tc-abar">
        <span className="only-d" style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
          <span className="tc-p" style={{ fontWeight: 700 }}>{cls} · {D(data.day)} · {parts}</span>
          <span className="tc-s">{officeLine}</span>
        </span>
        <button type="button" className="tap btn pri tc-save" disabled={pending} onClick={() => setSheet("save")}>
          <Ic n="check" size={22} />
          <span style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", lineHeight: 1.2 }}>
            <span>{editing === "change" ? tx(p(`Save changes · ${data.classLabel}`, `बदलाव सेव करें · ${clsP.hi}`)) : tx(p(`Save ${data.classLabel} attendance`, `${clsP.hi} की हाज़िरी सेव करें`))}</span>
            <span className="num" style={{ fontSize: 13, fontWeight: 600, opacity: 0.85 }}>{parts}</span>
          </span>
        </button>
        <span className="tc-s only-m" style={{ textAlign: "center" }}>{officeLine}</span>
      </div>
    </div>
  );

  /* --------------------------------------------------------- saved view */
  // Everything on the saved card comes from what the office has — the save's
  // own answer or the page's data — never from taps on this phone (P1).
  const savedAway = data.roll.filter((r) => sOf(savedMarks[r.id]) !== "P");
  const outboxMarks = useMemo<Record<string, Mark>>(() => {
    if (!outbox) return {};
    try {
      const parsed = JSON.parse(outbox.payload) as { marks?: { studentId: string; status: Mark }[] };
      return Object.fromEntries((parsed.marks ?? []).map((m) => [m.studentId, m.status]));
    } catch {
      return {};
    }
  }, [outbox]);
  const nextKid = [...often.entries()].map(([id, n]) => ({ id, n, name: nameOf.get(id) ?? "" })).filter((k) => k.name)[0] ?? null;
  const closed = data.closed ? closedText(context?.closedWhy ?? null, data.day, isToday) : null;
  const lastOpen = context?.lastOpen ?? null;
  const savedView = (
    <div className="pad stack" style={{ display: "grid", gridTemplateColumns: "minmax(0, 1.2fr) minmax(0, 1fr)", gap: 20, alignItems: "start", padding: "24px 28px 40px", maxWidth: 1180, margin: "0 auto", width: "100%" }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 16, minWidth: 0 }}>
        {outbox ? (
          // Saved on the phone while offline: it reads as done-but-waiting, not
          // as an open register with a live Save button (BUG-08).
          <div className="card" role="status" style={{ padding: "28px 24px 22px", display: "flex", flexDirection: "column", alignItems: "center", gap: 10, textAlign: "center", borderColor: "var(--warnm)" }}>
            <span className="tc-av" style={{ width: 64, height: 64, background: "var(--warns)", color: "var(--warnfg)" }}><Ic n="cloud" size={28} /></span>
            <span className="serif" style={{ fontSize: 26, fontWeight: 600 }}>{tx(p("Kept on this phone", "फ़ोन पर रखी है"))}</span>
            <span className="tc-p" style={{ color: "var(--mut)" }}>
              {outboxDurable
                ? tx(p("It will be sent by itself when the internet is back. You do not need to save again.", "इंटरनेट आते ही अपने आप भेज दी जाएगी। दोबारा सेव करने की ज़रूरत नहीं।"))
                : tx(p("Keep this page open — it is sent when the internet is back.", "यह पेज खुला रखें — इंटरनेट आते ही भेजी जाएगी।"))}
            </span>
            <div style={{ width: "100%", marginTop: 6 }}>{tiles(28, Object.keys(outboxMarks).length ? outboxMarks : marks)}</div>
            {online ? <button type="button" className="tap btn pri tc-abb" disabled={pending} onClick={() => deliver(outbox, true)}><Ic n="cloud" />{tx(p("Send now", "अभी भेजें"))}</button> : null}
          </div>
        ) : recorded ? (
          <div className="card" style={{ padding: "28px 24px 22px", display: "flex", flexDirection: "column", alignItems: "center", gap: 10, textAlign: "center" }}>
            <DrawnTick size={104} />
            <span className="serif tc-agr" style={{ fontSize: 30, fontWeight: 600, lineHeight: 1.15 }}>
              {receipt && receipt.revision > 1
                ? tx(p(`Changed at ${savedTime?.en ?? "—"}.`, `${savedTime?.hi ?? "—"} बजे बदली गई।`))
                : tx(p(`Saved at ${savedTime?.en ?? "—"}.`, `${savedTime?.hi ?? "—"} बजे सेव हुई।`))}
            </span>
            <span className="tc-p" style={{ color: "var(--mut)" }}>
              {tx(p(`${data.classLabel} · ${dayShortP(data.day).en}. The office can see it now.`, `${clsP.hi} · ${dayShortP(data.day).hi}। कार्यालय अब इसे देख सकता है।`))}
            </span>
            <div style={{ width: "100%", marginTop: 6 }}>{tiles(28, { ...fresh, ...savedMarks })}</div>
            {savedAway.length ? (
              <span className="tc-s" style={{ textAlign: "left", alignSelf: "stretch" }}>
                {tx(p(`Away: ${andList(savedAway.map((k) => `${k.name}${sOf(savedMarks[k.id]) === "H" ? " (half-day)" : ""}`))}`, `अनुपस्थित: ${andList(savedAway.map((k) => `${k.name}${sOf(savedMarks[k.id]) === "H" ? " (आधा दिन)" : ""}`), "और")}`))}
              </span>
            ) : null}
            <span className="tc-s" style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
              <Ic n="message" size={15} />
              {local?.warning
                ? tx(local.warning)
                : queuedCount
                  ? tx(p(`WhatsApp to ${queuedCount} ${queuedCount === 1 ? "parent" : "parents"} goes ${when.en} · Hindi first`, `${queuedCount} ${queuedCount === 1 ? "अभिभावक" : "अभिभावकों"} को ${when.hi ?? when.en} व्हाट्सऐप · पहले हिंदी`))
                  : countMarks(ids, savedMarks).absent
                    ? isToday
                      ? tx(p("No WhatsApp will go to parents today", "आज अभिभावकों को कोई व्हाट्सऐप नहीं जाएगा"))
                      : tx(p("No WhatsApp will go to parents for this day", "इस दिन के लिए अभिभावकों को कोई व्हाट्सऐप नहीं जाएगा"))
                    : tx(p("No one absent · no messages to parents", "कोई अनुपस्थित नहीं · अभिभावकों को कोई संदेश नहीं"))}
            </span>
            {/* Where to go once it is done (B16): back to the day, not a dead end. One Back, here. */}
            <Link href="/teach" className="tap btn soft" style={{ height: 44, marginTop: 4 }}>
              <Ic n="home" size={18} />
              {tx(p("Back to Today", "आज पर वापस"))}
            </Link>
            {receipt?.actorName && receipt.revision > 1 ? <span className="tc-s">{tx(p(`By ${receipt.actorName} · changed ${receipt.revision - 1} ${receipt.revision === 2 ? "time" : "times"}`, `${receipt.actorName} द्वारा · ${receipt.revision - 1} बार बदली गई`))}</span> : null}
          </div>
        ) : closed ? (
          <div className="card" role="status" style={{ padding: "28px 24px 22px", display: "flex", flexDirection: "column", alignItems: "center", gap: 10, textAlign: "center" }}>
            <span className="tc-av" style={{ width: 64, height: 64, background: "var(--infos)", color: "var(--info)" }}><Ic n="calendar" size={28} /></span>
            <span className="serif" style={{ fontSize: 26, fontWeight: 600 }}>{tx(closed.title)}</span>
            <span className="tc-p" style={{ color: "var(--mut)" }}>{tx(closed.body)}</span>
            {lastOpen ? (
              <Link href={`/teach/attendance?class=${data.classId}&day=${lastOpen.day}`} className={`tap btn ${lastOpen.marked ? "sec" : "pri"} tc-abb`} style={{ width: "100%" }}>
                <Ic n={lastOpen.marked ? "eye" : "calCheck"} />
                {lastOpen.marked
                  ? tx(p(`See ${dayShortP(lastOpen.day).en} (saved)`, `${dayShortP(lastOpen.day).hi} की हाज़िरी देखें (सेव है)`))
                  : tx(p(`Mark ${dayShortP(lastOpen.day).en} (not marked)`, `${dayShortP(lastOpen.day).hi} की हाज़िरी लगाएँ (बाकी)`))}
              </Link>
            ) : null}
            <button type="button" className="tap btn sec tc-abb" style={{ width: "100%" }} onClick={() => setView("history")}><Ic n="calendar" />{tx(p("Past days", "पिछले दिन"))}</button>
          </div>
        ) : (
          <div className="card" style={{ padding: "28px 24px 22px", display: "flex", flexDirection: "column", alignItems: "center", gap: 10, textAlign: "center" }}>
            <span className="tc-av" style={{ width: 64, height: 64, background: "var(--s2)", color: "var(--mut)" }}><Ic n="calCheck" size={28} /></span>
            <span className="serif" style={{ fontSize: 26, fontWeight: 600 }}>{tx(p("Not marked yet", "अभी हाज़िरी नहीं लगी"))}</span>
            <span className="tc-p" style={{ color: "var(--mut)" }}>{tx(p(`Until it is saved, the office sees ${data.classLabel} as Not marked — never as present.`, `सेव होने तक ऑफ़िस को ${clsP.hi} “नहीं लगी” दिखेगी।`))}</span>
          </div>
        )}

        {recorded && mayChangeHere && !outbox ? (
          <div className="card tc-in" style={{ padding: "16px 18px", display: "flex", flexWrap: "wrap", alignItems: "center", gap: 14 }}>
            <span className="tc-ib" style={{ width: 52, height: 52, borderRadius: 16, background: "var(--accs)", color: "var(--accfg)" }}><Ic n="edit" size={24} /></span>
            <span style={{ flex: 1, minWidth: 180, display: "flex", flexDirection: "column" }}>
              <span className="tc-p" style={{ fontWeight: 700 }}>{tx(p("You can still change it", "आप इसे अब भी बदल सकते हैं"))}</span>
              <span className="tc-s">{tx(p("Any time, with a reason. The office sees the change and it stays in the history.", "कभी भी, कारण के साथ। ऑफ़िस बदलाव देखता है और वह पुराने रिकॉर्ड में रहता है।"))}</span>
            </span>
            <button type="button" className="tap btn sec" style={{ height: 48 }} onClick={() => { rememberChanges(ids); const base = { ...fresh, ...savedMarks }; latest.current = base; setMarks(base); setEditing("change"); }}>
              <Ic n="edit" />
              {tx(p("Change attendance", "हाज़िरी बदलें"))}
            </button>
          </div>
        ) : null}
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 16, minWidth: 0 }}>
        {context?.others.length ? (
          <div className="card tc-in" style={{ padding: "16px 18px", display: "flex", flexDirection: "column", gap: 10 }}>
            <span className="sech">{T(p("Your other classes", "आपकी दूसरी कक्षाएँ"))}</span>
            {context.others.map((o) => (
              <Link key={o.classId} href={`/teach/attendance?class=${o.classId}&day=${data.day}`} className="row tap" style={{ display: "flex", alignItems: "center", gap: 10, minHeight: 48 }}>
                <span className="tc-p" style={{ flex: 1, fontWeight: 700 }}>{tx(classLabelP(o.classLabel))}</span>
                <span className="pill" style={{ height: 28, padding: "0 10px", fontSize: 13, fontWeight: 700, background: o.marked ? V("oks") : V("warns"), color: o.marked ? V("ok") : V("warnfg") }}>{o.marked ? tx(p("Saved", "सेव है")) : tx(p("Not marked", "बाकी है"))}</span>
                <Ic n="chevRight" />
              </Link>
            ))}
          </div>
        ) : null}
        {recorded && nextKid ? (
          <div className="card tc-in" style={{ padding: "18px 20px", display: "flex", flexDirection: "column", gap: 12, borderColor: "var(--warnm)", animationDelay: "120ms" }}>
            <span className="sech" style={{ color: "var(--warnfg)" }}>{T(p("Next step", "अगला कदम"))}</span>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <span className="tc-av" style={{ width: 48, height: 48, fontSize: 15, background: "var(--bads)", color: "var(--bad)" }}>{initials(nextKid.name)}</span>
              <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
                <span className="tc-p" style={{ fontWeight: 700 }}>{tx(p(`${nextKid.name}: absent ${nextKid.n} days`, `${nextKid.name}: ${nextKid.n} दिन अनुपस्थित`))}</span>
                <span className="tc-s">
                  {savedMarks[nextKid.id] === "absent"
                    ? isToday
                      ? tx(p("This month — and today again.", "इस महीने — और आज भी।"))
                      : tx(p(`This month — and on ${dayShortP(data.day).en} too.`, `इस महीने — और ${dayShortP(data.day).hi} को भी।`))
                    : tx(p("This month. A short call or note helps.", "इस महीने। एक फ़ोन या नोट मदद करता है।"))}
                </span>
              </span>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 8 }}>
              <Link href={`/teach/class?student=${nextKid.id}`} className="tap btn pri tc-abb"><Ic n="phone" />{tx(p("Call parents", "माता-पिता को फ़ोन"))}</Link>
              <Link href={`/teach/notes?sheet=add&student=${nextKid.id}`} className="tap btn sec tc-abb"><Ic n="edit" />{tx(p("Add note", "नोट लिखें"))}</Link>
            </div>
          </div>
        ) : null}
        {!closed ? <button type="button" className="tap btn sec tc-abb" onClick={() => setView("history")}><Ic n="calendar" />{tx(p("See this month", "इस महीने की हाज़िरी"))}</button> : null}
      </div>
    </div>
  );

  /* ----------------------------------------------------------- history */
  const cells = monthGrid(data.month);
  const byDay = new Map<string, { a: string[]; h: string[]; marked: number }>();
  for (const m of data.monthMarks) {
    const d = byDay.get(m.day) ?? { a: [], h: [], marked: 0 };
    d.marked += 1;
    if (m.status === "absent") d.a.push(m.studentId);
    else if (m.status === "half_day" || m.status === "leave") d.h.push(m.studentId);
    byDay.set(m.day, d);
  }
  const pctOf = (d: { a: string[]; h: string[]; marked: number }) => Math.round(((d.marked - d.a.length - d.h.length) / Math.max(1, d.marked)) * 100);
  const scale = (pc: number): [string, string] => (pc >= 95 ? [V("ok"), V("onsolid")] : pc >= 90 ? [V("okm"), V("ok")] : pc >= 85 ? [V("warnm"), V("warnfg")] : [V("bads"), V("bad")]);
  const marked = [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b));
  const avg = marked.length ? Math.round(marked.reduce((s, [, d]) => s + pctOf(d), 0) / marked.length) : null;
  const closedSet = useMemo(() => new Set(data.closedDays), [data.closedDays]);
  const isClosedDay = (day: string) => closedSet.has(day) || new Date(`${day}T00:00:00Z`).getUTCDay() === 0;
  const holidayName = (day: string): Pair | null => {
    const h = context?.holidays[day];
    if (!h || !(h.en || h.hi)) return null;
    return p(h.en ?? h.hi ?? "", h.hi ?? h.en ?? "");
  };
  // The day the card below the calendar opens on: this register's day when it
  // is a school day in this month; otherwise the last day marked (a holiday
  // asked "Mark now" for a day with no register, smoke run).
  const firstPick =
    data.day.startsWith(data.month) && !isClosedDay(data.day) && data.day <= today
      ? data.day
      : marked.at(-1)?.[0] ?? (lastOpen && lastOpen.day.startsWith(data.month) ? lastOpen.day : `${data.month}-01`);
  const [pickDay, setPickDay] = useState<string>(firstPick);
  const picked = byDay.get(pickDay) ?? null;
  const lead = cells.findIndex((c) => c !== null);
  const prevMonthDays = new Date(Date.UTC(Number(data.month.slice(0, 4)), Number(data.month.slice(5, 7)) - 1, 0)).getUTCDate();
  const trail = (7 - (cells.length % 7)) % 7;
  const monthTitle = tx(monthTitleP(data.month));
  const schoolDays = marked.map(([d]) => d).slice(-6);
  const dayHref = (d: string) => `/teach/attendance?class=${data.classId}&day=${d}`;
  const monthNav = (cls: string) => (
    <span className={cls} style={{ display: "flex", gap: 4 }}>
      <Link className="tap btn ghost" aria-label={tx(p("Previous month", "पिछला महीना"))} href={`${dayHref(data.day)}&view=history&month=${shiftMonth(data.month, -1)}`} style={{ width: 44, height: 44, padding: 0 }}><Ic n="chevLeft" /></Link>
      <Link className="tap btn ghost" aria-label={tx(p("Next month", "अगला महीना"))} href={`${dayHref(data.day)}&view=history&month=${shiftMonth(data.month, 1)}`} style={{ width: 44, height: 44, padding: 0 }}><Ic n="chevRight" /></Link>
    </span>
  );
  const histKids = [...often.entries()].map(([id, n]) => ({ id, n, name: nameOf.get(id) ?? "" })).filter((k) => k.name);
  const owed = (context?.unmarked ?? []).filter((d) => d.startsWith(data.month));
  const owedRuns = dayRuns(owed, new Map(data.closedDays.map((d) => [d, { kind: "holiday" as const }])));
  const owedSet = new Set(owed);
  const runText = (lang: "en" | "hi") => owedRuns.map((r) => (r.from === r.to ? dayShortP(r.from)[lang] : `${dayShortP(r.from)[lang]} – ${dayShortP(r.to)[lang]}`)).join(", ");
  const pickedClosed = !picked && isClosedDay(pickDay);
  const pickedFuture = pickDay > today;
  const history = (
    <div className="pad stack" style={{ display: "grid", gridTemplateColumns: "minmax(0, 1.35fr) minmax(0, 1fr)", gap: 20, alignItems: "start", padding: "22px 28px 40px" }}>
      <div className="card" style={{ minWidth: 0, padding: "18px 20px", display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10 }}>
          <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
            <span className="serif" style={{ fontSize: 24, fontWeight: 600 }}>{monthTitle}</span>
            <span className="tc-s">{tx(p(`${data.classLabel} · ${data.roll.length} children · tap a day to see who was away`, `${clsP.hi} · ${data.roll.length} बच्चे · कौन नहीं आया देखने के लिए दिन दबाएँ`))}</span>
          </span>
          {monthNav("hide-m")}
          {avg !== null ? <span className="pill num" style={{ height: 30, padding: "0 12px", fontSize: 13, background: "var(--accs)", color: "var(--accfg)" }}>{tx(p(`Average ${avg}% · ${marked.length} days marked`, `औसत ${avg}% · ${marked.length} दिन लगी`))}</span> : null}
        </div>
        {owedRuns.length ? (
          <div className="tc-note" role="status" style={{ background: "var(--warns)", color: "var(--warnfg)", alignItems: "center", flexWrap: "wrap" }}>
            <Ic n="alert" />
            <span style={{ flex: "1 1 200px", fontWeight: 600 }}>{tx(p(`Not marked yet: ${runText("en")} (${owed.length} ${owed.length === 1 ? "day" : "days"})`, `अभी बाकी: ${runText("hi")} (${owed.length} दिन)`))}</span>
            <Link href={dayHref(owed[0])} className="tap btn sec" style={{ height: 44 }}>{tx(p(`Mark ${dayShortP(owed[0]).en}`, `${dayShortP(owed[0]).hi} की लगाएँ`))}</Link>
          </div>
        ) : null}
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 12 }}>
          {([["95%+", V("ok"), "0"], ["90–94%", V("okm"), "0"], ["85–89%", V("warnm"), "0"], [tx(p("Below 85%", "85% से कम")), V("bads"), "0"], [tx(p("Holiday", "छुट्टी")), V("s2"), "1px solid var(--bd)"]] as const).map(([l, bg, bd]) => (
            <span key={l} className="tc-s" style={{ display: "flex", alignItems: "center", gap: 6 }}><span style={{ width: 12, height: 12, borderRadius: 4, background: bg, border: bd }} />{l}</span>
          ))}
        </div>
        <div className="tc-cal">
          {WEEK_HEADS.map((d, i) => <span key={i} className="tc-s" style={{ textAlign: "center", fontWeight: 700 }}>{tx(d)}</span>)}
          {Array.from({ length: Math.max(0, lead) }, (_, i) => (
            <span key={`l${i}`} className="tc-day" aria-hidden="true" style={{ opacity: 0.35, background: "var(--card)", animationDelay: `${i * 12}ms` }}>
              <span className="num" style={{ fontSize: 13, fontWeight: 700 }}>{prevMonthDays - lead + i + 1}</span>
              <span className="pill" style={{ padding: "0 5px", fontSize: 11, background: "transparent", color: V("sub") }}>·</span>
            </span>
          ))}
          {cells.filter((c) => c !== null).map((c, i) => {
            const d = byDay.get(c.day);
            const sun = c.weekday === 0;
            const hol = !sun && closedSet.has(c.day);
            const future = c.day > today;
            const isTodayCell = c.day === today;
            const due = owedSet.has(c.day);
            // A day with saved attendance shows it, holiday or not: a red
            // "Holiday" over "70% present" contradicted itself (smoke run).
            const pc = d ? pctOf(d) : null;
            const sc = pc !== null ? scale(pc) : null;
            const name = holidayName(c.day);
            const chip = pc !== null ? `${pc}%` : sun ? tx(p("Sun", "रवि")) : hol ? tx(p("Holiday", "छुट्टी")) : isTodayCell || due ? tx(p("Not yet", "बाकी")) : "·";
            const sel = c.day === pickDay;
            const label = pc !== null ? tx(p(`${pc}% present${hol || sun ? " · marked on a holiday" : ""}`, `${pc}% उपस्थित${hol || sun ? " · छुट्टी के दिन लगी" : ""}`)) : sun ? tx(p("Sunday", "रविवार")) : hol ? tx(name ? p(`Holiday · ${name.en}`, `छुट्टी · ${name.hi}`) : p("Holiday", "छुट्टी")) : future ? tx(p("coming up", "अभी आना है")) : tx(p("not marked", "नहीं लगी"));
            return (
              <button
                key={c.day}
                type="button"
                className="tap tc-day"
                aria-pressed={sel}
                aria-label={`${D(c.day)} · ${label}`}
                onClick={() => {
                  if (!d && (sun || hol)) return toast.show({ text: tx(hol ? (name ? p(`Holiday · ${name.en} · no school`, `छुट्टी · ${name.hi} · स्कूल बंद`) : p("Holiday · no school", "छुट्टी · स्कूल बंद")) : p("Sunday · no school", "रविवार · स्कूल बंद")) });
                  if (future) return toast.show({ text: tx(p("This day has not come yet", "यह दिन अभी नहीं आया")) });
                  setPickDay(c.day);
                }}
                style={{ background: isTodayCell ? V("accs") : (hol || sun) && !d ? V("s2") : V("card"), borderColor: isTodayCell ? V("acc") : due ? V("warnm") : V("bd"), boxShadow: sel ? "inset 0 0 0 2px var(--acc)" : "none", opacity: future && !hol ? 0.7 : 1, animationDelay: `${(i + lead) * 12}ms` }}
              >
                <span className="num" style={{ fontSize: 13, fontWeight: 700, color: isTodayCell ? V("accfg") : V("fg") }}>{c.date}</span>
                <span className="pill num" style={{ padding: "0 5px", fontSize: 11, background: sc ? sc[0] : due ? V("warns") : "transparent", color: sc ? sc[1] : due ? V("warnfg") : V("sub") }}>{chip}</span>
              </button>
            );
          })}
          {Array.from({ length: trail }, (_, i) => (
            <span key={`t${i}`} className="tc-day" aria-hidden="true" style={{ opacity: 0.35, background: "var(--card)" }}>
              <span className="num" style={{ fontSize: 13, fontWeight: 700 }}>{i + 1}</span>
              <span className="pill" style={{ padding: "0 5px", fontSize: 11, background: "transparent", color: V("sub") }}>·</span>
            </span>
          ))}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <Link href={`/teach/register?class=${data.classId}&month=${data.month}`} className="tc-lnk" style={{ flex: 1 }}><Ic n="printer" />{tx(p("Print the monthly register", "मासिक रजिस्टर छापें"))}</Link>
          {monthNav("only-m")}
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 16, minWidth: 0 }}>
        <div className="card tc-in" style={{ padding: "18px 20px", display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
              <span className="serif" style={{ fontSize: 22, fontWeight: 600 }}>{pickDay === today ? tx(p(`Today · ${dayShortP(pickDay).en}`, `आज · ${dayShortP(pickDay).hi}`)) : D(pickDay)}</span>
              <span className="tc-s">{picked ? tx(p(`${picked.marked - picked.a.length - picked.h.length} of ${picked.marked} present${picked.h.length ? ` · ${picked.h.length} half-day` : ""}`, `${picked.marked} में से ${picked.marked - picked.a.length - picked.h.length} उपस्थित${picked.h.length ? ` · ${picked.h.length} आधा दिन` : ""}`)) : tx(p(`${data.classLabel} · ${data.roll.length} children`, `${clsP.hi} · ${data.roll.length} बच्चे`))}</span>
            </span>
            {picked ? <span className="pill num tc-pop" style={{ height: 30, padding: "0 12px", fontSize: 14, background: scale(pctOf(picked))[0], color: scale(pctOf(picked))[1] }}>{pctOf(picked)}%</span> : null}
          </div>
          {picked ? (
            <>
              <div className="tc-stk">
                <span style={{ width: `${(((picked.marked - picked.a.length - picked.h.length) / Math.max(1, picked.marked)) * 100).toFixed(1)}%`, background: V("ok") }} />
                <span style={{ width: `${((picked.a.length / Math.max(1, picked.marked)) * 100).toFixed(1)}%`, background: V("bad") }} />
                <span style={{ width: `${((picked.h.length / Math.max(1, picked.marked)) * 100).toFixed(1)}%`, background: V("warn") }} />
              </div>
              {([[p("Absent", "अनुपस्थित"), picked.a, V("bads"), V("bad")], [p("Half-day", "आधा दिन"), picked.h, V("warns"), V("warnfg")]] as const)
                .filter(([, list]) => list.length)
                .map(([label, list, bg, fg]) => (
                  <div key={label.en} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    <span className="sech">{tx(label)} ({list.length})</span>
                    {list.map((id) => (
                      <span key={id} className="tc-in" style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <span className="tc-av" style={{ width: 34, height: 34, fontSize: 12, background: bg, color: fg }}>{initials(nameOf.get(id) ?? "?")}</span>
                        <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
                          <span style={{ fontWeight: 600 }}>{nameOf.get(id) ?? "—"}</span>
                          {numLabel(id) ? <span className="tc-s">{numLabel(id)}</span> : null}
                        </span>
                      </span>
                    ))}
                  </div>
                ))}
              {!picked.a.length && !picked.h.length ? <span className="tc-note" style={{ background: "var(--oks)", color: "var(--ok)" }}>{tx(p("Everyone came this day.", "इस दिन सब आए।"))}</span> : null}
              {pickDay === data.day && receipt ? <span className="tc-s">{tx(p(`Marked${receipt.actorName ? ` by ${receipt.actorName}` : ""} at ${timeP(receipt.savedAt).en}`, `${timeP(receipt.savedAt).hi} बजे लगी${receipt.actorName ? ` · ${receipt.actorName}` : ""}`))}</span> : null}
              {data.canCorrect ? (
                <Link href={dayHref(pickDay)} className="tap btn sec tc-abb"><Ic n="edit" />{tx(p("Change this day", "यह दिन बदलें"))}</Link>
              ) : null}
            </>
          ) : pickedClosed ? (
            <div className="tc-note" style={{ background: "var(--s2)" }}>
              <Ic n="calendar" style={{ marginTop: 2, color: "var(--mut)" }} />
              <span>{tx(holidayName(pickDay) ? p(`Holiday · ${holidayName(pickDay)?.en}. No register on this day.`, `छुट्टी · ${holidayName(pickDay)?.hi}। इस दिन हाज़िरी नहीं लगती।`) : p("School was closed. No register on this day.", "स्कूल बंद था। इस दिन हाज़िरी नहीं लगती।"))}</span>
            </div>
          ) : pickedFuture ? (
            <div className="tc-note" style={{ background: "var(--s2)" }}>
              <Ic n="info" style={{ marginTop: 2, color: "var(--mut)" }} />
              <span>{tx(p("This day has not come yet.", "यह दिन अभी नहीं आया।"))}</span>
            </div>
          ) : (
            <>
              <div className="tc-note" style={{ background: "var(--s2)" }}>
                <Ic n="info" style={{ marginTop: 2, color: "var(--mut)" }} />
                <span>{tx(p(`Not marked yet. Until you save, the office sees ${data.classLabel} as Not marked — never as present.`, `अभी नहीं लगी। सेव होने तक ऑफ़िस को ${clsP.hi} “नहीं लगी” दिखेगी — उपस्थित कभी नहीं।`))}</span>
              </div>
              {data.canSave || data.canCorrect ? <Link href={dayHref(pickDay)} className="tap btn pri tc-abb"><Ic n="calCheck" />{tx(p(`Mark ${dayShortP(pickDay).en} now`, `${dayShortP(pickDay).hi} की हाज़िरी अभी लगाएँ`))}</Link> : null}
            </>
          )}
        </div>

        <div className="card tc-in" style={{ padding: "18px 20px", display: "flex", flexDirection: "column", gap: 12, animationDelay: "100ms" }}>
          <span style={{ display: "flex", flexDirection: "column" }}>
            <span className="tc-t">{tx(p("Children absent often", "बार-बार अनुपस्थित"))}</span>
            <span className="tc-s">{subOf(p("Children absent often", "बार-बार अनुपस्थित")) ? `${subOf(p("Children absent often", "बार-बार अनुपस्थित"))} · ` : ""}{tx(p("this month", "इस महीने"))}</span>
          </span>
          {histKids.map((k) => (
            <div key={k.id} style={{ display: "flex", flexDirection: "column", gap: 8, paddingTop: 12, borderTop: "1px solid var(--bd)" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <span className="tc-av" style={{ width: 42, height: 42, fontSize: 13, background: "var(--bads)", color: "var(--bad)" }}>{initials(k.name)}</span>
                <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
                  <span className="tc-p" style={{ fontWeight: 700 }}>{k.name}</span>
                  <span className="tc-s">{tx(p(`${k.n} of ${marked.length} days absent this month`, `इस महीने ${marked.length} में से ${k.n} दिन अनुपस्थित`))}</span>
                </span>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 5, paddingLeft: 54 }}>
                {schoolDays.map((d) => {
                  const st = data.monthMarks.find((m) => m.day === d && m.studentId === k.id)?.status;
                  const c = st === "absent" ? V("bad") : st === "half_day" || st === "leave" ? V("warn") : st ? V("ok") : "transparent";
                  return (
                    <span key={d} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 3 }}>
                      <span style={{ width: 22, height: 22, borderRadius: 7, background: c, border: st ? 0 : "1.5px dashed var(--bds)" }} />
                      <span className="num" style={{ fontSize: 10, color: "var(--mut)" }}>{d === today ? tx(p("Today", "आज")) : Number(d.slice(8))}</span>
                    </span>
                  );
                })}
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, paddingLeft: 54 }}>
                <Link href={`/teach/class?student=${k.id}`} className="tap btn soft" style={{ height: 44 }}><Ic n="phone" />{tx(p("Call parents", "माता-पिता को फ़ोन"))}</Link>
                <Link href={`/teach/notes?sheet=add&student=${k.id}`} className="tap btn sec" style={{ height: 44 }}><Ic n="edit" />{tx(p("Add note", "नोट लिखें"))}</Link>
              </div>
            </div>
          ))}
          <span className="tc-s">{histKids.length ? tx(p("Everyone else was absent fewer than 3 days.", "बाकी सब 3 दिन से कम अनुपस्थित रहे।")) : tx(p("Nobody absent 3 days or more this month.", "इस महीने कोई भी 3 या ज़्यादा दिन अनुपस्थित नहीं।"))}</span>
        </div>
      </div>
    </div>
  );

  /* -------------------------------------------------------------- page */
  const screen: "mark" | "saved" | "history" = view === "history" ? "history" : editing && !outbox && data.roll.length ? "mark" : "saved";
  const attendanceWord = tx(p("Attendance", "हाज़िरी"));
  const head =
    screen === "history"
      ? { crumb: `${attendanceWord} · ${cls}`, title: `${tx(monthTitleP(data.month, true))} · ${cls}`, mTitle: `${tx(monthTitleP(data.month, true))} · ${cls}`, mSub: tx(p("Tap a day to see who was away", "कौन नहीं आया देखने के लिए दिन दबाएँ")) }
      : screen === "saved" && recorded
        ? { crumb: `${attendanceWord} · ${cls}`, title: tx(p("Attendance saved", "हाज़िरी सेव हो गई")), mTitle: tx(p("Attendance saved", "हाज़िरी सेव हो गई")), mSub: `${cls} · ${D(data.day)}` }
        : { crumb: T(p("Attendance", "हाज़िरी")), title: `${cls} · ${D(data.day)} · ${attendanceWord}`, mTitle: cls, mSub: `${attendanceWord} · ${D(data.day)} · ${tx(p(`${data.roll.length} children`, `${data.roll.length} बच्चे`))}` };
  const historyBack = (
    <button type="button" className="tap btn ghost tc-x" aria-label={tx(p("Back", "पीछे"))} onClick={() => setView(null)} style={{ color: "var(--fg)" }}>
      <Ic n="chevLeft" size={22} />
    </button>
  );

  const sheetTitle = editing === "change" ? tx(p(`Save the changes to ${data.classLabel}?`, `${clsP.hi} में बदलाव सेव करें?`)) : tx(p(`Save ${data.classLabel} attendance?`, `${clsP.hi} की हाज़िरी सेव करें?`));
  const needReason = editing === "change" && changeReason.length < 3;
  const nothingChanged = editing === "change" && changed.length === 0;
  const saveLabel = pending
    ? showSlow
      ? tx(p("Still saving…", "अभी सेव हो रही है…"))
      : tx(p("Saving…", "सेव हो रही है…"))
    : nothingChanged
      ? tx(p("Nothing changed yet", "अभी कुछ नहीं बदला"))
      : needReason
        ? tx(p("Pick a reason first", "पहले कारण चुनें"))
        : editing === "change"
          ? tx(p("Save changes", "बदलाव सेव करें"))
          : tx(p("Save attendance", "हाज़िरी सेव करें"));
  // The save sheet's one saving line (U01), in the register's own words. It never says saved: a
  // confirmed save closes the sheet onto the saved card. A refusal or a lost answer stays here
  // with what to do next; Try again sends the same taps, reason and WhatsApp choice.
  const retrySave = () => submit(editing === "change" ? "correction" : "save", editing === "change" ? changeReason : null);
  const sheetSave: SaveState = pending
    ? { kind: "saving", slow: showSlow }
    : state && state.status !== "idle" && state.status !== "saved"
      ? {
          kind: "failed",
          message: state.message,
          next: state.status === "error"
            ? p("Your taps are still here. Try again sends this register again; it will not be saved twice.", "आपकी लगाई हाज़िरी यहीं है। फिर कोशिश करने पर यही हाज़िरी दोबारा भेजी जाएगी; दो बार सेव नहीं होगी।")
            : p("Close this and press Reload to see what the office has now.", "इसे बंद करके “फिर खोलें” दबाएँ और देखें कि ऑफ़िस के पास अभी क्या है।"),
        }
      : SAVE_IDLE;
  const absentLabel = isToday ? p("Absent today", "आज अनुपस्थित") : p(`Absent on ${dayShortP(data.day).en}`, `${dayShortP(data.day).hi} को अनुपस्थित`);
  const alertSwitch = absentKids.length ? (
    <>
      <button
        type="button"
        role="switch"
        aria-checked={alerts}
        className="tap tc-opt"
        onClick={(e) => {
          // A key press that lands here while the teacher is typing her note
          // must not decide whether parents get a message (P1, 20 Oct).
          if (e.detail === 0 && Date.now() - typedAt.current < 1500) return;
          setAlertsChoice(!alerts);
          keep(latest.current, !alerts);
        }}
        style={{ background: "var(--s2)" }}
      >
        <span className="tc-ib" style={{ width: 40, height: 40, borderRadius: 12, background: alerts ? "var(--oks)" : "var(--s3)", color: alerts ? "var(--ok)" : "var(--mut)" }}><Ic n="message" /></span>
        <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
          <span className="tc-p" style={{ fontWeight: 600 }}>{tx(p(`Send WhatsApp to their parents ${when.en}`, `उनके माता-पिता को ${when.hi ?? when.en} व्हाट्सऐप`))}</span>
          <span className="tc-s num">
            {alerts
              ? tx(p(`On · ${absentKids.length} ${absentKids.length === 1 ? "parent" : "parents"} · Hindi first. Tap to stop.`, `चालू · ${absentKids.length} अभिभावक · पहले हिंदी। रोकने के लिए दबाएँ।`))
              : editing === "change" && queuedCount > 0
                ? tx(p(`Off · the ${queuedCount} ${queuedCount === 1 ? "message" : "messages"} already waiting will be stopped too`, `बंद · पहले से रखे ${queuedCount} संदेश भी रुक जाएँगे`))
                : tx(p("Off · no message will go to parents. Tap to turn on.", "बंद · अभिभावकों को कोई संदेश नहीं। चालू करने के लिए दबाएँ।"))}
          </span>
        </span>
        <span className={`sw${alerts ? " on" : ""}`}><span /></span>
      </button>
      {alerts && preview ? (
        <>
          <div className="tc-wa">
            <div>
              <span style={{ display: "block" }}>{preview.hi}</span>
              <span style={{ display: "block", marginTop: 6, opacity: 0.8 }}>{preview.en}</span>
              <span className="num" style={{ display: "block", textAlign: "right", fontSize: 11, opacity: 0.6 }}>{tx(when)}</span>
            </div>
          </div>
          <span className="tc-s" style={{ marginTop: -6 }}>{absentKids.length > 1 ? tx(p(`The same message goes to ${absentKids.length - 1} more ${absentKids.length === 2 ? "family" : "families"} with their child’s name.`, `यही संदेश ${absentKids.length - 1} और परिवारों को उनके बच्चे के नाम से।`)) : tx(p("Only this family gets a message.", "सिर्फ़ इस परिवार को संदेश जाएगा।"))}</span>
        </>
      ) : null}
    </>
  ) : null;
  const closedBanner = !online || outbox || (data.reason && !data.canSave && !data.canCorrect) || (state && (state.status === "stale" || state.status === "roster_changed" || state.status === "refused"));
  return (
    <VxPage className="tc">
      <TchTop
        crumb={head.crumb}
        title={head.title}
        actions={
          <>
            {outbox ? <span className="pill" style={{ height: 30, padding: "0 12px", fontSize: 13, background: "var(--warns)", color: "var(--warnfg)" }}><Ic n="cloud" size={14} />{tx(p("Waiting to send", "भेजना बाकी"))}</span> : null}
            <LangSeg />
            {screen !== "history" ? <button type="button" className="tap btn sec" onClick={() => setView("history")}><Ic n="calendar" />{tx(p("Past days", "पिछले दिन"))}</button> : null}
            <button type="button" className="tap btn sec" onClick={() => setSheet("help")}><Ic n="help" />{tx(p("Help", "मदद"))}</button>
          </>
        }
        dLead={screen === "history" ? historyBack : undefined}
        mLead={screen === "history" ? historyBack : undefined}
        mBack={screen === "history" ? undefined : "/teach"}
        mTitle={head.mTitle}
        mSub={head.mSub}
        mAction={
          <>
            {outbox ? <span className="pill" style={{ background: "var(--warns)", color: "var(--warnfg)" }}><Ic n="cloud" size={12} />{tx(p("Waiting to send", "भेजना बाकी"))}</span> : null}
            <LangSeg />
            <HelpIcon onClick={() => setSheet("help")} label={tx(p("Help", "मदद"))} />
          </>
        }
      />
      <main>
        {closedBanner ? (
          <div className="pad" style={{ padding: "16px 28px 0", display: "flex", flexDirection: "column", gap: 10 }}>
            {!online ? (
              <div className="tc-note" role="status" style={{ background: "var(--warns)", color: "var(--warnfg)" }}>
                <Ic n="wifiOff" style={{ marginTop: 2 }} />
                <span style={{ fontWeight: 600 }}>{tx(p("No internet. You can still mark — saving will wait for the connection.", "इंटरनेट नहीं। हाज़िरी लगा सकते हैं — सेव इंटरनेट आने पर होगी।"))}</span>
              </div>
            ) : null}
            {outbox ? (
              <div className="tc-note" role="status" style={{ background: "var(--warns)", color: "var(--warnfg)", alignItems: "center" }}>
                <Ic n="cloud" />
                <span style={{ flex: 1, fontWeight: 600 }}>{outboxDurable ? tx(p("Waiting to send — this register is kept on this phone and will be sent when you are online.", "भेजना बाकी — यह हाज़िरी फ़ोन पर रखी है, इंटरनेट आते ही भेजी जाएगी।")) : tx(p("The save is waiting only on this open page. Keep it open and check again when online.", "सेव अभी सिर्फ़ इस खुले पेज पर रुकी है। इसे खुला रखें और इंटरनेट आने पर फिर देखें।"))}</span>
                {online ? <button type="button" className="tap btn sec" disabled={pending} onClick={() => deliver(outbox, true)}>{tx(p("Send now", "अभी भेजें"))}</button> : null}
              </div>
            ) : null}
            {data.reason && !data.canSave && !data.canCorrect ? (
              <div className="tc-note" style={{ background: "var(--infos)", color: "var(--info)" }}>
                <Ic n="info" style={{ marginTop: 2 }} />
                <span>{tx(data.reason)}</span>
              </div>
            ) : null}
            {state && (state.status === "stale" || state.status === "roster_changed" || state.status === "refused") ? (
              <div className="tc-note" role="alert" style={{ background: "var(--bads)", color: "var(--bad)", alignItems: "center" }}>
                <Ic n="alert" />
                <span style={{ flex: 1, fontWeight: 600 }}>
                  {tx(state.message)}
                  {state.status === "roster_changed" ? ` ${[...state.joined.map((n) => `+${n}`), ...state.left.map((n) => `−${n}`)].join(", ")}` : ""}
                </span>
                <button type="button" className="tap btn sec" onClick={() => router.refresh()}>{tx(p("Reload", "फिर खोलें"))}</button>
              </div>
            ) : null}
          </div>
        ) : null}

        {screen === "history" ? (
          history
        ) : data.roll.length === 0 && !closed ? (
          <div className="pad" style={{ padding: "20px 28px" }}>
            <div className="card" style={{ padding: "32px 20px", display: "flex", flexDirection: "column", alignItems: "center", gap: 10, textAlign: "center" }}>
              <span className="tc-av" style={{ width: 56, height: 56, background: "var(--s2)", color: "var(--mut)" }}><Ic n="users" size={26} /></span>
              <span className="tc-p" style={{ fontWeight: 700 }}>{tx(p("Nobody is on this class's roll for this day", "इस दिन कक्षा में कोई बच्चा नहीं"))}</span>
              <span className="tc-s">{tx(p("If children should be here, ask the office to add them to the class.", "अगर बच्चे होने चाहिए, तो ऑफ़िस से उन्हें कक्षा में जोड़ने को कहें।"))}</span>
            </div>
          </div>
        ) : screen === "mark" ? (
          markView
        ) : (
          savedView
        )}
      </main>

      {/* ------------------------------------------------------ save sheet */}
      <Sheet
        open={sheet === "save"}
        onClose={() => setSheet(null)}
        title={sheetTitle}
        // The saving line takes the day line's place under the title, so the sheet does not move.
        // It is always mounted (empty when idle), so the change to "Saving…" is announced.
        sub={
          <>
            <SaveStatus
              state={sheetSave}
              words={REGISTER_SAVE}
              test={isTestSessionLabel(data.sessionLabel)}
              onRetry={state?.status === "error" && editing && !needReason && !nothingChanged ? retrySave : undefined}
              reserve={false}
            />
            {sheetSave.kind === "idle" ? `${D(data.day)} · ${parts}` : null}
          </>
        }
        footer={
          <>
            <button type="button" className="tap btn sec tc-abb" style={{ flex: 1 }} onClick={() => setSheet(null)}>{tx(p("Check again", "फिर देखें"))}</button>
            <button type="button" className="tap btn pri tc-abb" style={{ flex: 1.6 }} disabled={pending || !editing || needReason || nothingChanged} onClick={() => submit(editing === "change" ? "correction" : "save", editing === "change" ? changeReason : null)}>
              {pending ? <Ic n="refresh" size={18} className="spin" /> : <Ic n="check" size={18} />}
              {saveLabel}
            </button>
          </>
        }
      >
        <div className="tc-sb">
          {tiles(26, marks)}
          {([[absentLabel, absentKids, V("bads"), V("bad")], [p("Half-day", "आधा दिन"), halfKids, V("warns"), V("warnfg")]] as const)
            .filter(([, list]) => list.length)
            .map(([label, list, bg, fg]) => (
              <div key={label.en} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <span className="sech">{T(label)} ({list.length})</span>
                {list.map((k) => (
                  <span key={k.id} className="tc-in" style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <span className="tc-av" style={{ width: 38, height: 38, fontSize: 12, background: bg, color: fg }}>{initials(k.name)}</span>
                    <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
                      <span className="tc-p" style={{ fontWeight: 600 }}>{k.name}</span>
                      <span className="tc-s">{whoLine(k)}{data.yesterday[k.id] === "absent" && marks[k.id] === "absent" ? ` · ${tx(p("absent on the last school day too", "पिछले स्कूल दिन भी अनुपस्थित"))}` : ""}</span>
                    </span>
                  </span>
                ))}
              </div>
            ))}
          {!absentKids.length && !halfKids.length ? (
            <div className="tc-note" style={{ background: "var(--oks)", color: "var(--ok)" }}>
              <Ic n="checkCircle" />
              <span style={{ fontWeight: 600 }}>{isToday ? tx(p("Everyone is here today. No messages will go to parents.", "आज सब उपस्थित हैं। अभिभावकों को कोई संदेश नहीं जाएगा।")) : tx(p(`Everyone was here on ${dayShortP(data.day).en}. No messages will go to parents.`, `${dayShortP(data.day).hi} को सब उपस्थित थे। अभिभावकों को कोई संदेश नहीं जाएगा।`))}</span>
            </div>
          ) : null}
          {editing === "change" ? (
            <>
              {/* What changes and why come before the WhatsApp switch, so the first thing to touch is the reason. */}
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <span className="sech">{T(p("What changes", "क्या बदल रहा है"))}</span>
                {changed.length ? (
                  changed.map((r) => (
                    <span key={r.id} className="tc-p">
                      <b>{r.name}</b>: {tx(LOOK[sOf(savedMarks[r.id])].t)} → {tx(LOOK[sOf(marks[r.id])].t)}
                    </span>
                  ))
                ) : (
                  <span className="tc-s">{tx(p("Nothing is changed yet. Tap a child first.", "अभी कुछ नहीं बदला। पहले बच्चे पर टैप करें।"))}</span>
                )}
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <span className="sech" style={{ color: needReason && changed.length ? "var(--warnfg)" : undefined }}>{T(p("Why are you changing it? Pick one", "कारण चुनें"))}</span>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                  {WHY.map((w) => (
                    <button key={w.en} type="button" className={`tap chip${why === w.en ? " on" : ""}`} aria-pressed={why === w.en} onClick={() => setWhy(w.en)} style={{ height: 44, padding: "0 16px", fontSize: 14, borderColor: needReason && changed.length ? "var(--warnm)" : undefined }}>{tx(w)}</button>
                  ))}
                </div>
              </div>
              <label className="field">
                <span>{tx(p("Note (optional)", "नोट (अगर लिखना हो)"))}</span>
                <Textarea
                  rows={2}
                  maxLength={150}
                  value={whyNote}
                  onKeyDown={() => {
                    typedAt.current = Date.now();
                  }}
                  onChange={(e) => setWhyNote(e.target.value)}
                  placeholder={tx(p("For example: came at 9:10 with her father", "जैसे: पिता के साथ 9:10 बजे आई"))}
                  style={{ minHeight: 64 }}
                />
              </label>
              {alertSwitch}
              <span className="tc-s">{tx(p(`Saving again replaces what you saved${savedTime ? ` at ${savedTime.en}` : ""}. The office is told it was changed.`, "दोबारा सेव करने से पहले वाली हाज़िरी बदल जाएगी। ऑफ़िस को बताया जाएगा।"))}</span>
            </>
          ) : (
            <>
              {alertSwitch}
              <span className="tc-s">{tx(p("After saving you can still change it whenever needed.", "सेव करने के बाद भी ज़रूरत हो तो कभी भी बदल सकते हैं।"))}</span>
            </>
          )}
        </div>
      </Sheet>

      <HelpSheet open={sheet === "help"} onClose={() => setSheet(null)} title={p("How to mark attendance", "हाज़िरी कैसे लगाएँ")} sub={p("3 easy steps", "3 आसान कदम")} steps={HELP} phone={officePhone} />
    </VxPage>
  );
}
