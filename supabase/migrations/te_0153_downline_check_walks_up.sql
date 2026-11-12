-- te_0153: the "in my downline" check walks up from the person (at most 12 managers) instead of building the
-- whole downline every time; te_my_team builds the downline once (the user, 12 Nov: "speed up my team", before
-- AP BEMMP, KL BEMMP, UP BEMMP and Care 360 get Travel from the 16th).
--
-- Same answer as before: checked for every manager and person, 5,252 pairs each, none only in one (12 Nov).
-- is_in_my_downline is shared (KPI templates, Revive Lab, Inventory, Travel), so all of them get the speed.

create or replace function public.is_in_my_downline(p_employee_id uuid)
returns boolean language sql stable security definer set search_path to 'public' as $$
  with recursive up as (
    select e.reporting_manager_id as mgr, 1 as depth from employees e
    where e.id = p_employee_id and e.reporting_manager_id is not null
    union all
    select m.reporting_manager_id, u.depth + 1 from up u join employees m on m.id = u.mgr
    -- The same guard as downline_of: 12 levels, so a loop in reporting lines can't run on.
    where m.reporting_manager_id is not null and u.depth < 12
  )
  select exists (select 1 from up where mgr = current_employee_id())
$$;

create or replace function public.te_my_team()
returns uuid[] language sql stable security definer set search_path to 'public' as $$
  select coalesce(array_agg(e.id), '{}') from employees e
  where e.is_active and e.id <> current_employee_id() and e.id in (select d from downline_of(current_employee_id()) d)
$$;

-- The claims you can see, worked out once for a list (te_can_see is the same rule for one claim, but run per claim it
-- costs about 1.5 ms each, which grows with every claim). Same rule: yours, you're its coordinator, it's in your
-- downline, you coordinate its cost centre (one coordinator per centre, unique index), or you're admin / Travel Desk.
create or replace function public.te_visible_claims()
returns table(id uuid) language sql stable security definer set search_path to 'public' as $$
  with me as (select current_employee_id() as me, te_is_admin() or te_is_desk() as all_claims)
  select c.id from te_claims c join employees e on e.id = c.employee_id cross join me
  where me.all_claims or c.employee_id = me.me or c.coordinator_id = me.me
    or c.employee_id in (select d from downline_of(me.me) d)
    or exists (select 1 from te_cost_centre_coordinators k
               where lower(k.cost_centre) = lower(btrim(e.function_name)) and k.coordinator_id = me.me and k.coordinator_id <> c.employee_id)
$$;
revoke all on function public.te_visible_claims() from public, anon;
grant execute on function public.te_visible_claims() to authenticated;

-- The inbox, Summary and Patterns use it in place of te_can_see per claim; nothing else changes in them.
CREATE OR REPLACE FUNCTION public.te_inbox()
 RETURNS TABLE(id uuid, month date, part integer, status text, number text, total numeric, name text, ecode text, submitted_at timestamp with time zone, waiting boolean, days integer, first_day date, last_day date, km numeric, modes text[], tickets integer, places text[], find text, deputation text, employee_id uuid, cost_centre text, route_from text, route_to text, travel numeric, da numeric, hotel numeric, other numeric, asks text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with mine as (
    select c.*, e.full_name, e.ecode, nullif(trim(e.function_name), '') as cost_centre,
      (c.status = 'with_manager' and e.reporting_manager_id = current_employee_id())
      or (c.status = 'with_coordinator' and te_claim_coordinator(c.id) = current_employee_id())
      or (c.status = 'with_desk' and te_is_desk()) as step,
      -- The person asks the manager to edit or delete it (te_0094).
      case when e.reporting_manager_id = current_employee_id() then
        case when c.recall_requested_at is not null then 'edit' when c.delete_requested_at is not null then 'delete' end end as asks
    from te_claims c join employees e on e.id = c.employee_id
    where c.status <> 'draft' and c.employee_id <> current_employee_id() and c.id in (select v.id from te_visible_claims() v)
  )
  select m.id, m.month, m.part, m.status, m.number, te_total(m.id), m.full_name, m.ecode, m.submitted_at, m.step or m.asks is not null,
    (select count(*)::int from te_days d where d.claim_id = m.id),
    (select min(day) from te_days d where d.claim_id = m.id),
    (select max(day) from te_days d where d.claim_id = m.id),
    (select coalesce(sum(case when r.mode in ('bike', 'car') then coalesce(r.claimed_km, r.map_km) else r.map_km end), 0)
       from te_rides r join te_days d on d.id = r.day_id where d.claim_id = m.id),
    (select coalesce(array_agg(distinct r.mode), '{}') from te_rides r join te_days d on d.id = r.day_id where d.claim_id = m.id),
    (select count(distinct t.ticket_no)::int from te_tickets t join te_days d on d.id = t.day_id where d.claim_id = m.id),
    te_claim_places(m.id), te_claim_find(m.id), te_claim_deputation(m.id),
    m.employee_id, m.cost_centre,
    -- Where it started: the first ride's from.
    (select split_part(r.from_name, ',', 1) from te_rides r join te_days d on d.id = r.day_id where d.claim_id = m.id order by d.day, r.seq limit 1),
    -- Where it ended: the last ride's to, or where that ride left from when it went home.
    (select split_part(case when lower(trim(split_part(r.to_name, ',', 1))) = 'home' then r.from_name else r.to_name end, ',', 1)
       from te_rides r join te_days d on d.id = r.day_id where d.claim_id = m.id order by d.day desc, r.seq desc limit 1),
    (select coalesce(sum(r.amount), 0) from te_rides r join te_days d on d.id = r.day_id where d.claim_id = m.id),
    (select coalesce(sum(d.da_amount), 0) from te_days d where d.claim_id = m.id),
    (select coalesce(sum(h.amount), 0) from te_hotels h join te_days d on d.id = h.day_id where d.claim_id = m.id),
    (select coalesce(sum(x.amount), 0) from te_expenses x join te_days d on d.id = x.day_id where d.claim_id = m.id),
    case when not m.step then m.asks end
  from mine m order by m.step or m.asks is not null desc, m.submitted_at desc nulls last limit 200
$function$;

CREATE OR REPLACE FUNCTION public.te_patterns(p_from date DEFAULT NULL::date, p_to date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare me uuid := current_employee_id();
begin
  if not travel_has_access() then raise exception 'Travel Expense is not open to you yet'; end if;
  return coalesce((
    with d as (
      select dd.id, dd.day, dd.da_kind, c.employee_id
      from te_days dd join te_claims c on c.id = dd.claim_id
      where c.employee_id <> me and c.status <> 'draft' and c.id in (select v.id from te_visible_claims() v)
        and (p_from is null or dd.day >= p_from) and (p_to is null or dd.day <= p_to)
    ), per as (
      select d.employee_id,
        count(*) as days,
        sum(coalesce((select sum(x.amount) from te_rides x where x.day_id = d.id), 0)
          + coalesce((select da_amount from te_days where id = d.id), 0)
          + coalesce((select sum(x.amount) from te_hotels x where x.day_id = d.id), 0)
          + coalesce((select sum(x.amount) from te_expenses x where x.day_id = d.id), 0)) as claimed,
        count(*) filter (where d.da_kind in ('out_district', 'out_state', 'out_state_stay')) as out_days
      from d group by d.employee_id
    ), rides as (
      select d.employee_id,
        coalesce(sum(r.claimed_km) filter (where r.mode in ('bike', 'car')), 0) as km,
        sum(r.claimed_km) filter (where r.mode in ('bike', 'car') and r.map_km > 0) as km_claimed,
        sum(r.map_km) filter (where r.mode in ('bike', 'car') and r.map_km > 0 and r.claimed_km is not null) as km_map,
        count(*) filter (where r.mode in ('bike', 'car') and r.map_km > 0 and r.claimed_km > r.map_km * 1.1) as rides_over,
        -- Auto fares against the map's km (te_0050; the user, 21 Oct: "auto fare also, it can be compared").
        sum(r.fare) filter (where r.mode = 'auto' and r.map_km > 0 and r.fare > 0) as auto_fare,
        sum(r.map_km) filter (where r.mode = 'auto' and r.map_km > 0 and r.fare > 0) as auto_km,
        count(*) filter (where r.mode = 'auto' and r.map_km > 0 and r.fare > 0) as auto_rides
      from d join te_rides r on r.day_id = d.id group by d.employee_id
    ), tickets as (
      select d.employee_id, count(distinct t.ticket_no) as tickets from d join te_tickets t on t.day_id = d.id group by d.employee_id
    ), cuts as (
      select d.employee_id, sum(greatest(coalesce(j.old_amount, 0) - coalesce(j.new_amount, 0), 0)) as cut
      from d join te_adjustments j on j.item_id in (
        select d.id union all select r.id from te_rides r where r.day_id = d.id
        union all select h.id from te_hotels h where h.day_id = d.id union all select x.id from te_expenses x where x.day_id = d.id)
      group by d.employee_id
    )
    select jsonb_agg(jsonb_build_object(
        'ecode', e.ecode, 'name', e.full_name, 'function', e.function_name,
        'days', p.days, 'claimed', round(p.claimed, 2), 'tickets', coalesce(t.tickets, 0),
        'km', coalesce(r.km, 0), 'km_claimed', r.km_claimed, 'km_map', r.km_map, 'rides_over', coalesce(r.rides_over, 0), 'auto_fare', r.auto_fare, 'auto_km', r.auto_km, 'auto_rides', coalesce(r.auto_rides, 0),
        'out_days', p.out_days, 'cut', round(coalesce(k.cut, 0), 2)) order by e.full_name)
    from per p join employees e on e.id = p.employee_id
    left join rides r on r.employee_id = p.employee_id
    left join tickets t on t.employee_id = p.employee_id
    left join cuts k on k.employee_id = p.employee_id), '[]');
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
        where c.employee_id <> me and c.status <> 'draft' and c.id in (select v.id from te_visible_claims() v)
          and (p_from is null or d.day >= p_from) and (p_to is null or d.day <= p_to)
        group by e.id, e.ecode, e.full_name) s), '[]'));
end $function$;
