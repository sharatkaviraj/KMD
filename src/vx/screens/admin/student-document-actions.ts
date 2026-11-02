"use server";

import { revalidatePath } from "next/cache";
import { assertPermission } from "@/platform/auth/current-staff";
import { assertStudentVisible } from "@/platform/auth/test-session-access";
import { assertNotPreviewing } from "@/vx/view-as";
import { isUuid } from "@/modules/collection/domain/document-files";
import { deleteDocument, openableDocument } from "@/modules/collection/data/documents-repo";

/** The stored document, rather than a client-supplied student, owns the scope. */
export async function removeStudentDocument(documentId: string): Promise<{ ok: boolean }> {
  try {
    const staff = await assertPermission("documents:manage");
    await assertNotPreviewing();
    if (!isUuid(documentId)) return { ok: false };
    const document = await openableDocument(documentId);
    if (!document) return { ok: false };
    await assertStudentVisible(staff, document.studentId);
    await deleteDocument(documentId);
    revalidatePath(`/students/${document.studentId}`);
    revalidatePath(`/teach/student/${document.studentId}`);
    return { ok: true };
  } catch {
    return { ok: false };
  }
}
