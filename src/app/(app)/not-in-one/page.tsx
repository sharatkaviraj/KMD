import { requireStaff } from "@/platform/auth/current-staff";
import { notInOneTopic } from "@/vx/not-in-one";
import { lead } from "@/vx/text";
import { Section, TopBar, VxPage } from "@/vx/ui/page";
import { Btn, Card } from "@/vx/ui/primitives";

export const runtime = "nodejs";

/**
 * Where a screen One does not have yet lands (owner, 6 Nov 2026): never a
 * redirect to the Fees app. It names the screen and says it is not in One
 * yet; the work is still done in the Fees app, which stays the money record.
 */
export default async function NotInOnePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const staff = await requireStaff("/not-in-one");
  const from = (await searchParams).from;
  const topic = notInOneTopic(typeof from === "string" ? from : null);
  const t = (en: string, hi: string) => lead({ en, hi }, staff.language);
  const title = t("Not in One yet", "अभी One में नहीं");
  return (
    <VxPage label={title}>
      <TopBar title={title} crumb={lead(topic, staff.language)} mBack="/menu" />
      <Section>
        <Card style={{ display: "flex", flexDirection: "column", gap: 12, padding: 18 }}>
          <strong style={{ fontSize: 17 }}>{lead(topic, staff.language)}</strong>
          <p style={{ margin: 0, color: "var(--mut)" }}>
            {t("This is not in One yet. For now, do it in the Fees app as you do today. One reads the money from Fees, so nothing is lost.",
              "यह अभी One में नहीं है। अभी के लिए इसे पहले की तरह Fees ऐप में करें। One पैसे का हिसाब Fees से पढ़ता है, इसलिए कुछ नहीं खोता।")}
          </p>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <Btn href="/">{t("Go to Home", "होम पर जाएँ")}</Btn>
            <Btn variant="sec" href="/menu">{t("All screens", "सभी स्क्रीन")}</Btn>
          </div>
        </Card>
      </Section>
    </VxPage>
  );
}
