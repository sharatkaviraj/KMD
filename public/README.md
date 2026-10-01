# Installed VPPS One

VPPS One is one installable school workspace for all eight staff roles. The
public manifest has a stable `/` identity and neutral Home/Preferences shortcuts.
`/` continues to resolve the account's saved start preference and permissions.
The fee manifest endpoint redirects to this same manifest for compatibility.

Installation is available in Windows Chrome/Edge and Android. Preferences
captures the browser's install prompt; iPhone/iPad instructions use Safari's
Add to Home Screen. Prompt acceptance is not reported as an installed app until
`appinstalled` or standalone display mode confirms it.

The production worker caches only public hashed build files, branding and the
neutral reconnect page. It never stores protected HTML, RSC responses, private
JSON, token pages or mutations. An offline cold launch shows the reconnect page.
Already-open attendance, marks, request and payment forms have versioned device
drafts; recovery is explicit and server saves still authorize each operation.
Payments require an online server confirmation; they are never queued to post.

An updated worker waits. The user chooses reload, after pending draft writes
finish. Open sheets, pending saves and failed draft storage block activation.
Static cache size is bounded; old owned caches are removed on activation.

`src/proxy.ts` must exclude manifest, worker, offline page and branding from auth.
Physical Windows installation, Android lifecycle and iPhone keyboard/standalone
checks remain device acceptance work; Chromium emulation is not physical evidence.
