"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";

import { draftKey } from "@/platform/drafts/policy";
import { loadDraft, removeDraft, saveDraft } from "@/platform/drafts/store";
import { useOnline } from "@/platform/drafts/use-durable-draft";
import { Ic, type IconName } from "@/vx/icons";
import { useVx } from "@/vx/i18n";
import { dayMonth, initials } from "@/vx/format";
import { p, type Pair } from "@/vx/text";
import { Textarea } from "@/vx/ui/controls";
import { Sheet, useToast } from "@/vx/ui/overlays";
import { VxPage } from "@/vx/ui/page";

import { checkRegisterVx, saveRegisterVx, type VxSaveState } from "../actions";
import type { AttendChoices, AttendData } from "../data";
import { absentAlert, absentOften, copyYesterday, countMarks, monthGrid, nextTap, shiftMonth, type Mark } from "../domain/teach";
import { ampm, andList, dShort } from "./fmt";
import { DrawnTick, HelpIcon, HelpSheet, LangSeg, TchTop, useUrlState, type HelpStep } from "./shared";

/*
 * Teacher · Attendance (design TchAttend). Everyone starts Present; a tap
 * makes a child Absent, a second Half-day (RULES C renames the design's
 * Leave), a third Present again. Until the teacher presses Save, the office
 * sees the class as Not marked — never as present. After saving: the saved
 * card, with Change any time (D-248: no window, no request to the office).
 * The month view by `?view=history`. Saves wait in the phone's outbox when
 * offline and are sent with the same id when the phone is back online.
 */

type SheetKey = "save" | "help";
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
  { title: p("Tap a child who is away", "एक बार = अनुपस्थित, दो बार = आधा दिन।"), body: p("Once = Absent (red). Twice = Half-day (yellow). Three times = Present again.", "एक बार = अनुपस्थित (लाल)। दो बार = आधा दिन (पीला)। तीन बार = फिर उपस्थित।"), pic: MINI([[V("card"), V("ok")], [V("bads"), V("bad")], [V("warns"), V("warn")]]) },
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
const WHY: Pair[] = [p("Came late", "देर से आया"), p("Went home sick", "बीमार होकर घर गया"), p("Marked by mistake", "गलती से दर्ज"), p("Was on a school trip", "स्कूल ट्रिप पर था")];

function newId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : "10000000-1000-4000-8000-100000000000".replace(/[018]/g, (c) => (Number(c) ^ ((Math.random() * 16) >> (Number(c) / 4))).toString(16));
}

type Outbox = { payload: string; alerts: boolean; commandId: string; at: number };

/** The time a draft was written; called from event handlers only. */
function stamp(): number {
  return Date.now();
}

/* --------------------------------------------------------- choose a class */

export function AttendChoose({ data }: { data: AttendChoices }) {
  const { tx, sub } = useVx();
  return (
    <VxPage className="tc">
      <TchTop crumb={`${tx(p("Attendance", "हाज़िरी"))}${sub(p("Attendance", "हाज़िरी")) ? ` · ${sub(p("Attendance", "हाज़िरी"))}` : ""}`} title={tx(p("Choose a class", "कक्षा चुनें"))} mBack="/teach" actions={<LangSeg />} mAction={<LangSeg />} />
      <main>
        <div className="pad" style={{ padding: "20px 28px 40px", maxWidth: 720 }}>
          {data.choices.length === 0 ? (
            <div className="card" style={{ padding: "32px 20px", display: "flex", flexDirection: "column", alignItems: "center", gap: 10, textAlign: "center" }}>
              <span className="tc-av" style={{ width: 56, height: 56, background: "var(--s2)", color: "var(--mut)" }}><Ic n="calCheck" size={26} /></span>
              <span className="tc-p" style={{ fontWeight: 700 }}>{tx(p("You do not take a register", "आप हाज़िरी नहीं लेते"))}</span>
              <span className="tc-s">{tx(p("Class teachers take the daily register.", "दैनिक हाज़िरी कक्षा अध्यापक लेते हैं।"))}</span>
            </div>
          ) : (
            <div className="card" style={{ overflow: "hidden" }}>
              {data.choices.map((c, i) => (
                <Link key={c.classId} href={`/teach/attendance?class=${c.classId}&day=${data.day}`} className="row tap" style={{ display: "flex", alignItems: "center", gap: 12, padding: "14px 18px", borderTop: i ? "1px solid var(--bd)" : 0, minHeight: 60 }}>
                  <span className="tc-ib" style={{ width: 40, height: 40, borderRadius: 12, background: "var(--accs)", color: "var(--accfg)" }}><Ic n="users" /></span>
                  <span className="tc-p" style={{ flex: 1, fontWeight: 700 }}>{c.classLabel}</span>
                  <Ic n="chevRight" />
                </Link>
              ))}
            </div>
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
}: {
  data: AttendData;
  ownerId: string;
  initialSheet: string | null;
  initialView: string | null;
  school: string;
  officePhone?: string;
}) {
  const { tx, sub, language } = useVx();
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
  const nP = counts.present + counts.late;
  const nA = counts.absent;
  const nH = counts.halfDay + counts.leave;
  const total = Math.max(1, counts.total);
  const absentKids = data.roll.filter((r) => marks[r.id] === "absent");
  const halfKids = data.roll.filter((r) => sOf(marks[r.id]) === "H");
  const often = useMemo(() => new Map(absentOften(data.monthMarks, 3).map((o) => [o.studentId, o.absent])), [data.monthMarks]);
  const yesterdayIds = Object.entries(data.yesterday).filter(([, m]) => m === "absent").map(([id]) => id);
  // The class teacher changes her own register whenever she needs to, and the
  // office any register; nobody approves it (D-248).
  const mayChangeHere = data.canCorrect && !data.closed;

  // The marks as last set, so two taps in one frame both count.
  const latest = useRef(marks);
  useEffect(() => {
    latest.current = marks;
  }, [marks]);
  const tap = (id: string) => {
    if (!editing) return;
    rememberChanges([id]);
    const next = { ...latest.current, [id]: nextTap(latest.current[id]) };
    latest.current = next;
    setMarks(next);
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
      toast.show({ text: tx(p(`Saved at ${ampm(res.receipt.savedAt)}. The office can see it now.`, `${ampm(res.receipt.savedAt)} बजे सहेजा। ऑफ़िस अब देख सकता है।`)) });
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

  const q = query.trim().toLowerCase();
  const shown = data.roll.filter((r) => !q || r.name.toLowerCase().includes(q) || (r.rollNo ?? "") === q);
  const preview = absentKids[0] ? absentAlert({ childName: absentKids[0].name, classLabel: data.classLabel, dayLabel: dayMonth(data.day), school }) : null;
  const rollOf = (id: string) => data.roll.find((r) => r.id === id)?.rollNo ?? "—";
  const nameOf = new Map(data.roll.map((r) => [r.id, r.name]));
  const T = (t: Pair) => `${tx(t)}${sub(t) ? ` · ${sub(t)}` : ""}`;

  /* ------------------------------------------------------------- pieces */

  const tiles = (size: number) => (
    <div style={{ width: "100%", display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 8 }}>
      {([["P", nP, V("oks"), V("ok")], ["A", nA, V("bads"), V("bad")], ["H", nH, V("warns"), V("warnfg")]] as const).map(([k, n, bg, fg], i) => (
        <div key={k} className="tc-ctile tc-pop" style={{ background: bg, color: fg, animationDelay: `${200 + i * 90}ms` }}>
          <span className="num" style={{ fontSize: size, fontWeight: 700, lineHeight: 1.1 }}>{n}</span>
          <span style={{ fontSize: 13, fontWeight: 700 }}>{tx(LOOK[k].t)}</span>
        </div>
      ))}
    </div>
  );

  const kidCard = (r: AttendData["roll"][number], i: number) => {
    const s = sOf(marks[r.id]);
    const lk = LOOK[s];
    const n = often.get(r.id);
    const hint: { text: string; icon: IconName; color: string } | null = n
      ? { text: tx(p(`${n} days absent · call parents?`, `${n} दिन अनुपस्थित · माता-पिता को फ़ोन?`)), icon: "phone", color: V("warnfg") }
      : r.birthday
        ? { text: tx(p("Birthday today", "आज जन्मदिन")), icon: "cake", color: V("acc") }
        : yesterdayIds.includes(r.id) && s === "P"
          ? { text: tx(p("Absent yesterday", "कल अनुपस्थित")), icon: "info", color: V("mut") }
          : null;
    const tone = TONES[(Number(r.rollNo) || i + 1) % 5];
    return (
      <button
        key={r.id}
        type="button"
        disabled={!editing}
        onClick={() => tap(r.id)}
        className={`tap tc-akid ${lk.cls}`}
        aria-label={`${r.name}, roll ${r.rollNo ?? i + 1}, ${tx(lk.t)}. ${tx(p("Tap to change.", "बदलने के लिए टैप करें।"))}`}
        aria-pressed={s !== "P"}
        style={{ background: lk.bg, borderColor: lk.bd, animationDelay: `${Math.min(i, 16) * 22}ms` }}
      >
        <span className="num" style={{ flex: "none", width: 22, fontSize: 13, fontWeight: 700, textAlign: "right", color: "var(--mut)" }}>{r.rollNo ?? i + 1}</span>
        <span className="tc-av" style={{ width: 40, height: 40, fontSize: 13, background: tone[0], color: tone[1] }}>{initials(r.name)}</span>
        <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 1 }}>
          <span className="tc-el" style={{ fontSize: 15, fontWeight: 600 }}>{r.name}</span>
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
    );
  };

  /* ---------------------------------------------------------- mark view */
  const allYesterday = yesterdayIds.length > 0 && yesterdayIds.every((id) => marks[id] === "absent");
  const parts = [tx(p(`${nP} present`, `${nP} उपस्थित`)), tx(p(`${nA} absent`, `${nA} अनुपस्थित`))].concat(nH ? [tx(p(`${nH} half-day`, `${nH} आधा दिन`))] : []).join(" · ");
  const savedAt = data.receipt ? ampm(data.receipt.savedAt) : null;
  const markView = (
    <div style={{ display: "flex", flexDirection: "column", minHeight: "100%" }}>
      <div className="pad stack" style={{ flex: 1, display: "grid", gridTemplateColumns: "minmax(0, 1fr) 300px", gap: 20, alignItems: "start", padding: "20px 28px 24px" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 14, minWidth: 0 }}>
          <div className="tc-note tc-in" style={{ background: editing === "change" ? V("warns") : V("accs"), color: editing === "change" ? V("warnfg") : V("accfg"), padding: "14px 16px", alignItems: "center" }}>
            <span className="tc-ib" style={{ width: 42, height: 42, borderRadius: 13, background: "var(--card)" }}><Ic n={editing === "change" ? "edit" : "sun"} size={22} /></span>
            <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
              <span className="tc-p" style={{ fontWeight: 700 }}>{editing === "change" ? tx(p("You are changing today’s attendance", "आप आज की हाज़िरी बदल रही हैं")) : tx(p("Everyone is marked Present.", "सभी बच्चे उपस्थित माने गए हैं।"))}</span>
              <span style={{ fontSize: 13, opacity: 0.85 }}>
                {editing === "change"
                  ? tx(p(`The office still sees what you saved${savedAt ? ` at ${savedAt}` : ""} until you save again.`, `दोबारा सेव करने तक ऑफ़िस को पहले वाली हाज़िरी दिखेगी।`))
                  : T(p("Tap only the children who are absent.", "सिर्फ़ अनुपस्थित बच्चों पर टैप करें।"))}
              </span>
            </span>
          </div>
          <div className="tc-cnt">
            {([["P", nP, V("ok"), V("okm")], ["A", nA, V("bad"), V("bad")], ["H", nH, V("warn"), V("warnm")]] as const).map(([k, n, c, bd]) => (
              <div key={k} className="card" style={{ padding: "12px 14px", display: "flex", flexDirection: "column", gap: 2, borderColor: n && k !== "P" ? bd : "var(--bd)", overflow: "hidden" }}>
                <span style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, fontWeight: 600 }}>
                  <span style={{ flex: "none", width: 9, height: 9, borderRadius: 5, background: c }} />
                  <span className="tc-el">{tx(LOOK[k].t)}</span>
                </span>
                <span className="num" style={{ color: c }}><span key={n} className="tc-n">{n}</span></span>
                {sub(LOOK[k].t) ? <span className="tc-s tc-el">{sub(LOOK[k].t)}</span> : null}
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
                    if (allYesterday) {
                      toast.show({ text: tx(p(`${andList(yesterdayIds.map((id) => nameOf.get(id) ?? ""))} already marked Absent`, "पहले से अनुपस्थित")) });
                      return;
                    }
                    rememberChanges(ids);
                    setMarks(copyYesterday(ids, data.yesterday));
                    toast.show({ text: tx(p(`${andList(yesterdayIds.map((id) => nameOf.get(id) ?? ""))} marked Absent, like yesterday`, "कल जैसा अनुपस्थित किया")) });
                  }}
                  style={{ height: 42, padding: "0 16px", fontSize: 14 }}
                >
                  <Ic n={allYesterday ? "check" : "undo"} size={16} />
                  {tx(p("Same as yesterday", "कल जैसा"))} ({yesterdayIds.length})
                </button>
              ) : null}
              {editing === "change" ? (
                <button type="button" className="tap chip" onClick={() => { rememberChanges(ids); setEditing(null); setMarks({ ...fresh, ...data.saved }); }} style={{ height: 42, padding: "0 16px", fontSize: 14 }}>
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
              <span className="sr">{tx(p("Find a child", "बच्चा खोजें"))}</span>
              <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={tx(p("Find a child", "नाम या रोल नंबर खोजें"))} style={{ flex: 1, minWidth: 0, height: 40, border: 0, outline: "none", background: "transparent", fontSize: 16, color: "var(--fg)" }} />
            </label>
          </div>
          <span className="tc-s">{T(p("Tap once for Absent, twice for Half-day, three times for Present again", "एक बार टैप = अनुपस्थित, दो बार = आधा दिन"))}</span>
          <div className="tc-agrid">{shown.map(kidCard)}</div>
          {shown.length === 0 ? (
            <div className="card tc-in" style={{ padding: "32px 20px", display: "flex", flexDirection: "column", alignItems: "center", gap: 10, textAlign: "center" }}>
              <span className="tc-av" style={{ width: 56, height: 56, background: "var(--s2)", color: "var(--mut)" }}><Ic n="search" size={26} /></span>
              <span className="tc-p" style={{ fontWeight: 700 }}>{tx(p(`No child called “${query}”`, `“${query}” नाम का कोई बच्चा नहीं`))}</span>
              <span className="tc-s">{tx(p("Try the first name or the roll number.", "पहला नाम या रोल नंबर लिखें।"))}</span>
              <button type="button" className="tap btn sec" onClick={() => setQuery("")} style={{ height: 48 }}>{tx(p(`Show all ${data.roll.length}`, `सभी ${data.roll.length} दिखाएँ`))}</button>
            </div>
          ) : null}
        </div>

        <aside className="only-d card" style={{ position: "sticky", top: 84, padding: "18px 20px", display: "flex", flexDirection: "column", gap: 14 }}>
          <span className="sech">{T(p("Today so far", "अब तक"))}</span>
          <div className="tc-stk">
            <span style={{ width: `${((nP / total) * 100).toFixed(1)}%`, background: V("ok") }} />
            <span style={{ width: `${((nA / total) * 100).toFixed(1)}%`, background: V("bad") }} />
            <span style={{ width: `${((nH / total) * 100).toFixed(1)}%`, background: V("warn") }} />
          </div>
          <span className="num" style={{ fontSize: 26, fontWeight: 700 }}>
            {Math.round((nP / total) * 100)}%<span className="tc-s" style={{ fontWeight: 500 }}> {tx(p("present", "उपस्थित"))}</span>
          </span>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <span style={{ fontWeight: 600 }}>{absentKids.length + halfKids.length ? tx(p("Away today", "आज अनुपस्थित")) : tx(p("Everyone is here", "सब उपस्थित हैं"))}</span>
            {[...absentKids, ...halfKids].map((k) => {
              const a = marks[k.id] === "absent";
              return (
                <span key={k.id} className="tc-in" style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span className="tc-av" style={{ width: 30, height: 30, fontSize: 11, background: a ? V("bads") : V("warns"), color: a ? V("bad") : V("warnfg") }}>{initials(k.name)}</span>
                  <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
                    <span className="tc-el" style={{ fontWeight: 600 }}>{k.name}</span>
                    <span className="tc-s">{a ? tx(p(`Absent · roll ${k.rollNo ?? "—"}`, `अनुपस्थित · रोल ${k.rollNo ?? "—"}`)) : tx(p(`Half-day · roll ${k.rollNo ?? "—"}`, `आधा दिन · रोल ${k.rollNo ?? "—"}`))}</span>
                  </span>
                </span>
              );
            })}
            {absentKids.length + halfKids.length === 0 ? <span className="tc-s">{tx(p("No one marked absent yet. Tap a child to mark them away.", "अभी कोई अनुपस्थित नहीं। अनुपस्थित बच्चे पर टैप करें।"))}</span> : null}
          </div>
          <div className="tc-note" style={{ background: "var(--s2)", fontSize: 13 }}>
            <Ic n="message" style={{ marginTop: 1, color: "var(--acc)" }} />
            <span>{tx(p("Parents of absent children get a WhatsApp at 10 am. You can turn it off before saving.", "अनुपस्थित बच्चों के माता-पिता को सुबह 10 बजे व्हाट्सऐप जाता है। सेव से पहले बंद कर सकते हैं।"))}</span>
          </div>
          {yesterdayIds.length ? <span className="tc-s">{tx(p(`Yesterday: ${andList(yesterdayIds.map((id) => nameOf.get(id) ?? "—"))} ${yesterdayIds.length === 1 ? "was" : "were"} absent.`, `कल: ${andList(yesterdayIds.map((id) => nameOf.get(id) ?? "—"), "और")} अनुपस्थित थे।`))}</span> : null}
        </aside>
      </div>

      <div className="glass tc-abar">
        <span className="only-d" style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
          <span className="tc-p" style={{ fontWeight: 700 }}>{data.classLabel} · {parts}</span>
          <span className="tc-s">{editing === "change" ? tx(p("Until you save again, the office keeps what you saved before.", "दोबारा सेव करने तक ऑफ़िस पहले वाली हाज़िरी रखेगा।")) : tx(p(`Until you save, the office sees ${data.classLabel} as Not marked.`, `सेव करने तक ऑफ़िस को ${data.classLabel} “नहीं लगी” दिखेगी।`))}</span>
        </span>
        <button type="button" className="tap btn pri tc-save" disabled={pending} onClick={() => setSheet("save")}>
          <Ic n="check" size={22} />
          <span style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", lineHeight: 1.2 }}>
            <span>{editing === "change" ? tx(p("Save changes", "बदलाव सेव करें")) : tx(p("Save attendance", "हाज़िरी सेव करें"))}</span>
            <span className="num" style={{ fontSize: 13, fontWeight: 600, opacity: 0.85 }}>{parts}</span>
          </span>
        </button>
        <span className="tc-s only-m" style={{ textAlign: "center" }}>{editing === "change" ? tx(p("Until you save again, the office keeps what you saved before.", "दोबारा सेव करने तक ऑफ़िस पहले वाली हाज़िरी रखेगा।")) : tx(p(`Until you save, the office sees ${data.classLabel} as Not marked.`, `सेव करने तक ऑफ़िस को ${data.classLabel} “नहीं लगी” दिखेगी।`))}</span>
      </div>
    </div>
  );

  /* --------------------------------------------------------- saved view */
  const nextKid = [...often.entries()].map(([id, n]) => ({ id, n, name: nameOf.get(id) ?? "" })).filter((k) => k.name)[0] ?? null;
  const savedView = (
    <div className="pad stack" style={{ display: "grid", gridTemplateColumns: "minmax(0, 1.2fr) minmax(0, 1fr)", gap: 20, alignItems: "start", padding: "24px 28px 40px", maxWidth: 1180, margin: "0 auto", width: "100%" }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 16, minWidth: 0 }}>
        {recorded ? (
          <div className="card" style={{ padding: "28px 24px 22px", display: "flex", flexDirection: "column", alignItems: "center", gap: 10, textAlign: "center" }}>
            <DrawnTick size={104} />
            <span className="serif tc-agr" style={{ fontSize: 30, fontWeight: 600, lineHeight: 1.15 }}>
              {data.receipt && data.receipt.revision > 1 ? tx(p(`Updated at ${savedAt}.`, `${savedAt} बजे बदला।`)) : tx(p(`Saved at ${(savedAt ?? "—").replace(/ (am|pm)$/, "")}.`, `${(savedAt ?? "—").replace(/ (am|pm)$/, "")} बजे सेव हुआ।`))}
            </span>
            <span className="tc-p" style={{ color: "var(--mut)" }}>
              {tx(p("The office can see it now.", "कार्यालय अब इसे देख सकता है।"))}
              {sub(p("The office can see it now.", "कार्यालय अब इसे देख सकता है।")) ? (
                <>
                  <br />
                  {sub(p("The office can see it now.", "कार्यालय अब इसे देख सकता है।"))}
                </>
              ) : null}
            </span>
            <div style={{ width: "100%", marginTop: 6 }}>{tiles(28)}</div>
            <span className="tc-s" style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
              <Ic n="message" size={15} />
              {data.queuedAlerts.length
                ? tx(p(`WhatsApp to ${data.queuedAlerts.length} ${data.queuedAlerts.length === 1 ? "parent" : "parents"} goes at 10 am · Hindi first`, `${data.queuedAlerts.length} अभिभावकों को सुबह 10 बजे व्हाट्सऐप · पहले हिंदी`))
                : nA
                  ? tx(p("No WhatsApp will go to parents today", "आज अभिभावकों को कोई व्हाट्सऐप नहीं जाएगा"))
                  : tx(p("No one absent · no messages to parents", "कोई अनुपस्थित नहीं · अभिभावकों को कोई संदेश नहीं"))}
            </span>
            {data.receipt?.actorName && data.receipt.revision > 1 ? <span className="tc-s">{tx(p(`By ${data.receipt.actorName}${data.receipt.revision > 1 ? ` · changed ${data.receipt.revision - 1} ${data.receipt.revision === 2 ? "time" : "times"}` : ""}`, `${data.receipt.actorName} द्वारा`))}</span> : null}
          </div>
        ) : (
          <div className="card" style={{ padding: "28px 24px 22px", display: "flex", flexDirection: "column", alignItems: "center", gap: 10, textAlign: "center" }}>
            <span className="tc-av" style={{ width: 64, height: 64, background: "var(--s2)", color: "var(--mut)" }}><Ic n="calCheck" size={28} /></span>
            <span className="serif" style={{ fontSize: 26, fontWeight: 600 }}>{data.closed ? tx(p("No register for this day", "इस दिन हाज़िरी नहीं")) : tx(p("Not marked yet", "अभी हाज़िरी नहीं लगी"))}</span>
            <span className="tc-p" style={{ color: "var(--mut)" }}>
              {data.closed ? tx(p("School is closed on this day, or it has not come yet.", "इस दिन स्कूल बंद है या दिन अभी नहीं आया।")) : tx(p(`Until it is saved, the office sees ${data.classLabel} as Not marked — never as present.`, `सेव होने तक ऑफ़िस को ${data.classLabel} “नहीं लगी” दिखेगी।`))}
            </span>
          </div>
        )}

        {recorded && mayChangeHere ? (
          <div className="card tc-in" style={{ padding: "16px 18px", display: "flex", flexWrap: "wrap", alignItems: "center", gap: 14 }}>
            <span className="tc-ib" style={{ width: 52, height: 52, borderRadius: 16, background: "var(--accs)", color: "var(--accfg)" }}><Ic n="edit" size={24} /></span>
            <span style={{ flex: 1, minWidth: 180, display: "flex", flexDirection: "column" }}>
              <span className="tc-p" style={{ fontWeight: 700 }}>{tx(p("You can still change it", "आप इसे अब भी बदल सकती हैं"))}</span>
              <span className="tc-s">{tx(p("Any time, with a reason. The office sees the change and it stays in the history.", "कभी भी, कारण के साथ। ऑफ़िस बदलाव देखता है और वह इतिहास में रहता है।"))}</span>
            </span>
            <button type="button" className="tap btn sec" style={{ height: 48 }} onClick={() => { rememberChanges(ids); setMarks({ ...fresh, ...data.saved }); setEditing("change"); }}>
              <Ic n="edit" />
              {tx(p("Change attendance", "हाज़िरी बदलें"))}
            </button>
          </div>
        ) : null}
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 16, minWidth: 0 }}>
        {recorded && nextKid ? (
          <div className="card tc-in" style={{ padding: "18px 20px", display: "flex", flexDirection: "column", gap: 12, borderColor: "var(--warnm)", animationDelay: "120ms" }}>
            <span className="sech" style={{ color: "var(--warnfg)" }}>{T(p("Next step", "अगला कदम"))}</span>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <span className="tc-av" style={{ width: 48, height: 48, fontSize: 15, background: "var(--bads)", color: "var(--bad)" }}>{initials(nextKid.name)}</span>
              <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
                <span className="tc-p" style={{ fontWeight: 700 }}>{tx(p(`${nextKid.name}: absent ${nextKid.n} days`, `${nextKid.name}: ${nextKid.n} दिन अनुपस्थित`))}</span>
                <span className="tc-s">{marks[nextKid.id] === "absent" ? tx(p("This month — and today again.", "इस महीने — और आज भी।")) : tx(p("This month. A short call or note helps.", "इस महीने। एक फ़ोन या नोट मदद करता है।"))}</span>
              </span>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 8 }}>
              <Link href={`/teach/class?student=${nextKid.id}`} className="tap btn pri tc-abb"><Ic n="phone" />{tx(p("Call parents", "माता-पिता को फ़ोन"))}</Link>
              <Link href={`/teach/notes?sheet=add&student=${nextKid.id}`} className="tap btn sec tc-abb"><Ic n="edit" />{tx(p("Add note", "नोट लिखें"))}</Link>
            </div>
          </div>
        ) : null}
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <Link href="/teach" className="tap btn pri tc-abb"><Ic n="home" />{tx(p("Back to Today", "आज पर वापस"))}</Link>
          <button type="button" className="tap btn sec tc-abb" onClick={() => setView("history")}><Ic n="calendar" />{tx(p("See this month", "इस महीने की हाज़िरी"))}</button>
        </div>
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
  const today = data.day;
  const [pickDay, setPickDay] = useState<string>(data.day.startsWith(data.month) ? data.day : marked.at(-1)?.[0] ?? `${data.month}-01`);
  const picked = byDay.get(pickDay) ?? null;
  const lead = cells.findIndex((c) => c !== null);
  const prevMonthDays = new Date(Date.UTC(Number(data.month.slice(0, 4)), Number(data.month.slice(5, 7)) - 1, 0)).getUTCDate();
  const trail = (7 - (cells.length % 7)) % 7;
  const monthTitle = new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric" }).format(new Date(`${data.month}-15T12:00:00+05:30`));
  const schoolDays = marked.map(([d]) => d).slice(-6);
  const monthNav = (cls: string) => (
    <span className={cls} style={{ display: "flex", gap: 4 }}>
      <Link className="tap btn ghost" aria-label={tx(p("Previous month", "पिछला महीना"))} href={`${dayHref(data.day)}&view=history&month=${shiftMonth(data.month, -1)}`} style={{ width: 36, height: 36, padding: 0 }}><Ic n="chevLeft" /></Link>
      <Link className="tap btn ghost" aria-label={tx(p("Next month", "अगला महीना"))} href={`${dayHref(data.day)}&view=history&month=${shiftMonth(data.month, 1)}`} style={{ width: 36, height: 36, padding: 0 }}><Ic n="chevRight" /></Link>
    </span>
  );
  const histKids = [...often.entries()].map(([id, n]) => ({ id, n, name: nameOf.get(id) ?? "" })).filter((k) => k.name);
  const dayHref = (d: string) => `/teach/attendance?class=${data.classId}&day=${d}`;
  const history = (
    <div className="pad stack" style={{ display: "grid", gridTemplateColumns: "minmax(0, 1.35fr) minmax(0, 1fr)", gap: 20, alignItems: "start", padding: "22px 28px 40px" }}>
      <div className="card" style={{ minWidth: 0, padding: "18px 20px", display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10 }}>
          <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
            <span className="serif" style={{ fontSize: 24, fontWeight: 600 }}>{monthTitle}</span>
            <span className="tc-s">{tx(p(`${data.classLabel} · ${data.roll.length} children · tap a day to see who was away`, `${data.classLabel} · ${data.roll.length} बच्चे · कौन नहीं आया देखने के लिए दिन दबाएँ`))}</span>
          </span>
          {monthNav("hide-m")}
          {avg !== null ? <span className="pill num" style={{ height: 30, padding: "0 12px", fontSize: 13, background: "var(--accs)", color: "var(--accfg)" }}>{tx(p(`Average ${avg}%`, `औसत ${avg}%`))}</span> : null}
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 12 }}>
          {([["95%+", V("ok"), "0"], ["90–94%", V("okm"), "0"], ["85–89%", V("warnm"), "0"], [tx(p("Below 85%", "85% से कम")), V("bads"), "0"], [tx(p("Holiday", "छुट्टी")), V("s2"), "1px solid var(--bd)"]] as const).map(([l, bg, bd]) => (
            <span key={l} className="tc-s" style={{ display: "flex", alignItems: "center", gap: 6 }}><span style={{ width: 12, height: 12, borderRadius: 4, background: bg, border: bd }} />{l}</span>
          ))}
        </div>
        <div className="tc-cal">
          {["M", "T", "W", "T", "F", "S", "S"].map((d, i) => <span key={i} className="tc-s" style={{ textAlign: "center", fontWeight: 700 }}>{d}</span>)}
          {Array.from({ length: Math.max(0, lead) }, (_, i) => (
            <span key={`l${i}`} className="tc-day" aria-hidden="true" style={{ opacity: 0.35, background: "var(--card)", animationDelay: `${i * 12}ms` }}>
              <span className="num" style={{ fontSize: 13, fontWeight: 700 }}>{prevMonthDays - lead + i + 1}</span>
              <span className="pill" style={{ padding: "0 5px", fontSize: 11, background: "transparent", color: V("sub") }}>·</span>
            </span>
          ))}
          {cells.filter((c) => c !== null).map((c, i) => {
            const d = byDay.get(c.day);
            const sun = c.weekday === 0;
            const hol = !sun && data.closedDays.includes(c.day);
            const future = c.day > today;
            const isToday = c.day === today;
            const pc = d ? pctOf(d) : null;
            const sc = pc !== null ? scale(pc) : null;
            const chip = sun ? tx(p("Sun", "रवि")) : hol ? tx(p("Holiday", "छुट्टी")) : pc !== null ? `${pc}%` : isToday ? tx(p("Not yet", "अभी नहीं")) : "·";
            const sel = c.day === pickDay;
            return (
              <button
                key={c.day}
                type="button"
                className="tap tc-day"
                aria-pressed={sel}
                aria-label={`${dShort(c.day)} · ${pc !== null ? `${pc}% present` : sun ? "Sunday" : hol ? "holiday" : future ? "coming up" : "not marked"}`}
                onClick={() => {
                  if (sun || hol) return toast.show({ text: tx(hol ? p("Holiday · no school", "छुट्टी · स्कूल बंद") : p("Sunday · no school", "रविवार · स्कूल बंद")) });
                  if (future) return toast.show({ text: tx(p("This day has not come yet", "यह दिन अभी नहीं आया")) });
                  setPickDay(c.day);
                }}
                style={{ background: isToday ? V("accs") : hol || sun ? V("s2") : V("card"), borderColor: isToday ? V("acc") : V("bd"), boxShadow: sel ? "inset 0 0 0 2px var(--acc)" : "none", opacity: future && !hol ? 0.7 : 1, animationDelay: `${(i + lead) * 12}ms` }}
              >
                <span className="num" style={{ fontSize: 13, fontWeight: 700, color: isToday ? V("accfg") : V("fg") }}>{c.date}</span>
                <span className="pill num" style={{ padding: "0 5px", fontSize: 11, background: sc ? sc[0] : "transparent", color: sc ? sc[1] : V("sub") }}>{chip}</span>
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
              <span className="serif" style={{ fontSize: 22, fontWeight: 600 }}>{pickDay === today ? tx(p(`Today · ${dShort(pickDay)}`, `आज · ${dShort(pickDay)}`)) : dShort(pickDay)}</span>
              <span className="tc-s">{picked ? tx(p(`${picked.marked - picked.a.length - picked.h.length} of ${picked.marked} present${picked.h.length ? ` · ${picked.h.length} half-day` : ""}`, `${picked.marked} में से ${picked.marked - picked.a.length - picked.h.length} उपस्थित`)) : tx(p(`${data.classLabel} · ${data.roll.length} children`, `${data.classLabel} · ${data.roll.length} बच्चे`))}</span>
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
                          <span className="tc-s">{tx(p(`Roll ${rollOf(id)}`, `रोल ${rollOf(id)}`))}</span>
                        </span>
                      </span>
                    ))}
                  </div>
                ))}
              {!picked.a.length && !picked.h.length ? <span className="tc-note" style={{ background: "var(--oks)", color: "var(--ok)" }}>{tx(p("Everyone came this day.", "इस दिन सब आए।"))}</span> : null}
              {pickDay === data.day && data.receipt ? <span className="tc-s">{tx(p(`Marked${data.receipt.actorName ? ` by ${data.receipt.actorName}` : ""} at ${ampm(data.receipt.savedAt)}`, `${ampm(data.receipt.savedAt)} बजे लगाई`))}</span> : null}
              {data.canCorrect ? (
                <Link href={dayHref(pickDay)} className="tap btn sec tc-abb"><Ic n="edit" />{tx(p("Change this day", "यह दिन बदलें"))}</Link>
              ) : null}
            </>
          ) : (
            <>
              <div className="tc-note" style={{ background: "var(--s2)" }}>
                <Ic n="info" style={{ marginTop: 2, color: "var(--mut)" }} />
                <span>{tx(p(`Not marked yet. Until you save, the office sees ${data.classLabel} as Not marked — never as present.`, `अभी नहीं लगी। सेव होने तक ऑफ़िस को ${data.classLabel} “नहीं लगी” दिखेगी — उपस्थित कभी नहीं।`))}</span>
              </div>
              {data.canSave || data.canCorrect ? <Link href={dayHref(pickDay)} className="tap btn pri tc-abb"><Ic n="calCheck" />{tx(p("Mark now", "अभी लगाएँ"))}</Link> : null}
            </>
          )}
        </div>

        <div className="card tc-in" style={{ padding: "18px 20px", display: "flex", flexDirection: "column", gap: 12, animationDelay: "100ms" }}>
          <span style={{ display: "flex", flexDirection: "column" }}>
            <span className="tc-t">{tx(p("Children absent often", "बार-बार अनुपस्थित"))}</span>
            <span className="tc-s">{sub(p("Children absent often", "बार-बार अनुपस्थित")) ? `${sub(p("Children absent often", "बार-बार अनुपस्थित"))} · ` : ""}{tx(p("this month", "इस महीने"))}</span>
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
  const screen: "mark" | "saved" | "history" = view === "history" ? "history" : editing && data.roll.length ? "mark" : "saved";
  const head =
    screen === "history"
      ? { crumb: tx(p(`Attendance · ${data.classLabel}`, `हाज़िरी · ${data.classLabel}`)), title: `${monthTitle.split(" ")[0]} · ${data.classLabel}`, mTitle: `${monthTitle.split(" ")[0]} · ${data.classLabel}`, mSub: tx(p("Tap a day to see who was away", "कौन नहीं आया देखने के लिए दिन दबाएँ")) }
      : screen === "saved" && recorded
        ? { crumb: tx(p(`Attendance · ${data.classLabel}`, `हाज़िरी · ${data.classLabel}`)), title: tx(p("Attendance saved", "हाज़िरी सेव हो गई")), mTitle: tx(p("Attendance saved", "हाज़िरी सेव हो गई")), mSub: `${data.classLabel} · ${dShort(data.day)}` }
        : { crumb: T(p("Attendance", "हाज़िरी")), title: `${data.classLabel} · ${dShort(data.day)} · ${language === "hi" ? "Attendance" : "हाज़िरी"}`, mTitle: `${data.classLabel} · ${language === "hi" ? "हाज़िरी" : sub(p("Attendance", "हाज़िरी")) ?? "Attendance"}`, mSub: `${dShort(data.day)} · ${tx(p(`${data.roll.length} children`, `${data.roll.length} बच्चे`))}` };
  const historyBack = (
    <button type="button" className="tap btn ghost tc-x" aria-label={tx(p("Back", "पीछे"))} onClick={() => setView(null)} style={{ color: "var(--fg)" }}>
      <Ic n="chevLeft" size={22} />
    </button>
  );

  const sheetTitle = editing === "change" ? tx(p("Save the changes?", "बदलाव सेव करें?")) : tx(p(`Save ${data.classLabel} attendance?`, `${data.classLabel} की हाज़िरी सेव करें?`));
  return (
    <VxPage className="tc">
      <TchTop
        crumb={head.crumb}
        title={head.title}
        actions={
          <>
            {outbox ? <span className="pill" style={{ height: 30, padding: "0 12px", fontSize: 13, background: "var(--warns)", color: "var(--warnfg)" }}><Ic n="cloud" size={14} />{tx(p("Waiting to sync", "भेजना बाकी"))}</span> : null}
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
            {outbox ? <span className="pill" style={{ background: "var(--warns)", color: "var(--warnfg)" }}><Ic n="cloud" size={12} />{tx(p("Waiting to sync", "भेजना बाकी"))}</span> : null}
            <LangSeg />
            <HelpIcon onClick={() => setSheet("help")} label={tx(p("Help", "मदद"))} />
          </>
        }
      />
      <main>
        {!online || outbox || data.closed || (data.reason && !data.canSave && !data.canCorrect) || (state && (state.status === "stale" || state.status === "roster_changed" || state.status === "refused")) ? (
          <div className="pad" style={{ padding: "16px 28px 0", display: "flex", flexDirection: "column", gap: 10 }}>
            {!online ? (
              <div className="tc-note" role="status" style={{ background: "var(--warns)", color: "var(--warnfg)" }}>
                <Ic n="wifiOff" style={{ marginTop: 2 }} />
                <span style={{ fontWeight: 600 }}>{tx(p("No internet. You can still mark — saving will wait for the connection.", "इंटरनेट नहीं। हाज़िरी लगा सकते हैं — सहेजना कनेक्शन का इंतज़ार करेगा।"))}</span>
              </div>
            ) : null}
            {outbox ? (
              <div className="tc-note" role="status" style={{ background: "var(--warns)", color: "var(--warnfg)", alignItems: "center" }}>
                <Ic n="cloud" />
                <span style={{ flex: 1, fontWeight: 600 }}>{outboxDurable ? tx(p("Waiting to sync — this register is saved on this phone and will be sent when you are online.", "भेजना बाकी — यह हाज़िरी फ़ोन पर रखी है, इंटरनेट आते ही भेजी जाएगी।")) : tx(p("The save is waiting only on this open page. Keep it open and check again when online.", "सहेजना केवल इस खुले पेज पर बाकी है। इसे खुला रखें और इंटरनेट आने पर फिर जाँचें।"))}</span>
                {online ? <button type="button" className="tap btn sec" disabled={pending} onClick={() => deliver(outbox, true)}>{tx(p("Send now", "अभी भेजें"))}</button> : null}
              </div>
            ) : null}
            {data.closed ? (
              <div className="tc-note" style={{ background: "var(--infos)", color: "var(--info)" }}>
                <Ic n="info" style={{ marginTop: 2 }} />
                <span>{tx(p("School is closed on this day, or it has not come yet. There is no register to take.", "इस दिन स्कूल बंद है या दिन अभी नहीं आया।"))}</span>
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
        ) : data.roll.length === 0 ? (
          <div className="pad" style={{ padding: "20px 28px" }}>
            <div className="card" style={{ padding: "32px 20px", display: "flex", flexDirection: "column", alignItems: "center", gap: 10, textAlign: "center" }}>
              <span className="tc-av" style={{ width: 56, height: 56, background: "var(--s2)", color: "var(--mut)" }}><Ic n="users" size={26} /></span>
              <span className="tc-p" style={{ fontWeight: 700 }}>{tx(p("Nobody is on this class's roll for this day", "इस दिन कक्षा में कोई बच्चा नहीं"))}</span>
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
        sub={`${dShort(data.day)} · ${parts}`}
        footer={
          <>
            <button type="button" className="tap btn sec tc-abb" style={{ flex: 1 }} onClick={() => setSheet(null)}>{tx(p("Check again", "फिर देखें"))}</button>
            <button type="button" className="tap btn pri tc-abb" style={{ flex: 1.6 }} disabled={pending || !editing || (editing === "change" && changeReason.length < 3)} onClick={() => submit(editing === "change" ? "correction" : "save", editing === "change" ? changeReason : null)}>
              {pending ? <Ic n="refresh" size={18} className="spin" /> : <Ic n="check" size={18} />}
              {editing === "change" ? tx(p("Save changes", "बदलाव सेव करें")) : tx(p("Save attendance", "हाज़िरी सेव करें"))}
            </button>
          </>
        }
      >
        <div className="tc-sb">
          {tiles(26)}
          {([[p("Absent today", "आज अनुपस्थित"), absentKids, V("bads"), V("bad")], [p("Half-day", "आधा दिन"), halfKids, V("warns"), V("warnfg")]] as const)
            .filter(([, list]) => list.length)
            .map(([label, list, bg, fg]) => (
              <div key={label.en} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <span className="sech">{T(label)} ({list.length})</span>
                {list.map((k) => (
                  <span key={k.id} className="tc-in" style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <span className="tc-av" style={{ width: 38, height: 38, fontSize: 12, background: bg, color: fg }}>{initials(k.name)}</span>
                    <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
                      <span className="tc-p" style={{ fontWeight: 600 }}>{k.name}</span>
                      <span className="tc-s">{tx(p(`Roll ${k.rollNo ?? "—"}`, `रोल ${k.rollNo ?? "—"}`))}{data.yesterday[k.id] === "absent" && marks[k.id] === "absent" ? ` · ${tx(p("absent yesterday too", "कल भी अनुपस्थित"))}` : ""}</span>
                    </span>
                  </span>
                ))}
              </div>
            ))}
          {!absentKids.length && !halfKids.length ? (
            <div className="tc-note" style={{ background: "var(--oks)", color: "var(--ok)" }}>
              <Ic n="checkCircle" />
              <span style={{ fontWeight: 600 }}>{tx(p("Everyone is here today. No messages will go to parents.", "आज सब उपस्थित हैं। अभिभावकों को कोई संदेश नहीं जाएगा।"))}</span>
            </div>
          ) : null}
          {absentKids.length ? (
            <>
              <button type="button" role="switch" aria-checked={alerts} className="tap tc-opt" onClick={() => setAlerts(!alerts)} style={{ background: "var(--s2)" }}>
                <span className="tc-ib" style={{ width: 40, height: 40, borderRadius: 12, background: "var(--oks)", color: "var(--ok)" }}><Ic n="message" /></span>
                <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
                  <span className="tc-p" style={{ fontWeight: 600 }}>{tx(p("Send WhatsApp to their parents at 10 am", "उनके माता-पिता को सुबह 10 बजे व्हाट्सऐप"))}</span>
                  <span className="tc-s num">{alerts ? tx(p(`${absentKids.length} ${absentKids.length === 1 ? "parent" : "parents"} · Hindi first`, `${absentKids.length} अभिभावक · पहले हिंदी`)) : tx(p("Off · no message will go to parents", "बंद · अभिभावकों को कोई संदेश नहीं"))}</span>
                </span>
                <span className={`sw${alerts ? " on" : ""}`}><span /></span>
              </button>
              {alerts && preview ? (
                <>
                  <div className="tc-wa">
                    <div>
                      <span style={{ display: "block" }}>{preview.hi}</span>
                      <span style={{ display: "block", marginTop: 6, opacity: 0.8 }}>{preview.en}</span>
                      <span className="num" style={{ display: "block", textAlign: "right", fontSize: 11, opacity: 0.6 }}>10:00 am</span>
                    </div>
                  </div>
                  <span className="tc-s" style={{ marginTop: -6 }}>{absentKids.length > 1 ? tx(p(`The same message goes to ${absentKids.length - 1} more ${absentKids.length === 2 ? "family" : "families"} with their child’s name.`, `यही संदेश ${absentKids.length - 1} और परिवारों को उनके बच्चे के नाम से।`)) : tx(p("Only this family gets a message.", "सिर्फ़ इस परिवार को संदेश जाएगा।"))}</span>
                </>
              ) : null}
            </>
          ) : null}
          {editing === "change" ? (
            <>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <span className="sech">{T(p("Why are you changing it?", "कारण"))}</span>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                  {WHY.map((w) => (
                    <button key={w.en} type="button" className={`tap chip${why === w.en ? " on" : ""}`} aria-pressed={why === w.en} onClick={() => setWhy(w.en)} style={{ height: 44, padding: "0 16px", fontSize: 14 }}>{tx(w)}</button>
                  ))}
                </div>
              </div>
              <label className="field">
                <span>{tx(p("Note (optional)", "नोट (वैकल्पिक)"))}</span>
                <Textarea rows={2} maxLength={150} value={whyNote} onChange={(e) => setWhyNote(e.target.value)} placeholder={tx(p("For example: came at 9:10 with her father", "जैसे: पिता के साथ 9:10 बजे आई"))} style={{ minHeight: 64 }} />
              </label>
              <span className="tc-s">{tx(p(`Saving again replaces what you saved${savedAt ? ` at ${savedAt}` : ""}. The office is told it was changed.`, "दोबारा सेव करने से पहले वाली हाज़िरी बदल जाएगी। ऑफ़िस को बताया जाएगा।"))}</span>
            </>
          ) : (
            <span className="tc-s">{tx(p("After saving you can still change it whenever needed.", "सेव करने के बाद भी ज़रूरत हो तो कभी भी बदल सकते हैं।"))}</span>
          )}
        </div>
      </Sheet>

      <HelpSheet open={sheet === "help"} onClose={() => setSheet(null)} title={p("How to mark attendance", "हाज़िरी कैसे लगाएँ")} sub={p("3 easy steps", "3 आसान कदम")} steps={HELP} phone={officePhone} />
    </VxPage>
  );
}

