-- Travel Expense · te_0023 · my places, named by their person
-- The user, 17 Oct: a place picked on the map (the base location, a hospital, a stop) can be saved
-- with a name and picked again with one tap; a "My places" tab names, renames and removes them.
-- The saved-places table of the trip module (te_0005, empty) is used as it is.
create or replace function public.te_places()
returns table (id uuid, name text, lat double precision, lng double precision)
language sql stable security definer set search_path to 'public' as $f$
  select id, name, lat, lng from travel_places where employee_id = current_employee_id() order by name
$f$;

create or replace function public.te_save_place(p_id uuid, p_name text, p_lat double precision, p_lng double precision)
returns uuid language plpgsql security definer set search_path to 'public' as $f$
declare me uuid := current_employee_id(); pid uuid;
begin
  if me is null or not travel_has_access() then raise exception 'Travel Expense has not been given to you yet'; end if;
  if coalesce(trim(p_name), '') = '' then raise exception 'Give the place a name'; end if;
  if p_id is null then
    if exists (select 1 from travel_places where employee_id = me and name_key = lower(trim(p_name))) then
      raise exception 'You already have a place called %', trim(p_name);
    end if;
    insert into travel_places (employee_id, name, name_key, lat, lng) values (me, trim(p_name), lower(trim(p_name)), p_lat, p_lng) returning id into pid;
  else
    update travel_places set name = trim(p_name), name_key = lower(trim(p_name)), lat = coalesce(p_lat, lat), lng = coalesce(p_lng, lng)
    where id = p_id and employee_id = me returning id into pid;
    if pid is null then raise exception 'That place is not yours'; end if;
  end if;
  return pid;
end $f$;

create or replace function public.te_delete_place(p_id uuid)
returns void language sql security definer set search_path to 'public' as $f$
  delete from travel_places where id = p_id and employee_id = current_employee_id()
$f$;

revoke execute on function public.te_places(), public.te_save_place(uuid, text, double precision, double precision), public.te_delete_place(uuid) from public, anon;
grant execute on function public.te_places(), public.te_save_place(uuid, text, double precision, double precision), public.te_delete_place(uuid) to authenticated;
