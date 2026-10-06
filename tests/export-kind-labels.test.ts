import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { exportKinds, exportKindLabels, type ExportKind } from "@/modules/assessments/domain/exports";
import { primary } from "@/platform/i18n/language";

const migration = readFileSync("supabase/migrations/20261004123341_export_kinds_for_workbooks.sql", "utf8");
const workbookKinds = [...migration.matchAll(/add value if not exists '([^']+)'/g)].map(match => match[1]);
describe("export log after workbook exports", () => {
  for (const kind of workbookKinds) {
    it(`renders the database's ${kind} kind in Hindi and English`, () => {
      expect(exportKinds).toContain(kind);
      const label = exportKindLabels[kind as ExportKind];
      expect(primary(label, "hi")).toBeTruthy();
      expect(primary(label, "en")).toBeTruthy();
    });
  }
});
