/*
  te_0160: the policy's Specialists row (the user, 16 Nov, Athul Raj V E1307 "not getting it"; "we dont need in setting").
  Anybody whose designation on the claim says Specialist gets the Specialists DA, whatever the grade:
  in district 200, out of district 250, staying in a room in the state 300, out of state 400.
  Only the DA changes; rooms, km rates and the rest stay with the grade. Aurum grades (per diem) are not touched.
*/

insert into public.te_policy (key, value)
values ('specialist_da', '{"da_in_district": 200, "da_out_district": 250, "da_out_state": 300, "da_out_state_stay": 400}'::jsonb)
on conflict (key) do nothing;

-- The grade's rule, with the Specialists DA for a Specialist designation.
create or replace function public.te_rule_for(p_grade text, p_designation text)
 returns te_grade_rules language plpgsql stable security definer set search_path to 'public' as $function$
declare r te_grade_rules := te_rule(p_grade); s jsonb;
begin
  if coalesce(p_designation, '') ~* 'specialist' and r.per_diem is null then
    select value into s from te_policy where key = 'specialist_da';
    if s is not null then
      r.da_in_district := coalesce((s->>'da_in_district')::numeric, r.da_in_district);
      r.da_out_district := coalesce((s->>'da_out_district')::numeric, r.da_out_district);
      r.da_out_state := coalesce((s->>'da_out_state')::numeric, r.da_out_state);
      r.da_out_state_stay := coalesce((s->>'da_out_state_stay')::numeric, r.da_out_state_stay);
    end if;
  end if;
  return r;
end $function$;
revoke all on function public.te_rule_for(text, text) from public, anon;
grant execute on function public.te_rule_for(text, text) to authenticated;

create or replace function public.te_da(p_grade text, p_kind text, p_purpose text, p_designation text)
 returns numeric language plpgsql stable security definer set search_path to 'public' as $function$
declare r te_grade_rules := te_rule_for(p_grade, p_designation);
begin
  if exists (select 1 from te_purposes where label = p_purpose and not gives_da) then return 0; end if;
  return case p_kind when 'in_district' then r.da_in_district when 'out_district' then r.da_out_district
    when 'out_state' then r.da_out_state when 'out_state_stay' then r.da_out_state_stay
    when 'deputation' then coalesce((select (value #>> '{}')::numeric from te_policy where key = 'deputation_da'), 800)
    when 'aurum_actual' then coalesce(r.misc_day, 0)
    when 'aurum_per_diem' then coalesce(r.per_diem, 0) + coalesce(r.misc_day, 0)
    when 'aurum_per_diem_lodging' then round(coalesce(r.per_diem, 0) * 0.5) + coalesce(r.misc_day, 0)
    when 'aurum_per_diem_board' then round(coalesce(r.per_diem, 0) * 0.25) + coalesce(r.misc_day, 0)
    else 0 end;
end $function$;
revoke all on function public.te_da(text, text, text, text) from public, anon;
grant execute on function public.te_da(text, text, text, text) to authenticated;

create or replace function public.te_da(p_grade text, p_kind text, p_purpose text)
 returns numeric language sql stable security definer set search_path to 'public' as $function$
  select te_da(p_grade, p_kind, p_purpose, null::text)
$function$;

-- Saving a day and the claim's screen use the designation too.
do $$
declare f text;
  a1 text := $q$te_da(c.grade, coalesce(p_day->>'da_kind', 'none'), p_day->>'purpose')$q$;
  a2 text := $q$'rule', to_jsonb(te_rule(c.grade))$q$;
begin
  f := pg_get_functiondef('public.te_save_day(uuid, jsonb)'::regprocedure);
  if position(a1 in f) = 0 then raise exception 'te_save_day changed'; end if;
  execute replace(f, a1, $q$te_da(c.grade, coalesce(p_day->>'da_kind', 'none'), p_day->>'purpose', c.designation)$q$);
  select pg_get_functiondef(p.oid) into f from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'te_claim';
  if position(a2 in f) = 0 then raise exception 'te_claim changed'; end if;
  execute replace(f, a2, $q$'rule', to_jsonb(te_rule_for(c.grade, c.designation))$q$);
end $$;
