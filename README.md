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
- **Distance** is the road distance between the points where the engineer
  pressed, from OpenStreetMap routing (OSRM's public server — free, no key).
  The database works out the straight line itself and does not accept a road
  distance far from it; such a leg is paid on the straight line and marked.
- **Photographs are taken in the app**, never chosen from the phone, and each
  carries where it was taken.
- **A facility's place is learned from the first visit**, once the manager
  approves that claim. A stop closed more than 300 m from it is marked for
  the manager, not refused.
- **One claim per trip**, to the reporting manager.

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
`cyrix-travel.vercel.app`), with `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`
and `VITE_AUTH_EMAIL_DOMAIN`. Database changes are in `supabase/migrations`,
applied one at a time.
