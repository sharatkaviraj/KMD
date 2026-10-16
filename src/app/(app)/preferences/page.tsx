import { PrivatePhoto } from "@/modules/collection/ui/private-photo";
import { approvedStaffPhotos } from "@/modules/collection/data/approved-photos";
import { ProfilePhotoControl } from "@/modules/collection/ui/profile-photo-editor";
import { PwaInstallCard } from "@/ui/pwa-install-card";
import { m } from "@/messages";
import { requireStaff } from "@/platform/auth/current-staff";
import { pageTitle } from "@/platform/i18n/page-title";
import {
  resolveStart,
  startOptionHint,
  startOptionsFor,
} from "@/platform/config/start";
import { Card, Section } from "@/ui/primitives";
import { PageHeader } from "@/ui/page-header-localized";

import { LanguageForm } from "./language-form";
import { StartForm, type StartChoice } from "./start-form";

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
  const portraits = await approvedStaffPhotos([staff.id]).catch(() => new Map<string,string>());
  const portrait = portraits.get(staff.id);

  /**
   * Where you start, offered from what this role already reaches.
   *
   * The list is built on the server from permitted native routes,
   * so the radio group cannot contain a destination the account may not open —
   * and the action re-checks the posted value against the same function rather
   * than trusting the list it rendered.
   *
   * Home first, as the absence of a choice. A stored value the role has since
   * lost resolves to null here too, so the form shows what will actually
   * happen rather than what was once chosen.
   */
  const choices: StartChoice[] = [
    {
      value: "",
      label: m.startRoleHome,
      hint: m.startRoleHomeHint,
      external: false,
    },
    ...startOptionsFor(staff.role).map((option) => ({
      value: option.value,
      label: option.label,
      hint: startOptionHint(option),
      external: false,
    })),
  ];

  const current = resolveStart(staff.role, staff.preferredStart)?.value ?? "";

  return (
    <>
      <PageHeader eyebrow={m.eyebrowPersonal} title={m.preferencesTitle} language={staff.language} />

      <PwaInstallCard />
      {portrait ? <PrivatePhoto src={portrait} alt={staff.displayName} className="size-20 rounded-full object-cover" /> : null}
      <ProfilePhotoControl credential={{kind:"staff"}} language={staff.language} />
      <Section title={m.language} description={m.preferencesLanguageHint} language={staff.language}>
        <Card className="p-4">
          <LanguageForm current={staff.language} />
        </Card>
      </Section>

      <Section
        className="mt-7"
        title={m.startTitle}
        description={m.startHint}
        language={staff.language}
      >
        <Card className="p-4">
          <StartForm choices={choices} current={current} />
        </Card>
      </Section>
    </>
  );
}
