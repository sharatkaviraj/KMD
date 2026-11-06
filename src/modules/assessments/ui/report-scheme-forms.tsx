"use client";

import { useActionState } from "react";

import { approveReportSchemeAction, saveReportSchemeAction } from "@/app/(app)/assessments/actions";
import * as m from "@/messages/pairs";
import { ms } from "@/messages/setup";
import { idleAssessmentState } from "@/modules/assessments/domain/form-state";
import { primary } from "@/platform/i18n/language";
import { useLanguage } from "@/platform/i18n/use-language";
import { Field, Input, Notice, Select, Textarea } from "@/ui/primitives";
import { Button } from "@/ui/primitives/button";

/**
 * The draft of a term's report scheme (P8). Bands and signature lines are
 * plain text, one per line, because they are typed from a printed circular;
 * the server parses and checks them.
 */
export function ReportSchemeForm({
  term,
  initial,
}: {
  term: string;
  initial: {
    bandsText: string;
    percentDecimals: number;
    passPercent: number | null;
    attendanceFrom: string | null;
    attendanceTo: string | null;
    headerEn: string;
    headerHi: string;
    signatoriesText: string;
  };
}) {
  const language = useLanguage();
  const [state, action, pending] = useActionState(saveReportSchemeAction, idleAssessmentState);

  return (
    <form action={action} className="space-y-4" data-scheme-form>
      <input type="hidden" name="term" value={term} />
      {state.message ? (
        <Notice tone={state.status === "error" ? "danger" : "success"} text={state.message} language={language} />
      ) : null}

      <Field label={ms.schemeBands} htmlFor="scheme-bands" hint={ms.schemeDefaultBands} language={language}>
        <Textarea
          id="scheme-bands"
          name="bandsText"
          rows={8}
          defaultValue={initial.bandsText}
          className="font-mono text-[13px]"
        />
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={ms.schemeDecimals} htmlFor="scheme-decimals" language={language}>
          <Select id="scheme-decimals" name="percentDecimals" defaultValue={String(initial.percentDecimals)}>
            <option value="0">0</option>
            <option value="1">1</option>
            <option value="2">2</option>
          </Select>
        </Field>
        <Field label={ms.schemePass} htmlFor="scheme-pass" language={language}>
          <Input
            id="scheme-pass"
            name="passPercent"
            inputMode="decimal"
            defaultValue={initial.passPercent === null ? "" : String(initial.passPercent)}
          />
        </Field>
        <Field label={ms.schemeAttendanceFrom} htmlFor="scheme-from" language={language}>
          <Input id="scheme-from" name="attendanceFrom" type="date" defaultValue={initial.attendanceFrom ?? ""} />
        </Field>
        <Field label={ms.schemeAttendanceTo} htmlFor="scheme-to" language={language}>
          <Input id="scheme-to" name="attendanceTo" type="date" defaultValue={initial.attendanceTo ?? ""} />
        </Field>
        <Field label={ms.schemeHeaderEn} htmlFor="scheme-header-en" language={language}>
          <Input id="scheme-header-en" name="headerEn" defaultValue={initial.headerEn} />
        </Field>
        <Field label={ms.schemeHeaderHi} htmlFor="scheme-header-hi" language={language}>
          <Input id="scheme-header-hi" name="headerHi" defaultValue={initial.headerHi} />
        </Field>
      </div>

      <Field label={ms.schemeSignatories} htmlFor="scheme-signatories" language={language}>
        <Textarea id="scheme-signatories" name="signatoriesText" rows={3} defaultValue={initial.signatoriesText} />
      </Field>

      <Button type="submit" variant="outline" fullWidth loading={pending} loadingText={primary(m.saving, language)}>
        {primary(ms.schemeSaveDraft, language)}
      </Button>
    </form>
  );
}

/** Approve the draft: final from here, and cards are issued from it. */
export function ApproveSchemeForm({ term }: { term: string }) {
  const language = useLanguage();
  const [state, action, pending] = useActionState(approveReportSchemeAction, idleAssessmentState);
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="term" value={term} />
      {state.message ? (
        <Notice tone={state.status === "error" ? "danger" : "success"} text={state.message} language={language} />
      ) : null}
      <p className="text-[13px] text-muted-foreground">{primary(ms.schemeApproveMeans, language)}</p>
      <Button type="submit" fullWidth loading={pending} loadingText={primary(m.saving, language)}>
        {primary(ms.schemeApprove, language)}
      </Button>
    </form>
  );
}
