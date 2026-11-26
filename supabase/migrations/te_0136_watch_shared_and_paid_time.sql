/*
  te_0136 — Two more red signs on SW Admin's Watch (the user, 7 Nov: "add both to watch … watch is the thing im showing
  to management ie with our app we have found this much"):
    shared     red  the same trip on another person's claim (te_0134), with both people's photos together
    paid_time  red  a payment screen paid at another time than the ride (te_0135): on another date than the ride's
                    (or the night after), or over 2 hours outside the ride's photos — from the photo where it starts
                    (else Start my day) to the photo where it ends; 2 hours for a photo taken late
*/
do $$
declare f text;
  anchor text := E'\n  )\n  select jsonb_build_object(';
  more text := $q$
    union all
    -- The same trip on another person's claim (te_0134).
    select dd.employee_id, dd.day, dd.number, dd.status, 'shared', 'red',
      initcap(x.mode) || ' ' || split_part(coalesce(x.from_name, ''), ',', 1) || ' → ' || split_part(coalesce(x.to_name, ''), ',', 1)
        || ': ₹' || round(coalesce(x.amount, x.fare, 0)) || ' here · '
        || case when sr.v->>'kind' = 'ticket' then 'one ticket for both likely, with ' else 'shared likely with ' end
        || (sr.v->>'name') || ' (' || (sr.v->>'ecode') || ') ' || coalesce('on ' || (sr.v->>'number'), 'on a claim not sent yet')
        || ' for ₹' || round((sr.v->>'amount')::numeric)
        || ' · photos together ' || to_char((sr.v->>'mine_at')::timestamptz at time zone 'Asia/Kolkata', 'FMHH12:MI am')
        || ' and ' || to_char((sr.v->>'other_at')::timestamptz at time zone 'Asia/Kolkata', 'FMHH12:MI am'),
      coalesce(x.amount, x.fare), jsonb_build_object('lat', x.from_lat, 'lng', x.from_lng)
    from (select distinct claim_id from dd) k
    cross join lateral jsonb_array_elements(coalesce(te_shared_rides(k.claim_id), '[]'::jsonb)) sr(v)
    join te_rides x on x.id = (sr.v->>'ride')::uuid join dd on dd.id = x.day_id
    union all
    -- Paid at another time than the ride (te_0135).
    select w.employee_id, w.day, w.number, w.status, 'paid_time', 'red',
      initcap(w.mode) || ' ' || split_part(coalesce(w.from_name, ''), ',', 1) || ' → ' || split_part(coalesce(w.to_name, ''), ',', 1)
        || ': ₹' || round(w.fare) || ' paid ' || to_char(w.paid_at at time zone 'Asia/Kolkata', 'FMDD Mon FMHH12:MI am')
        || ', the ride ' || case when w.st is null and w.en is null then 'on ' || to_char(w.day, 'FMDD Mon')
           else concat_ws(' – ', to_char(w.st at time zone 'Asia/Kolkata', 'FMDD Mon FMHH12:MI am'), to_char(w.en at time zone 'Asia/Kolkata', 'FMDD Mon FMHH12:MI am')) || ' by its photos' end,
      w.fare, jsonb_build_object('lat', w.to_lat, 'lng', w.to_lng)
    from (
      select dd.employee_id, dd.day, dd.number, dd.status, x.mode, x.from_name, x.to_name, x.to_lat, x.to_lng, x.fare, b.paid_at, st.at st, en.at en
      from te_bills b join te_rides x on b.owner_kind = 'ride' and x.id = b.owner_id join dd on dd.id = x.day_id
      cross join lateral (
        select case when x.seq = (select min(y.seq) from te_rides y where y.day_id = x.day_id)
          -- The first ride starts at Start my day; any ride else at the day's first photo where it starts.
          then coalesce((select s.at from te_day_starts s where s.employee_id = dd.employee_id and s.day = dd.day order by s.at limit 1), ph.at)
          else ph.at end at
        from (select v.shot_at at from te_visit_photos v where v.employee_id = dd.employee_id and v.day = dd.day and v.lat is not null
                and x.from_lat is not null and te_km(v.lat, v.lng, x.from_lat, x.from_lng) <= 1 order by v.shot_at limit 1) ph0
        right join (select 1) one on true
        cross join lateral (select ph0.at) ph
      ) st
      left join lateral (
        select v.shot_at at from te_visit_photos v where v.employee_id = dd.employee_id and v.day = dd.day and v.lat is not null
          and x.to_lat is not null and te_km(v.lat, v.lng, x.to_lat, x.to_lng) <= 1 and v.shot_at >= coalesce(st.at, '-infinity')
        order by v.shot_at limit 1
      ) en on true
      where b.paid_at is not null and x.fare > 0 and x.mode not in ('bike', 'car')
    ) w
    where (w.paid_at at time zone 'Asia/Kolkata')::date not in (w.day, w.day + 1)
       or w.paid_at < w.st - interval '2 hours' or w.paid_at > w.en + interval '2 hours'$q$;
begin
  f := pg_get_functiondef('public.te_watch(date,date)'::regprocedure);
  -- Run again over the first version: the part from the shared sign on is put back.
  if position('''shared'', ''red''' in f) > 0 then f := left(f, position(E'
    union all
    -- The same trip on another person''s claim (te_0134).' in f) - 1) || anchor || split_part(f, anchor, 2); end if;
  if position(anchor in f) = 0 then raise exception 'te_watch changed'; end if;
  execute replace(f, anchor, more || anchor);
end $$;
