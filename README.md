# Cyrix Travel Expense

A field engineer's day on the road, leg by leg: start, change mode, reach a
facility, close the stop with a photograph, end the trip, and claim the
travel. Served at `app.cyrix.in/travel`, behind the portal's rewrite, on the
same Supabase project and sign-in as KPI and Revive Lab.

## Rules it carries

- **Bike and car** (own car, Uber, local taxi) are paid per kilometre; **bus,
  train and auto** on the actual fare, with a photograph of the bill. Rates
  are in `travel_modes` and changed on the Rates page by the software
  administrator.
- **A ride runs from one place to the next.** Reaching a place ("I am here")
  ends the ride that brought the engineer there; after the visit they start
  again, or end the trip there. On screen a leg is a "ride" and a stop a
  "visit": the words an engineer who has never seen the app understands.
- **An arrival is looked at before it is recorded.** "I am here" reads the
  phone's place and shows it on a small map (OpenStreetMap's tiles, no map
  library) with a ring as wide as the phone's own doubt; a weak reading is
  said to be one. Nothing is recorded until the engineer says yes, and they
  can read again or back out.
- **The engineer may give their own km** for a ride paid by the kilometre.
  It is shown beside the distance worked out, to them and to the manager,
  and is never what is paid on.
- **Distance** is the road distance between the points where the engineer
  pressed, from OpenStreetMap routing (OSRM's public server — free, no key).
  A leg made before rides ended at their stops is measured from its start,
  through each stop reached on it, to its end. The
  database works out the straight line through the same points itself and
  does not accept a road distance far from it; such a leg is paid on the
  straight line and marked.
- **Coming home is End trip, not a visit.** The Reached form says so, and
  says it first when the phone is at the saved home. A trip ended within
  300 m of that home is marked by the database (`ended_home`, te_0011), so
  its last ride reads "→ Home" to the engineer and to the manager, who
  cannot read the home itself.
- **Home** is marked with a press, or saved the first time a trip starts
  from home; it is shown on the Start card and on My places (behind the name
  in the header), and is moved only by standing at the new place and
  pressing.
- **Saved places** are a person's own names for places they start from
  often. A saved place names where the phone is — a marked point within
  300 m of one is called by its name — and never stands in for being there:
  no trip can start from the list.
- **A new starting place is marked, not typed.** A press reads where the phone
  is, and OpenStreetMap's place search (Nominatim's public server — free, no
  key) says what the place is called. The point is what is recorded; the name
  only says it in words, and a place that cannot be named is still marked.
- **Each mode has its own colour and its own vehicle**, the same wherever it
  appears; the one in force is drawn moving.
- **Photographs are taken in the app**, never chosen from the phone, and each
  carries where it was taken. Whether they are required at all is a setting
  the software administrator switches (the Rates page here, and the Travel
  Expense tab of SW Admin in KPI); while it is off a claim says where a
  photograph is missing. It is meant to be on.
- **A claim can be deleted** by its engineer while the manager does not hold
  it, and by the software administrator at any time. Its photographs go
  first, then the trip; the deletion is written to the audit log.
- **A stop is offered its name** from where the phone is: a facility whose
  place a manager has agreed, or else one of the engineer's saved places.
- **A facility's place is learned from the first visit**, once the manager
  approves that claim. A stop closed more than 300 m from it is marked for
  the manager, not refused.
- **One claim per trip**, to the reporting manager. A trip has no number
  while it is on the road or waiting to be sent; submitting it gives it the
  next TE number, shown as it is given. So a trip cancelled or never sent
  uses none, and the numbers run in the order claims were submitted.

## Run it

```
npm install
npm run dev      # http://localhost:5178/travel/
npm run build    # type-check and build into dist/travel
```

Copy `.env.example` to `.env.local` and fill in the two Supabase values — the
same public ones every module's bundle already carries.

## Deploy

A Vercel project named `cyrix-travel` (the portal rewrites `/travel` to
`cyrix-travel.vercel.app`), building the `main` branch of
`CYRIX-Healthcare-Pvt-Ltd/Cyrix-Travel` on every push. It needs
`VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`; `VITE_AUTH_EMAIL_DOMAIN`
may be left out, and is `cyrix.local` when it is. Database changes are in
`supabase/migrations`, applied one at a time.
