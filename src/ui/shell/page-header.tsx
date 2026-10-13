import { ReactNode } from "react";

import { ClassicTopBar } from "@/vx/ui/classic-top-bar";

type PageHeaderProps = {
  title: ReactNode;
  description?: ReactNode;
  /** Small label above the title (caps, tracked). */
  eyebrow?: ReactNode;
  actions?: ReactNode;
  /**
   * Phone-only line under the title — a count, a status, a session ("214
   * showing", "Draft"). Falls back to `eyebrow`. Pass `false` for title only.
   */
  mobileEyebrow?: ReactNode | false;
  /**
   * Drop the phone title block. Use when the screen already opens with its own
   * hero (the Dashboard's ink band) and a second title would only push the
   * numbers below the fold.
   */
  hideOnMobile?: boolean;
  /** Phone-only: suppress the action cluster when it is desktop-shaped. */
  hideActionsOnMobile?: boolean;
  className?: string;
};

/**
 * The fee screens' title block, drawn as VPPS One's design top bar (UI-73).
 *
 * In the fee app this was two headers, one per breakpoint, each with its own
 * `<h1>` and its own copy of the actions. Inside VPPS One's shell it is the
 * same bar every redesigned screen opens with: a glass desk bar with the
 * eyebrow as the crumb over a serif title, and a phone bar with Back, the
 * title and `mobileEyebrow` under it. The props keep their meaning, so none
 * of the 37 screens that call it changed. The description stays under the
 * bar on a desk and off a phone, as before.
 */
export function PageHeader({
  title,
  description,
  eyebrow,
  actions,
  mobileEyebrow,
  hideOnMobile = false,
  hideActionsOnMobile = false,
  className,
}: PageHeaderProps) {
  const phoneEyebrow = mobileEyebrow === false ? null : (mobileEyebrow ?? eyebrow);

  return (
    <>
      <ClassicTopBar
        title={title}
        crumb={eyebrow}
        sub={phoneEyebrow}
        actions={actions}
        hideOnPhone={hideOnMobile}
        hideActionsOnPhone={hideActionsOnMobile}
        className={className}
      />
      {description ? <p className="vx-cdesc phone-hide">{description}</p> : null}
    </>
  );
}
