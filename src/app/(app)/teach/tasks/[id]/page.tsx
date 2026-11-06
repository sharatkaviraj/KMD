import { notFound } from "next/navigation";
import { requirePermission } from "@/platform/auth/current-staff";
import { assertSessionVisible, notFoundUnlessVisible } from "@/platform/auth/test-session-access";
import { schoolProfile } from "@/platform/config/school";
import type { Language } from "@/platform/i18n/language";
import { resolveAssignedRequest, rollForRequest } from "@/modules/collection/data/requests-repo";
import type { CollectionRequest } from "@/modules/collection/domain/requests";
import { loadTaskWork } from "@/modules/teacher-tasks/data/repo";
import { TaskAcademicForm, TaskCollectionForm } from "@/modules/teacher-tasks/ui/task-work";
import { createAdminClient } from "@/platform/supabase/admin";
import { assignedRequestGeneration, collectionDraftScope } from "@/modules/teacher-tasks/data/draft-scope";
import { taskAsk } from "@/vx/screens/teach/domain/today";
import { dShortP } from "@/vx/screens/teach/ui/fmt";
import { p, type Pair } from "@/vx/text";

import { TaskShell } from "../task-shell";

export const runtime = "nodejs";

/**
 * The task forms say their words with `primary()`, which leads with Hindi
 * for a reader of both; every other teacher screen leads with English for
 * her (vx/text.ts). So a "both" reader got a Hindi-only task in an English
 * app (smoke 20 Oct). The form follows the rest of her screens.
 */
function formLanguage(language: Language): Language {
  return language === "both" ? "en" : language;
}

/** "The office needs Address and Photo for 1 child · by Fri 23 Oct", and why, when the office said. */
function askOf(request: Pick<CollectionRequest, "fields" | "dueDate" | "reasonEn" | "reasonHi">, children: number): Pair {
  const ask = taskAsk({ fields: request.fields, children, dueLabel: request.dueDate ? dShortP(request.dueDate) : null });
  const why = request.reasonEn || request.reasonHi;
  if (!why) return ask;
  return p(`${ask.en}. ${request.reasonEn || request.reasonHi}`, `${ask.hi ?? ask.en}। ${request.reasonHi || request.reasonEn}`);
}

const titleOf = (request: Pick<CollectionRequest, "titleEn" | "titleHi">): Pair => p(request.titleEn || request.titleHi || "", request.titleHi || request.titleEn || "");

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const staff = await requirePermission("attendance:view", `/teach/tasks/${id}`);
  const language = formLanguage(staff.language);
  const phone = schoolProfile.officePhone || undefined;
  if (id.startsWith("collection-")) {
    const request = await resolveAssignedRequest(id.slice(11), staff.id);
    if (!request) notFound();
    await notFoundUnlessVisible(() => assertSessionVisible(staff, request.sessionLabel));
    await createAdminClient().rpc("mark_teacher_task_opened", { p_id: request.id, p_staff: staff.id, p_token: null, p_request_token: null });
    const roll = await rollForRequest(request);
    const current = await resolveAssignedRequest(request.id, staff.id);
    if (!current || current.token !== request.token) notFound();
    const draftScope = collectionDraftScope({ requestId: request.id, actorId: staff.id, taskToken: null, requestToken: request.token, session: request.sessionLabel, studentIds: roll.map((r) => r.studentId), fieldIds: request.fields.map((f) => f.id) });
    const photoCredential = { kind: "assigned-request" as const, id: request.id, generation: assignedRequestGeneration(staff.id, request.id, request.token) };
    return (
      <TaskShell title={titleOf(request)} back="/teach/tasks" intro={askOf(request, roll.length)} phone={phone}>
        <TaskCollectionForm id={id} draftScope={draftScope} photoCredential={photoCredential} request={{ ...request, token: "" }} roll={roll} language={language} />
      </TaskShell>
    );
  }
  const work = await loadTaskWork({ id, staffId: staff.id });
  if (!work) notFound();
  // Phase 3 fence: a task in a session this viewer cannot open is "not found".
  await notFoundUnlessVisible(() => assertSessionVisible(staff, work.task.session_label));
  const intro = work.collection ? askOf(work.collection.request, work.collection.roll.length) : null;
  return (
    <TaskShell title={work.task.title} back="/teach/tasks" intro={intro} phone={phone}>
      {work.collection ? (
        <TaskCollectionForm id={id} draftScope={work.collection.draftScope} request={{ ...work.collection.request, token: "" }} roll={work.collection.roll} language={language} />
      ) : work.academic ? (
        <TaskAcademicForm key={`${id}:${work.academic.revision}`} work={work.academic} language={language} />
      ) : null}
    </TaskShell>
  );
}
