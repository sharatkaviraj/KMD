import * as m from "@/messages/pairs";
import { requirePermission } from "@/platform/auth/current-staff";
import { primary } from "@/platform/i18n/language";
import { pageTitle } from "@/platform/i18n/page-title";
import { listFields } from "@/modules/collection/data/fields-repo";
import { activeFields } from "@/modules/collection/domain/fields";
import { AskListForm } from "@/modules/collection/ui/ask-list-form";
import { Section } from "@/ui/primitives";
import { PageHeader } from "@/ui/page-header-localized";

export const runtime = "nodejs";

export async function generateMetadata() {
  return { title: await pageTitle(m.askListTitle) };
}

/**
 * A round over exactly the children a sheet names.
 *
 * **The case this exists for.** Thirty-five families whose number is on record
 * and is not a WhatsApp number. Nothing about those children is missing —
 * every gap filter says their records are complete — so no query finds them
 * and the office is the only thing that knows (S-06).
 */
export default async function UploadAskListPage() {
  const staff = await requirePermission(
    "collection:manage",
    "/collection/rounds/upload",
  );

  const fields = activeFields(await listFields());

  return (
    <>
      <PageHeader eyebrow={m.eyebrowSampark}
        title={m.askListTitle}
        description={m.askListHint}
        language={staff.language}
        back={{ href: "/collection/rounds", label: m.roundsTitle }}
      />

      <Section className="mt-6" title={m.askListTitle} language={staff.language}>
        <AskListForm
          fields={fields.map((field) => ({
            id: field.id,
            label: primary({ hi: field.labelHi, en: field.labelEn }, staff.language),
          }))}
        />
      </Section>
    </>
  );
}
