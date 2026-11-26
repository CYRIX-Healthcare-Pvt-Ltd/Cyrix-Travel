/*
  te_0157 — a second End my day reminder at 10 pm (the user, 13 Nov: "add 2nd reminder for 10pm for end my day
  option"). The same people as at 8 pm (Start my day today, no End my day yet), so whoever ended after the first one
  gets nothing. Its own once-a-day key (…:2), so it is not stopped by the 8 pm one. Words of the second:
  "Hi Kevin, your day is still open 🌙" / "Press 🌇 End my day before you sleep. Tap here to end your day."
*/
drop function if exists public.te_end_day_reminders(uuid);
create or replace function public.te_end_day_reminders(p_only uuid default null, p_round int default 1)
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
    values ('travel',
            case when p_round = 2 then 'Hi ' || r.first || ', your day is still open 🌙' else 'Hi ' || r.first || ', done for the day? 👋' end,
            case when p_round = 2 then 'Press 🌇 End my day before you sleep. Tap here to end your day.'
                 else 'Don’t forget to press 🌇 End my day. Tap here to end your day.' end,
            coalesce(link, '/travel/claims'), jsonb_build_object('kind', 'travel', 'what', 'end_day'), 1,
            'te-end-day:' || r.id || ':' || today || case when p_round = 2 then ':2' else '' end || case when p_only is not null then ':' || extract(epoch from now())::bigint else '' end)
    on conflict (dedupe_key) do nothing
    returning id into mid;
    if mid is not null then
      insert into push_inbox (message_id, employee_id) values (mid, r.id);
      n := n + 1;
    end if;
  end loop;
  return n;
end $f$;
revoke execute on function public.te_end_day_reminders(uuid, int) from public, anon, authenticated;

-- 10 pm in India is 16:30 UTC; the 8 pm job keeps its own name.
select cron.unschedule('te-end-day-2') where exists (select 1 from cron.job where jobname = 'te-end-day-2');
select cron.schedule('te-end-day-2', '30 16 * * *', $$select public.te_end_day_reminders(null, 2)$$);
