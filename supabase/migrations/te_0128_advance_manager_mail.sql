/*
  te_0128 — A mail to the Travel Desk when the reporting manager approves an advance (the user, 5 Nov: "travel desk told
  they want to receive mail when manager approves the advance, ie body says manager approved the advance"). The same
  way as te_0067: the approval calls KPI's travel-mail at once, pg_cron every five minutes catches a missed call, each
  advance is claimed before it is sent so it goes once, and a failed send is written on the advance.
  The words are in KPI supabase/functions/travel-mail/manager.ts. Advances approved before this are not mailed.
*/
alter table public.te_advances add column if not exists manager_mailed_at timestamptz, add column if not exists manager_mail_error text;
update public.te_advances set manager_mailed_at = now() where manager_at is not null and manager_mailed_at is null;

create or replace function public.te_advance_mgr_mail_claim(p_limit integer default 20)
returns table (id uuid, number text, amount numeric, purpose text, reason text, cost_centre text,
               base_name text, base_state text, dest_name text, month date, created_at timestamptz,
               name text, ecode text, designation text, email text,
               manager_name text, manager_ecode text, manager_email text, manager_at timestamptz, manager_note text,
               desk_name text, desk_at timestamptz, desk_note text, desk_emails text[],
               edit_note text, edited_name text, edited_at timestamptz)
language sql security definer set search_path = public as $$
  with c as (
    select v.id from te_advances v where v.manager_at is not null and v.manager_mailed_at is null
    order by v.manager_at limit greatest(1, least(coalesce(p_limit, 20), 100))
    for update skip locked
  ), u as (
    update te_advances v set manager_mailed_at = now() from c where v.id = c.id returning v.*
  )
  select u.id, u.number, u.amount, u.purpose, u.reason, u.cost_centre, u.base_name, u.base_state, u.dest_name, u.month, u.created_at,
         e.full_name, e.ecode, e.designation, nullif(btrim(e.work_email), ''),
         m.full_name, m.ecode, nullif(btrim(m.work_email), ''), u.manager_at, u.manager_note,
         null::text, null::timestamptz, null::text,
         (select coalesce(array_agg(nullif(btrim(x.work_email), '')) filter (where nullif(btrim(x.work_email), '') is not null), '{}')
          from user_roles r join employees x on x.id = r.employee_id where r.role = 'travel_desk' and x.is_active),
         u.edit_note, (select full_name from employees where id = u.edited_by), u.edited_at
  from u join employees e on e.id = u.employee_id
  left join employees m on m.id = u.manager_id
$$;

create or replace function public.te_advance_mgr_mail_failed(p_id uuid, p_error text)
returns void language sql security definer set search_path = public as $$
  update te_advances set manager_mail_error = left(coalesce(p_error, 'failed'), 500) where id = p_id
$$;

-- The manager's approval sends it straight away, as the Travel Desk's does (te_0067).
create or replace function public.te_advance_given_mail()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if (new.status = 'given' and old.status is distinct from 'given')
     or (new.status = 'with_desk' and old.status = 'with_manager') then perform te_advance_mail_call(); end if;
  return new;
end $$;

revoke all on function public.te_advance_mgr_mail_claim(integer), public.te_advance_mgr_mail_failed(uuid, text) from public, anon, authenticated;
grant execute on function public.te_advance_mgr_mail_claim(integer), public.te_advance_mgr_mail_failed(uuid, text) to service_role;
