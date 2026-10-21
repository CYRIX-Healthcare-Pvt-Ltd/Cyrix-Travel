-- Travel Expense · te_0041 · a home before the first claim, and every move of it shown
-- The user, 21 Oct: "should we force engineer to save his home ie starting location?" — yes, once: the
-- daily allowance and each day's first ride are reckoned from it. It is marked by standing there and
-- pressing, so it cannot be put anywhere else. It may be moved (people move house); each move is kept,
-- with how far it went, and the approvers of a claim open at the time see it ("showing to approver is
-- enough").

create table if not exists public.te_home_moves (
  id          bigserial primary key,
  employee_id uuid not null references public.employees(id) on delete cascade,
  at          timestamptz not null default now(),
  from_lat    double precision,
  from_lng    double precision,
  to_lat      double precision not null,
  to_lng      double precision not null,
  km          numeric
);
create index if not exists te_home_moves_who on public.te_home_moves (employee_id, at);
alter table public.te_home_moves enable row level security;
-- Read through te_claim only.

create or replace function public.travel_set_home(p_lat double precision, p_lng double precision)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare was travel_homes; me uuid := current_employee_id(); far numeric;
begin
  if not travel_has_access() then raise exception 'Travel Expense has not been given to you yet'; end if;
  if not travel_point_ok(p_lat, p_lng) then raise exception 'Your location could not be read — allow location and try again'; end if;
  select * into was from travel_homes where employee_id = me;
  far := case when was.employee_id is null then null else round(te_km(was.lat, was.lng, p_lat, p_lng)::numeric, 1) end;
  insert into travel_homes (employee_id, lat, lng) values (me, p_lat, p_lng)
  on conflict (employee_id) do update set lat = excluded.lat, lng = excluded.lng, set_at = now();
  -- The first mark, and any move of more than 200 m (a phone reading wanders a little).
  if was.employee_id is null or far > 0.2 then
    insert into te_home_moves (employee_id, from_lat, from_lng, to_lat, to_lng, km)
    values (me, was.lat, was.lng, p_lat, p_lng, far);
  end if;
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
        'twin_owner', (tw.o).owner_id, 'twin_claim', (tw.o).claim_id))
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

-- A learned place on the map for a Travel admin (the user, 21 Oct: "how to check in map or reallocate?"):
-- its pin and name put right for everyone.
drop function if exists public.te_admin_places();
create function public.te_admin_places()
 returns table (id uuid, name text, full_name text, district text, visits int, first_by text, created_at timestamptz, lat float8, lng float8)
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
begin
  if not (te_is_admin() or is_sw_admin()) then raise exception 'Only a Travel admin sees the learned places'; end if;
  return query
  select f.id, f.name, f.full_name, f.district, (select count(*)::int from te_tickets t where t.facility_id = f.id),
         e.full_name || ' (' || e.ecode || ')', f.created_at, f.lat, f.lng
  from te_facilities f left join employees e on e.id = f.first_by
  where not f.hidden order by f.name;
end $function$;
revoke all on function public.te_admin_places() from public, anon;
grant execute on function public.te_admin_places() to authenticated;

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
  update te_facilities set name = btrim(p_name), words = te_place_words(p_name), kind = te_place_type(p_name), lat = p_lat, lng = p_lng
   where id = p_id and not hidden;
  if not found then raise exception 'That place is no longer there'; end if;
end $function$;
revoke all on function public.te_edit_place(uuid, text, float8, float8) from public, anon;
grant execute on function public.te_edit_place(uuid, text, float8, float8) to authenticated;
