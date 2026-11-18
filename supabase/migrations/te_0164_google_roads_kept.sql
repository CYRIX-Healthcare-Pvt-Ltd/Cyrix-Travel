/*
  te_0164 — Google's roads kept with the ride until the Travel Desk approves (the user, 18 Nov: "why cant we add the
  first press on a temp variable until travel desk approves? so only 1 load … if travel desk approved, we can clear
  it, ie the selected km will be saved also"). route_alts holds Google's answer for the ride's From and To
  ({ at, key, roads: [{ km, mins, via, poly }] }): the day or its map opened again, by the engineer or an approver,
  asks Google nothing. Cleared when the claim is approved, and after 30 days whatever its state (Google lets its
  answers be kept no longer). The km chosen stays in map_km and route_km for good.
*/
alter table public.te_rides add column if not exists route_alts jsonb;

do $$
declare f text;
begin
  f := pg_get_functiondef((select p.oid from pg_proc p where p.proname = 'te_save_day'));
  if position($q$project, photo_skip, commute, route_km)$q$ in f) = 0
     or position($q$coalesce(com, false), nullif(x->>'route_km', '')::numeric)$q$ in f) = 0
     or position($q$route_km = excluded.route_km;$q$ in f) = 0 then raise exception 'te_save_day changed'; end if;
  f := replace(f, $q$project, photo_skip, commute, route_km)$q$, $q$project, photo_skip, commute, route_km, route_alts)$q$);
  f := replace(f, $q$coalesce(com, false), nullif(x->>'route_km', '')::numeric)$q$,
    $q$coalesce(com, false), nullif(x->>'route_km', '')::numeric, case when jsonb_typeof(x->'route_alts') = 'object' then x->'route_alts' end)$q$);
  f := replace(f, $q$route_km = excluded.route_km;$q$, $q$route_km = excluded.route_km, route_alts = excluded.route_alts;$q$);
  execute f;
end $$;

-- Approved: the roads go.
create or replace function public.te_clear_route_alts() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'approved' and old.status is distinct from 'approved' then
    update te_rides set route_alts = null
    where route_alts is not null and day_id in (select id from te_days where claim_id = new.id);
  end if;
  return new;
end $$;
drop trigger if exists te_clear_route_alts on public.te_claims;
create trigger te_clear_route_alts after update of status on public.te_claims
  for each row execute function public.te_clear_route_alts();

-- 30 days at the most (every night, 3:15 am in India).
select cron.unschedule('te-route-alts') where exists (select 1 from cron.job where jobname = 'te-route-alts');
select cron.schedule('te-route-alts', '45 21 * * *',
  $$update public.te_rides set route_alts = null where route_alts is not null and coalesce((route_alts->>'at')::timestamptz, '-infinity') < now() - interval '30 days'$$);
