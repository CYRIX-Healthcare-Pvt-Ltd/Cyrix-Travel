/*
  te_0091 — the expense types are SW Admin's to keep, beside the purposes (the user, 30 Oct: "sw admin can add / delete or
  edit, add in purpose itself bcz many subtabs making it confusing"). Each type can always ask for its bill; three carry a
  rule by their role, not their name, so a rename keeps it: phone (the month's phone allowance), tools (petty cash above
  the limit) and spare (its own column in the Excel). A rename carries to the expenses already claimed; a type is deleted
  only while nothing names it, and one with a role is kept.
*/
create table if not exists public.te_expense_kinds (
  id serial primary key,
  label text not null,
  role text check (role in ('phone', 'tools', 'spare')),
  bill_always boolean not null default false,
  is_active boolean not null default true,
  sort int not null default 0
);
create unique index if not exists te_expense_kinds_label on public.te_expense_kinds (lower(label));
create unique index if not exists te_expense_kinds_role on public.te_expense_kinds (role) where role is not null;
alter table public.te_expense_kinds enable row level security;
insert into public.te_expense_kinds (label, role, bill_always, sort) values
  ('Courier', null, true, 1), ('Printing & stationery', null, false, 2), ('Tools', 'tools', true, 3), ('Toll', null, false, 4),
  ('Client meal', null, false, 5), ('Team meal', null, false, 6), ('Phone', 'phone', false, 7), ('Spare purchase', 'spare', false, 8),
  ('Other', null, false, 9)
on conflict do nothing;

create or replace function public.te_set_expense_kind(p_id int, p_label text, p_bill_always boolean, p_active boolean)
returns void language plpgsql security definer set search_path = public as $$
declare old text; lbl text := btrim(coalesce(p_label, ''));
begin
  if not te_is_admin() then raise exception 'Only SW Admin or ACC Admin'; end if;
  if lbl = '' then raise exception 'Type the expense type'; end if;
  if exists (select 1 from te_expense_kinds where lower(label) = lower(lbl) and id is distinct from p_id) then raise exception 'There is an expense type "%" already', lbl; end if;
  if p_id is null then
    insert into te_expense_kinds (label, bill_always, is_active, sort) values (lbl, coalesce(p_bill_always, false), coalesce(p_active, true), (select coalesce(max(sort), 0) + 1 from te_expense_kinds));
    return;
  end if;
  select label into old from te_expense_kinds where id = p_id;
  if old is null then raise exception 'That expense type is not there any more'; end if;
  update te_expense_kinds set label = lbl, bill_always = coalesce(p_bill_always, false), is_active = coalesce(p_active, true) where id = p_id;
  if old <> lbl then update te_expenses set category = lbl where category = old; end if;
end $$;

create or replace function public.te_delete_expense_kind(p_id int)
returns void language plpgsql security definer set search_path = public as $$
declare k te_expense_kinds; n int;
begin
  if not is_sw_admin() then raise exception 'Only SW Admin deletes an expense type'; end if;
  select * into k from te_expense_kinds where id = p_id;
  if k.id is null then raise exception 'That expense type is not there any more'; end if;
  if k.role = 'phone' then raise exception 'Keep %: the phone allowance counts it. Untick In use instead', k.label; end if;
  if k.role = 'tools' then raise exception 'Keep %: petty cash above the limit goes by it. Untick In use instead', k.label; end if;
  if k.role = 'spare' then raise exception 'Keep %: the Excel has its own column for it. Untick In use instead', k.label; end if;
  select count(*) into n from te_expenses where category = k.label;
  if n > 0 then raise exception '% is used on % expenses. Untick In use instead', k.label, n; end if;
  delete from te_expense_kinds where id = p_id;
end $$;
revoke all on function public.te_set_expense_kind(int, text, boolean, boolean) from public, anon;
revoke all on function public.te_delete_expense_kind(int) from public, anon;
grant execute on function public.te_set_expense_kind(int, text, boolean, boolean) to authenticated, service_role;
grant execute on function public.te_delete_expense_kind(int) to authenticated, service_role;

-- The rules read the types by role and by "bill always", and the claim and the admin page carry the list.
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

CREATE OR REPLACE FUNCTION public.te_summary(p_from date, p_to date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare me uuid := current_employee_id(); g text; r te_grade_rules;
begin
  if not travel_has_access() then raise exception 'Travel Expense is not open to you yet'; end if;
  select grade into g from employees where id = me;
  r := te_rule(g);
  return jsonb_build_object(
    'mine', (
      with d as (
        select d.id, d.claim_id, c.status,
          coalesce((select sum(x.amount) from te_rides x where x.day_id = d.id), 0) as travel,
          d.da_amount as da,
          coalesce((select sum(x.amount) from te_hotels x where x.day_id = d.id), 0) as hotel,
          coalesce((select sum(x.amount) from te_expenses x where x.day_id = d.id), 0) as other
        from te_days d join te_claims c on c.id = d.claim_id
        where c.employee_id = me and c.status <> 'draft'
          and (p_from is null or d.day >= p_from) and (p_to is null or d.day <= p_to)
      ), t as (select *, travel + da + hotel + other as total from d)
      select jsonb_build_object(
        'claimed', coalesce(sum(total), 0),
        'sent_back', coalesce(sum(total) filter (where status in ('returned', 'recalled')), 0),
        'pending', coalesce(sum(total) filter (where status in ('with_manager', 'with_coordinator', 'with_desk')), 0),
        'approved', coalesce(sum(total) filter (where status = 'approved'), 0),
        'paid', coalesce(sum(total) filter (where status = 'paid'), 0),
        'claims', count(distinct claim_id),
        'travel', coalesce(sum(travel), 0), 'da', coalesce(sum(da), 0), 'hotel', coalesce(sum(hotel), 0), 'other', coalesce(sum(other), 0),
        'days', count(*),
        'tickets', (select count(distinct k.ticket_no) from te_tickets k where k.day_id in (select id from t)),
        'km', (select coalesce(sum(case when x.mode in ('bike', 'car') then coalesce(x.claimed_km, x.map_km) else x.map_km end), 0) from te_rides x where x.day_id in (select id from t)),
        'bike_km', (select coalesce(sum(x.claimed_km), 0) from te_rides x where x.day_id in (select id from t) and x.mode = 'bike'),
        'car_km', (select coalesce(sum(x.claimed_km), 0) from te_rides x where x.day_id in (select id from t) and x.mode = 'car'),
        'auto', (select coalesce(sum(x.fare), 0) from te_rides x where x.day_id in (select id from t) and x.mode = 'auto'),
        'phone', (select coalesce(sum(x.amount), 0) from te_expenses x where x.day_id in (select id from t) and x.category in (select label from te_expense_kinds where role = 'phone')))
      from t),
    'limits', jsonb_build_object('grade', g, 'bike_km', r.bike_km_month, 'car_km', r.car_km_month,
      'auto', (te_pol('auto_month'))::text::numeric, 'phone', (te_pol('phone_month'))::text::numeric),
    'scope', case when te_is_admin() or te_is_desk() then 'all' else 'team' end,
    'team', coalesce((
      select jsonb_agg(p order by p->>'name') from (
        select jsonb_build_object('ecode', e.ecode, 'name', e.full_name,
          'claims', count(distinct c.id),
          'claimed', sum(v.total),
          'pending', coalesce(sum(v.total) filter (where c.status in ('with_manager', 'with_coordinator', 'with_desk')), 0),
          'approved', coalesce(sum(v.total) filter (where c.status = 'approved'), 0),
          'paid', coalesce(sum(v.total) filter (where c.status = 'paid'), 0),
          'waiting', count(distinct c.id) filter (where (c.status = 'with_manager' and e.reporting_manager_id = me)
              or (c.status = 'with_coordinator' and te_claim_coordinator(c.id) = me)
              or (c.status = 'with_desk' and te_is_desk()))) p
        from te_days d
        join te_claims c on c.id = d.claim_id
        join employees e on e.id = c.employee_id
        cross join lateral (select coalesce((select sum(x.amount) from te_rides x where x.day_id = d.id), 0) + d.da_amount
            + coalesce((select sum(x.amount) from te_hotels x where x.day_id = d.id), 0)
            + coalesce((select sum(x.amount) from te_expenses x where x.day_id = d.id), 0) as total) v
        where c.employee_id <> me and c.status <> 'draft' and te_can_see(c.id)
          and (p_from is null or d.day >= p_from) and (p_to is null or d.day <= p_to)
        group by e.id, e.ecode, e.full_name) s), '[]'));
end $function$;

CREATE OR REPLACE FUNCTION public.te_my_claims()
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
    -- As te_submit asks them (te_0060, te_0074; te_0081): a fare over the limit or a bike taxi, not a return on the same ticket; a hotel night over it; an expense over it, or a courier or tool.
    (select count(*)::int from (
       select r.id from te_rides r join te_days d on d.id = r.day_id where d.claim_id = c.id
         and r.same_ticket is null and r.mode not in ('bike', 'car') and (r.amount > (te_pol('bill_over'))::text::numeric or r.mode = 'taxi_bike')
         and not exists (select 1 from te_bills b where b.owner_id = r.id)
       union all select h.id from te_hotels h join te_days d on d.id = h.day_id where d.claim_id = c.id and h.amount > (te_pol('bill_over'))::text::numeric and not exists (select 1 from te_bills b where b.owner_id = h.id)
       union all select x.id from te_expenses x join te_days d on d.id = x.day_id where d.claim_id = c.id
         and (x.amount > (te_pol('bill_over'))::text::numeric or x.category in (select label from te_expense_kinds where bill_always))
         and not exists (select 1 from te_bills b where b.owner_id = x.id)) m),
    c.submitted_at,
    greatest(c.returned_at, c.last_recalled_at),
    te_claim_places(c.id), te_claim_find(c.id), te_claim_deputation(c.id)
  from te_claims c where c.employee_id = current_employee_id() order by c.month desc, c.part desc
$function$;

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
  -- Visit photos (te_0082): a ride for a purpose needing one has its photo that day within reach, or "Photo not possible" with a reason.
  if coalesce((te_pol('visit_photos'))::text::boolean, false) then
    select string_agg(to_char(d.day, 'FMDD Mon') || ' · ' || initcap(r.mode) || ' ride ' || split_part(coalesce(r.from_name, '—'), ',', 1) || ' → ' || split_part(coalesce(r.to_name, '—'), ',', 1), '; ' order by d.day, r.seq)
      into missing
      from te_rides r join te_days d on d.id = r.day_id
     where d.claim_id = p_claim and r.purpose in (select label from te_purposes where photo_needed)
       and r.to_lat is not null and lower(btrim(split_part(coalesce(r.to_name, ''), ',', 1))) <> 'home'
       and coalesce(btrim(r.photo_skip), '') = ''
       and not exists (select 1 from te_visit_photos v where v.employee_id = c.employee_id and v.day = d.day and te_m(v.lat, v.lng, r.to_lat, r.to_lng) <= near_m);
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

CREATE OR REPLACE FUNCTION public.te_admin_data()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not te_is_admin() then raise exception 'Only SW Admin or ACC Admin'; end if;
  return jsonb_build_object(
    'rules', (select jsonb_agg(to_jsonb(r) order by r.grade = '*' desc, r.grade) from te_grade_rules r),
    'policy', (select jsonb_object_agg(key, value) from te_policy),
    'purposes', (select jsonb_agg(to_jsonb(p) order by p.sort, p.label) from te_purposes p),
    'expense_kinds', (select coalesce(jsonb_agg(to_jsonb(k) order by k.sort, k.label), '[]') from te_expense_kinds k),
    'projects', (select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'label', p.label, 'is_active', p.is_active) order by p.sort, p.label), '[]') from te_project_rows() p),
    'coordinators', (select coalesce(jsonb_agg(jsonb_build_object('cost_centre', k.cost_centre, 'coordinator_ecode', x.ecode, 'coordinator', x.full_name,
                       'people', (select count(*) from employees e where e.is_active and lower(btrim(e.function_name)) = lower(k.cost_centre))) order by k.cost_centre), '[]')
                     from te_cost_centre_coordinators k join employees x on x.id = k.coordinator_id),
    -- The cost centres people are mapped to (their function), to choose a coordinator for.
    'cost_centres', (select coalesce(jsonb_agg(jsonb_build_object('name', c.name, 'people', c.n) order by c.name), '[]')
                     from (select min(btrim(function_name)) as name, count(*) as n from employees
                           where is_active and nullif(btrim(function_name), '') is not null group by lower(btrim(function_name))) c),
    'desk', (select coalesce(jsonb_agg(jsonb_build_object('ecode', e.ecode, 'name', e.full_name) order by e.full_name), '[]')
             from user_roles u join employees e on e.id = u.employee_id where u.role = 'travel_desk'),
    'sw', is_sw_admin());
end $function$;
