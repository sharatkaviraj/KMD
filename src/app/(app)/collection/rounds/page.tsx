import Link from "@/ui/link";
import { Inbox, Plus, Upload } from "lucide-react";

import * as m from "@/messages/pairs";
import { requirePermission } from "@/platform/auth/current-staff";
import { can } from "@/platform/auth/permissions";
import { dayLabel } from "@/platform/dates";
import { primary } from "@/platform/i18n/language";
import { pageTitle } from "@/platform/i18n/page-title";
import { resolveSessionLabel } from "@/modules/academics/data/academics-repo";
import { listRounds } from "@/modules/collection/data/rounds-repo";
import { roundStatusLabel } from "@/modules/collection/domain/rounds";
import { AuthoredText } from "@/ui/authored-text";
import { Panel, PanelRow } from "@/ui/panel";
import { Badge } from "@/ui/primitives";
import { buttonClasses } from "@/ui/primitives/button";
import { EmptyState } from "@/ui/states";
import { PageHeader } from "@/ui/page-header-localized";

export const runtime = "nodejs";

export async function generateMetadata() {
  return { title: await pageTitle(m.roundsTitle) };
}

const STATUS_TONE = {
  draft: "neutral",
  open: "success",
  closed: "neutral",
} as const;

/**
 * One question, asked of many groups.
 *
 * A request is one class and one link, and that shape is not changing — this
 * is what turns "ask every class for phone numbers" into nineteen of them and
 * keeps them together afterwards (S-03, B-02).
 */
export default async function RoundsPage() {
  const staff = await requirePermission("collection:view", "/collection/rounds");
  const language = staff.language;
  const mayManage = can(staff, "collection:manage");
  const sessionLabel = await resolveSessionLabel();

  if (!sessionLabel) {
    return (
      <>
        <PageHeader eyebrow={m.eyebrowSampark} title={m.roundsTitle} language={language} />
        <EmptyState title={m.noSessionFound} language={language} />
      </>
    );
  }

  const rounds = await listRounds(sessionLabel);

  return (
    <>
      <PageHeader eyebrow={m.eyebrowSampark}
        title={m.roundsTitle}
        description={m.roundsHint}
        language={language}
        back={{ href: "/collection", label: m.collectionTitle }}
        action={
          mayManage ? (
            <div className="flex gap-2">
              {/* For when no filter can find the children the office means:
                  an uploaded list is the other half of S-03. */}
              <Link
                href="/collection/rounds/upload"
                className={buttonClasses({ variant: "outline", size: "sm" })}
              >
                <Upload aria-hidden />
                {primary(m.askListTitle, language)}
              </Link>
              <Link
                href="/collection/rounds/new"
                className={buttonClasses({ size: "sm" })}
              >
                <Plus aria-hidden />
                {primary(m.roundNew, language)}
              </Link>
            </div>
          ) : null
        }
      />

      {rounds.length === 0 ? (
        <EmptyState className="mt-6" title={m.roundsNone} language={language} />
      ) : (
        <Panel className="mt-6" title={m.roundsTitle} language={language}>
          {rounds.map((round) => (
            <PanelRow
              key={round.id}
              href={`/collection/rounds/${round.id}`}
              icon={Inbox}
              title={
                <AuthoredText
                  value={{ hi: round.titleHi, en: round.titleEn }}
                  language={language}
                />
              }
              detail={
                round.dueDate
                  ? `${primary(m.roundWhen, language)}: ${primary(dayLabel(round.dueDate), language)}`
                  : null
              }
              trailing={
                <Badge
                  tone={
                    STATUS_TONE[round.status as keyof typeof STATUS_TONE] ?? "neutral"
                  }
                >
                  {primary(roundStatusLabel(round.status), language)}
                </Badge>
              }
            />
          ))}
        </Panel>
      )}
    </>
  );
}
