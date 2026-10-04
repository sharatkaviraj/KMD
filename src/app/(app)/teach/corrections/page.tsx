import { m } from "@/messages";
import { requirePermission } from "@/platform/auth/current-staff";
import { can } from "@/platform/auth/permissions";
import { dayLabel } from "@/platform/dates";
import { flat, primary } from "@/platform/i18n/language";
import { pageTitle } from "@/platform/i18n/page-title";
import {
  classLabelMap,
  resolveSessionLabel,
} from "@/modules/academics/data/academics-repo";
import { listCorrections } from "@/modules/attendance/data/corrections-repo";
import { classScopeFor } from "@/modules/attendance/data/teaching-repo";
import { scopeIncludes } from "@/modules/attendance/domain/class-scope";
import { attendanceLabels } from "@/modules/attendance/domain/attendance";
import {
  byQueueOrder,
  canDecide,
  correctionStatusLabels,
  pendingCount,
} from "@/modules/attendance/domain/corrections";
import { decideCorrectionAction } from "@/app/(app)/teach/actions";
import { Badge, Card, Notice, Textarea } from "@/ui/primitives";
import { Button } from "@/ui/primitives/button";
import { EmptyState } from "@/ui/states";
import { PageHeader } from "@/ui/page-header-localized";

export const runtime = "nodejs";

export async function generateMetadata() {
  return { title: await pageTitle(m.correctionsTitle) };
}

const STATUS_TONE = {
  pending: "warning",
  approved: "success",
  rejected: "neutral",
} as const;

/**
 * The approval queue.
 *
 * Everybody with `attendance:view` can read it — a teacher should be able to
 * see what happened to their own request without asking. Only somebody with
 * `attendance:correct` gets the buttons, and never on their own request: the
 * whole value of the queue is that a second person looked, and a rubber stamp
 * would be worse than no queue at all because it would look like oversight.
 */
export default async function CorrectionsPage() {
  const staff = await requirePermission("attendance:view", "/teach/corrections");
  const language = staff.language;
  const sessionLabel = await resolveSessionLabel();

  if (!sessionLabel) {
    return (
      <>
        <PageHeader eyebrow={m.eyebrowMyClass} title={m.correctionsTitle} language={language} back={BACK} />
        <EmptyState title={m.noSessionFound} language={language} />
      </>
    );
  }

  const [labels, scope] = await Promise.all([
    classLabelMap(sessionLabel),
    classScopeFor(staff, sessionLabel),
  ]);
  // A teacher sees the requests about her own classes and the ones she made;
  // the office and the coordinators see the whole queue (P1). The database
  // applies the same rule, so this is the page agreeing with it rather than
  // the only guard.
  const corrections = (await listCorrections(sessionLabel, labels))
    .filter(
      (correction) =>
        correction.requestedById === staff.id || scopeIncludes(scope, correction.classId),
    )
    .sort(byQueueOrder);
  const waiting = pendingCount(corrections);

  return (
    <>
      <PageHeader eyebrow={m.eyebrowMyClass}
        title={m.correctionsTitle}
        language={language}
        back={BACK}
        action={
          waiting > 0 ? (
            <Badge tone="warning">
              {waiting} {primary(m.correctionsPending, language)}
            </Badge>
          ) : null
        }
      />

      {corrections.length === 0 ? (
        <EmptyState title={m.correctionsNone} language={language} />
      ) : (
        <ul className="space-y-3">
          {corrections.map((correction) => {
            const verdict = canDecide({
              hasCorrectPermission: can(staff, "attendance:correct"),
              requestedByStaffId: correction.requestedById,
              deciderStaffId: staff.id,
              status: correction.status,
            });

            const isOwn = correction.requestedById === staff.id;

            return (
              <li key={correction.id}>
                <Card className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-[15px] font-semibold text-foreground">
                        {correction.studentName}
                      </p>
                      <p className="truncate text-[13px] text-muted-foreground">
                        {correction.classLabel} ·{" "}
                        {correction.day
                          ? primary(dayLabel(correction.day), language)
                          : "—"}
                      </p>
                    </div>
                    <Badge tone={STATUS_TONE[correction.status]}>
                      {primary(correctionStatusLabels[correction.status], language)}
                    </Badge>
                  </div>

                  <p className="mt-3 flex flex-wrap items-center gap-2 text-[14px]">
                    <span className="text-muted-foreground line-through">
                      {correction.fromStatus
                        ? primary(attendanceLabels[correction.fromStatus], language)
                        : "—"}
                    </span>
                    <span aria-hidden className="text-subtle-foreground">
                      →
                    </span>
                    <span className="font-semibold text-foreground">
                      {primary(attendanceLabels[correction.toStatus], language)}
                    </span>
                  </p>

                  <p className="mt-2 rounded-xl bg-surface-2 px-3 py-2 text-[14px] leading-6 text-foreground">
                    {correction.reason}
                  </p>

                  <p className="mt-2 text-[12px] text-subtle-foreground">
                    {correction.requestedByName} ·{" "}
                    {correction.requestedAt.slice(0, 10)}
                    {correction.decidedByName
                      ? ` · ${flat(m.correctionDecidedBy, language)}: ${correction.decidedByName}`
                      : ""}
                  </p>

                  {correction.decisionNote ? (
                    <p className="mt-1 text-[13px] text-muted-foreground">
                      {correction.decisionNote}
                    </p>
                  ) : null}

                  {correction.status === "pending" && isOwn ? (
                    <Notice
                      className="mt-3"
                      tone="neutral"
                      text={m.correctionOwnRequest}
                      language={language}
                    />
                  ) : null}

                  {verdict.allowed ? (
                    // Two submit buttons on one form: the note is typed once
                    // and belongs to whichever decision is pressed.
                    <form
                      action={decideCorrectionAction}
                      className="mt-3 space-y-2"
                    >
                      <input
                        type="hidden"
                        name="correctionId"
                        value={correction.id}
                      />
                      <Textarea
                        name="decisionNote"
                        rows={2}
                        maxLength={300}
                        aria-label={flat(m.correctionDecisionNote, language)}
                        placeholder={flat(m.correctionDecisionNote, language)}
                        className="min-h-16"
                      />
                      <div className="flex gap-2">
                        <Button
                          type="submit"
                          name="approve"
                          value="true"
                          className="flex-1"
                        >
                          {primary(m.correctionApprove, language)}
                        </Button>
                        <Button
                          type="submit"
                          name="approve"
                          value="false"
                          variant="outline"
                          className="flex-1"
                        >
                          {primary(m.correctionReject, language)}
                        </Button>
                      </div>
                    </form>
                  ) : null}
                </Card>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}

const BACK = { href: "/teach", label: m.teachTitle };
