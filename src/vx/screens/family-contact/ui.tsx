"use client";

import { useRouter } from "next/navigation";
import { useCallback, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, useTransition } from "react";

import { dayMonth } from "@/vx/format";
import { useVx } from "@/vx/i18n";
import { p, type Pair } from "@/vx/text";
import { ChipRow, Chip, Field, Input, Textarea } from "@/vx/ui/controls";
import { Sheet, useToast } from "@/vx/ui/overlays";
import { Btn, Pill } from "@/vx/ui/primitives";

import { checkFamilyContactAction, logFamilyContactAction } from "@/vx/screens/family-contact/actions";
import { contactCommand, latestContactCandidate, parseContact, type ContactRequest, CONTACT_OUTCOMES, CONTACT_TEXT, type ContactEntry, type ContactOutcome } from "./domain";

import { clearContact, correctContactDate, contactRecoveryKey, contactSnapshot, contactStorage, decodeContactRecord, notifyContactRecovery, reserveContact, subscribeContactRecovery, validContactScope } from "./recovery";

const TONE: Record<ContactOutcome, "mut" | "ok" | "acc"> = { attempted: "mut", spoke: "ok", follow_up_agreed: "acc" };

/**
 * The last family contact and a "Log family contact" sheet (D-265). It only
 * records what happened; there is no send button anywhere in it.
 */
export type ContactRecoveryScope = { owner: string; sessionLabel: string; previewing: boolean };
export function FamilyContactLog({ studentId, contacts, canLog, today, recoveryScope }: { studentId: string; contacts: ContactEntry[]; canLog: boolean; today: string; recoveryScope?: ContactRecoveryScope }) {
  const { tx } = useVx();
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [outcome, setOutcome] = useState<ContactOutcome | null>(null);
  const [agreedOn, setAgreedOn] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<Pair | null>(null);
  const [retryId, setRetryId] = useState<string | null>(null);
  const [serverToday, setServerToday] = useState(today);
  const [pending, start] = useTransition();
  const inFlight = useRef(false);
  const owner = recoveryScope?.owner, sessionLabel = recoveryScope?.sessionLabel;
  const scope = useMemo(() => owner && sessionLabel ? { owner, sessionLabel, studentId } : null, [owner, sessionLabel, studentId]);
  const scopeKey = validContactScope(scope) ? contactRecoveryKey(scope) : "";
  const writable = canLog && !recoveryScope?.previewing && !!scopeKey;
  const current = useRef({ key: scopeKey, writable });
  useLayoutEffect(() => { current.current = { key: scopeKey, writable }; return () => { current.current.writable = false; }; }, [scopeKey, writable]);
  const snapshot = useSyncExternalStore(subscribeContactRecovery, useCallback(() => contactSnapshot(scope), [scope]), () => "loading");
  const original = useMemo(() => scope && snapshot ? decodeContactRecord(snapshot, scope) : null, [snapshot, scope]);
  const unavailable = snapshot === "loading" || snapshot === "unavailable" || snapshot === "unsupported" || (!!snapshot && !original);
  const [formContext, setFormContext] = useState({ key: "", attempt: "" });
  const attempt = original ? JSON.stringify(original) : "";
  // Reset only when the immutable command/context changes. An externally
  // confirmed command must not leave its old text ready for a fresh submission.
  if (formContext.key !== scopeKey || formContext.attempt !== attempt) {
    if (formContext.key !== scopeKey) setOpen(false);
    setFormContext({ key: scopeKey, attempt });
    setOutcome(original?.outcome ?? null); setAgreedOn(original ? latestContactCandidate(original).agreedOn ?? "" : ""); setNote(original?.note ?? "");
    setError(null); setRetryId(null);
    setServerToday(today);
  }
  const last = contacts[0] ?? null;

  const close = () => {
    if (pending || inFlight.current) return;
    setOpen(false);
    if (original) return;
    setOutcome(null);
    setAgreedOn("");
    setNote("");
    setError(null);
  };

  const perform = (mode: "new" | "check" | "retry" | "correct") => {
    if (pending || inFlight.current || !writable || unavailable || !scope) return;
    if (mode !== "new" && (!original || ((mode === "retry" || mode === "correct") && retryId !== original.attemptId))) return;
    if (mode === "new" && snapshot) return;
    const captured = scope;
    const owns = () => current.current.key === scopeKey && current.current.writable;
    const storage = contactStorage();
    if (!storage) return setError(p("Recovery storage is unavailable. No new contact was sent.", "पुनर्प्राप्ति भंडारण उपलब्ध नहीं है। नया संपर्क नहीं भेजा गया।"));
    let command: ContactRequest | null = original;
    if (mode === "new") {
      const parsed = parseContact({ outcome, note, agreedOn }, today);
      if (!parsed.ok) return setError(parsed.error);
      if (!crypto.randomUUID) return setError(p("Refresh in a browser that supports safe contact recovery.", "सुरक्षित संपर्क पुनर्प्राप्ति वाले ब्राउज़र में पेज खोलें।"));
      command = contactCommand({ ...captured, ...parsed.value, attemptId: crypto.randomUUID(), noteId: null });
    }
    if (!command) return;
    if (mode === "correct") {
      const parsed = parseContact({ ...command, agreedOn }, serverToday);
      if (!parsed.ok) return setError(parsed.error);
    }
    let payload = command;
    inFlight.current = true;
    setError(null);
    start(async () => {
      try {
        if (mode === "new" && !(await reserveContact(storage, captured, payload, owns))) {
          if (owns()) setError(p("Another contact is pending or recovery could not be stored. Check the original contact.", "दूसरा संपर्क लंबित है या पुनर्प्राप्ति सहेजी नहीं जा सकी। मूल संपर्क जाँचें।"));
          notifyContactRecovery(); return;
        }
        if (mode === "correct") {
          const corrected = await correctContactDate(storage, captured, snapshot, agreedOn, owns);
          if (!corrected) {
            if (owns()) setError(p("The pending contact changed or its date correction could not be stored. Check the original result again.", "लंबित संपर्क बदल गया या तारीख का सुधार नहीं सहेजा जा सका। मूल नतीजा फिर जाँचें।"));
            notifyContactRecovery(); return;
          }
          payload = corrected;
        }
        notifyContactRecovery();
        if (!owns()) return;
        const res = await (mode === "check" ? checkFamilyContactAction(payload) : logFamilyContactAction(payload));
        if (!owns()) return;
        if (!res.ok) { setError(res.error); setRetryId(res.status === "not_found" || res.status === "expired" ? payload.attemptId : null); if (res.today) setServerToday(res.today); return; }
        if (res.attemptId !== payload.attemptId) throw new Error("Wrong contact receipt");
        if (res.agreedOn !== payload.agreedOn && !payload.dateCorrections?.includes(res.agreedOn ?? "")) throw new Error("Wrong contact date receipt");
        if (!(await clearContact(storage, captured, payload.attemptId, owns))) {
          if (owns()) setError(p("Contact confirmed, but phone recovery could not be cleared. Check the same contact again before a new one.", "संपर्क की पुष्टि हुई, पर फोन से पुनर्प्राप्ति नहीं हट सकी। नया संपर्क दर्ज करने से पहले वही संपर्क फिर जाँचें।"));
          return;
        }
        notifyContactRecovery();
        if (!owns()) return;
        setOpen(false); setOutcome(null); setAgreedOn(""); setNote(""); setError(null); setRetryId(null);
        const recorded = payload.outcome === "follow_up_agreed" ? p(`Family contact recorded · agreed date ${res.agreedOn}`, `परिवार से संपर्क दर्ज · तय तारीख ${res.agreedOn}`) : p("Family contact recorded", "परिवार से संपर्क दर्ज");
        toast.show({ text: tx(recorded) }); router.refresh();
      } catch {
        if (owns()) { setRetryId(null); setError(p("Could not confirm the result. The original contact is kept on this phone. Check its result before retrying or recording a new contact.", "नतीजे की पुष्टि नहीं हो सकी। मूल संपर्क इस फोन में रखा है। फिर प्रयास या नया संपर्क दर्ज करने से पहले उसका नतीजा जाँचें।")); }
      } finally { inFlight.current = false; }
    });
  };

  return (
    <div data-family-contact style={{ marginTop: 12, paddingTop: 12, borderTop: "1px solid var(--bd)", display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
      <span style={{ flex: "1 1 220px", minWidth: 0, display: "flex", flexDirection: "column", gap: 4 }}>
        <span style={{ fontSize: 12, color: "var(--mut)", fontWeight: 600 }}>{tx(p("Last family contact", "पिछला परिवार संपर्क"))}</span>
        {last ? (
          <span style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center", fontSize: 14 }}>
            <Pill tone={TONE[last.outcome]}>{tx(CONTACT_TEXT[last.outcome])}</Pill>
            {last.agreedOn ? <span>{tx(p(`on ${dayMonth(last.agreedOn)}`, `${dayMonth(last.agreedOn)} को`))}</span> : null}
            <span style={{ color: "var(--mut)" }}>{last.by} · {dayMonth(last.at)}</span>
          </span>
        ) : (
          <span style={{ fontSize: 14, color: "var(--mut)" }}>{tx(p("None recorded this year", "इस वर्ष कोई दर्ज नहीं"))}</span>
        )}
        {last?.note ? <span style={{ fontSize: 13, color: "var(--mut)", overflowWrap: "anywhere" }}>{last.note}</span> : null}
      </span>
      {canLog ? (
        <Btn variant="soft" icon="phone" style={{ minHeight: 44 }} onClick={() => setOpen(true)}>{tx(p("Log family contact", "परिवार संपर्क दर्ज करें"))}</Btn>
      ) : null}

      <Sheet
        open={open}
        onClose={close}
        dismissable={!pending}
        title={tx(p("Log family contact", "परिवार संपर्क दर्ज करें"))}
        sub={tx(p("Record what happened. This does not send any message.", "जो हुआ वह दर्ज करें। इससे कोई संदेश नहीं जाता।"))}
        icon="phone"
        footer={
          <div style={{ width: "100%", display: "flex", flexDirection: "column", gap: 8 }}>
          <Btn variant="pri" style={{ minHeight: 44 }} full disabled={pending || !!original || unavailable || !writable || !outcome} onClick={() => perform("new")}>
            {tx(pending ? p("Saving…", "सहेज रहे हैं…") : p("Save", "सहेजें"))}
          </Btn>
          {original ? <>
            <Btn variant="soft" style={{ minHeight: 44 }} full disabled={pending || !writable} onClick={() => perform("check")}>{tx(p("Check original result", "मूल नतीजा जाँचें"))}</Btn>
            {retryId === original.attemptId ? <Btn variant="soft" style={{ minHeight: 44 }} full disabled={pending || !writable} onClick={() => perform("retry")}>{tx(p("Retry same contact", "उसी संपर्क से फिर प्रयास करें"))}</Btn> : null}
            {retryId === original.attemptId && original.outcome === "follow_up_agreed" && agreedOn !== latestContactCandidate(original).agreedOn ? <Btn variant="soft" style={{ minHeight: 44 }} full disabled={pending || !writable || !agreedOn} onClick={() => perform("correct")}>{tx(p("Correct date on same contact", "उसी संपर्क की तारीख सुधारें"))}</Btn> : null}
            <Btn variant="soft" style={{ minHeight: 44 }} full disabled={pending} onClick={() => { setOpen(false); router.refresh(); }}>{tx(p("Check contact history", "संपर्क का इतिहास जाँचें"))}</Btn>
          </> : null}
          </div>
        }
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {unavailable ? <p role="alert">{tx(p("Safe contact recovery is unavailable. Refresh this page; no new contact will be sent.", "सुरक्षित संपर्क पुनर्प्राप्ति उपलब्ध नहीं है। पेज फिर खोलें; नया संपर्क नहीं भेजा जाएगा।"))}</p> : null}
          {original ? <p role="status">{tx(p("An original contact is pending verification. Keep this entry and check its result; do not record it as a new contact.", "मूल संपर्क की पुष्टि लंबित है। यही प्रविष्टि रखें और उसका नतीजा जाँचें; इसे नया संपर्क बनाकर दर्ज न करें।"))}</p> : null}
          {original?.outcome === "follow_up_agreed" && retryId === original.attemptId ? <p>{tx(p("If the agreed date needs correcting, choose its correct date below. This keeps the same contact ID; the confirmed history shows whichever original or corrected date was saved first.", "तय तारीख सुधारनी हो तो नीचे सही तारीख चुनें। संपर्क पहचान वही रहेगी; पुष्टि किए इतिहास में पहले सहेजी गई मूल या सुधरी तारीख दिखेगी।"))}</p> : null}
          <Field label={tx(p("What happened?", "क्या हुआ?"))}>
            <fieldset disabled={pending || !!original} style={{ border: 0, margin: 0, padding: 0 }}>
            <ChipRow label={tx(p("What happened?", "क्या हुआ?"))} style={{ flexWrap: "wrap" }}>
              {CONTACT_OUTCOMES.map((o) => (
                <Chip key={o} on={outcome === o} onClick={() => setOutcome(o)}>{tx(CONTACT_TEXT[o])}</Chip>
              ))}
            </ChipRow>
            </fieldset>
          </Field>
          {outcome === "follow_up_agreed" ? (
            <Field label={tx(p("Agreed date", "तय तारीख"))}>
              <Input disabled={pending || (!!original && retryId !== original.attemptId)} type="date" min={serverToday} value={agreedOn} onChange={(e) => setAgreedOn(e.target.value)} />
            </Field>
          ) : null}
          <Field label={tx(p("Note (optional)", "टिप्पणी (वैकल्पिक)"))}>
            <Textarea disabled={pending || !!original} rows={3} maxLength={400} value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
          {error ? <p role="alert" style={{ margin: 0, color: "var(--bad)", fontWeight: 600 }}>{tx(error)}</p> : null}
        </div>
      </Sheet>
    </div>
  );
}
