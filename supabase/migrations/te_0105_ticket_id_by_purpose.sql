/*
  te_0105 — a Ticket ID tick on each purpose (the user, 3 Nov, renaming Breakdown: "make it service, and check box for
  ticket id enable option"). A ride asks for the ticket ID by its purpose's tick, no longer by "breakdown" in its name,
  so the purpose can be renamed and deleted like any other. The purposes named breakdown now carry the tick.
*/
alter table public.te_purposes add column if not exists needs_ticket boolean not null default false;
update public.te_purposes set needs_ticket = true where label ~* 'breakdown';

create or replace function public.te_needs_ticket(p_purpose text) returns boolean
 language sql stable security definer set search_path to 'public' as $$
  select exists (select 1 from te_purposes where label = p_purpose and needs_ticket)
$$;
revoke all on function public.te_needs_ticket(text) from public, anon;
grant execute on function public.te_needs_ticket(text) to authenticated;

-- The purposes whose rides ask for the ticket ID, for the app.
create or replace function public.te_ticket_purposes() returns text[]
 language sql stable security definer set search_path to 'public' as $$
  select coalesce(array_agg(label), '{}') from te_purposes where needs_ticket
$$;
revoke all on function public.te_ticket_purposes() from public, anon;
grant execute on function public.te_ticket_purposes() to authenticated;

create or replace function public.te_set_purpose_ticket(p_id integer, p_on boolean)
returns void language plpgsql security definer set search_path to 'public' as $$
begin
  if not is_sw_admin() then raise exception 'Only SW Admin sets the ticket ID'; end if;
  update te_purposes set needs_ticket = p_on where id = p_id;
  if not found then raise exception 'That purpose is not there any more'; end if;
end $$;
revoke all on function public.te_set_purpose_ticket(integer, boolean) from public, anon;
grant execute on function public.te_set_purpose_ticket(integer, boolean) to authenticated;

-- Without the breakdown name checks.
CREATE OR REPLACE FUNCTION public.te_set_purpose(p_id integer, p_label text, p_gives_da boolean, p_active boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare old text; lbl text := btrim(coalesce(p_label, ''));
begin
  if not te_is_admin() then raise exception 'Only SW Admin or ACC Admin'; end if;
  if lbl = '' then raise exception 'Type the purpose'; end if;
  if exists (select 1 from te_purposes where lower(label) = lower(lbl) and id is distinct from p_id) then raise exception 'There is a purpose "%" already', lbl; end if;
  if p_id is null then
    insert into te_purposes (label, gives_da, sort) values (lbl, p_gives_da, (select coalesce(max(sort), 0) + 1 from te_purposes));
    return;
  end if;
  select label into old from te_purposes where id = p_id;
  if old is null then raise exception 'That purpose is not there any more'; end if;
  update te_purposes set label = lbl, gives_da = p_gives_da, is_active = p_active where id = p_id;
  if old <> lbl then
    update te_days set purpose = lbl where purpose = old;
    update te_rides set purpose = lbl where purpose = old;
  end if;
end $function$;

CREATE OR REPLACE FUNCTION public.te_delete_purpose(p_id integer)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare lbl text; n int;
begin
  if not is_sw_admin() then raise exception 'Only SW Admin deletes a purpose'; end if;
  select label into lbl from te_purposes where id = p_id;
  if lbl is null then raise exception 'That purpose is not there any more'; end if;
  select (select count(*) from te_rides where purpose = lbl) + (select count(*) from te_days where purpose = lbl) into n;
  if n > 0 then raise exception '% is used on % rides or days. Untick In use instead', lbl, n; end if;
  delete from te_purposes where id = p_id;
end $function$;

CREATE OR REPLACE FUNCTION public.te_submit(p_claim uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare c te_claims; due date; late int := 0; steps jsonb := te_pol('late_pct'); over numeric := (te_pol('bill_over'))::text::numeric; missing text;
  near_m numeric := coalesce((te_pol('photo_near_m'))::text::numeric, 500); lim int := coalesce((te_pol('photo_skips'))::text::int, 3); used int;
begin
  select * into c from te_claims where id = p_claim;
  if not te_can_edit(p_claim) then raise exception 'This claim cannot be sent now'; end if;
  if not exists (select 1 from te_days where claim_id = p_claim) then raise exception 'Add at least one day first'; end if;
  -- Bills the policy asks for, each named (the user, 19 Oct: "don't know in which is having error").
  select string_agg(item, '; ' order by ord, item) into missing from (
    select d.day as ord, to_char(d.day, 'FMDD Mon') || ' · ' || case r.mode when 'taxi_bike' then 'Uber / Taxi bike' when 'taxi' then 'Uber / Taxi car' else initcap(r.mode) end || ' ride ' || split_part(coalesce(r.from_name, '—'), ',', 1) || ' → ' || split_part(coalesce(r.to_name, '—'), ',', 1) as item
    from te_rides r join te_days d on d.id = r.day_id
    where d.claim_id = p_claim and r.same_ticket is null and r.mode not in ('bike', 'car') and (r.amount > over or r.mode = 'taxi_bike') and not exists (select 1 from te_bills b where b.owner_id = r.id)
    union all
    select d.day, to_char(d.day, 'FMDD Mon') || ' · Hotel night' from te_hotels h join te_days d on d.id = h.day_id
    where d.claim_id = p_claim and h.amount > over and not exists (select 1 from te_bills b where b.owner_id = h.id)
    union all
    select d.day, to_char(d.day, 'FMDD Mon') || ' · ' || x.category from te_expenses x join te_days d on d.id = x.day_id
    where d.claim_id = p_claim and (x.amount > over or x.category in (select label from te_expense_kinds where bill_always)) and not exists (select 1 from te_bills b where b.owner_id = x.id)
  ) s;
  if missing is not null then raise exception 'Attach the bill for %', missing; end if;
  -- A ride whose purpose asks for a ticket ID names its ticket (te_0060; te_0105 by the tick, not the name).
  select string_agg(to_char(d.day, 'FMDD Mon') || ' · ' || initcap(r.mode) || ' ride ' || split_part(coalesce(r.from_name, '—'), ',', 1) || ' → ' || split_part(coalesce(r.to_name, '—'), ',', 1), '; ' order by d.day, r.seq)
    into missing
    from te_rides r join te_days d on d.id = r.day_id
   where d.claim_id = p_claim and te_needs_ticket(r.purpose)
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
  -- Visit photos (te_0082, te_0092): a ride for a purpose needing one has its own photo that day within reach, or "Photo not possible" with a reason.
  if coalesce((te_pol('visit_photos'))::text::boolean, false) then
    select string_agg(to_char(d.day, 'FMDD Mon') || ' · ' || initcap(r.mode) || ' ride ' || split_part(coalesce(r.from_name, '—'), ',', 1) || ' → ' || split_part(coalesce(r.to_name, '—'), ',', 1), '; ' order by d.day, r.seq)
      into missing
      from te_rides r join te_days d on d.id = r.day_id
     where d.claim_id = p_claim and r.purpose in (select label from te_purposes where photo_needed)
       and r.to_lat is not null and lower(btrim(split_part(coalesce(r.to_name, ''), ',', 1))) <> 'home'
       and coalesce(btrim(r.photo_skip), '') = ''
       and r.id in (select te_rides_without_photo(p_claim));
    if missing is not null then raise exception 'Take the visit photo, or choose Photo not possible, for %', missing; end if;
    if coalesce(te_pol('photo_after') #>> '{}', 'block') = 'block' then
      select count(*) into used from te_rides r join te_days d on d.id = r.day_id join te_claims k on k.id = d.claim_id
       where k.employee_id = c.employee_id and k.month = c.month and coalesce(btrim(r.photo_skip), '') <> '' and (k.id = p_claim or k.status <> 'draft');
      if used > lim then raise exception 'Photo not possible is chosen % times in %. The limit is % a month', used, to_char(c.month, 'FMMonth'), lim; end if;
    end if;
  end if;
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
end $function$;
