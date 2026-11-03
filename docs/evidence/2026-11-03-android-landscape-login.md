# Android landscape password visibility follow-up

Branch: `codex/android-landscape-password-20261102`.
Released bases: One `0007d5148dde1088279c85695c7f61ee131b8c9d`
(PR160), Fees `9d9fe62ec337db25cab8913a4564e1ffd3ebb62f` (PR123).
The original Android findings release remains intact, including PR159's work.
The owner authorized testing, merge and live release; no business-data action.

## Native reproduction and cause

Fresh BrowserStack Galaxy S24, Android 14, Chrome, 2 November UTC. Reduced
user agent reports Chrome `152.0.0.0`; the exact patch version was not collected.
Public routes only: One `/login?next=%2F`, Fees `/`. Synthetic native-keyboard
characters, no email or authentication submission. Start portrait, rotate,
focus the password, then tap its eye. The keyboard stays open, but the field
is partly covered by Chrome's address bar.

Temporary remote DevTools instrumentation captured input layout, focus,
selection, document scroll and visual viewport events. It never recorded a
password value, made network requests or changed app records.

| Measurement | One before / after | Fees before / after |
| --- | --- | --- |
| Layout viewport | 703 x 280 / unchanged | 703 x 280 / unchanged |
| Visual viewport height | 82 / 82 | 82 / 82 |
| Input top in layout viewport | 160.776 / 160.776 | 154.5 / 154.5 |
| Input height | 44 / 44 | 44 / 44 |
| `window.scrollY` | 280 / 280 | 210 / 210 |
| `visualViewport.offsetTop` | 141.667 / 182.667 | 135.333 / 176.333 |
| Input top relative to visible viewport | 19.109 / -21.891 | 19.167 / -21.833 |
| Input focus / selection | retained / retained | retained / retained |

The type switch causes a delayed browser pan, starting after the React commit
and settling within about 200ms. The input does not reflow or lose focus.
On One, intercepting and skipping an unchanged `setSelectionRange` still
reproduced the pan (visual offset 125 to 182.667). Redundant selection writes
are therefore not the cause. A single immediate `scrollIntoView(nearest)` did
not correct the independently panned viewport on this device.

## Change

Both login components snapshot the input's visible top alongside its selection.
After the type switch, `src/ui/auth/preserve-password-viewport.ts` briefly
observes viewport/document scroll and viewport resize. One animation frame
batches events and compensates only the measured position delta. A smaller
viewport moves the field only enough to keep it visible. Fractional rounding
under 0.5 CSS pixel is ignored.

The guard expires after 500ms and stops on a new pointer interaction, touch
movement, wheel, Tab/Escape/PageUp/PageDown, blur, another toggle or component cleanup. It never
focuses an element. Keyboard activation keeps focus on the eye; input node,
selection restoration, autocomplete, validation and submission remain intact.
No global provider, viewport meta setting, animation dependency or background
request was added.

On the native One page, a temporary prototype of the same geometry correction
held visible top from 36.109 to 35.776px through show/hide, with keyboard,
focus and selection retained. This is prototype evidence, not verification of
the eventual exact production build. Both forms were cleared, pages reloaded
to remove instrumentation, clipboard cleared and BrowserStack stopped.

## Regression evidence and release gates

`tests/login-ui/viewport.spec.ts` models the measured independent viewport pan
with 40/100/185ms stages, real DOM rectangles and real document scrolling.
Four repeated toggles assert full visible field geometry, middle backward
selection, unchanged input identity, continued typing and zero submissions.
Additional cases shrink the visible height, scroll deliberately and Tab away.
An immediate-typing regression enters text 75ms after the toggle, proves that
entry precedes the final delayed pan, and checks visibility, new text/caret and
zero submissions afterward. It failed when every key cancelled the guard;
ordinary text entry now keeps compensation active. The fixture ignores React's
redundant assignment of an unchanged type rather than manufacture extra pans.
One covers English and Hindi. Raw touches on measured button rectangles avoid
Playwright's automatic locator scrolling; a pointer-down measurement proves
the tool did not move the baseline. Tab's native reveal scroll is distinguished
from programmatic compensation. The six geometry cases fail on the released
code with the field above the visible viewport, then pass with the correction.

| Fresh local check | One | Fees |
| --- | --- | --- |
| Login browser suite | 20 passed | 10 passed |
| Unit suite | 430 files; 19,261 passed, one existing skip | 492 files; 4,484 passed |
| Typecheck | passed | passed |
| Lint | passed; 15 existing warnings | passed; 4 existing warnings |
| Port imports / theme | 829 files / 430 matching tokens | not applicable |
| Source budgets / architecture / generated map | existing CI gates retained | passed |
| Installed vendor verifier | not applicable | blocked locally by dependency junction; unchanged isolated CI required |
| Production build / route bundle budgets | clean CI required before merge | clean CI required before merge |

The prior local production build exhausted D:; about 1.5GB remained for this
follow-up. Production builds use the existing clean CI jobs rather than claim
local build success. Exact-head CI/build/bundle results are recorded in the
pull request. New dependencies and lockfile changes: none. Before-release
public HTML script downloads measure One 319,659 gzip bytes and Fees 220,542
gzip bytes. The same measurement after release is needed for the final delta;
it excludes CSS, RSC, images and latency.

Fresh native verification of the exact deployed follow-up is a separate gate
from the desktop fixture. Portrait and landscape on both apps must be reported
with their actual result, including any remaining gaps. No full Fees internal
workflow or whole-app acceptance is implied. No credentials, records,
payments, messages, providers, migrations or authentication/security settings
were changed; the existing TEST note and receipt `TST20261102-0001` were untouched.
