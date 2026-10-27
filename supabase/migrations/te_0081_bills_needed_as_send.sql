/*
  te_0081: My claims counts the bills still needed by the rule Send uses (te_submit since te_0060): a claim sent with a
  ₹299 client meal showed "1 bill needed" by the old list (the user, 27 Oct: "bill needed, when why it went to manager?").
*/
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
         and (x.amount > (te_pol('bill_over'))::text::numeric or x.category in ('Courier', 'Tools'))
         and not exists (select 1 from te_bills b where b.owner_id = x.id)) m),
    c.submitted_at,
    greatest(c.returned_at, c.last_recalled_at),
    te_claim_places(c.id), te_claim_find(c.id), te_claim_deputation(c.id)
  from te_claims c where c.employee_id = current_employee_id() order by c.month desc, c.part desc
$function$;
