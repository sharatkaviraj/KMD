"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition, type ReactNode } from "react";

import { Ic, type IconName } from "@/vx/icons";
import { useVx } from "@/vx/i18n";
import type { Pair } from "@/vx/text";
import { Field, Select, Textarea } from "@/vx/ui/controls";
import { Sheet, useToast } from "@/vx/ui/overlays";

import {
  cancelRemindersAction,
  remindMarksAction,
  remindRegistersAction,
  saveFollowupAction,
  sendWeeklySummaryAction,
  toggleStepAction,
  type ActionResult,
} from "@/app/(app)/academics/coordinator-actions";

import { nameInitials, toneOf } from "./ui";

/*
 * The interactive parts of the coordinator's screens. Pages are Server
 * Components; these are the buttons and sheets inside them. A sheet that is a
 * named state in SCREENS.md opens from the URL (`?sheet=remind`) so it can be
 * linked to, and closing it goes back to the page without the parameter.
 */

/** Run an action, toast what happened, refresh the page's data. */
export function useAct() {
  const router = useRouter();
  const toast = useToast();
  const { tx } = useVx();
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<ActionResult>, after?: (r: ActionResult) => void) =>
    start(async () => {
      let result: ActionResult;
      try {
        result = await fn();
      } catch (error) {
        toast.show({ tone: "bad", text: error instanceof Error ? error.message : "Something went wrong." });
        return;
      }
      const ids = result.ids;
      toast.show({
        tone: result.ok ? "ok" : "bad",
        text: tx(result.text),
        undo: result.ok && ids?.length ? async () => {
          const undone = await cancelRemindersAction(ids);
          toast.show({ tone: undone.ok ? "info" : "bad", text: tx(undone.text) });
          router.refresh();
        } : undefined,
      });
      if (result.ok) router.refresh();
      after?.(result);
    });
  return { run, pending };
}

/** A sheet whose open state is the URL. */
export function UrlSheet({ closeHref, title, sub, icon, footer, wide, children }: { closeHref: string; title: ReactNode; sub?: ReactNode; icon?: IconName; footer?: ReactNode; wide?: boolean; children: ReactNode }) {
  const router = useRouter();
  const [open, setOpen] = useState(true);
  const close = () => {
    setOpen(false);
    window.setTimeout(() => router.replace(closeHref, { scroll: false }), 220);
  };
  return (
    <Sheet open={open} onClose={close} title={title} sub={sub} icon={icon} footer={footer} wide={wide}>
      {children}
    </Sheet>
  );
}

function Spin() {
  return <Ic n="refresh" size={16} className="spin" />;
}

/* ------------------------------------------------------------ reminders */

export function RemindRegistersButton({ classIds, label, variant = "pri", icon = "send", full, compact }: { classIds: string[]; label: Pair; variant?: "pri" | "sec" | "soft"; icon?: IconName | null; full?: boolean; compact?: boolean }) {
  const { tx } = useVx();
  const { run, pending } = useAct();
  return (
    <button
      type="button"
      className={`tap btn ${variant}`}
      style={{ width: full ? "100%" : undefined, ...(compact ? { flex: "none", height: 38, padding: "0 14px", fontSize: 13 } : null) }}
      disabled={pending || classIds.length === 0}
      onClick={() => run(() => remindRegistersAction(classIds))}
    >
      {pending ? <Spin /> : icon && !compact ? <Ic n={icon} size={18} /> : null}
      {tx(label)}
    </button>
  );
}

export function RemindMarksButton({ teacherIds, label, variant = "pri", icon = "send", full }: { teacherIds: string[]; label: Pair; variant?: "pri" | "sec" | "soft"; icon?: IconName; full?: boolean }) {
  const { tx } = useVx();
  const { run, pending } = useAct();
  return (
    <button type="button" className={`tap btn ${variant}`} style={{ width: full ? "100%" : undefined }} disabled={pending || teacherIds.length === 0} onClick={() => run(() => remindMarksAction(teacherIds))}>
      {pending ? <Spin /> : <Ic n={icon} size={18} />}
      {tx(label)}
    </button>
  );
}

export type SendPreview = { hi: string; en: string; link?: string | null };

/**
 * The send sheet (AcadHome `remind`, AcadAttendance `remind`), as the design
 * draws it: who gets it as chips to leave someone out, the message as a
 * WhatsApp bubble (Hindi first), who/cost/how, a note, then Cancel or Send.
 * Nothing goes until Send; the count and the cost are shown first (RULES H).
 */
export function RemindSheet({
  closeHref,
  mode,
  title,
  sub,
  people,
  whoNote,
  previews,
  unit,
  costEach,
  channel,
  note,
  pick = "chips",
}: {
  closeHref: string;
  mode: "registers" | "marks";
  title: Pair;
  sub?: Pair;
  people: { id: string; name: string; tag?: Pair; sub?: string; initials?: string; on: boolean }[];
  /** "chips" (AcadHome) or a checkbox list with avatars (AcadAttendance). */
  pick?: "chips" | "list";
  whoNote?: Pair | null;
  /** The message each person would get, by id. */
  previews: Record<string, SendPreview>;
  /** "teacher"/"teachers" or "class"/"classes" for the To line. */
  unit: { one: Pair; many: Pair };
  /** Rupees per message, when the channel charges. */
  costEach?: number | null;
  channel: Pair;
  note: Pair;
}) {
  const { tx } = useVx();
  const { run, pending } = useAct();
  const router = useRouter();
  const [chosen, setChosen] = useState(() => new Set(people.filter((p) => p.on).map((p) => p.id)));
  const toggle = (id: string) =>
    setChosen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const send = () =>
    run(
      () => (mode === "registers" ? remindRegistersAction([...chosen]) : remindMarksAction([...chosen])),
      (r) => {
        if (r.ok) router.replace(closeHref, { scroll: false });
      },
    );
  const n = chosen.size;
  const first = people.find((p) => chosen.has(p.id)) ?? people[0];
  const preview = first ? previews[first.id] : undefined;
  const count = `${n} ${tx(n === 1 ? unit.one : unit.many)}`;
  const facts: [Pair, string][] = [
    [{ en: "To", hi: "किसे" }, count],
    ...(costEach ? [[{ en: "Cost", hi: "खर्च" }, `₹${(n * costEach).toFixed(2)} · ${n} × ₹${costEach.toFixed(2)}`] as [Pair, string]] : []),
    [{ en: "Sent through", hi: "कैसे" }, tx(channel)],
  ];
  return (
    <UrlSheet
      closeHref={closeHref}
      title={tx(title)}
      sub={sub ? tx(sub) : undefined}
      footer={
        <>
          <button type="button" className="tap btn sec" style={{ flex: 1 }} onClick={() => router.replace(closeHref, { scroll: false })}>
            {tx({ en: "Cancel", hi: "रद्द करें" })}
          </button>
          <button type="button" className="tap btn pri" style={{ flex: 1.6, opacity: n ? 1 : 0.5 }} disabled={pending || n === 0} onClick={send}>
            {pending ? <Spin /> : <Ic n="send" size={18} />}
            {n ? tx({ en: `Send ${n} ${n === 1 ? "reminder" : "reminders"}`, hi: `${n} रिमाइंडर भेजें` }) : tx({ en: "Pick someone first", hi: "पहले किसी को चुनें" })}
          </button>
        </>
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {people.length === 0 ? (
          <p style={{ margin: 0, color: "var(--mut)" }}>{tx({ en: "Nobody is late. Nothing to send.", hi: "कोई पीछे नहीं। भेजने को कुछ नहीं।" })}</p>
        ) : null}
        {pick === "list" && people.length ? (
          <div role="group" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {people.map((person) => {
              const on = chosen.has(person.id);
              return (
                <button key={person.id} type="button" role="checkbox" aria-checked={on} className="tap" onClick={() => toggle(person.id)} style={{ display: "flex", alignItems: "center", gap: 12, minHeight: 56, padding: "10px 14px", borderRadius: 14, width: "100%", textAlign: "left", color: "var(--fg)", border: on ? "2px solid var(--acc)" : "1px solid var(--bd)", background: on ? "var(--accs)" : "var(--card)" }}>
                  <span aria-hidden="true" style={{ flex: "none", width: 22, height: 22, borderRadius: 7, border: `2px solid ${on ? "var(--acc)" : "var(--bds)"}`, background: on ? "var(--acc)" : "transparent", color: "#FFFFFF", display: "flex", alignItems: "center", justifyContent: "center" }}>
                    {on ? <Ic n="check" size={14} stroke={3} /> : null}
                  </span>
                  <span aria-hidden="true" style={{ flex: "none", width: 38, height: 38, borderRadius: 19, background: toneOf(person.name).bg, color: toneOf(person.name).fg, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 700 }}>{person.initials ?? nameInitials(person.name)}</span>
                  <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
                    <span style={{ fontWeight: 600 }}>{person.name}{person.tag ? ` · ${tx(person.tag)}` : ""}</span>
                    {person.sub ? <span style={{ fontSize: 12, color: "var(--mut)" }}>{person.sub}</span> : null}
                  </span>
                </button>
              );
            })}
          </div>
        ) : null}
        {pick === "chips" && people.length > 1 ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <span className="sech">{tx({ en: "Who gets it · tap a name to leave them out", hi: "किसे जाएगा · हटाने के लिए नाम पर टैप करें" })}</span>
            <div role="group" style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {people.map((person) => {
                const on = chosen.has(person.id);
                return (
                  <button key={person.id} type="button" className={`tap chip${on ? " on" : ""}`} aria-pressed={on} onClick={() => toggle(person.id)}>
                    {on ? <Ic n="check" size={14} /> : null}
                    {person.name}
                    {person.tag ? ` · ${tx(person.tag)}` : ""}
                  </button>
                );
              })}
            </div>
            {whoNote ? <span style={{ fontSize: 12, color: "var(--mut)" }}>{tx(whoNote)}</span> : null}
          </div>
        ) : null}
        {preview && first ? <WaBubble to={first.name} many={n > 1} preview={preview} /> : null}
        <div className="card" style={{ padding: "0 14px", boxShadow: "none", display: "flex", flexDirection: "column" }}>
          {facts.map(([k, v], i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "9px 0", fontSize: 13, borderTop: i ? "1px solid var(--bd)" : undefined }}>
              <span style={{ color: "var(--mut)" }}>{tx(k)}</span>
              <span className="num" style={{ fontWeight: 700, textAlign: "right" }}>{v}</span>
            </div>
          ))}
        </div>
        <div style={{ display: "flex", gap: 10, padding: "12px 14px", borderRadius: 14, fontSize: 13, lineHeight: 1.5, background: "var(--infos)", color: "var(--info)" }}>
          <Ic n="info" size={18} style={{ flex: "none", marginTop: 1 }} />
          <span>{tx(note)}</span>
        </div>
      </div>
    </UrlSheet>
  );
}

/** The design's WhatsApp bubble: who it is to, the Hindi, the link, the English under it. */
export function WaBubble({ to, many, preview }: { to: string; many: boolean; preview: SendPreview }) {
  const { tx } = useVx();
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6, padding: 12, borderRadius: 16, background: "var(--wabg)" }}>
      <span style={{ fontSize: 11, fontWeight: 700, color: "var(--wafg)", opacity: 0.7 }}>
        {tx({ en: `Preview · to ${to}${many ? " (each one gets their own)" : ""}`, hi: `नमूना · ${to} को${many ? " (हर एक को अपना)" : ""}` })}
      </span>
      <div style={{ alignSelf: "flex-start", maxWidth: "94%", padding: "9px 12px 5px", borderRadius: "4px 14px 14px 14px", background: "var(--wab)", color: "var(--wafg)", lineHeight: 1.5, boxShadow: "0 1px 1px rgba(0,0,0,.08)", fontSize: 14 }}>
        <div style={{ whiteSpace: "pre-line" }}>{preview.hi}</div>
        {preview.link ? <div style={{ color: "var(--info)", textDecoration: "underline", overflowWrap: "anywhere" }}>{preview.link}</div> : null}
        <div style={{ whiteSpace: "pre-line", marginTop: 6, opacity: 0.78 }}>{preview.en}</div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------- weekly summary */

export function SendSummaryButton({ label }: { label: Pair }) {
  const { tx } = useVx();
  const { run, pending } = useAct();
  return (
    <button type="button" className="tap btn pri" disabled={pending} onClick={() => run(() => sendWeeklySummaryAction())}>
      {pending ? <Spin /> : <Ic n="send" size={18} />}
      {tx(label)}
    </button>
  );
}

/* --------------------------------------------------------- follow-ups */

const OUTCOMES: { value: string; label: Pair; icon: IconName; hint: Pair }[] = [
  { value: "will_come", label: { en: "Will come tomorrow", hi: "कल आएगा" }, icon: "calCheck", hint: { en: "Check tomorrow's register for this child.", hi: "कल का रजिस्टर इस बच्चे के लिए देखें।" } },
  { value: "reached", label: { en: "Spoke to the parent", hi: "अभिभावक से बात हुई" }, icon: "checkCircle", hint: { en: "Write what was agreed in the note, so the class teacher sees it.", hi: "जो तय हुआ उसे नोट में लिखें, ताकि कक्षा-अध्यापक देखें।" } },
  { value: "no_answer", label: { en: "No answer", hi: "जवाब नहीं मिला" }, icon: "phone", hint: { en: "Try again after 4 pm. The class teacher can also try.", hi: "शाम 4 बजे के बाद फिर कोशिश करें। कक्षा-अध्यापक भी कर सकते हैं।" } },
  { value: "visit_school", label: { en: "Will come to meet us", hi: "मिलने आएँगे" }, icon: "user", hint: { en: "Add the meeting to the calendar so the class teacher can join.", hi: "बैठक कैलेंडर में जोड़ें ताकि कक्षा-अध्यापक भी आ सकें।" } },
  { value: "wrong_number", label: { en: "Wrong number", hi: "गलत नंबर" }, icon: "alert", hint: { en: "Ask the office to correct the number in the student's record.", hi: "कार्यालय से विद्यार्थी के रिकॉर्ड में नंबर ठीक करवाएँ।" } },
];

/** The call sheet (AcadAttendance `call`), as the design draws it: dial, the last note, how it went, a note, save. */
export function CallSheet({ closeHref, studentId, name, sub, phoneHref, phoneLabel, lastNote }: { closeHref: string; studentId: string; name: string; sub: string; phoneHref: string | null; phoneLabel: string | null; lastNote?: { body: string; by: string } | null }) {
  const { tx } = useVx();
  const { run, pending } = useAct();
  const router = useRouter();
  const [outcome, setOutcome] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const first = name.split(" ")[0];
  const picked = OUTCOMES.find((o) => o.value === outcome);
  return (
    <UrlSheet
      closeHref={closeHref}
      title={tx({ en: `Call ${first}’s family`, hi: `${first} के परिवार को कॉल` })}
      sub={sub}
      footer={
        <>
          <button type="button" className="tap btn sec" style={{ flex: 1 }} onClick={() => router.replace(closeHref, { scroll: false })}>
            {tx({ en: "Cancel", hi: "रद्द करें" })}
          </button>
          <button type="button" className="tap btn pri" style={{ flex: 1.6, opacity: outcome ? 1 : 0.5 }} disabled={pending || !outcome} onClick={() => outcome && run(() => saveFollowupAction({ studentId, kind: "call", outcome, note }), (r) => r.ok && router.replace(closeHref, { scroll: false }))}>
            {pending ? <Spin /> : <Ic n="check" size={18} />}
            {tx({ en: "Save call", hi: "कॉल सहेजें" })}
          </button>
        </>
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {phoneHref ? (
          <a className="tap btn pri" href={phoneHref} style={{ height: 54, fontSize: 16 }}>
            <Ic n="phone" size={18} />
            {tx({ en: `Call ${phoneLabel ?? "the parent"}`, hi: `${phoneLabel ?? "अभिभावक"} को कॉल करें` })}
          </a>
        ) : (
          <p style={{ margin: 0, color: "var(--mut)", fontSize: 14 }}>{tx({ en: "No phone number on file. Record what you did.", hi: "फ़ोन नंबर नहीं है। जो किया, दर्ज करें।" })}</p>
        )}
        {lastNote ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 3, padding: "12px 14px", borderRadius: 14, fontSize: 13, lineHeight: 1.5, background: "var(--s2)" }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: "var(--mut)" }}>{tx({ en: "Last note", hi: "पिछला नोट" })}</span>
            <span>“{lastNote.body}”</span>
            <span style={{ fontSize: 12, color: "var(--mut)" }}>{lastNote.by}</span>
          </div>
        ) : null}
        <span className="sech">{tx({ en: "How did it go?", hi: "क्या हुआ?" })}</span>
        <div role="radiogroup" style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {OUTCOMES.map((o) => (
            <button key={o.value} type="button" role="radio" aria-checked={outcome === o.value} className={`tap chip${outcome === o.value ? " on" : ""}`} onClick={() => setOutcome(o.value)} style={{ height: 42 }}>
              <Ic n={o.icon} size={15} />
              {tx(o.label)}
            </button>
          ))}
        </div>
        {picked ? (
          <div className="fadein" style={{ display: "flex", gap: 10, padding: "12px 14px", borderRadius: 14, fontSize: 13, lineHeight: 1.5, background: "var(--infos)", color: "var(--info)" }}>
            <Ic n="info" size={18} style={{ flex: "none", marginTop: 1 }} />
            <span>{tx(picked.hint)}</span>
          </div>
        ) : null}
        <label className="field">
          <span>{tx({ en: "Note (optional)", hi: "नोट (वैकल्पिक)" })}</span>
          <textarea className="inp" rows={3} maxLength={400} value={note} onChange={(e) => setNote(e.target.value)} placeholder={tx({ en: "For example: mother says he will come from Monday", hi: "जैसे: माँ ने कहा सोमवार से आएगा" })} style={{ minHeight: 72, height: "auto", padding: "12px 14px" }} />
        </label>
        <span style={{ fontSize: 12, color: "var(--mut)" }}>{tx({ en: `The call is saved on ${first}’s record so the class teacher sees it too.`, hi: `कॉल ${first} के रिकॉर्ड में सहेजी जाती है ताकि कक्षा-अध्यापक भी देखें।` })}</span>
      </div>
    </UrlSheet>
  );
}

export function FollowupButtons({ studentId, staff, compact }: { studentId: string; staff: { id: string; name: string }[]; compact?: boolean }) {
  const { tx } = useVx();
  const { run, pending } = useAct();
  const [open, setOpen] = useState(false);
  const [owner, setOwner] = useState(staff[0]?.id ?? "");
  const [note, setNote] = useState("");
  return (
    <>
      <div className={compact ? "mfull" : undefined} style={{ display: "flex", gap: 6, flexWrap: compact ? "nowrap" : "wrap" }}>
        <button type="button" className="tap btn sec" style={compact ? { fontSize: 13, flex: 1 } : undefined} disabled={pending} onClick={() => run(() => saveFollowupAction({ studentId, kind: "improving" }))}>
          <Ic n="trend" size={compact ? 16 : 18} />
          {tx({ en: "Mark as improving", hi: "सुधार हो रहा है" })}
        </button>
        <button type="button" className="tap btn soft" style={compact ? { fontSize: 13, flex: 1 } : undefined} disabled={pending} onClick={() => setOpen(true)}>
          <Ic n="userPlus" size={compact ? 16 : 18} />
          {tx({ en: "Assign follow-up", hi: "फ़ॉलो-अप सौंपें" })}
        </button>
      </div>
      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        title={tx({ en: "Assign a follow-up", hi: "फ़ॉलो-अप सौंपें" })}
        icon="userPlus"
        footer={
          <button type="button" className="tap btn pri" style={{ flex: 1 }} disabled={pending || !owner} onClick={() => run(() => saveFollowupAction({ studentId, kind: "follow_up", ownerId: owner, note }), (r) => r.ok && setOpen(false))}>
            {pending ? <Spin /> : <Ic n="check" size={18} />}
            {tx({ en: "Assign", hi: "सौंपें" })}
          </button>
        }
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <Field label={tx({ en: "Who follows up", hi: "कौन देखेगा" })}>
            <Select value={owner} onChange={(e) => setOwner(e.target.value)}>
              {staff.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </Select>
          </Field>
          <Field label={tx({ en: "What to do", hi: "क्या करना है" })}>
            <Textarea rows={3} maxLength={400} value={note} onChange={(e) => setNote(e.target.value)} placeholder={tx({ en: "e.g. Extra Maths practice twice a week", hi: "जैसे सप्ताह में दो बार गणित अभ्यास" })} />
          </Field>
        </div>
      </Sheet>
    </>
  );
}

/* ------------------------------------------------------- plan steps */

export function StepToggle({ stepId, done, disabled, children }: { stepId: string; done: boolean; disabled?: boolean; children: ReactNode }) {
  const { run, pending } = useAct();
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={done}
      disabled={disabled || pending}
      className="tap"
      onClick={() => run(() => toggleStepAction(stepId, !done))}
      style={{ display: "flex", alignItems: "flex-start", gap: 12, width: "100%", textAlign: "left", background: "none", border: 0, padding: "10px 0", color: "var(--fg)" }}
    >
      <span aria-hidden="true" style={{ flex: "none", width: 22, height: 22, borderRadius: 7, border: `2px solid ${done ? "var(--ok)" : "var(--bds)"}`, background: done ? "var(--ok)" : "transparent", color: "var(--onsolid)", display: "flex", alignItems: "center", justifyContent: "center", marginTop: 1 }}>
        {done ? <Ic n="check" size={14} stroke={3} /> : null}
      </span>
      <span style={{ flex: 1, minWidth: 0 }}>{children}</span>
    </button>
  );
}

/** Prints the page (the register's "Print" button). */
export function PrintButton({ label, icon = "printer" }: { label: Pair; icon?: IconName }) {
  const { tx } = useVx();
  return (
    <button type="button" className="tap btn sec" onClick={() => window.print()}>
      <Ic n={icon} size={18} />
      {tx(label)}
    </button>
  );
}
