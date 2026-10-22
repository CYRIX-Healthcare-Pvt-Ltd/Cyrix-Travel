-- Travel Expense · te_0059 · a return linked by its ticket
-- The user, 22 Oct: the round trip's return was added by hand on 9 Aug as a flight of its own, asked for a bill,
-- and the ticket — already on the 7 Aug flight — was refused as the same bill. Attaching that ticket to the return
-- now links it instead: when a ride of this claim keeps a return under that booking (return_leg, te_0058), the
-- ride becomes that return — the ticket's mode, ₹0 whatever was typed, no bill of its own, marked with what the ticket said.

create or replace function public.te_link_return(p_ride uuid, p_refs text[])
 returns text
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare r te_rides; d te_days; go te_rides; gd te_days; leg jsonb;
begin
  select * into r from te_rides where id = p_ride;
  if r.id is null then return null; end if;
  select * into d from te_days where id = r.day_id;
  if not te_can_edit(d.claim_id) then raise exception 'This claim cannot be changed now'; end if;
  if not exists (select 1 from te_claims k where k.id = d.claim_id and k.employee_id = current_employee_id()) then
    raise exception 'That claim is not yours';
  end if;
  -- The going ride of this claim whose ticket's return this is.
  select g.* into go from te_rides g join te_days x on x.id = g.day_id
  where x.claim_id = d.claim_id and g.id <> r.id and g.return_leg ->> 'ref' = any(p_refs)
  order by x.day limit 1;
  if go.id is null then return null; end if;
  select * into gd from te_days where id = go.day_id;
  leg := go.return_leg;
  update te_rides set fare = 0, amount = 0, mode = coalesce(nullif(leg ->> 'mode', ''), mode), claimed_km = null, ticket_date = nullif(leg ->> 'date', '')::date,
    note = coalesce(nullif(btrim(note), ''), format('On the %s ticket · %s', to_char(gd.day, 'FMDD Mon'), leg ->> 'ref')),
    same_ticket = jsonb_build_object('ref', leg ->> 'ref', 'day', gd.day, 'from', leg ->> 'from', 'to', leg ->> 'to', 'date', leg ->> 'date')
  where id = r.id;
  return to_char(gd.day, 'FMDD Mon');
end $function$;
revoke all on function public.te_link_return(uuid, text[]) from public, anon;
grant execute on function public.te_link_return(uuid, text[]) to authenticated;
