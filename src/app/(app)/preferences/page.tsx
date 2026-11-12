import { PrivatePhoto } from "@/modules/collection/ui/private-photo";
import { approvedStaffPhotos } from "@/modules/collection/data/approved-photos";
import { ProfilePhotoControl } from "@/modules/collection/ui/profile-photo-editor";
import { PwaInstallCard } from "@/ui/pwa-install-card";
import * as m from "@/messages/pairs";
import { photoMessages } from "@/messages/setup";
import { initials } from "@/vx/format";
import { requireStaff } from "@/platform/auth/current-staff";
import { pageTitle } from "@/platform/i18n/page-title";
import {
  resolveStart,
  startOptionHint,
  startOptionsFor,
} from "@/platform/config/start";
import { Card, Section } from "@/ui/primitives";
import { PageHeader } from "@/ui/page-header-localized";

import { staffWhatsappMessages } from "@/messages/setup";
import { dayLabel } from "@/platform/dates";
import { readNoticePrefs, readStaffConsent } from "@/modules/staff-notices/data/consent";
import { KINDS, STAFF_MESSAGE_KINDS } from "@/modules/staff-notices/domain/kinds";

import { loadWhatsappLink } from "@/modules/whatsapp/data/staff-link";
import { staffLanguage } from "@/modules/whatsapp/domain/helper-handoff";
import { LinkWhatsapp } from "@/vx/ui/link-whatsapp";

import { aiConnectionMessages } from "@/messages/ai-connection";
import { loadAiConnectionCard } from "@/modules/mcp/data/card";
import { AiConnectionCard } from "@/modules/mcp/ui/connection-card";

import { disconnectMyAiConnectionAction } from "./ai-connection-actions";
import { LanguageForm } from "./language-form";
import { WhatsappForm } from "./whatsapp-form";
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

  // WhatsApp from the school app (go-live Phase F): their own consent and switches.
  const lookOnly = Boolean(staff.viewedBy);
  const [consent, prefs, aiCard, link] = await Promise.all([
    readStaffConsent(staff.id),
    readNoticePrefs(staff.id),
    // The AI connection card (plan §8.1): eligible staff only; a failed read hides it rather than guessing a state.
    loadAiConnectionCard(staff).catch(() => null),
    // Link my WhatsApp (D-581): yes from their own phone, which replaces the yes/stop buttons.
    loadWhatsappLink(staff.id, staffLanguage(staff.language), lookOnly).catch(() => null),
  ]);
  const consentDay = consent.state === "yes" ? consent.optInAt : consent.state === "opted_out" ? consent.optOutAt : null;
  const consentSince = consentDay ? dayLabel(consentDay.slice(0, 10)) : null;

  return (
    <>
      <PageHeader eyebrow={m.eyebrowPersonal} title={m.preferencesTitle} language={staff.language} />

      <PwaInstallCard />
      <Section className="mt-7" title={photoMessages.title} language={staff.language}>
        <Card className="flex items-center gap-4 p-4">
          {portrait ? (
            <PrivatePhoto src={portrait} alt={staff.displayName} className="size-16 shrink-0 rounded-full object-cover" />
          ) : (
            <span aria-hidden className="flex size-16 shrink-0 items-center justify-center rounded-full bg-accent-soft text-xl font-semibold text-accent">{initials(staff.displayName)}</span>
          )}
          <div className="min-w-0 flex-1">
            <p className="truncate font-medium">{staff.displayName}</p>
            <ProfilePhotoControl credential={{ kind: "staff" }} language={staff.language} />
          </div>
        </Card>
      </Section>

      <Section className="mt-7" title={m.language} description={m.preferencesLanguageHint} language={staff.language}>
        <Card className="p-4">
          <LanguageForm current={staff.language} />
        </Card>
      </Section>

      <Section className="mt-7" title={staffWhatsappMessages.title} language={staff.language}>
        <Card className="p-4">
          <WhatsappForm
            state={consent.state}
            since={consentSince}
            hasNumber={consent.hasNumber}
            kinds={STAFF_MESSAGE_KINDS.map((kind) => ({ kind, label: KINDS[kind].label, enabled: prefs[kind] }))}
            linkCard={
              link?.card ? (
                // The vx tokens for the card; a classic page's own are a different shape (UI-2).
                <div className="vx lw-host">
                  <LinkWhatsapp card={link.card} pending={link.pending} live={link.live} lookOnly={lookOnly} />
                </div>
              ) : undefined
            }
          />
        </Card>
      </Section>

      {aiCard ? (
        // Today's AI line links here (/preferences#ai-connection).
        <div id="ai-connection" className="scroll-mt-20">
        <Section className="mt-7" title={aiConnectionMessages.cardTitle} language={staff.language}>
          <AiConnectionCard
            state={aiCard.state}
            address={aiCard.address}
            language={staff.language}
            now={aiCard.now}
            disconnect={disconnectMyAiConnectionAction}
          />
        </Section>
        </div>
      ) : null}

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
