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
| Stack | React 18, TypeScript, Vite 5, Tailwind 3, react-router, `@supabase/supabase-js`; OpenStreetMap tiles, OSRM routing and Nominatim place search (public servers, no key); Google Routes API (Compute Routes Essentials) for a ride's road km since 19 Nov 2026 |
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
| `VITE_GOOGLE_MAPS_KEY` | `.env.local`, Vercel | ships to the browser, so restrict it in Google Cloud (Routes API only, `app.cyrix.in` referrer) | Google's roads for a ride (`src/lib/googleRoutes.ts`); without it rides fall back to the OSRM map |

Never put the service-role key or a database URL in `.env.local` for this app
or in Vercel: every `VITE_` value is readable by anyone who opens the site.
Mail (advances, claims, vehicle approvals) is sent by KPI's `travel-mail` edge
function, and KPI's `travel-photos`, `place-link` and `bemp-ticket` functions
clear paid visit photos, read Google Maps share links and look up BEMP tickets;
their settings live in Supabase, not here.

## Database

Migrations are in `supabase/migrations` (`te_0001` … `te_0174` as of 26 Nov 2026), applied by
hand one at a time, in order. `te_0001`–`te_0011` built the first,
trip-tracking design; `te_0012` replaced it with claims by the day and left the
old `travel_*` tables in place, unread. Every write goes through a `te_*`
function; reads are by row-level security (your own, your team's, and the
Travel Desk's and admins').

| Migrations | What they cover |
|---|---|
| te_0001–te_0011 | The first, trip-tracking design (left in place, unread) |
| te_0012–te_0070 | Claims by the day, bills, the approval chain, numbers, bookings, advances, places, patterns |
| te_0071–te_0073, te_0085, te_0087–te_0088, te_0102–te_0103, te_0159 | Places named by hand are shared, a second home, home required and changed at most monthly, the home circle setting |
| te_0074, te_0096–te_0097, te_0122–te_0123, te_0160, te_0167–te_0168, te_0174 | Uber, taxi and bike; out-of-policy vehicle approval; Aurum grades and per diem; Specialists' DA; the monthly auto limit |
| te_0075–te_0078, te_0090, te_0172 | Deputation: a state, dates and a letter, approved by the manager |
| te_0082–te_0084, te_0086, te_0088–te_0089, te_0092, te_0108, te_0120–te_0121, te_0124, te_0147 | Visit photos: one per visit, matched to a ride, removed after payment |
| te_0104, te_0107, te_0109–te_0110, te_0113, te_0129, te_0150–te_0157, te_0169–te_0170 | Start my day and End my day, reminders, restarts |
| te_0093–te_0094, te_0081, te_0105, te_0133–te_0135, te_0173 | Claim a day within 3 days, manager recall and delete, bills needed on send, not a bill |
| te_0079, te_0112, te_0130, te_0140–te_0149, te_0161–te_0166, te_0171 | Km: the desk's km, route screenshots, km bands, Google's roads and longer-road reasons |
| te_0095, te_0098–te_0101, te_0111, te_0114–te_0119, te_0136–te_0139 | Reports for SW Admin, policy history, live usage, the Travel Desk's live view and the watch log |
| te_0126–te_0128, te_0132, te_0138 | Advances by name, cost centre and manager mail; mail copies |
| te_0158 | Feedback by voice |

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
- **Start my day and End my day** (te_0104, te_0109, te_0150 onward): a
  working day opens with a location press and is ended before the next one
  starts or is claimed; reminders at the end of the day and at 10 pm. Ride 1
  starts where the day started. A day can be restarted with a reason
  (te_0170).
- **Visit photos** (te_0082 onward): one photo per visit, taken in the app,
  matched to the ride it belongs to, and deleted once the claim is paid
  (KPI's `travel-photos`, nightly).
- **Claims within 3 days** (te_0093): a day can be added only within three
  days of it.
- **Road km** (te_0140 onward, te_0161 onward): since 19 Nov a ride's map km is
  Google's road, within the month's free requests only (te_0163); the engineer
  may pick another of Google's roads, with a reason when it is longer than the
  limits in Settings (te_0165, te_0166). Days before that keep the km allowance
  and the route screenshot.
- **Deputation** (te_0075): a state, dates and the letter, asked for in My
  profile and approved by the reporting manager; claims from that state carry
  the deputation DA and tag.
- **Grades** (te_0122, te_0168): what a grade may travel by and claim (Aurum's
  per diem and windows, Specialists' DA in te_0160); a vehicle the grade does
  not give needs an out-of-policy approval (te_0096).
- **Feedback** (te_0158): a mic in the top bar records up to a minute for
  SW Admin.
- **Rates and policy** (allowances, limits, bill thresholds) are in
  `te_policy`, set by SW Admin and ACC_ADMIN on the Policy page.

| Page | Route | Who |
|---|---|---|
| Summary | `/` | everybody with the module |
| My claims | `/claims`, `/claim/:id`, `/claim/:id/day` | the claimant, and approvers on their claims |
| Advances | `/advances` | everybody with the module |
| My places | `/places` | everybody with the module |
| Photo (Start my day, visit photos, End my day) | `/photos` | everybody with the module |
| My profile (home, deputation, vehicle approvals) | `/profile` | everybody with the module |
| Approvals | `/approvals`, `/approvals/person/:id` | managers, coordinators, Travel Desk |
| Bookings | `/bookings` | Travel Desk, admins |
| Policy | `/policy` | SW Admin, ACC_ADMIN |

## Related docs

- [cyrix-platform README](https://github.com/CYRIX-Healthcare-Pvt-Ltd/cyrix-platform#readme): the portal and how a module is added
- [Cyrix-KPI](https://github.com/CYRIX-Healthcare-Pvt-Ltd/Cyrix-KPI#readme): the shared database, SW Admin (where the module is granted) and the `travel-mail` function
