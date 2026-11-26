/*
  te_0099 — the people under this person, at any depth (the user, 3 Nov: "this smitha has reportees also, so now full
  expense also she can see, so how to only take here teams?"). Approvals uses it for its My team | Travel Desk switch,
  shown to desk and admin people who also have reportees.
*/
create or replace function public.te_my_team()
returns uuid[] language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(e.id), '{}') from employees e where e.is_active and e.id <> current_employee_id() and is_in_my_downline(e.id)
$$;
revoke all on function public.te_my_team() from public, anon;
grant execute on function public.te_my_team() to authenticated;
