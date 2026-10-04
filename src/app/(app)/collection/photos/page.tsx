import Link from "next/link";

import { m } from "@/messages";
import { ms } from "@/messages/setup";
import { requirePermission } from "@/platform/auth/current-staff";
import { primary } from "@/platform/i18n/language";
import { pageTitle } from "@/platform/i18n/page-title";
import { classLabelMap, resolveSessionLabel } from "@/modules/academics/data/academics-repo";
import { classPhotoRoster } from "@/modules/collection/data/photos-repo";
import { FolderPlacement, PhotoTile } from "@/modules/collection/ui/photo-forms";
import { Badge, Card, Notice, Section } from "@/ui/primitives";
import { PageHeader } from "@/ui/page-header-localized";
import { cn } from "@/platform/utils";

export const runtime = "nodejs";

export async function generateMetadata() {
  return { title: await pageTitle(ms.photoTitle) };
}

type Props = { searchParams: Promise<{ class?: string }> };

/**
 * Children's photographs (P10c, S-11): a class at a time, the ones without a
 * photograph first — the missing-photo view is the order of the list, not a
 * separate screen.
 */
export default async function PhotosPage({ searchParams }: Props) {
  const staff = await requirePermission("collection:manage", "/collection/photos");
  const language = staff.language;
  const { class: classId } = await searchParams;
  const sessionLabel = await resolveSessionLabel();
  if (!sessionLabel) {
    return <Notice tone="danger" text={m.noSessionFound} language={language} />;
  }

  const labels = await classLabelMap(sessionLabel);
  const chosen = classId && labels.has(classId) ? classId : null;
  const roster = chosen ? await classPhotoRoster(chosen, sessionLabel) : [];
  const missing = roster.filter((child) => !child.photoId);
  const ordered = [...missing, ...roster.filter((child) => child.photoId)];

  return (
    <>
      <PageHeader
        eyebrow={m.eyebrowSampark}
        title={ms.photoTitle}
        language={language}
        back={{ href: "/collection", label: m.eyebrowSampark }}
      />
      <Notice className="mb-5" tone="info" text={ms.photoIntro} language={language} />

      <Section title={ms.photoChooseClass} language={language}>
        <ul className="flex flex-wrap gap-2" data-photo-classes>
          {[...labels.entries()].map(([id, label]) => (
            <li key={id}>
              <Link
                href={`/collection/photos?class=${id}`}
                className={cn(
                  "inline-flex min-h-11 items-center rounded-xl border px-3 text-[13px]",
                  id === chosen ? "border-primary bg-primary text-primary-foreground" : "border-border text-foreground",
                )}
                aria-current={id === chosen ? "page" : undefined}
              >
                {label}
              </Link>
            </li>
          ))}
        </ul>
      </Section>

      {chosen ? (
        <div data-photo-class={chosen}>
          <Section
            className="mt-6"
            title={{ hi: labels.get(chosen)!, en: labels.get(chosen)! }}
            language={language}
          >
            <p className="mb-3">
              <Badge tone={missing.length > 0 ? "warning" : "success"} data-photo-missing={missing.length}>
                {primary(ms.photoMissingCount, language)} {missing.length} / {roster.length}
              </Badge>
            </p>
            <Card className="mb-4 p-4">
              <FolderPlacement
                roster={roster.map(({ studentId, name, srNo, externalId, photoId, photoUrl }) => ({
                  studentId,
                  name,
                  srNo,
                  externalId,
                  photoId,
                  photoUrl,
                }))}
              />
            </Card>
            <ul className="space-y-3">
              {ordered.map((child) => (
                <li key={child.studentId}>
                  <Card className="p-3">
                    <PhotoTile
                      child={{
                        studentId: child.studentId,
                        name: child.name,
                        srNo: child.srNo,
                        externalId: child.externalId,
                        photoId: child.photoId,
                        photoUrl: child.photoUrl,
                      }}
                    />
                  </Card>
                </li>
              ))}
            </ul>
          </Section>
        </div>
      ) : null}
    </>
  );
}
