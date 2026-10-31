/**
 * What one WhatsApp template message costs the school, in rupees.
 *
 * Meta bills a UTILITY template to an Indian number at about ₹0.145 (the figure
 * `campaigns.ts` records, and the AiSensy invoice shows), plus 18% GST — so
 * ₹0.17 a message. Shown on the send bar as "about ₹24 to send", rounded up,
 * so nobody presses Send on three hundred families without knowing the bill.
 *
 * An ESTIMATE, and labelled as one on screen: Meta revises the rate card, and a
 * template it silently re-categorises as MARKETING costs about 7.5× this. The
 * monthly campaign-by-campaign count against the AiSensy bill is the check on
 * both (`docs/modules/whatsapp-reminders.md`, "Meta re-categorises silently").
 */
export const UTILITY_MESSAGE_COST_INR = 0.17;
