# Transport

Which children ride each bus route, when each bus leaves, and who drives it.

Transport (`/transport`, owner, 7 Nov 2026, D-550). Janmejay asked to see the
children per route and per time of day, to give each route a driver, and to
know which driver goes where. Before this, One only had an "On bus" filter on
Students.

## Three things, and where each lives

| Thing | Owner | Where One reads it |
|---|---|---|
| **Route** (a village or an area of town) and which route each child is on | Fees | Route names: `vppsone.fees_bridge_routes`, a copy of `GET /api/one/v1/sync/routes`. The child's route: `transport_route_id` on the nightly roster copy (`fees_bridge_students`). A TEST session reads the local `public.transport_routes` and `public.students` instead. |
| **Driver** | One | `vppsone.transport_drivers`, per session |
| **Trip**: one bus run at one time of day, with its bus, driver, helper and its routes in order (stops, each with an optional time) | One | `vppsone.transport_trips` + `transport_trip_stops`, per session |

A child rides every trip that stops at their route, so "who is on the 7:05 bus"
and "which driver goes to this village" are worked out (`domain/board.ts`,
`buildBoard`), never stored twice.

## Files

- `domain/board.ts`: pure rules. The board (route cards, trips, drivers, gaps),
  search, and the checks for a bus and a driver. No database, no words.
- `data/routes.ts`: route names. The copy is replaced whole by
  `fees_bridge_replace_routes()`: after the nightly roster job, after an admin's
  "Refresh roster now", from the screen's "Get route names again", and once when
  the copy is empty or over 26 hours old. Until the copy exists the screen asks
  Fees directly and keeps the answer for ten minutes.
- `data/riders.ts`: the children with a route this session, through the fee
  schema client (the bridge projection for the real year).
- `data/fleet.ts`: drivers and trips. `{ ready: false }` while the tables are
  missing, so the screen still shows children per route.
- `data/writes.ts`: the only writes. Every statement names the session.
  `transport_save_trip()` saves a trip and its stops in one transaction, with an
  `updated_at` check so two people changing one bus cannot overwrite each other.

The screen is `src/vx/screens/transport/`; the page and server actions are
`src/app/(app)/transport/`.

## Who may do what

- `transport:view` opens the screen; `transport:manage` adds the buttons that
  change buses and drivers. Both are the admin's and the office's
  (migration `20261107165001`), and Staff → Roles can give them to anyone.
- Every action checks `transport:manage`, refuses a "see the app as" preview,
  and refuses when the session the screen showed is not the account's session
  now or one it may write.

## Never

- **Never write a route or a child's route here.** Fees owns them. To move a
  child to another route, change it in Fees; the screen says so.
- **Never fetch the route names more often than the rules above.** The roster
  copy is nightly by owner decision (D-457); the route names ride on it.
- **Never count a "No Transport" child as a bus rider.** That row is a
  placeholder (`isSentinelNoTransportRoute`), not a route.
- **Never offer to send a new bus or driver again when the answer was lost.**
  It may have saved; a second copy is the one mistake a person cannot see from
  the form. The form says to look at the list instead.
