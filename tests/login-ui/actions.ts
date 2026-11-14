declare global { interface Window { loginSubmissions: number; codeChecks: string[] } }
window.loginSubmissions = 0;
window.codeChecks = [];
export async function loginAction() {
  window.loginSubmissions += 1;
  return { status: "error" as const, message: { en: "That email and password do not match an account.", hi: "ईमेल या पासवर्ड गलत है।" } };
}
const noCode = { status: "error" as const, problem: "unavailable" as const, message: null, masked: null, resendAt: null, waitMinutes: null, triesLeft: null, sends: 0 };
// `?sent=1`: Send code answers the way the server does for any number (D-585).
// `?sent=notyet`: as it answers a number other than the owner's while codes go to the owner only (D-608).
export async function requestCodeAction(previous: { sends: number }) {
  const sent = new URLSearchParams(location.search).get("sent");
  if (sent === "notyet") return { ...noCode, problem: "not_yet" as const, sends: previous.sends };
  if (sent !== "1") return noCode;
  return { status: "sent" as const, problem: null, message: null, masked: "+91 ••••• •4321", resendAt: Date.now() + 30_000, waitMinutes: null, triesLeft: null, sends: previous.sends + 1 };
}
export async function verifyCodeAction(previous: { sends: number }, data: FormData) {
  window.codeChecks.push(String(data.get("code") ?? ""));
  return { ...noCode, sends: previous.sends };
}
