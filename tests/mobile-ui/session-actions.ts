// Synthetic browser adapter. Never imports or contacts the application server.
let attempts = 0;
export async function listAvailableSessionsAction() {
  attempts += 1;
  const params = new URLSearchParams(location.search);
  // `?loading` stays loading: resolving after 250 ms gave the picker an enabled
  // row mid-test, and Shift+Tab rightly wrapped to it.
  if (params.has("loading")) return new Promise<never>(() => {});
  await new Promise((resolve) => setTimeout(resolve, 250));
  if (params.has("failed") && (!params.has("recover") || attempts <= 2)) throw new Error("Synthetic catalogue unavailable");
  return [{ id: "test", session_label: "TEST-2026-27", is_current: false, status: "active" }];
}
export async function setViewSessionAction(label: string) {
  // `?slow-switch` holds the switch for a moment, so the "Opening …" card can be seen.
  if (new URLSearchParams(location.search).has("slow-switch")) await new Promise((resolve) => setTimeout(resolve, 1200));
  window.dispatchEvent(new CustomEvent("qa:session-switch", { detail: label }));
  return { success: true as const, sessionLabel: label };
}
