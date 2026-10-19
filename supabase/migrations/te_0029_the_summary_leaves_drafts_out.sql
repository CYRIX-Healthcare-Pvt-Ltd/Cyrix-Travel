-- Travel Expense · te_0029 · the summary leaves drafts out
-- The user, 19 Oct: "draft amount shouldn't be shown in summary". Only what was sent counts: claimed,
-- by kind, days, km, tickets and the month's budget there. "Not sent" becomes "Sent back": the claims
-- back with the person, sent back or recalled.

create or replace function public.te_summary(p_from date, p_to date)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $f$
declare me uuid := current_employee_id(); g text; r te_grade_rules;
begin
  if not travel_has_access() then raise exception 'Travel Expense is not open to you yet'; end if;
  select grade into g from employees where id = me;
  r := te_rule(g);
  return jsonb_build_object(
    'mine', (
      with k as (select c.id, c.status, te_total(c.id) total from te_claims c
                 where c.employee_id = me and c.status <> 'draft' and (p_from is null or c.month >= p_from) and (p_to is null or c.month <= p_to))
      select jsonb_build_object(
        'claimed', coalesce(sum(total), 0),
        'sent_back', coalesce(sum(total) filter (where status in ('returned', 'recalled')), 0),
        'pending', coalesce(sum(total) filter (where status in ('with_manager', 'with_coordinator', 'with_desk')), 0),
        'approved', coalesce(sum(total) filter (where status = 'approved'), 0),
        'paid', coalesce(sum(total) filter (where status = 'paid'), 0),
        'claims', count(*),
        'travel', (select coalesce(sum(x.amount), 0) from te_rides x join te_days d on d.id = x.day_id where d.claim_id in (select id from k)),
        'da', (select coalesce(sum(d.da_amount), 0) from te_days d where d.claim_id in (select id from k)),
        'hotel', (select coalesce(sum(x.amount), 0) from te_hotels x join te_days d on d.id = x.day_id where d.claim_id in (select id from k)),
        'other', (select coalesce(sum(x.amount), 0) from te_expenses x join te_days d on d.id = x.day_id where d.claim_id in (select id from k)),
        'days', (select count(*) from te_days d where d.claim_id in (select id from k)),
        'tickets', (select count(distinct t.ticket_no) from te_tickets t join te_days d on d.id = t.day_id where d.claim_id in (select id from k)),
        'km', (select coalesce(sum(case when x.mode in ('bike', 'car') then coalesce(x.claimed_km, x.map_km) else x.map_km end), 0)
               from te_rides x join te_days d on d.id = x.day_id where d.claim_id in (select id from k)),
        'bike_km', (select coalesce(sum(x.claimed_km), 0) from te_rides x join te_days d on d.id = x.day_id where d.claim_id in (select id from k) and x.mode = 'bike'),
        'car_km', (select coalesce(sum(x.claimed_km), 0) from te_rides x join te_days d on d.id = x.day_id where d.claim_id in (select id from k) and x.mode = 'car'),
        'auto', (select coalesce(sum(x.fare), 0) from te_rides x join te_days d on d.id = x.day_id where d.claim_id in (select id from k) and x.mode = 'auto'),
        'phone', (select coalesce(sum(x.amount), 0) from te_expenses x join te_days d on d.id = x.day_id where d.claim_id in (select id from k) and x.category = 'Phone'))
      from k),
    'limits', jsonb_build_object('grade', g, 'bike_km', r.bike_km_month, 'car_km', r.car_km_month,
      'auto', (te_pol('auto_month'))::text::numeric, 'phone', (te_pol('phone_month'))::text::numeric),
    'scope', case when te_is_admin() or te_is_desk() then 'all' else 'team' end,
    'team', coalesce((
      select jsonb_agg(p order by p->>'name') from (
        select jsonb_build_object('ecode', e.ecode, 'name', e.full_name,
          'claims', count(*),
          'claimed', sum(te_total(c.id)),
          'pending', coalesce(sum(te_total(c.id)) filter (where c.status in ('with_manager', 'with_coordinator', 'with_desk')), 0),
          'approved', coalesce(sum(te_total(c.id)) filter (where c.status = 'approved'), 0),
          'paid', coalesce(sum(te_total(c.id)) filter (where c.status = 'paid'), 0),
          'waiting', count(*) filter (where (c.status = 'with_manager' and e.reporting_manager_id = me)
              or (c.status = 'with_coordinator' and exists (select 1 from te_coordinators kk where kk.employee_id = c.employee_id and kk.coordinator_id = me))
              or (c.status = 'with_desk' and te_is_desk()))) p
        from te_claims c join employees e on e.id = c.employee_id
        where c.employee_id <> me and c.status not in ('draft') and te_can_see(c.id)
          and (p_from is null or c.month >= p_from) and (p_to is null or c.month <= p_to)
        group by e.id, e.ecode, e.full_name) s), '[]'));
end $f$;
