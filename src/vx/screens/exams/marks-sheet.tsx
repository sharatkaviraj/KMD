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
  BLANK,
  changedIds,
  checkSummary,
  counts,
  isFilled,
  looksOff,
  nextBlank,
  parseMark,
  pressKey,
  shouldAdvance,
  toEntries,
  type Cell,
} from "./domain/entry";
import type { SaveOutcome, SavePayload } from "./save-types";
import type { SheetPaper, SheetStudent } from "./sheet-data";
import { commandCells, isMarksRecovery, type MarksRecovery } from "./sheet-recovery";

/*
 * One paper's marks, typed in a list on a computer or on a number pad on a
 * phone — the same sheet for the exam office, the teacher and the no-login
 * marks link. It saves by itself as she types (a draft), checks before she
 * sends, and sends once (a submission). A blank is never a zero.
 */

export type SheetPhase = "entry" | "check" | "sent";

type Status = "idle" | "saving" | "saved" | "error" | "stale";

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
  const [pendingCommand, setPendingCommand] = useState(false);
  const recoveryKey = draftKey(ownerId, sessionLabel, `vx-marks/${paper.id}`);
  const baseline = JSON.stringify({ revision: paper.entryRevision, ids: order, max: paper.maxMarks, step: paper.markStep });

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inflight = useRef<Promise<SaveOutcome | null> | null>(null);
  const command = useRef<SavePayload | null>(null);
  const storage = useRef<Promise<unknown>>(Promise.resolve());
  const latest = useRef({ cells: initialSaved, saved: initialSaved, revision: paper.entryRevision });
  const inputs = useRef(new Map<string, HTMLInputElement>());

  const editable = ready && !recovered && !pendingCommand && !busy && status !== "stale" && paper.examOpen && !paper.locked && (entryStatus === "open" || correcting);
  const c = counts(order, cells);
  const summary = checkSummary(order, cells, paper.passMarks);

  /* ------------------------------------------------------------ saving */

  useEffect(() => {
    let active = true;
    void loadDraft(recoveryKey).then((raw) => {
      if (!active) return;
      const draft = readDraft(raw, isMarksRecovery);
      if (draft && (!draft.value.command || draft.value.command.paperId === paper.id)) setRecovered(draft.value);
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
    try {
      const write = storage.current.catch(() => undefined).then(() => saveDraft(recoveryKey, { version: 1, baseline, value, updatedAt: Date.now() }));
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
        const snapshot = payload.kind === "reopen" ? latest.current.saved : commandCells(payload);
        latest.current = { ...latest.current, saved: snapshot, revision: result.revision };
        setSaved(snapshot);
        setRevision(result.revision);
        setEntryStatus(result.entryStatus);
        setStatus("saved");
        setLastSaved(result.savedAt);
        setMessage(null);
        setWho([]);
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
        const snapshot = commandCells(payload);
        latest.current = { ...latest.current, saved: snapshot };
        setSaved(snapshot);
        setStatus("saved");
        setMessage(null);
        if (!(await clearRecovery())) { command.current = payload; setPendingCommand(true); }
      } else {
        if (definite) await keepRecovery(null);
        setStatus(result && !result.ok && result.reason === "stale" ? "stale" : "error");
        setMessage(result && !result.ok ? result.message : p("The save has not been confirmed. Try again to check the same save; your entries are kept on this phone.", "सेव की पुष्टि नहीं हुई है। उसी सेव को जाँचने के लिए फिर कोशिश करें; प्रविष्टियाँ इस फ़ोन पर रखी हैं।"));
        setWho(result && !result.ok ? (result.who ?? []) : []);
      }
      return result;
    })();
    inflight.current = run;
    try { return await run; }
    finally { inflight.current = null; }
  }

  async function flush(): Promise<boolean> {
    if (inflight.current) await inflight.current;
    if (command.current) return Boolean((await runCommand(command.current))?.ok);
    if (!ready || recovered || status === "stale" || !paper.examOpen || paper.locked) return false;
    const snapshot = latest.current.cells;
    const changed = changedIds(order, snapshot, latest.current.saved);
    if (changed.length === 0) return true;
    if (entryStatus === "submitted") return false;
    const result = await runCommand({
      commandId: crypto.randomUUID(),
      paperId: paper.id,
      kind: "draft",
      expectedRevision: latest.current.revision,
      reason: null,
      entries: toEntries(order, snapshot),
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
    const text = raw.replace(/[^\d.]/g, "");
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
    if (parsed.value !== null && shouldAdvance(text, paper.maxMarks)) {
      const next = nextBlank(order, { ...latest.current.cells }, index);
      if (next >= 0) focusAt(next);
    }
  }

  function keyDown(e: KeyboardEvent<HTMLInputElement>, id: string, index: number) {
    if (e.key === "Enter" || e.key === "ArrowDown") {
      e.preventDefault();
      focusAt(Math.min(order.length - 1, index + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      focusAt(Math.max(0, index - 1));
    } else if (e.key === "a" || e.key === "A") {
      e.preventDefault();
      update(id, { state: "absent", value: null });
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
      if (entryStatus === "open" && changedIds(order, restored, latest.current.saved).length) {
        await runCommand({ commandId: crypto.randomUUID(), paperId: paper.id, kind: "draft", expectedRevision: value.revision, reason: null, entries: toEntries(order, restored) });
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
      if (shouldAdvance(text, paper.maxMarks)) advancePad();
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
      if (kind === "submit" && !(await flush())) return;
      const result = await runCommand({
        commandId: crypto.randomUUID(),
        paperId: paper.id,
        kind,
        expectedRevision: latest.current.revision,
        reason: kind === "correction" ? reason.trim() || null : null,
        entries: toEntries(order, latest.current.cells),
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
      toast.show({ text: tx(p("Taken back — you can change marks again", "वापस लिया — अब अंक फिर बदल सकते हैं")) });
      router.refresh();
    } else {
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
  const statusLine =
    status === "saving"
      ? tx(p("Saving…", "सहेज रहे हैं…"))
      : status === "saved" && lastSaved
        ? `${tx(p("Saved", "सहेजा"))} ${clock(lastSaved)}`
        : status === "error" || status === "stale"
          ? tx(p("Not saved yet", "अभी सहेजा नहीं"))
          : tx(p("Changes save as you type", "लिखते समय बदलाव सहेजे जाते हैं"));

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
  ) : message ? (
    <Banner
      tone={status === "stale" ? "warn" : "bad"}
      action={status === "stale" ? <Btn variant="sec" onClick={() => window.location.reload()}>{tx(p("Reload", "फिर खोलें"))}</Btn> : <Btn variant="sec" onClick={() => void flush()}>{tx(p("Try again", "फिर से"))}</Btn>}
    >
      {tx(message)}
      {who.length ? ` (${who.slice(0, 6).join(", ")}${who.length > 6 ? "…" : ""})` : ""}
    </Banner>
  ) : null;

  /* ---------------------------------------------------- phase: sent */

  if (phase === "sent") {
    const until = submittedAt ? clock(new Date(new Date(submittedAt).getTime() + 10 * 60_000)) : null;
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
              {paper.locked ? null : onWithdraw ? (
                <div style={{ display: "flex", alignItems: "center", gap: 12, background: "var(--s2)", borderRadius: 14, padding: "12px 14px", width: "100%", textAlign: "left" }}>
                  <Ic n="clock" size={18} style={{ color: "var(--mut)", flex: "none" }} />
                  <span style={{ flex: 1, fontSize: 14 }}>
                    {tx(p("Made a mistake? You can undo for 10 minutes", "गलती हुई? 10 मिनट तक वापस ले सकते हैं"))}
                    {until ? ` (${tx(p("till", "तक"))} ${until}).` : "."}
                  </span>
                  <Btn variant="sec" icon="undo" disabled={busy || !ready || Boolean(recovered) || pendingCommand} onClick={() => void withdraw()}>{tx(p("Undo", "वापस लें"))}</Btn>
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
      <div className="glass" style={{ position: "sticky", bottom: 0, zIndex: 10, borderTop: "1px solid var(--bd)", padding: "12px 28px", display: "flex", alignItems: "center", gap: 12 }}>
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
                  <BarChart data={bins} height={170} format={(v) => String(v)} />
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

  /* --------------------------------------------------- phase: entry */

  const hiddenUntil = showDone ? 0 : firstUnfilledRun(order, saved, current);
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
        <span style={{ fontSize: 12, color: "var(--mut)" }}>{tx(p(`of ${c.total} children`, `${c.total} बच्चे में से`))}</span>
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
                        <span className="num" style={{ width: 44, flex: "none", color: "var(--mut)", fontWeight: 600 }}>{s.roll ?? "—"}</span>
                        <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
                          <strong className="clip">{s.name}</strong>
                          {s.prev ? <span style={{ fontSize: 12, color: "var(--mut)" }}>{s.prev}</span> : null}
                        </span>
                        <input
                          ref={(el) => {
                            if (el) inputs.current.set(s.id, el);
                            else inputs.current.delete(s.id);
                          }}
                          className={`inp num${off ? " err" : ""}`}
                          inputMode="decimal"
                          aria-label={`${s.name} — ${tx(p("mark out of", "अंक, पूर्णांक"))} ${paper.maxMarks}`}
                          disabled={!editable || cell.state === "absent" || cell.state === "exempt"}
                          value={cell.state === "absent" ? "AB" : cell.state === "exempt" ? "EX" : (texts[s.id] ?? "")}
                          onFocus={() => setCurrent(i)}
                          onChange={(e) => typed(s.id, i, e.target.value)}
                          onKeyDown={(e) => keyDown(e, s.id, i)}
                          style={{ width: 96, height: 48, textAlign: "center", fontSize: 22, fontWeight: 600, flex: "none" }}
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
                            <span style={{ color: "var(--mut)" }}>{status === "saving" ? tx(p("Saving…", "सहेज रहे…")) : tx(p("Not saved", "सहेजा नहीं"))}</span>
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
                    <Pill tone="mut">{tx(p("Roll", "रोल"))} {padStudent.roll ?? "—"}</Pill>
                    <strong style={{ fontSize: 20, textAlign: "center" }}>{padStudent.name}</strong>
                    {padStudent.prev ? <span style={{ fontSize: 12, color: "var(--mut)" }}>{padStudent.prev}</span> : null}
                    <span className="num" style={{ fontSize: 56, fontWeight: 700, lineHeight: 1.1, color: padCell?.state === "absent" ? "var(--bad)" : padText || padCell?.state === "value" ? "var(--fg)" : "var(--s3)" }}>
                      {padCell?.state === "absent" ? "AB" : padCell?.state === "exempt" ? "EX" : padText || (padCell?.state === "value" ? padCell.value : "00")}
                      <span style={{ fontSize: 18, color: "var(--mut)" }}>/{paper.maxMarks}</span>
                    </span>
                    <span style={{ fontSize: 13, color: "var(--mut)" }}>
                      {isFilled(padCell) ? (sameSaved(padCell ?? BLANK, saved[padStudent.id]) ? `✓ ${tx(p("Saved", "सहेजा"))}` : tx(p("Saving…", "सहेज रहे…"))) : tx(p("Not entered yet", "अभी नहीं भरा"))}
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
        <div className="glass" style={{ position: "sticky", bottom: 0, zIndex: 10, borderTop: "1px solid var(--bd)", padding: "12px 28px", display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
            <strong>{tx(p(`${c.filled} of ${c.total} done`, `${c.total} में से ${c.filled} भरे`))} · {c.blank} {tx(p("left", "बाकी"))}</strong>
            <span style={{ fontSize: 12, color: status === "error" || status === "stale" ? "var(--bad)" : "var(--mut)" }}>{statusLine}</span>
          </span>
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
