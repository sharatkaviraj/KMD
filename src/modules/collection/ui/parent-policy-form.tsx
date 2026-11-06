"use client";

import { useActionState, useState } from "react";

import { saveParentPolicyAction } from "@/app/(app)/collection/actions";
import * as m from "@/messages/pairs";
import { ms } from "@/messages/setup";
import { idleCollectionState } from "@/modules/collection/domain/form-state";
import type { ParentPolicy } from "@/modules/collection/domain/parent-policy";
import { primary } from "@/platform/i18n/language";
import { useLanguage } from "@/platform/i18n/use-language";
import { Field, Input, Notice } from "@/ui/primitives";
import { Button } from "@/ui/primitives/button";

/**
 * One category's policy (P9). Approval is on by default; turning it off opens
 * the four fields an automatic exception must name, and the server refuses it
 * unless all four are filled.
 */
export function ParentPolicyForm({ policy }: { policy: ParentPolicy }) {
  const language = useLanguage();
  const [state, save, saving] = useActionState(saveParentPolicyAction, idleCollectionState);
  const [approval, setApproval] = useState(policy.approvalRequired);
  const field = (name: string) => `${policy.category}-${name}`;

  return (
    <form action={save} className="space-y-3" data-policy={policy.category}>
      <input type="hidden" name="category" value={policy.category} />
      {state.message ? (
        <Notice tone={state.status === "error" ? "danger" : "success"} text={state.message} language={language} />
      ) : null}
      <label className="flex min-h-11 items-center gap-2 text-[14px] font-medium text-foreground">
        <input
          type="checkbox"
          name="approvalRequired"
          checked={approval}
          onChange={(event) => setApproval(event.target.checked)}
          className="size-4"
        />
        {primary(ms.policyApprovalRequired, language)}
      </label>
      {!approval ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={ms.policyRecipients} htmlFor={field("recipients")} language={language}>
            <Input id={field("recipients")} name="autoRecipients" defaultValue={policy.autoRecipients ?? ""} required />
          </Field>
          <Field label={ms.policyTrigger} htmlFor={field("trigger")} language={language}>
            <Input id={field("trigger")} name="autoTrigger" defaultValue={policy.autoTrigger ?? ""} required />
          </Field>
          <Field label={ms.policyContent} htmlFor={field("content")} language={language}>
            <Input id={field("content")} name="autoContent" defaultValue={policy.autoContent ?? ""} required />
          </Field>
          <Field label={ms.policyCorrection} htmlFor={field("correction")} language={language}>
            <Input id={field("correction")} name="autoCorrection" defaultValue={policy.autoCorrection ?? ""} required />
          </Field>
        </div>
      ) : null}
      <Button type="submit" variant="outline" size="sm" loading={saving} loadingText={primary(m.saving, language)}>
        {primary(m.save, language)}
      </Button>
    </form>
  );
}
