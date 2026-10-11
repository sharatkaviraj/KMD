"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { Ic } from "@/vx/icons";
import { Bi, useVx } from "@/vx/i18n";
import { agoP, dayMonth, initials, shortDay } from "@/vx/format";
import { p, type Pair } from "@/vx/text";
import { Chip, ChipRow, Field, Input, Seg, Select, SwitchRow, Textarea } from "@/vx/ui/controls";
import { Sheet, useToast } from "@/vx/ui/overlays";
import { Avatar, Btn, Card, EmptyState, Pill, Progress, SuccessTick, WhatsAppPreview } from "@/vx/ui/primitives";
import { useSpeech, VoiceNote, Waveform } from "@/vx/ui/voice";

import {
  addPlanStepAction,
  closePlanAction,
  createNoteAction,
  createPlanAction,
  removePlanStepAction,
  replyToNoteAction,
  setFollowUpAction,
  setNoteStatusAction,
  tellParentsAboutNoteAction,
  tellParentsAboutPlanAction,
  togglePlanStepAction,
  undoNoteAction,
} from "../actions";
import type { ChildChoice, NoteReply, SupportPlan } from "../data";
import {
  canWorkOnNote,
  excerpt,
  FOLLOW_OWNER,
  FOLLOW_WHEN,
  followUpDate,
  followUpLabel,
  followUpOwnerText,
  isSensitiveNote,
  nextOpenAction,
  NOTE_TAGS,
  parentNoteMessage,
  parentPlanMessage,
  planProgress,
  QUICK_PHRASES,
  STATUS_ORDER,
  STATUS_TEXT,
  suggestedSteps,
  TAG_TEXT,
  TAG_TONE,
  type BoardNote,
  type FollowOwner,
  type FollowWhen,
  type NoteStatus,
  type NoteTag,
  type Visibility,
} from "../domain/notes";
import "../../teach/ui/teach.css";

/** What the client needs to know about the reader (sets do not cross the wire). */
export type ClientViewer = { id: string; name: string; readsEveryClass: boolean; correctsAttendance: boolean; heldClassIds: string[]; canWrite: boolean };

export function canWork(note: BoardNote, viewer: ClientViewer): boolean {
  return canWorkOnNote(note, { ...viewer, heldClassIds: new Set(viewer.heldClassIds) });
}

/** Set or drop URL params without a navigation. */
export function replaceParams(changes: Record<string, string | null>) {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  for (const [k, v] of Object.entries(changes)) {
    if (v) url.searchParams.set(k, v);
    else url.searchParams.delete(k);
  }
  window.history.replaceState(window.history.state, "", url.toString());
}

/* ----------------------------------------------------------------- cards */

export function TagPills({ tags }: { tags: readonly NoteTag[] }) {
  const { tx } = useVx();
  return (
    <span style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
      {tags.map((t) => (
        <Pill key={t} tone={TAG_TONE[t]}>{tx(TAG_TEXT[t])}</Pill>
      ))}
    </span>
  );
}

export function StatusPill({ status }: { status: NoteStatus }) {
  const { tx } = useVx();
  return <Pill tone={status === "done" ? "ok" : status === "working" ? "info" : "warn"}>{tx(STATUS_TEXT[status])}</Pill>;
}

export function NoteCard({ note, today, href, selected, showChild = true }: { note: BoardNote; today: string; href: string; selected?: boolean; showChild?: boolean }) {
  const { tx } = useVx();
  const due = followUpLabel(note.status === "done" || !note.needsFollowUp ? null : note.followUpOn, today, dayMonth);
  return (
    <Link href={href} scroll={false} className={`tap n-card${selected ? " sel" : ""}${due?.tone === "bad" ? " due" : ""}`}>
      <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
        {showChild ? <Avatar text={initials(note.studentName)} seed={note.studentId ?? note.id} size={36} /> : null}
        <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
          {showChild ? <strong className="clip">{note.studentName}</strong> : null}
          <span style={{ fontSize: 12, color: "var(--mut)" }}>
            {showChild ? `${note.classLabel} · ` : ""}
            {note.writtenByName} · {tx(agoP(note.createdAt))}
          </span>
        </span>
        <StatusPill status={note.status} />
      </span>
      <span style={{ fontSize: 15 }}>
        {note.source === "voice" ? <Ic n="mic" size={14} style={{ marginRight: 4, verticalAlign: "-2px" }} /> : null}
        {excerpt(note.body)}
      </span>
      <span style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
        <TagPills tags={note.tags} />
        {due ? <Pill tone={due.tone} icon="flag">{tx(due.text)}</Pill> : null}
        {note.planId ? <Pill tone="acc" icon="clipboard">{tx(p("Plan", "योजना"))}</Pill> : null}
        {note.visibility === "private" ? <Pill tone="mut" icon="lock">{tx(p("Only me", "सिर्फ़ मैं"))}</Pill> : null}
        {note.replies ? <span style={{ fontSize: 12, color: "var(--mut)", display: "inline-flex", gap: 4, alignItems: "center" }}><Ic n="message" size={13} />{note.replies}</span> : null}
      </span>
    </Link>
  );
}

/* --------------------------------------------------------------- add note */

export type AddStep = "add" | "listening" | "review" | "saved";

function Steps({ step }: { step: AddStep }) {
  const { tx } = useVx();
  const at = step === "add" || step === "listening" ? 0 : step === "review" ? 1 : 2;
  const names = [p("Write", "लिखें"), p("Check", "जाँचें"), p("Saved", "सहेजा")];
  return (
    <div className="n-steps" aria-label="Steps">
      {names.map((n, i) => (
        <span key={n.en} style={{ display: "contents" }}>
          {i > 0 ? <span className={`n-line${i <= at ? " on" : ""}`} /> : null}
          <span className={`n-step${i <= at ? " on" : ""}`}>
            <i>{i < at ? <Ic n="check" size={14} /> : i + 1}</i>
            {tx(n)}
          </span>
        </span>
      ))}
    </div>
  );
}

/**
 * Add a note (design TchNotes add → listening → review → saved). One child,
 * tags, the words typed or spoken; then follow-up, who may read it, and
 * whether the parents should hear — queued only, never sent from here.
 */
export function AddNoteSheet({
  open,
  onClose,
  kids,
  notes = [],
  base,
  initialStudent,
  initialStep,
  today,
  school,
  author,
}: {
  open: boolean;
  onClose: () => void;
  kids: ChildChoice[];
  /** The notes the reader already sees, to find the child's open action. */
  notes?: readonly BoardNote[];
  /** The notes screen the sheet sits on, for the link to that open action. */
  base?: string;
  initialStudent: string | null;
  initialStep: AddStep;
  today: string;
  school: string;
  author: string;
}) {
  const { tx, sub } = useVx();
  const router = useRouter();
  const toast = useToast();
  const [step, setStepState] = useState<AddStep>(initialStep);
  const [studentId, setStudentId] = useState<string>(initialStudent && kids.some((k) => k.id === initialStudent) ? initialStudent : "");
  const [classFilter, setClassFilter] = useState<string>(() => kids.find((k) => k.id === initialStudent)?.classId ?? kids[0]?.classId ?? "");
  const [tags, setTags] = useState<NoteTag[]>([]);
  const [body, setBody] = useState("");
  const [voice, setVoice] = useState(false);
  const [lang, setLang] = useState<"hi-IN" | "en-IN">("hi-IN");
  const [follow, setFollow] = useState(false);
  const [when, setWhen] = useState<FollowWhen>("tomorrow");
  const [owner, setOwner] = useState<FollowOwner>("me");
  const [visibility, setVisibility] = useState<Visibility>("team");
  const [tellParents, setTellParents] = useState(false);
  const [savedId, setSavedId] = useState<string | null>(null);
  const [error, setError] = useState<Pair | null>(null);
  const [saveUncertain, setSaveUncertain] = useState(false);
  const [pending, start] = useTransition();

  const speech = useSpeech((text) => {
    setVoice(true);
    setBody((cur) => (cur ? `${cur} ${text}` : text));
  });

  const setStep = (next: AddStep) => {
    if (speech.listening) speech.stop();
    setStepState(next);
    replaceParams({ step: next === "add" ? null : next });
  };

  const child = kids.find((k) => k.id === studentId) ?? null;
  const classes = [...new Map(kids.map((k) => [k.classId, k.classLabel])).entries()];
  const classKids = kids.filter((k) => k.classId === classFilter);

  const reset = () => {
    setStepState("add");
    setTags([]);
    setBody("");
    setVoice(false);
    setFollow(false);
    setTellParents(false);
    setSavedId(null);
    setError(null);
    setSaveUncertain(false);
  };

  const close = () => {
    if (speech.listening) speech.stop();
    onClose();
    if (step === "saved") reset();
  };

  const save = () =>
    start(async () => {
      if (saveUncertain) return;
      setError(null);
      if (!navigator.onLine) {
        setError(p("You are offline. This note has not been saved. Reconnect and tap Save note.", "आप ऑफलाइन हैं। यह नोट सेव नहीं हुआ है। इंटरनेट आने पर नोट सेव करें दबाएँ।"));
        return;
      }
      try {
        const res = await createNoteAction({
          studentId,
          body,
          tags,
          source: voice ? "voice" : "typed",
          needsFollowUp: follow,
          followWhen: follow ? when : null,
          followOwner: follow ? owner : null,
          visibility,
          tellParents: tellParents && visibility === "team",
        });
        if (res.ok) {
          setSavedId(res.id ?? null);
          setStep("saved");
          router.refresh();
        } else setError(res.error);
      } catch {
        // A rejected response may follow a committed save. Keep the text and
        // block another submission in this composer until the history is checked.
        setSaveUncertain(true);
        setError(p("The save could not be confirmed. Your note is still here. Check your connection and the notes list before starting another note.", "सेव की पुष्टि नहीं हो सकी। आपका नोट यहाँ है। नया नोट शुरू करने से पहले इंटरनेट और नोटों की सूची जाँचें।"));
      }
    });

  const undo = () =>
    start(async () => {
      if (!savedId) return;
      const res = await undoNoteAction(savedId);
      if (res.ok) {
        toast.show({ text: tx(p("Note removed", "नोट हटाया गया")) });
        setStep("review");
        setSavedId(null);
        router.refresh();
      } else toast.show({ text: tx(res.error), tone: "bad" });
    });

  // A child with an action already open is shown it first: an update on it
  // beats a second note that says the same thing. Writing a new one is still
  // allowed — it may be about something else.
  const openAction = child ? nextOpenAction(notes.filter((n) => n.studentId === child.id)) : null;
  const openOwner = openAction ? followUpOwnerText(openAction) : null;
  const openDue = openAction ? followUpLabel(openAction.followUpOn, today, dayMonth) : null;
  const toUpdate = () => {
    if (!openAction || !child || !base) return;
    close();
    router.push(`${base}?student=${child.id}&note=${openAction.id}`, { scroll: false });
  };

  const preview = child ? parentNoteMessage({ childName: child.name, teacher: author, body: body || "…", school }) : null;
  const canNext = Boolean(child) && body.trim().length > 0;

  const footer =
    step === "add" ? (
      <>
        <button type="button" className="tap btn sec big" style={{ flex: 1 }} onClick={() => setStep("listening")} disabled={!child}>
          <Ic n="mic" size={18} /> {tx(p("Speak", "बोलें"))}
        </button>
        <button type="button" className="tap btn pri big" style={{ flex: 2 }} disabled={!canNext} onClick={() => setStep("review")}>
          {tx(p("Next", "आगे"))} <Ic n="arrowRight" size={18} />
        </button>
      </>
    ) : step === "listening" ? (
      <>
        <button type="button" className="tap btn sec big" style={{ flex: 1 }} onClick={() => setStep("add")}>
          {tx(p("Type instead", "टाइप करें"))}
        </button>
        <button type="button" className="tap btn pri big" style={{ flex: 2 }} disabled={!body.trim()} onClick={() => setStep("review")}>
          <Ic n="check" size={18} /> {tx(p("Done speaking", "बोलना पूरा"))}
        </button>
      </>
    ) : step === "review" ? (
      <>
        <button type="button" className="tap btn sec big" style={{ flex: 1 }} onClick={() => setStep("add")}>
          {tx(p("Back", "पीछे"))}
        </button>
        <button type="button" className="tap btn pri big" style={{ flex: 2 }} disabled={pending || !canNext || saveUncertain} onClick={save}>
          {pending ? <Ic n="refresh" size={18} className="spin" /> : <Ic n="check" size={18} />}
          {tx(p("Save note", "नोट सहेजें"))}
        </button>
      </>
    ) : (
      <>
        <button type="button" className="tap btn sec big" style={{ flex: 1 }} onClick={() => reset()}>
          <Ic n="plus" size={18} /> {tx(p("Another", "एक और"))}
        </button>
        <button type="button" className="tap btn pri big" style={{ flex: 2 }} onClick={close}>
          {tx(p("Done", "ठीक है"))}
        </button>
      </>
    );

  return (
    <Sheet open={open} onClose={close} icon="note" wide title={tx(p("Add a note", "नोट जोड़ें"))} sub={sub(p("Add a note", "नोट जोड़ें")) || undefined} footer={footer}>
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <Steps step={step} />

        {step === "add" ? (
          <>
            <Field label={<Bi en="Which child?" hi="कौन सा बच्चा?" />}>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {classes.length > 1 ? (
                  <Select aria-label="Class" value={classFilter} onChange={(e) => setClassFilter(e.target.value)} style={{ maxWidth: 140 }}>
                    {classes.map(([id, label]) => (
                      <option key={id} value={id}>{label}</option>
                    ))}
                  </Select>
                ) : null}
                <Select aria-label="Child" value={studentId} onChange={(e) => setStudentId(e.target.value)} style={{ flex: 1, minWidth: 180 }}>
                  <option value="">{tx(p("Choose a child", "बच्चा चुनें"))}</option>
                  {(classKids.some((k) => k.id === studentId) || !child ? classKids : [child, ...classKids]).map((k) => (
                    <option key={k.id} value={k.id}>{k.name}</option>
                  ))}
                </Select>
              </div>
            </Field>
            {openAction && child && base ? (
              <div role="status" style={{ padding: "12px 14px", borderRadius: 14, background: "var(--s2)", display: "flex", flexDirection: "column", gap: 8 }}>
                <strong style={{ fontSize: 14 }}>{tx(p(`${child.name} already has an open action`, `${child.name} की एक कार्रवाई पहले से खुली है`))}</strong>
                <span style={{ fontSize: 14 }}>{excerpt(openAction.body, 140)}</span>
                {openOwner || openDue ? (
                  <span style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    {openOwner ? <Pill tone="mut" icon="user">{tx(openOwner)}</Pill> : null}
                    {openDue ? <Pill tone={openDue.tone} icon="flag">{tx(openDue.text)}</Pill> : null}
                  </span>
                ) : null}
                <span style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                  <Btn variant="soft" icon="message" onClick={toUpdate}>{tx(p("Add update", "अपडेट जोड़ें"))}</Btn>
                  <span style={{ fontSize: 12.5, color: "var(--mut)" }}>{tx(p("Or write a new note below if it is about something else.", "अगर बात कुछ और है तो नीचे नया नोट लिखें।"))}</span>
                </span>
              </div>
            ) : null}
            <Field label={<Bi en="What is it about?" hi="किस बारे में?" />}>
              <ChipRow label="Tags">
                {NOTE_TAGS.map((t) => (
                  <Chip key={t} on={tags.includes(t)} onClick={() => setTags((cur) => (cur.includes(t) ? cur.filter((x) => x !== t) : [...cur, t]))}>
                    {tx(TAG_TEXT[t])}
                  </Chip>
                ))}
              </ChipRow>
            </Field>
            <Field label={<Bi en="The note" hi="नोट" />} hint={tx(p("Type, or tap the mic and speak in Hindi or English.", "टाइप करें या माइक दबाकर हिंदी या अंग्रेज़ी में बोलें।"))}>
              <VoiceNote value={body} onChange={(v) => setBody(v)} lang={lang} onLangChange={setLang} rows={4} />
            </Field>
            <ChipRow label="Quick phrases">
              {QUICK_PHRASES.map((q) => (
                <Chip key={q.en} on={false} onClick={() => setBody((cur) => (cur ? `${cur} ${tx(q)}.` : `${tx(q)}.`))}>
                  {tx(q)}
                </Chip>
              ))}
            </ChipRow>
          </>
        ) : null}

        {step === "listening" ? (
          <div className="n-listen">
            <button type="button" className={`tap n-mic${speech.listening ? "" : " idle"}`} aria-label={speech.listening ? "Stop" : "Speak"} onClick={() => (speech.listening ? speech.stop() : speech.start(lang))}>
              <Ic n="mic" size={40} />
            </button>
            <Waveform active={speech.listening} />
            <strong>{speech.listening ? tx(p("Listening…", "सुन रहे हैं…")) : tx(p("Tap the mic and speak", "माइक दबाएँ और बोलें"))}</strong>
            <Seg<"hi-IN" | "en-IN">
              label="Language"
              value={lang}
              onChange={setLang}
              options={[
                { value: "hi-IN", label: "हिंदी" },
                { value: "en-IN", label: "English" },
              ]}
            />
            {speech.error ? <span role="alert" style={{ color: "var(--bad)" }}>{speech.error}</span> : null}
            {!speech.supported ? <span style={{ color: "var(--mut)", fontSize: 13, textAlign: "center" }}>{tx(p("Speaking is not available here. Use the mic on your keyboard.", "यहाँ बोलना उपलब्ध नहीं। कीबोर्ड का माइक इस्तेमाल करें।"))}</span> : null}
            <Card style={{ width: "100%" }}>
              <span style={{ fontSize: 12, color: "var(--mut)" }}>{child?.name}</span>
              <p style={{ margin: "6px 0 0", minHeight: 48 }}>
                {body}
                {speech.interim ? <span style={{ color: "var(--mut)" }}> {speech.interim}</span> : null}
              </p>
            </Card>
          </div>
        ) : null}

        {step === "review" ? (
          <>
            <Card>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <Avatar text={initials(child?.name ?? "")} seed={child?.id ?? "x"} size={40} />
                <span style={{ flex: 1 }}>
                  <strong>{child?.name}</strong>
                  <div style={{ fontSize: 12, color: "var(--mut)" }}>{child?.classLabel}</div>
                </span>
                <TagPills tags={tags} />
              </div>
              <Textarea rows={3} value={body} maxLength={2000} onChange={(e) => setBody(e.target.value)} style={{ marginTop: 10 }} aria-label="Note" />
            </Card>
            <SwitchRow icon="flag" title={<Bi en="Needs a follow-up" hi="फ़ॉलो-अप चाहिए" />} on={follow} onChange={setFollow} />
            {follow ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 10, paddingLeft: 8 }}>
                <ChipRow label="When">
                  {FOLLOW_WHEN.map((w) => (
                    <Chip key={w.key} on={when === w.key} onClick={() => setWhen(w.key)}>
                      {tx(w.text)} · {shortDay(followUpDate(w.key, today))}
                    </Chip>
                  ))}
                </ChipRow>
                <ChipRow label="Who">
                  {FOLLOW_OWNER.map((o) => (
                    <Chip key={o.key} on={owner === o.key} onClick={() => setOwner(o.key)}>
                      {tx(o.text)}
                    </Chip>
                  ))}
                </ChipRow>
              </div>
            ) : null}
            <Field label={<Bi en="Who can read it?" hi="कौन पढ़ सकता है?" />}>
              <Seg<Visibility>
                label="Who can read"
                value={visibility}
                onChange={setVisibility}
                options={[
                  // Health and family notes reach only the admin and the class teacher (D-264).
                  { value: "team", label: tx(isSensitiveNote({ tags }) ? p("Admin and class teacher", "प्रशासक और कक्षा अध्यापक") : p("Teachers of this child", "इस बच्चे के शिक्षक")) },
                  { value: "private", label: tx(p("Only me", "सिर्फ़ मैं")) },
                ]}
              />
            </Field>
            {visibility === "team" ? (
              <>
                <SwitchRow icon="message" title={<Bi en="Tell the parents too" hi="माता-पिता को भी बताएँ" />} sub={tx(p("Queued for the office. Nothing is sent from here.", "ऑफ़िस की कतार में। यहाँ से कुछ नहीं भेजा जाता।"))} on={tellParents} onChange={setTellParents} />
                {tellParents && preview ? <WhatsAppPreview title={tx(p("What the parents will read", "माता-पिता क्या पढ़ेंगे"))} lines={[preview.hi, preview.en]} /> : null}
              </>
            ) : null}
            {error ? <span role="alert" style={{ color: "var(--bad)", fontWeight: 600 }}>{tx(error)}</span> : null}
          </>
        ) : null}

        {step === "saved" ? (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12, textAlign: "center", padding: "8px 0" }}>
            <SuccessTick />
            <strong style={{ fontSize: 20 }}>{tx(p("Note saved", "नोट सहेजा गया"))}</strong>
            <span style={{ color: "var(--mut)" }}>
              {child?.name}
              {follow ? ` · ${tx(p(`follow-up ${shortDay(followUpDate(when, today))}`, `फ़ॉलो-अप ${shortDay(followUpDate(when, today))}`))}` : ""}
              {tellParents && visibility === "team" ? ` · ${tx(p("parents' message queued", "माता-पिता का संदेश कतार में"))}` : ""}
            </span>
            {savedId ? (
              <Btn variant="ghost" icon="undo" disabled={pending} onClick={undo}>
                {tx(p("Undo", "वापस लें"))}
              </Btn>
            ) : null}
          </div>
        ) : null}
      </div>
    </Sheet>
  );
}

/* ------------------------------------------------------------ note detail */

export function NoteDetail({
  note,
  replies,
  viewer,
  today,
  school,
  base,
  onClose,
}: {
  note: BoardNote;
  replies: NoteReply[];
  viewer: ClientViewer;
  today: string;
  school: string;
  base: string;
  onClose?: () => void;
}) {
  const { tx } = useVx();
  const router = useRouter();
  const toast = useToast();
  const [reply, setReply] = useState("");
  const [lang, setLang] = useState<"hi-IN" | "en-IN">("hi-IN");
  const [pending, start] = useTransition();
  const [askParents, setAskParents] = useState(false);
  const work = canWork(note, viewer);
  const due = followUpLabel(note.status === "done" || !note.needsFollowUp ? null : note.followUpOn, today, dayMonth);
  const preview = parentNoteMessage({ childName: note.studentName, teacher: note.writtenByName, body: note.body, school });

  const run = (fn: () => Promise<{ ok: boolean; error?: Pair }>, done: Pair) =>
    start(async () => {
      const res = await fn();
      if (res.ok) {
        toast.show({ text: tx(done) });
        router.refresh();
      } else if (res.error) toast.show({ text: tx(res.error), tone: "bad" });
    });

  const sendReply = () =>
    start(async () => {
      const res = await replyToNoteAction(note.id, reply, "typed");
      if (res.ok) {
        setReply("");
        router.refresh();
      } else toast.show({ text: tx(res.error), tone: "bad" });
    });

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <Card>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <Avatar text={initials(note.studentName)} seed={note.studentId ?? note.id} size={48} />
          <span style={{ flex: 1, minWidth: 0 }}>
            <strong style={{ fontSize: 18 }}>{note.studentName}</strong>
            <div style={{ fontSize: 13, color: "var(--mut)" }}>{note.classLabel} · {note.writtenByName} · {shortDay(note.createdAt)}</div>
          </span>
          {onClose ? (
            <button type="button" className="tap icon-btn" aria-label="Close" onClick={onClose} style={{ width: 44, height: 44 }}>
              <Ic n="x" size={20} />
            </button>
          ) : null}
        </div>
        <p style={{ margin: "12px 0", fontSize: 16, whiteSpace: "pre-wrap" }}>
          {note.source === "voice" ? <Ic n="mic" size={15} style={{ marginRight: 6, verticalAlign: "-2px", color: "var(--mut)" }} /> : null}
          {note.body}
        </p>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
          <TagPills tags={note.tags} />
          {due ? <Pill tone={due.tone} icon="flag">{tx(due.text)}{note.followUpName ? ` · ${note.followUpName}` : ""}</Pill> : null}
          {note.studentId ? <Link href={`${base}?student=${note.studentId}`} style={{ fontSize: 13 }}>{tx(p("All notes on this child", "इस बच्चे के सब नोट्स"))}</Link> : null}
        </div>
      </Card>

      <Card>
        <span style={{ fontSize: 13, color: "var(--mut)" }}><Bi en="Where it stands" hi="स्थिति" /></span>
        <div className="n-steps" style={{ marginTop: 10 }}>
          {STATUS_ORDER.map((s, i) => {
            const on = STATUS_ORDER.indexOf(note.status) >= i;
            return (
              <span key={s} style={{ display: "contents" }}>
                {i > 0 ? <span className={`n-line${on ? " on" : ""}`} /> : null}
                <button type="button" className={`tap n-step${on ? " on" : ""}`} disabled={!work || pending || note.status === s} onClick={() => run(() => setNoteStatusAction(note.id, s), p("Updated", "बदला गया"))} style={{ background: "none", border: 0, font: "inherit" }}>
                  <i>{on && note.status !== s ? <Ic n="check" size={14} /> : i + 1}</i>
                  {tx(STATUS_TEXT[s])}
                </button>
              </span>
            );
          })}
        </div>
        {work && note.status !== "done" ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 14 }}>
            <span style={{ fontSize: 13, color: "var(--mut)" }}><Bi en="Follow up" hi="फ़ॉलो-अप" /></span>
            <ChipRow label="Follow up">
              {FOLLOW_WHEN.map((w) => (
                <Chip key={w.key} on={note.followUpOn === followUpDate(w.key, today)} onClick={() => run(() => setFollowUpAction(note.id, note.followUpOwner ?? "me", w.key), p("Follow-up set", "फ़ॉलो-अप तय"))}>
                  {tx(w.text)}
                </Chip>
              ))}
            </ChipRow>
          </div>
        ) : null}
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 14 }}>
          {note.planId ? (
            <Btn variant="soft" icon="clipboard" href={`${base}?plan=${note.planId}`}>{tx(p("Open support plan", "सहायता योजना खोलें"))}</Btn>
          ) : work && viewer.canWrite && note.studentId ? (
            <Btn variant="soft" icon="clipboard" href={`${base}?note=${note.id}&view=plan`}>{tx(p("Make a support plan", "सहायता योजना बनाएँ"))}</Btn>
          ) : null}
          {work && note.visibility === "team" && note.studentId ? (
            <Btn variant="sec" icon="message" onClick={() => setAskParents(true)}>{tx(p("Tell the parents", "माता-पिता को बताएँ"))}</Btn>
          ) : null}
        </div>
      </Card>

      <Card>
        <span style={{ fontSize: 13, color: "var(--mut)" }}><Bi en="What happened next" hi="आगे क्या हुआ" /></span>
        <div className="n-tl" style={{ marginTop: 12 }}>
          <div className="n-tlItem">
            <span className="n-tlDot" />
            <span>
              <strong style={{ fontSize: 14 }}>{note.writtenByName}</strong> <span style={{ fontSize: 12, color: "var(--mut)" }}>{tx(agoP(note.createdAt))}</span>
              <div style={{ fontSize: 14 }}>{tx(p("Wrote the note", "नोट लिखा"))}</div>
            </span>
          </div>
          {replies.map((r) => (
            <div key={r.id} className="n-tlItem">
              <span className="n-tlDot" style={r.source === "system" ? { background: "var(--s3)", borderColor: "var(--bds)" } : undefined} />
              <span>
                <strong style={{ fontSize: 14 }}>{r.writtenByName}</strong> <span style={{ fontSize: 12, color: "var(--mut)" }}>{tx(agoP(r.createdAt))}</span>
                <div style={{ fontSize: 14, color: r.source === "system" ? "var(--mut)" : undefined, whiteSpace: "pre-wrap" }}>{r.body}</div>
              </span>
            </div>
          ))}
        </div>
        {work ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 8 }}>
            <VoiceNote value={reply} onChange={setReply} lang={lang} onLangChange={setLang} rows={2} placeholder={tx(p("Add an update…", "अपडेट जोड़ें…"))} />
            <Btn variant="pri" icon="send" disabled={pending || !reply.trim()} onClick={sendReply} style={{ alignSelf: "flex-end" }}>{tx(p("Add update", "अपडेट जोड़ें"))}</Btn>
          </div>
        ) : null}
      </Card>

      <Sheet
        open={askParents}
        onClose={() => setAskParents(false)}
        icon="message"
        title={tx(p("Tell the parents", "माता-पिता को बताएँ"))}
        sub={tx(p("The message is queued for the office to send.", "संदेश ऑफ़िस की कतार में जाएगा।"))}
        footer={
          <>
            <button type="button" className="tap btn sec big" style={{ flex: 1 }} onClick={() => setAskParents(false)}>{tx(p("Cancel", "रद्द करें"))}</button>
            <button
              type="button"
              className="tap btn pri big"
              style={{ flex: 2 }}
              disabled={pending}
              onClick={() => {
                setAskParents(false);
                run(() => tellParentsAboutNoteAction(note.id), p("Queued for the parents", "माता-पिता के लिए कतार में"));
              }}
            >
              <Ic n="send" size={18} /> {tx(p("Queue message", "संदेश कतार में डालें"))}
            </button>
          </>
        }
      >
        <WhatsAppPreview title={tx(p("What the parents will read", "माता-पिता क्या पढ़ेंगे"))} lines={[preview.hi, preview.en]} />
      </Sheet>
    </div>
  );
}

/* ------------------------------------------------------------ support plan */

const OWNER_ROLES = ["me", "class_teacher", "subject_teacher", "coordinator", "admin", "parents"] as const;
type OwnerRole = (typeof OWNER_ROLES)[number];
const OWNER_TEXT: Record<OwnerRole, Pair> = {
  me: p("Me", "मैं"),
  class_teacher: p("Class teacher", "कक्षा अध्यापक"),
  subject_teacher: p("Subject teacher", "विषय अध्यापक"),
  coordinator: p("Coordinator", "समन्वयक"),
  admin: p("Principal / admin", "प्रधानाचार्य"),
  parents: p("Parents", "माता-पिता"),
};
const WHEN_LABELS: Pair[] = [p("Every day", "रोज़"), p("This week", "इस हफ़्ते"), p("Every Friday", "हर शुक्रवार"), p("This month", "इस महीने")];

function ownerText(role: string | null): Pair {
  return role && role in OWNER_TEXT ? OWNER_TEXT[role as OwnerRole] : p(role ?? "—");
}

/** Make a support plan from a note (design Notes `plan`): a goal and up to a dozen steps, each with an owner. */
export function NewPlan({ note, school, base }: { note: BoardNote; school: string; base: string }) {
  const { tx } = useVx();
  const router = useRouter();
  const toast = useToast();
  const [goal, setGoal] = useState(() => tx(p(`Help ${note.studentName} get back on track`, `${note.studentName} को फिर से सही राह पर लाना`)));
  const [steps, setSteps] = useState(() => suggestedSteps(note.tags).map((s) => ({ body: tx(s), ownerRole: "me" as OwnerRole, whenLabel: tx(WHEN_LABELS[1]!), on: true })));
  const [extra, setExtra] = useState("");
  const [tell, setTell] = useState(false);
  const [error, setError] = useState<Pair | null>(null);
  const [pending, start] = useTransition();
  const chosen = steps.filter((s) => s.on);
  const preview = parentPlanMessage({ childName: note.studentName, goal, steps: chosen.map((s) => s.body), school });

  const create = () =>
    start(async () => {
      setError(null);
      if (!note.studentId) return;
      const res = await createPlanAction({ studentId: note.studentId, noteId: note.id, goal, steps: chosen.map(({ body, ownerRole, whenLabel }) => ({ body, ownerRole, whenLabel })), tellParents: tell });
      if (res.ok && res.id) {
        toast.show({ text: tx(p("Support plan started", "सहायता योजना शुरू")) });
        router.replace(`${base}?plan=${res.id}`);
        router.refresh();
      } else if (!res.ok) setError(res.error);
    });

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <Card>
        <Field label={<Bi en="The goal" hi="लक्ष्य" />}>
          <Input value={goal} maxLength={300} onChange={(e) => setGoal(e.target.value)} />
        </Field>
        <span style={{ display: "block", fontSize: 13, color: "var(--mut)", margin: "14px 0 8px" }}><Bi en="Steps — tap to keep or drop" hi="कदम — रखने या हटाने के लिए टैप करें" /></span>
        <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 8 }}>
          {steps.map((s, i) => (
            <li key={`${s.body}-${i}`} style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              <button type="button" className={`tap n-check${s.on ? " on" : ""}`} aria-label="Keep step" onClick={() => setSteps((cur) => cur.map((x, j) => (j === i ? { ...x, on: !x.on } : x)))}>
                {s.on ? <Ic n="check" size={16} /> : null}
              </button>
              <span style={{ flex: 1, minWidth: 160 }}>{s.body}</span>
              <Select aria-label="Who" value={s.ownerRole} onChange={(e) => setSteps((cur) => cur.map((x, j) => (j === i ? { ...x, ownerRole: e.target.value as OwnerRole } : x)))} style={{ width: 150 }}>
                {OWNER_ROLES.map((r) => <option key={r} value={r}>{tx(OWNER_TEXT[r])}</option>)}
              </Select>
            </li>
          ))}
        </ul>
        <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
          <Input value={extra} maxLength={160} placeholder={tx(p("Add your own step", "अपना कदम जोड़ें"))} onChange={(e) => setExtra(e.target.value)} />
          <Btn
            icon="plus"
            disabled={!extra.trim() || steps.length >= 12}
            onClick={() => {
              setSteps((cur) => [...cur, { body: extra.trim(), ownerRole: "me", whenLabel: tx(WHEN_LABELS[1]!), on: true }]);
              setExtra("");
            }}
          >
            {tx(p("Add", "जोड़ें"))}
          </Btn>
        </div>
      </Card>
      <SwitchRow icon="message" title={<Bi en="Tell the parents about the plan" hi="माता-पिता को योजना बताएँ" />} sub={tx(p("Queued for the office. Nothing is sent from here.", "ऑफ़िस की कतार में। यहाँ से कुछ नहीं भेजा जाता।"))} on={tell} onChange={setTell} />
      {tell ? <WhatsAppPreview title={tx(p("What the parents will read", "माता-पिता क्या पढ़ेंगे"))} lines={[preview.hi, preview.en]} /> : null}
      {error ? <span role="alert" style={{ color: "var(--bad)", fontWeight: 600 }}>{tx(error)}</span> : null}
      <Btn variant="pri" big full icon="clipboard" disabled={pending || !goal.trim() || chosen.length === 0} onClick={create}>
        {tx(p("Start the plan", "योजना शुरू करें"))}
      </Btn>
    </div>
  );
}

/** A running plan: tick steps, add or drop one, close it, tell the parents. */
export function PlanView({ plan, viewer, school, base }: { plan: SupportPlan; viewer: ClientViewer; school: string; base: string }) {
  const { tx } = useVx();
  const router = useRouter();
  const toast = useToast();
  const [body, setBody] = useState("");
  const [owner, setOwner] = useState<OwnerRole>("me");
  const [when, setWhen] = useState(0);
  const [askParents, setAskParents] = useState(false);
  const [pending, start] = useTransition();
  const prog = planProgress(plan.steps);
  const open = plan.status === "active" || plan.status === "draft";
  const mayEdit = viewer.canWrite && (plan.createdBy === viewer.id || viewer.readsEveryClass || viewer.correctsAttendance || (plan.classId !== null && viewer.heldClassIds.includes(plan.classId)));
  const preview = parentPlanMessage({ childName: plan.studentName, goal: plan.goal, steps: plan.steps.map((s) => s.body), school });

  const run = (fn: () => Promise<{ ok: boolean; error?: Pair }>, done?: Pair) =>
    start(async () => {
      const res = await fn();
      if (res.ok) {
        if (done) toast.show({ text: tx(done) });
        router.refresh();
      } else if (res.error) toast.show({ text: tx(res.error), tone: "bad" });
    });

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <Card>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <Avatar text={initials(plan.studentName)} seed={plan.studentId} size={48} />
          <span style={{ flex: 1, minWidth: 0 }}>
            <strong style={{ fontSize: 18 }}>{plan.studentName}</strong>
            <div style={{ fontSize: 13, color: "var(--mut)" }}>{plan.classLabel} · {plan.createdByName} · {shortDay(plan.createdAt)}</div>
          </span>
          <Pill tone={open ? "info" : "ok"}>{open ? tx(p("Running", "चल रही है")) : tx(p("Closed", "बंद"))}</Pill>
        </div>
        <p style={{ margin: "12px 0 8px", fontSize: 16, fontWeight: 600 }}>{plan.goal}</p>
        <Progress value={prog.done} max={Math.max(1, prog.total)} label={tx(p(`${prog.done} of ${prog.total} steps done`, `${prog.total} में से ${prog.done} कदम पूरे`))} />
        {plan.noteId ? <Link href={`${base}?note=${plan.noteId}`} style={{ display: "inline-block", marginTop: 10, fontSize: 13 }}>{tx(p("The note it came from", "जिस नोट से बनी"))}</Link> : null}
      </Card>
      <Card>
        {plan.steps.length === 0 ? <EmptyState icon="clipboard" title={tx(p("No steps yet", "अभी कोई कदम नहीं"))} /> : null}
        <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 10 }}>
          {plan.steps.map((s) => (
            <li key={s.id} style={{ display: "flex", gap: 10, alignItems: "center" }}>
              <button type="button" className={`tap n-check${s.done ? " on" : ""}`} aria-label="Done" disabled={!mayEdit || !open || pending} onClick={() => run(() => togglePlanStepAction(plan.id, s.id, !s.done))}>
                {s.done ? <Ic n="check" size={16} /> : null}
              </button>
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ textDecoration: s.done ? "line-through" : undefined, color: s.done ? "var(--mut)" : undefined }}>{s.body}</span>
                <div style={{ fontSize: 12, color: "var(--mut)" }}>{s.ownerName ?? tx(ownerText(s.ownerRole))}{s.whenLabel ? ` · ${s.whenLabel}` : ""}</div>
              </span>
              {mayEdit && open ? (
                <button type="button" className="tap icon-btn" aria-label="Remove step" disabled={pending} onClick={() => run(() => removePlanStepAction(plan.id, s.id), p("Step removed", "कदम हटाया"))} style={{ width: 40, height: 40 }}>
                  <Ic n="trash" size={18} />
                </button>
              ) : null}
            </li>
          ))}
        </ul>
        {mayEdit && open ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 14 }}>
            <Input value={body} maxLength={160} placeholder={tx(p("Add a step", "कदम जोड़ें"))} onChange={(e) => setBody(e.target.value)} />
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <Select aria-label="Who" value={owner} onChange={(e) => setOwner(e.target.value as OwnerRole)} style={{ width: 160 }}>
                {OWNER_ROLES.map((r) => <option key={r} value={r}>{tx(OWNER_TEXT[r])}</option>)}
              </Select>
              <Select aria-label="When" value={String(when)} onChange={(e) => setWhen(Number(e.target.value))} style={{ width: 150 }}>
                {WHEN_LABELS.map((w, i) => <option key={w.en} value={i}>{tx(w)}</option>)}
              </Select>
              <Btn
                icon="plus"
                disabled={pending || !body.trim()}
                onClick={() => {
                  const text = body;
                  setBody("");
                  run(() => addPlanStepAction(plan.id, text, owner, tx(WHEN_LABELS[when]!)), p("Step added", "कदम जोड़ा"));
                }}
              >
                {tx(p("Add", "जोड़ें"))}
              </Btn>
            </div>
          </div>
        ) : null}
      </Card>
      {mayEdit && open ? (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <Btn variant="sec" icon="message" onClick={() => setAskParents(true)}>{tx(p("Tell the parents", "माता-पिता को बताएँ"))}</Btn>
          <Btn variant="soft" icon="checkCircle" disabled={pending} onClick={() => run(() => closePlanAction(plan.id), p("Plan closed", "योजना बंद"))}>{tx(p("Close the plan", "योजना बंद करें"))}</Btn>
        </div>
      ) : null}
      <Sheet
        open={askParents}
        onClose={() => setAskParents(false)}
        icon="message"
        title={tx(p("Tell the parents", "माता-पिता को बताएँ"))}
        sub={tx(p("The message is queued for the office to send.", "संदेश ऑफ़िस की कतार में जाएगा।"))}
        footer={
          <>
            <button type="button" className="tap btn sec big" style={{ flex: 1 }} onClick={() => setAskParents(false)}>{tx(p("Cancel", "रद्द करें"))}</button>
            <button
              type="button"
              className="tap btn pri big"
              style={{ flex: 2 }}
              disabled={pending}
              onClick={() => {
                setAskParents(false);
                run(() => tellParentsAboutPlanAction(plan.id), p("Queued for the parents", "माता-पिता के लिए कतार में"));
              }}
            >
              <Ic n="send" size={18} /> {tx(p("Queue message", "संदेश कतार में डालें"))}
            </button>
          </>
        }
      >
        <WhatsAppPreview title={tx(p("What the parents will read", "माता-पिता क्या पढ़ेंगे"))} lines={[preview.hi, preview.en]} />
      </Sheet>
    </div>
  );
}

/** A child's notes as a timeline (design Notes `student`). */
export function StudentTimeline({ name, classLabel, notes, plans, today, base }: { name: string; classLabel: string; notes: BoardNote[]; plans: SupportPlan[]; today: string; base: string }) {
  const { tx } = useVx();
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <Card>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <Avatar text={initials(name)} seed={name} size={52} />
          <span style={{ flex: 1 }}>
            <strong style={{ fontSize: 18 }}>{name}</strong>
            <div style={{ fontSize: 13, color: "var(--mut)" }}>{classLabel} · {tx(p(`${notes.length} notes`, `${notes.length} नोट्स`))}</div>
          </span>
        </div>
      </Card>
      {plans.map((pl) => {
        const pr = planProgress(pl.steps);
        return (
          <Link key={pl.id} href={`${base}?plan=${pl.id}`} className="tap n-card">
            <span style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
              <strong><Ic n="clipboard" size={15} /> {pl.goal}</strong>
              <Pill tone={pl.status === "active" ? "info" : "ok"}>{pl.status === "active" ? tx(p("Running", "चल रही है")) : tx(p("Closed", "बंद"))}</Pill>
            </span>
            <Progress value={pr.done} max={Math.max(1, pr.total)} label={tx(p(`${pr.done} of ${pr.total} steps`, `${pr.total} में से ${pr.done} कदम`))} />
          </Link>
        );
      })}
      {notes.length === 0 ? (
        <Card><EmptyState icon="note" title={tx(p("No notes on this child yet", "इस बच्चे पर अभी कोई नोट नहीं"))} /></Card>
      ) : (
        <div className="n-tl">
          {notes.map((n) => (
            <div key={n.id} className="n-tlItem">
              <span className="n-tlDot" />
              <NoteCard note={n} today={today} href={n.studentId ? `${base}?student=${n.studentId}&note=${n.id}` : `${base}?note=${n.id}`} showChild={false} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
