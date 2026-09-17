import Link from "next/link";
import { Plus } from "lucide-react";

import { m } from "@/messages";
import { requirePermission } from "@/platform/auth/current-staff";
import { can } from "@/platform/auth/permissions";
import { pageTitle } from "@/platform/i18n/page-title";
import { flat, primary, t } from "@/platform/i18n/language";
import {
  listClassAliases,
  listFeeClasses,
  resolveSessionLabel,
} from "@/modules/academics/data/academics-repo";
import { feeClassName } from "@/modules/academics/domain/subjects";
import { listStaff } from "@/modules/staff/data/staff-repo";
import {
  getPublishedVersion,
  listSlots,
  listVersions,
} from "@/modules/timetable/data/timetable-repo";
import { TimetableViews } from "@/modules/timetable/ui/timetable-views";
import { Badge, Notice } from "@/ui/primitives";
import { buttonClasses } from "@/ui/primitives/button";
import { EmptyState } from "@/ui/states";
import { PageHeader } from "@/ui/shell/app-shell";

export const runtime = "nodejs";

export async function generateMetadata() {
  return { title: await pageTitle(m.timetableTitle) };
}

const STATUS_LABEL = {
  draft: m.timetableDraft,
  published: m.timetablePublished,
  archived: m.timetableArchived,
} as const;

const STATUS_TONE = {
  draft: "warning",
  published: "success",
  archived: "neutral",
} as const;

export default async function TimetablePage() {
  const staff = await requirePermission("timetable:view", "/timetable");
  const language = staff.language;
  const sessionLabel = await resolveSessionLabel();

  if (!sessionLabel) {
    return (
      <>
        <PageHeader eyebrow={m.eyebrowAcademics} title={m.timetableTitle} language={language} />
        <EmptyState title={m.classLabelsNothing} language={language} />
      </>
    );
  }

  const [versions, published, classes, aliases, allStaff] = await Promise.all([
    listVersions(sessionLabel),
    getPublishedVersion(sessionLabel),
    listFeeClasses(sessionLabel),
    listClassAliases(sessionLabel),
    listStaff(),
  ]);

  const slots = published ? await listSlots(published.id) : [];
  const mayManage = can(staff, "timetable:manage");

  // Only the classes that actually appear in the published timetable, in the
  // fee app's own order.
  const classIdsInUse = new Set(slots.map((slot) => slot.classId));
  const classOptions = classes
    .filter((entry) => classIdsInUse.has(entry.id))
    .map((entry) => ({
      id: entry.id,
      label:
        aliases.find((alias) => alias.classId === entry.id)?.timetableLabel ??
        feeClassName(entry),
    }));

  const teacherIdsInUse = new Set(slots.map((slot) => slot.staffProfileId));
  const teacherOptions = allStaff
    .filter((person) => teacherIdsInUse.has(person.id) || (person.isActive && person.isTeaching))
    .map((person) => ({
      id: person.id,
      label: person.displayName,
      shortName: person.shortName,
    }))
    .sort((a, b) => a.label.localeCompare(b.label, "en"));

  const days = [...new Set(slots.map((slot) => slot.day))];

  return (
    <>
      <PageHeader eyebrow={m.eyebrowAcademics}
        title={m.timetableTitle}
        description={
          published
            ? t(
                `${published.label} · ${published.slotCount} ${m.timetableSlots.hi}`,
                `${published.label} · ${published.slotCount} ${m.timetableSlots.en}`,
              )
            : t(`${m.session.hi} ${sessionLabel}`, `${m.session.en} ${sessionLabel}`)
        }
        language={language}
        action={
          mayManage ? (
            <Link href="/timetable/import" className={buttonClasses({ size: "sm" })}>
              <Plus aria-hidden />
              {primary(m.timetableUpload, language)}
            </Link>
          ) : null
        }
      />

      {!published ? (
        <EmptyState
          title={m.timetableNoPublished}
          detail={m.timetableNone}
          language={language}
          action={
            mayManage ? (
              <Link href="/timetable/import" className={buttonClasses()}>
                {primary(m.timetableUpload, language)}
              </Link>
            ) : null
          }
        />
      ) : (
        <TimetableViews
          slots={slots}
          days={days}
          classes={classOptions}
          teachers={teacherOptions}
        />
      )}

      {versions.length > 0 ? (
        <section className="mt-8 space-y-2">
          <h2 className="text-[15px] font-semibold text-foreground">
            {flat(m.timetableVersions, language)}
          </h2>
          <ul className="space-y-1.5">
            {versions.map((version) => (
              <li key={version.id}>
                <Link
                  href={`/timetable/${version.id}`}
                  className="focus-ring flex min-h-14 items-center gap-3 rounded-xl border border-border bg-surface px-4 py-2.5 transition-colors hover:bg-surface-2"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[15px] font-medium text-foreground">
                      {version.label}
                    </span>
                    <span className="block truncate text-[12px] text-muted-foreground">
                      {version.slotCount} {primary(m.timetableSlots, language)} ·{" "}
                      {version.createdAt.slice(0, 10)}
                    </span>
                  </span>
                  <Badge tone={STATUS_TONE[version.status]}>
                    {primary(STATUS_LABEL[version.status], language)}
                  </Badge>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {published ? (
        <Notice
          className="mt-6"
          tone="neutral"
          text={m.timetablePublishHint}
          language={language}
        />
      ) : null}
    </>
  );
}
