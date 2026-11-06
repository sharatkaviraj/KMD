import * as m from "@/messages/pairs";
import { listMessages as lm } from "@/messages/setup";
import { requirePermission } from "@/platform/auth/current-staff";
import { primary, type Language } from "@/platform/i18n/language";
import { pageTitle } from "@/platform/i18n/page-title";
import { listFields } from "@/modules/collection/data/fields-repo";
import {
  fieldInputLabels,
  fieldModeLabels,
  orderFields,
  type CollectionField,
} from "@/modules/collection/domain/fields";
import { FieldForm } from "@/modules/collection/ui/office-forms";
import { retireFieldAction } from "@/app/(app)/collection/actions";
import { Badge, Notice } from "@/ui/primitives";
import { Button } from "@/ui/primitives/button";
import { CollapsibleSection } from "@/ui/primitives/collapsible-section";
import { AddRow, EditRow } from "@/ui/primitives/edit-row";
import { PageHeader } from "@/ui/page-header-localized";

export const runtime = "nodejs";

export async function generateMetadata() {
  return { title: await pageTitle(m.collectionFieldsTitle) };
}

/**
 * The registry: every question the school can ask.
 *
 * Written once and asked many times, which is the whole reason it is a table
 * and not a text box on each request. A key is never renamed — submissions and
 * student records point at it — so a question the school stops asking is
 * retired rather than deleted, and the answers it already has keep meaning
 * what they meant.
 */
export default async function FieldsPage() {
  const staff = await requirePermission("collection:manage", "/collection/fields");
  const language = staff.language;
  const fields = orderFields(await listFields());
  const active = fields.filter((field) => field.isActive);
  const retired = fields.filter((field) => !field.isActive);

  return (
    <>
      <PageHeader eyebrow={m.eyebrowSampark}
        title={m.collectionFieldsTitle}
        description={m.collectionFieldsIntro}
        language={language}
        back={BACK}
      />

      <Notice
        className="mb-5"
        tone="neutral"
        text={m.collectionFieldKeyHint}
        language={language}
      />

      <AddRow className="mb-4" label={primary(lm.addQuestion, language)}>
        <FieldForm />
      </AddRow>

      <ul className="space-y-2">
        {active.map((field) => (
          <li key={field.id}>
            <FieldRow field={field} language={language} />
          </li>
        ))}
      </ul>

      {/* Questions the school stopped asking stay (their answers point at
          them) but out of the way, folded at the bottom. */}
      {retired.length > 0 ? (
        <CollapsibleSection
          className="mt-6"
          title={`${primary(lm.retiredQuestions, language)} (${retired.length})`}
        >
          <ul className="space-y-2">
            {retired.map((field) => (
              <li key={field.id}>
                <FieldRow field={field} language={language} />
              </li>
            ))}
          </ul>
        </CollapsibleSection>
      ) : null}
    </>
  );
}

function FieldRow({ field, language }: { field: CollectionField; language: Language }) {
  return (
    <EditRow
      title={language === "en" ? field.labelEn : field.labelHi}
      subtitle={`${primary(fieldInputLabels[field.inputType], language)} · ${primary(fieldModeLabels[field.mode], language)}`}
      badge={
        !field.isActive ? <Badge tone="neutral">{primary(m.collectionRetired, language)}</Badge> : null
      }
      editLabel={primary(m.edit, language)}
    >
      <p className="mb-3 truncate font-mono text-[12px] text-subtle-foreground">{field.key}</p>
      <FieldForm field={field} />

      <form action={retireFieldAction} className="mt-2">
        <input type="hidden" name="id" value={field.id} />
        <input type="hidden" name="active" value={field.isActive ? "false" : "true"} />
        <Button type="submit" variant="ghost" size="sm" fullWidth>
          {primary(field.isActive ? m.collectionRetire : m.collectionRestore, language)}
        </Button>
      </form>
    </EditRow>
  );
}

const BACK = { href: "/collection", label: m.collectionTitle };
