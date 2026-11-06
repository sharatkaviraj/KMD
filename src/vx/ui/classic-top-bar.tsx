import type { ReactNode } from "react";

import { Ic } from "@/vx/icons";
import { BackLink, TrailBack } from "@/vx/ui/back-link";

/*
 * The design's top bar for a screen that is not yet a `VxPage` (UI-73).
 *
 * Both title blocks the older screens open with — this app's `PageHeader`
 * (`@/ui/page-header-localized`) and the fee kit's (`@/ui/shell/page-header`)
 * — render this, so every one of those screens sits in the same frame as a
 * redesigned one: on a desk a 64px glass bar with the crumb over a serif
 * title and the actions on the right; on a phone a 58px bar with Back and a
 * bold title, the actions wrapping under it. `TopBar` in `./page.tsx` is the
 * original; this is the same picture drawn with media queries, because an
 * older screen is not inside a `.vx` size container.
 *
 * One title, one set of actions, rendered once: the two layouts are CSS,
 * so a screen reader hears one heading and a test finds one button.
 */
export function ClassicTopBar({
  title,
  titleUnder,
  crumb,
  sub,
  actions,
  back,
  backLabel,
  hideOnPhone = false,
  hideActionsOnPhone = false,
  className,
}: {
  title: ReactNode;
  /** The title in the reader's other language, quieter, beside it. */
  titleUnder?: ReactNode;
  /** The small line above the desktop title: the area or the day. */
  crumb?: ReactNode;
  /** The line under the phone title. */
  sub?: ReactNode;
  actions?: ReactNode;
  /** Where Back goes. Without it the phone bar goes back to the previous screen, if there was one. */
  back?: { href: string; label?: string };
  backLabel?: string;
  /** The screen opens with its own phone hero; draw the bar from 900px only. */
  hideOnPhone?: boolean;
  /** The actions are desk-shaped; keep them off the phone bar. */
  hideActionsOnPhone?: boolean;
  className?: string;
}) {
  const chevron = <Ic n="chevLeft" size={24} />;
  return (
    <header className={`vx-ctop${hideOnPhone ? " phone-hide" : ""}${className ? ` ${className}` : ""}`}>
      <div className="vx-ctop-row">
        {back ? (
          <BackLink href={back.href} className="vx-ctop-back" label={back.label ?? backLabel}>
            {chevron}
          </BackLink>
        ) : (
          <>
            <TrailBack className="vx-ctop-back trail" label={backLabel}>
              {chevron}
            </TrailBack>
            <span className="vx-ctop-gap" aria-hidden="true" />
          </>
        )}
        <div className="vx-ctop-tt">
          {crumb ? <span className="vx-ctop-crumb">{crumb}</span> : null}
          <h1 className="vx-ctop-h1">
            {title}
            {titleUnder ? <span className="vx-ctop-under">{titleUnder}</span> : null}
          </h1>
          {sub ? <span className="vx-ctop-sub">{sub}</span> : null}
        </div>
      </div>
      {actions ? <div className={`vx-ctop-act${hideActionsOnPhone ? " phone-hide" : ""}`}>{actions}</div> : null}
    </header>
  );
}
