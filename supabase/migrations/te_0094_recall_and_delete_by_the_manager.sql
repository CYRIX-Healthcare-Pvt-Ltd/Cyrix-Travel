/*
  te_0094 — recall and deletion go by whether the manager has approved.

  The user, 31 Oct: "recall to edit doesn't need approval but request deletion needs, why?" —
    "no approval for recall and deletion : if manager didnt approved it
     need approval for recall and deletion : if manager approved it
     recall and deletion disabled : if travel desk approves it"
  Waiting on the manager, or sent back by the manager: its person recalls or deletes it straight away. Past the manager
  (with the coordinator or Travel Desk, or sent back from there): the person asks, and only the reporting manager
  answers. Approved or paid: neither. SW Admin's Delete stays (te_0090).
*/
alter table public.te_claims add column if not exists recall_requested_at timestamptz;
alter table public.te_claims add column if not exists recall_reason text;

-- Has the manager approved it this round: past the manager, or sent back from a step after the manager.
create or replace function public.te_past_manager(p_claim uuid)
 returns boolean
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select case
    when c.status in ('with_coordinator', 'with_desk') then true
    when c.status = 'returned' then coalesce((
      select p.to_status in ('with_coordinator', 'with_desk')
        from te_events r join te_events p on p.claim_id = r.claim_id and p.to_status is not null and (p.at, p.id) < (r.at, r.id)
       where r.claim_id = c.id and r.action = 'returned'
       order by r.at desc, r.id desc, p.at desc, p.id desc limit 1), false)
    else false end
  from te_claims c where c.id = p_claim
$function$;
revoke all on function public.te_past_manager(uuid) from public, anon;
grant execute on function public.te_past_manager(uuid) to authenticated, service_role;

create or replace function public.te_can_delete(p_claim uuid)
 returns boolean
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select exists (select 1 from te_claims c join employees e on e.id = c.employee_id where c.id = p_claim and (
       (c.employee_id = current_employee_id() and (c.status in ('draft', 'recalled', 'with_manager') or (c.status = 'returned' and not te_past_manager(c.id))))
    or (c.delete_requested_at is not null and e.reporting_manager_id = current_employee_id() and te_past_manager(c.id))
    or is_sw_admin()))
$function$;

CREATE OR REPLACE FUNCTION public.te_delete_claim(p_claim uuid)
 RETURNS text[]
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare c te_claims; paths text[];
begin
  select * into c from te_claims where id = p_claim;
  if c.id is null then raise exception 'That claim is not there'; end if;
  if not te_can_delete(p_claim) then
    raise exception '%', case when c.status in ('approved', 'paid') then 'An approved claim cannot be deleted'
      else 'This claim is deleted only when the manager approves the request' end;
  end if;
  -- A deleted claim is still one somebody can account for.
  perform log_audit('te_claim', c.id, 'deleted', jsonb_build_object(
    'number', c.number, 'month', c.month, 'status', c.status, 'total', te_total(c.id),
    'ecode', (select ecode from employees where id = c.employee_id),
    'days', (select count(*) from te_days where claim_id = c.id)));
  select coalesce(array_agg(path), '{}') into paths from te_bills where claim_id = p_claim;
  delete from te_claims where id = p_claim;
  if not exists (select 1 from te_claims where number is not null) then perform setval('public.te_claim_seq', 1, false); end if;
  return paths;
end $function$;

create or replace function public.te_request_delete(p_claim uuid, p_reason text)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare c te_claims;
begin
  select * into c from te_claims where id = p_claim;
  if c.employee_id is distinct from current_employee_id() then raise exception 'Only your own claim'; end if;
  if c.status in ('approved', 'paid') then raise exception 'An approved claim cannot be deleted'; end if;
  if not te_past_manager(p_claim) then raise exception 'You can delete this one yourself'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'Say why it should be deleted'; end if;
  update te_claims set delete_requested_at = now(), delete_reason = trim(p_reason), updated_at = now() where id = p_claim;
end $function$;

create or replace function public.te_recall(p_claim uuid)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare c te_claims;
begin
  select * into c from te_claims where id = p_claim for update;
  if c.employee_id is distinct from current_employee_id() then raise exception 'Only your own claim'; end if;
  if c.status in ('with_coordinator', 'with_desk') then raise exception 'Your manager has approved it: ask your manager to let you edit it'; end if;
  if c.status <> 'with_manager' then raise exception 'It can be recalled only while it waits on your manager'; end if;
  update te_claims set status = 'recalled', recalls = recalls + 1, last_recalled_at = now(), updated_at = now() where id = p_claim;
end $function$;

-- The person asks to edit a claim the manager has approved.
create or replace function public.te_request_recall(p_claim uuid, p_reason text)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare c te_claims;
begin
  select * into c from te_claims where id = p_claim for update;
  if c.employee_id is distinct from current_employee_id() then raise exception 'Only your own claim'; end if;
  if c.status = 'with_manager' then raise exception 'Your manager has not approved it yet: recall it yourself'; end if;
  if c.status in ('approved', 'paid') then raise exception 'An approved claim cannot be changed'; end if;
  if c.status not in ('with_coordinator', 'with_desk') then raise exception 'You can edit it already'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'Say what you need to change'; end if;
  update te_claims set recall_requested_at = now(), recall_reason = trim(p_reason), updated_at = now() where id = p_claim;
end $function$;

-- The reporting manager lets it be edited (it comes back recalled, and is approved again once sent) or keeps it;
-- the person can withdraw the request.
create or replace function public.te_answer_recall(p_claim uuid, p_allow boolean)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare c te_claims; mgr uuid; me uuid := current_employee_id();
begin
  select * into c from te_claims where id = p_claim for update;
  if c.recall_requested_at is null then raise exception 'There is no request to edit it'; end if;
  select reporting_manager_id into mgr from employees where id = c.employee_id;
  if p_allow then
    if mgr is distinct from me then raise exception 'Only the reporting manager lets it be edited'; end if;
    if c.status not in ('with_coordinator', 'with_desk') then raise exception 'It is approved already, so it cannot be edited'; end if;
    perform set_config('te.why', 'recall_allowed', true);
    update te_claims set status = 'recalled', recalls = recalls + 1, last_recalled_at = now(), updated_at = now() where id = p_claim;
    perform set_config('te.why', '', true);
  else
    if not (mgr = me or c.employee_id = me) then raise exception 'Only the reporting manager'; end if;
    update te_claims set recall_requested_at = null, recall_reason = null, updated_at = now() where id = p_claim;
  end if;
end $function$;
revoke all on function public.te_request_recall(uuid, text), public.te_answer_recall(uuid, boolean) from public, anon;
grant execute on function public.te_request_recall(uuid, text), public.te_answer_recall(uuid, boolean) to authenticated, service_role;

-- A request goes when the claim moves: an edit request on any move; a deletion request once the manager no longer answers it.
create or replace function public.te_requests_follow_status()
 returns trigger
 language plpgsql
 set search_path to 'public'
as $function$
begin
  if new.status is distinct from old.status then
    new.recall_requested_at := null; new.recall_reason := null;
    if new.status not in ('with_coordinator', 'with_desk', 'returned') then new.delete_requested_at := null; new.delete_reason := null; end if;
  end if;
  return new;
end $function$;
drop trigger if exists te_claims_requests on public.te_claims;
create trigger te_claims_requests before update on public.te_claims for each row execute function public.te_requests_follow_status();

CREATE OR REPLACE FUNCTION public.te_log()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare me uuid := current_employee_id(); why text := nullif(current_setting('te.why', true), '');
begin
  if tg_op = 'INSERT' then
    insert into te_events (claim_id, actor_id, action, to_status) values (new.id, coalesce(me, new.employee_id), 'created', new.status);
    return new;
  end if;
  if new.status is distinct from old.status then
    insert into te_events (claim_id, actor_id, action, to_status, note) values (new.id, me,
      coalesce(why, case
        when new.status = 'with_manager' then case when old.status in ('returned', 'recalled') then 'resubmitted' else 'submitted' end
        when new.status in ('returned', 'recalled', 'paid') then new.status
        when old.status = 'with_manager' then 'manager_approved'
        when old.status = 'with_coordinator' then 'coordinator_approved'
        when old.status = 'with_desk' then 'desk_approved'
        else 'moved' end),
      new.status,
      case
        when why is not null then null
        when new.status = 'with_manager' then new.number
        when new.status = 'returned' then new.return_note
        when new.status = 'paid' then concat_ws(' · ', 'Paid on ' || to_char(new.paid_on, 'FMDD Mon YYYY'), 'UTR ' || new.paid_ref)
        when new.status = 'recalled' then null
        when old.status = 'with_manager' then new.manager_note
        when old.status = 'with_coordinator' then new.coordinator_note
        when old.status = 'with_desk' then new.desk_note end);
  end if;
  if new.delete_requested_at is not null and old.delete_requested_at is null then
    insert into te_events (claim_id, actor_id, action, note) values (new.id, me, 'delete_requested', new.delete_reason);
  elsif new.delete_requested_at is null and old.delete_requested_at is not null and new.status is not distinct from old.status then
    insert into te_events (claim_id, actor_id, action) values (new.id, me, case when me = new.employee_id then 'delete_withdrawn' else 'delete_refused' end);
  end if;
  -- Asking to edit a claim the manager has approved (te_0094); a request the claim moved past is cleared without a word.
  if new.recall_requested_at is not null and old.recall_requested_at is null then
    insert into te_events (claim_id, actor_id, action, note) values (new.id, me, 'recall_requested', new.recall_reason);
  elsif new.recall_requested_at is null and old.recall_requested_at is not null and new.status is not distinct from old.status then
    insert into te_events (claim_id, actor_id, action) values (new.id, me, case when me = new.employee_id then 'recall_withdrawn' else 'recall_refused' end);
  end if;
  if new.advance is distinct from old.advance then
    insert into te_events (claim_id, actor_id, action, note) values (new.id, me, 'advance', new.advance::text);
  end if;
  return new;
end $function$;

CREATE OR REPLACE FUNCTION public.te_tell()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare c te_claims; e employees; who text; role text; num text; says text;
begin
  if new.action not in ('returned', 'adjusted', 'delete_requested', 'recall_requested', 'recall_allowed', 'recall_refused', 'delete_refused') then return new; end if;
  select * into c from te_claims where id = new.claim_id;
  select * into e from employees where id = c.employee_id;
  num := coalesce(c.number, to_char(c.month, 'Mon-YY') || ' claim');
  who := coalesce((select split_part(full_name, ' ', 1) from employees where id = new.actor_id), 'Someone');
  role := case when new.actor_id = e.reporting_manager_id then 'manager'
               when te_claim_coordinator(c.id) = new.actor_id or c.coordinator_id = new.actor_id then 'coordinator'
               when exists (select 1 from user_roles u where u.employee_id = new.actor_id and u.role = 'travel_desk') then 'Travel Desk'
               else 'admin' end;
  says := who || ' (' || role || '): ' || replace(coalesce(new.note, ''), E'\n', ' — ');
  if new.action = 'returned' then
    perform te_notify(c.id, c.employee_id, num || ' sent back to you', says, new.actor_id);
    if new.actor_id is distinct from e.reporting_manager_id then
      perform te_notify(c.id, e.reporting_manager_id, split_part(e.full_name, ' ', 1) || '''s ' || num || ' sent back', says, new.actor_id);
    end if;
  -- Asking the manager to delete or edit it, and the manager's answer (te_0094).
  elsif new.action in ('delete_requested', 'recall_requested') then
    perform te_notify(c.id, e.reporting_manager_id,
      split_part(e.full_name, ' ', 1) || case when new.action = 'delete_requested' then ' asks to delete ' else ' asks to edit ' end || num,
      replace(coalesce(new.note, ''), E'\n', ' — '), new.actor_id);
  elsif new.action = 'recall_allowed' then
    perform te_notify(c.id, c.employee_id, num || ' is back with you to edit', who || ' (manager)', new.actor_id);
  elsif new.action in ('recall_refused', 'delete_refused') then
    perform te_notify(c.id, c.employee_id, num || case when new.action = 'recall_refused' then ': edit not allowed' else ': not deleted' end, who || ' (' || role || ')', new.actor_id);
  else
    perform te_notify(c.id, c.employee_id, num || ': an amount was changed', says, new.actor_id);
  end if;
  return new;
end $function$;

drop function if exists public.te_inbox();
CREATE FUNCTION public.te_inbox()
 RETURNS TABLE(id uuid, month date, part integer, status text, number text, total numeric, name text, ecode text, submitted_at timestamp with time zone, waiting boolean, days integer, first_day date, last_day date, km numeric, modes text[], tickets integer, places text[], find text, deputation text, employee_id uuid, cost_centre text, route_from text, route_to text, travel numeric, da numeric, hotel numeric, other numeric, asks text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with mine as (
    select c.*, e.full_name, e.ecode, nullif(trim(e.function_name), '') as cost_centre,
      (c.status = 'with_manager' and e.reporting_manager_id = current_employee_id())
      or (c.status = 'with_coordinator' and te_claim_coordinator(c.id) = current_employee_id())
      or (c.status = 'with_desk' and te_is_desk()) as step,
      -- The person asks the manager to edit or delete it (te_0094).
      case when e.reporting_manager_id = current_employee_id() then
        case when c.recall_requested_at is not null then 'edit' when c.delete_requested_at is not null then 'delete' end end as asks
    from te_claims c join employees e on e.id = c.employee_id
    where c.status <> 'draft' and c.employee_id <> current_employee_id() and te_can_see(c.id)
  )
  select m.id, m.month, m.part, m.status, m.number, te_total(m.id), m.full_name, m.ecode, m.submitted_at, m.step or m.asks is not null,
    (select count(*)::int from te_days d where d.claim_id = m.id),
    (select min(day) from te_days d where d.claim_id = m.id),
    (select max(day) from te_days d where d.claim_id = m.id),
    (select coalesce(sum(case when r.mode in ('bike', 'car') then coalesce(r.claimed_km, r.map_km) else r.map_km end), 0)
       from te_rides r join te_days d on d.id = r.day_id where d.claim_id = m.id),
    (select coalesce(array_agg(distinct r.mode), '{}') from te_rides r join te_days d on d.id = r.day_id where d.claim_id = m.id),
    (select count(distinct t.ticket_no)::int from te_tickets t join te_days d on d.id = t.day_id where d.claim_id = m.id),
    te_claim_places(m.id), te_claim_find(m.id), te_claim_deputation(m.id),
    m.employee_id, m.cost_centre,
    -- Where it started: the first ride's from.
    (select split_part(r.from_name, ',', 1) from te_rides r join te_days d on d.id = r.day_id where d.claim_id = m.id order by d.day, r.seq limit 1),
    -- Where it ended: the last ride's to, or where that ride left from when it went home.
    (select split_part(case when lower(trim(split_part(r.to_name, ',', 1))) = 'home' then r.from_name else r.to_name end, ',', 1)
       from te_rides r join te_days d on d.id = r.day_id where d.claim_id = m.id order by d.day desc, r.seq desc limit 1),
    (select coalesce(sum(r.amount), 0) from te_rides r join te_days d on d.id = r.day_id where d.claim_id = m.id),
    (select coalesce(sum(d.da_amount), 0) from te_days d where d.claim_id = m.id),
    (select coalesce(sum(h.amount), 0) from te_hotels h join te_days d on d.id = h.day_id where d.claim_id = m.id),
    (select coalesce(sum(x.amount), 0) from te_expenses x join te_days d on d.id = x.day_id where d.claim_id = m.id),
    case when not m.step then m.asks end
  from mine m order by m.step or m.asks is not null desc, m.submitted_at desc nulls last limit 200
$function$;
revoke all on function public.te_inbox() from public, anon;
grant execute on function public.te_inbox() to authenticated, service_role;
