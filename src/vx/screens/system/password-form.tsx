"use client";

import { useState } from "react";

import { changePasswordAction } from "@/app/(app)/preferences/password/actions";
import { useVx } from "@/vx/i18n";
import { p, type Pair } from "@/vx/text";
import { Field, Input } from "@/vx/ui/controls";
import { useToast } from "@/vx/ui/overlays";
import { Banner } from "@/vx/ui/page";
import { Btn, Card } from "@/vx/ui/primitives";

import { passwordStrength, type Strength } from "@/vx/screens/system/logic";

const STRENGTH: Record<Strength["label"], { pair: Pair; color: string }> = {
  "too-short": { pair: p("Too short — at least 6 characters", "बहुत छोटा — कम से कम 6 अक्षर"), color: "var(--bad)" },
  weak: { pair: p("Weak — add more letters or numbers", "कमज़ोर — और अक्षर या अंक जोड़ें"), color: "var(--bad)" },
  fair: { pair: p("Fair", "ठीक"), color: "var(--warn)" },
  good: { pair: p("Good", "अच्छा"), color: "var(--acc)" },
  strong: { pair: p("Strong", "मज़बूत"), color: "var(--ok)" },
};

/** P11 state `password`: change your own password, with a strength meter. */
export function PasswordForm() {
  const { tx } = useVx();
  const toast = useToast();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const strength = passwordStrength(next);
  const mismatch = confirm.length > 0 && confirm !== next;
  const ready = current.length > 0 && strength.ok && confirm === next;

  async function save() {
    if (!ready) return;
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
    toast.show({ text: tx(p("Password changed.", "पासवर्ड बदल गया।")), tone: "ok" });
  }

  const type = show ? "text" : "password";
  return (
    <Card style={{ display: "flex", flexDirection: "column", gap: 14, maxWidth: 520, width: "100%" }}>
      {done ? <Banner tone="ok">{tx(p("Your password is changed. Use the new one next time you sign in.", "पासवर्ड बदल गया। अगली बार नया पासवर्ड लगाएँ।"))}</Banner> : null}
      <Field label={tx(p("Current password", "अभी का पासवर्ड"))}>
        <Input type={type} value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" />
      </Field>
      <Field label={tx(p("New password", "नया पासवर्ड"))}>
        <Input type={type} value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" aria-describedby="pw-strength" />
      </Field>
      <div id="pw-strength" aria-live="polite" style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 4 }} aria-hidden>
          {[1, 2, 3, 4].map((i) => (
            <span key={i} style={{ height: 6, borderRadius: 3, background: next && strength.score >= i ? STRENGTH[strength.label].color : "var(--s3)" }} />
          ))}
        </div>
        {next ? <span style={{ fontSize: 13, color: STRENGTH[strength.label].color, fontWeight: 600 }}>{tx(STRENGTH[strength.label].pair)}</span> : null}
      </div>
      <Field label={tx(p("Type the new password again", "नया पासवर्ड फिर से लिखें"))} error={mismatch ? tx(p("The two do not match.", "दोनों मेल नहीं खाते।")) : undefined}>
        <Input type={type} value={confirm} invalid={mismatch} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" />
      </Field>
      <label className="tap" style={{ display: "flex", gap: 10, alignItems: "center", minHeight: 44 }}>
        <input type="checkbox" checked={show} onChange={(e) => setShow(e.target.checked)} style={{ width: 20, height: 20 }} />
        {tx(p("Show passwords", "पासवर्ड दिखाएँ"))}
      </label>
      {error ? <Banner tone="bad">{error}</Banner> : null}
      <Btn variant="pri" icon="key" big full disabled={!ready || busy} onClick={save}>
        {busy ? tx(p("Changing…", "बदल रहे हैं…")) : tx(p("Change password", "पासवर्ड बदलें"))}
      </Btn>
    </Card>
  );
}
