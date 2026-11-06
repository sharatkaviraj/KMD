import { notFound } from "next/navigation";

import {
  deleteDraftAction,
  publishVersionAction,
} from "@/app/(app)/timetable/actions";
import * as m from "@/messages/pairs";
import { requirePermission } from "@/platform/auth/current-staff";
import { assertSessionVisible, notFoundUnlessVisible } from "@/platform/auth/test-session-access";
import { can } from "@/platform/auth/permissions";
import { pageTitle } from "@/platform/i18n/page-title";
import { flat, primary, t } from "@/platform/i18n/language";
import {
  getVersion,
  listSlots,
} from "@/modules/timetable/data/timetable-repo";
import { findClashes } from "@/modules/timetable/domain/views";
import { periodNumber } from "@/modules/timetable/domain/periods";
import { Badge, Card, DetailList, Notice } from "@/ui/primitives";
import { Button } from "@/ui/primitives/button";
import { PageHeader } from "@/ui/page-header-localized";

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

export default async function TimetableVersionPage(
  props: PageProps<"/timetable/[id]">,
) {
  const { id } = await props.params;
  const staff = await requirePermission("timetable:view", `/timetable/${id}`);
  const language = staff.language;

  const version = await getVersion(id);
  if (!version) notFound();
  // Phase 3 fence: a record in a session this viewer cannot open is "not found".
  await notFoundUnlessVisible(() => assertSessionVisible(staff, version.sessionLabel));

  const slots = await listSlots(version.id);
  const clashes = findClashes(slots);
  const mayManage = can(staff, "timetable:manage");

  const teachers = new Set(slots.map((slot) => slot.staffProfileId)).size;
  const classes = new Set(slots.map((slot) => slot.classId)).size;
  const days = new Set(slots.map((slot) => slot.day)).size;

  return (
    <>
      <PageHeader eyebrow={m.eyebrowAcademics}
        title={t(version.label, version.label)}
        description={t(
          `${m.session.hi} ${version.sessionLabel}`,
          `${m.session.en} ${version.sessionLabel}`,
        )}
        language={language}
        back={{ href: "/timetable", label: m.timetableTitle }}
        action={
          <Badge tone={STATUS_TONE[version.status]}>
            {primary(STATUS_LABEL[version.status], language)}
          </Badge>
        }
      />

      {clashes.length > 0 ? (
        <Notice
          className="mb-4"
          tone="danger"
          text={m.timetableClashFound}
          language={language}
        >
          <ul className="space-y-1 text-[13px]">
            {clashes.slice(0, 8).map((clash, index) => (
              <li key={index}>
                {clash.teacherShortName} — {clash.day} P{periodNumber(clash.period)} —{" "}
                {clash.classLabels.join(" / ")} ({clash.subjects.join(" / ")})
              </li>
            ))}
          </ul>
        </Notice>
      ) : null}

      <Card className="p-5">
        <DetailList
          language={language}
          items={[
            { label: m.timetableCells, value: version.cellCount },
            { label: m.timetableSlots, value: version.slotCount },
            { label: m.navStaff, value: teachers },
            { label: m.classBadge, value: classes },
            { label: m.calendarDate, value: version.createdAt.slice(0, 10) },
            ...(version.publishedAt
              ? [
                  {
                    label: m.timetablePublished,
                    value: version.publishedAt.slice(0, 10),
                  },
                ]
              : []),
          ]}
        />
        <p className="mt-3 text-[13px] text-muted-foreground">
          {days} {flat(m.calendarDaysEntered, language)}
        </p>
      </Card>

      {mayManage && version.status === "draft" ? (
        <div className="mt-6 space-y-3">
          <form action={publishVersionAction}>
            <input type="hidden" name="versionId" value={version.id} />
            <Button type="submit" variant="accent" fullWidth>
              {primary(m.timetablePublish, language)}
            </Button>
          </form>

          <Notice tone="neutral" text={m.timetablePublishHint} language={language} />

          <form action={deleteDraftAction}>
            <input type="hidden" name="versionId" value={version.id} />
            <Button type="submit" variant="ghost" fullWidth>
              {primary(m.timetableDelete, language)}
            </Button>
          </form>
        </div>
      ) : null}
    </>
  );
}
