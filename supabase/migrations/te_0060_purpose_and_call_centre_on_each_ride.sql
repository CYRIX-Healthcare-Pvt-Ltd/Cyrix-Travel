-- Travel Expense · te_0060 · purpose and call centre on each ride; one claim a day; bills above ₹300
-- The user, 23 Oct, after the first review with the team:
--  1. A day can mix purposes and call centres (a hospital visit for KL BEMMP, then a breakdown for Care 360): each
--     ride carries its own purpose and project (shown as "call centre"), the next ride starting with the last one's.
--  4. One claim a day, so one DA a day: a date already in another claim of the person's is refused.
--  5. A breakdown call's ticket is on its ride: its ticket ID (required) and service report, kept in te_tickets
--     under the ride's own id, so the approver's views and the places learned keep working.
--  3/7. A bill is needed for whatever comes to more than ₹300 — a bus, train, taxi, hotel night or expense —
--     and nothing else asks for one (the earlier per-mode and per-category rules are gone).
--  6. The ₹300 DA is out of district, staying; ₹400 out of state, staying (labels in the app; the codes stay).

alter table public.te_rides add column if not exists purpose text, add column if not exists project text;

update public.te_policy set value = '300'::jsonb where key = 'bill_over';

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
  -- One claim a day, so one DA a day (the user, 23 Oct): a date already in another of this person's claims is refused.
  select coalesce(k.number, 'your ' || to_char(k.month, 'FMMon') || ' draft') into other
    from te_days d join te_claims k on k.id = d.claim_id
   where k.employee_id = c.employee_id and k.id <> p_claim and d.day = (p_day->>'day')::date limit 1;
  if other is not null then
    raise exception '% is already claimed in % — one claim a day', to_char((p_day->>'day')::date, 'FMDD Mon'), other;
  end if;
  other := null;
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
    insert into te_rides (id, day_id, seq, from_name, from_lat, from_lng, to_name, to_lat, to_lng, mode, claimed_km, map_km, fare, amount, note, inter, same_ticket, ticket_date, return_leg, purpose, project)
    values ((x->>'id')::uuid, did, n, x->>'from_name', (x->>'from_lat')::float8, (x->>'from_lng')::float8,
      x->>'to_name', (x->>'to_lat')::float8, (x->>'to_lng')::float8, x->>'mode',
      nullif(x->>'claimed_km', '')::numeric, nullif(x->>'map_km', '')::numeric, nullif(x->>'fare', '')::numeric, round(amt, 2), x->>'note', nullif(x->>'inter', '')::boolean, case when jsonb_typeof(x->'same_ticket') = 'object' then x->'same_ticket' end, nullif(x->>'ticket_date', '')::date, case when jsonb_typeof(x->'return_leg') = 'object' then x->'return_leg' end,
      nullif(btrim(x->>'purpose'), ''), nullif(btrim(x->>'project'), ''))
    on conflict (id) do update set seq = excluded.seq, from_name = excluded.from_name, from_lat = excluded.from_lat,
      from_lng = excluded.from_lng, to_name = excluded.to_name, to_lat = excluded.to_lat, to_lng = excluded.to_lng,
      mode = excluded.mode, claimed_km = excluded.claimed_km, map_km = excluded.map_km, fare = excluded.fare,
      amount = excluded.amount, note = excluded.note, inter = excluded.inter, same_ticket = excluded.same_ticket, ticket_date = excluded.ticket_date, return_leg = excluded.return_leg,
      purpose = excluded.purpose, project = excluded.project;
  end loop;

  delete from te_tickets where day_id = did and id not in (select (v->>'id')::uuid from jsonb_array_elements(coalesce(p_day->'tickets', '[]')) v);
  insert into te_tickets (id, day_id, ticket_no, service_report, place)
  select (v->>'id')::uuid, did, trim(v->>'ticket_no'), nullif(trim(v->>'service_report'), ''), nullif(trim(v->>'place'), '')
  from jsonb_array_elements(coalesce(p_day->'tickets', '[]')) v where coalesce(trim(v->>'ticket_no'), '') <> ''
  on conflict (id) do update set ticket_no = excluded.ticket_no, service_report = excluded.service_report, place = excluded.place;

  -- One hotel night. A room a colleague already claimed with this person cannot be claimed again (policy: no split claims).
  -- A night the company paid claims ₹0 and is kept (te_0043).
  if p_day->'hotel' is not null and jsonb_typeof(p_day->'hotel') = 'object' and (coalesce((p_day->'hotel'->>'amount')::numeric, 0) > 0
     or exists (select 1 from te_hotels hh where hh.id = (p_day->'hotel'->>'id')::uuid and hh.company_booking is not null)
     or exists (select 1 from te_bills bb where bb.owner_id = (p_day->'hotel'->>'id')::uuid and te_bill_company(bb) is not null)) then
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
end $function$
;

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
  -- Bills the policy asks for, each named (the user, 19 Oct: "don't know in which is having error").
  select string_agg(item, '; ' order by ord, item) into missing from (
    select d.day as ord, to_char(d.day, 'FMDD Mon') || ' · ' || initcap(r.mode) || ' ride ' || split_part(coalesce(r.from_name, '—'), ',', 1) || ' → ' || split_part(coalesce(r.to_name, '—'), ',', 1) as item
    from te_rides r join te_days d on d.id = r.day_id
    where d.claim_id = p_claim and r.same_ticket is null and r.mode not in ('bike', 'car') and r.amount > over and not exists (select 1 from te_bills b where b.owner_id = r.id)
    union all
    select d.day, to_char(d.day, 'FMDD Mon') || ' · Hotel night' from te_hotels h join te_days d on d.id = h.day_id
    where d.claim_id = p_claim and h.amount > over and not exists (select 1 from te_bills b where b.owner_id = h.id)
    union all
    select d.day, to_char(d.day, 'FMDD Mon') || ' · ' || x.category from te_expenses x join te_days d on d.id = x.day_id
    where d.claim_id = p_claim and x.amount > over and not exists (select 1 from te_bills b where b.owner_id = x.id)
  ) s;
  if missing is not null then raise exception 'Attach the bill for %', missing; end if;
  -- A breakdown call names its ticket (te_0060).
  select string_agg(to_char(d.day, 'FMDD Mon') || ' · ' || initcap(r.mode) || ' ride ' || split_part(coalesce(r.from_name, '—'), ',', 1) || ' → ' || split_part(coalesce(r.to_name, '—'), ',', 1), '; ' order by d.day, r.seq)
    into missing
    from te_rides r join te_days d on d.id = r.day_id
   where d.claim_id = p_claim and r.purpose ilike '%breakdown%'
     and not exists (select 1 from te_tickets t where t.id = r.id and btrim(t.ticket_no) <> '');
  if missing is not null then raise exception 'Enter the ticket ID for %', missing; end if;
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
end $function$
;
