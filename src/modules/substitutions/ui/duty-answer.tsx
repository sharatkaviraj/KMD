"use client";

import { useActionState, useState } from "react";

import { acknowledgeDutyAction, cannotCoverAction } from "@/app/(app)/duty/[id]/actions";
import { m } from "@/messages";
import { idleSubsState } from "@/modules/substitutions/domain/form-state";
import { primary } from "@/platform/i18n/language";
import { useLanguage } from "@/platform/i18n/use-language";
import { Notice, Textarea } from "@/ui/primitives";
import { Button } from "@/ui/primitives/button";

/**
 * The teacher's two answers, one large button each (P5).
 *
 * "Acknowledge" is the common path and comes first. "I cannot cover" is a
 * second, deliberate step — it opens a short optional note and a confirm —
 * because it pulls in the coordinator, and a mis-tap there is a phone call.
 */
export function DutyAnswer({
  dutyId,
  acknowledged,
  cannotCover,
}: {
  dutyId: string;
  acknowledged: boolean;
  cannotCover: boolean;
}) {
  const language = useLanguage();
  const [ackState, ack, acking] = useActionState(acknowledgeDutyAction, idleSubsState);
  const [refuseState, refuse, refusing] = useActionState(cannotCoverAction, idleSubsState);
  const [declining, setDeclining] = useState(false);

  const isAcknowledged = acknowledged || ackState.status === "saved";
  const isRefused = cannotCover || refuseState.status === "saved";

  return (
    <div className="space-y-3">
      {ackState.status === "error" && ackState.message ? (
        <Notice tone="danger" text={ackState.message} language={language} />
      ) : null}
      {refuseState.status === "error" && refuseState.message ? (
        <Notice tone="danger" text={refuseState.message} language={language} />
      ) : null}

      {isRefused ? (
        <Notice tone="warning" text={m.dutyCannotCoverSent} language={language} />
      ) : isAcknowledged ? (
        <Notice tone="success" text={m.dutyAcknowledged} language={language} />
      ) : (
        <form action={ack}>
          <input type="hidden" name="dutyId" value={dutyId} />
          <Button type="submit" size="lg" fullWidth loading={acking} loadingText={primary(m.saving, language)}>
            {primary(m.dutyAcknowledge, language)}
          </Button>
        </form>
      )}

      {!isRefused ? (
        declining ? (
          <form action={refuse} className="space-y-2">
            <input type="hidden" name="dutyId" value={dutyId} />
            <label htmlFor="cannot-cover-note" className="block text-[13px] font-medium text-muted-foreground">
              {primary(m.dutyCannotCoverNote, language)}
            </label>
            <Textarea id="cannot-cover-note" name="note" rows={2} maxLength={200} />
            <div className="flex flex-wrap gap-2">
              <Button type="submit" variant="outline" loading={refusing} loadingText={primary(m.saving, language)}>
                {primary(m.dutyCannotCover, language)}
              </Button>
              <Button type="button" variant="ghost" onClick={() => setDeclining(false)}>
                {primary(m.cancel, language)}
              </Button>
            </div>
          </form>
        ) : (
          <Button type="button" variant="ghost" fullWidth onClick={() => setDeclining(true)}>
            {primary(m.dutyCannotCover, language)}
          </Button>
        )
      ) : null}

      <p className="text-[12px] leading-5 text-subtle-foreground">{primary(m.dutyAckMeans, language)}</p>
    </div>
  );
}
