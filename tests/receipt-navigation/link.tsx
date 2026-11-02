import type { AnchorHTMLAttributes, ReactNode } from "react";
export default function Link({ href, children, prefetch, scroll, replace, onNavigate, unstable_dynamicOnHover, ...props }: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string; children?: ReactNode; prefetch?: unknown; scroll?: unknown; replace?: unknown; onNavigate?: unknown; unstable_dynamicOnHover?: unknown }) {
  void prefetch; void scroll; void replace; void onNavigate; void unstable_dynamicOnHover;
  return <a href={href} {...props} onClick={event => {
    props.onClick?.(event);
    if (event.defaultPrevented || props.target === "_blank") return;
    event.preventDefault();
    history.pushState(null, "", href);
    window.dispatchEvent(new PopStateEvent("popstate"));
  }}>{children}</a>;
}
export function useLinkStatus() { return { pending: false }; }
