import { redirect } from "next/navigation";
import { requireStaff } from "@/platform/auth/current-staff";
import { homeFor } from "@/platform/config/navigation";

/** Old bookmarks remain usable; school work opens within VPPS One. */
export default async function AppsPage() {
  const staff = await requireStaff("/apps");
  redirect(homeFor(staff.role));
}
