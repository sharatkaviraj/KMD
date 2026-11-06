"use client";

import Link from "@/ui/link";
import { useRouter } from "next/navigation";
import { useState, useTransition, type ReactNode } from "react";

import { Ic } from "@/vx/icons";
import { useVx } from "@/vx/i18n";
import { p, type Pair } from "@/vx/text";
import { Sheet, useToast } from "@/vx/ui/overlays";

import { addEventAction, cancelEventAction, requestNoticeAction, type CalendarResult } from "@/app/(app)/calendar/actions";

import { addMinutes, dayHi, dayLong, dayShort, daysApart, eventNotice, holidayNotice, KIND_STYLE, minutesBetween, time12, type EventKind, type NoticeAudience } from "./domain";
import type { AddModel, NotifyModel } from "./model";

/*
 * The calendar's interactive parts: the add form (Calendar `add`), the notice
 * sheet (`notify`) and cancelling an event. Each calls the same server action
 * as before. Nothing here sends a WhatsApp message: a notice is saved and
 * waits in Messages → To send, where a person sends it by hand (UI-67, UI-71).
 */

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

function rupeesAbout(n: number): string {
  return `₹${Math.max(1, Math.round(n)).toLocaleString("en-IN")}`;
}

function rate2(rate: number): string {
  return `₹${rate.toLocaleString("en-IN", { maximumFractionDigits: 3 })}`;
}

/** The WhatsApp bubble: the message as the family reads it, Hindi first. It is the message itself, so both languages show. */
export function Bubble({ text, time, ticks }: { text: Pair; time: ReactNode; ticks?: boolean }) {
  return (
    <div className="cal-wa">
      <div className="cal-bu">
        {text.hi && text.hi !== text.en ? <div lang="hi">{text.hi}</div> : null}
        <div lang="en">{text.en}</div>
        <div className="cal-tm">
          {time}
          {ticks ? <Ic n="ticks" size={15} style={{ color: "var(--info)" }} /> : null}
        </div>
      </div>
    </div>
  );
}

function SegChoice<V extends string>({ label, value, options, onChange }: { label: string; value: V; options: { value: V; label: string }[]; onChange: (v: V) => void }) {
  const i = Math.max(0, options.findIndex((o) => o.value === value));
  return (
    <div className="seg cal-seg" role="radiogroup" aria-label={label} style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}>
      <span className="thumb" aria-hidden="true" style={{ width: `calc((100% - 6px) / ${options.length})`, transform: `translateX(${i * 100}%)` }} />
      {options.map((o) => (
        <button key={o.value} type="button" role="radio" aria-checked={o.value === value} className={o.value === value ? "tap on" : "tap"} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

function ChipBtn({ on, children, onClick, style }: { on: boolean; children: ReactNode; onClick: () => void; style?: React.CSSProperties }) {
  return (
    <button type="button" className={`tap chip${on ? " on" : ""}`} aria-pressed={on} onClick={onClick} style={style}>
      {children}
    </button>
  );
}

const START_TIMES = ["08:00", "09:00", "10:00", "11:30", "12:00", "14:00", "16:00"];
const DURATIONS: [number, Pair][] = [
  [30, p("30 min", "30 मिनट")],
  [60, p("1 hour", "1 घंटा")],
  [120, p("2 hours", "2 घंटे")],
  [180, p("3 hours", "3 घंटे")],
];

/** What the form starts with; the design fixture fills it with a frame's sample. */
export type AddInitial = { kind?: EventKind; title?: string; multi?: boolean; startsOn?: string; endsOn?: string; allDay?: boolean; startsAt?: string; endsAt?: string; place?: string; classIds?: string[]; tell?: boolean };

/** Add an event or a holiday (Calendar `add`): what, type, when, time, place, classes, and an optional notice. */
export function AddEventForm({ model, rate, initial }: { model: AddModel; rate: number; initial?: AddInitial }) {
  const { tx, sub } = useVx();
  const router = useRouter();
  const toast = useToast();
  const { run, pending } = useRun();
  const [kind, setKind] = useState<EventKind>(initial?.kind ?? model.kind);
  const [title, setTitle] = useState(initial?.title ?? "");
  const [titleHi, setTitleHi] = useState("");
  const [multi, setMulti] = useState(initial?.multi ?? false);
  const [startsOn, setStartsOn] = useState(initial?.startsOn ?? model.day);
  const [endsOn, setEndsOn] = useState(initial?.endsOn ?? model.day);
  const [allDay, setAllDay] = useState(initial?.allDay ?? true);
  const [startsAt, setStartsAt] = useState(initial?.startsAt ?? "09:00");
  const [endsAt, setEndsAt] = useState(initial?.endsAt ?? "11:00");
  const [place, setPlace] = useState(initial?.place ?? "");
  const [chosen, setChosen] = useState<Set<string>>(() => new Set(initial?.classIds ?? []));
  const [details, setDetails] = useState("");
  const [tell, setTell] = useState(initial?.tell ?? false);
  const [err, setErr] = useState(false);

  const holiday = kind === "holiday";
  const meeting = kind === "meeting";
  const kinds: EventKind[] = model.feeKinds ? ["holiday", "exam", "event", "ptm", "meeting", "fee_due"] : ["holiday", "exam", "event", "ptm", "meeting"];
  const last = multi && endsOn > startsOn ? endsOn : startsOn;
  const students = chosen.size === 0 ? model.parents : model.classes.filter((c) => chosen.has(c.id)).reduce((s, c) => s + c.roll, 0);
  const aud = meeting ? p("staff", "स्टाफ़") : p("parents", "अभिभावक");
  const audience: NoticeAudience = meeting ? "staff" : "parents";
  const reach = meeting ? model.staff : holiday ? model.parents : students;
  const cost = rupeesAbout(reach * rate);
  const timed = !holiday && !allDay;
  const shown = { kind, title: title.trim() || KIND_STYLE[kind].label.en, titleHi: titleHi.trim() || null, startsOn, endsOn: last, allDay: !timed, startsAt: timed ? startsAt : null, place: holiday ? null : place.trim() || null };
  const preview = holiday ? holidayNotice(shown.title, shown.titleHi, startsOn, last, audience) : eventNotice(shown, audience);
  const dLine = multi
    ? p(`${dayShort(startsOn)} – ${dayShort(last)} · ${daysApart(startsOn, last) + 1} days`, `${dayHi(startsOn)} – ${dayHi(last)} · ${daysApart(startsOn, last) + 1} दिन`)
    : p(dayLong(startsOn), dayHi(startsOn));
  const dHi = sub(dLine);

  const toggle = (id: string) =>
    setChosen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const pickStart = (t: string) => {
    setEndsAt(addMinutes(t, Math.max(30, minutesBetween(startsAt, endsAt))));
    setStartsAt(t);
  };
  const save = () => {
    if (!title.trim()) {
      setErr(true);
      toast.show({ tone: "bad", text: tx(p("Give the event a name first", "पहले कार्यक्रम का नाम लिखें")) });
      return;
    }
    run(
      () =>
        addEventAction({
          kind,
          title,
          titleHi,
          startsOn,
          endsOn: last,
          allDay: !timed,
          startsAt,
          endsAt,
          place: holiday ? "" : place,
          classIds: holiday || meeting ? [] : [...chosen],
          details: holiday ? "" : details,
          notify: tell,
          audience,
        }),
      (r) => r.ok && router.replace(r.id ? `/calendar?event=${r.id}` : model.backHref, { scroll: false }),
    );
  };
  const saveL = tx(p("Save event", "कार्यक्रम सहेजें"));
  const saveIcon = pending ? <Ic n="refresh" size={16} className="spin" /> : <Ic n="check" />;
  const countL = tell ? p(`${reach} ${aud.en} · about ${cost}`, `${reach} ${aud.hi} · लगभग ${cost}`) : p(`Off · you can tell ${aud.en} later from ${holiday ? "the holiday" : "the event"}`, `बंद · ${aud.hi} को बाद में ${holiday ? "छुट्टी" : "कार्यक्रम"} से बता सकते हैं`);

  return (
    <>
      <div className="pad cal-pg">
        <div className="stack" style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) 380px", gap: 20, alignItems: "start", maxWidth: 1180 }}>
          <div className="card cal-c" style={{ gap: 16, padding: 20, minWidth: 0 }}>
            <label className="field">
              <span>{tx(p("What is it?", "क्या है?"))}</span>
              <input className={`inp${err && !title.trim() ? " err" : ""}`} value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} placeholder={tx(holiday ? p("For example: Diwali break", "जैसे: दीपावली अवकाश") : p("For example: Science exhibition", "जैसे: विज्ञान प्रदर्शनी"))} />
            </label>
            {err && !title.trim() ? <span role="alert" style={{ fontSize: 12, fontWeight: 600, color: "var(--bad)", marginTop: -10 }}>{tx(p("Give the event a name so parents know what it is.", "नाम लिखें ताकि अभिभावक समझ सकें कि क्या है।"))}</span> : null}
            <label className="field">
              <span>{tx(p("Name in Hindi (optional)", "हिंदी में नाम (वैकल्पिक)"))}</span>
              <input className="inp" lang="hi" value={titleHi} maxLength={120} onChange={(e) => setTitleHi(e.target.value)} />
            </label>
            <div className="field">
              <span>{tx(p("Type", "प्रकार"))}</span>
              <SegChoice label={tx(p("Event type", "कार्यक्रम का प्रकार"))} value={kind} onChange={setKind} options={kinds.map((k) => ({ value: k, label: tx(KIND_STYLE[k].label) }))} />
            </div>
            <div className="field">
              <span>{tx(p("When", "कब"))}</span>
              <SegChoice
                label={tx(p("One day or several", "एक दिन या कई"))}
                value={multi ? "multi" : "one"}
                onChange={(v) => {
                  setMulti(v === "multi");
                  if (v === "multi" && endsOn <= startsOn) setEndsOn(startsOn);
                }}
                options={[
                  { value: "one", label: tx(p("One day", "एक दिन")) },
                  { value: "multi", label: tx(p("Several days", "कई दिन")) },
                ]}
              />
            </div>
            <div className="g2" style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 12 }}>
              <label className="field">
                <span>{tx(multi ? p("First day", "पहला दिन") : p("Date", "तारीख़"))}</span>
                <input
                  className="inp"
                  type="date"
                  value={startsOn}
                  onChange={(e) => {
                    const v = e.target.value;
                    if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return;
                    setStartsOn(v);
                    if (endsOn < v) setEndsOn(v);
                  }}
                />
              </label>
              {multi ? (
                <label className="field cal-in">
                  <span>{tx(p("Last day", "आख़िरी दिन"))}</span>
                  <input className="inp" type="date" value={last} min={startsOn} onChange={(e) => /^\d{4}-\d{2}-\d{2}$/.test(e.target.value) && setEndsOn(e.target.value < startsOn ? startsOn : e.target.value)} />
                </label>
              ) : null}
            </div>
            <span className="cal-m" style={{ marginTop: -8 }}>
              {tx(dLine)}
              {dHi ? ` · ${dHi}` : ""}
            </span>
            {!holiday ? (
              <>
                <button type="button" className="tap cal-sw" role="switch" aria-checked={allDay} onClick={() => setAllDay(!allDay)}>
                  <span className="cal-c cal-f">
                    <span className="cal-t">{tx(p("All day", "पूरे दिन"))}</span>
                    <span className="cal-m">{tx(p("Turn off to pick a time", "समय चुनने के लिए बंद करें"))}</span>
                  </span>
                  <span className={`sw${allDay ? " on" : ""}`}>
                    <span />
                  </span>
                </button>
                {timed ? (
                  <>
                    <div className="field cal-in">
                      <span>{tx(p("Starts at", "शुरू"))}</span>
                      <div className="cal-r cal-w" style={{ gap: 6 }}>
                        {START_TIMES.map((t) => (
                          <ChipBtn key={t} on={startsAt === t} onClick={() => pickStart(t)}>{time12(t)}</ChipBtn>
                        ))}
                      </div>
                    </div>
                    <div className="field cal-in">
                      <span>{tx(p(`How long · ends ${time12(endsAt)}`, `कितनी देर · ${time12(endsAt)} तक`))}</span>
                      <div className="cal-r cal-w" style={{ gap: 6 }}>
                        {DURATIONS.map(([m, l]) => (
                          <ChipBtn key={m} on={addMinutes(startsAt, m) === endsAt} onClick={() => setEndsAt(addMinutes(startsAt, m))}>{tx(l)}</ChipBtn>
                        ))}
                      </div>
                    </div>
                  </>
                ) : null}
                <label className="field">
                  <span>{tx(p("Place (optional)", "जगह (वैकल्पिक)"))}</span>
                  <input className="inp" value={place} maxLength={120} onChange={(e) => setPlace(e.target.value)} placeholder={tx(p("For example: School hall", "जैसे: विद्यालय सभागार"))} />
                </label>
                {meeting ? (
                  <span className="cal-x cal-m3">{tx(p(`Meetings are for staff only — ${model.staff} people. Parents are not invited.`, `बैठक केवल स्टाफ़ के लिए है — ${model.staff} लोग। अभिभावक आमंत्रित नहीं।`))}</span>
                ) : (
                  <div className="field">
                    <span>{tx(p(`Classes · ${students} students`, `कक्षाएँ · ${students} विद्यार्थी`))}</span>
                    <div className="cal-r cal-w" style={{ gap: 6 }}>
                      <ChipBtn on={chosen.size === 0} onClick={() => setChosen(new Set())} style={{ height: 32, padding: "0 11px" }}>{tx(p("All classes", "सभी कक्षाएँ"))}</ChipBtn>
                      {model.classes.map((c) => (
                        <ChipBtn key={c.id} on={chosen.has(c.id)} onClick={() => toggle(c.id)} style={{ height: 32, padding: "0 11px" }}>{c.label}</ChipBtn>
                      ))}
                    </div>
                  </div>
                )}
                <label className="field">
                  <span>{tx(p("Details (optional)", "विवरण (वैकल्पिक)"))}</span>
                  <textarea className="inp" rows={2} maxLength={1000} value={details} onChange={(e) => setDetails(e.target.value)} style={{ minHeight: 64 }} />
                </label>
              </>
            ) : (
              <span className="cal-x cal-m3">{tx(p("A holiday closes the register and the timetable for the whole school on these days.", "छुट्टी इन दिनों पूरे विद्यालय का रजिस्टर और समय सारणी बंद करती है।"))}</span>
            )}
            <button type="button" className="tap cal-sw" role="switch" aria-checked={tell} onClick={() => setTell(!tell)} style={{ border: tell ? "2px solid var(--acc)" : "1px solid var(--bd)", background: tell ? "var(--accs)" : "var(--card)" }}>
              <span className="cal-i cal-ic" style={{ background: "var(--card)", color: "var(--acc)" }}>
                <Ic n="message" />
              </span>
              <span className="cal-c cal-f">
                <span className="cal-t">{tx(p(`Tell ${aud.en} on WhatsApp`, `${aud.hi} को WhatsApp पर बताएँ`))}</span>
                <span className="num cal-m">{tx(countL)}</span>
              </span>
              <span className={`sw${tell ? " on" : ""}`}>
                <span />
              </span>
            </button>
          </div>
          <div className="unstick cal-c" style={{ position: "sticky", top: 86, gap: 14, minWidth: 0 }}>
            {tell ? (
              <div className="card cal-c cal-in" style={{ gap: 10, padding: "14px 14px 16px" }}>
                <div className="cal-r cal-sp" style={{ gap: 8 }}>
                  <span className="sech">{tx(p("WhatsApp preview", "WhatsApp पूर्वावलोकन"))}</span>
                  <span className="pill num" style={{ background: "var(--accs)", color: "var(--accfg)" }}>{tx(p(`${reach} ${aud.en} · about ${cost}`, `${reach} ${aud.hi} · लगभग ${cost}`))}</span>
                </div>
                <Bubble text={preview} time={tx(p("after approval", "मंज़ूरी के बाद"))} />
                <span className="cal-m">{tx(p(`Hindi first, English below. Saved for approval in Messages → To send, where a person sends it on WhatsApp — about ${rate2(rate)} a message.`, `पहले हिंदी, नीचे अंग्रेज़ी। संदेश → भेजने को में मंज़ूरी के लिए सहेजी जाती है, फिर कोई व्यक्ति WhatsApp से भेजता है — लगभग ${rate2(rate)} प्रति संदेश।`))}</span>
              </div>
            ) : null}
            <div className="only-d cal-r" style={{ gap: 8 }}>
              <Link href={model.backHref} scroll={false} className="tap btn sec" style={{ flex: 1, height: 46 }}>{tx(p("Cancel", "रद्द करें"))}</Link>
              <button type="button" className="tap btn pri" style={{ flex: 1.6, height: 46 }} disabled={pending} onClick={save}>
                {saveIcon}
                {saveL}
              </button>
            </div>
          </div>
        </div>
      </div>
      <div className="only-m glass cal-sb cal-c" style={{ gap: 6 }}>
        <span className="num cal-m" style={{ textAlign: "center" }}>{tx(tell ? p(`Saves and asks to tell ${reach} ${aud.en} · ${cost}`, `सहेजता है और ${reach} ${aud.hi} को बताने की मंज़ूरी माँगता है · ${cost}`) : p("Saves without a WhatsApp", "बिना WhatsApp के सहेजता है"))}</span>
        <button type="button" className="tap btn pri" style={{ width: "100%", height: 48 }} disabled={pending} onClick={save}>
          {saveIcon}
          {saveL}
        </button>
      </div>
    </>
  );
}

/** A sheet whose open state is the URL: closing plays the animation, then drops the parameter. */
function useUrlSheet(closeHref: string) {
  const router = useRouter();
  const [open, setOpen] = useState(true);
  const close = () => {
    setOpen(false);
    window.setTimeout(() => router.replace(closeHref, { scroll: false }), 220);
  };
  return { open, close };
}

/** Ask to tell people about a holiday or an event (Calendar `notify`). Saved for approval, never sent from here. */
export function NotifySheet({ model, rate }: { model: NotifyModel; rate: number }) {
  const { tx, sub } = useVx();
  const { run, pending } = useRun();
  const { open, close } = useUrlSheet(model.closeHref);
  const [audience, setAudience] = useState<NoticeAudience>(model.initial);
  const chosen = model.options.find((o) => o.key === audience) ?? model.options[0];
  const word = chosen.key === "staff" ? p("staff", "स्टाफ़") : chosen.key === "both" ? p("people", "लोग") : p("parents", "अभिभावक");
  const cost = rupeesAbout(chosen.n * rate);
  const lineHi = sub(model.line);
  return (
    <Sheet
      open={open}
      onClose={close}
      wide
      title={tx(model.head)}
      sub={`${tx(model.line)}${lineHi ? ` · ${lineHi}` : ""}`}
      footer={
        <div className="cal-sf">
          <div className="cal-r cal-sp" style={{ fontSize: 13 }}>
            <span className="num" style={{ color: "var(--mut)" }}>{`${chosen.n} ${tx(word)} × ${rate2(rate)}`}</span>
            <span className="num" style={{ fontWeight: 700 }}>{tx(p(`about ${cost}`, `लगभग ${cost}`))}</span>
          </div>
          <div className="cal-r" style={{ gap: 8 }}>
            <button type="button" className="tap btn sec" style={{ flex: 1 }} onClick={close}>{tx(p("Not now", "अभी नहीं"))}</button>
            <button
              type="button"
              className="tap btn pri"
              style={{ flex: 1.6 }}
              disabled={pending}
              onClick={() => run(() => requestNoticeAction({ holidayDay: model.holidayDay, eventId: model.eventId, audience: chosen.key }), (r) => r.ok && close())}
            >
              {pending ? <Ic n="refresh" size={16} className="spin" /> : <Ic n="send" />}
              {tx(p(`Ask to send to ${chosen.n} · ${cost}`, `${chosen.n} को भेजने की मंज़ूरी माँगें · ${cost}`))}
            </button>
          </div>
        </div>
      }
    >
      <div className="cal-n2" style={{ paddingTop: 4 }}>
        <div className="cal-c" style={{ gap: 8, minWidth: 0 }}>
          {model.already ? (
            <div role="status" className="cal-r cal-st" style={{ gap: 10, padding: "12px 14px", borderRadius: 14, background: "var(--warns)", color: "var(--warnfg)", fontSize: 13, lineHeight: 1.5 }}>
              <Ic n="info" />
              <span>{tx(model.already)}</span>
            </div>
          ) : null}
          <span className="sech">{tx(p("Who gets it", "किसे मिलेगी"))}</span>
          <div role="radiogroup" aria-label={tx(p("Who gets it", "किसे मिलेगी"))} className="cal-c" style={{ gap: 8 }}>
            {model.options.map((o) => {
              const on = o.key === chosen.key;
              return (
                <button key={o.key} type="button" role="radio" aria-checked={on} className="tap cal-sw" onClick={() => setAudience(o.key)} style={{ border: on ? "2px solid var(--acc)" : "1px solid var(--bd)", background: on ? "var(--accs)" : "var(--card)" }}>
                  <span className="cal-i" style={{ width: 20, height: 20, borderRadius: 10, border: `2px solid ${on ? "var(--acc)" : "var(--bds)"}` }}>
                    <span style={{ width: 10, height: 10, borderRadius: 5, background: "var(--acc)", transform: `scale(${on ? 1 : 0})`, transition: "transform .25s var(--spring)" }} />
                  </span>
                  <span className="cal-c cal-f">
                    <span className="cal-t">{tx(o.label)}</span>
                    <span className="cal-m">{tx(o.sub)}</span>
                  </span>
                  <span className="num cal-h">{o.n}</span>
                </button>
              );
            })}
          </div>
          <span className="sech" style={{ marginTop: 6 }}>{tx(p("When", "कब"))}</span>
          <span className="cal-r cal-st cal-m3" style={{ gap: 8 }}>
            <Ic n="clock" size={15} style={{ marginTop: 2 }} />
            {tx(p("After approval in Messages → To send, a person sends it on WhatsApp.", "संदेश → भेजने को में मंज़ूरी के बाद, कोई व्यक्ति WhatsApp से भेजता है।"))}
          </span>
        </div>
        <div className="cal-c cal-in" style={{ gap: 8, minWidth: 0 }}>
          <span className="sech">{tx(p("What they see", "उन्हें क्या दिखेगा"))}</span>
          <Bubble text={chosen.preview} time={tx(p("after approval", "मंज़ूरी के बाद"))} />
          <span className="cal-m">{tx(p("Hindi first, English below. Nothing is sent from here.", "पहले हिंदी, नीचे अंग्रेज़ी। यहाँ से कुछ नहीं जाता।"))}</span>
        </div>
      </div>
    </Sheet>
  );
}

/** Cancel an event: it leaves the calendar but stays in the record. */
export function CancelEventButton({ id, title, told }: { id: string; title: Pair; told: boolean }) {
  const { tx } = useVx();
  const router = useRouter();
  const { run, pending } = useRun();
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="tap btn ghost mfull" onClick={() => setOpen(true)} style={{ color: "var(--bad)" }}>
        <Ic n="x" />
        {tx(p("Cancel event", "कार्यक्रम रद्द करें"))}
      </button>
      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        title={tx(p(`Cancel ${title.en}?`, `${title.hi ?? title.en} रद्द करें?`))}
        footer={
          <div className="cal-sf">
            <div className="cal-r cal-sp" style={{ fontSize: 13 }}>
              <span style={{ color: "var(--mut)" }}>{tx(p("No WhatsApp will be sent", "कोई WhatsApp नहीं जाएगा"))}</span>
              <span className="num" style={{ fontWeight: 700 }}>₹0</span>
            </div>
            <div className="cal-r" style={{ gap: 8 }}>
              <button type="button" className="tap btn sec" style={{ flex: 1 }} onClick={() => setOpen(false)}>{tx(p("Keep event", "कार्यक्रम रखें"))}</button>
              <button type="button" className="tap btn danger" style={{ flex: 1.6 }} disabled={pending} onClick={() => run(() => cancelEventAction(id), (r) => { if (r.ok) { setOpen(false); router.replace("/calendar"); } })}>
                {pending ? <Ic n="refresh" size={16} className="spin" /> : <Ic n="x" />}
                {tx(p("Cancel event", "कार्यक्रम रद्द करें"))}
              </button>
            </div>
          </div>
        }
      >
        <div className="cal-r cal-st" style={{ gap: 10, padding: "12px 14px", borderRadius: 14, background: "var(--warns)", color: "var(--warnfg)", fontSize: 13, lineHeight: 1.5 }}>
          <Ic n="info" />
          <span>
            {tx(
              told
                ? p("It leaves everyone’s calendar but stays in the record. People already told are not told again automatically — send a new notice from Messages if they need to know.", "यह सबके कैलेंडर से हटेगा पर रिकॉर्ड में रहेगा। जिन्हें बताया गया, उन्हें अपने आप दोबारा नहीं बताया जाएगा — ज़रूरत हो तो संदेश से नई सूचना भेजें।")
                : p("It leaves everyone’s calendar but stays in the record. Nobody was told about it yet.", "यह सबके कैलेंडर से हटेगा पर रिकॉर्ड में रहेगा। अभी किसी को इसकी सूचना नहीं दी गई।"),
            )}
          </span>
        </div>
      </Sheet>
    </>
  );
}
