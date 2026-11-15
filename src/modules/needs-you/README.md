# needs-you

Needs you (D-630..D-635): one list per person of what is waiting on them
today, in order, with what they finished and their own to-dos. Built for
staff who are new to apps: the next job in a big card, one button each,
nothing hidden.

| | |
|---|---|
| Routes | `/needs` (teachers, the fee office, the exam office); the strip at the top of each of their Todays; the head of `/inbox` (the admin and coordinators) |
| Tables | `vppsone.needs_reminders`, `vppsone.needs_seen`, `vppsone.needs_plans`, RPC `vppsone.needs_sync` (`20261115060835_needs_you.sql`) |
| AI task | `needs.arrange` (feature "Needs you order" in AI in One) |

## Owns

- The four lanes and One's own order in them (`domain/lanes.ts`): Do now, Today, Later, Waiting on others.
- Each role's jobs as mapped from the screens that own them (`domain/teacher.ts`, `domain/office.ts`), read in `data/sources.ts` from what each Today already loaded.
- A person's own to-dos and "Remind me later", with the time read from their words in Hindi, Hinglish or English (`domain/when.ts`) or picked on a chip (`domain/choices.ts`), and "Bring back" for a job put off by mistake (`canBringBack`, `broughtBack`, D-636).
- "Done today": a job a complete read no longer finds (`needs_sync`).
- What the AI is shown and how its answer is checked (`domain/plan.ts`).

## Invariants

- A job is never copied: its button opens the screen that owns it. Only a person's own to-do and saying yes to a cover are done here.
- Nothing is marked done unless every read succeeded (`complete`). A source that failed to load would otherwise tick off everything it holds.
- The AI sees only kinds of job and numbers under made-up ids, never a title or a name. It orders only inside Do now and Today, and a period that starts within 15 minutes stays first whatever it says.
- The AI is asked after the page is drawn, at most every 10 minutes and 12 times a day per person, and an order made for the same list is used again.
- Previews and seeing One as somebody else are look-only: nothing is written and nothing is asked.
- A put-off can always be undone where the job now is: Later shows "Bring back" on it, not only a toast that goes after a few seconds.

## Never

- Put Needs you in the phone's bottom bar. The owner asked for the current setup to stay (15 Nov); it is the strip on Today, the first tile in More and the second item in the menus.
- Let a list's own read block or break Today: the strip streams in its own Suspense boundary and leaves itself out on failure.
- Send a job's title, a child's or a staff member's name to the AI.

## Layout

`domain/` is pure rules, no database and no clock of its own. `data/` does
the IO (server-only). `ui/` is the list, the strip and the admin's head.
