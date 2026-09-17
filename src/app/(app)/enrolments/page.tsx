import { m } from "@/messages";
import { requirePermission } from "@/platform/auth/current-staff";
import { can } from "@/platform/auth/permissions";
import { pageTitle } from "@/platform/i18n/page-title";
import { flat, primary, t } from "@/platform/i18n/language";
import {
  listFeeClasses,
  resolveSessionLabel,
} from "@/modules/academics/data/academics-repo";
import { feeClassName } from "@/modules/academics/domain/subjects";
import {
  listEnrolments,
  listFeeStudents,
} from "@/modules/enrolments/data/enrolments-repo";
import {
  differenceIsFixedByRebuild,
  differenceLabels,
  fixableCount,
  groupDifferences,
  reconcile,
  rollByClass,
} from "@/modules/enrolments/domain/enrolments";
import { rebuildEnrolmentsAction } from "@/app/(app)/enrolments/actions";
import { Badge, Card, Notice } from "@/ui/primitives";
import { Button } from "@/ui/primitives/button";
import { EmptyState } from "@/ui/states";
import { PageHeader } from "@/ui/shell/app-shell";

export const runtime = "nodejs";

export async function generateMetadata() {
  return { title: await pageTitle(m.enrolmentsTitle) };
}

/**
 * The academic record, and the check that keeps it honest.
 *
 * Nothing in the database enforces the relationship — rule 2 forbids a foreign
 * key into `public` — so this page is the enforcement: it compares the two
 * sides every time it loads and says what differs. It reports rather than
 * fixes, because a rebuild takes the fee app's word for every difference and
 * that is a decision the office should make on purpose.
 */
export default async function EnrolmentsPage() {
  const staff = await requirePermission("academics:view", "/enrolments");
  const language = staff.language;
  const sessionLabel = await resolveSessionLabel();

  if (!sessionLabel) {
    return (
      <>
        <PageHeader eyebrow={m.eyebrowAcademics} title={m.enrolmentsTitle} language={language} />
        <EmptyState title={m.classLabelsNothing} language={language} />
      </>
    );
  }

  const [classes, feeStudents, enrolments] = await Promise.all([
    listFeeClasses(sessionLabel),
    listFeeStudents(sessionLabel),
    listEnrolments(sessionLabel),
  ]);

  const check = reconcile(feeStudents, enrolments);
  const groups = groupDifferences(check.differences);
  const fixable = fixableCount(check.differences);
  const roll = rollByClass(classes, enrolments);
  const mayManage = can(staff, "academics:manage");
  const classNames = new Map(classes.map((entry) => [entry.id, feeClassName(entry)]));

  return (
    <>
      <PageHeader eyebrow={m.eyebrowAcademics}
        title={m.enrolmentsTitle}
        description={t(
          `${m.session.hi} ${sessionLabel} — ${enrolments.length} / ${feeStudents.length} ${m.enrolmentsStudents.hi}`,
          `${m.session.en} ${sessionLabel} — ${enrolments.length} / ${feeStudents.length} ${m.enrolmentsStudents.en}`,
        )}
        language={language}
      />

      <Notice className="mb-4" tone="info" text={m.enrolmentsIntro} language={language} />

      {enrolments.length === 0 ? (
        <EmptyState
          title={m.enrolmentsNone}
          language={language}
          action={
            mayManage ? (
              <form action={rebuildEnrolmentsAction}>
                <Button type="submit">{primary(m.enrolmentsBuild, language)}</Button>
              </form>
            ) : null
          }
        />
      ) : (
        <>
          <Notice
            className="mb-4"
            tone={check.differences.length === 0 ? "success" : "warning"}
            text={
              check.differences.length === 0
                ? m.enrolmentsAllMatch
                : t(
                    `${check.differences.length} अंतर मिले · ${check.inAgreement} ${m.enrolmentsInAgreement.hi}`,
                    `${check.differences.length} difference(s) · ${check.inAgreement} ${m.enrolmentsInAgreement.en}`,
                  )
            }
            language={language}
          />

          {groups.length > 0 ? (
            <section className="mb-5 space-y-3">
              <h2 className="text-[15px] font-semibold text-foreground">
                {flat(m.enrolmentsCheck, language)}
              </h2>

              {groups.map(({ kind, items }) => (
                <Card key={kind} className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <p className="text-[14px] font-semibold text-foreground">
                      {flat(differenceLabels[kind], language)}
                    </p>
                    <Badge tone={differenceIsFixedByRebuild[kind] ? "info" : "danger"}>
                      {items.length}
                    </Badge>
                  </div>

                  {!differenceIsFixedByRebuild[kind] ? (
                    <p className="mt-1.5 text-[13px] leading-5 text-muted-foreground">
                      {flat(m.enrolmentsNeedsPerson, language)}
                    </p>
                  ) : null}

                  <ul className="mt-2 space-y-1">
                    {items.slice(0, 8).map((item) => (
                      <li
                        key={item.studentId}
                        className="text-[13px] text-muted-foreground"
                      >
                        <span className="font-medium text-foreground">
                          {item.studentName}
                        </span>
                        {item.admissionNo ? (
                          <span className="ml-1.5 font-mono text-[12px] opacity-70">
                            {item.admissionNo}
                          </span>
                        ) : null}
                        {item.detail ? (
                          <span className="ml-1.5">
                            {classNames.get(item.detail.from ?? "") ??
                              item.detail.from ??
                              "—"}
                            {" → "}
                            {classNames.get(item.detail.to ?? "") ??
                              item.detail.to ??
                              "—"}
                          </span>
                        ) : null}
                      </li>
                    ))}
                    {items.length > 8 ? (
                      <li className="text-[13px] text-subtle-foreground">
                        + {items.length - 8}
                      </li>
                    ) : null}
                  </ul>
                </Card>
              ))}

              {mayManage && fixable > 0 ? (
                <form action={rebuildEnrolmentsAction} className="space-y-2">
                  <Button type="submit" variant="outline" fullWidth>
                    {primary(m.enrolmentsRebuild, language)}
                  </Button>
                  <p className="text-center text-[13px] text-muted-foreground">
                    {fixable} {flat(m.enrolmentsFixable, language)} ·{" "}
                    {flat(m.enrolmentsRebuildHint, language)}
                  </p>
                </form>
              ) : null}
            </section>
          ) : null}

          <section className="space-y-2">
            <h2 className="text-[15px] font-semibold text-foreground">
              {flat(m.enrolmentsRoll, language)}
            </h2>
            <ul className="space-y-1.5">
              {roll.map(({ feeClass, enrolled }) => (
                <li
                  key={feeClass.id}
                  className="flex items-center justify-between gap-3 rounded-xl border border-border bg-surface px-4 py-3"
                >
                  <span className="min-w-0 truncate text-[15px] text-foreground">
                    {feeClassName(feeClass)}
                  </span>
                  <span className="shrink-0 text-[15px] font-semibold tabular-nums text-foreground">
                    {enrolled}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        </>
      )}
    </>
  );
}
