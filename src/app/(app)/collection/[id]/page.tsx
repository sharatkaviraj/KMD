import { headers } from "next/headers";

import { authoredPlain, authoredTitle } from "@/ui/authored-text";
import { m } from "@/messages";
import { requirePermission } from "@/platform/auth/current-staff";
import { can } from "@/platform/auth/permissions";
import { dayLabel } from "@/platform/dates";
import { countOf, flat, primary, t } from "@/platform/i18n/language";
import { pageTitle } from "@/platform/i18n/page-title";
import {
  getRequest,
  rollForRequest,
} from "@/modules/collection/data/requests-repo";
import { submissionsForRequest } from "@/modules/collection/data/submissions-repo";
import {
  completeness,
  outstandingRows,
  requestStatusLabels,
  requestUrl,
  staffUrl,
  waMeLink,
} from "@/modules/collection/domain/requests";
import { CopyLink } from "@/modules/collection/ui/office-forms";
import {
  rotateTokenAction,
  setRequestStatusAction,
} from "@/app/(app)/collection/actions";
import { Badge, Card, Notice, Section } from "@/ui/primitives";
import { Button, buttonClasses } from "@/ui/primitives/button";
import { EmptyState } from "@/ui/states";
import { PageHeader } from "@/ui/shell/app-shell";

export const runtime = "nodejs";

export async function generateMetadata() {
  return { title: await pageTitle(m.collectionTitle) };
}

/**
 * One request: its link, how far it has got, and who is still owed.
 *
 * The origin is read on the server rather than in the browser. A link the
 * office pastes into WhatsApp is an absolute URL, and a client component
 * reaching for `window.location.origin` during render gets an empty string,
 * bakes `/r/abc` into the href, and keeps it through hydration — a button that
 * looks right and carries a relative path, which is nothing at all once it
 * leaves the browser. That is not hypothetical; it is what Sampark's Remind
 * button did.
 */
export default async function RequestPage(props: PageProps<"/collection/[id]">) {
  const staff = await requirePermission("collection:view", "/collection");
  const language = staff.language;
  const mayManage = can(staff, "collection:manage");
  const { id } = await props.params;

  const request = await getRequest(id);

  if (!request) {
    return (
      <>
        <PageHeader title={m.collectionTitle} language={language} back={BACK} />
        <EmptyState title={m.notFound} language={language} />
      </>
    );
  }

  const host = (await headers()).get("host") ?? "";
  const origin = `${host.startsWith("localhost") ? "http" : "https"}://${host}`;

  const [roll, submissions] = await Promise.all([
    rollForRequest(request),
    submissionsForRequest(request.id),
  ]);

  const done = completeness(roll, request.fields);
  const waiting = outstandingRows(roll, request.fields);
  const link = requestUrl(origin, request.token);

  const title = { hi: request.titleHi, en: request.titleEn };
  // The sender's own language: this is the text they will paste into WhatsApp,
  // and an empty half would make it start with a dash (B-14).
  const message = `${authoredPlain(title, language)} — ${request.classLabel}\n${link}`;

  return (
    <>
      <PageHeader
        title={authoredTitle(title, m.collectionTitle)}
        description={t(request.classLabel, request.classLabel)}
        language={language}
        back={BACK}
        action={
          <Badge tone={request.status === "open" ? "success" : "neutral"}>
            {primary(requestStatusLabels[request.status], language)}
          </Badge>
        }
      />

      {request.status === "draft" ? (
        <Notice
          className="mb-4"
          tone="warning"
          text={m.collectionDraftNotice}
          language={language}
        />
      ) : null}

      {/* ------------------------------------------------ the numbers */}

      <Section title={m.collectionProgress} language={language}>
        <Card className="p-5">
          <div className="flex items-baseline gap-3">
            <p className="text-[34px] font-semibold leading-none tabular-nums text-foreground">
              {done.percent}%
            </p>
            <p className="text-[13px] text-muted-foreground">
              {countOf(done.answered, done.expected, language)}{" "}
              {primary(m.collectionAnswered, language)} ·{" "}
              {done.studentsDone}/{done.students} {primary(m.teachStudents, language)}
            </p>
          </div>

          <div className="mt-4 flex flex-wrap gap-1.5">
            <Badge tone="neutral">
              {request.fields.length} {primary(m.collectionAsking, language)}
            </Badge>
            {submissions.length > 0 ? (
              <Badge tone="accent">
                {submissions.length} {primary(m.collectionAnswered, language)}
              </Badge>
            ) : null}
            {request.dueDate ? (
              <Badge tone="neutral">
                {primary(m.collectionDueDate, language)}{" "}
                {primary(dayLabel(request.dueDate), language)}
              </Badge>
            ) : null}
          </div>
        </Card>
      </Section>

      {/* --------------------------------------------------- the link */}

      {request.status === "open" ? (
        <Section className="mt-7" title={m.collectionLink} language={language}>
          <Card className="space-y-3 p-4">
            <CopyLink url={link} />

            {request.assignedStaffId ? (
              <CopyLink url={staffUrl(origin, request.token)} />
            ) : null}

            <a
              href={waMeLink("", message)}
              target="_blank"
              rel="noreferrer noopener"
              className={buttonClasses({ variant: "outline", fullWidth: true })}
            >
              {primary(m.collectionOpenWhatsapp, language)}
            </a>

            {mayManage ? (
              <form action={rotateTokenAction}>
                <input type="hidden" name="id" value={request.id} />
                <Button type="submit" variant="ghost" size="sm" fullWidth>
                  {primary(m.collectionRotate, language)}
                </Button>
                <p className="mt-1 text-center text-[12px] text-subtle-foreground">
                  {primary(m.collectionRotateHint, language)}
                </p>
              </form>
            ) : null}
          </Card>
        </Section>
      ) : null}

      {/* ------------------------------------------- who is still owed */}

      <Section className="mt-7" title={m.collectionWaitingOn} language={language}>
        {waiting.length === 0 ? (
          <EmptyState title={m.linkNothingToDo} language={language} />
        ) : (
          <ul className="space-y-1.5">
            {waiting.slice(0, 60).map((row) => (
              <li
                key={row.studentId}
                className="flex min-h-12 items-center gap-3 rounded-xl border border-border bg-surface px-3 py-2"
              >
                <span className="w-7 shrink-0 text-[13px] font-semibold tabular-nums text-subtle-foreground">
                  {row.rollNo ?? "—"}
                </span>
                <span className="min-w-0 flex-1 truncate text-[14px] text-foreground">
                  {row.fullName}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      {/* ------------------------------------------------- open/close */}

      {mayManage ? (
        <Card className="mt-8 p-4">
          <form action={setRequestStatusAction}>
            <input type="hidden" name="id" value={request.id} />
            <input
              type="hidden"
              name="status"
              value={request.status === "open" ? "closed" : "open"}
            />
            <Button
              type="submit"
              fullWidth
              size="lg"
              variant={request.status === "open" ? "outline" : "primary"}
            >
              {primary(
                request.status === "open"
                  ? m.collectionClose
                  : request.status === "closed"
                    ? m.collectionReopen
                    : m.collectionOpen,
                language,
              )}
            </Button>
          </form>
          <p className="mt-2 text-center text-[12px] text-subtle-foreground">
            {flat(m.collectionIntro, language)}
          </p>
        </Card>
      ) : null}
    </>
  );
}

const BACK = { href: "/collection", label: m.collectionTitle };
