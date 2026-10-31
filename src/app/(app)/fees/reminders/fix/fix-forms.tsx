"use client";

import { useActionState, useState } from "react";

import {
  IDLE_FIX_ACTION,
  importSessionReportAction,
  markHandledAction,
  markNumberAction,
  resendFailuresAction,
  resolveStuckAction,
  saveFamilyNumberAction,
} from "./actions";
import { toWhatsappDestination } from "@/modules/whatsapp/domain/phone";
import { explainUnusablePhone } from "@/modules/whatsapp/domain/phone-numbers";
import { useActionFeedback } from "@/ui/hooks/use-action-feedback";
import { Button } from "@/ui/primitives/button";
import { Input } from "@/ui/primitives/input";
import { Label } from "@/ui/primitives/label";
import { Notice } from "@/ui/primitives/notice";
import { SelectNative } from "@/ui/primitives/select-native";
import { Sheet } from "@/ui/primitives/sheet";
import { PendingSubmitButton } from "@/ui/shell/pending-submit-button";

/**
 * The failure desk's buttons. Each is its own small form with its own pending
 * state, so pressing Resend on one family never greys out another.
 *
 * Colocated with the route because they import its server actions — a module
 * component reaching into `src/app` is the `module-reaches-app` edge
 * `quality:architecture` refuses. This route is a mobile takeover, so nothing
 * here reserves room for a bottom tab bar.
 */

type Variant = "accent" | "outline" | "primary" | "secondary";

function ResultLine({ state }: { state: { status: string; message?: string } }) {
  if (state.status === "idle" || !state.message) return null;
  return (
    <Notice tone={state.status === "success" ? "success" : "danger"} className="text-xs">
      {state.message}
    </Notice>
  );
}

/** Resend one family's failures, or a whole group's. */
export function ResendForm({
  sendIds,
  label,
  variant = "accent",
  formId,
  className,
}: {
  sendIds: string[];
  label: string;
  variant?: Variant;
  /** Lets checkboxes elsewhere on the page join this form (`form=` attribute). */
  formId?: string;
  className?: string;
}) {
  const [state, action] = useActionState(resendFailuresAction, IDLE_FIX_ACTION);
  useActionFeedback(state, { successTitle: "Resent", errorTitle: "Not resent" });
  return (
    <form id={formId} action={action} className="flex flex-col gap-2">
      {sendIds.map((id) => (
        <input key={id} type="hidden" name="sendId" value={id} />
      ))}
      <PendingSubmitButton
        variant={variant}
        className={className ?? "h-11 w-full md:h-9 md:w-auto"}
        idleLabel={label}
        pendingLabel="Sending…"
      />
      <ResultLine state={state} />
    </form>
  );
}

/** Called, slip sent home, or not chasing — a person's word that closes a failure. */
export function HandledForm({ sendIds, compact = false }: { sendIds: string[]; compact?: boolean }) {
  const [state, action] = useActionState(markHandledAction, IDLE_FIX_ACTION);
  useActionFeedback(state, { successTitle: "Recorded", errorTitle: "Not recorded" });
  return (
    <details className="group rounded-lg border border-border bg-card">
      <summary className="tap focus-ring flex min-h-11 cursor-pointer items-center px-3 text-xs font-semibold md:min-h-9">
        {compact ? "Handled another way…" : "Mark handled…"}
      </summary>
      <form action={action} className="flex flex-col gap-2 border-t border-border p-3">
        {sendIds.map((id) => (
          <input key={id} type="hidden" name="sendId" value={id} />
        ))}
        <div className="space-y-1.5">
          <Label htmlFor={`resolution-${sendIds[0]}`}>What happened</Label>
          <SelectNative id={`resolution-${sendIds[0]}`} name="resolution" defaultValue="called" className="h-11 w-full md:h-9">
            <option value="called">We called the family</option>
            <option value="slip_sent">A slip went home with the child</option>
            <option value="dismissed">Not chasing this one</option>
          </SelectNative>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`note-${sendIds[0]}`}>Note</Label>
          <Input
            id={`note-${sendIds[0]}`}
            name="note"
            placeholder="Will pay on Saturday · left the school · …"
            className="h-11 md:h-9"
          />
        </div>
        <PendingSubmitButton variant="outline" className="h-11 w-full md:h-9 md:w-auto" idleLabel="Record" pendingLabel="Recording…" />
        <ResultLine state={state} />
      </form>
    </details>
  );
}

/** "This number does not work" / "try it again". */
export function NumberHealthForm({ phone, working, label }: { phone: string; working: boolean; label: string }) {
  const [state, action] = useActionState(markNumberAction, IDLE_FIX_ACTION);
  useActionFeedback(state, { successTitle: "Recorded", errorTitle: "Not recorded" });
  return (
    <form action={action} className="flex flex-col gap-1">
      <input type="hidden" name="phone" value={phone} />
      <input type="hidden" name="working" value={working ? "1" : "0"} />
      <PendingSubmitButton variant="ghost" className="h-11 px-2 text-xs md:h-8" idleLabel={label} pendingLabel="…" />
      <ResultLine state={state} />
    </form>
  );
}

/** The session-wide AiSensy report import. */
export function ImportReportForm() {
  const [state, action] = useActionState(importSessionReportAction, IDLE_FIX_ACTION);
  useActionFeedback(state, { successTitle: "Report imported", errorTitle: "Could not import that report" });
  return (
    <form action={action} className="flex flex-col gap-2">
      <div className="space-y-1.5">
        <Label htmlFor="fix-report">AiSensy campaign report (CSV)</Label>
        <Input id="fix-report" name="report" type="file" accept=".csv,text/csv" className="h-11 py-2" />
      </div>
      <PendingSubmitButton variant="outline" className="h-11 w-full md:h-9 md:w-auto" idleLabel="Import report" pendingLabel="Reading…" />
      <ResultLine state={state} />
    </form>
  );
}

/** A send that never heard back: a person checked AiSensy. */
export function StuckForm({ sendIds }: { sendIds: string[] }) {
  const [state, action] = useActionState(resolveStuckAction, IDLE_FIX_ACTION);
  useActionFeedback(state, { successTitle: "Recorded", errorTitle: "Not recorded" });
  return (
    <form action={action} className="flex flex-col gap-2">
      {sendIds.map((id) => (
        <input key={id} type="hidden" name="sendId" value={id} />
      ))}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" name="outcome" value="sent" variant="outline" className="h-11 flex-1 md:h-9 md:flex-none">
          It went
        </Button>
        <Button type="submit" name="outcome" value="failed" variant="accent" className="h-11 flex-1 md:h-9 md:flex-none">
          It didn&apos;t — resend
        </Button>
      </div>
      <ResultLine state={state} />
    </form>
  );
}

/** What the office typed, checked the way every send checks it. */
function PhoneCheck({ value, dead }: { value: string; dead: string | null }) {
  if (!value.trim()) return null;
  const destination = toWhatsappDestination(value);
  if (!destination) {
    return <p className="text-xs font-semibold text-destructive">{explainUnusablePhone(value)}</p>;
  }
  const pretty = `+91 ${destination.slice(3, 8)} ${destination.slice(8)}`;
  return (
    <p className={dead ? "text-xs font-semibold text-warning" : "text-xs font-semibold text-success"}>
      {dead ? `⚠ ${pretty} — ${dead}` : `✓ ${pretty} · valid mobile`}
    </p>
  );
}

/**
 * Fix a family's numbers where the failure is, and resend in the same press.
 *
 * The live check is `toWhatsappDestination` — the function every send runs —
 * so a ✓ here means the sender will take it. A number WhatsApp already rejected
 * is flagged by its last ten digits, and re-entering it needs a tick, so the
 * office vouches for it on purpose rather than by habit.
 */
export function NumberSheet({
  studentId,
  studentName,
  fatherPhone,
  motherPhone,
  siblingIds,
  siblingNames,
  sendIds,
  canResend,
  deadKeys,
  triggerLabel,
  triggerVariant = "accent",
}: {
  studentId: string;
  studentName: string;
  fatherPhone: string | null;
  motherPhone: string | null;
  siblingIds: string[];
  siblingNames: string[];
  /** The failed rows to resend after saving. Empty for a family with no failure yet. */
  sendIds: string[];
  canResend: boolean;
  /** Last-ten-digit keys WhatsApp has rejected, with the reason in words. */
  deadKeys: Record<string, string>;
  triggerLabel: string;
  triggerVariant?: Variant;
}) {
  const [open, setOpen] = useState(false);
  const [father, setFather] = useState(fatherPhone ?? "");
  const [mother, setMother] = useState(motherPhone ?? "");
  const [state, action] = useActionState(saveFamilyNumberAction, IDLE_FIX_ACTION);
  useActionFeedback(state, {
    successTitle: "Saved",
    errorTitle: "Not saved",
    onSuccess: () => setOpen(false),
  });

  const keyOf = (value: string) => {
    const digits = value.replace(/\D/g, "");
    return digits.length >= 10 ? digits.slice(-10) : "";
  };
  const fatherDead = deadKeys[keyOf(father)] ?? null;
  const motherDead = deadKeys[keyOf(mother)] ?? null;
  const fatherOk = !father.trim() || Boolean(toWhatsappDestination(father));
  const motherOk = !mother.trim() || Boolean(toWhatsappDestination(mother));
  const anyNumber = Boolean(toWhatsappDestination(father) || toWhatsappDestination(mother));
  const ready = fatherOk && motherOk && anyNumber;
  const willResend = canResend && sendIds.length > 0;

  return (
    <>
      <Button
        type="button"
        variant={triggerVariant}
        className="h-11 w-full md:h-9 md:w-auto"
        onClick={() => setOpen(true)}
      >
        {triggerLabel}
      </Button>
      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        title={`Numbers for ${studentName}`}
        description="Reminders go to the father's number first, then the mother's."
        size="lg"
      >
        <form action={action} className="flex flex-col gap-4 pb-2">
          <input type="hidden" name="studentId" value={studentId} />
          {sendIds.map((id) => (
            <input key={id} type="hidden" name="sendId" value={id} />
          ))}
          {siblingIds.map((id) => (
            <input key={id} type="hidden" name="siblingId" value={id} />
          ))}
          <input type="hidden" name="resend" value={willResend ? "1" : "0"} />

          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`father-${studentId}`}>Father&apos;s number</Label>
            <Input
              id={`father-${studentId}`}
              name="fatherPhone"
              inputMode="numeric"
              autoComplete="tel-national"
              maxLength={16}
              value={father}
              onChange={(event) => setFather(event.target.value)}
              placeholder="10-digit mobile"
              className="h-12 font-mono text-base tracking-wide"
            />
            <PhoneCheck value={father} dead={fatherDead} />
            {fatherDead ? (
              <label className="flex min-h-11 items-center gap-2 text-xs">
                <input type="checkbox" name="retryFather" value="1" className="h-5 w-5" />
                Try this number again anyway
              </label>
            ) : null}
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`mother-${studentId}`}>Mother&apos;s number</Label>
            <Input
              id={`mother-${studentId}`}
              name="motherPhone"
              inputMode="numeric"
              autoComplete="tel-national"
              maxLength={16}
              value={mother}
              onChange={(event) => setMother(event.target.value)}
              placeholder="Optional"
              className="h-12 font-mono text-base tracking-wide"
            />
            <PhoneCheck value={mother} dead={motherDead} />
            {motherDead ? (
              <label className="flex min-h-11 items-center gap-2 text-xs">
                <input type="checkbox" name="retryMother" value="1" className="h-5 w-5" />
                Try this number again anyway
              </label>
            ) : null}
          </div>

          {siblingIds.length > 0 ? (
            <label className="flex min-h-11 items-center gap-2 rounded-lg bg-surface-2 px-3 text-xs">
              <input type="checkbox" name="applyToSiblings" value="1" defaultChecked className="h-5 w-5" />
              Change it for {siblingNames.join(", ") || "the siblings"} too, where they had the same number
            </label>
          ) : null}

          <PendingSubmitButton
            variant="accent"
            className="h-12 w-full text-sm"
            disabled={!ready}
            idleLabel={willResend ? "Save & resend" : "Save"}
            pendingLabel={willResend ? "Saving and sending…" : "Saving…"}
          />
          {!canResend && sendIds.length > 0 ? (
            <p className="text-xs text-muted-foreground">
              Saving only. An admin can press Resend afterwards.
            </p>
          ) : null}
          <ResultLine state={state} />
        </form>
      </Sheet>
    </>
  );
}
