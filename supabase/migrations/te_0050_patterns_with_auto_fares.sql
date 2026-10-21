-- Travel Expense · te_0050 · auto fares in the patterns
-- The user, 21 Oct: "auto fare also, it can be compared". Each person's auto fares against the map's km
-- for those rides, so a fare a km far above the others shows.

create or replace function public.te_patterns(p_from date default null, p_to date default null)
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
declare me uuid := current_employee_id();
begin
  if not travel_has_access() then raise exception 'Travel Expense is not open to you yet'; end if;
  return coalesce((
    with d as (
      select dd.id, dd.day, dd.da_kind, c.employee_id
      from te_days dd join te_claims c on c.id = dd.claim_id
      where c.employee_id <> me and c.status <> 'draft' and te_can_see(c.id)
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
revoke all on function public.te_patterns(date, date) from public, anon;
grant execute on function public.te_patterns(date, date) to authenticated;
