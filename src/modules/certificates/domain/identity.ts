import { z } from "zod";

/**
 * The school's certificate identity: who signs, where, under which codes, and
 * how the page is laid out. Entered once by a certificate manager and frozen
 * into every document prepared afterwards. School codes live here, never in a
 * student's external identifiers.
 */
const text = (max: number) => z.string().trim().max(max).refine((value) => !/[{}<>]/.test(value), "Unsafe text").default("");
const code = z.string().trim().max(40).regex(/^[A-Za-z0-9/ .-]*$/, "Use letters, numbers and / - . only").default("");

export const certificateIdentitySchema = z.object({
  principalName: text(80), principalDesignation: text(60).transform((value) => value || "Principal"),
  principalDesignationHi: text(60).transform((value) => value || "प्रधानाचार्य"),
  place: text(60), udiseCode: code, pspCode: code, recognitionNo: code,
  /** A facsimile is used only after a manager turns it on; owning an image is not authority. */
  signaturePolicy: z.enum(["manual", "facsimile"]).default("manual"),
  facsimileEnabledBy: z.string().max(80).nullable().default(null), facsimileEnabledAt: z.string().max(40).nullable().default(null),
  layout: z.enum(["classic", "preprinted"]).default("classic"),
  /** Millimetres to nudge text onto a pre-printed form, from a calibration print. */
  offsetX: z.number().min(-20).max(20).default(0), offsetY: z.number().min(-20).max(20).default(0),
});
export type CertificateIdentity = z.infer<typeof certificateIdentitySchema>;
export const DEFAULT_IDENTITY: CertificateIdentity = certificateIdentitySchema.parse({});

export function cleanIdentity(input: unknown): CertificateIdentity {
  const parsed = certificateIdentitySchema.safeParse(input ?? {});
  return parsed.success ? parsed.data : DEFAULT_IDENTITY;
}

/**
 * The record of who allowed a facsimile is kept by the server: switching it on
 * stamps the actor and time, switching it off clears them, and a save that
 * leaves the policy alone keeps the original stamp.
 */
export function stampIdentity(before: CertificateIdentity, after: CertificateIdentity, actor: string, now: string): CertificateIdentity {
  if (after.signaturePolicy === "manual") return { ...after, facsimileEnabledBy: null, facsimileEnabledAt: null };
  if (before.signaturePolicy === "facsimile") return { ...after, facsimileEnabledBy: before.facsimileEnabledBy, facsimileEnabledAt: before.facsimileEnabledAt };
  return { ...after, facsimileEnabledBy: actor, facsimileEnabledAt: now };
}
