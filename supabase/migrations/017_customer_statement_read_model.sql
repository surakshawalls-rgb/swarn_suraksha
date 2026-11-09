-- Exact customer statement totals over the complete selected history, with
-- paginated invoice details. The RPC is read-only and membership checked.
do $preflight$
begin
  if to_regclass('public.customers') is null or to_regclass('public.ss_sales') is null
     or to_regclass('public.ss_sale_returns') is null
     or to_regprocedure('public.is_business_member(uuid)') is null then
    raise exception 'Verified customer, sales, return tables and membership helper are required before 017_customer_statement_read_model';
  end if;
  perform public.is_business_member(null::uuid);
end
$preflight$;

create or replace function public.ss_customer_statement_page(
  p_business_id uuid,p_customer_id uuid,p_from date default null,p_through date default null,
  p_offset integer default 0,p_limit integer default 100
) returns jsonb
language plpgsql stable security definer set search_path=''
as $function$
declare result jsonb;
begin
  if (select auth.uid()) is null then raise exception 'Authentication required' using errcode='42501'; end if;
  if p_business_id is null or not public.is_business_member(p_business_id) then
    raise exception 'Workspace is missing or customer statement access is not authorized' using errcode='42501';
  end if;
  if p_customer_id is null or not exists(select 1 from public.customers c where c.business_id=p_business_id and c.id=p_customer_id) then
    raise exception 'Customer does not belong to this workspace' using errcode='42501';
  end if;
  if p_from is not null and p_through is not null and p_through<p_from then raise exception 'End date must not precede start date' using errcode='22023'; end if;
  if p_offset is null or p_offset<0 or p_offset>100000 or p_limit is null or p_limit<1 or p_limit>100 then
    raise exception 'Statement page must contain 1 to 100 rows and use a valid offset' using errcode='22023';
  end if;
  with return_totals as (
    select r.sale_id,sum(r.original_line_amount)::numeric returned,sum(r.balance_reduction)::numeric due_reduction,sum(r.cash_refund)::numeric refunded
    from public.ss_sale_returns r where r.business_id=p_business_id group by r.sale_id
  ), calculated as (
    select s.id,s.invoice_number,s.subtotal,s.paid_total,s.created_at,
      coalesce(r.returned,0)::numeric returned,coalesce(r.due_reduction,0)::numeric due_reduction,coalesce(r.refunded,0)::numeric refunded,
      (s.subtotal-coalesce(r.returned,0))::numeric net_invoiced,
      (s.paid_total-coalesce(r.refunded,0))::numeric net_collected,
      (s.subtotal-s.paid_total-coalesce(r.due_reduction,0))::numeric outstanding
    from public.ss_sales s left join return_totals r on r.sale_id=s.id
    where s.business_id=p_business_id and s.customer_id=p_customer_id
      and (p_from is null or (s.created_at at time zone 'Asia/Kolkata')::date>=p_from)
      and (p_through is null or (s.created_at at time zone 'Asia/Kolkata')::date<=p_through)
  ), totals as (
    select coalesce(sum(net_invoiced),0)::numeric net_invoiced,coalesce(sum(net_collected),0)::numeric net_collected,
      coalesce(sum(returned),0)::numeric returned,coalesce(sum(outstanding),0)::numeric outstanding,count(*)::bigint total_count
    from calculated
  ), page_rows as (
    select jsonb_agg(jsonb_build_object('id',p.id,'invoice_number',p.invoice_number::text,'subtotal',p.subtotal::text,
      'paid_total',p.paid_total::text,'created_at',p.created_at,'returned',p.returned::text,'due_reduction',p.due_reduction::text,
      'refunded',p.refunded::text,'net_invoiced',p.net_invoiced::text,'net_collected',p.net_collected::text,'outstanding',p.outstanding::text)
      order by p.created_at desc,p.id desc) rows
    from (select * from calculated order by created_at desc,id desc limit p_limit offset p_offset) p
  )
  select jsonb_build_object('totals',jsonb_build_object('net_invoiced',t.net_invoiced::text,'net_collected',t.net_collected::text,
    'returned',t.returned::text,'outstanding',t.outstanding::text),'rows',coalesce(pr.rows,'[]'::jsonb),'total_count',t.total_count)
    into result from totals t cross join page_rows pr;
  return result;
end
$function$;
revoke all on function public.ss_customer_statement_page(uuid,uuid,date,date,integer,integer) from public,anon,authenticated;
grant execute on function public.ss_customer_statement_page(uuid,uuid,date,date,integer,integer) to authenticated;
