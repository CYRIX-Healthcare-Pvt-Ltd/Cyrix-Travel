-- Travel Expense · te_0042 · what the company booked is not claimed again
-- The user, 21 Oct: flights, hotels, trains and buses are often booked by the company (MakeMyTrip
-- myBiz); "company booked for train 500, so again I cannot claim it". The Travel Desk uploads the
-- monthly report; its sheets (Flight, Hotel, Bus, Rail, Cab, Offline) carry each booking's id. A ticket
-- the engineer attaches is read for its booking id and PNR; when one is a company booking, that ride or
-- hotel night claims nothing — its company cost still counts in the trip's cost — and the approvers see
-- it, with any date that differs. A booking for the person in the month that no bill carries is shown
-- too. Remarks become required on a flight, a train and a hotel night.

-- ---------------------------------------------------------------- the report
create table if not exists public.te_company_uploads (
  id          uuid primary key,
  file_name   text,
  lines       int not null default 0,
  uploaded_by uuid references public.employees(id) on delete set null,
  uploaded_at timestamptz not null default now()
);
create table if not exists public.te_company_bookings (
  line_key      text primary key,
  booking_id    text not null,
  mode          text not null,
  action        text,
  pnr           text,
  created       date,
  travel_date   date,
  end_date      date,
  from_place    text,
  to_place      text,
  hotel         text,
  passengers    text,
  passenger_ids text,
  booker        text,
  amount        numeric,
  upload_id     uuid references public.te_company_uploads(id) on delete set null,
  uploaded_at   timestamptz not null default now()
);
create index if not exists te_company_bookings_id on public.te_company_bookings (booking_id);
create index if not exists te_company_bookings_pnr on public.te_company_bookings (pnr);
create index if not exists te_company_bookings_date on public.te_company_bookings (travel_date);
alter table public.te_company_uploads enable row level security;
alter table public.te_company_bookings enable row level security;
-- Read and written through the functions below only.

alter table public.te_bills add column if not exists refs text[] not null default '{}';
create index if not exists te_bills_refs on public.te_bills using gin (refs);
alter table public.te_rides add column if not exists company_booking text, add column if not exists company_amount numeric;
alter table public.te_hotels add column if not exists company_booking text, add column if not exists company_amount numeric,
  add column if not exists amount_before_company numeric, add column if not exists note text;

-- A booking, once: its kind, dates, places and people from its booking line, its cost net of every
-- change, cancellation and refund line.
create or replace function public.te_booking_card(p_booking text)
 returns jsonb
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select case when p_booking is null then null else (
    select jsonb_build_object('booking_id', p_booking, 'mode', k.mode, 'pnr', k.pnr, 'travel_date', k.travel_date, 'end_date', k.end_date,
      'from', k.from_place, 'to', k.to_place, 'hotel', k.hotel, 'passengers', k.passengers,
      'net', (select round(sum(x.amount), 2) from te_company_bookings x where x.booking_id = p_booking),
      'cancelled', exists (select 1 from te_company_bookings x where x.booking_id = p_booking and x.action = 'CANCELLATION'))
    from te_company_bookings k where k.booking_id = p_booking
    order by (k.action = 'BOOKING') desc, k.created limit 1) end
$function$;

-- The company booking a bill shows: its booking id, or its PNR.
create or replace function public.te_bill_company(b te_bills)
 returns text
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select k.booking_id from te_company_bookings k
  where cardinality(b.refs) > 0 and (k.booking_id = any(b.refs) or (k.pnr is not null and length(k.pnr) >= 5 and k.pnr = any(b.refs)))
  order by (k.action = 'BOOKING') desc limit 1
$function$;

-- Whether a booking's passengers are this person: by name, without Mr. or Ms., or by E-code.
create or replace function public.te_booking_for(p_names text, p_ids text, p_name text, p_ecode text)
 returns boolean
 language sql
 immutable
as $function$
  select coalesce(
    (length(btrim(coalesce(p_name, ''))) >= 4 and
      regexp_replace(regexp_replace(lower(coalesce(p_names, '')), '\m(mr|ms|mrs|dr|miss)\M|[^a-z]', ' ', 'g'), '\s+', ' ', 'g')
        like '%' || btrim(regexp_replace(regexp_replace(lower(p_name), '[^a-z]', ' ', 'g'), '\s+', ' ', 'g')) || '%')
    or (p_ecode is not null and upper(coalesce(p_ids, '')) ~ ('(^|[^A-Z0-9])' || upper(p_ecode) || '([^A-Z0-9]|$)')
        and coalesce(p_names, '') !~ '[,;]'), false)
$function$;

-- Every ride and hotel night of a claim still open, settled against the company bookings: a line a
-- company booking pays claims nothing and keeps the company's cost beside it; a line no longer matched
-- claims again what it did.
create or replace function public.te_apply_company(p_claim uuid)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare c te_claims; r te_grade_rules; x record; m text;
begin
  select * into c from te_claims where id = p_claim;
  if c.id is null or c.status in ('approved', 'paid') then return; end if;
  r := te_rule(c.grade);
  for x in select rr.* from te_rides rr join te_days d on d.id = rr.day_id where d.claim_id = p_claim loop
    select te_bill_company(b) into m from te_bills b where b.owner_id = x.id and te_bill_company(b) is not null limit 1;
    if m is not null then
      update te_rides set company_booking = m, company_amount = (te_booking_card(m)->>'net')::numeric, amount = 0 where id = x.id;
    elsif x.company_booking is not null then
      update te_rides set company_booking = null, company_amount = null,
        amount = round(case x.mode when 'bike' then coalesce(x.claimed_km, 0) * coalesce(r.bike_rate, 5)
                                   when 'car' then coalesce(x.claimed_km, 0) * coalesce(r.car_rate, 11)
                                   else coalesce(x.fare, 0) end, 2)
      where id = x.id;
    end if;
  end loop;
  for x in select h.* from te_hotels h join te_days d on d.id = h.day_id where d.claim_id = p_claim loop
    select te_bill_company(b) into m from te_bills b where b.owner_id = x.id and te_bill_company(b) is not null limit 1;
    if m is not null then
      update te_hotels set company_booking = m, company_amount = (te_booking_card(m)->>'net')::numeric,
        amount_before_company = case when x.company_booking is null then x.amount else x.amount_before_company end, amount = 0
      where id = x.id;
    elsif x.company_booking is not null then
      update te_hotels set company_booking = null, company_amount = null, amount = coalesce(x.amount_before_company, x.amount), amount_before_company = null
      where id = x.id;
    end if;
  end loop;
end $function$;
revoke all on function public.te_apply_company(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------- bills carry what was read off them
drop function if exists public.te_add_bill(uuid, text, uuid, text, text, text, bigint, numeric, date, text, text);
create function public.te_add_bill(p_claim uuid, p_kind text, p_owner uuid, p_path text, p_name text, p_sha256 text, p_phash bigint,
  p_amount numeric, p_date date, p_billno text, p_phash2 text default null, p_refs text[] default null)
 returns uuid
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare used text; bid uuid;
begin
  if not te_can_edit(p_claim) then raise exception 'This claim cannot be changed now'; end if;
  select te_bill_label(b) into used from te_bills b where b.sha256 = p_sha256;
  if used is not null then raise exception '% as %', case when p_kind = 'report' then 'Same file' else 'Same bill' end, used; end if;
  insert into te_bills (claim_id, owner_kind, owner_id, path, name, sha256, phash, phash2, ocr_amount, ocr_date, ocr_billno, uploaded_by, refs)
  values (p_claim, p_kind, p_owner, p_path, p_name, p_sha256, p_phash, nullif(p_phash2, ''), p_amount, p_date, nullif(trim(p_billno), ''), current_employee_id(),
    coalesce((select array_agg(distinct upper(btrim(x))) from unnest(p_refs) x where length(btrim(x)) >= 5), '{}'))
  returning id into bid;
  perform te_apply_company(p_claim);
  return bid;
end $function$;
revoke all on function public.te_add_bill(uuid, text, uuid, text, text, text, bigint, numeric, date, text, text, text[]) from public, anon;
grant execute on function public.te_add_bill(uuid, text, uuid, text, text, text, bigint, numeric, date, text, text, text[]) to authenticated;

create or replace function public.te_remove_bill(p_bill uuid)
 returns text
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare b te_bills;
begin
  select * into b from te_bills where id = p_bill;
  if b.id is null or not te_can_edit(b.claim_id) then raise exception 'This claim cannot be changed now'; end if;
  delete from te_bills where id = p_bill;
  perform te_apply_company(b.claim_id);
  return b.path;
end $function$;

-- ---------------------------------------------------------------- the Travel Desk's upload and list
create or replace function public.te_upload_bookings(p_upload uuid, p_file text, p_rows jsonb)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare n int := 0; cl uuid;
begin
  if not (te_is_desk() or te_is_admin() or is_sw_admin()) then raise exception 'Only the Travel Desk uploads company bookings'; end if;
  insert into te_company_uploads (id, file_name, uploaded_by) values (p_upload, p_file, current_employee_id()) on conflict (id) do nothing;
  insert into te_company_bookings (line_key, booking_id, mode, action, pnr, created, travel_date, end_date, from_place, to_place, hotel,
    passengers, passenger_ids, booker, amount, upload_id)
  select concat_ws('|', upper(btrim(v->>'booking_id')), v->>'action', v->>'created', v->>'amount'), upper(btrim(v->>'booking_id')), v->>'mode', v->>'action',
    nullif(upper(btrim(v->>'pnr')), ''), nullif(v->>'created', '')::date, nullif(v->>'travel_date', '')::date, nullif(v->>'end_date', '')::date,
    nullif(btrim(v->>'from'), ''), nullif(btrim(v->>'to'), ''), nullif(btrim(v->>'hotel'), ''), nullif(btrim(v->>'passengers'), ''),
    nullif(btrim(v->>'passenger_ids'), ''), nullif(btrim(v->>'booker'), ''), nullif(v->>'amount', '')::numeric, p_upload
  from jsonb_array_elements(p_rows) v
  where coalesce(btrim(v->>'booking_id'), '') <> ''
  on conflict (line_key) do update set mode = excluded.mode, pnr = excluded.pnr, travel_date = excluded.travel_date, end_date = excluded.end_date,
    from_place = excluded.from_place, to_place = excluded.to_place, hotel = excluded.hotel, passengers = excluded.passengers,
    passenger_ids = excluded.passenger_ids, booker = excluded.booker, upload_id = excluded.upload_id, uploaded_at = now();
  get diagnostics n = row_count;
  update te_company_uploads set lines = lines + n where id = p_upload;
  -- Claims still open whose bills carry one of these bookings are settled now.
  for cl in select distinct b.claim_id from te_bills b
            where exists (select 1 from jsonb_array_elements(p_rows) v
                          where upper(btrim(v->>'booking_id')) = any(b.refs) or (nullif(upper(btrim(v->>'pnr')), '') = any(b.refs))) loop
    perform te_apply_company(cl);
  end loop;
  return jsonb_build_object('lines', n);
end $function$;
revoke all on function public.te_upload_bookings(uuid, text, jsonb) from public, anon;
grant execute on function public.te_upload_bookings(uuid, text, jsonb) to authenticated;

create or replace function public.te_bookings(p_from date default null, p_to date default null)
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
begin
  if not (te_is_desk() or te_is_admin() or is_sw_admin()) then raise exception 'Only the Travel Desk sees company bookings'; end if;
  return jsonb_build_object(
    'uploads', coalesce((select jsonb_agg(jsonb_build_object('file', u.file_name, 'lines', u.lines, 'at', u.uploaded_at, 'by', e.full_name) order by u.uploaded_at desc)
      from (select * from te_company_uploads order by uploaded_at desc limit 10) u left join employees e on e.id = u.uploaded_by), '[]'),
    'bookings', coalesce((select jsonb_agg(te_booking_card(x.booking_id) || jsonb_build_object('claims', (
        select coalesce(jsonb_agg(distinct jsonb_build_object('number', coalesce(k.number, 'Draft'), 'id', k.id, 'name', ee.full_name, 'ecode', ee.ecode)), '[]')
        from te_bills b join te_claims k on k.id = b.claim_id join employees ee on ee.id = k.employee_id
        where x.booking_id = any(b.refs) or (x.pnr is not null and x.pnr = any(b.refs)))) order by x.travel_date desc nulls last, x.booking_id)
      from (select distinct on (booking_id) booking_id, travel_date, pnr from te_company_bookings
            where (p_from is null or travel_date >= p_from) and (p_to is null or travel_date <= p_to)
            order by booking_id, (action = 'BOOKING') desc) x), '[]'));
end $function$;
revoke all on function public.te_bookings(date, date) from public, anon;
grant execute on function public.te_bookings(date, date) to authenticated;

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
    insert into te_hotels (id, day_id, name, note, amount, occupancy, metro, shared_with)
    values ((p_day->'hotel'->>'id')::uuid, did, p_day->'hotel'->>'name', nullif(btrim(p_day->'hotel'->>'note'), ''), (p_day->'hotel'->>'amount')::numeric,
      coalesce(p_day->'hotel'->>'occupancy', 'single'), coalesce((p_day->'hotel'->>'metro')::boolean, false),
      (select id from employees where ecode = upper(trim(p_day->'hotel'->>'shared_ecode'))))
    on conflict (day_id) do update set id = excluded.id, name = excluded.name, note = excluded.note,
      amount = case when te_hotels.company_booking is not null then te_hotels.amount else excluded.amount end,
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
  -- A ride or night the company booked claims nothing (te_0042).
  perform te_apply_company(p_claim);
  update te_claims set updated_at = now() where id = p_claim;
  return did;
end $function$;

CREATE OR REPLACE FUNCTION public.te_claim(p_claim uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare c te_claims; out jsonb; me uuid := current_employee_id();
begin
  if not te_can_see(p_claim) then raise exception 'That claim is not yours to see'; end if;
  select * into c from te_claims where id = p_claim;
  select jsonb_build_object(
    'claim', to_jsonb(c) || jsonb_build_object(
      'name', e.full_name, 'ecode', e.ecode,
      'manager', (select full_name from employees where id = e.reporting_manager_id),
      'coordinator', (select x.full_name from te_coordinators k join employees x on x.id = k.coordinator_id where k.employee_id = c.employee_id),
      'mine', c.employee_id = me,
      'can_edit', te_can_edit(p_claim),
      'can_decide', (c.status = 'with_manager' and (e.reporting_manager_id = me or te_is_admin()))
        or (c.status = 'with_coordinator' and (exists (select 1 from te_coordinators k where k.employee_id = c.employee_id and k.coordinator_id = me) or te_is_admin()))
        or (c.status = 'with_desk' and te_is_desk()),
      'is_desk', te_is_desk(),
      'is_manager', e.reporting_manager_id = me),
    'rule', to_jsonb(te_rule(c.grade)),
    'days', coalesce((select jsonb_agg(jsonb_build_object(
        'id', d.id, 'day', d.day, 'place', d.place, 'district', d.district, 'purpose', d.purpose,
        'da_kind', d.da_kind, 'da_amount', d.da_amount, 'continues_day', d.continues_day, 'remarks', d.remarks,
        'place_lat', d.place_lat, 'place_lng', d.place_lng, 'da_auto', d.da_auto,
        'rides', coalesce((select jsonb_agg(to_jsonb(r) order by r.seq) from te_rides r where r.day_id = d.id), '[]'),
        'tickets', coalesce((select jsonb_agg(to_jsonb(t) || jsonb_build_object('earlier', (
          select coalesce(jsonb_agg(jsonb_build_object('day', d2.day, 'name', e2.full_name, 'mine', k2.employee_id = c.employee_id) order by d2.day), '[]')
          from te_tickets t2 join te_days d2 on d2.id = t2.day_id join te_claims k2 on k2.id = d2.claim_id join employees e2 on e2.id = k2.employee_id
          where t2.ticket_no = t.ticket_no and d2.day < d.day))) from te_tickets t where t.day_id = d.id), '[]'),
        'hotel', (select to_jsonb(h) || jsonb_build_object('shared_ecode', (select ecode from employees where id = h.shared_with),
                    'shared_name', (select full_name from employees where id = h.shared_with)) from te_hotels h where h.day_id = d.id),
        'room_by', (select jsonb_build_object('name', x.full_name, 'ecode', x.ecode, 'amount', h.amount, 'number', k.number)
                    from te_hotels h join te_days dd on dd.id = h.day_id join te_claims k on k.id = dd.claim_id join employees x on x.id = k.employee_id
                    where h.shared_with = c.employee_id and dd.day = d.day and k.id <> c.id limit 1),
        'expenses', coalesce((select jsonb_agg(to_jsonb(x)) from te_expenses x where x.day_id = d.id), '[]')
      ) order by d.day) from te_days d where d.claim_id = c.id), '[]'),
    'bills', coalesce((select jsonb_agg(jsonb_build_object('id', b.id, 'owner_kind', b.owner_kind, 'owner_id', b.owner_id,
        'path', b.path, 'name', b.name, 'ocr_amount', b.ocr_amount, 'ocr_date', b.ocr_date, 'ocr_billno', b.ocr_billno,
        -- Possibly the same bill again (te_0032): the same bill number and amount read off it, or the same
        -- picture within 12 of 256 bits; a bill from before keeps its coarse picture, held to 2 of 64. Which
        -- bill it looks like, too (te_0036), so two alike on one claim are told as one pair.
        'twin', case when (tw.o).id is not null then te_bill_label(tw.o) end,
        'twin_owner', (tw.o).owner_id, 'twin_claim', (tw.o).claim_id,
        'refs', b.refs, 'company', te_booking_card(te_bill_company(b))))
      from te_bills b
      left join lateral (select o from te_bills o
                 where o.id <> b.id and b.owner_kind <> 'report' and o.owner_kind <> 'report' and (
                   (b.ocr_billno is not null and o.ocr_billno = b.ocr_billno and o.ocr_amount is not distinct from b.ocr_amount)
                   or (b.phash2 is not null and o.phash2 is not null and bit_count(('x' || b.phash2)::bit(256) # ('x' || o.phash2)::bit(256)) <= 12)
                   or ((b.phash2 is null or o.phash2 is null) and b.phash is not null and o.phash is not null and bit_count((b.phash # o.phash)::bit(64)) <= 2))
                 limit 1) tw(o) on true
      where b.claim_id = c.id), '[]'),
    'km_month', (select jsonb_build_object(
        'bike', coalesce(sum(r.claimed_km) filter (where r.mode = 'bike'), 0),
        'car', coalesce(sum(r.claimed_km) filter (where r.mode = 'car'), 0),
        'auto', coalesce(sum(r.fare) filter (where r.mode = 'auto'), 0),
        'phone', (select coalesce(sum(x.amount), 0) from te_expenses x join te_days dx on dx.id = x.day_id join te_claims kx on kx.id = dx.claim_id
                  where kx.employee_id = c.employee_id and kx.month = c.month and x.category = 'Phone'))
      from te_rides r join te_days d on d.id = r.day_id join te_claims k on k.id = d.claim_id
      where k.employee_id = c.employee_id and k.month = c.month),
    -- Where the person moved their home while this claim was open (te_0041), for the approvers.
    'home_moves', coalesce((select jsonb_agg(jsonb_build_object('at', m.at, 'km', m.km, 'first', m.from_lat is null) order by m.at)
      from te_home_moves m where m.employee_id = c.employee_id and m.from_lat is not null
        and m.at >= c.month and m.at <= coalesce(c.submitted_at, now())), '[]'),
    -- Bookings the company made for this person in the claim's month that no bill on any claim carries (te_0042).
    'company_unlinked', coalesce((select jsonb_agg(te_booking_card(x.booking_id) order by x.travel_date)
      from (select distinct on (k.booking_id) k.booking_id, k.travel_date from te_company_bookings k
            where k.action in ('BOOKING', 'Date_Change', 'OFFLINE_MODIFICATION')
              and k.travel_date >= c.month and k.travel_date < (c.month + interval '1 month')
              and te_booking_for(k.passengers, k.passenger_ids, e.full_name, e.ecode)
              and not exists (select 1 from te_bills bb where k.booking_id = any(bb.refs) or (k.pnr is not null and k.pnr = any(bb.refs)))
            order by k.booking_id) x), '[]'),
    'policy', (select jsonb_object_agg(key, value) from te_policy),
    'purposes', (select jsonb_agg(label order by sort, label) from te_purposes where is_active),
    'office_purposes', (select coalesce(jsonb_agg(label), '[]') from te_purposes where not gives_da),
    'history', coalesce((select jsonb_agg(jsonb_build_object('id', v.id, 'at', v.at, 'action', v.action, 'to_status', v.to_status,
        'note', v.note, 'actor', a.full_name) order by v.at, v.id)
      from te_events v left join employees a on a.id = v.actor_id where v.claim_id = c.id), '[]'),
    'adjustments', coalesce((select jsonb_agg(jsonb_build_object('item_id', j.item_id, 'unit', j.unit, 'old_value', j.old_value, 'new_value', j.new_value,
        'old_amount', j.old_amount, 'new_amount', j.new_amount, 'reason', j.reason, 'by', b.full_name, 'at', j.at) order by j.at)
      from te_adjustments j left join employees b on b.id = j.by_id where j.claim_id = c.id), '[]')
  ) into out
  from employees e where e.id = c.employee_id;
  return out;
end $function$;

CREATE OR REPLACE FUNCTION public.te_submit(p_claim uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare c te_claims; due date; late int := 0; steps jsonb := te_pol('late_pct'); over numeric := (te_pol('bill_over'))::text::numeric; missing text;
begin
  select * into c from te_claims where id = p_claim;
  if not te_can_edit(p_claim) then raise exception 'This claim cannot be sent now'; end if;
  if not exists (select 1 from te_days where claim_id = p_claim) then raise exception 'Add at least one day first'; end if;
  -- A home first (te_0041): the daily allowance and the first ride of a day are reckoned from it.
  if not exists (select 1 from travel_homes where employee_id = c.employee_id) then
    raise exception 'Mark your home first: open Add a claim and press I''m at home while you are there';
  end if;
  -- Bills the policy asks for, each named (the user, 19 Oct: "don't know in which is having error").
  select string_agg(item, '; ' order by ord, item) into missing from (
    select d.day as ord, to_char(d.day, 'FMDD Mon') || ' · ' || initcap(r.mode) || ' ride ' || split_part(coalesce(r.from_name, '—'), ',', 1) || ' → ' || split_part(coalesce(r.to_name, '—'), ',', 1) as item
    from te_rides r join te_days d on d.id = r.day_id
    where d.claim_id = p_claim and (r.mode in ('bus', 'train', 'flight') or (r.mode not in ('bike', 'car') and r.amount > over)) and not exists (select 1 from te_bills b where b.owner_id = r.id)
    union all
    select d.day, to_char(d.day, 'FMDD Mon') || ' · Hotel night' from te_hotels h join te_days d on d.id = h.day_id
    where d.claim_id = p_claim and not exists (select 1 from te_bills b where b.owner_id = h.id)
    union all
    select d.day, to_char(d.day, 'FMDD Mon') || ' · ' || x.category from te_expenses x join te_days d on d.id = x.day_id
    where d.claim_id = p_claim and (x.amount > over or x.category in ('Courier', 'Toll', 'Client meal', 'Team meal')) and not exists (select 1 from te_bills b where b.owner_id = x.id)
  ) s;
  if missing is not null then raise exception 'Attach the bill for %', missing; end if;
  -- Remarks on every flight, train and hotel night (te_0042; the user, 21 Oct).
  select string_agg(item, '; ' order by ord, item) into missing from (
    select d.day as ord, to_char(d.day, 'FMDD Mon') || ' · ' || initcap(r.mode) || ' ' || split_part(coalesce(r.from_name, '—'), ',', 1) || ' → ' || split_part(coalesce(r.to_name, '—'), ',', 1) as item
    from te_rides r join te_days d on d.id = r.day_id
    where d.claim_id = p_claim and r.mode in ('flight', 'train') and coalesce(btrim(r.note), '') = ''
    union all
    select d.day, to_char(d.day, 'FMDD Mon') || ' · Hotel night' from te_hotels h join te_days d on d.id = h.day_id
    where d.claim_id = p_claim and coalesce(btrim(h.note), '') = ''
  ) s;
  if missing is not null then raise exception 'Write the remarks for %', missing; end if;
  -- Late: due by the 5th of the next month; 1, 2, 3 months after that take 10, 20, 30 percent; later is refused.
  due := (c.month + interval '1 month')::date + ((te_pol('submit_by_day'))::text::int - 1);
  if current_date > due then
    late := ((extract(year from age(current_date, due)) * 12 + extract(month from age(current_date, due)))::int) + 1;
    if late > jsonb_array_length(steps) then raise exception 'This month is more than % months late and cannot be claimed', jsonb_array_length(steps); end if;
    late := (steps->>(late - 1))::int;
  end if;
  update te_claims set status = 'with_manager', submitted_at = now(), late_pct = late, return_note = null,
    number = coalesce(number, te_number(nextval('te_claim_seq')::int)),
    updated_at = now()
  where id = p_claim returning number into c.number;
  return c.number;
end $function$;
