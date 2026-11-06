import Link from "@/ui/link";
import { Lock } from "lucide-react";

import * as m from "@/messages/pairs";
import { primary, type Language, type Localized } from "@/platform/i18n/language";
import { buttonClasses } from "@/ui/primitives/button";
import { StateCard } from "@/ui/states";

/**
 * A class, or a child, outside the reader's scope.
 *
 * Said plainly rather than rendered as an empty roll: "nobody is enrolled" and
 * "this is not yours to open" are different answers, and only one of them is
 * true here (P1). Always with somewhere to go, like every state in the atlas.
 */
export function NotYourClass({
  language,
  title = m.notYourClassTitle,
}: {
  language: Language;
  title?: Localized;
}) {
  return (
    <StateCard
      icon={Lock}
      title={title}
      detail={m.notYourClassDetail}
      language={language}
      action={
        <Link href="/teach" className={buttonClasses({ variant: "outline" })}>
          {primary(m.teachTitle, language)}
        </Link>
      }
    />
  );
}
