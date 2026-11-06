import * as m from "@/messages/pairs";
import { requirePermission } from "@/platform/auth/current-staff";
import { primary, secondary } from "@/platform/i18n/language";
import { pageTitle } from "@/platform/i18n/page-title";
import {
  classLabelMap,
  resolveSessionLabel,
} from "@/modules/academics/data/academics-repo";
import { listFields } from "@/modules/collection/data/fields-repo";
import { resolveAudience } from "@/modules/collection/data/rounds-repo";
import { activeFields } from "@/modules/collection/domain/fields";
import { describeGaps, gapFields } from "@/modules/collection/domain/gaps";
import { audienceFromParams, needsReason } from "@/modules/collection/domain/rounds";
import { NewRoundForm } from "@/modules/collection/ui/round-form";
import { Notice, Section } from "@/ui/primitives";
import { EmptyState } from "@/ui/states";
import { PageHeader } from "@/ui/page-header-localized";

export const runtime = "nodejs";

export async function generateMetadata() {
  return { title: await pageTitle(m.roundNew) };
}

/**
 * Build a round, and see who it reaches before making it.
 *
 * **The selection is in the URL and the count is a server render of the real
 * resolver.** Not a number the browser worked out: the number the office is
 * shown has to be the number that gets frozen, and the day those were two code
 * paths is the day a preview could say nine and the round cover eleven.
 *
 * It also means this screen ships no JavaScript for the part that matters.
 * Ticking a class is a form submission — slower than a click, and it works on
 * the connection this is actually opened on, with Back and a shareable URL
 * thrown in (D-139).
 */
export default async function NewRoundPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const staff = await requirePermission("collection:manage", "/collection/rounds/new");
  const language = staff.language;
  const sessionLabel = await resolveSessionLabel();

  if (!sessionLabel) {
    return (
      <>
        <PageHeader eyebrow={m.eyebrowSampark} title={m.roundNew} language={language} />
        <EmptyState title={m.noSessionFound} language={language} />
      </>
    );
  }

  const params = await searchParams;
  const audience = audienceFromParams(params);

  const [labels, allFields, resolved] = await Promise.all([
    classLabelMap(sessionLabel),
    listFields(),
    resolveAudience(audience, sessionLabel),
  ]);

  const fields = activeFields(allFields);

  // The suggested reason is derived from the filters the office actually
  // chose, so a narrowed round arrives with a sentence already in the box
  // rather than with an empty required field and a shrug (S-03).
  const suggested = describeGaps(gapFields(fields, audience.gaps.map((g) => g.fieldKey)));

  return (
    <>
      <PageHeader eyebrow={m.eyebrowSampark}
        title={m.roundNew}
        description={m.roundsHint}
        language={language}
        back={{ href: "/collection/rounds", label: m.roundsTitle }}
      />

      {resolved.unknownGapKeys.length > 0 ? (
        <Notice tone="warning" text={m.roundUnknownGap} language={language} />
      ) : null}

      <Section className="mt-6" title={m.roundWho} language={language}>
        <NewRoundForm
          language={language}
          classes={[...labels.entries()].map(([id, label]) => ({ id, label }))}
          fields={fields.map((field) => ({
            id: field.id,
            key: field.key,
            label: primary({ hi: field.labelHi, en: field.labelEn }, language),
            under: secondary({ hi: field.labelHi, en: field.labelEn }, language),
          }))}
          audience={{
            classIds: [...audience.classIds],
            gapKeys: audience.gaps.map((gap) => gap.fieldKey),
            allEnrolled: audience.allEnrolled,
          }}
          preview={{
            covered: resolved.students.length,
            beforeGaps: resolved.beforeGaps,
            classes: resolved.classIds.length,
            narrowed: audience.gaps.length > 0,
          }}
          needsReason={needsReason(audience)}
          suggestedReason={suggested}
        />
      </Section>
    </>
  );
}
