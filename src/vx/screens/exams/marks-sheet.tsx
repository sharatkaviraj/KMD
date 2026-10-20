"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";

import { draftKey, readDraft } from "@/platform/drafts/policy";
import { loadDraft, removeDraft, saveDraft } from "@/platform/drafts/store";

import { useVx } from "@/vx/i18n";
import { Ic } from "@/vx/icons";
import { p, type Pair } from "@/vx/text";
import { NumberPad, Seg, Textarea } from "@/vx/ui/controls";
import { Confirm, HelpButton, useToast } from "@/vx/ui/overlays";
import { Banner, TopBar, VxPage } from "@/vx/ui/page";
import { Avatar, avatarColor, BarChart, Btn, Card, Pill, Progress, Ring, SuccessTick } from "@/vx/ui/primitives";
import { clock, initials, shortDay } from "@/vx/format";

import {
  afterSave,
  BLANK,
  changedIds,
  draftEntries,
  submitBlockers,
  checkSummary,
  counts,
  isFilled,
  looksOff,
  nextBlank,
  parseMark,
  pressKey,
  shouldAdvance,
  cleanTyped,
  misfits,
  toEntries,
  type Cell,
} from "./domain/entry";
import { needsCorrectionText } from "./domain/progress";
import { ExamsTop, Note, XBar } from "./bits";
import { UNDO_MS, type SaveOutcome, type SavePayload } from "./save-types";
import type { SheetPaper, SheetStudent } from "./sheet-data";
import { isMarksRecovery, type MarksRecovery } from "./sheet-recovery";

/*
 * One paper's marks, typed in a list on a computer or on a number pad on a
 * phone — the same sheet for the exam office, the teacher and the no-login
 * marks link. It saves by itself as she types (a draft), checks before she
 * sends, and sends once (a submission). A blank is never a zero.
 */

export type SheetPhase = "entry" | "check" | "sent";

/**
 * "blocked": nothing was sent because a changed cell cannot be saved as it
 * stands; the change is still on this device and the line says why.
 */
type Status = "idle" | "saving" | "saved" | "error" | "stale" | "blocked";

/** The draft's fingerprint: a draft is offered back only against the same paper, roster and revision. */
function baselineOf(revision: number, ids: string[], maxMarks: number, markStep: number): string {
  return JSON.stringify({ revision, ids, max: maxMarks, step: markStep });
}

export function MarksSheet({
  ownerId,
  sessionLabel,
  paper,
  students,
  saved: initialSaved,
  coordinatorName,
  onSave,
  onWithdraw,
  canCorrect = false,
  canReopen = false,
  initialPhase = "entry",
  initialMode = "list",
  crumb,
  backHref,
  nextHref,
  nextLabel,
  doneHref,
  noteHref,
  variant = "teacher",
  forTeacher = null,
  viewerStaffId = null,
}: {
  ownerId: string;
  sessionLabel: string;
  paper: SheetPaper;
  students: SheetStudent[];
  saved: Record<string, Cell>;
  coordinatorName: string | null;
  onSave: (payload: SavePayload) => Promise<SaveOutcome>;
  onWithdraw?: (paperId: string, revision: number) => Promise<SaveOutcome>;
  canCorrect?: boolean;
  canReopen?: boolean;
  initialPhase?: SheetPhase;
  initialMode?: "list" | "pad";
  crumb: string;
  backHref?: string;
  nextHref?: string | null;
  nextLabel?: string | null;
  doneHref?: string;
  /** Where "Add a note" goes; the child's id is appended. */
  noteHref?: string;
  /** "office": the exam office entering a paper for its teacher (design Exams · entry). */
  variant?: "teacher" | "office";
  /** Whose paper the office is entering, for the override note. */
  forTeacher?: string | null;
  /** The staff member looking at the sheet: only the one who sent it may undo it. */
  viewerStaffId?: string | null;
}) {
  const { tx } = useVx();
  const toast = useToast();
  const router = useRouter();
  const order = students.map((s) => s.id);
  const byId = new Map(students.map((s) => [s.id, s]));

  const [cells, setCells] = useState<Record<string, Cell>>(initialSaved);
  const [saved, setSaved] = useState<Record<string, Cell>>(initialSaved);
  const [texts, setTexts] = useState<Record<string, string>>(() => textsOf(initialSaved));
  const [, setRevision] = useState(paper.entryRevision);
  const [entryStatus, setEntryStatus] = useState(paper.entryStatus);
  const [submittedAt, setSubmittedAt] = useState(paper.submittedAt);
  const [phase, setPhase] = useState<SheetPhase>(paper.entryStatus === "submitted" && initialPhase === "entry" ? "sent" : initialPhase);
  const [mode, setMode] = useState<"list" | "pad">(initialMode);
  const [current, setCurrent] = useState(() => Math.max(0, nextBlank(order, initialSaved, -1)));
  const [padText, setPadText] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [message, setMessage] = useState<Pair | null>(null);
  const [who, setWho] = useState<string[]>([]);
  const [lastSaved, setLastSaved] = useState<string | null>(null);
  const [showDone, setShowDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const [correcting, setCorrecting] = useState(false);
  const [reason, setReason] = useState("");
  const [askReopen, setAskReopen] = useState(false);
  const [ready, setReady] = useState(false);
  const [recovered, setRecovered] = useState<MarksRecovery | null>(null);
  /** A draft kept against an older version of this paper: shown, never applied by itself. */
  const [oldDraft, setOldDraft] = useState<MarksRecovery | null>(null);
  const [viewOld, setViewOld] = useState(false);
  const [pendingCommand, setPendingCommand] = useState(false);
  const [freshSave, setFreshSave] = useState(false);
  const [blocker, setBlocker] = useState<Pair | null>(null);
  const [undoUntil, setUndoUntil] = useState<string | null>(paper.undoUntil ?? null);
  const [undoOpen, setUndoOpen] = useState(paper.undoOpen ?? false);
  // When Undo closes, on this phone's own clock: the time it had left (from
  // the server) added to the moment the page arrived — never the server's
  // wall time against the phone's, which a fast phone would end at once.
  const [undoDeadline, setUndoDeadline] = useState<number | null>(() => (paper.undoOpen && paper.undoLeftMs !== undefined ? Date.now() + paper.undoLeftMs : null));
  const [submittedBy, setSubmittedBy] = useState(paper.submittedBy);
  const [undoNote, setUndoNote] = useState<Pair | null>(null);
  /** The exam office reads a sheet first; "Edit marks" opens the logged override. */
  const [officeEdit, setOfficeEdit] = useState(false);
  const recoveryKey = draftKey(ownerId, sessionLabel, `vx-marks/${paper.id}`);
  const baseline = baselineOf(paper.entryRevision, order, paper.maxMarks, paper.markStep);

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inflight = useRef<Promise<SaveOutcome | null> | null>(null);
  const command = useRef<SavePayload | null>(null);
  const storage = useRef<Promise<unknown>>(Promise.resolve());
  const latest = useRef({ cells: initialSaved, saved: initialSaved, revision: paper.entryRevision });
  const inputs = useRef(new Map<string, HTMLInputElement>());
  const advancedFrom = useRef<{ from: number; to: number } | null>(null);
  /** The version of the paper this page opened on; a draft must match it to be offered back. */
  const openedAt = useRef(baseline);
  /** Whether the last attempt stopped on a mark the paper cannot hold. */
  const blocked = useRef(false);

  // Rows in an old draft that differ from what is saved now; with none, there is nothing to decide.
  const oldDiff = oldDraft ? Object.entries(oldDraft.cells).filter(([id, cell]) => byId.has(id) && !sameSaved(cell, saved[id])) : [];
  const oldPending = oldDiff.length > 0;
  const editable =
    ready && !recovered && !oldPending && !pendingCommand && !busy && status !== "stale" && paper.examOpen && !paper.locked &&
    (entryStatus === "open" || correcting) && (variant !== "office" || officeEdit || correcting);
  // Progress is what the school has: the persisted cells, never edits still on
  // this device (B02). Those are counted apart, as changes on this device.
  const c = counts(order, saved);
  const local = changedIds(order, cells, saved);
  const summary = checkSummary(order, cells, paper.passMarks);
  // Marks the paper cannot hold — usually an old half mark on a whole-mark
  // paper. They are shown and named, never rounded or rewritten; they stop the
  // final send, not the draft saves of other children (B03).
  const badNow = misfits(order, cells, paper.maxMarks, paper.markStep);
  const badSet = new Set(badNow);
  const mayUndo = Boolean(onWithdraw) && undoOpen && Boolean(undoUntil) && submittedBy !== null && submittedBy === viewerStaffId;

  // The check and sent screens open at the top, where their banner is.
  useEffect(() => {
    if (phase !== "entry" && typeof window !== "undefined") window.scrollTo({ top: 0 });
  }, [phase]);

  // "Saved just now" for a minute after a confirmed save, then the time.
  useEffect(() => {
    if (!freshSave) return;
    const t = setTimeout(() => setFreshSave(false), 60_000);
    return () => clearTimeout(t);
  }, [freshSave, lastSaved]);

  // The undo closes when the server's ten minutes do; the server still decides.
  useEffect(() => {
    if (!undoOpen || undoDeadline === null) return;
    const t = setTimeout(() => setUndoOpen(false), Math.max(0, undoDeadline - Date.now()));
    return () => clearTimeout(t);
  }, [undoOpen, undoDeadline]);

  /* ------------------------------------------------------------ saving */

  useEffect(() => {
    let active = true;
    void loadDraft(recoveryKey).then((raw) => {
      if (!active) return;
      const draft = readDraft(raw, isMarksRecovery);
      if (draft && (!draft.value.command || draft.value.command.paperId === paper.id)) {
        // An unconfirmed save is always offered back: the server matches it by
        // its command id and revision, so checking it never applies it twice
        // or over newer marks. A plain draft is offered only against the same
        // version of the paper; an older one is shown for the teacher to
        // look at or discard, never put back by itself (B02).
        if (draft.value.command || draft.baseline === openedAt.current) setRecovered(draft.value);
        else setOldDraft(draft.value);
      }
      setReady(true);
    }).catch(() => {
      if (!active) return;
      setReady(true);
      setStatus("error");
      setMessage(p("This phone could not read saved work. Keep this page open until the school confirms your save.", "इस फ़ोन पर सहेजा काम नहीं पढ़ा जा सका। स्कूल से सेव की पुष्टि होने तक पेज खुला रखें।"));
    });
    return () => {
      active = false;
      if (timer.current) clearTimeout(timer.current);
    };
  }, [recoveryKey, paper.id]);

  async function keepRecovery(payload: SavePayload | null, correctionReason: string | null = correcting ? reason : null): Promise<boolean> {
    const value = { cells: latest.current.cells, command: payload, revision: latest.current.revision, correctionReason };
    // Stamped with the revision the draft was made against, not the one the page opened at.
    const stamp = baselineOf(latest.current.revision, order, paper.maxMarks, paper.markStep);
    try {
      const write = storage.current.catch(() => undefined).then(() => saveDraft(recoveryKey, { version: 1, baseline: stamp, value, updatedAt: Date.now() }));
      storage.current = write;
      await write;
      return true;
    } catch {
      setStatus("error");
      setMessage(p("This phone could not keep your draft. Keep this page open and try again before leaving.", "इस फ़ोन पर ड्राफ्ट नहीं सहेजा जा सका। पेज खुला रखें और जाने से पहले फिर कोशिश करें।"));
      return false;
    }
  }

  async function runCommand(payload: SavePayload): Promise<SaveOutcome | null> {
    if (inflight.current) return inflight.current;
    if (command.current && command.current.commandId !== payload.commandId) return null;
    command.current = payload;
    setPendingCommand(true);
    const run = (async () => {
      setStatus("saving");
      if (!(await keepRecovery(payload))) return null;
      const result = await onSave(payload).catch(() => null);
      const definite = result?.ok || (result && !result.ok && result.reason !== "failed");
      if (definite) {
        command.current = null;
        setPendingCommand(false);
      }
      if (result?.ok) {
        // A draft sends only the cells that changed, so what is saved now is
        // what was saved before with those cells laid over it — the rows it
        // did not send are still saved and must not vanish (B03).
        const snapshot = payload.kind === "reopen" ? latest.current.saved : afterSave(latest.current.saved, payload.entries);
        latest.current = { ...latest.current, saved: snapshot, revision: result.revision };
        setSaved(snapshot);
        setRevision(result.revision);
        setEntryStatus(result.entryStatus);
        setStatus("saved");
        setLastSaved(result.savedAt);
        setFreshSave(true);
        setMessage(null);
        setBlocker(null);
        blocked.current = false;
        setWho([]);
        if (payload.kind === "submit") {
          setUndoUntil(new Date(new Date(result.savedAt).getTime() + UNDO_MS).toISOString());
          setUndoDeadline(Date.now() + UNDO_MS);
          setUndoOpen(true);
          setSubmittedBy(viewerStaffId);
        }
        if (payload.kind === "submit" || payload.kind === "correction") {
          setSubmittedAt(result.savedAt);
          setCorrecting(false);
          setReason("");
          setPhase("sent");
          router.refresh();
        } else if (payload.kind === "reopen") {
          setSubmittedAt(null);
          setPhase("entry");
        }
        if (changedIds(order, latest.current.cells, snapshot).length === 0) {
          if (!(await clearRecovery())) { command.current = payload; setPendingCommand(true); }
        }
        else await keepRecovery(null);
      } else if (result && !result.ok && result.reason === "no_change") {
        const snapshot = afterSave(latest.current.saved, payload.entries);
        latest.current = { ...latest.current, saved: snapshot };
        setSaved(snapshot);
        setStatus("saved");
        setMessage(null);
        setBlocker(null);
        blocked.current = false;
        if (!(await clearRecovery())) { command.current = payload; setPendingCommand(true); }
      } else {
        if (definite) await keepRecovery(null);
        setStatus(result && !result.ok && result.reason === "stale" ? "stale" : "error");
        setBlocker(null);
        blocked.current = false;
        setMessage(result && !result.ok ? result.message : p("The save has not been confirmed. Try again to check the same save; your entries are kept on this phone.", "सेव की पुष्टि नहीं हुई है। उसी सेव को जाँचने के लिए फिर कोशिश करें; प्रविष्टियाँ इस फ़ोन पर रखी हैं।"));
        setWho(result && !result.ok ? (result.who ?? []) : []);
      }
      return result;
    })();
    inflight.current = run;
    try { return await run; }
    finally { inflight.current = null; }
  }

  /**
   * Marks the paper cannot hold among `ids` are named all at once and nothing
   * is sent: `save_marks` refuses a whole command for any one of them. A draft
   * checks only the cells it sends — an old 7.5 nobody touched must not stop
   * a new mark for another child (B03) — while the final send checks the
   * whole column and names every child it is waiting on.
   */
  function stopOnMisfits(bad: string[], snapshot: Record<string, Cell>, kind: "draft" | "submit" | "correction"): boolean {
    if (bad.length === 0) return false;
    blocked.current = true;
    const first = bad[0];
    const firstName = byId.get(first)?.name ?? "—";
    const why = needsCorrectionText(snapshot[first]?.value ?? 0, paper.maxMarks, paper.markStep);
    setStatus("blocked");
    setBlocker(
      kind === "submit"
        ? p(`Not submitted – ${bad.length} ${bad.length === 1 ? "mark needs" : "marks need"} correction`, `जमा नहीं हुआ – ${bad.length} अंक सुधारने हैं`)
        : p(`Not saved – your change is still here · ${firstName}: ${why.en}`, `सहेजा नहीं – आपका बदलाव यहीं है · ${firstName}: ${why.hi ?? why.en}`),
    );
    setMessage(
      kind === "submit"
        ? p("This paper cannot be sent until these marks are corrected. Nothing has been changed:", "ये अंक ठीक होने तक पेपर नहीं भेजा जा सकता। कुछ भी बदला नहीं गया:")
        : p("Not saved – your change is still here. Correct these marks and it saves again:", "सहेजा नहीं – आपका बदलाव यहीं है। ये अंक ठीक करते ही फिर सेव होगा:"),
    );
    setWho(bad.map((id) => `${byId.get(id)?.name ?? "—"} ${snapshot[id]?.value ?? ""}`));
    return true;
  }

  function clearBlocked() {
    blocked.current = false;
    setStatus("idle");
    setBlocker(null);
    setMessage(null);
    setWho([]);
  }

  async function flush(): Promise<boolean> {
    if (inflight.current) await inflight.current;
    if (command.current) return Boolean((await runCommand(command.current))?.ok);
    if (!ready || recovered || status === "stale" || !paper.examOpen || paper.locked) return false;
    const snapshot = latest.current.cells;
    const draft = draftEntries(order, snapshot, latest.current.saved, paper.maxMarks, paper.markStep);
    const changed = draft.changed;
    if (changed.length === 0) {
      // The blocked change was put back as it was saved: nothing is waiting any more.
      if (blocked.current) clearBlocked();
      return true;
    }
    if (entryStatus === "submitted") return false;
    if (stopOnMisfits(draft.blocked, snapshot, "draft")) return false;
    if (blocked.current) clearBlocked();
    // Only what changed is sent: unchanged rows — an old mark the paper can
    // no longer hold among them — are left exactly as they are.
    const result = await runCommand({
      commandId: crypto.randomUUID(),
      paperId: paper.id,
      kind: "draft",
      expectedRevision: latest.current.revision,
      reason: null,
      entries: draft.entries,
    });
    return Boolean(result?.ok || (result && !result.ok && result.reason === "no_change"));
  }

  async function clearRecovery(): Promise<boolean> {
    const clear = storage.current.catch(() => undefined).then(() => removeDraft(recoveryKey));
    storage.current = clear;
    try { await clear; return true; }
    catch {
      setStatus("error");
      setMessage(p("This phone could not clear saved recovery. Keep this page open and retry before leaving.", "इस फोन पर सहेजी गई पुनर्प्राप्ति नहीं हट सकी। पृष्ठ खुला रखें और छोड़ने से पहले फिर प्रयास करें।"));
      return false;
    }
  }

  function schedule() {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      timer.current = null;
      void flush();
    }, 900);
  }

  function update(id: string, cell: Cell, text?: string) {
    if (!editable || command.current || inflight.current) return;
    const next = { ...latest.current.cells, [id]: cell };
    latest.current = { ...latest.current, cells: next };
    setCells(next);
    setTexts((t) => ({ ...t, [id]: text ?? (cell.state === "value" ? String(cell.value) : "") }));
    void keepRecovery(null);
    if (!correcting) schedule();
  }

  /* ---------------------------------------------------------- the list */

  function focusAt(index: number) {
    const id = order[index];
    if (!id) return;
    setCurrent(index);
    requestAnimationFrame(() => inputs.current.get(id)?.focus());
  }

  function typed(id: string, index: number, raw: string) {
    const text = cleanTyped(raw);
    if (text === null) {
      toast.show({ text: tx(p("Type the mark in numbers only", "अंक सिर्फ़ गिनती में लिखें")), tone: "bad" });
      return;
    }
    // A point straight after the sheet moved on belongs to the child before:
    // "80.5" on a whole-mark paper must not leave ".5" for the next child.
    const moved = advancedFrom.current;
    if (text.startsWith(".") && moved && moved.to === index) {
      advancedFrom.current = null;
      focusAt(moved.from);
      toast.show({ text: tx(paper.markStep < 1 ? p("Finish the mark in the box above", "ऊपर वाले खाने में अंक पूरा करें") : p("This paper takes whole marks only", "इस पेपर में सिर्फ़ पूरे अंक दिए जाते हैं")), tone: "bad" });
      return;
    }
    advancedFrom.current = null;
    if (text.endsWith(".") && paper.markStep < 1) {
      setTexts((t) => ({ ...t, [id]: text }));
      return;
    }
    const parsed = parseMark(text, paper.maxMarks, paper.markStep);
    if (!parsed.ok) {
      toast.show({ text: parsed.reason === "over" ? `${tx(p("Highest mark is", "अधिकतम अंक"))} ${paper.maxMarks}` : tx(p("That mark cannot be given on this paper", "यह अंक इस पेपर में नहीं हो सकता")), tone: "bad" });
      return;
    }
    update(id, parsed.value === null ? BLANK : { state: "value", value: parsed.value }, text);
    if (parsed.value !== null && shouldAdvance(text, paper.maxMarks, paper.markStep)) {
      const next = nextBlank(order, { ...latest.current.cells }, index);
      if (next >= 0) {
        advancedFrom.current = { from: index, to: next };
        focusAt(next);
      }
    }
  }

  function keyDown(e: KeyboardEvent<HTMLInputElement>, id: string, index: number) {
    if (e.key === "Enter" || e.key === "ArrowDown") {
      e.preventDefault();
      focusAt(Math.min(order.length - 1, index + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      focusAt(Math.max(0, index - 1));
    } else if ((e.key === "a" || e.key === "A") && !e.ctrlKey && !e.metaKey && !e.altKey && (latest.current.cells[id] ?? BLANK).state === "blank" && !(texts[id] ?? "")) {
      // The A shortcut only on an empty box, and said out loud: typing "abc"
      // or Ctrl+A into a box with a mark used to make the child Absent silently.
      e.preventDefault();
      update(id, { state: "absent", value: null });
      toast.show({ text: tx(p(`${byId.get(id)?.name ?? ""} marked Absent · tap Absent again to undo`, `${byId.get(id)?.name ?? ""} अनुपस्थित · हटाने के लिए फिर “अनुपस्थित” दबाएँ`)) });
      focusAt(Math.min(order.length - 1, index + 1));
    }
  }

  function toggleAbsent(id: string) {
    const cell = latest.current.cells[id] ?? BLANK;
    update(id, cell.state === "absent" ? BLANK : { state: "absent", value: null });
  }

  function toggleExempt(id: string) {
    if (!paper.allowExempt) return;
    const cell = latest.current.cells[id] ?? BLANK;
    update(id, cell.state === "exempt" ? BLANK : { state: "exempt", value: null });
  }

  async function restoreRecovery() {
    if (!recovered || !paper.examOpen || paper.locked || inflight.current) return;
    const value = recovered;
    const restored = Object.fromEntries(Object.entries(value.cells).filter(([id]) => byId.has(id)));
    latest.current = { ...latest.current, cells: restored, revision: value.revision };
    setCells(restored);
    setTexts(textsOf(restored));
    setRecovered(null);
    if (value.command) {
      command.current = value.command;
      await runCommand(value.command);
    } else {
      setPhase("entry");
      if (canCorrect && value.correctionReason !== null && value.correctionReason !== undefined) {
        setCorrecting(true);
        setReason(value.correctionReason);
      }
      await keepRecovery(null, value.correctionReason ?? null);
      const draft = draftEntries(order, restored, latest.current.saved, paper.maxMarks, paper.markStep);
      if (entryStatus === "open" && draft.changed.length && !stopOnMisfits(draft.blocked, restored, "draft")) {
        await runCommand({ commandId: crypto.randomUUID(), paperId: paper.id, kind: "draft", expectedRevision: value.revision, reason: null, entries: draft.entries });
      }
    }
  }

  /* ------------------------------------------------------- number pad */

  function padKey(key: string) {
    const id = order[current];
    if (!id || !editable) return;
    if (key === "AB") {
      update(id, { state: "absent", value: null });
      advancePad();
      return;
    }
    const text = pressKey(padText, key, paper.maxMarks, paper.markStep);
    setPadText(text);
    const parsed = parseMark(text, paper.maxMarks, paper.markStep);
    if (parsed.ok && parsed.value !== null) {
      update(id, { state: "value", value: parsed.value }, text);
      if (shouldAdvance(text, paper.maxMarks, paper.markStep)) advancePad();
    } else if (text === "") {
      update(id, BLANK, "");
    }
  }

  function advancePad() {
    const next = nextBlank(order, latest.current.cells, current);
    setPadText("");
    if (next >= 0 && next !== current) setCurrent(next);
    else if (current < order.length - 1) setCurrent(current + 1);
  }

  function goPad(index: number) {
    const clamped = Math.max(0, Math.min(order.length - 1, index));
    setCurrent(clamped);
    setPadText("");
  }

  /* ------------------------------------------------------ sending */

  async function send(kind: "submit" | "correction") {
    if (inflight.current || busy || !ready || recovered) return;
    if (timer.current) clearTimeout(timer.current);
    setBusy(true);
    try {
      if (command.current) { await runCommand(command.current); return; }
      // Sending is strict: the whole column, every child it is waiting on named.
      // A correction, like a draft, sends and checks only what it changes.
      const changed = changedIds(order, latest.current.cells, latest.current.saved);
      const bad = kind === "submit" ? submitBlockers(order, latest.current.cells, paper.maxMarks, paper.markStep) : misfits(changed, latest.current.cells, paper.maxMarks, paper.markStep);
      if (stopOnMisfits(bad, latest.current.cells, kind)) return;
      if (kind === "submit" && !(await flush())) return;
      const result = await runCommand({
        commandId: crypto.randomUUID(),
        paperId: paper.id,
        kind,
        expectedRevision: latest.current.revision,
        reason: kind === "correction" ? reason.trim() || null : null,
        entries: toEntries(kind === "submit" ? order : changed, latest.current.cells),
      });
      if (result?.ok && kind === "correction") toast.show({ text: tx(p("Correction saved", "सुधार सहेजा गया")) });
    } finally { setBusy(false); }
  }

  async function withdraw() {
    if (!onWithdraw || busy || !ready || recovered || pendingCommand || inflight.current || command.current) return;
    setBusy(true);
    const result = await onWithdraw(paper.id, latest.current.revision).catch(() => null);
    setBusy(false);
    if (result?.ok) {
      latest.current = { ...latest.current, revision: result.revision };
      setRevision(result.revision);
      setEntryStatus("open");
      setSubmittedAt(null);
      setPhase("entry");
      setUndoOpen(false);
      setUndoUntil(null);
      setSubmittedBy(null);
      toast.show({ text: tx(p("Taken back — you can change marks again", "वापस लिया — अब अंक फिर बदल सकते हैं")) });
      router.refresh();
    } else {
      // Too late, or not hers to take back: the server has changed nothing, and
      // the screen stops offering what it will refuse.
      if (result && !result.ok && (result.reason === "too_late" || result.reason === "not_permitted" || result.reason === "not_submitted")) {
        setUndoOpen(false);
        setUndoNote(result.message);
      }
      toast.show({ text: tx(result && !result.ok ? result.message : p("Could not take it back", "वापस नहीं लिया जा सका")), tone: "bad" });
    }
  }

  async function reopen() {
    if (inflight.current || busy || !ready || recovered || command.current) return;
    setBusy(true);
    const result = await runCommand({
      commandId: crypto.randomUUID(),
      paperId: paper.id,
      kind: "reopen",
      expectedRevision: latest.current.revision,
      reason: null,
      entries: [],
    });
    setBusy(false);
    setAskReopen(false);
    if (result?.ok) {
      latest.current = { ...latest.current, revision: result.revision };
      setRevision(result.revision);
      setEntryStatus("open");
      setPhase("entry");
      toast.show({ text: tx(p("Handed back to the teacher", "अध्यापक को वापस दिया")) });
      router.refresh();
    } else {
      toast.show({ text: tx(result && !result.ok ? result.message : p("Could not hand it back", "वापस नहीं दिया जा सका")), tone: "bad" });
    }
  }

  /* --------------------------------------------------------- pieces */

  const title = `${paper.classLabel} · ${paper.subjectCode}`;
  const subLine = `${tx(paper.examLabel)} · ${tx(p("out of", "पूर्णांक"))} ${paper.maxMarks}${paper.dueLabel ? ` · ${tx(p("enter by", "अंतिम तिथि"))} ${paper.dueLabel}` : ""}`;
  // One line for where the save stands, read out politely when it changes.
  const statusLine =
    status === "saving"
      ? tx(p("Saving…", "सहेज रहे हैं…"))
      : status === "blocked" && blocker
        ? tx(blocker)
        : status === "error"
          ? tx(p("Not saved. Your change is still here.", "सहेजा नहीं गया। आपका बदलाव यहीं है।"))
          : status === "stale"
            ? tx(p("Not saved yet", "अभी सहेजा नहीं"))
            : local.length
              ? tx(p("Draft on this device", "इस डिवाइस पर ड्राफ़्ट"))
              : status === "saved" && lastSaved
                ? freshSave
                  ? tx(p("Saved just now", "अभी सहेजा"))
                  : `${tx(p("Saved", "सहेजा"))} ${clock(lastSaved)}`
                : tx(p("Changes save as you type", "लिखते समय बदलाव सहेजे जाते हैं"));
  const statusBad = status === "error" || status === "stale" || status === "blocked";
  const localLine = local.length ? tx(p(`${local.length} ${local.length === 1 ? "change" : "changes"} on this device`, `इस डिवाइस पर ${local.length} बदलाव`)) : null;
  // On the entry screen Retry sits beside the save line; elsewhere it is on the banner. One button, never two.
  const retry = status === "error" ? (
    <Btn variant="sec" icon="refresh" onClick={() => void flush()}>{tx(p("Retry", "फिर कोशिश करें"))}</Btn>
  ) : null;
  /** A changed row's own state, in the shared words. */
  const rowState = (): string =>
    status === "saving" ? tx(p("Saving…", "सहेज रहे…")) : statusBad ? tx(p("Not saved – retry", "सहेजा नहीं – फिर कोशिश करें")) : tx(p("Draft on this device", "इस डिवाइस पर ड्राफ़्ट"));

  const help = (
    <HelpButton
      title={tx(p("Entering marks", "अंक भरना"))}
      steps={[
        { icon: "keyboard", title: tx(p("Type the mark", "अंक लिखें")), body: tx(p("After two numbers it jumps to the next child. Press Enter for a single number.", "दो अंक लिखते ही अगला बच्चा आ जाता है। एक अंक हो तो Enter दबाएँ।")) },
        { icon: "x", title: tx(p("Absent", "अनुपस्थित")), body: tx(p("Tap Absent (or press A) for a child who missed the exam. A blank is never counted as zero.", "परीक्षा न देने वाले बच्चे के लिए Absent दबाएँ (या A)। खाली को शून्य नहीं माना जाता।")) },
        { icon: "send", title: tx(p("Check and send", "जाँचें और भेजें")), body: tx(p("When every child has a mark or Absent, check the summary and send it to the exam office.", "हर बच्चे के अंक या अनुपस्थित भरने पर सारांश देखें और परीक्षा विभाग को भेजें।")) },
      ]}
    />
  );

  const banner = paper.locked ? (
    <Banner tone="info">{tx(p("Marks for this class are final. They cannot change until the admin reopens them.", "इस कक्षा के अंक अंतिम हैं। प्रशासक के खोलने तक अंक नहीं बदलेंगे।"))}</Banner>
  ) : !paper.examOpen ? (
    <Banner tone="warn">{tx(p("This exam is not open for marks.", "यह परीक्षा अंकों के लिए खुली नहीं है।"))}</Banner>
  ) : recovered ? (
    <Banner tone="warn" action={<Btn variant="sec" disabled={busy} onClick={() => void restoreRecovery()}>{tx(recovered.command ? p("Restore and check save", "वापस लाएँ और सहेजना जाँचें") : p("Restore draft", "ड्राफ्ट वापस लाएँ"))}</Btn>}>
      {tx(recovered.command ? p("A previous save has not been confirmed. Check that same save before changing these marks.", "पिछले सहेजने की पुष्टि नहीं हुई है। अंक बदलने से पहले उसी सहेजने को जाँचें।") : p("This phone has a draft from your previous visit.", "इस फोन पर आपकी पिछली बार का ड्राफ्ट है।"))}
      {!recovered.command ? <Btn variant="ghost" disabled={busy} onClick={() => { void clearRecovery().then((cleared) => { if (cleared) setRecovered(null); }); }}>{tx(p("Discard draft", "ड्राफ्ट हटाएँ"))}</Btn> : null}
    </Banner>
  ) : oldPending ? (
    <Banner tone="warn" action={<Btn variant="ghost" disabled={busy} onClick={() => { void clearRecovery().then((cleared) => { if (cleared) { setOldDraft(null); setViewOld(false); } }); }}>{tx(p("Discard draft", "ड्राफ्ट हटाएँ"))}</Btn>}>
      {tx(p("This phone has a draft from an older version of this paper — the marks were saved again since. It has not been put back.", "इस फ़ोन पर इस पेपर के पुराने रूप का ड्राफ़्ट है — उसके बाद अंक फिर सहेजे गए। इसे वापस नहीं लगाया गया।"))}{" "}
      <button type="button" className="tap" onClick={() => setViewOld(!viewOld)} style={{ border: 0, background: "transparent", padding: 0, color: "inherit", fontWeight: 700, textDecoration: "underline" }}>
        {viewOld ? tx(p("Hide draft", "ड्राफ़्ट छिपाएँ")) : tx(p(`View draft (${oldDiff.length})`, `ड्राफ़्ट देखें (${oldDiff.length})`))}
      </button>
      {viewOld ? (
        <span style={{ display: "block", marginTop: 6, fontSize: 13 }}>
          {oldDiff.slice(0, 30).map(([id, cell]) => (
            <span key={id} style={{ display: "block" }}>
              {byId.get(id)?.name ?? "—"}: {tx(p("draft", "ड्राफ़्ट"))} {cellText(cell)} · {tx(p("saved", "सहेजा"))} {cellText(saved[id] ?? BLANK)}
            </span>
          ))}
          {oldDiff.length > 30 ? "…" : null}
        </span>
      ) : null}
    </Banner>
  ) : message ? (
    <Banner
      tone={status === "stale" ? "warn" : "bad"}
      action={status === "stale" ? <Btn variant="sec" onClick={() => window.location.reload()}>{tx(p("Reload", "फिर खोलें"))}</Btn> : status === "error" && phase !== "entry" ? <Btn variant="sec" icon="refresh" onClick={() => void flush()}>{tx(p("Retry", "फिर कोशिश करें"))}</Btn> : undefined}
    >
      {tx(message)}
      {who.length ? ` (${who.slice(0, 12).join(", ")}${who.length > 12 ? "…" : ""})` : ""}
    </Banner>
  ) : badNow.length && !paper.locked && paper.examOpen ? (
    <Banner tone="warn">
      {tx(p(`${badNow.length} saved ${badNow.length === 1 ? "mark needs" : "marks need"} correction before this paper can be sent. They are kept exactly as saved, and other changes still save:`, `${badNow.length} सहेजे अंक भेजने से पहले सुधारने हैं। ये जैसे सहेजे थे वैसे ही रखे हैं, और बाकी बदलाव सेव होते रहेंगे:`))}{" "}
      {badNow.map((id) => `${byId.get(id)?.name ?? "—"} (${cells[id]?.value ?? ""})`).join(", ")}
    </Banner>
  ) : null;

  /* ---------------------------------------------------- phase: sent */

  if (phase === "sent") {
    const until = undoUntil ? clock(undoUntil) : null;
    return (
      <VxPage>
        <TopBar crumb={crumb} title={tx(p("Marks sent", "अंक भेजे गए"))} mTitle={tx(p("Marks sent", "अंक भेजे गए"))} mSub={title} mBack={backHref} actions={help} mAction={help} />
        <main>
          {banner ? <section className="pad" style={{ padding: "16px 28px 0" }}>{banner}</section> : null}
          <section className="pad" style={{ padding: "28px 28px 40px", display: "flex", justifyContent: "center" }}>
            <Card style={{ maxWidth: 520, width: "100%", display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center", gap: 14, padding: "28px 22px" }}>
              <SuccessTick />
              <h2 className="serif" style={{ margin: 0, fontSize: 26 }}>{tx(p("Marks sent", "अंक भेजे गए"))}</h2>
              <p style={{ margin: 0, fontSize: 16 }}>
                {coordinatorName ? `${coordinatorName} (${tx(p("exam coordinator", "परीक्षा प्रभारी"))}) ${tx(p("has your marks.", "के पास आपके अंक हैं।"))}` : tx(p("The exam office has your marks.", "परीक्षा विभाग के पास आपके अंक हैं।"))}
              </p>
              <span style={{ color: "var(--mut)", fontSize: 13 }}>
                {title} · {students.length} {tx(p("children", "बच्चे"))}
                {submittedAt ? ` · ${tx(p("sent at", "भेजा"))} ${clock(submittedAt)}, ${shortDay(submittedAt)}` : ""}
              </span>
              {paper.locked ? null : mayUndo ? (
                <div style={{ display: "flex", alignItems: "center", gap: 12, background: "var(--s2)", borderRadius: 14, padding: "12px 14px", width: "100%", textAlign: "left" }}>
                  <Ic n="clock" size={18} style={{ color: "var(--mut)", flex: "none" }} />
                  <span style={{ flex: 1, fontSize: 14 }}>
                    {tx(p("Made a mistake? You can undo for 10 minutes", "गलती हुई? 10 मिनट तक वापस ले सकते हैं"))}
                    {until ? ` (${tx(p("till", "तक"))} ${until}).` : "."}
                  </span>
                  <Btn variant="sec" icon="undo" disabled={busy || !ready || Boolean(recovered) || pendingCommand} onClick={() => void withdraw()}>{tx(p("Undo submission", "जमा करना वापस लें"))}</Btn>
                </div>
              ) : submittedAt && entryStatus === "submitted" ? (
                // After the ten minutes, or for anyone but the sender: when it was sent, and who changes it now.
                <div role="status" style={{ display: "flex", alignItems: "center", gap: 12, background: "var(--s2)", borderRadius: 14, padding: "12px 14px", width: "100%", textAlign: "left" }}>
                  <Ic n="checkCircle" size={18} style={{ color: "var(--ok)", flex: "none" }} />
                  <span style={{ flex: 1, fontSize: 14, display: "flex", flexDirection: "column" }}>
                    <span>{tx(p(`Submitted on ${shortDay(submittedAt)}, ${clock(submittedAt)}`, `${shortDay(submittedAt)}, ${clock(submittedAt)} को जमा किया`))}</span>
                    {undoNote ? <span style={{ fontSize: 13, color: "var(--bad)" }}>{tx(undoNote)}</span> : onWithdraw && !canCorrect ? <span style={{ fontSize: 13, color: "var(--mut)" }}>{tx(p("To change a mark now, ask the exam office.", "अब अंक बदलने के लिए परीक्षा विभाग से कहें।"))}</span> : null}
                  </span>
                </div>
              ) : null}
              {canCorrect || canReopen ? (
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "center" }}>
                  {canCorrect && !paper.locked ? (
                    <Btn variant="soft" icon="edit" disabled={!ready || Boolean(recovered) || pendingCommand || busy} onClick={() => { setCorrecting(true); setPhase("entry"); }}>{tx(p("Correct a mark", "अंक सुधारें"))}</Btn>
                  ) : null}
                  {canReopen && !paper.locked ? (
                    <Btn variant="sec" icon="undo" disabled={!ready || Boolean(recovered) || pendingCommand || busy} onClick={() => setAskReopen(true)}>{tx(p("Hand back to teacher", "अध्यापक को वापस दें"))}</Btn>
                  ) : null}
                </div>
              ) : null}
              {/* The saved marks, read only: nothing is opened for editing and nothing autosaves. */}
              <Btn variant="ghost" icon="eye" onClick={() => setPhase("entry")}>{tx(p("View saved marks", "सहेजे अंक देखें"))}</Btn>
              {nextHref ? (
                <Btn variant="pri" big href={nextHref}>
                  {tx(p("Next", "अगला"))}: {nextLabel} <Ic n="arrowRight" size={18} />
                </Btn>
              ) : null}
              {doneHref ? <Btn variant="sec" href={doneHref}>{tx(p("Back to the list", "सूची पर वापस"))}</Btn> : null}
            </Card>
          </section>
        </main>
        <Confirm
          open={askReopen}
          onClose={() => setAskReopen(false)}
          onConfirm={() => void reopen()}
          busy={busy}
          title={tx(p("Hand this paper back?", "यह पेपर वापस दें?"))}
          body={tx(p("The teacher can change marks again and must send it once more.", "अध्यापक फिर से अंक बदल सकेंगे और दोबारा भेजना होगा।"))}
          confirmLabel={tx(p("Hand back", "वापस दें"))}
        />
      </VxPage>
    );
  }

  /* --------------------------------------------------- phase: check */

  if (phase === "check") {
    const pass = paper.passMarks;
    const bins = histogram(order.map((id) => cells[id]).filter((x): x is Cell => Boolean(x && x.state === "value")).map((x) => x.value as number), paper.maxMarks, pass);
    const highestName = summary.highest === null ? "" : (students.find((s) => cells[s.id]?.state === "value" && cells[s.id]?.value === summary.highest)?.name ?? "");
    const sendBar = (
      <div className="glass" style={{ position: "sticky", bottom: "var(--vx-bottom-h)", zIndex: 10, borderTop: "1px solid var(--bd)", padding: "12px 28px", display: "flex", alignItems: "center", gap: 12 }}>
        <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
          <strong>{summary.blanks.length ? `${summary.blanks.length} ${tx(p("still missing", "बाकी"))}` : tx(p("Every child has a mark", "हर बच्चे के अंक भरे"))}</strong>
          <span style={{ fontSize: 12, color: "var(--mut)" }}>{coordinatorName ? `${tx(p("To", "को"))} ${coordinatorName} · ${tx(p("exam coordinator", "परीक्षा प्रभारी"))}` : tx(p("To the exam office", "परीक्षा विभाग को"))}</span>
        </span>
        <Btn variant="pri" big icon="send" disabled={busy || summary.blanks.length > 0 || !editable} onClick={() => void send("submit")}>
          {tx(p("Send to exam coordinator", "परीक्षा प्रभारी को भेजें"))}
        </Btn>
      </div>
    );
    return (
      <VxPage>
        <TopBar crumb={crumb} title={tx(p("Check and send", "जाँचें और भेजें"))} mTitle={tx(p("Check and send", "जाँचें और भेजें"))} mSub={title} mBack={undefined} actions={help} mAction={help} />
        <main>
          <section className="pad" style={{ padding: "22px 28px 24px", display: "flex", flexDirection: "column", gap: 16 }}>
            <div>
              <Btn variant="ghost" icon="chevLeft" onClick={() => setPhase("entry")}>{tx(p("Back to marks", "अंकों पर वापस"))}</Btn>
            </div>
            <div>
              <h2 className="serif" style={{ margin: 0, fontSize: 28 }}>{tx(p("Check before sending", "भेजने से पहले जाँचें"))}</h2>
              <span style={{ color: "var(--mut)" }}>{subLine}</span>
            </div>
            {banner}
            <div className="g4" style={{ display: "grid", gridTemplateColumns: "repeat(4,minmax(0,1fr))", gap: 12 }}>
              <Card><Stat label={tx(p("Class average", "कक्षा औसत"))} value={summary.average ?? "—"} sub={`${tx(p("out of", "में से"))} ${paper.maxMarks}`} /></Card>
              <Card><Stat label={tx(p("Highest", "सर्वाधिक"))} value={summary.highest ?? "—"} sub={highestName} tone="var(--ok)" /></Card>
              <Card><Stat label={tx(p("Marks entered", "अंक भरे"))} value={`${c.filled}/${c.total}`} sub={c.blank ? `${c.blank} ${tx(p("missing", "बाकी"))}` : tx(p("all in", "सब भरे"))} tone={c.blank ? "var(--warnfg)" : "var(--ok)"} /></Card>
              <Card><Stat label={tx(p("Absent", "अनुपस्थित"))} value={c.absent} sub={tx(p("on exam day", "परीक्षा के दिन"))} /></Card>
            </div>
            <div className="g2" style={{ display: "grid", gridTemplateColumns: "repeat(2,minmax(0,1fr))", gap: 16, alignItems: "start" }}>
              <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                <Card>
                  <h3 style={{ margin: "0 0 10px", fontSize: 15 }}>{tx(p("How the class did", "कक्षा का प्रदर्शन"))}</h3>
                  <BarChart data={bins} height={170} format={(v) => String(Math.round(v))} />
                </Card>
                {pass !== null ? (
                  <Card>
                    <h3 style={{ margin: 0, fontSize: 15 }}>{tx(p("Children below", "इनसे कम अंक"))} {pass} ({Math.round((pass / paper.maxMarks) * 100)}%)</h3>
                    <p style={{ margin: "2px 0 8px", color: "var(--mut)", fontSize: 13 }}>{tx(p("Nothing to change — just so you know. A short note helps their class teacher.", "कुछ बदलना नहीं है — बस जानकारी के लिए। एक छोटा नोट कक्षा अध्यापक की मदद करता है।"))}</p>
                    {summary.below.length === 0 ? <span style={{ color: "var(--mut)" }}>{tx(p("Nobody — well done.", "कोई नहीं — बढ़िया।"))}</span> : null}
                    {summary.below.map((id) => {
                      const s = byId.get(id)!;
                      return (
                        <div key={id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 0", borderTop: "1px solid var(--bd)" }}>
                          <Avatar text={initials(s.name)} bg={avatarColor(s.name)} size={34} />
                          <span style={{ flex: 1, minWidth: 0 }}>
                            <strong className="clip" style={{ display: "block" }}>{s.name}</strong>
                            <span style={{ fontSize: 12, color: "var(--mut)" }}>{cells[id]?.value} / {paper.maxMarks}{s.prev ? ` · ${s.prev}` : ""}</span>
                          </span>
                          {noteHref ? <Btn variant="soft" href={`${noteHref}${id}`}>{tx(p("Add a note", "नोट लिखें"))}</Btn> : null}
                        </div>
                      );
                    })}
                  </Card>
                ) : null}
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                {summary.blanks.length ? (
                  <Card style={{ borderColor: "var(--warn)" }}>
                    <h3 style={{ margin: 0, fontSize: 15 }}>{summary.blanks.length} {tx(p("children have no mark yet", "बच्चों के अंक अभी नहीं भरे"))}</h3>
                    <p style={{ margin: "2px 0 8px", color: "var(--mut)", fontSize: 13 }}>{tx(p("Enter the mark, or tap Absent if they missed the exam.", "अंक भरें, या परीक्षा छोड़ने पर अनुपस्थित दबाएँ।"))}</p>
                    {summary.blanks.map((id) => {
                      const s = byId.get(id)!;
                      return (
                        <div key={id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 0", borderTop: "1px solid var(--bd)" }}>
                          <span className="num" style={{ width: 28, color: "var(--mut)" }}>{s.roll ?? "—"}</span>
                          <strong className="clip" style={{ flex: 1, minWidth: 0 }}>{s.name}</strong>
                          <Btn variant="sec" disabled={!editable} onClick={() => update(id, { state: "absent", value: null })}>{tx(p("Absent", "अनुपस्थित"))}</Btn>
                          <Btn variant="soft" onClick={() => { setPhase("entry"); focusAt(order.indexOf(id)); setCurrent(order.indexOf(id)); }}>{tx(p("Enter mark", "अंक भरें"))}</Btn>
                        </div>
                      );
                    })}
                  </Card>
                ) : null}
                <Card>
                  <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                    <Avatar text={initials(coordinatorName ?? "Exam office")} bg={avatarColor(coordinatorName ?? "x")} size={40} />
                    <span style={{ display: "flex", flexDirection: "column" }}>
                      <strong>{coordinatorName ?? tx(p("Exam office", "परीक्षा विभाग"))}</strong>
                      <span style={{ fontSize: 13, color: "var(--mut)" }}>{tx(p("Exam coordinator · gets your marks", "परीक्षा प्रभारी · आपके अंक इन्हें मिलेंगे"))}</span>
                    </span>
                  </div>
                  <div style={{ marginTop: 12 }}>
                    <Banner tone="info">{tx(p("After sending, you have ten minutes to undo. After that, ask the exam office to change a mark.", "भेजने के बाद दस मिनट तक वापस ले सकते हैं। उसके बाद अंक बदलने के लिए परीक्षा विभाग से कहें।"))}</Banner>
                  </div>
                </Card>
              </div>
            </div>
          </section>
          {sendBar}
        </main>
      </VxPage>
    );
  }

  /* ------------------------------------- phase: entry, the exam office */

  if (variant === "office") {
    const line = paper.passMarks ?? Math.ceil(paper.maxMarks * 0.33);
    const linePct = Math.floor((line / Math.max(1, paper.maxMarks)) * 100);
    const values = order.map((id) => cells[id]).filter((x): x is Cell => Boolean(x && x.state === "value" && x.value !== null));
    const lowCount = values.filter((x) => (x.value as number) < line).length;
    const highest = summary.highest === null ? null : (students.find((s) => cells[s.id]?.state === "value" && cells[s.id]?.value === summary.highest)?.name ?? null);
    const stats = [
      { label: tx(p("Average", "औसत")), value: summary.average === null ? "—" : summary.average.toFixed(1), tone: "var(--fg)" },
      { label: tx(p("Highest", "सर्वाधिक")), value: summary.highest === null ? "—" : String(summary.highest), tone: "var(--ok)", title: highest ?? undefined },
      { label: tx(p(`Below ${linePct}%`, `${linePct}% से कम`)), value: String(lowCount), tone: lowCount ? "var(--bad)" : "var(--fg)" },
    ];
    const cols = `36px minmax(0,1fr) 92px ${paper.allowExempt ? "110px" : "52px"}`;
    const colsM = `22px minmax(0,1fr) 70px ${paper.allowExempt ? "100px" : "48px"}`;
    const title2 = `${paper.classLabel} ${paper.subjectCode} · ${tx(p("enter marks", "अंक भरें"))}`;
    return (
      <VxPage>
        <style href="vx-marks-office" precedence="default">{`.xer{display:grid;grid-template-columns:${cols};gap:10px;align-items:center;min-height:58px;padding:6px 16px}.xer.xd+.xer.xd{border-top:1px solid var(--bd)}.xsave{bottom:12px}@container vx (max-width:899px){.xer{grid-template-columns:${colsM};padding:6px 12px}.xsave{bottom:calc(var(--vx-bottom-h) + 12px)}}`}</style>
        <ExamsTop crumb={crumb} title={title2} back={backHref} mSub={`${tx(p("Out of", "पूर्णांक"))} ${paper.maxMarks} · ${tx(p("admin entry", "प्रशासक प्रविष्टि"))}`} mBack={backHref} />
        <main>
          <div className="pad" style={{ padding: "16px 28px 20px" }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 12, maxWidth: 880, margin: "0 auto" }}>
              {!officeEdit && !correcting ? (
                <Note icon="eye" tone="info">
                  <span style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10, justifyContent: "space-between", width: "100%" }}>
                    <span>{tx(p("You are looking at the saved marks. Nothing changes until you press Edit marks.", "आप सहेजे अंक देख रहे हैं। “अंक बदलें” दबाने तक कुछ नहीं बदलेगा।"))}</span>
                    {entryStatus === "open" && paper.examOpen && !paper.locked ? (
                      <Btn variant="sec" icon="edit" disabled={!ready || Boolean(recovered) || oldPending || pendingCommand} onClick={() => setOfficeEdit(true)}>{tx(p("Edit marks", "अंक बदलें"))}</Btn>
                    ) : null}
                  </span>
                </Note>
              ) : null}
              {officeEdit || correcting ? (
              <Note icon="shield" tone="warn">
                <b>{tx(p("Admin override.", "प्रशासक द्वारा।"))}</b>{" "}
                {forTeacher
                  ? tx(p(`You are entering ${paper.classLabel} ${paper.subjectCode} marks for ${forTeacher}. Each change is logged with your name.`, `आप ${forTeacher} की जगह ${paper.classLabel} ${paper.subjectCode} के अंक भर रहे हैं। हर बदलाव आपके नाम से दर्ज होता है।`))
                  : tx(p(`You are entering ${paper.classLabel} ${paper.subjectCode} marks. Each change is logged with your name.`, `आप ${paper.classLabel} ${paper.subjectCode} के अंक भर रहे हैं। हर बदलाव आपके नाम से दर्ज होता है।`))}
              </Note>
              ) : null}
              {banner}
              {correcting ? (
                <Card style={{ borderColor: "var(--warn)" }}>
                  <strong>{tx(p("Correcting a sent paper", "भेजे पेपर में सुधार"))}</strong>
                  <p style={{ margin: "4px 0 8px", color: "var(--mut)", fontSize: 13 }}>{tx(p("Change the marks, say why, then save. Every change is kept with its reason.", "अंक बदलें, कारण लिखें, फिर सहेजें। हर बदलाव कारण सहित रखा जाता है।"))}</p>
                  <Textarea value={reason} disabled={!editable} onChange={(e) => { const next = e.target.value; setReason(next); void keepRecovery(null, next); }} placeholder={tx(p("Why are these marks changing?", "अंक क्यों बदल रहे हैं?"))} rows={2} />
                  <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                    <Btn variant="pri" icon="check" disabled={!editable || reason.trim().length < 3} onClick={() => void send("correction")}>{tx(p("Save correction", "सुधार सहेजें"))}</Btn>
                    <Btn variant="ghost" disabled={pendingCommand || busy} onClick={() => { setCorrecting(false); setCells(saved); latest.current = { ...latest.current, cells: saved }; setTexts(textsOf(saved)); setPhase("sent"); void clearRecovery(); }}>{tx(p("Cancel", "रद्द करें"))}</Btn>
                  </div>
                </Card>
              ) : null}
              <div className="card" style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "12px 22px", padding: "14px 16px" }}>
                {stats.map((k) => (
                  <span key={k.label} title={k.title} style={{ display: "flex", flexDirection: "column" }}>
                    <span style={{ fontSize: 12, color: "var(--mut)" }}>{k.label}</span>
                    <span className="num" style={{ fontSize: 20, fontWeight: 700, color: k.tone }}>{k.value}</span>
                  </span>
                ))}
                <span style={{ display: "flex", flexDirection: "column", gap: 6, flex: 1, minWidth: 150 }}>
                  <span style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
                    <span style={{ color: "var(--mut)" }}>{tx(p("Saved", "सहेजे"))}</span>
                    <b className="num">{tx(p(`${c.filled} of ${c.total}`, `${c.total} में से ${c.filled}`))}</b>
                  </span>
                  <XBar parts={[{ w: c.total ? (c.filled / c.total) * 100 : 0, color: "var(--acc)" }]} />
                </span>
              </div>
              <div className="card" style={{ overflow: "hidden" }}>
                <div className="only-d xer" style={{ minHeight: 42, background: "var(--s2)", borderBottom: "1px solid var(--bd)" }}>
                  <span className="sech">{tx(p("Roll", "रोल"))}</span>
                  <span className="sech">{tx(p("Student", "विद्यार्थी"))}</span>
                  <span className="sech" style={{ textAlign: "center" }}>{tx(p("Marks", "अंक"))} / {paper.maxMarks}</span>
                  <span className="sech">{tx(p("Absent", "अनुपस्थित"))}</span>
                </div>
                <div>
                  {students.map((s, i) => {
                    const cell = cells[s.id] ?? BLANK;
                    const off = cell.state === "value" && looksOff(cell.value, s.prevPct, paper.maxMarks);
                    const pct = cell.state === "value" && cell.value !== null ? (cell.value / Math.max(1, paper.maxMarks)) * 100 : null;
                    const res = badSet.has(s.id)
                      ? { t: tx(needsCorrectionText(cell.value ?? 0, paper.maxMarks, paper.markStep)), c: "var(--bad)" }
                      : cell.state === "absent"
                        ? { t: tx(p("Absent", "अनुपस्थित")), c: "var(--mut)" }
                        : cell.state === "exempt"
                          ? { t: tx(p("Exempt", "छूट")), c: "var(--mut)" }
                          : pct === null
                            ? { t: tx(p("Not entered", "नहीं भरा")), c: "var(--mut)" }
                            : off
                              ? { t: `${Math.round(pct)}% · ${tx(p("far from last test", "पिछले टेस्ट से बहुत अलग"))}`, c: "var(--warnfg)" }
                              : { t: `${Math.round(pct)}%`, c: (cell.value as number) < line ? "var(--bad)" : "var(--mut)" };
                    const away = cell.state === "absent" || cell.state === "exempt";
                    return (
                      <div key={s.id} className="row xer xd">
                        <span className="num" style={{ fontSize: 12, fontWeight: 700, color: "var(--mut)" }}>{s.roll ?? "—"}</span>
                        <span style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
                          <span className="clip" style={{ fontSize: 15, fontWeight: 600 }}>{s.name}</span>
                          <span style={{ fontSize: 12, fontWeight: 700, color: res.c }}>{res.t}</span>
                        </span>
                        {away ? (
                          <span className="pill" style={{ height: 42, borderRadius: 12, justifyContent: "center", fontSize: 12, color: "var(--mut)", background: "var(--s3)", animation: "xPopIn .3s var(--spring) both" }}>
                            {cell.state === "absent" ? tx(p("Absent", "अनुपस्थित")) : tx(p("Exempt", "छूट"))}
                          </span>
                        ) : (
                          <input
                            ref={(el) => {
                              if (el) inputs.current.set(s.id, el);
                              else inputs.current.delete(s.id);
                            }}
                            className={`inp num${off || badSet.has(s.id) ? " err" : ""}`}
                            type="text"
                            inputMode="decimal"
                            placeholder="—"
                            aria-label={`${s.name} — ${tx(p("Row", "पंक्ति"))} ${i + 1}${s.roll ? `, ${tx(p("Roll", "रोल"))} ${s.roll}` : ""} — ${tx(p("mark out of", "अंक, पूर्णांक"))} ${paper.maxMarks}`}
                            disabled={!editable}
                            value={texts[s.id] ?? ""}
                            onFocus={() => setCurrent(i)}
                            onChange={(e) => typed(s.id, i, e.target.value)}
                            onKeyDown={(e) => keyDown(e, s.id, i)}
                            style={{ height: 42, padding: "0 6px", textAlign: "center", fontWeight: 700 }}
                          />
                        )}
                        <span style={{ display: "flex", gap: 6 }}>
                          <button type="button" className={`tap chip${cell.state === "absent" ? " on" : ""}`} aria-pressed={cell.state === "absent"} aria-label={tx(p(`Mark ${s.name} absent`, `${s.name} को अनुपस्थित करें`))} disabled={!editable} onClick={() => toggleAbsent(s.id)} style={{ flex: 1, padding: 0, justifyContent: "center" }}>
                            AB
                          </button>
                          {paper.allowExempt ? (
                            <button type="button" className={`tap chip${cell.state === "exempt" ? " on" : ""}`} aria-pressed={cell.state === "exempt"} aria-label={tx(p(`Mark ${s.name} exempt`, `${s.name} को छूट दें`))} disabled={!editable} onClick={() => toggleExempt(s.id)} style={{ flex: 1, padding: 0, justifyContent: "center" }}>
                              EX
                            </button>
                          ) : null}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
              <div className="glass xsave" style={{ position: "sticky", zIndex: 4, marginTop: 4, display: "flex", alignItems: "center", gap: 12, padding: "8px 8px 8px 16px", borderRadius: 18, border: "1px solid var(--bd)", boxShadow: "var(--shh)" }}>
                <span style={{ flex: 1, minWidth: 0, display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: statusBad ? "var(--bad)" : "var(--mut)" }}>
                  {status === "saving" ? (
                    <span aria-hidden="true" style={{ flex: "none", width: 16, height: 16, borderRadius: 8, border: "2px solid var(--bds)", borderTopColor: "var(--acc)", animation: "xLoop .7s linear infinite" }} />
                  ) : status === "saved" ? (
                    <Ic n="checkCircle" style={{ flex: "none", color: "var(--ok)", animation: "xPopIn .35s var(--spring) both" }} />
                  ) : null}
                  <span className="clip" role="status" aria-live="polite">{statusLine}{localLine ? ` · ${localLine}` : ""}</span>
                  <span className="hide-m" style={{ display: "flex", alignItems: "center", gap: 4, flex: "none" }}>
                    · <span className="k">Enter</span>
                    {tx(p("next student", "अगला विद्यार्थी"))}
                  </span>
                </span>
                {retry}
                {entryStatus === "submitted" && !correcting ? (
                  <Btn variant="sec" onClick={() => setPhase("sent")}>{tx(p("Sent", "भेजा"))} ✓</Btn>
                ) : !correcting ? (
                  <button type="button" className="tap btn pri" style={{ height: 46 }} disabled={!editable || busy} onClick={() => { void flush(); setPhase("check"); }}>
                    <Ic n="checkCircle" />
                    {tx(p("Check and submit", "जाँचें और जमा करें"))}
                  </button>
                ) : null}
              </div>
            </div>
          </div>
        </main>
      </VxPage>
    );
  }

  /* --------------------------------------------------- phase: entry */

  // Never fold away a row whose mark the paper cannot hold: it has to be fixed.
  const firstBad = badNow.length ? order.indexOf(badNow[0]) : order.length;
  const hiddenUntil = showDone ? 0 : Math.min(firstUnfilledRun(order, saved, current), firstBad);
  const modeSeg = (
    <Seg
      label={tx(p("How to enter", "कैसे भरें"))}
      value={mode}
      onChange={(v) => setMode(v)}
      options={[
        { value: "list", label: tx(p("Type in list", "सूची में लिखें")) },
        { value: "pad", label: tx(p("Number pad", "नंबर पैड")) },
      ]}
    />
  );

  const padStudent = students[current];
  const padCell = padStudent ? cells[padStudent.id] : undefined;
  const ring = (
    <Card style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10, padding: "20px 18px" }}>
      <Ring value={c.filled} max={Math.max(1, c.total)} size={128} stroke={12} tone="var(--pri)">
        <strong className="num" style={{ fontSize: 30 }}>{c.filled}</strong>
        <span style={{ fontSize: 12, color: "var(--mut)" }}>{tx(p(`of ${c.total} saved`, `${c.total} में से सहेजे`))}</span>
      </Ring>
      <strong>{c.blank ? `${c.blank} ${tx(p("still to fill", "बाकी"))}` : tx(p("All filled", "सब भरे"))}</strong>
    </Card>
  );

  return (
    <VxPage>
      <TopBar
        crumb={crumb}
        title={title}
        mTitle={title}
        mSub={mode === "pad" ? `${tx(p("Number pad", "नंबर पैड"))} · ${c.filled}/${c.total}` : subLine}
        mBack={backHref}
        actions={help}
        mAction={help}
      />
      <main>
        <section className="pad stack" style={{ padding: "22px 28px 24px", display: "grid", gridTemplateColumns: "minmax(0,1fr) 290px", gap: 20, alignItems: "start" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 14, minWidth: 0 }}>
            <Card>
              <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                <span style={{ flex: 1, minWidth: 200, display: "flex", flexDirection: "column" }}>
                  <strong style={{ fontSize: 18 }}>{title}</strong>
                  <span style={{ fontSize: 13, color: "var(--mut)" }}>{subLine}</span>
                </span>
                <span style={{ minWidth: 240 }}>{modeSeg}</span>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 12 }}>
                <span style={{ flex: 1 }}><Progress value={c.filled} max={Math.max(1, c.total)} /></span>
                <strong className="num">{c.filled} / {c.total}</strong>
              </div>
            </Card>
            {banner}
            {correcting ? (
              <Card style={{ borderColor: "var(--warn)" }}>
                <strong>{tx(p("Correcting a sent paper", "भेजे पेपर में सुधार"))}</strong>
                <p style={{ margin: "4px 0 8px", color: "var(--mut)", fontSize: 13 }}>{tx(p("Change the marks, say why, then save. Every change is kept with its reason.", "अंक बदलें, कारण लिखें, फिर सहेजें। हर बदलाव कारण सहित रखा जाता है।"))}</p>
                <Textarea value={reason} disabled={!editable} onChange={(e) => { const next = e.target.value; setReason(next); void keepRecovery(null, next); }} placeholder={tx(p("Why are these marks changing?", "अंक क्यों बदल रहे हैं?"))} rows={2} />
                <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                  <Btn variant="pri" icon="check" disabled={!editable || reason.trim().length < 3} onClick={() => void send("correction")}>{tx(p("Save correction", "सुधार सहेजें"))}</Btn>
                  <Btn variant="ghost" disabled={pendingCommand || busy} onClick={() => { setCorrecting(false); setCells(saved); latest.current = { ...latest.current, cells: saved }; setTexts(textsOf(saved)); setPhase("sent"); void clearRecovery(); }}>{tx(p("Cancel", "रद्द करें"))}</Btn>
                </div>
              </Card>
            ) : null}

            {mode === "list" ? (
              <>
                <span className="only-d" style={{ fontSize: 13, color: "var(--mut)" }}>
                  {tx(p("Type the mark — after 2 numbers it jumps to the next child. Press Enter for a single number.", "अंक लिखें — दो अंक के बाद अगला बच्चा। एक अंक हो तो Enter दबाएँ।"))}
                </span>
                <Card pad={false} style={{ overflow: "hidden" }}>
                  <div className="only-d" style={{ display: "grid", gridTemplateColumns: "56px minmax(0,1fr) 110px 120px 110px", gap: 12, padding: "12px 18px", fontSize: 11, fontWeight: 700, letterSpacing: ".06em", textTransform: "uppercase", color: "var(--mut)" }}>
                    <span>{tx(p("Roll", "रोल"))}</span>
                    <span>{tx(p("Child", "बच्चा"))}</span>
                    <span style={{ textAlign: "center" }}>{tx(p("Mark", "अंक"))} / {paper.maxMarks}</span>
                    <span style={{ textAlign: "center" }}>{tx(p("Absent?", "अनुपस्थित?"))}</span>
                    <span>{tx(p("Status", "स्थिति"))}</span>
                  </div>
                  {hiddenUntil > 0 ? (
                    <button type="button" className="tap row" onClick={() => setShowDone(true)} style={{ width: "100%", display: "flex", alignItems: "center", gap: 10, padding: "12px 18px", border: 0, borderTop: "1px solid var(--bd)", background: "var(--oks)", color: "var(--ok)", fontWeight: 600, textAlign: "left" }}>
                      <Ic n="checkCircle" size={18} />
                      <span style={{ flex: 1 }}>{hiddenUntil} {tx(p("children above are done", "बच्चों के अंक ऊपर भरे जा चुके"))}</span>
                      <span>{tx(p("Show", "दिखाएँ"))}</span>
                      <Ic n="chevDown" size={16} />
                    </button>
                  ) : null}
                  {students.map((s, i) => {
                    if (i < hiddenUntil) return null;
                    const cell = cells[s.id] ?? BLANK;
                    const dirty = !sameSaved(cell, saved[s.id]);
                    const active = i === current;
                    const off = cell.state === "value" && looksOff(cell.value, s.prevPct, paper.maxMarks);
                    return (
                      <div key={s.id} className="row" style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 12, padding: "10px 18px", borderTop: "1px solid var(--bd)", background: active ? "var(--accs)" : undefined, boxShadow: active ? "inset 3px 0 0 var(--pri)" : undefined }}>
                        {s.roll ? <span className="num" style={{ width: 44, flex: "none", color: "var(--mut)", fontWeight: 600 }}>{s.roll}</span> : null}
                        {/* Name, box and Absent share one line at 390px; a long
                            name wraps rather than being cut to "An…" (ST-02),
                            and a child no longer takes three lines (N3). */}
                        <span style={{ flex: "1 1 80px", minWidth: 0, display: "flex", flexDirection: "column" }}>
                          <strong style={{ overflowWrap: "break-word" }}>{s.name}</strong>
                          {s.hint ? <span style={{ fontSize: 12, color: "var(--mut)" }}>{tx(s.hint)}</span> : null}
                          {s.prev ? <span style={{ fontSize: 12, color: "var(--mut)" }}>{s.prev}</span> : null}
                          {badSet.has(s.id) ? <span style={{ fontSize: 12, fontWeight: 700, color: "var(--bad)" }}>{tx(needsCorrectionText(cell.value ?? 0, paper.maxMarks, paper.markStep))}</span> : null}
                        </span>
                        <input
                          ref={(el) => {
                            if (el) inputs.current.set(s.id, el);
                            else inputs.current.delete(s.id);
                          }}
                          className={`inp num${off || badSet.has(s.id) ? " err" : ""}`}
                          inputMode="decimal"
                          aria-label={`${s.name} — ${tx(p("Row", "पंक्ति"))} ${i + 1}${s.roll ? `, ${tx(p("Roll", "रोल"))} ${s.roll}` : ""} — ${tx(p("mark out of", "अंक, पूर्णांक"))} ${paper.maxMarks}`}
                          disabled={!editable || cell.state === "absent" || cell.state === "exempt"}
                          value={cell.state === "absent" ? "AB" : cell.state === "exempt" ? "EX" : (texts[s.id] ?? "")}
                          onFocus={() => setCurrent(i)}
                          onChange={(e) => typed(s.id, i, e.target.value)}
                          onKeyDown={(e) => keyDown(e, s.id, i)}
                          style={{ width: 84, height: 48, textAlign: "center", fontSize: 22, fontWeight: 600, flex: "none" }}
                        />
                        <button
                          type="button"
                          className={`tap btn ${cell.state === "absent" ? "danger" : "sec"}`}
                          aria-pressed={cell.state === "absent"}
                          disabled={!editable}
                          onClick={() => toggleAbsent(s.id)}
                          style={{ width: 104, flex: "none" }}
                        >
                          {tx(p("Absent", "अनुपस्थित"))}
                        </button>
                        {paper.allowExempt ? <button type="button" className={`tap btn ${cell.state === "exempt" ? "soft" : "sec"}`} aria-pressed={cell.state === "exempt"} disabled={!editable} onClick={() => toggleExempt(s.id)} style={{ width: 104, flex: "none" }}>{tx(p("Exempt", "छूट"))}</button> : null}
                        <span className="hide-m" style={{ width: 100, flex: "none", fontSize: 13 }}>
                          {active && !isFilled(cell) ? (
                            <span style={{ color: "var(--accfg)", fontWeight: 600 }}>{tx(p("Typing here", "यहाँ लिखें"))}</span>
                          ) : dirty ? (
                            <span style={{ color: statusBad ? "var(--bad)" : "var(--mut)" }}>{rowState()}</span>
                          ) : isFilled(cell) ? (
                            <span style={{ color: "var(--ok)", fontWeight: 600 }}>✓ {tx(p("Saved", "सहेजा"))}</span>
                          ) : (
                            <span style={{ color: "var(--sub)" }}>—</span>
                          )}
                          {off ? <span style={{ display: "block", color: "var(--warnfg)", fontSize: 12 }}>{tx(p("Far from last test", "पिछले टेस्ट से बहुत अलग"))}</span> : null}
                        </span>
                      </div>
                    );
                  })}
                </Card>
              </>
            ) : padStudent ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 14, maxWidth: 460, width: "100%", margin: "0 auto" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <button type="button" className="tap icon-btn" aria-label={tx(p("Previous child", "पिछला बच्चा"))} onClick={() => goPad(current - 1)} disabled={current === 0}>
                    <Ic n="chevLeft" size={22} />
                  </button>
                  <Card style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 6, borderColor: "var(--pri)", borderWidth: 2 }}>
                    {padStudent.roll ? <Pill tone="mut">{tx(p("Roll", "रोल"))} {padStudent.roll}</Pill> : null}
                    <strong style={{ fontSize: 20, textAlign: "center" }}>{padStudent.name}</strong>
                    {padStudent.hint ? <span style={{ fontSize: 12, color: "var(--mut)" }}>{tx(padStudent.hint)}</span> : null}
                    {padStudent.prev ? <span style={{ fontSize: 12, color: "var(--mut)" }}>{padStudent.prev}</span> : null}
                    <span className="num" style={{ fontSize: 56, fontWeight: 700, lineHeight: 1.1, color: padCell?.state === "absent" ? "var(--bad)" : padText || padCell?.state === "value" ? "var(--fg)" : "var(--s3)" }}>
                      {padCell?.state === "absent" ? "AB" : padCell?.state === "exempt" ? "EX" : padText || (padCell?.state === "value" ? padCell.value : "00")}
                      <span style={{ fontSize: 18, color: "var(--mut)" }}>/{paper.maxMarks}</span>
                    </span>
                    <span style={{ fontSize: 13, color: "var(--mut)" }}>
                      {!sameSaved(padCell ?? BLANK, saved[padStudent.id]) ? rowState() : isFilled(padCell) ? `✓ ${tx(p("Saved", "सहेजा"))}` : tx(p("Not entered yet", "अभी नहीं भरा"))}
                    </span>
                  </Card>
                  <button type="button" className="tap icon-btn" aria-label={tx(p("Next child", "अगला बच्चा"))} onClick={() => goPad(current + 1)} disabled={current >= order.length - 1}>
                    <Ic n="chevRight" size={22} />
                  </button>
                </div>
                {editable ? (
                  <>
                    <NumberPad onKey={padKey} extra={{ key: paper.markStep < 1 ? "." : "AB", label: paper.markStep < 1 ? "." : <span style={{ color: "var(--bad)", fontSize: 17 }}>{tx(p("Absent", "अनुपस्थित"))}</span> }} />
                    {paper.markStep < 1 ? <Btn variant="danger" full onClick={() => padKey("AB")}>{tx(p("Absent", "अनुपस्थित"))}</Btn> : null}
                    {paper.allowExempt ? <Btn variant="sec" full onClick={() => { toggleExempt(padStudent.id); advancePad(); }}>{tx(p("Exempt", "छूट"))}</Btn> : null}
                    <Btn variant="pri" big full onClick={advancePad}>
                      {tx(p("Next child", "अगला बच्चा"))} <Ic n="arrowRight" size={18} />
                    </Btn>
                  </>
                ) : null}
              </div>
            ) : null}
          </div>

          <aside className="only-d" style={{ display: "flex", flexDirection: "column", gap: 14, position: "sticky", top: 84 }}>
            {ring}
            <Card pad={false}>
              <MiniStat label={tx(p("Average so far", "अब तक औसत"))} sub={`${tx(p("out of", "में से"))} ${paper.maxMarks}`} value={summary.average ?? "—"} />
              <MiniStat label={tx(p("Highest", "सर्वाधिक"))} sub={summary.highest === null ? "" : (students.find((s) => cells[s.id]?.state === "value" && cells[s.id]?.value === summary.highest)?.name ?? "")} value={summary.highest ?? "—"} tone="var(--ok)" />
              {paper.passMarks !== null ? (
                <MiniStat label={`${tx(p("Below", "इससे कम"))} ${paper.passMarks}`} sub={summary.below.slice(0, 2).map((id) => byId.get(id)?.name.split(" ")[0]).join(", ")} value={summary.below.length} tone="var(--warnfg)" />
              ) : null}
              <MiniStat label={tx(p("Absent on exam day", "परीक्षा के दिन अनुपस्थित"))} sub={tx(p("counted as entered", "भरा हुआ माना"))} value={c.absent} />
            </Card>
            <Card>
              <h2 className="sech" style={{ marginBottom: 8 }}>{tx(p("Quick keys", "शॉर्टकट"))}</h2>
              <KeyHint k="12" text={tx(p("2 numbers → next child", "2 अंक → अगला बच्चा"))} />
              <KeyHint k="Enter" text={tx(p("next child", "अगला बच्चा"))} />
              <KeyHint k="A" text={tx(p("mark absent", "अनुपस्थित"))} />
            </Card>
          </aside>
        </section>
        <div className="glass" style={{ position: "sticky", bottom: "var(--vx-bottom-h)", zIndex: 10, borderTop: "1px solid var(--bd)", padding: "12px 28px", display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
            <strong>{tx(p(`${c.filled} of ${c.total} saved`, `${c.total} में से ${c.filled} सहेजे`))} · {c.blank} {tx(p("left", "बाकी"))}{localLine ? ` · ${localLine}` : ""}</strong>
            <span role="status" aria-live="polite" style={{ fontSize: 12, color: statusBad ? "var(--bad)" : "var(--mut)" }}>{statusLine}</span>
          </span>
          {retry}
          {entryStatus === "submitted" && !correcting ? (
            <Btn variant="sec" onClick={() => setPhase("sent")}>{tx(p("Sent", "भेजा"))} ✓</Btn>
          ) : !correcting ? (
            <Btn variant="pri" big icon="checkCircle" disabled={!editable || busy} onClick={() => { void flush(); setPhase("check"); }}>
              {tx(p("Check & send", "जाँचें और भेजें"))}
            </Btn>
          ) : null}
        </div>
      </main>
    </VxPage>
  );
}

function textsOf(cells: Record<string, Cell>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [id, cell] of Object.entries(cells)) out[id] = cell.state === "value" && cell.value !== null ? String(cell.value) : "";
  return out;
}

/** A cell as the sheet prints it in a list: the mark, AB, EX or a dash. */
function cellText(cell: Cell): string {
  return cell.state === "value" ? String(cell.value) : cell.state === "absent" ? "AB" : cell.state === "exempt" ? "EX" : "—";
}

function sameSaved(a: Cell, b: Cell | undefined): boolean {
  const y = b ?? BLANK;
  return a.state === y.state && (a.state !== "value" || a.value === y.value);
}

/** How many saved, filled rows sit above the first unfilled one — the run the list folds away. */
function firstUnfilledRun(order: string[], saved: Record<string, Cell>, current: number): number {
  let n = 0;
  while (n < order.length && n < current && isFilled(saved[order[n]])) n += 1;
  return n >= 3 ? n : 0;
}

function histogram(values: number[], max: number, pass: number | null) {
  const cut1 = pass ?? Math.round(max * 0.33);
  const cut2 = Math.round(max * 0.6);
  const cut3 = Math.round(max * 0.8);
  const bands = [
    { label: `0–${cut1 - 1}`, lo: 0, hi: cut1 - 0.001, highlight: true },
    { label: `${cut1}–${cut2 - 1}`, lo: cut1, hi: cut2 - 0.001 },
    { label: `${cut2}–${cut3 - 1}`, lo: cut2, hi: cut3 - 0.001 },
    { label: `${cut3}–${max}`, lo: cut3, hi: max },
  ];
  return bands.map((b) => ({ label: b.label, value: values.filter((v) => v >= b.lo && v <= b.hi).length, highlight: b.highlight }));
}

function Stat({ label, value, sub, tone }: { label: string; value: React.ReactNode; sub?: string; tone?: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
      <span style={{ fontSize: 13, color: "var(--mut)", fontWeight: 600 }}>{label}</span>
      <span className="num" style={{ fontSize: 26, fontWeight: 700, color: tone }}>{value}</span>
      {sub ? <span style={{ fontSize: 12, color: "var(--mut)" }}>{sub}</span> : null}
    </div>
  );
}

function MiniStat({ label, sub, value, tone }: { label: string; sub?: string; value: React.ReactNode; tone?: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 16px", borderTop: "1px solid var(--bd)" }}>
      <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
        <span style={{ fontSize: 14 }}>{label}</span>
        {sub ? <span className="clip" style={{ fontSize: 12, color: "var(--mut)" }}>{sub}</span> : null}
      </span>
      <strong className="num" style={{ fontSize: 18, color: tone }}>{value}</strong>
    </div>
  );
}

function KeyHint({ k, text }: { k: string; text: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "4px 0", fontSize: 13 }}>
      <span className="k" style={{ minWidth: 26, textAlign: "center", padding: "1px 6px", borderRadius: 6, border: "1px solid var(--bd)", fontSize: 11, fontWeight: 700 }}>{k}</span>
      <span>{text}</span>
    </div>
  );
}
