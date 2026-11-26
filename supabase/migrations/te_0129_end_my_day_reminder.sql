/*
  te_0129 — End my day reminder (the user, 5 Nov, after the second demo day: "give notification for en that end my
  day, both device and bell icon"). On 4 and 5 Nov only about half of those who pressed Start my day pressed End my
  day. At 8 pm (most End my day presses come between 4 and 10 pm), whoever pressed Start my day today and not End my
  day gets one message in the Travel bell, which the push round (every 5 minutes) also sends to their phone. It opens
  today's day in their claim when there is one, else their claims. One a person a day (dedupe_key).
  The words (the user, 5 Nov, from 6 Nov): "Hi Kevin, done for the day? 👋" / "Don’t forget to press 🌇 End my day. Tap
  here to end your day."
  p_only: that one person, whether or not they started (for showing it working on a test account).
*/
create or replace function public.te_end_day_reminders(p_only uuid default null)
returns int language plpgsql security definer set search_path = public as $f$
declare
  today date := (now() at time zone 'Asia/Kolkata')::date;
  r record; mid uuid; link text; n int := 0;
begin
  for r in
    select e.id, initcap(split_part(trim(e.full_name), ' ', 1)) first
    from employees e
    where e.is_active
      and (case when p_only is not null then e.id = p_only
                else exists (select 1 from te_day_starts s where s.employee_id = e.id and s.day = today)
                     and not exists (select 1 from te_day_ends x where x.employee_id = e.id and x.day = today) end)
  loop
    select '/travel/claim/' || c.id || '?add=' || today into link
    from te_claims c join te_days d on d.claim_id = c.id
    where c.employee_id = r.id and d.day = today and c.status in ('draft', 'returned')
    limit 1;
    insert into push_messages (kind, title, body, url, target, people, dedupe_key)
    values ('travel', 'Hi ' || r.first || ', done for the day? 👋',
            'Don’t forget to press 🌇 End my day. Tap here to end your day.',
            coalesce(link, '/travel/claims'), jsonb_build_object('kind', 'travel', 'what', 'end_day'), 1,
            'te-end-day:' || r.id || ':' || today || case when p_only is not null then ':' || extract(epoch from now())::bigint else '' end)
    on conflict (dedupe_key) do nothing
    returning id into mid;
    if mid is not null then
      insert into push_inbox (message_id, employee_id) values (mid, r.id);
      n := n + 1;
    end if;
  end loop;
  return n;
end $f$;
revoke execute on function public.te_end_day_reminders(uuid) from public, anon, authenticated;

-- 8 pm in India is 14:30 UTC.
select cron.unschedule('te-end-day') where exists (select 1 from cron.job where jobname = 'te-end-day');
select cron.schedule('te-end-day', '30 14 * * *', $$select public.te_end_day_reminders()$$);
