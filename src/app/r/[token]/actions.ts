"use server";

import { revalidatePath } from "next/cache";

import { m } from "@/messages";
import { decodeMessage, type Localized } from "@/platform/i18n/language";
import {
  limitByToken,
  limitUnknownToken,
  clientIp,
} from "@/modules/collection/data/rate-limit";
import { resolveToken } from "@/modules/collection/data/requests-repo";
import { submitCollectionPayload } from "@/modules/teacher-tasks/data/collection-save";
import {
  idleLinkState,
  type LinkState,
} from "@/modules/collection/domain/link-state";

/**
 * What the public form posts to.
 *
 * **There is no session here**, so every rule that matters is re-applied:
 *
 *  - the token is resolved again, and the request it names is the only thing
 *    this action can touch — a student id or a field id in the payload that
 *    the request does not cover is dropped rather than trusted;
 *  - every value is validated again by the same `validateField()` the browser
 *    ran, because the browser is never the thing that decides;
 *  - the rate limiter is charged before any of it.
 *
 * The teacher's own device may be offline halfway through a class, so the
 * payload is the whole page and re-sending it is harmless: answers upsert on
 * (request, student, field).
 */

function failure(message: Localized): LinkState {
  return { status: "error", message };
}

export async function submitAnswersAction(
  _previous: LinkState,
  formData: FormData,
): Promise<LinkState> {
  const token = (formData.get("token") ?? "").toString();
  const ip = await clientIp();

  const budget = await limitByToken(token);
  if (!budget.allowed) return failure(m.linkTooMany);

  const request = await resolveToken(token);
  if (!request) {
    // A token that does not resolve is charged to the guessing budget, so a
    // teacher working through her own link never pays for somebody else's
    // attempts and a guesser never hides inside hers.
    await limitUnknownToken(ip);
    return failure(m.linkClosed);
  }

  let payload: unknown;
  try {
    payload = JSON.parse((formData.get("payload") ?? "").toString());
  } catch {
    return failure(m.notSaved);
  }

  if (!Array.isArray(payload)) return failure(m.notSaved);

  const result = await submitCollectionPayload(request, payload);
  if (result.status !== "saved") return result;

  revalidatePath(`/r/${token}`);
  return { ...idleLinkState, status: "saved", message: m.linkSaved };
}

export async function decodeFieldMessage(message: string): Promise<Localized> {
  return decodeMessage(message);
}
