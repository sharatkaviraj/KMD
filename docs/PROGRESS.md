# VPPS One — progress

## One on a desk: every screen uses the width it is given — 7 November 2026

Owner asked (7 Nov) for the desktop view of the whole app, everything changed
so far included, to be optimized and tested, with creative touches, and
deployed tonight. Branch `claude/project-thread-oio4yk`, D-528 to D-533.
Every screen checked at 1920, 1366, 1100 and 1000 wide and on a 390 phone.
**Done:** Today's Fees today starts under the teaching cards beside the rail
(no more empty block), and the money cards arrange by their own width (an
empty ring and a line of help in How they pay before the first receipt; the
year's pace ends with "Still to come this year" and "Due by today"). The
Students table fits 1366 and 1100 with its Call / WhatsApp / Collect buttons,
its header sticky under the top bar. The desk side menu fades and offers
"More below" when it runs past the fold, keeps the open screen's item in
view, wraps long names, and fetches a screen only on intent. School
settings' form stacks beside the receipt in a narrow panel. Admissions: SR on
one line, document pills fit, pipeline buttons stay in their cards. A
teacher's Notes has a big New note in the top card on a desk, and the
floating button steps aside while it shows. Phone layouts unchanged. Main had
about 30 bytes left under `/teach/attendance`'s first-load budget, so the
menu's hint is CSS alone, and the money section's words and the "+ New"
menu load with chunks only a desk asks for. Tests:
`tests/mobile-ui/today-desktop-widgets.spec.ts` (5),
`tests/intent-prefetch-link.test.tsx`; the whole suite passes except
`tests/sentry-lite.test.ts` (a checkout under `/home/user`).
**Remains:** Collect (`/payments`) keeps its narrow desk card; it is the
money flow and was left as it is.

## Needs you · Teachers' work: collecting from teachers the Sampark way — 7 November 2026

Owner asked (7 Nov) for the admin's Needs you, where work is given to
teachers, to be reworked so the office collects data from teachers quickly
the Sampark way: links sent to teachers, missing data collected fast,
deployed live. Branch `claude/project-thread-3kf2yi`, D-520 to D-523.
**Done:** Needs you split into "To decide" and "Teachers' work"; the board
with three next steps and every request grouped by teacher; a WhatsApp send
list for links and reminders (one green button per teacher, the message
typed in, the send noted through the existing delivery functions, nothing
sent by the app); Ask teachers as four numbered questions with missing
counts and a live "children · teachers" plan; changing a teacher re-checks
in place and offers only teachers the server accepts. Tests:
`tests/teacher-tasks-collect.test.ts` (23), `tests/teacher-task-send-queue.test.tsx` (4),
`tests/teacher-task-collect-board.test.tsx` (4), recovery test repointed.
**Remains:** a teacher's own per-teacher page that lists all their open links
in one place, and automatic sending through a paid WhatsApp provider (needs
the owner's go-ahead), were left for later.
**Live check (same evening):** on a real Galaxy M32 and Windows Chrome the
board, Ask teachers and the send list worked, but the phone showed "could not
note it" after the green button. Cause: `queue_teacher_task_delivery` read a
bare `snapshot`, which `message_sends` also has as a column since
`20261004084641`, so no task delivery had ever been queued on live. Fixed by
migration `20261107174655` (variables named through a block label; applied to
One's database after a rolled-back dry run) and re-checked on the phone: the
tap is noted and the board updates. The SQL fixture now carries live's
`message_sends` columns so the test fails without the fix. Also: the Ask
sheet's sticky footers paint the 12px under them, so the list no longer peeks
out below Cancel.

## The Menu tab, redrawn with Settings first — 7 November 2026

Owner asked (7 Nov) for the phone Menu tab to be redesigned: Settings quick to
reach, clearer labels and buttons, creative touches so non-technical staff
understand it and use it fast, deployed live. Branch
`claude/project-thread-h2m3nx`, D-519. **Done:** Settings card first (quick
switches with their state in words, one big Settings button, My settings /
Password / School year); "Your shortcuts" with Change (a non-admin's defaults
skip the bottom bar's screens); sticky group chips that light the group in
view; every tile says what it opens, in coloured groups; Listen reads the page
and lights each part; Sign out asks once. Tests: `tests/vx-menu-items.test.ts`.
**Live** from 16:44 UTC (PR 298, merge 3ada532). BrowserStack: real Galaxy M32
Chrome passed as QA admin (card, switches, shortcuts, Fees chip jump, sign-out
sheet and Cancel). Windows 11 Chrome (2560x1600) drew the desk layout right
but clicking "Records" lit "Studies": the chips' scrollspy band assumed the
phone's header, and the smooth scroll overrode the tapped chip. Fixed in the
follow-up PR (band measured from the sticky row; a tapped chip holds until a
hand moves the page). **Remains:** the teacher's More page is separate and
unchanged.

## The small things: faces, a year switch you can see, taps that answer — 7 November 2026

Owner asked (7 Nov) for a thorough pass over One for non-technical teachers,
starting from two examples on the real year: no photo while writing a note,
and no animation when switching the year. Branch `claude/project-thread-6smwbz`,
D-511 to D-516. **Done:** the child's face on every note screen (`Face`); the
real year's photos copied from Fees into One by an admin's "Refresh roster
now" (batched, with a bar; source `fees`); the identity views follow the
nightly roster (26 h, which had been refusing real-year saves between
copies); one migration, `20261107142035`, applied to One's database with the
owner's go-ahead. Every `@/ui/link` dims while its page loads, the top bar is
3 px, a tapped tab lights at once, and "Opening…" shows above the tabs for a
page slower than 450 ms. The year switch shows "Opening 2026-27…" and then
"Now showing 2026-27". Smaller fixes on Messages, Calendar, Settings and the
notes board (D-516). Tests: `tests/fees-photo-copy.test.ts` (13); the whole
suite passes except `tests/sentry-lite.test.ts`, which fails only in a
checkout under `/home/user` (the path contains "user").
**Remains:** teachers see real-year photos after the first "Refresh roster
now" by an admin; the copy is not automatic (owner's choice).
**Live:** merged as PR 295 (`92036b2`), on one.vpps.co.in from 15:09 UTC.
Checked live as QA admin and QA teacher in a container browser (a drawn test
photo on one TEST child shows in New note on phone and desk; initials where
there is none; tab lit within 0.12 s; "Opening…" on a slow page) and on
BrowserStack (real Galaxy M32 Chrome and Windows 11 Chrome): all passed but
the year picker's words, which D-517 fixes (desk heading still "Test / UAT /
DEMO", phone sheet Hindi-only for a both-languages reader). Same branch,
restarted from main after the merge.
**D-517 live:** merged as PR 296 (`bf71816`), on one.vpps.co.in from 15:56
UTC. Checked live as QA admin (reads both languages) in a container browser:
the desk menu's heading reads "Practice years · अभ्यास वर्ष", the phone
sheet's the same, and the row badge "TEST · परीक्षण"; nothing says "Test /
UAT / DEMO" or "Other production" any more.
BrowserStack re-check of D-517 (real Galaxy M32 Chrome and Windows 11
Chrome, QA admin): passed. It found one more thing: straight after sign-in,
before any reload, the shell's words were English for a reader of both
languages and `<html lang>` stayed "en". **D-518** makes the root layout's
fee language provider follow the locale and catalogue the server sends again
after sign-in and after the EN | हि switch (it had kept its first props as
state); the real /login signs in the same way, so it is covered too. Test:
`tests/shell-language-follows-server.test.tsx` (5).
**D-518 live:** merged as PR 297 (`e0712c7`), on one.vpps.co.in from 16:28
UTC. Checked live in a container browser, desk and phone, straight after
sign-in as QA admin with no reload: `<html lang>` "hi", the menu heading
"Practice years · अभ्यास वर्ष" and the badge "TEST · परीक्षण". The EN | हि
switch (QA academic, the coordinator screens carry it) now moves the year
menu with the page: हि gives "अभ्यास वर्ष", EN gives English; the account's
language was put back to "en" afterwards. BrowserStack (real Galaxy M32
Chrome and Windows 11 Chrome, QA admin, straight after sign-in): passed,
both lines in both languages and `<html lang>` "hi".
**Second pass (D-524 to D-526):** the teacher screens on a 360 px phone,
live on TEST-2026-27, as QA teacher (Hindi) and QA teacher 2 (English), 15
screens. Fixed: one name per subject in each language on Today, My class, My
subjects, More and the profile (`subjectWords`; "ELGA" is no longer "Elga"
anywhere, report cards included); a paper with every mark in but not sent
says "Filled · not sent" on Today, My subjects and More, and the Marks tile
counts it instead of "Nothing waiting"; "Attendance" fits the centre button;
the top bar's line and a child's name in the register take two lines.
Test: `tests/teacher-one-subject-name.test.ts`.
Merged as PR 303 (`ef4a7b3`).
**My tasks (D-527):** each marks paper names its exam and the exam office's
"marks due" day under its title, says class and subject as the marks screens
do ("अंक · कक्षा 1 · पर्यावरण"), and the list runs oldest exam first, then
classes in school order. It used to read "Class 1 · EVS" once per open exam
with nothing to tell them apart. Built beside the teacher-data PR 301, which
merged first, without touching its lines. Test: `tests/teacher-tasks-exam-name.test.ts`.
**D-538:** the live check as QA teacher 2 found every Class 11 and 12 card
on My subjects saying "No paper yet" beside a paper that existed: papers keep
the label they were made with ("11 Arts"), the class list says "Class 11
Arts", and the card matched them as text. Cards now find their paper by class
id, and links and My tasks name classes from the class list.
**D-539:** Today's "Mark attendance" button faded to half every 2.4 s,
which on a phone looks switched off. It now stays solid and a ring grows
off it and fades, four times, then rests (none with reduced motion). The
help pictures of the button do the same. Test:
`tests/teacher-mark-attendance-call.test.ts`.
**Live and on BrowserStack:** PR 304 went live at 17:51 UTC (`578a12e`).
It was checked at 360 px as QA teacher and QA teacher 2, then on BrowserStack
on a real Galaxy M32 (Chrome) and on Windows 11 Chrome, and every check
passed. My tasks names each exam, with First formative first. Subjects read
in Hindi. The Mark attendance button stays at full opacity, and its ring is
gone after about 10 s. No Class 11 or 12 card says "No paper yet".
"Attendance" fits under the centre tab, and nothing scrolls sideways.
Still there: leftover `phoneops-20261011` test tasks show under their raw
titles on QA teacher's To do list (TEST data only).

## Today looks the same in the real year, with one widget style — 7 November 2026

Owner asked (7 Nov) why the phone Today in the real session looked different
from the TEST session, and for better, more regular widgets. Branch
`claude/project-thread-hrx5zc`, D-506 to D-509, with schoolfees #150 (merged).
**Done:** the real session now shows the same money cards as TEST (year pace,
families to call, money chart) from Fees' own figures; no duplicate "Fees
collected today" card; a closed day (the Diwali break) shows one clear tile
with the day school opens; every card uses one widget head; new Birthdays
today and Coming up widgets. Checked in a container browser with synthetic
fixtures (`/?view=today&closed=1|ledger=1`, design `F01-TodayLive`,
`F01-TodayClosed`, `F01-TodayLedgerOnly`) at 320/390 px and 1280/1366 px,
light and dark, axe clean on the widgets.
**Remains:** see the thread for the live and BrowserStack check.

## One receipt, everywhere, on one sheet — 7 November 2026

Owner asked (7 Nov) for One's receipt to look like the Fees receipt preview
wherever it is shown, and to print on a single A4 sheet looking the same.
Branch `claude/project-thread-f7ft7x`, D-502 to D-505. **Done:** the receipt
page, the receipts desk's side panel (now 520 px, with Print A4 and Download
PDF above the paper) and the ported Fees receipt page all show the Fees A4
receipt; the phone gets the whole receipt in two columns instead of the
counter slip. Print A4 prints it alone, fitted to one sheet; Collect's and the
payment desk's Print open the full receipt and print it. The PDF is one page
(`tests/receipt-pdf-one-page.test.ts`). Checked in a container browser with
synthetic receipts (`tests/mobile-ui/receipt-paper.html`, `?view=source|desk`,
`&heavy=1`): phone, desktop, desk panel and Chrome's A4 print, one page each.
Live 7 Nov 12:50 UTC (PR 292). Checked live as QA admin on TEST receipt
SVP20260516-0001: phone and desk render it, Print A4 and `?print=1` both call
print, the print fits at 0.901 on one page, the PDF is one page. BrowserStack:
Galaxy M32 (Chrome) shows it in two columns and Android's print preview reads
1/1; Windows 11 Chrome shows four columns with the PAID stamp and Chrome's
print preview reads "1 sheet of paper", A4, the receipt alone. Tapping Print
over WebDriver blocks the driver on both (the print dialog is modal), so the
previews were read from the session videos. A TEST-session sheet keeps the
magenta TEST frame; the real session has none.
**Remains:** a split-tender payment still prints from Fees' own print page.

## One AI page, and the connector on its own — 7 November 2026

Owner asked (7 Nov) for one AI page in Settings instead of three, the MCP
connector on a page of its own and clearly named, and a clear picture of which
model does what, how each job is routed and what it costs. Branch
`claude/project-thread-b5tm9t`, D-501. **Done:** Settings → AI in One shows
every AI job (written drafts, photos, voice) in four views: What AI did, How it
works (animated roads with Show me and Listen), Cost and Switches; one
database function (`ai_overview`, migration `20261107100619`, applied) feeds
it. `/settings/builtin-ai` redirects to its Cost view. The connector is now
"Claude / ChatGPT connector" everywhere, with an explainer, a read-only list
and this month's call counts.
Live 7 Nov 10:54 UTC (PR 288). Checked signed in as QA admin in a container
browser (desktop and phone) and on BrowserStack (Galaxy M32 Chrome, Windows 11
Chrome): four of five steps passed; the job and station sheets were unstyled,
because sheets render in the overlay layer (`.vxt`) outside the page's `.aip`.
Follow-up: the AI styles now apply in that layer and each sheet carries its
own `.aip`; on a phone the arrows between stations no longer take taps meant
for a station, and Show me / Listen scroll the lit station into view; a paid
model with nothing spent shows ₹0, not "Free"; the connector's last "AI
connection" wording now names the Claude / ChatGPT connector. Live 11:21 UTC
(PR 289); BrowserStack recheck on Galaxy M32 passed all four steps, desktop
Chrome too (the Windows session could not be signed in from that thread).
Second follow-up from that recheck: the voice listener (GPT Transcribe) never
finishes a job, so it read "0 answered · 12 tries"; its good tries now count
as heard, and live reads "Heard 7 voice notes · 12 tries" (the other five
failed at no cost, three of them refused with a 403, and the next AI took over). A station's sheet now opens with this road's count
and labels the model rows "all roads together", because NVIDIA Free read
"Answered 2" on the station and "13 answered" in its sheet.
**Remains:** nothing for this page.

## Felt and heard: haptics, short sounds and Listen — 7 November 2026

Owner asked (7 Nov) for haptic feedback where it helps (not too much), sounds
or voice where needed, and other touches that make One easy for non-technical
teachers. Branch `claude/project-thread-v897y5`, D-497 to D-499. **Done:** one
cue helper (`src/ui/feedback/cue.ts`) gives every result a short buzz and a
quiet synthesised chime: saved, finished job, warning, failed, undo, mic
on/off, AI ready. Every toast, save line, fee-kit toast and the old
`triggerHaptic` go through it, so the whole app is covered without touching
240 call sites; the register, Collect, marks, admissions, the Payment Desk and
day close mark their finished jobs as "done". Nothing plays before the first
touch, in the background, or twice for one save. Menu, Settings and the
teacher's More hold the Sounds, Vibration (Android only) and Read aloud
switches, kept on the device. Every Help sheet has a Listen button that reads
the steps aloud in Hindi or English and lights the step it is on, and a
screen's Help button ripples on the first three visits until it is opened.
Live in PRs 280 and 281 (Vibration offered only where the pointer is a
finger). Checked on BrowserStack, Windows 11 Chrome and a real Galaxy M32:
switches, Help ripple and Listen work. The phone's first Listen tap said "no
voice" although Hindi was installed, because a sleeping speech engine took
longer than 1.2 s to list its voices. PR 284 (live): Listen now speaks by
language when the list is still empty, and says the device could not read the
words only when speaking actually fails or nothing starts within 8 s. Rechecked
on a fresh M32 after deploy: the very first tap read the steps aloud.
**Remains:** notes screens are the notes thread's (it imports the same
helper); iPhones cannot vibrate from a web page, so they get the chime only.

## Free AI keys: the free models go first — 7 November 2026

Owner asked (7 Nov) for the best models on the new NVIDIA and OpenRouter keys
and the Gemini Free key, and for One to use them first to cut AI costs, the
paid models as the fallback. Branch `claude/project-thread-946cvd`, PR 279,
D-496 (after D-490). **Done:** measured One's own tasks on every free model that
answered; Nemotron 3.5 Super VL with thinking off and guided JSON passed 10 of
11 in 1-4 s (with thinking on it took 9-12 s, past its 7 s stage). The free models now write a class's results and notices to all parents
or staff as well as the old open tasks, and every text task of a test account;
a photographed admission form never goes to them. They share 20-24 s, rest
after a failure, must answer Hindi in Hindi, and keep working once the paid
budget is spent. `assist_log.provider` applied on wtgx as `20261107075126`
(function granted to service_role only, checked); Settings → AI helper shows
the free share, drafts per free provider and the estimated saving, and its
chain pills now wrap on a phone. **Surprised:** the helper spent $0.055 on
61 drafts in the 30 days to 7 Nov; 43 were test accounts' (now free), and real
staff's were mostly notes and the Today brief, which stay paid, so the saving
grows only as staff use the open tasks. NVIDIA's free tier is a trial for
testing, so its terms, not its price, are the limit to watch.
**Checked live (08:08 UTC, deploy `dpl_77MBhC68…`):** as the QA teacher,
`ask.answer` in English and Hindi and `note.polish` in Hindi were each written by
`nvidia-free` (`assist_log.model` reads `private/nvidia/nemotron-3.5-super-120b-a12b`)
in 2.4-3.7 s at $0; the Hindi came back in Devanagari. As the QA admin,
Settings → AI helper shows "Free AI wrote 3 of 62 drafts", the saving and
"NVIDIA Free 3", with no sideways scroll at 360, 390, 412, 1366 and 1920 px.
Follow-up: the settings row said "Claude drafts"; it now says "AI drafts".

## Notes, card by card — 7 November 2026

Owner asked (7 Nov) that writing a note stop hiding behind scrolls: card by
card like Collect, quick for non-technical teachers, the right child clearly
picked, and the built-in AI sorting the note. Branch
`claude/project-thread-fsmfri`, PR 263. **Done:** "New note" opens four cards (child,
words, check, saved) on the teacher's notes, a class's child sheet and the
admin/coordinator notes board (D-486); the words are sorted on Next and then by
`note.sort` on the quick AI chain, with health/family kept and names masked in
both scripts (D-487). A note that names a classmate instead of the picked
child asks which child it is about. Checked in the container at 360×640,
375×667, 390×844 (en, hi, hi + en) and 1366×768: every card fits without a
scroll. **Surprised:** the offline banner pushed Save under the tab bar on a
small phone until the cards re-measured on a size change; "call the mother"
was being filed as a family note; the decision numbers moved twice (D-482/483,
then D-484/485) because other changes on the same day took them first.
Follow-ups the same morning, from live runs as the QA teachers: PR 268 (the
AI's mark beside the row's label, a clean saved quote, no doubled Hindi word),
PR 270 (the check card never hides a row: the AI's offers fold beside the
words when room is short), PR 273, which moves the frame into `frame.ts`:
on a screen about 600px tall the card now gives way one step more (the AI's
"reading" line goes, the words keep one line) instead of dropping to its own
height and staying there after the AI answered, and the Hindi draft line says
डिवाइस like the English; and PR 275, after which that line no longer says अभी
twice ("सहेजना बाकी है"). BrowserStack on 270 and again on 273 (7 Nov): Galaxy
M32 (Hindi), iPhone 15 (English) and Windows Chrome passed child → words →
check → save → undo, with no test note left behind, and the 275 line read
right on Windows Chrome and the M32. **Remains:** iOS 15 Safari has no
container queries, which breaks the whole app's layout there, not only notes
(reported separately, 7 Nov). Below about 590px of visible height the check
card is drawn at its own height and the page scrolls, by design.

**Second round, the same afternoon (D-500, PR 283).** Janmejay, after using it:
once the class was picked its children could not be seen, a new note opened
with an earlier note's words, nothing showed the AI working, a teacher would
not know how to save the AI's note, and the buttons were too small; look at
the whole flow again for a teacher who is not technical. **Done** in
`cards.tsx`, `cards.css` and `frame.ts`: the whole class in a list that
scrolls inside the card; a note left unsaved is offered ("Continue this
note"), never poured in; a large Speak button; while the AI works, a panel
with a moving spark, dots and changing lines, then its clear note written in
word by word and already ticked, so Save keeps it (the teacher's own words
are the other choice); four labelled tiles; a steps strip on phones; a fade
and an arrow wherever a card has more below; the "ready" and "done" cues.
PR 273's squeeze steps are gone: what does not fit scrolls inside the card,
above its button. Checked in the container: typecheck, lint, the full vitest
run (only `sentry-lite` fails, as it always does in this container), the
phone flow suite 16 of 16, and 42 screenshots of every card at 360×640,
390×844 and 1366×768 in English, Hindi and dark mode, with no sideways scroll,
Save in sight and no control under 36 px. **Surprised:** the quick-word
chips are 44 px tall on a phone (`.tap`), so a strip sized for two rows of
smaller chips showed one; the design fixture's server actions are stubs, so
its Save says "Not confirmed" and the saved card has its own view
(`M-TchNotes-Saved`; the AI at work is `M-TchNotes-AI` and `DX-TchNotes-AI`,
the class list `M-TchNotes-Pick`). Live at 08:52 UTC. Checked live in a
container browser (QA teacher at 360×640 in Hindi, QA admin at 1366×768):
class list, unsaved note offered and continued, AI panel, the AI's note ticked
in 1.2-2.7 s, Only me, Save, Undo, and no test note left in the database.
BrowserStack (run by the haptics thread, 09:00 UTC, as the QA teacher): Galaxy
M32 (Android 11 Chrome) and Windows 11 Chrome pass, nothing left behind.
**Follow-up, PR 285:** the "Written by AI" and privacy line was squeezed to
nothing on a 360 px phone and a 1280×720 desktop (a flex child that clips its
own overflow can shrink to zero, so the card never said there was more); the
card's parts no longer shrink and the body scrolls instead. Undo now returns
to the check card as it was (the box keeps the teacher's own words; the saved
card shows the saved ones), and a child without a roll number shows initials.
**Remains:** the undo toast sits over Save for a few seconds on a phone (the
app's toast position, not changed here). TEST classes have five or six
children, so the list's inner scroll shows on live only in a short window.

## One AI report for the whole year — 7 November 2026

Owner asked (7 Nov) for one master report instead of many: a file with
everything One and Fees hold for a session, photographs included, to give to
ChatGPT and ask for any report. Branch `claude/project-thread-v4b26m`.
**Done:** Reports → AI report (`/reports/ai`, banner on the Reports hub and a
menu entry) builds one Excel workbook (One's sheets, then Fees' AI context
sheets as `Fees …`), or a .zip with `photos/`, `photos/index.csv` and a
read-me, joined on the device from three routes that each stay under Vercel's
4.5 MB (D-484). Fees serves the year's workbook and photographs through two
read-only bridge reads (schoolfees PR 149, merged). `reports:ai` is the
admin's alone until Staff → Roles grants it; every sheet still needs the
permission that shows it on screen, notes pass `canSeeNote`, a real year
without the live connection gets no money sheets, and every part taken is
logged as `ai_report` (D-485; migrations `20261107045006`, `20261107045020`,
applied). **Remains:** the photographs and live money come only for the real
year, so QA accounts (TEST years only) see One's rehearsal copy and no photos.
Follow-up (same day): the first live file showed a few ids still inside
values (class ids in a JSON audience, "withdrawn:<id>", an upload's id); they
now become names or are left out. The decision numbers moved from D-482/D-483
to D-484/D-485 because the Hindi dates change took D-482 at the same time.
Merged as PRs 262 and 264 (`08523aa`). Checked live with the QA admin on
TEST-2026-27: on BrowserStack a real Galaxy M32 (about 20 s) and Windows 11
Chrome both made and saved the 3.9 MB, 77-sheet file; a teacher is refused.

## Every screen on a real phone and desktop — 7 November 2026

Owner asked whether anyone had seen One's screens on BrowserStack, phone and
desktop. Branch `claude/project-thread-gpn8c6`. **Done:** a new
`QA_LOGIN_KEY` on Vercel (the old one was Sensitive and unreadable; the copy
agents read is `/mnt/project-files/secrets/qa-login-key.txt`). A 390×844 crawl
of 352 screens for all ten QA roles found one error: the defaulters PDF
answered 500 for every money role (the export's student read put ~530 ids in
one URL; chunked at 200 in PR 255, live, 585 rows now; same fix for Fees in
schoolfees PR 148). A real Galaxy M32 found three more, fixed here: the tab
bar rode on top of the keyboard (inline `display:grid` beat the `data-kb`
rule, D-479), the accountant home opened the keyboard on arrival (D-478),
Fees home showed two session pickers (D-480); Fee setup said "Inst 4–4".
**Not fixable with QA accounts:** the roster status and "Refresh roster now"
show only for real staff on the real session, and Dues/Fee setup/Reports
show One's TEST copy rather than "Live from Fees" for test accounts.
Fees home's background dues preparation never ran in One (`cookies()`
inside `after()`, "Unable to load school defaults" on every visit); it is a
server action the page starts now (D-481). Windows 11 Chrome on BrowserStack:
admin and teacher screens render correctly. A real iPhone 15 re-check passed.
Hindi screens printed English dates ("Sat 7 Nov", "10 Oct", "1:40 am");
the Hindi line now says them in Hindi wherever they were built (D-488), and
about 90 dates printed outside any pair now go through it too (PR 261; the
fee collector's Today and the classic Payment Desk followed). Re-checked live
on BrowserStack, Galaxy M32 (office) and Windows Chrome (teacher): passed. Books
(cheques, UPI, refunds, requests and their sheets and messages) now reads in
Hindi too (D-489; BrowserStack Galaxy M32 and Windows Chrome passed). Still
English on purpose: parent WhatsApp text and the amount in words on the bank
slip. The "At the bank" hint named the newest slip row (DS-0001, an April
deposit entered late, its cheque long cleared) instead of the slip whose
cheques were listed; it now names the latest deposit that still has a cheque
at the bank (`slipStillAtBank`).

## Language choice on Add staff — 7 November 2026

Owner asked (7 Nov) that creating an account asks whether the app opens in
Hindi or English. Branch `claude/project-thread-25gwfp`. **Done:** the Add staff
sheet on `/staff` has an "App language" choice (हिंदी, English, हिंदी + English;
Hindi first) and `addStaffAction` saves it instead of always `both` (D-476).
No migration. **Remains:** nothing; existing accounts keep their language.
Follow-up (same day): the Add staff button only showed on desktop widths, so on
a phone an admin could add a login but not a person. The phone header now shows
"Add staff" for anyone who may manage staff (Add login for an admin who may not);
a new person's page offers Create login. The decision number moved from D-475 to
D-476 because the Reports change took D-475 first.

## Office roles school day in TEST — 6 November 2026

Owner asked for agents replaying a whole school day as the academic
coordinator, exam coordinator, accountant and admin in TEST-2026-27 (qa.*
accounts, one.vpps.co.in). Branch `claude/project-thread-rjz9br`. Findings:
`/mnt/project-files/day-run-office/` (admin, academic, exam, accountant). **Done (this PR):** admission wizard recovers from a 504 that saved
(was stuck on "Saving…") and warns when fees did not set up (A-14); a
coordinator cannot overwrite a saved register without a reason (AC-01, server
and sheet); academic menu has Cover, Needs you, Notices (AC-02); half-day is
not counted as leave and the present line matches its % (AC-03/04); weekly
summary names the current exam (AC-08); write-off reasons in words (A-05);
"No class teacher" sentence (A-20); denial for Admissions/Student tools names
the right area (AC-17/E34); undeliverable cover notices no longer read
"queued" (AC-07); results board keeps `exam=` on every step (E43), refuses
"Send results now" with nothing locked (E26, server too), shows schedule in
India time and no longer shifts it on re-save (E27); report card PDF prints
"कुल" in the Hindi font (E33) and the chosen exam's title (E44); EN means
English (E45). **Surprised:** live One's DB was CPU-starved from ~11:19 UTC
while four threads crawled it; saves took 30–150 s. TEST-D-*/AIQ-* students
have no installment rows (seed data), which explains "No fee record".
**Money (same PR):** receipt panel and reverse sheet say what was forgiven
with a receipt, including a counter waiver found by request id (A-18, B4);
daily collection report/CSV nets reversals (B1, P0); a timed-out save says
nothing was saved (B3); Left owing is session-scoped (B2 part); one family
call counts once (B8); reminder preview shows the family's real overdue date
(B9); search finds whole SRs like TEST-D-0366, JKG/SKG are classes (B11);
Today's sparkline and follow-ups leave reversals out (B12); Promises tab
counts open promises. **Evening follow-up:** Dues "not due yet" now reads installment rows due
today or later, the same rule as Reports. SQL showed 507 TEST children with
₹1.13 Cr owed on the student row and no installment rows (live 2026-27: 1),
which made Dues read ₹117 L against Reports' ₹4.4 L. The late fee forgiven at
the counter (waive_late_fee under the receipt's client_request_id) is now
read by the shared receipt detail, so the receipt page, the slip and the PDF
all show "Late fee waived". **Overnight follow-up (PR 241; the family race was fixed in PR 239):**
EMI plan rows read "EMI 2 late fee", not "Inst 101"; receipts say "Owed
before/after" because pending_before_posting holds the row's late fee too;
the Dues tile says how many of its students have left (the badge counts
active only); one helper writes session labels (TEST-2026–27, not
TEST–2026-27); the desktop TEST tab no longer covers the session pill;
Session health offers "prepare missing dues" when only fee-less QA classes
stood in the way. The Who-list "full year, no late fee" figures were TEST-D-
shells with no installment rows (installments appear on a first payment).
**PR 246 (night 6 Nov):** Session health's Reconcile for TEST-2026-27 now
finishes: the fee write guard places `installments.id` (through its student)
and `session_reconcile_log.id` (through its session), and the generator pages
its student read, which PostgREST had cut at 1,000 of 1,137 children across
both sessions. Run live 18:58 UTC: 519 active TEST children, 519 with dues;
the 4 still missing are in classes with no fee setting (QA fixtures, "7 Z").
The reconcile log no longer counts other years' children as needing
attention. The same unpaged student read is in `veerpatta/schoolfees`
(not changed from here).
**Open:** QA fixture classes in pickers (needed by the harnesses), the admin's
15 s of "Reversal asked" (not reproduced), load-only timeouts.

## Teacher school day: 20 seats in TEST — 6 November 2026

Owner asked for 20 teacher agents replaying a school day in TEST and the bugs
fixed. Branch `claude/project-thread-fgot2n`. D-443 to D-446. **Done:** teachers
1-10 ran the day on live One (Smoke Lab seats, TEST-2026-27) before the run was
paused for database load; bug list in project files `teacher-day/`. Fixed: a
note saved twice files once (migration `20261106122604` applied on wtgx),
health/family note audience line, papers with no children no longer read
"Sent"/"Done", subject teachers see their periods first and a period opens
their subject, "You You" on the class timetable. TEST data only: enrolments
dated from 1 Apr and 14 TEST classes given smoke-seat class teachers so seats
have registers. Second batch (after teachers 11 and 18 re-checked PR 219 live): sent papers never say "Continue" (D-447), no attendance remark before 10 days (D-448), a subject teacher's periods are really the first card on a phone (order -1), a subject page without a paper is named, half days counted on Today and the class page. Third batch (teachers 12, 13): Send waits for an in-flight autosave (D-449), autosave says "Saving", absent/exempt count as entered on the class page, a period matches its subject by code, then name, then the only subject in that class. Fourth batch (teachers 14, 15): the register page's month read is two indexed reads instead of an embedded join ordered by mark id (D-450; it hit the statement timeout nine times and showed React #441); a child's page no longer paints "Attendance 50%" red from one day (same 5-day rule as the "Low attendance" chip); the teacher notes tile says "others open"; teacher 15: a saved register lists half-day children on their own line (not under "अनुपस्थित:"), the class page says attendance counts only after 5 marked days, and a combined period on Today can be tapped. **Open:** teachers 16, 17, 19 and 20 not run: the One database ran out of headroom at 13:45 UTC and the smoke thread stopped live page loads for the day. Parent WhatsApp ON by

Parent messages (owner's answer to D-320, 6 Nov): Settings → Parent messages lets the admin turn off, or set where it starts, every message teachers can queue for parents: the register's absent-child WhatsApp, "Tell parents" on a note, sharing a support plan, birthday wishes (D-451). Enforced in the server actions and hidden on the screen. Default keeps current behaviour until the admin saves.

Last four seats (16, 17, 19, 20; one browser, after the 16:15 UTC database restart; every page under 9 s): a refresh during a note save brings the note back with its id, or says it was saved; the Notes tab closes an open form; the class page's Sampark list says "N blank — tell the exam office" for a sent paper with blanks; a health note's empty replies line names the admin; the tab bar no longer covers Save on a phone (D-464); a teacher with nothing assigned gets an "Attendance" title, no note shortcut, a Marks page that says she has no subjects, and Help opening on her own topic; My profile has Change password (Back returns to the profile); My tasks lights "Notices, links & leave". **Open (P3):** help pictures use other words than the buttons, Bolo is voice only, sidebar lacks Timetable/Tasks/Help/Profile, no office phone set in school profile.

Teacher-day polish (6 Nov evening, D-473): help pictures in the reader's language with the real button words, and a My profile help topic; desk sidebar gains Timetable, My tasks, Help and My profile; no-class Today drops Bolo and the children card, says "ask the office" without a phone, and shows both languages in Both mode; empty Notes hides counters and filters; attendance chooser has Help on a desk; timetable colour key hidden past five classes; health-note plans keep the coordinator out; leave over P1 mentions the register; the AI cover plan names its day. Left: typed Bolo, the office phone (needs the real number in `NEXT_PUBLIC_SCHOOL_PHONE`), the cover card that vanished (teacher 11), one header style for every desk screen.

Teacher-day last items (6 Nov night, D-474): Bolo takes typed requests (text box under the mic; migration 20261106192629 applied to wtgx); Today says "Cover changed" when the office cancels or moves a cover (teacher 11's Mon 9 Nov P8 was cancelled at 12:51 and just vanished); every teacher desk header is language switch then "? Help" with the word; teacher "Call the office" uses the fee app's parent-facing office number until `NEXT_PUBLIC_SCHOOL_PHONE` is set (owner to confirm the number).
default on a register's first save (D-320) left for the owner.

## Collect: card-by-card payment entry — 5 November 2026

Owner approved the Collect prototype; plan
`docs/plans/2026-11-05-native-money-and-collect-flow.md` §3 (copied in with the
prototype). Branch `feat/collect-flow`, not pushed. D-420 to D-426.
**Done:** `/payments` is Collect — who → dues → amount → payment → (check) →
sealed, the prototype's motion and shortcuts, same cards on phone and desktop
(rail ≥900 px, child panel ≥1180 px). One UI on a money port: the bridge
adapter for real staff (directory lookup, `getBridgeCollectDues`, quote, post,
`getBridgeCommand`), the local adapter for test accounts (the vx desk's
actions, attempt store kept). Family = one payment per child with its own
command id, stored before the first post; lost answers are checked by id;
partial failures retry only the rest. Cash + UPI sends `tenders` (schoolfees
#141); UPI/bank carry no reference. Classic desks at `/payments/classic`
(`?classic=1`). Domain in `src/modules/collect/domain` with Vitest; browser
fixture `tests/mobile-ui/collect.html` + `collect.spec.ts` (no-scroll at
360×640, 390×844, 1366×768, 1920×1080 in en/hi/both). **Not done / open:**
Fees-side "likely today" and a family command (plan §4); One's receipt
template does not know `split` (split receipts print via Fees' `printUrl`);
Cash + UPI is off on the TEST ledger; nothing was posted to any ledger —
checked only on the synthetic fixture. Saving on real staff still needs
`FEES_BRIDGE_WRITES_ENABLED` and #141 deployed.

## AI helper: best model per task, drafts that wait for staff — 5 November 2026

Owner: Gemini free first, then the Claude Max / ChatGPT Pro API credits, Gemini
Paid last, best model where it matters, and AI that feels part of substitution,
notes and the automations; implement, migrate, deploy. Branch
`feat/ai-tiers-ambient`. D-416 to D-419 (`docs/ai/DECISIONS.md`). **Done:**
three tiers (Haiku / Sonnet / Opus 5.5) with OpenAI then Gemini Paid behind;
free key for open tasks only (D-401 kept, D-417); Settings shows the chains;
Check keys probes Opus and the OpenAI drafting models; `assist_drafts` and
`cover_reports` applied on wtgx as `20261105063256` (no grant to anon or
authenticated, checked); cover plans prepared on save and by the new
`assist-prepare` job (07:35 IST), Saturday class digests, a "Ready for you"
card on teacher and admin Today, the plan inside the duty, voice notes tidied
by themselves, "How did the period go?" and "While you were away". Merged as #199 and live on one.vpps.co.in. **Key check, 12:43 IST,
production:** every routed model answered: Claude Haiku 5.5 (2.4 s), Sonnet 5.5
(3.0 s), Opus 5.5 (2.0 s); OpenAI `gpt-6-luna` (3.2 s), `gpt-6.1-sol` (3.9 s),
`gpt-transcribe`; Gemini Paid 3.5 Flash-Lite (text and image). The free key now
works: 3.5 Flash-Lite, 3.6 Flash and 3.1 Flash-Lite pass; 3.8 Flash gave 503/504
(Google busy) and 2.5 Flash 404 (retired). Settings → AI helper shows the three
chains; `/api/assist/drafts` answers. No cover duty was assigned that day, so
no prepared draft has been seen in production yet.

## AI keys checked, Gemini model set, Claude voice fixed — 4 November 2026

Owner: wire the free Gemini key into the router, pick the model, check every
key against production and deploy. The router and key check shipped in #196
(`1bc7c9b2`). **Key check, 15:15 IST, production:** Claude Sonnet and Haiku,
OpenAI `gpt-transcribe` and Gemini Paid answer; the free Gemini key answers no
model (403, billing; 404 for 2.5 Flash), so it needs replacing with a key from
an AI Studio project on the free tier. **Set:** `GEMINI_MODEL=gemini-3.5-flash-lite`
(Production, Preview; D-415). **Surprised:** Claude had never answered a voice
command. Its output schema's 20 optional fields made Anthropic's grammar
compile outlast the 18 s stage, so Gemini Paid answered every clip (Maya clip:
26.6 s). Branch `fix/claude-voice-schema` gives Claude a format with no
optional fields (D-414). No eval: `tests/ai-fixtures` does not exist.
Results: `docs/ai/PROGRESS.md`.

## Bolo cover by voice — 4 November 2026

Owner: "maya test mam is absent today unka substitute laga do in test session
… didn't complete the task; train and optimise it". Branch
`feat/bolo-teacher-absence`, D-405–D-406. The ledger showed why: the clip was
transcribed "Mr. Sharma is absent today…", the model invented "period 1" for
the only cover intent (one period, class and substitute required), and a
second phrasing was refused as unsupported. Now: a `teacher_absence` intent
with planner-proposed cover per lesson, single-period cover without class or
substitute, honorific-tolerant teacher matching, teacher/class spelling hints
for the listener, and a Hinglish prompt with examples. **Provider keys:** the
OpenAI transcription key and the Gemini free key both answer HTTP 403 in
production, so Gemini Paid hears every clip; fixing those is an account
change for the owner. Also (D-407): voice-typed words in notes now show
instantly — partial results no longer re-render the whole composer, and the
per-word fade is gone. Release and live checks follow in this row.

## Phone quick substitute and voice typing — 4 November 2026

Owner: add photo and Bolo to the phone's "+" quick substitute, optimise the AI
screens for phones, and fix voice typing in notes ("repeated words, very
poor"). Branch `feat/quick-cover-ai-mobile`, decisions D-403–D-404. The "+"
sheet gains Quick substitute (Photo · Speak · Arrange) for people who may
arrange cover while built-in AI is on; hold-to-speak, photo pickers, sheet
footers and marks inputs are sized for phones. Voice typing rebuilds each
listening session from all of Chrome's results, merges Android's restated
phrases, and ignores results after Stop. **Released:** #192 merged as
`16925a7d` (all checks green after the Quick substitute row moved to a lazy
chunk: /students 243.6 KB against its 243.7 KB ceiling, main 243.4), production
`dpl_GrtddLVS9f7GCCfAKjv1zTMv4TNu`. **Verified live** in a 386 px frame on
one.vpps.co.in (admin, TEST session, fictional data): "+" shows Quick
substitute (Photo · Speak · Arrange) in place of "Assign substitute"; a slip
handed to the camera input opened "Substitute from a photo" and read at once
(no rows: slip dated 5 Oct, the date guard); Speak opened "Substitute by voice"
with the example and a 76 px hold button; a stand-in recognizer replaying
Android's restated finals, a silence restart and a late final after Done left
the note "Aarav did not bring his homework today again" (cleared, not saved).
Follow-up #193 widens the Bolo sheet footer, which shrink-wrapped to 73 px.
**Not verified:** a real phone microphone and camera, iPhone Safari.

## Built-in AI goes live — 4 November 2026

Owner: "check and deploy this plan perfectly in the live one app" (photo marks,
photo substitutions, Bolo voice; #188 had merged it as a TEST-only pilot that
refuses production). Branch `feat/builtin-ai-live`, decisions D-399–D-402,
details in `docs/ai/`. **Database:** `20261104055339_builtin_ai_live` applied
on wtgx while the feature was off; the stored statement's MD5 equals the file,
and the three pilot files now carry their recorded versions. **Code:** one
switch `VPPSONE_BUILTIN_AI` (`test`/`live`), jobs follow the person's session,
test accounts stay in TEST (code and SQL), real records skip Gemini Free,
valid cover-photo rows auto-apply with the two-minute Undo, panel wording no
longer says "test session". **Not changed:** staff WhatsApp transport (cover
notices queue, held, until the school turns staff notices on). **Released:**
#189 merged as `39c4526a` (27/27 checks green); production with the switch at
`test` (`dpl_AXF382EU9jcGRXe7P5bVdPhjXHq4`), then **`live`**
(`dpl_A4kQZT45891zv2SePLpJCaFkTrzv`, one.vpps.co.in). **Verified live**
(admin, fictional fixtures): TEST cover photo read 5/5 rows via Claude Sonnet
5.5 in 4.5 s and wrote nothing; the date guard returned no rows for a
wrong-date slip; Bolo answered "who is free in P5" read-only in TEST and in
2026-27 (Gemini Free skipped, 3.6 s, ₹0.03). **Surprised:** Gemini Free and
OpenAI transcription fail in production (each falls through; voice works via
Gemini Paid); a parallel session is fixing the Gemini request schema and
adding failure status codes. **Not verified:** marks photo end to end on
production, phone microphones, Hindi speech, real handwriting accuracy.

## Review plan finish and AI connection — 4 November 2026

Branch `docs/review-finish-20261104` (this record, docs only); matrix per
requirement ID in `docs/plans/2026-11-04-review-completion-matrix.md`,
decisions D-384–D-398. **Released (One):** #174 `bcfc5881` (picker focus
fixture), #175 `ee2fe796` + #177 `02cc89eb` (search without the workspace
read; lean lookup), #176 `678add9a` (dues on `fees:view`, `assist_log` purge,
leave idempotency), #178 `04bf7a90` (F01–F03), #182 `45436075` (bridge
timing), #181 `b0f49acb` (guided cover), #180 `157dd7a0` (N02/U01/T01), #184
`fc59f2d5` (P02 section reads), #179 `eb9631e8` (AI connection M0/M1).
**Fees:** #135 `75b4132a`, #137 `4079ff00`. Production READY: One
`dpl_8x7BSjdNoNMz9TFuQmQowcsQ1Zma` at `eb9631e8`, Fees
`dpl_2c62oJTDoC6gWuE9dJCrG6w8GzGm` at `4079ff00`; CI green on every merged
code PR. **Migrations applied (wtgx):** `20261103192446`
teacher_leave_request_id; `20261104022925` ai_connection_mcp (RLS on, no
browser grants, functions service_role only, switch off). None on the Fees
database. **Verified live** (desktop Chrome, admin, timings only): Today
₹38,125 / 5 receipts matched Fees exactly; MCP discovery correct,
unauthenticated call 401 with `WWW-Authenticate`, median 95 ms. **Held:**
#183 + Fees #136 receipt send (Fees migration `20261103213000` needs a
rolled-back off-hours dry-run first); #185 waits for Fees #138, whose `scan`
check fails (`rounding-policy-mixed` 5 findings vs budget 4); #186 (Today AI
status line) on auto-merge. **Not verified:** search misses 500 ms (repeats
0.58–0.68 s, first-time 1.36–2.2 s, cold 5.4 s); P02's latency effect (one
cold sample, 4.3 s page); Android (no device); other roles (no logins);
N01/N03/A01/C01 live lifecycles (would create real records); Claude/ChatGPT
connection (owner connects himself; ChatGPT needs a paid workspace not
confirmed). Manual day close still not built (D-383). Surprised: the
directory SQL is 7 ms warm, so the seconds are in the bridge call chain.
Next: warm P02 samples (revert #184 if slower); fix #138's scan, merge #138
then #185 and measure; receipt-notice dry-run off-hours; owner's M0 provider
test incl. the forwarded-link test; then the switch for named admins.

## Fees office commands and release of the review plan — 3 November 2026

Released: Phase 3 (#169, `d6c44cb7`); Fees office reads (schoolfees #133,
migration `20261103170000` live, confirmed by read) and `FEES_BRIDGE_OFFICE_READS=true`
in One production; Fees office commands (schoolfees #134 `c7f91a1f`, migration
`20261103190000` dry-run with its fixture in a rolled-back transaction on live,
then applied with `supabase db push`; all grant flags off, browser roles denied).
Hotfix #170 (`94b854a8`): the transport allowlist refused the office reads
(D-380). #171 (`feat/fees-office-commands-ui`): Reverse on the Fees receipt
page and refund decisions in Needs you (D-382). Grant flags `can_reverse`,
`can_decide_refund`, `can_process_refund` set on the two admin grants for
2026-27 (owner's choice: admins only); everyone else stays refused by Fees.
Surprised: the phone harnesses need every new server-action module aliased to
a stub, or Vite's dependency scan fails and reloads the page mid-test.
Remaining: day close (D-383); MCP feasibility; a real-device pass; a first
reversal or refund decision by a signed-in admin, which no test has made live.

## Review plan, Phase 3: native workflows — 3 November 2026

Branch `feat/review-native-phase3`, stacked on Phase 2 (#168). The Fees
receipt template, Print and Download PDF inside One (F03); "Decide several" in
Needs you with grouped, confirmed, retryable decisions (N01/N02); attendance
reminder reasons (A01); cover's first step and plain empty states (C01); Fees
office reads wired behind `FEES_BRIDGE_OFFICE_READS` (off). Fees side: PR
#133 merged as `5dc9ebe4` (code deployed; office reads answer 503 until its
migration `20261103170000_one_bridge_office_reads` is applied with
`npx supabase db push --linked --yes` from the schoolfees checkout — not run
here: production database access needs the owner). Fees write commands are
draft schoolfees PR #134: reversal, refund decision and refund processing, each
behind `commands_enabled` and its own grant flag (default off); day close was
skipped (Fees has no manual close or SQL engine; only the nightly cron writes it).
Its SQL fixture must run on an isolated schema copy before merge. Remaining: Phase 3 release; apply the Fees migration, then
set `FEES_BRIDGE_OFFICE_READS=true`; review and release the write commands;
MCP feasibility after that.

## Review plan, Phase 2: daily speed and clarity — 3 November 2026

Branch `feat/review-daily-phase2`, stacked on Phase 1 (#167). Student 360 no
longer rebuilds itself when fees arrive (P01: one mounted card, thumbnail kept);
a photo viewer with zoom and Save (P04); concessions summary and folded settings
(P05); compact household and history with restrictions always visible (P06);
the Students list labels stale results while searching and replaces the quick
pills with one Filters button and a grouped sheet including enrolment (S02/S03).
Also fixed: phone masking regex and per-parent numbers. Verified with unit
tests, the Student 360 / documents / admin-mobile browser specs (documents run
serially; parallel runs time out on this machine) and harness screenshots. No
migration, data write or message. **Released:** PR #168 merged as `d48e6668`.

## Review plan, Phase 1: trust fixes — 3 November 2026

Branch `fix/review-trust-phase1` from `2437e9ae`. Raj's 3 Nov review plan is
mapped per ID in `docs/plans/2026-11-03-review-plan-implementation.md`. Root
cause shared by most findings: readers left on local fee tables after the Fees
connection went live, with refusals turned into empty results. Built: global
search through the Fees directory/One roster with honest failure (S01), no
false "fee figures could not be read" (T02), per-part money requests and
could-not-read states with Try again instead of 0/"All clear" (T03),
Assign Work tolerant of children missing from the Fees roster (N03, confirmed
from production `student_missing`), explained receipt refusals (F02), the real
logo (T01), no "Bus · No transport" (P03), and the waiver shown only when a
late fee is pending. No migration, no data write, no message. Fees-side reads
(`/summary/today`, `/requests/pending`, `/receipts/lookup`, `/receipts`,
cross-session receipt detail) are in schoolfees PR #133. **Released:** PR #167
merged as `ca58c86f` (26/26 checks). CI caught a WebKit stall on the payment
desk: the new logo used the real `next/image` in a harness that stubs it
nowhere else and popped in with a spring transform; harnesses now stub it and
the logo is still on documents.

## School Office second pass — 3 November 2026

Branch `feat/school-office-v2` (with `feat/returns-readiness-copilot` merged in),
based on `37c9e6e3`. Certificates: study, character, date-of-birth and TC kinds;
a formal navy-and-gold A4 layout with the principal's block and a verification QR
(`/cv/{code}`); a certificate sheet on Student 360 (kind, purpose, conduct/TC
reason, prepare, print/download/share, reprint-first, draft kept across a fix);
a desk with counts, a signing tray printed as one file and handed over together,
kind filters and class batches; settings for school identity, signature policy,
pre-printed paper and wording with insert chips and a live preview. Returns: a
readiness board, class x field heat grid and the Portal Copilot.
Migrations `20261103031956_school_office_certificate_kinds` and
`20261103032018_returns_copilot_rows` are applied to wtgx; a rolled-back check
proved per-kind serials, reprint-first, the TC `not_left` refusal, the roster
and that TEST issues never verify. Surprise: the QA sign-in tool now refuses
the QA accounts on production, so screens were checked in the synthetic School
Office harness rather than signed in. **Released:** PR #163 merged as `cb2c7af2` (25/25
checks green); production deployment `dpl_6cveAjNe5xEsFQU1oB2NX92bkyFT` READY on
one.vpps.co.in, `/cv/{code}` answers publicly, staff routes redirect to sign-in,
no runtime errors in the first hour. Remaining: the school's real principal
name, place and codes in Certificate settings; a real certificate printed and
signed once by the office.

## Android landscape password follow-up — 3 November 2026

Branch `codex/android-landscape-password-20261102`, based on released `0007d514`.
Real S24 tracing reproduced a 41px visual-viewport pan after the type switch;
input layout and document scroll stayed fixed. Skipping an unchanged selection
restore did not help. A bounded, cancellable viewport correction retains the
field's visible position while preserving the existing keyboard/focus/caret
fix. [Evidence](evidence/2026-11-03-android-landscape-login.md) distinguishes
native baseline/prototype measurements from exact-build release verification.
The owner authorized merge and live deployment; CI and device release results
are recorded in the pull request. No business records or provider effects.

## Android findings — 2 November 2026

Branch `codex/android-findings-20261102`, based on deployed `1a88631` / PR159.
Payment picker identity now wraps independently of money; password visibility
preserves editing focus/selection; historical academic results have names and
permission-respecting links; primary navigation uses the existing visual
viewport offset. Per-pupil averages, current roll/eligibility and detail guards
remain. [Evidence](evidence/2026-11-02-android-findings.md) separates fixture
reproductions from unavailable real-device coverage. Local units/typecheck,
payment/login/receipt fixtures pass. Local production build failed ENOSPC;
clean exact-head CI, deployment and public runtime provenance are tracked in
the linked release evidence and pull request.
The owner subsequently authorized this release; no data/provider/message action.

## Simpler student Documents — 2 November 2026

Branch `codex/student-documents-ux`, based on `3c9076e`. The owner requested
brainstorming, implementation and live release. Uploaded files now lead the
Documents tab, with persistent Add, authenticated Open links, an in-profile VX
upload sheet, optional notes, progress/retry and confirmed removal. School-issued
certificates remain separate below. Preview/read-only accounts have no write
controls; storage routing, existing transports and actual-student fences remain.

Implementation `b2334db`, followed by fresh-review fixes. Final local verification:
429 unit files / 19,232 tests passed and one skip; all 45 profile/stream/document
browser cases pass, including 16 document cases, 320/390/1280px, light/dark,
Hindi/bilingual, keyboard, upload/removal failures and three streamed-fee races.
The workflow now lives above the fee Suspense boundary; a delayed read cannot
discard a draft, retry identity or in-flight upload. Fresh review found no
critical issue; both its stream-state and bilingual-label findings were fixed
with failing-then-passing regressions. Typecheck/scoped lint, 430 theme tokens,
828 ported imports and the sibling-fixture build pass. Full lint has 15 existing
warnings. [Release evidence](evidence/student-documents-2026-11-02/README.md),
[PR #158](https://github.com/veerpatta/vppsone/pull/158). CI/publication verification
remain before merge. No migration or real document/payment/message mutation.


## School Office, certificates and official records — 1 November 2026

Branch `feat/school-office-operations`, based on `c3c05f1`; certificate commits
`8a9a8fd` / `b198bd4`, followed by the government/board integration release.
Owner approved implementation/live deployment, manual signature and numbering
`VPPS/STUDY/<session>/0001`.

Implemented contextual Study Certificate issuance, immutable private PDFs and
exact issue recovery, School Office register/settings, supported government
format mapping/reference exports/staged external-registration reconciliation,
submission/full/partial acceptance evidence, sourced board readiness/deadlines,
retained examination membership and separate official-result revisions. Today,
Needs you, student Learning/Documents, Exam Office and Calendar use these stores.

All five new One-only migrations are applied. Three rollback-only PostgreSQL
scripts pass 19 command/security groups; no fixture rows remain. Full suite:
428 files / 19,206 tests, typecheck and lint pass; 430 theme tokens and 828
ported imports match. Production build/bundle gates pass. Browser evidence
validates 46 distinct scenarios, including two artifact-write failures that
passed targeted reruns after task cache space was recovered. Reviews' material
findings were fixed and covered. Financial/provider authority is unchanged.

Release CI, production SHA and live verification remain the final publication
steps. Actual portal specimens/circulars and official outcomes remain operator
configuration; no invented upload contract, physical-device or portal acceptance
claim. See [release evidence](evidence/2026-11-01-school-office-release.md).

## Faster app frame and student views — 1 November 2026

Implementation commit `5d54795` on `perf/one-student-loading-20261101`, based on
`b666e38`. The target is One at `one.vpps.co.in`.

The directory overlaps optional task metadata with its main read and reads
portraits beside attendance. Student 360 starts its authorized portrait beside
the school model. The informational bridge banner streams after the authenticated
shell. Individual profile/report marks queries request only the opened pupil and
chunk paper IDs; class-wide exports keep their existing behavior.

Search draft state is isolated from the cards, with a 250 ms pause instead of
450 ms, immediate Enter and IME support. Regression checks cover newer typing
during old results, clearing an in-flight query, normalized whitespace and the
transition between multiple pages and one page. Scrolling touches cancel full
profile prefetches before they begin; held intent and keyboard focus retain them.

Validation: 416 test files, 18,728 passed and one skipped; typecheck and lint pass
(15 existing warnings), 828 ported imports clean and 430 theme tokens match.
Synthetic browser coverage passes the 27 existing profile/stream cases plus the
two new 390/1280px search cases (the 390px search also passed the first run).
Fresh review's three search races were reproduced, fixed and retested. Production
build/bundle gates and the deployment record belong to this branch's release PR.

No migration was added. A read-only audit of all 103 repository migrations against
361 live ledger entries found six historical timestamp aliases already documented
in the October assessment evidence, all matched by migration name; relevant
objects/columns exist. No historic migration was replayed. Existing non-smoke TEST
accounts lack `students:view`, so their denied responses are excluded from latency
measurements. No permissions were granted for benchmarking; no real student,
payment or message action was performed. Release evidence is retained in the PR
and `D:\Codex\scratch\vppsone-performance-20261101`.

## Native Fees student records in One — 1 November 2026

Native current-session (`2026-27`) student reads are released through
[PR #154](https://github.com/veerpatta/vppsone/pull/154), branch
`codex/fees-one-student-details`, reviewed head `fdb6903`, production merge
`8756ea6815dd3acb697d852b7757568c1beb9e0c`. All 22 checks passed before merge;
CI recorded 411 files, 18,665 tests passed and one skipped, plus build and bundle
checks. Four synthetic mobile flows passed separately. Source Fees PR120 is
released at `4586d25b5d88a93431f1c726847a23298eed3f5d`; source migration
`20261101063539_one_bridge_student_reads` is applied, and all 18 added profile
projection fields match Fees across 537 students.

One now displays the complete saved profile, private source photograph, native
financial directory/filter results, installments, receipts, ledger/corrections,
EMI, household and communication history, and existing stored PDFs. Fees remains
the only financial authority; each read section intersects both applications'
permissions. Source has 484 photographs; 53 missing photographs are absent in
Fees itself. Teacher-login work remains deferred; this release does not change
collection gates, send messages or create a competing financial writer.

Initial deployed acceptance recorded 40 checks: 38 passed, including the real
native pages, photos and receipt; two checks rejected the expected anonymous
sign-in redirect. This was an operator-harness contract mismatch, not a failed
authenticated application read. The harness-only correction is
[PR #155](https://github.com/veerpatta/vppsone/pull/155), branch
`codex/student-read-acceptance-denial`, reviewed commit `9a945241`. It accepts
only the exact anonymous One 307 login denial, never follows redirects, and rejects
all authenticated/source redirects. Vercel's exact `text/plain` marker
`Redirecting...\n` is accepted alongside an empty redirect body; other bodies
remain rejected, and direct 401/403/404 denials must still be empty. Its 28
focused tests, syntax, scoped lint and TypeScript checks passed; two independent
reviews are clear. The updated anonymous denial probes passed live. That exact
head passed all 22 checks, including 411 files / 18,688 tests passed and one
skipped, the production build and bundle budgets.

The later intermittent source failures were investigated before final acceptance.
Existing household fingerprint checks attempted no-op inserts, and the original
statement triggers still journaled them. The new student read paths were audited
without finding hidden business writes. Source [PR #121](https://github.com/veerpatta/schoolfees/pull/121),
reviewed head `960f9419`, merged as `9111947f16696f103905b9da558b11caa4789a93`
after green CI. It contains forward migration
`20261101075630_one_bridge_changed_rows_capture`, now applied after rollback
rehearsals and a one-migration dry run. Its 128 triggers across 32 tables are
healthy. Zero-row DML and 100 existing TEST-student lock-helper calls produced
zero events in rollback checks; all 616 access-revision rows were unchanged.
Forced sync revision 274 verified 537 students, 19 classes and 419 households
in 5.545 seconds.

Status: native current-session student reads are deployed and verified.
Post-migration live API/SSR acceptance passed **40/40 checks with 46 GETs and zero
application write requests**, including native profile/financial/family/receipt
pages, five exact source-photo hash comparisons, the 35,340-byte saved PDF and
anonymous media denials. Private redacted evidence is
`live-student-read-post-capture.json`; no student data or credentials are committed.
PR155's final documentation update follows the ordinary green-CI merge process.
This is point-in-time acceptance: the bounded global-MVCC retry
check remains and unrelated concurrent transactions can still cause a retry or
`read_changed` response. No availability SLA or elapsed observation period is
claimed. Teacher-login rollout remains deferred; historical promoted-session
receipts, native audio playback and physical device/printer testing remain
outside this read release. See [implementation and evidence](cutover/COEXISTENCE-2026-11-01.md).

## Fees coexistence implementation — initial notes, 1 November 2026

The following initial-stage snapshot is historical; the release status above
supersedes its in-progress, disabled and unpublished descriptions.

Owner authorized implementation, required migrations and live deployment of
the [coexistence plan](plans/2026-11-01-fees-one-coexistence-plan.md). Work is in
`codex/fees-one-coexistence` from `de277a8`; source Fees work is
`codex/one-coexistence-api` from `a966a82a`. Existing canonical checkouts and
their unrelated local documentation are preserved.

In progress: narrow source payment/read API, durable capture, fenced atomic
One projections, explicit real/TEST routing and recovery. Initial isolated
PostgreSQL and focused contract tests pass; independent review, full CI,
deployment and live verification are still pending. Target migrations
`20261101041404` and `20261101042523` are applied; the bridge is disabled,
unpublished and empty. No financial posting has been performed.

The old cutover report below is historical evidence. Its retirement/link
shutdown and independent One financial processing steps do not apply to
coexistence. Owner classification is now explicit: preserve all existing One
activity as TEST; make the five named accounts real and retain existing logins.
The transactional quarantine/activation adapter is being rehearsed before
publication. See [implementation and evidence](cutover/COEXISTENCE-2026-11-01.md).

## Handoff repair and readiness report — 1 November 2026

Code/report delivered in [PR #151](https://github.com/veerpatta/vppsone/pull/151),
branch `codex/cutover-verification-fixes` from `da37090`, code commit `4ea0240`.
[Consolidated readiness report](cutover/READINESS-2026-27.md):
**HOLD for cutover**. The supplied 31 Oct verification is preserved with its
provenance; the original local 1 Nov report and working changes were left
untouched in the canonical checkout.

Fixed the snapshot loader's eight and tail-sync's two JSON parameters, ported
one-tap receipt method fallback from fees `a966a82`, removed `/teach`'s nested
main landmark and refreshed stale role-home expectations. Rehearsals skip
explicit non-transactional `setval`, and re-check imported row plans before
staff-role derivation. MCP comparison now refuses missing sessions; migration
output can use a private D: root; `--accept-held <list>` parsing is corrected.
Runbook includes the explicit MCP file and ten post-load export comparisons.

Local validation on the final code: **383 files / 18,285 tests passed**;
typegen + TypeScript passed; full lint 0 errors (15 existing warnings);
ported-import check clean (827 files); theme parity 430/430. Next 16.4.3
matches the lockfile after a fresh install. Two independent local agent
reviews resolved the staff-audit reconciliation ordering and command/parser
issues. GitHub CI/build/mobile-fixture and merge state are recorded on PR #151;
merge only when every required check is green. Authenticated role-home E2E,
full PostgreSQL loader execution and provider transactions were not run.

Fresh read-only evidence: 15 public household tables + 2 private views and
19 columns missing from One; 10 populated missing tables contain 7,772 rows.
Source REST reader lacks access to one of them. Full fresh load rehearsal
therefore remains blocked independently of the JSON repair. Existing backup
228 tables / 51,509 rows and restore-test 228/228 were verified; no new backup,
load, conversion, quarantine, account/gate/provider change or send occurred.
The dev-marker database fee gate remains open; deployed app restrictions are
not the same as database lockdown. Parent gates off, all online switches off.

Remaining: reviewed household compatibility/read-path work; complete fresh
rehearsal and financial/export proof; four unavailable receipt arithmetic
examples and consolidated owner decisions; authenticated UI/provider/office
acceptance. Stop at the report; no cutover authorization is inferred.

## Go-live with the real 2026-27 data — started 30 October 2026

Plan: `docs/cutover/GO-LIVE-2026-27-PLAN.md`, decisions D-338 to D-345. The
plan replaces the shared-database cutover (`LIVE-MIGRATION-PLAN.md`), because
the owner ruled out any change to the fee app's code or data. Phases 0–9 are
engineering and run now; Phases 10–12 (rehearsals, cutover, parallel run) need
the new Supabase project (cost: owner's yes), live read access, approved
templates and the Razorpay webhook, and are dated around a proposed T0 of
Sunday 13 Dec. Status per phase is kept in the table below.

| Phase | Status | PR | Notes |
|---|---|---|---|
| 0 Plan and decisions | in review | — | This entry |
| 1 Foundation (A1): marker, guards, fee writes switch, parity | in review | #141 (`feat/golive-foundation`) | Applied to wtgx: 11 fee catch-ups (earlier run, now committed), `deployment_marker` 20261030112133, `migration_ledger` 20261030112221, fee-migrations `nightly_backup_bucket` 20261030111402, `student_photo_storage_rls` 20261030111416, `parity_revoke_public_execute` 20261030111438, `parity_office_sync_realtime` 20261030111442, `fee_writes_guard` 20261030112459, `test_receipt_prefix` 20261030112612. Marker seeded `dev`. Surprises: wtgx let `anon` execute 45 fee functions live had revoked (incl. the money RPCs); live got a new fees migration `20261030170000_online_payment_staff_alerts` today, not on fees main yet. Review fixes: fee-migration `fee_writes_table_guard` 20261030121509 — BEFORE triggers on the 16 money tables (every API caller, incl. service role), TEST/real boundary moves of `students.class_id` / `classes.session_label` refused while closed, and only the owner (postgres, no JWT) can write `fee_writes_enabled` (proved by `verify-fee-writes-guard.sql` cases E–G, rolled back). App guard: updates/deletes placed by URL filters only, `or`/`and`/`not.` filters unscoped, import batches/rows, academic sessions and policies resolved to their session. A Vercel production / `VPPSONE_ENV=live` deployment counts as production even on a `dev` marker (QA sign-in test accounts only; fee writes test-only until the key is 'true'). QA sign-in checks the account before minting. `seed:timetable` is now test-scoped; `seed:scenarios` no longer touches real absences or overwrites templates on production. `deep-smoke`, `smoke-roles`, `measure-round-trips` are `dev-only` until Phase 3. Fee-parity baseline re-recorded (613 objects) with fees-identical fingerprints for the 15 preamble'd functions. Left: auth.users trigger (blocked on Q5, owner), QA users → test accounts (Phase 3); still `dev-only`, deferred to Phase 3: the 13 writing `verify-*` scripts, `smoke-screens`, the e2e harness |
| 2 Importer, reconcile (A2): migration tooling | in review | #142 (`feat/golive-migrate-tooling`) | `scripts/migrate/`: sealed fees reader (surface + wire seals, tested), `extract-live`, `control-totals`, `load-snapshot` (dry run default; guards, staging, named triggers, terminal rules, One-owned settings, TEST rows only on `--first-load`, protected rows, orphan check, matviews, setval), `reconcile`, `storage-copy`, `tail-sync`, `fees-quiet-check`, `rollback-export`; docs `docs/cutover/MIGRATION-TOOLS.md`; D-348. Applied to wtgx: vppsone migration `tail_receipts_review` (20261030132121). Ran read-only: extract `20261030-a2-first` (88 tables, 73,573 rows, stable first attempt) — control totals MATCH the fees MCP on every field for 2026-27 and TEST-2026-27; `load-snapshot` dry run, `reconcile` (62 mismatches vs the stale replica, expected), `storage-copy`, `tail-sync`, `fees-quiet-check`, `rollback-export` dry runs. Not run: any `--apply`. Surprises: **6 fees users' emails already belong to different One auth users**, so the first real load refuses until Q5 maps them (Phase 3); open fees Path A pay codes run to **2027-01-31** (tail end without the T0 switch-off); live has no Postgres password, so the extract is REST with a double-read fingerprint instead of an exported snapshot (D-348). **Review fixes (D-349):** tail-sync parents-first with FK deferral and receipt-linked intents as evidence; events replace only One's `ignored` twin; reconcile event-twin, year-split, unmigrated-data and matview-freshness checks; loader locks before its guards (`fee_writes_open()`), detaches re-pointed rows, asserts written counts, drops staging, refuses live tables/columns One lacks (13 listed), refuses runs without auth identities, `--rollback-only` rehearsal (not yet run: the plan stops on the 6 clashes first); grants migration `20261030145719` applied to wtgx; rollback runbook `ROLLBACK-REENTRY.md`. Still open: purge run `20261030-a2-first`'s sealed auth rows and re-extract; `staff_payment_alerts` needs its fee-schema catch-up (fees migration not in the synced checkout) before the first load. |
| 3 Session pill, TEST visibility (B) | in review | #143 (`feat/golive-session-pill`) | Applied to wtgx: vppsone `test_session_visibility` 20261030155339 (is_test_session / current_is_test_account / is_real_admin / can_see_test_sessions, `set_test_account` RPC, RESTRICTIVE `test_session_fence` on all 53 session-labelled tables + 27 child + 7 grandchild tables), `set_test_account_log_text` 20261030155654, fee-migration `fee_user_from_staff_profile` (D-350: `public.users` derived from `staff_profiles` via `fee_role_map`). Proved under JWT claims in begin…rollback (`scripts/verify-test-session-fence.sql`, all cases pass; `current_staff_role()` admin/accountant/view_only as mapped). App: `test-session-policy.ts` + `test-session-access.ts`; `isTestAccount`/`confined` on the staff (confined deployments fence everyone, banner); switcher cached unfiltered and filtered per viewer; resolver ignores a forbidden URL/cookie and deletes it where it can, test accounts default to TEST-2026-27; `setViewSessionAction` refuses; native `resolveSessionLabel` follows the pill; by-id guards on student/receipt/family/ledger pages, PDFs, exports, desk summary, receipt-by-number, Student 360, admissions, teacher student page; `assertSessionWritable` in all 55 actions handed a session label (architecture test); pill in the vx shell (desktop dropdown + phone sheet, no "Live ·" off production); `/staff/[id]` test-account switch for real admins. §3.6: 39 QA/smoke/day-run profiles flagged (`scripts/mark-qa-test-accounts.mjs`, run `qa20261030-0gyecx`, reversible); test-scoped tools now confined on every marker; the 13 verify scripts, `smoke-screens`, `deep-smoke`, `smoke-roles`, `measure-round-trips` and the e2e harness test-scoped. Load: fresh extract `20261030-p3-fresh`, dry run 6 remapped by email, 4 new, 0 refused (sealed auth rows purged after). Not done: Playwright run (needs a local `next dev`; spec `tests/e2e/test-session.spec.ts` written), screenshot comparison, seeding TEST-2026-27 vppsone data so the confined verify scripts have a scene (run `seed:timetable` / `qa:seed` first — they now write TEST). Surprise: vppsone holds almost no TEST-2026-27 rows (6 notes), so QA accounts see near-empty native screens until seeded. **Review fixes (fixer, D-351):** applied to wtgx: vppsone `test_account_staff_and_student_fences` 20261030172156 (`change_staff_authority` refuses a test actor on a real profile; `student_in_visible_session()`; RESTRICTIVE fence on acc_counter_queue, acc_requests, data_quality_skips, external_student_ids, parent_route_flags, promotion_marks) and fee-migration `fee_20261031000200_test_account_fee_write_fence` 20261030172225 (a test account's JWT writes money rows, students, classes, academic_sessions only in TEST, and only TEST-named app_settings keys; D-347 switch kept); `verify-test-session-fence.sql` A–N all pass on wtgx (rolled back). App: every action naming a student/receipt/family/class checks the record's own session (new `assertStudentsVisible`, `assertClassVisible`, `assertNotTestAccount`, `workingSessionFor`; student create/update/archive/delete/bulk, sibling, fee plan, EMI, waivers, close-due, ledger, refunds, corrections, reversal/decline, desk, counter queue, books, promotion, quality, merge/split, reminders, campaigns, outbox batch, birthday wish, photos, admissions) and a second architecture test holds it (22 native writes left OPEN with reasons — next: fence them by id); receipt/reversal/statement WhatsApp sends refuse a real record for a test account; bulk update uses TEST for a test account; live session, routes, fee heads, payment modes, WhatsApp settings, matrix, bank statements refuse test accounts; staff create/update/activate/login/reset/role refuse a real target for a test actor and new profiles inherit the flag; `setTestAccountAction` refuses while previewing (unit tests); resolver/switcher fail closed (TEST) when the viewer cannot be read; native by-id pages (assessments, marks grid, collection request/round + export, timetable version, teach class/task, duty) 404 out-of-session records (`documents/[id]` does not exist). Tooling: verify-cover-command, verify-staff-outbox, verify-parent-policy and the four fault-injection verify scripts + verify-sampark-import are `confined-dev-only` (refused on production); confined tools use TEST-2026-27 itself, never pickSessionLabel's fall-back; `verify:access` fixed (duplicate key, TEST-scoped totals, orphan login) and run: PASS, but vacuous until TEST is seeded (did not run `seed:timetable`/`qa:seed`). e2e spec: a test teacher keeps the pill (TEST only, D-351 (5)); added test-admin, edit/print and receipt-by-number cases. Still not done: Playwright run and pill screenshots (need a build or an unprotected preview), `/pay/[code]` deferred to Phase 7 (plan §3.4), Q6 back with the owner (plan §6). |
| 4 Quarantine and promote (H) | in review | #150 (`feat/golive-conversion`) | D-360, `docs/cutover/QUARANTINE-REPORT.md`. Built, dry-run and rehearsed (`--rollback-only`) on wtgx, nothing applied but one fix: `convert-to-production` (7 steps, `--revert <step>`; rehearsal applied + reverted all), `classify-dev-vppsone` (read-only: A 365 / B 29,203 / R 932 / C 884 / K 96 rows, 0 unclassified; the 20th 2026-27 class is a QA artefact; owner's own activity listed), `quarantine-in-place` (513 TEST-D- shells, 1 TEST twin class, 19 teacher twins, 36,939 row changes; rehearsal with promote: 230/232 checks pass — the 2 left need step 2 — re-run 0, all 69 written tables covered by backup-one), `promote-master-data` (+ `seed-timetable --production-promote`), `verify-quarantine.sql`, `rebuild-enrolments` (C8: 541 = 513 + 28; 1 of 20 classes without a class teacher; rehearsal passed), `reset-test-session --session TEST-2026-27`, `load-snapshot` writes the data_replica REAL row. **Applied (owner-approved TEST hygiene):** `repoint-test-class-rows.mjs` moved the two TEST `class_teachers` rows of 22 Sep onto their TEST classes (Class 1's closed, its TEST class already had one); `ct_mismatch` 0; revert tested. No migration. Surprises: the runbook's step-3 rollback must restore BOTH schemas and step 4's needs a backup taken after step 3 (runbook fixed); 2 of the 19 "real teacher" profiles are day-run QA teachers with timetable short names — owner checks the sign-off list; 78 of 79 TEST students carry numbers off the allowlist (B15 policy is the owner's). **Review fixes (D-361):** no-FK references listed and re-pointed (`cover_duties.class_ids`, `merge_host_class_id`, `fee_reminder_batches.student_ids`, `actor_staff_id`, `*_by`, `on_behalf_of`) and checked by `verify-quarantine.sql` (248 checks), an unlisted reference column stops the run; phone-field answers nulled in `student_records` and its history; the 2 day-run teacher profiles are HELD until the owner passes `--accept-held` (17 twins without it); `reset-test-session` skips `TEST-D-` shells in its guard, unguards append-only deletes per statement, has `--rollback-only` and `--null-test-phones` (B15); C8 moved before step 8 (it refuses after fee writes open); `load-snapshot --first-load` refuses unquarantined B rows; confined `seed:timetable` falls back to `T-` twins. Re-rehearsed on wtgx `--rollback-only --with-promote --with-reset`: 35,675 rows, 246/248 checks (2 need step 2), re-run 0, the reset deleted 25,930 TEST rows on the quarantined state — PASSED, rolled back. Nothing new applied. Left: the owner's call on the 2 held profiles and on TEST phones (null or allowlist). |
| 5a Small fee changes P1–P5, P13 (C) | in review | #144 (`feat/golive-fee-port-small`) | Ported with their tests (`tests/fees/`): P1 SBC + case-blind category labels; P2/P3 SQL verified already on wtgx (anon EXECUTE false on both reads; `idx_audit_logs_record_id`, `get_student_segment_counts` present), P3 `queries.ts` merged; P4 student export with photos (behind the session gate); P5 `online` reads Online/UPI (Razorpay), never Cash, in the ported screens AND One's vx desk/receipts/reports/accounts/palette/Student 360 (`deskModeOf('online')` was "other", so the vx Receipts desk left online money out of the day total — now filed under UPI), auto-day-close, catalogues, plus the TEST-session resend rule in `run-sender.ts` (with the failed-row reclaim from fees `1b932785`, which One's base lacked). P13: next 16.4.3 (fees is on 16.3.8, which still has three critical advisories), vitest 4.1.12, zod 4.6.7, overrides for undici/vite/source-map-js/postcss-selector-parser — `npm audit --omit=dev` 0, and CI now gates it at high (fees' scan gate 95dcd45d); a moderate `minimatch` advisory published since sits only under eslint and is accepted (D-352); fees' vendored braces patch not ported (no advisory on One's braces). Receipt verify ported to public `/rv/[code]` (A2), every `verifyUrl` via `receiptVerifyPath()`. `scripts/migrate/export-parity.mjs` (sheet names, headers, row counts only); export code is identical to fees HEAD (`ai-context-bundle`, `responses`, `info-fields`, photo workbook) bar One's session gate. Carried from B: the 22 OPEN native writes fenced by id (`passesFence` + `assert*Visible`), allow-list empty. Seeded TEST-2026-27: `seed:timetable` now derives TEST class labels (19) and enrolments (76) when confined, published 1,038 slots / 172 assignments; `qa:seed` run `r2610310020`; `verify:access` PASS with real TEST counts. **Surprise, fixed live:** `authenticated` could not SELECT `staff_profiles.is_test_account` (column grants since 20261004041954), so every signed-in page on wtgx sent its user to `/login?reason=no-profile` since Phase B — vppsone migration `staff_profiles_is_test_account_readable` 20261030185555 applied, test pins the grants. The e2e spec then found: the pill printed a refused `?session=2026-27` over TEST data (now shown only when the viewer's own list has it, desktop and phone pills); the confined banner was hidden from profile test accounts (now the deployment's, for everyone); `/fees/students/[id]` streams (loading.tsx), so its not-found is a 200 with the not-found screen — the spec checks the screen. `next dev` here needs `--webpack` (Turbopack refuses the node_modules junction). Open: two TEST-labelled `class_teachers` rows from 22 Sep point at 2026-27 classes (QA teachers 1/2 "hold" a real class; not changed — rows are not mine to relabel); receipt PDF/print comparison (B6) and live-vs-One export diff need the real snapshot (on the Phase 10 row). **Review fixes (fixer):** the same-day reminder retry no longer resends a real-session send whose fate is unknown (network error or 5xx → `delivery-unknown:` prefix, stays claimed; TEST retries anything); every collection action now checks the record it names (request, round, message, SamPark batch, photo proposal) or refuses test accounts for school-wide writes (fields, templates, parent policy, route flags) — the record-id architecture test could not see bare `id`s, so a new architecture test holds every collection action to the fence, and `tests/collection-write-fence.test.ts` proves a test account is refused on a real request/message; `verify:fee-parity` 7/7 after refreshing the baseline — the only drift was the four Phase B test-account fence triggers (fee-migration 20261031000200: `test_account_student_guard`, `test_account_session_row_guard` ×2, `test_account_settings_guard`), intentional and recorded in SCHEMA-PARITY; the catch-up migrations were already in the #141 baseline; the phone pill sets a long label a size smaller so TEST-2026-27 stays on one line (`docs/evidence/phase-c-pill-375.png` retaken); the e2e not-found check also asserts the real record's admission number is absent — spec re-run 6/6 on `next dev --webpack`, the real-student journey only with `--timeout=300000` (four cold dev compiles exceed 60 s on this machine); D-352 records the five deliberate differences from fees. |
| 5 Fee changes P6–P11 (D) | in review | #145 (`feat/golive-aisensy`) | Ported from fees 8a0cd47c with their tests (37 fee WhatsApp test files under `tests/fees/`, 1,100+ cases): P6 reminder profiles, the ladder, school notices, families/ladder/notices screens, `_v6` bodies + Pay now, message cost; P7 "Why N?", chips; P8 fast reminders (`tap`/`reveal` CSS); P9 installments + last year in one message; P10 send-system sweep, RTE rule, desk waive-by-default merged into `payments/ui/mobile-payment-flow-sheet.tsx` and `payment-desk-mobile.tsx` (the vx desk keeps "take", it asks for a waiver reason — D-353 (7)); P11 linked siblings; receipt/reversal/statement/school-notice senders at fees HEAD. One's own edits kept: delivery-unknown retry rule, test-session fences, `/rv` verify link; new screens fenced by id. `onlineLedgerRecheck` is a Phase 7 stub (`payments/data/online/service.ts`, answers "off"); `pay-scope.ts`, `upi-open.ts`, `missing-column.ts` ported. Not ported: the pay page changes (Phase E), the one-tap interaction test (needs @testing-library/react), fees' `payment-desk-workflow`/`mobile-office-workflows` suites (never ported to One). Test names: sample names stay as the src template samples; a fixture destination phone replaced (rule 6). |
| 6 AiSensy parity and send gate (D) | in review | #145 (`feat/golive-aisensy`) | D-353. One gate (`platform/messaging/parent-send-gate.ts`) in `sendAisensyCampaignMessage`, used by all 7 fee send paths and One's native parent provider (absences as `native`); only aisensy.ts and the two staff transports name AiSensy's endpoint (test). `_v7` (22, `APPROVED_V7` empty → text-only fallback; `_v6` refused; param count pinned per situation); `docs/cutover/AISENSY-TEMPLATES.md` for the owner. Cross-campaign dedupe in the run sender; retry/reconcile skip pre-watermark rows; `payCodeRefused` helper for Phase E; `source` `vppsone/…`; D-270 superseded (auto receipt notice follows its switch, behind the gate). Applied to wtgx: vppsone `parent_send_gate` 20261031040453 (runtime_flags.value, `parent_dispatch_categories` `[]`, `absent_notice_owner` "fees_notice", `message_test_recipients` empty, service-role only; grants checked). **Fee catch-up to live:** fees origin/main had two migrations live already ran — `20261030170000_online_payment_staff_alerts` (staff phone seed blanked, rule 6) → 20261031042015, `20261030190000_whatsapp_failure_desk` → 20261031042059, plus One-only `failure_desk_service_grants` → 20261031042122 (wtgx has no default privileges). Fresh extract `20261031-pd-catchup` (90 tables, 78,583 rows) + load-snapshot dry run: **no live table or column refused**; sealed auth rows purged. `verify:fee-parity` 7/7, baseline re-recorded (642). Not done: `catalog-diff` (needs the live fingerprint through the MCP — Phase D read live only through the sealed client); the failure desk's Fix tab and the staff payment alerts' sender (app code on fees origin/main; the alerts sender is Phase 8, plan §8.4); seeding `message_test_recipients` (operator, no numbers in the repo). **Review fixes (fixer):** One's own parent messages carry `message_sends.session_label` to the gate (`nativeParentGate`; no readable session = allowlist), so a TEST-session message sent by a real admin or a cron is held to the allowlist; the receipt notice asks the gate (`parentSendRefusal`) before render and claim, and releases its claim if the gate flips mid-send, so a refusal never leaves the permanent `(receipt_id, notice_kind)` row; the cross-campaign check reads `notice_kind = 'reminder'` only (a receipt no longer silences a family), counts delivery-unknown failures as sent, and pages each chunk newest first; reconcile passes the row's session to the cutover line (TEST rows no longer refused); Families bulk save checks the students' sessions and `writeReminderProfiles` chunks its `.in()`; the two ladder set-up actions clamp `auto` and the scheduled-runs route sends nothing while `SCHEDULED_SENDS_LIVE` is false (dry run still reports); import rules: `staff_payment_alerts` imported terminal (push → `no_devices`, WhatsApp → `off`, lease cleared; claim filter pinned), `staff_push_subscriptions` never touched. Behaviour tests for retry/reconcile watermark, the dedupe cases and >1,000 rows. **Blocks the first real load: `catalog-diff` against live and live's migration ledger above 20261030120000** (steps in SCHEMA-PARITY; not run — the brief reads live only through the sealed client, which has no SQL path). Owner: Q20 (vx desk late-fee default, D-353 (7)). Deferred to Phase 8: critique1 C1 (staff quiet hours as the send window reusing `DEFAULT_QUIET_HOURS`) — it is the staff transport's rule and nothing in Phase D sends to staff. |
| 7 Razorpay (E) | in review | #146 (`feat/golive-razorpay`) | D-354, `docs/cutover/RAZORPAY.md`. Ported from fees origin/main **78e27e4f** (newer than 8a0cd47c; so fees #86 31e85d27 comes whole) with their tests: `payments/domain/online/*`, `data/online/{razorpay-client,service,orders,after-posting}` (the real `onlineLedgerRecheck` replaces Phase D's stub), `office-sync-events` (`publishOfficeSyncEventWith`), webhook `/api/webhooks/razorpay` (+ `/api/fees/webhooks/razorpay`; `src/app/api/webhooks` added to PORTED_TREES), cron `/api/fees/cron/online-payments`, the whole `/pay/[code]` + `status`, staff screen `/fees/payments/online` (vx nav *Online payments*, `fees:accounts`; actions fenced by the capture's students), the four pay-page cases, `pay-checkout-panel` (12 cases, on a local @testing-library stand-in), the three dry runs (adapted: One's applied functions on wtgx, one thrown-away transaction — 48/56/34 pass). One-only: `vp1_` in TS (`REFERENCE_PREFIX`; `vpps_` refused in processOrderPayment, reconcileOpenOrders, link pass, applyCapture, applyOrderCapture) and SQL; live-key guard (Vercel production AND `VPPSONE_ENV=live`); middleware opens `/pay`, `/api/webhooks`, `/api/fees/webhooks`, `/api/fees/cron` (`tests/public-routes.test.ts` enumerates every secret/signature/token route and sends each a cold request: 200, not 307 — the AiSensy webhook and the three existing fee crons were 307 until now); `payCodeRefused` on every `/pay` door; fee write guard places the online RPCs (TEST pays online in mirror mode; real refused); 7 switches only; receipt sender treats a gate refusal as suppressed. **Applied to wtgx** (fee-migrations): `online_vp1_ownership` 20261031064009, `receipt_suffix_floor` 20261031064037 (floor in all three numbering functions, VPP02 on a bad value; online receipts take the session prefix), `online_switches_default_off` 20261031064046 (all 7 + staff-alert `false`; replica had waive_late_fees and staff_whatsapp `true`). Proved before and after in `scripts/migrate/verify-online-vp1-and-floor.sql` (rolled back: vp1_ 36 chars, every vpps_ refused, TST…-5001 online, 5002/5003 desk, VPP02); grants unchanged and checked; `cron.job` clean; `verify:fee-parity` 7/7 after re-recording (exactly the 9 functions changed; SCHEMA-PARITY row). Not done: the staff-alert sender and its screen section (Phase 8; `staff-alerts.ts` is a no-op stub); scheduling One's reconciler pg_cron and the Vault secret (operator, C4 — SQL in RAZORPAY.md §5); no Razorpay call was made (no keys on any One deployment). Surprise: the shared node_modules has no @testing-library, so the interaction test runs on `tests/support/dom-testing-lite.tsx`. **Review fixes (fixer):** the staff screen is fenced by session (`data/online/screen-reads.ts` + `domain/online/session-fence.ts`): a test account (everybody on Preview/local) sees TEST payments only, real staff no TEST ones, an unplaceable capture is a real admin's only, the reconciliation is recomputed from visible captures for anyone but a real admin, and the audit list shows them switch changes only (`tests/online-payments-screen-fence.test.ts`; query shapes probed read-only on wtgx); the switch and review-close actions report a refused write (`switch_refused`/`not_resolved`) and audit nothing; the receipt outbox branches on the gate's refusal code — `read_failed`/`actor_unknown` retried, rules suppressed; **critique0 #4 built:** the run sender gives no Pay now (text-only notice) to a family whose children, `pay_scope` children or phone hold a fees code still payable (Path A until `pay_code_expires_on`, none = for good; Path B 21 days), nobody gets Pay now when the line is unreadable, TEST never held (`modules/whatsapp/data/fees-pay-codes.ts`, `tests/fees-pay-code-skip.test.ts`); `tests/public-routes.test.ts` now also holds every route, page and server-action file under a public prefix to a credential check (re-exports followed; `/rv` open by design); staff_payment_alerts import states and "public tables only" pinned; receipt-band preflight `scripts/migrate/online-preflight.mjs` (read-only; NO-GO on wtgx today, as expected) named in RAZORPAY.md §4; RAZORPAY.md §3a parents notice / HDFC QR / limits, §7 tail-end formula + SQL (run read-only on wtgx) and the (a) static-QR note; staff alerts given an owner in plan §8.4 (Phase 8 everywhere, no "Phase F"). Full `vitest run` 17,668 passed / 355 files; typecheck clean bar the known `@anthropic-ai/sdk` errors; lint 0 errors; `check:port` clean. Open: @testing-library in devDependencies (row 7a). |
| 7a Follow-up: real @testing-library for `pay-checkout-panel` | not started | | Add `@testing-library/react`, `@testing-library/user-event`, `@testing-library/jest-dom` to devDependencies with the lockfile (needs an `npm install`, not run here: shared node_modules, disk), point `tests/fees/ui/interaction/pay-checkout-panel.test.tsx` back at the real imports and delete `tests/support/dom-testing-lite.tsx`. |
| I Owner decisions of 31 Oct | in review | #147 (`feat/golive-owner-decisions`) | D-350 approved (row edited), D-355 new. Applied to wtgx: vppsone `parent_dispatch_test_only` 20261031084012 (seeded OFF; runtime_flags grants unchanged — service_role S/U, authenticated S, anon none), fee-migration `fee_20261031090000_school_notice_sends_service_grants` 20261031084233 (service_role S/I/U). Q5: no auth.users trigger (public sign-up is ON for wtgx, so one would hand out access); proof `scripts/verify-staff-login-fee-role.sql` A–I pass, rolled back; the ported `/fees/staff` (a second writer of `public.users`) now redirects to `/staff`. Q6: `scripts/migrate/access-email-check.mjs` run read-only — 4 fees users without a One account (all `not loaded` before the first load), 6 remapped, 0 ambiguous; loader proven not to write a remapped auth row or any password hash. Q20: vx desk waives by default ('Payment Desk late fee waiver'), amount shown before saving; jsdom + the fee-followup, payment-ui (chromium) and operations-fee-collector Playwright suites run locally green. Pay-now tail: `docs/cutover/OLD-PAY-NOW.md`; One has all 8 switches, same meaning, nothing to port. Test-only parent send mode built, not switched on, nothing sent. Surprise: public sign-up is enabled on wtgx and 12 `public` tables let any signed-in user read (parent phones among them) — plan Q21, owner to turn sign-ups off before the first real load. **Review fixes (fixer):** **OPEN BLOCKER for the first real load — public sign-ups are ON on wtgx (owner, Dashboard → Authentication); `load-snapshot.mjs --apply` now refuses while they are on or unreadable** (`lib/auth-settings.mjs`; read 31 Oct: `disable_signup` false), and the plan §0.1 order, Phase 11 go/no-go and Q21 say so. `access-email-check` prints `ok` only when every row is `yes` (`not loaded` → NOT VERIFIED, exit 2; `--before-load` informational); runbook C5a sends the 4 access emails only after `ok`; C7 names the one fees switch (`online_payment_links_enabled`). `/collection` parent messages now honour test-only mode through the gate (`parentDispatchMode`; never via the mock). Proof SQL E/F/I now go through `change_staff_authority`: re-run on wtgx 31 Oct as one self-aborting DO block, A–I pass, no proof row left. Fee nav and settings point at `/staff`; a test pins that nothing in src calls the dead `staff-fees` writers. vx desk: the default waiver skips a late fee every pending row still avoids on the payment date (`deskWaivesLate`); the mixed due-plus-avoidable case still waives all pending late fee (server behaviour for it not checked). CI on feec1df: 23/23 green, including `synthetic-browser` (payment-ui Playwright in Chromium **and WebKit**). Not merged (orchestrator merges). |
| 8 Staff WhatsApp (F) | in review | #148 (`feat/golive-staff-whatsapp`) | D-356, `docs/cutover/STAFF-WHATSAPP.md`. **Applied to wtgx:** vppsone `staff_whatsapp_consent_and_gates` 20261031101234 (consent columns, `staff_notice_prefs`, switches `staff_notice_kinds_enabled` — existing kinds on, every new kind off — `staff_whatsapp_month_cap` 1000, `staff_notice_student_names` off; payload kinds; claim reads the gate facts; `release_staff_notice`, `digest_staff_notices`, `queue_staff_notice(_to_permission)`; triggers on `fee_desk_requests` and `teacher_leave`; every staff template in `message_templates`, `vppsone_attendance_reminder` switched off). Grants checked after applying (`has_table/column/function_privilege`): authenticated reads its own prefs only and no consent column or function, service_role all, anon none — pinned in `tests/staff-whatsapp-migration.test.ts`. `scripts/verify-staff-whatsapp.sql` A–J pass on wtgx, rolled back (no row left). App: the gate in `staff-notices/domain/gates.ts` (consent, kind switch, own switch, allowlist for TEST/test account/confined, 07:00–20:00 window = `DEFAULT_QUIET_HOURS` end (C1), 8/day, month cap, digest, 1 req/s), every branch tested; dispatcher hands back refusals before rendering; new kinds rendered from one template table (`templates.ts`) the doc and migration are tested against; no phone number in any staff message; child named only with the switch. Moved to the outbox (B13): marks reminder (job + button), weekly summary, staff notice from Messages, timetable "tell teachers". New jobs `fee-day-summary` 19:00 IST and `fee-day-not-closed` 20:00 IST (vercel.json; confined deployments read no real fee data). `/preferences` consent + per-kind toggles; `/staff/[id]` admin records consent (form / in person / no); Messages → Staff tab (log, month count, cost, cap). Teacher-task API send asks consent/switch/allowlist (`no_consent`). Carried from D: staff payment alerts sender (`staff-alerts.ts`: WhatsApp → `online_payment` outbox notices to `fees:collect`, push closed `no_devices`; also queues `online_review` for `review_required` captures), the failure desk Fix tab (fees 3cc2de4b + 2c0ada0a, 3-way merged; fences on every action, cutover line on resend, delivery-unknown rule kept in the run sender). `AISENSY-TEMPLATES.md` records the 31 Oct `_v7` submission (`APPROVED_V7` still empty). Not done / owner: staff templates not submitted (bodies in STAFF-WHATSAPP.md §6), the five-minute pg_cron timer (SQL in §5, needs a Vault token), Web Push (no subscription screen in One), no consent recorded for anyone, no kind turned on, nothing sent. Surprise: the cover and register templates had never been registered in `message_templates`, and two cover bodies skipped a slot (Meta needs every slot used) — fixed in the renderers. **Review fixes (fixer, D-357):** applied to wtgx vppsone `staff_whatsapp_review_fixes` 20261031111241 (file = ledger statement, md5 checked): a confined deployment's claim takes TEST-session notices only (`p_test_only`); no child's name stored (payload `student_id` + class; the claim adds the name only with the switch on); authenticated loses `staff_notices.payload` and `staff_notice_attempts.params` (column grants; checked with has_column_privilege, pinned in `tests/staff-whatsapp-review-fixes-migration.test.ts`); a digest folds only after accepted/unknown; one AiSensy second across all dispatchers (`reserve_staff_send_slot`); one month count incl. teacher-task AiSensy claims (`staff_whatsapp_month_sent()`, used by the claim, the Staff tab and the teacher-task gate, which now applies the cap). `verify-staff-whatsapp.sql` H, K–N pass on wtgx (rolled back). App: staff-alert drain confined (no alert claim; TEST reviews only); fee-day jobs add a TEST pass (production) / TEST only (confined); `online_payment_staff_whatsapp_enabled` is the 8th online switch on the screen; failure desk refuses >200 ids and writes exactly the fenced list, siblings filtered then capped, a test account's retry leaves number health alone; weekly summary keyed per session+Monday+admin, "last sent" reads the outbox; STAFF-WHATSAPP.md §6 adds the six teacher-task templates (URL button `…/t/tasks/{{1}}`, tested against migration 20261016090000). **Required at cutover (C4):** store three job tokens in Vault and run `scripts/ops/schedule-staff-notices-cron.sql` (5-minute dispatch + fee-day jobs on the IST minute; refuses unless the marker says production — run on wtgx, refused as expected). Vercel team plan could not be read (assume Hobby). Still owner-gated: templates, consent, kinds, transport. Full `vitest run` 18,092 passed / 373 files; lint clean on the touched files; typecheck clean bar the known `assist/data/run.ts` (`@anthropic-ai/sdk`) errors; `check:port` clean.
| 9 Monitoring, env, runbooks (G) | in review | #149 (`feat/golive-ops`) | D-358. **Applied to wtgx:** vppsone `ops_health_and_alerts` 20261031115621 (`ops_health_counts(p_hours)` counts only, EXECUTE for service_role only — anon/authenticated false, checked; staff kind `ops_alert` + template `vx_staff_ops_alert_v1`, seeded OFF). Job `health` (`/api/jobs/health`, vercel.json 02:30 UTC; alerts real admins through the Phase F outbox), `npm run migrate:health` (+ `--probe`: the Razorpay webhook must answer a bad signature with 401), server-side Sentry without the SDK (`src/instrumentation.ts`, only when a DSN is set; browser errors not covered), `docs/cutover/one-live-cron-jobs.sql` (runbook; run on wtgx and refused, as it should — marker `dev`), `env-names-diff.mjs` → `ENV-INVENTORY.md` (67 names, none unsettled; Vercel names via `vercel env ls`, values hidden), runbooks CUTOVER / ROLLBACK / PARALLEL-RUN / TRAINING / ADMIN-OPS / PARENT-NOTICE / MCP-AND-NOTION. **Backup run for real:** `backup-20261031T121335Z`, 228 tables / 51,482 rows, restore test into a throw-away schema 228/228 equal, rolled back (`BACKUP-EVIDENCE.md`); the Drive nightly backup ran 31 Oct 03:30 IST (ok). Surprises: wtgx pg_cron `refresh-sibling-groups-matview` fails every 2 minutes (function missing) — removed at C4, not here; One Production has no `RAZORPAY_WEBHOOK_SECRET` (probe 404) and no `APP_MODE` (needed with `VPPSONE_ENV=live`); there is **no tail-review screen** for `vppsone.tail_receipts_review` (SQL procedure in PARALLEL-RUN.md); no school-notice template fits the parent notice about the new pay address (options in PARENT-NOTICE.md). Runbook steps 2–3 need phase H's scripts. **Review fixes (D-359):** applied to wtgx vppsone `ops_health_more_counts` 20261031125856 (pg_net non-2xx `net_http_failed`, events pending > 30 min, receipt notices + One's parent sends + AiSensy total against an owner-set `aisensy_month_plan_cap` flag (added OFF, key added to `runtime_flags_key_known`), `cutover_rows`; grants re-checked: service_role only). `backup-one.mjs --restore` (dry run / `--rollback-only` / `--apply`) is the scripted rollback of steps 3–4 — **rehearsed on wtgx with `--rollback-only`: 226 tables / 51,481 rows equal, 37 s, nothing persisted**; `reconcile-post.mjs` (`--baseline` at C3, daily check 5); the `health` job probes its own Razorpay webhook (404 = "not configured yet" until the cutover line); `health --probe` asks the test-only doors cold; `env-names --vercel` diffs live Production names; Sentry reads One-owned `SENTRY_DSN` only (owner sets it at C5; `NEXT_PUBLIC_SENTRY_DSN`'s project unrecorded); C4/rollback timer checks by name; C8 checks as SQL (rebuild is phase H); first-week alerting is the Operator at 08:00/16:00 until T+7; weekly AiSensy wallet + Supabase advisors checks. Follow-ups: browser-side Sentry needs the SDK's client half (row below); the restore holds ACCESS EXCLUSIVE locks ~40 s — run it outside desk hours. |
| 9a Follow-up: browser-side Sentry | not started | | Port the fee app's lazy-loaded client SDK (`instrumentation-client.ts`) with the same masking as `sentry-lite.ts`, to One's own `SENTRY_DSN` project. Server errors are covered by G; browser errors are not. |
| 9b Job heartbeats + One's Sentry DSN | done | #165 `5cd16f5c` | D-363. `src/platform/observability/heartbeat.ts`, called from `/api/jobs/[job]` after a scheduled `ok`/`skipped` run. Set on One Production 3 Nov: `SENTRY_DSN` (`vppsone-staging`), `HEARTBEAT_URL_DRIVE_BACKUP` and `HEARTBEAT_URL_DOCUMENT_BACKUP` (Healthchecks.io, 1 day + 1 h grace, alerts to the owner's email). Other jobs have no URL and do not ping. |
| 10 Rehearsals | not started | | Open from 5a (plan §5.4 / B5 / B6), both on one real snapshot: every export compared fees vs One with `npm run migrate:export-parity` (`ai-context-bundle` first; files in `%USERPROFILE%\.vppsone-migration\`, never the repo) — 0 differences; 10 receipts (cash, UPI, online, cheque, discount, family, carry-forward) printed from both apps on A4 and the office printer. Checklist in `docs/cutover/MIGRATION-TOOLS.md`. |

## The fee app at fees.vpps.co.in — 30 October 2026

The owner asked for School Fees on `fees.vpps.co.in` the same way (D-337,
`docs/DOMAIN.md`). The domain, Cloudflare CNAME and certificate were already in
place from earlier that morning. Done now: the fee app's production
`NEXT_PUBLIC_SITE_URL` and the live Supabase Site URL moved to
`https://fees.vpps.co.in`, with `https://fees.vpps.co.in/**` added to its
redirect URLs, and the fee app redeployed. Here: `VERIFIED_ORIGINS.schoolfees`
and PARITY.md, so VPPS One's links to the fee app open on the new address.
Kept on `schoolfees-two.vercel.app` on purpose: the Meta-approved Pay now
buttons, the Razorpay webhook and the MCP worker's site URL, so that host must
never redirect.

## VPPS One at one.vpps.co.in — 30 October 2026

The owner asked for the app on the school's own subdomain (D-336, runbook
`docs/DOMAIN.md`). Done outside the repo: `one.vpps.co.in` added to Vercel
project `vppsone`; Cloudflare `CNAME one → ade918e9b8269018.vercel-dns-017.com`,
DNS only; certificate issued (Let's Encrypt, to 28 Jan 2027, auto-renewed);
production-only `NEXT_PUBLIC_SITE_URL=https://one.vpps.co.in`, with Preview and
Development keeping the old value; `https://one.vpps.co.in/**` in schoolfees-dev's
Supabase redirect URLs. In the repo: `VERIFIED_ORIGINS.vppsone` and PARITY.md.
`vppsone.vercel.app` keeps answering. Surprise: the certificate was not issued
on its own after the CNAME verified; `vercel certs issue` did it in seconds.
Remaining: staff sign in once on the new address and reinstall the phone app;
deciding later whether to redirect `vppsone.vercel.app`.

Released: [PR 137](https://github.com/veerpatta/vppsone/pull/137) merged as
`d2a30c9` (head `6f65bc8`, all 22 checks green before merging); production
`dpl_A7HgWi1qg2X9y2QZJLboEhd1ZnHZ` READY, aliased to `one.vpps.co.in` and
`vppsone.vercel.app`. Checked live: both `/login` 200 "VPPS One" from `bom1`,
`http://` 308 to https, HSTS, manifest and service worker 200, a job route 404
without its secret, `npm run verify:origins` 3/3. Not checked: a receipt
rendered signed in (needs a staff session).

## Fee admin screens simplified — 28 October 2026

PR 134 (`52357ed`) and its fix PR 135 (`f19a7c0`), at the owner's request.
- **School Setup Lists:** a row of jump links with counts. Sessions, classes,
  routes and fee heads are one row each that opens to edit, and adding sits
  behind a button. No scroll boxes inside the page.
- **Deletes now ask:** class, route and fee head deletes ask before deleting.
  They used to happen on one tap.
- **Staff accounts:** "Create staff account" sits behind a button, and each
  account row says "Manage".
- **WhatsApp reminders (phone):** family cards show the number and the tick
  box, with the other details and controls under "More". The reconciliation
  paragraph folds under "How this number is worked out".
- **Class teachers:** the hand-over form now has a Cancel.

Surprise: #134's truncated rows pushed the Classes and Routes cards past a
375px screen (grid items need `min-w-0`). Caught live and fixed in #135.

## Every screen checked; settings lists simplified — 28 October 2026

PR 132 (`2aa53b7`), from the owner's request to check every screen and
simplify confusing UI. All 115 fixed routes loaded signed in as an admin,
with no error, crash or wrong redirect. 24 daily and busy screens were
looked at on a phone, and several on desktop. Three settings screens showed
every item's form open at once and now open one item at a time (shared
`EditRow`/`AddRow`, native details):
- What can be asked for: Add comes first, retired questions folded away.
- Cover policy: one row per teacher.
- Class teachers: "Change teacher" instead of a hand-over form on every class.

Not changed: the ported fee admin grids (`/fees/master-data`, `/fees/staff`,
`/fees/reminders`) and the defaulters call queue, which are dense but
organised. (The missing hand-over Cancel was added in #134.)

## Student documents section made simpler — 28 October 2026

PR 130 (`6d72b44`), from the owner's report that adding documents was
confusing. The Add button now comes first. Adding is three steps (tap the
type, tap to choose the file, Save), and Save stays off until both are
chosen. Rows show the type, note, file name, date and who added it. Remove
now asks first. Upload logic is unchanged. Checked live at phone size:
opening the form, choosing a type, and Remove → Keep it. A real upload
through the new form has not been made yet.

## One central store and nightly Drive backups — 28 October 2026

Branch `feat/drive-central-backup`, after PR 126 (`2f211bc`). D-334. No
silent bucket fallback (unreadable settings stop uploads visibly; the old
Server Action upload removed); a database guard and history on the storage
destination; the nightly `drive-backup` job (sealed file copies, the
approved copy-only move of bucket documents, a sealed snapshot of every
vppsone and fee table with a manifest) into the "Share" folder the owner
chose; `npm run recovery -- snapshot` to open and check one. Independent review's
findings fixed in `2b6a04b`. Migration `20261028035840` dry-run on PGlite
(`docs/evidence/drive-storage-2026-10-27/`; the dry run caught an operator
precedence bug that would have refused every settings update) and applied to
dev with the owner's approval before merge; on real data the two one-call
schema exports read 49,611 rows (~26 MB of JSON) in 3.5 s for both, twice.
PR 127 merged (`9537e7c`) and deployed. Live, 28 Oct: 8 synthetic admin
uploads and opens through Drive (timings in `docs/DRIVE-STORAGE.md`); the
first `drive-backup` run `ok` in 99 s (snapshot 204 tables / 49,644 rows, 13
file copies, 11 bucket documents moved copy-only, 0 parked); the snapshot and
a file copy restored with the private key (204/204 tables). PR 128
(`88517e2`) recorded it. Rolled out to every role at 09:10 UTC by the owner's
decision without the office-account pilot (D-335): 3 admin and 2 office
accounts now upload to Drive; the first real office upload is still to be
checked. Surprise: PR 126 was merged while its `check` job was still running
(it then passed).

## Student documents in Google Drive — 27 October 2026

Branch `feat/drive-document-storage`, after PR 121 (`6de3b3c`). D-333,
`docs/DRIVE-STORAGE.md`. Code for Drive-backed student documents behind
`file_storage_settings` (default: the Supabase bucket, as before): keyless
Google auth from the Vercel OIDC token, chunked uploads with type sniffing,
sha256 and resume, streamed private reads, a nightly sealed copy to another
provider, the recovery-key tool. Fixed in passing: opening a document by id
now obeys class scope. Tested against a fake Drive (8 files, 68 tests) and
reviewed independently (findings fixed in `9b92a4c`). Owner approved the
migration, the Google project, a dedicated Shared Drive and the backup plan:
migration `20261027114837` applied to dev before merge; Google project
`vpps-one-files` with keyless federation created, no org policy changed.
PR 122 (`f6adbfe`) and PR 123 (`fea7705`, folder-only access, timing logs)
merged and deployed. Drive: folder `VPPS One documents` in the existing
"Share" drive, service account writer on that folder only. Recovery key made
on the office PC (fingerprint `9c7fea21…`), public half in the settings row.
Pilot on for the owner's account only: one real 369 KB PDF stored and opened
through Drive (timings in `docs/DRIVE-STORAGE.md`). 28 Oct: the scheduled
Document backup passed its Drive health check and sealed that document; the
sealed copy opened with the private key to the same sha256 (restore check).
Not yet: the synthetic size/concurrency measurements and any decision to go
wider. The 1 MB bucket-upload limit found here was fixed separately in #125.

## AI helper on phones — 27 October 2026

Branch `feat/ai-assist-mobile`, after PR 118 (`5ab9f87`) and the owner's key
went live (first real draft logged 09:45 UTC, $0.007, kept). D-330: 48px
full-width AI buttons that wrap, stacked suggestion buttons, keyboard closed
and the card scrolled into view on touch, Copy with a fallback and the phone's
Share sheet on read-only suggestions, an offline state, camera or gallery on
the admission form. Checked at 375 and 1280 px in the phone harness
(`tests/mobile-ui/assist.html`); 2 new tests. Not yet checked on a real phone.

## AI helper, second round — 27 October 2026

Branch `feat/ai-assist-more`, [PR 118](https://github.com/veerpatta/vppsone/pull/118),
feature commit `500119e`, after PR 117 was merged (`9afae39`, production READY). Owner: "build more suggested ideas". D-328, D-329. New, behind the same
key, switch and budget: "Summary for a parent meeting" on the teacher's child
view and Student 360; "This week's notes in short" on the notes board (when a
class is picked) and the teacher's notes; "What to say on this call" on the
dues call sheet and the attendance call sheet; "Draft it for me" on the new
WhatsApp template sheet; "Today and this week in plain words" on Today. Every
figure in a call script or the brief is the app's own (slots); no family's
name or amount reaches the AI for a call. No migration. 19 new tests
(number rules, task clean-up, call-script privacy, sensitive notes held back).
Still not tried against the real API: no key is set yet.

## AI helper — 27 October 2026

Branch `feat/ai-assist`, [PR 117](https://github.com/veerpatta/vppsone/pull/117), feature commit `8833288`. Owner's request: build the brainstormed Claude uses
(all but the worksheet builder) on the school's Claude Console, easy for
non-technical staff. D-324 to D-327. Claude Haiku 5.5 for quick drafts,
Claude Sonnet 5.5 for remarks, results and reading a paper form.

What staff see, only once `ANTHROPIC_API_KEY` is set and the admin leaves it on:
"Tidy up" and "In English/Hindi" under every note box; "Write it for me",
"Polish" and "Fill the other language" on the notice composer, and "Suggest a
reply" on parent replies; "Suggest what to do in this period" on a cover duty;
"Write AI remarks for N children" and an AI card among the suggested remarks;
"Match the other N with AI" on the import's column step; "Fill from a photo of
the paper form" on the admission wizard; "Write a summary" on a class's result
analysis; an "Ask" row in the search box for questions; and Settings → AI
helper for the switch, budget, daily limit, per-feature switches and usage.

Migration `20261027080847_assist` (two private tables, three RPCs) is applied
on dev. 37 new tests: 30 unit (masking, cost, task clean-up, the route's
refusal order with Claude mocked) and 7 rendered component tests. Local:
14,765 tests, typecheck, lint, build and bundle budget all pass. No local
browser check: this checkout's `.env.local` has no Supabase settings. **Not yet tested against the real API**: there is
no key in this checkout or on Vercel, so every AI button is hidden on the
deployed app until the key is added (docs/SETUP.md). Status: in review.

## Workspace tidy — 26 October 2026

Branch `chore/tidy-root`. The local checkout moved from `Desktop\vppsone` to
`Desktop\VPPS One\app`, beside `reference-docs\` and `private-data\` (real export
files, never in git). Seven stray worktrees were removed after three unpushed agent
branches were pushed as `salvage/student360-first-screen`, `salvage/students-list`
and `salvage/admin-today-order`. Those three are not merged and still need review.
Root Playwright configs moved to `tests/playwright/` (D-323). Speed ideas, ranked
from a code read and not yet built: [plans/2026-10-26-speed-ideas.md](plans/2026-10-26-speed-ideas.md).

## Source-note privacy release - 25 October 2026

Reviewed on `codex/technical-followup-20261025`, based on main
`9212f9b4ff5c2f3193fe9ac55293da4d4ed29f62` (freshly fetched before publication).
Two reproduced failures now stop safely: parent sharing refuses failed/missing
source-note reads before writing, and plan reads refuse incomplete source results.
Author-only private-plan access is preserved. Independent final review found no
blockers. The same work adds reviewed synthetic timetable integration tests.

Local checks passed: 14,439 unit tests across 251 files, full-project TypeScript,
complete production build, 28 browser checks, scoped lint, port boundaries and
bundle budgets. Three original real-fixture suites were not run locally; theme
parity skipped because its reference checkout was absent. The normal CI remains
unchanged. Temporary build settings were restored; Claude was not interrupted.

The user authorized deployment on 25 October. Publication is now in progress via
a draft PR and exact-head CI, then the normal VPPS One Vercel pipeline. No database
migration, live record change or real notification is part of this release.
Authenticated backend acceptance and the historical weak-network register delay
remain separate limits. Policy decisions are unchanged. Release identifiers and
results: [verification record](evidence/notes-source-privacy-release-2026-10-25.md).
The earlier school-day ledger remains **202 fixed, 36 improved**, not all 262 resolved.


## Sampark shared teacher work — 16 October 2026

**Released 17 October 2026.** [#98](https://github.com/veerpatta/vppsone/pull/98) merged as `30416c7` (head `8f3b25c`, 22/22 checks green) and deployed to production (`dpl_21nXBAYm9X3h3VGkNxkENyRsjXEQ`, `vppsone.vercel.app` aliased to that commit). On schoolfees-dev the three migrations are recorded as `20261016125715` teacher_tasks, `20261016125729` profile_photos, `20261017043313` teacher_task_delivery. The last was applied from bytes hashing `a8567aa9…eb71eb`, and its catalog matches `migration-catalog.json` exactly: 26 functions with their ACLs, 4 RLS tables, indexes, triggers, the restrictive policy, 6 columns and 6 contracts. The 38 existing `message_sends` rows were untouched. Production was smoke-tested as QA admin and QA teacher: Needs you, Students "No photo" filter, Student360 photo/request actions, Integrations (AiSensy "Setup pending", automated sends off, manual sharing offered), teacher task list and staff photo entry. No writes, sends or links were created. Surprising: the repo files keep their `07/08/090000` names while the recorded versions are MCP-stamped, so the names and versions differ; the first two were already like that, and the files were left as reviewed. Remaining: AiSensy templates and provider configuration are deliberately pending. The first load after sign-in logged one React #418 hydration-text warning, not yet attributed to a screen.

**Placement fix, 17 October 2026** (branch `ui/sampark-placement`, D-295–D-296). The SamPark controls now sit in each screen's own kit and place. Student360 has a camera badge on the ring, ⋯ rows on a phone and "Ask a teacher" on a desk. Needs you has top-bar actions on a desk and a Teacher work card below the queue. Students has its toolbar select, a Filter-sheet section, the match banner and the bulk bar. Staff, teacher class and profile screens and Preferences got a photo button in their header cards, and "My tasks" is a teacher More tile with a shell page. Task and photo sheets follow vx's language rule. Local checks: typecheck and lint pass; 209 files / 13,771 unit tests pass; both SamPark and photo browser acceptances pass at 390 and 1440 px (evidence screenshots refreshed); verified by hand at 390 and 1366 px as QA admin and teacher. Remaining: the fee list still clips its quick-chip row at its own edge (unchanged behaviour).

Consolidated final-review corrections are complete locally on `codex/sampark-teacher-workflows`, based on `88c7923` (commit title `fix: preserve task authority and repair acceptance fixtures`): original task credential preservation, installed legacy atomic writes, scalar draft isolation, management authority after waits, signed-in legacy photo entry and sharp 0.35.5. Current focused checks pass 15 files / 72 tests; all seven actual SQL scripts, 26 PostgreSQL observed-lock schedules, 125 affected browser tests, refreshed integrated/photo browsers, typecheck, lint (nine existing warnings), theme and port gates pass. The revised three-function-body SQL delta is covered by existing user approval per parent confirmation; no migration is applied at this worker checkpoint. Corrected-head full Vitest/build/bundles run in mandatory CI alongside scoped review under Ruling 6; controller application/release verification remain pending. [Consolidated evidence](evidence/sampark-workflows/consolidated-fixes-report.md).

Historical Task 4 gates at `88c7923` passed: 204 files / 13,742 tests (zero skips), typecheck, lint (nine existing warnings), all 430 theme tokens, port check, production build, all eight bundle budgets, both integrated browser widths and actual canonical SQL plus twenty PostgreSQL lock schedules. These historical full-suite/build results do not establish corrected-head success. At 11:27:28 UTC the user approved the original exact dev packet; application remains with the controller after required checks/review. No deployed/live completion is implied.

Task 4 integrates the reviewed Tasks 1–3. Legacy teacher proposals without a managed task now require an administrator in the canonical database review transaction and existing review action/UI. Existing Integrations shows pending AiSensy configuration, counts local templates without calling them externally approved, and links to usable reviewed manual sharing. External campaign/template setup is deliberately deferred by the user's 10:31 UTC steering; it does not block the remaining release after migration, review and CI gates. Unknown saves/sends retain their exact commands and truthful unconfirmed wording. Genuine production-component fixtures cover mobile/desktop recovery and portraits; actual canonical academic SQL and all twenty PostgreSQL lock schedules pass. [Task 4 report](evidence/sampark-workflows/task-4-report.md) and the [exact migration packet](evidence/sampark-workflows/migration-approval.md) are the current local acceptance records. Independent final review, remote migration approval/application, PR/CI and deployment verification remain controller-owned; this is not a release claim.

Tasks 1–3 have passed independent reviews; their plan checkboxes are complete. The prior Task 1 “no local PostgreSQL runtime / execution pending” statement below is historical: the controller's [fresh local concurrency evidence](evidence/sampark-workflows/task-1-concurrency-local.md), followed by Task 4's final-SQL run, supersedes it. No remote migration or live delivery was performed by Task 4.

Task 3 fix round 1 (local commit title `fix: reserve task campaigns and show reviewed delivery scope`) closes the two Important findings: generic campaign bypass and missing student/field/academic-scope approval details. Twelve focused files/103 tests, current PGlite migration, typecheck and scoped lint pass; lock order is unchanged, so prior concurrency evidence is retained without a new server run. The report records the revised SQL hash. Minor UI findings and explicit Integrations pending setup remain with Task 4; AiSensy template configuration is intentionally deferred and does not block releasing the remaining work.

Task 3 implemented locally on `codex/sampark-teacher-workflows` (commit title `feat: add reviewed teacher task delivery and reconciliation`; not released). Existing collection delivery now owns reviewed task send/remind/manual, current-recipient and language checks, durable unknown/reconciliation and canonical follow-up. Focused 10-file/87-test run, typecheck, scoped lint, PGlite and fresh PostgreSQL 17 observed-lock schedules pass. Six campaign contracts and exact additive migration inventory are in [Task 3 evidence](evidence/sampark-workflows/task-3-report.md). Independent review, Task 4 integrated checks, migration approval and verified provider configuration remain with the controller; no remote writes or real messages occurred.

Task 1 implemented locally on `codex/sampark-teacher-workflows` (local commit titled `feat: add shared teacher task assignment and entry points`; not released). Needs you assignment, Students/profile requests and signed-in/public task work share canonical collection/marks/register sources. The authored migration remains unapplied; approval, independent review, Tasks 2/3 and Task 4 browser/release checks remain with the controller. See [Task 1 evidence](evidence/sampark-workflows/task-1-report.md) for SQL proof, RED/GREEN, the original full-suite failures and subsequent focused pass. The large selection identity and explicit rejected-work recovery required database fixes; no school data or external sends were used.

Task 1 fix round 1 addresses all four Important review findings: known academic refusals remain editable; stale scope/replayed creation refuses and offers explicit existing-list delegation; missing-field selection intersects canonical directory results; academic edits and uncertain command identities recover from scoped local storage. Covering 15-file/170-test run, separate action tests, actual migration SQL fixture, 6GB typecheck and scoped lint are recorded in the appended Task 1 evidence. Independent re-review and release gates remain with the controller; no remote operations were performed.

Task 1 fix round 2 addresses the re-review's create/restart lock inversion: both acquire the session advisory lock before shared row locks and re-read the initial lookup afterward. Local PGlite and 28 focused tests pass. A deterministic two-connection regression against the actual migration is wired to disposable localhost PostgreSQL 17 in CI; execution is pending CI, because no local PostgreSQL/Python runtime is available. No remote operations or migration application occurred.

## Student profile redesign — 12 October 2026

User-approved portrait profile implemented on `codex/student-profile-redesign`, based on main `62a513ae5e2fe937f2b2d09e70b8cb618a8c6839` (#82). Four primary sections retain the existing tab URLs, directory return context, browser history and Payment Desk flow. Private collection portraits retain `collection:manage`; no public photo fallback, permission expansion or fee-calculation change. Independent review findings on class scope and unavailable records were fixed. Tests and synthetic screenshots are documented in `docs/evidence/student-profile-2026-10-12/README.md`.

Status: implementation, local verification and independent review done in `73493b314257b33094a6f426c5bbe3f80bf3d81c`; release authorized and tracked by [PR #83](https://github.com/veerpatta/vppsone/pull/83). The user subsequently authorized commit, push, a draft PR, green-check merge and production deployment. The PR and final task release report are the authoritative CI/merge/deployment checkpoint. No school database writes or migrations are authorized for this task.

**The 4 October plan pack is done: P0–P12 merged and deployed (last: `b16eee0`, #49).**
Its Gate H report is `docs/RELEASE-REPORT-2026-10-04.md`: ready for the bounded
in-app cover pilot in `docs/PILOT-RUNBOOK.md`, and **not** for real WhatsApp,
parent automation or cutover. What waits on the school is listed there under
"Decisions the school still owes"; nothing in it is code. The next code work
is the residual R rows below.
F6 is done — `schoolfees-dev` carries a de-identified replica of the live fee
database (D-186), and `docs/replica-and-smoke.md` is the account of what having
real fee data uncovered. **F7 is done: an accountant posts a payment in VPPS One, and the role boundary holds at the database (D-191).** R3.4 is the next R row and still owes
mock message retry and the S-01–S-09 acceptance pass; precedence on accept is
now in the database (P10a, D-234), which replaces wiring `mayReplace()`.

Use the first actionable row, not the deferred original live-cutover row 7.3.
Phases 0–7 below are historical implementation records and remain intact.
An agent updates its row before it stops. Never delete a row; add `N.x-fix` rows
under the task they fix.

**The design atlas.** `docs/design/` (Ledger Calm 2, v1.0) is the shared UI
reference; its `HANDOFF.md` adds a D0–D5 queue that runs *alongside* the R
queue rather than replacing it. D0–D2 are in the table below. Read
`docs/evidence/D0-2026-09-17.md` before touching a role home: it records which
atlas screens belong to this repo, which belong to `veerpatta/schoolfees`, and
the five places the implementation deliberately departs from the pictures.

Status: `todo` · `in progress` · `pr open` · `done` · `blocked (reason)`

## Plan pack — 4 October 2026 (active)

Raj supplied a planning pack on 4 October (`VPPS-One-Full-Plan.md`, coding
prompts, PDF and a source-evidence archive) and asked for it end to end. Its
tickets P0–P12 run **ahead of** the residual R rows below, which stay open and
are not reset. First slice: absence → valid published cover → staff notice →
teacher acknowledgement (P0–P5). Authorization given before work began: ship
per rule 5, additive `vppsone` migrations on schoolfees-dev, Timetable2025
regular bells as an editable default, admin-only role changes (D-205).

| Task | Bounded deliverable | Gate | Status | Branch / commit / evidence |
|---|---|---|---|---|
| P0 | Baseline, target isolation and a fail-closed client guard; redacted execution manifest | A | done | `p0-p1-isolation-and-authority` · `target-guard.ts`, `scripts/target-guard.mjs` · `docs/evidence/P0-P1-2026-10-04.md` · D-208. The "conflicting" ref `hkkrtspkawifcyqfzltx` exists nowhere |
| P1 | One staff authority, admin-only role/activation, last-admin guard, scoped direct reads, teacher class scope in pages | C | done | same branch · migrations `*_staff_authority_and_scoped_reads`, `*_hide_phone_reason_and_token_columns` · `npm run verify:access` · D-205–D-209. Concurrent last-admin race never run on dev (reason in evidence); D-207 names the fee-role decision needed before cutover |
| P2 | Bell schedule and physical teaching events: joint, parallel cohort and team block; every-member eligibility | B, D | done | `p2-physical-duties` · `domain/events.ts`, `domain/bells.ts`, migration `*_bells_and_team_rules`, `/substitutions/rules` · `docs/evidence/P2-2026-10-04.md` · D-210, D-211. Team rules unset: ELGA stays manual until the school says how many must be present |
| P3 | One atomic, versioned, idempotent "Save absence & arrange cover" command with receipt | E | done | `p3-cover-command` · `commit_cover_command`, `domain/arrange.ts`, new `/substitutions` · `npm run verify:cover` 19/19 · `tests/e2e/cover-workflow.spec.ts` (absence → hand-picked teacher → acknowledge → cannot cover → back at school, in a browser) · `docs/evidence/P3-P5-2026-10-04.md` · D-212, D-213, D-216. Writing the journey found that assigning the current holder never pinned her |
| P4 | Staff notice outbox: intents, leased attempts, current-state recheck, Unknown, mock transport | F | done | same branch · `staff_notice_attempts`, claim/stamp/finish/sweep/reconcile, `staff-notices/` · `npm run verify:outbox` 11/11 · D-214. Real AiSensy campaign not created or verified (provider gate) |
| P5 | Teacher duty loop: Today + link to one authenticated duty, Acknowledge, Cannot cover, escalation | G | done | same branch · `/duty/[id]`, `respond_to_cover_duty`, Today card · D-215. Physical phone and teacher trials not run (R8.3) |
| P6 | Attendance: effective roster, explicit whole-roster save, half-day, receipt recovery | — | done | `p6-attendance` · `save_attendance_register`, `attendance_register_revisions`, `attendance_rules`, dated `attendance_roster()`, reminder via the outbox · `npm run verify:attendance` 22/22 · `tests/e2e/attendance-register.spec.ts` · `docs/evidence/P6-2026-10-04.md` · D-217–D-222. Subject teachers no longer take a class's daily register (plan rule); phone trials not run (R8.3) |
| P7 | Marks: blank/zero/absent/exempt distinct, draft then submit | — | done | `p7-marks` · `save_marks`, `marks.exempt`, paper scheme (step, exemption), `marks_commands`, `paper_roster()` · `npm run verify:marks` 23/23 · `tests/e2e/marks-entry.spec.ts` · `docs/evidence/P7-2026-10-04.md` · D-223–D-225. Only the assigned subject teacher or the exam office enters a paper now; the school's scheme and bands are P8's to confirm |
| P8 | SA1 reports: scheme, completeness, immutable issued revision | — | done | `p8-reports` · `report_schemes`, `report_card_issues`, `issue_report_card`, `/assessments/scheme`, Draft marking · `npm run verify:reports` 14/14 · `tests/report-scheme.test.ts` · `tests/e2e/report-issue.spec.ts` · `docs/evidence/P8-2026-10-04.md` · D-226–D-229 (set-up strings moved to `src/messages/setup.ts` to keep `/students` inside its bundle budget). The school's own SA1 scheme (bands, rounding, pass rule, header, signatories) is unconfirmed — defaults until the exam office approves its own |
| P9 | Parent message policy: approval by default, stale approval blocked | — | done | `p9-parent-policy` · `parent_message_policies`, `parent_route_flags`, snapshot and stale columns on `message_sends`, `/collection/policy` · `npm run verify:parent-policy` 15/15 · `tests/parent-policy.test.ts` · `tests/e2e/parent-messages.spec.ts` · `docs/evidence/P9-2026-10-04.md` · D-230–D-232. Every category needs approval and `parent_dispatch` is off; no school-approved automatic exception exists, and report and absence messages are not queued anywhere yet |
| P10 | SamPark residual parity (R3.4/R4) | — | done | **P10a merged** (`f3bb72e`, #48): one writer `write_student_value`, `student_record_history`, `accept_submissions` · `verify:records` 19/19 · D-233–D-234. **P10b/P10c/P10d merged** (`b16eee0`, #49): SamPark workbook import by ids with the identity queue (`/collection/import`, `apply_sampark_import`, `resolve_sampark_row`), photographs (`/collection/photos`, `place_student_photo`, private bucket) · `verify:sampark-import` 17/17 · `verify:photos` 9/9 · `docs/evidence/P10bc-2026-10-04.md` · D-235–D-236. **P10d**: students and round workbooks (`/collection/export/students`, `/collection/rounds/[id]/export`), every cell text, counts inside, logged · `tests/workbook.test.ts`, `tests/e2e/workbook-export.spec.ts` · D-237. Open: teacher photo capture by link, the general student import, identity/source health |
| P11 | Archive catalogue and restore drill | — | done | `b16eee0` (#49) · `vppsone.archives`, `restore_drills`, private `vppsone-archives` bucket, `archive_table_export` / `restore_drill_table`, shared `archive-engine.ts`, `/archives` · `npm run verify:archive` 10/10 (66 tables, 4,530 rows, 5 files; four kinds of tampering caught) · `tests/e2e/archive-drill.spec.ts` · `docs/ARCHIVE.md` · `docs/evidence/P11-2026-10-04.md` · D-238. Off-site copies stay manual until the school authorizes a destination; archives are made by hand |
| P12 | Release report, pilot runbook, hosting decision inputs | H | done | `b16eee0` (#49) · `docs/RELEASE-REPORT-2026-10-04.md` (Gate H: ready for the bounded in-app cover pilot; not for real WhatsApp, parent automation or cutover), `docs/PILOT-RUNBOOK.md`, `docs/HOSTING-DECISION.md` · `npm run verify:fee-parity` 7/7 against `docs/evidence/fee-contract-baseline.json` (505 fee objects) · the migration boundary test · `verify:cover` gains the operator-switch check (20/20) · D-239. Never run: real devices, the provider gate, synthetic fee postings for the behavioural fee regressions and rollback drill, a fresh-project restore |

## Revision 2 — active queue (2026-09-17)

Planning delivery: updated PLAN, parity register, QA protocol, verified baseline,
kickoff and aligned entry documents. Branch `main`; identify this documentation
commit through git history. Baseline application commit `0712de6`. No R-phase
implementation is claimed. See `QA-BASELINE-2026-09-17.md` for executed checks.

| Task | Bounded deliverable | Depends on | Status | Branch / commit / evidence |
|---|---|---|---|---|
| R0.1 | Complete source parity inventory, verify app/test origins and record baseline defects/metrics | Existing source + baseline | done | `r0-1-parity-and-origins` · `f6327b3` ([#17](https://github.com/veerpatta/vppsone/pull/17)) · `docs/evidence/R0.1-2026-09-17.md`, `docs/evidence/R0.1-origins-2026-09-17.json`, `npm run verify:origins` |
| R0.2 | Deterministic six-role + second-teacher fixtures, run-scoped reset and mock provider | R0.1 | done | `r0-2-fixtures` · `8f78782` ([#18](https://github.com/veerpatta/vppsone/pull/18)) · `npm run qa:seed`/`qa:reset`/`qa:status` · `docs/evidence/R0.2-2026-09-17.md` |
| R0.2-fix | B-21: the teacher's Today card called her first lesson "Period 0" | R0.2 | done | `r0-2-fixtures` · `8f78782` ([#18](https://github.com/veerpatta/vppsone/pull/18)) · `src/modules/timetable/domain/periods.ts`, `tests/periods.test.ts` |
| R0.3 | Independent access expectations; smoke timeouts/counts/results; first teacher and office browser journeys | R0.2 | done | `r0-3-expectations-and-journeys` · `01da4d4` ([#19](https://github.com/veerpatta/vppsone/pull/19)) · `npm run smoke:workflows` · `docs/evidence/R0.3-2026-09-17.md`, `docs/evidence/R0.3-smoke-roles-2026-09-17.json` |
| R1.1 | App registry, Apps hub, original SamPark/School Fees home shortcuts and verified context links | R0.1 | done | `r1-1-app-registry` · `76bba63` ([#20](https://github.com/veerpatta/vppsone/pull/20)) · `src/platform/config/apps.ts`, `/apps` · `docs/evidence/R1.1-2026-09-17.md` |
| R1.2 | Role home resolver, role-priority phone nav, grouped desktop sidebar and aliases | R1.1 | done | `r1-2-role-navigation` · `d3eca8e` ([#21](https://github.com/veerpatta/vppsone/pull/21)) · `homeFor()`, `NAV_PRIORITY`, `sidebarFor()` · `docs/evidence/R1.2-2026-09-17.md` |
| R1.3 | Shared form/state components, language preferences and responsive design baseline | R1.2 | done | `r1-3-shared-states` · `3aa251f` ([#22](https://github.com/veerpatta/vppsone/pull/22)) · `authored.ts`, `AuthoredText`, `/preferences`, `class-order.ts` · `docs/evidence/R1.3-2026-09-17.md` |
| R2.1 | Teacher Today priorities, assigned requests and class shortcuts | R1.3, R0.3 | done | `r2-1-teacher-today` · `6fde807` ([#23](https://github.com/veerpatta/vppsone/pull/23)) · `lessonsToday()`, `nextAction()`, `TaskHero` · `docs/evidence/R2.1-2026-09-17.md`. Assigned requests deferred to R3.3 with the inbox they need |
| R2.2 | Office/admin, academic/exam coordinator and viewer homes with real queues | R1.3, R0.3 | done | `r2-1-teacher-today` · `6fde807` ([#23](https://github.com/veerpatta/vppsone/pull/23)) · `attention.ts`, `home-repo.ts` · `docs/evidence/R2.2-2026-09-17.md`. Exam coordinator queue deferred to R5.3 with the counts it needs; no fee summary until R6 |
| R2.3 | Student directory and shared summary, source labels, persistent search/session context | R2.1, R2.2 | done | `r2-3-directory` · `/students`, `directory.ts`, source badges, fee context link · `docs/evidence/R2.3-2026-09-17.md`. Detail screen stays at `/teach/student/[id]` until R4.1 moves it with an alias |
| R3.1 | Additive rounds, frozen membership/value snapshots, identity mapping and audience domain | R0, R2.3 | done | `r3-1-rounds` · `652393c` ([#25](https://github.com/veerpatta/vppsone/pull/25)) · `collection_rounds`, `collection_request_members`, `audience.ts`, `external_student_ids` · `tests/e2e/collection-freeze.spec.ts` · `docs/evidence/R3.1-2026-09-17.md`. Rounds and mapping are schema with no writer yet: the wizard is R3.2, the fan-out R3.3, the matcher R4.1 |
| R3.2 | Audience/fields/preview wizard, gap filters and Excel ask-list matching with notes | R3.1 | done | `r3-2-round-wizard` · `4668104` ([#26](https://github.com/veerpatta/vppsone/pull/26)) · `/collection/rounds`, `rounds-repo.ts`, `gaps.ts`, `ask-list.ts` · `tests/e2e/{round-wizard,ask-list}.spec.ts` · `docs/evidence/R3.2-2026-09-17.md`. A round mints no links yet (R3.3). House and route audiences are resolvable and not offered: both columns are empty on dev and rule 2 forbids filling them (B-31), and nothing holds house/route ownership (B-32) |
| R3.3 | Teacher fan-out, master/office links, completion board and resume | R3.2 | done | `r3-3-fan-out` · `fbcfb4a` ([#27](https://github.com/veerpatta/vppsone/pull/27)) · `staff_scopes`, `ownership.ts`, `fan-out.ts`, `fan-out-repo.ts`, `RoundBoard` · `tests/e2e/fan-out.spec.ts` · `docs/evidence/R3.3-2026-09-17.md`. Nothing is sent: the board records what the office did in WhatsApp itself (D-10). No per-group override yet (B-35); house and route rounds still undemonstrable on dev data (B-31) |
| R3.4 | Round-aware review/precedence/superseding and mock message retry; S-01–S-09 acceptance | R3.3 | in progress | `r3-4-review-precedence` · `precedence.ts`, round context on the queue, staleness and superseding · `tests/e2e/review-precedence.spec.ts` · `docs/evidence/R3.4-2026-09-17.md`. **Still owed: mock message retry, the S-01–S-09 acceptance pass, and wiring `mayReplace()` into accept** |
| R4.1 | Student source/health tools and resumable import preview/error handling | R3.4 | todo | — |
| R4.2 | Student photo capture/retake/replace, bulk filename matching and office-assisted workflow | R4.1 | todo | — |
| R4.3 | Documents, workbook export and residual S-12–S-14 source parity | R4.2 | todo | — |
| R5.1 | Attendance UX, durable/account-scoped drafts, corrections and atomic save recovery | R2, R0.3 | in progress | Draft/recovery/UI portion shipped in R7-smooth; complete correction/concurrency acceptance remains |
| R5.1-fix | Independent attendance recovery, pending-correction visibility, refusal handling and queue warnings | R5.1 | released; acceptance partial | [PR #66](https://github.com/veerpatta/vppsone/pull/66), main `585e593f4118d163344a8de2aa647866d642c079`; review CI 38109919157 and main CI 38110232040 passed, matching Vercel production READY. No DB writes or migration approval. Physical/authenticated acceptance remains open. |
| R7.1-fix | Student 360 streamed fee errors remain distinct from absent records, with retry | R7.1 | released; acceptance partial | [PR #66](https://github.com/veerpatta/vppsone/pull/66), main `585e593f4118d163344a8de2aa647866d642c079`; 12,239 tests/126 files, 74 responsive browser cases, four payment-draft cases and build/budgets passed. Hosted commit verified; see `docs/evidence/independent-release-integration-2026-10-11.md`. |
| R5.2 | Timetable/cover usability, atomic publication and stale/concurrent plan handling | R5.1 | todo | — |
| R5.3 | Marks entry/paste/history, report readiness and print; atomic/versioned saves | R5.2, R4.3 | in progress | Scoped draft/recovery and submit-time payload shipped in R7-smooth; paste/history/report/versioning acceptance remains |
| R6.1 | Complete all F-row fee destinations and verify authentication/context/environment handoff | R1.1, R2.3 | todo | — |
| R6.2 | Reconcile fee summaries and validate original workflows in verified fee test environment | R6.1 | todo | Record unavailable sandbox as an evidence gap, never use live writes |
| R7.1 | Measure and optimize query/render/bundle/image/save hotspots; before/after evidence | R3–R6 | in progress | Bounded shell/directory/form work measured in R7-smooth; remaining workflow/image hotspots and field acceptance are open |
| R7.2 | Full responsive/language/keyboard/accessibility pass and performance budgets | R7.1 | todo | Partial performance/PWA work in R7-smooth below; the full atlas state matrix remains owed |
| R7-smooth | Requested desktop/mobile smoothness, installability, scoped drafts and measured performance | User request | done | `perf/installable-workspace` · `2c9ef2f` / `741318f` · [PR 39](https://github.com/veerpatta/vppsone/pull/39) · D-201–D-203 · `docs/evidence/smoothness-2026-10-01.md`; does not close all R5/R7/R8 parity work |
| R7-smooth-fix | Payment draft key readiness, switching/reload recovery and honest warning | R7-smooth | pr open | `fix/payment-draft-recovery`; implementation `d947828619bf3de107cae3064206618f72e91d63`; [draft PR 40](https://github.com/veerpatta/vppsone/pull/40); D-204; `docs/evidence/payment-draft-recovery-2026-10-01.md`. All required local gates and four Chromium journeys passed; explicit release approval remains outstanding |
| R8.1 | Full deep smoke matrix; fix P0/P1 with regression and cleanup evidence | R7.2 | todo | — |
| R8.1-smoke-fix | Requested test-data rule/workflow smoke, responsive feedback and query latency fixes | User request, 5 October | done | [PR 52](https://github.com/veerpatta/vppsone/pull/52), [PR 54](https://github.com/veerpatta/vppsone/pull/54), [PR 55](https://github.com/veerpatta/vppsone/pull/55) · code merged/deployed at `8c5dbe5`, `bom1` · D-240–D-247 · CI 10,074 tests/94 files; 12 rule commands plus 17 recovery API assertions; all 76 browser workflows covered, five final live checks passed · final live role matrix 784/784, account sweep 991 cases, zero broken screens/missing fixtures; inert fixtures removed and checked · native recovery migration `20261006043431` applied on dev, 505 public fee objects unchanged · live p50 `/teach` 3127→573ms, `/dashboard` 2048→585ms, `/fees/payments` 2427→791ms · `docs/RELEASE-REPORT-2026-10-06.md` and dated evidence · Surprise: layout redirects did not stop concurrent fee-page background work; shared native fee guard now stops it, with zero error/fatal logs after the final sweep. Field CWV, physical acceptance and occasional latency spikes remain open |
| R8.1-pdf-fonts | Live smoke, 10 October: every PDF returned 500 on production | User request, 10 October | done | [PR 57](https://github.com/veerpatta/vppsone/pull/57), `1bbcf87`, [PR 58](https://github.com/veerpatta/vppsone/pull/58) · deployed at `bc0e2bf`; live receipt PDF 200 `application/pdf` 70 KB at 17:15 UTC · `claude/project-thread-byaizq` · write flows (payment, note) and desktop/phone crawls of all 10 accounts clean except PDFs; receipt PDF, WhatsApp receipt attachment, fee statements and collection lists failed with MODULE_NOT_FOUND because pdfkit loads `#standard-fonts/*` through a subpath import file tracing does not follow, those files require `./chunks/`, and `document-kit.tsx` reads `public/fonts/*.ttf` and two branding PNGs off disk, which Vercel keeps out of functions · fix: `outputFileTracingIncludes` for all of them on every route (the comment in document-kit said this include existed; it was never ported into next.config) · Surprise: each fix exposed the next missing file, three in a row. One ₹100 dev test receipt SVP20261010-0001 left unreversed |
| R5.1-no-approval | Attendance corrections need no admin approval, and class teachers have no time limit | User request, 11 October | done | `remove-attendance-approval` · [PR 71](https://github.com/veerpatta/vppsone/pull/71) · D-248 · removed the 30-minute change window (both server actions and the teacher screen), the "Ask the office" sheet, `/teach/corrections`, the coordinator's Changes tab, Needs-you correction items and their counts. A class teacher picks a reason in the save sheet. No migration: the window was app-only, and `attendance_corrections` stays as history. Surprise: the first diagnosis was wrong. On the old screen a class teacher could already correct directly; the approval came from the new vx screen merged the same day |
| R7-whole-student | 11 Oct improvement notes: payment desk trust, Students views, Student 360 overview, scoped notes, Today around the school day | User request, 11 October | done | [PR 73](https://github.com/veerpatta/vppsone/pull/73), [PR 74](https://github.com/veerpatta/vppsone/pull/74) · D-249–D-260 · no migration. Payment form 541/553px at 1100/1440px (was ~228px); review step, uncertain-save check by request id, Overdue/Due today/Upcoming; School view default with attendance and badges; provisional term label; notes scoped to a child; Scheduled now. Surprise: the profile's Notes tab had been empty since 10 Oct (ambiguous author embed). Open: fee-collector posting (D-259), marks finalisation and bulk approvals wait on the notes' §10 decisions, and the row click/scroll return were checked in code, not visually |
| R7-whole-student-2 | The notes' remaining items, built with defaults: fee collectors post payments (D-261), admin finalises marks (D-262), bulk decide of ticked changes (D-263), health/family notes scoped (D-264), family contact outcomes (D-265), support actions worked in Student 360 (D-266), teacher roster badges and named reviews on Today (D-267), attendance/Year Clear answers (D-268); live-check fixes D-270 to D-272 | R7-whole-student | done | PR #75 merged as `f160533`, then a follow-up PR for D-270 to D-272. Migrations `20261011090858`, `20261011091243`, `20261011092957` applied to schoolfees-dev, and the dev fee DB grants fee collectors posting. Live check on 11 Oct: row click and scroll return pass on desktop and phone; Today timetable right at a set test time; Student 360 and teacher badges pass; the QA fee collector posted ₹100 cash (SVP20261011-0001) on dev. That check found the automatic WhatsApp receipt attempt (D-270, nothing reached anyone: no provider key), the stale balance on the printed receipt (D-271) and the clock and Accounts gaps (D-272). Still owed at cutover: `docs/cutover/fee-collector-posts-payments.sql` on the live fee DB. Search text typed but not submitted is lost on Back |
| R7-today-phone | Today's "Scheduled now" timetable is too long on a phone | User request, 12 October | done | [PR 81](https://github.com/veerpatta/vppsone/pull/81), main `8ff04a5`, production `dpl_34EH87Hg8UkddZ923pF5KM4SNYN9` READY (live CSS carries `.sched-scroll`) · `fix/today-schedule-mobile` · Now/Next switch, folded list with cover changes first, one-line rows, desktop unchanged (D-273) · card 916px → 521px at 390px with 22 test classes · `tests/vx-admin-schedule.test.ts` (fold rule), `tests/mobile-ui/today-schedule.spec.ts` 13/13 at 320/360/390 in en/hi/hi-en, axe clean. Not yet checked on a real phone during school hours |
| R7-design-everywhere | Older screens in the design's frame: the 85 not-yet-redesigned routes open in the design's top bar and the fee kit's primitives take the design's geometry | User request, 13 October ("implement this design in the whole app") | done | [PR 84](https://github.com/veerpatta/vppsone/pull/84), main `a5a5ca4` · `ui/design-everywhere` · UI-73 · fidelity fixture `tests/mobile-ui/design.html` + `scripts/design-compare.mjs`. Found that the canvas had not changed since the 10 Oct build; the gap was the classic screens and later drift |
| R7-same-to-same | "Same to same": every module set beside its design frames and fixed until they agree; the design wins over later look changes (owner's choice, 13 Oct), rules and data stay | User request, 13 October | done | [PR 85](https://github.com/veerpatta/vppsone/pull/85), main `84c8345` · `ui/fidelity-all` · UI-74…UI-93 · per-module log and remaining gaps in `docs/ui/FIDELITY.md`. Student 360 back to the design (undoes PR #83's portrait profile) as an intercepting drawer. Payment Desk: an unresolved save closes to the desk with Resume payment, and bulk entry is gated again (UI-88). Students opens on Fees for fee readers, as D01/F05 draw it (UI-89, over D-253's School default). `outbox-handoff.spec.ts` (local mobile-ui only) flakes the same way on main. CI 19/19 green on `952c146` (WebKit included); production deploy of `84c8345` READY on vppsone.vercel.app, sign-in page checked live. Signed-in live walk not run: no service key in this checkout and the Vercel env read was refused |
| R7-phone-filters-steps | Phone: filters and other views on Students, and collecting a fee in steps without scrolling | User request, 16 October | done | [PR 95](https://github.com/veerpatta/vppsone/pull/95), main `22ac204`, production `dpl_2gwXV3pGT4TysfkRG8ryAUU8Jrq6` READY · `ui/phone-filters-steps` · UI-94, UI-95, D-292–D-294 · Students: Filter sheet (view, class, eight fee filters, four child filters, sort, Cards/Compact/By class), removable chips, layout remembered per person. Desk on a phone: Dues → Amount → Date & save with a stepper and Back/Next; each step fits 390×844 (measured on the design harness). Found that a fee-list filter over ~300 children put every id in one URL ("Part paid" is 390 on dev) and fixed the paging (D-292). Phone suites updated for the steps: fee-followup 27/27, operations-fee-collector 29/29, operations-admin 18/18 (new Filter sheet test at four widths), payment parity (it timed out on the old one-page flow until updated; green in Chromium and WebKit). CI 19/19 on `dc71a8d`. No migration. Not yet tried on a real phone at the counter, and no signed-in walk on live (no service key in this checkout)
| R7-desk-keyboard-speed | Phone desk after first use: the class list would not scroll, the keyboard should open on its own and the layout fit it, and faster | User request, 16 October | done | [PR 97](https://github.com/veerpatta/vppsone/pull/97), main `81f6589`, production `dpl_J6irCgCzHn7iibb1avZEufU9Dsbw` READY · `ui/desk-keyboard-speed` · UI-96, D-362 · The class list was a "contain" scroller with no height cap and swallowed the finger (since before the steps); now a scroll area only where capped. Amount focused on arrival, typing mode (bar on the keyboard, stepper and tab bar aside), taps that blur a field land before the layout moves. Desk load starts the ledger and receipts with the summary; rows start loading on press. Found while testing: typing in Notes then tapping Review & save missed the button (layout moved mid-tap) — fixed by ending typing mode 250 ms after blur. Merged main twice while it waited (the live post-payment read, B07; the class row's grid layout); its decision was renumbered D-295 → D-362 because main had taken D-295–D-361 meanwhile. One WebKit run crashed the browser once (passed on re-run). Not measured on a real phone
| R8.2 | CI/main/deployment verification, parity closure and rollback report | R8.1 | todo | — |
| R8.3 | Timed teacher/office/admin and physical Android/webview/camera/print acceptance | R8.2 | todo | Code-delivered and staff-accepted are separate if physical evidence unavailable |

### Design atlas queue (`docs/design/HANDOFF.md`)

Runs alongside the R rows above; it does not replace them. D3 is deliberately
not a row of its own — the handoff's own table maps each of its slices onto
R2–R8, so those rows own it.

| Task | Bounded deliverable | Depends on | Status | Branch / commit / evidence |
|---|---|---|---|---|
| D0 | Delta audit: atlas vs built, persona→role map, repo ownership per screen, deviations | R1–R3 as merged | done | `d1-d2-role-homes` · `docs/evidence/D0-2026-09-17.md` |
| D1 | Shared foundation the role homes need: two-column desktop layout, page eyebrow and desktop title scale, labelled progress bar, signed-in identity in the top bar, wider shell | D0 | done | `d1-d2-role-homes` · `HomeColumns`, `ProgressRow`, `PageHeader` `eyebrow`, `max-w-7xl` · `docs/evidence/D1-D2-2026-09-17.md` |
| D2 | Role homes with real data: accounts staff start in School Fees, teacher opens her class/day, admin gets the combined overview; office/coordinator/viewer preserved | D1 | done | `d1-d2-role-homes` · `start.ts`, `overview.ts`, `schoolOverview()`, `/preferences` start form · `tests/e2e/role-homes.spec.ts` · `docs/evidence/D1-D2-2026-09-17.md` |
| D2-fix | B-38: an issued link carrying a query string 404ed. B-39: `/\host` passed the redirect check. B-40/B-41: the workflow suite's own fragility — a 58 s test against a 60 s timeout, and three teardowns that leaked three requests a run | D2 | done | `d1-d2-role-homes` · `isSafeInternalPath()`, `/auth/confirm`, `removeRound()` · `tests/env.test.ts`, `tests/e2e/role-homes.spec.ts` |
| D3 | The design language on every screen: shared panel/row/footnote/state kit, page eyebrows across the app, row lists converted | D2 | done | `d3-design-language` · `src/ui/panel.tsx`, `StateCard`, 37 eyebrowed headings · `docs/evidence/D3-2026-09-18.md`. Its per-workflow slices stay owned by the R rows the handoff names |
| D3-fix | B-42: the first `Panel` rendered lists as `<div>`s, so a register was fifteen unrelated paragraphs to a screen reader. B-43: `HomeColumns` changed element type when its aside went away, remounting the register form and losing the "Saved" acknowledgement | D3 | done | `d3-design-language` · `Panel` is a `<ul>`, `PanelRow` an `<li>`, `HomeColumns` keeps one wrapper · both caught by `tests/e2e/teacher-attendance.spec.ts` |
| D4 | Deep interaction and visual QA across the atlas's full state matrix | D3, R5 | todo | Partial pass recorded in `docs/evidence/D1-D2-2026-09-17.md` and `D3-2026-09-18.md`; the rest belongs with R7.2/R8.1 |
| D5 | Design deviations and status folded into the release report | D4, R8.2 | todo | Deviations recorded in D0; the report is R8.2's |

## The School Fees port (F rows)

Janmejay's call, 18 September 2026, after the conflict with CLAUDE.md rule 2
was put to him: *"eventually the vpps one will become the main app for all and
we will close fees app once the vpps one is complete... the accountant should
see the exact fee app as now in vpps one, nothing changes same as fee app, you
literally copy paste exact code for accountant user."*

So the fee app is ported in, not linked to. Branch `port-fee-app`.
This supersedes the working interpretation in PLAN §1 and selects the
alternative PLAN §9 left open. R6 (the launcher-based handoff) is reduced to
whatever still needs a link after the port, and is not yet revisited.

| Task | Bounded deliverable | Status | Evidence |
|---|---|---|---|
| F1 | Tailwind v3 + the fee app's tokens, config and globals | done | `a9cda27` · `npm run check:theme` compares 430 tokens against the sibling repo |
| F2 | The fee build configuration: staleTimes, dynamicOnHover, React Compiler, 12 dependencies | done | `8f235a3` · `next build --webpack` |
| F3 | One role model and one language across both vocabularies | done | `9fead20` · `fee-roles.ts`, the session shim, `i18n/bridge.ts`, migration `20260918043934` · `tests/{fee-roles,i18n-bridge}.test.ts` |
| F4 | The port itself — 709 files, 20 modules, 48 screens, 16 API routes | done | `4335eb8` · `scripts/port-rewrite-imports.mjs`, `npm run check:port` |
| F5 | One shell, fee tabs in the navigation map, fee routes reachable | done | `9c8f52d` · `DashboardShell` takes items; `money` group in `navigation.ts` |
| F5-fix | Production-only render failures and two pieces of stale copy | done | `9e743ed` · icons resolved client-side, the fee providers mounted, `public/` copied |
| F6 | Fee test data on `schoolfees-dev`, so the fee screens can be exercised at all | done | `scripts/replicate-live.mjs` · a de-identified replica of live: 11,295 rows, 34 tables, money exact to the rupee, every person replaced (D-186) |
| F7 | Timed accountant walkthrough against real fee configuration | done | Receipt SVP20260922-0002 posted through the desk; `current_staff_role()` falls back to `vppsone.staff_profiles` (D-191, migration `20260922100000`) |
| F13 | The Payment Desk broke on the first payment of each day | done | `cookies()` inside `unstable_cache()` from `getReceiptReversalTotals`, hidden by an early return that an empty day always took (D-192) |
| F14 | An over-long PostgREST URL is refused at once, not after eight seconds | done | `createGuardedFetch` on both admin clients (D-193) · `tests/guarded-fetch.test.ts` |
| F10 | The academic session was read by sorting the labels, in six places | done | `pickSessionLabel()` + `tests/active-session.test.ts` (D-187) · every register, mark and cover plan would have worked in the rehearsal session on live |
| F11 | A `.in()` list of more than ~300 ids fails silently after eight seconds | done | `platform/helpers/in-filter.ts` · the defaulters queue went 16,000ms to 880ms and stopped hiding four columns of data |
| F12 | The fee matviews had no grants in dev, so the Payment Desk 503ed for everybody | done | Mirrored from live, deliberately not a migration (D-189) |
| F8 | Decide what an installed VPPS One is, then switch the PWA on or delete it | done | `perf/installable-workspace` · [PR 39](https://github.com/veerpatta/vppsone/pull/39) · D-201/D-202 · Neutral installed workspace; browser-tested offline fallback, draft recovery and deliberate updates. See `docs/evidence/smoothness-2026-10-01.md`. Physical installation acceptance remains R8.3 |
| F8-fix | The proxy auth-redirected `manifest.webmanifest` and `offline.html` | done | `31c102a` ([#33](https://github.com/veerpatta/vppsone/pull/33)) · found by probing the deployed site; `src/proxy.ts` excludes them, and `branding/`, now |
| F9 | Merge and deploy | done | `cd4d1e2` ([#32](https://github.com/veerpatta/vppsone/pull/32)) and `31c102a` ([#33](https://github.com/veerpatta/vppsone/pull/33)) · live at `vppsone.vercel.app`, verified signed in |
| F9-fix | B-44: the administrator's home said 19 registers outstanding on a Sunday | done | `31c102a` · `schoolOpenToday` reaches `attention.ts`; `tests/attention.test.ts` |

### F6 is done, and what doing it uncovered

`schoolfees-dev` now carries a de-identified replica of the live fee database:
11,295 rows, 34 tables, the money exact to the rupee and every person replaced
(D-186). `npm run replica:load`, and `docs/replica-and-smoke.md` is the full
account.

Having fee data to reach the code with is what made the next three findings
possible, and none of them could have been seen without it:

- **The academic session was chosen by sorting the labels**, in six places
  including `resolveSessionLabel()` and its 92 callers (D-187). `TEST-2026-27`
  sorts above `2026-27`, and live has carried that rehearsal session for months
  — so on live every register, mark and cover plan would have worked in the
  rehearsal year, silently. Fixed, with `tests/active-session.test.ts`.
- **A `.in()` list over ~300 ids fails silently after eight seconds**, and the
  school has 583 active children. The defaulters queue took 16 seconds and hid
  four columns of data. Now 880ms. `platform/helpers/in-filter.ts`.
- **An accountant could not post a payment at all** (D-188). `has_permission()`
  reads `public.users`, and VPPS One accounts have no row there by design — so
  the RPC refused the cookie client and the service-role client alike. Sixteen
  of the eighteen fee RPCs are gated that way. **Fixed** (D-191):
  `current_staff_role()` now falls back to `vppsone.staff_profiles`, which the
  fee database was already prepared for — `public.staff_role` carries all eight
  VPPS One roles and `has_permission()` already had an arm for each.
- **The Payment Desk broke on the first payment of each day** (D-192), and only
  then: `cookies()` inside `unstable_cache()`, reached through an early return
  that an empty day always took. Fixing the `.in()` bug is what exposed it.

### What is verified, and what is not

**Verified.** `npm run check` green: typecheck, lint, 430-token theme parity,
the import codemod, 7,825 unit tests, production build. `npm run
smoke:workflows`: **42 of 42**, including the teacher attendance journey that
previous runs had only ever skipped because the day was a Sunday.
`npm run smoke:roles`: **728 of 728**, and for the first time that number
includes the 48 ported fee screens — the matrix could not see their guards
before. `npm run smoke:deep`: **921 cases** across all eleven accounts, zero
crashes, with per-screen timings.

**Seen in a browser on a production build.** As the QA teacher: Class 1, 39
children, 8 periods and the register waiting — the screen that read "आपकी कक्षा
—" with 0 children before the session fix. As the QA accountant: the Payment
Desk loading a real child with ₹58,500 across five instalments, ₹44,500 of it
overdue, masked name and phone throughout.

**Posting a payment is verified.** Receipt SVP20260922-0002, ₹7,500 cash,
posted through the Payment Desk as the QA accountant, `created_by` the real
person, the ledger moving ₹58,500 → ₹51,000, and the same `client_request_id`
sent twice producing exactly one receipt. Undo, late-fee waiver and repayment
plans were each asked of a role that may and a role that may not.

**Not verified.** Refunds, which need a refund request to exist first, and the
WhatsApp reminder run, which is deliberately disabled in this app.

### B-44 — the number that only appears at the weekend

The administrator's home read **19 registers outstanding, whose work: teachers**
on a Sunday. `registersOutstanding` was `classesTotal - submitted` with no
question about whether the school was open, so a day when nobody takes a
register counted every class as owing one. Wrong every weekend since R2.2, and
invisible because the arithmetic is right and the question is wrong.

D-101 is the same question in the nightly job, fixed there in 7.4. This was the
second copy of it. It was found by opening the deployed site, not by a test —
which is the argument for doing that at all.

**Not verified.** Every fee workflow (F6). The `accountant` and `fee_collector`
QA accounts are in the fixture list but have not been seeded, so neither role
has been signed in as — the fee screens above were read as `admin`. Physical
device, printer and WhatsApp paths are untouched, as before.

### Two things about the suite itself

`reuseExistingServer` is **false** now. It let Playwright attach to whatever
was already on 3100, including a server started before the build under test —
three specs "failed" that way, each waiting sixty seconds for an element that
was on the page, and the run took 17 minutes instead of 3. The same trap cost
a debugging session in D3. A failure that looks identical to a real one is
worse than a slow suite.

`tests/e2e/warm-server.ts` loads the heavy route module graphs before the first
test's clock starts. It was written for the wrong reason — the stale server was
the actual cause — but it is kept: after the port a cold signed-in render is a
real cost, and paying it once outside anybody's budget is cheaper than a longer
timeout in all 42.

### R0.1 — what it found

The parity register is complete: 14 SamPark rows and 12 School Fees rows now
carry source file, current state, destination, roles and owning phase, with
S-12–S-14 subfeatures named and their deferrals recorded.

Three findings change later tasks:

- **The fee app is at `vpps-one.vercel.app`.** `schoolfees.vercel.app` is a
  different company's product answering 200, and `sampark.vercel.app` errors.
  Both are now refused by `tests/app-origins.test.ts`, and the three real
  origins are re-checkable with `npm run verify:origins` (B-15).
- **There is no staff-reachable test origin for either sibling.** School Fees
  previews do run on schoolfees-dev but sit behind Vercel SSO; SamPark has no
  test deployment at all. R6.2 as written cannot be executed until somebody
  creates one — recorded as a gap, not worked around (B-16).
- **The QA teacher holds no class.** `qa.teacher@qa.vpps.local` has zero
  teaching assignments, so every "teacher" row in the 216-combination smoke is
  a result about an empty teacher. R0.2 has to fix the fixtures before any
  teacher workflow can be said to pass (B-17).

Also: B-06 is five screens, not one — `/collection`, `/assessments/[id]`,
`/timetable`, `/teach/attendance` and `/teach/register` all sort class labels
with `localeCompare` and all ignore the `sort_order` column that already
exists. Baseline for the R7.1 ratchet is **1,293.2 KB of client JS in 37 files**.

### R0.2 — what a working teacher fixture found in the first minute

Nine accounts now, from one list the seeder, the role smoke and `dev:login` all
read; three files used to keep their own copy. The two teaching accounts are
bound to teachers the **published timetable already knows**, chosen by rule
rather than by a name in the repository — most periods, ties by short name, and
the second must share no class with the first. On this data that is a primary
teacher (Classes 1–5, now class teacher of Class 1) and a secondary teacher
(Classes 6–12, now class teacher of Class 7).

Every write records its previous value in `vppsone.qa_undo`, so `qa:reset` puts
back rows the fixture did not create — which it has to, because binding a login
to an existing profile is the only way to give it a day. Proved by running it:
11 steps out, 11 steps back, database identical, then 11 steps out again with
the same two teachers.

**B-21, found and fixed the moment a teacher had a period to render.** The
Today card printed `timetable_slots.period` raw, and that column is 0-based —
so a teacher's first lesson of the day read "0" and her last read "7". Six
other screens each remembered to add one; this one, the screen she opens every
morning, did not. It had been shipping since Phase 3.1 and no test could reach
it, because the only teacher account had no periods at all. `periodNumber()` is
now the only place the off-by-one lives, and `tests/periods.test.ts` refuses
both shapes that caused it.

**B-20 raised, not fixed**: the same card lists 20 rows for an eight-period day,
because a parallel subject taught to five classes at once is five slots and
renders as five lines. The teacher is in one room. How a combined period should
read is R2.1's decision, not a patch in passing.

`dispatch()` now goes through a typed provider adapter. `MESSAGE_PROVIDER=mock`
decides from the destination's last digit — 5 slow, 6 timeout, 7 rate-limited,
8 server error, 9 duplicate with a stable id — and is refused on a live
deployment. Mocked sends carry a `mock:` prefix into
`message_sends.provider_message_id` so they can never be read as real ones.

Still open from this row: a 40-child class and a 1,205-row student list cannot
be fixtured from here, because the roster is the fee app's and rule 2 forbids
writing it (B-18).

### R0.3 — a third reading, and a smoke that can fail

`smoke:roles` was comparing two things that come from the same place: the
permission each page's guard names, and what the map says that implies. A page
asking for the wrong permission agrees with itself.
`tests/fixtures/role-expectations.ts` is the second opinion — 36 routes read
out of PLAN §3 by hand, each with the sentence it comes from. A screen
disagreeing with the map is a failure; the map disagreeing with the plan is a
**drift**, which has to be owned in that file by name or the run fails.

**B-22, found on the first run.** `view_only` holds `attendance:view`, so it
can open the register form, a class's roster, the corrections queue, the
monthly register and a child's card — every one an editable form or a list of
named children, which PLAN §3 gives the viewer neither of. It also puts a Teach
tab on a viewer's bar leading to an empty teacher workspace. Owned by R1.2,
which is where the role navigation lives; `smoke:roles -- --strict` is what
that task turns on when it is resolved.

The runner also fails now, which it could not before: a missing fixture is a
failure rather than a shrug, a hung case has a 20-second deadline, and a run
that executed fewer combinations than it set out to refuses to print a pass.
All three were tried against the broken state before being trusted.

**Two browser journeys** (`npm run smoke:workflows`, Playwright against a
production build). A teacher takes her register — all present, two exceptions,
save, reload, submit again, and the class disappears from Today — with every
step asserted against the rows rather than the toast. The office asks for a
number, finds the draft link answers 404 until it is opened, watches a
nine-digit number leave the Send button disabled with no row written, saves a
real one, re-answers it and sees the replacement in the review queue — the last
part in a browser context with no session at all.

The first teardown was wrong in a way worth keeping: it assumed the register
was the test's own. **A register for today already exists** — the
`open-registers` job opens one per class every morning — so the run left Class
1 submitted and the next one failed with "there is nothing to do today". It
snapshots and restores now.

**B-23 raised**: `Section` renders a bare `<section>` with an `<h2>` inside
and no `aria-labelledby`, so every landmark on every screen is unnamed.

### R1.1 — the way to the other two apps

`src/platform/config/apps.ts` is the registry PLAN §2 asks for: stable ids,
the names staff already use with what each app is *for*, the destination's own
environment, who is offered it, and an allow-list of paths. Two properties do
the work.

**Nothing else in `src/` may write a sibling hostname.** A test scans every
source file outside the two config files for a `vercel.app` host and fails on
a match, because two of the three a reader would guess are wrong and one is a
different company's product (B-15).

**No link carries an id across a dataset boundary.** This app is on
schoolfees-dev and both siblings are on live data, so a student link falls back
to the destination's own search screen instead of a URL that would 404 with a
child's name on it. It flips to a detail link the moment the two sides match,
and a test asserts both halves. SamPark never gets one in either direction: it
keeps its own text ids, and mapping them is R3.1's work (S-10).

`/apps` is guarded on a new `apps:view`, which admin and office hold. Every
card carries **its own** environment badge — both read "live data" while this
app's header reads "test" — because PLAN §2 is explicit that one badge must
not be read as covering all three. Each says a separate sign-in may be needed;
same Supabase project is not a shared cookie and SamPark is a different auth
stack. Ordinary links in the same tab, so Back works.

Both apps also sit on the office and admin home, above the list of screens,
with their hostnames printed.

Still true after this: **`/apps` is not on the office bottom bar.** Office may
open ten screens, the bar holds five, and the shared order leads with Teach and
Cover — which is B-04, and R1.2 owns it. The More hub and the home shortcut
cover it meanwhile.

### R1.2 — where each role starts, and what its thumb reaches first

`homeFor(role)` gives a teacher `/teach` and everybody else `/dashboard`, and
it is applied at every landing: `/`, both login doors, `/auth/confirm`, the
school-name link and the Go home button. `admitSignedInUser()` hands the role
back with the admission, because the fallback can only be resolved once the
profile is known and reading it twice is two chances to disagree. A teacher
signing in now lands on her day with the register as the first thing on the
screen; before this she landed on a card showing her own email address (B-03).

**B-04 closed.** One shared order gave every role Home, Teach, Cover,
Timetable, Exams — so the office reached SamPark through More, behind three
screens it does not use, and R1.1's Apps tab never appeared on its bar at all.
`NAV_PRIORITY` is an ordered row per role following PLAN §3's navigation
column. Where a screen the plan names does not exist yet the row is simply
shorter; nothing is invented to fill a gap.

**B-22 closed.** `view_only` held `attendance:view`, which guards six screens
that are each an editable form or a list of named children — neither of which
PLAN §3 gives that role. The permission is gone; the attendance *figures* the
plan does promise it are a count on its own Home, read under `dashboard:view`.
So `npm run smoke:roles` runs with `--strict` now, and passes: **222 of 222 as
expected, 0 drift**. The permission map, the guards and the plan agree for the
first time.

The desktop sidebar shows **everything** a role may open, in three groups in
the order a day runs — today's work, records, setup — with no More on it,
because nothing is hidden and a hub listing what did not fit would be empty.
Nine screens for the office against the four-plus-More the phone shows.

Two independently written fixtures needed updating, which is them working:
`permissions.test.ts`'s expected set for the viewer, and `navigation.test.ts`'s
two order-sensitive assertions, now set comparisons with the order asserted by
new cases. `differenceIn()` was split out of `differenceFor()` so the drift
mechanism stays tested against a made-up expectation now the live list is
empty — a test that only exercised real rows would stop running the day the
last one was fixed.

### R1.3 — a title is text somebody typed, and a class list is in school order

**B-05 and B-14 were holding each other up.** Both title columns were NOT
NULL, so a Hindi school typed every request title twice — and all four screens
that rendered one did `language === "en" ? titleEn : titleHi`, which is a
blank title the moment only one half exists. Migration `20260917110132` makes
one half enough and checks that one survives; `readAuthored()` decides what a
reader sees **and whether it fell back**; `AuthoredText` is the one component
all four sites use. The fallback is visible — a Hindi reader gets "in English"
beside an English title — because hiding it is how somebody decides the app is
half-translated and stops trusting the rest.

**B-06 closed.** The order already existed on both tables and was being thrown
away by `[...map.entries()].sort(byLabel)`. `classLabelMap()` is built in
school order now, so three screens simply stopped sorting and the fourth — a
teacher's own classes, a subset — ranks against it. A test scans every source
file for the two shapes that caused it. **Correction to R0.1: four screens, not
five.** `/timetable` sorts staff names, which is right.

**Self-service language** (PLAN §3a). `/preferences` writes one column on the
row belonging to whoever is asking, found by their own `user_id` — no id in the
form to tamper with. Each option is written in its own language, because
somebody on a screen they cannot read needs to recognise the word for theirs.
It sits in the top bar beside sign-out: both are about the person, a teacher's
bar is already full so More is not a tab she has, and this is the one setting
somebody may need *because* they cannot read the screen they are on.

**B-23 closed**: `Section` names its landmark from its own heading, and `Field`
gained a hint slot above the control rather than below it.

**The phone baseline found the smallest target in the app.** Six screens at
360/390/430px, checking no horizontal scroll and no target under 44px. The
first run failed on `← मेरा दिन` at **20px** — the `PageHeader` back link, on
the screen a teacher opens most, reached with a thumb while holding a register.
It is 44px now. The check's first version also failed every form, and that was
the check being wrong: a checkbox is 20px inside a 48px row that is the target.

One fixture bug worth keeping: eighteen cases signing in individually asked
Supabase for eighteen one-time links in a minute, got rate-limited, and the
refusal read exactly like a permission bug. One session per account now,
except for the tests that are about signing in.

Client JS is **1,309.9 KB in 39 files** against R0.1's 1,293.2 KB — +1.3 %,
inside the R7.1 ratchet.

### R2.1 — the teacher day, with one thing to do next

**B-20 closed.** The Today card listed one row per timetable slot, so a subject
taught to five classes at once rendered as five lines and a teacher saw **20
entries for an eight-period day**, told she was in five rooms. `lessonsToday()`
groups by period *and subject*: a combined lesson is one row carrying its
classes, and two different subjects in one period stay two rows because that is
a clash worth seeing. The QA teacher Thursday now reads 8 rows.

`nextAction()` plus `TaskHero` give PLAN section 1 its "one prominent next
action": the first outstanding register, with the roll count that makes it
concrete — "Class 1 में 15 बच्चे" — as the only accent-coloured block on the
screen. **When everything is in there is no hero at all**; no fallback task is
invented, because a made-up action is how the card stops being believed.

Metric cards show only what can be read honestly: classes held, merged lessons,
cover duties, corrections. A **dash, not a nought**, when no timetable is
published — "there is none" and "you are free" are different news. The design
package also shows Open requests and Records to check; neither is rendered,
because the teacher request inbox is R3.3 and records are a permission a teacher
does not hold. Lesson *times* are absent too: there is no bell schedule in this
database (D-61), so periods are numbered rather than given plausible clock
times.

The classless teacher was checked as well: no hero, a dash for classes with the
reason under it, 0 periods (correct — the timetable is published and she has
none), and her one cover duty as the only thing on her day.

One bug made and removed: `classRoll(classId, sessionLabel)` is two strings in a
row, I passed them backwards, TypeScript said nothing, and the teacher screen
rendered an error card. The signature takes a named object now, at all seven
call sites.

The visual reference was the design package another agent left at `docs/design/`
— followed for layout, and **not** followed where a card would need data this
app does not have. It is untracked by the user decision and is not committed.

### R2.2 — exceptions with counts and owners

`/dashboard` was a profile card and a list of links, identical for six roles,
since Phase 1.2 (B-03). It is now each role queue, in the order that role works:
admin gets registers, absences, review, corrections and failed jobs; office
leads with its own review and corrections; the academic coordinator gets
absences first.

**The owner is the load-bearing half.** A number with no name beside it is
somebody else problem to everybody who reads it, and the register that has not
come in belongs to a teacher rather than to whoever has the dashboard open.

Three empty queues are deliberate. The exam coordinator gets none because
incomplete papers and report readiness have no cheap count yet and an empty
queue is honest where a wrong one is not (R5.3 owns it). A teacher gets none
because her exceptions are already the top of `/teach`. The viewer gets figures
instead — 139 children, 19 classes, 0 registers in of 19 — because PLAN section
3 gives that role read-only information and no per-child actions.

**Unavailable is not zero.** Each count is read individually; a failure comes
back null, renders a dash, and says the count could not be read — and still
counts as needing attention, because nobody knows that it does not. D-93 is why:
a swallowed query error once reported "19 classes have no class teacher", and
on a dashboard that same mistake tells an administrator the school has nothing
outstanding.

One density fix found by looking rather than by reading: the owner line used
`flat()`, so a bilingual reader got both halves and it truncated to nothing
useful on a 360px phone. It is `primary()` now.

Not built here and named rather than faked: no fee summary (a school-wide fee
figure is a new read whose reconciliation rules R6 is still settling, and an
unreconciled number is exactly the ₹0-instead-of-unavailable the design package
warns about), no student search box (the directory is R2.3, and a field posting
to a route that does not exist is a dead control), and no uncovered-period
count (that needs the planner own context; the card sends the coordinator to
`/substitutions`, where the real figure is).

### R2.3 — a real directory, and where each value came from

`/students` is the searchable roster PLAN section 3a asks for, in place of
reaching a child through whichever register they happen to be on. A plain GET
form with every filter in the URL, so Back works, a bookmark works and a pasted
link opens the same list for whoever receives it — and the screen ships no
JavaScript of its own. Scope, search, count and paging all happen in Postgres:
the staff list is a few dozen and ships whole (D-29), but the roster will be a
few thousand and PostgREST truncates at a thousand with no error (D-62).

It is guarded on a new `students:view` that only admin and office hold, and it
is now **second on the office bar** — मुख्य · विद्यार्थी · जानकारी · ऐप · और —
which is PLAN section 3 office row exactly, for the first time.

**A search bug the browser found.** Three kinds of thing get typed into a
school search box and `queryKind()` tells them apart: a bare number is an exact
admission number, ten digits is a phone, anything else is a label. The first
version searched labels against names only — and **this school issues
alphanumeric SR numbers**, so pasting `TEST-CL6-002` from a spreadsheet
searched names, found nothing, and read as "that child is not here". The loose
branch searches `admission_no` too now, with a test that reads the repo query
back so the rule cannot be dropped.

**Source labels (S-10).** Each accepted value now carries a badge saying where
it came from — a teacher, the office, an import — because an approved human
correction and an imported figure look identical once they are both text on a
card, and which one it is decides whether somebody rings the parent to check. A
source the app has never heard of renders as itself rather than being forced
into one of the three.

**The fee link finally has a caller.** R1.1 built the context builder and
nothing used it. The student page now emits
`/protected/students?query=<SR>` — a *search* link carrying the SR, not a deep
link carrying a dev UUID that means nothing in the fee app live database — and
the button says "Find this child" rather than "Open this child" (D-122).

Named rather than half-done: the detail screen stays at `/teach/student/[id]`
until R4.1 moves it with an alias (one record, not two); search is not
transliteration-aware, so "Meera" does not find "मीरा", which needs a stored
transliteration or a Postgres extension rather than a tweak.

### R3.1 — a question asked on Monday is still Monday's question

A request's roll and its prefilled values were re-read from `enrolments` and
`student_records` **every time the link was opened**. So a child moved between
classes after a link went out stopped being on it, and an office correction
changed what "the number we hold" meant on the review screen — the teacher is
shown one thing, answers it, and the queue compares her answer against
something she never saw. Neither reads as an error. Both look exactly like
working software. That is B-07, and S-02 is the behaviour it is missing.

`vppsone.collection_request_members` is the fix: who was asked, their roll
number, and `snapshot jsonb` — the prefilled values exactly as sent, written
once by `freezeMembers()` at creation and **never re-derived**. Alongside it,
the additive round schema (`collection_rounds`, `round_id`,
`audience_kind`/`audience_label`, sent/reminded/archived columns) and
`audience.ts` for what an audience is.

The workflow test is the point. It creates a request through the form, opens
the link, then **moves a child to another class and corrects a value** while
the link is live, and asserts the page did not notice. That would pass against
code that never froze anything — so it then deletes the member rows and
reloads, which is the legacy path `rollForRequest` still takes, and asserts
the roll shrinks and the correction leaks through. The defect is reproduced on
demand thirty lines below the fix that closes it (D-147).

Two defects found while building it. Adding `sent_by` and `reminded_by` gave
`collection_requests` a **third** foreign key to `staff_profiles`, which made
the unnamed PostgREST embed ambiguous and threw on every `/collection` screen
for every role (B-26). `tests/embeds.test.ts` exists to catch exactly that and
stayed green, because it read foreign keys out of `create table` blocks only —
a table gains most of its later references by `alter table`, which made the
check strongest on the day a table was written and blind ever after (D-148).
And `tests/directory.test.ts` measured source within a character window
against a file checked out CRLF, so it passed in CI and failed locally (B-27).

The first version of the freeze test used `mother_phone` and passed — and
would have passed against any code at all, because a collect field prefills
nothing and the assertion was about the absence of something never rendered
(D-149). It uses `guardian_phone` now, where what the school holds is text on
the screen.

Named rather than half-done: **no screen creates a round.** `collection_rounds`
exists and is empty; the wizard is R3.2 and the fan-out is R3.3, so a request
made today is a single class that carries `audience_kind = 'class'` and
freezes its members — the whole of B-07 and none of B-02. `ask_note`,
`reminder_count`, `archived_at` and `token_rotated_at` are columns with no
writer, here because this is the additive migration. `external_student_ids`
gives SamPark links a mapping to use (S-10) and nothing populates it, so the
link still degrades to search — a missing row now rather than a missing
mechanism (D-146).

### R3.2 — see who a round reaches before you make it

R3.1 gave a round a table and no way to make one. This is the screen, and the
count on it is the whole point: `/collection/rounds/new` is **two forms on one
page** — a `GET` that only changes the URL, and a `POST` that carries the same
selection as hidden fields. So the number the office reads is a server render
of the real resolver, not arithmetic the browser did on what it happened to
have loaded. The day those are two code paths is the day a preview says nine
and the round covers eleven.

It also ships no JavaScript of its own. Ticking a class is a page load — slower
than a click, and it works on the connection this is actually opened on, with
Back and a shareable URL thrown in (D-139).

`gaps.ts` is what "missing" means, in one place. **Blank is missing; wrong is
not** — a nine-digit phone number is a different problem from no phone number,
and rolling them together puts a child the office must fix itself onto a
teacher's list. And **two gaps mean both**, the smaller set, so the sentence
shown to the teacher says "and" rather than "or" (D-152).

The ask list is for the case no filter can find: thirty-five families whose
number is on record and is not a WhatsApp number. Ported from SamPark reading
**CSV** rather than `.xlsx` — `SOURCES.md` records that `excel.ts` was not
ported, and a spreadsheet library to parse a file Excel already exports is a
dependency bought for nothing. The BOM is kept, because without it Excel opens
the Hindi notes column as mojibake. **What did not match is the point**: the
upload is two steps and the first creates nothing, so every non-blank row comes
back matched or named by the row number Excel shows down the left.

Four defects found by looking, one of them by reading the resolver rather
than by any failing test: a round carrying an explicit list still had the gap
filters applied on top of it, so a list frozen from a gap selection and
re-resolved after those gaps were filled would quietly cover fewer children
than it was frozen with (B-33, D-158). Nothing would have failed loudly — the
failure is a *smaller* number, and every screen renders that without
complaint. The journey now builds exactly that shape and fails without the fix.

The count line read **"1 कक्षाओं में"** — a
plural Hindi noun on a singular number, obvious to every Hindi speaker in the
school and invisible to anybody reviewing in English, which is exactly why it
shipped (B-28, D-153). The phone baseline caught a **16px link** on the
builder, the same defect class as B-24 (B-29). And the match report ran
together as text — "पंक्ति 4NOPE-404Somebody Missing" — because a margin
separates pixels and a screen reader reads the text (B-30).

Named rather than half-done: **a round mints no links.** The fan-out, the
recipients and the master link are R3.3, and the round page says so rather than
showing an empty list somebody reads as a failure. **House and route audiences
are resolvable and not offered**: both columns are empty on schoolfees-dev — 0
of 139 — and rule 2 forbids filling them, so chips for a filter that could only
return nobody would be a lie (B-31). Nothing holds house or route *ownership*
either, so such a round would have no recipient to fan out to (B-32). The
audience carries `search` and the builder has no box for it yet.

### R3.3 — one round becomes nineteen links, and says who it cannot reach

R3.2 could write a round down and minted nothing. This is the fan-out.

**B-32 had to go first.** `class_teachers` covered classes and nothing covered
a house or a bus route, so a house round resolved to children and then had
nowhere to send them. `vppsone.staff_scopes` is that fact, normalised —
classes deliberately stay where they are, because `class_teachers` carries
handover dates a bus route in-charge does not need and a route does not want
four columns that mean nothing to it (D-159).

A link sent to the wrong teacher is a group that never gets collected and
nobody notices until the due date, so there are **three outcomes and none of
them is a guess**: one owner, more than one, or nobody. Two owners is a choice
for this round rather than a mistake to clean up — both people really do hold
it. A teacher with no number blocks the group as well, caught in the plan
rather than at insert, because a link nobody can be sent is a roster frozen for
nothing (D-160).

**Who gets left out is first class.** House is recorded for about a third of a
school, so grouping a house-wise send by house silently drops every child with
no house — exactly the children whose records are thinnest. `unassigned` comes
back beside the groups rather than being inferred from two totals disagreeing,
and both lists are stated before anything is created (D-161).

That produced **B-34**: the first version labelled the skipped total "in no
group", but skipped is blocked *plus* unassigned, and a child in a class whose
teacher has no number is very much in a group. It reads "N children no link
would reach" now.

**The fan-out is not one transaction, deliberately.** Per-link atomicity is
kept, but if link seven of eleven fails the first six stay: six live tokens
with frozen rosters are six classes the office can send to right now, and
deleting them to satisfy an all-or-nothing aesthetic destroys real work. There
is **no separate resume path** — a resume *is* "create the groups that are not
there yet", so it is the only path, and the half that runs after a failure is
the same code that ran before it (D-162).

Exercised in the browser over three classes chosen for three outcomes: Nursery
(6) and JKG (4) got links, Class 1 (15) got none because its teacher has no
number and was named as held up, and the master link froze exactly the 10 the
class links cover between them. Pressing it again created nothing; the tokens
answered 404 while draft and 200 once opened, to a browser with no session.

Named rather than half-done: **nothing is sent** — the board records what the
office did in WhatsApp itself (D-10). There is no per-group override for a
blocked group yet, so the office fixes it in the staff record (B-35). House and
route rounds remain undemonstrable on dev data (B-31). Two rounds asking the
same class for the same field make two links and nothing reconciles them; that
is R3.4.

### R3.4 (part 1) — the queue says when the record moved

Two failures that look like nothing on screen. A **stale** answer renders as an
ordinary row with a reasonable value in it, and accepting it silently reverts a
correction somebody made on purpose (S-07). A **superseded** one renders as a
*second* ordinary row, and the office adjudicates a question it cannot see the
shape of — which is the ordinary case, not an edge: the office asks in April,
half come back, and it asks the stragglers again in June.

`precedence.ts` answers both, compared against the **frozen** value the
submission carries rather than one re-read now — re-reading is the bug freezing
exists to remove (D-164). The earlier answer is *marked*, never deleted: "what
did she say in April" is a real question when June's answer looks wrong, and an
accepted row is never superseded at all, because rewriting a decision makes the
audit trail a record of what the app thinks rather than of what anybody did
(D-165).

**B-37 came out of building the scenario and looking at it.** The first version
read "what is held now" from `student_records` only, with a comment claiming
that avoided flagging everything — it did the opposite. A value the teacher was
shown that came from the *fee column* has no `student_records` row, so "no row"
was indistinguishable from "the value was cleared" and every such answer was
called stale: four flags on four pending rows. The read now follows the same
precedence the link used, and the rule now requires something to conflict with
— "shown a number, hold nothing now" is a hole to fill, not a correction to
revert (D-166).

The queue also shows the **group** the answer was asked of rather than the
class on the request row, because a house link has no class and would print a
dash on every one.

**R3.4 is not finished.** Still owed: the mock message retry the R0.2 provider
outcomes exist to exercise, the S-01–S-09 acceptance pass, and wiring the
long-existing `mayReplace()` into the accept path — nothing imports yet, so it
cannot currently be wrong, but it is not wired.

### D0 — the atlas is an evolution of what is running

`docs/design/` arrived mid-R3. The delta audit is
`docs/evidence/D0-2026-09-17.md`, and its finding is the useful part: the
palette, the primitives, the role-priority bar, the grouped sidebar, the app
registry, the per-account language and the 44px baseline were **already
there**, from R1.1–R1.3 and R2.1. No token migration, no second component set,
no dependency change. Three things were genuinely missing, which is why this
delivery is small.

Everything that belongs to another repository or a later R row is listed there
by name rather than half-built here: the fee screens are
`veerpatta/schoolfees`, the teacher request cards are R3.3's inbox, photo
progress is R4.2, exam readiness is R5.3, fee figures are R6.

### D1 and D2 — where each account starts, and what it opens on

**Accounts staff start in School Fees, and no account became an accountant.**
The design package warns twice against the obvious implementation — "do not
silently turn `office` into `accountant`", "never derive account type from an
email, a menu label, or a mock query parameter" — and it is right: half the
office are not in accounts. So `staff_profiles.preferred_start` is an explicit
choice the person makes about themselves on `/preferences`, offering only what
`allowedFor(role)` and the app registry already allow. Choosing School Fees
opens a door that was already on the Apps hub; the fee app still decides what
happens on the other side of it (D-168). A stored value is re-resolved on every
read, so a role change takes the landing away with the permission instead of
leaving somebody at `/access-denied` every morning (D-169). Observed: a fresh
magic link for an office account with the preference set answers `307` to
`https://vpps-one.vercel.app/protected/dashboard` — the registry's verified
origin, not a guess.

**A teacher opens her own class and day.** `/teach` was already her Home; it
now names the class in the heading, counts the children on her roll rather than
the number of classes she holds, names the day's first lesson, and puts the
timetable in a column beside the work on a desk instead of four sections below
it. **"First lesson", not "next"** — there is no bell schedule in this database
(D-173), and the atlas's "09:10" is a picture of a fictional school.

**An administrator opens the combined overview.** Attendance, staff, cover and
exams as fractions beside the exception queue, plus the current information
round and the two sibling apps as desks. The profile card is gone from that one
home: a screen about the school should not open with a card about the person
reading it.

**The fee line carries no amount.** VPPS One reads no fee totals until R6, so
the card says the figures are not read here and names the app that holds them.
A zero would be a number an administrator could act on and it would be wrong
every day (D-172); a test asserts no rupee symbol can reach that screen. Every
other count on the screen is `number | null`, and a read that failed renders a
dash with a reason and no bar — the D-93 rule, applied to five more figures.

**Three defects, two of them found by looking rather than by testing.**

- **B-38.** `/auth/confirm` did `url.pathname = sanitizeRedirectPath(next)`,
  and the `URL.pathname` setter percent-encodes a `?`. Every magic link whose
  deep link carried query parameters — which is every link into a register, a
  class or a filtered directory — landed on `/teach/attendance%3Fclass=…`,
  a path that does not exist. Found while checking that a deep link still beats
  the new start screen.
- **B-39.** `sanitizeRedirectPath` refused `//host` and not `/\host`, which URL
  parsing for http(s) treats identically. It was not exploitable only because
  that one caller encoded it — so fixing B-38 would have turned the sign-in
  door into an open redirect. `isSafeInternalPath()` refuses a backslash
  anywhere and any control character (D-171).
- **B-40 and B-41 are one defect seen twice.** `fan-out.spec.ts` measured
  58.2 s against the suite's 60 s default, so the same build passed and failed
  on consecutive runs; confirmed pre-existing against `main`, and its ceiling
  was raised. That did not fix the run — `collection-freeze.spec.ts` failed
  next, on a page this branch does not touch, and the accessibility snapshot in
  its failure report showed `/collection` full of titles hours old.

  Three specs ended with `delete from collection_rounds` under a comment saying
  it cascaded to the round's links. It does not: `round_id` is
  `ON DELETE SET NULL`, which is right for the app — archiving a round must not
  destroy answers a teacher already sent — and wrong for a teardown. Every
  fan-out run left **three live requests** behind on the database three
  journeys share, `listRequests()` reads them all with a query per row, and the
  whole suite had been getting slower for a fortnight.

  `removeRound()` deletes the links first; 34 leftovers were removed from dev.
  The suite went from **12.4 minutes with a failure to 1.8 minutes, 42 of 42**,
  and `fan-out` from 58.2 s to 10.6 s. The raised ceiling stays on that one
  journey; the suite default is left alone, because it is what catches the next
  test that starts taking a minute.

Preserved and checked: office, coordinator and viewer homes unchanged;
`smoke:roles -- --strict` 258 of 258, 0 drift; every new string a Hindi/English
pair; no horizontal overflow and no sub-44px control at 320 and 360.

**Evidence gaps, named.** The populated information-round card was not seen
against real data — the only round on dev is a draft over a class with no class
teacher, so no link can be minted for it. The fee destination is asserted from
the `Location` header and never opened, because it is the school's live fee
app. Physical devices and the full D4 state matrix remain R8.3's and R7.2's.

### D3 — the atlas is one composition, applied

Opening the atlas's `students`, `staff`, `attendance`, `review`, `cover`,
`setup` and `reports` side by side, they are **one** composition: a white card
whose head carries a title and a line of context, and whose body is a list of
rows separated by hairlines rather than by gaps. The role homes had it by hand;
every other screen had a stack of separately-bordered cards, which is a
different density and reads as a different product.

So this pass is mostly one component. `Panel`, `PanelRow`, `FootNote`,
`RowAction` and `StateCard` in `src/ui/panel.tsx` and `src/ui/states/`, plus
the page eyebrow on all 37 remaining headings, applied by route area.

Converted: the directory, the staff list (with four real figures above it), the
register, the teacher's day, all five role homes, collection, rounds,
assessments, the academics hub (two columns now), More, and a teacher's own
token page. The state boundaries became the atlas's "every state has a next
step" — a symbol, a sentence, and a way back to *this role's* Home.

**Left as cards on purpose**: review, cover, the rounds board, jobs,
corrections, policies and the form screens. The atlas draws those as cards too
— a review row is a before/after diff with a decision form in it, a cover row
carries its candidates. `PanelRow` is for a row that fits on a row, and forcing
these into one would delete the content that makes them worth opening.

**The register's live counts stay in the form.** The atlas puts Present/Absent/
Late/Excused in the supporting column; those are client state the offline queue
owns, and the queue is the last part of this app worth destabilising for a
layout. The column carries the guidance card instead.

**Two defects of my own, both caught by one existing test.**

**B-42.** The first `Panel` rendered its rows as `<div>`s — which is what the
markup looked like it needed, and which makes a register fifteen unrelated
paragraphs to a screen reader. `teacher-attendance.spec.ts` counts
`getByRole("listitem")` and found 0 of 15. `Panel` is a `<ul>` now and
`PanelRow` an `<li>`, with the link inside the item rather than being it.

**B-43, the worse one.** The register's aside — "mark the exceptions first" —
is there while the register is open and gone once it locks, and `HomeColumns`
returned a bare fragment with no aside and a grid with one. Two different
element types at the main column's position, so **pressing Save remounted the
register form** and its client state went with it: the "Saved" acknowledgement
a teacher had just earned never appeared. Nothing was lost — the row was
written and the queue is in storage — the screen simply stopped saying so,
which on that screen is most of the point. The wrapper is one `div` now
whatever the aside does.

Worth remembering as a *shape* of bug: a layout component that returns a
different tree depending on a prop remounts its children when that prop flips,
and the damage lands in whatever client state was underneath.

Two process notes from chasing them. The re-run after the B-42 fix **also**
failed, against a preview server still holding the previous build because
Playwright reused one this session had started — rebuild *and* restart before
believing a workflow result. And a cold `next start` answers the first
`/teach` in **28 seconds** against 0.3–4.6 warm, which is enough on its own to
blow a 60-second test budget.

Dependencies naming a whole phase mean all its required rows. Default order is
the plan sequence; after recording a concrete blocker, independent ready rows
may proceed. Every done row needs branch, delivery commit, evidence and remaining
limitations. Add fix rows rather than deleting historical records.

## Original implementation history

## Phase 0 — setup (done by Janmejay + Claude, 2026-09-16)

| # | What | Status |
|---|---|---|
| 0.1 | Repo `veerpatta/vppsone` created, private | done |
| 0.2 | Next.js 16 app scaffolded, Supabase + zod installed | done |
| 0.3 | Vercel project linked, env vars set to schoolfees-dev | done |
| 0.4 | Plan, rules and sources written | done |

### Applied to schoolfees-dev

Migrations are applied through the Supabase MCP, and the file is named for the
version the MCP recorded (D-22), so this list and
`supabase_migrations.schema_migrations` agree.

| Version | File | Task |
|---|---|---|
| 20260917093746 | `create_qa_fixture_runs` | R0.2 |
| 20260917110132 | `collection_request_title_is_authored` | R1.3 |
| 20260916191746 | `create_vppsone_schema` | 1.1 |
| 20260916191757 | `create_staff_profiles` | 1.1 |
| 20260916191935 | `expose_vppsone_to_postgrest` | 1.1 |
| 20260916201212 | `create_subjects_and_class_aliases` | 1.4 |
| 20260916202429 | `staff_language_allows_bilingual` | 1.7 |
| 20260916204801 | `create_class_teachers_and_calendar` | 1.5 |
| 20260916205631 | `create_enrolments` | 1.6 |
| 20260916210606 | `create_timetable_versions_and_slots` | 2.2–2.3 |
| 20260917021218 | `create_attendance_and_notes` | 3.1–3.6 |
| 20260917025818 | `create_substitutions` | 4.1–4.4 |
| 20260917033652 | `create_collection` | 5.1–5.4 |
| 20260917033722 | `create_vppsone_documents_bucket` | 5.3 |
| 20260917041039 | `create_assessments` | 6.1–6.5 |
| 20260917051014 | `create_jobs` | 7.1 |
| 20260917051208 | `create_job_message_templates` | 7.2 |
| 20260917093746 | `create_qa_fixture_runs` | R0.2 |

## Phase 1 — foundation

| # | What | Status | Branch | Commit | Notes |
|---|---|---|---|---|---|
| 1.1 | Supabase clients, Auth, login, middleware, `vppsone` schema, `staff_role`, `staff_profiles`, permissions | done | `p1-1-foundation` | `50f674d` ([#1](https://github.com/veerpatta/vppsone/pull/1)) | Creating the schema was not enough — PostgREST answered `PGRST106 Invalid schema: vppsone` until it was exposed, so that is now its own migration (D-19). A proxy that bounced any signed-in visitor off `/login` looped forever against a session whose profile was deactivated; the login page decides that now, from the profile rather than the JWT (D-23). The env badge and a bare `/dashboard` exist but the shell is 1.2's; `requirePermission()` throws rather than rendering an error screen until 1.2 gives it one |
| 1.2 | App shell: mobile layout, bottom nav, top bar, tokens, env badge | done | `p1-2-shell` | | Ledger Calm tokens ported from the fee app into Tailwind v4 `@theme`. Signed-in screens live under `src/app/(app)/` so the guard is structural. Nav is derived from `can()`, and each item carries a `ready` flag with a test that it matches a real page file — the phase ships over several deploys and a tab without a route is a 404 with the school on it. `requirePermission()` now redirects to `/access-denied`; actions use `assertPermission()`, which throws, because `redirect()` in an action is a thrown signal a try/catch would swallow |
| 1.3 | Master data — staff | done | `p1-3-staff` | | List with client-side search (a few dozen staff, so the whole list ships once and search works in a corridor), create, edit, deactivate. `short_name` is disabled in the edit form, absent from the update schema, and refused by the action — three layers over the database trigger. Phone numbers normalise to ten digits and refuse anything not starting 6–9 rather than guessing. Nobody can deactivate themselves |
| 1.4 | Master data — subjects, class aliases | done | `p1-4-subjects-classes` | | Subjects with an immutable code, and a per-class label editor where each row saves itself (nineteen classes, filled in over more than one sitting). **The fee app.s RLS gates `public.classes` on its own `public.users.role`, so the cookie client reads zero rows and no error** — fee reads now go through the service-role client after `assertPermission`, since rule 2 forbids adding a policy there (D-32). `orphanedAliases()` is what notices a class that has gone, because no FK points into `public` |
| 1.5 | Master data — class teachers, academic calendar | done | `p1-5-class-teachers-calendar` | | Class teachers are replaced, never edited: a handover closes the outgoing row on the day *before* the new one starts, and a partial unique index allows exactly one open row per class. The calendar stores only the days that are not ordinary — a few dozen rows, not 365 — and a range is expanded to one row per day so "is school open on the 14th" stays a lookup. **`exam` and `event` keep school open but stop the timetable**, which is the distinction that decides whether a register is taken (D-39) |
| 1.6 | Enrolments from `public.students` + consistency check | done | `p1-6-enrolments` | | One row per child per session, because `public.students` holds only today and an academic record needs history. No FK can point into `public` (rule 2), so the screen is the enforcement: it reconciles both sides on every load and names five kinds of difference. A vanished student is the one a rebuild will not resolve — their attendance and marks are here — so the row is kept for a person (D-43) |
| 1.7 | Per-account language: Hindi / English / Bilingual | done | `p1-7-language` | | Janmejay's call mid-phase: the app was hard-coded bilingual, which made every label twice as long for everyone and gave nobody the screen they wanted. Strings are now pairs in `src/messages/`, rendered per reader (PLAN §3a, D-35). Validation messages ride through Zod as JSON because the domain cannot know who is reading. The login screen uses a device cookie, since signed out there is no profile (D-36). `raj@vpps.co.in` is `en` |

## Phase 2 — timetable

| # | What | Status | Branch | Commit | Notes |
|---|---|---|---|---|---|
| 2.1 | Parser port from `timetable2025/scripts/data.js` + fixture tests | done | `p2-1-parser` | | Ported with behaviour intact; every count SOURCES.md pins matched on the first run — 768 cells, 30 parallel, 60 shared, 19 teachers, 23 subjects. Two deliberate changes: the parser now reports *problems* (short row, duplicate class, unclosed bracket, empty brackets) because 2.2 has to show the school what is wrong before anybody publishes, and `SHORT_SUBJECTS` is not ported at all — it belongs at render, and applying it at parse produces labels matching no subject row |
| 2.2 | Import dry run, resolve against master data | done | `p2-1-parser` | | Resolves every cell against the 1.3/1.4 master data and groups what is missing **by the screen that fixes it**. Keeps going after the first unknown name — a run that stopped would make the school fix one, re-upload, and find the next, nineteen times. An unmapped class is reported once rather than also reporting its eight subjects |
| 2.3 | Versions: upload → check → draft → publish | done | `p2-1-parser` | | A partial unique index allows exactly one published version per session; publish archives the old one **first**, because the other order is refused by that index. `teaching_assignments` is regenerated last, so an interruption leaves stale assignments (visible, fixable) rather than assignments for a timetable that is not live |
| 2.4 | Views: class / teacher / day / free | done | `p2-1-parser` | | Four grids, filtered in the browser over the whole published timetable. `freeTeachers()` takes the whole roster rather than deriving it from the timetable — somebody with no periods is the *most* free, which is the bug the old planner needed a hard-coded reserve list to work around. A clash is one teacher in two different *subjects*; a combined class is not a clash |

## Phase 3 — teacher workspace

| # | What | Status | Branch | Commit | Notes |
|---|---|---|---|---|---|
| 3.1 | `/teach` shell + Today | done | `p3-teacher-workspace` | | The card answers one question above the fold — is there anything I have not done. It names **three kinds of nothing** (school closed, no class of your own, everything already in), because a card that counts rows renders all three as an empty box and only one means "you are finished" (D-59). Today's periods come from the published timetable, matched to the sheet's own day header rather than to `=== "Monday"`: a retyped block would otherwise silently show a teacher a free day |
| 3.2 | Attendance screen | done | `p3-teacher-workspace` | | Four big targets per child, not a dropdown — forty children are marked standing up. Every tap goes straight to `localStorage`; the flush is **one request for the whole register**, so a signal drop cannot half-mark a class; and the upsert on `(register, student)` makes a second submit produce the same rows. Verified against dev: two submits → 1 register, 14 marks. The queue is a `useSyncExternalStore` external store rather than component state (D-57) |
| 3.3 | Corrections + office on-behalf | done | `p3-teacher-workspace` | | A submitted register is a record: changing a mark carries a reason and two names. **Nobody approves their own** — with one approver that means a request can sit, which is the right failure. The mark is rewritten *after* the request is marked approved, so an interruption leaves an approved request with an unchanged mark (visible, fixable) rather than a changed mark nobody signed. `on_behalf_of` names the teacher stood in for, never the person pressing the button (D-54) |
| 3.4 | Notes | done | `p3-teacher-workspace` | | Per student and per class, typed by the six seeded `note_kinds`. Kind first, text second — the order the register margin already uses — so a note is findable by what it was about. Remove is your own only, enforced in the query rather than checked beforehand, so a tampered id cannot reach somebody else's note |
| 3.5 | Student card | done | `p3-teacher-workspace` | | Attendance % (late counts as present, approved leave leaves the denominator), notes, and the fee standing read from the fee app's **own** `v_student_directory` — VPPS One does not model fees and must not appear to. Fees and late fees are shown as separate figures and never summed (D-33), and only to `collection:view` (D-56). Marks were the one thing PLAN 3.5 named that was absent — a placeholder would have been a promise the data could not keep (D-60). They arrived in Phase 6.3 as term summaries, built with the same `totalsFor()` the report card uses |
| 3.6 | Monthly register PDF | done | `p3-teacher-workspace` | | The paper sheet, as a value: `buildMonthlySheet()` with tests. Columns are the union of "school was open" and "somebody took a register" — an open day with no register is the gap worth seeing, and a register taken on a closed day is still a fact about the children. A blank cell is *not* an absence. It prints rather than rendering a PDF server-side (D-55); `@media print` is A4 landscape, because a month of columns does not cross portrait |

## Phase 4 — substitutions

| # | What | Status | Branch | Commit | Notes |
|---|---|---|---|---|---|
| 4.1 | Engine port (tests first) | done | `p4-substitutions` | | Ported whole: the tier ladder, the weights, the min-cost flow, half days, fatigue, load spreading and the merge rules, with the original's tests brought across first. **Dropped deliberately**: `createPlanStore` (plans are rows, so pruning is a query and invalidation is `planIsStale()`), and the `DEFAULT_SHIFTS`/`RESERVE_STAFF`/`DUTY_STAFF` constants, which named real teachers in source — rule 6 forbids that and they are rows now (D-61). Four of the original's 34 tests were about its own `data.js` and `i18n.js`, not the engine, and VPPS One tests those elsewhere |
| 4.2 | Planner UI | done | `p4-substitutions` | | One day at a time, in the order a coordinator works: who is away, what that leaves uncovered, the allocation, then publish. Every row carries the engine's own proposal *and* the names it refused, with the reason on them — hiding a blocked teacher makes the staff room look smaller than it is, which is the moment somebody goes back to the paper chart. Half days are first-class: the period picker leads with "whole day" because most absences are, and a teacher away from P5 is an ordinary candidate for P1 |
| 4.3 | Publish → assignments → notify | done | `p4-substitutions` | | Publishing puts the cover on the covering teacher's own Today card; a draft shows nobody, because a teacher who turned up to a class the coordinator had not finished deciding about is the reason nobody trusts the card again. Notification is in-app, not WhatsApp (D-65). Anything set by hand is pinned by construction and survives regenerating, and the pins are handed to the engine as work already done so it never double-books against one (D-66) |
| 4.4 | Shift policies | done | `p4-substitutions` | | `cover_policies`: the periods somebody is on site for, whether they are a duty-holder or office staff, and their automatic cover cap. Everybody is listed whether or not they have a row — absence of one means full day, ordinary teacher, default cap — and clearing a row deletes it rather than writing the defaults in, because "nobody has said" and "somebody decided" should not look the same |
| 4.5 | Test data and a fixture sweep | done | `p4-substitutions` | | Added because the phase could not otherwise be judged: `seed:timetable` publishes the fixture sheet through the app's own parser, `seed:scenarios` seeds one of every state (four absence shapes, a published day and a hard draft day, four cover policies, a month of registers, three corrections, six note kinds). `tests/substitution-fixture.test.ts` runs the engine over the real 768-cell sheet across 42 day × absence-shape permutations and asserts the invariants hold on every one |
| 4.6 | Fix: PostgREST was truncating the timetable | done | `p4-substitutions` | | Found while seeding: the published timetable is 1038 slots and `listSlots()` had been returning 1000 since Phase 2, with no error — thirty-eight lessons missing from every timetable view and invisible to the planner. Reads that can exceed a thousand rows now page through `fetchAllRows()` (D-62) |

## Phase 5 — collection

| # | What | Status | Branch | Commit | Notes |
|---|---|---|---|---|---|
| 5.1 | Token links + field registry | done | `p5-collection` | | `/r/<token>` is one request, `/t/` is one teacher's own list, `/w/` is where a WhatsApp button lands — public by design, because the school has forty staff and four accounts (D-68). The token is the whole authorization: ~96 bits, one request and no navigation past it, **every rejection the same 404**, and a guess rate limited in Postgres with its own budget so a teacher never spends a guesser's. The field registry and `validateField()` are ported from Sampark with their bilingual errors — a nine-digit phone number is impossible to *submit*, not something the office cleans up later |
| 5.2 | Submissions + review queue | done | `p5-collection` | | Re-answering replaces on (request, student, field): a correction is not a second submission. The queue **splits changes from confirmations** and accepts confirmations in bulk — "this is already right" is a real answer but not a change, and four hundred of them one at a time is a queue nobody finishes (D-73). A repeated phone number carries a neutral count, never a warning (D-71). **Blank means no change, never erase** (D-72) |
| 5.3 | Student records + documents | done | `p5-collection` | | An accepted answer lands in `vppsone.student_records` and **never in the fee app**: `fee_column` is a comparison, not a destination (rule 2, D-69). An approved human answer outranks every import, forever, in code rather than in an editable row (D-70). Documents live in a private bucket and are served through a signed URL that lasts a minute, minted inside the function that checks the permission, with a path keyed by child and a random id rather than the filename (D-75) |
| 5.4 | WhatsApp templates | done | `p5-collection` | | Templates carry the approved wording beside the name AiSensy knows them by, and a send stores the text **as it will read** because a template can be edited afterwards. `mayDispatch()` refuses a parent-facing row outright — D-10 made executable — so the office opens it in their own WhatsApp and marks it sent. Staff messages may go through the provider and still need an `AISENSY_API_KEY` this repo does not carry (rule 8: sending costs money) (D-76) |
| 5.5 | Fix: "9 of 45" read backwards in Hindi | done | `p5-collection` | | Caught on the collection link, which happened to render for a Hindi reader. English counts up from the part, Hindi counts down from the whole (`45 में से 9`), so two numbers around a translated "of" render backwards in one of them — as the attendance register had been doing since Phase 3. `countOf()` now owns the word order (D-77) |

## Phase 6 — assessments and reports

| # | What | Status | Branch | Commit | Notes |
|---|---|---|---|---|---|
| 6.1 | Assessments admin | done | `p6-assessments` | `820ca5f` ([#11](https://github.com/veerpatta/vppsone/pull/11)) | An exam is not one max mark, so `assessment_subjects` is a paper per class per subject — a Class 5 English paper and a Class 10 English paper are out of different totals, and a single `max_marks` on the exam would make the whole school sit the same one (D-78). Locking is the state that stops entry, and it is one field a coordinator sets, not a date somebody has to remember |
| 6.2 | Marks grid | done | `p6-assessments` | `820ca5f` ([#11](https://github.com/veerpatta/vppsone/pull/11)) | **Three states per cell, never two** (D-79): blank is nobody has entered it, Absent is a child who did not sit the paper, and a number is a number — including nought. The column saves in one request like the attendance register, and a refusal leaves the whole column unwritten rather than half of it. Every change is logged with both sides of it, and an unchanged save writes nothing (D-80). `inputMode="decimal"`, not `type="number"` — a spinner that scroll-changes a mark somebody is reading past is a silent wrong answer |
| 6.3 | Progress view | done | `p6-assessments` | `820ca5f` ([#11](https://github.com/veerpatta/vppsone/pull/11)) | Finished papers stay on the board: dropping them would show a teacher who has entered everything as identical to a teacher nobody asked. Term summaries reach the student card too, using the same `totalsFor()` the report card uses, so two screens about one child cannot disagree about what a missing paper means. **A paper nobody has marked is out of both halves; an absence is a nought it is out of** (D-81) |
| 6.4 | Report card | done | `p6-assessments` | `820ca5f` ([#11](https://github.com/veerpatta/vppsone/pull/11)) | A card is a **snapshot, not a view** — issued cards keep their own copy, because marks change afterwards and recomputing would silently rewrite what a family is holding (D-82). One row per subject, a column per exam. Weight applies to the percentage and never to a printed mark (D-83), and the card says so only when the weights actually differ. `readiness()` says what is missing beside the button rather than refusing. No PDF: the browser's own print is what a school with one printer actually uses, and the grade bands are a **default the school still has to confirm** (D-84) |
| 6.5 | Academic exports | done | `p6-assessments` | `820ca5f` ([#11](https://github.com/veerpatta/vppsone/pull/11)) | CSV built in the browser, with only the log row posted — an export is a copy of the school's records leaving the building, and who took what is the fact worth keeping. Logged *before* the file is handed over, because a log of successful downloads misses the interesting case. BOM and CRLF so Excel opens Hindi correctly, and `marksCsv()` prints "Absent" and "Not entered" as different things rather than both as blank |
| 6.6 | Fix: `weight` was stored, shown and documented but changed no total | done | `p6-assessments` | `820ca5f` ([#11](https://github.com/veerpatta/vppsone/pull/11)) | Found while smoke-testing the seeded card: the form took a weight, the card carried it to every cell, and no arithmetic anywhere used it — a control that did nothing. `totalsFor()` now applies it to the percentage only, and returns `weighted` so a screen can explain a percentage that is not the printed pair divided (D-83). The seed has a child who picked up after the formative, because otherwise every child scores the same share of both papers and the weighting is invisible in the data |

## Phase 7 — automations and cutover

| # | What | Status | Branch | Commit | Notes |
|---|---|---|---|---|---|
| 7.0 | Passwordless test sign-in, and the two bugs it found | done | `p7-0-sign-in` | | Phases 3–6 all shipped without anybody looking at a signed-in screen. `/auth/confirm` accepts a link Supabase minted, both doors share `admitSignedInUser()`, and `npm run dev:login` issues a one-time link for a `@qa.vpps.local` account — dev only, any other address refused (D-86, D-87). The first pass through it found that the Teach card told every teacher on a good connection that she had no internet (D-88), and that saving a column wrote a "not entered → not entered" log row and an empty marks row for every child the teacher had not reached yet (D-89). Neither was reachable by a probe |
| 7.0b | Fix: `/collection/messages` threw on every load | done | `p7-messages-embed` | | Found by the same sweep as 7.0. `message_sends` points at `staff_profiles` twice — `requested_by` and `staff_profile_id` — so an unqualified embed has no answer and PostgREST refuses the whole select. The screen had been an error card since Phase 5 merged (D-95). `tests/embeds.test.ts` reads the foreign keys out of the migrations and the selects out of the repos and compares them, so the next one is caught before it ships. It was written, seen to pass against the bug, found to be matching nothing because of CRLF, and only then trusted (D-96) |
| 7.1 | Job platform + console | done | `p7-jobs` | | `runJob()` is everything every job has in common, so a job is only the work. **One run at a time is a partial unique index, not a flag** — a lock in memory does not exist when the app is two instances, which on Vercel it always is (D-90). A run that died leaves a `running` row holding that index forever, so stale rows are closed as failures before every attempt. Twice in a day is a skip, not work; the console's button forces it, and only on the second press, after it has told you why (D-91). Two doors in: Vercel's `CRON_SECRET` bearer, or a per-job token that is `HMAC(JOBS_SECRET, job)` — four different tokens, none of them the secret, and a deploy with neither variable set runs nothing at all rather than anything at all (D-92). Every refusal is the same 404 |
| 7.2 | Scheduled jobs | done | `p7-jobs` | | Open today's registers, chase an unsubmitted one, nudge outstanding marks, write the day down. **The two reminders prepare messages and send nothing** — `draft`, staff audience, for the office to send by hand, which is where Phase 5 left every message this app produces (D-10, D-76). Building them turned up that a job which swallows a query error reports a confident zero: "19 classes have no class teacher" was a wrong column name, not a finding, and a second wrong table name was hiding behind the same silence (D-93). Every read now fails loudly. The dedupe is per template, because a teacher nudged about marks has not thereby been asked about her register |
| 7.4 | Production job secrets, and a deep smoke test across every role | done | `p7-smoke` | | `CRON_SECRET` and `JOBS_SECRET` set on Vercel production through the CLI and the deployment redeployed to pick them up — `/api/jobs/*` answers 404 without them and runs the job with them, both verified live. `npm run smoke:roles` opens all 36 screens as all 6 roles and reads the expected answer out of each screen's own guard: **216 combinations, all correct, none throwing** (D-98). Its first run said every role could open everything, which was the test not knowing that a guard firing mid-stream emits a meta refresh rather than a 307 (D-97). `tests/action-guards.test.ts` covers the other door — a Server Action is reachable without its page (D-99). Two real bugs: a Sunday reported 19 registers outstanding (D-101), and a skipped run wrote nothing, so the console could not tell a cron that fired and skipped from one that never fired (D-100) |
| 7.3 | Cutover to live data (PLAN §7) | blocked (Janmejay's call — rule 8) | — | | **Prepared, not done.** It writes to the live fee project and repoints production, which rule 8 makes somebody else's decision. `docs/CUTOVER.md` is the runbook: the six steps, what `expose_vppsone_to_postgrest` does if you skip it, and what rollback does and does not undo. `npm run cutover:check` reads **dev only** and refuses the live ref — it confirms all 34 tables the 15 migrations create exist, that no migration creates anything in `public`, and what master data step 3 has to reproduce for real. Currently green |

## Mobile refresh — 2026-09-30

| What | Status | Branch / commit | Evidence / remaining |
|---|---|---|---|
| Mobile-first visual, accessibility and workload refresh; user-requested centering and animation polish | Implemented in this revision | `main`, this change | `docs/evidence/MOBILE-2026-09-30.md`: unified role navigation, readable/wrapping cards, shared targets, named/nested sheets, localized sessions, adaptive nav clearance, reduced-motion-safe animations, no unnecessary financial shell reads for non-fee roles. Final checks and exact deployment result are recorded at delivery. The isolated browser fixture is ready but Chromium launch is blocked; authenticated/physical acceptance and field-performance evidence remain pending. No database/config cutover |

## Native admin overview correction - 2026-09-30

The user approved the actual native design and all five follow-up refinements at 15:13 UTC, explicitly authorizing commit/main/deployment. This supersedes the earlier design-review hold below. PR 38 now prioritizes pending/unavailable work while retaining compact zero-count links, adds explicit navigation actions, labels absence-derived teaching counts precisely, separates cover-load errors from no plan, uses tracks only for genuine fractions, marks external live workspaces explicitly, and groups secondary destinations under keyboard-operable All screens. Final aggregate/browser verification and production release are in progress; no database/configuration changes.

| What | Status | Branch / commit | Evidence / remaining |
|---|---|---|---|
| Complete the native admin School overview missed by PR 37 | Implemented; verification in progress; release awaiting user design approval | codex/native-admin-overview; this change | docs/evidence/NATIVE-ADMIN-2026-09-30.md: native compact header, attention hierarchy, earlier phone support cards, wrapping workspaces, preserved data/role contracts. Actual local TEST screenshots and final check results are recorded at delivery. No production push until approval. |

### R7-smooth / F8 — desktop, phone and installed workspace

The requested implementation is in [PR 39](https://github.com/veerpatta/vppsone/pull/39)
on `perf/installable-workspace`: original implementation `2c9ef2f`, current-main
integration `741318f`, preserving PR 37's mobile refresh and PR 38's approved native
admin design. D-201–D-203 and `docs/evidence/smoothness-2026-10-01.md` record behavior
and measurements against main `8ff94de`. Teacher/admin HTML/RSC documents shrank
about 50%/39%; navigation timing is mixed, with no universal latency claim.

Final production verification passed all 49 active browser journeys, 68 mobile
fixture checks and 728 screen/role cases. CI passed 8,144 unit tests; final-head CI
and matching hosted deployment metadata are release gates. Install/offline,
scoped manual draft recovery, deliberate worker updates, local desktop details,
online-only payment confirmation and privacy-conscious measurements are delivered.
Client chunk growth remains inside the 10% route budget.

The directory's bounded/fresh-query fix from current main is retained. Integration
also corrected the visible-target helper for clipped skip links and added actual
keyboard focus acceptance; update recovery now waits for reopening explicitly.
Physical Windows/Android/iPhone installation and lifecycle acceptance,
representative field metrics and unrelated R5/R7/R8 parity work remain open.
No database/configuration cutover.


## Remaining non-migration recovery — 2026-10-11

Released in PR 67, main `7aee58853173c03dd0f6402d718baf0a69b56da4`; review CI `38113376477` and main CI `38113879033` passed. Production READY `dpl_xiezbcdnvwYfcZ4M1TgDgKPeLYvg` matches that SHA and the canonical hostname. Fourteen grouped findings were addressed with 12,389 unit tests and 84 browser cases passing. Five correctness findings remain open (day-close concurrency, durable inbox delivery, atomic preparation, mixed seat set/clear, uncertain provider acceptance). See `docs/evidence/remaining-workflow-audit-2026-10-11.md`. Authenticated acceptance requires existing QA sessions or an authorized secure configuration; no credential probing was performed. Original promotion migration/callers remain excluded pending their unresolved approval. No LIVE School Fees or real provider dispatch occurred. Subsequent dev metadata inspection found the receipt fallback's direct session column invalid; the correction below supersedes its earlier mocked session test.

### Receipt session fallback fix — 2026-10-11

Branch `audit/receipt-session-recovery-20261011`, based on main `7aee588`. `lastReceiptDate` now follows the same payment/installment/class inner joins as the receipt list, because `public.receipts` has no `session_label`. The schema-aware test rejects that nonexistent column and reproduced two failures before the fix; all ten targeted cases then passed. Typecheck and port checks passed; the local execution transport disconnected before the full suite/lint/build could complete. The same tested source and regression are submitted through the supported GitHub API, with complete CI required before merge and matching production verification after merge. No migration or DB record writes. Immutable release identifiers are recorded at delivery.


## Durable inbox and provider recovery — 2026-10-11

In progress on `audit/durable-recovery-20261011`, reconciled with main `ccabab7` (PR 71). O02 now persists scoped intent and reuses command identity through normal/departure/reload delivery; PR 71's removal of attendance correction approval is preserved. O05 claims before provider transport and keeps unknown outcomes blocked until human evidence confirms receipt; no provider retry/overwrite/cancellation can erase an unknown attempt. Validation and release identifiers are tracked in `docs/evidence/durable-provider-recovery-2026-10-11.md`. O01/O03/O04 remain pending a valid separate PR 69 DDL approval: the fresh action expired, and metadata still showed no functions. Original promotion approval and LIVE School Fees remain untouched.

## Phone school operations - 2026-10-11
Release checkpoint e2751ee: full CI 153 files/12,642 tests, six phone lanes 162 cases and provider concurrency pass. Payment browser attempt passed 29/30; WebKit1440 Back click was swallowed while smooth scrolling moved the target past mouse-up. Retained trace has Review unchanged/zero receipts. A bounded stable-target test correction is under focused retest and independent review; draft/merge remains held. No financial replay or new product finding.

Isolated test/phone-school-operations from PR76 fefd2a0; draft PR78 integrates reviewed PR77 payment head 439d334. Six role agents reproduced 22 findings (6 P1/16 P2) and corrected profile/history/context, clipping/contrast, attendance late-draft overwrite, marks recovery/accessibility, bank dates/accounting copy, timetable privacy/date/cover recovery, receipt navigation/readiness/duplicate printing, and Books deposit action overlap. Actual DEV attendance correction/reload, private-note privacy, selected approval/conflicts and marks submission/correction/reopen/concurrency/finalize/lock/unlock pass with exact ledgers. Collector lost-response Cash recovery and UPI posting retain 2 receipts/18,000/5 allocations/zero dues; accountant retains 5 distinct receipts/18,000, zero allocation variance, one bank match, one cheque slip and deposited/cleared events, one balanced close and 5 verified CSV rows. No own notice claims exist. Native receipt Print/Back passes at 360/390/412 and 740 landscape; 16 focused regressions pass. Accountant's final 34 phone cases include actual global navigation; independent source reviews are clean. Earlier combined 7ea7f67 CI passed 151 files/12,626 tests, 158 phone cases and 30 payment browser cases; fresh final-head CI, authorized merge and exact production/live phone verification remain gates. Final immutable release evidence is recorded in PR78 and the delivered report. Cover writes remain blocked by notice-recipient isolation; admin cleanup approval remains unresolved and tagged records are retained. No schema, grants, persistent credentials, real transfer/dispatch or protected LIVE School Fees work. Full evidence, split-attempt limits and improvement plan: docs/evidence/phone-school-operations-2026-10-11.md.

## Payment entry parity - 2026-10-11

Approved bounded restoration on isolated branch fix/payment-entry-parity, based on PR 76 main fefd2a0. Missing collector/concession fields, original shortcuts and EMI context, authoritative selected-date preview, original paper receipt, and owner/session-scoped durable interrupted-save recovery are implemented. Genuine review and explicit-only messaging remain. See docs/plans/2026-10-11-payment-entry-parity-design.md and docs/evidence/payment-entry-parity-2026-10-11.md. Final independent review is clean at 439d334; full CI passed 146 files / 12,565 tests and all 30 Chromium/touch-WebKit cases passed. PR78 owns combined phone retest, DEV bookkeeping acceptance and release coordination. No database/schema/provider writes.

## Bounded phone operations follow-up - 2026-10-11

PR77/78 first release is verified on production at main 3d5b767; full main CI passed 153 files/12,642 tests and 162 phone cases, with 18/18 final deployed read-only touch checks. The earlier pending checkpoint is superseded by docs/evidence/phone-school-operations-2026-10-11.md and the delivered consolidated report.

Authorized bounded follow-up on test/phone-operations-followup reproduces conditional leave-decision loser side effects, capped manual-day undercount, Books cheque draft/date and landscape action gaps, invalid contact calendar dates, contact promise-error form loss, and formula-like school CSV text. Scoped fixes retain original permissions, preview, review/explicit Save and receipt behavior; independent individual and aggregate product reviews are clean. Contact uncertainty is intentionally bounded to the mounted view: reload, Back and another tab permit manual duplicate entry, explicitly recorded as open FU-CON03 rather than durable exactly-once acceptance. The added phone CI separates four contact acceptance cases from three characterization probes. Targeted fee modes/recovery passed all27 across retained split runs without payment source/DEV financial writes. The repaired admin interruption harness has five deterministic checks; fresh uniquely tagged genuine admin acceptance is queued before release. Class final16 touch cases pass after fixing offline note composer loss; academic8 offline/reconnect cases pass. Exact-head aggregate CI, draft PR, merge/deployment identity and non-destructive production checks remain gates. See docs/evidence/phone-operations-followup-2026-10-11.md.

DEV wtgxcptmucjerhufzjcf only; no protected LIVE, schema/grants/new credentials, real transfer or notices. Separate PR69 approval, actual cover recipient isolation, physical devices and original cleanup approval stay blocked; ledgers are retained. Final release identifiers will be recorded in PR and updated consolidated report.

### Follow-up genuine admin acceptance checkpoint

Two actual DEV touch cases passed at 360/390px on 11 October: 46.902s and 45.268s, runner 95.717s. Exact baseline guards resumed only the untouched 9862c9ee batch and created a fresh 29acbd26 batch for 390px. Each conflict save was forwarded once, returned server 200, then its browser response was aborted once. A/C each retain one written audit history, B stays pending with its office value and no history, and the cached conflict retry preserves the same history ID. Independent read-only SQL agrees. No original terminal fixture was replayed or deleted. The CI artifact-path and typecheck heap corrections preserve test gates; all six targeted and six original browser jobs passed at e2b1e3e. Exact final aggregate/release evidence remains the next gate. Durable cross-view contact recovery is a separate reviewed implementation phase, not included in PR79.

### 12 October: contact and sibling completion candidate

Resumed the same preserved worktree after the PC reconnected; interrupted runs without final results remain unverified. PR79 at 6fe31fc already released 29 reproduced fixes. Three additional P2 findings are now locally fixed and independently reviewed: durable cross-view contact recovery (FU-CON03), expired unsaved agreed-date correction under the original UUID (FU-CON04), and sibling directory context (FU-SIB01). The complete reproduced register is 32 findings (7 P1 / 25 P2); this checkpoint does not claim the three candidate fixes are deployed.

Contact passed 35 focused tests and 30 touch phone cases at 360/390/412px and 844×390 landscape; sibling baseline RED then three-width GREEN restores exact directory filters/page. Source lint/type diagnostics and whitespace checks passed. Genuine DEV verification completed across retained checkpoints: first Save forwarded once, persisted one original UUID and lost its browser response; a guarded read-only continuation checked that UUID without replaying Save, then deliberately posted one separate identical contact with a new UUID. Exactly two rows and unchanged original creation time were verified; staff notices stayed 24→24 and seven retained receipts remain ₹36,000 / seven distinct requests. Initial auth-origin and premature Check-assertion failures remain recorded rather than relabeled green. No schema, grants, persistent credentials, financial writes or messages were introduced. Owned local server stopped; temporary configuration remains only for final deployed read-only checks.

Exact-head aggregate/phone/provider checks, draft PR, merge/deployment identity and eight non-destructive production phone checks are the remaining release gates. See docs/evidence/phone-contact-context-completion-2026-10-12.md; final pull-request receipt and same-identity Library report supersede this candidate checkpoint. PR69 atomic operations, real cover-recipient isolation, physical devices and separate retained-fixture cleanup approvals remain outside this release.

## A whole school day, run by agents — 2026-10-14

Raj asked for one full school day to be operated end to end by agents playing the staff, for what they hit to be fixed, and for the app to be faster. Account, findings, timings and open questions: `docs/evidence/dayrun-2026-10-14.md`; decisions D-274–D-291.

| What | Status | Branch / commit | Remaining or surprising |
|---|---|---|---|
| Role run: class teacher, subject teacher, principal (+view only), fee desk (accountant, office, collector), coordinators, performance — ~60 findings | done | `.dayrun/` (git-excluded; replica names) | Five browsers saturated the laptop and dev DB, so role-run timings are inflated; counts and verification timings are reliable |
| Speed: per-request dedupe of board/inbox, shared caches for static reads, lazy Supabase in the session sheet, cheaper badges and Accounts home, touch prefetch | done | #91 → `f6db841` | Cross-request badge cache not built (cookie client, D-281); inline styles on long lists, font preload |
| Teacher screens | done | #90 → `f3f2c47` | Leave/cover clash warning, parent-alert queue retry, one-tap present |
| Fee desk, receipts, dues, admissions; concession refused (D-274) | done | #88 → `be54c9b` | **Concession needs a fee-app fix and the school's decision before it returns**; family receipt, one-tap print, Devanagari search |
| Cover, admin desk, search, messages, layout | done | #87 → `932b3a6` | ~75 duplicate `<main>` landmarks on other screens; classic cover screen's mixed strings |
| Exams, report cards, academics | done | #89 → `7615a22` | Test exams still show raw slugs |
| Verification re-run on merged main, and its fixes | done | #92 → `f17694f`, cover phone-test race #93 → `671a1a1`; production deployed and rechecked in a browser (office Accounts ₹6,500 and closed, Dues 3.3 s with no export prefetch, not-due ₹9,750, "80.5" no longer splits) | Replica half marks on whole-mark papers block three papers until the exam office picks a rounding rule; a new admission is charged late fee on installments due before joining (fee-app rule) |

## Assessment fixes — 19 October 2026

The 19 October fix brief (school-day assessment of `2768ec5`): finding-by-finding ledger, reproduction, evidence, proposals and rollback in `docs/evidence/assessment-fixes-2026-10-19.md`; decisions D-297–D-307.

| What | Status | Branch / commit | Remaining or surprising |
|---|---|---|---|
| Marks B01–B06: one saved/eligible contract, persisted-only progress, changed-cell drafts, server-side submit and lock validity, own-exam receipt, server undo window, read-only office view, write-my-own remarks | done, unmerged | `fix/assessment-2026-10-19` `f73c48a`, `2bb22a3` | DEV still holds replica half marks on whole-mark papers; they are now flagged, not blocking, and the exam office still has to choose a rounding rule |
| Finance B07–B08: live post-payment balance with freshness, read-only Retry, receipt URL/sheet gating, decided requests in My requests | done, unmerged | same | The root cause was the skipped matview drain, not the ledger; the fee app's own WhatsApp balance (`fees/payments/actions.ts` after()) can still quote a pre-payment figure |
| Notes B09–B10, R01: IST week, "you" by id, class context, Only-me plan sharing guarded on every path | done, unmerged | same | R01 was a code path with no exposure in DEV data; the RLS hardening for direct REST reads is a proposal awaiting approval |
| Everyday B11–B16: one leave resolver, leave in Needs you, decision feedback, workload label, dated task titles, live register banner, wrapping tags, next step after attendance | done, unmerged | same | Notice bodies that say "today" are stored text; an "applies on" date is proposed |
| U01 report card, U03 photos, U04 phone | partly | same | U01 reconciled (weighted). U03: the rejection reason needs a schema change (proposal); the live two-role approve/reject loop is not run. U04: WebKit, 200 % zoom and physical phones not run |

### 20 October: released, and the follow-up

PR #102 merged as `3348320` after all 23 checks passed on `52be936`; production `vppsone.vercel.app` serves it (deployment `dpl_9C4yJgBCtcVka7brtf2mV9Agm72a`), and a read-only production smoke as QA teacher and admin passed (marks 19/39 on Today and the sheet, reversed-receipt link replaced, leave in Needs you with school dates).

| What | Status | Branch / commit | Remaining or surprising |
|---|---|---|---|
| U03 photo rejection reason; R01 policy hardening | done (see PR) | `fix/assessment-followup-2026-10-20` | Two DEV migrations applied (`20261020020824_photo_review_reason`, `20261020020829_support_plans_follow_source_note`) and must reach live at cutover. The photo loop was verified on DEV's real functions in a rolled-back transaction, not through a browser upload. Still not run: 200 % zoom, keyboard-only and physical phones; live concurrent editors |

Follow-up released: PR #103 merged as `1583b0b` after all 22 checks passed on `9f0da09`; production `vppsone.vercel.app` serves it (`dpl_B7RioJE2sxcZw4tNut2WsmS55enS`). Read-only production smoke as admin: `/collection/review`, `/notes`, `/notes?tab=plans`, `/inbox` and `/exams` all 200 with no error. The two DEV migrations (`20261020020824`, `20261020020829`) are in the ledger and must reach live at cutover.

20 Oct, accessibility follow-up: production reflow/zoom/keyboard pass over 16 screens and three roles found one 320 px overflow (`/receipts`) and invisible focus on borderless search inputs; both fixed on `fix/accessibility-followup-2026-10-20`. DEV migration ledger matches the repo (one renamed entry, same version, rows present). The live fee database is untouched and waits for cutover.

Accessibility follow-up released: #105 (main `a93eda3`) and #106 (main `399feb1`), production `dpl_HQdBZ6X6e6uXaNRQsWw7WJNQi6JK`. Re-run on production: no overflow on 16 screens at 640 px or 320 px, and every search box shows the focus ring under Tab (Students, Payments, Receipts, notes picker measured). Remaining: physical phones and a screen-reader pass; the live fee database migrations wait for cutover.

20 Oct, live cutover plan prepared (not run): `docs/cutover/LIVE-MIGRATION-PLAN.md`, D-310. Classifies all 79 migrations plus the fee-collector change. Pre-flight P0–P15 (backup, identity, fee preconditions, the bodies to restore, who owns the functions, how the fee app deploys, D-207). Phases M1–M4 with gates and a phase-ordered rollback. Independent review found and fixed three blocking errors (an M2 gate that could not pass, a function count off by one, an M1 rollback that would have taken fee permissions down). `CUTOVER.md` step 1, step 5 and the rollback now point to it. Waiting on the owner's go-ahead.

## Smoke Lab — 20 October 2026

Owner's request: passwordless logins for every role so AI agents can run the whole school day end to end and find bugs and improvements. **Released 20 October 2026.** [PR 109](https://github.com/veerpatta/vppsone/pull/109) merged as `b2ef7f6` (head `614042a`) and deployed to production (`dpl_9Ru8y6hRMniS5PVen1cqSxdYQgqG`, `vppsone.vercel.app`). CI on the head passed, but only after the merge: `--auto` merged at once because the main CI job is not a required check. `scripts/smoke/self-test.mjs` passed against production. Afterwards the test database held 14/14 pool accounts banned, 0 sessions and 0 open runs. Remaining: first real agent school day. Guide: `docs/smoke/README.md`; decisions D-311–D-314.

| What | Status | Branch / commit | Remaining or surprising |
|---|---|---|---|
| DEV migration `20261020103153_smoke_lab` (pool, runs, passes, findings, `smoke_access_allowed`); 14 smoke accounts via `npm run smoke:pool` (6 teachers attached to real class-teacher profiles) | done on DEV | `feat/smoke-lab` | D-skip for live; added to the live plan |
| `/smoke` console, `/lab/enter`, `/lab/clock`, `/api/lab/brief`, `/api/lab/findings`, middleware gate, Markdown export | done | `feat/smoke-lab` | Self-test passed on a local server against DEV (open run, pass sign-in, finding + repeat, revoke pass, revoke run, nothing left the app) |
| Security review fixes (D-314): DEV migrations `20261020105658_smoke_lab_enforcement` (ban/unban, session purge, pg_cron `smoke-enforce`, single-statement counters and findings) and `20261020110015_smoke_lab_ban_date`; smoke accounts lose staff/settings management; gate in `getCurrentStaff`; `app_metadata.smoke_lab` on all 14 | done on DEV | `feat/smoke-lab` | Surprise: `banned_until = 'infinity'` broke Supabase Auth for the whole test project (listing users failed) for about 20 minutes; replaced by 2999-12-31. Both migrations are D-skip |
| School day with 24 seats and 11 agents (D-315): admin, academic and exam coordinators, accountant, 20 teachers, then a developer UX review | done on DEV, through production | `feat/smoke-schoolday-2026-10-20` | **262 findings (15 P1)** in about 28 root causes, ranked with fixes in `docs/evidence/smoke-school-day-2026-10-20.md`. Cross-checks, permissions and money held. Teacher P1s: the sheet steals focus while typing (a note toggles parent WhatsApp), marks keep a partial number (85 saves 8), marks freeze offline, and the saved card shows unsaved counts. Others: report card says Pass with a 0, the receipt's fees-owed is wrong, and "cover arranged" when none was. Surprise: the run was planned on Dussehra and crossed midnight; next run on a working day in school hours |
| All 262 school-day findings worked through (D-316–D-322): eight developer agents, one area each in its own worktree, then integration | **released 21 Oct** | [PR 112](https://github.com/veerpatta/vppsone/pull/112) merged as `d36ac19` (head `ba2ca61`, all 23 checks green before merging); production `dpl_BvDdgiUD8renQKjFApjtnZStsTPE`. Production spot check passed 8 of 8: the change-sheet note stays whole and in focus with WhatsApp untouched, Hindi-only Today, `/staff/roles`, cover, results | Verified in a browser on 21 Oct (local server on the branch, test database, 7 seats): 14 of 15 checks passed, including both teacher P1s, report cards, the needs-attention count, cover and the receipt's fees still owed (₹11,398 before a ₹1 test receipt, ₹11,397 after; SVP20261021-0001). The 15th, the cover tile, passed but no away teacher was set to test it. Its 7 new small problems are fixed in `e69c17c` and `f2256cf`. **202 fixed, 36 improved**, 9 duplicates, 8 by design, 4 not reproducible, 2 need the owner (pass rule, Exempt), 1 open (16 s register load on a weak network). DEV migration `20261021033411_late_cover_assign`. Per-finding list: `docs/evidence/smoke-school-day-2026-10-21-fixes.md`. Surprise: the needs-attention P1 was an undated rehearsal exam full of zeros read as every child's latest paper, not missing marks |
| Agent harness (`scripts/smoke/lib.mjs`), baseline sweep (`npm run smoke:sweep`), self-test | done | `feat/smoke-lab` | First sweep (teacher 1, local dev server): 12 screens each at 390/1280 px; flagged the note composer 10 px wider than a 390 px screen. Dev-server timings are not findings |
| Round 2 prepared, **not started** (D-331, D-332): smoke seats capped at 5 AI drafts a day in `runAssistTask`; the school day and role focus cover the AI helper; committed plan `docs/smoke/plans/school-day.json` (28 seats, personas, 10 waves); `npm run smoke:ready` (read-only) | **released 27 Oct**, run not started | [PR 120](https://github.com/veerpatta/vppsone/pull/120) merged as `6482df2` (head `e79a1af`, all 22 checks green before merging); production `dpl_CMpeRTPMDmhbdQax8ia6w7bbgh4s` | Checked 27 Oct: 28/28 seats with account, profile and flag, all banned; no open run; `smoke-enforce` active; AI month $24.99 left against about $4.20 worst case; `smoke:ready` against `vppsone.vercel.app` passed. Surprise: this PC's `.env.local` holds only a Vercel token, so `open-run.mjs`, `smoke:pool` and `dev:login` cannot run here until the dev URL and service key are added. The 269 findings of the first runs are all still `new` on `/smoke` though PR 112 fixed them; findings are per run, so round 2 is not affected |


## Actions cost optimization - 27 October 2026

Branch `ci/actions-cost-2026-10-27`, workflow commit `eddb811`; PR #116.
All 14 phone matrix configurations/check identities are preserved while testing
an official version-matched Playwright image with Node 24. Obsolete PR-only
cancellation was added to payment parity, provider claim and teacher SQL.
Independent workflow review found no critical/important issues. GitHub CI and
full-job timing comparison are pending; merge only after passing checks.
Local npm installation is blocked by approximately 218 MiB free disk space.
No application logic, production database or deployment gates changed.

## Faster and smoother — 6 November 2026

Plan and ideas: `docs/ui/PERFORMANCE.md` ("6 November"). Janmejay chose to build all three batches in order, one PR each.

| What | Status | Branch / commit | Remaining or surprising |
|---|---|---|---|
| Batch 1: screen names in speed logs, one wave of reads in the layout and the shell, 10-minute photo cache, tapped-link feedback, lighter glass on touch screens, lazy avatars (D-427 to D-431) | **released 6 Nov** | [PR 207](https://github.com/veerpatta/vppsone/pull/207) merged as `d69b791` (all 18 checks green) | Measure on live after it deploys. Surprise: the Students list photo route was `no-store` and went through the bridge for every thumbnail on every visit. Animations were checked for layout-animating transitions: the remaining ones are progress-bar widths, which are cheap, so idea C was dropped |
| Batch 2: pair catalogue split per page, subset fonts, sign in straight to the start screen, screens settle in (D-432 to D-435) | **released 6 Nov** | [PR 208](https://github.com/veerpatta/vppsone/pull/208) merged as `73b0199` | ~17 KB gzipped off every route, 158 KB off the first visit's fonts. "Keep the server warm" not built: Vercel crons on this plan run daily at most, so a school-hours ping would need pg_cron on One's database or a paid plan; deferred until the per-screen logs show whether first-byte time is cold starts or server work |
| Batch 3: drag-to-close sheets on phones, tap feedback on Dues rows (D-436, D-437); the rest checked and not built, with reasons (D-438) | **released 6 Nov** | [PR 209](https://github.com/veerpatta/vppsone/pull/209) merged as `26f239c` | Next: read the per-screen speed logs a day after release and pick the slowest screen; Cache Components only if first-byte time is still the gap |
| Batch 4: screen links prefetch on intent instead of on sight; Calendar reads in one wave (D-439, D-440) | **released 6 Nov** | [PR 212](https://github.com/veerpatta/vppsone/pull/212) merged as `63b41c4` | Measured on live afterwards: Calendar, Students, Academics, Attendance, Exams, Staff 0 prefetches on open (were 53, 33, 26, 10, 9, 8). Collection 20 and Fees 12 remained: their links were outside `src/vx` |
| Batch 5: the intent link in `src/ui`, used by every screen including the ported Fees ones (D-441) | **released 6 Nov** | [PR 214](https://github.com/veerpatta/vppsone/pull/214) merged as `c52060f` | Measured on live afterwards: Collection, Dues, Reports, Home, Calendar 0 prefetches on open. Fees 6: those are the ported shell's deliberate idle warm-ups (`useIdlePrefetch`, three routes, staggered, loading shell only), left as they are. Next: Fees is the slowest first load left (about 3 s from the US edge), worth a server-side look |
| Batch 6: list photos shrunk on One's server before they travel (D-442) | done (PR 216, 8e4028a) | `claude/project-thread-r6fmx0` | Fees serves the original photo for its thumbnail, so a Students page carried fifty full-size photos. Not measurable from the container: test accounts see TEST students, who have no Fees photos; check on a real staff phone |
| Batch 7: Academics needs-attention reads one session (D-495) | done (PR 274, 267cf90; BrowserStack Galaxy M32 + Windows Chrome passed) | `claude/project-thread-r6fmx0` | Slowest route in the 7 Nov speed logs; 510 ms to 18 ms on the database, and no longer times out under load |

## Test-account screens on live — 6 November 2026

| What | Status | Branch / commit | Remaining or surprising |
|---|---|---|---|
| Admissions, New admission, Student tools and Fee reports threw "That academic session is not available to this account" for every test account on live. Each asked the fees bridge for the live year (fee policy's or `app_settings`' label) instead of the viewer's session; now they use `resolveViewSession` (reports also drop a forbidden `?sessionLabel=`), and promotion starts from `defaultSessionFor` | in review | `claude/project-thread-wlt8d6` | Real staff see the same year as before unless their pill names another; the four screens follow the pill now. Pinned in `tests/test-account-session-screens.test.ts` |

## Smoke test every workflow — 6 November 2026

| What | Status | Branch / commit | Remaining or surprising |
|---|---|---|---|
| Test sign-in retried when a concurrent tap on the same QA account spent its one-time token (`/login?error=link`); admissions duplicate check and family search fenced to the viewer's sessions, admit checks session, class and siblings; enquiry moves and leave decisions fenced by the row's own session; QA teachers rebound from two real teachers' profiles to their `T-` twins (data, with Janmejay's yes) | **released 6 Nov** | [PR 217](https://github.com/veerpatta/vppsone/pull/217) merged as `707f673` | Four test threads crawling at once overloaded One's database (smallest compute: 60 connections, ~10-connection API pool, 8 s statement timeout) from 11:20 UTC; requests hung to the 300 s function limit and simple scans ran ~100x slow afterwards. Janmejay: no upgrade now, write it up. Live runs: at most 2–3 browsers across all threads |
| Counter screen (`/accounts`) in Hindi; "Exam ends" until the end date; `loadClass` early promises marked handled so one timeout cannot end the function instance | **released 6 Nov** | [PR 218](https://github.com/veerpatta/vppsone/pull/218) merged (head `95ae47d`) | Vercel logged `Unhandled Rejection` on an `/exam-office` request at the same millisecond as a `/teach/class` timeout: one screen's crash took a neighbour down |
| Payments counter opens with no child chosen; results pipeline Checked not done while a class waits to be submitted; "No teacher is set for these papers"; families counted with their links | **released 6 Nov** | [PR 220](https://github.com/veerpatta/vppsone/pull/220) merged as `e1d6a98` | From the UX review and exam-office replay |
| Final checks: 8-role gentle crawl (90 screens, no page errors); 4 roles × 14 screens they should not use (all refused except by-design ones) | done | — | Teachers hold `attendance:view`, so a teacher with no classes opens the coordinator's school-wide attendance screen (read-only); asked Janmejay. Combined bug list of all four threads: Claude Doc "VPPS One smoke test: combined bug list, 6 Nov 2026". Open P1s: a reversed receipt keeps the late-fee waiver posted with it (Fees design, One's sheet is silent); TEST exam duty pickers may list real staff (suspected) |
| TEST exam pickers and paper-setter action offer only test staff to a test account (E09); check card says the late fee this payment takes ("Collected ₹1,000 · ₹2,000 still owed", not the whole ₹3,000); `/reminders` no longer says rules are "automatic on" | **released 6 Nov** | [PR 223](https://github.com/veerpatta/vppsone/pull/223), [PR 226](https://github.com/veerpatta/vppsone/pull/226) | Nothing in either repo reads `vppsone.fee_reminder_rules`: a rule switched on is a saved setting, nothing sends it. Wiring a sender needs Janmejay's go-ahead and a paid WhatsApp provider. `tests/sentry-lite.test.ts` fails in the cloud container on main too |
| Owner decisions: only a class teacher sees a class's attendance (D-452); a reversed receipt's late-fee waiver stays forgiven (D-451, PR 224's wording) | **released 6 Nov** | [PR 228](https://github.com/veerpatta/vppsone/pull/228) | A subject teacher no longer reads the register, month sheet or class/child attendance figures. Parent-message switches shipped in PR 227; this branch's duplicate was dropped, leaving unused table `vppsone.parent_message_switches` to drop |
| A health or family note can no longer be handed to the coordinator to follow up (following up lets that person read it); "Write AI remarks for N children" asks once before drafting; the note box says how many characters are left near its 2,000 limit | PR open | branch `claude/project-thread-j33nla` | From the teacher replay. "Marks check says all filled while its tile says 4/5" could not be reproduced from the code (both counts come from the same saved cells); needs a live look when the database is calm |
| Dues → Aging "Class by installment" has a column for every overdue installment (Inst 3 money sat in the total with no column, under a note saying Inst 3 and 4 were not due); Finance controls shows "Receipt reversed by an admin" instead of the raw `admin_reversal:<id>` tag | PR open | branch `claude/project-thread-j33nla` | From the accountant run. The PDF receipt's "Pending before" column is the payment row's stored `pending_before_posting`, which the Fees RPC records as what the counter could collect (fees plus late fee); the label says "Pending", not "fees", and it matches the Fees receipt, so it was left as it is |
| Teacher leave: "Withdraw" asks once ("Yes, withdraw" / "Keep it") on Today and More; the leave sheet keeps its day, half, reason, note and send id for the tab, so a refresh during a slow send neither empties the form nor files twice; Today's periods inside her leave read "On leave" or "Leave asked" instead of "Done ✓"; an unmarked register says the office marks it when her leave takes the first period | **released 6 Nov** | [PR 232](https://github.com/veerpatta/vppsone/pull/232) | Draft is `sessionStorage` (per tab, cleared on close or send) and only good for the day it was saved. Not tried live: the database is still throttled. Cover card that "vanished" was not reproduced; the approved card already lists who takes each period |
| Support plan header says "New plan" / "No steps yet" instead of "0 of 0 done"; the counter's "Usual Friday" averages this session's receipts only (it mixed every session, so TEST compared with live takings); a payment the server confirmed was never saved can be dropped ("Don't send it, back to payment") instead of only sent again | in review | `claude/project-thread-j33nla` | The Notes board uses the same helper. "Usual" still counts receipts later reversed |

## UX review fixes for non-technical staff — 6 November 2026

| What | Status | Branch / commit | Remaining or surprising |
|---|---|---|---|
| Wave 1 of the "VPPS One through a non-technical teacher's eyes" review (D-454, D-455): written word under the centre button and Marks for teachers without a class; teacher Today reordered for the first phone screen; "A+" and "Help" words; marks links read "Sent · N blank" instead of "Done ✓"; error card says nothing saved is lost and to call the office; loading screen explains itself after 8 s; TEST tab moved to the top edge on phones; Notes add button no longer covers a filter; Messages tabs and subtitles in plain words; task titles wrap to two lines; admin Menu drops tiles already pinned; board links moved below the work; the Sampark link page says it holds the same marks as the app | **released 6 Nov** | [PR 229](https://github.com/veerpatta/vppsone/pull/229) merged as `d4ca970` | Not crawled on live (load rule). Left for wave 2, after PRs 224 and 228 merge: class subject screen (Enter marks first, 92 vs 44 periods), admin/office home tiles and the ₹0 sparkline, dues/receipts/cheques tiles, long lists opening on a short view, Hindi strings on the counter and help, Settings hydration error |
| Wave 2 (D-456): phone list screens lead with at most two tiles (Dues, Receipts, Notes, School Office), cheques tiles 2×2 and bilingual, admin phone Today with Needs you higher and no rising sparkline beside ₹0, Activity log 40 at a time, Settings activity times built by hand (the 12-hour `Intl` output differed between server and phone: React #418), payment modes on the desk in the reader's language, class subject screen with Enter marks first and one weekly count, "Sent · N blank" there too | **released 6 Nov** | [PR 231](https://github.com/veerpatta/vppsone/pull/231) | Not crawled on live. The #418 cause is inferred from the code (the only locale-formatted text on those pages), not seen in a browser. Still open from the review: exam names stored in English ("Half yearly") show in Hindi accounts until each exam gets a Hindi name |
| UX review follow-up (D-463): exams can be renamed and given a Hindi name from Exams & marks; teacher class and subject screens show the stored Hindi exam name; Settings #418 fixed at its real cause (the theme line); the Exam name button also shows on phones | **released 6 Nov** | [PR 240](https://github.com/veerpatta/vppsone/pull/240), [PR 244](https://github.com/veerpatta/vppsone/pull/244) and a picker follow-up | Re-checked live after deploy: no console errors on Settings, a Hindi teacher reads "अर्धवार्षिक परीक्षा अंक". Phone check on live 6 Nov (one browser, 360×780): wave 1 and 2 changes present; the #418 was still there after wave 2, which is how the real cause was found. The admin task-assignment paper picker now shows the Hindi exam name too (third follow-up) |
| Fees roster sync is nightly only (D-457): every-minute `fees-bridge-sync` cron job unscheduled (migration 20261106162701, applied to wtgx), roster freshness 5 min → 26 h in the app and four SQL readers, roster wording no longer promises "live" | done | `claude/project-thread-j33nla` | The bridge had been in an error state since 14:19 UTC (`bridge_health_update_failed` during the overload); one manual `?verify=1` run after deploy clears it, otherwise the 02:00 IST run does. New Fees admissions now reach One the next morning. |
| Smoke-test small bugs: Notes no longer carries the last tag (board composer had a default "studies" tag and never reset on close); family ticket waits for every ticked child before Next/amount, and loads ticked siblings past the first three; Hindi side of teacher Today/More/Class dates and times, exam "when" times, subject names on teacher marks screens, and Back / help / "Tap and speak" labels | done | `claude/project-thread-j33nla` | Marks "All filled" vs 4/5 not reproduced: the sheet tally is consistent; likely the teacher tile counts its roll from enrolment dates (`trackerFor`/`onRoll`) while the sheet lists a different set. Still open: Hindi search on Latin names, ported fee screens in "both", AI tidy-up answering in English |
| Smoke-test Hindi items and the Marks count: Hindi name search on `/students` (D-466); `both` readers get bilingual fee labels (D-465); 18 fee strings that were "???" in `hi.json` repaired; Tidy up writes Hindi for a Hindi reader and turns romanised Hindi into Devanagari; fee student header, statement and not-found translated; marks saves refresh every `/teach` screen and `/exams` so a tile cannot keep the pre-save count for the 300 s router cache | done | `claude/project-thread-j33nla` | The marks cause is inferred, not reproduced: the save revalidated only `/teach/marks` while `staleTimes` keeps other pages 300 s. Fee admin pages (reminders, edit student, admin tools) are still English-only |


## Opening the app faster — 6 November 2026

| What | Status | Branch / commit | Remaining or surprising |
|---|---|---|---|
| Boot splash at the first byte and the account's reads streamed behind it (D-461); `/` sent straight to the person's home by the proxy, from a home hint the shell writes (D-462) | **released 6 Nov** (again) | PR 234, reverted by PR 235 during the database outage, re-shipped | Sessions use ES256 keys, so sign-in checks stay local. Real-phone timing still to do |

## One without the Fees redirects — 6 November 2026

| What | Status | Branch / commit | Remaining or surprising |
|---|---|---|---|
| Dues & calls and Fee setup read live from Fees for real staff (D-467, D-468); every other Fees redirect lands on "Not in One yet" (D-469); admin "Refresh roster now" (D-470); search falls back to One's roster (D-471); Fees feature freeze (D-472) | **released 6 Nov** | `claude/project-thread-vv9vvk`, with Fees PR 146 | Still not in One: Reports (needs a `reports:view` bridge operation, which is a live Fees migration, so not done), Books, Reminders, Student tools, admissions edits, receipt send and reverse. Dues writes (calls, promises, plans, write-offs) and fee-setup publishing are off on the live screens until Fees has commands for them. `tests/sentry-lite.test.ts` fails on main too · The build's typecheck ran out of Node's default heap on Vercel (preview stuck in Running TypeScript); `npm run build` now goes through `scripts/next-build.mjs` with the 6 GB CI uses |
| Reports reads live from Fees for real staff (D-477): hub, daily collection, defaulters, pending by class and the day book; Accounts links to it instead of "Not in One yet" | **done 7 Nov** | `claude/project-thread-vv9vvk`, with Fees PR 147 (its migration applied to the live Fees database 7 Nov) | Exports and "All detailed reports" still go to "Not in One yet". The day book's close status is Fees' own in live mode, not One's `fee_day_close_events` |
| Reports has its own "See fee reports" switch on Staff → Roles (D-476): on for admin, accountant, fee collector; off for office. Menu, navigation, Accounts tiles and the day-book button follow it | **done 7 Nov** | `claude/project-thread-vv9vvk`, migration `20261107042312` applied to One's database | Turning it on for a role also needs that person's Fees bridge grant (`can_read`) for live numbers; the two Viewers' grants are read-off |
