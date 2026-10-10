import { getViewSessionCookie } from "@/modules/fees/platform/session-context/cookie";
import { resolveViewSession } from "@/modules/fees/platform/session-context/resolver";
import { getBooksData } from "@/modules/finance-controls/vx/books-data";
import { requirePermission } from "@/platform/auth/current-staff";
import { can } from "@/platform/auth/permissions";
import { schoolToday } from "@/vx/format";
import { Books, type BooksSheet, type BooksView } from "@/vx/screens/accounts/books";
import { getViewer } from "@/vx/view-as";

export const runtime = "nodejs";

const VIEWS: BooksView[] = ["cheques", "upi", "refunds", "requests"];
const SHEETS: BooksSheet[] = ["deposit", "bounce", "upload", "refund"];

function one(value: string | string[] | undefined): string {
  return typeof value === "string" ? value : Array.isArray(value) ? (value[0] ?? "") : "";
}

/**
 * The accountant's books (AccBooks): cheques to deposit, the deposit slip,
 * bounced cheques, UPI matching against the bank statement, refunds and
 * advances, and requests waiting on the admin. `?view=deposit` and
 * `?view=bounce` open the cheques tab with that sheet on top.
 */
export default async function AccountsBooksPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const staff = await requirePermission("fees:view", "/accounts/books");
  const { previewing } = await getViewer();
  const sp = await searchParams;
  const session = await resolveViewSession({ searchParamSession: sp.session, cookieSession: await getViewSessionCookie() });
  const data = await getBooksData({
    staffId: staff.id,
    today: schoolToday(),
    sessionLabel: session.sessionLabel,
    canDecide: can(staff, "fees:manage"),
    canWrite: can(staff, "fees:collect"),
  });

  const askedView = one(sp.view);
  const askedSheet = one(sp.sheet);
  let view: BooksView = (VIEWS as string[]).includes(askedView) ? (askedView as BooksView) : "cheques";
  let sheet: BooksSheet = (SHEETS as string[]).includes(askedSheet) ? (askedSheet as BooksSheet) : "";
  if (askedView === "deposit" || askedView === "bounce") {
    view = "cheques";
    sheet = askedView;
  }
  const pick = one(sp.pick).split(",").map((s) => s.trim()).filter(Boolean).slice(0, 200);
  const receipt = one(sp.receipt) || null;

  return (
    <Books
      data={data}
      initialView={view}
      initialSheet={sheet}
      initialPick={pick}
      initialReceipt={receipt}
      staffName={staff.displayName}
      readOnly={Boolean(previewing)}
    />
  );
}
