-- te_0075: deputation (the user, 26 Oct).
--
-- "some emp we will send to deputation, for 2 months for a project … upload letter mandatory, from and to date …
-- for them auto DA is 800 … for their each claim a tag should show deputation … if deputation is submitted, it
-- should go to manager approval. and for any edits manager should approve. history should show." Then: "better
-- add state instead of cost centre in deputation, so if the claim is from that state only we can claim in
-- deputation … in observation it should show as critical if claiming from other states".
--
-- A deputation is a state, from and to dates and the letter, asked for in My profile and approved by the reporting
-- manager. A change is a new request naming the one it replaces; the approved one stands until the change is
-- approved. Every request stays, so the rows are the history. On a day inside an approved deputation whose places
-- are all in its state, the DA is 'deputation' (te_policy deputation_da, ₹800); a place in another state is kept on
-- the day (te_days.dep_off) for the approvers' red observation, and the day takes the usual DA.

insert into public.te_policy (key, value) values ('deputation_da', '800') on conflict (key) do nothing;

alter table public.te_days drop constraint if exists te_days_da_kind_check;
alter table public.te_days add constraint te_days_da_kind_check
  check (da_kind in ('none', 'in_district', 'out_district', 'out_state', 'out_state_stay', 'deputation'));
alter table public.te_days drop constraint if exists te_days_da_auto_check;
alter table public.te_days add constraint te_days_da_auto_check
  check (da_auto in ('none', 'in_district', 'out_district', 'out_state', 'out_state_stay', 'deputation'));
-- A place of the day outside the deputation's state, as the map named it ("Bengaluru, Karnataka").
alter table public.te_days add column if not exists dep_off text;

create table if not exists public.te_deputations (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id) on delete cascade,
  state text not null,
  from_day date not null,
  to_day date not null,
  letter_path text not null,
  letter_name text,
  status text not null default 'with_manager' check (status in ('with_manager', 'approved', 'returned', 'withdrawn', 'replaced')),
  -- The approved deputation this request changes; it stands until this one is approved.
  replaces uuid references public.te_deputations(id),
  decided_by uuid references public.employees(id), decided_at timestamptz, note text,
  created_at timestamptz not null default now(),
  check (to_day >= from_day)
);
create index if not exists te_deputations_employee on public.te_deputations (employee_id, from_day);
alter table public.te_deputations enable row level security;

-- The letters: a private bucket, a folder per person.
insert into storage.buckets (id, name, public, file_size_limit) values ('te-letters', 'te-letters', false, 10485760)
on conflict (id) do nothing;

create or replace function public.te_dep_can_see(p_employee uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select p_employee = current_employee_id() or te_is_admin() or te_is_desk() or is_in_my_downline(p_employee)
$$;

drop policy if exists te_letters_insert on storage.objects;
create policy te_letters_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'te-letters' and (storage.foldername(name))[1] = public.current_employee_id()::text);
drop policy if exists te_letters_select on storage.objects;
create policy te_letters_select on storage.objects for select to authenticated
  using (bucket_id = 'te-letters' and public.te_dep_can_see(((storage.foldername(name))[1])::uuid));
drop policy if exists te_letters_delete on storage.objects;
create policy te_letters_delete on storage.objects for delete to authenticated
  using (bucket_id = 'te-letters' and (storage.foldername(name))[1] = public.current_employee_id()::text
         and not exists (select 1 from public.te_deputations d where d.letter_path = name));

/* The state of the approved deputation a person is on that day, or null. */
create or replace function public.te_dep_on(p_employee uuid, p_day date)
returns text language sql stable security definer set search_path = public as $$
  select state from te_deputations where employee_id = p_employee and status = 'approved' and p_day between from_day and to_day
  order by from_day limit 1
$$;

/* The state a claim is tagged with: an approved deputation over one of its days, or its month while it has none. */
create or replace function public.te_claim_deputation(p_claim uuid)
returns text language sql stable security definer set search_path = public as $$
  select d.state from te_claims c join te_deputations d on d.employee_id = c.employee_id and d.status = 'approved'
  where c.id = p_claim and (
    exists (select 1 from te_days x where x.claim_id = c.id and x.day between d.from_day and d.to_day)
    or (not exists (select 1 from te_days x where x.claim_id = c.id)
        and d.from_day < (c.month + interval '1 month')::date and d.to_day >= c.month))
  order by d.from_day limit 1
$$;

/* A message to one person about a deputation: the bell, and devices on the next round (as te_advance_tell). */
create or replace function public.te_dep_tell(p_to uuid, p_title text, p_body text, p_url text, p_by uuid)
returns void language plpgsql security definer set search_path = public as $$
declare mid uuid;
begin
  if p_to is null or p_to = p_by then return; end if;
  insert into push_messages (kind, title, body, url, target, sent_by)
  values ('travel', left(p_title, 80), left(coalesce(p_body, ''), 400), p_url, jsonb_build_object('kind', 'travel', 'deputation', true), p_by)
  returning id into mid;
  insert into push_inbox (message_id, employee_id) values (mid, p_to);
end $$;

create or replace function public.te_dep_range(p_from date, p_to date)
returns text language sql immutable as $$
  select to_char(p_from, 'FMDD Mon') || case when extract(year from p_from) <> extract(year from p_to) then to_char(p_from, ' YYYY') else '' end
      || ' – ' || to_char(p_to, 'FMDD Mon YYYY')
$$;

/* Ask for a deputation, or a change to the approved one (p_replaces); it goes to the reporting manager. */
create or replace function public.te_dep_request(p_state text, p_from date, p_to date, p_path text, p_name text, p_replaces uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare me uuid := current_employee_id(); e employees; st text := btrim(coalesce(p_state, '')); old te_deputations; clash te_deputations; v te_deputations;
begin
  if me is null then raise exception 'Sign in first'; end if;
  select * into e from employees where id = me;
  if e.reporting_manager_id is null then raise exception 'You have no reporting manager to approve it'; end if;
  if st = '' then raise exception 'Choose the state'; end if;
  if p_from is null or p_to is null then raise exception 'Choose the from and to dates'; end if;
  if p_to < p_from then raise exception 'The to date is before the from date'; end if;
  if p_to - p_from > 366 then raise exception 'A deputation is up to a year'; end if;
  if coalesce(p_path, '') not like me::text || '/%' then raise exception 'Upload the deputation letter'; end if;
  if exists (select 1 from te_deputations where employee_id = me and status = 'with_manager') then
    raise exception 'Your deputation request is still with the manager';
  end if;
  if p_replaces is not null then
    select * into old from te_deputations where id = p_replaces;
    if old.id is null or old.employee_id <> me or old.status <> 'approved' then raise exception 'That deputation cannot be changed now'; end if;
    if old.state = st and old.from_day = p_from and old.to_day = p_to and old.letter_path = p_path then raise exception 'Nothing is changed'; end if;
  end if;
  select * into clash from te_deputations
  where employee_id = me and status = 'approved' and id is distinct from p_replaces and from_day <= p_to and to_day >= p_from limit 1;
  if clash.id is not null then
    raise exception 'It overlaps your deputation in % (%)', clash.state, te_dep_range(clash.from_day, clash.to_day);
  end if;
  insert into te_deputations (employee_id, state, from_day, to_day, letter_path, letter_name, replaces)
  values (me, st, p_from, p_to, p_path, nullif(btrim(coalesce(p_name, '')), ''), p_replaces)
  returning * into v;
  perform te_dep_tell(e.reporting_manager_id,
    case when p_replaces is null then 'Deputation' else 'Deputation change' end || ' from ' || split_part(e.full_name, ' ', 1) || ' · ' || st,
    te_dep_range(p_from, p_to), '/travel/approvals?view=deputation', me);
  return v.id;
end $$;

create or replace function public.te_dep_withdraw(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v te_deputations;
begin
  select * into v from te_deputations where id = p_id;
  if v.id is null or v.employee_id <> current_employee_id() then raise exception 'That deputation is not yours'; end if;
  if v.status <> 'with_manager' then raise exception 'Only a request still with the manager can be withdrawn'; end if;
  update te_deputations set status = 'withdrawn', decided_at = now() where id = p_id;
end $$;

/* The reporting manager's step: approve, or send back with a reason. */
create or replace function public.te_dep_decide(p_id uuid, p_approve boolean, p_note text)
returns text language plpgsql security definer set search_path = public as $$
declare me uuid := current_employee_id(); v te_deputations; e employees; why text := nullif(btrim(coalesce(p_note, '')), '');
        clash te_deputations;
begin
  select * into v from te_deputations where id = p_id;
  if v.id is null then raise exception 'That deputation is not there any more'; end if;
  if v.employee_id = me then raise exception 'Your own deputation is approved by your manager'; end if;
  select * into e from employees where id = v.employee_id;
  if v.status <> 'with_manager' then raise exception 'It is not waiting for approval'; end if;
  if not (e.reporting_manager_id = me or te_is_admin()) then
    raise exception 'It waits on % to approve', coalesce((select full_name from employees where id = e.reporting_manager_id), 'the reporting manager');
  end if;
  if not p_approve then
    if why is null or length(why) < 3 then raise exception 'Write why it is going back'; end if;
    update te_deputations set status = 'returned', decided_by = me, decided_at = now(), note = why where id = p_id;
    perform te_dep_tell(v.employee_id, 'Deputation sent back · ' || v.state, why, '/travel/profile', me);
    return 'returned';
  end if;
  select * into clash from te_deputations
  where employee_id = v.employee_id and status = 'approved' and id is distinct from v.replaces and from_day <= v.to_day and to_day >= v.from_day limit 1;
  if clash.id is not null then
    raise exception 'It overlaps the approved deputation in % (%)', clash.state, te_dep_range(clash.from_day, clash.to_day);
  end if;
  if v.replaces is not null then update te_deputations set status = 'replaced' where id = v.replaces and status = 'approved'; end if;
  update te_deputations set status = 'approved', decided_by = me, decided_at = now(), note = why where id = p_id;
  perform te_dep_tell(v.employee_id, 'Deputation approved · ' || v.state, te_dep_range(v.from_day, v.to_day) || ' · DA ₹'
    || to_char(coalesce((select (value #>> '{}')::numeric from te_policy where key = 'deputation_da'), 800), 'FM99,990') || ' a day', '/travel/profile', me);
  return 'approved';
end $$;

/* One deputation as the screens show it. */
create or replace function public.te_dep_card(v te_deputations)
returns jsonb language sql stable security definer set search_path = public as $$
  select to_jsonb(v) || jsonb_build_object(
    'name', e.full_name, 'ecode', e.ecode,
    'decided_name', d.full_name, 'decided_ecode', d.ecode,
    'was', (select jsonb_build_object('state', o.state, 'from_day', o.from_day, 'to_day', o.to_day) from te_deputations o where o.id = v.replaces))
  from employees e left join employees d on d.id = v.decided_by where e.id = v.employee_id
$$;

create or replace function public.te_my_deputations()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'items', coalesce((select jsonb_agg(te_dep_card(v) order by v.created_at desc) from te_deputations v where v.employee_id = current_employee_id()), '[]'),
    'manager', (select x.full_name from employees e join employees x on x.id = e.reporting_manager_id where e.id = current_employee_id()),
    'da', coalesce((select (value #>> '{}')::numeric from te_policy where key = 'deputation_da'), 800))
$$;

/* The deputations an approver sees: the ones waiting on them first, then the rest they may see; a withdrawn one left out. */
create or replace function public.te_dep_inbox()
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(x.card || jsonb_build_object('waiting', x.waiting) order by x.waiting desc, x.created_at desc), '[]')
  from (
    select v.created_at, te_dep_card(v) as card,
      (v.status = 'with_manager' and e.reporting_manager_id = current_employee_id()) as waiting
    from te_deputations v join employees e on e.id = v.employee_id
    where v.employee_id <> current_employee_id() and v.status <> 'withdrawn'
      and (te_is_admin() or e.reporting_manager_id = current_employee_id() or is_in_my_downline(v.employee_id))
    order by v.created_at desc limit 300
  ) x
$$;

-- The deputation DA, the same for every grade.
create or replace function public.te_da(p_grade text, p_kind text, p_purpose text)
 RETURNS numeric
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare r te_grade_rules := te_rule(p_grade);
begin
  if exists (select 1 from te_purposes where label = p_purpose and not gives_da) then return 0; end if;
  return case p_kind when 'in_district' then r.da_in_district when 'out_district' then r.da_out_district
    when 'out_state' then r.da_out_state when 'out_state_stay' then r.da_out_state_stay
    when 'deputation' then coalesce((select (value #>> '{}')::numeric from te_policy where key = 'deputation_da'), 800) else 0 end;
end $function$;

-- A day takes the deputation DA only inside an approved deputation; the place outside its state is kept.
create or replace function public.te_save_day(p_claim uuid, p_day jsonb)
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
  if p_day->>'da_kind' = 'deputation' and te_dep_on(c.employee_id, (p_day->>'day')::date) is null then
    raise exception '% is not in an approved deputation — choose another DA', to_char((p_day->>'day')::date, 'FMDD Mon');
  end if;
  -- One claim a day, so one DA a day (the user, 23 Oct): a date already in another of this person's claims is refused.
  select coalesce(k.number, 'your ' || to_char(k.month, 'FMMon') || ' draft') into other
    from te_days d join te_claims k on k.id = d.claim_id
   where k.employee_id = c.employee_id and k.id <> p_claim and d.day = (p_day->>'day')::date limit 1;
  if other is not null then
    raise exception '% is already claimed in % — one claim a day', to_char((p_day->>'day')::date, 'FMDD Mon'), other;
  end if;
  other := null;
  insert into te_days (id, claim_id, day, place, district, purpose, da_kind, da_amount, continues_day, remarks, place_lat, place_lng, da_auto, dep_off)
  values (did, p_claim, (p_day->>'day')::date, p_day->>'place', p_day->>'district', p_day->>'purpose',
    coalesce(p_day->>'da_kind', 'none'), te_da(c.grade, coalesce(p_day->>'da_kind', 'none'), p_day->>'purpose'),
    nullif(p_day->>'continues_day', '')::date, p_day->>'remarks',
    nullif(p_day->>'place_lat', '')::float8, nullif(p_day->>'place_lng', '')::float8, nullif(p_day->>'da_auto', ''), nullif(p_day->>'dep_off', ''))
  on conflict (id) do update set day = excluded.day, place = excluded.place, district = excluded.district,
    purpose = excluded.purpose, da_kind = excluded.da_kind, da_amount = excluded.da_amount,
    continues_day = excluded.continues_day, remarks = excluded.remarks,
    place_lat = excluded.place_lat, place_lng = excluded.place_lng, da_auto = excluded.da_auto, dep_off = excluded.dep_off;

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
end $function$;

-- The claim carries the approved deputations over its month, and each day its place outside the state.
create or replace function public.te_claim(p_claim uuid)
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
                  where kx.employee_id = c.employee_id and kx.month = c.month and x.category = 'Phone'))
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
    'policy', (select jsonb_object_agg(key, value) from te_policy),
    'purposes', (select jsonb_agg(label order by sort, label) from te_purposes where is_active),
    'office_purposes', (select coalesce(jsonb_agg(label), '[]') from te_purposes where not gives_da),
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

-- The lists say which claims are on deputation.
drop function if exists public.te_my_claims();
create or replace function public.te_my_claims()
 RETURNS TABLE(id uuid, month date, part integer, status text, number text, total numeric, days integer, first_day date, last_day date, km numeric, modes text[], tickets integer, bills_missing integer, submitted_at timestamp with time zone, returned_at timestamp with time zone, places text[], find text, deputation text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select c.id, c.month, c.part, c.status, c.number, te_total(c.id),
    (select count(*)::int from te_days d where d.claim_id = c.id),
    coalesce((select min(day) from te_days d where d.claim_id = c.id), c.picked_day),
    coalesce((select max(day) from te_days d where d.claim_id = c.id), c.picked_day),
    (select coalesce(sum(case when r.mode in ('bike', 'car') then coalesce(r.claimed_km, r.map_km) else r.map_km end), 0)
       from te_rides r join te_days d on d.id = r.day_id where d.claim_id = c.id),
    (select coalesce(array_agg(distinct r.mode), '{}') from te_rides r join te_days d on d.id = r.day_id where d.claim_id = c.id),
    (select count(distinct t.ticket_no)::int from te_tickets t join te_days d on d.id = t.day_id where d.claim_id = c.id),
    -- As te_submit asks them (te_0048): train, flight, a bus that leaves its district; another fare over the limit; hotel nights; the listed expenses.
    (select count(*)::int from (
       select r.id from te_rides r join te_days d on d.id = r.day_id where d.claim_id = c.id
         and (r.mode in ('train', 'flight') or (r.mode = 'bus' and coalesce(r.inter, true)) or (r.mode not in ('bike', 'car') and (r.amount > (te_pol('bill_over'))::text::numeric or r.mode = 'taxi_bike')))
         and not exists (select 1 from te_bills b where b.owner_id = r.id)
       union all select h.id from te_hotels h join te_days d on d.id = h.day_id where d.claim_id = c.id and not exists (select 1 from te_bills b where b.owner_id = h.id)
       union all select x.id from te_expenses x join te_days d on d.id = x.day_id where d.claim_id = c.id
         and (x.amount > (te_pol('bill_over'))::text::numeric or x.category in ('Courier', 'Toll', 'Client meal', 'Team meal'))
         and not exists (select 1 from te_bills b where b.owner_id = x.id)) m),
    c.submitted_at,
    greatest(c.returned_at, c.last_recalled_at),
    te_claim_places(c.id), te_claim_find(c.id), te_claim_deputation(c.id)
  from te_claims c where c.employee_id = current_employee_id() order by c.month desc, c.part desc
$function$;
revoke execute on function public.te_my_claims() from public, anon;
grant execute on function public.te_my_claims() to authenticated;

drop function if exists public.te_inbox();
create or replace function public.te_inbox()
 RETURNS TABLE(id uuid, month date, part integer, status text, number text, total numeric, name text, ecode text, submitted_at timestamp with time zone, waiting boolean, days integer, first_day date, last_day date, km numeric, modes text[], tickets integer, places text[], find text, deputation text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with mine as (
    select c.*, e.full_name, e.ecode,
      (c.status = 'with_manager' and e.reporting_manager_id = current_employee_id())
      or (c.delete_requested_at is not null and e.reporting_manager_id = current_employee_id())
      or (c.status = 'with_coordinator' and te_claim_coordinator(c.id) = current_employee_id())
      or (c.status = 'with_desk' and te_is_desk()) as waiting
    from te_claims c join employees e on e.id = c.employee_id
    where c.status <> 'draft' and c.employee_id <> current_employee_id() and te_can_see(c.id)
  )
  select m.id, m.month, m.part, m.status, m.number, te_total(m.id), m.full_name, m.ecode, m.submitted_at, m.waiting,
    (select count(*)::int from te_days d where d.claim_id = m.id),
    (select min(day) from te_days d where d.claim_id = m.id),
    (select max(day) from te_days d where d.claim_id = m.id),
    (select coalesce(sum(case when r.mode in ('bike', 'car') then coalesce(r.claimed_km, r.map_km) else r.map_km end), 0)
       from te_rides r join te_days d on d.id = r.day_id where d.claim_id = m.id),
    (select coalesce(array_agg(distinct r.mode), '{}') from te_rides r join te_days d on d.id = r.day_id where d.claim_id = m.id),
    (select count(distinct t.ticket_no)::int from te_tickets t join te_days d on d.id = t.day_id where d.claim_id = m.id),
    te_claim_places(m.id), te_claim_find(m.id), te_claim_deputation(m.id)
  from mine m order by m.waiting desc, m.submitted_at desc nulls last limit 200
$function$;
revoke execute on function public.te_inbox() from public, anon;
grant execute on function public.te_inbox() to authenticated;

do $$
declare f text;
begin
  foreach f in array array['te_dep_can_see(uuid)', 'te_dep_on(uuid, date)', 'te_claim_deputation(uuid)', 'te_dep_tell(uuid, text, text, text, uuid)',
    'te_dep_range(date, date)', 'te_dep_request(text, date, date, text, text, uuid)', 'te_dep_withdraw(uuid)', 'te_dep_decide(uuid, boolean, text)',
    'te_dep_card(te_deputations)', 'te_my_deputations()', 'te_dep_inbox()'] loop
    execute format('revoke execute on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;

-- The tab is My profile now.
create or replace function public.te_advance_request(p_amount numeric, p_purpose text, p_reason text, p_base_name text, p_base_state text, p_dest_name text, p_dest_lat double precision, p_dest_lng double precision, p_dest_state text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare me uuid := current_employee_id(); e employees; h travel_homes; why text; m date := date_trunc('month', now() at time zone 'Asia/Kolkata')::date;
        total numeric; most numeric; v te_advances; amt numeric := round(coalesce(p_amount, 0));
begin
  if me is null then raise exception 'Sign in first'; end if;
  select * into e from employees where id = me;
  select * into h from travel_homes where employee_id = me;
  if h.employee_id is null then raise exception 'Set your home in My profile first — it is where the advance is from'; end if;
  if e.reporting_manager_id is null then raise exception 'You have no reporting manager to approve it'; end if;
  if nullif(btrim(coalesce(e.function_name, '')), '') is null then raise exception 'Your cost centre is not mapped — ask HR to set it'; end if;
  if amt <= 0 then raise exception 'Enter the advance amount'; end if;
  if length(btrim(coalesce(p_purpose, ''))) < 3 then raise exception 'Enter the purpose — the work it is for'; end if;
  if length(btrim(coalesce(p_reason, ''))) < 3 then raise exception 'Enter the reason for the advance'; end if;
  if p_dest_lat is null or p_dest_lng is null or length(btrim(coalesce(p_dest_name, ''))) = 0 then raise exception 'Choose where you are travelling to'; end if;
  if nullif(btrim(coalesce(p_base_state, '')), '') is null or nullif(btrim(coalesce(p_dest_state, '')), '') is null then
    raise exception 'The state of your home or the destination could not be found — try again';
  end if;
  -- Rule 1: out of the state only.
  if lower(btrim(p_base_state)) = lower(btrim(p_dest_state)) then
    raise exception 'An advance is only for travel outside %', btrim(p_base_state);
  end if;
  -- Rules 5 and 4.
  why := te_advance_blocked(me);
  if why is not null then raise exception '%', why; end if;
  most := coalesce((select (value #>> '{}')::numeric from te_policy where key = 'advance_month_amount'), 20000);
  select coalesce(sum(amount), 0) into total from te_advances where employee_id = me and month = m and status not in ('declined', 'cancelled');
  if total + amt > most then
    raise exception 'Up to ₹% this month — ₹% is left', to_char(most, 'FM99,99,99,990'), to_char(most - total, 'FM99,99,99,990');
  end if;
  insert into te_advances (employee_id, number, amount, purpose, reason, cost_centre, base_name, base_lat, base_lng, base_state,
                           dest_name, dest_lat, dest_lng, dest_state, month)
  values (me, te_advance_number(nextval('te_advance_seq')::int), amt, btrim(p_purpose), btrim(p_reason), nullif(btrim(coalesce(e.function_name, '')), ''),
          nullif(btrim(coalesce(p_base_name, '')), ''), h.lat, h.lng, btrim(p_base_state),
          btrim(p_dest_name), p_dest_lat, p_dest_lng, btrim(p_dest_state), m)
  returning * into v;
  perform te_advance_tell(e.reporting_manager_id, 'Advance ' || v.number || ' · ₹' || to_char(amt, 'FM99,99,99,990') || ' from ' || split_part(e.full_name, ' ', 1),
    btrim(p_base_state) || ' → ' || btrim(p_dest_name) || ' · ' || btrim(p_purpose), '/travel/approvals?view=advances', me);
  return jsonb_build_object('id', v.id, 'number', v.number);
end $function$;
