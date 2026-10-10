"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition, type ReactNode } from "react";

import { Ic, type IconName } from "@/vx/icons";
import { useVx } from "@/vx/i18n";
import type { Pair } from "@/vx/text";
import { Field, RadioCard, Select, Textarea } from "@/vx/ui/controls";
import { Sheet, useToast } from "@/vx/ui/overlays";
import { WhatsAppPreview } from "@/vx/ui/primitives";

import {
  cancelRemindersAction,
  decideChangeAction,
  remindMarksAction,
  remindRegistersAction,
  saveFollowupAction,
  sendWeeklySummaryAction,
  toggleStepAction,
  type ActionResult,
} from "@/app/(app)/academics/coordinator-actions";

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

export function RemindRegistersButton({ classIds, label, variant = "pri", icon = "send", full }: { classIds: string[]; label: Pair; variant?: "pri" | "sec" | "soft"; icon?: IconName; full?: boolean }) {
  const { tx } = useVx();
  const { run, pending } = useAct();
  return (
    <button type="button" className={`tap btn ${variant}`} style={{ width: full ? "100%" : undefined }} disabled={pending || classIds.length === 0} onClick={() => run(() => remindRegistersAction(classIds))}>
      {pending ? <Spin /> : <Ic n={icon} size={18} />}
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

/**
 * The "remind all late" sheet (AcadHome `remind`, AcadAttendance `remind`):
 * who is being asked, a preview of the message, then one tap.
 */
export function RemindSheet({
  closeHref,
  mode,
  people,
  preview,
}: {
  closeHref: string;
  mode: "registers" | "marks";
  people: { id: string; name: string; sub: string; on: boolean }[];
  preview: string[];
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
  const title = mode === "registers" ? tx({ en: "Ask to mark attendance", hi: "हाज़िरी लेने को कहें" }) : tx({ en: "Remind late teachers", hi: "देर वाले शिक्षकों को याद दिलाएँ" });
  return (
    <UrlSheet
      closeHref={closeHref}
      title={title}
      sub={tx({ en: `${chosen.size} of ${people.length} chosen · WhatsApp to staff`, hi: `${people.length} में से ${chosen.size} चुने · स्टाफ़ को WhatsApp` })}
      icon="send"
      footer={
        <button type="button" className="tap btn pri" style={{ flex: 1 }} disabled={pending || chosen.size === 0} onClick={send}>
          {pending ? <Spin /> : <Ic n="send" size={18} />}
          {tx({ en: `Send to ${chosen.size}`, hi: `${chosen.size} को भेजें` })}
        </button>
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        {people.length === 0 ? (
          <p style={{ margin: 0, color: "var(--mut)" }}>{tx({ en: "Nobody is late. Nothing to send.", hi: "कोई पीछे नहीं। भेजने को कुछ नहीं।" })}</p>
        ) : (
          <div role="group" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {people.map((person) => (
              <label key={person.id} className="tap" style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 12px", borderRadius: 14, border: `1.5px solid ${chosen.has(person.id) ? "var(--acc)" : "var(--bd)"}`, background: chosen.has(person.id) ? "var(--accs)" : "var(--card)" }}>
                <input type="checkbox" checked={chosen.has(person.id)} onChange={() => toggle(person.id)} style={{ width: 20, height: 20, accentColor: "var(--acc)" }} />
                <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
                  <strong className="clip">{person.name}</strong>
                  <span className="clip" style={{ fontSize: 13, color: "var(--mut)" }}>{person.sub}</span>
                </span>
              </label>
            ))}
          </div>
        )}
        {preview.length ? <WhatsAppPreview lines={preview} title={tx({ en: "Message preview", hi: "संदेश का नमूना" })} /> : null}
        <p style={{ margin: 0, fontSize: 13, color: "var(--mut)" }}>
          {tx({
            en: mode === "registers" ? "Sent once per class per day. If the register is saved before it goes, it is not sent." : "One message per teacher, naming every paper still open. You can undo for a few seconds.",
            hi: mode === "registers" ? "हर कक्षा के लिए दिन में एक बार। रजिस्टर पहले सहेजा गया तो नहीं जाएगा।" : "हर शिक्षक को एक संदेश, सभी बाकी पेपरों के नाम के साथ। कुछ सेकंड तक वापस ले सकते हैं।",
          })}
        </p>
      </div>
    </UrlSheet>
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

const OUTCOMES: { value: string; label: Pair; icon: IconName }[] = [
  { value: "reached", label: { en: "Spoke to the parent", hi: "अभिभावक से बात हुई" }, icon: "checkCircle" },
  { value: "will_come", label: { en: "Child will come from tomorrow", hi: "कल से बच्चा आएगा" }, icon: "calCheck" },
  { value: "visit_school", label: { en: "Parent will visit school", hi: "अभिभावक स्कूल आएँगे" }, icon: "building" },
  { value: "no_answer", label: { en: "No answer", hi: "जवाब नहीं मिला" }, icon: "phone" },
  { value: "wrong_number", label: { en: "Wrong number", hi: "गलत नंबर" }, icon: "alert" },
];

/** The call-outcome sheet (AcadAttendance `call`). */
export function CallSheet({ closeHref, studentId, name, sub, phoneHref, father }: { closeHref: string; studentId: string; name: string; sub: string; phoneHref: string | null; father: string | null }) {
  const { tx } = useVx();
  const { run, pending } = useAct();
  const router = useRouter();
  const [outcome, setOutcome] = useState<string>("reached");
  const [note, setNote] = useState("");
  return (
    <UrlSheet
      closeHref={closeHref}
      title={tx({ en: `Call about ${name}`, hi: `${name} के बारे में कॉल` })}
      sub={sub}
      icon="phone"
      footer={
        <button type="button" className="tap btn pri" style={{ flex: 1 }} disabled={pending} onClick={() => run(() => saveFollowupAction({ studentId, kind: "call", outcome, note }), (r) => r.ok && router.replace(closeHref, { scroll: false }))}>
          {pending ? <Spin /> : <Ic n="check" size={18} />}
          {tx({ en: "Save outcome", hi: "नतीजा सहेजें" })}
        </button>
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {phoneHref ? (
          <a className="tap btn soft" href={phoneHref} style={{ justifyContent: "center" }}>
            <Ic n="phone" size={18} />
            {tx({ en: `Call ${father ? `${father} (father)` : "the parent"}`, hi: `${father ? `${father} (पिता)` : "अभिभावक"} को कॉल करें` })}
          </a>
        ) : (
          <p style={{ margin: 0, color: "var(--mut)", fontSize: 14 }}>{tx({ en: "No phone number on file. Record what you did.", hi: "फ़ोन नंबर नहीं है। जो किया, दर्ज करें।" })}</p>
        )}
        <div role="radiogroup" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {OUTCOMES.map((o) => (
            <RadioCard key={o.value} checked={outcome === o.value} onSelect={() => setOutcome(o.value)} title={tx(o.label)} icon={o.icon} />
          ))}
        </div>
        <Field label={tx({ en: "Note (optional)", hi: "नोट (वैकल्पिक)" })}>
          <Textarea rows={2} maxLength={400} value={note} onChange={(e) => setNote(e.target.value)} placeholder={tx({ en: "What was said", hi: "क्या बात हुई" })} />
        </Field>
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
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button type="button" className={`tap btn ${compact ? "ghost" : "sec"}`} disabled={pending} onClick={() => run(() => saveFollowupAction({ studentId, kind: "improving" }))}>
          <Ic n="trend" size={18} />
          {tx({ en: "Mark improving", hi: "सुधार हो रहा है" })}
        </button>
        <button type="button" className={`tap btn ${compact ? "ghost" : "soft"}`} disabled={pending} onClick={() => setOpen(true)}>
          <Ic n="userPlus" size={18} />
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
      <span style={{ flex: 1, minWidth: 0, textDecoration: done ? "line-through" : undefined, color: done ? "var(--mut)" : undefined }}>{children}</span>
    </button>
  );
}

/* ------------------------------------------------ change requests */

export function DecideButtons({ correctionId, canDecide, reason }: { correctionId: string; canDecide: boolean; reason?: Pair }) {
  const { tx } = useVx();
  const { run, pending } = useAct();
  const [declining, setDeclining] = useState(false);
  const [note, setNote] = useState("");
  if (!canDecide) {
    return (
      <span style={{ fontSize: 13, color: "var(--mut)", display: "inline-flex", gap: 6, alignItems: "center" }}>
        <Ic n="lock" size={14} />
        {tx(reason ?? { en: "The office decides change requests.", hi: "बदलाव के अनुरोध कार्यालय तय करता है।" })}
      </span>
    );
  }
  return (
    <>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button type="button" className="tap btn pri" disabled={pending} onClick={() => run(() => decideChangeAction({ correctionId, approve: true }))}>
          {pending ? <Spin /> : <Ic n="check" size={18} />}
          {tx({ en: "Approve", hi: "स्वीकार" })}
        </button>
        <button type="button" className="tap btn sec" disabled={pending} onClick={() => setDeclining(true)}>
          <Ic n="x" size={18} />
          {tx({ en: "Decline", hi: "अस्वीकार" })}
        </button>
      </div>
      <Sheet
        open={declining}
        onClose={() => setDeclining(false)}
        title={tx({ en: "Decline this change?", hi: "यह बदलाव अस्वीकार करें?" })}
        icon="x"
        footer={
          <>
            <button type="button" className="tap btn sec" style={{ flex: 1 }} onClick={() => setDeclining(false)}>{tx({ en: "Cancel", hi: "रद्द" })}</button>
            <button type="button" className="tap btn danger" style={{ flex: 1 }} disabled={pending || note.trim().length < 3} onClick={() => run(() => decideChangeAction({ correctionId, approve: false, note }), (r) => r.ok && setDeclining(false))}>
              {tx({ en: "Decline", hi: "अस्वीकार" })}
            </button>
          </>
        }
      >
        <Field label={tx({ en: "Tell the teacher why", hi: "शिक्षक को कारण बताएँ" })}>
          <Textarea rows={3} maxLength={200} value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
      </Sheet>
    </>
  );
}

/** Prints the page (the register's "Print" button). */
export function PrintButton({ label }: { label: Pair }) {
  const { tx } = useVx();
  return (
    <button type="button" className="tap btn sec" onClick={() => window.print()}>
      <Ic n="printer" size={18} />
      {tx(label)}
    </button>
  );
}
