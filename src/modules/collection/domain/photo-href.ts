/**
 * The larger version of a list photo, for the viewer: One's own link at full
 * size (`photo-link.ts`), or the Fees photo route's full variant. Anything
 * else is returned as it came. Pure string work with no Node import, so the
 * browser can call it.
 */
export function fullPhotoHref(href: string): string {
  if (href.startsWith("/api/photos/students/")) return href.replace(/([?&])s=list(?=&|$)/, "$1s=full");
  if (href.startsWith("/api/fees-bridge/students/")) return href.replace(/([?&])variant=(list|thumb)(?=&|$)/, "$1variant=full");
  return href;
}
