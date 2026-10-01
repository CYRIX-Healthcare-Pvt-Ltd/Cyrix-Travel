/*
  te_0001 — Travel Expense: a field engineer's day on the road, leg by leg.

  As the user laid it out (1 Oct 2026): the engineer starts from home or a
  new place, changes mode along the way (bike, car, bus, train, auto), stops
  at facilities for a ticket, a PM visit, a meeting or a spare pickup, and
  ends the trip. Each leg has its own mode, distance and amount; bike and
  car (own car, Uber, local taxi) are paid per km, bus, train and auto on
  the actual fare with a photograph of the bill. Closing a stop needs a
  photograph taken there and then, with where it was taken. A facility's
  place is learned from the first visit, once the manager approves it, and
  a stop closed more than 300 m from it is flagged for the manager, not
  refused. One claim per trip, to the reporting manager.

  Reads are by row-level security: your own, your downline's, and the
  software administrator's. Every write goes through a function here.
*/

-- ---------------------------------------------------------------------
-- Rates and settings
-- ---------------------------------------------------------------------
create table if not exists public.travel_modes (
  mode       text primary key,
  label      text not null,
  -- Paid per km when set; otherwise on the actual fare, with its bill.
  per_km     numeric(8,2),
  sort_order int not null default 0,
  is_active  boolean not null default true,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.employees(id) on delete set null
);
insert into public.travel_modes (mode, label, per_km, sort_order) values
  ('bike', 'Bike', 5, 1),
  ('car', 'Car / taxi', 11, 2),
  ('bus', 'Bus', null, 3),
  ('train', 'Train', null, 4),
  ('auto', 'Auto', null, 5)
on conflict (mode) do nothing;

create table if not exists public.travel_settings (
  key   text primary key,
  value jsonb not null
);
insert into public.travel_settings (key, value) values ('facility_radius_m', '300'::jsonb)
on conflict (key) do nothing;

-- ---------------------------------------------------------------------
-- Where people start, and where facilities are
-- ---------------------------------------------------------------------
create table if not exists public.travel_homes (
  employee_id uuid primary key references public.employees(id) on delete cascade,
  lat         double precision not null,
  lng         double precision not null,
  set_at      timestamptz not null default now()
);

create table if not exists public.travel_facilities (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (length(btrim(name)) between 2 and 200),
  -- Compared without case or spacing, so "GH Kasaragod" is one place.
  name_key    text not null unique,
  lat         double precision not null,
  lng         double precision not null,
  -- Learned from a first visit: used for checking once a manager approves it.
  status      text not null default 'pending' check (status in ('pending', 'approved')),
  learned_from uuid,
  created_by  uuid references public.employees(id) on delete set null,
  approved_by uuid references public.employees(id) on delete set null,
  approved_at timestamptz,
  created_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Trips, their legs and their stops
-- ---------------------------------------------------------------------
create sequence if not exists public.travel_trip_number;

create table if not exists public.travel_trips (
  id            uuid primary key default gen_random_uuid(),
  number        int not null default nextval('public.travel_trip_number') unique,
  code          text generated always as ('TE-' || lpad(number::text, greatest(2, length(number::text)), '0')) stored,
  employee_id   uuid not null references public.employees(id) on delete restrict,
  status        text not null default 'open' check (status in ('open', 'submitted', 'approved', 'returned')),
  start_kind    text not null check (start_kind in ('home', 'new')),
  start_lat     double precision not null,
  start_lng     double precision not null,
  start_note    text check (start_note is null or length(start_note) <= 200),
  started_at    timestamptz not null default now(),
  end_lat       double precision,
  end_lng       double precision,
  ended_at      timestamptz,
  total_km      numeric(10,2) not null default 0,
  total_amount  numeric(12,2) not null default 0,
  submitted_at  timestamptz,
  decided_by    uuid references public.employees(id) on delete set null,
  decided_at    timestamptz,
  decision_note text check (decision_note is null or length(decision_note) <= 500),
  created_at    timestamptz not null default now()
);
create index if not exists travel_trips_employee on public.travel_trips (employee_id, started_at desc);
-- One trip on the road at a time.
create unique index if not exists travel_trips_one_open on public.travel_trips (employee_id) where status = 'open' and ended_at is null;

create table if not exists public.travel_legs (
  id         uuid primary key default gen_random_uuid(),
  trip_id    uuid not null references public.travel_trips(id) on delete cascade,
  seq        int not null,
  mode       text not null references public.travel_modes(mode),
  from_lat   double precision not null,
  from_lng   double precision not null,
  from_at    timestamptz not null default now(),
  to_lat     double precision,
  to_lng     double precision,
  to_at      timestamptz,
  -- The road distance the app worked out, and the straight line the database
  -- works out itself from the two points — the second is the check on the first.
  road_km    numeric(10,2),
  line_km    numeric(10,2),
  -- How the road distance was got: 'route' from the map service, 'line' when it could not be reached.
  km_source  text check (km_source in ('route', 'line')),
  rate       numeric(8,2),
  fare       numeric(10,2) check (fare is null or (fare >= 0 and fare <= 100000)),
  amount     numeric(12,2) not null default 0,
  bill_path  text,
  bill_lat   double precision,
  bill_lng   double precision,
  bill_at    timestamptz,
  unique (trip_id, seq)
);

create table if not exists public.travel_stops (
  id            uuid primary key default gen_random_uuid(),
  trip_id       uuid not null references public.travel_trips(id) on delete cascade,
  seq           int not null,
  kind          text not null check (kind in ('ticket', 'pm', 'meeting', 'spare')),
  ticket_no     text check (ticket_no is null or length(ticket_no) <= 60),
  facility_name text not null check (length(btrim(facility_name)) between 2 and 200),
  facility_id   uuid references public.travel_facilities(id) on delete set null,
  lat           double precision not null,
  lng           double precision not null,
  reached_at    timestamptz not null default now(),
  note          text check (note is null or length(note) <= 500),
  closed_at     timestamptz,
  proof_path    text,
  proof_lat     double precision,
  proof_lng     double precision,
  proof_at      timestamptz,
  -- Metres from the facility's approved place when the proof was taken; null while it has none.
  distance_m    int,
  flagged       boolean not null default false,
  unique (trip_id, seq)
);

-- ---------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------
/** Straight-line kilometres between two points (haversine). */
create or replace function public.travel_line_km(lat1 double precision, lng1 double precision, lat2 double precision, lng2 double precision)
returns numeric language sql immutable as $fn$
  select round((6371 * 2 * asin(sqrt(
    power(sin(radians(lat2 - lat1) / 2), 2)
    + cos(radians(lat1)) * cos(radians(lat2)) * power(sin(radians(lng2 - lng1) / 2), 2))))::numeric, 3)
$fn$;

create or replace function public.travel_point_ok(lat double precision, lng double precision)
returns boolean language sql immutable as $fn$
  select lat is not null and lng is not null and lat between -90 and 90 and lng between -180 and 180 and not (lat = 0 and lng = 0)
$fn$;

/** Has the module: given it in SW Admin, or the software administrator. */
create or replace function public.travel_has_access()
returns boolean language sql stable security definer set search_path to 'public' as $fn$
  select is_sw_admin() or exists (
    select 1 from employee_modules em where em.employee_id = current_employee_id() and em.module_code = 'travel')
$fn$;

/** May see this trip: its own engineer, anybody they report up to, the software administrator. */
create or replace function public.travel_can_see(p_employee_id uuid)
returns boolean language sql stable security definer set search_path to 'public' as $fn$
  select p_employee_id = current_employee_id() or is_sw_admin() or is_in_my_downline(p_employee_id)
$fn$;

/** Approves this person's claims: somebody above them, or the software administrator. Never themselves. */
create or replace function public.travel_approves(p_employee_id uuid)
returns boolean language sql stable security definer set search_path to 'public' as $fn$
  select p_employee_id <> current_employee_id() and (is_sw_admin() or is_in_my_downline(p_employee_id))
$fn$;

create or replace function public.travel_lock(p_trip_id uuid)
returns public.travel_trips language plpgsql security definer set search_path to 'public' as $fn$
declare t travel_trips;
begin
  select * into t from travel_trips where id = p_trip_id for update;
  if not found then raise exception 'That trip does not exist'; end if;
  return t;
end $fn$;

/** The trip's totals, from its legs. */
create or replace function public.travel_retotal(p_trip_id uuid)
returns void language sql security definer set search_path to 'public' as $fn$
  update travel_trips t
     set total_km = coalesce((select sum(coalesce(l.road_km, 0)) from travel_legs l where l.trip_id = t.id), 0),
         total_amount = coalesce((select sum(l.amount) from travel_legs l where l.trip_id = t.id), 0)
   where t.id = p_trip_id
$fn$;

/** A proof or bill photograph of this trip: <trip>/<name>.jpg, taken by its engineer. */
create or replace function public.travel_file_ok(p_trip_id uuid, p_path text)
returns boolean language sql immutable as $fn$
  select p_path ~ ('^' || p_trip_id::text || '/(bill|proof)-[0-9]{1,3}\.(jpg|jpeg|png|webp)$')
$fn$;

/** Ends the running leg at this point: the app's road distance, checked against the straight line. */
create or replace function public.travel_close_leg(p_trip travel_trips, p_lat double precision, p_lng double precision,
  p_road_km numeric, p_fare numeric, p_bill_path text, p_bill_lat double precision, p_bill_lng double precision)
returns void language plpgsql security definer set search_path to 'public' as $fn$
declare
  l    travel_legs;
  m    travel_modes;
  line numeric;
  road numeric;
  src  text;
begin
  select * into l from travel_legs where trip_id = p_trip.id and to_at is null order by seq desc limit 1 for update;
  if not found then raise exception 'There is no leg running'; end if;
  select * into m from travel_modes where mode = l.mode;
  line := travel_line_km(l.from_lat, l.from_lng, p_lat, p_lng);
  -- A road is never shorter than the straight line, and seldom three times it: outside that, the line stands.
  if p_road_km is not null and p_road_km >= line * 0.98 and p_road_km <= greatest(line * 3, line + 5) then
    road := round(p_road_km, 2); src := 'route';
  else
    road := round(line, 2); src := 'line';
  end if;
  if m.per_km is null then
    if p_fare is null then raise exception 'Enter the fare for the % leg', lower(m.label); end if;
    if p_bill_path is null or not travel_file_ok(p_trip.id, p_bill_path) then
      raise exception 'Take a photograph of the % bill', lower(m.label);
    end if;
    if not travel_point_ok(p_bill_lat, p_bill_lng) then raise exception 'The bill photograph has no location — allow location and take it again'; end if;
  end if;
  update travel_legs
     set to_lat = p_lat, to_lng = p_lng, to_at = now(), road_km = road, line_km = line, km_source = src,
         rate = m.per_km,
         fare = case when m.per_km is null then round(p_fare, 2) end,
         amount = case when m.per_km is null then round(p_fare, 2) else round(road * m.per_km, 2) end,
         bill_path = case when m.per_km is null then p_bill_path end,
         bill_lat = case when m.per_km is null then p_bill_lat end,
         bill_lng = case when m.per_km is null then p_bill_lng end,
         bill_at = case when m.per_km is null then now() end
   where id = l.id;
  perform travel_retotal(p_trip.id);
end $fn$;

-- ---------------------------------------------------------------------
-- The engineer's moves
-- ---------------------------------------------------------------------
create or replace function public.travel_set_home(p_lat double precision, p_lng double precision)
returns void language plpgsql security definer set search_path to 'public' as $fn$
begin
  if not travel_has_access() then raise exception 'Travel Expense has not been given to you yet'; end if;
  if not travel_point_ok(p_lat, p_lng) then raise exception 'Your location could not be read — allow location and try again'; end if;
  insert into travel_homes (employee_id, lat, lng) values (current_employee_id(), p_lat, p_lng)
  on conflict (employee_id) do update set lat = excluded.lat, lng = excluded.lng, set_at = now();
end $fn$;

create or replace function public.travel_start(p_kind text, p_lat double precision, p_lng double precision, p_mode text, p_note text default null)
returns jsonb language plpgsql security definer set search_path to 'public' as $fn$
declare
  me uuid := current_employee_id();
  t  travel_trips;
begin
  if me is null or not travel_has_access() then raise exception 'Travel Expense has not been given to you yet'; end if;
  if p_kind not in ('home', 'new') then raise exception 'Start from home or from a new place'; end if;
  if not travel_point_ok(p_lat, p_lng) then raise exception 'Your location could not be read — allow location and try again'; end if;
  if not exists (select 1 from travel_modes where mode = p_mode and is_active) then raise exception 'Choose how you are travelling'; end if;
  if exists (select 1 from travel_trips where employee_id = me and status = 'open' and ended_at is null) then
    raise exception 'You already have a trip running — end it first';
  end if;
  if p_kind = 'home' and not exists (select 1 from travel_homes where employee_id = me) then
    insert into travel_homes (employee_id, lat, lng) values (me, p_lat, p_lng);
  end if;
  insert into travel_trips (employee_id, start_kind, start_lat, start_lng, start_note)
  values (me, p_kind, p_lat, p_lng, nullif(btrim(coalesce(p_note, '')), ''))
  returning * into t;
  insert into travel_legs (trip_id, seq, mode, from_lat, from_lng) values (t.id, 1, p_mode, p_lat, p_lng);
  return jsonb_build_object('id', t.id, 'code', t.code);
end $fn$;

/** A trip of mine that is still on the road. */
create or replace function public.travel_mine_running(p_trip_id uuid)
returns public.travel_trips language plpgsql security definer set search_path to 'public' as $fn$
declare t travel_trips := travel_lock(p_trip_id);
begin
  if t.employee_id is distinct from current_employee_id() then raise exception 'This is not your trip'; end if;
  if t.status <> 'open' or t.ended_at is not null then raise exception 'This trip has ended'; end if;
  return t;
end $fn$;

create or replace function public.travel_change_mode(p_trip_id uuid, p_lat double precision, p_lng double precision, p_mode text,
  p_road_km numeric default null, p_fare numeric default null, p_bill_path text default null,
  p_bill_lat double precision default null, p_bill_lng double precision default null)
returns void language plpgsql security definer set search_path to 'public' as $fn$
declare t travel_trips := travel_mine_running(p_trip_id);
begin
  if not travel_point_ok(p_lat, p_lng) then raise exception 'Your location could not be read — allow location and try again'; end if;
  if not exists (select 1 from travel_modes where mode = p_mode and is_active) then raise exception 'Choose how you are travelling next'; end if;
  perform travel_close_leg(t, p_lat, p_lng, p_road_km, p_fare, p_bill_path, p_bill_lat, p_bill_lng);
  insert into travel_legs (trip_id, seq, mode, from_lat, from_lng)
  values (t.id, (select coalesce(max(seq), 0) + 1 from travel_legs where trip_id = t.id), p_mode, p_lat, p_lng);
end $fn$;

create or replace function public.travel_reach(p_trip_id uuid, p_kind text, p_facility text, p_ticket_no text,
  p_lat double precision, p_lng double precision, p_note text default null)
returns uuid language plpgsql security definer set search_path to 'public' as $fn$
declare
  t   travel_trips := travel_mine_running(p_trip_id);
  fac text := btrim(coalesce(p_facility, ''));
  tk  text := nullif(btrim(coalesce(p_ticket_no, '')), '');
  key text;
  f   travel_facilities;
  sid uuid;
begin
  if p_kind not in ('ticket', 'pm', 'meeting', 'spare') then raise exception 'Choose what this stop is for'; end if;
  if length(fac) < 2 then raise exception 'Enter the facility, or the place, you have reached'; end if;
  if p_kind = 'ticket' and tk is null then raise exception 'Enter the ticket ID you came for'; end if;
  if not travel_point_ok(p_lat, p_lng) then raise exception 'Your location could not be read — allow location and try again'; end if;
  if exists (select 1 from travel_stops where trip_id = t.id and closed_at is null) then
    raise exception 'Close the stop you are at before reaching another';
  end if;
  key := lower(regexp_replace(fac, '[^a-zA-Z0-9]+', '', 'g'));
  select * into f from travel_facilities where name_key = key;
  insert into travel_stops (trip_id, seq, kind, ticket_no, facility_name, facility_id, lat, lng, note)
  values (t.id, (select coalesce(max(seq), 0) + 1 from travel_stops where trip_id = t.id), p_kind, tk, fac, f.id, p_lat, p_lng,
          nullif(btrim(coalesce(p_note, '')), ''))
  returning id into sid;
  return sid;
end $fn$;

create or replace function public.travel_close_stop(p_stop_id uuid, p_proof_path text, p_lat double precision, p_lng double precision, p_note text default null)
returns jsonb language plpgsql security definer set search_path to 'public' as $fn$
declare
  s      travel_stops;
  t      travel_trips;
  f      travel_facilities;
  radius int := coalesce((select (value #>> '{}')::int from travel_settings where key = 'facility_radius_m'), 300);
  key    text;
  dist   int;
  flag   boolean := false;
begin
  select * into s from travel_stops where id = p_stop_id;
  if not found then raise exception 'That stop does not exist'; end if;
  t := travel_mine_running(s.trip_id);
  if s.closed_at is not null then raise exception 'This stop is already closed'; end if;
  if p_proof_path is null or not travel_file_ok(t.id, p_proof_path) then raise exception 'Take the proof photograph first'; end if;
  if not travel_point_ok(p_lat, p_lng) then raise exception 'The photograph has no location — allow location and take it again'; end if;
  key := lower(regexp_replace(s.facility_name, '[^a-zA-Z0-9]+', '', 'g'));
  select * into f from travel_facilities where name_key = key;
  if not found then
    -- The first visit: this is where the facility is, once the manager agrees.
    insert into travel_facilities (name, name_key, lat, lng, learned_from, created_by)
    values (s.facility_name, key, p_lat, p_lng, s.id, current_employee_id()) returning * into f;
  elsif f.status = 'approved' then
    dist := round(travel_line_km(f.lat, f.lng, p_lat, p_lng) * 1000);
    flag := dist > radius;
  end if;
  update travel_stops
     set closed_at = now(), proof_path = p_proof_path, proof_lat = p_lat, proof_lng = p_lng, proof_at = now(),
         facility_id = f.id, distance_m = dist, flagged = flag,
         note = coalesce(nullif(btrim(coalesce(p_note, '')), ''), note)
   where id = s.id;
  return jsonb_build_object('flagged', flag, 'distance_m', dist, 'facility_status', f.status);
end $fn$;

create or replace function public.travel_end(p_trip_id uuid, p_lat double precision, p_lng double precision,
  p_road_km numeric default null, p_fare numeric default null, p_bill_path text default null,
  p_bill_lat double precision default null, p_bill_lng double precision default null)
returns void language plpgsql security definer set search_path to 'public' as $fn$
declare t travel_trips := travel_mine_running(p_trip_id);
begin
  if not travel_point_ok(p_lat, p_lng) then raise exception 'Your location could not be read — allow location and try again'; end if;
  if exists (select 1 from travel_stops where trip_id = t.id and closed_at is null) then
    raise exception 'Close the stop you are at, with its photograph, before ending the trip';
  end if;
  perform travel_close_leg(t, p_lat, p_lng, p_road_km, p_fare, p_bill_path, p_bill_lat, p_bill_lng);
  update travel_trips set end_lat = p_lat, end_lng = p_lng, ended_at = now() where id = t.id;
end $fn$;

create or replace function public.travel_submit(p_trip_id uuid)
returns void language plpgsql security definer set search_path to 'public' as $fn$
declare t travel_trips := travel_lock(p_trip_id);
begin
  if t.employee_id is distinct from current_employee_id() then raise exception 'This is not your trip'; end if;
  if t.ended_at is null then raise exception 'End the trip before submitting it'; end if;
  if t.status not in ('open', 'returned') then raise exception 'This claim has already been submitted'; end if;
  update travel_trips set status = 'submitted', submitted_at = now(), decided_by = null, decided_at = null where id = t.id;
end $fn$;

-- ---------------------------------------------------------------------
-- The manager's
-- ---------------------------------------------------------------------
create or replace function public.travel_decide(p_trip_id uuid, p_approve boolean, p_note text default null)
returns void language plpgsql security definer set search_path to 'public' as $fn$
declare
  t   travel_trips := travel_lock(p_trip_id);
  why text := nullif(btrim(coalesce(p_note, '')), '');
begin
  if not travel_approves(t.employee_id) then raise exception 'Only this person''s manager can decide their claim'; end if;
  if t.status <> 'submitted' then raise exception 'This claim is not waiting for a decision'; end if;
  if not p_approve and (why is null or length(why) < 5) then raise exception 'Say why it is sent back'; end if;
  update travel_trips
     set status = case when p_approve then 'approved' else 'returned' end,
         decided_by = current_employee_id(), decided_at = now(), decision_note = left(why, 500)
   where id = t.id;
  -- Approving the claim agrees where its first-visit facilities are.
  if p_approve then
    update travel_facilities f set status = 'approved', approved_by = current_employee_id(), approved_at = now()
     where f.status = 'pending' and f.learned_from in (select s.id from travel_stops s where s.trip_id = t.id);
  end if;
end $fn$;

create or replace function public.travel_set_rate(p_mode text, p_per_km numeric)
returns void language plpgsql security definer set search_path to 'public' as $fn$
begin
  if not is_sw_admin() then raise exception 'Only the software administrator can change the rates'; end if;
  if p_per_km is not null and (p_per_km <= 0 or p_per_km > 500) then raise exception 'A rate is between ₹0 and ₹500 a km'; end if;
  update travel_modes set per_km = p_per_km, updated_at = now(), updated_by = current_employee_id() where mode = p_mode;
  if not found then raise exception 'That mode does not exist'; end if;
end $fn$;

/** Whose claims wait on me, with their names — employees is not readable row by row for a whole downline. */
create or replace function public.travel_trip_list()
returns table(id uuid, code text, employee_id uuid, employee_name text, employee_ecode text, status text,
  started_at timestamptz, ended_at timestamptz, total_km numeric, total_amount numeric, submitted_at timestamptz,
  decided_at timestamptz, decided_by_name text, decision_note text, stops int, flags int, mine boolean, can_decide boolean)
language sql stable security definer set search_path to 'public' as $fn$
  select t.id, t.code, t.employee_id, e.full_name, e.ecode, t.status, t.started_at, t.ended_at, t.total_km, t.total_amount,
         t.submitted_at, t.decided_at, d.full_name, t.decision_note,
         (select count(*)::int from travel_stops s where s.trip_id = t.id),
         (select count(*)::int from travel_stops s where s.trip_id = t.id and s.flagged)
           + (select count(*)::int from travel_legs l where l.trip_id = t.id and l.km_source = 'line'),
         t.employee_id = current_employee_id(),
         travel_approves(t.employee_id)
  from travel_trips t
  join employees e on e.id = t.employee_id
  left join employees d on d.id = t.decided_by
  where travel_can_see(t.employee_id)
  order by t.started_at desc
$fn$;

-- ---------------------------------------------------------------------
-- Who reads what
-- ---------------------------------------------------------------------
alter table public.travel_modes enable row level security;
alter table public.travel_settings enable row level security;
alter table public.travel_homes enable row level security;
alter table public.travel_facilities enable row level security;
alter table public.travel_trips enable row level security;
alter table public.travel_legs enable row level security;
alter table public.travel_stops enable row level security;

create policy travel_modes_read on public.travel_modes for select to authenticated using (travel_has_access());
create policy travel_settings_read on public.travel_settings for select to authenticated using (travel_has_access());
create policy travel_homes_read on public.travel_homes for select to authenticated using (employee_id = current_employee_id());
create policy travel_facilities_read on public.travel_facilities for select to authenticated using (travel_has_access());
create policy travel_trips_read on public.travel_trips for select to authenticated using (travel_can_see(employee_id));
create policy travel_legs_read on public.travel_legs for select to authenticated
  using (exists (select 1 from travel_trips t where t.id = trip_id and travel_can_see(t.employee_id)));
create policy travel_stops_read on public.travel_stops for select to authenticated
  using (exists (select 1 from travel_trips t where t.id = trip_id and travel_can_see(t.employee_id)));

revoke all on public.travel_modes, public.travel_settings, public.travel_homes, public.travel_facilities,
  public.travel_trips, public.travel_legs, public.travel_stops from anon, public;
grant select on public.travel_modes, public.travel_settings, public.travel_homes, public.travel_facilities,
  public.travel_trips, public.travel_legs, public.travel_stops to authenticated;

do $do$
declare f text;
begin
  for f in select p.oid::regprocedure::text from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname like 'travel\_%' loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated, service_role', f);
  end loop;
  -- Inner pieces: nobody calls these from a browser.
  revoke execute on function public.travel_lock(uuid) from authenticated;
  revoke execute on function public.travel_retotal(uuid) from authenticated;
  revoke execute on function public.travel_mine_running(uuid) from authenticated;
  revoke execute on function public.travel_close_leg(travel_trips, double precision, double precision, numeric, numeric, text, double precision, double precision) from authenticated;
end $do$;

-- ---------------------------------------------------------------------
-- Photographs: bills and proof, taken in the app
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('travel-proofs', 'travel-proofs', false, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

create policy travel_proofs_read on storage.objects for select to authenticated
  using (bucket_id = 'travel-proofs' and exists (
    select 1 from public.travel_trips t where t.id::text = (storage.foldername(name))[1] and public.travel_can_see(t.employee_id)));
create policy travel_proofs_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'travel-proofs' and exists (
    select 1 from public.travel_trips t where t.id::text = (storage.foldername(name))[1]
      and t.employee_id = public.current_employee_id() and t.status = 'open' and t.ended_at is null
      and public.travel_file_ok(t.id, name)));
