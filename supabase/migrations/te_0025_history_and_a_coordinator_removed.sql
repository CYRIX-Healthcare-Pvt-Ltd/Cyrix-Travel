-- Travel Expense · te_0025 · a claim's history; a removed coordinator passes the claim on; the day's place on the map
-- The user, 18 Oct:
--   "need a history like revive lab ie when applied, when approved, etc"
--   "I deleted coordinator then I refreshed, then also no pending approval in travel desk"
--   "hosp/place we enter first in form should be also in his rides … at least near, because location
--    fetching may vary due to network"
--   "if any change in district or state, can we automatically change daily allowance?"

-- ---------------------------------------------------------------- the day's place on the map, and the DA the map gave
alter table public.te_days add column if not exists place_lat double precision;
alter table public.te_days add column if not exists place_lng double precision;
alter table public.te_days add column if not exists da_auto text
  check (da_auto in ('none', 'in_district', 'out_district', 'out_state', 'out_state_stay'));
-- A ride counts as reaching the day's hospital when it starts or ends this near it (a phone's location can be off).
insert into public.te_policy (key, value) values ('place_near_km', '1') on conflict (key) do nothing;

-- ---------------------------------------------------------------- the history
create table if not exists public.te_events (
  id bigserial primary key,
  claim_id uuid not null references public.te_claims(id) on delete cascade,
  at timestamptz not null default now(),
  actor_id uuid references public.employees(id) on delete set null,
  action text not null,
  to_status text,
  note text
);
create index if not exists te_events_claim on public.te_events (claim_id, at);
alter table public.te_events enable row level security;

-- What already happened, from the claims' own dates (once).
insert into public.te_events (claim_id, at, actor_id, action, to_status, note)
select * from (
  select id, created_at, employee_id, 'created', 'draft', null::text from public.te_claims
  union all select id, submitted_at, employee_id, 'submitted', 'with_manager', number from public.te_claims where submitted_at is not null
  union all select id, last_recalled_at, employee_id, 'recalled', 'recalled', null from public.te_claims where last_recalled_at is not null
  union all select id, manager_at, manager_id, 'manager_approved',
    case when coordinator_at is not null or status = 'with_coordinator' then 'with_coordinator' else 'with_desk' end, manager_note
    from public.te_claims where manager_at is not null
  union all select id, coordinator_at, coordinator_id, 'coordinator_approved', 'with_desk', coordinator_note from public.te_claims where coordinator_at is not null
  union all select id, desk_at, desk_id, 'desk_approved', 'approved', desk_note from public.te_claims where desk_at is not null
  union all select id, paid_at, desk_id, 'paid', 'paid', null from public.te_claims where paid_at is not null
  union all select id, returned_at, returned_by, 'returned', 'returned', return_note from public.te_claims where returned_at is not null
  union all select id, delete_requested_at, employee_id, 'delete_requested', null, delete_reason from public.te_claims where delete_requested_at is not null
) s where not exists (select 1 from public.te_events);

/*
  Every step from here on, as it happens: who, when, and the note given. A step taken by the system
  for a reason (a coordinator removed) says so through te.why.
*/
create or replace function public.te_log()
returns trigger language plpgsql security definer set search_path to 'public' as $f$
declare me uuid := current_employee_id(); why text := nullif(current_setting('te.why', true), '');
begin
  if tg_op = 'INSERT' then
    insert into te_events (claim_id, actor_id, action, to_status) values (new.id, coalesce(me, new.employee_id), 'created', new.status);
    return new;
  end if;
  if new.status is distinct from old.status then
    insert into te_events (claim_id, actor_id, action, to_status, note) values (new.id, me,
      coalesce(why, case
        when new.status = 'with_manager' then case when old.status in ('returned', 'recalled') then 'resubmitted' else 'submitted' end
        when new.status in ('returned', 'recalled', 'paid') then new.status
        when old.status = 'with_manager' then 'manager_approved'
        when old.status = 'with_coordinator' then 'coordinator_approved'
        when old.status = 'with_desk' then 'desk_approved'
        else 'moved' end),
      new.status,
      case
        when why is not null then null
        when new.status = 'with_manager' then new.number
        when new.status = 'returned' then new.return_note
        when new.status in ('recalled', 'paid') then null
        when old.status = 'with_manager' then new.manager_note
        when old.status = 'with_coordinator' then new.coordinator_note
        when old.status = 'with_desk' then new.desk_note end);
  end if;
  if new.delete_requested_at is not null and old.delete_requested_at is null then
    insert into te_events (claim_id, actor_id, action, note) values (new.id, me, 'delete_requested', new.delete_reason);
  elsif new.delete_requested_at is null and old.delete_requested_at is not null then
    insert into te_events (claim_id, actor_id, action) values (new.id, me, case when me = new.employee_id then 'delete_withdrawn' else 'delete_refused' end);
  end if;
  if new.advance is distinct from old.advance then
    insert into te_events (claim_id, actor_id, action, note) values (new.id, me, 'advance', new.advance::text);
  end if;
  return new;
end $f$;
revoke execute on function public.te_log() from public, anon, authenticated;
drop trigger if exists te_claims_log on public.te_claims;
create trigger te_claims_log after insert or update on public.te_claims for each row execute function public.te_log();

-- ---------------------------------------------------------------- a coordinator removed: their claims go on to the Travel Desk
create or replace function public.te_set_coordinator(p_ecode text, p_coordinator text)
returns void language plpgsql security definer set search_path to 'public' as $f$
declare e uuid; k uuid;
begin
  if not te_is_admin() then raise exception 'Only SW Admin or ACC Admin'; end if;
  select id into e from employees where ecode = upper(trim(p_ecode));
  if e is null then raise exception 'No one with the code %', p_ecode; end if;
  if coalesce(trim(p_coordinator), '') = '' then
    delete from te_coordinators where employee_id = e;
    -- Nobody is left to check what waited on the coordinator, so it goes on to the Travel Desk (the user, 18 Oct).
    perform set_config('te.why', 'coordinator_removed', true);
    update te_claims set status = 'with_desk', updated_at = now() where employee_id = e and status = 'with_coordinator';
    perform set_config('te.why', '', true);
    return;
  end if;
  select id into k from employees where ecode = upper(trim(p_coordinator));
  if k is null then raise exception 'No one with the code %', p_coordinator; end if;
  if k = e then raise exception 'Nobody coordinates their own claims'; end if;
  insert into te_coordinators (employee_id, coordinator_id, set_by) values (e, k, current_employee_id())
  on conflict (employee_id) do update set coordinator_id = excluded.coordinator_id, set_by = excluded.set_by, set_at = now();
end $f$;

-- What already waits on a coordinator who was removed (TE-02, 18 Oct).
do $g$
begin
  perform set_config('te.why', 'coordinator_removed', true);
  update public.te_claims c set status = 'with_desk', updated_at = now()
  where c.status = 'with_coordinator' and not exists (select 1 from public.te_coordinators k where k.employee_id = c.employee_id);
  perform set_config('te.why', '', true);
end $g$;

-- ---------------------------------------------------------------- the day keeps its place's pin and the map's DA
create or replace function public.te_save_day(p_claim uuid, p_day jsonb)
returns uuid language plpgsql security definer set search_path to 'public' as $f$
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

  -- Bills whose row is gone go with it.
  delete from te_bills b where b.claim_id = p_claim and b.owner_id not in (
    select id from te_rides where day_id in (select id from te_days where claim_id = p_claim)
    union select id from te_hotels where day_id in (select id from te_days where claim_id = p_claim)
    union select id from te_expenses where day_id in (select id from te_days where claim_id = p_claim))
    and b.created_at < now() - interval '1 day';
  update te_claims set updated_at = now() where id = p_claim;
  return did;
end $f$;

-- ---------------------------------------------------------------- the claim, with its days' pins and its history
create or replace function public.te_claim(p_claim uuid)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $f$
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
        -- Possibly the same bill photographed again: the same amount, date and bill number, or a look-alike picture.
        'twin', (select coalesce(k.number, 'an unsent claim') || ' · ' || x.full_name from te_bills o join te_claims k on k.id = o.claim_id join employees x on x.id = k.employee_id
                 where o.id <> b.id and (
                   (b.ocr_billno is not null and o.ocr_billno = b.ocr_billno and o.ocr_amount is not distinct from b.ocr_amount)
                   or (b.phash is not null and o.phash is not null and bit_count((b.phash # o.phash)::bit(64)) <= 5))
                 limit 1))) from te_bills b where b.claim_id = c.id), '[]'),
    'km_month', (select jsonb_build_object(
        'bike', coalesce(sum(r.claimed_km) filter (where r.mode = 'bike'), 0),
        'car', coalesce(sum(r.claimed_km) filter (where r.mode = 'car'), 0),
        'auto', coalesce(sum(r.fare) filter (where r.mode = 'auto'), 0))
      from te_rides r join te_days d on d.id = r.day_id join te_claims k on k.id = d.claim_id
      where k.employee_id = c.employee_id and k.month = c.month),
    'policy', (select jsonb_object_agg(key, value) from te_policy),
    'purposes', (select jsonb_agg(label order by sort, label) from te_purposes where is_active),
    'office_purposes', (select coalesce(jsonb_agg(label), '[]') from te_purposes where not gives_da),
    'history', coalesce((select jsonb_agg(jsonb_build_object('id', v.id, 'at', v.at, 'action', v.action, 'to_status', v.to_status,
        'note', v.note, 'actor', a.full_name) order by v.at, v.id)
      from te_events v left join employees a on a.id = v.actor_id where v.claim_id = c.id), '[]')
  ) into out
  from employees e where e.id = c.employee_id;
  return out;
end $f$;
