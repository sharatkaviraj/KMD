import { redirect } from "next/navigation";

import { requireStaffPermission } from "@/modules/fees/platform/session";

/**
 * The fees app's staff screen, closed in One (D-350, approved by the owner on
 * 31 Oct; D-355). In the fees app this screen IS the staff record: it writes
 * `public.users.role` and creates sign-ins with a fee role. In One the staff
 * list on Staff & roles (`/staff`) is the source of truth, and
 * `public.users` is derived from `vppsone.staff_profiles` by the
 * `staff_profiles_sync_fee_user` trigger. A second writer here could only
 * contradict it — a role set here was silently undone at the profile's next
 * change, and an account made here had no profile at all. So the screen sends
 * an admin to `/staff`, after the same permission check it always made.
 */
export default async function StaffPage() {
  await requireStaffPermission("staff:manage", {
    onDenied: "redirect",
  });
  redirect("/staff");
}
