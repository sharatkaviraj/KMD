# School Office, second pass: from a compliant engine to a counter staff enjoy

3 November 2026. Brainstorm for Raj, written against `main` at `37c9e6e3` (after
PR #157 *Integrate school certificates, government returns and board records*
and PR #158 *student documents*). Source research: *Research - Rajasthan School
Operations Certificates and PSP - 2026-11-01.pdf*. Earlier plan:
`docs/plans/2026-11-01-school-operations-ui-ux-plan.md`.

This is a list of ideas, not a decided design. Every guardrail in the research
still applies: no invented official formats, no portal automation, no AI-written
facts, no automatic messages, Fees remains the authority on money. Items marked
**verify** depend on a fact about Rajasthan practice or VPPS policy that nobody
has confirmed yet.

---

## 1. Why the first build doesn't feel right

The engine underneath PR #157 is good: serials are atomic, issues are
immutable, commands are idempotent, the snapshot is frozen, and TEST data is
confined. **Keep all of it.** The problem is the surface. It was designed around
what can go wrong, not around the person at the desk with a parent waiting.

| # | What staff experience today | Where |
|---|---|---|
| 1 | **Pressing *Study certificate* takes you off the student** and onto a separate certificate page. The clerk loses their place while the parent is still at the counter. | `study-certificate-button.tsx` → `router.push(/school-office/certificates/:id)` |
| 2 | **The disclaimer is printed on the certificate.** Every PDF carries "Print copy - physical signature and school seal required", so even a correct certificate looks like a draft. The register repeats the same warning at the top. | `certificate-pdf.tsx` footer box, `certificates.tsx` `office-note` |
| 3 | **It doesn't look like a school certificate.** Plain Helvetica, no border, no principal's name, no place, no recognition or affiliation line, no photo box, no "To whom it may concern". Parents and banks expect something formal. | `certificate-pdf.tsx` |
| 4 | **Only one certificate type exists.** The office's real volume is TC, character certificates, tuition-fee certificates (Jan–Mar income tax season), bonafide letters for a scholarship or bank, and DOB extracts. | `certificates/domain/certificate.ts` (study only) |
| 5 | **Editing the template means writing code**: `{studentName}` placeholders, a checkbox list of "required fields", and no preview. | `template.tsx` |
| 6 | **Government returns show the plumbing**: a free-text *Module* box, a typed *School code*, *Format/adapter*, and a single *Check details* button. Staff think "UDISE is due, who's missing what?", not "choose an adapter". | `returns.tsx`, `return-format.tsx` |
| 7 | **The office alone fixes all missing data.** If 42 students lack a field, one clerk opens 42 records, even though the class teachers know those children. | attention list → `/students/:id` |
| 8 | **Teachers have no role**, and the principal's only role is to sign paper that the app can't see. | — |
| 9 | Board readiness opens with **cycle editors and configuration**, not with "who isn't ready". | `board-office/workspace.tsx`, `forms.tsx` |

In short, the honesty and safety belong **in the app's state**, not on the
paper and not in front of every click.

---

## 2. Principles for the second pass

1. **Counter-first.** Any routine document is at most three taps from a
   student's name. Target: parent asks → certificate in hand in under 30 seconds.
2. **Ask only for what's missing, where it's missing.** A missing date of birth
   becomes a date field *inside the same sheet*, not a link to another page.
3. **Keep honesty in the app, not on the paper.** Status (*awaiting signature*,
   *handed over*) is shown in One. The printed page is a clean, formal document.
4. **Send each fix to the person who knows.** Class teachers confirm their own
   children's details; the office reviews the exceptions.
5. **Show progress, hide configuration.** Destination codes, series prefixes
   and portal formats are entered once in Settings and never shown on a work
   screen.
6. **Keep one student context.** Profile, fee desk, search and the quick
   action all open the same certificate sheet.
7. **Use what's already built.** `Sheet`, `DataList`, `Pill`, `Progress`,
   `HeatGrid`, `Ring`, `SuccessTick`, `ListRow`, the palette and the quick-action
   sheet already exist. No new component library.

---

## 3. The ideas

Ranked roughly by value ÷ effort. Each idea lists what it is, how it should
feel, where it belongs in the current app, and the guardrail that keeps it
honest.

### A. The Certificate sheet (replaces the page jump) — *highest value, small*

- **What:** Tapping *Certificate* on a student opens a bottom sheet on phone and
  a centred `Sheet` dialog on desktop. Choose a type (Study · Character · Fee ·
  TC · …). The sheet shows a live preview thumbnail of the actual PDF, the
  serial it will get, and the actions **Print**, **Download** and **Share** (the
  OS share sheet, started by the user, never automatic). **Done** closes the
  sheet and you are still on the student.
- **Missing details are fixed inline:** "Father's name is missing" appears as an
  input in the sheet. **Save & continue** writes through the proper writer (One
  record writer or the Fees-owned command for fee-owned student facts) and
  re-runs preflight, without leaving the sheet. Someone without edit rights sees
  "Ask the office to add father's name" plus a one-tap **Remind office**, which
  creates a Needs-you item.
- **An existing issue offers a reprint first:** "Study certificate
  VPPS/STUDY/2026-27/0041 issued 12 Oct · **Reprint** / New issue". This keeps
  today's rule that a reprint never takes a new number.
- **Success moment:** `SuccessTick` plus the serial in large type, then the PDF.
- **Where:** `student360.tsx` header action becomes a split button
  **Certificate ▾**. The *School-issued* list in the Documents tab stays.
- **Guardrail:** the server still supplies every fact, and the browser only
  sends `{studentId, type, purpose?, commandId}`.

### B. A certificate that looks like a certificate — *high value, small*

- An A4 page with a **thin double-rule border**, the letterhead (logo, school
  name in Hindi and English, recognition/affiliation number, UDISE code,
  address), **"To whom it may concern / जिसके लिए भी संबंधित हो"**, the body, **Place:
  …  Date: …** on the left, and a signature block on the right with the
  **principal's printed name and designation** under the line, plus a seal
  circle.
- An optional **photo box**, filled from the student's existing photo when the
  template turns it on.
- A small **QR in the footer** that links to `/verify/<code>`. The page shows
  only: valid / cancelled / superseded, the serial, the issue date and a masked
  name ("R**** S*****"). It never exposes the profile. This deters forgery and
  stays within the research's minimum-fields rule.
- **Remove the "Print copy - signature required" box from the paper.** The app
  shows the status; the paper carries a real signature line. *TEST* documents
  keep a loud watermark.
- **Pre-printed stationery mode** (**verify** whether VPPS has a serially
  numbered certificate book): print only the variable text, positioned over the
  school's existing form. Calibrate once with an X/Y offset nudge on a test
  print.
- **Signature policy switch** in Settings: *Manual signature (default)* or
  *Pre-authorised facsimile*. The second is off until the principal turns it on.
  The research is explicit that owning an image is not authority, so the switch
  records who enabled it and when.
- **Where:** `certificate-pdf.tsx`. School identity comes from a new
  **Settings → School identity** card (see L).

### C. A catalogue of the documents the office actually issues — *high value, medium*

| Type | Data source | Notes |
|---|---|---|
| **Study / enrolment** (exists) | enrolment | Add a **Purpose** line chosen from a list (Scholarship, Bank account, Aadhaar, Passport, Other…). Purpose is one template line, not a separate template. |
| **Character** | enrolment + period | Fixed approved wording only. No free-text praise and no AI. |
| **Tuition fee certificate** (80C) | Fees ledger, **read-only** | The biggest parent request in Jan–Mar. Financial year Apr–Mar, tuition head only, receipts listed. Uses the fee clients from the fees module's own read path; never writes. |
| **DOB / SR register extract** | admission record | DOB in figures **and words** (deterministic, both languages). |
| **Transfer Certificate** | leaving workflow | **A separate workflow, not a template** (see D). |
| **Merit / participation** | event or result list | Bulk, decorative layout, its own series. Pairs with result day (M). |

Each type keeps its own series, template version and register filter. The
register's type filter appears once more than one type exists.

### D. TC as a guided leaving flow — *high value, larger; **verify** the Rajasthan TC rules first*

TC is the most consequential document, so it should not be a one-click button.
Instead, a **four-step sheet**:

1. **Leaving details:** date, reason (picked from a list), last class attended,
   whether promoted.
2. **Clearance glance:** dues shown read-only from Fees ("₹2,400 outstanding").
   Whether dues may block a TC is a **policy question**; show the dues, don't
   enforce a rule in code. Library and other checks only if VPPS uses them.
3. **Facts preview:** DOB in words, admission date, SR number, conduct. Missing
   items are fixed inline, as in A.
4. **Issue:** TC serial, PDF, and the student's status change to *left*. That
   status change is a separate, explicit act inside the same confirmation, and
   it uses the existing enrolment writer.

Check before building whether a private-school TC must also be generated or
recorded on PSP or ShalaDarpan (**verify**). If so, the TC flow ends with a
Portal Copilot card (K) holding the same values.

### E. A visual template editor — *medium value, small*

- Split view: wording on the left, **live PDF preview** of a sample TEST student
  on the right (stacked on phone).
- An **Insert** chip row ("Student name", "Father's name", "Class", "Session"…)
  places the placeholder for you. Staff never type braces.
- **Required fields are inferred** from the wording. Drop the checkbox list, or
  keep it under "Advanced".
- "Saving creates version 3. Certificates already issued keep version 2." plus a
  small **What changed** diff against the previous version.

### F. The signing tray — *high value, small*

Physical signatures are the reality, so make them a batch instead of a chore.

- Every certificate prepared today sits in the **Signing tray**. Today shows the
  office and the principal one line: "6 certificates waiting for signature".
- **Print tray** produces one merged PDF with a cover list (serial, name, type)
  for the principal to sign in one sitting.
- **Mark signed & handed over** in bulk, with "collected by" (Father, Mother,
  Student, Other). This replaces the per-certificate *Record signed handover*
  button.
- No approval step is added: the tray records a physical act that already
  happens.

### G. Requests and pickup shelf — *medium value, small, optional*

A parent phones for a certificate. **Log request** (student, type, purpose,
needed by) creates a *Requested* row. Generation moves it to *Ready for pickup*,
and Today shows "3 ready for pickup". Handover closes it. This gives the office
a to-do list without anyone keeping a paper diary. A WhatsApp note to the
parent, if wanted, is drafted for the office to send by hand (rule 8: no real
sends).

### H. Bulk issue — *medium value, small once A exists*

Scholarship season: **School Office → New batch → Class 9-A → Study certificate,
purpose Scholarship → 38 ready, 2 need details**. Generate the ready ones and
get **one merged PDF**, with one serial per child. The two blocked students
become Fix-it items (I).

### I. Fix-it: class teachers fill the gaps — *very high value, medium*

This is the change that makes data readiness stop being the office's burden.

- The office (or the readiness board, J) asks for specific fields for a specific
  purpose, e.g. "UDISE+ 2026-27 needs: Hindi name, mother's name, category".
- Each **class teacher's Today** gets one card: **"5 students in 7-B need
  details for UDISE+ → Start"**.
- Tapping it opens a **card stack**, one student per card with photo, name and
  only the missing fields. Inputs are large, Hindi-name **transliteration is
  suggested** (deterministic; the teacher confirms or edits), and **Save →
  next** advances. It takes about 10 seconds per child and works on a phone in
  the staffroom.
- **Protected facts** (name spelling, DOB, parentage) are saved as *proposed
  changes* with "entered by class teacher". The office confirms them in bulk on
  one screen. Unprotected One-owned facts write directly through the record
  writer with provenance.
- The office sees **per-class progress bars** and a **Nudge** button that
  re-raises the Today card. It never sends a WhatsApp.
- This reuses the existing fan-out/ownership model (`staff_scopes`,
  `ownership.ts`) and Needs-you. The purpose-specific preflight from the earlier
  plan (Slice 2) is the engine that decides what's missing.

### J. The readiness board (replaces the returns form) — *high value, medium*

School Office → **Returns** becomes a grid of destination cards, not a form:

```
┌ UDISE+ 2026-27 ─────────────────────────┐   ┌ Class 8 exam 2027 ──────────┐
│ ███████████████████░░░  541 / 583 ready │   │ ████████░░░░  61 / 92 ready │
│ 31 need details · 11 conflicts          │   │ Photos 70/92 · Sign 58/92   │
│ Closes 14 Nov · verified by Raj 1 Nov ⓘ │   │ Deadline: needs verification│
│ [Fix-it sent to 9 teachers]  [Open →]   │   │                    [Open →] │
└─────────────────────────────────────────┘   └─────────────────────────────┘
```

- **Open** shows a **class × issue HeatGrid** (rows are classes, columns are
  missing fields, darker means more students). Tap a cell to see the students
  and send a Fix-it. **Conflicts** (identity, session, duplicate external ID)
  stay office-only.
- The **destination's settings** (module, school code, format/version, source
  circular) live behind ⚙ and are picked from a list set up once. They are never
  typed on the work screen.
- Primary action, depending on the evidence available: **Portal Copilot** (K)
  when no verified upload format exists, or **Download upload file** once a real
  specimen has been verified. The three states *prepared / submitted by person /
  accepted by portal* stay exactly as the research requires.

### K. Portal Copilot: manual entry assistance done well — *very high value, medium*

The honest replacement for an "upload file" that doesn't exist yet. The operator
has the official portal open and One beside it (split desktop window, or One on
a phone next to the PC).

- **One student at a time, in the portal's field order**, each value already
  formatted (DD/MM/YYYY, codes mapped, Hindi where the portal wants Hindi).
- **Tap a value to copy it.** A **Copy row** button copies tab-separated values
  for portals that accept a pasted row. **Keyboard:** `J`/`K` for next/previous,
  `1`–`9` to copy field *n*.
- **Mark entered → next.** Each row records "entered by Anita, 3 Nov 11:42".
  This is honest row-level evidence of *human submission*, never of *portal
  acceptance*.
- **A progress ring and resume.** Close the laptop at 212/583 and tomorrow it
  opens at student 213, on any device.
- **Mismatch notes:** "Portal shows a different DOB" logs a discrepancy into the
  reconciliation queue instead of anyone silently changing data.
- Nothing logs in, scrapes or submits. It turns a three-day typing job into a
  calm, resumable one, and every value comes from One's canonical record.

### L. School identity, once — *small, unlocks B, J, K*

**Settings → School identity:** names in Hindi and English, address, place,
phone, recognition number, affiliation, **UDISE code**, **PSP school code**,
principal's name and designation, logo, seal image (display only), and signature
policy. This is a school-level namespace, so it never goes into per-student
external-ID fields, as the research warns. The certificate letterhead, the
copilot and the readiness board read from here.

Student-level IDs get their own crosswalk rows: SR number, **PEN** (UDISE+),
**APAAR ID** (**verify** current UDISE+/APAAR requirements for VPPS), board
registration and roll numbers. Each is shown on Student 360 as a small "IDs"
card with a source and verified date.

### M. Board work: photo studio and result day — *high value, medium–large*

**Photo & signature studio** (Class 8/10/12 registration):

- In the classroom, the teacher opens *Board registration → 10-A → Photos*. The
  camera shows a **face-frame guide**, auto-crops, and compresses to the
  **dimensions and KB limits entered from the current circular**, never
  hard-coded. Signature: the student signs on white paper, the teacher snaps it,
  and the app thresholds it to clean black-on-white.
- Files are named by SR or registration number. **Download class ZIP** is ready
  for the portal upload the human does. The existing student photo is reused
  when it already meets the spec.
- Per-class progress (photos 70/92, signatures 58/92) feeds the readiness board
  card.

**Result day:**

- *Before:* roll numbers are mapped (pasted from the admit-card list), and
  cohort and subjects are confirmed.
- *On the day:* a **keyboard-fast grid** (student rows × subject columns,
  Enter moves down) for typing from the official result, or importing the
  board-provided file if one has been verified. Attaching evidence is optional.
- *After:* toppers, subject averages, distinction/pass/supplementary **with
  denominators** (registered → appeared → result available), plus a quiet
  comparison against internal pre-board marks, labelled as correlation, not
  cause.
- **One tap: merit certificates** (C) for the toppers in the decorative layout,
  and a **celebration poster PDF/PNG** for the office to share manually.
- Official results never overwrite internal marks or report cards (existing
  separation).

### N. Deadline radar — *medium value, small*

Calendar entries for official deadlines carry **source link + "verified by / on"**.
Today shows the office "UDISE+ closes in 9 days · 42 not ready →". An unverified
or conflicting date shows a **Needs verification** pill instead of a countdown.
A scraped banner is never treated as a deadline.

### O. Find it from anywhere — *small*

- **Palette / search:** typing "cert riya" or "TC 1043" offers *Study
  certificate for Riya S. (7-B)*, which opens the sheet from A directly.
- The **quick action** (`nav.ts` "Study certificate") currently goes to
  `/students`. Make it open a **student picker sheet** and then the certificate
  sheet. That's two taps, and you never leave Today.
- **Fee desk:** a small "Certificate" link in the ported collection screen's
  student panel. Per rule 9a its label comes from the next-intl catalogue, and
  it only links to a One route.

### P. Deterministic helpers (power B, C, D, I)

- `dateInWords(iso, "en"|"hi")`: "Fourteenth March Two Thousand Eleven" /
  "चौदह मार्च दो हज़ार ग्यारह". Unit-tested over the edge years.
- Hindi transliteration *suggestion* for names. It is only ever a suggestion and
  needs human confirmation.
- `maskName()` for the verify page.
- All of these live in `domain/` with tests and no database.

---

## 4. Where each idea lives in the current shell

| Surface | Role today | After this pass |
|---|---|---|
| **Student 360** | One *Study certificate* button; Documents shows issued list | **Certificate ▾** split button → sheet (A); "IDs" card (L); Documents keeps School-issued plus Uploaded |
| **Today — office** | School Office attention card | One **Office desk** card: signing tray · ready for pickup · nearest deadline · conflicts |
| **Today — class teacher** | — | **Fix-it** card for their own class only (I); photo-studio task in board season (M) |
| **Today — principal** | — | "6 to sign" line (F); result-day summary in season |
| **School Office** | Certificates · Government returns chips | **Desk** (today: requests, tray, recent) · **Register** · **Returns** (readiness board J) |
| **Exam Office → Board** | Cycle/readiness editors | Readiness first: roster progress, **Photo studio**, **Result day**; editors behind ⚙ |
| **Calendar** | Deadlines | Source-verified deadlines with **Needs verification** pill (N) |
| **Settings** | Certificate template | **School identity** (L) · Certificate types and templates (E) · Signature policy (B) |
| **Search / palette / quick action** | Goes to student list | Direct to the certificate sheet (O) |
| **`/verify/:code`** (public) | — | Minimal validity page (B) |

Nothing new appears in the bottom tabs. School Office stays in the People group
and the phone Menu.

## 5. Phone and desktop

- **Phone:** sheets for everything short (certificate, signing, fix-it card);
  full page for the readiness HeatGrid and Copilot. Sticky primary action above
  the safe area, 44 px targets, 16 px inputs, and swipe or Next on the card
  stack.
- **Desktop:** the certificate sheet is a centred dialog with the PDF preview
  beside the actions. The Copilot is a narrow, tall layout made for snapping
  beside the portal window. Register `DataList` rows get a type icon and a
  status pill.
- **Motion:** use the existing sheet and toast motion. `SuccessTick` appears
  only on a real success, and reduced motion is respected.

## 6. Copy: say less, say it once

| Now | Better |
|---|---|
| "Physical signature and school seal are required on every print copy, including reprints." (on the register and the PDF) | Status pill **Awaiting signature**; a one-time hint in the signing tray: "Sign and stamp, then mark handed over." |
| "Could not prepare the certificate. Your request is retained; try again." | "Didn't finish. Tap to try again; the same number will be used." |
| "Fix student details" → link away | Inline: "Add father's name" [input] **Save & continue** |
| "Module", "School code", "Format/adapter" on the returns screen | Gone from the work screen; set once under ⚙ |
| "Create another issue" in a `<details>` | **Reprint** (primary) · *Issue a fresh copy* (secondary, explains new number) |

Every string is a pair in `src/vx/screens/school-office/text.ts` (or `ms` for
setup-only screens, per D-229).

## 7. Suggested order (each slice is demo-able to Janmejay and the office)

| Slice | Contents | Demo |
|---|---|---|
| **1. Counter delight** | A (sheet + inline fix + reprint-first), B (formal PDF, no printed disclaimer, QR verify), L (school identity), F (signing tray) | Parent at the counter: certificate printed in under 30 s without leaving the profile; principal signs the day's tray in one go |
| **2. Catalogue** | C (character, fee certificate, DOB extract, purpose line), E (visual editor), H (bulk), O (search/quick action), P helpers | Scholarship batch for one class in one merged PDF; an 80C fee certificate for a parent |
| **3. Distributed readiness** | I (Fix-it for class teachers), J (readiness board + HeatGrid), N (deadline radar) | Office asks for UDISE fields → teachers clear their cards on phones → board turns green |
| **4. Portal Copilot** | K (+ discrepancy queue) | An operator enters 20 students into the real portal from One with no retyping errors, then resumes the next day |
| **5. TC** | D (after the TC rules are verified) | Leaving flow issues a TC and changes status in one confirmed act |
| **6. Board season** | M (photo studio, result day, merit certificates) | Class 10 photos captured in one period; result-day grid to toppers and merit certificates |

Slices 1–2 need no external specimen, so they can start today. Slice 4 can ship
without a verified upload format, because it is manual entry assistance and is
labelled that way.

## 8. Decisions only the school can make

1. **Signature:** manual only, or is a pre-authorised facsimile acceptable for
   study/character certificates? (B)
2. **Stationery:** does VPPS have pre-printed certificate books? If yes, send a
   photo of one blank page. (B)
3. **Top three documents** by monthly volume, and an existing filled sample of
   each with the student redacted. (C)
4. **Principal's printed name and designation**, and the place to print. (B, L)
5. **Dues and TC:** show only, or does the school refuse a TC with dues? (D)
6. **Is a private-school TC also recorded on PSP or ShalaDarpan?** (D, verify)
7. **First portal module** for the Copilot (UDISE+ student profile is the usual
   annual pain). (K)
8. **Which fields** the class teachers may enter directly, and which need
   office confirmation. (I)

## 9. Guardrails carried forward from the research

- Deterministic generation only. No LLM writes an official fact, name spelling
  or result.
- No "PSP compatible" or "Sync" wording without a verified current specimen.
  The Copilot is labelled manual entry assistance.
- No login, scraping, CAPTCHA/MFA handling or submission on a government portal.
- Identifier namespaces stay separate (school PSP/UDISE code vs student SR / PEN
  / APAAR / board roll number).
- Reprint = same bytes, same number. Correction = new number + reason. Cancelled
  numbers are never reused.
- Fees is read-only from certificates. Dues are shown, never edited here.
- No automatic message to a parent. Share and WhatsApp are user-initiated or
  drafts.
- Downloads and bulk files recheck permission; files with many children are
  access-controlled and audited.
- Asia/Kolkata dates on every issue.
