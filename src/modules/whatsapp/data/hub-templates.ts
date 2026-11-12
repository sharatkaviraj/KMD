import "server-only";

import {
  ALL_HUB_SUBMISSIONS,
  HUB_SUBMIT_PER_HOUR,
  HUB_SUBMIT_PER_PRESS,
  hubExpectedBodies,
} from "@/modules/whatsapp/domain/hub-templates";
import { submitTemplates, syncTemplates } from "@/platform/whatsapp/service";

/**
 * The school's WhatsApp hub and the templates One asks it to carry (D-566,
 * D-573): send them for approval, and read back what Meta decided, holding
 * every row to the wording One sends. Every caller has already checked the
 * admin (Settings → WhatsApp), the hub's signature (the webhook) or the
 * job's secret (the hourly check).
 */

/** Read every template's status from the hub, each of One's own checked word for word. */
export function syncHubTemplates(actor: { staffId: string | null }, siteOrigin: string) {
  return syncTemplates(actor, siteOrigin, { expectedBodies: hubExpectedBodies() });
}

/**
 * "Send for approval": the rows Meta has not seen yet, or turned down, up to
 * one press's worth. Nothing is sent to a parent or a member of staff.
 */
export function submitHubTemplateSet(actor: { staffId: string | null }) {
  return submitTemplates(ALL_HUB_SUBMISSIONS, actor, { limit: HUB_SUBMIT_PER_PRESS });
}

/**
 * The hourly check's half: a template that has never been sent for approval
 * goes, once, by itself. One the hub refused, or Meta rejected, is left for
 * an admin's "Send for approval", so a refusal is never repeated every hour.
 */
export function submitNewHubTemplates() {
  return submitTemplates(ALL_HUB_SUBMISSIONS, { staffId: null }, { limit: HUB_SUBMIT_PER_HOUR, newOnly: true });
}
