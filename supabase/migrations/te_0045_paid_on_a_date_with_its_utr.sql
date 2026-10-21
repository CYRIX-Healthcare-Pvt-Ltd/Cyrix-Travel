-- Travel Expense · te_0045 · paid on a date, with its UTR
-- The user, 21 Oct: "travel desk only can mark paid, and add date and UTR". Marking a claim paid asks for
-- the day the money went and the bank's transaction reference; the history step and the claim say both.

alter table public.te_claims add column if not exists paid_on date, add column if not exists paid_ref text;

drop function if exists public.te_mark_paid(uuid);
create function public.te_mark_paid(p_claim uuid, p_paid_on date, p_ref text)
returns void language plpgsql security definer set search_path to 'public' as $f$
declare c te_claims; ref text := upper(regexp_replace(coalesce(p_ref, ''), '\s+', '', 'g'));
begin
  if not te_is_desk() then raise exception 'Only the Travel Desk marks a claim paid'; end if;
  select * into c from te_claims where id = p_claim;
  if c.id is null or c.status <> 'approved' then raise exception 'Approve it first'; end if;
  if p_paid_on is null then raise exception 'Give the date it was paid'; end if;
  if p_paid_on > (now() at time zone 'Asia/Kolkata')::date then raise exception 'The date it was paid cannot be in the future'; end if;
  if c.desk_at is not null and p_paid_on < (c.desk_at at time zone 'Asia/Kolkata')::date then
    raise exception 'It was approved on %, so it cannot have been paid before', to_char(c.desk_at at time zone 'Asia/Kolkata', 'FMDD Mon');
  end if;
  if ref !~ '^[A-Z0-9/-]{6,30}$' then raise exception 'Give the UTR: 6 to 30 letters and digits'; end if;
  update te_claims set status = 'paid', paid_at = now(), paid_on = p_paid_on, paid_ref = ref, updated_at = now() where id = p_claim;
end $f$;
revoke all on function public.te_mark_paid(uuid, date, text) from public, anon;
grant execute on function public.te_mark_paid(uuid, date, text) to authenticated;

-- The history's "Paid" step says when and by which transfer.
create or replace function public.te_log()
returns trigger language plpgsql security definer set search_path to 'public' as $f$
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
  elsif new.delete_requested_at is null and old.delete_requested_at is not null then
    insert into te_events (claim_id, actor_id, action) values (new.id, me, case when me = new.employee_id then 'delete_withdrawn' else 'delete_refused' end);
  end if;
  if new.advance is distinct from old.advance then
    insert into te_events (claim_id, actor_id, action, note) values (new.id, me, 'advance', new.advance::text);
  end if;
  return new;
end $f$;
