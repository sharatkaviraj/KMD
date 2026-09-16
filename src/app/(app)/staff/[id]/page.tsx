import Link from "next/link";
import { notFound } from "next/navigation";
import { Pencil } from "lucide-react";

import { setStaffActiveAction } from "@/app/(app)/staff/actions";
import { m } from "@/messages";
import { requirePermission } from "@/platform/auth/current-staff";
import { can, roleLabel } from "@/platform/auth/permissions";
import {
  flat,
  primary,
  t,
  type Language,
  type Localized,
} from "@/platform/i18n/language";
import { getStaffById } from "@/modules/staff/data/staff-repo";
import { canDeactivate } from "@/modules/staff/domain/staff";
import { Badge, Card, DetailList, Notice } from "@/ui/primitives";
import { Button, buttonClasses } from "@/ui/primitives/button";
import { PageHeader } from "@/ui/shell/app-shell";

export const runtime = "nodejs";

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

export default async function StaffDetailPage(props: PageProps<"/staff/[id]">) {
  const { id } = await props.params;
  const actor = await requirePermission("staff:view", `/staff/${id}`);
  const language = actor.language;
  const person = await getStaffById(id);

  if (!person) {
    notFound();
  }

  const mayManage = can(actor, "staff:manage");
  const deactivation = canDeactivate(person, actor.id);

  return (
    <>
      <PageHeader
        // A name is the same in both languages.
        title={t(person.displayName, person.displayName)}
        description={t(
          `${primary(roleLabel(person.role), "hi")} · ${person.shortName}`,
          `${roleLabel(person.role).en} · ${person.shortName}`,
        )}
        language={language}
        back={{ href: "/staff", label: m.staffTitle }}
        action={
          mayManage ? (
            <Link
              href={`/staff/${person.id}/edit`}
              className={buttonClasses({ variant: "outline", size: "sm" })}
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
              label: m.shortName,
              value: <span className="font-mono">{person.shortName}</span>,
            },
            {
              label: m.teaches,
              value: flat(person.isTeaching ? m.yes : m.no, language),
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

      {!person.userId ? (
        <Notice
          className="mt-4"
          tone="info"
          text={m.staffNoLogin}
          language={language}
        />
      ) : null}

      {mayManage ? (
        <form action={setStaffActiveAction} className="mt-6">
          <input type="hidden" name="id" value={person.id} />
          <input
            type="hidden"
            name="isActive"
            value={person.isActive ? "false" : "true"}
          />
          <Button
            type="submit"
            variant={person.isActive ? "outline" : "primary"}
            fullWidth
            // A disabled button is a hint; the action checks the same rule
            // again, because a hint is not a guard.
            disabled={person.isActive && !deactivation.allowed}
          >
            {primary(person.isActive ? m.deactivate : m.reactivate, language)}
          </Button>
          {person.isActive && deactivation.reason ? (
            <p className="mt-2 text-center text-[13px] text-muted-foreground">
              {flat(deactivation.reason, language)}
            </p>
          ) : null}
        </form>
      ) : null}
    </>
  );
}
