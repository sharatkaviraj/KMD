import { m } from "@/messages";
import { requirePermission } from "@/platform/auth/current-staff";
import { primary, t } from "@/platform/i18n/language";
import { pageTitle } from "@/platform/i18n/page-title";
import { resolveSessionLabel } from "@/modules/academics/data/academics-repo";
import { listCoverPolicies } from "@/modules/substitutions/data/policies-repo";
import {
  coverRoleLabels,
  isFullDay,
  policyFor,
} from "@/modules/substitutions/domain/policies";
import { describePeriods } from "@/modules/substitutions/domain/plan";
import { PolicyForm } from "@/modules/substitutions/ui/policy-form";
import { clearCoverPolicyAction } from "@/app/(app)/substitutions/actions";
import { listStaff } from "@/modules/staff/data/staff-repo";
import { Badge, Card, Notice } from "@/ui/primitives";
import { Button } from "@/ui/primitives/button";
import { EmptyState } from "@/ui/states";
import { PageHeader } from "@/ui/shell/app-shell";

export const runtime = "nodejs";

export async function generateMetadata() {
  return { title: await pageTitle(m.subsPoliciesTitle) };
}

/**
 * Who can cover which period.
 *
 * The engine this was ported from shipped these as constants in its source,
 * with one teacher's part-time hours written into the file — so the school
 * could not change its own hours without a deploy, and a real name lived in a
 * repository (rule 6). This screen is what replaced them.
 *
 * Everybody is listed, whether or not they have a row: absence of a row means
 * the full day, an ordinary teacher and the default cap, and a coordinator
 * should not have to know which of those is stored and which is assumed.
 */
export default async function CoverPoliciesPage() {
  const staff = await requirePermission(
    "substitutions:manage",
    "/substitutions/policies",
  );
  const language = staff.language;
  const sessionLabel = await resolveSessionLabel();

  if (!sessionLabel) {
    return (
      <>
        <PageHeader title={m.subsPoliciesTitle} language={language} back={BACK} />
        <EmptyState title={m.noSessionFound} language={language} />
      </>
    );
  }

  const [policies, everybody] = await Promise.all([
    listCoverPolicies(sessionLabel),
    listStaff(),
  ]);

  const people = everybody
    .filter((person) => person.isActive)
    .sort((a, b) => a.displayName.localeCompare(b.displayName, "en"));

  return (
    <>
      <PageHeader
        title={m.subsPoliciesTitle}
        description={m.subsPoliciesHint}
        language={language}
        back={BACK}
      />

      <Notice
        className="mb-5"
        tone="neutral"
        text={t(
          "जिनकी कोई प्रविष्टि नहीं है वे पूरे दिन उपलब्ध माने जाते हैं।",
          "Anybody without an entry is taken to be here all day, as an ordinary teacher.",
        )}
        language={language}
      />

      <ul className="space-y-3">
        {people.map((person) => {
          const stored = policies.find(
            (policy) => policy.staffProfileId === person.id,
          );
          const effective = policyFor(policies, person.id);

          return (
            <li key={person.id}>
              <Card className="p-4">
                <div className="mb-3 flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-[15px] font-semibold text-foreground">
                      {person.displayName}
                    </p>
                    <p className="truncate text-[12px] text-subtle-foreground">
                      {person.shortName} ·{" "}
                      {isFullDay(effective.allowedPeriods)
                        ? primary(m.subsFullDay, language)
                        : describePeriods(effective.allowedPeriods)}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    {effective.coverRole !== "normal" ? (
                      <Badge
                        tone={effective.coverRole === "reserve" ? "neutral" : "warning"}
                      >
                        {primary(coverRoleLabels[effective.coverRole], language)}
                      </Badge>
                    ) : null}
                  </div>
                </div>

                <PolicyForm
                  staffProfileId={person.id}
                  allowedPeriods={effective.allowedPeriods}
                  coverRole={effective.coverRole}
                  maxAutoCovers={effective.maxAutoCovers}
                  note={stored?.note ?? null}
                />

                {stored ? (
                  // Deleting the row rather than writing the defaults into it:
                  // "nobody has said anything about this person" and "somebody
                  // decided they work the full day" should not look the same.
                  <form action={clearCoverPolicyAction} className="mt-2">
                    <input type="hidden" name="staffProfileId" value={person.id} />
                    <Button type="submit" variant="ghost" size="sm" fullWidth>
                      {primary(m.subsPolicyReset, language)}
                    </Button>
                  </form>
                ) : null}
              </Card>
            </li>
          );
        })}
      </ul>
    </>
  );
}

const BACK = { href: "/substitutions", label: m.subsTitle };
