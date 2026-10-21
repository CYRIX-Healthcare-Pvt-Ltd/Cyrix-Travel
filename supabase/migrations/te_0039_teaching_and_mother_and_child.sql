-- Travel Expense · te_0039 · a TH or MCH means one thing in Kerala and another in Andhra
-- In Andhra's asset list (the user, 21 Oct) TH is a Teaching Hospital and MCH a Mother and Child Hospital;
-- in Kerala's, a Taluk Hospital and a Medical College Hospital. Either full name is now the same kind as
-- its short form (an Area Hospital and a UCHC too), so a place learned as "TH Guntur" and one picked as "Teaching Hospital Guntur" are one.

create or replace function public.te_place_words(p text)
 returns text[]
 language sql
 immutable
as $function$
  select coalesce(array_agg(distinct w order by w), '{}')
  from unnest(regexp_split_to_array(lower(regexp_replace(coalesce(p, ''), '[^a-zA-Z0-9]+', ' ', 'g')), '\s+')) w
  where length(w) >= 2 and w not in ('primary', 'family', 'community', 'health', 'healthcare', 'centre', 'center', 'hospital', 'hosp', 'district', 'taluk', 'taluka', 'headquarters', 'headquarter', 'head', 'quarters', 'hq', 'general', 'urban', 'wellness', 'and', 'medical', 'college', 'government', 'govt', 'women', 'children', 'childrens', 'mother', 'child', 'teaching', 'dental', 'satellite', 'sub', 'block', 'area', 'new', 'additional', 'mental', 'the', 'of', 'unit', 'model', 'clinic', 'dispensary', '24x7', 'aam', 'phc', 'uphc', 'bphc', 'aphc', 'nphc', 'chc', 'uchc', 'fhc', 'ufhc', 'hwc', 'uhwc', 'thqh', 'thq', 'th', 'dh', 'dhh', 'dwh', 'sdh', 'gh', 'ah', 'mch', 'gmc', 'gmch', 'gmhc', 'wch', 'w', 'c')
$function$;

create or replace function public.te_place_type(p text)
 returns text
 language sql
 immutable
as $function$
  select case
    when x ~ '\m(uphc|urban primary health cent(re|er))\M' then 'uphc'
    when x ~ '\m(uhwc|urban health (and |& )?wellness cent(re|er))\M' then 'uhwc'
    when x ~ '\m(hwc|health (and |& )?wellness cent(re|er))\M' then 'hwc'
    when x ~ '\m(phc|fhc|primary health cent(re|er)|family health cent(re|er))\M' then 'phc'
    when x ~ '\m(chc|uchc|community health cent(re|er))\M' then 'chc'
    when x ~ '\m(thqh|thq|taluk head ?quarters? hospital)\M' then 'thqh'
    when x ~ '\m(th|taluk hospital|teaching hospital)\M' then 'th'
    when x ~ '\m(sdh|sub district hospital)\M' then 'sdh'
    when x ~ '\m(dh|dhh|district hospital|district head ?quarters? hospital)\M' then 'dh'
    when x ~ '\m(gh|general hospital)\M' then 'gh'
    when x ~ '\m(ah|area hospital)\M' then 'ah'
    when x ~ '\m(mch|gmc|gmch|medical college|mother (and |& )?child)\M' then 'mch'
    when x ~ '\m(wch|women (and |& )?child(ren)?)' or x ~ 'w ?& ?c' then 'wch'
  end
  from (select lower(coalesce(p, '')) as x) t
$function$;

update te_facilities set words = te_place_words(name), kind = te_place_type(name);
