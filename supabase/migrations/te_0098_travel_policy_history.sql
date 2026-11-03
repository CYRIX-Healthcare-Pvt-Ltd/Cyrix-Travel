/*
  te_0098 — the history of Travel policy (the user, 3 Nov: "if any travel policy is edited we need history also who
  edited what date and time"). Every change to allowances by grade, settings, purposes, projects, expense types,
  coordinators and who is on the Travel Desk or Accounts desk is written by a trigger, one row per field changed:
  what it was, what it became, who and when. Read by SW Admin and Accounts (te_policy_history); nobody edits it.
*/
create table if not exists public.te_policy_log (
  id bigserial primary key,
  at timestamptz not null default now(),
  by_id uuid references employees (id) on delete set null,
  area text not null,
  item text,
  field text,
  action text not null check (action in ('changed', 'added', 'removed')),
  before text,
  after text
);
create index if not exists te_policy_log_at on public.te_policy_log (at desc);
alter table public.te_policy_log enable row level security;
revoke all on public.te_policy_log from anon, authenticated;

-- A person as "Name (ECODE)", for coordinators and desk members.
create or replace function public.te_person_label(p_id uuid)
returns text language sql stable security definer set search_path = public as $$
  select full_name || ' (' || ecode || ')' from employees where id = p_id
$$;

/*
  tg_argv: the area's name and the column naming the item (a grade, a setting's key, a purpose's name…).
  A change: one row per field that moved. Added or removed: one row, the item's fields in "after" / "before".
*/
create or replace function public.te_policy_log_row()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  o jsonb := case when tg_op <> 'INSERT' then to_jsonb(old) end;
  n jsonb := case when tg_op <> 'DELETE' then to_jsonb(new) end;
  r jsonb := coalesce(n, o);
  area text := tg_argv[0];
  item text := r ->> tg_argv[1];
  me uuid := current_employee_id();
  noise text[] := array['id', 'sort', 'updated_at', 'updated_by', 'set_by', 'set_at', tg_argv[1]];
  k text;
  rest jsonb;
begin
  -- Desk members: only the Travel Desk and Accounts roles, named by the person.
  if tg_table_name = 'user_roles' then
    if r ->> 'role' not in ('travel_desk', 'acc_admin') then return null; end if;
    if tg_op = 'UPDATE' then return null; end if;
    insert into te_policy_log (by_id, area, item, action)
    values (me, case r ->> 'role' when 'travel_desk' then 'Travel Desk' else 'Accounts' end,
            te_person_label((r ->> 'employee_id')::uuid), case tg_op when 'INSERT' then 'added' else 'removed' end);
    return null;
  end if;
  -- A coordinator is a person, not an id.
  if tg_table_name = 'te_cost_centre_coordinators' then
    if o ? 'coordinator_id' then o := jsonb_set(o, '{coordinator_id}', to_jsonb(te_person_label((o ->> 'coordinator_id')::uuid))); end if;
    if n ? 'coordinator_id' then n := jsonb_set(n, '{coordinator_id}', to_jsonb(te_person_label((n ->> 'coordinator_id')::uuid))); end if;
  end if;

  if tg_op = 'UPDATE' then
    for k in select jsonb_object_keys(n) loop
      continue when k = any (noise) and not (k = tg_argv[1] and tg_table_name in ('te_purposes', 'te_projects', 'te_expense_kinds'));
      if n -> k is distinct from o -> k then
        insert into te_policy_log (by_id, area, item, field, action, before, after)
        values (me, area, item, k, 'changed', o ->> k, n ->> k);
      end if;
    end loop;
  elsif tg_table_name = 'te_policy' then
    -- A setting saved for the first time, or taken away.
    insert into te_policy_log (by_id, area, item, field, action, before, after)
    values (me, area, item, 'value', case tg_op when 'INSERT' then 'added' else 'removed' end, o ->> 'value', n ->> 'value');
  else
    rest := r - noise;
    insert into te_policy_log (by_id, area, item, action, before, after)
    values (me, area, item, case tg_op when 'INSERT' then 'added' else 'removed' end,
            case when tg_op = 'DELETE' then rest::text end, case when tg_op = 'INSERT' then rest::text end);
  end if;
  return null;
end $$;

drop trigger if exists te_policy_log on public.te_policy;
create trigger te_policy_log after insert or update or delete on public.te_policy
  for each row execute function public.te_policy_log_row('Settings', 'key');
drop trigger if exists te_policy_log on public.te_grade_rules;
create trigger te_policy_log after insert or update or delete on public.te_grade_rules
  for each row execute function public.te_policy_log_row('Allowances by grade', 'grade');
drop trigger if exists te_policy_log on public.te_purposes;
create trigger te_policy_log after insert or update or delete on public.te_purposes
  for each row execute function public.te_policy_log_row('Purposes', 'label');
drop trigger if exists te_policy_log on public.te_projects;
create trigger te_policy_log after insert or update or delete on public.te_projects
  for each row execute function public.te_policy_log_row('Projects', 'label');
drop trigger if exists te_policy_log on public.te_expense_kinds;
create trigger te_policy_log after insert or update or delete on public.te_expense_kinds
  for each row execute function public.te_policy_log_row('Expense types', 'label');
drop trigger if exists te_policy_log on public.te_cost_centre_coordinators;
create trigger te_policy_log after insert or update or delete on public.te_cost_centre_coordinators
  for each row execute function public.te_policy_log_row('Coordinators', 'cost_centre');
drop trigger if exists te_policy_log on public.user_roles;
create trigger te_policy_log after insert or update or delete on public.user_roles
  for each row execute function public.te_policy_log_row('Desk', 'role');

-- The history, newest first, for SW Admin and Accounts. Null dates: all time.
create or replace function public.te_policy_history(p_from date default null, p_to date default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not te_is_admin() then raise exception 'Only SW Admin and Accounts see the history'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', l.id, 'at', l.at, 'by', te_person_label(l.by_id), 'area', l.area, 'item', l.item,
             'field', l.field, 'action', l.action, 'before', l.before, 'after', l.after) order by l.at desc, l.id desc)
    from te_policy_log l
    where (p_from is null or l.at >= (p_from::timestamp at time zone 'Asia/Kolkata'))
      and (p_to is null or l.at < ((p_to + 1)::timestamp at time zone 'Asia/Kolkata'))), '[]');
end $$;

revoke all on function public.te_policy_log_row(), public.te_person_label(uuid), public.te_policy_history(date, date) from public, anon;
grant execute on function public.te_policy_history(date, date) to authenticated;
