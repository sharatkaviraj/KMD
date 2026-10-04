"use client";

import { useActionState, useState } from "react";
import { Download } from "lucide-react";

import {
  issueReportCardAction,
  logExportAction,
  saveAssessmentAction,
  savePaperAction,
} from "@/app/(app)/assessments/actions";
import { m } from "@/messages";
import { ms } from "@/messages/setup";
import {
  assessmentKindLabels,
  assessmentKinds,
  type Assessment,
} from "@/modules/assessments/domain/assessments";
import { idleAssessmentState } from "@/modules/assessments/domain/form-state";
import { exportFileName } from "@/modules/assessments/domain/report-card";
import { primary } from "@/platform/i18n/language";
import { useLanguage } from "@/platform/i18n/use-language";
import { Field, Input, Notice, Select, Textarea } from "@/ui/primitives";
import { Button } from "@/ui/primitives/button";

/** One exam: a term, a code, and how much it counts. */
export function AssessmentForm({ assessment }: { assessment?: Assessment }) {
  const language = useLanguage();
  const [state, action, pending] = useActionState(
    saveAssessmentAction,
    idleAssessmentState,
  );
  const id = assessment?.id ?? "new";

  return (
    <form action={action} className="space-y-3">
      {state.status === "error" && state.message ? (
        <Notice tone="danger" text={state.message} language={language} />
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={m.assessmentTerm} htmlFor={`term-${id}`} language={language}>
          <Input
            id={`term-${id}`}
            name="term"
            required
            maxLength={80}
            defaultValue={assessment?.term ?? ""}
            readOnly={Boolean(assessment)}
          />
        </Field>
        <Field label={m.assessmentCode} htmlFor={`code-${id}`} language={language}>
          <Input
            id={`code-${id}`}
            name="code"
            required
            maxLength={20}
            defaultValue={assessment?.code ?? ""}
            readOnly={Boolean(assessment)}
          />
        </Field>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={m.name} htmlFor={`al-en-${id}`} language={language}>
          <Input
            id={`al-en-${id}`}
            name="labelEn"
            required
            maxLength={80}
            defaultValue={assessment?.labelEn ?? ""}
          />
        </Field>
        <Field label={m.languageHindi} htmlFor={`al-hi-${id}`} language={language}>
          <Input
            id={`al-hi-${id}`}
            name="labelHi"
            required
            maxLength={80}
            defaultValue={assessment?.labelHi ?? ""}
          />
        </Field>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={m.assessmentKind} htmlFor={`kind-${id}`} language={language}>
          <Select
            id={`kind-${id}`}
            name="kind"
            defaultValue={assessment?.kind ?? "summative"}
          >
            {assessmentKinds.map((kind) => (
              <option key={kind} value={kind}>
                {primary(assessmentKindLabels[kind], language)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={m.assessmentWeight} htmlFor={`w-${id}`} language={language}>
          <Input
            id={`w-${id}`}
            name="weight"
            type="number"
            inputMode="decimal"
            step="0.1"
            min={0}
            max={10}
            defaultValue={assessment?.weight ?? 1}
          />
        </Field>
      </div>

      <p className="-mt-1 text-[12px] text-subtle-foreground">
        {primary(m.assessmentWeightHint, language)}
      </p>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={m.assessmentStarts} htmlFor={`s-${id}`} language={language}>
          <Input
            id={`s-${id}`}
            name="startsOn"
            type="date"
            defaultValue={assessment?.startsOn ?? ""}
          />
        </Field>
        <Field label={m.assessmentEnds} htmlFor={`e-${id}`} language={language}>
          <Input
            id={`e-${id}`}
            name="endsOn"
            type="date"
            defaultValue={assessment?.endsOn ?? ""}
          />
        </Field>
      </div>

      <Button
        type="submit"
        variant={assessment ? "outline" : "primary"}
        fullWidth
        loading={pending}
        loadingText={primary(m.saving, language)}
      >
        {primary(
          state.status === "saved" ? m.saved : assessment ? m.save : m.assessmentNew,
          language,
        )}
      </Button>
    </form>
  );
}

/** One paper: a class, a subject, and what it is out of. */
export function PaperForm({
  assessmentId,
  classes,
  subjects,
}: {
  assessmentId: string;
  classes: { id: string; label: string }[];
  subjects: { id: string; code: string; nameEn: string }[];
}) {
  const language = useLanguage();
  const [state, action, pending] = useActionState(savePaperAction, idleAssessmentState);

  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="assessmentId" value={assessmentId} />

      {state.status === "error" && state.message ? (
        <Notice tone="danger" text={state.message} language={language} />
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={m.teachClassTitle} htmlFor="p-class" language={language}>
          <Select id="p-class" name="classId" required defaultValue="">
            <option value="">—</option>
            {classes.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.label}
              </option>
            ))}
          </Select>
        </Field>

        <Field label={m.paperSubject} htmlFor="p-subject" language={language}>
          <Select id="p-subject" name="subjectId" required defaultValue="">
            <option value="">—</option>
            {subjects.map((subject) => (
              <option key={subject.id} value={subject.id}>
                {subject.code} — {subject.nameEn}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Field label={m.paperMax} htmlFor="p-max" language={language}>
          <Input
            id="p-max"
            name="maxMarks"
            type="number"
            inputMode="decimal"
            required
            min={1}
            max={1000}
            defaultValue={100}
          />
        </Field>
        <Field label={m.paperPass} htmlFor="p-pass" language={language}>
          <Input id="p-pass" name="passMarks" type="number" inputMode="decimal" min={0} />
        </Field>
        <Field label={m.sortOrder} htmlFor="p-sort" language={language}>
          <Input
            id="p-sort"
            name="sortOrder"
            type="number"
            inputMode="numeric"
            min={0}
            defaultValue={0}
          />
        </Field>
        {/* The paper's scheme (P7): the smallest part of a mark it gives, and
            whether a child may be excused from it rather than marked. */}
        <Field label={m.paperMarkStep} htmlFor="p-step" language={language}>
          <Select id="p-step" name="markStep" defaultValue="0.5">
            <option value="1">{primary(m.paperMarkStepWhole, language)}</option>
            <option value="0.5">{primary(m.paperMarkStepHalf, language)}</option>
            <option value="0.25">{primary(m.paperMarkStepQuarter, language)}</option>
          </Select>
        </Field>
        <label className="flex min-h-11 items-center gap-2 text-[14px] text-foreground sm:col-span-2">
          <input type="checkbox" name="allowExempt" defaultChecked className="size-4" />
          {primary(m.paperAllowExempt, language)}
        </label>
      </div>

      <Button
        type="submit"
        variant="outline"
        fullWidth
        loading={pending}
        loadingText={primary(m.saving, language)}
      >
        {primary(m.paperAdd, language)}
      </Button>
    </form>
  );
}

/** Freeze a report card as it currently reads. */
/**
 * Issue a card, or reissue it with a reason (P8).
 *
 * The submission id is minted once per form — the page draws a new form, with
 * a new id, once a revision lands — so pressing twice, or retrying after an
 * answer that never came, cannot issue twice. A reissue asks why: the earlier
 * card is kept, and the reason is what tells a parent's question apart from a
 * typo.
 */
export function IssueReportForm({
  studentId,
  term,
  expectedRevision,
}: {
  studentId: string;
  term: string;
  expectedRevision: number;
}) {
  const language = useLanguage();
  const [state, action, pending] = useActionState(
    issueReportCardAction,
    idleAssessmentState,
  );
  const [commandId] = useState(() =>
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : "10000000-1000-4000-8000-100000000000".replace(/[018]/g, (c) =>
          (Number(c) ^ (Math.random() * 16) >> (Number(c) / 4)).toString(16),
        ),
  );
  const alreadyIssued = expectedRevision > 0;

  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="studentId" value={studentId} />
      <input type="hidden" name="term" value={term} />
      <input type="hidden" name="commandId" value={commandId} />
      <input type="hidden" name="expectedRevision" value={expectedRevision} />

      {alreadyIssued ? (
        <>
          <label htmlFor="reissue-reason" className="block text-[13px] font-medium text-muted-foreground">
            {primary(ms.reportReissueReason, language)}
          </label>
          <Textarea id="reissue-reason" name="reason" rows={2} maxLength={300} required />
        </>
      ) : null}

      {state.message ? (
        <Notice
          tone={state.status === "error" ? "danger" : "success"}
          text={state.message}
          language={language}
        />
      ) : null}

      <Button
        type="submit"
        fullWidth
        loading={pending}
        loadingText={primary(m.saving, language)}
      >
        {primary(alreadyIssued ? m.reportReissue : m.reportIssue, language)}
      </Button>
    </form>
  );
}

/**
 * Take a CSV, and tell the server it was taken.
 *
 * The file is built in the browser from data already on the page — there is no
 * second query and no URL anybody could share. What reaches the server is the
 * log row, which is the whole of what PLAN 6.5 asks for.
 */
export function ExportButton({
  csv,
  kind,
  scope,
  rowCount,
  day,
}: {
  csv: string;
  kind: "marks" | "attendance" | "report_cards";
  scope: string;
  rowCount: number;
  day: string;
}) {
  const language = useLanguage();

  return (
    <form action={logExportAction}>
      <input type="hidden" name="kind" value={kind} />
      <input type="hidden" name="scope" value={scope} />
      <input type="hidden" name="rowCount" value={rowCount} />

      <Button
        type="submit"
        variant="outline"
        size="sm"
        onClick={() => {
          const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
          const url = URL.createObjectURL(blob);
          const anchor = document.createElement("a");
          anchor.href = url;
          anchor.download = exportFileName(kind, scope, day);
          anchor.click();
          // Released on the next tick: revoking synchronously can cancel the
          // download in Safari before it has read the blob.
          window.setTimeout(() => URL.revokeObjectURL(url), 1000);
        }}
      >
        <Download aria-hidden />
        {primary(m.exportMarks, language)}
      </Button>
    </form>
  );
}
