/*
  te_0092 — one visit photo per visit.

  The user, 30 Oct: "if i went to maj took photo at 10:10, again came at 5:15 pm, so i took photo" — a photo was found for
  a ride by its place alone, so one photo at 10:10 also stood for an evening ride to the same hospital, gone to or not.
  "yes, one photo per visit": the day's rides needing a photo take them in ride order, each one no ride before it took,
  at the nearest place (within 150 m of the nearest) — the earliest taken after the ride before's photo, else the
  earliest. Travel's src/lib/visits.ts matchPhotos does the same on the phone; change both.
*/
create or replace function public.te_rides_without_photo(p_claim uuid)
 returns setof uuid
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
declare
  near_m numeric := coalesce((te_pol('photo_near_m'))::text::numeric, 500);
  owner uuid; r record; pick uuid; pick_at timestamptz; after_at timestamptz := '-infinity'; taken uuid[] := '{}';
begin
  select employee_id into owner from te_claims where id = p_claim;
  for r in
    select x.id, x.to_lat, x.to_lng, d.day from te_rides x join te_days d on d.id = x.day_id
     where d.claim_id = p_claim and x.purpose in (select label from te_purposes where photo_needed)
       and x.to_lat is not null and lower(btrim(split_part(coalesce(x.to_name, ''), ',', 1))) <> 'home'
     order by d.day, x.seq
  loop
    select v.id, v.shot_at into pick, pick_at from (
      select v.id, v.shot_at, te_m(v.lat, v.lng, r.to_lat, r.to_lng) as m
        from te_visit_photos v
       where v.employee_id = owner and v.day = r.day and not (v.id = any(taken))
         and te_m(v.lat, v.lng, r.to_lat, r.to_lng) <= near_m
    ) v
    where v.m <= (select min(te_m(w.lat, w.lng, r.to_lat, r.to_lng)) from te_visit_photos w
                   where w.employee_id = owner and w.day = r.day and not (w.id = any(taken))) + 150
    order by v.shot_at >= after_at desc, v.shot_at limit 1;
    if pick is null then return next r.id; else taken := taken || pick; after_at := pick_at; end if;
  end loop;
end $function$;
revoke all on function public.te_rides_without_photo(uuid) from public, anon, authenticated;

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
