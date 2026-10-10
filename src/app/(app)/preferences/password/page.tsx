import { requireStaff } from "@/platform/auth/current-staff";
import { lead } from "@/vx/text";
import { VxPage, TopBar, Section } from "@/vx/ui/page";

import { PasswordForm } from "@/vx/screens/system/password-form";

export const runtime = "nodejs";

/** Preferences → Password (P11 state `password`). Every account, its own password. */
export default async function PasswordPage() {
  const staff = await requireStaff("/preferences/password");
  const lang = staff.language;
  return (
    <VxPage>
      <TopBar crumb={lead({ en: "Preferences", hi: "पसंद" }, lang)} title={lead({ en: "Change password", hi: "पासवर्ड बदलें" }, lang)} mBack="/preferences" />
      <main>
        <Section>
          <PasswordForm />
        </Section>
      </main>
    </VxPage>
  );
}
