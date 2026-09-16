import { requirePermission } from "@/platform/auth/current-staff";
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
import { Notice } from "@/ui/primitives";
import { EmptyState } from "@/ui/states";
import { PageHeader } from "@/ui/shell/app-shell";

export const runtime = "nodejs";

export const metadata = { title: "कक्षा के नाम · VPPS One" };

export default async function ClassAliasesPage() {
  const staff = await requirePermission("academics:view", "/academics/classes");
  const sessionLabel = await resolveSessionLabel();

  if (!sessionLabel) {
    return (
      <>
        <PageHeader
          title="कक्षा के नाम"
          titleEn="Class labels"
          back={{ href: "/academics", label: "शैक्षणिक" }}
        />
        <EmptyState
          hi="फ़ीस ऐप में कोई कक्षा नहीं मिली।"
          en="No classes were found in the fee app, so there is nothing to map yet."
        />
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

  return (
    <>
      <PageHeader
        title="कक्षा के नाम"
        titleEn="Class labels"
        back={{ href: "/academics", label: "शैक्षणिक" }}
        description={`सत्र · Session ${sessionLabel} — ${progress.mapped} / ${progress.total}`}
      />

      <Notice
        className="mb-4"
        tone={progress.complete ? "success" : "info"}
        hi={
          progress.complete
            ? "हर कक्षा का नाम तय है।"
            : "समय-सारिणी की शीट में कक्षा जिस नाम से लिखी है, वही यहाँ भरें।"
        }
        en={
          progress.complete
            ? "Every class has a timetable label. A Phase 2 import can resolve all of them."
            : "Enter each class exactly as the timetable sheet writes it — “11-S”, “5”, “NUR”. Unmapped classes are listed first."
        }
      />

      {orphans.length > 0 ? (
        <Notice
          className="mb-4"
          tone="warning"
          hi={`${orphans.length} नाम ऐसी कक्षा से जुड़े हैं जो अब फ़ीस ऐप में नहीं है।`}
          en={`${orphans.length} label(s) point at a class that no longer exists in the fee app for this session: ${orphans
            .map((alias) => alias.timetableLabel)
            .join(", ")}. They are ignored by the timetable and can be left alone.`}
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
