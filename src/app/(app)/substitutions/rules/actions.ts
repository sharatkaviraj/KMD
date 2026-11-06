"use server";

import { revalidatePath } from "next/cache";

import * as m from "@/messages/pairs";
import { assertPermission } from "@/platform/auth/current-staff";
import { t } from "@/platform/i18n/language";
import { resolveSessionLabel } from "@/modules/academics/data/academics-repo";
import {
  clearTeamRule,
  saveBells,
  saveTeamRule,
} from "@/modules/substitutions/data/school-rules-repo";
import { idleSubsState, type SubsState } from "@/modules/substitutions/domain/form-state";
import { PERIOD_COUNT } from "@/modules/timetable/domain/parse-timetable";
import { bellProblems, type BellPeriod } from "@/modules/timetable/domain/bells";

function failure(message: SubsState["message"]): SubsState {
  return { status: "error", message };
}

/**
 * Save the session's bells. Every period needs a window; windows run forward
 * and do not overlap. A gap is a break.
 */
export async function saveBellsAction(_previous: SubsState, formData: FormData): Promise<SubsState> {
  const actor = await assertPermission("substitutions:manage");
  const sessionLabel = await resolveSessionLabel();
  if (!sessionLabel) return failure(m.noSessionFound);

  const periods: BellPeriod[] = Array.from({ length: PERIOD_COUNT }, (_, index) => ({
    index,
    starts: (formData.get(`starts-${index}`) ?? "").toString().slice(0, 5),
    ends: (formData.get(`ends-${index}`) ?? "").toString().slice(0, 5),
  }));

  const problems = bellProblems(periods, PERIOD_COUNT);
  if (problems.length > 0) {
    const first = problems[0];
    return failure(
      t(
        `पीरियड ${first.index + 1} का समय ठीक नहीं है — शुरू, अंत और पिछले पीरियड से टकराव जाँचें।`,
        `Period ${first.index + 1} has a time that does not work — check its start, its end and that it does not overlap the one before.`,
      ),
    );
  }

  try {
    await saveBells(sessionLabel, periods, actor.id);
  } catch {
    return failure(m.notSaved);
  }

  revalidatePath("/substitutions/rules");
  revalidatePath("/substitutions");
  return { ...idleSubsState, status: "saved" };
}

/** How many of a team block's teachers must be present for it to run without help. */
export async function saveTeamRuleAction(_previous: SubsState, formData: FormData): Promise<SubsState> {
  const actor = await assertPermission("substitutions:manage");
  const sessionLabel = await resolveSessionLabel();
  if (!sessionLabel) return failure(m.noSessionFound);

  const subjectCode = (formData.get("subjectCode") ?? "").toString().trim();
  const minimumPresent = Number((formData.get("minimumPresent") ?? "").toString());
  const largestTeam = Number((formData.get("largestTeam") ?? "15").toString());

  if (!subjectCode || !Number.isInteger(minimumPresent) || minimumPresent < 1 || minimumPresent > Math.min(15, largestTeam)) {
    return failure(m.notSaved);
  }

  try {
    await saveTeamRule(sessionLabel, { subjectCode, minimumPresent }, actor.id);
  } catch {
    return failure(m.notSaved);
  }

  revalidatePath("/substitutions/rules");
  return { ...idleSubsState, status: "saved" };
}

export async function clearTeamRuleAction(formData: FormData) {
  await assertPermission("substitutions:manage");
  const sessionLabel = await resolveSessionLabel();
  const subjectCode = (formData.get("subjectCode") ?? "").toString();
  if (!sessionLabel || !subjectCode) return;

  await clearTeamRule(sessionLabel, subjectCode);
  revalidatePath("/substitutions/rules");
}
