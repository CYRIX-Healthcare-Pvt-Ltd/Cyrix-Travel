/*
  te_0007 — a mode of travel can be added, and one can be taken out of use.

  The five modes were rows put in by the first migration, and nothing could
  add a sixth (the user, 1 Oct, on SW Admin's "What each mode pays": "should
  have added, add mode if anything if we need to add"). The software
  administrator may now add one — a metro, a company vehicle, a ferry — with
  its name, whether it pays by the kilometre or on its actual fare, and which
  of the five drawn vehicles it looks like, so it is not a grey arrow among
  five pictures.

  A mode cannot be deleted once a leg has been travelled on it: the leg
  names it. So a mode is taken out of use instead — it leaves the picker and
  stays on the claims that used it — and can be put back. One mode at least
  stays in use, or no trip could start.
*/
alter table public.travel_modes
  add column if not exists art text check (art is null or art in ('bike', 'car', 'bus', 'train', 'auto'));

/** Adds a mode. Its code is made from its name; a name already there, however it is spaced or cased, is refused. */
create or replace function public.travel_add_mode(p_label text, p_per_km numeric default null, p_art text default null)
returns text language plpgsql security definer set search_path to 'public' as $fn$
declare
  nm  text := regexp_replace(btrim(coalesce(p_label, '')), '\s+', ' ', 'g');
  key text := btrim(regexp_replace(lower(nm), '[^a-z0-9]+', '_', 'g'), '_');
begin
  if not is_sw_admin() then raise exception 'Only the software administrator can add a mode'; end if;
  if length(nm) < 2 or length(nm) > 30 or key = '' then raise exception 'Give the mode a name, 2 to 30 letters'; end if;
  if exists (select 1 from travel_modes m
              where m.mode = key or regexp_replace(lower(m.label), '[^a-z0-9]+', '', 'g') = replace(key, '_', '')) then
    raise exception 'There is already a mode called %', nm;
  end if;
  if p_per_km is not null and (p_per_km <= 0 or p_per_km > 500) then raise exception 'A rate is between ₹0 and ₹500 a km'; end if;
  if p_art is not null and p_art not in ('bike', 'car', 'bus', 'train', 'auto') then raise exception 'Choose which vehicle it is drawn as'; end if;
  if (select count(*) from travel_modes) >= 20 then raise exception 'There are 20 modes already — take one out of use rather than adding more'; end if;
  insert into travel_modes (mode, label, per_km, sort_order, art, updated_by)
  values (key, nm, p_per_km, (select coalesce(max(sort_order), 0) + 1 from travel_modes), p_art, current_employee_id());
  perform log_audit('travel_mode', null, 'added', jsonb_build_object('mode', key, 'label', nm, 'per_km', p_per_km, 'art', p_art));
  return key;
end $fn$;

/** Takes a mode out of use, or puts it back. Legs already travelled on it keep it. */
create or replace function public.travel_set_mode_active(p_mode text, p_on boolean)
returns void language plpgsql security definer set search_path to 'public' as $fn$
begin
  if not is_sw_admin() then raise exception 'Only the software administrator can change the modes'; end if;
  if p_on is null then raise exception 'Say whether the mode is in use'; end if;
  if not exists (select 1 from travel_modes where mode = p_mode) then raise exception 'That mode does not exist'; end if;
  if not p_on and not exists (select 1 from travel_modes where is_active and mode <> p_mode) then
    raise exception 'One mode at least has to stay in use';
  end if;
  update travel_modes set is_active = p_on, updated_at = now(), updated_by = current_employee_id() where mode = p_mode;
  perform log_audit('travel_mode', null, case when p_on then 'put_in_use' else 'taken_out_of_use' end, jsonb_build_object('mode', p_mode));
end $fn$;

revoke all on function public.travel_add_mode(text, numeric, text) from public, anon;
revoke all on function public.travel_set_mode_active(text, boolean) from public, anon;
grant execute on function public.travel_add_mode(text, numeric, text) to authenticated, service_role;
grant execute on function public.travel_set_mode_active(text, boolean) to authenticated, service_role;
