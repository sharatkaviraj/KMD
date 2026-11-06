"use client";

import { useActionState } from "react";
import Link from "@/ui/link";
import { AlertTriangle, ArrowRight, Check } from "lucide-react";

import {
  checkSheetAction,
  saveDraftAction,
} from "@/app/(app)/timetable/actions";
import {
  idleImportState,
  type ImportState,
} from "@/modules/timetable/domain/import-state";
import * as m from "@/messages/pairs";
import {
  FIX_SCREEN,
  groupByFixScreen,
  MISSING_HINT,
} from "@/modules/timetable/domain/resolve-import";
import { flat, primary } from "@/platform/i18n/language";
import { useLanguage } from "@/platform/i18n/use-language";
import { Badge, Card, Field, Input, Notice, Textarea } from "@/ui/primitives";
import { Button, buttonClasses } from "@/ui/primitives/button";

/**
 * Paste a sheet, see what is missing, save it as a draft.
 *
 * The check is a separate press from the save on purpose: the point of a dry
 * run is to look at it. Saving re-resolves from scratch rather than trusting
 * the checked result, because the whole reason somebody left this screen was
 * to go and change the master data.
 */
export function TimetableImportForm() {
  const language = useLanguage();
  const [state, formAction, isPending] = useActionState<ImportState, FormData>(
    checkSheetAction,
    idleImportState,
  );
  const [saveState, saveAction, isSaving] = useActionState<ImportState, FormData>(
    saveDraftAction,
    idleImportState,
  );

  const report = saveState.report ?? state.report;
  const message = saveState.message ?? state.message;
  const sheet = saveState.sheet || state.sheet;
  const label = saveState.label || state.label;
  const groups = report ? groupByFixScreen(report.missing) : [];

  return (
    <div className="space-y-5">
      <form action={formAction} className="space-y-4">
        <Field label={m.timetableSheetName} htmlFor="label" language={language}>
          <Input
            id="label"
            name="label"
            defaultValue={label}
            placeholder="v11"
            maxLength={60}
            aria-describedby="label-help"
          />
          <p id="label-help" className="text-[13px] leading-5 text-muted-foreground">
            {flat(m.timetableSheetNameHint, language)}
          </p>
        </Field>

        <Field label={m.timetableSheet} htmlFor="sheet" language={language}>
          <Textarea
            id="sheet"
            name="sheet"
            defaultValue={sheet}
            required
            rows={10}
            spellCheck={false}
            className="font-mono text-[13px]"
            aria-describedby="sheet-help"
          />
          <p id="sheet-help" className="text-[13px] leading-5 text-muted-foreground">
            {flat(m.timetableSheetHint, language)}
          </p>
        </Field>

        {message ? <Notice tone="danger" text={message} language={language} /> : null}

        <Button
          type="submit"
          loading={isPending}
          loadingText={primary(m.timetableChecking, language)}
          fullWidth
        >
          {primary(m.timetableCheck, language)}
        </Button>
      </form>

      {report ? (
        <section className="space-y-3">
          <Notice
            tone={report.canPublish ? "success" : "warning"}
            text={report.canPublish ? m.timetableReady : m.timetableBlocked}
            language={language}
          />

          <Card className="p-4">
            <ul className="grid grid-cols-2 gap-3 text-[14px] sm:grid-cols-4">
              <li>
                <span className="block text-[12px] text-muted-foreground">
                  {primary(m.timetableCells, language)}
                </span>
                <span className="text-[18px] font-semibold tabular-nums">
                  {report.counts.cells}
                </span>
              </li>
              <li>
                <span className="block text-[12px] text-muted-foreground">
                  {primary(m.timetableSlots, language)}
                </span>
                <span className="text-[18px] font-semibold tabular-nums">
                  {report.counts.resolved}
                </span>
              </li>
              <li>
                <span className="block text-[12px] text-muted-foreground">
                  {primary(m.pending, language)}
                </span>
                <span
                  className={`text-[18px] font-semibold tabular-nums ${
                    report.counts.unresolved > 0 ? "text-destructive" : ""
                  }`}
                >
                  {report.counts.unresolved}
                </span>
              </li>
              <li>
                <span className="block text-[12px] text-muted-foreground">
                  {primary(m.timetableProblems, language)}
                </span>
                <span
                  className={`text-[18px] font-semibold tabular-nums ${
                    report.problems.length > 0 ? "text-destructive" : ""
                  }`}
                >
                  {report.problems.length}
                </span>
              </li>
            </ul>
          </Card>

          {/* Grouped by the screen that fixes it — "Anjana is not a teacher"
              is not actionable; "add Anjana on the Staff screen" is. */}
          {groups.map(({ kind, items }) => (
            <Card key={kind} className="p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[14px] font-semibold text-foreground">
                    {flat(MISSING_HINT[kind], language)}
                  </p>
                </div>
                <Badge tone="warning">{items.length}</Badge>
              </div>

              <ul className="mt-3 space-y-1.5">
                {items.map((item) => (
                  <li key={`${item.kind}:${item.name}`} className="text-[13px]">
                    <span className="font-medium text-foreground">{item.name}</span>
                    <span className="ml-2 text-muted-foreground">
                      {item.cells} {primary(m.timetableCells, language)}
                    </span>
                    <span className="block text-[12px] text-subtle-foreground">
                      {item.examples.join(" · ")}
                    </span>
                  </li>
                ))}
              </ul>

              <Link
                href={FIX_SCREEN[kind].href}
                className={buttonClasses({
                  variant: "outline",
                  size: "sm",
                  className: "mt-3",
                })}
              >
                {primary(m.timetableFixOn, language)}{" "}
                {primary(FIX_SCREEN[kind].label, language)}
                <ArrowRight aria-hidden />
              </Link>
            </Card>
          ))}

          {report.problems.length > 0 ? (
            <Card className="p-4">
              <div className="flex items-start gap-2">
                <AlertTriangle
                  aria-hidden
                  className="mt-0.5 size-4 shrink-0 text-destructive"
                />
                <p className="text-[14px] font-semibold text-foreground">
                  {flat(m.timetableProblems, language)}
                </p>
              </div>
              <ul className="mt-2 space-y-1">
                {report.problems.slice(0, 20).map((problem, index) => (
                  <li key={index} className="text-[13px] text-muted-foreground">
                    <span className="font-mono text-[12px]">L{problem.line}</span>{" "}
                    {problem.kind} — {problem.detail}
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}

          {report.canPublish ? (
            <form action={saveAction}>
              <input type="hidden" name="sheet" value={sheet} />
              <input type="hidden" name="label" value={label} />
              <Button
                type="submit"
                variant="accent"
                fullWidth
                loading={isSaving}
                loadingText={primary(m.saving, language)}
              >
                <Check aria-hidden />
                {primary(m.timetableSaveDraft, language)}
              </Button>
            </form>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
