/*
  te_0077: the employee's bell for an approved or sent-back deputation opens My profile on its Deputation tab (the
  user, 26 Oct: "better add sub tab?").
*/
CREATE OR REPLACE FUNCTION public.te_dep_decide(p_id uuid, p_approve boolean, p_note text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare me uuid := current_employee_id(); v te_deputations; e employees; why text := nullif(btrim(coalesce(p_note, '')), '');
        clash te_deputations;
begin
  select * into v from te_deputations where id = p_id;
  if v.id is null then raise exception 'That deputation is not there any more'; end if;
  if v.employee_id = me then raise exception 'Your own deputation is approved by your manager'; end if;
  select * into e from employees where id = v.employee_id;
  if v.status <> 'with_manager' then raise exception 'It is not waiting for approval'; end if;
  if not (e.reporting_manager_id = me or te_is_admin()) then
    raise exception 'It waits on % to approve', coalesce((select full_name from employees where id = e.reporting_manager_id), 'the reporting manager');
  end if;
  if not p_approve then
    if why is null or length(why) < 3 then raise exception 'Write why it is going back'; end if;
    update te_deputations set status = 'returned', decided_by = me, decided_at = now(), note = why where id = p_id;
    perform te_dep_tell(v.employee_id, 'Deputation sent back · ' || v.state, why, '/travel/profile?tab=deputation', me);
    return 'returned';
  end if;
  select * into clash from te_deputations
  where employee_id = v.employee_id and status = 'approved' and id is distinct from v.replaces and from_day <= v.to_day and to_day >= v.from_day limit 1;
  if clash.id is not null then
    raise exception 'It overlaps the approved deputation in % (%)', clash.state, te_dep_range(clash.from_day, clash.to_day);
  end if;
  if v.replaces is not null then update te_deputations set status = 'replaced' where id = v.replaces and status = 'approved'; end if;
  update te_deputations set status = 'approved', decided_by = me, decided_at = now(), note = why where id = p_id;
  perform te_dep_tell(v.employee_id, 'Deputation approved · ' || v.state, te_dep_range(v.from_day, v.to_day) || ' · DA ₹'
    || to_char(coalesce((select (value #>> '{}')::numeric from te_policy where key = 'deputation_da'), 800), 'FM99,990') || ' a day', '/travel/profile?tab=deputation', me);
  return 'approved';
end $function$;
