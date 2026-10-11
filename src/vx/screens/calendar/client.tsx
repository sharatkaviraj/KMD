"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { Ic } from "@/vx/icons";
import { useVx } from "@/vx/i18n";
import type { Pair } from "@/vx/text";
import { Chip, Field, Input, Seg, SwitchRow, Textarea } from "@/vx/ui/controls";
import { Confirm, useToast } from "@/vx/ui/overlays";
import { WhatsAppPreview } from "@/vx/ui/primitives";
import { UrlSheet } from "@/vx/screens/academics/client";

import { addEventAction, cancelEventAction, requestNoticeAction, type CalendarResult } from "@/app/(app)/calendar/actions";

import { EVENT_KINDS, type EventKind } from "./domain";

const KIND_LABELS: Record<EventKind, Pair> = {
  holiday: { en: "Holiday", hi: "अवकाश" },
  exam: { en: "Exam", hi: "परीक्षा" },
  event: { en: "Event", hi: "कार्यक्रम" },
  ptm: { en: "PTM", hi: "अभिभावक बैठक" },
  meeting: { en: "Meeting", hi: "बैठक" },
  fee_due: { en: "Fee due", hi: "फीस देय" },
};

function useRun() {
  const toast = useToast();
  const router = useRouter();
  const { tx } = useVx();
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<CalendarResult>, after?: (r: CalendarResult) => void) =>
    start(async () => {
      try {
        const r = await fn();
        toast.show({ tone: r.ok ? "ok" : "bad", text: tx(r.text) });
        if (r.ok) router.refresh();
        after?.(r);
      } catch (error) {
        toast.show({ tone: "bad", text: error instanceof Error ? error.message : "Something went wrong." });
      }
    });
  return { run, pending };
}

/** Add an event (Calendar `add`): kind, name, dates, time, classes, and an optional notice. */
export function AddEventSheet({ closeHref, day, classes, parents }: { closeHref: string; day: string; classes: { id: string; label: string; roll: number }[]; parents: number }) {
  const { tx } = useVx();
  const router = useRouter();
  const { run, pending } = useRun();
  const [kind, setKind] = useState<EventKind>("event");
  const [title, setTitle] = useState("");
  const [titleHi, setTitleHi] = useState("");
  const [startsOn, setStartsOn] = useState(day);
  const [endsOn, setEndsOn] = useState(day);
  const [allDay, setAllDay] = useState(true);
  const [startsAt, setStartsAt] = useState("10:00");
  const [endsAt, setEndsAt] = useState("11:00");
  const [place, setPlace] = useState("");
  const [chosen, setChosen] = useState<Set<string>>(() => new Set());
  const [details, setDetails] = useState("");
  const [notify, setNotify] = useState(false);
  const [audience, setAudience] = useState<"parents" | "staff" | "both">("parents");
  const count = chosen.size === 0 ? parents : classes.filter((c) => chosen.has(c.id)).reduce((s, c) => s + c.roll, 0);
  const toggle = (id: string) =>
    setChosen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const submit = () =>
    run(
      () => addEventAction({ kind, title, titleHi, startsOn, endsOn, allDay: kind === "holiday" ? true : allDay, startsAt, endsAt, place, classIds: [...chosen], details, notify, audience }),
      (r) => r.ok && router.replace(r.id ? `/calendar?event=${r.id}` : closeHref, { scroll: false }),
    );
  const cost = Math.round(count * 0.145);
  return (
    <UrlSheet
      closeHref={closeHref}
      wide
      icon="plus"
      title={tx({ en: "Add to the calendar", hi: "कैलेंडर में जोड़ें" })}
      sub={tx({ en: "Holidays also close the register and the timetable that day.", hi: "छुट्टी उस दिन रजिस्टर और समय सारणी भी बंद करती है।" })}
      footer={
        <button type="button" className="tap btn pri" style={{ flex: 1 }} disabled={pending || !title.trim() || !startsOn} onClick={submit}>
          {pending ? <Ic n="refresh" size={16} className="spin" /> : <Ic n="check" size={18} />}
          {notify ? tx({ en: "Add and ask to notify", hi: "जोड़ें और सूचना माँगें" }) : tx({ en: "Add", hi: "जोड़ें" })}
        </button>
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div role="radiogroup" aria-label={tx({ en: "Kind", hi: "प्रकार" })} style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {EVENT_KINDS.map((k) => (
            <Chip key={k} on={kind === k} onClick={() => setKind(k)}>{tx(KIND_LABELS[k])}</Chip>
          ))}
        </div>
        <div className="g2" style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0,1fr))", gap: 12 }}>
          <Field label={tx({ en: "Name", hi: "नाम" })}>
            <Input value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} placeholder={kind === "holiday" ? "Diwali" : "PTM · Class 10"} />
          </Field>
          <Field label={tx({ en: "Name in Hindi (optional)", hi: "हिंदी में नाम (वैकल्पिक)" })}>
            <Input value={titleHi} maxLength={120} onChange={(e) => setTitleHi(e.target.value)} lang="hi" />
          </Field>
          <Field label={tx({ en: "From", hi: "से" })}>
            <Input type="date" value={startsOn} onChange={(e) => { setStartsOn(e.target.value); if (endsOn < e.target.value) setEndsOn(e.target.value); }} />
          </Field>
          <Field label={tx({ en: "To", hi: "तक" })}>
            <Input type="date" value={endsOn} min={startsOn} onChange={(e) => setEndsOn(e.target.value)} />
          </Field>
        </div>
        {kind !== "holiday" ? (
          <>
            <SwitchRow title={tx({ en: "All day", hi: "पूरा दिन" })} on={allDay} onChange={setAllDay} icon="clock" />
            {!allDay ? (
              <div className="g2" style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0,1fr))", gap: 12 }}>
                <Field label={tx({ en: "Starts", hi: "शुरू" })}><Input type="time" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} /></Field>
                <Field label={tx({ en: "Ends", hi: "समाप्त" })}><Input type="time" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} /></Field>
              </div>
            ) : null}
            <Field label={tx({ en: "Where (optional)", hi: "कहाँ (वैकल्पिक)" })}>
              <Input value={place} maxLength={120} onChange={(e) => setPlace(e.target.value)} />
            </Field>
            <Field label={tx({ en: `Classes · ${chosen.size === 0 ? "whole school" : `${chosen.size} chosen`}`, hi: `कक्षाएँ · ${chosen.size === 0 ? "पूरा विद्यालय" : `${chosen.size} चुनी`}` })}>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {classes.map((c) => (
                  <Chip key={c.id} on={chosen.has(c.id)} onClick={() => toggle(c.id)}>{c.label}</Chip>
                ))}
              </div>
            </Field>
            <Field label={tx({ en: "Details (optional)", hi: "विवरण (वैकल्पिक)" })}>
              <Textarea rows={2} maxLength={1000} value={details} onChange={(e) => setDetails(e.target.value)} />
            </Field>
          </>
        ) : null}
        <SwitchRow title={tx({ en: "Tell parents on WhatsApp", hi: "अभिभावकों को WhatsApp पर बताएँ" })} sub={tx({ en: "Recorded for approval in Messages — nothing is sent from here.", hi: "Messages में स्वीकृति के लिए दर्ज — यहाँ से कुछ नहीं जाता।" })} on={notify} onChange={setNotify} icon="send" />
        {notify ? (
          <>
            <Seg
              label={tx({ en: "Who", hi: "किसे" })}
              value={audience}
              onChange={setAudience}
              options={[
                { value: "parents", label: tx({ en: "Parents", hi: "अभिभावक" }) },
                { value: "staff", label: tx({ en: "Staff", hi: "स्टाफ़" }) },
                { value: "both", label: tx({ en: "Both", hi: "दोनों" }) },
              ]}
            />
            <WhatsAppPreview
              lines={[`प्रिय अभिभावक, ${titleHi || title || "…"} — ${startsOn}${place ? ` (${place})` : ""}।`, "", `Dear parent, ${title || "…"} is on ${startsOn}${place ? ` at ${place}` : ""}.`]}
              count={count}
              cost={cost}
            />
          </>
        ) : null}
      </div>
    </UrlSheet>
  );
}

/** Ask to tell people about a holiday or an event (Calendar `notify`). */
export function NotifySheet({ closeHref, holidayDay, eventId, title, preview, parents, staff, already }: { closeHref: string; holidayDay?: string; eventId?: string; title: string; preview: Pair; parents: number; staff: number; already: string | null }) {
  const { tx } = useVx();
  const router = useRouter();
  const { run, pending } = useRun();
  const [audience, setAudience] = useState<"parents" | "staff" | "both">("parents");
  const count = audience === "parents" ? parents : audience === "staff" ? staff : parents + staff;
  return (
    <UrlSheet
      closeHref={closeHref}
      icon="send"
      title={tx({ en: `Tell people about ${title}`, hi: `${title} की सूचना दें` })}
      sub={tx({ en: "A notice is saved with the day and sent from Messages → To send once approved.", hi: "सूचना दिन के साथ सहेजी जाती है और मंज़ूरी के बाद संदेश → भेजने को से भेजी जाती है।" })}
      footer={
        <button type="button" className="tap btn pri" style={{ flex: 1 }} disabled={pending} onClick={() => run(() => requestNoticeAction({ holidayDay, eventId, audience }), (r) => r.ok && router.replace(closeHref, { scroll: false }))}>
          {pending ? <Ic n="refresh" size={16} className="spin" /> : <Ic n="send" size={18} />}
          {tx({ en: `Ask to send to ${count}`, hi: `${count} को भेजने की स्वीकृति माँगें` })}
        </button>
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        {already ? (
          <div role="status" style={{ display: "flex", gap: 8, padding: "10px 14px", borderRadius: 14, background: "var(--infos)", color: "var(--info)", fontSize: 14, fontWeight: 600 }}>
            <Ic n="info" size={18} />
            {already}
          </div>
        ) : null}
        <Seg
          label={tx({ en: "Who", hi: "किसे" })}
          value={audience}
          onChange={setAudience}
          options={[
            { value: "parents", label: tx({ en: `Parents · ${parents}`, hi: `अभिभावक · ${parents}` }) },
            { value: "staff", label: tx({ en: `Staff · ${staff}`, hi: `स्टाफ़ · ${staff}` }) },
            { value: "both", label: tx({ en: "Both", hi: "दोनों" }) },
          ]}
        />
        <WhatsAppPreview lines={[preview.hi ?? preview.en, "", preview.en]} count={count} cost={Math.round(count * 0.145)} />
      </div>
    </UrlSheet>
  );
}

export function CancelEventButton({ id, title }: { id: string; title: string }) {
  const { tx } = useVx();
  const router = useRouter();
  const { run, pending } = useRun();
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="tap btn ghost" onClick={() => setOpen(true)}>
        <Ic n="x" size={18} />
        {tx({ en: "Cancel event", hi: "कार्यक्रम रद्द करें" })}
      </button>
      <Confirm
        open={open}
        onClose={() => setOpen(false)}
        danger
        busy={pending}
        icon="alert"
        title={tx({ en: `Cancel ${title}?`, hi: `${title} रद्द करें?` })}
        body={tx({ en: "It leaves the calendar but stays in the record. Anyone already told is not told again automatically.", hi: "यह कैलेंडर से हटेगा पर रिकॉर्ड में रहेगा। जिन्हें बताया गया, उन्हें अपने आप दोबारा नहीं बताया जाएगा।" })}
        confirmLabel={tx({ en: "Cancel event", hi: "रद्द करें" })}
        onConfirm={() => run(() => cancelEventAction(id), (r) => { if (r.ok) { setOpen(false); router.replace("/calendar"); } })}
      />
    </>
  );
}
