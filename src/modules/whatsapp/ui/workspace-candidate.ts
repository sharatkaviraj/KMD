/**
 * The families the send screen's client half receives — see `WorkspaceCandidate`.
 *
 * Its own module, not `reminders-workspace.tsx`: that file is `"use client"`,
 * so a mapper exported from it is a client reference the server cannot call,
 * and every byte in it ships to the phone. The page maps on the server; the
 * workspace imports only the type.
 */
import type { ReminderCandidate } from "@/modules/whatsapp/domain/fee-reminders";

/**
 * The fields of a family this component actually shows or sends. The page
 * maps every candidate down to these before handing them over, because the
 * whole audience — every family's ledger facts, the session's unreachable and
 * held-back lists — used to travel to the phone on EVERY tile tap, and almost
 * none of it is read here. Adding a field here is a decision to ship it.
 */
export type WorkspaceCandidate = Pick<
  ReminderCandidate,
  | "studentId"
  | "admissionNo"
  | "studentName"
  | "parentName"
  | "studentClass"
  | "destination"
  | "familyKey"
  | "secondaryDestination"
  | "usedMotherPhone"
  | "dueAmount"
  | "totalPaid"
  | "sentToday"
  | "sentCount"
  | "cadence"
  | "profile"
  | "profileSource"
  | "includedByHand"
  | "missingFacts"
  | "missingFactsLabel"
>;

export function toWorkspaceCandidate(candidate: ReminderCandidate): WorkspaceCandidate {
  return {
    studentId: candidate.studentId,
    admissionNo: candidate.admissionNo,
    studentName: candidate.studentName,
    parentName: candidate.parentName,
    studentClass: candidate.studentClass,
    destination: candidate.destination,
    // The message count groups by it, as the run does: linked siblings are one family.
    familyKey: candidate.familyKey,
    secondaryDestination: candidate.secondaryDestination,
    usedMotherPhone: candidate.usedMotherPhone,
    dueAmount: candidate.dueAmount,
    totalPaid: candidate.totalPaid,
    sentToday: candidate.sentToday,
    sentCount: candidate.sentCount,
    cadence: candidate.cadence,
    profile: candidate.profile,
    profileSource: candidate.profileSource,
    includedByHand: candidate.includedByHand,
    missingFacts: candidate.missingFacts,
    missingFactsLabel: candidate.missingFactsLabel,
  };
}
