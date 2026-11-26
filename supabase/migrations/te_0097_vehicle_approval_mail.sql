/*
  te_0097 — the mail for an out-of-policy vehicle (te_0096; the user, 3 Nov: "after approval a mail will go to
  requested person and his reporting manager isnt? like advance mail goes", then "ok good" to the preview):
  when the Travel Desk approves it, and when the manager removes it. To the person, copied to the reporting
  manager and the Travel Desk, sent by KPI's travel-mail function (words in travel-mail/vehicle.ts there).

  Sent as te_0067 sends the advance mail: the decision calls travel-mail at once (pg_net), pg_cron every five
  minutes picks up anything missed; each mail is claimed before it is sent so it goes once; a failure is written
  on the row (mail_error), not tried again.
*/
alter table public.te_vehicle_approvals
  add column if not exists mailed_at timestamptz,
  add column if not exists removed_mailed_at timestamptz,
  add column if not exists mail_error text;

create or replace function public.te_va_mail_claim(p_limit integer default 20)
returns table (id uuid, number text, kind text, mode text, label text, from_day date, to_day date, until date,
               reason text, letter_name text, created_at timestamptz,
               name text, ecode text, designation text, grade text, email text,
               manager_name text, manager_ecode text, manager_email text, manager_at timestamptz,
               desk_name text, desk_at timestamptz, removed_name text, removed_at timestamptz, note text, desk_emails text[])
language sql security definer set search_path = public as $$
  with a as (
    select v.id from te_vehicle_approvals v
    where v.status in ('approved', 'removed') and v.desk_at is not null and v.mailed_at is null
    order by v.desk_at limit greatest(1, least(coalesce(p_limit, 20), 100)) for update skip locked
  ), ua as (
    update te_vehicle_approvals v set mailed_at = now() from a where v.id = a.id returning v.*, 'approved'::text as kind
  ), r as (
    select v.id from te_vehicle_approvals v
    where v.status = 'removed' and v.removed_mailed_at is null
    order by v.removed_at limit greatest(1, least(coalesce(p_limit, 20), 100)) for update skip locked
  ), ur as (
    update te_vehicle_approvals v set removed_mailed_at = now() from r where v.id = r.id returning v.*, 'removed'::text as kind
  ), u as (select * from ua union all select * from ur)
  select u.id, u.number, u.kind, u.mode, te_va_label(u.mode), u.from_day, u.to_day, te_va_until(t),
         u.reason, u.letter_name, u.created_at,
         e.full_name, e.ecode, e.designation, e.grade, nullif(btrim(e.work_email), ''),
         m.full_name, m.ecode, nullif(btrim(m.work_email), ''), u.manager_at,
         d.full_name, u.desk_at, x.full_name, u.removed_at, u.note,
         (select coalesce(array_agg(nullif(btrim(y.work_email), '')) filter (where nullif(btrim(y.work_email), '') is not null), '{}')
          from user_roles ro join employees y on y.id = ro.employee_id where ro.role = 'travel_desk' and y.is_active)
  from u
  join te_vehicle_approvals t on t.id = u.id
  join employees e on e.id = u.employee_id
  left join employees m on m.id = u.manager_by
  left join employees d on d.id = u.desk_by
  left join employees x on x.id = u.removed_by
  order by u.kind, u.id
$$;

create or replace function public.te_va_mail_failed(p_id uuid, p_error text)
returns void language sql security definer set search_path = public as $$
  update te_vehicle_approvals set mail_error = left(coalesce(p_error, 'failed'), 500) where id = p_id
$$;

-- The desk's approval and the manager's removal send at once (the same call as the advance mail).
create or replace function public.te_va_mail_now()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status in ('approved', 'removed') and old.status is distinct from new.status then perform te_advance_mail_call(); end if;
  return new;
end $$;
drop trigger if exists te_va_mail_now on public.te_vehicle_approvals;
create trigger te_va_mail_now after update of status on public.te_vehicle_approvals
  for each row execute function public.te_va_mail_now();

revoke all on function public.te_va_mail_claim(integer), public.te_va_mail_failed(uuid, text), public.te_va_mail_now()
  from public, anon, authenticated;
grant execute on function public.te_va_mail_claim(integer), public.te_va_mail_failed(uuid, text) to service_role;
