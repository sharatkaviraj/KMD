"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { sanitizeRedirectPath } from "@/platform/env";
import { createClient } from "@/platform/supabase/server";

export type LoginActionState = {
  status: "idle" | "error";
  /** Hindi. Shown as the headline of the error box. */
  message: string | null;
  /** English. Shown under it, smaller — the school reads both. */
  messageEn: string | null;
};

// The idle state lives in the client component, not here: a "use server"
// module may only export async functions, so exporting an object from this
// file fails the build.

function fail(message: string, messageEn: string): LoginActionState {
  return { status: "error", message, messageEn };
}

/**
 * Supabase's auth errors arrive in English and are aimed at developers. The
 * three that staff will actually hit get a Hindi sentence that says what to do
 * next; anything else falls through to a generic pair so a new error code
 * cannot produce a blank box.
 */
function translateAuthError(error: { message?: string; code?: string }): LoginActionState {
  const code = error.code ?? "";
  const message = (error.message ?? "").toLowerCase();

  if (code === "invalid_credentials" || message.includes("invalid login credentials")) {
    return fail(
      "ईमेल या पासवर्ड गलत है।",
      "That email and password do not match an account.",
    );
  }

  if (code === "email_not_confirmed" || message.includes("email not confirmed")) {
    return fail(
      "यह खाता अभी पुष्टि नहीं हुआ है। विद्यालय प्रशासक से संपर्क करें।",
      "This account is not confirmed yet. Ask the school admin.",
    );
  }

  if (code === "over_request_rate_limit" || message.includes("rate limit")) {
    return fail(
      "बहुत बार कोशिश हुई। कुछ मिनट रुककर फिर प्रयास करें।",
      "Too many attempts. Wait a few minutes and try again.",
    );
  }

  return fail(
    "अभी साइन इन नहीं हो पा रहा। थोड़ी देर बाद फिर प्रयास करें।",
    error.message ?? "Unable to sign in right now. Please try again.",
  );
}

export async function loginAction(
  _previous: LoginActionState,
  formData: FormData,
): Promise<LoginActionState> {
  const email = (formData.get("email") ?? "").toString().trim().toLowerCase();
  const password = (formData.get("password") ?? "").toString();
  const next = sanitizeRedirectPath(formData.get("next")?.toString());

  if (!email || !password) {
    return fail(
      "ईमेल और पासवर्ड दोनों भरें।",
      "Enter both your email and your password.",
    );
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    return translateAuthError(error);
  }

  // The password was right, which only proves this is a Supabase account —
  // the same account pool the fee app uses. Being staff *here* is a
  // `vppsone.staff_profiles` row, and not having one is a normal thing to be.
  const { data: profile } = await supabase
    .from("staff_profiles")
    .select("is_active")
    .eq("user_id", data.user.id)
    .maybeSingle<{ is_active: boolean }>();

  if (!profile) {
    await supabase.auth.signOut();
    return fail(
      "इस खाते का VPPS One में कोई स्टाफ़ प्रोफ़ाइल नहीं है। विद्यालय प्रशासक से संपर्क करें।",
      "This account has no VPPS One staff profile yet. Ask the school admin to add one.",
    );
  }

  if (!profile.is_active) {
    await supabase.auth.signOut();
    return fail(
      "यह स्टाफ़ खाता निष्क्रिय है। विद्यालय प्रशासक से संपर्क करें।",
      "This staff account is inactive. Ask the school admin.",
    );
  }

  revalidatePath("/", "layout");

  // Outside the try/catch on purpose: redirect() works by throwing, so
  // catching around it would swallow the navigation.
  redirect(next);
}

export async function logoutAction() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  revalidatePath("/", "layout");
  redirect("/login");
}
