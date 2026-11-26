/*
  te_0079: a bike or car ride's km: the Travel Desk changes it to any figure (the user, 27 Oct: "only travel desk persons
  can change it, ie for them no upper or lower limit"); the manager and the coordinator from the map's km to the
  tolerance more ("manager can edit km, but only from lower to upper limit"). The change shows in the observations as
  before ("Changed by an approver").
*/
CREATE OR REPLACE FUNCTION public.te_adjust(p_claim uuid, p_kind text, p_item uuid, p_value numeric, p_reason text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  c te_claims; me uuid := current_employee_id(); mgr uuid; r te_grade_rules; rd te_rides;
  day_of date; old_v numeric; old_a numeric; new_a numeric; u text := '₹'; lbl text;
  fmt_old text; fmt_new text; tol numeric; lo numeric; hi numeric;
begin
  select * into c from te_claims where id = p_claim for update;
  if c.id is null then raise exception 'No such claim'; end if;
  select reporting_manager_id into mgr from employees where id = c.employee_id;
  if not ((c.status = 'with_manager' and (mgr = me or te_is_admin()))
       or (c.status = 'with_coordinator' and (te_claim_coordinator(c.id) = me or te_is_admin()))
       or (c.status = 'with_desk' and te_is_desk())) then
    raise exception 'Only whoever the claim waits on can change it';
  end if;
  if c.employee_id = me then raise exception 'Nobody changes their own claim here'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'Say why it is changed'; end if;
  if p_value is null or p_value < 0 then raise exception 'Type the new figure'; end if;
  r := te_rule(c.grade);

  if p_kind = 'ride' then
    select x.* into rd from te_rides x join te_days d on d.id = x.day_id where x.id = p_item and d.claim_id = p_claim;
    if rd.id is null then raise exception 'That ride is not on this claim'; end if;
    select day into day_of from te_days where id = rd.day_id;
    lbl := initcap(rd.mode) || ' ' || split_part(coalesce(rd.from_name, '—'), ',', 1) || ' → ' || split_part(coalesce(rd.to_name, '—'), ',', 1);
    old_a := rd.amount;
    if rd.mode in ('bike', 'car') then
      if not (c.status = 'with_desk' and te_is_desk()) and rd.map_km is not null then
        tol := coalesce((select (value #>> '{}')::numeric from te_policy where key = 'km_tolerance_pct'), 10);
        -- To a tenth, outward, as the app works it out (claims.ts kmRange).
        lo := floor(round(rd.map_km * 10000) / 1000) / 10;
        hi := ceil(round(rd.map_km * (1 + tol / 100) * 10000) / 1000) / 10;
        if p_value < lo or p_value > hi then
          raise exception 'The km can be % to % km (the map''s km to % more)', lo, hi, tol::text || '%';
        end if;
      end if;
      u := 'km'; old_v := rd.claimed_km;
      new_a := round(p_value * case when rd.mode = 'bike' then coalesce(r.bike_rate, 5) else coalesce(r.car_rate, 11) end, 2);
      if old_v is not distinct from p_value then return; end if;
      update te_rides set claimed_km = p_value, amount = new_a where id = p_item;
    else
      old_v := rd.fare; new_a := p_value;
      if old_v is not distinct from p_value then return; end if;
      update te_rides set fare = p_value, amount = p_value where id = p_item;
    end if;
  elsif p_kind = 'hotel' then
    select h.amount, d.day, 'Hotel' || coalesce(' ' || nullif(trim(h.name), ''), '') into old_v, day_of, lbl
    from te_hotels h join te_days d on d.id = h.day_id where h.id = p_item and d.claim_id = p_claim;
    if day_of is null then raise exception 'That hotel night is not on this claim'; end if;
    if old_v is not distinct from p_value then return; end if;
    old_a := old_v; new_a := p_value;
    update te_hotels set amount = p_value where id = p_item;
  elsif p_kind = 'expense' then
    select x.amount, d.day, x.category || coalesce(' · ' || nullif(trim(x.description), ''), '') into old_v, day_of, lbl
    from te_expenses x join te_days d on d.id = x.day_id where x.id = p_item and d.claim_id = p_claim;
    if day_of is null then raise exception 'That expense is not on this claim'; end if;
    if old_v is not distinct from p_value then return; end if;
    old_a := old_v; new_a := p_value;
    update te_expenses set amount = p_value where id = p_item;
  elsif p_kind = 'da' then
    select da_amount, day, 'DA' into old_v, day_of, lbl from te_days where id = p_item and claim_id = p_claim;
    if day_of is null then raise exception 'That day is not on this claim'; end if;
    if old_v is not distinct from p_value then return; end if;
    old_a := old_v; new_a := p_value;
    update te_days set da_amount = p_value where id = p_item;
  else
    raise exception 'Nothing to change there';
  end if;

  insert into te_adjustments (claim_id, item_kind, item_id, label, unit, old_value, new_value, old_amount, new_amount, reason, by_id)
  values (p_claim, p_kind, p_item, lbl, u, old_v, p_value, old_a, new_a, trim(p_reason), me);
  fmt_old := case when u = 'km' then rtrim(rtrim(to_char(coalesce(old_v, 0), 'FM999990.0'), '0'), '.') || ' km (₹' || trim(to_char(coalesce(old_a, 0), 'FM999,999,990')) || ')'
                  else '₹' || trim(to_char(coalesce(old_v, 0), 'FM999,999,990')) end;
  fmt_new := case when u = 'km' then rtrim(rtrim(to_char(p_value, 'FM999990.0'), '0'), '.') || ' km (₹' || trim(to_char(new_a, 'FM999,999,990')) || ')'
                  else '₹' || trim(to_char(p_value, 'FM999,999,990')) end;
  insert into te_events (claim_id, actor_id, action, note)
  values (p_claim, me, 'adjusted', to_char(day_of, 'FMDD Mon') || ' · ' || lbl || ': ' || fmt_old || ' → ' || fmt_new || E'\n' || trim(p_reason));
  update te_claims set updated_at = now() where id = p_claim;
end $function$;
