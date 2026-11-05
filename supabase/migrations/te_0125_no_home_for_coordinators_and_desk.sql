/*
  te_0125 — Coordinators and the Travel Desk are not asked to set a home (the user, 5 Nov: "for coord, or travel desk
  persons we dont need default home setting option"). The Set your home screen (te_0102) is for people who travel;
  anyone named as a coordinator in SW Admin → Travel Expense → Coordinators, or on its Travel Desk list, goes
  straight in. They can still set one from My profile.
*/
create or replace function public.te_home_needed()
 returns boolean language sql stable security definer set search_path to 'public' as $function$
  select coalesce(te_rule_from('home_required_from', current_employee_id()) <= (now() at time zone 'Asia/Kolkata')::date, false)
    and not exists (select 1 from travel_homes h where h.employee_id = current_employee_id())
    and not exists (select 1 from te_cost_centre_coordinators c where c.coordinator_id = current_employee_id())
    and not exists (select 1 from user_roles r where r.employee_id = current_employee_id() and r.role = 'travel_desk')
$function$;
