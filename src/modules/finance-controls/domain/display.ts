// Pure display/formatting utilities for finance controls
// This file has NO server-only dependency so it can be imported by client components

// Type definitions needed for display functions
type CollectionCloseRow = {
  id: string;
  payment_date: string;
  status: "draft" | "pending_approval" | "closed" | "reopened";
  cash_deposit_status: "pending" | "deposited" | "carried_forward" | "not_applicable";
  reconciliation_status: "pending" | "in_review" | "cleared" | "issue_found";
  bank_deposit_reference: string | null;
  close_note: string | null;
  summary_snapshot: unknown;
  created_at: string;
  updated_at: string;
  created_by: string | null;
  updated_by: string | null;
  approved_at: string | null;
  approved_by: string | null;
  closed_at: string | null;
  closed_by: string | null;
};

// Status tone functions
function statusToneForClosure(status: CollectionCloseRow["status"]) {
  switch (status) {
    case "closed":
      return "good" as const;
    case "pending_approval":
      return "warning" as const;
    case "reopened":
      return "accent" as const;
    case "draft":
    default:
      return "neutral" as const;
  }
}

function statusToneForReconciliation(status: CollectionCloseRow["reconciliation_status"]) {
  switch (status) {
    case "cleared":
      return "good" as const;
    case "issue_found":
      return "warning" as const;
    case "in_review":
      return "accent" as const;
    case "pending":
    default:
      return "neutral" as const;
  }
}

function statusToneForCashDeposit(status: CollectionCloseRow["cash_deposit_status"]) {
  switch (status) {
    case "deposited":
      return "good" as const;
    case "carried_forward":
      return "warning" as const;
    case "not_applicable":
      return "neutral" as const;
    case "pending":
    default:
      return "accent" as const;
  }
}

// Status label functions
function statusLabelForClosure(status: CollectionCloseRow["status"]) {
  switch (status) {
    case "draft":
      return "Draft";
    case "pending_approval":
      return "Pending approval";
    case "closed":
      return "Closed";
    case "reopened":
      return "Reopened";
  }
}

function statusLabelForReconciliation(status: CollectionCloseRow["reconciliation_status"]) {
  switch (status) {
    case "pending":
      return "Pending reconciliation";
    case "in_review":
      return "In review";
    case "cleared":
      return "Cleared";
    case "issue_found":
      return "Issue found";
  }
}

function statusLabelForCashDeposit(status: CollectionCloseRow["cash_deposit_status"]) {
  switch (status) {
    case "pending":
      return "Cash deposit pending";
    case "deposited":
      return "Cash deposited";
    case "carried_forward":
      return "Carried forward";
    case "not_applicable":
      return "Not applicable";
  }
}

/**
 * A correction row's notes as a person reads them. An admin reversal is
 * tagged `admin_reversal:<receipt id>` by the Fees RPC (20260817103000) so
 * that every one falls into this queue; the tag itself showed raw in the day
 * book (accountant run, 6 Nov 2026). Any other note is shown as written.
 */
function correctionNoteText(notes: string | null | undefined): string | null {
  if (!notes) return null;
  if (/^admin_reversal:[0-9a-f-]{36}$/i.test(notes.trim())) return "Receipt reversed by an admin";
  return notes;
}

export {
  correctionNoteText,
  statusLabelForCashDeposit,
  statusLabelForClosure,
  statusLabelForReconciliation,
  statusToneForCashDeposit,
  statusToneForClosure,
  statusToneForReconciliation,
};
