/*
  te_0126 — The Travel Desk's message names the manager who approved the advance (the user, 5 Nov: "approved by
  name"): "Approved by jestin jose (E1266) · Kerala → Karnataka" in place of "Approved by the manager · …".
  The messages already sent get the name too.
*/
do $$
declare f text;
  a text := $q$'Approved by the manager · ' || v.base_state$q$;
  b text := $q$'Approved by ' || coalesce((select full_name || ' (' || ecode || ')' from employees where id = me), 'the manager') || ' · ' || v.base_state$q$;
begin
  f := pg_get_functiondef('public.te_advance_decide'::regproc);
  if position(a in f) = 0 then raise exception 'te_advance_decide changed'; end if;
  execute replace(f, a, b);
end $$;

update push_messages m
set body = 'Approved by ' || e.full_name || ' (' || e.ecode || ')' || substr(m.body, length('Approved by the manager') + 1)
from te_advances x, employees e
where m.kind = 'travel' and m.body like 'Approved by the manager · %'
  and m.title like 'Advance ' || x.number || ' · %' and m.created_at::date = x.manager_at::date
  and e.id = x.manager_id;
