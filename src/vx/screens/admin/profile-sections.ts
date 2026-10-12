import type { StudentTab } from "./logic";

export type ProfileSection = "overview" | "learning" | "fees" | "more";

/** Legacy tab URLs stay authoritative, including bookmarks and browser Back. */
export function profileSection(tab: StudentTab): ProfileSection {
  if (tab === "overview" || tab === "fees") return tab;
  if (tab === "attendance" || tab === "marks") return "learning";
  return "more";
}

export function profileSections(tabs: readonly StudentTab[]): { section: ProfileSection; tab: StudentTab }[] {
  const result: { section: ProfileSection; tab: StudentTab }[] = [];
  for (const section of ["overview", "learning", "fees", "more"] as const) {
    const preferred = section === "more" ? "info" : section === "learning" ? "attendance" : section;
    const tab = tabs.includes(preferred) ? preferred : tabs.find(t => profileSection(t) === section);
    if (tab) result.push({ section, tab });
  }
  return result;
}
