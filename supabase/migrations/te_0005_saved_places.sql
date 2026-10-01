/*
  te_0005 — places an engineer starts from often, saved under a name.

  A trip that does not start from home starts from "a new place", marked by
  a press and named by the map. The office, a branch store, a hotel used
  every month came out under whatever the map calls that spot, and a little
  differently each time. The engineer may now save a marked place under a
  name of their own (the user, 1 Oct: "in a new place also, we should have
  option to save this place, with name, so in profile under saved place we
  can see this").

  A saved place is a name for where the phone is, never a stand-in for
  being there: nothing here lets a trip start from a saved place. The point
  of every start is still read from the phone at the press; the app only
  says "Office" instead of the map's name when that point is at a saved
  place. So the table holds a name and a point per person, and nothing in
  the trip functions reads it.

  Each person sees and changes only their own. Twenty at most: a list to
  recognise places by, not a log of everywhere somebody has been.
*/
create table if not exists public.travel_places (
  id          uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id) on delete cascade,
  name        text not null check (length(btrim(name)) between 2 and 60),
  name_key    text not null,
  lat         double precision not null,
  lng         double precision not null,
  saved_at    timestamptz not null default now(),
  unique (employee_id, name_key)
);
create index if not exists travel_places_mine on public.travel_places (employee_id);

alter table public.travel_places enable row level security;
create policy travel_places_read on public.travel_places for select to authenticated using (employee_id = current_employee_id());
-- Read only, and only one's own: every write goes through the two functions below.
revoke all on public.travel_places from anon, public, authenticated;
grant select on public.travel_places to authenticated;

/** Saves where the engineer is standing under a name; the same name again moves that place here. */
create or replace function public.travel_save_place(p_name text, p_lat double precision, p_lng double precision)
returns uuid language plpgsql security definer set search_path to 'public' as $fn$
declare
  me  uuid := current_employee_id();
  nm  text := regexp_replace(btrim(coalesce(p_name, '')), '\s+', ' ', 'g');
  key text := lower(regexp_replace(nm, '[^a-zA-Z0-9]+', '', 'g'));
  pid uuid;
begin
  if me is null or not travel_has_access() then raise exception 'Travel Expense has not been given to you yet'; end if;
  if length(nm) < 2 or length(nm) > 60 or key = '' then raise exception 'Give the place a name, 2 to 60 letters'; end if;
  if not travel_point_ok(p_lat, p_lng) then raise exception 'Your location could not be read — allow location and try again'; end if;
  if not exists (select 1 from travel_places where employee_id = me and name_key = key)
     and (select count(*) from travel_places where employee_id = me) >= 20 then
    raise exception 'You have 20 saved places — remove one you no longer use first';
  end if;
  insert into travel_places (employee_id, name, name_key, lat, lng) values (me, nm, key, p_lat, p_lng)
  on conflict (employee_id, name_key) do update set name = excluded.name, lat = excluded.lat, lng = excluded.lng, saved_at = now()
  returning id into pid;
  return pid;
end $fn$;

/** Removes one of the engineer's own saved places. No trip is touched: a trip keeps the name it started under. */
create or replace function public.travel_forget_place(p_id uuid)
returns void language plpgsql security definer set search_path to 'public' as $fn$
begin
  delete from travel_places where id = p_id and employee_id = current_employee_id();
  if not found then raise exception 'That place is not one of yours'; end if;
end $fn$;

revoke all on function public.travel_save_place(text, double precision, double precision) from public, anon;
revoke all on function public.travel_forget_place(uuid) from public, anon;
grant execute on function public.travel_save_place(text, double precision, double precision) to authenticated, service_role;
grant execute on function public.travel_forget_place(uuid) to authenticated, service_role;
