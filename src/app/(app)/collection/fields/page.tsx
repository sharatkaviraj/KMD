import { m } from "@/messages";
import { requirePermission } from "@/platform/auth/current-staff";
import { primary } from "@/platform/i18n/language";
import { pageTitle } from "@/platform/i18n/page-title";
import { listFields } from "@/modules/collection/data/fields-repo";
import {
  fieldInputLabels,
  fieldModeLabels,
  orderFields,
} from "@/modules/collection/domain/fields";
import { FieldForm } from "@/modules/collection/ui/office-forms";
import { retireFieldAction } from "@/app/(app)/collection/actions";
import { Badge, Card, Notice, Section } from "@/ui/primitives";
import { Button } from "@/ui/primitives/button";
import { PageHeader } from "@/ui/shell/app-shell";

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

  return (
    <>
      <PageHeader
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

      <ul className="space-y-3">
        {fields.map((field) => (
          <li key={field.id}>
            <Card className="p-4">
              <div className="mb-3 flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-[15px] font-semibold text-foreground">
                    {language === "en" ? field.labelEn : field.labelHi}
                  </p>
                  <p className="truncate text-[12px] text-subtle-foreground">
                    <span className="font-mono">{field.key}</span> ·{" "}
                    {primary(fieldInputLabels[field.inputType], language)} ·{" "}
                    {primary(fieldModeLabels[field.mode], language)}
                  </p>
                </div>
                {!field.isActive ? (
                  <Badge tone="neutral">
                    {primary(m.collectionRetired, language)}
                  </Badge>
                ) : null}
              </div>

              <FieldForm field={field} />

              <form action={retireFieldAction} className="mt-2">
                <input type="hidden" name="id" value={field.id} />
                <input
                  type="hidden"
                  name="active"
                  value={field.isActive ? "false" : "true"}
                />
                <Button type="submit" variant="ghost" size="sm" fullWidth>
                  {primary(
                    field.isActive ? m.collectionRetire : m.collectionRestore,
                    language,
                  )}
                </Button>
              </form>
            </Card>
          </li>
        ))}
      </ul>

      <Section className="mt-8" title={m.add} language={language}>
        <Card className="p-4">
          <FieldForm />
        </Card>
      </Section>
    </>
  );
}

const BACK = { href: "/collection", label: m.collectionTitle };
