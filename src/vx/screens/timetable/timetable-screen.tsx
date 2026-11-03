"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, useTransition, type CSSProperties, type ReactNode } from "react";

import { renderNotice } from "@/modules/staff-notices/domain/notices";
import { periodNumber } from "@/modules/timetable/domain/periods";
import {
  coverAction,
  checkCoverAction,
  decideLeaveAction,
  lateCoverAction,
  discardChangeAction,
  publishChangesAction,
  requestLeaveAction,
  saveChangeAction,
  type CoverInput,
  type CoverActionResult,
  type TimetableResult,
} from "@/app/(app)/timetable/vx-actions";
import { clock, initials, rupees, schoolToday } from "@/vx/format";
import { useVx } from "@/vx/i18n";
import { Ic, type IconName } from "@/vx/icons";
import { p, type Pair } from "@/vx/text";
import { BackLink } from "@/vx/ui/back-link";
import { Chip, ChipRow, Field, Input, Seg, Select, Switch, Textarea } from "@/vx/ui/controls";
import { HelpButton, Sheet, useToast } from "@/vx/ui/overlays";
import { Banner, VxPage } from "@/vx/ui/page";
import { Btn, Card, EmptyState, Pill } from "@/vx/ui/primitives";

import type { CoverDutyView, LeaveView, TimetableData } from "./data";
import { browserCoverStorage, clearCoverRecord, coverRecoveryKey, decodeCoverRecord, notifyCoverRecovery, persistCoverRecord, readCoverSnapshot, subscribeCoverRecovery, takeAutoCheck, type CoverScope } from './cover-recovery';
import {
  addDay,
  affectedTeachers,
  applyChanges,
  awaySpan,
  bellTime,
  BREAK_AFTER,
  cellKey,
  changeNotice,
  classGrid,
  clashFor,
  dateShort,
  dateSpan,
  dayRange,
  dayShort,
  FAMILY_LABELS,
  FAMILY_TONES,
  freeAt,
  LEAVE_PROBLEMS,
  leaveProblems,
  LEGEND_FAMILIES,
  periodAt,
  coverRing,
  sortLeaveByUrgency,
  periodsNeedingCover,
  PERIODS,
  schoolDays,
  spanPeriods,
  subjectFamily,
  teacherGrid,
  teacherLoad,
  teachersOf,
  WEEK,
  WEEK_SHORT,
  WEEK_SHORT_HI,
  weekdayOf,
  type LeaveSpan,
  type PendingChange,
  type Slot,
  type Weekday,
} from "./domain/timetable";

/*
 * Timetable & substitutions, drawn as the design's `Timetable` module: the
 * class and teacher weeks, today's cover, teacher leave, and Publish changes.
 * Pending edits wait in `vppsone.timetable_changes` until Publish (UI-44); the
 * cover command and its recovery record are unchanged by the drawing.
 */

export type TimetableView = "class" | "teacher" | "subs" | "leave";
export type TimetableState = {
  view: TimetableView;
  classId: string | null;
  teacherId: string | null;
  cell: { day: Weekday; period: number } | null;
  pick: string | null;
  duty: string | null;
  /** `publish` opens the Publish changes screen; `leave` the Add leave sheet. */
  sheet: "publish" | "leave" | null;
};

const uuid = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : "10000000-1000-4000-8000-100000000000".replace(/[018]/g, (c) => (Number(c) ^ (Math.random() * 16) >> (Number(c) / 4)).toString(16));

function timetableHref(s: Partial<TimetableState>, day: string | undefined): string {
  const qs = new URLSearchParams();
  if (day) qs.set("day", day);
  if (s.view && s.view !== "class") qs.set("view", s.view);
  if (s.classId) qs.set("class", s.classId);
  if (s.teacherId) qs.set("teacher", s.teacherId);
  if (s.cell) qs.set("cell", `${s.cell.day}-${periodNumber(s.cell.period)}`);
  if (s.pick) qs.set("pick", s.pick);
  if (s.duty) qs.set("duty", s.duty);
  if (s.sheet) qs.set("sheet", s.sheet);
  return `/timetable${qs.size ? `?${qs}` : ""}`;
}

/* ------------------------------------------------------------- the look */

const V = (token: string) => `var(--${token})`;
/** A class in a narrow week cell: "11 Arts", not "Class 11 ..." with the stream cut off (smoke run, 20 Oct). */
const cellClass = (label: string) => label.replace(/^class\s+/i, "");
/** A subject's cell: its family colour at 15% over the card (the design's `tintBg`). */
const tint = (code: string) => `color-mix(in srgb, ${V(FAMILY_TONES[subjectFamily(code)])} 15%, var(--card))`;
const bar = (code: string) => V(FAMILY_TONES[subjectFamily(code)]);
const NOW_DOT: CSSProperties = { flex: "none", width: 8, height: 8, borderRadius: 4, background: "var(--acc)", animation: "xPulse 1.8s ease infinite" };
const rise = (i: number): CSSProperties => ({ animation: `xIn .3s var(--ease) ${Math.min(i, 5) * 0.04}s both` });
const MUTED: CSSProperties = { fontSize: 12, color: "var(--mut)" };

/** The design's avatar letters: "Mr. Meena" → "Me", "Asha Purohit" → "AP". */
function ini(name: string): string {
  const words = name.replace(/^(mr|mrs|ms|dr|shri|smt)\.?\s+/i, "").split(/\s+/).filter(Boolean);
  return words.length === 1 ? words[0].slice(0, 2) : initials(name);
}

/** The design's avatar: a 34px circle in one of five token tones, picked by the name. */
const TONES: [string, string][] = [["accs", "accfg"], ["infos", "info"], ["oks", "ok"], ["warns", "warnfg"], ["s3", "fg"]];
function toneOf(name: string): [string, string] {
  let h = 2166136261;
  for (let i = 0; i < name.length; i++) { h ^= name.charCodeAt(i); h = Math.imul(h, 16777619); }
  h ^= h >>> 15; h = Math.imul(h, 2246822507); h ^= h >>> 13;
  return TONES[Math.floor(((h >>> 0) / 4294967296) * TONES.length)];
}
function Ava({ name, size = 34, style }: { name: string; size?: number; style?: CSSProperties }) {
  const [bg, fg] = toneOf(name);
  return (
    <span aria-hidden="true" style={{ flex: "none", width: size, height: size, borderRadius: size / 2, display: "flex", alignItems: "center", justifyContent: "center", fontSize: size >= 30 ? 12 : 9, fontWeight: 700, background: V(bg), color: V(fg), ...style }}>
      {ini(name)}
    </span>
  );
}

function Dot({ color, style }: { color: string; style?: CSSProperties }) {
  return <span aria-hidden="true" style={{ flex: "none", width: 8, height: 8, borderRadius: 4, background: color, ...style }} />;
}

function RadioDot({ on }: { on: boolean }) {
  return (
    <span aria-hidden="true" style={{ flex: "none", width: 20, height: 20, borderRadius: 10, border: `2px solid ${on ? "var(--acc)" : "var(--bds)"}`, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <span style={{ width: 10, height: 10, borderRadius: 5, background: "var(--acc)", transform: `scale(${on ? 1 : 0})`, transition: "transform .25s var(--spring)" }} />
    </span>
  );
}

/**
 * The design's 76px ring (viewBox 100, r 42, stroke 11) with a number in the
 * middle. Nothing to count is an empty grey ring, never a full one: "0/0"
 * drawn as a green circle read as success while three periods had no teacher
 * (admin run, 20 Oct).
 */
function RingNum({ value, max, tone, big, bigSize = 20, small }: { value: number; max: number; tone: string; big: ReactNode; bigSize?: number; small: ReactNode }) {
  const frac = max > 0 ? Math.min(1, Math.max(0, value / max)) : 0;
  const len = frac > 0 ? Math.max(0.5, 263.9 * frac).toFixed(1) : "0";
  return (
    <span style={{ position: "relative", flex: "none", width: 76, height: 76 }}>
      <svg width={76} height={76} viewBox="0 0 100 100" aria-hidden="true">
        <circle cx={50} cy={50} r={42} fill="none" stroke="var(--s3)" strokeWidth={11} />
        <circle cx={50} cy={50} r={42} fill="none" stroke={tone} strokeWidth={11} strokeLinecap="round" strokeDasharray={`${len} 263.9`} style={{ transform: "rotate(-90deg)", transformOrigin: "50% 50%", ["--len" as string]: len, animation: "xDraw .9s var(--ease) both" }} />
      </svg>
      <span style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
        <b className="num" style={{ fontSize: bigSize, lineHeight: 1 }}>{big}</b>
        <span style={{ fontSize: 11, color: "var(--mut)" }}>{small}</span>
      </span>
    </span>
  );
}

/** A coloured note across the page that leads somewhere (the design's `.xno` button). */
function Note({ tone, icon, children, cta, href }: { tone: "warn" | "info"; icon: IconName; children: ReactNode; cta?: string; href?: string }) {
  const [bg, fg] = tone === "warn" ? ["var(--warns)", "var(--warnfg)"] : ["var(--infos)", "var(--info)"];
  const st: CSSProperties = { display: "flex", alignItems: "center", gap: 10, width: "100%", padding: "12px 14px", borderRadius: 14, fontSize: 13, lineHeight: 1.5, background: bg, color: fg, textAlign: "left", animation: "xIn .3s var(--ease) both" };
  const inner = (
    <>
      <Ic n={icon} />
      <span style={{ flex: 1, minWidth: 0 }}>{children}</span>
      {cta && href ? (
        <b style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 13 }}>
          {cta}
          <Ic n="chevRight" size={16} />
        </b>
      ) : null}
    </>
  );
  return href ? <Link href={href} className="tap" style={st}>{inner}</Link> : <div role="status" style={st}>{inner}</div>;
}

/** The WhatsApp chat the design draws: who it goes to, then the bubble, Hindi first. */
function WaPreview({ to, hi, en, time }: { to: string; hi: string; en: string; time?: string }) {
  return (
    <div style={{ padding: 12, borderRadius: 16, background: "var(--wabg)", display: "flex", flexDirection: "column", gap: 6 }}>
      <span style={{ fontSize: 11, fontWeight: 700, color: "var(--wafg)", opacity: 0.7 }}>{to}</span>
      <div style={{ alignSelf: "flex-start", maxWidth: "94%", padding: "9px 12px 5px", borderRadius: "4px 14px 14px 14px", background: "var(--wab)", color: "var(--wafg)", lineHeight: 1.5, whiteSpace: "pre-line", boxShadow: "0 1px 1px rgba(0,0,0,.08)", animation: "xPopIn .4s var(--spring) both", overflowWrap: "anywhere" }}>
        {hi}
        <div style={{ marginTop: 6, opacity: 0.78 }}>{en}</div>
        {time ? <div style={{ fontSize: 11, textAlign: "right", opacity: 0.6 }}>{time}</div> : null}
      </div>
    </div>
  );
}

/* --------------------------------------------------------------- the clock */

const subscribeClock = (fn: () => void) => {
  const t = window.setInterval(fn, 30_000);
  return () => window.clearInterval(t);
};
const readClock = () => new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date());

/** School-clock "HH:MM" (null while rendering on the server), or the one the data pins. */
function useSchoolClock(pinned: string | null | undefined): string | null {
  const live = useSyncExternalStore(subscribeClock, readClock, () => null);
  return pinned ?? live;
}

/* ------------------------------------------------------------------ screen */

export function TimetableScreen({ data, state, previewing }: { data: TimetableData; state: TimetableState; previewing: boolean }) {
  const { tx } = useVx();
  const say = (en: string, hi: string) => tx({ en, hi });
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();
  const coverInFlight = useRef(false);
  const coverDay = data.cover?.day;
  const scope = useMemo<CoverScope | null>(() => data.sessionLabel && coverDay ? { owner: data.me.id, session: data.sessionLabel, day: coverDay } : null, [data.me.id, data.sessionLabel, coverDay]);
  const snapshot = useSyncExternalStore(subscribeCoverRecovery, () => readCoverSnapshot(scope), () => 'loading');
  const recovery = useMemo(() => scope ? decodeCoverRecord(snapshot, scope) : null, [snapshot, scope]);
  const storageReady = Boolean(scope && snapshot !== 'loading' && snapshot !== 'unavailable' && snapshot !== 'unsupported' && (!snapshot || recovery));
  const scopeKey = scope ? coverRecoveryKey(scope) : '';
  const currentScope = useRef(scopeKey);
  const currentMayCover = useRef(!previewing && data.me.mayCover);
  useLayoutEffect(() => { currentScope.current = scopeKey; currentMayCover.current = !previewing && data.me.mayCover; }, [scopeKey, previewing, data.me.mayCover]);
  const stillOwnsCover = (commandScope: CoverScope) => currentScope.current === coverRecoveryKey(commandScope) && currentMayCover.current;
  const [checkedMissing, setCheckedMissing] = useState<string | null>(null);
  const [storageProblem, setStorageProblem] = useState<string | null>(null);
  // Which unresolved commands this page checks by itself (see the effect below):
  // one already waiting when a day is first opened here, or one this tab sent
  // and lost. Never one another tab is still sending.
  const autoEligible = useRef(new Set<string>());
  const autoChecked = useRef(new Set<string>());
  const seenScopes = useRef(new Set<string>());
  const coverBlocked = previewing || pending || !storageReady || Boolean(recovery);
  const href = (next: Partial<TimetableState>) => timetableHref(next, data.cover?.day);
  const hhmm = useSchoolClock(data.clock);

  // Pending periods are an editor preview; teachers follow the published version.
  const planned = useMemo(() => data.me.mayEdit ? applyChanges(data.slots, data.changes) : data.slots, [data.me.mayEdit, data.slots, data.changes]);
  const subjectPair = useMemo(() => {
    const m = new Map(data.subjects.map((s) => [s.code, s]));
    return (code: string): Pair => {
      const s = m.get(code);
      return s ? { en: s.name, hi: s.nameHi ?? undefined } : { en: code };
    };
  }, [data.subjects]);
  const subjectName = (code: string) => tx(subjectPair(code));
  const teacherName = useMemo(() => new Map(data.teachers.map((t) => [t.id, t.name])), [data.teachers]);
  const todayName = weekdayOf(data.today);
  const nowP = todayName ? periodAt(data.bells, hhmm) : -1;
  const dayName = (d: Weekday) => tx({ en: WEEK_SHORT[d], hi: WEEK_SHORT_HI[d] });

  const go = (next: Partial<TimetableState>, replace = false) => {
    const url = href({ ...next });
    if (replace) router.replace(url, { scroll: false });
    else router.push(url, { scroll: false });
  };
  const done = (result: TimetableResult, after?: () => void) => {
    toast.show({ text: tx(result.message), tone: result.ok ? "ok" : "bad" });
    if (result.ok) {
      after?.();
      router.refresh();
    }
  };
  const uncertain = () => toast.show({ text: tx(p('The save result is uncertain. Check the saved result before trying another change.', 'बदलाव का परिणाम अनिश्चित है। दूसरा बदलाव करने से पहले जाँचें।')), tone: 'bad' });
  const finishCover = async (result: CoverActionResult, command: CoverInput, commandScope: CoverScope, after?: () => void) => {
    if (result.status === 'saved' || result.status === 'refused') {
      const storage = browserCoverStorage();
      const cleared = Boolean(storage && await clearCoverRecord(storage, commandScope, command.commandId, () => stillOwnsCover(commandScope)));
      notifyCoverRecovery();
      if (!stillOwnsCover(commandScope)) return;
      if (!cleared) toast.show({ text: tx(p('The result was received, but its recovery record could not be cleared. Check it again before another save.', 'परिणाम मिला, लेकिन स्थानीय रिकॉर्ड नहीं मिटा। अगले बदलाव से पहले फिर जाँचें।')), tone: 'bad' });
      else { setStorageProblem(null); done(result, currentScope.current === coverRecoveryKey(commandScope) ? after : undefined); }
      if (!cleared || !result.ok) router.refresh();
    } else if (result.status === 'not_found') {
      setCheckedMissing(command.commandId);
      toast.show({ text: tx(result.message), tone: 'bad' });
    } else {
      // Uncertain again: whatever the last check said no longer holds.
      autoEligible.current.add(command.commandId);
      setCheckedMissing(null);
      toast.show({ text: tx(result.message), tone: 'bad' });
    }
  };
  const cover = (input: Omit<CoverInput, 'commandId' | 'sessionLabel' | 'day' | 'dayRevision'>, after?: () => void) => {
    if (previewing || !data.cover?.canCommand || !data.me.mayCover || !scope || coverBlocked || coverInFlight.current) return;
    const command: CoverInput = { ...input, commandId: uuid(), sessionLabel: scope.session, day: scope.day, dayRevision: data.cover.dayRevision };
    coverInFlight.current = true;
    start(async () => {
      try {
        const storage = browserCoverStorage();
        if (!storage || !await persistCoverRecord(storage, scope, command)) {
          setStorageProblem(coverRecoveryKey(scope));
          toast.show({ text: tx(p('Cannot preserve this save on the phone. Nothing was submitted. Restore browser storage and try again.', 'फ़ोन पर बदलाव सुरक्षित नहीं हो सका। कुछ जमा नहीं हुआ। ब्राउज़र स्टोरेज ठीक करके फिर आज़माएँ।')), tone: 'bad' });
          notifyCoverRecovery();
          return;
        }
        setStorageProblem(null);
        notifyCoverRecovery();
        // A lock may have waited while the viewer changed role, session or day.
        // Retain the original identity, but never dispatch in that new context.
        if (!stillOwnsCover(scope)) return;
        const result = await coverAction(command);
        if (!stillOwnsCover(scope)) return;
        await finishCover(result, command, scope, after);
      }
      catch { autoEligible.current.add(command.commandId); uncertain(); }
      finally { coverInFlight.current = false; }
    });
  };
  const recoverCover = (retry: boolean) => {
    if (previewing || !scope || !recovery || !data.me.mayCover || pending || coverInFlight.current) return;
    const command = recovery.payload;
    coverInFlight.current = true;
    start(async () => {
      try {
        let result = await checkCoverAction(command);
        if (!stillOwnsCover(scope)) return;
        if (retry && result.status === 'not_found') result = await coverAction(command);
        if (!stillOwnsCover(scope)) return;
        await finishCover(result, command, scope);
      } catch { setCheckedMissing(null); uncertain(); }
      finally { coverInFlight.current = false; }
    });
  };
  // An unresolved save is checked by itself — on load, and as soon as a slow
  // save gives up — instead of waiting for somebody to find "Check saved
  // result". A save that landed clears and unblocks the screen; one that did
  // not says so plainly and offers to send the same command again, which the
  // server answers once (D-212). Once per command per page: a check that
  // cannot reach the server leaves the buttons for a person.
  const autoCommand = recovery?.payload.commandId ?? null;
  useEffect(() => {
    if (snapshot === "loading" || !scopeKey) return;
    if (!seenScopes.current.has(scopeKey)) {
      seenScopes.current.add(scopeKey);
      if (autoCommand) autoEligible.current.add(autoCommand);
    }
    if (!autoCommand || !autoEligible.current.has(autoCommand)) return;
    if (takeAutoCheck(autoChecked.current, autoCommand, pending || coverInFlight.current || previewing || !data.me.mayCover)) recoverCover(false);
  });

  const classId = state.classId ?? data.classes[0]?.id ?? null;
  const teacherId = state.teacherId ?? data.teachers[0]?.id ?? null;
  const duties = data.cover?.duties ?? [];
  const coverIsToday = data.cover?.day === data.today;
  // Cover is drawn on the weekday of the day it is for — Friday's cover on Friday's column — as long as that day is in the week shown (B22).
  const coverWeekday = data.cover && data.week.includes(data.cover.day) ? weekdayOf(data.cover.day) : null;
  const coverWhen: Pair = coverIsToday || !data.cover ? { en: "Today", hi: "आज" } : { en: dayShort(data.cover.day), hi: dayShort(data.cover.day) };
  const coveredN = duties.filter((d) => d.status === "assigned").length;
  const publishing = state.sheet === "publish" && data.me.mayEdit;
  const pendingN = data.me.mayEdit ? data.changes.length : 0;
  const publishHref = href({ view: state.view, classId: state.classId, teacherId: state.teacherId, sheet: "publish" });
  const classHref = href({ view: "class", classId: state.classId });
  const session = (data.sessionLabel ?? "—").replace(/^(\d{4})-(\d{2})$/, "$1–$2");
  const todayLine = dayShort(data.today);

  /* ----------------------------------------------------------- top bar */

  const publishAct = pendingN ? (
    <Btn variant="pri" icon="upload" href={publishHref}>{say(`Publish changes (${pendingN})`, `बदलाव प्रकाशित करें (${pendingN})`)}</Btn>
  ) : null;
  const help = (
    <HelpButton
      title={say("Timetable", "समय सारणी")}
      steps={[
        { icon: "calendar", title: say("The week", "सप्ताह"), body: say("Pick a class or a teacher to see their week. Today's row is highlighted.", "कक्षा या शिक्षक चुनें, उनका सप्ताह दिखेगा। आज की पंक्ति अलग दिखती है।") },
        { icon: "edit", title: say("Change a period", "पीरियड बदलें"), body: say("Tap a period to change it. Changes wait until you publish; teachers still see the old timetable.", "पीरियड पर टैप करके बदलें। बदलाव प्रकाशित करने तक रुके रहते हैं; शिक्षक पुरानी समय सारणी देखते हैं।") },
        { icon: "swap", title: say("Cover", "व्यवस्था"), body: say("Cover shows who is away today and who covers. Assigning a teacher queues their WhatsApp notice.", "व्यवस्था में आज कौन अनुपस्थित है और कौन लेगा, दिखता है। शिक्षक देने पर उनका WhatsApp संदेश कतार में जाता है।") },
      ]}
    />
  );
  const mAct = (label: string, icon: IconName, to: string) => (
    <Link href={to} className="tap btn soft" style={{ height: 40, padding: "0 12px", fontSize: 13 }}>
      <Ic n={icon} size={16} />
      {label}
    </Link>
  );

  const waitingN = data.leave.filter((l) => l.status === "asked").length;
  const approvedN = data.leave.filter((l) => l.status === "approved" && l.to >= data.today).length;
  const classNow = data.classes.find((c) => c.id === classId);
  const loadNow = teacherId ? teacherLoad(planned, teacherId) : null;
  const top = publishing
    ? {
        crumb: say("Timetable · changes", "समय सारणी · बदलाव"),
        title: say("Publish changes", "बदलाव प्रकाशित करें"),
        back: href({ view: state.view, classId: state.classId, teacherId: state.teacherId }),
        actions: help,
        mSub: say(`${pendingN} waiting · ${data.version ? `${data.version.label} is live` : "no live version"}`, `${pendingN} बाकी · ${data.version ? `${data.version.label} लागू है` : "कोई लागू संस्करण नहीं"}`),
        mAction: undefined,
      }
    : state.view === "teacher"
      ? {
          crumb: say("Timetable", "समय सारणी"),
          title: say("Teacher timetable", "शिक्षक समय सारणी"),
          back: classHref,
          actions: <>{publishAct}{help}</>,
          mSub: teacherId && loadNow ? say(`${teacherName.get(teacherId) ?? ""} · ${loadNow.total} periods a week`, `${teacherName.get(teacherId) ?? ""} · सप्ताह में ${loadNow.total} पीरियड`) : undefined,
          mAction: undefined,
        }
      : state.view === "subs"
        ? {
            crumb: coverDay && !coverIsToday ? say(`Timetable · ${dayShort(coverDay)}`, `समय सारणी · ${dayShort(coverDay)}`) : say(`Timetable · today ${todayLine}`, `समय सारणी · आज ${todayLine}`),
            title: say("Cover", "व्यवस्था"),
            back: classHref,
            actions: <>{data.me.mayViewCover ? <Btn variant="sec" icon="calendar" href={href({ view: "leave" })}>{say("Teacher leave", "शिक्षक छुट्टी")}</Btn> : null}{help}</>,
            mSub: say(`${coveredN} of ${duties.length} periods covered`, `${duties.length} में से ${coveredN} पीरियड की व्यवस्था हुई`),
            mAction: undefined,
          }
        : state.view === "leave"
          ? {
              crumb: say("Timetable", "समय सारणी"),
              title: say("Teacher leave", "शिक्षक छुट्टी"),
              back: classHref,
              actions: <>{data.me.mayViewCover ? <Btn variant="pri" icon="plus" href={href({ view: "leave", sheet: "leave" })}>{say("Add leave", "छुट्टी जोड़ें")}</Btn> : null}{help}</>,
              mSub: say(`${waitingN} waiting · ${approvedN} approved`, `${waitingN} बाकी · ${approvedN} स्वीकृत`),
              mAction: data.me.mayViewCover ? mAct(say("Add", "जोड़ें"), "plus", href({ view: "leave", sheet: "leave" })) : undefined,
            }
          : {
              crumb: say(`Academics · Session ${session}`, `अकादमिक · सत्र ${session}`),
              title: say("Timetable", "समय सारणी"),
              back: undefined,
              actions: <>{publishAct}{help}</>,
              mSub: classNow
                ? say(`${classNow.label} · today ${todayLine}${nowP >= 0 ? ` · P${periodNumber(nowP)} now` : ""}`, `${classNow.label} · आज ${todayLine}${nowP >= 0 ? ` · अभी P${periodNumber(nowP)}` : ""}`)
                : data.version?.label,
              mAction: pendingN ? mAct(say(`Publish ${pendingN}`, `प्रकाशित ${pendingN}`), "upload", publishHref) : undefined,
            };

  const header = (
    <>
      <header className="only-d glass vx-top" style={{ flex: "none", height: 64, display: "flex", alignItems: "center", gap: 10, padding: "0 28px", borderBottom: "1px solid var(--bd)" }}>
        {top.back ? (
          <Link href={top.back} className="tap btn ghost" aria-label={say("Back", "वापस")} style={{ width: 40, padding: 0 }}>
            <Ic n="chevLeft" />
          </Link>
        ) : null}
        <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
          <span style={{ fontSize: 12, color: "var(--mut)" }}>{top.crumb}</span>
          <h1 className="serif clip" style={{ margin: 0, fontSize: 22, fontWeight: 600, lineHeight: 1.15 }}>{top.title}</h1>
        </div>
        {top.actions}
      </header>
      <header className="only-m glass vx-top" style={{ flex: "none", minHeight: 58, display: "flex", alignItems: "center", gap: 4, padding: "6px 8px", borderBottom: "1px solid var(--bd)" }}>
        <BackLink href={top.back ?? "/menu"} className="tap icon-btn" style={{ width: 44, height: 44, borderRadius: 22 }} label={top.back ? say("Back", "वापस") : say("Back to menu", "मेन्यू पर वापस")}>
          <Ic n="chevLeft" size={24} />
        </BackLink>
        <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", paddingLeft: 2 }}>
          <span className="clip" style={{ fontSize: 17, fontWeight: 700 }}>{top.title}</span>
          {top.mSub ? <span className="clip" style={{ fontSize: 12, color: "var(--mut)" }}>{top.mSub}</span> : null}
        </span>
        {top.mAction}
      </header>
    </>
  );

  /* -------------------------------------------------------------- tabs */

  const tabs = publishing ? null : (
    <div className="pad" style={{ padding: "16px 28px 0" }}>
      <Seg<TimetableView>
        label={say("Timetable view", "समय सारणी का दृश्य")}
        value={state.view}
        onChange={(v) => go({ view: v, classId: v === "class" ? classId : null, teacherId: v === "teacher" ? teacherId : null })}
        options={[
          { value: "class", label: say("Class", "कक्षा") },
          { value: "teacher", label: say("Teacher", "शिक्षक") },
          ...(data.me.mayViewCover
            ? [
                { value: "subs" as const, label: say("Cover", "व्यवस्था") },
                { value: "leave" as const, label: say("Leave", "छुट्टी") },
              ]
            : []),
        ]}
        style={{ width: data.me.mayViewCover ? 560 : 280, maxWidth: "100%" }}
      />
    </div>
  );

  /* -------------------------------------------------------------- body */

  let body: ReactNode;
  if (publishing) {
    body = (
      <PublishScreen
        data={data}
        subjectName={subjectName}
        subjectPair={subjectPair}
        teacherName={teacherName}
        pending={pending}
        previewing={previewing}
        classHref={href({ view: "class", classId: state.classId })}
        onRemove={(id) => start(async () => done(await discardChangeAction(id)))}
        onPublish={(notify, after) => start(async () => done(await publishChangesAction({ notify }), after))}
      />
    );
  } else if (!data.version && (state.view === "class" || state.view === "teacher")) {
    body = (
      <EmptyState
        icon="calendar"
        title={say("No timetable is published", "कोई समय सारणी प्रकाशित नहीं")}
        body={say("Import the timetable sheet and publish it. The week grids, cover and teacher loads all come from it.", "समय सारणी की शीट आयात करके प्रकाशित करें। सप्ताह, व्यवस्था और शिक्षकों का भार उसी से बनते हैं।")}
        action={data.me.mayEdit ? <Btn variant="pri" icon="upload" href="/timetable/import">{say("Import timetable", "समय सारणी आयात करें")}</Btn> : undefined}
      />
    );
  } else if (state.view === "class" && classId) {
    const cls = data.classes.find((c) => c.id === classId);
    const grid = classGrid(planned, classId);
    const changedHere = new Set((data.me.mayEdit ? data.changes : []).filter((c) => c.classId === classId).map((c) => cellKey(c.day, c.period)));
    const classDuties = coverWeekday && cls ? duties.filter((d) => d.classLabels.includes(cls.label)) : [];
    const coverHere = new Map(classDuties.map((d) => [d.period, d]));
    const needsOf = (label: string) => Boolean(coverWeekday) && duties.some((d) => d.status !== "assigned" && d.classLabels.includes(label));
    const changedOf = (id: string) => data.me.mayEdit && data.changes.some((c) => c.classId === id);
    const away = [...new Set(classDuties.flatMap((d) => d.absentNames))];
    const periodsList = classDuties.map((d) => `P${periodNumber(d.period)}`);
    const joined = (list: string[], and: string) => (list.length > 1 ? `${list.slice(0, -1).join(", ")} ${and} ${list[list.length - 1]}` : list[0] ?? "");
    const coveredHere = classDuties.filter((d) => d.status === "assigned").length;
    body = (
      <>
        <ChipRow label={say("Classes", "कक्षाएँ")} style={{ gap: 6, paddingBottom: 0 }}>
          {data.classes.map((c) => (
            <Chip key={c.id} on={c.id === classId} onClick={() => go({ view: "class", classId: c.id }, true)}>
              <Dot color={needsOf(c.label) ? V("warn") : changedOf(c.id) ? V("info") : V("ok")} />
              {c.label.replace(/Science$/, "Sci").replace(/Commerce$/, "Com")}
            </Chip>
          ))}
        </ChipRow>
        {classDuties.length && data.me.mayViewCover ? (
          <Note tone="warn" icon="swap" cta={say("Cover", "व्यवस्था")} href={href({ view: "subs" })}>
            {say(
              `${coverWhen.en} ${joined(periodsList, "and")} ${classDuties.length > 1 ? "need" : "needs"} cover · ${joined(away, "and")} ${away.length > 1 ? "are" : "is"} away · ${coveredHere} of ${classDuties.length} covered`,
              `${coverWhen.hi} ${joined(periodsList, "और")} में व्यवस्था चाहिए · ${joined(away, "और")} अनुपस्थित · ${classDuties.length} में से ${coveredHere} की व्यवस्था हुई`,
            )}
          </Note>
        ) : null}
        {pendingN ? (
          <Note tone="info" icon="edit" cta={say("Review", "देखें")} href={href({ view: "class", classId, sheet: "publish" })}>
            {say(`${pendingN} ${pendingN === 1 ? "change is" : "changes are"} not published yet · teachers still see the old timetable`, `${pendingN} बदलाव अभी प्रकाशित नहीं · शिक्षक अभी पुरानी समय सारणी देखते हैं`)}
          </Note>
        ) : null}
        <WeekCard
          data={data}
          title={cls?.label ?? ""}
          info={[cls?.classTeacher ? say(`Class teacher ${cls.classTeacher}`, `कक्षा अध्यापक ${cls.classTeacher}`) : null, data.me.mayEdit ? say("tap a period to change it", "बदलने के लिए पीरियड पर टैप करें") : null].filter(Boolean).join(" · ")}
          legend
          todayName={todayName}
          nowP={nowP}
          dayName={dayName}
          cell={(day, period) => {
            const list = grid.get(cellKey(day, period)) ?? [];
            const key = cellKey(day, period);
            const duty = day === coverWeekday ? coverHere.get(period) : undefined;
            const open = data.me.mayEdit ? () => go({ view: "class", classId, cell: { day, period } }) : undefined;
            const now = day === todayName && period === nowP;
            if (list.length === 0) return { ...FREE, t1: say("Free", "खाली"), t2: "", t2m: say("Free period", "खाली पीरियड"), dot: now ? "now" : null, onClick: open, aria: `${dayName(day)} P${periodNumber(period)}` };
            const first = list[0];
            const t1 = list.map((s) => subjectName(s.subjectCode)).join(" / ");
            const who = list.map((s) => teacherName.get(s.staffProfileId) ?? s.teacherShortName).join(", ");
            const view: CellView = { t1, t2: who, t2m: who, bg: tint(first.subjectCode), line: { style: "solid", width: 1, color: "transparent" }, bar: bar(first.subjectCode), dot: now ? "now" : changedHere.has(key) ? "edit" : null, onClick: open, aria: `${dayName(day)} P${periodNumber(period)}: ${t1} · ${who}` };
            if (duty) {
              const by = duty.status === "assigned";
              const tone = by ? "ok" : "warn";
              view.t2 = by ? say(`Sub: ${duty.coveringName ?? "—"}`, `व्यवस्था: ${duty.coveringName ?? "—"}`) : say("Needs cover", "व्यवस्था चाहिए");
              view.t2m = by ? say(`Covered by ${duty.coveringName ?? "—"}`, `${duty.coveringName ?? "—"} ले रहे हैं`) : say(`${duty.absentNames.join(", ")} away · needs cover`, `${duty.absentNames.join(", ")} अनुपस्थित · व्यवस्था चाहिए`);
              view.line = { style: "dashed", width: 1.5, color: V(tone) };
              view.bar = V(tone);
            }
            return view;
          }}
        />
      </>
    );
  } else if (state.view === "teacher" && teacherId) {
    const grid = teacherGrid(planned, teacherId);
    const load = teacherLoad(planned, teacherId);
    const name = teacherName.get(teacherId) ?? "";
    const tomorrow = addDay(data.today, 1);
    const onLeaveSoon = (id: string) => data.leave.some((l) => l.staffId === id && l.status === "approved" && l.to >= data.today && l.from <= tomorrow);
    const onLeave = data.leave.find((l) => l.staffId === teacherId && l.status === "approved" && l.to >= data.today);
    const subjects = [...new Set([...grid.values()].flat().map((s) => subjectName(s.subjectCode)))];
    const covering = coverWeekday ? duties.filter((d) => d.status === "assigned" && d.coveringStaffId === teacherId) : [];
    const coveringAt = new Map(covering.map((d) => [d.period, d]));
    const ownAt = new Map((coverWeekday ? duties : []).filter((d) => d.absentIds?.includes(teacherId)).map((d) => [d.period, d]));
    // Periods they leave that began before cover could be arranged: marked on their week too (smoke run, 20 Oct).
    const missedAt = new Map((coverWeekday ? (data.cover?.missed ?? []) : []).filter((m) => m.absentIds.includes(teacherId)).map((m) => [m.period, m]));
    const takenN = Math.max(data.subsThisWeek[teacherId] ?? 0, covering.length);
    body = (
      <>
        <ChipRow label={say("Teachers", "शिक्षक")} style={{ gap: 6, paddingBottom: 0 }}>
          {data.teachers.map((x) => (
            <Chip key={x.id} on={x.id === teacherId} onClick={() => go({ view: "teacher", teacherId: x.id }, true)}>
              <Dot color={onLeaveSoon(x.id) ? V("warn") : V("ok")} />
              {x.name}
            </Chip>
          ))}
        </ChipRow>
        {onLeave ? (
          <Note tone="warn" icon="calendar" cta={data.me.mayViewCover ? say("Cover today", "आज की व्यवस्था") : undefined} href={data.me.mayViewCover ? href({ view: "subs" }) : undefined}>
            {say(
              `${onLeave.name} is on leave ${dayRange(onLeave.from, onLeave.to)}${onLeave.span === "full" ? "" : ` (${spanLabel(onLeave.span).en})`}${onLeave.note ? ` · ${onLeave.note}` : ""}`,
              `${onLeave.name} छुट्टी पर हैं ${dayRange(onLeave.from, onLeave.to)}${onLeave.span === "full" ? "" : ` (${spanLabel(onLeave.span).hi})`}${onLeave.note ? ` · ${onLeave.note}` : ""}`,
            )}
          </Note>
        ) : null}
        <div className="stack" style={{ display: "grid", gridTemplateColumns: "minmax(0,1.2fr) minmax(0,1fr)", gap: 14 }}>
          <Card style={{ padding: "14px 16px", display: "flex", alignItems: "center", gap: 14 }}>
            <RingNum value={load.total} max={WEEK.length * PERIODS.length} tone="var(--acc)" big={load.total} small={say(`of ${WEEK.length * PERIODS.length}`, `${WEEK.length * PERIODS.length} में से`)} />
            <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
              <span style={{ fontSize: 15, fontWeight: 700 }}>{say(`${load.total} periods a week · ${load.free} free`, `सप्ताह में ${load.total} पीरियड · ${load.free} खाली`)}</span>
              <span style={MUTED}>{say(`Free periods are dashed below. Most in a day: ${load.most}.`, `खाली पीरियड नीचे धारीदार हैं। एक दिन में सबसे ज़्यादा: ${load.most}।`)}</span>
              <span style={{ display: "flex", alignItems: "flex-end", gap: 6, height: 46, marginTop: 6 }}>
                {WEEK.map((d, i) => (
                  <span key={d} title={say(`${load.perDay[i]} periods`, `${load.perDay[i]} पीरियड`)} style={{ flex: 1, minWidth: 0, height: "100%", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "flex-end", gap: 4 }}>
                    <span style={{ width: "100%", maxWidth: 26, height: `${Math.round((load.perDay[i] / PERIODS.length) * 100)}%`, borderRadius: "5px 5px 2px 2px", background: d === todayName ? "var(--acc)" : "var(--c2)", transformOrigin: "bottom", animation: "xGrowY .6s var(--ease) both" }} />
                    <span style={{ fontSize: 11, color: "var(--mut)" }}>{tx({ en: WEEK_SHORT[d].slice(0, 2), hi: WEEK_SHORT_HI[d] })}</span>
                  </span>
                ))}
              </span>
            </span>
          </Card>
          <Card style={{ padding: "14px 16px", display: "flex", flexDirection: "column" }}>
            <span className="sech" style={{ marginBottom: 6 }}>{say(`Subs taken this week · ${takenN}`, `इस सप्ताह ली गई व्यवस्था · ${takenN}`)}</span>
            {covering.map((d, i) => (
              <div key={d.id} style={{ display: "grid", gridTemplateColumns: "10px minmax(0,1fr) auto", gap: 10, alignItems: "start", padding: "6px 0", fontSize: 13, ...rise(i) }}>
                <i style={{ width: 10, height: 10, marginTop: 4, borderRadius: 5, background: "var(--acc)" }} />
                <span>{say(`${d.classLabels.join(", ")} · for ${d.absentNames.join(", ")}`, `${d.classLabels.join(", ")} · ${d.absentNames.join(", ")} के स्थान पर`)}</span>
                <span className="num" style={MUTED}>{coverWeekday ? `${dayName(coverWeekday)} P${periodNumber(d.period)}` : `P${periodNumber(d.period)}`}</span>
              </div>
            ))}
            {takenN > covering.length ? <span style={MUTED}>{say(`${takenN - covering.length} earlier this week`, `इस सप्ताह पहले ${takenN - covering.length}`)}</span> : null}
            {takenN === 0 ? <span style={MUTED}>{say("No cover periods taken this week.", "इस सप्ताह कोई व्यवस्था पीरियड नहीं लिया।")}</span> : null}
          </Card>
        </div>
        <WeekCard
          data={data}
          title={name}
          info={[subjects.length ? say(`Teaches ${subjects.slice(0, 3).join(", ")}`, `पढ़ाते हैं: ${subjects.slice(0, 3).join(", ")}`) : null, say(`${load.total} periods a week`, `सप्ताह में ${load.total} पीरियड`)].filter(Boolean).join(" · ")}
          todayName={todayName}
          nowP={nowP}
          dayName={dayName}
          cell={(day, period) => {
            const list = grid.get(cellKey(day, period)) ?? [];
            const today = day === todayName;
            const now = today && period === nowP ? "now" : null;
            const taking = day === coverWeekday ? coveringAt.get(period) : undefined;
            if (taking) {
              const t1 = taking.classLabels.map(cellClass).join(", ");
              const t2 = say(`Covering · ${subjectName(taking.subjectCode)}`, `व्यवस्था · ${subjectName(taking.subjectCode)}`);
              return { t1, t2, t2m: t2, bg: tint(taking.subjectCode), line: { style: "dashed", width: 1.5, color: V("acc") }, bar: V("acc"), dot: now, aria: `${dayName(day)} P${periodNumber(period)}: ${t1} · ${t2}` };
            }
            if (list.length === 0) {
              const t2 = `${dayName(day)} P${periodNumber(period)}`;
              return { ...FREE, t1: say("Free", "खाली"), t2, t2m: say("Free period", "खाली पीरियड"), dot: now, aria: `${t2}: ${say("Free", "खाली")}` };
            }
            const t1 = [...new Set(list.map((s) => cellClass(s.classLabel)))].join(", ");
            const sub = subjectName(list[0].subjectCode);
            const view: CellView = { t1, t2: sub, t2m: sub, bg: tint(list[0].subjectCode), line: { style: "solid", width: 1, color: "transparent" }, bar: bar(list[0].subjectCode), dot: now, onClick: data.me.mayEdit ? () => go({ view: "class", classId: list[0].classId, cell: { day, period } }) : undefined, aria: `${dayName(day)} P${periodNumber(period)}: ${t1} · ${sub}` };
            const own = day === coverWeekday ? ownAt.get(period) : undefined;
            if (own) {
              const by = own.status === "assigned";
              view.t2 = by ? say(`Sub: ${own.coveringName ?? "—"}`, `व्यवस्था: ${own.coveringName ?? "—"}`) : say("Needs cover", "व्यवस्था चाहिए");
              view.t2m = by ? say(`Covered by ${own.coveringName ?? "—"}`, `${own.coveringName ?? "—"} ले रहे हैं`) : say("Away · needs cover", "अनुपस्थित · व्यवस्था चाहिए");
              view.line = { style: "dashed", width: 1.5, color: V(by ? "ok" : "warn") };
              view.bar = V(by ? "ok" : "warn");
            } else if (day === coverWeekday && missedAt.has(period)) {
              view.t2 = say("Away · no cover", "अनुपस्थित · व्यवस्था नहीं");
              view.t2m = say("Away · not covered", "अनुपस्थित · कोई शिक्षक नहीं");
              view.line = { style: "dashed", width: 1.5, color: V("bad") };
              view.bar = V("bad");
            }
            return view;
          }}
        />
      </>
    );
  } else if (state.view === "subs") {
    body = <Subs data={data} pending={coverBlocked} subjectName={subjectName} clock={hhmm} onCover={cover} onAssign={(needKey) => go({ view: "subs", duty: needKey })} />;
  } else if (state.view === "leave") {
    body = <Leave data={data} pending={pending || previewing} onDecide={(id, approve) => start(async () => {
      const result = await decideLeaveAction({ id, approve });
      // Approved with lessons still short of a teacher: the toast says how many, and the cover tab opens on that day.
      if (result.ok && result.coverDay) {
        toast.show({ text: tx(result.message), tone: "bad" });
        router.push(timetableHref({ view: "subs" }, result.coverDay), { scroll: false });
        return;
      }
      done(result);
    })} />;
  } else {
    body = <EmptyState icon="calendar" title={say("Nothing to show", "दिखाने को कुछ नहीं")} body={say("No classes or teachers in this session's timetable yet.", "इस सत्र की समय सारणी में अभी कोई कक्षा या शिक्षक नहीं।")} />;
  }

  // Sheets: edit (with clash), assign, leave.
  const editCell = !publishing && state.cell && classId && state.view === "class" ? state.cell : null;
  // A running period nobody covers opens the same sheet; choosing sends that teacher in now.
  const lateRow = state.duty ? (data.cover?.missed ?? []).find((m) => m.key === state.duty && m.running) ?? null : null;
  const duty = state.duty ? (duties.find((d) => d.needKey === state.duty) ?? (lateRow ? lateDutyView(lateRow) : null)) : null;
  const sendLate = (needKey: string, staffId: string) => {
    if (previewing || !data.me.mayCover || !scope || coverBlocked || coverInFlight.current) return;
    coverInFlight.current = true;
    start(async () => {
      try {
        done(await lateCoverAction({ commandId: uuid(), sessionLabel: scope.session, day: scope.day, needKey, coveringStaffId: staffId }), () => go({ view: "subs" }, true));
      } catch {
        uncertain();
      } finally {
        coverInFlight.current = false;
      }
    });
  };
  const close = () => go({ view: state.view, classId: state.classId, teacherId: state.teacherId }, true);

  return (
    <VxPage>
      {header}
      <div className="vx-pmain">
        {tabs}
        <div className="pad" style={{ padding: "16px 28px 40px", display: "flex", flexDirection: "column", gap: 14, minWidth: 0, ...(publishing ? { width: "100%", maxWidth: 880, margin: "0 auto" } : null) }}>
          {!previewing && data.me.mayCover && recovery ? (
            <Banner tone="warn">
              {checkedMissing === recovery.payload.commandId ? (
                <div role="alert" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <b>{tx(p(`Not saved · cover for ${dayShort(recovery.payload.day)}`, `सहेजा नहीं गया · ${dayShort(recovery.payload.day)} की व्यवस्था`))}</b>
                  <span>{tx(p('The server has no record of this change. Try again sends the same change once more — it can never be saved twice.', 'सर्वर पर यह बदलाव दर्ज नहीं है। "फिर आज़माएँ" वही बदलाव एक बार और भेजता है — यह दो बार कभी नहीं सहेजा जाता।'))}</span>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <Btn variant="pri" disabled={pending} onClick={() => recoverCover(true)}>{pending ? tx(p('Saving…', 'सहेजा जा रहा है…')) : tx(p('Try again', 'फिर आज़माएँ'))}</Btn>
                    <Btn variant="sec" disabled={pending} onClick={() => recoverCover(false)}>{tx(p('Check again', 'फिर जाँचें'))}</Btn>
                  </div>
                </div>
              ) : (
                <div role="status" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <b>{pending ? tx(p(`Checking the last cover save for ${dayShort(recovery.payload.day)}…`, `${dayShort(recovery.payload.day)} का पिछला व्यवस्था बदलाव जाँचा जा रहा है…`)) : tx(p(`Cover save for ${dayShort(recovery.payload.day)} needs checking`, `${dayShort(recovery.payload.day)} के कवर बदलाव को जाँचना है`))}</b>
                  <span>{tx(p('Its result may already be saved. Resolve this request before another cover change.', 'यह बदलाव पहले ही सुरक्षित हो सकता है। दूसरा कवर बदलाव करने से पहले इसे जाँचें।'))}</span>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <Btn variant="sec" disabled={pending} onClick={() => recoverCover(false)}>{tx(p('Check saved result', 'सुरक्षित परिणाम जाँचें'))}</Btn>
                  </div>
                </div>
              )}
            </Banner>
          ) : !previewing && data.me.mayCover && scope && ((!storageReady && snapshot !== 'loading') || storageProblem === scopeKey) ? <Banner tone="warn">{snapshot === 'unsupported' ? tx(p('This browser cannot safely preserve cover saves across tabs. Open this page in an up-to-date supported browser before saving.', 'यह ब्राउज़र अलग-अलग टैब में कवर बदलाव सुरक्षित नहीं रख सकता। बदलाव करने से पहले नया समर्थित ब्राउज़र इस्तेमाल करें।')) : tx(p('Cannot preserve the cover request on this phone. Nothing new was submitted. Restore browser storage before saving.', 'इस फ़ोन पर कवर अनुरोध सुरक्षित नहीं हो सका। कोई नया बदलाव जमा नहीं हुआ। पहले ब्राउज़र स्टोरेज ठीक करें।'))}</Banner> : null}
          {body}
        </div>
      </div>
      {editCell && classId ? (
        <EditSheet
          key={`${editCell.day}-${editCell.period}-${state.pick ?? ""}`}
          data={data}
          planned={planned}
          classId={classId}
          day={editCell.day}
          period={editCell.period}
          initialPick={state.pick}
          subjectName={subjectName}
          dayName={dayName}
          pending={pending || previewing}
          onClose={close}
          onSave={(subjectId, staffProfileId) => start(async () => done(await saveChangeAction({ day: editCell.day, period: editCell.period, classId, subjectId, staffProfileId }), close))}
        />
      ) : null}
      <AssignSheet
        duty={duty}
        data={data}
        pending={coverBlocked}
        subjectName={subjectName}
        onClose={() => go({ view: "subs" }, true)}
        onAssign={(needKey, staffId) => (lateRow && lateRow.key === needKey ? sendLate(needKey, staffId) : cover({ intent: "assign", needKey, coveringStaffId: staffId }, () => go({ view: "subs" }, true)))}
      />
      {data.me.mayViewCover ? (
        <LeaveSheet
          open={state.sheet === "leave"}
          data={data}
          pending={pending || previewing}
          onClose={() => go({ view: "leave" }, true)}
          onSave={(input) => start(async () => done(await requestLeaveAction(input), () => go({ view: "leave" }, true)))}
        />
      ) : null}
    </VxPage>
  );
}

function spanLabel(span: LeaveSpan): { en: string; hi: string } {
  if (span === "first_half") return { en: `P1–P${BREAK_AFTER + 1}`, hi: `P1–P${BREAK_AFTER + 1}` };
  if (span === "second_half") return { en: `after P${BREAK_AFTER + 1}`, hi: `P${BREAK_AFTER + 1} के बाद` };
  return { en: "full day", hi: "पूरा दिन" };
}

/* ---------------------------------------------------------------- week grid */

type CellView = {
  t1: string;
  t2: string;
  /** The phone's longer second line. */
  t2m: string;
  bg: string;
  line: { style: "solid" | "dashed"; width: number; color: string };
  bar: string;
  dot: "now" | "edit" | null;
  onClick?: () => void;
  aria: string;
};

const FREE = { bg: "transparent", line: { style: "dashed" as const, width: 1.5, color: V("bds") }, bar: V("bds") };

function cellBox(c: CellView): CSSProperties {
  const w = c.line.width;
  return {
    position: "relative",
    minWidth: 0,
    overflow: "hidden",
    display: "flex",
    flexDirection: "column",
    justifyContent: "center",
    gap: 1,
    borderRadius: 10,
    textAlign: "left",
    color: "var(--fg)",
    background: c.bg,
    borderStyle: c.line.style,
    borderWidth: `${w}px ${w}px ${w}px 3px`,
    borderColor: `${c.line.color} ${c.line.color} ${c.line.color} ${c.bar}`,
  };
}

function CellDot({ dot }: { dot: CellView["dot"] }) {
  if (!dot) return null;
  return <span aria-hidden="true" style={{ position: "absolute", top: 7, right: 7, width: 8, height: 8, borderRadius: 4, background: dot === "now" ? "var(--acc)" : "var(--warn)", animation: dot === "now" ? "xPulse 1.8s ease infinite" : undefined }} />;
}

function WeekCard({
  data,
  title,
  info,
  todayName,
  nowP,
  dayName,
  cell,
  legend,
}: {
  data: TimetableData;
  title: string;
  info: string;
  todayName: Weekday | null;
  nowP: number;
  dayName: (d: Weekday) => string;
  cell: (day: Weekday, period: number) => CellView;
  legend?: boolean;
}) {
  const { tx } = useVx();
  const [phoneDay, setPhoneDay] = useState<Weekday>(todayName ?? "Monday");
  const bell = (i: number) => data.bells.find((b) => b.index === i);
  const cols = `62px repeat(${BREAK_AFTER + 1}, minmax(0,1fr)) 22px repeat(${PERIODS.length - BREAK_AFTER - 1}, minmax(0,1fr))`;
  const lunchFrom = bellTime(bell(BREAK_AFTER)?.ends);
  const lunchTo = bellTime(bell(BREAK_AFTER + 1)?.starts);
  const dayIdx = Math.max(0, WEEK.indexOf(phoneDay));

  const tile = (c: CellView, key: string) => {
    const st: CSSProperties = { ...cellBox(c), minHeight: 58, padding: "7px 8px 6px 10px" };
    const inner = (
      <>
        <b className="clip" style={{ fontSize: 13 }}>{c.t1}</b>
        <span className="clip" style={{ fontSize: 11, color: "var(--mut)" }}>{c.t2}</span>
        <CellDot dot={c.dot} />
      </>
    );
    return c.onClick ? (
      <button key={key} type="button" className="tap" aria-label={c.aria} onClick={c.onClick} style={st}>{inner}</button>
    ) : (
      <div key={key} aria-label={c.aria} style={st}>{inner}</div>
    );
  };

  const phoneRow = (period: number) => {
    const c = cell(phoneDay, period);
    const b = bell(period);
    const inner = (
      <>
        <span style={{ flex: "none", width: 46, display: "flex", flexDirection: "column", alignItems: "center" }}>
          <b style={{ fontSize: 13 }}>P{periodNumber(period)}</b>
          <span className="num" style={{ fontSize: 11, color: "var(--mut)" }}>{bellTime(b?.starts)}</span>
        </span>
        <span style={{ ...cellBox(c), flex: 1, minHeight: 54, padding: "7px 8px 6px 10px" }}>
          <b className="clip">{c.t1}</b>
          <span className="clip" style={{ fontSize: 12, color: "var(--mut)" }}>{c.t2m}</span>
          <CellDot dot={c.dot} />
        </span>
      </>
    );
    const st: CSSProperties = { width: "100%", display: "flex", alignItems: "center", gap: 10, border: 0, padding: 0, background: "transparent", color: "var(--fg)", textAlign: "left" };
    return c.onClick ? (
      <button key={period} type="button" className="tap" aria-label={c.aria} onClick={c.onClick} style={st}>{inner}</button>
    ) : (
      <div key={period} aria-label={c.aria} style={st}>{inner}</div>
    );
  };

  return (
    <Card style={{ padding: "14px 16px", display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", gap: 8 }}>
        <span style={{ fontSize: 13 }}>
          <b>{title}</b>
          {info ? <> · <span style={{ color: "var(--mut)" }}>{info}</span></> : null}
        </span>
        {legend ? (
          <span className="hide-m" style={{ display: "flex", flexWrap: "wrap", gap: 10, fontSize: 12, color: "var(--mut)" }}>
            {LEGEND_FAMILIES.map((f) => (
              <span key={f} style={{ display: "flex", alignItems: "center", gap: 4 }}>
                <Dot color={V(FAMILY_TONES[f])} />
                {tx(FAMILY_LABELS[f])}
              </span>
            ))}
          </span>
        ) : null}
      </div>

      <div className="only-d" style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <div style={{ display: "grid", gridTemplateColumns: cols, gap: 6, alignItems: "stretch" }}>
          <span />
          {PERIODS.map((i) => (
            <Fragment key={i}>
              <span style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: "2px 0 4px" }}>
                <span style={{ display: "flex", alignItems: "center", gap: 4, fontWeight: 700, fontSize: 13 }}>
                  P{periodNumber(i)}
                  {i === nowP ? <span style={NOW_DOT} /> : null}
                </span>
                <span className="num" style={{ fontSize: 11, color: "var(--mut)" }}>{bellTime(bell(i)?.starts)}</span>
              </span>
              {i === BREAK_AFTER ? <span style={{ fontSize: 11, color: "var(--mut)", textAlign: "center", writingMode: "vertical-rl", alignSelf: "center" }}>{tx(p("Lunch", "भोजन"))}</span> : null}
            </Fragment>
          ))}
        </div>
        {WEEK.map((day, di) => {
          const today = day === todayName;
          return (
            <div key={day} style={{ display: "grid", gridTemplateColumns: cols, gap: 6, alignItems: "stretch", padding: 4, margin: "0 -4px", borderRadius: 14, background: today ? "var(--accs)" : "transparent" }}>
              <span style={{ display: "flex", flexDirection: "column", justifyContent: "center", paddingLeft: 6 }}>
                <b style={{ fontSize: 13, color: today ? "var(--accfg)" : "var(--fg)" }}>{dayName(day)}</b>
                <span style={{ fontSize: 11, color: "var(--mut)" }}>{dateShort(data.week[di] ?? "")}</span>
              </span>
              {PERIODS.map((period) => (
                <Fragment key={period}>
                  {tile(cell(day, period), `${day}${period}`)}
                  {period === BREAK_AFTER ? <span aria-hidden="true" style={{ borderRadius: 8, background: "repeating-linear-gradient(135deg,var(--s3) 0 5px,transparent 5px 10px)", opacity: 0.6 }} /> : null}
                </Fragment>
              ))}
            </div>
          );
        })}
      </div>

      <div className="only-m" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <div className="seg" role="radiogroup" aria-label={tx(p("Day", "दिन"))} style={{ gridTemplateColumns: `repeat(${WEEK.length}, minmax(0,1fr))` }}>
          <span className="thumb" aria-hidden="true" style={{ width: `calc((100% - 6px) / ${WEEK.length})`, transform: `translateX(${dayIdx * 100}%)` }} />
          {WEEK.map((d, i) => (
            <button key={d} type="button" role="radio" aria-checked={d === phoneDay} className={d === phoneDay ? "on" : ""} onClick={() => setPhoneDay(d)} style={{ height: 46, lineHeight: 1.15, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 0 }}>
              <span>{d === todayName ? tx(p("Today", "आज")) : dayName(d)}</span>
              <span style={{ fontSize: 11, fontWeight: 500 }}>{Number((data.week[i] ?? "").slice(8)) || ""}</span>
            </button>
          ))}
        </div>
        <div key={phoneDay} style={{ display: "flex", flexDirection: "column", gap: 8, animation: "xIn .3s var(--ease) both" }}>
          {PERIODS.map((period) => (
            <Fragment key={period}>
              {phoneRow(period)}
              {period === BREAK_AFTER ? (
                <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "2px 0", fontSize: 12, color: "var(--mut)" }}>
                  <span style={{ flex: 1, height: 1, background: "var(--bd)" }} />
                  {tx(p(`Lunch · ${lunchFrom}–${lunchTo}`, `भोजन · ${lunchFrom}–${lunchTo}`))}
                  <span style={{ flex: 1, height: 1, background: "var(--bd)" }} />
                </div>
              ) : null}
            </Fragment>
          ))}
        </div>
      </div>
    </Card>
  );
}

/* ---------------------------------------------------------------- edit sheet */

function EditSheet({
  data,
  planned,
  classId,
  day,
  period,
  initialPick,
  subjectName,
  dayName,
  pending,
  onClose,
  onSave,
}: {
  data: TimetableData;
  planned: Slot[];
  classId: string;
  day: Weekday;
  period: number;
  initialPick: string | null;
  subjectName: (code: string) => string;
  dayName: (d: Weekday) => string;
  pending: boolean;
  onClose: () => void;
  onSave: (subjectId: string, staffId: string) => void;
}) {
  const { tx } = useVx();
  const say = (en: string, hi: string) => tx({ en, hi });
  const cls = data.classes.find((c) => c.id === classId);
  const now = planned.filter((s) => s.classId === classId && s.day === day && s.period === period);
  const classSlots = useMemo(() => planned.filter((s) => s.classId === classId), [planned, classId]);
  const classSubjects = useMemo(() => {
    const ids = new Set(classSlots.map((s) => s.subjectId));
    return data.subjects.filter((s) => ids.has(s.id));
  }, [classSlots, data.subjects]);
  // The class's own teacher for a subject: who teaches it here most often.
  const ownTeacher = (subjectId: string): string | null => {
    const count = new Map<string, number>();
    for (const s of classSlots) if (s.subjectId === subjectId) count.set(s.staffProfileId, (count.get(s.staffProfileId) ?? 0) + 1);
    return [...count.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  };
  // Picking a teacher picks what they teach this class, as the design's clash check does.
  const pickedSubject = initialPick ? classSlots.find((s) => s.staffProfileId === initialPick)?.subjectId ?? null : null;
  const [subjectId, setSubjectId] = useState<string>(pickedSubject ?? now[0]?.subjectId ?? classSubjects[0]?.id ?? data.subjects[0]?.id ?? "");
  const [staffId, setStaffId] = useState<string>(initialPick ?? now[0]?.staffProfileId ?? "");
  const [showAll, setShowAll] = useState(false);
  const subjectTeachers = teachersOf(planned, subjectId);
  const others = planned.filter((s) => !(s.classId === classId && s.day === day && s.period === period));
  const free = new Set(freeAt(others, data.teachers.map((t) => t.id), day, period));
  const ordered = [...data.teachers].sort((a, b) => Number(subjectTeachers.has(b.id)) - Number(subjectTeachers.has(a.id)) || Number(free.has(b.id)) - Number(free.has(a.id)) || a.name.localeCompare(b.name));
  const shown = showAll ? ordered : ordered.filter((t) => subjectTeachers.has(t.id) || t.id === staffId).slice(0, 8);
  const clash = staffId ? clashFor(others, { day, period, classId, staffProfileId: staffId }) : null;
  const firstFree = ordered.find((t) => subjectTeachers.has(t.id) && free.has(t.id) && t.id !== staffId);
  const nameOf = (id: string) => data.teachers.find((t) => t.id === id)?.name ?? "—";
  const bell = data.bells.find((b) => b.index === period);
  const unchanged = now.length === 1 && now[0].subjectId === subjectId && now[0].staffProfileId === staffId;
  const subjectNow = data.subjects.find((s) => s.id === subjectId);
  const nowLine = now.length ? now.map((s) => `${subjectName(s.subjectCode)} · ${nameOf(s.staffProfileId) === "—" ? s.teacherShortName : nameOf(s.staffProfileId)}`).join(", ") : say("free", "खाली");
  const pn = `P${periodNumber(period)}`;

  return (
    <Sheet
      open
      onClose={onClose}
      wide
      title={`${cls?.label ?? say("Class", "कक्षा")} · ${dayName(day)} · ${pn}`}
      sub={`${bell ? `${bellTime(bell.starts)}–${bellTime(bell.ends)} · ` : ""}${say("now", "अभी")}: ${nowLine}`}
      footer={
        <>
          <button type="button" className="tap btn sec" style={{ flex: 1 }} onClick={onClose}>{say("Cancel", "रद्द करें")}</button>
          <button type="button" className="tap btn pri" style={{ flex: 1.6 }} disabled={pending || !subjectId || !staffId || Boolean(clash) || unchanged} onClick={() => onSave(subjectId, staffId)}>
            <Ic n="check" />
            {say("Save change", "बदलाव सहेजें")}
          </button>
        </>
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 14, paddingTop: 4 }}>
        <div className="field">
          <span>{say("Subject", "विषय")}</span>
          <div role="group" aria-label={say("Subject", "विषय")} style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {(classSubjects.length ? classSubjects : data.subjects).map((s) => (
              <Chip
                key={s.id}
                on={s.id === subjectId}
                onClick={() => {
                  setSubjectId(s.id);
                  const own = ownTeacher(s.id);
                  if (own) setStaffId(own);
                }}
              >
                <Dot color={bar(s.code)} />
                {tx({ en: s.name, hi: s.nameHi ?? undefined })}
              </Chip>
            ))}
          </div>
        </div>
        <div className="field">
          <span style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
            {say("Teacher", "शिक्षक")}
            {!showAll ? (
              <button type="button" className="tap" onClick={() => setShowAll(true)} style={{ border: 0, padding: 0, background: "transparent", color: "var(--acc)", fontSize: 12, fontWeight: 700 }}>
                {say("Show every teacher", "सभी शिक्षक दिखाएँ")}
              </button>
            ) : null}
          </span>
          <div className="card" role="radiogroup" aria-label={say("Teacher", "शिक्षक")} style={{ display: "flex", flexDirection: "column", padding: "0 14px", boxShadow: "none" }}>
            {shown.map((t, i) => {
              const busy = clashFor(others, { day, period, classId, staffProfileId: t.id });
              const on = staffId === t.id;
              return (
                <button key={t.id} type="button" role="radio" aria-checked={on} className="tap" onClick={() => setStaffId(t.id)} style={{ width: "100%", display: "flex", alignItems: "center", gap: 12, minHeight: 50, padding: "6px 0", border: 0, borderTop: i ? "1px solid var(--bd)" : 0, background: "transparent", color: "var(--fg)", textAlign: "left" }}>
                  <RadioDot on={on} />
                  <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
                    <span style={{ fontWeight: 600 }}>{t.name}</span>
                    <span style={MUTED}>{subjectTeachers.has(t.id) ? say(`Teaches ${subjectNow ? subjectName(subjectNow.code) : ""}`, `पढ़ाते हैं: ${subjectNow ? subjectName(subjectNow.code) : ""}`) : say("Another subject", "दूसरा विषय")}</span>
                  </span>
                  {busy ? <Pill tone="warn">{say(`Busy · ${busy.classLabel}`, `व्यस्त · ${busy.classLabel}`)}</Pill> : <Pill tone="ok">{say("Free", "खाली")}</Pill>}
                </button>
              );
            })}
          </div>
        </div>
        {clash ? (
          <div role="alert" style={{ padding: "12px 14px", borderRadius: 14, fontSize: 13, lineHeight: 1.5, display: "flex", flexDirection: "column", gap: 10, background: "var(--warns)", color: "var(--warnfg)", animation: "xShake .4s ease" }}>
            <span style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 700 }}>
              <Ic n="alert" />
              {say(`${nameOf(staffId)} already teaches ${clash.classLabel} in ${pn} on ${WEEK_SHORT[day]}`, `${nameOf(staffId)} ${dayName(day)} को ${pn} में पहले से ${clash.classLabel} में हैं`)}
            </span>
            <span>{say("Pick a free teacher, or keep the period as it was.", "खाली शिक्षक चुनें, या पीरियड पहले जैसा रखें।")}</span>
            <span style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {firstFree ? (
                <button type="button" className="tap btn sec" style={{ height: 36, fontSize: 13 }} onClick={() => setStaffId(firstFree.id)}>
                  {say(`Use ${firstFree.name} · free`, `${firstFree.name} को लें · खाली`)}
                </button>
              ) : null}
              {now[0] ? (
                <button type="button" className="tap btn sec" style={{ height: 36, fontSize: 13 }} onClick={() => { setSubjectId(now[0].subjectId); setStaffId(now[0].staffProfileId); }}>
                  {say(`Keep ${nowLine}`, `रखें: ${nowLine}`)}
                </button>
              ) : null}
            </span>
          </div>
        ) : !unchanged && staffId ? (
          <div className="fadein" style={{ padding: "12px 14px", borderRadius: 14, fontSize: 13, lineHeight: 1.5, display: "flex", gap: 10, background: "var(--oks)", color: "var(--ok)" }}>
            <Ic n="checkCircle" />
            <span>{say(`No clash · ${nameOf(staffId)} is free then. Saved changes wait for you to publish.`, `कोई टकराव नहीं · ${nameOf(staffId)} तब खाली हैं। सहेजे बदलाव प्रकाशित करने तक रुकते हैं।`)}</span>
          </div>
        ) : null}
        <div className="field">
          <span>{say("Room", "कमरा")}</span>
          <span style={{ fontSize: 13, color: "var(--mut)" }}>{say("Rooms are not kept in the timetable yet; the period keeps its class's room.", "समय सारणी में अभी कमरे नहीं रखे जाते; पीरियड कक्षा के अपने कमरे में रहता है।")}</span>
        </div>
      </div>
    </Sheet>
  );
}

/* ---------------------------------------------------------------- substitutions */

function noticeLine(d: CoverDutyView): Pair {
  const n = d.coveringName ?? "—";
  if (d.notice === "read") return p(`${n} was told on WhatsApp · read`, `${n} को WhatsApp पर बताया · पढ़ लिया`);
  if (d.notice === "delivered" || d.notice === "accepted") return p(`${n} was told on WhatsApp · delivered`, `${n} को WhatsApp पर बताया · पहुँच गया`);
  if (d.notice === "failed") return p(`The WhatsApp notice to ${n} failed · call them`, `${n} को WhatsApp संदेश नहीं गया · फ़ोन करें`);
  if (d.notice) return p(`${n} · WhatsApp notice queued`, `${n} · WhatsApp संदेश कतार में`);
  return p(`${n} · no notice yet`, `${n} · अभी कोई संदेश नहीं`);
}

function Subs({
  data,
  pending,
  subjectName,
  clock: hhmm,
  onCover,
  onAssign,
}: {
  data: TimetableData;
  pending: boolean;
  subjectName: (code: string) => string;
  clock: string | null;
  onCover: (input: Omit<CoverInput, "commandId" | "sessionLabel" | "day" | "dayRevision">, after?: () => void) => void;
  onAssign: (needKey: string) => void;
}) {
  const { tx } = useVx();
  const say = (en: string, hi: string) => tx({ en, hi });
  const c = data.cover;
  const [awayId, setAwayId] = useState("");
  const [awaySpanChoice, setAwaySpanChoice] = useState<LeaveSpan>("full");
  const [choice, setChoice] = useState<Record<string, string>>({});
  const [editing, setEditing] = useState(false);
  if (!c) return <EmptyState icon="swap" title={say("Cover is not open to you", "व्यवस्था आपके लिए खुली नहीं")} body={say("Ask the office who is covering.", "कौन ले रहा है, कार्यालय से पूछें।")} />;
  const live = c.duties;
  const assigned = live.filter((d) => d.status === "assigned").length;
  const nowPeriod = c.day === data.today ? periodAt(data.bells, hhmm) : -1;
  const isToday = c.day === data.today;
  const onLeave = (staffId: string) => data.leave.find((l) => l.staffId === staffId && l.status === "approved" && l.from <= c.day && c.day <= l.to);
  const absenceOf = (staffId: string) => c.absences.find((a) => a.staffId === staffId);
  const awayWhy = (a: CoverView["absences"][number]): string => {
    const span = awaySpan(a.periods);
    const l = onLeave(a.staffId);
    const head =
      span.kind === "after"
        ? say(`Half day · away after P${span.after}`, `आधा दिन · P${span.after} के बाद अनुपस्थित`)
        : span.kind === "periods"
          ? say(`Away P${span.list.join(", P")}`, `अनुपस्थित P${span.list.join(", P")}`)
          : l && l.to > c.day
            ? say(`On leave till ${dayShort(l.to)}`, `${dayShort(l.to)} तक छुट्टी पर`)
            : l
              ? say("On leave", "छुट्टी पर")
              : say("Away all day", "पूरे दिन अनुपस्थित");
    return a.reason ? `${head} · ${a.reason}` : head;
  };
  const dutyWhy = (d: CoverDutyView): string => {
    const ids = d.absentIds ?? [];
    if (ids.length === 1) {
      const a = absenceOf(ids[0]);
      const span = a ? awaySpan(a.periods) : null;
      const n = d.absentNames[0] ?? "—";
      if (span?.kind === "after") return say(`${n} leaves after P${span.after}`, `${n} P${span.after} के बाद चले जाते हैं`);
      if (onLeave(ids[0])) return say(`${n} is on leave`, `${n} छुट्टी पर हैं`);
      return say(`${n} is away`, `${n} अनुपस्थित हैं`);
    }
    return say(`${d.absentNames.join(", ")} ${d.absentNames.length > 1 ? "are" : "is"} away`, `${d.absentNames.join(", ")} अनुपस्थित`);
  };
  const open = live.length - assigned;
  const away = [...c.absences];
  const missed = c.missed ?? [];
  // Every lesson the absences leave, the begun ones included: the ring is
  // covered out of all of them, green only when every one has a teacher.
  const ring = coverRing(assigned, live.length, missed.length);
  const isAbsent =(ids: string[] | undefined, names: string[], a: CoverView["absences"][number]) => (ids ? ids.includes(a.staffId) : names.includes(a.name));

  return (
    <>
      {!c.hasTimetable ? <Banner tone="warn">{say(`No published timetable covers ${dayShort(c.day)}, so there is nothing to arrange.`, `${dayShort(c.day)} के लिए कोई प्रकाशित समय सारणी नहीं, इसलिए व्यवस्था नहीं।`)}</Banner> : null}
      <div className="stack" style={{ display: "grid", gridTemplateColumns: "minmax(0,1.3fr) minmax(0,1fr)", gap: 14 }}>
        <Card style={{ padding: "14px 16px", display: "flex", flexDirection: "column" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 6 }}>
            <span className="sech">{isToday ? say(`Away today · ${dayShort(c.day)}`, `आज अनुपस्थित · ${dayShort(c.day)}`) : say(`Away · ${dayShort(c.day)}`, `अनुपस्थित · ${dayShort(c.day)}`)}</span>
            {c.canCommand ? (
              <button type="button" className="tap vx-lnk" aria-expanded={editing} onClick={() => setEditing((v) => !v)} style={{ fontSize: 13, fontWeight: 700 }}>
                {editing ? say("Done", "हो गया") : say("Mark away", "अनुपस्थित दर्ज करें")}
              </button>
            ) : null}
          </div>
          {/* Review C01: an empty day says what to do first, not just 0/0. */}
          {away.length === 0 ? (
            <span style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 10, padding: "8px 0" }}>
              <span style={MUTED}>{say("No one is marked away yet.", "अभी कोई अनुपस्थित दर्ज नहीं।")}</span>
              {c.canCommand && !editing ? <Btn variant="pri" icon="user" onClick={() => setEditing(true)}>{say("Mark a teacher away", "शिक्षक को अनुपस्थित दर्ज करें")}</Btn> : null}
            </span>
          ) : null}
          {away.map((a, i) => {
            // Every lesson the absence leaves, including the ones whose period had already begun.
            const n = live.filter((d) => isAbsent(d.absentIds, d.absentNames, a)).length + missed.filter((x) => isAbsent(x.absentIds, x.absentNames, a)).length;
            return (
              <div key={a.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "8px 0", borderTop: i ? "1px solid var(--bd)" : 0, ...rise(i) }}>
                <Ava name={a.name} />
                <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
                  <span style={{ fontWeight: 600 }}>{a.name}</span>
                  <span style={MUTED}>{awayWhy(a)}</span>
                </span>
                <Pill tone="warn">{say(`${n} ${n === 1 ? "period" : "periods"}`, `${n} पीरियड`)}</Pill>
                {editing && c.canCommand ? <Btn variant="ghost" disabled={pending} style={{ height: 36 }} onClick={() => onCover({ intent: "clear_absence", staffProfileId: a.staffId })}>{say("Back", "लौट आए")}</Btn> : null}
              </div>
            );
          })}
          {editing && c.canCommand ? (
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", borderTop: "1px solid var(--bd)", paddingTop: 10, marginTop: 4 }}>
              <Select value={awayId} onChange={(e) => setAwayId(e.target.value)} style={{ flex: 1, minWidth: 160 }} aria-label={say("Teacher away", "अनुपस्थित शिक्षक")}>
                <option value="">{say("Mark a teacher away…", "शिक्षक चुनें…")}</option>
                {c.staff.map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </Select>
              <Select value={awaySpanChoice} onChange={(e) => setAwaySpanChoice(e.target.value as LeaveSpan)} aria-label={say("Which periods", "कौन से पीरियड")} style={{ width: "auto" }}>
                <option value="full">{say("Whole day", "पूरा दिन")}</option>
                <option value="first_half">{say(`First half · P1–P${BREAK_AFTER + 1}`, `पहली पाली · P1–P${BREAK_AFTER + 1}`)}</option>
                <option value="second_half">{say(`Second half · P${BREAK_AFTER + 2}–P${PERIODS.length}`, `दूसरी पाली · P${BREAK_AFTER + 2}–P${PERIODS.length}`)}</option>
              </Select>
              {/* Periods already marked away (an approved leave, say) are kept: the new ones are added, never swapped in silently. */}
              <Btn variant="pri" icon="check" disabled={pending || !awayId} onClick={() => onCover({ intent: "absence", staffProfileId: awayId, periods: [...new Set([...(absenceOf(awayId)?.periods ?? []), ...spanPeriods(awaySpanChoice)])].sort((x, y) => x - y) }, () => setAwayId(""))}>{say("Save & arrange", "सहेजें और व्यवस्था करें")}</Btn>
              {awayId && absenceOf(awayId) ? (
                <span role="status" style={{ flexBasis: "100%", fontSize: 13, color: "var(--warnfg)" }}>
                  {(() => {
                    const a = absenceOf(awayId)!;
                    const list = `P${a.periods.map((x) => periodNumber(x)).join(", P")}`;
                    return onLeave(awayId)
                      ? say(`${a.name} is already away ${list} on approved leave. The periods you pick are added; use Back to clear the day.`, `${a.name} स्वीकृत छुट्टी पर ${list} में पहले से अनुपस्थित हैं। चुने पीरियड जोड़ दिए जाएँगे; दिन हटाने के लिए "लौट आए" दबाएँ।`)
                      : say(`${a.name} is already away ${list}. The periods you pick are added; use Back to clear the day.`, `${a.name} ${list} में पहले से अनुपस्थित हैं। चुने पीरियड जोड़ दिए जाएँगे; दिन हटाने के लिए "लौट आए" दबाएँ।`);
                  })()}
                </span>
              ) : null}
            </div>
          ) : null}
        </Card>
        <Card style={{ padding: "14px 16px", display: "flex", alignItems: "center", gap: 14 }}>
          <RingNum value={assigned} max={ring.total} tone={ring.tone === "ok" ? "var(--ok)" : ring.tone === "warn" ? "var(--warn)" : "var(--s3)"} big={ring.total === 0 ? "—" : `${assigned}/${ring.total}`} bigSize={18} small={say("covered", "व्यवस्था")} />
          <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 4 }}>
            <span style={{ fontSize: 15, fontWeight: 700, color: ring.short ? "var(--warnfg)" : undefined }}>
              {ring.total === 0
                ? say("No period needs cover", "किसी पीरियड में व्यवस्था नहीं चाहिए")
                : ring.short
                  ? say(`${assigned} of ${ring.total} periods covered · ${ring.short} with no teacher`, `${ring.total} में से ${assigned} पीरियड की व्यवस्था · ${ring.short} में कोई शिक्षक नहीं`)
                  : say(`All ${ring.total} periods covered`, `सभी ${ring.total} पीरियड की व्यवस्था हुई`)}
            </span>
            <span style={MUTED}>
              {open
                ? say(`${open} still need a teacher · best matches are picked for you`, `${open} को अभी शिक्षक चाहिए · सबसे उपयुक्त पहले चुने गए हैं`)
                : live.length
                  ? say("Everyone knows where to be today", "आज सबको पता है कहाँ जाना है")
                  : missed.length
                    ? say(`${missed.length} ${missed.length === 1 ? "period had" : "periods had"} begun before cover could be arranged · see below`, `${missed.length} पीरियड व्यवस्था से पहले शुरू हो चुके थे · नीचे देखें`)
                    : say("Mark a teacher away and their periods appear here", "शिक्षक को अनुपस्थित दर्ज करें, उनके पीरियड यहाँ दिखेंगे")}
            </span>
          </span>
        </Card>
      </div>
      {missed.length ? (
        <Card style={{ padding: "14px 16px", display: "flex", flexDirection: "column", gap: 4, borderColor: "var(--warnm)" }}>
          <span className="sech">{say(`Already begun · not covered · ${missed.length}`, `पहले ही शुरू · व्यवस्था नहीं · ${missed.length}`)}</span>
          <span style={MUTED}>{say("These periods had started before the teacher was marked away, so cover was not arranged by itself. For a period running now, send a teacher in; for one already over, check that the class had someone.", "शिक्षक को अनुपस्थित दर्ज करने से पहले ये पीरियड शुरू हो चुके थे, इसलिए व्यवस्था अपने-आप नहीं हुई। जो पीरियड अभी चल रहा है, उसमें शिक्षक भेजें; जो ख़त्म हो चुका, उसमें देख लें कि कक्षा में कोई था।")}</span>
          {missed.map((x, i) => {
            const bell = data.bells.find((b) => b.index === x.period);
            return (
              <div key={x.key} style={{ display: "flex", alignItems: "center", gap: 12, padding: "8px 0", borderTop: i ? "1px solid var(--bd)" : 0 }}>
                <span style={{ flex: "none", width: 54, borderRadius: 12, padding: "6px 0", display: "flex", flexDirection: "column", alignItems: "center", background: "var(--warns)", color: "var(--warnfg)" }}>
                  <b>P{periodNumber(x.period)}</b>
                  <span className="num" style={{ fontSize: 11 }}>{bellTime(bell?.starts)}</span>
                </span>
                <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
                  <span style={{ fontWeight: 600 }}>{x.classLabels.join(", ")} · {subjectName(x.subjectCode)}</span>
                  <span style={MUTED}>
                    {x.running
                      ? say(`${x.absentNames.join(", ")} away · running now with no teacher`, `${x.absentNames.join(", ")} अनुपस्थित · अभी चल रहा है, कोई शिक्षक नहीं`)
                      : say(`${x.absentNames.join(", ")} away · missed`, `${x.absentNames.join(", ")} अनुपस्थित · छूट गया`)}
                  </span>
                </span>
                {x.running && c.canCommand ? (
                  <button type="button" className="tap btn pri" disabled={pending} onClick={() => onAssign(x.key)}>
                    <Ic n="send" />
                    {say("Send a teacher now", "अभी शिक्षक भेजें")}
                  </button>
                ) : null}
              </div>
            );
          })}
        </Card>
      ) : null}
      {live.length > 0 && open === 0 && missed.length === 0 ? (
        <Card className="fadein" style={{ padding: "14px 16px", display: "flex", alignItems: "center", gap: 12, background: "var(--oks)", color: "var(--ok)", borderColor: "var(--okm)" }}>
          <svg width={28} height={28} viewBox="0 0 24 24" aria-hidden="true" style={{ flex: "none", animation: "xPopIn .5s var(--spring) both" }}>
            <path d="M5 12.5l4.5 4.5L19 7.5" style={{ fill: "none", stroke: "currentColor", strokeWidth: 2.6, strokeLinecap: "round", strokeLinejoin: "round", ["--len" as string]: 22, strokeDasharray: 22, animation: "xDraw .45s .15s var(--ease) both" }} />
          </svg>
          <span style={{ display: "flex", flexDirection: "column" }}>
            <b>{isToday ? say("Every period today is covered", "आज हर पीरियड की व्यवस्था हो गई") : say(`Every period on ${dayShort(c.day)} is covered`, `${dayShort(c.day)} के हर पीरियड की व्यवस्था हो गई`)}</b>
            <span style={{ fontSize: 13 }}>{say("Each substitute's WhatsApp notice goes from the staff outbox.", "हर शिक्षक का WhatsApp संदेश स्टाफ़ आउटबॉक्स से जाता है।")}</span>
          </span>
        </Card>
      ) : null}
      {live.map((d) => {
        const bell = data.bells.find((b) => b.index === d.period);
        const free = d.candidates.filter((x) => !x.blocked);
        const best = free[0];
        const picked = choice[d.needKey] ?? (d.status === "assigned" ? d.coveringStaffId : best?.id) ?? "";
        const pickedName = d.candidates.find((x) => x.id === picked)?.name;
        const done = d.status === "assigned";
        const now = d.period === nowPeriod;
        const pn = `P${periodNumber(d.period)}`;
        const [tileBg, tileFg] = done ? ["var(--oks)", "var(--ok)"] : now ? ["var(--accs)", "var(--accfg)"] : ["var(--warns)", "var(--warnfg)"];
        return (
          <Card key={d.id} pad={false} style={{ display: "flex", flexDirection: "column", overflow: "hidden", animation: "xIn .3s var(--ease) both" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "14px 16px" }}>
              <span style={{ flex: "none", width: 54, height: 54, borderRadius: 14, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", background: tileBg, color: tileFg, transition: "background-color .3s ease" }}>
                <b>{pn}</b>
                <span className="num" style={{ fontSize: 11 }}>{bellTime(bell?.starts)}</span>
              </span>
              <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
                <span style={{ fontSize: 15, fontWeight: 700 }}>{d.classLabels.join(", ")} · {subjectName(d.subjectCode)}</span>
                <span style={MUTED}>{dutyWhy(d)}</span>
              </span>
              {now ? (
                <span className="pill" style={{ background: "var(--accs)", color: "var(--accfg)" }}>
                  <span style={NOW_DOT} />
                  {say("Now", "अभी")}
                </span>
              ) : null}
              {done ? (
                <span style={{ display: "flex", alignItems: "center", gap: 6, fontWeight: 700, fontSize: 13, color: "var(--ok)", animation: "xPopIn .45s var(--spring) both" }}>
                  <Ic n="check" size={20} stroke={2.8} />
                  <span className="hide-m">{say(`Covered by ${d.coveringName ?? "—"}`, `${d.coveringName ?? "—"} ले रहे हैं`)}</span>
                </span>
              ) : null}
            </div>
            {done ? (
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8, padding: "8px 16px", borderTop: "1px solid var(--bd)", animation: "xIn .3s var(--ease) both" }}>
                <span style={{ ...MUTED, flex: 1, minWidth: 0 }}>{tx(noticeLine(d))}</span>
                {c.canCommand ? (
                  <span style={{ display: "flex", gap: 4 }}>
                    <button type="button" className="tap btn ghost" style={{ height: 36 }} onClick={() => onAssign(d.needKey)}>{say("Change", "बदलें")}</button>
                    <button type="button" className="tap btn ghost" style={{ height: 36 }} disabled={pending} onClick={() => onCover({ intent: "release", needKey: d.needKey })}>{say("Release", "छोड़ें")}</button>
                  </span>
                ) : null}
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", padding: "4px 16px 14px", borderTop: "1px solid var(--bd)" }}>
                {d.reason && d.reasonKey !== "no_candidate" ? <span style={{ fontSize: 13, color: "var(--warnfg)", padding: "8px 0 2px" }}>{tx(d.reason)}</span> : null}
                {c.canCommand ? (
                  <>
                    <div role="radiogroup" aria-label={say(`Who covers ${pn}`, `${pn} कौन लेगा`)} style={{ display: "flex", flexDirection: "column" }}>
                      {free.slice(0, 3).map((x, i) => {
                        const on = picked === x.id;
                        return (
                          <button key={x.id} type="button" role="radio" aria-checked={on} className="tap" onClick={() => setChoice((m) => ({ ...m, [d.needKey]: x.id }))} style={{ width: "100%", display: "flex", alignItems: "center", gap: 12, minHeight: 52, padding: "8px 0", border: 0, borderTop: i ? "1px solid var(--bd)" : 0, background: "transparent", color: "var(--fg)", textAlign: "left" }}>
                            <RadioDot on={on} />
                            <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
                              <span style={{ fontWeight: 600 }}>{x.name}</span>
                              <span style={MUTED}>{candidateWhy(tx, pn, x)}</span>
                            </span>
                            {i === 0 ? <Pill tone="ok">{say("Best match", "सबसे उपयुक्त")}</Pill> : null}
                          </button>
                        );
                      })}
                      {free.length === 0 ? <span style={{ ...MUTED, padding: "10px 0" }}>{say(`Nobody is free in ${pn}. Merge with another section or take it yourself.`, `${pn} में कोई खाली नहीं। दूसरे सेक्शन के साथ मिलाएँ या स्वयं लें।`)}</span> : null}
                    </div>
                    <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8, marginTop: 8 }}>
                      <button type="button" className="tap btn pri mfull" disabled={pending || !picked} onClick={() => onCover({ intent: "assign", needKey: d.needKey, coveringStaffId: picked })}>
                        <Ic n="send" />
                        {pickedName ? say(`Assign ${pickedName}`, `${pickedName} को दें`) : say("Nobody is free", "कोई खाली नहीं")}
                      </button>
                      <button type="button" className="tap btn ghost mfull" onClick={() => onAssign(d.needKey)}>{say(`See all ${free.length} free teachers`, `सभी ${free.length} खाली शिक्षक देखें`)}</button>
                      <span style={MUTED}>1 WhatsApp · {rupees(0.88)}</span>
                    </div>
                  </>
                ) : (
                  <span style={{ ...MUTED, padding: "10px 0 0" }}>{say("Cover is arranged by the coordinator.", "व्यवस्था समन्वयक करते हैं।")}</span>
                )}
              </div>
            )}
          </Card>
        );
      })}
      {live.length === 0 && missed.length === 0 && c.hasTimetable ? <EmptyState icon="checkCircle" title={isToday ? say("No cover needed today", "आज कोई व्यवस्था नहीं चाहिए") : say(`No cover needed on ${dayShort(c.day)}`, `${dayShort(c.day)} को कोई व्यवस्था नहीं चाहिए`)} body={say("Mark a teacher away above and the periods they leave appear here with the best teachers to cover.", "ऊपर शिक्षक को अनुपस्थित दर्ज करें; उनके पीरियड यहाँ सबसे उपयुक्त शिक्षकों के साथ दिखेंगे।")} /> : null}
      <Link href={`/substitutions?day=${c.day}`} className="tap vx-lnk" style={{ fontSize: 13, color: "var(--mut)", alignSelf: "flex-start" }}>{say("Same records, older full-page view: open classic cover →", "वही रिकॉर्ड, पुराना पूरा पेज: पुरानी व्यवस्था स्क्रीन खोलें →")}</Link>
    </>
  );
}

type CoverView = NonNullable<TimetableData["cover"]>;

/** A running period with nobody in it, drawn as a duty still to fill, for the assign sheet. */
function lateDutyView(m: NonNullable<CoverView["missed"]>[number]): CoverDutyView {
  return {
    id: `late:${m.key}`,
    needKey: m.key,
    period: m.period,
    classLabels: m.classLabels,
    subjectCode: m.subjectCode,
    status: "needs_help",
    coveringStaffId: null,
    coveringName: null,
    suggestedStaffId: null,
    absentNames: m.absentNames,
    absentIds: m.absentIds,
    reason: null,
    notice: null,
    candidates: m.candidates ?? [],
  };
}

function candidateWhy(tx: (pair: Pair) => string, pn: string, x: CoverDutyView["candidates"][number]): string {
  const n = x.subsThisWeek;
  return tx({
    en: `${x.blocked ? "Not available" : `Free in ${pn}`} · ${x.detail} · ${n} ${n === 1 ? "sub" : "subs"} this week`,
    hi: `${x.blocked ? "उपलब्ध नहीं" : `${pn} में खाली`} · ${x.detailHi ?? x.detail} · इस सप्ताह ${n} व्यवस्था`,
  });
}

function AssignSheet({ duty, data, pending, subjectName, onClose, onAssign }: { duty: CoverDutyView | null; data: TimetableData; pending: boolean; subjectName: (code: string) => string; onClose: () => void; onAssign: (needKey: string, staffId: string) => void }) {
  const { tx } = useVx();
  const say = (en: string, hi: string) => tx({ en, hi });
  const [pick, setPick] = useState<string | null>(null);
  const [seen, setSeen] = useState<string | null>(null);
  if ((duty?.needKey ?? null) !== seen) {
    setSeen(duty?.needKey ?? null);
    setPick(duty?.coveringStaffId ?? duty?.candidates.find((c) => !c.blocked)?.id ?? null);
  }
  const name = duty?.candidates.find((c) => c.id === pick)?.name;
  const bell = duty ? data.bells.find((b) => b.index === duty.period) : undefined;
  const pn = duty ? `P${periodNumber(duty.period)}` : "";
  const firstFree = duty?.candidates.find((c) => !c.blocked)?.id;
  // What the cover command will queue for them (staff-notices `renderNotice`).
  const notice = duty && name && data.cover
    ? renderNotice({
        kind: duty.status === "assigned" ? "cover_changed" : "cover_assigned",
        staffName: name,
        language: "both",
        day: data.cover.day,
        period: duty.period,
        periodTime: bell ? `${bell.starts}–${bell.ends}` : null,
        classLabels: duty.classLabels,
        subjectCode: duty.subjectCode,
        link: `${typeof window === "undefined" ? "" : window.location.origin}/duty/${duty.id}`,
      }).text
    : null;
  return (
    <Sheet
      open={Boolean(duty)}
      onClose={onClose}
      title={duty ? say(`Cover ${pn} · ${duty.classLabels.join(", ")}`, `व्यवस्था ${pn} · ${duty.classLabels.join(", ")}`) : say("Cover", "व्यवस्था")}
      sub={duty ? `${bell ? `${bellTime(bell.starts)}–${bellTime(bell.ends)} · ` : ""}${subjectName(duty.subjectCode)} · ${say(`${duty.absentNames.join(", ")} is away`, `${duty.absentNames.join(", ")} अनुपस्थित`)}` : undefined}
      footer={
        <>
          <button type="button" className="tap btn sec" style={{ flex: 1 }} onClick={onClose}>{say("Cancel", "रद्द करें")}</button>
          <button type="button" className="tap btn pri" style={{ flex: 1.6 }} disabled={pending || !pick || !duty} onClick={() => duty && pick && onAssign(duty.needKey, pick)}>
            <Ic n="check" />
            {name ? say(`Assign ${name}`, `${name} को दें`) : say("Assign", "दें")}
          </button>
        </>
      }
    >
      {duty ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 14, paddingTop: 4 }}>
          <span className="sech">{say(`Free in ${pn} · best first`, `${pn} में खाली · सबसे उपयुक्त पहले`)}</span>
          {duty.candidates.length === 0 ? <EmptyState icon="users" title={say("Nobody to offer", "देने को कोई नहीं")} body={say("Cover is managed by the coordinator.", "व्यवस्था समन्वयक करते हैं।")} /> : null}
          <div role="radiogroup" aria-label={say(`Who covers ${pn}`, `${pn} कौन लेगा`)} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {duty.candidates.map((c) => {
              const on = pick === c.id;
              return (
                <button key={c.id} type="button" role="radio" aria-checked={on} aria-disabled={c.blocked || undefined} className="tap" onClick={() => !c.blocked && setPick(c.id)} style={{ width: "100%", display: "flex", alignItems: "center", gap: 12, minHeight: 58, padding: "10px 14px", borderRadius: 14, border: on ? "2px solid var(--acc)" : "1px solid var(--bd)", background: on ? "var(--accs)" : "var(--card)", color: "var(--fg)", textAlign: "left", opacity: c.blocked ? 0.55 : 1 }}>
                  <RadioDot on={on} />
                  <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
                    <span style={{ fontWeight: 600 }}>{c.name}</span>
                    <span style={MUTED}>{candidateWhy(tx, pn, c)}</span>
                  </span>
                  {c.id === firstFree ? <Pill tone="ok">{say("Best match", "सबसे उपयुक्त")}</Pill> : c.blocked ? <Pill tone="mut">{say("Busy", "व्यस्त")}</Pill> : null}
                </button>
              );
            })}
          </div>
          {name ? (
            <div className="card" style={{ display: "flex", alignItems: "center", gap: 12, padding: "14px 16px", boxShadow: "none" }}>
              <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
                <span style={{ fontWeight: 600 }}>{say(`Tell ${name} on WhatsApp`, `${name} को WhatsApp पर बताएँ`)}</span>
                <span style={MUTED}>{say(`Sent with every cover · 1 message · ${rupees(0.88)}`, `हर व्यवस्था के साथ जाता है · 1 संदेश · ${rupees(0.88)}`)}</span>
              </span>
              <Switch on onChange={() => undefined} disabled label={say("Always sent", "हमेशा भेजा जाता है")} />
            </div>
          ) : null}
          {notice ? <WaPreview to={say(`Preview · to ${name}`, `पूर्वावलोकन · ${name} को`)} hi={notice.hi} en={notice.en} /> : null}
        </div>
      ) : null}
    </Sheet>
  );
}

/* ---------------------------------------------------------------- leave */

function askedLine(l: LeaveView, today: string): Pair {
  const day = schoolToday(new Date(l.createdAt));
  if (day === today) {
    const at = bellTime(clock(l.createdAt));
    return p(`asked today ${at}`, `आज ${at} माँगी`);
  }
  if (day === addDay(today, -1)) return p("asked yesterday", "कल माँगी");
  return p(`asked ${dayShort(day)}`, `${dayShort(day)} को माँगी`);
}

function leaveType(l: LeaveView): Pair {
  if (l.span === "first_half") return p(`Half day · P1–P${BREAK_AFTER + 1}`, `आधा दिन · P1–P${BREAK_AFTER + 1}`);
  if (l.span === "second_half") return p(`Half day · after P${BREAK_AFTER + 1}`, `आधा दिन · P${BREAK_AFTER + 1} के बाद`);
  const days = schoolDays(l.from, l.to).length;
  return days > 1 ? p(`${days} full days`, `${days} पूरे दिन`) : p("Full day", "पूरा दिन");
}

function Leave({ data, pending, onDecide }: { data: TimetableData; pending: boolean; onDecide: (id: string, approve: boolean) => void }) {
  const { tx } = useVx();
  const say = (en: string, hi: string) => tx({ en, hi });
  // Most urgent first: today and tomorrow, then later days, and days already gone last.
  const waiting = sortLeaveByUrgency(data.leave.filter((l) => l.status === "asked"), data.today);
  const approved = data.leave.filter((l) => l.status === "approved" && l.to >= data.today);
  const first = data.week[0] ?? data.today;
  const strip = Array.from({ length: 14 }, (_, i) => addDay(first, i));
  const awayOn = (day: string) => data.leave.filter((l) => l.from <= day && day <= l.to);
  const sub = (l: LeaveView, extra?: Pair) => [tx(leaveType(l)), l.note, extra ? tx(extra) : null].filter(Boolean).join(" · ");

  return (
    <>
      <Card style={{ padding: "14px 16px", display: "flex", flexDirection: "column", gap: 10 }}>
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
          <span style={{ fontSize: 15, fontWeight: 700 }}>{say(`Who is away · ${dateSpan(strip[0], strip[strip.length - 1])}`, `कौन अनुपस्थित है · ${dateSpan(strip[0], strip[strip.length - 1])}`)}</span>
          <span style={{ display: "flex", gap: 10, fontSize: 12, color: "var(--mut)" }}>
            <span style={{ display: "flex", alignItems: "center", gap: 4 }}><Dot color="var(--acc)" />{say("Approved", "स्वीकृत")}</span>
            <span style={{ display: "flex", alignItems: "center", gap: 4 }}><Dot color="transparent" style={{ border: "1.5px dashed var(--warn)" }} />{say("Asked", "माँगी गई")}</span>
          </span>
        </div>
        <div className="hs" style={{ display: "flex", gap: 6 }}>
          {strip.map((day) => {
            const sunday = weekdayOf(day) === null;
            const today = day === data.today;
            const who = sunday ? [] : awayOn(day).slice(0, 3);
            return (
              <div key={day} style={{ flex: "none", width: 60, padding: "8px 4px", borderRadius: 12, display: "flex", flexDirection: "column", alignItems: "center", gap: 4, background: today ? "var(--accs)" : sunday ? "var(--s2)" : "var(--card)", border: `1px solid ${today ? "var(--acc)" : "var(--bd)"}`, opacity: sunday ? 0.55 : 1 }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: "var(--mut)" }}>{dayShort(day).split(" ")[0]}</span>
                <b className="num">{Number(day.slice(8))}</b>
                <span style={{ display: "flex", minHeight: 24, paddingLeft: 4 }}>
                  {who.map((l) => {
                    const [bg, fg] = toneOf(l.name);
                    const ok = l.status === "approved";
                    return (
                      <span key={l.id} title={`${l.name} · ${ok ? say("approved", "स्वीकृत") : say("asked", "माँगी गई")}`} style={{ width: 24, height: 24, borderRadius: 12, marginLeft: -4, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 9, fontWeight: 700, border: ok ? "2px solid var(--card)" : "1.5px dashed var(--warn)", background: ok ? V(bg) : "var(--card)", color: V(fg), animation: "xPopIn .35s var(--spring) both" }}>
                        {ini(l.name)}
                      </span>
                    );
                  })}
                </span>
              </div>
            );
          })}
        </div>
      </Card>
      <span className="sech">{data.me.mayCover ? say(`Waiting for you · ${waiting.length}`, `आपके निर्णय के लिए · ${waiting.length}`) : say(`Asked · ${waiting.length}`, `माँगी गई · ${waiting.length}`)}</span>
      {waiting.map((l) => {
        const periods = periodsNeedingCover(data.slots, l.staffId, l.from, l.to, l.span, new Set(data.closedDays ?? []));
        const past = l.to < data.today;
        return (
          <Card key={l.id} style={{ padding: "14px 16px", display: "flex", flexWrap: "wrap", alignItems: "center", gap: 12, animation: "xIn .3s var(--ease) both" }}>
            <Ava name={l.name} />
            <span style={{ flex: 1, minWidth: 210, display: "flex", flexDirection: "column" }}>
              <span style={{ fontWeight: 600 }}>{l.name} · {dayRange(l.from, l.to)}</span>
              <span style={MUTED}>{sub(l, askedLine(l, data.today))}</span>
              {past ? (
                <span style={{ fontSize: 13, color: "var(--warnfg)" }}>{say("These days have passed · record it as taken, or decline it", "ये दिन बीत चुके हैं · ली गई दर्ज करें, या अस्वीकार करें")}</span>
              ) : periods === 0 ? (
                <span style={MUTED}>{say("No lessons need cover on these days", "इन दिनों किसी पीरियड में व्यवस्था नहीं चाहिए")}</span>
              ) : (
                <span style={{ fontSize: 13, color: "var(--warnfg)" }}>{say(`${periods} ${periods === 1 ? "period" : "periods"} will need cover`, `${periods} पीरियड में व्यवस्था चाहिए होगी`)}</span>
              )}
            </span>
            {past ? <Pill tone="warn">{say("Date passed", "तारीख़ निकल गई")}</Pill> : l.from <= addDay(data.today, 1) ? <Pill tone="bad">{l.from <= data.today ? say("Today", "आज") : say("Tomorrow", "कल")}</Pill> : null}
            {data.me.mayCover ? (
              <span className="mfull" style={{ display: "flex", gap: 8 }}>
                <button type="button" className="tap btn ghost" style={{ flex: 1 }} disabled={pending} onClick={() => onDecide(l.id, false)}>{say("Decline", "अस्वीकार करें")}</button>
                <button type="button" className="tap btn pri" style={{ flex: 1 }} disabled={pending} onClick={() => onDecide(l.id, true)}>
                  <Ic n="check" />
                  {past ? say("Record as taken", "ली गई दर्ज करें") : say("Approve", "स्वीकार करें")}
                </button>
              </span>
            ) : null}
          </Card>
        );
      })}
      {waiting.length === 0 ? (
        <Card className="fadein" style={{ padding: 24, display: "flex", flexDirection: "column", alignItems: "center", gap: 6, textAlign: "center" }}>
          <Ic n="checkCircle" size={26} style={{ color: "var(--ok)" }} />
          <b>{say("No leave requests waiting", "कोई छुट्टी अनुरोध बाकी नहीं")}</b>
          <span style={MUTED}>{say("New requests from teachers show up here.", "शिक्षकों के नए अनुरोध यहाँ दिखेंगे।")}</span>
        </Card>
      ) : null}
      {approved.length ? <span className="sech">{say("Approved · coming up", "स्वीकृत · आगे")}</span> : null}
      {approved.length ? (
        <Card pad={false}>
          {approved.map((l, i) => (
            <div key={l.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 16px", borderTop: i ? "1px solid var(--bd)" : 0, ...rise(i) }}>
              <Ava name={l.name} />
              <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
                <span style={{ fontWeight: 600 }}>{l.name} · {dayRange(l.from, l.to)}</span>
                <span style={MUTED}>{sub(l)}</span>
              </span>
              <span className="hide-m" style={MUTED}>
                {l.decidedBy && l.decidedAt
                  ? say(`Approved by ${l.decidedBy} · ${dayShort(schoolToday(new Date(l.decidedAt)))}`, `${l.decidedBy} ने स्वीकृत की · ${dayShort(schoolToday(new Date(l.decidedAt)))}`)
                  : say("Approved", "स्वीकृत")}
              </span>
            </div>
          ))}
        </Card>
      ) : null}
    </>
  );
}

const REASONS: Pair[] = [p("Sick", "बीमार"), p("Family", "परिवार"), p("Personal", "निजी"), p("School duty", "विद्यालय कार्य")];

function LeaveSheet({ open, data, pending, onClose, onSave }: { open: boolean; data: TimetableData; pending: boolean; onClose: () => void; onSave: (input: { staffId: string; from: string; to: string; span: string; note?: string }) => void }) {
  const { tx } = useVx();
  const say = (en: string, hi: string) => tx({ en, hi });
  const [staffId, setStaffId] = useState(data.me.mayCover ? "" : data.me.id);
  const [from, setFrom] = useState(data.today);
  const [to, setTo] = useState(data.today);
  const [span, setSpan] = useState<LeaveSpan>("full");
  const [reason, setReason] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const problems = leaveProblems({ staffId, from, to });
  const closed = new Set(data.closedDays ?? []);
  const periods = staffId && !problems.length ? periodsNeedingCover(data.slots, staffId, from, to, span, closed) : 0;
  // A leave only on days the school is closed is refused by the server; say so before Save.
  const allClosed = !problems.length && schoolDays(from, to).every((day) => closed.has(day) || weekdayOf(day) === null);
  const who = data.teachers.find((t) => t.id === staffId)?.name ?? say("This teacher", "यह शिक्षक");
  // The reason chip leads the note, as the design keeps them: "Sick · …". Stored in English.
  const fullNote = [reason, note.trim()].filter(Boolean).join(" · ").slice(0, 200);
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={data.me.mayCover ? say("Add leave", "छुट्टी जोड़ें") : say("Ask for leave", "छुट्टी माँगें")}
      sub={data.me.mayCover ? say("Saved as asked · approve it to arrange cover", "माँगी गई के रूप में सहेजी जाती है · स्वीकार करने पर व्यवस्था होती है") : say("Your coordinator approves it", "समन्वयक इसे स्वीकार करेंगे")}
      footer={
        <>
          <button type="button" className="tap btn sec" style={{ flex: 1 }} onClick={onClose}>{say("Cancel", "रद्द करें")}</button>
          <button type="button" className="tap btn pri" style={{ flex: 1.6 }} disabled={pending || problems.length > 0 || allClosed} onClick={() => onSave({ staffId, from, to, span, note: fullNote })}>
            <Ic n="check" />
            {data.me.mayCover ? say("Save leave", "छुट्टी सहेजें") : say("Ask for leave", "छुट्टी माँगें")}
          </button>
        </>
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 14, paddingTop: 4 }}>
        {data.me.mayCover ? (
          <Field label={say("Teacher", "शिक्षक")}>
            <Select value={staffId} onChange={(e) => setStaffId(e.target.value)}>
              <option value="">{say("Pick a teacher…", "शिक्षक चुनें…")}</option>
              {data.teachers.map((t) => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </Select>
          </Field>
        ) : null}
        <div className="g2" style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0,1fr))", gap: 12 }}>
          <Field label={say("From", "से")}><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
          <Field label={say("To", "तक")}><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
        </div>
        <div className="field">
          <span>{say("How long", "कितना")}</span>
          <Seg<LeaveSpan>
            label={say("How long", "कितना")}
            value={span}
            onChange={setSpan}
            options={[
              { value: "full", label: say("Full day", "पूरा दिन") },
              { value: "first_half", label: `P1–P${BREAK_AFTER + 1}` },
              { value: "second_half", label: `P${BREAK_AFTER + 2}–P${PERIODS.length}` },
            ]}
          />
        </div>
        <div className="field">
          <span>{say("Reason", "कारण")}</span>
          <div role="group" aria-label={say("Reason", "कारण")} style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {REASONS.map((r) => (
              <Chip key={r.en} on={reason === r.en} onClick={() => setReason(reason === r.en ? null : r.en)}>{tx(r)}</Chip>
            ))}
          </div>
        </div>
        <Field label={say("Note (optional)", "टिप्पणी (वैकल्पिक)")} hint={say("Kept for the office. Never sent in a notice.", "केवल कार्यालय के लिए। किसी संदेश में नहीं जाती।")}>
          <Textarea value={note} maxLength={180} onChange={(e) => setNote(e.target.value)} placeholder={say("Anything the office should know", "कार्यालय को कुछ बताना हो")} style={{ minHeight: 64 }} />
        </Field>
        <div style={{ padding: "12px 14px", borderRadius: 14, fontSize: 13, lineHeight: 1.5, display: "flex", gap: 10, background: problems.length ? "var(--warns)" : "var(--infos)", color: problems.length ? "var(--warnfg)" : "var(--info)" }}>
          <Ic n={problems.length ? "alert" : "info"} style={{ marginTop: 2 }} />
          <span>
            {problems.length
              ? tx(LEAVE_PROBLEMS[problems[0]])
              : allClosed
                ? say("School is closed on these days, so no leave is needed.", "इन दिनों स्कूल बंद है, इसलिए छुट्टी की ज़रूरत नहीं।")
                : say(`${who} has ${periods} ${periods === 1 ? "period" : "periods"} in these days. Once approved they show up under Cover.`, `इन दिनों ${who} के ${periods} पीरियड हैं। स्वीकार होने पर वे व्यवस्था में दिखेंगे।`)}
          </span>
        </div>
      </div>
    </Sheet>
  );
}

/* ---------------------------------------------------------------- publish */

function PublishScreen({
  data,
  subjectName,
  subjectPair,
  teacherName,
  pending,
  previewing,
  classHref,
  onRemove,
  onPublish,
}: {
  data: TimetableData;
  subjectName: (code: string) => string;
  subjectPair: (code: string) => Pair;
  teacherName: Map<string, string>;
  pending: boolean;
  previewing: boolean;
  classHref: string;
  onRemove: (id: string) => void;
  onPublish: (notify: boolean, after: () => void) => void;
}) {
  const { tx } = useVx();
  const say = (en: string, hi: string) => tx({ en, hi });
  const [notify, setNotify] = useState(true);
  const [published, setPublished] = useState(false);
  const changes: PendingChange[] = data.changes;
  const affected = affectedTeachers(changes, data.slots);
  const [firstId, firstList] = [...affected.entries()][0] ?? [null, []];
  const preview = firstId ? changeNotice(teacherName.get(firstId) ?? "teacher", firstList, (code) => subjectPair(code).en) : null;
  const n = changes.length;
  const told = notify ? affected.size : 0;
  const when = (iso: string) => {
    const day = schoolToday(new Date(iso));
    return day === data.today ? say(`Today ${bellTime(clock(iso))}`, `आज ${bellTime(clock(iso))}`) : dayShort(day);
  };
  const versions = data.versions ?? [];

  if (published && n === 0) {
    return (
      <>
        <Card className="fadein" style={{ padding: "32px 28px", display: "flex", flexDirection: "column", alignItems: "center", gap: 12, textAlign: "center" }}>
          <svg width={96} height={96} viewBox="0 0 96 96" aria-hidden="true" style={{ animation: "xPopIn .5s var(--spring) both" }}>
            <circle cx={48} cy={48} r={44} style={{ fill: "var(--oks)" }} />
            <circle cx={48} cy={48} r={44} style={{ fill: "none", stroke: "var(--ok)", strokeWidth: 4, ["--len" as string]: 276.5, strokeDasharray: 276.5, animation: "xDraw .7s .1s var(--ease) both" }} />
            <path d="M30 49l12 12 24-26" style={{ fill: "none", stroke: "var(--ok)", strokeWidth: 6, strokeLinecap: "round", strokeLinejoin: "round", ["--len" as string]: 60, strokeDasharray: 60, animation: "xDraw .45s .5s var(--ease) both" }} />
          </svg>
          <span className="serif" style={{ fontSize: 26, fontWeight: 600 }}>{data.version ? say(`${data.version.label} is live`, `${data.version.label} लागू है`) : say("Published", "प्रकाशित")}</span>
          <span style={{ color: "var(--mut)" }}>{say("Teachers see it in their app.", "शिक्षक इसे अपने ऐप में देखते हैं।")}</span>
          <Btn variant="pri" href={classHref}>{say("Back to timetable", "समय सारणी पर वापस")}</Btn>
        </Card>
        <Versions versions={versions} />
      </>
    );
  }

  return (
    <>
      <Card pad={false} style={{ overflow: "hidden" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, padding: "12px 16px", background: "var(--s2)", borderBottom: "1px solid var(--bd)" }}>
          <span className="sech">{say(`Changes not published · ${n}`, `अप्रकाशित बदलाव · ${n}`)}</span>
          <span style={MUTED}>{say("Teachers still see the old timetable", "शिक्षक अभी पुरानी समय सारणी देखते हैं")}</span>
        </div>
        {changes.map((c, i) => {
          const bell = data.bells.find((b) => b.index === c.period);
          const day = (WEEK as readonly string[]).includes(c.day) ? WEEK_SHORT[c.day as Weekday] : c.day;
          return (
            <div key={c.id} style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 12, padding: "12px 16px", borderTop: i ? "1px solid var(--bd)" : 0, ...rise(i) }}>
              <span style={{ minWidth: 130, display: "flex", flexDirection: "column" }}>
                <b>{c.classLabel} · {day} P{periodNumber(c.period)}</b>
                <span className="num" style={MUTED}>{bell ? `${bellTime(bell.starts)}–${bellTime(bell.ends)}` : ""}</span>
              </span>
              <span style={{ flex: 1, minWidth: 230, display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
                <span className="pill" style={{ height: 28, padding: "0 10px", fontSize: 12, textDecoration: "line-through", background: "var(--s2)", color: "var(--mut)" }}>
                  {c.fromSubjectCode ? `${subjectName(c.fromSubjectCode)}${c.fromTeacher ? ` · ${c.fromTeacher}` : ""}` : say("Free", "खाली")}
                </span>
                <Ic n="arrowRight" style={{ color: "var(--sub)" }} />
                <span className="pill" style={{ height: 28, padding: "0 10px", fontSize: 12, background: tint(c.subjectCode), color: "var(--fg)" }}>
                  {subjectName(c.subjectCode)} · {teacherName.get(c.staffProfileId) ?? c.teacherShortName}
                </span>
              </span>
              <span style={MUTED}>{[c.createdBy, when(c.createdAt)].filter(Boolean).join(" · ")}</span>
              <button type="button" className="tap btn ghost" aria-label={say("Drop this change", "यह बदलाव हटाएँ")} disabled={pending || previewing} onClick={() => onRemove(c.id)} style={{ width: 40, padding: 0 }}>
                <Ic n="x" />
              </button>
            </div>
          );
        })}
        {n === 0 ? (
          <div style={{ padding: 26, display: "flex", flexDirection: "column", alignItems: "center", gap: 8, textAlign: "center" }}>
            <b>{say("Nothing waiting to publish", "प्रकाशित करने को कुछ नहीं")}</b>
            <span style={MUTED}>{say("Tap any period in the class timetable to change it.", "बदलने के लिए कक्षा समय सारणी में किसी पीरियड पर टैप करें।")}</span>
            <Btn variant="sec" href={classHref}>{say("Open class timetable", "कक्षा समय सारणी खोलें")}</Btn>
          </div>
        ) : null}
      </Card>
      <Card style={{ padding: "14px 16px", display: "flex", flexDirection: "column", gap: 8 }}>
        <span className="sech">{say("Starts from", "कब से")}</span>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          <Chip on>{say("As soon as you publish", "प्रकाशित करते ही")}</Chip>
        </div>
      </Card>
      <button type="button" role="switch" aria-checked={notify} className="tap card" onClick={() => setNotify((v) => !v)} style={{ width: "100%", display: "flex", alignItems: "center", gap: 12, padding: "14px 16px", textAlign: "left", color: "var(--fg)" }}>
        <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
          <span style={{ fontWeight: 600 }}>{say("Tell affected teachers on WhatsApp", "प्रभावित शिक्षकों को WhatsApp पर बताएँ")}</span>
          <span style={MUTED}>
            {notify
              ? say(`${affected.size} ${affected.size === 1 ? "teacher" : "teachers"} · ${affected.size} ${affected.size === 1 ? "message" : "messages"} · ${rupees(affected.size * 0.88)}`, `${affected.size} शिक्षक · ${affected.size} संदेश · ${rupees(affected.size * 0.88)}`)
              : say("Nobody is told · they will see it next time they open the app", "किसी को नहीं बताया जाएगा · ऐप खोलने पर दिखेगा")}
          </span>
        </span>
        <span className={`sw${notify ? " on" : ""}`} aria-hidden="true"><span /></span>
      </button>
      {notify && preview && firstId ? (
        <>
          <WaPreview
            to={affected.size > 1 ? say(`Preview · to ${teacherName.get(firstId) ?? ""} (each one gets their own changes)`, `पूर्वावलोकन · ${teacherName.get(firstId) ?? ""} को (हर शिक्षक को उनके अपने बदलाव)`) : say(`Preview · to ${teacherName.get(firstId) ?? ""}`, `पूर्वावलोकन · ${teacherName.get(firstId) ?? ""} को`)}
            hi={preview.hi}
            en={preview.en}
          />
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {[...affected.keys()].map((id) => (
              <span key={id} className="pill" style={{ height: 26, padding: "0 10px", fontSize: 12, background: "var(--s2)", color: "var(--fg)", border: "1px solid var(--bd)" }}>{teacherName.get(id) ?? "—"}</span>
            ))}
          </div>
        </>
      ) : null}
      <button type="button" className="tap btn pri" style={{ height: 50, fontSize: 15 }} disabled={pending || previewing || n === 0} onClick={() => onPublish(notify, () => setPublished(true))}>
        <Ic n="upload" />
        {pending
          ? say("Publishing…", "प्रकाशित हो रहा है…")
          : n === 0
            ? say("Nothing to publish", "प्रकाशित करने को कुछ नहीं")
            : told
              ? say(`Publish ${n} ${n === 1 ? "change" : "changes"} and tell ${told} ${told === 1 ? "teacher" : "teachers"}`, `${n} बदलाव प्रकाशित करें और ${told} शिक्षकों को बताएँ`)
              : say(`Publish ${n} ${n === 1 ? "change" : "changes"}`, `${n} बदलाव प्रकाशित करें`)}
      </button>
      <Versions versions={versions} />
    </>
  );
}

function Versions({ versions }: { versions: NonNullable<TimetableData["versions"]> }) {
  const { tx } = useVx();
  if (versions.length === 0) return null;
  return (
    <Card style={{ padding: "14px 16px", display: "flex", flexDirection: "column" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 6 }}>
        <span className="sech">{tx(p("Versions · newest first", "संस्करण · नए पहले"))}</span>
        <Link href="/timetable/classic" style={{ fontSize: 12, fontWeight: 700, color: "var(--acc)" }}>{tx(p("All versions & import", "सभी संस्करण और आयात"))}</Link>
      </div>
      {versions.map((v, i) => (
        <div key={v.id} style={{ display: "grid", gridTemplateColumns: "10px minmax(0,1fr) auto", gap: 10, alignItems: "start", padding: "6px 0", fontSize: 13, ...rise(i) }}>
          <i style={{ width: 10, height: 10, marginTop: 4, borderRadius: 5, background: i ? "var(--sub)" : "var(--acc)" }} />
          <span>{v.label}</span>
          <span className="num" style={MUTED}>{v.publishedAt ? dayShort(schoolToday(new Date(v.publishedAt))) : "—"}</span>
        </div>
      ))}
    </Card>
  );
}
