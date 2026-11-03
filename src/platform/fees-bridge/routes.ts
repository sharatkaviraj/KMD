/** Reviewed against the existing Fees protected route tree, 1 November 2026. */
export const FEES_ROUTE_TEMPLATES = [
  "/protected", "/protected/access-denied", "/protected/admin-tools", "/protected/admin-tools/activity",
  "/protected/admin-tools/prev-year-dues", "/protected/admin-tools/promotion", "/protected/admin-tools/promotion/[runId]",
  "/protected/admin-tools/recovery", "/protected/admin-tools/session-health", "/protected/admin-tools/whatsapp",
  "/protected/admin-tools/whatsapp-reminders", "/protected/advanced", "/protected/collections", "/protected/dashboard",
  "/protected/defaulters", "/protected/defaulters/contact-log", "/protected/defaulters/fee-breakdown", "/protected/defaulters/voice-note",
  "/protected/dues", "/protected/exports", "/protected/exports/[exportType]", "/protected/fee-setup", "/protected/fee-setup/generate",
  "/protected/fee-setup/time-travel", "/protected/fee-structure", "/protected/finance-controls", "/protected/finance-controls/export",
  "/protected/imports", "/protected/imports/template", "/protected/ledger", "/protected/master-data", "/protected/password",
  "/protected/payments", "/protected/payments/bulk", "/protected/payments/bulk/template", "/protected/payments/one-status",
  "/protected/payments/online", "/protected/payments/preview", "/protected/payments/student-summary",
  "/protected/receipts", "/protected/receipts/[receiptId]", "/protected/receipts/[receiptId]/detail", "/protected/receipts/[receiptId]/pdf", "/protected/receipts/search",
  "/protected/reminders", "/protected/reminders/campaigns", "/protected/reminders/families", "/protected/reminders/fix", "/protected/reminders/ladder",
  "/protected/reminders/lists", "/protected/reminders/lists/export", "/protected/reminders/notices", "/protected/reminders/runs/[runId]",
  "/protected/reminders/unreachable", "/protected/reports", "/protected/reports/export", "/protected/reports/ledger/[studentId]/print",
  "/protected/settings", "/protected/settings/glossary", "/protected/setup", "/protected/staff", "/protected/students",
  "/protected/students/[studentId]", "/protected/students/[studentId]/edit", "/protected/students/[studentId]/fee-pdf", "/protected/students/[studentId]/statement",
  "/protected/students/bulk-update", "/protected/students/bulk-update/template", "/protected/students/family/[familyGroupId]/fee-pdf", "/protected/students/family/[familyGroupId]/statement",
  "/protected/students/index", "/protected/students/new", "/protected/students/photo", "/protected/students/photo/download",
  "/protected/transactions", "/protected/transactions/data", "/protected/transactions/export", "/protected/transactions/receipt-days",
] as const;

export function isExistingFeesPath(path:string):boolean {
  const parts=path.split("/");
  return FEES_ROUTE_TEMPLATES.some(template=>{
    const segments=template.split("/");
    return parts.length===segments.length && segments.every((segment,index)=>segment.startsWith("[")
      ? /^[A-Za-z0-9_-]+$/.test(parts[index]) : segment===parts[index]);
  });
}
