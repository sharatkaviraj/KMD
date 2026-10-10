"use client";

import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

import { createClient } from "@/platform/supabase/client";
import { useVx } from "@/vx/i18n";
import { p } from "@/vx/text";
import { Sheet } from "@/vx/ui/overlays";
import { Btn } from "@/vx/ui/primitives";

import { expiredLoginHref } from "@/vx/screens/system/logic";

/*
 * P11 state `expired`. When the sign-in lapses while a screen is open, say so
 * on top of the screen rather than letting the next save fail: what was typed
 * in a draft-keeping form stays on the device, and "Sign in again" comes back
 * to this same page (/login?reason=expired&next=…).
 *
 * It listens to Supabase's own auth events and re-checks when the tab comes
 * back into view — no polling. Mount once inside the signed-in shell.
 */
export function SessionExpiredSheet() {
  const { tx } = useVx();
  const pathname = usePathname();
  const [expired, setExpired] = useState(false);

  useEffect(() => {
    const supabase = createClient();
    let leaving = false;
    const markLeaving = () => {
      leaving = true;
    };
    // A deliberate sign-out navigates away; do not show the sheet for it.
    window.addEventListener("beforeunload", markLeaving);
    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_OUT" && !leaving) setExpired(true);
      if (session) setExpired(false);
    });
    const check = async () => {
      if (document.visibilityState !== "visible") return;
      const { data: s } = await supabase.auth.getSession();
      if (!s.session && !leaving) setExpired(true);
    };
    document.addEventListener("visibilitychange", check);
    return () => {
      data.subscription.unsubscribe();
      document.removeEventListener("visibilitychange", check);
      window.removeEventListener("beforeunload", markLeaving);
    };
  }, []);

  const href = expiredLoginHref(pathname, typeof window === "undefined" ? "" : window.location.search);

  return (
    <Sheet
      open={expired}
      onClose={() => undefined}
      dismissable={false}
      icon="lock"
      title={tx(p("You have been signed out", "आप साइन आउट हो गए"))}
      sub={tx(p("For safety the app signs you out after a while.", "सुरक्षा के लिए ऐप कुछ समय बाद साइन आउट करता है।"))}
      footer={<Btn variant="pri" full icon="key" href={href}>{tx(p("Sign in again", "फिर से साइन इन करें"))}</Btn>}
    >
      <p style={{ margin: 0, color: "var(--mut)", lineHeight: 1.5 }}>
        {tx(p("Forms that keep a draft still have what you typed on this device. After signing in you come back to this page.", "जो फ़ॉर्म ड्राफ़्ट रखते हैं, उनमें आपका लिखा इसी फ़ोन पर है। साइन इन के बाद आप इसी पेज पर लौटेंगे।"))}
      </p>
    </Sheet>
  );
}
