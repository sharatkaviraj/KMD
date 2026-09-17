import Link from "next/link";
import { ChevronRight } from "lucide-react";

import { AuthoredText } from "@/ui/authored-text";
import { m } from "@/messages";
import { requirePermission } from "@/platform/auth/current-staff";
import { can } from "@/platform/auth/permissions";
import { dayLabel } from "@/platform/dates";
import { primary, t } from "@/platform/i18n/language";
import { pageTitle } from "@/platform/i18n/page-title";
import {
  classLabelMap,
  resolveSessionLabel,
} from "@/modules/academics/data/academics-repo";
import { listFields } from "@/modules/collection/data/fields-repo";
import { listRequests } from "@/modules/collection/data/requests-repo";
import { pendingSubmissionCount } from "@/modules/collection/data/submissions-repo";
import { activeFields } from "@/modules/collection/domain/fields";
import { requestStatusLabels } from "@/modules/collection/domain/requests";
import { NewRequestForm } from "@/modules/collection/ui/office-forms";
import { listStaff } from "@/modules/staff/data/staff-repo";
import { Badge, Card, Notice, Section } from "@/ui/primitives";
import { buttonClasses } from "@/ui/primitives/button";
import { EmptyState } from "@/ui/states";
import { PageHeader } from "@/ui/shell/app-shell";

export const runtime = "nodejs";

export async function generateMetadata() {
  return { title: await pageTitle(m.collectionTitle) };
}

const STATUS_TONE = {
  draft: "neutral",
  open: "success",
  closed: "neutral",
} as const;

/**
 * The office's side of the token links.
 *
 * A request is built here, sent as one link, and answered by somebody who
 * never signs in. That asymmetry is the whole point of the Sampark merge: the
 * school has forty staff and four accounts, and asking the other thirty-six to
 * remember a password is asking them not to answer.
 */
export default async function CollectionPage() {
  const staff = await requirePermission("collection:view", "/collection");
  const language = staff.language;
  const mayManage = can(staff, "collection:manage");
  const sessionLabel = await resolveSessionLabel();

  if (!sessionLabel) {
    return (
      <>
        <PageHeader title={m.collectionTitle} language={language} />
        <EmptyState title={m.noSessionFound} language={language} />
      </>
    );
  }

  const [requests, fields, labels, everybody, waiting] = await Promise.all([
    listRequests(sessionLabel),
    listFields(),
    classLabelMap(sessionLabel),
    listStaff(),
    pendingSubmissionCount(),
  ]);

  // No sort: `classLabelMap()` is built in school order, and sorting the
  // labels as text is what put Class 10, 11 and 12 between Class 1 and Class 2
  // on four screens (B-06).
  const classes = [...labels.entries()].map(([id, label]) => ({ id, label }));

  const people = everybody
    .filter((person) => person.isActive)
    .map((person) => ({ id: person.id, displayName: person.displayName }))
    .sort((a, b) => a.displayName.localeCompare(b.displayName, "en"));

  return (
    <>
      <PageHeader
        title={m.collectionTitle}
        description={m.collectionIntro}
        language={language}
        action={
          <div className="flex gap-2">
            <Link
              href="/collection/review"
              className={buttonClasses({ variant: "outline", size: "sm" })}
            >
              {primary(m.reviewTitle, language)}
              {waiting > 0 ? <Badge tone="warning">{waiting}</Badge> : null}
            </Link>
          </div>
        }
      />

      <div className="mb-6 flex flex-wrap gap-2">
        <Link
          href="/collection/fields"
          className={buttonClasses({ variant: "outline", size: "sm" })}
        >
          {primary(m.collectionFieldsTitle, language)}
        </Link>
        <Link
          href="/collection/messages"
          className={buttonClasses({ variant: "outline", size: "sm" })}
        >
          {primary(m.messagesTitle, language)}
        </Link>
      </div>

      <Section title={m.collectionTitle} language={language}>
        {requests.length === 0 ? (
          <EmptyState title={m.collectionNone} language={language} />
        ) : (
          <ul className="space-y-2">
            {requests.map((request) => (
              <li key={request.id}>
                <Link
                  href={`/collection/${request.id}`}
                  className="focus-ring flex min-h-16 items-center gap-3 rounded-2xl border border-border bg-surface px-4 py-3 transition-colors hover:bg-surface-2"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[15px] font-semibold text-foreground">
                      <AuthoredText
                        value={{ hi: request.titleHi, en: request.titleEn }}
                        language={language}
                      />
                    </span>
                    <span className="block truncate text-[12px] text-subtle-foreground">
                      {request.classLabel}
                      {request.assignedStaffName
                        ? ` · ${request.assignedStaffName}`
                        : ""}
                      {request.dueDate
                        ? ` · ${primary(dayLabel(request.dueDate), language)}`
                        : ""}
                    </span>
                  </span>
                  <Badge tone={STATUS_TONE[request.status]}>
                    {primary(requestStatusLabels[request.status], language)}
                  </Badge>
                  <ChevronRight
                    aria-hidden
                    className="size-4 shrink-0 text-subtle-foreground"
                  />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Section>

      {mayManage ? (
        <Section className="mt-8" title={m.collectionNew} language={language}>
          {classes.length === 0 ? (
            <Notice
              tone="warning"
              text={t(
                "पहले कक्षाएँ जोड़िए।",
                "There are no classes to ask about yet.",
              )}
              language={language}
            />
          ) : activeFields(fields).length === 0 ? (
            <Notice
              tone="warning"
              text={t(
                "पहले कोई सवाल जोड़िए।",
                "Add something that can be asked for first.",
              )}
              language={language}
            />
          ) : (
            <Card className="p-4">
              <NewRequestForm
                classes={classes}
                staff={people}
                fields={activeFields(fields)}
              />
            </Card>
          )}
        </Section>
      ) : null}
    </>
  );
}
