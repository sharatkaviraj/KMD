"use client";

import { useState } from "react";
import { Trash2 } from "lucide-react";

import { deleteDocumentAction } from "@/app/(app)/collection/actions";
import * as m from "@/messages/pairs";
import { documentMessages as dm } from "@/messages/setup";
import { primary } from "@/platform/i18n/language";
import { useLanguage } from "@/platform/i18n/use-language";
import { Button } from "@/ui/primitives/button";

/**
 * Remove one document, after asking. One tap used to remove it; a slip of
 * the thumb next to Open should not take a birth certificate off the list.
 */
export function RemoveDocument({ documentId, studentId }: { documentId: string; studentId: string }) {
  const language = useLanguage();
  const [asking, setAsking] = useState(false);

  if (!asking) {
    return (
      <button
        type="button"
        onClick={() => setAsking(true)}
        aria-label={primary(m.documentsRemove, language)}
        className="focus-ring grid size-11 shrink-0 place-items-center rounded-lg text-subtle-foreground hover:bg-destructive-soft hover:text-destructive-soft-foreground"
      >
        <Trash2 aria-hidden className="size-5" />
      </button>
    );
  }

  return (
    <form action={deleteDocumentAction} className="flex w-full flex-wrap items-center gap-2 border-t border-border pt-2">
      <input type="hidden" name="id" value={documentId} />
      <input type="hidden" name="studentId" value={studentId} />
      <span className="flex-1 text-[14px] font-medium text-foreground">{primary(dm.docRemoveAsk, language)}</span>
      <Button type="button" variant="outline" size="sm" onClick={() => setAsking(false)}>
        {primary(dm.docRemoveNo, language)}
      </Button>
      <Button type="submit" variant="destructive" size="sm">
        {primary(dm.docRemoveYes, language)}
      </Button>
    </form>
  );
}
