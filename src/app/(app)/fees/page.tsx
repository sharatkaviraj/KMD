import { redirect } from "next/navigation";

import { getDefaultProtectedHref } from "@/modules/fees/config/navigation";
import { requireAuthenticatedStaff } from "@/modules/fees/platform/session";

export default async function ProtectedPage() {
  const staff = await requireAuthenticatedStaff();

  redirect(getDefaultProtectedHref(staff.appRole));
}
