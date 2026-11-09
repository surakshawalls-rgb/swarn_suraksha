-- Tenant-scoped summary aggregates. No direct ledger grants are widened.
do $preflight$
begin
  if to_regclass('public.ss_sales') is null or to_regclass('public.ss_purchases') is null then
    raise exception 'Sales and purchase ledgers are required before 009_dashboard_summary';
  end if;
  if to_regprocedure('public.is_business_member(uuid)') is null then
    raise exception 'Tenant membership helper is required before 009_dashboard_summary';
  end if;
  perform public.is_business_member(null::uuid);
end
$preflight$;

create or replace function public.ss_dashboard_summary(p_business_id uuid)
returns table (
  sales_total numeric,
  purchases_total numeric,
  customer_due numeric,
  supplier_due numeric,
  sale_count bigint,
  purchase_count bigint
)
language plpgsql
stable
security definer
set search_path=''
as $function$
begin
  if (select auth.uid()) is null then
    raise exception 'Authentication required' using errcode='42501';
  end if;
  if p_business_id is null or not public.is_business_member(p_business_id) then
    raise exception 'Workspace is missing or access is not authorized' using errcode='42501';
  end if;
  return query
    select coalesce((select sum(s.subtotal) from public.ss_sales s where s.business_id=p_business_id),0)::numeric,
           coalesce((select sum(p.subtotal) from public.ss_purchases p where p.business_id=p_business_id),0)::numeric,
           coalesce((select sum(s.subtotal-s.paid_total) from public.ss_sales s where s.business_id=p_business_id),0)::numeric,
           coalesce((select sum(p.subtotal-p.paid_total) from public.ss_purchases p where p.business_id=p_business_id),0)::numeric,
           (select count(*) from public.ss_sales s where s.business_id=p_business_id),
           (select count(*) from public.ss_purchases p where p.business_id=p_business_id);
end
$function$;

revoke all on function public.ss_dashboard_summary(uuid) from public,anon,authenticated;
grant execute on function public.ss_dashboard_summary(uuid) to authenticated;
