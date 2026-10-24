/*
  te_0069 — a draft keeps the date it was started with (the user, 24 Oct: "how a claim starts without date? first
  we select the date and is proceeding isnt? so once started and back, then draft it should be the date i
  selected draft"). "Add a claim" picks a date, then opens the month's draft on it; going back without saving
  left a draft named only "Oct-26 claim", and Edit then opened today.

  The draft now keeps the picked date (te_claims.picked_day) until it has a saved day: its name and My claims
  show that date, and Edit opens it. Picking another date while the draft is still empty moves it there.
*/
alter table public.te_claims add column if not exists picked_day date;

drop function if exists public.te_open_month(date);
create or replace function public.te_open_month(p_month date, p_day date default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare me uuid := current_employee_id(); m date := date_trunc('month', p_month)::date; cid uuid; e employees; last te_claims; nxt int; proj text;
        pick date := case when p_day is not null and date_trunc('month', p_day)::date = date_trunc('month', p_month)::date then p_day end;
begin
  if me is null or not travel_has_access() then raise exception 'Travel Expense has not been given to you yet'; end if;
  if m > date_trunc('month', current_date)::date then raise exception 'A future month cannot be claimed'; end if;
  select * into e from employees where id = me;
  proj := coalesce(nullif(btrim(coalesce(e.function_name, '')), ''),
    (select project from te_claims where employee_id = me and nullif(trim(project), '') is not null order by updated_at desc limit 1));
  -- The part still open to change, if there is one.
  select id into cid from te_claims where employee_id = me and month = m and status in ('draft', 'returned') order by part limit 1;
  if cid is not null then
    update te_claims set project = proj where id = cid and nullif(trim(project), '') is null and proj is not null;
    -- Still empty: it takes the date just picked.
    update te_claims set picked_day = pick where id = cid and pick is not null and not exists (select 1 from te_days d where d.claim_id = cid);
    return cid;
  end if;
  select * into last from te_claims where employee_id = me order by month desc, part desc limit 1;
  select coalesce(max(part), 0) + 1 into nxt from te_claims where employee_id = me and month = m;
  insert into te_claims (employee_id, month, part, grade, designation, base_location, project, mobile, picked_day)
  values (me, m, nxt, e.grade, e.designation, coalesce(last.base_location, e.location), proj, coalesce(last.mobile, e.official_phone), pick)
  returning id into cid;
  return cid;
end $$;

revoke execute on function public.te_open_month(date, date) from public, anon;
grant execute on function public.te_open_month(date, date) to authenticated;

-- My claims: a draft with no saved day yet shows the date it was started with.
CREATE OR REPLACE FUNCTION public.te_my_claims()
 RETURNS TABLE(id uuid, month date, part integer, status text, number text, total numeric, days integer, first_day date, last_day date, km numeric, modes text[], tickets integer, bills_missing integer, submitted_at timestamp with time zone, returned_at timestamp with time zone, places text[], find text)
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

/*
  The calendar of "Add a claim" (te_0061) tells a date in a claim still open to change from one already sent (the
  user, 24 Oct: "if 24th is in draft, and if again in add a claim, 24th should be in diff color ie draft, so
  clicking again should go to the page after clicking edit button"): 'draft' marks the first, and an empty
  draft's picked date is there too.
*/
create or replace function public.te_my_claimed_days()
 returns jsonb
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select coalesce(jsonb_agg(s.x order by s.x->>'day'), '[]'::jsonb) from (
    select jsonb_build_object('day', d.day, 'claim', k.id, 'name', coalesce(k.number, to_char(k.month, 'FMMon') || ' draft'),
             'draft', k.status in ('draft', 'returned', 'recalled')) as x
      from te_days d join te_claims k on k.id = d.claim_id
     where k.employee_id = current_employee_id()
    union all
    select jsonb_build_object('day', k.picked_day, 'claim', k.id, 'name', coalesce(k.number, to_char(k.month, 'FMMon') || ' draft'), 'draft', true)
      from te_claims k
     where k.employee_id = current_employee_id() and k.status in ('draft', 'returned', 'recalled') and k.picked_day is not null
       and not exists (select 1 from te_days d where d.claim_id = k.id)
  ) s
$function$;
