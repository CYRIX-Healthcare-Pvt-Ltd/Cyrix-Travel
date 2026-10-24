/*
  te_0064 — every field of an advance request is needed (the user, 24 Oct: "for submitting all field should be
  mandatory"): the cost centre too, the person's function, which HR maps. Without it the request is refused, as
  without a home or a manager.
*/
create or replace function public.te_advance_request(
  p_amount numeric, p_purpose text, p_reason text, p_base_name text, p_base_state text,
  p_dest_name text, p_dest_lat double precision, p_dest_lng double precision, p_dest_state text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare me uuid := current_employee_id(); e employees; h travel_homes; why text; m date := date_trunc('month', now() at time zone 'Asia/Kolkata')::date;
        total numeric; most numeric; v te_advances; amt numeric := round(coalesce(p_amount, 0));
begin
  if me is null then raise exception 'Sign in first'; end if;
  select * into e from employees where id = me;
  select * into h from travel_homes where employee_id = me;
  if h.employee_id is null then raise exception 'Set your home in My places first — it is where the advance is from'; end if;
  if e.reporting_manager_id is null then raise exception 'You have no reporting manager to approve it'; end if;
  if nullif(btrim(coalesce(e.function_name, '')), '') is null then raise exception 'Your cost centre is not mapped — ask HR to set it'; end if;
  if amt <= 0 then raise exception 'Enter the advance amount'; end if;
  if length(btrim(coalesce(p_purpose, ''))) < 3 then raise exception 'Enter the purpose — the work it is for'; end if;
  if length(btrim(coalesce(p_reason, ''))) < 3 then raise exception 'Enter the reason for the advance'; end if;
  if p_dest_lat is null or p_dest_lng is null or length(btrim(coalesce(p_dest_name, ''))) = 0 then raise exception 'Choose where you are travelling to'; end if;
  if nullif(btrim(coalesce(p_base_state, '')), '') is null or nullif(btrim(coalesce(p_dest_state, '')), '') is null then
    raise exception 'The state of your home or the destination could not be found — try again';
  end if;
  -- Rule 1: out of the state only.
  if lower(btrim(p_base_state)) = lower(btrim(p_dest_state)) then
    raise exception 'An advance is only for travel outside %', btrim(p_base_state);
  end if;
  -- Rules 5 and 4.
  why := te_advance_blocked(me);
  if why is not null then raise exception '%', why; end if;
  most := coalesce((select (value #>> '{}')::numeric from te_policy where key = 'advance_month_amount'), 20000);
  select coalesce(sum(amount), 0) into total from te_advances where employee_id = me and month = m and status not in ('declined', 'cancelled');
  if total + amt > most then
    raise exception 'Up to ₹% this month — ₹% is left', to_char(most, 'FM99,99,99,990'), to_char(most - total, 'FM99,99,99,990');
  end if;
  insert into te_advances (employee_id, number, amount, purpose, reason, cost_centre, base_name, base_lat, base_lng, base_state,
                           dest_name, dest_lat, dest_lng, dest_state, month)
  values (me, te_advance_number(nextval('te_advance_seq')::int), amt, btrim(p_purpose), btrim(p_reason), nullif(btrim(coalesce(e.function_name, '')), ''),
          nullif(btrim(coalesce(p_base_name, '')), ''), h.lat, h.lng, btrim(p_base_state),
          btrim(p_dest_name), p_dest_lat, p_dest_lng, btrim(p_dest_state), m)
  returning * into v;
  perform te_advance_tell(e.reporting_manager_id, 'Advance ' || v.number || ' · ₹' || to_char(amt, 'FM99,99,99,990') || ' from ' || split_part(e.full_name, ' ', 1),
    btrim(p_base_state) || ' → ' || btrim(p_dest_name) || ' · ' || btrim(p_purpose), '/travel/approvals?view=advances', me);
  return jsonb_build_object('id', v.id, 'number', v.number);
end $$;
