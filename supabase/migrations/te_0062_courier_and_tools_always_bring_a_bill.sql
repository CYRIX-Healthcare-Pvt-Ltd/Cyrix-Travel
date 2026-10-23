-- Travel Expense · te_0062 · a courier and a tool always bring their bill
-- The user, 23 Oct: under the ₹300 rule (te_0060) a courier or a tool still needs its bill, whatever it cost.

CREATE OR REPLACE FUNCTION public.te_submit(p_claim uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare c te_claims; due date; late int := 0; steps jsonb := te_pol('late_pct'); over numeric := (te_pol('bill_over'))::text::numeric; missing text;
begin
  select * into c from te_claims where id = p_claim;
  if not te_can_edit(p_claim) then raise exception 'This claim cannot be sent now'; end if;
  if not exists (select 1 from te_days where claim_id = p_claim) then raise exception 'Add at least one day first'; end if;
  -- Bills the policy asks for, each named (the user, 19 Oct: "don't know in which is having error").
  select string_agg(item, '; ' order by ord, item) into missing from (
    select d.day as ord, to_char(d.day, 'FMDD Mon') || ' · ' || initcap(r.mode) || ' ride ' || split_part(coalesce(r.from_name, '—'), ',', 1) || ' → ' || split_part(coalesce(r.to_name, '—'), ',', 1) as item
    from te_rides r join te_days d on d.id = r.day_id
    where d.claim_id = p_claim and r.same_ticket is null and r.mode not in ('bike', 'car') and r.amount > over and not exists (select 1 from te_bills b where b.owner_id = r.id)
    union all
    select d.day, to_char(d.day, 'FMDD Mon') || ' · Hotel night' from te_hotels h join te_days d on d.id = h.day_id
    where d.claim_id = p_claim and h.amount > over and not exists (select 1 from te_bills b where b.owner_id = h.id)
    union all
    select d.day, to_char(d.day, 'FMDD Mon') || ' · ' || x.category from te_expenses x join te_days d on d.id = x.day_id
    where d.claim_id = p_claim and (x.amount > over or x.category in ('Courier', 'Tools')) and not exists (select 1 from te_bills b where b.owner_id = x.id)
  ) s;
  if missing is not null then raise exception 'Attach the bill for %', missing; end if;
  -- A breakdown call names its ticket (te_0060).
  select string_agg(to_char(d.day, 'FMDD Mon') || ' · ' || initcap(r.mode) || ' ride ' || split_part(coalesce(r.from_name, '—'), ',', 1) || ' → ' || split_part(coalesce(r.to_name, '—'), ',', 1), '; ' order by d.day, r.seq)
    into missing
    from te_rides r join te_days d on d.id = r.day_id
   where d.claim_id = p_claim and r.purpose ilike '%breakdown%'
     and not exists (select 1 from te_tickets t where t.id = r.id and btrim(t.ticket_no) <> '');
  if missing is not null then raise exception 'Enter the ticket ID for %', missing; end if;
  -- Remarks on every flight, train and hotel night (te_0042; the user, 21 Oct).
  select string_agg(item, '; ' order by ord, item) into missing from (
    select d.day as ord, to_char(d.day, 'FMDD Mon') || ' · ' || initcap(r.mode) || ' ' || split_part(coalesce(r.from_name, '—'), ',', 1) || ' → ' || split_part(coalesce(r.to_name, '—'), ',', 1) as item
    from te_rides r join te_days d on d.id = r.day_id
    where d.claim_id = p_claim and r.mode in ('flight', 'train') and coalesce(btrim(r.note), '') = ''
    union all
    select d.day, to_char(d.day, 'FMDD Mon') || ' · Hotel night' from te_hotels h join te_days d on d.id = h.day_id
    where d.claim_id = p_claim and coalesce(btrim(h.note), '') = ''
  ) s;
  if missing is not null then raise exception 'Write the remarks for %', missing; end if;
  -- Late: due by the 5th of the next month; 1, 2, 3 months after that take 10, 20, 30 percent; later is refused.
  due := (c.month + interval '1 month')::date + ((te_pol('submit_by_day'))::text::int - 1);
  if current_date > due then
    late := ((extract(year from age(current_date, due)) * 12 + extract(month from age(current_date, due)))::int) + 1;
    if late > jsonb_array_length(steps) then raise exception 'This month is more than % months late and cannot be claimed', jsonb_array_length(steps); end if;
    late := (steps->>(late - 1))::int;
  end if;
  update te_claims set status = 'with_manager', submitted_at = now(), late_pct = late, return_note = null,
    number = coalesce(number, te_number(nextval('te_claim_seq')::int)),
    updated_at = now()
  where id = p_claim returning number into c.number;
  return c.number;
end $function$
;
