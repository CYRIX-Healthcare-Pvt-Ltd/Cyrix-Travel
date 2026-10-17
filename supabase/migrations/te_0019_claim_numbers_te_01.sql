-- Travel Expense · te_0019 · claim numbers TE-01, TE-02, … (the user, 17 Oct: "the claim number should be TE-01")
-- One running number for every claim, given when it is first sent. The one claim numbered so far is renumbered.
create or replace function public.te_submit(p_claim uuid)
returns text language plpgsql security definer set search_path to 'public' as $f$
declare c te_claims; due date; late int := 0; steps jsonb := te_pol('late_pct'); over numeric := (te_pol('bill_over'))::text::numeric; missing text;
begin
  select * into c from te_claims where id = p_claim;
  if not te_can_edit(p_claim) then raise exception 'This claim cannot be sent now'; end if;
  if not exists (select 1 from te_days where claim_id = p_claim) then raise exception 'Add at least one day first'; end if;
  -- Bills the policy asks for.
  select string_agg(distinct to_char(d.day, 'DD Mon'), ', ') into missing from te_days d where d.claim_id = p_claim and (
    exists (select 1 from te_rides r where r.day_id = d.id and (r.mode in ('bus', 'train', 'flight') or r.amount > over)
            and not exists (select 1 from te_bills b where b.owner_id = r.id))
    or exists (select 1 from te_hotels h where h.day_id = d.id and not exists (select 1 from te_bills b where b.owner_id = h.id))
    or exists (select 1 from te_expenses x where x.day_id = d.id and (x.amount > over or x.category in ('Courier', 'Toll', 'Client meal', 'Team meal'))
            and not exists (select 1 from te_bills b where b.owner_id = x.id)));
  if missing is not null then raise exception 'Attach the bills still needed on %', missing; end if;
  -- Late: due by the 5th of the next month; 1, 2, 3 months after that take 10, 20, 30 percent; later is refused.
  due := (c.month + interval '1 month')::date + ((te_pol('submit_by_day'))::text::int - 1);
  if current_date > due then
    late := ((extract(year from age(current_date, due)) * 12 + extract(month from age(current_date, due)))::int) + 1;
    if late > jsonb_array_length(steps) then raise exception 'This month is more than % months late and cannot be claimed', jsonb_array_length(steps); end if;
    late := (steps->>(late - 1))::int;
  end if;
  update te_claims set status = 'with_manager', submitted_at = now(), late_pct = late, return_note = null,
    number = coalesce(number, 'TE-' || lpad(nextval('te_claim_seq')::text, 2, '0')),
    updated_at = now()
  where id = p_claim returning number into c.number;
  return c.number;
end $f$;
update public.te_claims set number = 'TE-' || lpad(substring(number from '(\d+)$')::int::text, 2, '0') where number like 'TE-____-%';
