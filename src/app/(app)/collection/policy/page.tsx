import * as m from "@/messages/pairs";
import { ms } from "@/messages/setup";
import { requirePermission } from "@/platform/auth/current-staff";
import { can } from "@/platform/auth/permissions";
import { primary } from "@/platform/i18n/language";
import { pageTitle } from "@/platform/i18n/page-title";
import { parentDispatchSwitch, parentPolicies } from "@/modules/collection/data/parent-messages-repo";
import { ParentPolicyForm } from "@/modules/collection/ui/parent-policy-form";
import { Badge, Card, Notice } from "@/ui/primitives";
import { PageHeader } from "@/ui/page-header-localized";

export const runtime = "nodejs";

export async function generateMetadata() {
  return { title: await pageTitle(ms.policyTitle) };
}

/**
 * The parent message policy (P9): per category, whether a person approves
 * every message — the default — or the automatic exception the school named
 * instead. Read by whoever sends parent messages; changed only by an
 * administrator, because it decides what reaches a family without a person.
 */
export default async function ParentPolicyPage() {
  const staff = await requirePermission("collection:manage", "/collection/policy");
  const language = staff.language;
  const [policies, switchOn] = await Promise.all([parentPolicies(), parentDispatchSwitch()]);
  const admin = can(staff, "jobs:run");

  return (
    <>
      <PageHeader
        eyebrow={m.eyebrowSampark}
        title={ms.policyTitle}
        language={language}
        back={{ href: "/collection/messages", label: m.messagesTitle }}
      />

      <Notice className="mb-4" tone="info" text={ms.policyIntro} language={language} />
      {!switchOn ? <Notice className="mb-5" tone="neutral" text={ms.policySwitchOff} language={language} /> : null}

      <ul className="space-y-3">
        {policies.map((policy) => (
          <li key={policy.category}>
            <Card className="p-4">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <p className="text-[15px] font-semibold text-foreground">
                  {language === "en" ? policy.labelEn : policy.labelHi}
                </p>
                <div className="flex gap-1.5">
                  <Badge tone={policy.approvalRequired ? "success" : "warning"}>
                    {primary(policy.approvalRequired ? ms.policyApprovalShort : ms.policyAutomatic, language)}
                  </Badge>
                  <Badge tone="neutral">
                    {primary(ms.policyVersion, language)} {policy.policyVersion}
                  </Badge>
                </div>
              </div>
              {admin ? (
                <ParentPolicyForm policy={policy} />
              ) : !policy.approvalRequired ? (
                <dl className="grid gap-1 text-[13px] text-muted-foreground">
                  <div className="flex gap-1">
                    <dt>{primary(ms.policyRecipients, language)}:</dt>
                    <dd className="text-foreground">{policy.autoRecipients}</dd>
                  </div>
                  <div className="flex gap-1">
                    <dt>{primary(ms.policyTrigger, language)}:</dt>
                    <dd className="text-foreground">{policy.autoTrigger}</dd>
                  </div>
                  <div className="flex gap-1">
                    <dt>{primary(ms.policyContent, language)}:</dt>
                    <dd className="text-foreground">{policy.autoContent}</dd>
                  </div>
                  <div className="flex gap-1">
                    <dt>{primary(ms.policyCorrection, language)}:</dt>
                    <dd className="text-foreground">{policy.autoCorrection}</dd>
                  </div>
                </dl>
              ) : null}
            </Card>
          </li>
        ))}
      </ul>
    </>
  );
}
