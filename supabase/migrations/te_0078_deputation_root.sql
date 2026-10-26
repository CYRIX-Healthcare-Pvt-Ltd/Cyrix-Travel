/*
  te_0078: each deputation's own history (the user, 26 Oct: "if i add tamil nadu so to see tamil nadu history what
  will i do. better for each deputation each history needed"). Every request carries the root, its deputation's first
  request: an edit while with the manager, a change of the approved one and a send again after a sending back keep it.
*/
alter table te_deputations add column if not exists root uuid;
update te_deputations set root = id where root is null;
do $$ begin
  for i in 1..10 loop
    update te_deputations n set root = o.root from te_deputations o where n.replaces = o.id and n.root is distinct from o.root;
    update te_deputations n set root = o.root from te_deputations o
    where o.status = 'edited' and o.employee_id = n.employee_id and n.created_at = o.decided_at and n.id <> o.id and n.root is distinct from o.root;
  end loop;
end $$;

drop function if exists public.te_dep_request(text, date, date, text, text, uuid);
create or replace function public.te_dep_request(p_state text, p_from date, p_to date, p_path text, p_name text, p_replaces uuid, p_after uuid default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare me uuid := current_employee_id(); e employees; st text := btrim(coalesce(p_state, '')); old te_deputations; clash te_deputations; v te_deputations;
begin
  if me is null then raise exception 'Sign in first'; end if;
  select * into e from employees where id = me;
  if e.reporting_manager_id is null then raise exception 'You have no reporting manager to approve it'; end if;
  if st = '' then raise exception 'Choose the state'; end if;
  if p_from is null or p_to is null then raise exception 'Choose the from and to dates'; end if;
  if p_to < p_from then raise exception 'The to date is before the from date'; end if;
  if p_to - p_from > 366 then raise exception 'A deputation is up to a year'; end if;
  if coalesce(p_path, '') not like me::text || '/%' then raise exception 'Upload the deputation letter'; end if;
  if exists (select 1 from te_deputations where employee_id = me and status = 'with_manager') then
    raise exception 'Your deputation request is still with the manager';
  end if;
  if p_replaces is not null then
    select * into old from te_deputations where id = p_replaces;
    if old.id is null or old.employee_id <> me or old.status <> 'approved' then raise exception 'That deputation cannot be changed now'; end if;
    if old.state = st and old.from_day = p_from and old.to_day = p_to and old.letter_path = p_path then raise exception 'Nothing is changed'; end if;
  end if;
  select * into clash from te_deputations
  where employee_id = me and status = 'approved' and id is distinct from p_replaces and from_day <= p_to and to_day >= p_from limit 1;
  if clash.id is not null then
    raise exception 'It overlaps your deputation in % (%)', clash.state, te_dep_range(clash.from_day, clash.to_day);
  end if;
  insert into te_deputations (employee_id, state, from_day, to_day, letter_path, letter_name, replaces)
  values (me, st, p_from, p_to, p_path, nullif(btrim(coalesce(p_name, '')), ''), p_replaces)
  returning * into v;
  -- One deputation's requests share a root: an edit, a change of the approved one, or a send again after a sending back.
  update te_deputations set root = coalesce((select o.root from te_deputations o where o.id = coalesce(p_after, p_replaces) and o.employee_id = me), v.id)
  where id = v.id;
  perform te_dep_tell(e.reporting_manager_id,
    case when p_replaces is null then 'Deputation' else 'Deputation change' end || ' from ' || split_part(e.full_name, ' ', 1) || ' · ' || st,
    te_dep_range(p_from, p_to), '/travel/approvals?view=deputation', me);
  return v.id;
end $$;
revoke execute on function public.te_dep_request(text, date, date, text, text, uuid, uuid) from public, anon;
grant execute on function public.te_dep_request(text, date, date, text, text, uuid, uuid) to authenticated;

create or replace function public.te_dep_edit(p_id uuid, p_state text, p_from date, p_to date, p_path text, p_name text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v te_deputations;
begin
  select * into v from te_deputations where id = p_id for update;
  if v.id is null or v.employee_id <> current_employee_id() then raise exception 'That deputation is not yours'; end if;
  if v.status <> 'with_manager' then raise exception 'It is no longer with the manager'; end if;
  if v.state = btrim(coalesce(p_state, '')) and v.from_day = p_from and v.to_day = p_to and v.letter_path = p_path then
    raise exception 'Nothing is changed';
  end if;
  update te_deputations set status = 'edited', decided_at = now() where id = p_id;
  return te_dep_request(p_state, p_from, p_to, p_path, p_name, v.replaces, v.id);
end $$;
