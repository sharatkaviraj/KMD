import "server-only";

import { HUB_TEMPLATE_SUBMISSIONS, hubExpectedBodies } from "@/modules/whatsapp/domain/hub-templates";
import { submitTemplates, syncTemplates } from "@/platform/whatsapp/service";

/**
 * The school's WhatsApp hub and the `_v8` set (D-566): send it for approval,
 * and read back what Meta decided, holding the `_v8` rows to their wording.
 * Every caller has already checked the admin (Settings → WhatsApp) or the
 * hub's signature (the webhook).
 */

/** Read every template's status from the hub, the `_v8` rows checked word for word. */
export function syncHubTemplates(actor: { staffId: string | null }, siteOrigin: string) {
  return syncTemplates(actor, siteOrigin, { expectedBodies: hubExpectedBodies() });
}

/** Send the `_v8` rows Meta has not seen yet (or rejected) to the hub for approval. Nothing is sent to a parent. */
export function submitHubTemplateSet(actor: { staffId: string | null }) {
  return submitTemplates(HUB_TEMPLATE_SUBMISSIONS, actor);
}
