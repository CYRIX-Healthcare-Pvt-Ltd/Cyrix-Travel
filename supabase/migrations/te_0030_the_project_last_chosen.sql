-- Travel Expense · te_0030 · a claim starts with the project last chosen
-- The user, 19 Oct: "project dropdown should be by default the last claim project he selected, if new
-- just keep choose". A new claim took the project of the claim with the latest month, which could be
-- one with none chosen yet, or an older month's. Now it is the project on the claim the person last
-- changed that has one; an open draft still without a project gets it too. Nobody's project is ever
-- replaced, and a person who never chose one still sees "Choose…".

create or replace function public.te_open_month(p_month date)
returns uuid language plpgsql security definer set search_path to 'public' as $f$
declare me uuid := current_employee_id(); m date := date_trunc('month', p_month)::date; cid uuid; e employees; last te_claims; nxt int; proj text;
begin
  if me is null or not travel_has_access() then raise exception 'Travel Expense has not been given to you yet'; end if;
  if m > date_trunc('month', current_date)::date then raise exception 'A future month cannot be claimed'; end if;
  select project into proj from te_claims where employee_id = me and nullif(trim(project), '') is not null order by updated_at desc limit 1;
  -- The part still open to change, if there is one.
  select id into cid from te_claims where employee_id = me and month = m and status in ('draft', 'returned') order by part limit 1;
  if cid is not null then
    update te_claims set project = proj where id = cid and nullif(trim(project), '') is null and proj is not null;
    return cid;
  end if;
  select * into e from employees where id = me;
  select * into last from te_claims where employee_id = me order by month desc, part desc limit 1;
  select coalesce(max(part), 0) + 1 into nxt from te_claims where employee_id = me and month = m;
  insert into te_claims (employee_id, month, part, grade, designation, base_location, project, mobile)
  values (me, m, nxt, e.grade, e.designation, coalesce(last.base_location, e.location), proj, coalesce(last.mobile, e.official_phone))
  returning id into cid;
  return cid;
end $f$;
