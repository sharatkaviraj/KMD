import { t, type Localized } from "@/platform/i18n/language";

/**
 * What can leave the building, and what the log calls it.
 *
 * Kept apart from `report-card.ts` so the data layer can name an export kind
 * without pulling the card-building arithmetic in with it.
 */

export const exportKinds = ["marks", "attendance", "report_cards"] as const;
export type ExportKind = (typeof exportKinds)[number];

export const exportKindLabels: Record<ExportKind, Localized> = {
  marks: t("अंक", "Marks"),
  attendance: t("उपस्थिति", "Attendance"),
  report_cards: t("प्रगति पत्र", "Report cards"),
};
