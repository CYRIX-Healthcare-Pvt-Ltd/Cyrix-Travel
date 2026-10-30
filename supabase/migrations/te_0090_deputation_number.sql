/*
  te_0090 — a number on each deputation, DP-01 on (the user, 30 Oct: "give deputation no so can sw admin can remove,
  bcz for test i added it now unable to remove"): one number for a deputation and all its requests (an edit, a change
  of the approved one and a send again share its root, te_0078), and SW Admin deletes it by that number as a claim or
  an advance is deleted: every request of it goes, then its letters; one audit line keeps what it was.
*/
create sequence if not exists public.te_dep_seq;
alter table public.te_deputations add column if not exists number text;
create index if not exists te_deputations_number on public.te_deputations (number);
create or replace function public.te_dep_number(n integer) returns text language sql immutable as $$ select 'DP-' || lpad(n::text, 2, '0') $$;

-- The deputations there are, in the order they were first asked.
update public.te_deputations set root = id where root is null;
do $$ declare r record; nm text; begin
  for r in select root from public.te_deputations where number is null group by root order by min(created_at) loop
    nm := public.te_dep_number(nextval('public.te_dep_seq')::int);
    update public.te_deputations set number = nm where root = r.root;
  end loop;
end $$;

-- A new deputation takes the next number when its root is set (te_dep_request sets it just after the insert); a request
-- of one already there takes that one's.
create or replace function public.te_dep_numbered() returns trigger language plpgsql set search_path to 'public' as $$
begin
  if new.root is null then return new; end if;
  if new.root = new.id then
    if new.number is null then new.number := te_dep_number(nextval('te_dep_seq')::int); end if;
  else
    new.number := coalesce((select o.number from te_deputations o where o.id = new.root), new.number);
  end if;
  return new;
end $$;
drop trigger if exists te_dep_numbered on public.te_deputations;
create trigger te_dep_numbered before insert or update of root on public.te_deputations for each row execute function public.te_dep_numbered();

/* What SW Admin is about to delete: the deputation's latest request, whose it is, and the claims with its DA. */
create or replace function public.te_find_deputation(p_number text)
 returns jsonb language plpgsql stable security definer set search_path to 'public' as $function$
declare n int := nullif(regexp_replace(coalesce(p_number, ''), '\D', '', 'g'), '')::int; v te_deputations;
begin
  if not is_sw_admin() then raise exception 'Only SW Admin deletes deputations'; end if;
  if n is null then raise exception 'Type a deputation number, like DP-01'; end if;
  select * into v from te_deputations where number = te_dep_number(n) order by created_at desc limit 1;
  if v.id is null then raise exception 'There is no deputation %', te_dep_number(n); end if;
  return (select jsonb_build_object('id', v.root, 'number', v.number, 'state', v.state, 'from_day', v.from_day, 'to_day', v.to_day,
      'status', v.status, 'name', e.full_name, 'ecode', e.ecode,
      'requests', (select count(*) from te_deputations d where d.root = v.root),
      'claims', coalesce((select jsonb_agg(distinct coalesce(k.number, to_char(k.month, 'Mon-YY')))
                          from te_days x join te_claims k on k.id = x.claim_id
                          where k.employee_id = v.employee_id and x.da_kind = 'deputation' and x.day between v.from_day and v.to_day), '[]'))
    from employees e where e.id = v.employee_id);
end $function$;

/* Delete a deputation and every request of it; the letters it leaves are returned for the page to remove. */
create or replace function public.te_delete_deputation(p_root uuid)
 returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare v te_deputations; paths jsonb;
begin
  if not is_sw_admin() then raise exception 'Only SW Admin deletes deputations'; end if;
  select * into v from te_deputations where root = p_root order by created_at desc limit 1;
  if v.id is null then raise exception 'That deputation is not there'; end if;
  select coalesce(jsonb_agg(distinct letter_path), '[]') into paths from te_deputations where root = p_root;
  perform log_audit('te_deputation', p_root, 'deleted', jsonb_build_object(
    'number', v.number, 'state', v.state, 'from_day', v.from_day, 'to_day', v.to_day, 'status', v.status,
    'ecode', (select ecode from employees where id = v.employee_id),
    'requests', (select count(*) from te_deputations where root = p_root)));
  delete from te_deputations where root = p_root;
  if not exists (select 1 from te_deputations) then perform setval('public.te_dep_seq', 1, false); end if;
  return paths;
end $function$;

revoke all on function public.te_find_deputation(text) from public, anon;
revoke all on function public.te_delete_deputation(uuid) from public, anon;
grant execute on function public.te_find_deputation(text) to authenticated, service_role;
grant execute on function public.te_delete_deputation(uuid) to authenticated, service_role;

-- SW Admin removes the letters of a deputation it deleted (no request names them any more).
drop policy if exists te_letters_sw_delete on storage.objects;
create policy te_letters_sw_delete on storage.objects for delete to authenticated
  using (bucket_id = 'te-letters' and public.is_sw_admin()
         and not exists (select 1 from public.te_deputations d where d.letter_path = name));
