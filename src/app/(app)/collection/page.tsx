import Link from "next/link";
import { MessageSquare } from "lucide-react";

import { AuthoredText } from "@/ui/authored-text";
import * as m from "@/messages/pairs";
import { ms } from "@/messages/setup";
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
import { Panel, PanelRow } from "@/ui/panel";
import { Badge, Card, Notice, Section } from "@/ui/primitives";
import { buttonClasses } from "@/ui/primitives/button";
import { EmptyState } from "@/ui/states";
import { PageHeader } from "@/ui/page-header-localized";

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
        <PageHeader eyebrow={m.eyebrowSampark} title={m.collectionTitle} language={language} />
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
        eyebrow={m.eyebrowSampark}
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
        {/* First, because a round is the thing the office reaches for when the
            answer is "every class" — which it usually is. One request is the
            exception, and it is still right here underneath. */}
        <Link
          href="/collection/rounds"
          className={buttonClasses({ variant: "outline", size: "sm" })}
        >
          {primary(m.roundsTitle, language)}
        </Link>
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
        {mayManage ? (
          <>
            <Link
              href="/collection/photos"
              className={buttonClasses({ variant: "outline", size: "sm" })}
            >
              {primary(ms.photoTitle, language)}
            </Link>
            <Link
              href="/collection/import"
              className={buttonClasses({ variant: "outline", size: "sm" })}
            >
              {primary(ms.importTitle, language)}
            </Link>
            {/* A download, not a page: a plain link so the browser saves it. */}
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- a route handler returning a file, not a page */}
            <a
              href="/collection/export/students"
              className={buttonClasses({ variant: "outline", size: "sm" })}
              data-export-students
            >
              {primary(ms.exportStudents, language)}
            </a>
          </>
        ) : null}
      </div>

      {requests.length === 0 ? (
        <EmptyState title={m.collectionNone} language={language} />
      ) : (
        <Panel
          title={m.collectionTitle}
          description={t(`${requests.length} सवाल`, `${requests.length} asked`)}
          language={language}
        >
          {requests.map((request) => (
            <PanelRow
              key={request.id}
              href={`/collection/${request.id}`}
              icon={MessageSquare}
              title={
                <AuthoredText
                  value={{ hi: request.titleHi, en: request.titleEn }}
                  language={language}
                />
              }
              detail={[
                request.classLabel,
                request.assignedStaffName,
                request.dueDate ? primary(dayLabel(request.dueDate), language) : null,
              ]
                .filter(Boolean)
                .join(" · ")}
              trailing={
                <Badge tone={STATUS_TONE[request.status]}>
                  {primary(requestStatusLabels[request.status], language)}
                </Badge>
              }
            />
          ))}
        </Panel>
      )}

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
