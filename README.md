# Cyrix Travel Expense

A field engineer's monthly travel claim, day by day, under the 2026 travel
policy: each day's rides, the tickets attended, the daily allowance, a hotel
night and other expenses, each with its bills. The claim goes from the
engineer to the reporting manager, a coordinator when one is set, and the
Travel Desk, which pays it. Expense advances for out-of-state travel are
requested and settled here too.

> Part of **Cyrix One**, the platform at [app.cyrix.in](https://app.cyrix.in).
> System-wide picture: [Cyrix One Platform — System Architecture](https://claude.ai/artifact/HNYWoBqCJ6Xh3XcREuKpTu)
> (ask Adrian for access). Every repository: [REPOSITORIES.md](https://github.com/CYRIX-Healthcare-Pvt-Ltd/cyrix-platform/blob/main/docs/REPOSITORIES.md).

## At a glance

| | |
|---|---|
| Served at | `app.cyrix.in/travel` (portal rewrite to `cyrix-travel.vercel.app`) |
| Stack | React 18, TypeScript, Vite 5, Tailwind 3, react-router, `@supabase/supabase-js`; OpenStreetMap tiles, OSRM routing and Nominatim place search (public servers, no key) |
| Database | Shared Supabase project (the same one as KPI, Revive Lab and My Task); own tables `te_*` (and the older `travel_*`, no longer read) |
| Sign-in | The portal's session on app.cyrix.in (`<ecode>@cyrix.local`); the `travel` module |
| Hosting | Vercel project `cyrix-travel` |
| Maintainers | Kevin |
| Status | Live |

## Run locally

```bash
npm install
cp .env.example .env.local   # the two public Supabase values
npm run dev                  # http://localhost:5178/travel/
```

## Environment variables

| Name | Where it is set | Secret? | What it is for |
|---|---|---|---|
| `VITE_SUPABASE_URL` | `.env.local`, Vercel | no | The shared Supabase project URL |
| `VITE_SUPABASE_ANON_KEY` | `.env.local`, Vercel | no (publishable key) | Browser access; row-level security does the protecting |
| `VITE_AUTH_EMAIL_DOMAIN` | `.env.local`, Vercel | no | Domain an employee code becomes; defaults to `cyrix.local` |

Never put the service-role key or a database URL in `.env.local` for this app
or in Vercel: every `VITE_` value is readable by anyone who opens the site.
Mail (advances, claims) is sent by KPI's `travel-mail` edge function, whose
settings live in Supabase, not here.

## Database

Migrations are in `supabase/migrations` (`te_0001` … `te_0070`), applied by
hand one at a time, in order. `te_0001`–`te_0011` built the first,
trip-tracking design; `te_0012` replaced it with claims by the day and left the
old `travel_*` tables in place, unread. Every write goes through a `te_*`
function; reads are by row-level security (your own, your team's, and the
Travel Desk's and admins').

## Deploy

Vercel builds `main` of `CYRIX-Healthcare-Pvt-Ltd/Cyrix-Travel` on every push
(`npm run build` → `dist/travel`), with the three `VITE_` variables above.
Migrations are not deployed by anything: apply them before merging code that
needs them.

## Checks before merging

```bash
npm run build    # type-check and build into dist/travel
```

There are no unit tests yet (`npm test` runs Vitest, which finds none).

## How it works

These are the rules as the migrations now have them; the migration named
beside each one carries the reasoning.

- **A month's claim is made of day cards** (te_0012). A day has its rides
  (from → to, mode, km or fare), the tickets attended, one daily allowance, a
  hotel night and other expenses. **One claim a day**: a date already in
  another of the person's claims is refused, and the calendars mark it
  (te_0060, te_0061). A day added after the month was sent goes into the next
  part of that month, "Oct-26 · part 2" (te_0018).
- **Each ride carries its own purpose and call centre** (the project), the
  next ride starting with the last one's (te_0060, te_0022). A breakdown
  call's ticket ID is required on its ride, with an optional service report
  (te_0037, te_0060).
- **Bills**: anything over ₹300 needs one (te_0060). A file claimed before is
  refused, and a look-alike photo or the same bill number and amount is
  flagged with where it was claimed (te_0013, te_0032, te_0052). Courier and
  tools always need a bill (te_0062). An inter-district or interstate bus ride
  needs its ticket (te_0048).
- **The approval chain** is engineer → reporting manager → coordinator (when
  set) → Travel Desk (te_0012). Approvers can change amounts, and every change
  is kept with who made it and in what role (te_0027, te_0044). Sending back
  goes straight to the claimant.
- **Numbers**: a claim is numbered **TE-01, TE-02 …** when it is first sent
  (te_0019); an advance **EA-01 …** (te_0065).
- **Recall and delete**: while it waits on the manager and nobody has
  approved it, the person can take a claim back to edit (te_0021). A draft is
  deleted at once; a sent claim needs the manager to approve its deletion;
  SW Admin and ACC_ADMIN can delete anything not yet paid (te_0015, te_0016,
  te_0028).
- **Paid** is marked only by the Travel Desk, with the date and the bank UTR
  (te_0045).
- **Company bookings are not claimed twice** (te_0042). The Travel Desk uploads
  the MakeMyTrip myBiz report; a ticket that matches a company booking claims
  nothing.
- **Expense advances** (te_0063 onward): only for official travel out of the
  state; approved by the reporting manager, then the Travel Desk; taken off
  that month's claims and then the next; at most two a month and ₹20,000 in
  all.
- **Places are learned from tickets** (te_0038, te_0040): the next engineer
  who types "aluva" is offered the place a colleague's ticket was saved
  against, before the map's own results. Home is set on the map (te_0053).
- **Patterns** (te_0049): for approvers and the Travel Desk, per person over
  time, what a day and a ticket cost, km a day, km claimed against the map's,
  and what approvers had to cut.
- **Rates and policy** (allowances, limits, bill thresholds) are in
  `te_policy`, set by SW Admin and ACC_ADMIN on the Policy page.

| Page | Route | Who |
|---|---|---|
| Summary | `/` | everybody with the module |
| My claims | `/claims`, `/claim/:id`, `/claim/:id/day` | the claimant, and approvers on their claims |
| Advances | `/advances` | everybody with the module |
| My places | `/places` | everybody with the module |
| Approvals | `/approvals` | managers, coordinators, Travel Desk |
| Bookings | `/bookings` | Travel Desk, admins |
| Policy | `/policy` | SW Admin, ACC_ADMIN |

## Related docs

- [cyrix-platform README](https://github.com/CYRIX-Healthcare-Pvt-Ltd/cyrix-platform#readme): the portal and how a module is added
- [Cyrix-KPI](https://github.com/CYRIX-Healthcare-Pvt-Ltd/Cyrix-KPI#readme): the shared database, SW Admin (where the module is granted) and the `travel-mail` function
