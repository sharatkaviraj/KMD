"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";

import { m } from "@/messages";
import { requirePermission } from "@/platform/auth/current-staff";
import { resolveSessionLabel } from "@/modules/academics/data/academics-repo";
import { createRound } from "@/modules/collection/data/rounds-repo";
import { matchableRoll } from "@/modules/collection/data/ask-list-repo";
import {
  hasIdentityColumn,
  matchAskList,
  parseCsv,
} from "@/modules/collection/domain/ask-list";
import {
  idleAskList,
  type AskListState,
} from "@/modules/collection/domain/form-state";
import { emptyAudience } from "@/modules/collection/domain/audience";
import { roundInputSchema } from "@/modules/collection/domain/rounds";

/**
 * A cap rather than a stream: an ask list is tens of rows, and a file large
 * enough to need streaming is a file somebody uploaded by mistake.
 */
const MAX_BYTES = 512 * 1024;

/**
 * Read the sheet and say who it names — **without creating anything**.
 *
 * The whole point is the step before. A list of thirty-five that quietly
 * becomes a round of thirty-one is the worst thing this feature can do: the
 * office believes it asked about everyone, and the four it dropped are the
 * four whose rows were already wrong. So the unmatched rows come back by row
 * number, and the office reads them before the round exists.
 */
export async function checkAskListAction(
  _previous: AskListState,
  formData: FormData,
): Promise<AskListState> {
  await requirePermission("collection:manage", "/collection/rounds/upload");
  const sessionLabel = await resolveSessionLabel();
  if (!sessionLabel) return { ...idleAskList, status: "error", message: m.noSessionFound };

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { ...idleAskList, status: "error", message: m.askListEmpty };
  }

  if (file.size > MAX_BYTES) {
    return { ...idleAskList, status: "error", message: m.askListEmpty };
  }

  const table = parseCsv(await file.text());

  if (table.rows.length === 0) {
    return { ...idleAskList, status: "error", message: m.askListEmpty };
  }

  // Answered before a single row is read: a sheet with no SR column cannot
  // identify anybody, and reporting forty unmatched rows would be telling the
  // office forty times over what is wrong once.
  if (!hasIdentityColumn(table.headers)) {
    return { ...idleAskList, status: "error", message: m.askListNoIdentityColumn };
  }

  const result = matchAskList(table, await matchableRoll(sessionLabel));

  return {
    status: "matched",
    message: result.unmatched.length === 0 ? m.askListAllMatched : null,
    matched: result.matched,
    unmatched: result.unmatched,
    classCount: result.classIds.length,
  };
}

/**
 * Create a round over exactly the children the sheet named.
 *
 * The ids come back through hidden fields rather than being re-read from the
 * file: the office has now *seen* this list, and re-parsing would let a second
 * upload in another tab decide who was asked about.
 *
 * An explicit list is the whole audience — every other dimension is ignored
 * when it is set — and `enrolled` is still applied when it resolves, so a
 * child who left between the upload and the send is still not asked about.
 */
export async function createFromAskListAction(formData: FormData): Promise<void> {
  const staff = await requirePermission("collection:manage", "/collection/rounds/upload");
  const sessionLabel = await resolveSessionLabel();
  if (!sessionLabel) redirect("/collection/rounds");

  const studentIds = formData.getAll("studentIds").map(String).filter(Boolean);
  if (studentIds.length === 0) redirect("/collection/rounds/upload");

  const notes: Record<string, string> = {};
  for (const studentId of studentIds) {
    const note = (formData.get(`note:${studentId}`) ?? "").toString().trim();
    if (note) notes[studentId] = note;
  }

  const parsed = roundInputSchema.safeParse({
    titleHi: formData.get("titleHi") ?? "",
    titleEn: formData.get("titleEn") ?? "",
    fieldIds: formData.getAll("fieldIds").map(String),
    dueDate: formData.get("dueDate") ?? "",
    reasonHi: formData.get("reasonHi") ?? "",
    reasonEn: formData.get("reasonEn") ?? "",
  });

  if (!parsed.success) redirect("/collection/rounds/upload");

  // An uploaded list always narrows, so it always needs a reason — and the
  // office typed one into the sheet or the box before reaching here.
  if (!parsed.data.reasonHi && !parsed.data.reasonEn) {
    redirect("/collection/rounds/upload");
  }

  const id = await createRound(
    {
      titleHi: parsed.data.titleHi,
      titleEn: parsed.data.titleEn,
      audience: { ...emptyAudience, studentIds, notes },
      fieldIds: parsed.data.fieldIds,
      dueDate: parsed.data.dueDate,
      reasonHi: parsed.data.reasonHi,
      reasonEn: parsed.data.reasonEn,
      recipientMode: "class_teacher",
    },
    sessionLabel,
    staff.userId,
  );

  revalidatePath("/collection/rounds");
  redirect(`/collection/rounds/${id}`);
}
