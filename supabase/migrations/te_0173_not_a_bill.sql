-- te_0173: a photo that is no bill (blank paper TE-222, a floor TE-217) is marked not_bill: red on the line and in Observations (the user, 25 Nov).
alter table te_bills add column if not exists not_bill boolean not null default false;
do $m$
declare d text := pg_get_functiondef('public.te_claim'::regproc);
  o text := $$'refs', b.refs, 'company'$$;
begin
  if position(o in d) = 0 then raise exception 'te_0173: anchor not found'; end if;
  execute replace(d, o, $$'refs', b.refs, 'not_bill', b.not_bill, 'company'$$);
end $m$;
update te_bills set not_bill = true
 where name in ('17955135449692379299095124553241.jpg') and ocr_amount = 47
    or path = 'bc678a10-9d4a-43d9-8856-c67333f788d7/d7779c1a-cea1-4e15-9f6f-8f635b4c71a1.jpg';
