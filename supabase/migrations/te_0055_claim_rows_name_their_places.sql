-- Travel Expense · te_0055 · claim rows name their places, and can be searched
-- The user, 21 Oct: "only the claim number is not good, we need a place name, it will be tough to know; and
-- add a search bar, in that anything can be searched; need the same for the manager in approvals". Each row
-- of My claims and Approvals carries the places visited, in the order first visited, and the words to search
-- (places, districts, purposes, tickets, rides' ends, hotels, remarks); Approvals also its modes and tickets.

create or replace function public.te_claim_places(p_claim uuid)
 returns text[]
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select coalesce(array_agg(p order by first), '{}') from (
    select trim(p) as p, min(d.day) as first
    from te_days d, unnest(string_to_array(coalesce(d.place, ''), ' · ')) p
    where d.claim_id = p_claim and trim(p) <> ''
    group by trim(p)
  ) x
$function$;

create or replace function public.te_claim_find(p_claim uuid)
 returns text
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select lower(concat_ws(' ',
    (select string_agg(concat_ws(' ', d.place, d.district, d.purpose, d.remarks), ' ') from te_days d where d.claim_id = p_claim),
    (select string_agg(concat_ws(' ', t.ticket_no, t.place), ' ') from te_tickets t join te_days d on d.id = t.day_id where d.claim_id = p_claim),
    (select string_agg(concat_ws(' ', r.from_name, r.to_name, r.note, r.company_booking), ' ') from te_rides r join te_days d on d.id = r.day_id where d.claim_id = p_claim),
    (select string_agg(concat_ws(' ', h.name, h.note, h.company_booking), ' ') from te_hotels h join te_days d on d.id = h.day_id where d.claim_id = p_claim),
    (select c.project from te_claims c where c.id = p_claim)))
$function$;
-- Read only through the claim lists, which already decide whose claims a person sees.
revoke all on function public.te_claim_places(uuid), public.te_claim_find(uuid) from public, anon, authenticated;

drop function if exists public.te_my_claims();
CREATE OR REPLACE FUNCTION public.te_my_claims()
 RETURNS TABLE(id uuid, month date, part integer, status text, number text, total numeric, days integer, first_day date, last_day date, km numeric, modes text[], tickets integer, bills_missing integer, submitted_at timestamp with time zone, returned_at timestamp with time zone, places text[], find text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select c.id, c.month, c.part, c.status, c.number, te_total(c.id),
    (select count(*)::int from te_days d where d.claim_id = c.id),
    (select min(day) from te_days d where d.claim_id = c.id),
    (select max(day) from te_days d where d.claim_id = c.id),
    (select coalesce(sum(case when r.mode in ('bike', 'car') then coalesce(r.claimed_km, r.map_km) else r.map_km end), 0)
       from te_rides r join te_days d on d.id = r.day_id where d.claim_id = c.id),
    (select coalesce(array_agg(distinct r.mode), '{}') from te_rides r join te_days d on d.id = r.day_id where d.claim_id = c.id),
    (select count(distinct t.ticket_no)::int from te_tickets t join te_days d on d.id = t.day_id where d.claim_id = c.id),
    -- As te_submit asks them (te_0048): train, flight, a bus that leaves its district; another fare over the limit; hotel nights; the listed expenses.
    (select count(*)::int from (
       select r.id from te_rides r join te_days d on d.id = r.day_id where d.claim_id = c.id
         and (r.mode in ('train', 'flight') or (r.mode = 'bus' and coalesce(r.inter, true)) or (r.mode not in ('bike', 'car') and r.amount > (te_pol('bill_over'))::text::numeric))
         and not exists (select 1 from te_bills b where b.owner_id = r.id)
       union all select h.id from te_hotels h join te_days d on d.id = h.day_id where d.claim_id = c.id and not exists (select 1 from te_bills b where b.owner_id = h.id)
       union all select x.id from te_expenses x join te_days d on d.id = x.day_id where d.claim_id = c.id
         and (x.amount > (te_pol('bill_over'))::text::numeric or x.category in ('Courier', 'Toll', 'Client meal', 'Team meal'))
         and not exists (select 1 from te_bills b where b.owner_id = x.id)) m),
    c.submitted_at,
    greatest(c.returned_at, c.last_recalled_at),
    te_claim_places(c.id), te_claim_find(c.id)
  from te_claims c where c.employee_id = current_employee_id() order by c.month desc, c.part desc
$function$
;
drop function if exists public.te_inbox();
CREATE OR REPLACE FUNCTION public.te_inbox()
 RETURNS TABLE(id uuid, month date, part integer, status text, number text, total numeric, name text, ecode text, submitted_at timestamp with time zone, waiting boolean, days integer, first_day date, last_day date, km numeric, modes text[], tickets integer, places text[], find text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
       from te_rides r join te_days d on d.id = r.day_id where d.claim_id = m.id),
    (select coalesce(array_agg(distinct r.mode), '{}') from te_rides r join te_days d on d.id = r.day_id where d.claim_id = m.id),
    (select count(distinct t.ticket_no)::int from te_tickets t join te_days d on d.id = t.day_id where d.claim_id = m.id),
    te_claim_places(m.id), te_claim_find(m.id)
  from mine m order by m.waiting desc, m.submitted_at desc nulls last limit 200
$function$
;
revoke execute on function public.te_my_claims(), public.te_inbox() from public, anon;
grant execute on function public.te_my_claims(), public.te_inbox() to authenticated;
