-- Travel Expense · te_0020 · a claim's row says its dates and its km
-- The user, 17 Oct: the claim number stands out, then the dates it covers (claims are by the day
-- now) and the total km. km is the claimed km on a bike or car ride, the map's km on any other.
drop function if exists public.te_my_claims();
create function public.te_my_claims()
returns table (id uuid, month date, part int, status text, number text, total numeric, days int, first_day date, last_day date, km numeric)
language sql stable security definer set search_path to 'public' as $f$
  select c.id, c.month, c.part, c.status, c.number, te_total(c.id),
    (select count(*)::int from te_days d where d.claim_id = c.id),
    (select min(day) from te_days d where d.claim_id = c.id),
    (select max(day) from te_days d where d.claim_id = c.id),
    (select coalesce(sum(case when r.mode in ('bike', 'car') then coalesce(r.claimed_km, r.map_km) else r.map_km end), 0)
       from te_rides r join te_days d on d.id = r.day_id where d.claim_id = c.id)
  from te_claims c where c.employee_id = current_employee_id() order by c.month desc, c.part desc
$f$;

drop function if exists public.te_inbox();
create function public.te_inbox()
returns table (id uuid, month date, part int, status text, number text, total numeric, name text, ecode text, submitted_at timestamptz, waiting boolean,
  days int, first_day date, last_day date, km numeric)
language sql stable security definer set search_path to 'public' as $f$
  with mine as (
    select c.*, e.full_name, e.ecode,
      (c.status = 'with_manager' and e.reporting_manager_id = current_employee_id())
      or (c.delete_requested_at is not null and e.reporting_manager_id = current_employee_id())
      or (c.status = 'with_coordinator' and exists (select 1 from te_coordinators k where k.employee_id = c.employee_id and k.coordinator_id = current_employee_id()))
      or (c.status = 'with_desk' and te_is_desk()) as waiting
    from te_claims c join employees e on e.id = c.employee_id
    where c.status <> 'draft' and c.employee_id <> current_employee_id() and te_can_see(c.id)
  )
  select m.id, m.month, m.part, m.status, m.number, te_total(m.id), m.full_name, m.ecode, m.submitted_at, m.waiting,
    (select count(*)::int from te_days d where d.claim_id = m.id),
    (select min(day) from te_days d where d.claim_id = m.id),
    (select max(day) from te_days d where d.claim_id = m.id),
    (select coalesce(sum(case when r.mode in ('bike', 'car') then coalesce(r.claimed_km, r.map_km) else r.map_km end), 0)
       from te_rides r join te_days d on d.id = r.day_id where d.claim_id = m.id)
  from mine m order by m.waiting desc, m.submitted_at desc nulls last limit 200
$f$;

revoke execute on function public.te_my_claims(), public.te_inbox() from public, anon;
grant execute on function public.te_my_claims(), public.te_inbox() to authenticated;
