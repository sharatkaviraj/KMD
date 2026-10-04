"use client";

import { useActionState, useState } from "react";

import {
  approveParentMessageAction,
  confirmParentSentAction,
  flagRouteAction,
} from "@/app/(app)/collection/actions";
import { m } from "@/messages";
import { ms } from "@/messages/setup";
import { idleCollectionState } from "@/modules/collection/domain/form-state";
import { idleParentSendState } from "@/modules/collection/domain/parent-send-state";
import { primary } from "@/platform/i18n/language";
import { useLanguage } from "@/platform/i18n/use-language";
import { Notice, Textarea } from "@/ui/primitives";
import { Button, buttonClasses } from "@/ui/primitives/button";

/**
 * Sending one parent message by hand, the P9 way.
 *
 * "Approve and open WhatsApp" first asks the server whether everything the
 * message rests on still holds; only then does it give the link, which opens
 * the person's own WhatsApp with the text filled in and sends nothing until
 * they press send. "I sent it" records that — and if something changed in
 * between, it still records the send (it happened) and says what changed.
 */
export function ParentSendControls({ id, approved }: { id: string; approved: boolean }) {
  const language = useLanguage();
  const [approval, approve, approving] = useActionState(approveParentMessageAction, idleParentSendState);
  const [confirmation, confirm, confirming] = useActionState(confirmParentSentAction, idleParentSendState);

  if (confirmation.status === "sent") {
    return confirmation.warnings.length > 0 ? (
      <Notice tone="warning" text={ms.messagesSentWarning} language={language}>
        <ul className="mt-1 list-disc pl-5 text-[13px]">
          {confirmation.warnings.map((warning) => (
            <li key={warning.en}>{primary(warning, language)}</li>
          ))}
        </ul>
      </Notice>
    ) : (
      <Notice tone="success" text={ms.messagesSentRecorded} language={language} />
    );
  }

  return (
    <div className="space-y-2" data-parent-send={id}>
      {/* The reasons themselves are on the row, from the database, so they
          are still there after a reload; this says what to do about them. */}
      {approval.status === "stale" ? (
        <p className="text-[13px] text-warning-soft-foreground" data-parent-stale>
          {primary(ms.messagesStaleHint, language)}
        </p>
      ) : null}
      {approval.status === "error" ? <Notice tone="danger" text={approval.message} language={language} /> : null}
      {confirmation.status === "error" ? <Notice tone="danger" text={confirmation.message} language={language} /> : null}
      {approval.status === "approved" ? (
        <Notice tone="success" text={ms.messagesApprovedOpen} language={language} />
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        {approval.status === "approved" ? (
          <a
            href={approval.link}
            target="_blank"
            rel="noreferrer noopener"
            className={buttonClasses({ size: "sm" })}
          >
            {primary(ms.messagesOpenAgain, language)}
          </a>
        ) : approval.status !== "stale" ? (
          <form action={approve}>
            <input type="hidden" name="id" value={id} />
            <Button type="submit" size="sm" loading={approving} loadingText={primary(m.saving, language)}>
              {primary(ms.messagesApproveOpen, language)}
            </Button>
          </form>
        ) : null}

        {approved || approval.status === "approved" ? (
          <form action={confirm}>
            <input type="hidden" name="id" value={id} />
            <Button type="submit" variant="outline" size="sm" loading={confirming} loadingText={primary(m.saving, language)}>
              {primary(ms.messagesConfirmSent, language)}
            </Button>
          </form>
        ) : null}
      </div>
    </div>
  );
}

/** "This number is wrong": stop using it, withdraw what is waiting, tell an administrator. */
export function FlagRouteForm({ phone, studentId }: { phone: string; studentId: string | null }) {
  const language = useLanguage();
  const [open, setOpen] = useState(false);
  const [state, flag, flagging] = useActionState(flagRouteAction, idleCollectionState);

  if (state.status === "saved" && state.message) {
    return <Notice tone="warning" text={state.message} language={language} />;
  }

  return open ? (
    <form action={flag} className="space-y-2" data-flag-route>
      <input type="hidden" name="phone" value={phone} />
      <input type="hidden" name="studentId" value={studentId ?? ""} />
      {state.status === "error" && state.message ? (
        <Notice tone="danger" text={state.message} language={language} />
      ) : null}
      <label htmlFor={`flag-${phone}`} className="block text-[13px] font-medium text-muted-foreground">
        {primary(ms.messagesWrongNumberReason, language)}
      </label>
      <Textarea id={`flag-${phone}`} name="reason" rows={2} maxLength={300} required />
      <div className="flex gap-2">
        <Button type="submit" variant="outline" size="sm" loading={flagging} loadingText={primary(m.saving, language)}>
          {primary(ms.messagesFlagSubmit, language)}
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
          {primary(m.cancel, language)}
        </Button>
      </div>
    </form>
  ) : (
    <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(true)}>
      {primary(ms.messagesWrongNumber, language)}
    </Button>
  );
}
