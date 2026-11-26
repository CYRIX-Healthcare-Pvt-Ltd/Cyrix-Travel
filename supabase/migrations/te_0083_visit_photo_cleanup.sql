/*
  te_0083: Visit photos removed after payment (the user, 28 Oct: "after the claim is paid, after utr, we can remove
  images so storage wont fill", "photo deletion rule also sw admin can change … after paid how many days").
  - A photo goes photo_keep_days (SW Admin's setting, 90) after every claim it stands on is paid.
  - A photo on no claim goes six months after it was taken: later than any claim of its month can still be sent.
  - The picture goes, the facts stay: removed_at is set and the claim says "Removed after payment".
  The bucket's files can only be deleted through Storage, so the edge function travel-photos (KPI repo) does it,
  called by pg_cron every night at 03:00 India time.
*/

-- The photos due to go, oldest first.
create or replace function public.te_photos_due(p_limit int default 500)
returns table (id uuid, path text) language sql stable security definer set search_path = public as $$
  with keep as (select coalesce((te_pol('photo_keep_days'))::text::int, 90) as days),
  near as (select coalesce((te_pol('photo_near_m'))::text::numeric, 500) as m),
  stands as (
    select v.id, k.status, k.paid_at
      from te_visit_photos v
      join te_claims k on k.employee_id = v.employee_id
      join te_days d on d.claim_id = k.id and d.day = v.day
      join te_rides r on r.day_id = d.id
     where v.removed_at is null and r.to_lat is not null and te_m(v.lat, v.lng, r.to_lat, r.to_lng) <= (select m from near)
  )
  select v.id, v.path from te_visit_photos v
   where v.removed_at is null and (
     (exists (select 1 from stands s where s.id = v.id)
       and not exists (select 1 from stands s where s.id = v.id and (s.status <> 'paid' or s.paid_at is null or s.paid_at > now() - make_interval(days => (select days from keep)))))
     or (not exists (select 1 from stands s where s.id = v.id) and v.day < current_date - interval '6 months'))
   order by v.day limit p_limit
$$;

create or replace function public.te_photos_removed(p_ids uuid[])
returns void language sql security definer set search_path = public as $$
  update te_visit_photos set removed_at = now() where id = any(p_ids) and removed_at is null
$$;

create or replace function public.te_photo_cleanup_call()
returns bigint language sql security definer set search_path = public as $$
  select net.http_post(
    url     := 'https://emuvmihfbnndhbpsndvc.supabase.co/functions/v1/travel-photos',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-push-key', (select decrypted_secret from vault.decrypted_secrets where name = 'push_reminder_key')),
    body    := '{}'::jsonb,
    timeout_milliseconds := 120000)
$$;

revoke all on function public.te_photos_due(int), public.te_photos_removed(uuid[]), public.te_photo_cleanup_call() from public, anon, authenticated;

-- Every night at 03:00 India time (21:30 UTC).
select cron.unschedule('travel-photos') where exists (select 1 from cron.job where jobname = 'travel-photos');
select cron.schedule('travel-photos', '30 21 * * *', 'select public.te_photo_cleanup_call()');
