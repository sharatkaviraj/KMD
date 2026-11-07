import { t } from "@/platform/i18n/language";

/**
 * The one AI-connection row on the Settings home, which is a client
 * component: kept apart from `ai-connection.ts` so the settings bundle ships
 * these two pairs and not the consent page's, card's and admin page's
 * (D-229: module-level `t()` calls are not tree-shaken).
 */
export const aiConnectionLink = {
  // Named for what it is, so nobody mistakes it for the AI helper inside One (D-501).
  title: t("Claude / ChatGPT कनेक्टर", "Claude / ChatGPT connector"),
  sub: t("MCP · आपका अपना Claude One पढ़ता है · AI सहायक से अलग", "MCP · your own Claude reads One · not the AI helper"),
} as const;
