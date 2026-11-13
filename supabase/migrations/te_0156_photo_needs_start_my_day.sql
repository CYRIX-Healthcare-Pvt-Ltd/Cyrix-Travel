/* te_0156 — a visit photo needs that day's Start my day (the user, 13 Nov: "1"). The app showed the camera only
   after Start my day, but decided it from te_my_day: when that answer was slow or failed, the camera showed and
   te_photo_add took the photo (E1997, 13 Nov, two photos and no start). Now the database refuses it too, for
   everybody Start my day applies to on the photo's day. A late-night "Visit of <day>" photo (p_day) belongs to a
   day already started and is not affected. */
do $$
declare f text; a text;
begin
  f := pg_get_functiondef('public.te_photo_add(text, double precision, double precision, real, timestamptz, text, text, text, text, date, timestamptz)'::regprocedure);
  a := $q$  -- A day not ended is ended before today's photos (te_0155).$q$;
  if position(a in f) = 0 then raise exception 'te_photo_add changed'; end if;
  execute replace(f, a, $q$  -- Start my day before the day's photos (te_0156).
  if p_day is null
     and te_rule_from('day_start_from', me) <= (shot at time zone 'Asia/Kolkata')::date
     and not exists (select 1 from te_day_starts s where s.employee_id = me and s.day = (shot at time zone 'Asia/Kolkata')::date) then
    raise exception 'Start my day first';
  end if;
$q$ || a);
end $$;
