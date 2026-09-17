import Link from "next/link";
import { ChevronRight, Plus, Upload } from "lucide-react";

import { m } from "@/messages";
import { requirePermission } from "@/platform/auth/current-staff";
import { can } from "@/platform/auth/permissions";
import { dayLabel } from "@/platform/dates";
import { primary } from "@/platform/i18n/language";
import { pageTitle } from "@/platform/i18n/page-title";
import { resolveSessionLabel } from "@/modules/academics/data/academics-repo";
import { listRounds } from "@/modules/collection/data/rounds-repo";
import { roundStatusLabel } from "@/modules/collection/domain/rounds";
import { AuthoredText } from "@/ui/authored-text";
import { Badge, Card, Section } from "@/ui/primitives";
import { buttonClasses } from "@/ui/primitives/button";
import { EmptyState } from "@/ui/states";
import { PageHeader } from "@/ui/shell/app-shell";

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
        <PageHeader title={m.roundsTitle} language={language} />
        <EmptyState title={m.noSessionFound} language={language} />
      </>
    );
  }

  const rounds = await listRounds(sessionLabel);

  return (
    <>
      <PageHeader
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

      <Section className="mt-6" title={m.roundsTitle} language={language}>
        {rounds.length === 0 ? (
          <EmptyState title={m.roundsNone} language={language} />
        ) : (
          <ul className="space-y-2">
            {rounds.map((round) => (
              <li key={round.id}>
                <Link
                  href={`/collection/rounds/${round.id}`}
                  className="focus-ring block rounded-2xl"
                >
                  <Card className="flex min-h-14 items-center gap-3 p-4">
                    <div className="min-w-0 flex-1">
                      <span className="block truncate text-[15px] font-medium text-foreground">
                        <AuthoredText
                          value={{ hi: round.titleHi, en: round.titleEn }}
                          language={language}
                        />
                      </span>
                      {round.dueDate ? (
                        <span className="mt-0.5 block text-[13px] text-muted-foreground">
                          {primary(m.roundWhen, language)}:{" "}
                          {primary(dayLabel(round.dueDate), language)}
                        </span>
                      ) : null}
                    </div>

                    <Badge tone={STATUS_TONE[round.status as keyof typeof STATUS_TONE] ?? "neutral"}>
                      {primary(roundStatusLabel(round.status), language)}
                    </Badge>

                    <ChevronRight aria-hidden className="size-4 shrink-0 text-subtle-foreground" />
                  </Card>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </>
  );
}
