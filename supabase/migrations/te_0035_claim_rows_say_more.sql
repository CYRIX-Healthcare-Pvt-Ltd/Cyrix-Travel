-- Travel Expense · te_0035 · a claim row says how, what is missing and where it stands
-- The user, 19 Oct: "this looks plain, is there any details to add?". Each row in My claims also gets
-- the modes travelled, the tickets attended, the bills still missing, when it was sent, and when it was
-- last sent back or recalled.

drop function if exists public.te_my_claims();
create function public.te_my_claims()
returns table (id uuid, month date, part int, status text, number text, total numeric, days int, first_day date, last_day date, km numeric,
  modes text[], tickets int, bills_missing int, submitted_at timestamptz, returned_at timestamptz)
language sql stable security definer set search_path to 'public' as $f$
  select c.id, c.month, c.part, c.status, c.number, te_total(c.id),
    (select count(*)::int from te_days d where d.claim_id = c.id),
    (select min(day) from te_days d where d.claim_id = c.id),
    (select max(day) from te_days d where d.claim_id = c.id),
    (select coalesce(sum(case when r.mode in ('bike', 'car') then coalesce(r.claimed_km, r.map_km) else r.map_km end), 0)
       from te_rides r join te_days d on d.id = r.day_id where d.claim_id = c.id),
    (select coalesce(array_agg(distinct r.mode), '{}') from te_rides r join te_days d on d.id = r.day_id where d.claim_id = c.id),
    (select count(distinct t.ticket_no)::int from te_tickets t join te_days d on d.id = t.day_id where d.claim_id = c.id),
    -- As te_submit asks them (te_0034): bus, train, flight; another fare over the limit; hotel nights; the listed expenses.
    (select count(*)::int from (
       select r.id from te_rides r join te_days d on d.id = r.day_id where d.claim_id = c.id
         and (r.mode in ('bus', 'train', 'flight') or (r.mode not in ('bike', 'car') and r.amount > (te_pol('bill_over'))::text::numeric))
         and not exists (select 1 from te_bills b where b.owner_id = r.id)
       union all select h.id from te_hotels h join te_days d on d.id = h.day_id where d.claim_id = c.id and not exists (select 1 from te_bills b where b.owner_id = h.id)
       union all select x.id from te_expenses x join te_days d on d.id = x.day_id where d.claim_id = c.id
         and (x.amount > (te_pol('bill_over'))::text::numeric or x.category in ('Courier', 'Toll', 'Client meal', 'Team meal'))
         and not exists (select 1 from te_bills b where b.owner_id = x.id)) m),
    c.submitted_at,
    greatest(c.returned_at, c.last_recalled_at)
  from te_claims c where c.employee_id = current_employee_id() order by c.month desc, c.part desc
$f$;
revoke execute on function public.te_my_claims() from public, anon;
grant execute on function public.te_my_claims() to authenticated;
