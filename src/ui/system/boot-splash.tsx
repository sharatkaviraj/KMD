/**
 * What the app shows at the first byte, while the signed-in frame is still
 * being read on the server (6 Nov 2026, "boot speed").
 *
 * Before this, nothing reached the phone until the (app) layout and the shell
 * had finished every read — the staff profile, the permission matrix, the
 * session, the shell's preferences — so an installed app sat on the system
 * splash, and a browser tab on a white page, for the whole of that time. The
 * speed logs showed first paint landing with the first byte, 0.8 to 4 s after
 * the tap on a normal day.
 *
 * It is drawn to match the splash Android draws from the manifest (the same
 * paper colour and the same crest), so the hand-over from the system's splash
 * to this one is not visible, and the frame then replaces it. Plain HTML and
 * CSS: it must paint before any JavaScript arrives, and it says nothing that
 * needs the reader's language, because the language is one of the things not
 * read yet. The "still loading" line appears by CSS alone after 8 seconds,
 * as the screen skeleton's does.
 */
export function BootSplash() {
  return (
    <div className="vx-boot" role="status" aria-live="polite" aria-label="VPPS One · लोड हो रहा है">
      <style>{BOOT_CSS}</style>
      {/* eslint-disable-next-line @next/next/no-img-element -- painted before Next's image loader exists; the file is cached for 30 days */}
      <img className="vx-boot-mark" src="/branding/icon-192.png" alt="" width={96} height={96} fetchPriority="high" decoding="async" />
      <span className="vx-boot-name">VPPS One</span>
      <span className="vx-boot-bar" aria-hidden="true"><span /></span>
      <span className="vx-boot-slow">
        Still loading. The internet or the server is slow; please wait. · अभी लोड हो रहा है। इंटरनेट या सर्वर धीमा है, थोड़ा रुकें।
      </span>
    </div>
  );
}

/*
 * Inline rather than in globals.css: the splash is the one thing on screen
 * before the frame, and it should not change when the frame's styles do.
 * Colours are the manifest's (`background_color` #F7FAFC) and the dark
 * workspace's, chosen by the same `dark` class next-themes sets before paint.
 */
const BOOT_CSS = `
.vx-boot{position:fixed;inset:0;z-index:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;padding:24px;background:#F7FAFC;color:#151923;font-family:var(--font-sans),system-ui,sans-serif;text-align:center}
.dark .vx-boot{background:#11131A;color:#F3F1EC}
.vx-boot-mark{width:96px;height:96px;border-radius:24px}
.vx-boot-name{font-size:17px;font-weight:600;letter-spacing:.01em;opacity:.85}
.vx-boot-bar{position:relative;width:120px;height:3px;border-radius:3px;overflow:hidden;background:rgba(11,79,121,.12);opacity:0;animation:vx-boot-in .3s ease-out .6s forwards}
.dark .vx-boot-bar{background:rgba(129,218,228,.16)}
.vx-boot-bar>span{position:absolute;inset:0 auto 0 0;width:40%;border-radius:3px;background:#0B4F79;animation:vx-boot-slide 1.1s ease-in-out infinite}
.dark .vx-boot-bar>span{background:#81DAE4}
.vx-boot-slow{max-width:320px;font-size:13px;line-height:1.5;opacity:0;visibility:hidden;animation:vx-boot-in .3s ease-out 8s forwards}
@keyframes vx-boot-in{to{opacity:.75;visibility:visible}}
@keyframes vx-boot-slide{0%{transform:translateX(-100%)}100%{transform:translateX(250%)}}
@media (prefers-reduced-motion:reduce){.vx-boot-bar>span{animation:none;width:100%;opacity:.5}}
`;
