/*
  te_0138 — One mail for a person's claims approved together (the user, 9 Nov: "suppose there is 5 claims of e6666, so
  when travel desk approves all, will it go as 5 mails ... build the combined mail").

  A person's approved claims wait for their mail until 2 minutes have passed with no new Travel Desk approval for that
  person; then all of them are handed over at once and KPI's travel-mail sends one mail (one claim: the same mail as
  before). Approve all approves one claim after another, so without the wait the first would go alone. The mail
  function runs every 5 minutes, so the mail goes within about 7 minutes of the last approval.

  The rows now carry each claim's first and last day for the mail's table, and come a person at a time: the limit is
  on people, so one person's claims are never split between two calls.
*/
drop function if exists public.te_claim_mail_claim(integer);
create function public.te_claim_mail_claim(p_limit integer default 20)
returns table (id uuid, number text, month date, amount numeric, name text, ecode text, designation text, email text,
               manager_name text, manager_email text, manager_at timestamptz, desk_name text, desk_at timestamptz, desk_note text,
               desk_emails text[], copy_emails text[], employee_id uuid, from_day date, to_day date)
language sql security definer set search_path = public as $$
  with who as (
    select v.employee_id from te_claims v where v.status = 'approved' and v.mailed_at is null
    group by v.employee_id
    having max(coalesce(v.desk_at, v.updated_at)) < now() - interval '2 minutes'
    order by min(coalesce(v.desk_at, v.updated_at)) limit greatest(1, least(coalesce(p_limit, 20), 100))
  ), c as (
    select v.id from te_claims v join who on who.employee_id = v.employee_id
    where v.status = 'approved' and v.mailed_at is null
    for update of v skip locked
  ), u as (
    update te_claims v set mailed_at = now() from c where v.id = c.id returning v.*
  )
  select u.id, u.number, u.month, te_total(u.id), e.full_name, e.ecode, e.designation, nullif(btrim(e.work_email), ''),
         m.full_name, nullif(btrim(m.work_email), ''), u.manager_at, d.full_name, u.desk_at, u.desk_note,
         (select coalesce(array_agg(nullif(btrim(x.work_email), '')) filter (where nullif(btrim(x.work_email), '') is not null), '{}')
          from user_roles r join employees x on x.id = r.employee_id where r.role = 'travel_desk' and x.is_active),
         te_mail_copy_emails('claim'), u.employee_id,
         (select min(t.day) from te_days t where t.claim_id = u.id), (select max(t.day) from te_days t where t.claim_id = u.id)
  from u join employees e on e.id = u.employee_id
  left join employees m on m.id = coalesce(u.manager_id, e.reporting_manager_id)
  left join employees d on d.id = u.desk_id
  order by u.employee_id, (select min(t.day) from te_days t where t.claim_id = u.id) nulls last, u.number
$$;
revoke all on function public.te_claim_mail_claim(integer) from public, anon, authenticated;
grant execute on function public.te_claim_mail_claim(integer) to service_role;
