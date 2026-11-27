-- =====================================================================
-- Cyrix Travel  ·  te_0175  ·  One more "Photo not possible" for one person in one month
--
-- Amalraj P V (E2482) used November's 3 "Photo not possible" while the visit photos were new
-- (7 and 9 Nov, then the training day of 21 Nov); the user, 27 Nov 2026: "can you give him 1 more".
-- The limit stays one for everybody (te_pol photo_skips); te_photo_skip_extra adds to it for one
-- person and one month, with why and who.
--
--   te_skip_limit(employee, month) = the month's limit for that person.
--   te_claim's photo_setup.skips, te_submit's check and te_my_no_proof_days use it.
-- =====================================================================

create table if not exists public.te_photo_skip_extra (
  employee_id uuid not null references public.employees(id) on delete cascade,
  month date not null check (month = date_trunc('month', month)::date),
  extra int not null check (extra > 0 and extra <= 10),
  reason text not null,
  given_by text not null,
  given_at timestamptz not null default now(),
  primary key (employee_id, month)
);
alter table public.te_photo_skip_extra enable row level security;
drop policy if exists te_photo_skip_extra_read on public.te_photo_skip_extra;
create policy te_photo_skip_extra_read on public.te_photo_skip_extra for select to authenticated
  using (employee_id = current_employee_id() or is_sw_admin());
revoke all on public.te_photo_skip_extra from anon;
grant select on public.te_photo_skip_extra to authenticated;

create or replace function public.te_skip_limit(p_employee uuid, p_month date)
returns int
language sql
stable security definer
set search_path to 'public'
as $$
  select coalesce((te_pol('photo_skips'))::text::int, 3)
       + coalesce((select x.extra from te_photo_skip_extra x where x.employee_id = p_employee and x.month = date_trunc('month', p_month)::date), 0)
$$;
revoke all on function public.te_skip_limit(uuid, date) from public, anon;
grant execute on function public.te_skip_limit(uuid, date) to authenticated, service_role;

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
    'rule', to_jsonb(te_rule_for(c.grade, c.designation)),
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
        'refs', b.refs, 'not_bill', b.not_bill, 'company', te_booking_card(te_bill_company(b))))
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
    'deputations', coalesce((select jsonb_agg(jsonb_build_object('state', x.state, 'from_day', x.from_day, 'to_day', x.to_day, 'letter_path', x.letter_path, 'letter_name', x.letter_name) order by x.from_day)
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
    'photo_setup', te_visit_setup() || jsonb_build_object('skips', te_skip_limit(c.employee_id, c.month)),
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

CREATE OR REPLACE FUNCTION public.te_submit(p_claim uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare c te_claims; due date; late int := 0; steps jsonb := te_pol('late_pct'); over numeric := (te_pol('bill_over'))::text::numeric; missing text;
  aurum boolean; worst date; nxt text; near_m numeric := coalesce((te_pol('photo_near_m'))::text::numeric, 500); lim int := coalesce((te_pol('photo_skips'))::text::int, 3); used int;
begin
  select * into c from te_claims where id = p_claim;
  if not te_can_edit(p_claim) then raise exception 'This claim cannot be sent now'; end if;
  if not exists (select 1 from te_days where claim_id = p_claim) then raise exception 'Add at least one day first'; end if;
  -- End my day for each day started or photographed (te_0150).
  select string_agg(to_char(d.day, 'FMDD Mon'), ', ' order by d.day) into missing
    from te_days d
   where d.claim_id = p_claim and d.day >= coalesce(te_end_first_from(c.employee_id), '2999-12-31')
     and (exists (select 1 from te_day_starts s where s.employee_id = c.employee_id and s.day = d.day)
          or exists (select 1 from te_visit_photos v where v.employee_id = c.employee_id and v.day = d.day))
     and not exists (select 1 from te_day_ends e where e.employee_id = c.employee_id and e.day = d.day);
  if missing is not null then raise exception 'End my day for % first', missing; end if;
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
  -- A bike or car ride claimed over the map's km and 1 km for every started 10 km of it carries a Google Maps screenshot (te_0140, te_0142).
  select string_agg(to_char(d.day, 'FMDD Mon') || ' · ' || initcap(r.mode) || ' ' || split_part(coalesce(r.from_name, '—'), ',', 1) || ' → ' || split_part(coalesce(r.to_name, '—'), ',', 1), '; ' order by d.day, r.seq)
    into missing
    from te_rides r join te_days d on d.id = r.day_id
   where d.claim_id = p_claim and r.mode in ('bike', 'car') and r.map_km > 0
     -- Rides from 10 Nov (the user, 9 Nov: "from 2mrws claim only needed, todays unsend no issue").
     -- The test accounts any day (the user, 9 Nov: "for test accounts there is not date or starting").
     and (d.day >= date '2026-11-10' or te_is_test(c.employee_id))
     and r.claimed_km > te_km_allowed(r.map_km)
     and not exists (select 1 from te_route_shots s where s.claim_id = p_claim and s.ride_id = r.id and s.places in ('match', 'named', 'unread'));
  if missing is not null then raise exception 'Add the Google Maps screenshot for %', missing; end if;
  -- No more than the screenshot's km, nor a screenshot of other points than the ride's (te_0141).
  select string_agg(to_char(d.day, 'FMDD Mon') || ' · ' || initcap(r.mode) || ' ' || split_part(coalesce(r.from_name, '—'), ',', 1) || ' → ' || split_part(coalesce(r.to_name, '—'), ',', 1), '; ' order by d.day, r.seq)
    into missing
    from te_rides r join te_days d on d.id = r.day_id join te_route_shots s on s.claim_id = p_claim and s.ride_id = r.id
   where d.claim_id = p_claim and s.km is not null and r.claimed_km > s.km + 0.5;
  if missing is not null then raise exception 'The km is more than the Google Maps screenshot for %', missing; end if;
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
      -- A day with no Start my day and no photos began from a place without proof: one more (te_0169).
      used := used + (select count(*) from te_days d join te_claims k on k.id = d.claim_id where k.employee_id = c.employee_id and k.month = c.month and coalesce(btrim(d.start_skip), '') <> '' and (k.id = p_claim or k.status <> 'draft'));
      lim := te_skip_limit(c.employee_id, c.month);
      if used > lim then raise exception 'Photo not possible is chosen % times in %. The limit is % a month', used, to_char(c.month, 'FMMonth'), lim; end if;
    end if;
  end if;
  aurum := coalesce((select grade ~ '^E[1-6]$' from employees where id = c.employee_id), false);
  if aurum then
    /* Aurum (te_0168; the user, 20 Nov): each day within 45 days of its date, and an outstation day within 7 days of
       the End my day of the trip's last day (a run of outstation days in a row). Late days take the late % by the
       month started past the window, as Cyrix claims do; later than the steps allow is refused. */
    select min(dl) into worst from (
      select d.day + 45 as dl from te_days d where d.claim_id = p_claim
      union all
      select coalesce(e.day, r.last_day) + 7 from (
        select d.day, (select min(x.day) from te_days x where x.claim_id = p_claim and x.da_kind like 'aurum%' and x.day >= d.day
                         and not exists (select 1 from te_days y where y.claim_id = p_claim and y.day = x.day + 1 and y.da_kind like 'aurum%')) as last_day
        from te_days d where d.claim_id = p_claim and d.da_kind like 'aurum%') r
      left join te_day_ends e on e.employee_id = c.employee_id and e.day = r.last_day) w;
    if current_date > worst then
      late := ceil((current_date - worst) / 30.0)::int;
      if late > jsonb_array_length(steps) then raise exception 'This claim is more than % months past its last date and cannot be claimed', jsonb_array_length(steps); end if;
      late := (steps->>(late - 1))::int;
    end if;
  else
  -- Late: due by the 5th of the next month; 1, 2, 3 months after that take 10, 20, 30 percent; later is refused.
  due := (c.month + interval '1 month')::date + ((te_pol('submit_by_day'))::text::int - 1);
  if current_date > due then
    late := ((extract(year from age(current_date, due)) * 12 + extract(month from age(current_date, due)))::int) + 1;
    if late > jsonb_array_length(steps) then raise exception 'This month is more than % months late and cannot be claimed', jsonb_array_length(steps); end if;
    late := (steps->>(late - 1))::int;
  end if;
  end if;
  /* A director as the reporting manager (0306): straight to the coordinator, or the Travel Desk (te_0168; the user, 20 Nov). */
  nxt := case when exists (select 1 from employees e join employees m on m.id = e.reporting_manager_id where e.id = c.employee_id and m.is_director)
              then case when te_claim_coordinator(p_claim) is not null then 'with_coordinator' else 'with_desk' end else 'with_manager' end;
  update te_claims set status = nxt, submitted_at = now(), late_pct = late, return_note = null,
    number = coalesce(number, te_number(nextval('te_claim_seq')::int)),
    updated_at = now()
  where id = p_claim returning number into c.number;
  return c.number;
end $function$;

CREATE OR REPLACE FUNCTION public.te_my_no_proof_days()
 RETURNS date[]
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with me as (select current_employee_id() id),
  days as (
    select g::date d from generate_series(coalesce(te_claim_from(), current_date - 3), (now() at time zone 'Asia/Kolkata')::date - 1, interval '1 day') g
    where g::date >= date '2026-11-20' and g::date >= coalesce(te_rule_from('day_start_from', (select id from me)), '2999-12-31')
  ),
  used as (
    select m, count(*) n from (
      select k.month m from te_rides r join te_days x on x.id = r.day_id join te_claims k on k.id = x.claim_id
       where k.employee_id = (select id from me) and coalesce(btrim(r.photo_skip), '') <> ''
      union all
      select k.month from te_days x join te_claims k on k.id = x.claim_id
       where k.employee_id = (select id from me) and coalesce(btrim(x.start_skip), '') <> '') s
    group by m
  )
  select coalesce(array_agg(days.d order by days.d), '{}') from days
  where coalesce((te_pol('visit_photos'))::text::boolean, false)
    and coalesce(te_pol('photo_after') #>> '{}', 'block') = 'block'
    and not exists (select 1 from te_day_starts s where s.employee_id = (select id from me) and s.day = days.d)
    and not exists (select 1 from te_visit_photos v where v.employee_id = (select id from me) and v.day = days.d and v.removed_at is null)
    and coalesce((select n from used where used.m = date_trunc('month', days.d)::date), 0) >= te_skip_limit((select id from me), date_trunc('month', days.d)::date)
$function$;

-- E2482, November 2026: one more.
insert into public.te_photo_skip_extra (employee_id, month, extra, reason, given_by)
select id, date '2026-11-01', 1, 'Used during the visit photo start (7, 9 Nov) and the 21 Nov training day', 'Kevin R (asked 27 Nov 2026)'
from public.employees where ecode = 'E2482'
on conflict (employee_id, month) do update set extra = excluded.extra, reason = excluded.reason, given_by = excluded.given_by, given_at = now();
