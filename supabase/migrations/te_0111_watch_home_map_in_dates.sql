/*
  te_0111 — Watch: "Home set on map" only when the home was placed on the map within the dates chosen (the user, 4 Nov,
  From–To 4 Nov showing homes placed on 2 and 3 Nov: "how this is 4th observation?"). Every other sign was already dated.
*/
do $$
declare f text;
  was text := $q$from travel_homes h join real r on r.id = h.employee_id where h.how = 'map'$q$;
begin
  f := pg_get_functiondef('public.te_watch(date, date)'::regprocedure);
  if position(was in f) = 0 then raise exception 'te_watch changed'; end if;
  execute replace(f, was, was || $q$ and (h.set_at at time zone 'Asia/Kolkata')::date between f and t$q$);
end $$;
