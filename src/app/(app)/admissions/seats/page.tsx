import { requirePermission } from "@/platform/auth/current-staff";
import { loadAdmissionsRosterContext } from "@/modules/students-fees/vx/admissions";

import { loadSeats } from "@/vx/screens/admissions/data";
import { SeatsScreen } from "@/vx/screens/admissions/seats";

export const runtime = "nodejs";

export const metadata = { title: "Seats per class" };

/** Seats per class for the session (admin only). Admissions shows seats left from these. */
export default async function SeatsPage() {
  await requirePermission("settings:manage", "/admissions/seats");
  const ctx = await loadAdmissionsRosterContext();
  const seats = await loadSeats(ctx.sessionLabel);
  return (
    <SeatsScreen
      sessionLabel={ctx.sessionLabel}
      classes={ctx.classes.map((c) => ({ id: c.id, label: c.label, onRoll: c.onRoll, seats: seats.get(c.id) ?? null }))}
    />
  );
}
