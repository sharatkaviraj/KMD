import { m } from "@/messages";
import { requireStaff } from "@/platform/auth/current-staff";
import { pageTitle } from "@/platform/i18n/page-title";
import { Card, Section } from "@/ui/primitives";
import { PageHeader } from "@/ui/shell/app-shell";

import { LanguageForm } from "./language-form";

export const runtime = "nodejs";

export async function generateMetadata() {
  return { title: await pageTitle(m.preferencesTitle) };
}

/**
 * The settings that belong to one person rather than to the school.
 *
 * Just the language for now, and that one matters more than a settings screen
 * usually does: until this existed, the only way to change the language you
 * read the app in was to ask an admin to open your staff profile — so the
 * setting that decides whether you can read the screen at all needed somebody
 * else to change it (PLAN §3a).
 *
 * Guarded on being staff and nothing more. It writes one column on the row
 * that belongs to whoever is asking, found by their own `user_id`, so there is
 * no id to tamper with and nothing a permission would add.
 */
export default async function PreferencesPage() {
  const staff = await requireStaff("/preferences");

  return (
    <>
      <PageHeader title={m.preferencesTitle} language={staff.language} />

      <Section title={m.language} description={m.preferencesLanguageHint} language={staff.language}>
        <Card className="p-4">
          <LanguageForm current={staff.language} />
        </Card>
      </Section>
    </>
  );
}
