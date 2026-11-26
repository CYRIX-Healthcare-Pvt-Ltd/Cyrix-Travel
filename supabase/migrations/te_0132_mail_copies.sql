/*
  te_0132 — Mail copies (the user, 6 Nov: "accounts team told, ... if a advance is approved, they need cc for other custom
  persons also", then "add check box, ie claim, advance, vehicle, deputation"). SW Admin keeps a list of people, by
  E-code, each with four ticks; a ticked person gets a copy (cc, their work email) of that kind of Travel mail:
    advance     the advance approved by the Travel Desk (te_0067)
    vehicle     the out-of-policy vehicle approved or removed (te_0097)
    claim       new: the claim approved by the Travel Desk, to the person, copies to the manager and the Travel Desk
    deputation  new: the deputation approved by the manager, to the person, copies to the manager and the Travel Desk
  KPI's travel-mail function sends them all. Claims and deputations approved before this are marked sent, so nothing
  old goes out.
*/
create table if not exists public.te_mail_copies (
  employee_id uuid primary key references public.employees(id) on delete cascade,
  claim boolean not null default false,
  advance boolean not null default true,
  vehicle boolean not null default false,
  deputation boolean not null default false,
  added_by uuid references public.employees(id) on delete set null,
  added_at timestamptz not null default now()
);
alter table public.te_mail_copies enable row level security;
revoke all on public.te_mail_copies from anon, authenticated;

-- The list, for SW Admin.
create or replace function public.te_mail_copies_list()
returns table (employee_id uuid, ecode text, name text, email text, claim boolean, advance boolean, vehicle boolean, deputation boolean,
               added_by text, added_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_sw_admin() then raise exception 'Only SW Admin sets the mail copies'; end if;
  return query
  select c.employee_id, e.ecode, e.full_name, nullif(btrim(e.work_email), ''), c.claim, c.advance, c.vehicle, c.deputation,
         (select a.full_name || ' (' || a.ecode || ')' from employees a where a.id = c.added_by), c.added_at
  from te_mail_copies c join employees e on e.id = c.employee_id
  order by e.full_name;
end $$;

-- Add a person by E-code (Advance ticked to start), or change their ticks.
create or replace function public.te_mail_copies_set(p_ecode text, p_claim boolean default null, p_advance boolean default null,
                                                     p_vehicle boolean default null, p_deputation boolean default null)
returns void language plpgsql security definer set search_path = public as $$
declare who employees;
begin
  if not is_sw_admin() then raise exception 'Only SW Admin sets the mail copies'; end if;
  select * into who from employees where upper(ecode) = upper(btrim(p_ecode));
  if not found then raise exception 'No employee with the E-code %', btrim(p_ecode); end if;
  if not who.is_active then raise exception '% (%) is not active', who.full_name, who.ecode; end if;
  if nullif(btrim(who.work_email), '') is null then raise exception '% (%) has no work email', who.full_name, who.ecode; end if;
  insert into te_mail_copies (employee_id, claim, advance, vehicle, deputation, added_by)
  values (who.id, coalesce(p_claim, false), coalesce(p_advance, true), coalesce(p_vehicle, false), coalesce(p_deputation, false), current_employee_id())
  on conflict (employee_id) do update set
    claim = coalesce(p_claim, te_mail_copies.claim), advance = coalesce(p_advance, te_mail_copies.advance),
    vehicle = coalesce(p_vehicle, te_mail_copies.vehicle), deputation = coalesce(p_deputation, te_mail_copies.deputation);
end $$;

create or replace function public.te_mail_copies_remove(p_employee uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not is_sw_admin() then raise exception 'Only SW Admin sets the mail copies'; end if;
  delete from te_mail_copies where employee_id = p_employee;
end $$;

revoke all on function public.te_mail_copies_list() from public, anon;
revoke all on function public.te_mail_copies_set(text, boolean, boolean, boolean, boolean) from public, anon;
revoke all on function public.te_mail_copies_remove(uuid) from public, anon;
grant execute on function public.te_mail_copies_list() to authenticated;
grant execute on function public.te_mail_copies_set(text, boolean, boolean, boolean, boolean) to authenticated;
grant execute on function public.te_mail_copies_remove(uuid) to authenticated;

-- The work emails ticked for one kind of mail (the mail functions only).
create or replace function public.te_mail_copy_emails(p_kind text)
returns text[] language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(lower(btrim(e.work_email))), '{}')
  from te_mail_copies c join employees e on e.id = c.employee_id
  where e.is_active and nullif(btrim(e.work_email), '') is not null
    and case p_kind when 'claim' then c.claim when 'advance' then c.advance when 'vehicle' then c.vehicle when 'deputation' then c.deputation else false end
$$;
revoke all on function public.te_mail_copy_emails(text) from public, anon, authenticated;

-- Advance and vehicle mails: the ticked people join the Travel Desk's copies.
do $$
declare f text; was text;
begin
  f := replace(pg_get_functiondef('public.te_advance_mail_claim(integer)'::regprocedure), E'\r\n', E'\n');
  was := $w$where r.role = 'travel_desk' and x.is_active)$w$;
  if position('te_mail_copy_emails' in f) = 0 then
    if position(was in f) = 0 then raise exception 'te_advance_mail_claim changed'; end if;
    execute replace(f, was, was || $n$ || te_mail_copy_emails('advance')$n$);
  end if;
  f := replace(pg_get_functiondef('public.te_va_mail_claim(integer)'::regprocedure), E'\r\n', E'\n');
  was := $w$where ro.role = 'travel_desk' and y.is_active)$w$;
  if position('te_mail_copy_emails' in f) = 0 then
    if position(was in f) = 0 then raise exception 'te_va_mail_claim changed'; end if;
    execute replace(f, was, was || $n$ || te_mail_copy_emails('vehicle')$n$);
  end if;
end $$;

-- ---------------------------------------------------------------- the claim approved by the Travel Desk
alter table public.te_claims add column if not exists mailed_at timestamptz, add column if not exists mail_error text;
update public.te_claims set mailed_at = now() where mailed_at is null and status in ('approved', 'paid');

create or replace function public.te_claim_mail_claim(p_limit integer default 20)
returns table (id uuid, number text, month date, amount numeric, name text, ecode text, designation text, email text,
               manager_name text, manager_email text, manager_at timestamptz, desk_name text, desk_at timestamptz, desk_note text,
               desk_emails text[], copy_emails text[])
language sql security definer set search_path = public as $$
  with c as (
    select v.id from te_claims v where v.status = 'approved' and v.mailed_at is null
    order by v.desk_at nulls last limit greatest(1, least(coalesce(p_limit, 20), 100))
    for update skip locked
  ), u as (
    update te_claims v set mailed_at = now() from c where v.id = c.id returning v.*
  )
  select u.id, u.number, u.month, te_total(u.id), e.full_name, e.ecode, e.designation, nullif(btrim(e.work_email), ''),
         m.full_name, nullif(btrim(m.work_email), ''), u.manager_at, d.full_name, u.desk_at, u.desk_note,
         (select coalesce(array_agg(nullif(btrim(x.work_email), '')) filter (where nullif(btrim(x.work_email), '') is not null), '{}')
          from user_roles r join employees x on x.id = r.employee_id where r.role = 'travel_desk' and x.is_active),
         te_mail_copy_emails('claim')
  from u join employees e on e.id = u.employee_id
  left join employees m on m.id = coalesce(u.manager_id, e.reporting_manager_id)
  left join employees d on d.id = u.desk_id
$$;
create or replace function public.te_claim_mail_failed(p_id uuid, p_error text)
returns void language sql security definer set search_path = public as $$
  update te_claims set mail_error = left(p_error, 500) where id = p_id
$$;
revoke all on function public.te_claim_mail_claim(integer) from public, anon, authenticated;
revoke all on function public.te_claim_mail_failed(uuid, text) from public, anon, authenticated;

-- ---------------------------------------------------------------- the deputation approved by the manager
alter table public.te_deputations add column if not exists mailed_at timestamptz, add column if not exists mail_error text;
update public.te_deputations set mailed_at = now() where mailed_at is null and status = 'approved';

create or replace function public.te_dep_mail_claim(p_limit integer default 20)
returns table (id uuid, state text, from_day date, to_day date, letter_name text, note text, name text, ecode text, designation text,
               email text, manager_name text, manager_email text, decided_at timestamptz, desk_emails text[], copy_emails text[])
language sql security definer set search_path = public as $$
  with c as (
    select v.id from te_deputations v where v.status = 'approved' and v.mailed_at is null
    order by v.decided_at nulls last limit greatest(1, least(coalesce(p_limit, 20), 100))
    for update skip locked
  ), u as (
    update te_deputations v set mailed_at = now() from c where v.id = c.id returning v.*
  )
  select u.id, u.state, u.from_day, u.to_day, u.letter_name, u.note, e.full_name, e.ecode, e.designation, nullif(btrim(e.work_email), ''),
         m.full_name, nullif(btrim(m.work_email), ''), u.decided_at,
         (select coalesce(array_agg(nullif(btrim(x.work_email), '')) filter (where nullif(btrim(x.work_email), '') is not null), '{}')
          from user_roles r join employees x on x.id = r.employee_id where r.role = 'travel_desk' and x.is_active),
         te_mail_copy_emails('deputation')
  from u join employees e on e.id = u.employee_id
  left join employees m on m.id = u.decided_by
$$;
create or replace function public.te_dep_mail_failed(p_id uuid, p_error text)
returns void language sql security definer set search_path = public as $$
  update te_deputations set mail_error = left(p_error, 500) where id = p_id
$$;
revoke all on function public.te_dep_mail_claim(integer) from public, anon, authenticated;
revoke all on function public.te_dep_mail_failed(uuid, text) from public, anon, authenticated;
grant execute on function public.te_claim_mail_claim(integer), public.te_claim_mail_failed(uuid, text),
  public.te_dep_mail_claim(integer), public.te_dep_mail_failed(uuid, text), public.te_mail_copy_emails(text) to service_role;
