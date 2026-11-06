import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Pencil } from "lucide-react";

import { recordWhatsappConsentAction, setStaffActiveAction, setTestAccountAction } from "@/app/(app)/staff/actions";
import * as m from "@/messages/pairs";
import { staffWhatsappMessages, testSessionMessages } from "@/messages/setup";
import { readStaffConsent } from "@/modules/staff-notices/data/consent";
import { isRealAdmin } from "@/platform/auth/test-session-policy";
import { requirePermission } from "@/platform/auth/current-staff";
import { can, roleLabel } from "@/platform/auth/permissions";
import {
  flat,
  primary,
  t,
  type Language,
  type Localized,
} from "@/platform/i18n/language";
import { createAdminClient } from "@/platform/supabase/admin";
import { classLabelMap, resolveSessionLabel } from "@/modules/academics/data/academics-repo";
import { getStaffById } from "@/modules/staff/data/staff-repo";
import { canDeactivate, mayChangeAuthority } from "@/modules/staff/domain/staff";
import { listCoverPolicies } from "@/modules/substitutions/data/policies-repo";
import { coverRoleLabels, isFullDay } from "@/modules/substitutions/domain/policies";
import { getPublishedVersion, listSlots } from "@/modules/timetable/data/timetable-repo";
import { periodNumber } from "@/modules/timetable/domain/periods";
import { schoolToday } from "@/platform/dates";
import { Badge, Card, DetailList, Notice } from "@/ui/primitives";
import { Button, buttonClasses } from "@/ui/primitives/button";
import { PageHeader } from "@/ui/page-header-localized";

export const runtime = "nodejs";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function formatPhone(value: string | null) {
  if (!value) return "—";
  // 98765 43210 — the grouping the school reads numbers in.
  return `${value.slice(0, 5)} ${value.slice(5)}`;
}

const LANGUAGE_LABEL: Record<Language, Localized> = {
  hi: m.languageHindi,
  en: m.languageEnglish,
  both: m.languageBoth,
};

/**
 * What a person does in school this session: the class they are class
 * teacher of, what they teach, and their cover rule. Each read is its own;
 * one that fails leaves its line out rather than the page.
 */
async function workFor(staffId: string) {
  const sessionLabel = await resolveSessionLabel();
  if (!sessionLabel) return { classTeacherOf: [] as string[], teaches: [] as string[], policy: null };
  const today = schoolToday();
  const [labels, classTeacher, published, policies, subjects] = await Promise.all([
    classLabelMap(sessionLabel).catch(() => new Map<string, string>()),
    createAdminClient()
      .from("class_teachers")
      .select("class_id, effective_from, effective_to")
      .eq("session_label", sessionLabel)
      .eq("staff_profile_id", staffId)
      .returns<{ class_id: string; effective_from: string; effective_to: string | null }[]>()
      .then((result) => result.data ?? []),
    getPublishedVersion(sessionLabel).catch(() => null),
    listCoverPolicies(sessionLabel).catch(() => []),
    createAdminClient().from("subjects").select("id, code, name_en").returns<{ id: string; code: string; name_en: string | null }[]>().then((result) => result.data ?? []),
  ]);
  const slots = published ? await listSlots(published.id).catch(() => []) : [];
  const subjectName = new Map(subjects.map((s) => [s.id, s.name_en || s.code]));
  const byClass = new Map<string, Set<string>>();
  for (const slot of slots) {
    if (slot.staffProfileId !== staffId) continue;
    const label = labels.get(slot.classId) ?? slot.classLabel;
    byClass.set(label, (byClass.get(label) ?? new Set()).add(subjectName.get(slot.subjectId) ?? slot.subjectCode));
  }
  return {
    classTeacherOf: classTeacher
      .filter((row) => row.effective_from <= today && (!row.effective_to || row.effective_to >= today))
      .map((row) => labels.get(row.class_id) ?? "—"),
    teaches: [...byClass.entries()].map(([label, names]) => `${label} · ${[...names].join(", ")}`),
    policy: policies.find((policy) => policy.staffProfileId === staffId) ?? null,
  };
}

/** `staff_profiles.is_test_account` for one profile. A failed read shows "no". */
async function readIsTestAccount(staffId: string): Promise<boolean> {
  const { data } = await createAdminClient()
    .from("staff_profiles")
    .select("is_test_account")
    .eq("id", staffId)
    .maybeSingle<{ is_test_account: boolean | null }>();
  return data?.is_test_account === true;
}

/**
 * One member of staff. `/staff/roles` and any other id that is not a profile
 * id used to reach the database and throw (React #441, "Something went
 * wrong"); the roles view lives at `/staff?view=roles`, and anything else is
 * not found (smoke run, 20 Oct).
 */
export default async function StaffDetailPage(props: PageProps<"/staff/[id]">) {
  const { id } = await props.params;
  if (id === "roles") redirect("/staff?view=roles");
  const actor = await requirePermission("staff:view", "/staff");
  if (!UUID.test(id)) notFound();
  const language = actor.language;
  const person = await getStaffById(id);

  if (!person) {
    notFound();
  }

  const mayManage = can(actor, "staff:manage");
  const mayCoverRules = can(actor, "substitutions:manage");
  // Switching access on or off is the administrator's alone (D-205); the
  // office still edits the record through the Edit button.
  const maySwitchAccess = mayChangeAuthority(actor.role);
  const deactivation = canDeactivate(person, actor.id);
  const mayMarkTest = isRealAdmin(actor) && person.id !== actor.id;
  const [work, personIsTest, consent] = await Promise.all([
    workFor(person.id),
    mayMarkTest ? readIsTestAccount(person.id) : Promise.resolve(false),
    maySwitchAccess ? readStaffConsent(person.id) : Promise.resolve(null),
  ]);
  const policy = work.policy;
  const policyLine: Localized = !policy
    ? t("सामान्य · कोई अलग नियम नहीं", "Ordinary · no rule of their own")
    : t(
        `${primary(coverRoleLabels[policy.coverRole], "hi")} · दिन में अधिकतम ${policy.maxAutoCovers} अपने-आप${isFullDay(policy.allowedPeriods) ? "" : ` · केवल P${policy.allowedPeriods.map((x) => periodNumber(x)).join(", P")}`}`,
        `${coverRoleLabels[policy.coverRole].en} · up to ${policy.maxAutoCovers} a day by the app${isFullDay(policy.allowedPeriods) ? "" : ` · only P${policy.allowedPeriods.map((x) => periodNumber(x)).join(", P")}`}`,
      );

  return (
    <>
      <PageHeader eyebrow={m.eyebrowAdministration}
        // A name is the same in both languages.
        title={t(person.displayName, person.displayName)}
        description={t(
          `${primary(roleLabel(person.role), "hi")} · ${person.shortName}`,
          `${roleLabel(person.role).en} · ${person.shortName}`,
        )}
        language={language}
        back={{ href: `/staff?id=${person.id}`, label: m.staffTitle }}
        action={
          mayManage ? (
            <Link
              href={`/staff/${person.id}/edit`}
              className={buttonClasses({ variant: "primary", size: "sm" })}
            >
              <Pencil aria-hidden />
              {primary(m.edit, language)}
            </Link>
          ) : null
        }
      />

      {!person.isActive ? (
        <Notice
          className="mb-4"
          tone="warning"
          text={m.staffInactiveNotice}
          language={language}
        />
      ) : null}

      <Card className="p-5">
        <DetailList
          language={language}
          items={[
            { label: m.role, value: flat(roleLabel(person.role), language) },
            {
              label: t("कक्षा अध्यापक", "Class teacher of"),
              value: work.classTeacherOf.length ? work.classTeacherOf.join(", ") : "—",
            },
            {
              label: t("पढ़ाते हैं", "Teaches"),
              value: work.teaches.length ? (
                <span className="flex flex-col gap-0.5">
                  {work.teaches.map((line) => (
                    <span key={line}>{line}</span>
                  ))}
                </span>
              ) : (
                flat(person.isTeaching ? t("समय-सारणी में अभी कोई पीरियड नहीं", "No periods in the timetable yet") : m.no, language)
              ),
            },
            {
              label: m.shortName,
              value: <span className="font-mono">{person.shortName}</span>,
            },
            { label: m.phone, value: formatPhone(person.phone) },
            {
              label: m.whatsapp,
              value: formatPhone(person.whatsappPhone ?? person.phone),
            },
            {
              label: m.language,
              value: flat(LANGUAGE_LABEL[person.language], language),
            },
            {
              label: m.signsIn,
              value: person.userId ? (
                <Badge tone="success">{flat(m.yes, language)}</Badge>
              ) : (
                <Badge tone="neutral">{flat(m.no, language)}</Badge>
              ),
            },
          ]}
        />
      </Card>

      {person.isTeaching ? (
        <Card className="mt-4 p-5">
          <DetailList
            language={language}
            items={[
              { label: t("व्यवस्था का नियम", "Cover rule"), value: flat(policyLine, language) },
              ...(policy?.note ? [{ label: t("टिप्पणी", "Note"), value: policy.note }] : []),
            ]}
          />
          {mayCoverRules ? (
            <Link href="/substitutions/policies" className={`${buttonClasses({ variant: "outline", size: "sm" })} mt-3`}>
              {primary(t("व्यवस्था का नियम बदलें", "Change the cover rule"), language)}
            </Link>
          ) : null}
        </Card>
      ) : null}

      {!person.userId ? (
        <Notice
          className="mt-4"
          tone="info"
          text={m.staffNoLogin}
          language={language}
        />
      ) : null}

      {consent ? (
        // WhatsApp consent (go-live Phase F): an administrator records a yes
        // collected on the training form or in person, or a no.
        <div className="mt-8 border-t border-border pt-4" data-testid="whatsapp-consent-admin">
          <p className="mb-1 text-[13px] font-semibold">
            {flat(staffWhatsappMessages.staffTitle, language)}
            {" · "}
            {flat(
              consent.state === "yes"
                ? staffWhatsappMessages.stateYes
                : consent.state === "opted_out"
                  ? staffWhatsappMessages.stateOptedOut
                  : staffWhatsappMessages.stateNo,
              language,
            )}
            {consent.state === "yes" && consent.optInSource
              ? ` · ${flat(
                  consent.optInSource === "form"
                    ? staffWhatsappMessages.viaForm
                    : consent.optInSource === "self"
                      ? staffWhatsappMessages.viaSelf
                      : staffWhatsappMessages.viaAdmin,
                  language,
                )}`
              : ""}
          </p>
          <p className="mb-2 text-[13px] text-muted-foreground">{flat(staffWhatsappMessages.staffHelp, language)}</p>
          {!consent.hasNumber ? (
            <p className="mb-2 text-[13px] text-muted-foreground">{flat(staffWhatsappMessages.noNumber, language)}</p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            {(
              [
                ["form", staffWhatsappMessages.recordForm],
                ["admin_recorded", staffWhatsappMessages.recordInPerson],
                ["no", staffWhatsappMessages.recordOptOut],
              ] as const
            ).map(([value, label]) => (
              <form key={value} action={recordWhatsappConsentAction}>
                <input type="hidden" name="id" value={person.id} />
                <input type="hidden" name="consent" value={value} />
                <Button type="submit" variant="outline" size="sm">
                  {primary(label, language)}
                </Button>
              </form>
            ))}
          </div>
        </div>
      ) : null}

      {mayMarkTest ? (
        // A test account sees and writes TEST-2026-27 only (Phase 3, D-340).
        // Only a real administrator sees this, and never on their own row.
        <form action={setTestAccountAction} className="mt-8 border-t border-border pt-4" data-testid="test-account-form">
          <input type="hidden" name="id" value={person.id} />
          <input type="hidden" name="isTestAccount" value={personIsTest ? "false" : "true"} />
          <p className="mb-1 text-[13px] font-semibold">
            {flat(testSessionMessages.testAccount, language)}
            {" · "}
            {flat(personIsTest ? m.yes : m.no, language)}
          </p>
          <p className="mb-2 text-[13px] text-muted-foreground">{flat(testSessionMessages.testAccountHelp, language)}</p>
          <label className="mb-2 flex flex-col gap-1 text-[13px]">
            {flat(testSessionMessages.reasonLabel, language)}
            <input name="reason" required maxLength={500} className="rounded-md border border-border bg-surface px-2 py-1.5" />
          </label>
          <Button type="submit" variant="outline" size="sm">
            {primary(personIsTest ? testSessionMessages.unmarkTest : testSessionMessages.markTest, language)}
          </Button>
        </form>
      ) : null}

      {maySwitchAccess ? (
        // Turning access off is the rare, serious step: last on the page, not
        // the largest button on it.
        <form action={setStaffActiveAction} className="mt-8 border-t border-border pt-4">
          <input type="hidden" name="id" value={person.id} />
          <input
            type="hidden"
            name="isActive"
            value={person.isActive ? "false" : "true"}
          />
          <p className="mb-2 text-[13px] text-muted-foreground">
            {flat(
              person.isActive
                ? t("बंद करने पर वे लॉगिन नहीं कर सकेंगे; उनके रिकॉर्ड रहेंगे।", "Turning access off stops them signing in; their records stay.")
                : t("चालू करने पर वे फिर लॉगिन कर सकेंगे।", "Turning access on lets them sign in again."),
              language,
            )}
          </p>
          <Button
            type="submit"
            variant={person.isActive ? "outline" : "primary"}
            size="sm"
            // A disabled button is a hint; the action checks the same rule
            // again, because a hint is not a guard.
            disabled={person.isActive && !deactivation.allowed}
          >
            {primary(person.isActive ? m.deactivate : m.reactivate, language)}
          </Button>
          {person.isActive && deactivation.reason ? (
            <p className="mt-2 text-[13px] text-muted-foreground">
              {flat(deactivation.reason, language)}
            </p>
          ) : null}
        </form>
      ) : null}
    </>
  );
}
