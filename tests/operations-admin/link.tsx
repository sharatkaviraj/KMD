import type { AnchorHTMLAttributes, ReactNode } from "react";
export default function Link({ href, children, prefetch, scroll, replace, unstable_dynamicOnHover, onNavigate, onClick, ...props }: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string; children?: ReactNode; prefetch?: unknown; scroll?: unknown; replace?: unknown; unstable_dynamicOnHover?: unknown; onNavigate?: unknown }) {
  void prefetch; void scroll; void unstable_dynamicOnHover; void onNavigate;
  return <a href={href} {...props} onClick={event => {
    onClick?.(event);
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || props.target || !href.startsWith("/")) return;
    event.preventDefault();
    if (replace) history.replaceState(null, "", href); else history.pushState(null, "", href);
    window.dispatchEvent(new PopStateEvent("popstate"));
  }}>{children}</a>;
}
export function useLinkStatus() { return { pending: false }; }
