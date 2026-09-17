import Link from "next/link";
import { FileQuestion } from "lucide-react";

import { m } from "@/messages";
import { SIGNED_OUT_LANGUAGE, primary } from "@/platform/i18n/language";
import { buttonClasses } from "@/ui/primitives/button";
import { StateCard } from "@/ui/states";

/**
 * A not-found boundary cannot read the staff profile — it renders for a route
 * that does not exist, so there is no page to have loaded one. Bilingual is
 * the honest default here, for the same reason the login screen is.
 */
export default function NotFound() {
  const language = SIGNED_OUT_LANGUAGE;

  return (
    <div className="py-6">
      {/* The atlas's rule for every one of these: a symbol, a sentence, and
          somewhere to go. "Every state has a next step" is the title of that
          screen, and a dead end is the one thing none of them may be. */}
      <StateCard
        icon={FileQuestion}
        title={m.notFound}
        detail={m.notFoundDetail}
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
