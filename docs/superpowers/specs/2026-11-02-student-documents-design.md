# Simple student documents

The owner asked for a simpler Documents section in the VPPS One student profile, consistent with the app, implemented and released live. Repository owner direction (`CLAUDE.md` rules 5 and 8) explicitly delegates routine choices and deployment without further approval gates.

## Approaches

- Document tiles: easy to scan for a handful of files, but large cards obscure filenames and take too much room in the 640px profile drawer.
- Required-document checklist: useful only with an agreed requirement policy; inventing missing/required labels would mislead staff.
- **Chosen by the implementer: a plain file list with an in-profile upload sheet.** It fixes inaccessible file rows and the disappearing upload affordance while fitting the existing profile.

## Design

Show Uploaded documents first, with the count and one Add document action even when files exist. Explain PDF/photo and the 10 MB limit. Each row opens the existing authenticated `/documents/<id>` route in a new tab, with type, filename, size and date. Keep removal behind a separate named action and a confirmation with the filename; show failure and retain the row until success. School-issued certificates stay in their own existing section below attachments.

Add document opens the app's existing Sheet. Offer the six existing document types, a keyboard accessible Choose file button, selected filename/size, optional note hidden until requested, progress and a Save document button. Keep the same student/profile location on save; refresh only after confirmed storage. Retry keeps the same request ID for the same file and metadata. Changing file, kind or note resets that identity so resumed data cannot drift. Do not allow sheet dismissal while uploading.

Use existing VX buttons, icons, typography, tokens and sheet motion. Support English, Hindi and bilingual account preferences, narrow 320px phones, desktop drawer, dark mode and reduced motion. Do not infer document completeness. Keep storage routing, byte validation, permissions, class/session fences and test isolation. Preview/read-only accounts have no mutation controls. A failed read is a retryable error, never an empty list.

## Scope and validation

No migration, new storage provider or source financial change. Retain existing upload transports and private file routes. Verify real components with synthetic records and intercepted local upload requests; verify removal permission/fence failures at the server boundary. Run the repository checks and a focused responsive browser suite. Shared-browser control is disabled in Work settings, so local Playwright fixtures are the browser evidence; live verification must state its precise coverage.
