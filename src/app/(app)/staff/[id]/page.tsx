import Link from "next/link";
import { notFound } from "next/navigation";
import { Pencil } from "lucide-react";

import { setStaffActiveAction } from "@/app/(app)/staff/actions";
import { requirePermission } from "@/platform/auth/current-staff";
import { can, roleLabels, roleLabelsEn } from "@/platform/auth/permissions";
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

export default async function StaffDetailPage(props: PageProps<"/staff/[id]">) {
  const { id } = await props.params;
  const actor = await requirePermission("staff:view", `/staff/${id}`);
  const person = await getStaffById(id);

  if (!person) {
    notFound();
  }

  const mayManage = can(actor, "staff:manage");
  const deactivation = canDeactivate(person, actor.id);

  return (
    <>
      <PageHeader
        title={person.displayName}
        titleEn={`${roleLabelsEn[person.role]} · ${person.shortName}`}
        back={{ href: "/staff", label: "स्टाफ़" }}
        action={
          mayManage ? (
            <Link
              href={`/staff/${person.id}/edit`}
              className={buttonClasses({ variant: "outline", size: "sm" })}
            >
              <Pencil aria-hidden />
              बदलें
            </Link>
          ) : null
        }
      />

      {!person.isActive ? (
        <Notice
          className="mb-4"
          tone="warning"
          hi="यह प्रोफ़ाइल निष्क्रिय है।"
          en="Inactive. They stay on past timetables and registers, but will not appear in pickers."
        />
      ) : null}

      <Card className="p-5">
        <DetailList
          items={[
            {
              label: "भूमिका · Role",
              value: `${roleLabels[person.role]} · ${roleLabelsEn[person.role]}`,
            },
            {
              label: "संक्षिप्त नाम · Short name",
              value: <span className="font-mono">{person.shortName}</span>,
            },
            {
              label: "कक्षा लेते हैं · Teaches",
              value: person.isTeaching ? "हाँ · Yes" : "नहीं · No",
            },
            { label: "फ़ोन · Phone", value: formatPhone(person.phone) },
            {
              label: "व्हाट्सएप · WhatsApp",
              value: formatPhone(person.whatsappPhone ?? person.phone),
            },
            {
              label: "भाषा · Language",
              value: person.preferredLanguage === "en" ? "English" : "हिन्दी",
            },
            {
              label: "साइन इन · Signs in",
              value: person.userId ? (
                <Badge tone="success">हाँ · Yes</Badge>
              ) : (
                <Badge tone="neutral">नहीं · No</Badge>
              ),
            },
          ]}
        />
      </Card>

      {!person.userId ? (
        <Notice
          className="mt-4"
          tone="info"
          hi="इनका कोई साइन-इन खाता नहीं है।"
          en="No sign-in account is linked. That is normal for a teacher who is on the timetable but never opens the app. To give them access, create the account in Supabase Auth with their email."
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
            {person.isActive ? "निष्क्रिय करें · Deactivate" : "फिर सक्रिय करें · Reactivate"}
          </Button>
          {person.isActive && !deactivation.allowed ? (
            <p className="mt-2 text-center text-[13px] text-muted-foreground">
              {deactivation.reasonHi} · {deactivation.reasonEn}
            </p>
          ) : null}
        </form>
      ) : null}
    </>
  );
}
