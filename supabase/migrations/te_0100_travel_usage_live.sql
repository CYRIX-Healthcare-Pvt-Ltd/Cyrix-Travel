/*
  te_0100 — Travel Expense in use, for SW Admin's Live tab (the user, 3 Nov, the demo's first day: "can we have a
  subtab showing live counters?, with date filters?"). Real people only: the test accounts E6666, E7777, E8888, E9999
  and any "- Test" name are left out ("dont include test accounts remember it"). Counts what was saved in the period:
  claims started, sent, approved by the manager, visit photos, bills, homes set, advances, deputations, vehicle
  requests — in total, by function and by person. Null dates: all time.
*/
create or replace function public.te_usage(p_from date default null, p_to date default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  s timestamptz := case when p_from is null then '-infinity'::timestamptz else p_from::timestamp at time zone 'Asia/Kolkata' end;
  e timestamptz := case when p_to is null then 'infinity'::timestamptz else (p_to + 1)::timestamp at time zone 'Asia/Kolkata' end;
  out jsonb;
begin
  if not is_sw_admin() then raise exception 'Only SW Admin sees this'; end if;
  with real as (
    select x.id, x.ecode, x.full_name, nullif(btrim(x.function_name), '') fn, x.reporting_manager_id
    from employees x where x.ecode not in ('E6666', 'E7777', 'E8888', 'E9999') and x.full_name not ilike '%- test%'
  ), act as (
    select c.employee_id id, 'started' k, c.created_at at from te_claims c
    union all select c.employee_id, case when ev.action in ('submitted', 'resubmitted') then 'sent' else 'approved' end, ev.at
      from te_events ev join te_claims c on c.id = ev.claim_id where ev.action in ('submitted', 'resubmitted', 'manager_approved')
    union all select c.employee_id, 'bill', b.created_at from te_bills b join te_claims c on c.id = b.claim_id
    union all select employee_id, 'photo', shot_at from te_visit_photos
    union all select employee_id, 'home', at from te_home_moves
    union all select employee_id, 'advance', created_at from te_advances
    union all select employee_id, 'deputation', created_at from te_deputations
    union all select employee_id, 'vehicle', created_at from te_vehicle_approvals
  ), ever as (
    select a.id, min(a.at) first_ever from act a join real r on r.id = a.id group by a.id
  ), hit as (
    select a.*, r.ecode, r.full_name, r.fn, r.reporting_manager_id from act a join real r on r.id = a.id where a.at >= s and a.at < e
  ), per as (
    select h.id, h.ecode, h.full_name, h.fn, te_person_label(h.reporting_manager_id) manager,
      min(h.at) first_at, max(h.at) last_at, count(*) actions,
      count(*) filter (where k = 'started') started, count(*) filter (where k = 'sent') sent, count(*) filter (where k = 'approved') approved,
      count(*) filter (where k = 'photo') photos, count(*) filter (where k = 'bill') bills,
      bool_or(k = 'home') home, (select v.first_ever from ever v where v.id = h.id) >= s new
    from hit h group by h.id, h.ecode, h.full_name, h.fn, h.reporting_manager_id
  )
  select jsonb_build_object(
    'totals', jsonb_build_object(
      'people', (select count(*) from per), 'new', (select count(*) from per where new),
      'started', (select count(*) from hit where k = 'started'), 'sent', (select count(*) from hit where k = 'sent'),
      'approved', (select count(*) from hit where k = 'approved'), 'photos', (select count(*) from hit where k = 'photo'),
      'bills', (select count(*) from hit where k = 'bill'), 'homes', (select count(*) from hit where k = 'home'),
      'advances', (select count(*) from hit where k = 'advance'), 'deputations', (select count(*) from hit where k = 'deputation'),
      'vehicles', (select count(*) from hit where k = 'vehicle')),
    'functions', coalesce((select jsonb_agg(jsonb_build_object('function', coalesce(f.fn, '—'), 'people', f.people, 'started', f.started, 'sent', f.sent, 'photos', f.photos) order by f.people desc, f.fn)
      from (select fn, count(*) people, sum(started) started, sum(sent) sent, sum(photos) photos from per group by fn) f), '[]'),
    'people', coalesce((select jsonb_agg(jsonb_build_object('ecode', p.ecode, 'name', p.full_name, 'function', p.fn, 'manager', p.manager,
      'first_at', p.first_at, 'last_at', p.last_at, 'actions', p.actions, 'started', p.started, 'sent', p.sent, 'approved', p.approved,
      'photos', p.photos, 'bills', p.bills, 'home', p.home, 'new', p.new) order by p.last_at desc) from per p), '[]'),
    'at', now()) into out;
  return out;
end $$;
revoke all on function public.te_usage(date, date) from public, anon;
grant execute on function public.te_usage(date, date) to authenticated;
