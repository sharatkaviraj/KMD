import { feeRoleFor } from "@/platform/auth/fee-roles";
import { can, type StaffRole } from "@/platform/auth/permissions";
import { primary, type Language } from "@/platform/i18n/language";
import {
  getMobileMoreGroups,
  getVisibleProtectedNavigation,
} from "@/modules/fees/config/navigation";
import { navigationFor, sidebarFor } from "./navigation";

/** Serializable: icons stay on the client, never cross the RSC boundary. */
export type MobileMoreGroup = {
  key: string;
  label: string;
  i18nKey?: string;
  items: {
    href: string;
    label: string;
    description?: string;
    i18nKey?: string;
  }[];
};

/** Both the workspace gate and the finer fee-page permissions must agree. */
export function permittedFeeNavigationHrefsFor(role: StaffRole): Set<string> {
  if (!can({ role }, "fees:view")) return new Set();
  const feeRole = feeRoleFor(role);
  return new Set([
    ...getVisibleProtectedNavigation(feeRole).map((item) => item.href),
    ...getMobileMoreGroups(feeRole).flatMap((group) =>
      group.items.map((item) => item.href),
    ),
  ]);
}

/**
 * Native role permissions decide which workspace exists. The fee vocabulary
 * only refines destinations inside an authorized fee workspace. In particular,
 * translating teacher to the fee app's teacher must never offer fee access.
 */
export function mobileMoreGroupsFor(
  role: StaffRole,
  language: Language,
): MobileMoreGroup[] {
  const primaryHrefs = new Set(
    navigationFor(role)
      .filter((item) => item.href !== "/more")
      .slice(0, 4)
      .map((item) => item.href),
  );
  const hasFees = can({ role }, "fees:view");
  const feeRole = feeRoleFor(role);
  const feeGroups = hasFees ? getMobileMoreGroups(feeRole) : [];
  const permittedFeeHrefs = permittedFeeNavigationHrefsFor(role);
  const groups: MobileMoreGroup[] = sidebarFor(role)
    .map((group) => ({
      key: group.title.en,
      label: primary(group.title, language),
      items: group.items
        .filter((item) =>
          !primaryHrefs.has(item.href) &&
          (!item.href.startsWith("/fees/") || permittedFeeHrefs.has(item.href)),
        )
        .map((item) => ({
          href: item.href,
          label: primary(item.label, language),
        })),
    }))
    .filter((group) => group.items.length > 0);
  const seen = new Set([
    ...primaryHrefs,
    ...groups.flatMap((group) => group.items.map((item) => item.href)),
  ]);

  // Preserve the ported fee long tail (receipt lookup, imports, finance controls,
  // glossary) without duplicating the native role's destinations or permissions.
  for (const group of feeGroups) {
    const items = group.items
      .filter((item) => !seen.has(item.href))
      .map(({ href, label, description, i18nKey }) => {
        seen.add(href);
        return { href, label, description, i18nKey };
      });
    if (items.length > 0) {
      groups.push({
        key: `fees-${group.key}`,
        label: group.label,
        i18nKey: group.i18nKey,
        items,
      });
    }
  }
  return groups;
}
