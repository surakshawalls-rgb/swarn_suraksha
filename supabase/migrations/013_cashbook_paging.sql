-- Merge the tenant's source ledgers before applying offset/limit paging.
-- The RPC returns only payment movements visible to a current business member.
do $preflight$
begin
  if to_regclass('public.ss_cashbook_entries') is null
     or to_regclass('public.ss_sale_cashbook_entries') is null
     or to_regclass('public.ss_sale_return_cashbook_entries') is null
     or to_regprocedure('public.is_business_member(uuid)') is null then
    raise exception 'Purchase, sale, and return cashbook ledgers plus membership helper are required before 013_cashbook_paging';
  end if;
  if exists (
    select 1 from unnest(array['ss_cashbook_entries','ss_sale_cashbook_entries','ss_sale_return_cashbook_entries']) as req(name)
    where not coalesce((select c.relrowsecurity from pg_class c where c.oid=to_regclass('public.'||req.name)),false)
  ) then
    raise exception 'All cashbook source tables must have RLS enabled before 013_cashbook_paging';
  end if;
  perform public.is_business_member(null::uuid);
end
$preflight$;

create or replace function public.ss_cashbook_page(
  p_business_id uuid,
  p_from timestamptz default null,
  p_through timestamptz default null,
  p_offset integer default 0,
  p_limit integer default 200
)
returns table(
  id uuid,
  payment_id uuid,
  source text,
  direction text,
  amount numeric,
  method text,
  recorded_at timestamptz,
  total_count bigint
)
language plpgsql stable security definer set search_path=''
as $function$
begin
  if (select auth.uid()) is null then raise exception 'Authentication required' using errcode='42501'; end if;
  if p_business_id is null or not public.is_business_member(p_business_id) then
    raise exception 'Workspace is missing or cashbook access is not authorized' using errcode='42501';
  end if;
  if p_offset is null or p_offset<0 or p_offset>100000 or p_limit is null or p_limit<1 or p_limit>200 then
    raise exception 'Cashbook page must contain 1 to 200 rows and use a valid offset' using errcode='22023';
  end if;
  if p_from is not null and p_through is not null and p_through<p_from then
    raise exception 'Cashbook end timestamp must not precede its start timestamp' using errcode='22023';
  end if;
  return query
  with entries as (
    select e.id,e.source_id as payment_id,'Purchase payment'::text as source,'out'::text as direction,
      e.amount,e.method,e.recorded_at from public.ss_cashbook_entries e
    where e.business_id=p_business_id and (p_from is null or e.recorded_at>=p_from) and (p_through is null or e.recorded_at<=p_through)
    union all
    select e.id,e.sale_payment_id,'Sale payment'::text,'in'::text,e.amount,e.method,e.recorded_at from public.ss_sale_cashbook_entries e
    where e.business_id=p_business_id and (p_from is null or e.recorded_at>=p_from) and (p_through is null or e.recorded_at<=p_through)
    union all
    select e.id,e.sale_return_id,'Sale refund'::text,'out'::text,e.amount,e.method,e.recorded_at from public.ss_sale_return_cashbook_entries e
    where e.business_id=p_business_id and (p_from is null or e.recorded_at>=p_from) and (p_through is null or e.recorded_at<=p_through)
  )
  select e.id,e.payment_id,e.source,e.direction,e.amount,e.method,e.recorded_at,count(*) over()::bigint
  from entries e order by e.recorded_at desc,e.id desc limit p_limit offset p_offset;
end
$function$;
revoke all on function public.ss_cashbook_page(uuid,timestamptz,timestamptz,integer,integer) from public,anon,authenticated;
grant execute on function public.ss_cashbook_page(uuid,timestamptz,timestamptz,integer,integer) to authenticated;
