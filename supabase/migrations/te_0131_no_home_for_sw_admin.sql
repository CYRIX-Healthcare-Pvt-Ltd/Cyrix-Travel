/*
  te_0131 — SW Admin is not asked to set a home (the user, 5 Nov, opening Aswin's claim as SW_ADMIN met "Set your home"):
  SW Admin claims no travel, as with coordinators and the Travel Desk (te_0125).
*/
create or replace function public.te_home_needed()
 returns boolean language sql stable security definer set search_path to 'public' as $function$
  select coalesce(te_rule_from('home_required_from', current_employee_id()) <= (now() at time zone 'Asia/Kolkata')::date, false)
    and not exists (select 1 from travel_homes h where h.employee_id = current_employee_id())
    and not exists (select 1 from te_cost_centre_coordinators c where c.coordinator_id = current_employee_id())
    and not exists (select 1 from user_roles r where r.employee_id = current_employee_id() and r.role = 'travel_desk')
    and not is_sw_admin()
$function$;
