declare global { interface Window { loginSubmissions: number } }
window.loginSubmissions = 0;
export async function loginAction() {
  window.loginSubmissions += 1;
  return { status: "error" as const, message: { en: "That email and password do not match an account.", hi: "ईमेल या पासवर्ड गलत है।" } };
}
const noCode = { status: "error" as const, problem: "unavailable" as const, message: null, masked: null, resendAt: null, waitMinutes: null, triesLeft: null, sends: 0 };
// `?sent=1`: Send code answers the way the server does for any number (D-585).
export async function requestCodeAction(previous: { sends: number }) {
  if (new URLSearchParams(location.search).get("sent") !== "1") return noCode;
  return { status: "sent" as const, problem: null, message: null, masked: "+91 ••••• •4321", resendAt: Date.now() + 30_000, waitMinutes: null, triesLeft: null, sends: previous.sends + 1 };
}
export async function verifyCodeAction() {
  return noCode;
}
