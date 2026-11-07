import { z } from "zod";
import { conductGrades } from "./conduct";
import { requestErrorCodes, requestKinds, requestPurposeKinds, type RequestErrorCode } from "./request-view";

/** The checks on what a screen sends about a certificate request (D-542); the shapes are in `request-view.ts`. */
export * from "./request-view";

const text = (max: number, min = 1) => z.string().trim().min(min).max(max).refine((value) => !/[{}<>]/.test(value), "Unsafe text");
const session = z.string().regex(/^(?:TEST-)?\d{4}-\d{2}$/);

export const requestCreateSchema = z.object({
  studentId: z.uuid(),
  sessionLabel: session,
  kind: z.enum(requestKinds),
  commandId: z.uuid(),
  purpose: text(80, 2).optional(),
  conduct: z.enum(conductGrades).optional(),
  note: text(300).optional(),
}).strict()
  .refine((value) => (value.kind === "character") === Boolean(value.conduct), "A character certificate needs a conduct grade, and only it")
  .refine((value) => !value.purpose || requestPurposeKinds.includes(value.kind), "This document has no purpose line");
export type RequestCreateInput = z.infer<typeof requestCreateSchema>;

export const requestIdSchema = z.object({ requestId: z.uuid() }).strict();
export const requestDeclineSchema = z.object({ requestId: z.uuid(), reason: text(300, 3) }).strict();
export const requestDownloadSchema = z.object({ requestId: z.uuid(), commandId: z.uuid() }).strict();
export const requestListSchema = z.object({
  scope: z.enum(["mine", "student"]),
  session: session,
  student: z.uuid().optional(),
}).strict().refine((value) => value.scope !== "student" || Boolean(value.student), "A student list names the student");

/** `certificate_request:not_enrolled` → `not_enrolled`; anything else is "unavailable". */
export function requestErrorCode(message: unknown): RequestErrorCode {
  const match = /certificate_request:([a-z_]+)/.exec(String(message ?? ""));
  const code = match?.[1];
  return (requestErrorCodes as readonly string[]).includes(code ?? "") ? code as RequestErrorCode : "unavailable";
}

/** The certificate command an approval issues with: one per request and approver, so a retry replays. */
export function approvalCommandSeed(requestId: string, actorId: string): string {
  return `certificate-request:${requestId}:${actorId}`;
}

/** A sha-256 hex digest shaped into a version-4 UUID (variant bits set), for deterministic command ids. */
export function uuidFromDigest(hex: string): string {
  const h = hex.replace(/[^a-f0-9]/gi, "").toLowerCase().padEnd(32, "0").slice(0, 32);
  const variant = ((parseInt(h[16], 16) & 0x3) | 0x8).toString(16);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-${variant}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}
