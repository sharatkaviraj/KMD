import { z } from "zod";

import { encodeMessage, t, type Localized } from "@/platform/i18n/language";
import type { AttendanceStatus } from "@/modules/attendance/domain/attendance";
import { attendanceStatuses } from "@/modules/attendance/domain/attendance";

/**
 * Corrections to a submitted register.
 *
 * A submitted register is a record, not a draft. The mark stands until
 * somebody with the authority decides otherwise, and the change carries a
 * reason and two names — who asked, and who agreed.
 *
 * The alternative, letting a teacher edit yesterday freely, makes a register
 * that cannot be relied on for anything: a report card, a transfer
 * certificate, or a conversation with a parent about a child's absences.
 */

export const correctionStatuses = ["pending", "approved", "rejected"] as const;

export type CorrectionStatus = (typeof correctionStatuses)[number];

export const correctionStatusLabels: Record<CorrectionStatus, Localized> = {
  pending: t("प्रतीक्षा में", "Waiting"),
  approved: t("स्वीकृत", "Approved"),
  rejected: t("अस्वीकृत", "Rejected"),
};

export type Correction = {
  id: string;
  registerId: string;
  studentId: string;
  studentName: string;
  classLabel: string;
  day: string;
  fromStatus: AttendanceStatus | null;
  toStatus: AttendanceStatus;
  reason: string;
  requestedById: string;
  requestedByName: string;
  requestedAt: string;
  status: CorrectionStatus;
  decidedByName: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
};

export const requestCorrectionSchema = z.object({
  registerId: z.uuid(),
  studentId: z.uuid(),
  toStatus: z.enum(attendanceStatuses),
  reason: z
    .string()
    .trim()
    .min(3, {
      message: encodeMessage(
        t("कारण लिखें", "Say why — a correction without a reason cannot be judged"),
      ),
    })
    .max(300, {
      message: encodeMessage(t("कारण बहुत लंबा है", "That reason is too long")),
    }),
});

export type RequestCorrectionInput = z.infer<typeof requestCorrectionSchema>;

export const decideCorrectionSchema = z.object({
  correctionId: z.uuid(),
  approve: z.boolean(),
  decisionNote: z
    .string()
    .trim()
    .max(300, {
      message: encodeMessage(t("टिप्पणी बहुत लंबी है", "That note is too long")),
    })
    .transform((value) => (value === "" ? null : value))
    .nullable(),
});

/**
 * Whether a correction request may be raised at all.
 *
 * Asking to change a mark to what it already is wastes an approver's time and
 * makes the queue harder to read, so it is refused here rather than accepted
 * and quietly ignored.
 */
export function canRequestCorrection(input: {
  registerStatus: "open" | "submitted";
  currentStatus: AttendanceStatus | null;
  toStatus: AttendanceStatus;
  hasPendingRequest: boolean;
}): { allowed: boolean; reason?: Localized } {
  if (input.registerStatus === "open") {
    // Still open: just edit it. A correction request on a draft is ceremony.
    return {
      allowed: false,
      reason: t(
        "यह रजिस्टर अभी खुला है — सीधे बदल दें।",
        "This register is still open — change it directly.",
      ),
    };
  }

  if (input.hasPendingRequest) {
    return {
      allowed: false,
      reason: t(
        "इस बच्चे के लिए एक निवेदन पहले से प्रतीक्षा में है।",
        "A request for this child is already waiting.",
      ),
    };
  }

  if (input.currentStatus === input.toStatus) {
    return {
      allowed: false,
      reason: t(
        "यह पहले से यही दर्ज है।",
        "That is already what is recorded.",
      ),
    };
  }

  return { allowed: true };
}

/**
 * Whether this person may decide a request.
 *
 * Nobody approves their own: the point of the queue is that a second person
 * looked. With one approver in the school that means a request can sit — which
 * is the right failure, because the alternative is a rubber stamp.
 */
export function canDecide(input: {
  hasCorrectPermission: boolean;
  requestedByStaffId: string;
  deciderStaffId: string;
  status: CorrectionStatus;
}): { allowed: boolean; reason?: Localized } {
  if (!input.hasCorrectPermission) {
    return {
      allowed: false,
      reason: t(
        "आपको निवेदन स्वीकार करने की अनुमति नहीं है।",
        "You cannot approve corrections.",
      ),
    };
  }

  if (input.status !== "pending") {
    return {
      allowed: false,
      reason: t("यह निवेदन तय हो चुका है।", "This request has already been decided."),
    };
  }

  if (input.requestedByStaffId === input.deciderStaffId) {
    return {
      allowed: false,
      reason: t(
        "अपना ही निवेदन स्वीकार नहीं कर सकते।",
        "You cannot approve your own request — the point is that somebody else looked.",
      ),
    };
  }

  return { allowed: true };
}

/** Waiting first, then newest — the order an approver works down. */
export function byQueueOrder(a: Correction, b: Correction): number {
  if (a.status !== b.status) {
    if (a.status === "pending") return -1;
    if (b.status === "pending") return 1;
  }
  return a.requestedAt < b.requestedAt ? 1 : -1;
}

export function pendingCount(corrections: Correction[]): number {
  return corrections.filter((entry) => entry.status === "pending").length;
}
