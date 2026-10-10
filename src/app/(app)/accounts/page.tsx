import { getViewSessionCookie } from "@/modules/fees/platform/session-context/cookie";
import { resolveViewSession } from "@/modules/fees/platform/session-context/resolver";
import { getAccountsHomeData } from "@/modules/finance-controls/vx/books-data";
import { requirePermission } from "@/platform/auth/current-staff";
import { can } from "@/platform/auth/permissions";
import { greeting, schoolToday } from "@/vx/format";
import { AccountsHome } from "@/vx/screens/accounts/accounts-home";
import { getViewer } from "@/vx/view-as";

export const runtime = "nodejs";

/**
 * The accountant's Today (AccHome): find a family, the day's money as it
 * comes in, the counter queue, today's jobs, requests waiting on the admin,
 * the 4 pm reminders and closing the day. `?view=menu` is the phone menu;
 * `?view=evening` the summary after the day is closed, which is also what
 * this page opens on once today's collection is closed.
 */
export default async function AccountsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const staff = await requirePermission("fees:view", "/accounts");
  const { previewing } = await getViewer();
  const sp = await searchParams;
  const session = await resolveViewSession({ searchParamSession: sp.session, cookieSession: await getViewSessionCookie() });
  const today = schoolToday();
  const data = await getAccountsHomeData({
    staffId: staff.id,
    today,
    sessionLabel: session.sessionLabel,
    seesAllRequests: can(staff, "fees:manage"),
  });
  const asked = typeof sp.view === "string" ? sp.view : "";
  const view = asked === "menu" || asked === "evening" || asked === "home" ? asked : data.closure?.status === "closed" ? "evening" : "home";
  return (
    <AccountsHome
      data={data}
      view={view}
      greet={greeting()}
      staffName={staff.displayName}
      canCollect={can(staff, "fees:collect")}
      canManage={can(staff, "fees:manage")}
      readOnly={Boolean(previewing)}
    />
  );
}
