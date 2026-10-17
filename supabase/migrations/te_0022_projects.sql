-- Travel Expense · te_0022 · projects, a list the admins keep
-- The user, 17 Oct: "project need dropdown in forms, that sw or acc admin will set".
create table if not exists public.te_projects (
  id serial primary key, label text not null unique, is_active boolean not null default true, sort int not null default 0
);
alter table public.te_projects enable row level security;
insert into public.te_projects (label, sort) values ('Care 360 (PVT BEMMP)', 1) on conflict (label) do nothing;

/** The projects to choose from, for anybody with the module. */
create or replace function public.te_projects()
returns table (label text) language sql stable security definer set search_path to 'public' as $f$
  select label from te_projects where is_active and travel_has_access() order by sort, label
$f$;

create or replace function public.te_set_project(p_id int, p_label text, p_active boolean)
returns void language plpgsql security definer set search_path to 'public' as $f$
begin
  if not te_is_admin() then raise exception 'Only SW Admin or ACC Admin'; end if;
  if coalesce(trim(p_label), '') = '' then raise exception 'Type the project name'; end if;
  if p_id is null then
    insert into te_projects (label, sort) values (trim(p_label), (select coalesce(max(sort), 0) + 1 from te_projects));
  else
    update te_projects set label = trim(p_label), is_active = p_active where id = p_id;
  end if;
end $f$;

create or replace function public.te_admin_data()
returns jsonb language plpgsql stable security definer set search_path to 'public' as $f$
begin
  if not te_is_admin() then raise exception 'Only SW Admin or ACC Admin'; end if;
  return jsonb_build_object(
    'rules', (select jsonb_agg(to_jsonb(r) order by r.grade = '*' desc, r.grade) from te_grade_rules r),
    'policy', (select jsonb_object_agg(key, value) from te_policy),
    'purposes', (select jsonb_agg(to_jsonb(p) order by p.sort, p.label) from te_purposes p),
    'projects', (select coalesce(jsonb_agg(to_jsonb(p) order by p.sort, p.label), '[]') from te_projects p),
    'coordinators', (select coalesce(jsonb_agg(jsonb_build_object('ecode', e.ecode, 'name', e.full_name, 'coordinator_ecode', k.ecode, 'coordinator', k.full_name) order by e.full_name), '[]')
                     from te_coordinators c join employees e on e.id = c.employee_id join employees k on k.id = c.coordinator_id),
    'desk', (select coalesce(jsonb_agg(jsonb_build_object('ecode', e.ecode, 'name', e.full_name) order by e.full_name), '[]')
             from user_roles u join employees e on e.id = u.employee_id where u.role = 'travel_desk'));
end $f$;

revoke execute on function public.te_projects(), public.te_set_project(int, text, boolean) from public, anon;
grant execute on function public.te_projects(), public.te_set_project(int, text, boolean) to authenticated;
