"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { dayMonth } from "@/vx/format";
import { useVx } from "@/vx/i18n";
import { p, type Pair } from "@/vx/text";
import { ChipRow, Chip, Field, Input, Textarea } from "@/vx/ui/controls";
import { Sheet, useToast } from "@/vx/ui/overlays";
import { Btn, Pill } from "@/vx/ui/primitives";

import { logFamilyContactAction } from "@/vx/screens/family-contact/actions";
import { CONTACT_OUTCOMES, CONTACT_TEXT, type ContactEntry, type ContactOutcome } from "./domain";

const TONE: Record<ContactOutcome, "mut" | "ok" | "acc"> = { attempted: "mut", spoke: "ok", follow_up_agreed: "acc" };

/**
 * The last family contact and a "Log family contact" sheet (D-265). It only
 * records what happened; there is no send button anywhere in it.
 */
export function FamilyContactLog({ studentId, contacts, canLog, today }: { studentId: string; contacts: ContactEntry[]; canLog: boolean; today: string }) {
  const { tx } = useVx();
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [outcome, setOutcome] = useState<ContactOutcome | null>(null);
  const [agreedOn, setAgreedOn] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<Pair | null>(null);
  const [uncertain, setUncertain] = useState(false);
  const [pending, start] = useTransition();
  const last = contacts[0] ?? null;

  const close = () => {
    if (pending) return;
    setOpen(false);
    if (uncertain) return;
    setOutcome(null);
    setAgreedOn("");
    setNote("");
    setError(null);
  };

  const save = () => {
    if (pending || uncertain) return;
    start(async () => {
      if (!outcome) return setError(p("Choose what happened.", "क्या हुआ, चुनें।"));
      try {
        const res = await logFamilyContactAction({ studentId, outcome, note, agreedOn: agreedOn || null });
        if (!res.ok) return setError(res.error);
        toast.show({ text: tx(p("Family contact recorded", "परिवार से संपर्क दर्ज")) });
        close();
        router.refresh();
      } catch {
        setUncertain(true);
        setError(p("Could not confirm the result. This contact may already be saved. Check the latest contact history. If it is listed, do not repeat it. Reload this page before recording a new contact.", "नतीजे की पुष्टि नहीं हो सकी। यह संपर्क पहले ही सहेजा गया हो सकता है। संपर्क का नया इतिहास देखें। यदि यह दर्ज है, तो दोबारा दर्ज न करें। नया संपर्क दर्ज करने से पहले इस पेज को फिर से लोड करें।"));
      }
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
        <Btn variant="soft" icon="phone" onClick={() => setOpen(true)}>{tx(p("Log family contact", "परिवार संपर्क दर्ज करें"))}</Btn>
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
          <Btn variant="pri" full disabled={pending || uncertain || !outcome} onClick={save}>
            {tx(pending ? p("Saving…", "सहेज रहे हैं…") : p("Save", "सहेजें"))}
          </Btn>
          {uncertain ? <Btn variant="soft" full onClick={() => { setOpen(false); router.refresh(); }}>{tx(p("Check contact history", "संपर्क का इतिहास देखें"))}</Btn> : null}
          </div>
        }
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <Field label={tx(p("What happened?", "क्या हुआ?"))}>
            <ChipRow label={tx(p("What happened?", "क्या हुआ?"))} style={{ flexWrap: "wrap" }}>
              {CONTACT_OUTCOMES.map((o) => (
                <Chip key={o} on={outcome === o} onClick={() => setOutcome(o)}>{tx(CONTACT_TEXT[o])}</Chip>
              ))}
            </ChipRow>
          </Field>
          {outcome === "follow_up_agreed" ? (
            <Field label={tx(p("Agreed date", "तय तारीख"))}>
              <Input type="date" min={today} value={agreedOn} onChange={(e) => setAgreedOn(e.target.value)} />
            </Field>
          ) : null}
          <Field label={tx(p("Note (optional)", "टिप्पणी (वैकल्पिक)"))}>
            <Textarea rows={3} maxLength={400} value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
          {error ? <p role="alert" style={{ margin: 0, color: "var(--bad)", fontWeight: 600 }}>{tx(error)}</p> : null}
        </div>
      </Sheet>
    </div>
  );
}
