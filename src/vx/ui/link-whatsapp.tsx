"use client";

import { useEffect, useEffectEvent, useState, useTransition } from "react";

import {
  cancelWhatsappLinkAction,
  resumeWhatsappAction,
  startWhatsappLinkAction,
  stopWhatsappAction,
  whatsappLinkStatusAction,
} from "@/app/(app)/preferences/whatsapp-link-actions";
import type { StartedLink, WhatsappLinkCard } from "@/modules/whatsapp/data/staff-link";
import { cue } from "@/ui/feedback/cue";
import { dayMonthP, timeP } from "@/vx/format";
import { Ic } from "@/vx/icons";
import { useVx } from "@/vx/i18n";
import { p, type Pair } from "@/vx/text";
import { useToast } from "@/vx/ui/overlays";
import { SuccessTick } from "@/vx/ui/primitives";

import "./link-whatsapp.css";

/*
 * Link my WhatsApp (D-582), on My profile (teachers) and Preferences.
 *
 * Three steps a first-time user can follow without help: tap the green
 * button, WhatsApp opens with the message already typed, press Send. The
 * screen then waits for the message by itself (a few seconds' check while
 * it is in view, and straight away when they come back from WhatsApp) and
 * turns into "Linked" with a tick. Nothing is ever sent from here: the
 * person presses Send in their own WhatsApp, and the number is taken from
 * WhatsApp, so it cannot be mistyped and cannot be somebody else's.
 *
 * The open button is a real link built before the tap, so a phone opens
 * WhatsApp at once (no pop-up for a blocker to stop). A computer also gets
 * a QR code to scan with the phone's camera. A code still waiting when the
 * page is opened again (a phone that dropped the page while WhatsApp was in
 * front) comes back as `pending`, so nobody has to start over.
 */

const W = {
  title: p("Link my WhatsApp", "मेरा WhatsApp जोड़ें"),
  why: p(
    "Parents' questions meant for you, and the school's messages about your work, come to your own WhatsApp.",
    "अभिभावकों के आपके लिए सवाल, और आपके काम की स्कूल की सूचनाएँ, आपके अपने WhatsApp पर आएँगी।",
  ),
  step1: p("Tap the green button", "हरा बटन दबाएँ"),
  step2: p("WhatsApp opens with a message ready", "WhatsApp में संदेश तैयार मिलेगा"),
  step3: p("Press Send. That is all.", "भेजें दबाएँ। बस इतना ही।"),
  linkBtn: p("Link my WhatsApp", "मेरा WhatsApp जोड़ें"),
  making: p("Making your code…", "आपका कोड बन रहा है…"),
  safe: p(
    "Nothing is sent until you press Send in WhatsApp, and only your own phone can link your number.",
    "जब तक आप WhatsApp में भेजें नहीं दबाते, कुछ नहीं जाता। आपका नंबर केवल आपके अपने फ़ोन से जुड़ता है।",
  ),
  onFile: (number: string) =>
    p(
      `The office has ${number} for you. Link from your own phone to make sure it is yours.`,
      `ऑफ़िस के पास आपका नंबर ${number} है। पक्का करने के लिए अपने फ़ोन से जोड़ें।`,
    ),
  codeReady: p("Your code is ready", "आपका कोड तैयार है"),
  openStep: p("Open WhatsApp and press Send", "WhatsApp खोलें और भेजें दबाएँ"),
  openBtn: p("Open WhatsApp", "WhatsApp खोलें"),
  backStep: p("Come back here. It links by itself.", "यहाँ लौट आएँ। नंबर अपने-आप जुड़ जाएगा।"),
  waiting: p("Waiting for your message", "आपके संदेश का इंतज़ार"),
  until: (time: Pair) => p(`The code works for 30 minutes, until ${time.en}.`, `कोड 30 मिनट चलेगा, ${time.hi ?? time.en} तक।`),
  scan: p("On a computer? Scan this with your phone's camera.", "कंप्यूटर पर हैं? इसे अपने फ़ोन के कैमरे से स्कैन करें।"),
  byHand: (to: string) => {
    const number = to.replace(/ /g, "\u00a0"); // one piece: a phone number never breaks across lines
    return p(`WhatsApp did not open? Send this message to ${number}:`, `WhatsApp नहीं खुला? यह संदेश ${number} पर भेजें:`);
  },
  copy: p("Copy message", "संदेश कॉपी करें"),
  copied: p("Copied. Paste it in WhatsApp and send.", "कॉपी हो गया। WhatsApp में चिपकाकर भेजें।"),
  copyFailed: p("Could not copy", "कॉपी नहीं हुआ"),
  cancel: p("Cancel", "रद्द करें"),
  expired: p("The code ran out. Make a new one: it takes a second.", "कोड का समय खत्म हो गया। नया बना लें, एक पल लगेगा।"),
  newCode: p("Make a new code", "नया कोड बनाएँ"),
  failed: p("Could not make a code just now. Please try again.", "अभी कोड नहीं बन सका। फिर से कोशिश करें।"),
  retry: p("Try again", "फिर से कोशिश करें"),
  linkedTitle: p("WhatsApp linked", "WhatsApp जुड़ गया"),
  onTitle: p("WhatsApp is on", "WhatsApp चालू है"),
  linkedToast: p("Your WhatsApp is linked", "आपका WhatsApp जुड़ गया"),
  since: (day: Pair) => p(`since ${day.en}`, `${day.hi ?? day.en} से`),
  live: p(
    "Parents' questions meant for you come here between 6 am and 9 pm. To answer, swipe right on the message and type.",
    "अभिभावकों के आपके लिए सवाल सुबह 6 से रात 9 बजे के बीच यहाँ आएँगे। जवाब देने के लिए संदेश को दाईं ओर स्वाइप करके लिखें।",
  ),
  notYet: p(
    "The school has not switched these messages on yet, so nothing comes for now. Your number is ready.",
    "स्कूल ने ये संदेश अभी चालू नहीं किए हैं, इसलिए अभी कुछ नहीं आएगा। आपका नंबर तैयार है।",
  ),
  different: p("Use a different number", "दूसरा नंबर जोड़ें"),
  stop: p("Stop WhatsApp", "WhatsApp बंद करें"),
  stopAsk: p("Stop all WhatsApp from the school app? You can turn it on again at any time.", "स्कूल ऐप के सारे WhatsApp बंद करें? कभी भी फिर से चालू कर सकते हैं।"),
  stopYes: p("Yes, stop", "हाँ, बंद करें"),
  keep: p("Keep it on", "चालू रखें"),
  stoppedToast: p("WhatsApp turned off", "WhatsApp बंद हो गया"),
  stoppedTitle: p("WhatsApp is turned off", "WhatsApp बंद है"),
  stoppedLine: p("Nothing is sent to this number.", "इस नंबर पर कुछ नहीं भेजा जाता।"),
  resume: p("Turn on again", "फिर से चालू करें"),
  resumedToast: p("WhatsApp is on again", "WhatsApp फिर से चालू है"),
  lookOnly: p("You are seeing One as this person, so nothing can be changed here.", "आप One को इस व्यक्ति की नज़र से देख रहे हैं, इसलिए यहाँ कुछ नहीं बदला जा सकता।"),
  notSaved: p("Not saved. Please try again.", "सहेजा नहीं गया। फिर से कोशिश करें।"),
  unreadable: p("Your WhatsApp link could not be read just now.", "आपका WhatsApp अभी पढ़ा नहीं जा सका।"),
};

const SOURCE: Record<string, Pair> = {
  whatsapp: p("linked from your phone", "आपके फ़ोन से जोड़ा"),
  self: p("you said yes in One", "आपने One में हाँ कहा"),
  admin_recorded: p("recorded by the office", "ऑफ़िस ने दर्ज किया"),
  form: p("on the paper form", "कागज़ के फ़ॉर्म से"),
};

/** How often the screen asks whether the message has come in, while it is in view. */
const CHECK_EVERY_MS = 3000;

type Phase =
  | { kind: "idle" }
  | { kind: "making" }
  | { kind: "waiting"; link: StartedLink }
  | { kind: "expired" }
  | { kind: "failed" };

type StatusReply = Awaited<ReturnType<typeof whatsappLinkStatusAction>>;

export function LinkWhatsapp({
  card: initialCard,
  pending,
  live,
  lookOnly = false,
}: {
  /** Null when it could not be read: the button still works. */
  card: WhatsappLinkCard | null;
  /** A code made earlier and still waiting for its message. */
  pending: StartedLink | null;
  /** Veer Patta AI's alerts reach real staff now. */
  live: boolean;
  /** An administrator seeing One as this person (D-544): look, never press. */
  lookOnly?: boolean;
}) {
  const { tx, sub } = useVx();
  const toast = useToast();
  const [card, setCard] = useState<WhatsappLinkCard | null>(initialCard);
  // Never a usable code in somebody else's view: it would link the viewer's phone to them.
  const [phase, setPhase] = useState<Phase>(pending && !lookOnly ? { kind: "waiting", link: pending } : { kind: "idle" });
  const [justLinked, setJustLinked] = useState(false);
  const [askStop, setAskStop] = useState(false);
  const [busy, start] = useTransition();

  const failed = (why: "look_only" | "failed") => toast.show({ text: tx(why === "look_only" ? W.lookOnly : W.notSaved), tone: "bad" });

  const begin = () => {
    if (lookOnly) return failed("look_only");
    cue("tap");
    setAskStop(false);
    setPhase({ kind: "making" });
    start(async () => {
      const res = await startWhatsappLinkAction().catch(() => null);
      if (res?.ok) {
        setPhase({ kind: "waiting", link: res.link });
        cue("ready");
      } else {
        setPhase(res && res.why === "look_only" ? { kind: "idle" } : { kind: "failed" });
        if (res?.why === "look_only") failed("look_only");
        else cue("error");
      }
    });
  };

  const cancel = () =>
    start(async () => {
      const res = await cancelWhatsappLinkAction().catch(() => null);
      if (res && !res.ok) return failed(res.why);
      setPhase({ kind: "idle" });
    });

  const consent = (on: boolean) =>
    start(async () => {
      const res = await (on ? resumeWhatsappAction() : stopWhatsappAction()).catch(() => null);
      if (!res || !res.ok) return failed(res ? res.why : "failed");
      setAskStop(false);
      setJustLinked(false);
      if (res.card) setCard(res.card);
      toast.show({ text: tx(on ? W.resumedToast : W.stoppedToast), tone: on ? "ok" : "info" });
    });

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.show({ text: tx(W.copied) });
    } catch {
      toast.show({ text: tx(W.copyFailed), tone: "bad" });
    }
  };

  /* ---- waiting for the message: a check every few seconds while in view, at once on coming back */
  const waitingCode = phase.kind === "waiting" ? phase.link.code : null;
  const waitingUntil = phase.kind === "waiting" ? phase.link.expiresAt : null;

  // The latest phase, read when an answer comes back: a late answer for a code
  // the person has since cancelled or replaced changes nothing.
  const settle = useEffectEvent((code: string, reply: StatusReply | null) => {
    if (phase.kind !== "waiting" || phase.link.code !== code || !reply || !reply.ok) return;
    const status = reply.status;
    if (status.state === "linked") {
      setCard(reply.card ?? { state: "linked", number: status.number, since: null, source: "whatsapp" });
      setJustLinked(true);
      setPhase({ kind: "idle" });
      toast.show({ text: tx(W.linkedToast), cue: "done", ms: 6000 });
    } else if (status.state === "expired") {
      setPhase({ kind: "expired" });
    } else if (status.state === "gone") {
      // Replaced by a newer code, from another tab or another device.
      setPhase({ kind: "idle" });
    }
  });
  const runOut = useEffectEvent((code: string) => {
    if (phase.kind === "waiting" && phase.link.code === code) setPhase({ kind: "expired" });
  });

  useEffect(() => {
    if (!waitingCode || !waitingUntil) return;
    let stopped = false;
    let asking = false;
    const check = async () => {
      if (stopped || asking || document.visibilityState !== "visible") return;
      if (Date.parse(waitingUntil) <= Date.now()) {
        runOut(waitingCode);
        return;
      }
      asking = true;
      const reply = await whatsappLinkStatusAction(waitingCode).catch(() => null);
      asking = false;
      if (!stopped) settle(waitingCode, reply);
    };
    const wake = () => void check();
    const timer = window.setInterval(wake, CHECK_EVERY_MS);
    document.addEventListener("visibilitychange", wake);
    window.addEventListener("focus", wake);
    window.addEventListener("pageshow", wake);
    return () => {
      stopped = true;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", wake);
      window.removeEventListener("focus", wake);
      window.removeEventListener("pageshow", wake);
    };
  }, [waitingCode, waitingUntil]);

  /* ---- the screens */
  const head = (icon: "message" | "check" | "bell", tone: "wa" | "ok" | "mut", title: Pair, line?: string | null) => (
    <div className="lw-head">
      <span className={`lw-ibx lw-${tone}`} aria-hidden="true"><Ic n={icon} size={22} /></span>
      <span className="lw-head-text">
        <span className="lw-title">{tx(title)}</span>
        {sub(title) ? <span className="lw-sub" lang="hi">{sub(title)}</span> : null}
        {line ? <span className="lw-line">{line}</span> : null}
      </span>
    </div>
  );

  const lookNote = lookOnly ? <p className="lw-note lw-warn" role="note">{tx(W.lookOnly)}</p> : null;

  if (phase.kind === "waiting") {
    const link = phase.link;
    return (
      <div className="lw" data-testid="link-whatsapp" data-state="waiting">
        {head("message", "wa", W.title)}
        <ol className="lw-steps">
          <li className="lw-step done">
            <span className="lw-num" aria-hidden="true"><Ic n="check" size={16} stroke={3} /></span>
            <span className="lw-step-body">
              <span className="lw-step-title">{tx(W.codeReady)}</span>
              <span className="lw-code num" aria-label={link.shown.split("").join(" ")}>{link.shown}</span>
            </span>
          </li>
          <li className="lw-step now">
            <span className="lw-num" aria-hidden="true">2</span>
            <span className="lw-step-body">
              <span className="lw-step-title">{tx(W.openStep)}</span>
              <a
                href={link.url}
                target="_blank"
                rel="noopener noreferrer"
                className="tap btn big lw-wa-btn"
                onClick={() => cue("tap")}
                data-testid="link-whatsapp-open"
              >
                <Ic n="send" size={20} />
                {tx(W.openBtn)}
              </a>
            </span>
          </li>
          <li className="lw-step">
            <span className="lw-num" aria-hidden="true">3</span>
            <span className="lw-step-body">
              <span className="lw-step-title">{tx(W.backStep)}</span>
              <span className="lw-wait" role="status" aria-live="polite">
                <span className="lw-dots" aria-hidden="true"><i /><i /><i /></span>
                {tx(W.waiting)}
              </span>
            </span>
          </li>
        </ol>
        {link.qr ? (
          <div className="lw-qr">
            {/* A data URL made on the server: nothing to optimise or fetch. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={link.qr} alt="" width={132} height={132} />
            <span>{tx(W.scan)}</span>
          </div>
        ) : null}
        <div className="lw-hand">
          <span className="lw-line">{tx(W.byHand(link.to))}</span>
          <pre className="lw-msg">{link.message}</pre>
          <div className="lw-row">
            <button type="button" className="tap btn sec" onClick={() => void copy(link.message)}><Ic n="copy" />{tx(W.copy)}</button>
            <button type="button" className="tap btn ghost" onClick={cancel} disabled={busy}><Ic n="x" />{tx(W.cancel)}</button>
          </div>
        </div>
        <p className="lw-note">{tx(W.until(timeP(link.expiresAt)))}</p>
        {lookNote}
      </div>
    );
  }

  const linkButton = (label: Pair, icon: "message" | "refresh" = "message") => (
    <button type="button" className="tap btn big lw-wa-btn" onClick={begin} disabled={busy || lookOnly} data-testid="link-whatsapp-start">
      {phase.kind === "making" ? <span className="lw-spin spin" aria-hidden="true" /> : <Ic n={icon} size={20} />}
      {tx(phase.kind === "making" ? W.making : label)}
    </button>
  );

  if (phase.kind === "expired" || phase.kind === "failed") {
    return (
      <div className="lw" data-testid="link-whatsapp" data-state={phase.kind}>
        {head("message", "wa", W.title)}
        <p className="lw-note lw-warn" role="alert">{tx(phase.kind === "expired" ? W.expired : W.failed)}</p>
        {linkButton(phase.kind === "expired" ? W.newCode : W.retry, "refresh")}
        {lookNote}
      </div>
    );
  }

  if (card?.state === "linked") {
    const facts = [card.number, card.since ? tx(W.since(dayMonthP(card.since))) : null, card.source && SOURCE[card.source] ? tx(SOURCE[card.source]!) : null].filter(Boolean).join(" · ");
    // "Linked" when it came from their phone; a yes recorded another way is just "on".
    const title = justLinked || card.source === "whatsapp" ? W.linkedTitle : W.onTitle;
    return (
      <div className="lw" data-testid="link-whatsapp" data-state="linked">
        <div className="lw-head">
          {justLinked ? <SuccessTick size={48} /> : <span className="lw-ibx lw-ok" aria-hidden="true"><Ic n="check" size={22} stroke={3} /></span>}
          <span className="lw-head-text" role={justLinked ? "status" : undefined}>
            <span className="lw-title">{tx(title)}</span>
            {sub(title) ? <span className="lw-sub" lang="hi">{sub(title)}</span> : null}
            <span className="lw-line num">{facts}</span>
          </span>
        </div>
        <p className="lw-note">{tx(live ? W.live : W.notYet)}</p>
        {askStop ? (
          <div className="lw-ask" role="alertdialog" aria-label={tx(W.stop)}>
            <span>{tx(W.stopAsk)}</span>
            <div className="lw-row">
              <button type="button" className="tap btn danger" onClick={() => consent(false)} disabled={busy}>{busy ? <span className="lw-spin spin" aria-hidden="true" /> : <Ic n="bell" />}{tx(W.stopYes)}</button>
              <button type="button" className="tap btn sec" onClick={() => setAskStop(false)} disabled={busy}>{tx(W.keep)}</button>
            </div>
          </div>
        ) : (
          <div className="lw-row">
            <button type="button" className="tap btn sec" onClick={begin} disabled={busy || lookOnly}><Ic n="refresh" />{tx(W.different)}</button>
            <button type="button" className="tap btn ghost lw-stop" onClick={() => setAskStop(true)} disabled={busy || lookOnly}><Ic n="x" />{tx(W.stop)}</button>
          </div>
        )}
        {lookNote}
      </div>
    );
  }

  if (card?.state === "stopped") {
    return (
      <div className="lw" data-testid="link-whatsapp" data-state="stopped">
        {head("bell", "mut", W.stoppedTitle, [card.number, card.since ? tx(W.since(dayMonthP(card.since))) : null].filter(Boolean).join(" · "))}
        <p className="lw-note">{tx(W.stoppedLine)}</p>
        <div className="lw-row">
          <button type="button" className="tap btn big lw-wa-btn" onClick={() => consent(true)} disabled={busy || lookOnly}>
            {busy ? <span className="lw-spin spin" aria-hidden="true" /> : <Ic n="bell" size={20} />}
            {tx(W.resume)}
          </button>
          <button type="button" className="tap btn sec" onClick={begin} disabled={busy || lookOnly}><Ic n="refresh" />{tx(W.different)}</button>
        </div>
        {lookNote}
      </div>
    );
  }

  // Not linked yet (or unreadable): the three steps and the one green button.
  return (
    <div className="lw" data-testid="link-whatsapp" data-state="none">
      {head("message", "wa", W.title, tx(W.why))}
      {card === null ? <p className="lw-note lw-warn" role="note">{tx(W.unreadable)}</p> : null}
      {card?.number ? <p className="lw-note">{tx(W.onFile(card.number))}</p> : null}
      <ol className="lw-preview" aria-label={tx(W.title)}>
        {[W.step1, W.step2, W.step3].map((step, i) => (
          <li key={i} style={{ animationDelay: `${i * 90}ms` }}>
            <span className="lw-num" aria-hidden="true">{i + 1}</span>
            <span>{tx(step)}</span>
          </li>
        ))}
      </ol>
      {linkButton(W.linkBtn)}
      <p className="lw-note lw-safe"><Ic n="lock" size={14} />{tx(W.safe)}</p>
      {lookNote}
    </div>
  );
}
