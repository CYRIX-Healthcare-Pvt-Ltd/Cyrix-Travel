/*
  te_0080: Approvals by person (the user, 27 Oct: "here it should be like kpi team view, Ie Emp name, cost centre,
  total claim total exp, then on click it should show each claim by him … claim num, claim amount, km, from (start
  location) to (last location, if last is home the before home location)"). Each claim row also carries its person,
  the cost centre, where it started and ended, and its travel, DA, hotel and other, for the person's summary.
*/
drop function if exists public.te_inbox();
create or replace function public.te_inbox()
 RETURNS TABLE(id uuid, month date, part integer, status text, number text, total numeric, name text, ecode text, submitted_at timestamp with time zone, waiting boolean, days integer, first_day date, last_day date, km numeric, modes text[], tickets integer, places text[], find text, deputation text,
   employee_id uuid, cost_centre text, route_from text, route_to text, travel numeric, da numeric, hotel numeric, other numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with mine as (
    select c.*, e.full_name, e.ecode, nullif(trim(e.function_name), '') as cost_centre,
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
    (select coalesce(sum(x.amount), 0) from te_expenses x join te_days d on d.id = x.day_id where d.claim_id = m.id)
  from mine m order by m.waiting desc, m.submitted_at desc nulls last limit 200
$function$;
revoke execute on function public.te_inbox() from public, anon;
grant execute on function public.te_inbox() to authenticated;
