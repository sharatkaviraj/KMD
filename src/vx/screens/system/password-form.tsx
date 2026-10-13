"use client";

import { useState } from "react";

import { changePasswordAction } from "@/app/(app)/preferences/password/actions";
import { useVx } from "@/vx/i18n";
import { Ic } from "@/vx/icons";
import { p, type Pair } from "@/vx/text";
import { Btn } from "@/vx/ui/primitives";

import { passwordRules, passwordStrength, type Strength } from "@/vx/screens/system/logic";

/*
 * P11 state `password` (design `Auth` · password): make your own password,
 * with a strength meter and three ticks. The server's rule (the fee app's
 * `validateStaffPassword`, 6 characters) is the only one that gates saving;
 * the meter and the other ticks are advice. The server checks the current
 * password by signing in with it, so it is asked for first — after a reset
 * it is the temporary one the admin gave.
 */

const STRENGTH: Record<Strength["label"], { pair: Pair; color: string }> = {
  "too-short": { pair: p("Too short", "बहुत छोटा"), color: "var(--bad)" },
  weak: { pair: p("Weak", "कमज़ोर"), color: "var(--bad)" },
  fair: { pair: p("Okay", "ठीक"), color: "var(--warn)" },
  good: { pair: p("Good", "अच्छा"), color: "var(--acc)" },
  strong: { pair: p("Strong", "मज़बूत"), color: "var(--ok)" },
};

const T = {
  temporary: p("Temporary password", "अस्थायी पासवर्ड"),
  titleTemp: p("Make your own password", "अपना पासवर्ड बनाएँ"),
  title: p("Change your password", "अपना पासवर्ड बदलें"),
  subTemp: p("The admin gave you a temporary one. Pick a new password only you know.", "प्रशासक ने अस्थायी पासवर्ड दिया था। ऐसा नया पासवर्ड चुनें जो सिर्फ़ आप जानें।"),
  sub: p("Pick a new password only you know.", "ऐसा नया पासवर्ड चुनें जो सिर्फ़ आप जानें।"),
  currentTemp: p("Temporary password from the admin", "प्रशासक से मिला अस्थायी पासवर्ड"),
  current: p("Current password", "अभी का पासवर्ड"),
  currentPlaceholder: p("The one you signed in with", "जिससे साइन इन किया"),
  next: p("New password", "नया पासवर्ड"),
  nextPlaceholder: p("At least 6 characters", "कम से कम 6 अक्षर"),
  strength: p("Strength", "मज़बूती"),
  typeOne: p("Type a password", "पासवर्ड लिखें"),
  ruleLong: p("6 or more characters", "6 या ज़्यादा अक्षर"),
  ruleNumber: p("At least one number", "कम से कम एक अंक"),
  rulePhone: p("Not your phone number", "आपका फ़ोन नंबर नहीं"),
  again: p("Type it again", "फिर से लिखें"),
  againPlaceholder: p("Same password again", "वही पासवर्ड फिर से"),
  match: p("Passwords match", "पासवर्ड मेल खाते हैं"),
  save: p("Save my password", "मेरा पासवर्ड सहेजें"),
  saving: p("Saving…", "सहेज रहे हैं…"),
  hintCurrent: p("Type the password you signed in with first.", "पहले वह पासवर्ड लिखें जिससे साइन इन किया।"),
  hintLong: p("Make it 6 characters or more, then type it again.", "6 या ज़्यादा अक्षर रखें, फिर दोबारा लिखें।"),
  hintAgain: p("Type the same password again to save.", "सहेजने के लिए वही पासवर्ड फिर से लिखें।"),
  hintReady: p("All set — save it.", "सब ठीक है — सहेजें।"),
  show: p("Show password", "पासवर्ड दिखाएँ"),
  hide: p("Hide password", "पासवर्ड छिपाएँ"),
  doneTitle: p("Password saved", "पासवर्ड सहेज लिया"),
  doneSub: p("Use it next time you sign in. The old one no longer works.", "अगली बार साइन इन में इसे लगाएँ। पुराना अब नहीं चलेगा।"),
  continue: p("Continue", "आगे बढ़ें"),
};

const eyeStyle = { position: "absolute", right: 4, bottom: 2, width: 40, height: 40, padding: 0, border: 0, borderRadius: 10, background: "transparent", color: "var(--mut)", display: "flex", alignItems: "center", justifyContent: "center" } as const;

export function PasswordForm({ temporary = false, phone = null, after = "/preferences", initial }: { temporary?: boolean; phone?: string | null; after?: string; /** The design fixture fills the boxes with this. */ initial?: { current?: string; next?: string; confirm?: string } }) {
  const { tx } = useVx();
  const [current, setCurrent] = useState(initial?.current ?? "");
  const [next, setNext] = useState(initial?.next ?? "");
  const [confirm, setConfirm] = useState(initial?.confirm ?? "");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const strength = passwordStrength(next);
  const rules = passwordRules(next, phone);
  const match = confirm.length > 0 && confirm === next;
  const mismatch = confirm.length >= next.length && confirm.length > 0 && !match;
  const ready = current.length > 0 && strength.ok && match;
  const score = next ? Math.max(1, strength.score) : 0;
  const tone = next ? STRENGTH[strength.label].color : "var(--mut)";
  const hint = ready ? T.hintReady : !current ? T.hintCurrent : !strength.ok ? T.hintLong : T.hintAgain;

  async function save() {
    if (!ready || busy) return;
    setBusy(true);
    setError(null);
    const res = await changePasswordAction({ currentPassword: current, newPassword: next, confirmPassword: confirm });
    setBusy(false);
    if (!res.ok) {
      setError(res.message);
      return;
    }
    setDone(true);
    setCurrent("");
    setNext("");
    setConfirm("");
  }

  if (done) {
    return (
      <div className="fadein" role="status" style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12, textAlign: "center", padding: "20px 0" }}>
        <svg width="96" height="96" viewBox="0 0 96 96" aria-hidden="true" style={{ animation: "xPopIn .5s var(--spring) both" }}>
          <circle cx="48" cy="48" r="44" style={{ fill: "var(--oks)" }} />
          <circle cx="48" cy="48" r="44" style={{ fill: "none", stroke: "var(--ok)", strokeWidth: 4, ["--len" as string]: "276.5", strokeDasharray: 276.5, animation: "xDraw .7s .1s var(--ease) both" }} />
          <path d="M30 49l12 12 24-26" style={{ fill: "none", stroke: "var(--ok)", strokeWidth: 6, strokeLinecap: "round", strokeLinejoin: "round", ["--len" as string]: "60", strokeDasharray: 60, animation: "xDraw .45s .5s var(--ease) both" }} />
        </svg>
        <span className="serif" style={{ fontSize: 28, fontWeight: 600, lineHeight: 1.15 }}>{tx(T.doneTitle)}</span>
        <span style={{ fontSize: 13, color: "var(--mut)" }}>{tx(T.doneSub)}</span>
        <Btn variant="pri" href={after} style={{ height: 50, width: "100%", fontSize: 16, borderRadius: 14 }}>
          {tx(T.continue)}
          <Ic n="arrowRight" size={18} />
        </Btn>
      </div>
    );
  }

  const type = show ? "text" : "password";
  const eye = (
    <button type="button" className="tap" aria-label={tx(show ? T.hide : T.show)} aria-pressed={show} onClick={() => setShow((v) => !v)} style={eyeStyle}>
      <Ic n={show ? "eyeOff" : "eye"} size={18} />
    </button>
  );
  const ruleRows: [Pair, boolean][] = [
    [T.ruleLong, rules.long],
    [T.ruleNumber, rules.number],
    [T.rulePhone, rules.notPhone],
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        {temporary ? <span className="pill" style={{ alignSelf: "flex-start", background: "var(--warns)", color: "var(--warnfg)" }}>{tx(T.temporary)}</span> : null}
        <h1 className="serif" style={{ margin: temporary ? "6px 0 0" : 0, fontSize: 28, fontWeight: 600, lineHeight: 1.15 }}>{tx(temporary ? T.titleTemp : T.title)}</h1>
        <span style={{ fontSize: 13, color: "var(--mut)" }}>{tx(temporary ? T.subTemp : T.sub)}</span>
      </div>

      <label className="field" style={{ position: "relative" }}>
        <span>{tx(temporary ? T.currentTemp : T.current)}</span>
        <input className="inp" type={type} value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" placeholder={tx(T.currentPlaceholder)} style={{ paddingRight: 52 }} />
      </label>

      <label className="field" style={{ position: "relative" }}>
        <span>{tx(T.next)}</span>
        <input className="inp" type={type} value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" placeholder={tx(T.nextPlaceholder)} aria-describedby="pw-strength" style={{ paddingRight: 52 }} />
        {eye}
      </label>

      <div id="pw-strength" aria-live="polite" style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: -6 }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 6 }} aria-hidden="true">
          {[0, 1, 2, 3].map((i) => (
            <span key={i} style={{ height: 6, borderRadius: 3, background: "var(--s3)", overflow: "hidden" }}>
              <span style={{ display: "block", height: 6, borderRadius: 3, background: tone, transform: `scaleX(${i < score ? 1 : 0})`, transformOrigin: "left", transition: "transform .4s var(--ease), background-color .3s ease", transitionDelay: `${i * 60}ms` }} />
            </span>
          ))}
        </div>
        <span style={{ display: "flex", justifyContent: "space-between", fontSize: 12 }}>
          <span style={{ color: "var(--mut)" }}>{tx(T.strength)}</span>
          <span style={{ fontWeight: 700, color: tone }}>{tx(next ? STRENGTH[strength.label].pair : T.typeOne)}</span>
        </span>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {ruleRows.map(([label, ok]) => (
          <div key={label.en} style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 14, color: ok ? "var(--ok)" : "var(--mut)", fontWeight: ok ? 600 : 400, transition: "color .25s ease" }}>
            <span aria-hidden="true" style={{ flex: "none", width: 22, height: 22, borderRadius: 11, background: ok ? "var(--ok)" : "transparent", border: `2px solid ${ok ? "var(--ok)" : "var(--bds)"}`, color: "var(--onsolid)", display: "flex", alignItems: "center", justifyContent: "center", transition: "background-color .25s ease, border-color .25s ease" }}>
              {ok ? <Ic n="check" size={13} stroke={3} style={{ animation: "xPopIn .4s var(--spring) both" }} /> : null}
            </span>
            {tx(label)}
          </div>
        ))}
      </div>

      <label className="field" style={{ position: "relative" }}>
        <span>{tx(T.again)}</span>
        <input className={`inp${mismatch ? " err" : ""}`} type={type} value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" placeholder={tx(T.againPlaceholder)} aria-invalid={mismatch || undefined} />
        {match ? (
          <span role="img" aria-label={tx(T.match)} style={{ position: "absolute", right: 10, bottom: 9, width: 26, height: 26, borderRadius: 13, background: "var(--oks)", color: "var(--ok)", display: "flex", alignItems: "center", justifyContent: "center", animation: "xPopIn .4s var(--spring) both" }}>
            <Ic n="check" size={15} stroke={3} />
          </span>
        ) : null}
      </label>

      {error ? (
        <div role="alert" className="fadein" style={{ display: "flex", gap: 10, alignItems: "flex-start", padding: "12px 14px", borderRadius: 14, background: "var(--bads)", color: "var(--bad)", fontSize: 14, lineHeight: 1.5 }}>
          <Ic n="alert" size={18} style={{ marginTop: 2 }} />
          <span>{error}</span>
        </div>
      ) : null}

      <button type="button" className="tap btn pri" onClick={() => void save()} aria-disabled={!ready || busy} style={{ height: 52, fontSize: 16, borderRadius: 14, opacity: ready && !busy ? 1 : 0.55 }}>
        <Ic n="key" size={18} />
        {tx(busy ? T.saving : T.save)}
      </button>
      <span style={{ fontSize: 12, color: "var(--mut)", textAlign: "center", marginTop: -8 }}>{tx(hint)}</span>
    </div>
  );
}
