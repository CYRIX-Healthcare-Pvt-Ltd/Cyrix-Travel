-- Travel Expense · te_0031 · the summary counts the days in a date range
-- The user, 19 Oct: "need calendar only, because I may want to search from 15th of some month". The
-- summary took whole claim months; now it adds up the days travelled between two dates — each day's
-- rides, DA, hotel night and other expenses — put under where its claim stands. No dates is all time.
-- Drafts stay out (te_0029).

create or replace function public.te_summary(p_from date, p_to date)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $f$
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
        'phone', (select coalesce(sum(x.amount), 0) from te_expenses x where x.day_id in (select id from t) and x.category = 'Phone'))
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
              or (c.status = 'with_coordinator' and exists (select 1 from te_coordinators kk where kk.employee_id = c.employee_id and kk.coordinator_id = me))
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
end $f$;
