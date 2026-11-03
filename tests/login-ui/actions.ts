declare global { interface Window { loginSubmissions: number } }
window.loginSubmissions = 0;
export async function loginAction() {
  window.loginSubmissions += 1;
  return { status: "error" as const, message: { en: "That email and password do not match an account.", hi: "ईमेल या पासवर्ड गलत है।" } };
}
