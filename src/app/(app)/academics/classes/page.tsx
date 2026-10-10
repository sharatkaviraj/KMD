import { m } from "@/messages";
import { requirePermission } from "@/platform/auth/current-staff";
import { pageTitle } from "@/platform/i18n/page-title";
import { can } from "@/platform/auth/permissions";
import {
  listClassAliases,
  listFeeClasses,
  resolveSessionLabel,
} from "@/modules/academics/data/academics-repo";
import {
  joinClassesToAliases,
  mappingProgress,
  orphanedAliases,
} from "@/modules/academics/domain/subjects";
import { ClassAliasEditor } from "@/modules/academics/ui/class-alias-editor";
import { t } from "@/platform/i18n/language";
import { Notice } from "@/ui/primitives";
import { EmptyState } from "@/ui/states";
import { PageHeader } from "@/ui/page-header-localized";

export const runtime = "nodejs";

export async function generateMetadata() {
  return { title: await pageTitle(m.classLabels) };
}

export default async function ClassAliasesPage() {
  const staff = await requirePermission("academics:view", "/academics/classes");
  const language = staff.language;
  const sessionLabel = await resolveSessionLabel();

  if (!sessionLabel) {
    return (
      <>
        <PageHeader eyebrow={m.eyebrowAcademics}
          title={m.classLabels}
          language={language}
          back={{ href: "/academics/setup", label: m.academicsTitle }}
        />
        <EmptyState title={m.classLabelsNothing} language={language} />
      </>
    );
  }

  const [classes, aliases] = await Promise.all([
    listFeeClasses(sessionLabel),
    listClassAliases(sessionLabel),
  ]);

  const rows = joinClassesToAliases(classes, aliases);
  const progress = mappingProgress(rows);
  // No foreign key points into `public` (rule 2), so a class that has gone
  // leaves its alias behind. Nothing enforces this; this is what notices.
  const orphans = orphanedAliases(classes, aliases);
  const orphanLabels = orphans.map((alias) => alias.timetableLabel).join(", ");

  return (
    <>
      <PageHeader eyebrow={m.eyebrowAcademics}
        title={m.classLabels}
        description={t(
          `${m.session.hi} ${sessionLabel} — ${progress.mapped} / ${progress.total}`,
          `${m.session.en} ${sessionLabel} — ${progress.mapped} / ${progress.total}`,
        )}
        language={language}
        back={{ href: "/academics/setup", label: m.academicsTitle }}
      />

      <Notice
        className="mb-4"
        tone={progress.complete ? "success" : "info"}
        text={progress.complete ? m.classLabelsDone : m.classLabelsTodo}
        language={language}
      />

      {orphans.length > 0 ? (
        <Notice
          className="mb-4"
          tone="warning"
          text={t(
            `${orphans.length} नाम ऐसी कक्षा से जुड़े हैं जो अब फ़ीस ऐप में नहीं है: ${orphanLabels}. समय-सारिणी इन्हें छोड़ देगी।`,
            `${orphans.length} label(s) point at a class that no longer exists in the fee app for this session: ${orphanLabels}. They are ignored by the timetable and can be left alone.`,
          )}
          language={language}
        />
      ) : null}

      <ClassAliasEditor
        rows={rows}
        sessionLabel={sessionLabel}
        editable={can(staff, "academics:manage")}
      />
    </>
  );
}
