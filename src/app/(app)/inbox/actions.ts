"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";

import { assertPermission } from "@/platform/auth/current-staff";
import { decideSubmissionsAction } from "@/app/(app)/collection/actions";
import { coverCommandAction } from "@/app/(app)/substitutions/actions";
import { idleCollectionState } from "@/modules/collection/domain/form-state";
import { idleCoverState } from "@/modules/substitutions/domain/cover-state";
import { assertNotPreviewing } from "@/vx/view-as";
import type { Pair } from "@/vx/text";

/*
 * Needs you (P5). Each action is a thin door onto the decision the app
 * already makes elsewhere — the cover command, the review queue — so the
 * rules (who may decide, stale revisions, idempotent command ids) stay exactly where they were.
 * Permission first, then the preview guard, then the existing action.
 */

export type InboxActionResult = { ok: true; message?: Pair } | { ok: false; message: Pair };

const FAILED: Pair = { en: "That did not go through. Nothing was changed.", hi: "यह नहीं हो पाया। कुछ नहीं बदला।" };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function done() {
  revalidatePath("/inbox");
  revalidatePath("/");
}

export async function decideSubmissionsVx(submissionIds: string[], accept: boolean, commandId: string = randomUUID()): Promise<InboxActionResult> {
  await assertPermission("collection:manage");
  await assertNotPreviewing();
  const ids = submissionIds.filter((id) => UUID.test(id));
  if (ids.length === 0 || !UUID.test(commandId)) return { ok: false, message: FAILED };

  const form = new FormData();
  for (const id of ids) form.append("submissionIds", id);
  form.set("accept", accept ? "true" : "false");
  form.set("commandId", commandId);
  form.set("replaceNewer", "false");
  form.set("note", "");
  const state = await decideSubmissionsAction(idleCollectionState, form);
  done();
  if (state.status === "error") return { ok: false, message: state.message ?? FAILED };
  return { ok: true, message: state.message ?? undefined };
}

export async function assignCoverVx(input: {
  commandId: string;
  needKey: string;
  coveringStaffId: string;
  day: string;
  dayRevision: number;
}): Promise<InboxActionResult> {
  await assertPermission("substitutions:manage");
  await assertNotPreviewing();
  if (!UUID.test(input.commandId) || !UUID.test(input.coveringStaffId)) return { ok: false, message: FAILED };

  const form = new FormData();
  form.set("commandId", input.commandId);
  form.set("day", input.day);
  form.set("dayRevision", String(input.dayRevision));
  form.set("intent", "assign");
  form.set("needKey", input.needKey);
  form.set("coveringStaffId", input.coveringStaffId);
  const state = await coverCommandAction(idleCoverState, form);
  done();
  if (state.status !== "saved") return { ok: false, message: state.message ?? FAILED };
  return { ok: true };
}
