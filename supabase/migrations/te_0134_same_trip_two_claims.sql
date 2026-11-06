/*
  te_0134 — The same trip on two people's claims (the user, 6 Nov: "for 3, whoever done it, show as observation, it is
  critical findings isnt?"; "shared auto likely with the partner name also"). Two engineers travelling together each
  claimed the same autos on 4–5 Nov, and one claimed a train ticket for both of them while the other claimed the same
  train again (3 Nov, one PNR). Said on both claims, and only with proof of place and time (the user: "check the correct
  from to location, time matching, or else we are giving false allegation"):
    · a hired vehicle (auto, taxi, car): the other ride starts within 1 km and ends within 1 km of this one, on a trip
      over 1 km;
    · a ticket (train, bus, flight): the same mode, from within 5 km and to within 30 km, with one fare at least 1.6
      times the other, so one ticket for two;
  and for both, the two people's visit photos that day within 30 minutes and 1 km of each other, at the trip's start or
  end. Test accounts match only test accounts; a ride with no places, a commute, a company booking or ₹0 never matches.
  Read through te_claim only.
*/
create index if not exists te_days_day on public.te_days (day);

create or replace function public.te_shared_rides(p_claim uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  with mine as (
    select r.id, r.mode, r.from_lat, r.from_lng, r.to_lat, r.to_lng, r.amount, d.day, k.employee_id emp, te_is_test(k.employee_id) test
    from te_claims k join te_days d on d.claim_id = k.id join te_rides r on r.day_id = d.id
    where k.id = p_claim and r.amount > 0 and not coalesce(r.commute, false) and r.company_booking is null
      and r.from_lat is not null and r.to_lat is not null and r.mode in ('auto', 'taxi', 'car', 'train', 'bus', 'flight')
  ), pair as (
    select m.id ride, m.day, m.emp, m.from_lat, m.from_lng, m.to_lat, m.to_lng,
      case when m.mode in ('auto', 'taxi', 'car') then 'vehicle' else 'ticket' end kind,
      o.id other_ride, o.mode, o.from_name, o.to_name, o.amount, o.note,
      k2.number, k2.status, k2.employee_id other_emp, e2.full_name, e2.ecode
    from mine m
    join te_days d2 on d2.day = m.day
    join te_claims k2 on k2.id = d2.claim_id and k2.employee_id <> m.emp
    join te_rides o on o.day_id = d2.id
    join employees e2 on e2.id = k2.employee_id
    where o.amount > 0 and not coalesce(o.commute, false) and o.company_booking is null
      and o.from_lat is not null and o.to_lat is not null
      and te_is_test(k2.employee_id) = m.test
      and ((m.mode in ('auto', 'taxi', 'car') and o.mode in ('auto', 'taxi', 'car')
            and te_km(m.from_lat, m.from_lng, o.from_lat, o.from_lng) <= 1 and te_km(m.to_lat, m.to_lng, o.to_lat, o.to_lng) <= 1
            and greatest(te_km(m.from_lat, m.from_lng, m.to_lat, m.to_lng), te_km(o.from_lat, o.from_lng, o.to_lat, o.to_lng)) > 1)
        or (m.mode in ('train', 'bus', 'flight') and o.mode = m.mode
            and te_km(m.from_lat, m.from_lng, o.from_lat, o.from_lng) <= 5 and te_km(m.to_lat, m.to_lng, o.to_lat, o.to_lng) <= 30
            and greatest(m.amount, o.amount) >= 1.6 * least(m.amount, o.amount)))
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'ride', p.ride, 'kind', p.kind, 'name', p.full_name, 'ecode', p.ecode, 'number', p.number, 'status', p.status,
      'mode', p.mode, 'from', p.from_name, 'to', p.to_name, 'amount', p.amount, 'note', nullif(btrim(coalesce(p.note, '')), ''),
      'bill', exists (select 1 from te_bills b where b.owner_kind = 'ride' and b.owner_id = p.other_ride),
      'mine_at', t.mine_at, 'other_at', t.other_at, 'place', t.place, 'at', t.at) order by p.day, p.ride), '[]'::jsonb)
  from pair p
  cross join lateral (
    -- The two photos nearest in time: one of each person, together, where the trip starts or ends — and which end.
    select v1.shot_at mine_at, v2.shot_at other_at, coalesce(v1.place, v2.place) place,
      case when te_km(v1.lat, v1.lng, p.from_lat, p.from_lng) <= te_km(v1.lat, v1.lng, p.to_lat, p.to_lng) then 'start' else 'end' end at
    from te_visit_photos v1 join te_visit_photos v2 on v2.employee_id = p.other_emp
    where v1.employee_id = p.emp
      and v1.day between p.day - 1 and p.day + 1 and v2.day between p.day - 1 and p.day + 1
      and (v1.shot_at at time zone 'Asia/Kolkata')::date = p.day and (v2.shot_at at time zone 'Asia/Kolkata')::date = p.day
      and abs(extract(epoch from v1.shot_at - v2.shot_at)) <= 1800
      and v1.lat is not null and v2.lat is not null
      and te_km(v1.lat, v1.lng, v2.lat, v2.lng) <= 1
      and (te_km(v1.lat, v1.lng, p.from_lat, p.from_lng) <= case p.kind when 'vehicle' then 1 else 5 end
           or te_km(v1.lat, v1.lng, p.to_lat, p.to_lng) <= case p.kind when 'vehicle' then 1 else 30 end)
    order by abs(extract(epoch from v1.shot_at - v2.shot_at)) limit 1) t
$$;
revoke all on function public.te_shared_rides(uuid) from public, anon, authenticated;

-- te_claim carries it, for the claim's Observations (both people's claims) and the Approvals page.
do $$
declare f text;
  was text := $q$'policy', (select jsonb_object_agg(key, value) from te_policy),$q$;
begin
  f := pg_get_functiondef('public.te_claim(uuid)'::regprocedure);
  if position('te_shared_rides' in f) > 0 then return; end if;
  if position(was in f) = 0 then raise exception 'te_claim changed'; end if;
  execute replace(f, was, $q$-- The same trip on another person's claim, with proof of place and time (te_0134).
    'shared', te_shared_rides(c.id),
    $q$ || was);
end $$;
