-- Travel Expense · te_0047 · a bill already added is refused, not asked about
-- The user, 21 Oct: "no attach anyway, why — on the previous step he added it". A bill that is the same
-- booking, the same bill number and amount, or practically the same picture (6 of 256) as one this person
-- already attached is refused, naming where it is. A looser likeness stays an observation for the approvers.

create or replace function public.te_bill_twin(p_claim uuid, p_phash2 text, p_billno text, p_amount numeric, p_refs text[])
 returns text
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select te_bill_label(b)
  from te_bills b join te_claims k on k.id = b.claim_id
  where k.employee_id = (select employee_id from te_claims where id = p_claim)
    and te_can_edit(p_claim) and b.owner_kind <> 'report'
    and (
      -- the same booking: MakeMyTrip's N… ids, not a PNR a group shares
      exists (select 1 from unnest(coalesce(p_refs, '{}')) x where x ~ '^N[A-Z][A-Z0-9]{12,20}$' and x = any(b.refs))
      or (nullif(btrim(p_billno), '') is not null and b.ocr_billno = upper(btrim(p_billno)) and b.ocr_amount is not distinct from p_amount)
      or (nullif(p_phash2, '') is not null and b.phash2 is not null
          and bit_count(('x' || b.phash2)::bit(256) # ('x' || p_phash2)::bit(256)) <= 6))
  order by b.created_at desc
  limit 1
$function$;

create or replace function public.te_add_bill(p_claim uuid, p_kind text, p_owner uuid, p_path text, p_name text, p_sha256 text, p_phash bigint,
  p_amount numeric, p_date date, p_billno text, p_phash2 text default null, p_refs text[] default null)
 returns uuid
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare used text; bid uuid;
begin
  if not te_can_edit(p_claim) then raise exception 'This claim cannot be changed now'; end if;
  select te_bill_label(b) into used from te_bills b where b.sha256 = p_sha256;
  if used is not null then raise exception '% as %', case when p_kind = 'report' then 'Same file' else 'Same bill' end, used; end if;
  -- Already on an earlier line (te_0047): the same booking, the same bill number and amount, or the same picture.
  if p_kind <> 'report' then
    used := te_bill_twin(p_claim, p_phash2, p_billno, p_amount, p_refs);
    if used is not null then raise exception 'Already added on %', used; end if;
  end if;
  insert into te_bills (claim_id, owner_kind, owner_id, path, name, sha256, phash, phash2, ocr_amount, ocr_date, ocr_billno, uploaded_by, refs)
  values (p_claim, p_kind, p_owner, p_path, p_name, p_sha256, p_phash, nullif(p_phash2, ''), p_amount, p_date, nullif(trim(p_billno), ''), current_employee_id(),
    coalesce((select array_agg(distinct upper(btrim(x))) from unnest(p_refs) x where length(btrim(x)) >= 5), '{}'))
  returning id into bid;
  perform te_apply_company(p_claim);
  return bid;
end $function$;
