-- te_0172: the claim's approved deputations carry the letter, so approvers open it from the DA · deputation line (the user, 25 Nov).
do $m$
declare d text := pg_get_functiondef('public.te_claim'::regproc);
  o text := $$jsonb_build_object('state', x.state, 'from_day', x.from_day, 'to_day', x.to_day)$$;
begin
  if position(o in d) = 0 then raise exception 'te_0172: anchor not found'; end if;
  execute replace(d, o, $$jsonb_build_object('state', x.state, 'from_day', x.from_day, 'to_day', x.to_day, 'letter_path', x.letter_path, 'letter_name', x.letter_name)$$);
end $m$;
