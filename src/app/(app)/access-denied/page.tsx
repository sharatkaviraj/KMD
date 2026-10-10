import { requireStaff } from "@/platform/auth/current-staff";
import { roleLabel } from "@/platform/auth/permissions";
import { pageTitle } from "@/platform/i18n/page-title";
import { designMenuFor, MENU_HOME } from "@/vx/nav";
import { lead } from "@/vx/text";
import { VxPage, TopBar, Section } from "@/vx/ui/page";
import { Btn, Card } from "@/vx/ui/primitives";

import { StatePanel } from "@/vx/screens/system/state";

export const runtime = "nodejs";

const TITLE = { en: "You can't open this page", hi: "यह पेज आपके लिए नहीं खुलता" };

export async function generateMetadata() {
  return { title: await pageTitle(TITLE) };
}

/**
 * Where `requirePermission()` sends somebody who reached a screen their role
 * does not open (P11 state `denied`).
 *
 * It names the permission and the role rather than saying "denied", because
 * the useful next sentence is the one the staff member says to the admin —
 * "it wants marks:write and I am office" is a request that can be actioned;
 * "it says no" is not. The way back is this role's own Home.
 */
export default async function AccessDeniedPage(props: PageProps<"/access-denied">) {
  const staff = await requireStaff();
  const language = staff.language;
  const { permission } = await props.searchParams;
  const wanted = typeof permission === "string" ? permission : null;
  const home = MENU_HOME[designMenuFor(staff.role)];

  return (
    <VxPage>
      <TopBar title={lead(TITLE, language)} mBack={home} />
      <main>
        <Section>
          <StatePanel
            icon="lock"
            tone="warn"
            code="403"
            language={language}
            title={TITLE}
            body={{ en: "Your role does not include this screen. If you need it for your work, ask the administrator to give your account access.", hi: "आपकी भूमिका में यह स्क्रीन नहीं है। काम के लिए चाहिए तो प्रशासक से अनुमति माँगें।" }}
            actions={
              <>
                <Btn variant="pri" icon="home" href={home}>{lead({ en: "Go to my Home", hi: "मेरे होम पर जाएँ" }, language)}</Btn>
                <Btn variant="ghost" icon="arrowRight" href="/menu">{lead({ en: "All my screens", hi: "मेरी सब स्क्रीन" }, language)}</Btn>
              </>
            }
          >
            <Card style={{ width: "100%", textAlign: "left", display: "flex", flexDirection: "column", gap: 8 }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                <span style={{ color: "var(--mut)" }}>{lead({ en: "Your role", hi: "आपकी भूमिका" }, language)}</span>
                <strong>{lead(roleLabel(staff.role), language)}</strong>
              </div>
              {wanted ? (
                <div style={{ display: "flex", justifyContent: "space-between", gap: 12, borderTop: "1px solid var(--bd)", paddingTop: 8 }}>
                  <span style={{ color: "var(--mut)" }}>{lead({ en: "This page needs", hi: "इस पेज के लिए चाहिए" }, language)}</span>
                  <code style={{ fontSize: 13, overflowWrap: "anywhere" }}>{wanted}</code>
                </div>
              ) : null}
            </Card>
          </StatePanel>
        </Section>
      </main>
    </VxPage>
  );
}
