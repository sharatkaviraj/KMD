import { requirePermission } from "@/platform/auth/current-staff";
import { loadStaffScreen } from "@/vx/screens/staff/data";
import { StaffScreen } from "@/vx/screens/staff/staff-screen";

export const runtime = "nodejs";

export const metadata = { title: "Staff & roles" };

const SHEETS = ["invite", "reset", "deactivate", "add", "role"] as const;
type Sheet = (typeof SHEETS)[number];

/** Staff & roles (design `Staff`): people, logins and the editable role matrix. */
export default async function StaffPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; id?: string; sheet?: string }>;
}) {
  await requirePermission("staff:view", "/staff");
  const params = await searchParams;
  const data = await loadStaffScreen();
  const sheet = SHEETS.includes(params.sheet as Sheet) ? (params.sheet as Sheet) : null;
  const id = typeof params.id === "string" && data.rows.some((row) => row.id === params.id) ? params.id : null;

  return (
    <StaffScreen
      rows={data.rows}
      load={data.load}
      matrix={data.matrix}
      roleCounts={data.roleCounts}
      events={data.events}
      sessionLabel={data.sessionLabel}
      mayManage={data.mayManage}
      isAdmin={data.isAdmin}
      mayEditMatrix={data.mayEditMatrix}
      meId={data.meId}
      initialView={params.view === "roles" ? "roles" : "people"}
      initialId={id}
      initialSheet={sheet}
    />
  );
}
