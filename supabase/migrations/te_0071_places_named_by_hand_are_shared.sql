/*
  te_0071 — a place the map does not have, named by hand, is offered to everyone; an admin puts its name right.

  The user, 26 Oct: "not only location with ticket, earlier example was cyrix healthcare was not showing" — a spot
  pressed on the map, or pasted from Google Maps, and given a name, was kept only on that ride; only a ticket's
  hospital was learned (te_0038). Now any such place is learned once a day using it is saved, and the next
  engineer who types its name finds it.

  "we should give it their official name isnt?": every learned place is new until a Travel admin or SW Admin has
  checked it — put its name right or moved its pin (te_edit_place), or ticked it as right as it is (te_check_place).
  Engineers use a new place straight away; nobody's claim waits for the check.
*/
alter table public.te_facilities add column if not exists source text not null default 'ticket';
alter table public.te_facilities add column if not exists checked_at timestamptz;
alter table public.te_facilities add column if not exists checked_by uuid references public.employees(id) on delete set null;

-- The places named by hand on a day just saved: each must be an end of one of its rides, not home or near it,
-- and not a place already known there.
create or replace function public.te_learn_named_places(p_day uuid, p_places jsonb)
 returns int
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  owner uuid; home travel_homes; v jsonb; nm text; la float8; lo float8; ws text[]; kd text; n int := 0;
begin
  select k.employee_id into owner from te_days d join te_claims k on k.id = d.claim_id where d.id = p_day;
  if owner is null or owner is distinct from current_employee_id() then raise exception 'That day is not yours'; end if;
  select * into home from travel_homes where employee_id = owner;
  for v in select * from jsonb_array_elements(coalesce(p_places, '[]'::jsonb)) loop
    nm := btrim(coalesce(v->>'name', ''));
    la := nullif(v->>'lat', '')::float8; lo := nullif(v->>'lng', '')::float8;
    continue when length(nm) < 2 or lower(nm) = 'home' or la is null or lo is null;
    continue when not exists (select 1 from te_rides r where r.day_id = p_day
      and ((abs(r.to_lat - la) < 1e-6 and abs(r.to_lng - lo) < 1e-6) or (abs(r.from_lat - la) < 1e-6 and abs(r.from_lng - lo) < 1e-6)));
    continue when home.employee_id is not null and te_km(home.lat, home.lng, la, lo) < 0.3;
    ws := te_place_words(nm); kd := te_place_type(nm);
    continue when cardinality(ws) = 0 and kd is null;
    -- Known already: the same name within half a kilometre, or any place within a hundred metres.
    continue when exists (select 1 from te_facilities f where not f.hidden
      and ((f.words = ws and f.kind is not distinct from kd and te_km(f.lat, f.lng, la, lo) < 0.5) or te_km(f.lat, f.lng, la, lo) < 0.1));
    insert into te_facilities (name, full_name, words, area, kind, lat, lng, district, first_by, source)
    values (nm, nm, ws, '{}', kd, la, lo, nullif(btrim(coalesce(v->>'district', '')), ''), owner, 'named');
    n := n + 1;
  end loop;
  return n;
end $function$;
revoke all on function public.te_learn_named_places(uuid, jsonb) from public, anon;
grant execute on function public.te_learn_named_places(uuid, jsonb) to authenticated;

-- The admins' list says how each came, when, by whom, and whether it has been checked.
drop function if exists public.te_admin_places();
create function public.te_admin_places()
 returns table (id uuid, name text, full_name text, district text, visits int, first_by text, created_at timestamptz, lat float8, lng float8,
                source text, checked_at timestamptz, checked_by text)
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
begin
  if not (te_is_admin() or is_sw_admin()) then raise exception 'Only a Travel admin sees the learned places'; end if;
  return query
  select f.id, f.name, f.full_name, f.district, (select count(*)::int from te_tickets t where t.facility_id = f.id),
         e.full_name || ' (' || e.ecode || ')', f.created_at, f.lat, f.lng,
         f.source, f.checked_at, c.full_name
  from te_facilities f left join employees e on e.id = f.first_by left join employees c on c.id = f.checked_by
  where not f.hidden order by f.created_at desc;
end $function$;
revoke all on function public.te_admin_places() from public, anon;
grant execute on function public.te_admin_places() to authenticated;

-- Ticked as right as it is, or the tick taken back.
create or replace function public.te_check_place(p_id uuid, p_checked boolean default true)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  if not (te_is_admin() or is_sw_admin()) then raise exception 'Only a Travel admin checks a learned place'; end if;
  update te_facilities set checked_at = case when p_checked then now() end, checked_by = case when p_checked then current_employee_id() end
   where id = p_id and not hidden;
  if not found then raise exception 'That place is no longer there'; end if;
end $function$;
revoke all on function public.te_check_place(uuid, boolean) from public, anon;
grant execute on function public.te_check_place(uuid, boolean) to authenticated;

-- Putting its name or pin right is checking it.
create or replace function public.te_edit_place(p_id uuid, p_name text, p_lat float8, p_lng float8)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  if not (te_is_admin() or is_sw_admin()) then raise exception 'Only a Travel admin changes a learned place'; end if;
  if length(btrim(coalesce(p_name, ''))) < 2 then raise exception 'Give the place a name'; end if;
  if not travel_point_ok(p_lat, p_lng) then raise exception 'Put the pin on the map'; end if;
  update te_facilities set name = btrim(p_name), words = te_place_words(p_name), kind = te_place_type(p_name), lat = p_lat, lng = p_lng,
         checked_at = now(), checked_by = current_employee_id()
   where id = p_id and not hidden;
  if not found then raise exception 'That place is no longer there'; end if;
end $function$;
