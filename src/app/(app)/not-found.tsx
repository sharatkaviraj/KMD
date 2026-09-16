import Link from "next/link";

import { m } from "@/messages";
import { SIGNED_OUT_LANGUAGE, primary } from "@/platform/i18n/language";
import { buttonClasses } from "@/ui/primitives/button";
import { EmptyState } from "@/ui/states";

/**
 * A not-found boundary cannot read the staff profile — it renders for a route
 * that does not exist, so there is no page to have loaded one. Bilingual is
 * the honest default here, for the same reason the login screen is.
 */
export default function NotFound() {
  const language = SIGNED_OUT_LANGUAGE;

  return (
    <div className="py-6">
      <EmptyState
        title={m.notFound}
        language={language}
        action={
          <Link href="/dashboard" className={buttonClasses({ variant: "outline" })}>
            {primary(m.goHome, language)}
          </Link>
        }
      />
    </div>
  );
}
