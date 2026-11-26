/*
  te_0140 — A Google Maps screenshot for a ride claimed well over the map (the user, 9 Nov, on Adith P K's Veekay Mall →
  Home, 58 km against the map's 46.8: "if they enter km more than 10%, can we ask them to post this?", "when we click
  check map, so it will open a pop up tab, so on that tab, we need scrnshot, so that will save to our app and checks the
  location km").

  The ride's map opens Google Maps with its From and To; the screenshot taken there is added on the same map, kept with
  the claim's bills (its own table, so it never counts as a bill), and the km read off it on the phone is kept with it.
  A bike or car ride more than route_shot_pct (10) over the map cannot be sent without one — for the test accounts
  only until it is tried out (the user, 9 Nov: "ok show only for test accounts now").
*/
insert into te_policy (key, value) values ('route_shot_pct', '10'::jsonb) on conflict (key) do nothing;

create table if not exists public.te_route_shots (
  id uuid primary key default gen_random_uuid(),
  claim_id uuid not null references public.te_claims(id) on delete cascade,
  -- No key on the ride: a day saved again keeps its rides' ids.
  ride_id uuid not null,
  path text not null unique,
  sha256 text not null,
  -- Every km figure read off it, and the one taken as the route's.
  kms numeric[] not null default '{}',
  km numeric,
  uploaded_by uuid references public.employees(id),
  created_at timestamptz not null default now(),
  unique (claim_id, ride_id)
);
alter table public.te_route_shots enable row level security;
revoke all on public.te_route_shots from anon, authenticated;

-- The claim's screenshots, for te_claim.
create or replace function public.te_route_shots_of(p_claim uuid)
returns jsonb language sql stable security definer set search_path to 'public' as $f$
  select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'ride_id', s.ride_id, 'path', s.path, 'km', s.km, 'kms', s.kms, 'created_at', s.created_at)
                            order by s.created_at), '[]')
  from te_route_shots s where s.claim_id = p_claim and te_can_see(p_claim)
$f$;
revoke all on function public.te_route_shots_of(uuid) from public, anon;
grant execute on function public.te_route_shots_of(uuid) to authenticated;

-- One screenshot a ride: a new one takes the old one's place, whose file path comes back to be removed.
create or replace function public.te_route_shot_add(p_claim uuid, p_ride uuid, p_path text, p_sha256 text, p_kms numeric[], p_km numeric)
returns text language plpgsql security definer set search_path to 'public' as $f$
declare old text;
begin
  if not te_can_edit(p_claim) then raise exception 'This claim cannot be changed now'; end if;
  if split_part(p_path, '/', 1) <> p_claim::text then raise exception 'Add the screenshot again'; end if;
  if exists (select 1 from te_route_shots where sha256 = p_sha256 and not (claim_id = p_claim and ride_id = p_ride))
     or exists (select 1 from te_bills where sha256 = p_sha256) then
    raise exception 'This screenshot is already added';
  end if;
  select path into old from te_route_shots where claim_id = p_claim and ride_id = p_ride;
  delete from te_route_shots where claim_id = p_claim and ride_id = p_ride;
  insert into te_route_shots (claim_id, ride_id, path, sha256, kms, km, uploaded_by)
  values (p_claim, p_ride, p_path, p_sha256, coalesce(p_kms, '{}'), p_km, current_employee_id());
  return old;
end $f$;
revoke all on function public.te_route_shot_add(uuid, uuid, text, text, numeric[], numeric) from public, anon;
grant execute on function public.te_route_shot_add(uuid, uuid, text, text, numeric[], numeric) to authenticated;

create or replace function public.te_route_shot_remove(p_id uuid)
returns text language plpgsql security definer set search_path to 'public' as $f$
declare s te_route_shots;
begin
  select * into s from te_route_shots where id = p_id;
  if s.id is null or not te_can_edit(s.claim_id) then raise exception 'This claim cannot be changed now'; end if;
  delete from te_route_shots where id = p_id;
  return s.path;
end $f$;
revoke all on function public.te_route_shot_remove(uuid) from public, anon;
grant execute on function public.te_route_shot_remove(uuid) to authenticated;

-- The claim carries its screenshots.
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
      'coordinator', (select full_name from employees where id = coalesce(c.coordinator_id, te_claim_coordinator(c.id))),
      'cost_centre', nullif(btrim(coalesce(e.function_name, '')), ''),
      -- What it takes from the person's advances (te_0063), worked out, and the Advance meter.
      'advance', te_claim_advance(c.id),
      'advance_box', te_advance_box(c.id),
      'mine', c.employee_id = me,
      'can_edit', te_can_edit(p_claim),
      'can_decide', (c.status = 'with_manager' and (e.reporting_manager_id = me or te_is_admin()))
        or (c.status = 'with_coordinator' and (te_claim_coordinator(c.id) = me or te_is_admin()))
        or (c.status = 'with_desk' and te_is_desk()),
      'is_desk', te_is_desk(),
      'is_manager', e.reporting_manager_id = me),
    'rule', to_jsonb(te_rule(c.grade)),
    'days', coalesce((select jsonb_agg(jsonb_build_object(
        'id', d.id, 'day', d.day, 'place', d.place, 'district', d.district, 'purpose', d.purpose,
        'da_kind', d.da_kind, 'da_amount', d.da_amount, 'continues_day', d.continues_day, 'remarks', d.remarks,
        'place_lat', d.place_lat, 'place_lng', d.place_lng, 'da_auto', d.da_auto, 'dep_off', d.dep_off,
        -- An auto ride carries what autos usually cost a km around where it started (te_0051).
        'rides', coalesce((select jsonb_agg(to_jsonb(r) || jsonb_build_object('auto_norm', case when r.mode = 'auto' then te_auto_norm(r.id) end) order by r.seq) from te_rides r where r.day_id = d.id), '[]'),
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
        'path', b.path, 'name', b.name, 'ocr_amount', b.ocr_amount, 'ocr_date', b.ocr_date, 'ocr_billno', b.ocr_billno, 'typed_amount', b.typed_amount, 'paid_at', b.paid_at,
        -- Possibly the same bill again (te_0032): the same bill number and amount read off it, or the same
        -- picture within 12 of 256 bits; a bill from before keeps its coarse picture, held to 2 of 64. Which
        -- bill it looks like, too (te_0036), so two alike on one claim are told as one pair.
        'twin', case when (tw.o).id is not null then te_bill_label(tw.o) end,
        'twin_owner', (tw.o).owner_id, 'twin_claim', (tw.o).claim_id,
        'refs', b.refs, 'company', te_booking_card(te_bill_company(b))))
      from te_bills b
      left join lateral (select o from te_bills o
                 where o.id <> b.id and b.owner_kind <> 'report' and o.owner_kind <> 'report' and (
                   (b.ocr_billno is not null and b.ocr_amount is not null and o.ocr_billno = b.ocr_billno and o.ocr_amount = b.ocr_amount)
                   or (b.phash2 is not null and o.phash2 is not null and bit_count(('x' || b.phash2)::bit(256) # ('x' || o.phash2)::bit(256)) <= 12)
                   or ((b.phash2 is null or o.phash2 is null) and b.phash is not null and o.phash is not null and bit_count((b.phash # o.phash)::bit(64)) <= 2))
                 limit 1) tw(o) on true
      where b.claim_id = c.id), '[]'),
    'km_month', (select jsonb_build_object(
        'bike', coalesce(sum(r.claimed_km) filter (where r.mode = 'bike'), 0),
        'car', coalesce(sum(r.claimed_km) filter (where r.mode = 'car'), 0),
        'auto', coalesce(sum(r.fare) filter (where r.mode = 'auto'), 0),
        'phone', (select coalesce(sum(x.amount), 0) from te_expenses x join te_days dx on dx.id = x.day_id join te_claims kx on kx.id = dx.claim_id
                  where kx.employee_id = c.employee_id and kx.month = c.month and x.category in (select label from te_expense_kinds where role = 'phone')))
      from te_rides r join te_days d on d.id = r.day_id join te_claims k on k.id = d.claim_id
      where k.employee_id = c.employee_id and k.month = c.month),
    -- Where the person moved their home (te_0041), for the approvers: each move once, on the claim being made when it
    -- happened — the moves since the person's previous claim was sent, up to this one's sending (te_0073).
    'home_moves', coalesce((select jsonb_agg(jsonb_build_object('at', m.at, 'km', m.km, 'first', m.from_lat is null, 'how', m.how) order by m.at)
      from te_home_moves m where m.employee_id = c.employee_id and m.from_lat is not null
        and m.at <= coalesce(c.submitted_at, now())
        and m.at > coalesce((select max(o.submitted_at) from te_claims o where o.employee_id = c.employee_id and o.id <> c.id
                              and o.submitted_at < coalesce(c.submitted_at, now())), '-infinity')), '[]'),
    -- Bookings the company made for this person in the claim's month that no bill on any claim carries (te_0042).
    'company_unlinked', coalesce((select jsonb_agg(te_booking_card(x.booking_id) order by x.travel_date)
      from (select distinct on (k.booking_id) k.booking_id, k.travel_date from te_company_bookings k
            where k.action in ('BOOKING', 'Date_Change', 'OFFLINE_MODIFICATION')
              and k.travel_date >= c.month and k.travel_date < (c.month + interval '1 month')
              and te_booking_for(k.passengers, k.passenger_ids, e.full_name, e.ecode)
              and not exists (select 1 from te_bills bb where k.booking_id = any(bb.refs) or (k.pnr is not null and k.pnr = any(bb.refs)))
            order by k.booking_id) x), '[]'),
    -- How the home in use was set: by standing there, or on the map (te_0053), for the approvers.
    'home', (select jsonb_build_object('how', h.how, 'set_at', h.set_at) from travel_homes h where h.employee_id = c.employee_id),
    'deputations', coalesce((select jsonb_agg(jsonb_build_object('state', x.state, 'from_day', x.from_day, 'to_day', x.to_day) order by x.from_day)
      from te_deputations x where x.employee_id = c.employee_id and x.status = 'approved'
        and x.from_day < (c.month + interval '1 month')::date and x.to_day >= c.month), '[]'),
    -- The same trip on another person's claim, with proof of place and time (te_0134).
    'shared', te_shared_rides(c.id),
    'routes', te_route_shots_of(c.id),
    'policy', (select jsonb_object_agg(key, value) from te_policy),
    'purposes', (select jsonb_agg(label order by sort, label) from te_purposes where is_active),
    'office_purposes', (select coalesce(jsonb_agg(label), '[]') from te_purposes where not gives_da),
    'expense_kinds', (select coalesce(jsonb_agg(jsonb_build_object('label', label, 'role', role, 'bill_always', bill_always, 'active', is_active) order by sort, label), '[]') from te_expense_kinds),
    -- Visit photos (te_0082): the setup, the person's photos of the claim's month, and "Photo not possible" on their other claims that month.
    'photo_setup', te_visit_setup(),
    'visit_photos', coalesce((select jsonb_agg(jsonb_build_object('id', v.id, 'day', v.day, 'shot_at', v.shot_at, 'taken_at', v.taken_at, 'lat', v.lat, 'lng', v.lng,
      'accuracy', v.accuracy, 'place', v.place, 'path', case when v.removed_at is null then v.path end, 'device_id', v.device_id, 'device', v.device) order by v.shot_at)
      from te_visit_photos v where v.employee_id = c.employee_id and v.day >= c.month and v.day < (c.month + interval '1 month')::date), '[]'),
    -- The phone most of the person's visit photos came from (te_0086).
    'usual_device', (select jsonb_build_object('device_id', u.device_id, 'device', u.device) from (
      select v.device_id, max(v.device) device from te_visit_photos v where v.employee_id = c.employee_id and v.device_id is not null
      group by v.device_id order by count(*) desc, max(v.shot_at) desc limit 1) u),
    'photo_skips_other', (select count(*) from te_rides r join te_days d on d.id = r.day_id join te_claims k on k.id = d.claim_id
      where k.employee_id = c.employee_id and k.month = c.month and k.id <> c.id and coalesce(btrim(r.photo_skip), '') <> ''),
    -- Who acted as what (te_0044): a Travel Desk or coordinator step says so beside the name; the
    -- reporting manager's does not. An amount changed or a claim sent back takes the stage it was at.
    'history', coalesce((select jsonb_agg(jsonb_build_object('id', v.id, 'at', v.at, 'action', v.action, 'to_status', v.to_status,
        'note', v.note, 'actor', a.full_name,
        'role', case
          when v.action = 'coordinator_approved' then 'Coordinator'
          when v.action in ('desk_approved', 'paid', 'advance') then 'Travel Desk'
          when v.action in ('adjusted', 'returned') then (
            select case p.to_status when 'with_desk' then 'Travel Desk' when 'with_coordinator' then 'Coordinator' end
            from te_events p where p.claim_id = v.claim_id and p.to_status is not null and (p.at, p.id) < (v.at, v.id)
            order by p.at desc, p.id desc limit 1)
        end) order by v.at, v.id)
      from te_events v left join employees a on a.id = v.actor_id where v.claim_id = c.id), '[]'),
    'adjustments', coalesce((select jsonb_agg(jsonb_build_object('item_id', j.item_id, 'unit', j.unit, 'old_value', j.old_value, 'new_value', j.new_value,
        'old_amount', j.old_amount, 'new_amount', j.new_amount, 'reason', j.reason, 'by', b.full_name, 'at', j.at) order by j.at)
      from te_adjustments j left join employees b on b.id = j.by_id where j.claim_id = c.id), '[]')
  ) into out
  from employees e where e.id = c.employee_id;
  return out;
end $function$;

-- Sending: a ride well over the map needs its screenshot.
CREATE OR REPLACE FUNCTION public.te_submit(p_claim uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare c te_claims; due date; late int := 0; steps jsonb := te_pol('late_pct'); over numeric := (te_pol('bill_over'))::text::numeric; missing text;
  near_m numeric := coalesce((te_pol('photo_near_m'))::text::numeric, 500); lim int := coalesce((te_pol('photo_skips'))::text::int, 3); used int;
begin
  select * into c from te_claims where id = p_claim;
  if not te_can_edit(p_claim) then raise exception 'This claim cannot be sent now'; end if;
  if not exists (select 1 from te_days where claim_id = p_claim) then raise exception 'Add at least one day first'; end if;
  -- Bills the policy asks for, each named (the user, 19 Oct: "don't know in which is having error").
  select string_agg(item, '; ' order by ord, item) into missing from (
    select d.day as ord, to_char(d.day, 'FMDD Mon') || ' · ' || case r.mode when 'taxi_bike' then 'Uber / Taxi bike' when 'taxi' then 'Uber / Taxi car' else initcap(r.mode) end || ' ride ' || split_part(coalesce(r.from_name, '—'), ',', 1) || ' → ' || split_part(coalesce(r.to_name, '—'), ',', 1) as item
    from te_rides r join te_days d on d.id = r.day_id
    where d.claim_id = p_claim and r.same_ticket is null and r.mode not in ('bike', 'car') and (r.amount > over or r.mode = 'taxi_bike') and not exists (select 1 from te_bills b where b.owner_id = r.id)
    union all
    select d.day, to_char(d.day, 'FMDD Mon') || ' · Hotel night' from te_hotels h join te_days d on d.id = h.day_id
    where d.claim_id = p_claim and h.amount > over and not exists (select 1 from te_bills b where b.owner_id = h.id)
    union all
    select d.day, to_char(d.day, 'FMDD Mon') || ' · ' || x.category from te_expenses x join te_days d on d.id = x.day_id
    where d.claim_id = p_claim and (x.amount > over or x.category in (select label from te_expense_kinds where bill_always)) and not exists (select 1 from te_bills b where b.owner_id = x.id)
  ) s;
  if missing is not null then raise exception 'Attach the bill for %', missing; end if;
  -- A ride whose purpose asks for a ticket ID names its ticket (te_0060; te_0105 by the tick, not the name).
  select string_agg(to_char(d.day, 'FMDD Mon') || ' · ' || initcap(r.mode) || ' ride ' || split_part(coalesce(r.from_name, '—'), ',', 1) || ' → ' || split_part(coalesce(r.to_name, '—'), ',', 1), '; ' order by d.day, r.seq)
    into missing
    from te_rides r join te_days d on d.id = r.day_id
   where d.claim_id = p_claim and te_needs_ticket(r.purpose)
     and not exists (select 1 from te_tickets t where t.id = r.id and btrim(t.ticket_no) <> '');
  if missing is not null then raise exception 'Enter the ticket ID for %', missing; end if;
  -- A bike or car ride claimed more than route_shot_pct over the map carries a Google Maps screenshot (te_0140).
  select string_agg(to_char(d.day, 'FMDD Mon') || ' · ' || initcap(r.mode) || ' ' || split_part(coalesce(r.from_name, '—'), ',', 1) || ' → ' || split_part(coalesce(r.to_name, '—'), ',', 1), '; ' order by d.day, r.seq)
    into missing
    from te_rides r join te_days d on d.id = r.day_id
   where d.claim_id = p_claim and r.mode in ('bike', 'car') and r.map_km > 0
     -- The test accounts only, until it is tried out (the user, 9 Nov).
     and (select e.ecode from te_claims c2 join employees e on e.id = c2.employee_id where c2.id = p_claim) in ('E6666', 'E7777', 'E8888', 'E9999')
     and r.claimed_km > r.map_km * (1 + coalesce((te_pol('route_shot_pct') #>> '{}')::numeric, 10) / 100)
     and not exists (select 1 from te_route_shots s where s.claim_id = p_claim and s.ride_id = r.id);
  if missing is not null then raise exception 'Add the Google Maps screenshot for %', missing; end if;
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
  -- Visit photos (te_0082, te_0092): a ride for a purpose needing one has its own photo that day within reach, or "Photo not possible" with a reason.
  if coalesce((te_pol('visit_photos'))::text::boolean, false) then
    select string_agg(to_char(d.day, 'FMDD Mon') || ' · ' || initcap(r.mode) || ' ride ' || split_part(coalesce(r.from_name, '—'), ',', 1) || ' → ' || split_part(coalesce(r.to_name, '—'), ',', 1), '; ' order by d.day, r.seq)
      into missing
      from te_rides r join te_days d on d.id = r.day_id
     where d.claim_id = p_claim and r.purpose in (select label from te_purposes where photo_needed)
       and r.to_lat is not null and (lower(btrim(split_part(coalesce(r.to_name, ''), ',', 1))) <> 'home'
       or (d.day >= coalesce((te_pol('home_mid_photo_from') #>> '{}')::date, '2999-12-31') and exists (select 1 from te_rides y where y.day_id = r.day_id and y.seq > r.seq and y.to_lat is not null)))
       and coalesce(btrim(r.photo_skip), '') = ''
       and r.id in (select te_rides_without_photo(p_claim));
    if missing is not null then raise exception 'Take the visit photo, or choose Photo not possible, for %', missing; end if;
    if coalesce(te_pol('photo_after') #>> '{}', 'block') = 'block' then
      select count(*) into used from te_rides r join te_days d on d.id = r.day_id join te_claims k on k.id = d.claim_id
       where k.employee_id = c.employee_id and k.month = c.month and coalesce(btrim(r.photo_skip), '') <> '' and (k.id = p_claim or k.status <> 'draft');
      if used > lim then raise exception 'Photo not possible is chosen % times in %. The limit is % a month', used, to_char(c.month, 'FMMonth'), lim; end if;
    end if;
  end if;
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
