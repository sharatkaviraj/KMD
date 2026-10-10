import { SIGNED_OUT_LANGUAGE } from "@/platform/i18n/language";
import { VxPage, Section } from "@/vx/ui/page";
import { Btn } from "@/vx/ui/primitives";

import { StatePanel } from "@/vx/screens/system/state";

/**
 * P11 state `notfound`, inside the signed-in shell.
 *
 * A not-found boundary cannot read the staff profile — it renders for a route
 * that does not exist, so there is no page to have loaded one. Both languages
 * is the honest default, for the same reason the login screen uses it.
 */
export default function NotFound() {
  const language = SIGNED_OUT_LANGUAGE;
  return (
    <VxPage>
      <main>
        <Section>
          <StatePanel
            icon="search"
            code="404"
            language={language}
            title={{ en: "This page is not here", hi: "यह पेज नहीं मिला" }}
            body={{ en: "The link may be old, or the record was removed. Your Home has everything you use.", hi: "लिंक पुराना हो सकता है या रिकॉर्ड हट गया। आपके होम पर सब कुछ है।" }}
            actions={
              <>
                <Btn variant="pri" icon="home" href="/">Home · होम</Btn>
                <Btn variant="ghost" icon="search" href="/menu">Menu · मेनू</Btn>
              </>
            }
          />
        </Section>
      </main>
    </VxPage>
  );
}
