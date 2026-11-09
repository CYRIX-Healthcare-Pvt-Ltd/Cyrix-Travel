/*
  te_0146 — The Google Maps screenshot notice, with the box's picture, to everybody who used Travel this month (a claim
  day, visit photo or Start my day): sent at once on 9 Nov night and again on 10 Nov at 9:00 IST (the user, 9 Nov:
  "send now and 2mrw 9 am also"). Into the Travel bell and to their devices through the push function.
*/
create or replace function public.te_notice_route_shot(p_body text, p_key text, p_with_tests boolean)
returns int language plpgsql security definer set search_path to 'public' as $f$
declare mid uuid; n int;
begin
  insert into push_messages (kind, title, body, url, target, dedupe_key, image)
  values ('travel', 'New in Travel: Google Maps screenshot', p_body, '/travel/',
          jsonb_build_object('kind', 'travel_notice', 'notice', 'route_screenshot'), p_key,
          'https://app.cyrix.in/travel/notices/route-screenshot.png')
  on conflict (dedupe_key) do nothing
  returning id into mid;
  if mid is null then return 0; end if;
  insert into push_inbox (message_id, employee_id)
  select mid, e.id from employees e
   where e.is_active and (p_with_tests or not te_is_test(e.id))
     and e.id in (
       select c.employee_id from te_claims c join te_days d on d.claim_id = c.id
        where d.day >= date_trunc('month', now() at time zone 'Asia/Kolkata')::date
       union select employee_id from te_visit_photos where day >= date_trunc('month', now() at time zone 'Asia/Kolkata')::date
       union select employee_id from te_day_starts where day >= date_trunc('month', now() at time zone 'Asia/Kolkata')::date);
  get diagnostics n = row_count;
  update push_messages set people = n where id = mid;
  perform push_call('queued');
  return n;
end $f$;
revoke all on function public.te_notice_route_shot(text, text, boolean) from public, anon, authenticated;

-- Tomorrow 9:00 IST = 03:30 UTC, once: the job takes itself away after it runs.
select cron.schedule('travel-route-shot-notice-10nov', '30 3 10 11 *', $job$
  select public.te_notice_route_shot(
    'From today, claiming more km than our map for a bike or car ride? Press Google Maps under the ride and take the screenshot there. Only a screenshot from that button is accepted. Then press Add screenshot; the km is taken from the screenshot.',
    'travel-notice:route-screenshot:2026-11-10', true);
  select cron.unschedule('travel-route-shot-notice-10nov');
$job$);
