/*
  te_0084 — visit photos are SW Admin's alone (the user, 28 Oct: "no, i told only sw admin, not them, remove from them").

  te_0082 let anyone te_is_admin() (SW Admin or ACC Admin) switch visit photos on or off, tick Photo needed, set the
  limits and delete a purpose. Now only SW Admin: te_set_purpose_photo and te_delete_purpose refuse anyone else, and
  te_set_policy refuses the five visit-photo settings to anyone else. ACC Admin keeps every other setting and purpose
  as before. The settings themselves live in KPI's SW Admin → Travel Expense → Visit photos.
*/

create or replace function public.te_set_policy(p_key text, p_value jsonb)
returns void language plpgsql security definer set search_path to 'public' as $$
begin
  if not te_is_admin() then raise exception 'Only SW Admin or ACC Admin'; end if;
  if p_key in ('visit_photos', 'photo_near_m', 'photo_skips', 'photo_after', 'photo_keep_days') and not is_sw_admin() then
    raise exception 'Only SW Admin sets visit photos';
  end if;
  update te_policy set value = p_value, updated_at = now() where key = p_key;
  if not found then raise exception 'No such setting'; end if;
end $$;

create or replace function public.te_set_purpose_photo(p_id integer, p_on boolean)
returns void language plpgsql security definer set search_path to 'public' as $$
begin
  if not is_sw_admin() then raise exception 'Only SW Admin sets visit photos'; end if;
  update te_purposes set photo_needed = p_on where id = p_id;
  if not found then raise exception 'That purpose is not there any more'; end if;
end $$;

create or replace function public.te_delete_purpose(p_id integer)
returns void language plpgsql security definer set search_path to 'public' as $$
declare lbl text; n int;
begin
  if not is_sw_admin() then raise exception 'Only SW Admin deletes a purpose'; end if;
  select label into lbl from te_purposes where id = p_id;
  if lbl is null then raise exception 'That purpose is not there any more'; end if;
  if lbl ~* 'breakdown' then raise exception 'Keep the breakdown purpose — its rides ask for the ticket ID by it'; end if;
  select (select count(*) from te_rides where purpose = lbl) + (select count(*) from te_days where purpose = lbl) into n;
  if n > 0 then raise exception '% is used on % rides or days. Untick In use instead', lbl, n; end if;
  delete from te_purposes where id = p_id;
end $$;
