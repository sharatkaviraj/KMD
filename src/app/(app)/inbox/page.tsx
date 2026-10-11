import { requirePermission } from "@/platform/auth/current-staff";
import { can } from "@/platform/auth/permissions";
import { resolveSessionLabel } from "@/modules/academics/data/academics-repo";
import { pendingMoneyRequests } from "@/modules/dashboard/vx/admin-today";
import { schoolToday } from "@/vx/format";
import { sortInbox } from "@/vx/screens/admin/logic";
import { loadInbox } from "@/vx/screens/admin/data";
import { InboxScreen } from "@/vx/screens/admin/inbox";
import { T } from "@/vx/screens/admin/text";
import { lead } from "@/vx/text";
import { Section, TopBar, VxPage } from "@/vx/ui/page";
import { EmptyState } from "@/vx/ui/primitives";
import { getViewer } from "@/vx/view-as";

export const runtime = "nodejs";

export const metadata = { title: "Needs you" };

/**
 * Needs you (P5, design F02/D03): attendance not marked, cover that needs a
 * teacher, correction requests, answers to check, refunds and failed jobs —
 * each from the queue that already owns it, each decided through that
 * queue's own action.
 */
export default async function InboxPage(props: PageProps<"/inbox">) {
  const staff = await requirePermission("attendance:correct", "/inbox");
  const { previewing } = await getViewer();
  const params = await props.searchParams;
  const item = typeof params.item === "string" ? params.item : null;
  const sessionLabel = await resolveSessionLabel();

  if (!sessionLabel) {
    return (
      <VxPage>
        <TopBar title={lead(T.needsYou, staff.language)} />
        <main>
          <Section>
            <EmptyState icon="calendar" title={lead(T.noSession, staff.language)} />
          </Section>
        </main>
      </VxPage>
    );
  }

  const { items, unavailable } = await loadInbox(staff, sessionLabel, schoolToday(), {
    refunds: can(staff, "fees:view") ? pendingMoneyRequests : undefined,
  });

  return (
    <VxPage label={lead(T.needsYou, staff.language)}>
      <InboxScreen items={sortInbox(items)} initial={item} previewing={previewing !== null} unavailable={unavailable.length > 0} scope={{ accountId: staff.userId, sessionLabel, day: schoolToday() }} />
    </VxPage>
  );
}
