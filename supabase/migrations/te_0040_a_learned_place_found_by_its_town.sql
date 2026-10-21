-- Travel Expense · te_0040 · a learned place is found by its town too
-- A place named only by its kind ("Government Medical College", "General Hospital") had nothing to be found
-- by. The town or area of the ride that went there (the second and third parts of its map name) is kept
-- beside its own words: "thrissur medical" finds it. A place carrying the typed name comes first.

alter table public.te_facilities add column if not exists area text[] not null default '{}';

create or replace function public.te_place_area(p_full text)
 returns text[]
 language sql
 immutable
as $function$
  select te_place_words(split_part(coalesce(p_full, ''), ',', 2) || ' ' || split_part(coalesce(p_full, ''), ',', 3))
$function$;

create or replace function public.te_learn_places(p_day uuid, p_tickets jsonb)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v jsonb; t te_tickets; r record; f te_facilities; home travel_homes; owner uuid; nm text; ws text[]; kd text;
begin
  select k.employee_id into owner from te_days d join te_claims k on k.id = d.claim_id where d.id = p_day;
  select * into home from travel_homes where employee_id = owner;
  for v in select * from jsonb_array_elements(p_tickets) loop
    select * into t from te_tickets where id = (v->>'id')::uuid and day_id = p_day;
    continue when t.id is null or coalesce(btrim(t.place), '') = '';
    -- The ride that went there (or came from there): its full name and its pin.
    select x.full_name, x.lat, x.lng into r from (
      select rr.to_name as full_name, rr.to_lat as lat, rr.to_lng as lng, 0 as pref, rr.seq from te_rides rr
       where rr.day_id = p_day and rr.to_lat is not null and lower(btrim(split_part(rr.to_name, ',', 1))) = lower(btrim(t.place))
      union all
      select rr.from_name, rr.from_lat, rr.from_lng, 1, rr.seq from te_rides rr
       where rr.day_id = p_day and rr.from_lat is not null and lower(btrim(split_part(rr.from_name, ',', 1))) = lower(btrim(t.place))
    ) x order by x.pref, x.seq limit 1;
    if r.full_name is null or lower(btrim(t.place)) = 'home'
       or (home.employee_id is not null and te_km(home.lat, home.lng, r.lat, r.lng) < 0.3) then
      update te_tickets set facility_id = null where id = t.id;
      continue;
    end if;
    nm := btrim(t.place); ws := te_place_words(nm); kd := te_place_type(nm);
    if cardinality(ws) = 0 and kd is null then continue; end if;
    select * into f from te_facilities
     where not hidden and words = ws and kind is not distinct from kd and te_km(lat, lng, r.lat, r.lng) < 0.5
     order by te_km(lat, lng, r.lat, r.lng) limit 1;
    if f.id is null then
      insert into te_facilities (name, full_name, words, area, kind, lat, lng, district, first_by)
      values (nm, r.full_name, ws, te_place_area(r.full_name), kd, r.lat, r.lng, nullif(btrim(v->>'district'), ''), owner)
      returning * into f;
    elsif f.district is null and nullif(btrim(v->>'district'), '') is not null then
      update te_facilities set district = btrim(v->>'district') where id = f.id;
    end if;
    update te_tickets set facility_id = f.id where id = t.id;
  end loop;
end $function$;

create or replace function public.te_find_places(p_q text, p_lat float8 default null, p_lng float8 default null)
 returns table (id uuid, name text, full_name text, lat float8, lng float8, district text, visits int)
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  with q as (select te_place_words(p_q) as w, te_place_type(p_q) as k)
  select f.id, f.name, f.full_name, f.lat, f.lng, f.district,
         (select count(*)::int from te_tickets t where t.facility_id = f.id)
  from te_facilities f, q
  where travel_has_access() and not f.hidden and cardinality(q.w) > 0
    and not exists (select 1 from unnest(q.w) qw where not exists (select 1 from unnest(f.words || f.area) fw where fw like qw || '%'))
  order by (q.k is not null and f.kind = q.k) desc,
           -- Its own name before its town: "aluva" finds DH Aluva before a PHC that is merely in Aluva.
           (q.w <@ f.words) desc,
           case when p_lat is null then 0 else te_km(p_lat, p_lng, f.lat, f.lng) end,
           (select count(*) from te_tickets t where t.facility_id = f.id) desc
  limit 6
$function$;

update te_facilities set area = te_place_area(full_name);
