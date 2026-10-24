/*
  te_0067 — the mail when the Travel Desk approves an advance (the user, 24 Oct: "once the advance is approved by
  travel desk, a mail should go to requested emp, his reporting manager, travel desk, regarding advance amount given
  to this emp"). One mail, to the person with copies to the reporting manager and the Travel Desk, sent by KPI's
  travel-mail function from notifications@cyrix.in (the words are in supabase/functions/travel-mail/words.ts there).

  The approval itself calls travel-mail at once (pg_net, after the approval is saved); pg_cron calls it every five
  minutes as well, for anything a call missed. Each advance is claimed before it is sent, so it is mailed once, and
  a send that fails is written on the advance (mail_error), not tried again.
*/
alter table public.te_advances add column if not exists mailed_at timestamptz, add column if not exists mail_error text;

-- Advances given but not mailed, claimed so each goes once (service role, from travel-mail).
create or replace function public.te_advance_mail_claim(p_limit integer default 20)
returns table (id uuid, number text, amount numeric, purpose text, reason text, cost_centre text,
               base_name text, base_state text, dest_name text, month date, created_at timestamptz,
               name text, ecode text, designation text, email text,
               manager_name text, manager_ecode text, manager_email text, manager_at timestamptz, manager_note text,
               desk_name text, desk_at timestamptz, desk_note text, desk_emails text[])
language sql security definer set search_path = public as $$
  with c as (
    select v.id from te_advances v where v.status = 'given' and v.mailed_at is null
    order by v.desk_at limit greatest(1, least(coalesce(p_limit, 20), 100))
    for update skip locked
  ), u as (
    update te_advances v set mailed_at = now() from c where v.id = c.id returning v.*
  )
  select u.id, u.number, u.amount, u.purpose, u.reason, u.cost_centre, u.base_name, u.base_state, u.dest_name, u.month, u.created_at,
         e.full_name, e.ecode, e.designation, nullif(btrim(e.work_email), ''),
         m.full_name, m.ecode, nullif(btrim(m.work_email), ''), u.manager_at, u.manager_note,
         d.full_name, u.desk_at, u.desk_note,
         (select coalesce(array_agg(nullif(btrim(x.work_email), '')) filter (where nullif(btrim(x.work_email), '') is not null), '{}')
          from user_roles r join employees x on x.id = r.employee_id where r.role = 'travel_desk' and x.is_active)
  from u join employees e on e.id = u.employee_id
  left join employees m on m.id = u.manager_id
  left join employees d on d.id = u.desk_id
$$;

create or replace function public.te_advance_mail_failed(p_id uuid, p_error text)
returns void language sql security definer set search_path = public as $$
  update te_advances set mail_error = left(coalesce(p_error, 'failed'), 500) where id = p_id
$$;

create or replace function public.te_advance_mail_call()
returns bigint language sql security definer set search_path = public as $$
  select net.http_post(
    url     := 'https://emuvmihfbnndhbpsndvc.supabase.co/functions/v1/travel-mail',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-push-key', (select decrypted_secret from vault.decrypted_secrets where name = 'push_reminder_key')),
    body    := '{}'::jsonb,
    timeout_milliseconds := 120000)
$$;

-- The Travel Desk's approval sends it straight away.
create or replace function public.te_advance_given_mail()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'given' and old.status is distinct from 'given' then perform te_advance_mail_call(); end if;
  return new;
end $$;
drop trigger if exists te_advance_given_mail on public.te_advances;
create trigger te_advance_given_mail after update of status on public.te_advances
  for each row execute function public.te_advance_given_mail();

revoke all on function public.te_advance_mail_claim(integer), public.te_advance_mail_failed(uuid, text),
  public.te_advance_mail_call(), public.te_advance_given_mail() from public, anon, authenticated;
grant execute on function public.te_advance_mail_claim(integer), public.te_advance_mail_failed(uuid, text) to service_role;

select cron.unschedule(jobid) from cron.job where jobname = 'travel-mail';
select cron.schedule('travel-mail', '*/5 * * * *', $$select public.te_advance_mail_call()$$);
