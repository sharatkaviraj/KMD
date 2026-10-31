"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";

import { requirePermission } from "@/platform/auth/current-staff";
import { assertSessionWritable, passesFence } from "@/platform/auth/test-session-access";
import { resolveSessionLabel } from "@/modules/academics/data/academics-repo";
import { createRound, resolveAudience } from "@/modules/collection/data/rounds-repo";
import {
  audienceFromParams,
  needsReason,
  roundInputSchema,
} from "@/modules/collection/domain/rounds";

/**
 * Write a round down. **It mints no links** — that is the fan-out, in R3.3.
 *
 * The audience is rebuilt here from the form's own hidden fields rather than
 * trusted from anywhere else, and then **resolved again** before the insert.
 * The second resolve is the point: the count the office pressed the button
 * under was rendered a moment ago, and a round covering nobody is a round
 * somebody will send and wonder about. Re-resolving costs one query and closes
 * the gap between what was shown and what is saved.
 */
export async function createRoundAction(formData: FormData): Promise<void> {
  const staff = await requirePermission("collection:manage", "/collection/rounds/new");
  const sessionLabel = await resolveSessionLabel();
  if (!sessionLabel) redirect("/collection/rounds");
  if (!(await passesFence(() => assertSessionWritable(staff, sessionLabel)))) redirect("/collection/rounds");

  const audience = audienceFromParams({
    class: formData.getAll("class").map(String),
    gap: formData.getAll("gap").map(String),
    all: formData.get("all") ? "1" : undefined,
  });

  const parsed = roundInputSchema.safeParse({
    titleHi: formData.get("titleHi") ?? "",
    titleEn: formData.get("titleEn") ?? "",
    fieldIds: formData.getAll("fieldIds").map(String),
    dueDate: formData.get("dueDate") ?? "",
    reasonHi: formData.get("reasonHi") ?? "",
    reasonEn: formData.get("reasonEn") ?? "",
  });

  // Back to the form with the selection intact. A validation failure that
  // dropped the audience would make the office rebuild it from memory, which
  // is how a second round covers a different set than the first.
  if (!parsed.success) {
    redirect(backTo(formData));
  }

  const resolved = await resolveAudience(audience, sessionLabel);
  if (resolved.students.length === 0) redirect(backTo(formData));

  // A narrowed round with no reason would reach a teacher as an unexplained
  // short list, which reads as a broken one (S-03). The form says so before
  // this point; this is the half that cannot be skipped by a crafted POST.
  const reasonGiven =
    Boolean(parsed.data.reasonHi) || Boolean(parsed.data.reasonEn);
  if (needsReason(audience) && !reasonGiven) {
    redirect(backTo(formData));
  }

  const id = await createRound(
    {
      titleHi: parsed.data.titleHi,
      titleEn: parsed.data.titleEn,
      audience,
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

/** The builder, with the selection the office had when they pressed the button. */
function backTo(formData: FormData): string {
  const params = new URLSearchParams();

  for (const id of formData.getAll("class")) params.append("class", String(id));
  for (const key of formData.getAll("gap")) params.append("gap", String(key));
  if (formData.get("all")) params.set("all", "1");

  const search = params.toString();
  return search ? `/collection/rounds/new?${search}` : "/collection/rounds/new";
}
