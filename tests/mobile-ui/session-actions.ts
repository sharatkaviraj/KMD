// Synthetic browser adapter. Never imports or contacts the application server.
let attempts = 0;
export async function listAvailableSessionsAction() {
  attempts += 1;
  await new Promise((resolve) => setTimeout(resolve, 250));
  const params = new URLSearchParams(location.search);
  if (params.has("failed") && (!params.has("recover") || attempts <= 2)) throw new Error("Synthetic catalogue unavailable");
  return [{ id: "test", session_label: "TEST-2026-27", is_current: false, status: "active" }];
}
export async function setViewSessionAction(label: string) {
  window.dispatchEvent(new CustomEvent("qa:session-switch", { detail: label }));
  return { success: true as const, sessionLabel: label };
}
