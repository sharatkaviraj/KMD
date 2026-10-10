import { SIGNED_OUT_LANGUAGE } from "@/platform/i18n/language";
import { Btn } from "@/vx/ui/primitives";

import { StatePanel } from "@/vx/screens/system/state";

/**
 * The app-level not-found: a path outside every route group, before the shell
 * and before sign-in. Same state as the in-app one, on a bare page.
 */
export default function RootNotFound() {
  return (
    <div className="vx" style={{ minHeight: "100dvh", background: "var(--bg)", color: "var(--fg)", display: "flex", alignItems: "center" }}>
      <main style={{ width: "100%" }}>
        <StatePanel
          icon="search"
          code="404"
          language={SIGNED_OUT_LANGUAGE}
          title={{ en: "This page is not here", hi: "यह पेज नहीं मिला" }}
          body={{ en: "Check the address, or start again from the beginning.", hi: "पता जाँचें, या शुरू से खोलें।" }}
          actions={<Btn variant="pri" icon="home" href="/">Start · शुरू करें</Btn>}
        />
      </main>
    </div>
  );
}
