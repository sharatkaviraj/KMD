"use server";

import { revalidatePath } from "next/cache";

import { m } from "@/messages";
import { decodeMessage, t, type Localized } from "@/platform/i18n/language";
import {
  limitByToken,
  limitUnknownToken,
  clientIp,
} from "@/modules/collection/data/rate-limit";
import { resolveToken, rollForRequest } from "@/modules/collection/data/requests-repo";
import { recordAnswers } from "@/modules/collection/data/submissions-repo";
import { validateField } from "@/modules/collection/domain/fields";
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

  // The roll is the authorization for *which children*: a student id that is
  // not on this request's class roll never reaches the database.
  const roll = await rollForRequest(request);
  const onRoll = new Map(roll.map((row) => [row.studentId, row]));
  const byKey = new Map(request.fields.map((field) => [field.key, field]));

  const answers: {
    studentId: string;
    fieldId: string;
    value: string | null;
    previousValue: string | null;
  }[] = [];

  for (const entry of payload) {
    if (!entry || typeof entry !== "object") continue;

    const { studentId, key, value } = entry as {
      studentId?: unknown;
      key?: unknown;
      value?: unknown;
    };

    if (typeof studentId !== "string" || typeof key !== "string") continue;

    const row = onRoll.get(studentId);
    const field = byKey.get(key);
    if (!row || !field) continue;

    const raw = typeof value === "string" ? value : "";
    const checked = validateField(field, raw);

    // A value the browser let through and the server will not is a bug worth
    // hearing about, not one to swallow: the teacher is told which answer.
    if (!checked.ok) {
      return failure(
        t(
          `${row.fullName}: ${checked.error.hi}`,
          `${row.fullName}: ${checked.error.en}`,
        ),
      );
    }

    answers.push({
      studentId,
      fieldId: field.id,
      value: checked.value,
      previousValue: row.current[field.key] ?? null,
    });
  }

  if (answers.length === 0) return { ...idleLinkState, status: "saved" };

  try {
    await recordAnswers(request, answers);
  } catch {
    return failure(m.notSaved);
  }

  revalidatePath(`/r/${token}`);
  return { ...idleLinkState, status: "saved", message: m.linkSaved };
}

export async function decodeFieldMessage(message: string): Promise<Localized> {
  return decodeMessage(message);
}
