/*
  te_0076: a deputation request still with the manager can be edited (the user, 26 Oct: "How to edit it? if date
  extented"). The waiting request is marked edited and the new one sent in its place, in one step, so a refusal
  (overlap, no letter) leaves the waiting request as it was. A change of an approved one stays a change.
  The one edited reads "Edited" in the history, not "Withdrawn" (the user: "i clicked edit and changed date, but
  history showing different").
*/
alter table te_deputations drop constraint te_deputations_status_check;
alter table te_deputations add constraint te_deputations_status_check
  check (status in ('with_manager', 'approved', 'returned', 'withdrawn', 'replaced', 'edited'));
-- Edited before this: withdrawn in the same moment the next one was asked.
update te_deputations d set status = 'edited'
where d.status = 'withdrawn' and exists (select 1 from te_deputations n where n.employee_id = d.employee_id and n.created_at = d.decided_at);

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
  return te_dep_request(p_state, p_from, p_to, p_path, p_name, v.replaces);
end $$;

revoke execute on function public.te_dep_edit(uuid, text, date, date, text, text) from public, anon;
grant execute on function public.te_dep_edit(uuid, text, date, date, text, text) to authenticated;
