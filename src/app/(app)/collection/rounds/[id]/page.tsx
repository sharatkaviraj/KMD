import { notFound } from "next/navigation";

import { m } from "@/messages";
import { requirePermission } from "@/platform/auth/current-staff";
import { dayLabel } from "@/platform/dates";
import { countOf, counted, primary } from "@/platform/i18n/language";
import { pageTitle } from "@/platform/i18n/page-title";
import { readAuthored } from "@/platform/i18n/authored";
import {
  classLabelMap,
  resolveSessionLabel,
} from "@/modules/academics/data/academics-repo";
import {
  fieldsForRound,
  resolveAudience,
  roundById,
} from "@/modules/collection/data/rounds-repo";
import { headers } from "next/headers";

import { can } from "@/platform/auth/permissions";
import {
  linksForRound,
  planForRound,
} from "@/modules/collection/data/fan-out-repo";
import { roundStatusLabel } from "@/modules/collection/domain/rounds";
import { RoundBoard } from "@/modules/collection/ui/round-board";
import { AuthoredText } from "@/ui/authored-text";
import { Badge, Card, Section } from "@/ui/primitives";
import { EmptyState } from "@/ui/states";
import { PageHeader } from "@/ui/shell/app-shell";

export const runtime = "nodejs";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const round = await roundById((await params).id);
  const title = round
    ? readAuthored({ hi: round.titleHi, en: round.titleEn }, "both")?.text
    : null;

  return { title: await pageTitle(title ? { hi: title, en: title } : m.roundsTitle) };
}

/**
 * One round: what was asked, of whom, and who it reaches today.
 *
 * The audience is stored **as chosen**, so this re-resolves it every time it
 * is opened — which is right for a round that has not gone out yet and is
 * exactly wrong for one that has. That is the difference the frozen members
 * exist for: once the fan-out mints links (R3.3), the count that matters is
 * the one on each link, not this one.
 */
export default async function RoundPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const staff = await requirePermission("collection:view", `/collection/rounds/${id}`);
  const language = staff.language;

  const round = await roundById(id);
  if (!round) notFound();

  const sessionLabel = (await resolveSessionLabel()) ?? round.sessionLabel;

  const [fields, resolved, labels, plan, links] = await Promise.all([
    fieldsForRound(round.id),
    resolveAudience(round.audience, sessionLabel),
    classLabelMap(sessionLabel),
    planForRound(round, sessionLabel),
    linksForRound(round.id),
  ]);

  // Read on the server, like every other link this app prints. A link that
  // has to be right in a WhatsApp message cannot come from the browser:
  // reaching for `window.location.origin` during render gets an empty string.
  const host = (await headers()).get("host") ?? "";
  const origin = `${host.startsWith("localhost") ? "http" : "https"}://${host}`;

  const mayManage = can(staff, "collection:manage");

  // **Which classes, by name.** A round that says "10 children" and not which
  // ten is a row nobody can check, and "Class 1, no phone number" is the whole
  // reason the audience is stored as chosen rather than only as resolved
  // (D-151). No sort: `classLabelMap()` is already in school order (D-130).
  const chosenClasses = round.audience.allEnrolled
    ? [...labels.values()]
    : [...labels.entries()]
        .filter(([id]) => round.audience.classIds.includes(id))
        .map(([, label]) => label);

  return (
    <>
      <PageHeader
        title={{
          hi: round.titleHi ?? round.titleEn ?? "—",
          en: round.titleEn ?? round.titleHi ?? "—",
        }}
        language={language}
        back={{ href: "/collection/rounds", label: m.roundsTitle }}
        action={
          <Badge tone={round.status === "open" ? "success" : "neutral"}>
            {primary(roundStatusLabel(round.status), language)}
          </Badge>
        }
      />

      <Section className="mt-6" title={m.roundWho} language={language}>
        <Card className="p-4">
          <p className="text-[15px] text-foreground">
            <strong className="text-[22px] font-semibold tabular-nums">
              {resolved.students.length}
            </strong>{" "}
            {primary(
              resolved.students.length === 1 ? m.roundCoversOne : m.roundCoversMany,
              language,
            )}
            {resolved.classIds.length > 0 ? (
              <span className="text-muted-foreground">
                {" · "}
                {primary(
                  counted(resolved.classIds.length, m.roundAcrossOne, m.roundAcrossMany),
                  language,
                )}
              </span>
            ) : null}
          </p>

          {chosenClasses.length > 0 ? (
            <p className="mt-1 text-[13px] text-muted-foreground">
              {round.audience.allEnrolled
                ? primary(m.roundAllClasses, language)
                : chosenClasses.join(" · ")}
            </p>
          ) : null}

          {round.audience.gaps.length > 0 && resolved.beforeGaps > resolved.students.length ? (
            <p className="mt-1 text-[13px] text-subtle-foreground">
              {countOf(resolved.students.length, resolved.beforeGaps, language)}
            </p>
          ) : null}

          {round.reasonHi || round.reasonEn ? (
            <p className="mt-3 border-t border-border pt-3 text-[14px] leading-6 text-muted-foreground">
              <AuthoredText
                value={{ hi: round.reasonHi, en: round.reasonEn }}
                language={language}
              />
            </p>
          ) : null}

          {round.dueDate ? (
            <p className="mt-2 text-[13px] text-muted-foreground">
              {primary(m.roundWhen, language)}: {primary(dayLabel(round.dueDate), language)}
            </p>
          ) : null}
        </Card>
      </Section>

      {/* -------------------------- the links, and what is holding them up */}

      <Section className="mt-7" title={m.boardTitle} language={language}>
        <RoundBoard
          roundId={round.id}
          origin={origin}
          mayManage={mayManage}
          links={links.map((link) => ({
            id: link.id,
            token: link.token,
            audienceKind: link.audienceKind,
            audienceLabel: link.audienceLabel,
            status: link.status,
            assignedStaffName: link.assignedStaffName,
            sentAt: link.sentAt,
            remindedAt: link.remindedAt,
            reminderCount: link.reminderCount,
            members: link.members,
            answered: link.answered,
          }))}
          plan={{
            ready: plan.ready.map((group) => ({
              label: group.scope.label,
              ownerName: group.ownerName,
              students: group.studentIds.length,
            })),
            blocked: plan.blocked.map((group) => ({
              label: group.scope.label,
              reason: group.reason,
              message: group.message,
              students: group.studentIds.length,
            })),
            unassigned: plan.unassigned.map((row) => ({
              fullName: row.fullName,
              classLabel: row.classLabel,
              reason: row.reason,
            })),
            totals: plan.totals,
          }}
        />
      </Section>

      <Section className="mt-7" title={m.roundWhat} language={language}>
        {fields.length === 0 ? (
          <EmptyState title={m.roundsNone} language={language} />
        ) : (
          <Card className="p-4">
            <ul className="space-y-2">
              {fields.map((field) => (
                <li key={field.id} className="text-[15px] text-foreground">
                  {primary({ hi: field.labelHi, en: field.labelEn }, language)}
                </li>
              ))}
            </ul>
          </Card>
        )}
      </Section>
    </>
  );
}
