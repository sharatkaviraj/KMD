# `chats`: parents' WhatsApp chats, answered in One (D-616 to D-618)

Parents' WhatsApp messages that need a person, answered by staff in One: one chat per parent per desk.

A parent writes to the school's WhatsApp number (the hub). Veer Patta AI
answers what it can; what needs a person lands in a **chat**: one per
parent's number per **desk**. Staff read and answer it at `/chats`, and the
answer goes back from the school's number, saying who wrote it.

| Desk | Who answers | Who else sees it |
|---|---|---|
| `class` | the child's class teacher | admins (they take it over first) |
| `accounts` | everyone with `fees:collect` who is not an admin | admins (they take it over first) |
| `admin` | the office and the admins; a chat that asked for the principal is the admins' alone | — |

## Where things are

| | |
|---|---|
| `domain/access.ts` | who sees a chat and who may write in it (`chatAccess`: reply, take over, watch, none) |
| `domain/filters.ts` | the list's views and filters, and "For you" (`isForYou`, mirrored in SQL by `data/list.ts#forYouFilter`) |
| `domain/routing.ts` | which desk a parent's message goes to |
| `domain/words.ts` | the head that says who writes, previews, the parent-facing words |
| `domain/nudges.ts` | when a waiting chat nudges its desk on WhatsApp, and when it is passed up to the admins |
| `domain/go-links.ts` | the one-tap `/go/<code>` link that opens a person's Chats |
| `domain/templates.ts` | the two Meta templates the chats own (`vpps_staff_open_one_*`, `vpps_parent_school_message_*`) |
| `data/inbound.ts` | a parent's message into its chat, from Veer Patta AI's turn (`whatsapp/data/helper-turn.ts`) |
| `data/handoff.ts` | a hand-off Veer Patta AI makes opens the desk's chat, or joins the one already there (`whatsapp/data/helper-relay.ts`) |
| `data/send.ts` | a message from school: kept, sent, or waiting for the parent's next message |
| `data/manage.ts` | take over, hand back, pass to another desk (merging into the family's chat there), finish, reopen |
| `data/nudges.ts` | the job behind `/api/jobs/parent-chats` (pg_cron, every 2 minutes) |
| `src/vx/screens/chats/` | the screens; `src/vx/shell/chats-nudge.tsx` the strip and pop-up on every screen |
| `data/list.ts#waitingChatsFor` | how many parents wait on a person: the menu badge, the strip, the teacher's More tile and Needs you's "N parents are waiting" job (`needs-you/data/chats.ts`, D-634) all read this one count |
| `supabase/migrations/20261115034215_parent_chats.sql`, `…044716_parent_chats_pass.sql` | the tables, functions and permissions |

## What must hold

- **Two people never answer one parent at once.** An admin replies on the
  office desk; on a teacher's or the accounts desk they take the chat over,
  and the desk reads it until it is handed back.
- **WhatsApp's own rules come first** (`checkWhatsAppSend`): practice mode,
  the helper's switch, and while `whatsapp_real_recipients` is off only the
  owner's test number. A message they stop is not kept.
- **After the parent's 24 hours a typed message waits.** The parent is told
  once, by an approved template, and everything waiting goes the moment they
  write (`deliverHeldMessages`).
- **A repeated tap sends nothing twice**: every message from school carries
  the browser's `client_ref`, unique in the table.
- **Practice chats only in the test session, real chats only in the real
  year**, whoever is looking (the owner's rule for test accounts).
- **"For you" is one rule in two places**: `isForYou` and `forYouFilter`.
  `tests/chats-domain.test.ts` checks them against each other.

## What must never happen

- A parent's message changing student or school data (the owner's rule of
  12 Nov): chats carry words and files, nothing else.
- A send to a real parent before the owner switches real recipients on.
- A teacher seeing money: the Fees-due filter is for admins and the fee desk.
