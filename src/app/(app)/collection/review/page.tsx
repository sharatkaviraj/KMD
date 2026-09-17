import { TriangleAlert } from "lucide-react";

import { m } from "@/messages";
import { requirePermission } from "@/platform/auth/current-staff";
import { can } from "@/platform/auth/permissions";
import { primary } from "@/platform/i18n/language";
import { pageTitle } from "@/platform/i18n/page-title";
import { listFields } from "@/modules/collection/data/fields-repo";
import {
  listSubmissions,
  phoneOwners,
} from "@/modules/collection/data/submissions-repo";
import {
  byReviewOrder,
  sharedPhoneCount,
  splitByChange,
} from "@/modules/collection/domain/review";
import { stalenessOf } from "@/modules/collection/domain/precedence";
import { cn } from "@/platform/utils";
import { DecideForm } from "@/modules/collection/ui/office-forms";
import { Badge, Card, Notice, Section } from "@/ui/primitives";
import { EmptyState } from "@/ui/states";
import { PageHeader } from "@/ui/shell/app-shell";

export const runtime = "nodejs";

export async function generateMetadata() {
  return { title: await pageTitle(m.reviewTitle) };
}

/**
 * The queue the office works down.
 *
 * Split in two, because the two halves need completely different attention:
 *
 *  - **changes** — somebody typed something new. Each is read and decided.
 *  - **confirmations** — a teacher looked at a row and said it was already
 *    right. That is a real and useful answer, but it is not a change, and a
 *    queue that made somebody approve four hundred of them one at a time is a
 *    queue nobody finishes. They are accepted together.
 *
 * A repeated phone number carries a neutral count and never a warning.
 * Siblings share a parent's number; the office is the one who can tell two
 * siblings from a mistyped digit, and the teacher is never shown it at all.
 */
export default async function ReviewPage() {
  const staff = await requirePermission("collection:view", "/collection/review");
  const language = staff.language;
  const mayDecide = can(staff, "collection:manage");

  const [submissions, fields, owners] = await Promise.all([
    listSubmissions("pending"),
    listFields(),
    phoneOwners(),
  ]);

  const byId = new Map(fields.map((field) => [field.id, field]));
  const { changes, confirmations } = splitByChange(
    [...submissions].sort(byReviewOrder),
  );

  return (
    <>
      <PageHeader
        title={m.reviewTitle}
        language={language}
        back={BACK}
        action={
          submissions.length > 0 ? (
            <Badge tone="warning">{submissions.length}</Badge>
          ) : null
        }
      />

      {submissions.length === 0 ? (
        <EmptyState title={m.reviewNone} language={language} />
      ) : null}

      {/* -------------------------------------------- the confirmations */}

      {confirmations.length > 0 ? (
        <Section title={m.reviewConfirmations} language={language}>
          <Card className="p-4">
            <p className="mb-3 text-[13px] leading-5 text-muted-foreground">
              {primary(m.reviewConfirmationsHint, language)}
            </p>

            <ul className="mb-3 space-y-1">
              {confirmations.slice(0, 12).map((entry) => (
                <li
                  key={entry.id}
                  className="truncate text-[13px] text-subtle-foreground"
                >
                  {entry.studentName} ·{" "}
                  {language === "en" ? entry.fieldLabelEn : entry.fieldLabelHi}
                </li>
              ))}
              {confirmations.length > 12 ? (
                <li className="text-[13px] text-subtle-foreground">
                  + {confirmations.length - 12}
                </li>
              ) : null}
            </ul>

            {mayDecide ? (
              <DecideForm
                submissionIds={confirmations.map((entry) => entry.id)}
                accept
                label={m.reviewAcceptAll}
              />
            ) : null}
          </Card>
        </Section>
      ) : null}

      {/* -------------------------------------------------- the changes */}

      {changes.length > 0 ? (
        <Section className="mt-8" title={m.reviewChanges} language={language}>
          <ul className="space-y-3">
            {changes.map((entry) => {
              const field = byId.get(entry.fieldId);
              const shared = field
                ? sharedPhoneCount(entry.value, field, owners, entry.studentId)
                : 0;

              return (
                <li key={entry.id}>
                  <Card className={cn("p-4", entry.isSuperseded && "opacity-60")}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-[15px] font-semibold text-foreground">
                          {entry.studentName}
                        </p>
                        <p className="truncate text-[12px] text-subtle-foreground">
                          {entry.audienceLabel} ·{" "}
                          {language === "en"
                            ? entry.requestTitleEn
                            : entry.requestTitleHi}
                        </p>
                      </div>
                      {entry.submittedByName ? (
                        <Badge tone="neutral">{entry.submittedByName}</Badge>
                      ) : null}
                    </div>

                    <p className="mt-3 text-[13px] text-muted-foreground">
                      {language === "en" ? entry.fieldLabelEn : entry.fieldLabelHi}
                    </p>

                    <p className="mt-1 flex flex-wrap items-center gap-2 text-[15px]">
                      <span className="text-muted-foreground line-through">
                        {entry.previousValue || "—"}
                      </span>
                      <span aria-hidden className="text-subtle-foreground">
                        →
                      </span>
                      <span className="font-semibold text-foreground">
                        {entry.value || "—"}
                      </span>
                    </p>

                    {/* **The record moved after she answered** (S-07).
                        Accepting this would quietly revert whoever moved it,
                        so both values are shown and nothing is refused. */}
                    {stalenessOf({
                      shown: entry.previousValue,
                      heldNow: entry.heldNow,
                    }).stale && entry.status === "pending" ? (
                      <p className="mt-2 flex flex-wrap items-center gap-1.5 text-[12px] text-warning">
                        <TriangleAlert aria-hidden className="size-3.5 shrink-0" />
                        {primary(m.reviewStale, language)}
                        <span className="text-subtle-foreground">
                          · {entry.heldNow || "—"} {primary(m.reviewStaleNow, language)}
                        </span>
                      </p>
                    ) : null}

                    {/* Greyed rather than hidden: "what did she say in April"
                        is a real question when June's answer looks wrong. */}
                    {entry.isSuperseded ? (
                      <p className="mt-2 text-[12px] text-subtle-foreground">
                        {primary(m.reviewSuperseded, language)} ·{" "}
                        {primary(m.reviewSupersededHint, language)}
                      </p>
                    ) : null}

                    {shared > 0 ? (
                      // Neutral, never a warning. Siblings share a number, and
                      // refusing the correct answer would teach a teacher that
                      // the screen is wrong about her own class.
                      <p className="mt-2 text-[12px] text-subtle-foreground">
                        {shared} {primary(m.reviewSharedPhone, language)} ·{" "}
                        {primary(m.reviewSharedPhoneHint, language)}
                      </p>
                    ) : null}

                    {field?.feeColumn ? (
                      <p className="mt-2 text-[12px] text-subtle-foreground">
                        {primary(m.reviewFeeAppDiffers, language)}
                      </p>
                    ) : null}

                    {mayDecide ? (
                      <div className="mt-3 flex gap-2">
                        <DecideForm
                          submissionIds={[entry.id]}
                          accept
                          label={m.reviewAccept}
                        />
                        <DecideForm
                          submissionIds={[entry.id]}
                          accept={false}
                          label={m.reviewReject}
                          variant="outline"
                        />
                      </div>
                    ) : null}
                  </Card>
                </li>
              );
            })}
          </ul>
        </Section>
      ) : null}

      {submissions.length > 0 ? (
        <Notice
          className="mt-8"
          tone="neutral"
          text={m.reviewFeeAppDiffers}
          language={language}
        />
      ) : null}
    </>
  );
}

const BACK = { href: "/collection", label: m.collectionTitle };
