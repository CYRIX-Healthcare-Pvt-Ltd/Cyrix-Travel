/*
  te_0127 — An advance's project or cost centre is chosen, and the manager can edit before approving (the user, 5 Nov:
  "project to cost center … something KLBEMMP emp goes to PVTBEMP, so they can do that also … default should be their
  current centre, and manager need approve, edit, decline also, edit opens same form, so in remark it should show
  manager edited it").
    · te_advance_request takes p_cost_centre: one of SW Admin → Travel Expense → Projects, or the person's own centre
      (their function), which is also what it is when none is sent.
    · te_advance_edit: the reporting manager (or SW / ACC Admin) changes amount, purpose, reason, destination or cost
      centre while it waits on them. The same rules hold; what changed is kept as the edit note ("Amount ₹10,000 →
      ₹8,000 · …") with who and when, and the person is told.
*/
alter table public.te_advances add column if not exists edited_by uuid references public.employees(id);
alter table public.te_advances add column if not exists edited_at timestamptz;
alter table public.te_advances add column if not exists edit_note text;

-- A cost centre an advance may carry: an active project, or the person's own.
create or replace function public.te_advance_centre(p_centre text, p_own text)
 returns text language sql stable security definer set search_path to 'public' as $function$
  select case
    when nullif(btrim(coalesce(p_centre, '')), '') is null then nullif(btrim(coalesce(p_own, '')), '')
    when lower(btrim(p_centre)) = lower(btrim(coalesce(p_own, ''))) then btrim(p_own)
    else (select p.label from te_projects p where p.is_active and lower(p.label) = lower(btrim(p_centre)) limit 1)
  end
$function$;

drop function if exists public.te_advance_request(numeric, text, text, text, text, text, double precision, double precision, text);
create or replace function public.te_advance_request(p_amount numeric, p_purpose text, p_reason text, p_base_name text, p_base_state text,
  p_dest_name text, p_dest_lat double precision, p_dest_lng double precision, p_dest_state text, p_cost_centre text default null)
 returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare me uuid := current_employee_id(); e employees; h travel_homes; why text; m date := date_trunc('month', now() at time zone 'Asia/Kolkata')::date;
        total numeric; most numeric; v te_advances; amt numeric := round(coalesce(p_amount, 0)); cc text;
begin
  if me is null then raise exception 'Sign in first'; end if;
  select * into e from employees where id = me;
  select * into h from travel_homes where employee_id = me;
  if h.employee_id is null then raise exception 'Set your home in My profile first — it is where the advance is from'; end if;
  if e.reporting_manager_id is null then raise exception 'You have no reporting manager to approve it'; end if;
  cc := te_advance_centre(p_cost_centre, e.function_name);
  if cc is null then
    raise exception '%', case when nullif(btrim(coalesce(p_cost_centre, '')), '') is null then 'Your cost centre is not mapped — ask HR to set it' else 'Choose a project or cost centre from the list' end;
  end if;
  if amt <= 0 then raise exception 'Enter the advance amount'; end if;
  if length(btrim(coalesce(p_purpose, ''))) < 3 then raise exception 'Enter the purpose — the work it is for'; end if;
  if length(btrim(coalesce(p_reason, ''))) < 3 then raise exception 'Enter the reason for the advance'; end if;
  if p_dest_lat is null or p_dest_lng is null or length(btrim(coalesce(p_dest_name, ''))) = 0 then raise exception 'Choose where you are travelling to'; end if;
  if nullif(btrim(coalesce(p_base_state, '')), '') is null or nullif(btrim(coalesce(p_dest_state, '')), '') is null then
    raise exception 'The state of your home or the destination could not be found — try again';
  end if;
  if lower(btrim(p_base_state)) = lower(btrim(p_dest_state)) then
    raise exception 'An advance is only for travel outside %', btrim(p_base_state);
  end if;
  why := te_advance_blocked(me);
  if why is not null then raise exception '%', why; end if;
  most := coalesce((select (value #>> '{}')::numeric from te_policy where key = 'advance_month_amount'), 20000);
  select coalesce(sum(amount), 0) into total from te_advances where employee_id = me and month = m and status not in ('declined', 'cancelled');
  if total + amt > most then
    raise exception 'Up to ₹% this month — ₹% is left', to_char(most, 'FM99,99,99,990'), to_char(most - total, 'FM99,99,99,990');
  end if;
  insert into te_advances (employee_id, number, amount, purpose, reason, cost_centre, base_name, base_lat, base_lng, base_state,
                           dest_name, dest_lat, dest_lng, dest_state, month)
  values (me, te_advance_number(nextval('te_advance_seq')::int), amt, btrim(p_purpose), btrim(p_reason), cc,
          nullif(btrim(coalesce(p_base_name, '')), ''), h.lat, h.lng, btrim(p_base_state),
          btrim(p_dest_name), p_dest_lat, p_dest_lng, btrim(p_dest_state), m)
  returning * into v;
  perform te_advance_tell(e.reporting_manager_id, 'Advance ' || v.number || ' · ₹' || to_char(amt, 'FM99,99,99,990') || ' from ' || split_part(e.full_name, ' ', 1),
    btrim(p_base_state) || ' → ' || btrim(p_dest_name) || ' · ' || btrim(p_purpose), '/travel/approvals?view=advances', me);
  return jsonb_build_object('id', v.id, 'number', v.number);
end $function$;

create or replace function public.te_advance_edit(p_advance uuid, p_amount numeric, p_purpose text, p_reason text,
  p_dest_name text, p_dest_lat double precision, p_dest_lng double precision, p_dest_state text, p_cost_centre text)
 returns void language plpgsql security definer set search_path to 'public' as $function$
declare me uuid := current_employee_id(); v te_advances; e employees; amt numeric := round(coalesce(p_amount, 0)); cc text;
        total numeric; most numeric; parts text[] := '{}'; rs text := '₹';
begin
  select * into v from te_advances where id = p_advance for update;
  if v.id is null then raise exception 'That advance is not there any more'; end if;
  if v.employee_id = me then raise exception 'Your own advance is approved by others'; end if;
  if v.status <> 'with_manager' then raise exception '% is past the manager — it cannot be edited now', v.number; end if;
  select * into e from employees where id = v.employee_id;
  if not (e.reporting_manager_id = me or te_is_admin()) then
    raise exception 'Only % can edit it', coalesce((select full_name from employees where id = e.reporting_manager_id), 'the reporting manager');
  end if;
  cc := te_advance_centre(p_cost_centre, e.function_name);
  if cc is null then raise exception 'Choose a project or cost centre from the list'; end if;
  if amt <= 0 then raise exception 'Enter the advance amount'; end if;
  if length(btrim(coalesce(p_purpose, ''))) < 3 then raise exception 'Enter the purpose — the work it is for'; end if;
  if length(btrim(coalesce(p_reason, ''))) < 3 then raise exception 'Enter the reason for the advance'; end if;
  if p_dest_lat is null or p_dest_lng is null or length(btrim(coalesce(p_dest_name, ''))) = 0 then raise exception 'Choose where the travel is to'; end if;
  if lower(btrim(v.base_state)) = lower(btrim(coalesce(p_dest_state, ''))) then
    raise exception 'An advance is only for travel outside %', v.base_state;
  end if;
  most := coalesce((select (value #>> '{}')::numeric from te_policy where key = 'advance_month_amount'), 20000);
  select coalesce(sum(amount), 0) into total from te_advances
   where employee_id = v.employee_id and month = v.month and id <> v.id and status not in ('declined', 'cancelled');
  if total + amt > most then
    raise exception 'Up to ₹% for % that month — ₹% is left', to_char(most, 'FM99,99,99,990'), split_part(e.full_name, ' ', 1), to_char(most - total, 'FM99,99,99,990');
  end if;

  if amt <> v.amount then parts := parts || ('Amount ' || rs || to_char(v.amount, 'FM99,99,99,990') || ' → ' || rs || to_char(amt, 'FM99,99,99,990')); end if;
  if btrim(p_dest_name) <> v.dest_name then parts := parts || ('To ' || v.dest_name || ' → ' || btrim(p_dest_name)); end if;
  if cc is distinct from v.cost_centre then parts := parts || ('Cost centre ' || coalesce(v.cost_centre, '—') || ' → ' || cc); end if;
  if btrim(p_purpose) <> v.purpose then parts := parts || 'Purpose changed'::text; end if;
  if btrim(p_reason) <> v.reason then parts := parts || 'Reason changed'::text; end if;
  if cardinality(parts) = 0 then raise exception 'Nothing was changed'; end if;

  update te_advances set amount = amt, purpose = btrim(p_purpose), reason = btrim(p_reason), dest_name = btrim(p_dest_name),
    dest_lat = p_dest_lat, dest_lng = p_dest_lng, dest_state = btrim(p_dest_state), cost_centre = cc,
    edited_by = me, edited_at = now(),
    edit_note = case when edit_note is null then array_to_string(parts, ' · ') else edit_note || ' · ' || array_to_string(parts, ' · ') end
  where id = v.id;
  perform te_advance_tell(v.employee_id, 'Advance ' || v.number || ' edited by ' || coalesce((select full_name from employees where id = me), 'your manager'),
    array_to_string(parts, ' · '), '/travel/advances', me);
end $function$;

create or replace function public.te_advance_card(v te_advances, p_used numeric)
 returns jsonb language sql stable security definer set search_path to 'public' as $function$
  select to_jsonb(v) - 'base_lat' - 'base_lng' || jsonb_build_object(
    'name', e.full_name, 'ecode', e.ecode,
    'manager_name', (select full_name from employees where id = v.manager_id),
    'desk_name', (select full_name from employees where id = v.desk_id),
    'declined_name', (select full_name from employees where id = v.declined_by),
    'edited_name', (select full_name from employees where id = v.edited_by),
    'own_centre', nullif(btrim(coalesce(e.function_name, '')), ''),
    'used', coalesce(p_used, 0),
    'left', case when v.status = 'given' then v.amount - coalesce(p_used, 0) end,
    'uses', coalesce((select jsonb_agg(jsonb_build_object('claim_id', s.claim_id, 'number', k.number, 'month', k.month, 'part', k.part,
                        'amount', s.amount, 'paid', s.frozen) order by s.frozen desc, s.ord)
                      from te_advance_split(v.employee_id) s join te_claims k on k.id = s.claim_id
                      where s.advance_id = v.id and s.sent), '[]'))
  from employees e where e.id = v.employee_id
$function$;

revoke all on function public.te_advance_centre(text, text) from public, anon;
revoke all on function public.te_advance_request(numeric, text, text, text, text, text, double precision, double precision, text, text) from public, anon;
revoke all on function public.te_advance_edit(uuid, numeric, text, text, text, double precision, double precision, text, text) from public, anon;
grant execute on function public.te_advance_centre(text, text) to authenticated;
grant execute on function public.te_advance_request(numeric, text, text, text, text, text, double precision, double precision, text, text) to authenticated;
grant execute on function public.te_advance_edit(uuid, numeric, text, text, text, double precision, double precision, text, text) to authenticated;
