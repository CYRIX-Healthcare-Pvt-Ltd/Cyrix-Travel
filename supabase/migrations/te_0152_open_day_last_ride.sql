/*
  te_0152 — End <day> the next morning names the day's last ride (the user, 12 Nov: "last to of 11th will be the last
  location, but we checks the location"): te_my_day gives 'open_last', the To of the open day's last ride in the
  person's claims, or null when no ride is in yet. The sheet shows it instead of a map; the phone's place is still kept.
*/
create or replace function public.te_last_ride_to(p_emp uuid, p_day date) returns text
 language sql stable security definer set search_path to 'public' as $$
  select split_part(r.to_name, ',', 1)
    from te_rides r join te_days d on d.id = r.day_id join te_claims c on c.id = d.claim_id
   where c.employee_id = p_emp and d.day = p_day and r.to_name is not null
   order by r.seq desc limit 1
$$;
revoke all on function public.te_last_ride_to(uuid, date) from public, anon, authenticated;

do $$
declare f text;
  a text := $q$'open_day', te_open_day(current_employee_id()))$q$;
begin
  f := pg_get_functiondef('public.te_my_day()'::regprocedure);
  if position(a in f) = 0 then raise exception 'te_my_day changed'; end if;
  execute replace(f, a, $q$'open_day', te_open_day(current_employee_id()),
    'open_last', te_last_ride_to(current_employee_id(), coalesce(te_late_day(current_employee_id()), te_open_day(current_employee_id()))))$q$);
end $$;
