import { getViewSessionCookie } from "@/modules/fees/platform/session-context/cookie";
import { resolveViewSession } from "@/modules/fees/platform/session-context/resolver";
import { getAccountsHomeData } from "@/modules/finance-controls/vx/books-data";
import { requirePermission } from "@/platform/auth/current-staff";
import { schoolNow } from "@/platform/auth/qa-clock";
import { can } from "@/platform/auth/permissions";
import { dayBookClosure } from "@/modules/receipts/vx/domain/day-close";
import { listCloseEvents } from "@/vx/screens/receipts/data";
import { greeting, schoolToday } from "@/vx/format";
import { AccountsHome } from "@/vx/screens/accounts/accounts-home";
import { getViewer } from "@/vx/view-as";
import { usesCanonicalFees } from "@/platform/fees-bridge/policy";
import { LiveFinanceHub } from "@/vx/screens/accounts/live-finance-hub";

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
  const bridgeSession=typeof sp.session==="string"?sp.session:await getViewSessionCookie();
  if(usesCanonicalFees(staff,bridgeSession))return <LiveFinanceHub language={staff.language}/>;
  const session = await resolveViewSession({ searchParamSession: sp.session, cookieSession: await getViewSessionCookie() });
  // The school clock: real for everyone, a QA/Smoke Lab account's pretend
  // time where one is set (D-269). It decides what the page says about the
  // time of day; every write still uses the real clock.
  const now = await schoolNow(staff);
  const today = schoolToday(now);
  const [home, events] = await Promise.all([
    getAccountsHomeData({
      staffId: staff.id,
      today,
      sessionLabel: session.sessionLabel,
      seesAllRequests: can(staff, "fees:manage"),
    }),
    listCloseEvents(today, today, { sessionLabel: session.sessionLabel }).catch(() => []),
  ]);
  // The day is closed on Receipts; Today says so too, as the Day book does
  // (verification N5: "close it in Receipts" after it was closed there).
  const data = { ...home, closure: dayBookClosure(home.closure, events) };
  const asked = typeof sp.view === "string" ? sp.view : "";
  const view = asked === "menu" || asked === "evening" || asked === "home" ? asked : data.closure?.status === "closed" ? "evening" : "home";
  return (
    <AccountsHome
      data={data}
      view={view}
      greet={greeting(now)}
      nowIso={now.toISOString()}
      staffName={staff.displayName}
      canCollect={can(staff, "fees:collect")}
      canAccounts={can(staff, "fees:accounts")}
      canManage={can(staff, "fees:manage")}
      roleName={staff.role}
      readOnly={Boolean(previewing)}
    />
  );
}
