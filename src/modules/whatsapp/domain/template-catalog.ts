import { ALL_CAMPAIGNS } from "@/modules/whatsapp/domain/campaigns";
import { FAMILY_CAMPAIGNS, RECEIPT_CAMPAIGNS } from "@/modules/whatsapp/domain/campaign-bodies-v3";
import {
  FEE_STATEMENT_CAMPAIGNS,
  RECEIPT_DOCUMENT_CAMPAIGNS,
  REVERSAL_CAMPAIGNS,
} from "@/modules/whatsapp/domain/campaign-bodies-v5";
import { V7_CAMPAIGNS } from "@/modules/whatsapp/domain/campaign-bodies-v6";
import { SCHOOL_NOTICE_TEMPLATES } from "@/modules/whatsapp/domain/school-notice-bodies";

/**
 * Every fee-side template VPPS One can send, as rows for the template registry
 * (`vppsone.whatsapp_templates`, migration `20261109062459`).
 *
 * The descriptors this reads decide what a template SAYS — its body and its
 * slots, in order. The registry decides whether Meta has approved it on the
 * school's own number, under which name and language. Two facts, two homes:
 * a template whose words are final in code still cannot go out until its
 * registry row reads `approved` (src/platform/whatsapp/policy.ts).
 *
 * Server and script only: it imports every template body. Nothing under `ui/`
 * or a client file may import it (the bundle ceiling only ratchets down).
 * `_v6` is never listed: its Pay now button belongs to the fees app.
 */

export type CatalogRow = {
  /** The name the app sends under, and the default name on the school's account. */
  key: string;
  /** Meta's language code. */
  languageCode: "hi" | "en";
  /** The switch that governs it (`vppsone.runtime_flags.whatsapp_features`). */
  feature: "fee_reminder" | "receipt" | "reversal" | "fee_statement" | "school_notice" | "absent_notice";
  bodyParams: number;
  /** What each `{{n}}` carries, in order, so the office can check a submission. */
  paramNames: readonly string[];
  header: "none" | "document";
  urlButton: boolean;
  labelEn: string;
};

function situationLabel(situation: string): string {
  return situation.replace(/_/g, " ");
}

export function catalogRows(): CatalogRow[] {
  const rows: CatalogRow[] = [];
  const add = (row: CatalogRow) => {
    if (/_v6$/i.test(row.key)) return;
    if (!rows.some((existing) => existing.key === row.key)) rows.push(row);
  };

  for (const campaign of ALL_CAMPAIGNS) {
    add({
      key: campaign.campaignName,
      languageCode: campaign.language,
      feature: "fee_reminder",
      bodyParams: campaign.slotOrder.length,
      paramNames: campaign.slotOrder,
      header: "none",
      urlButton: false,
      labelEn: `Fee reminder: ${situationLabel(campaign.situation)} (${campaign.language})`,
    });
  }
  for (const campaign of FAMILY_CAMPAIGNS) {
    add({
      key: campaign.campaignName,
      languageCode: campaign.language,
      feature: "fee_reminder",
      bodyParams: campaign.slotOrder.length,
      paramNames: campaign.slotOrder,
      header: "none",
      urlButton: false,
      labelEn: `Fee reminder for a family: ${situationLabel(campaign.situation)} (${campaign.language})`,
    });
  }
  for (const campaign of V7_CAMPAIGNS) {
    add({
      key: campaign.campaignName,
      languageCode: campaign.language,
      feature: "fee_reminder",
      bodyParams: campaign.slotOrder.length,
      paramNames: campaign.slotOrder,
      header: "none",
      urlButton: campaign.buttons.includes("pay_url"),
      labelEn: `Fee reminder with Pay now: ${situationLabel(campaign.situation)} (${campaign.language})`,
    });
  }
  for (const campaign of RECEIPT_DOCUMENT_CAMPAIGNS) {
    add({
      key: campaign.campaignName,
      languageCode: campaign.language,
      feature: "receipt",
      bodyParams: campaign.slotOrder.length,
      paramNames: campaign.slotOrder,
      header: "document",
      urlButton: false,
      labelEn: `Receipt with the PDF attached (${campaign.language})`,
    });
  }
  for (const campaign of RECEIPT_CAMPAIGNS) {
    add({
      key: campaign.campaignName,
      languageCode: campaign.language,
      feature: "receipt",
      bodyParams: campaign.slotOrder.length,
      paramNames: campaign.slotOrder,
      header: "none",
      urlButton: false,
      labelEn: `Receipt, text only (${campaign.language})`,
    });
  }
  for (const campaign of REVERSAL_CAMPAIGNS) {
    add({
      key: campaign.campaignName,
      languageCode: campaign.language,
      feature: "reversal",
      bodyParams: campaign.slotOrder.length,
      paramNames: campaign.slotOrder,
      header: "none",
      urlButton: false,
      labelEn: `Receipt cancelled (${campaign.language})`,
    });
  }
  for (const campaign of FEE_STATEMENT_CAMPAIGNS) {
    add({
      key: campaign.campaignName,
      languageCode: campaign.language,
      feature: "fee_statement",
      bodyParams: campaign.slotOrder.length,
      paramNames: campaign.slotOrder,
      header: campaign.headerKind,
      urlButton: false,
      labelEn: `Fee statement with the PDF attached (${campaign.language})`,
    });
  }
  for (const template of SCHOOL_NOTICE_TEMPLATES) {
    add({
      key: template.campaignName,
      languageCode: template.language,
      feature: template.kind === "absent_today" ? "absent_notice" : "school_notice",
      bodyParams: template.slotOrder.length,
      paramNames: template.slotOrder,
      header: "none",
      urlButton: false,
      labelEn: `School notice: ${situationLabel(template.kind)} (${template.language})`,
    });
  }
  return rows;
}
