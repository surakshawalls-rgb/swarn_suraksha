-- Chronological customer account statement using immutable invoice, payment,
-- return, and refund source records. Positive balance means amount due.
do $preflight$
begin
  if to_regclass('public.customers') is null or to_regclass('public.ss_sales') is null
     or to_regclass('public.ss_sale_payments') is null or to_regclass('public.ss_sale_returns') is null
     or to_regclass('public.ss_sale_return_cashbook_entries') is null
     or to_regprocedure('public.is_business_member(uuid)') is null then
    raise exception 'Verified customer, sales, payment, return and refund ledgers plus membership helper are required before 018_customer_transaction_ledger';
  end if;
  perform public.is_business_member(null::uuid);
end
$preflight$;

create or replace function public.ss_customer_ledger_page(
  p_business_id uuid,p_customer_id uuid,p_from date default null,p_through date default null,
  p_offset integer default 0,p_limit integer default 100
) returns jsonb
language plpgsql stable security definer set search_path=''
as $function$
declare result jsonb;
begin
  if (select auth.uid()) is null then raise exception 'Authentication required' using errcode='42501'; end if;
  if p_business_id is null or not public.is_business_member(p_business_id) then
    raise exception 'Workspace is missing or customer ledger access is not authorized' using errcode='42501';
  end if;
  if p_customer_id is null or not exists(select 1 from public.customers c where c.business_id=p_business_id and c.id=p_customer_id) then
    raise exception 'Customer does not belong to this workspace' using errcode='42501';
  end if;
  if p_from is not null and p_through is not null and p_through<p_from then raise exception 'End date must not precede start date' using errcode='22023'; end if;
  if p_offset is null or p_offset<0 or p_offset>100000 or p_limit is null or p_limit<1 or p_limit>100 then
    raise exception 'Ledger page must contain 1 to 100 rows and use a valid offset' using errcode='22023';
  end if;
  with raw_events as (
    select s.id event_id,'sale.invoice'::text event_type,'Invoice #'||s.invoice_number::text description,
      s.id entity_id,s.created_at happened_at,s.subtotal::numeric debit,0::numeric credit,null::text payment_method,1 sort_order
    from public.ss_sales s where s.business_id=p_business_id and s.customer_id=p_customer_id
    union all
    select p.id,'sale.payment'::text,'Payment received for invoice #'||s.invoice_number::text,p.id,p.recorded_at,
      0::numeric,p.amount::numeric,p.method,2
    from public.ss_sale_payments p join public.ss_sales s on s.business_id=p.business_id and s.id=p.sale_id
    where p.business_id=p_business_id and s.customer_id=p_customer_id
    union all
    select r.id,'sale.return'::text,'Returned items on invoice #'||s.invoice_number::text,r.id,r.recorded_at,
      0::numeric,r.original_line_amount::numeric,null::text,3
    from public.ss_sale_returns r join public.ss_sales s on s.business_id=r.business_id and s.id=r.sale_id
    where r.business_id=p_business_id and s.customer_id=p_customer_id
    union all
    select c.id,'sale.refund'::text,'Cash refund for invoice #'||s.invoice_number::text,c.id,c.recorded_at,
      c.amount::numeric,0::numeric,c.method,4
    from public.ss_sale_return_cashbook_entries c join public.ss_sales s on s.business_id=c.business_id and s.id=c.sale_id
    where c.business_id=p_business_id and s.customer_id=p_customer_id
  ), opening as (
    select coalesce(sum(e.debit-e.credit),0)::numeric amount from raw_events e
    where p_from is not null and (e.happened_at at time zone 'Asia/Kolkata')::date<p_from
  ), filtered as (
    select e.* from raw_events e
    where (p_from is null or (e.happened_at at time zone 'Asia/Kolkata')::date>=p_from)
      and (p_through is null or (e.happened_at at time zone 'Asia/Kolkata')::date<=p_through)
  ), totals as (
    select count(*)::bigint total_count,coalesce(sum(e.debit),0)::numeric debits,coalesce(sum(e.credit),0)::numeric credits from filtered e
  ), sequenced as (
    select e.*,(o.amount+sum(e.debit-e.credit) over(order by e.happened_at,e.sort_order,e.event_id rows between unbounded preceding and current row))::numeric running_balance
    from filtered e cross join opening o
  ), page_opening as (
    select case when p_offset=0 then o.amount else coalesce((select q.running_balance from sequenced q order by q.happened_at,q.sort_order,q.event_id offset p_offset-1 limit 1),o.amount) end::numeric amount
    from opening o
  ), page_rows as (
    select jsonb_agg(jsonb_build_object('event_id',p.event_id,'event_type',p.event_type,'description',p.description,'entity_id',p.entity_id,
      'happened_at',p.happened_at,'debit',p.debit::text,'credit',p.credit::text,'payment_method',p.payment_method,'running_balance',p.running_balance::text)
      order by p.happened_at,p.sort_order,p.event_id) rows
    from (select * from sequenced order by happened_at,sort_order,event_id limit p_limit offset p_offset) p
  )
  select jsonb_build_object('totals',jsonb_build_object('opening_balance',o.amount::text,'debits',t.debits::text,'credits',t.credits::text,
      'closing_balance',(o.amount+t.debits-t.credits)::text),'page_opening_balance',po.amount::text,
      'rows',coalesce(pr.rows,'[]'::jsonb),'total_count',t.total_count)
    into result from opening o cross join totals t cross join page_opening po cross join page_rows pr;
  return result;
end
$function$;
revoke all on function public.ss_customer_ledger_page(uuid,uuid,date,date,integer,integer) from public,anon,authenticated;
grant execute on function public.ss_customer_ledger_page(uuid,uuid,date,date,integer,integer) to authenticated;
