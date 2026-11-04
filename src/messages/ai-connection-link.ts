import { t } from "@/platform/i18n/language";

/**
 * The one AI-connection row on the Settings home, which is a client
 * component: kept apart from `ai-connection.ts` so the settings bundle ships
 * these two pairs and not the consent page's, card's and admin page's
 * (D-229: module-level `t()` calls are not tree-shaken).
 */
export const aiConnectionLink = {
  title: t("AI सहायक कनेक्शन", "AI assistant connection"),
  sub: t("Claude / ChatGPT: स्विच और कनेक्शन", "Claude / ChatGPT: switch and connections"),
} as const;
