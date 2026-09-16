import Link from "next/link";
import { BookOpen, Grid3x3 } from "lucide-react";

import { requirePermission } from "@/platform/auth/current-staff";
import {
  listClassAliases,
  listFeeClasses,
  listSubjects,
  resolveSessionLabel,
} from "@/modules/academics/data/academics-repo";
import {
  joinClassesToAliases,
  mappingProgress,
} from "@/modules/academics/domain/subjects";
import { Badge, Notice } from "@/ui/primitives";
import { PageHeader } from "@/ui/shell/app-shell";

export const runtime = "nodejs";

export const metadata = { title: "शैक्षणिक · VPPS One" };

/**
 * The academics hub.
 *
 * Its job is to say what is still missing, because that is what blocks the
 * Phase 2 timetable import: an unmapped class or a subject the sheet names and
 * this app does not.
 */
export default async function AcademicsPage() {
  await requirePermission("academics:view", "/academics");

  const sessionLabel = await resolveSessionLabel();
  const [subjects, classes, aliases] = await Promise.all([
    listSubjects(),
    sessionLabel ? listFeeClasses(sessionLabel) : Promise.resolve([]),
    sessionLabel ? listClassAliases(sessionLabel) : Promise.resolve([]),
  ]);

  const progress = mappingProgress(joinClassesToAliases(classes, aliases));
  const activeSubjects = subjects.filter((subject) => subject.isActive).length;

  const cards = [
    {
      href: "/academics/subjects",
      icon: BookOpen,
      label: "विषय",
      labelEn: "Subjects",
      detail: `${activeSubjects} सक्रिय · active`,
      done: activeSubjects > 0,
    },
    {
      href: "/academics/classes",
      icon: Grid3x3,
      label: "कक्षा के नाम",
      labelEn: "Class labels",
      detail: `${progress.mapped} / ${progress.total} मैप किए · mapped`,
      done: progress.complete,
    },
  ];

  return (
    <>
      <PageHeader
        title="शैक्षणिक"
        titleEn="Academics"
        description={
          sessionLabel
            ? `सत्र · Session ${sessionLabel}`
            : "कोई सत्र नहीं मिला · No session found"
        }
      />

      {!sessionLabel ? (
        <Notice
          tone="warning"
          hi="फ़ीस ऐप में कोई कक्षा नहीं मिली।"
          en="No classes were found in the fee app, so there is no session to work in yet."
        />
      ) : null}

      <ul className="grid gap-2 sm:grid-cols-2">
        {cards.map((card) => (
          <li key={card.href}>
            <Link
              href={card.href}
              className="focus-ring flex min-h-20 items-center gap-3 rounded-2xl border border-border bg-surface px-4 py-3 transition-colors hover:bg-surface-2"
            >
              <span
                aria-hidden
                className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent-soft-foreground [&_svg]:size-5"
              >
                <card.icon />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[15px] font-semibold text-foreground">
                  {card.label}
                  <span className="ml-2 text-[12px] font-normal text-subtle-foreground">
                    {card.labelEn}
                  </span>
                </span>
                <span className="block truncate text-[13px] text-muted-foreground">
                  {card.detail}
                </span>
              </span>
              {card.done ? (
                <Badge tone="success">पूरा</Badge>
              ) : (
                <Badge tone="warning">बाकी</Badge>
              )}
            </Link>
          </li>
        ))}
      </ul>

      <Notice
        className="mt-6"
        tone="info"
        hi="समय-सारिणी इन्हीं नामों से जुड़ेगी।"
        en="Phase 2 resolves every timetable cell against these two lists. A class with no label, or a subject the sheet names and this list does not, is what an import will stop on."
      />
    </>
  );
}
