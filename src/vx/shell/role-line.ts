import type { StaffRole } from "@/platform/auth/permissions";
import { MENU_LABEL, type DesignMenu } from "@/vx/nav";
import type { Pair } from "@/vx/text";

/** The line under the signed-in person's name, as the design's sidebar writes it ("Admin · settings", "Accountant"). */
export const ROLE_SUB: Record<StaffRole, Pair> = {
  admin: { en: "Admin · settings", hi: "प्रशासक · सेटिंग्स" },
  office: { en: "Office", hi: "कार्यालय" },
  accountant: { en: "Accountant", hi: "लेखाकार" },
  fee_collector: { en: "Fee desk", hi: "फ़ीस काउंटर" },
  academic_coordinator: { en: "Academic coordinator", hi: "शैक्षणिक समन्वयक" },
  exam_coordinator: { en: "Exam coordinator", hi: "परीक्षा प्रभारी" },
  teacher: { en: "Teacher", hi: "अध्यापक" },
  view_only: { en: "View only", hi: "केवल देखना" },
};

/**
 * Whose app this is, for the sidebar's "Admin · 2026–27" and Today's session
 * line. The office and the view-only account share the admin's menu, and the
 * menu's name told a viewer she was the admin (admin B6). Their own role
 * names them; an administrator previewing another menu still sees that menu.
 */
export function menuRoleLabel(menu: DesignMenu, role: StaffRole, previewing: DesignMenu | null | undefined): Pair {
  if (previewing) return MENU_LABEL[previewing];
  if (menu === "admin" && (role === "office" || role === "view_only")) return ROLE_SUB[role];
  return MENU_LABEL[menu];
}
