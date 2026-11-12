"use server";

import { revalidatePath } from "next/cache";

import { writeStaffConsent } from "@/modules/staff-notices/data/consent";
import {
  cancelStaffLink,
  readWhatsappLinkCard,
  startStaffLink,
  staffLinkStatus,
  type LinkStatus,
  type StartedLink,
  type WhatsappLinkCard,
} from "@/modules/whatsapp/data/staff-link";
import { staffLanguage } from "@/modules/whatsapp/domain/helper-handoff";
import { assertStaff } from "@/platform/auth/current-staff";
import { assertNotPreviewing } from "@/vx/view-as";

/**
 * Link my WhatsApp (D-581), the buttons on My profile and Preferences.
 *
 * Every one acts on the signed-in person's own row, found by their own id:
 * there is no id in the request to tamper with. A code is made for them
 * alone; asking about a code that is not theirs reads "gone", never somebody
 * else's number. An administrator seeing One as somebody else (D-544) can
 * look but not press.
 */

export type LinkActionFailure = { ok: false; why: "look_only" | "failed" };

async function mayChange(): Promise<boolean> {
  try {
    await assertNotPreviewing();
    return true;
  } catch {
    return false;
  }
}

/** Both screens show the card, and /preferences shows the kinds once there is a yes. */
function refreshScreens() {
  revalidatePath("/preferences");
  revalidatePath("/teach/more");
}

/** "Link my WhatsApp": a fresh code for this person and what the screen shows. */
export async function startWhatsappLinkAction(): Promise<{ ok: true; link: StartedLink } | LinkActionFailure> {
  const staff = await assertStaff();
  if (!(await mayChange())) return { ok: false, why: "look_only" };
  const link = await startStaffLink(staff.id, staffLanguage(staff.language));
  return link ? { ok: true, link } : { ok: false, why: "failed" };
}

/** Has their code come in from WhatsApp yet? The screen asks every few seconds while it waits. */
export async function whatsappLinkStatusAction(
  code: string,
): Promise<{ ok: true; status: LinkStatus; card: WhatsappLinkCard | null } | LinkActionFailure> {
  const staff = await assertStaff();
  if (typeof code !== "string" || code.length > 20) return { ok: true, status: { state: "gone" }, card: null };
  const status = await staffLinkStatus(staff.id, code);
  if (!status) return { ok: false, why: "failed" };
  if (status.state !== "linked") return { ok: true, status, card: null };
  refreshScreens();
  return { ok: true, status, card: await readWhatsappLinkCard(staff.id) };
}

/** "Cancel": the code on the screen goes, so the message typed in WhatsApp links nothing. */
export async function cancelWhatsappLinkAction(): Promise<{ ok: true } | LinkActionFailure> {
  const staff = await assertStaff();
  if (!(await mayChange())) return { ok: false, why: "look_only" };
  return (await cancelStaffLink(staff.id)) ? { ok: true } : { ok: false, why: "failed" };
}

/** Their own yes or stop, for their own row: the caller has already checked who is asking. */
async function setConsent(staffId: string, optIn: boolean): Promise<{ ok: true; card: WhatsappLinkCard | null } | LinkActionFailure> {
  if (!(await mayChange())) return { ok: false, why: "look_only" };
  try {
    await writeStaffConsent({ staffId, optIn, source: "self", recordedBy: staffId });
  } catch {
    return { ok: false, why: "failed" };
  }
  refreshScreens();
  return { ok: true, card: await readWhatsappLinkCard(staffId) };
}

/** "Stop WhatsApp": the number stays on file, and nothing more is sent to it. */
export async function stopWhatsappAction() {
  const staff = await assertStaff();
  return setConsent(staff.id, false);
}

/** "Turn on again", for the number they linked before. */
export async function resumeWhatsappAction() {
  const staff = await assertStaff();
  return setConsent(staff.id, true);
}
