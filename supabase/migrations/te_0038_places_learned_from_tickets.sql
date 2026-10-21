-- Travel Expense · te_0038 · places learned from tickets
-- The user, 21 Oct: our facilities go by short names the map does not know (DH ALUVA is District
-- Hospital Aluva), many PHCs are not on the map at all, and private hospitals are serviced too, so no
-- list can be kept by anybody ("if sw admin add hospital then it will be his responsibility"). Instead
-- a place is learned when a ticket is saved against it: its name and the pin of the ride that went
-- there. The next engineer who types "aluva" is offered it before the map's own results.
--
-- One place is the same name and kind within half a kilometre: "DH Aluva" and "District Hospital
-- Aluva" are one. Its visits are the tickets saved against it. Nothing near the person's home is
-- learned. Anybody with Travel Expense finds them; a Travel admin or SW Admin can take a wrong one off.

-- The words that name the place, without the kind of facility: "District Hospital Aluva" → {aluva}.
create or replace function public.te_place_words(p text)
 returns text[]
 language sql
 immutable
as $function$
  select coalesce(array_agg(distinct w order by w), '{}')
  from unnest(regexp_split_to_array(lower(regexp_replace(coalesce(p, ''), '[^a-zA-Z0-9]+', ' ', 'g')), '\s+')) w
  where length(w) >= 2 and w not in ('primary', 'family', 'community', 'health', 'healthcare', 'centre', 'center', 'hospital', 'hosp', 'district', 'taluk', 'taluka', 'headquarters', 'headquarter', 'head', 'quarters', 'hq', 'general', 'urban', 'wellness', 'and', 'medical', 'college', 'government', 'govt', 'women', 'children', 'childrens', 'sub', 'block', 'area', 'new', 'additional', 'mental', 'the', 'of', 'unit', 'model', 'clinic', 'dispensary', '24x7', 'aam', 'phc', 'uphc', 'bphc', 'aphc', 'nphc', 'chc', 'uchc', 'fhc', 'ufhc', 'hwc', 'uhwc', 'thqh', 'thq', 'th', 'dh', 'dhh', 'dwh', 'sdh', 'gh', 'ah', 'mch', 'gmc', 'gmch', 'gmhc', 'wch', 'w', 'c')
$function$;

-- The kind of facility, the same for the short form and the full name.
create or replace function public.te_place_type(p text)
 returns text
 language sql
 immutable
as $function$
  select case
    when x ~ '\m(uphc|urban primary health cent(re|er))\M' then 'uphc'
    when x ~ '\m(uhwc|urban health (and |& )?wellness cent(re|er))\M' then 'uhwc'
    when x ~ '\m(hwc|health (and |& )?wellness cent(re|er))\M' then 'hwc'
    when x ~ '\m(phc|fhc|primary health cent(re|er)|family health cent(re|er))\M' then 'phc'
    when x ~ '\m(chc|community health cent(re|er))\M' then 'chc'
    when x ~ '\m(thqh|thq|taluk head ?quarters? hospital)\M' then 'thqh'
    when x ~ '\m(th|taluk hospital)\M' then 'th'
    when x ~ '\m(sdh|sub district hospital)\M' then 'sdh'
    when x ~ '\m(dh|dhh|district hospital|district head ?quarters? hospital)\M' then 'dh'
    when x ~ '\m(gh|general hospital)\M' then 'gh'
    when x ~ '\m(mch|gmc|gmch|medical college)\M' then 'mch'
    when x ~ '\m(wch|women (and |& )?child(ren)?)' or x ~ 'w ?& ?c' then 'wch'
  end
  from (select lower(coalesce(p, '')) as x) t
$function$;

create table if not exists public.te_facilities (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  full_name  text not null,
  words      text[] not null,
  kind       text,
  lat        double precision not null,
  lng        double precision not null,
  district   text,
  first_by   uuid references public.employees(id) on delete set null,
  created_at timestamptz not null default now(),
  hidden     boolean not null default false
);
create index if not exists te_facilities_words on public.te_facilities using gin (words);
alter table public.te_facilities enable row level security;
-- Read through te_find_places and te_admin_places only.

alter table public.te_tickets add column if not exists facility_id uuid references public.te_facilities(id) on delete set null;

-- Kilometres between two points, as the screens measure them.
create or replace function public.te_km(a_lat float8, a_lng float8, b_lat float8, b_lng float8)
 returns float8
 language sql
 immutable
as $function$
  select 6371 * 2 * asin(sqrt(power(sin(radians(b_lat - a_lat) / 2), 2)
    + cos(radians(a_lat)) * cos(radians(b_lat)) * power(sin(radians(b_lng - a_lng) / 2), 2)))
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
      insert into te_facilities (name, full_name, words, kind, lat, lng, district, first_by)
      values (nm, r.full_name, ws, kd, r.lat, r.lng, nullif(btrim(v->>'district'), ''), owner)
      returning * into f;
    elsif f.district is null and nullif(btrim(v->>'district'), '') is not null then
      update te_facilities set district = btrim(v->>'district') where id = f.id;
    end if;
    update te_tickets set facility_id = f.id where id = t.id;
  end loop;
end $function$;
revoke all on function public.te_learn_places(uuid, jsonb) from public, anon, authenticated;

-- What an engineer is offered for what they type: the place words must all be there (the last may be
-- half typed); the same kind first, then the nearest, then the most visited.
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
    and not exists (select 1 from unnest(q.w) qw where not exists (select 1 from unnest(f.words) fw where fw like qw || '%'))
  order by (q.k is not null and f.kind = q.k) desc,
           case when p_lat is null then 0 else te_km(p_lat, p_lng, f.lat, f.lng) end,
           (select count(*) from te_tickets t where t.facility_id = f.id) desc
  limit 6
$function$;
revoke all on function public.te_find_places(text, float8, float8) from public, anon;
grant execute on function public.te_find_places(text, float8, float8) to authenticated;

create or replace function public.te_admin_places()
 returns table (id uuid, name text, full_name text, district text, visits int, first_by text, created_at timestamptz)
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
begin
  if not (te_is_admin() or is_sw_admin()) then raise exception 'Only a Travel admin sees the learned places'; end if;
  return query
  select f.id, f.name, f.full_name, f.district, (select count(*)::int from te_tickets t where t.facility_id = f.id),
         e.full_name || ' (' || e.ecode || ')', f.created_at
  from te_facilities f left join employees e on e.id = f.first_by
  where not f.hidden order by f.name;
end $function$;
revoke all on function public.te_admin_places() from public, anon;
grant execute on function public.te_admin_places() to authenticated;

create or replace function public.te_hide_place(p_id uuid)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  if not (te_is_admin() or is_sw_admin()) then raise exception 'Only a Travel admin removes a learned place'; end if;
  update te_facilities set hidden = true where id = p_id;
  update te_tickets set facility_id = null where facility_id = p_id;
end $function$;
revoke all on function public.te_hide_place(uuid) from public, anon;
grant execute on function public.te_hide_place(uuid) to authenticated;

CREATE OR REPLACE FUNCTION public.te_save_day(p_claim uuid, p_day jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  c te_claims; r te_grade_rules; did uuid := (p_day->>'id')::uuid; x jsonb; amt numeric; n int := 0;
  other text;
begin
  select * into c from te_claims where id = p_claim;
  if not te_can_edit(p_claim) then raise exception 'This claim cannot be changed now'; end if;
  if (p_day->>'day')::date < c.month or (p_day->>'day')::date >= (c.month + interval '1 month') then
    raise exception 'That date is not in this month''s claim';
  end if;
  r := te_rule(c.grade);
  insert into te_days (id, claim_id, day, place, district, purpose, da_kind, da_amount, continues_day, remarks, place_lat, place_lng, da_auto)
  values (did, p_claim, (p_day->>'day')::date, p_day->>'place', p_day->>'district', p_day->>'purpose',
    coalesce(p_day->>'da_kind', 'none'), te_da(c.grade, coalesce(p_day->>'da_kind', 'none'), p_day->>'purpose'),
    nullif(p_day->>'continues_day', '')::date, p_day->>'remarks',
    nullif(p_day->>'place_lat', '')::float8, nullif(p_day->>'place_lng', '')::float8, nullif(p_day->>'da_auto', ''))
  on conflict (id) do update set day = excluded.day, place = excluded.place, district = excluded.district,
    purpose = excluded.purpose, da_kind = excluded.da_kind, da_amount = excluded.da_amount,
    continues_day = excluded.continues_day, remarks = excluded.remarks,
    place_lat = excluded.place_lat, place_lng = excluded.place_lng, da_auto = excluded.da_auto;

  delete from te_rides where day_id = did and id not in (select (v->>'id')::uuid from jsonb_array_elements(coalesce(p_day->'rides', '[]')) v);
  for x in select * from jsonb_array_elements(coalesce(p_day->'rides', '[]')) loop
    n := n + 1;
    amt := case x->>'mode'
      when 'bike' then coalesce((x->>'claimed_km')::numeric, 0) * coalesce(r.bike_rate, 5)
      when 'car'  then coalesce((x->>'claimed_km')::numeric, 0) * coalesce(r.car_rate, 11)
      else coalesce((x->>'fare')::numeric, 0) end;
    insert into te_rides (id, day_id, seq, from_name, from_lat, from_lng, to_name, to_lat, to_lng, mode, claimed_km, map_km, fare, amount, note)
    values ((x->>'id')::uuid, did, n, x->>'from_name', (x->>'from_lat')::float8, (x->>'from_lng')::float8,
      x->>'to_name', (x->>'to_lat')::float8, (x->>'to_lng')::float8, x->>'mode',
      nullif(x->>'claimed_km', '')::numeric, nullif(x->>'map_km', '')::numeric, nullif(x->>'fare', '')::numeric, round(amt, 2), x->>'note')
    on conflict (id) do update set seq = excluded.seq, from_name = excluded.from_name, from_lat = excluded.from_lat,
      from_lng = excluded.from_lng, to_name = excluded.to_name, to_lat = excluded.to_lat, to_lng = excluded.to_lng,
      mode = excluded.mode, claimed_km = excluded.claimed_km, map_km = excluded.map_km, fare = excluded.fare,
      amount = excluded.amount, note = excluded.note;
  end loop;

  delete from te_tickets where day_id = did and id not in (select (v->>'id')::uuid from jsonb_array_elements(coalesce(p_day->'tickets', '[]')) v);
  insert into te_tickets (id, day_id, ticket_no, service_report, place)
  select (v->>'id')::uuid, did, trim(v->>'ticket_no'), nullif(trim(v->>'service_report'), ''), nullif(trim(v->>'place'), '')
  from jsonb_array_elements(coalesce(p_day->'tickets', '[]')) v where coalesce(trim(v->>'ticket_no'), '') <> ''
  on conflict (id) do update set ticket_no = excluded.ticket_no, service_report = excluded.service_report, place = excluded.place;

  -- One hotel night. A room a colleague already claimed with this person cannot be claimed again (policy: no split claims).
  if p_day->'hotel' is not null and jsonb_typeof(p_day->'hotel') = 'object' and coalesce((p_day->'hotel'->>'amount')::numeric, 0) > 0 then
    select e.full_name || ' (' || e.ecode || ')' into other
    from te_hotels h join te_days d on d.id = h.day_id join te_claims k on k.id = d.claim_id join employees e on e.id = k.employee_id
    where h.shared_with = c.employee_id and d.day = (p_day->>'day')::date and k.id <> p_claim limit 1;
    if other is not null then raise exception 'This room is already claimed by % for that night', other; end if;
    insert into te_hotels (id, day_id, name, amount, occupancy, metro, shared_with)
    values ((p_day->'hotel'->>'id')::uuid, did, p_day->'hotel'->>'name', (p_day->'hotel'->>'amount')::numeric,
      coalesce(p_day->'hotel'->>'occupancy', 'single'), coalesce((p_day->'hotel'->>'metro')::boolean, false),
      (select id from employees where ecode = upper(trim(p_day->'hotel'->>'shared_ecode'))))
    on conflict (day_id) do update set id = excluded.id, name = excluded.name, amount = excluded.amount,
      occupancy = excluded.occupancy, metro = excluded.metro, shared_with = excluded.shared_with;
  else
    delete from te_hotels where day_id = did;
  end if;

  delete from te_expenses where day_id = did and id not in (select (v->>'id')::uuid from jsonb_array_elements(coalesce(p_day->'expenses', '[]')) v);
  insert into te_expenses (id, day_id, category, description, amount)
  select (v->>'id')::uuid, did, v->>'category', v->>'description', coalesce((v->>'amount')::numeric, 0)
  from jsonb_array_elements(coalesce(p_day->'expenses', '[]')) v where coalesce((v->>'amount')::numeric, 0) > 0
  on conflict (id) do update set category = excluded.category, description = excluded.description, amount = excluded.amount;

  -- Bills whose row is gone go with it; a service report with its ticket (te_0037).
  delete from te_bills b where b.claim_id = p_claim and b.owner_id not in (
    select id from te_rides where day_id in (select id from te_days where claim_id = p_claim)
    union select id from te_hotels where day_id in (select id from te_days where claim_id = p_claim)
    union select id from te_expenses where day_id in (select id from te_days where claim_id = p_claim)
    union select id from te_tickets where day_id in (select id from te_days where claim_id = p_claim))
    and b.created_at < now() - interval '1 day';
  -- Each ticket's hospital learned for everyone (te_0038).
  perform te_learn_places(did, coalesce(p_day->'tickets', '[]'));
  update te_claims set updated_at = now() where id = p_claim;
  return did;
end $function$;

-- What is already on the claims is learned now.
do $learn$
declare d record;
begin
  for d in select t.day_id, jsonb_agg(jsonb_build_object('id', t.id)) as tk from te_tickets t group by t.day_id loop
    perform te_learn_places(d.day_id, d.tk);
  end loop;
end $learn$;
