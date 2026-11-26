/*
  te_0072 — the admins' list of learned places names who checked each one as it names who added it: name and employee
  code (the user, 26 Oct: "in admin, need to know who added it also. name - ecode").
*/
drop function if exists public.te_admin_places();
create function public.te_admin_places()
 returns table (id uuid, name text, full_name text, district text, visits int, first_by text, created_at timestamptz, lat float8, lng float8,
                source text, checked_at timestamptz, checked_by text)
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
begin
  if not (te_is_admin() or is_sw_admin()) then raise exception 'Only a Travel admin sees the learned places'; end if;
  return query
  select f.id, f.name, f.full_name, f.district, (select count(*)::int from te_tickets t where t.facility_id = f.id),
         e.full_name || ' (' || e.ecode || ')', f.created_at, f.lat, f.lng,
         f.source, f.checked_at, c.full_name || ' (' || c.ecode || ')'
  from te_facilities f left join employees e on e.id = f.first_by left join employees c on c.id = f.checked_by
  where not f.hidden order by f.created_at desc;
end $function$;
revoke all on function public.te_admin_places() from public, anon;
grant execute on function public.te_admin_places() to authenticated;
