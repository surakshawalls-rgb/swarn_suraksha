do $preflight$
begin
  if to_regclass('public.ss_customer_account_adjustments') is null
     or to_regclass('public.ss_metal_rate_snapshots') is null
     or to_regprocedure('public.ss_customer_ledger_page(uuid,uuid,date,date,integer,integer)') is null
     or to_regprocedure('public.has_business_role(uuid,text[])') is null then
    raise exception 'Customer adjustments, rate snapshots, ledger and authorization objects are required before 024_customer_outstanding_exchange';
  end if;
end
$preflight$;

do $constraints$
declare constraint_name text;
begin
  for constraint_name in
    select conname from pg_constraint
    where conrelid='public.ss_customer_account_adjustments'::regclass
      and contype='c'
      and (pg_get_constraintdef(oid) like '%entry_type%' or pg_get_constraintdef(oid) like '%exchange_posting_id%')
  loop
    execute format('alter table public.ss_customer_account_adjustments drop constraint %I',constraint_name);
  end loop;
  alter table public.ss_customer_account_adjustments
    add constraint ss_customer_account_adjustments_entry_type_check
      check (entry_type in ('advance_credit','exchange_refund','outstanding_payment','outstanding_exchange')),
    add constraint ss_customer_account_adjustments_transaction_check
      check (
        (entry_type='advance_credit' and sale_id is not null and exchange_posting_id is not null and method is null)
        or (entry_type='exchange_refund' and sale_id is not null and exchange_posting_id is not null and method is not null)
        or (entry_type='outstanding_payment' and sale_id is null and exchange_posting_id is null and method is not null)
        or (entry_type='outstanding_exchange' and sale_id is null and exchange_posting_id is null and method is null)
      );
end
$constraints$;

create table public.ss_customer_outstanding_exchange_postings (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.business_profiles(id) on delete restrict,
  customer_id uuid not null,
  customer_adjustment_id uuid not null unique references public.ss_customer_account_adjustments(id) on delete restrict,
  idempotency_key uuid not null,
  request_payload jsonb not null,
  exchange_total numeric(14,2) not null check (exchange_total>0),
  created_by uuid not null references auth.users(id),
  recorded_at timestamptz not null default now(),
  unique (business_id,customer_id,idempotency_key),
  foreign key (business_id,customer_id) references public.customers(business_id,id) on delete restrict
);

create table public.ss_customer_outstanding_exchanges (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.business_profiles(id) on delete restrict,
  customer_id uuid not null,
  posting_id uuid not null references public.ss_customer_outstanding_exchange_postings(id) on delete restrict,
  customer_adjustment_id uuid not null references public.ss_customer_account_adjustments(id) on delete restrict,
  item_number smallint not null check (item_number between 1 and 100),
  metal text not null check (metal in ('gold','silver')),
  purity text not null check (length(trim(purity)) between 1 and 40),
  description text not null check (length(trim(description)) between 1 and 180),
  net_weight_g numeric(14,4) not null check (net_weight_g>0),
  quality_deduction_percent numeric(5,2) not null check (quality_deduction_percent between 10 and 50),
  purity_factor numeric(8,6) not null check (purity_factor>0 and purity_factor<=1),
  accepted_weight_g numeric(14,4) not null check (accepted_weight_g>0),
  rate_snapshot_id uuid not null,
  applied_rate_per_gram numeric(14,4) not null check (applied_rate_per_gram>0),
  exchange_value numeric(14,2) not null check (exchange_value>0),
  received_at timestamptz not null default now(),
  created_by uuid not null references auth.users(id),
  unique (posting_id,item_number),
  foreign key (business_id,customer_id) references public.customers(business_id,id) on delete restrict,
  foreign key (business_id,rate_snapshot_id) references public.ss_metal_rate_snapshots(business_id,id) on delete restrict
);

create index ss_customer_outstanding_exchange_customer_idx
  on public.ss_customer_outstanding_exchange_postings(business_id,customer_id,recorded_at desc);
alter table public.ss_customer_outstanding_exchange_postings enable row level security;
alter table public.ss_customer_outstanding_exchanges enable row level security;
create policy ss_customer_outstanding_exchange_postings_read_member
  on public.ss_customer_outstanding_exchange_postings for select to authenticated
  using (public.is_business_member(business_id));
create policy ss_customer_outstanding_exchanges_read_member
  on public.ss_customer_outstanding_exchanges for select to authenticated
  using (public.is_business_member(business_id));
revoke all on public.ss_customer_outstanding_exchange_postings,public.ss_customer_outstanding_exchanges
  from public,anon,authenticated;
grant select on public.ss_customer_outstanding_exchange_postings,public.ss_customer_outstanding_exchanges
  to authenticated;

create or replace function public.ss_record_customer_outstanding_exchange(
  p_business_id uuid,p_customer_id uuid,p_idempotency_key uuid,p_items jsonb
) returns uuid
language plpgsql security definer set search_path=''
as $function$
declare
  actor uuid:=(select auth.uid());
  request jsonb;
  prior public.ss_customer_outstanding_exchange_postings%rowtype;
  ledger_result jsonb;
  outstanding numeric(14,2);
  exchange_total numeric(14,2):=0;
  weight numeric(14,4);
  accepted numeric(14,4);
  quality numeric(5,2);
  factor numeric(8,6);
  rate numeric(14,4);
  value numeric(14,2);
  item jsonb;
  item_no integer:=0;
  adjustment_id uuid;
  posting_id uuid;
  snapshot public.ss_metal_rate_snapshots%rowtype;
begin
  if actor is null then raise exception 'Authentication required' using errcode='42501'; end if;
  if p_business_id is null or p_customer_id is null
     or not public.has_business_role(p_business_id,array['owner','admin']) then
    raise exception 'Customer exchange settlement is not authorized for this business' using errcode='42501';
  end if;
  if p_idempotency_key is null or jsonb_typeof(p_items) is distinct from 'array'
     or jsonb_array_length(p_items) not between 1 and 100 then
    raise exception 'Exchange settlement requires an idempotency key and 1 to 100 items' using errcode='22023';
  end if;
  request:=jsonb_build_object('items',p_items);
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_business_id::text||':customer-ledger:'||p_customer_id::text,0));
  select * into prior from public.ss_customer_outstanding_exchange_postings
    where business_id=p_business_id and customer_id=p_customer_id and idempotency_key=p_idempotency_key;
  if found then
    if prior.request_payload is distinct from request then
      raise exception 'Idempotency key was already used for a different exchange settlement' using errcode='22023';
    end if;
    return prior.customer_adjustment_id;
  end if;
  perform 1 from public.customers where business_id=p_business_id and id=p_customer_id and is_active for update;
  if not found then raise exception 'Customer does not belong to this business or is archived' using errcode='23503'; end if;

  for item in select value from jsonb_array_elements(p_items) loop
    item_no:=item_no+1;
    weight:=(item->>'net_weight_g')::numeric;
    quality:=(item->>'quality_deduction_percent')::numeric;
    factor:=(item->>'purity_factor')::numeric;
    if item->>'metal' is null or item->>'metal' not in ('gold','silver') or nullif(trim(item->>'purity'),'') is null
       or nullif(trim(item->>'description'),'') is null or length(trim(item->>'description'))>180
       or item->>'rate_snapshot_id' is null or weight is null or weight<=0
       or quality is null or quality not between 10 and 50
       or factor is null or factor<=0 or factor>1
       or weight*10000<>trunc(weight*10000) or quality*100<>trunc(quality*100)
       or factor*1000000<>trunc(factor*1000000) then
      raise exception 'Exchange settlement item % has invalid metal, description, weight or deductions',item_no using errcode='22023';
    end if;
    if item->>'metal'='gold' and factor<>1 then
      raise exception 'Selected-purity gold must not apply purity twice' using errcode='22023';
    end if;
    if item->>'metal'='silver' and item->>'purity'='999' and abs(factor-0.999)>0.000001 then
      raise exception '999 silver purity factor is invalid' using errcode='22023';
    end if;
    if item->>'metal'='silver' and item->>'purity'='925' and abs(factor-0.925)>0.000001 then
      raise exception '925 silver purity factor is invalid' using errcode='22023';
    end if;
    if item->>'metal'='gold' and item->>'purity' not in ('24K','22K','20K','18K','16K') then
      raise exception 'Gold purity is not supported for customer outstanding exchange' using errcode='22023';
    end if;
    if item->>'metal'='silver' and item->>'purity' not in ('999','925','Custom') then
      raise exception 'Silver purity is not supported for customer outstanding exchange' using errcode='22023';
    end if;
    select * into snapshot from public.ss_metal_rate_snapshots
      where business_id=p_business_id and id=(item->>'rate_snapshot_id')::uuid and unit='gram'
        and metal=item->>'metal' and source_type='manual'
        and (item->>'metal'='silver' and purity is null
          or item->>'metal'='gold' and purity is not distinct from item->>'purity');
    if not found then raise exception 'Exchange settlement item % requires a matching saved gram-rate snapshot',item_no using errcode='22023'; end if;
    rate:=snapshot.shop_buy_rate;
    if rate is null or rate<=0 or rate is distinct from (item->>'applied_rate_per_gram')::numeric then
      raise exception 'Exchange settlement item % rate does not match its saved rate snapshot',item_no using errcode='22023';
    end if;
    accepted:=round(weight*factor*(1-quality/100),4);
    value:=round(accepted*rate,2);
    if accepted<=0 or value<=0 then raise exception 'Exchange settlement item % has no positive value',item_no using errcode='22023'; end if;
    exchange_total:=exchange_total+value;
  end loop;

  ledger_result:=public.ss_customer_ledger_page(p_business_id,p_customer_id,null,null,0,1);
  outstanding:=greatest(0,coalesce((ledger_result->'totals'->>'closing_balance')::numeric,0));
  if exchange_total>outstanding then
    raise exception 'Exchange value cannot exceed the customer outstanding balance' using errcode='22023';
  end if;
  insert into public.ss_customer_account_adjustments(
    business_id,customer_id,idempotency_key,entry_type,amount,actor_user_id
  ) values (p_business_id,p_customer_id,p_idempotency_key,'outstanding_exchange',exchange_total,actor)
  returning id into adjustment_id;
  insert into public.ss_customer_outstanding_exchange_postings(
    business_id,customer_id,customer_adjustment_id,idempotency_key,request_payload,exchange_total,created_by
  ) values (p_business_id,p_customer_id,adjustment_id,p_idempotency_key,request,exchange_total,actor)
  returning id into posting_id;

  item_no:=0;
  for item in select value from jsonb_array_elements(p_items) loop
    item_no:=item_no+1;
    weight:=(item->>'net_weight_g')::numeric;
    quality:=(item->>'quality_deduction_percent')::numeric;
    factor:=(item->>'purity_factor')::numeric;
    select * into snapshot from public.ss_metal_rate_snapshots
      where business_id=p_business_id and id=(item->>'rate_snapshot_id')::uuid;
    rate:=snapshot.shop_buy_rate;
    accepted:=round(weight*factor*(1-quality/100),4);
    value:=round(accepted*rate,2);
    insert into public.ss_customer_outstanding_exchanges(
      business_id,customer_id,posting_id,customer_adjustment_id,item_number,metal,purity,description,
      net_weight_g,quality_deduction_percent,purity_factor,accepted_weight_g,rate_snapshot_id,
      applied_rate_per_gram,exchange_value,created_by
    ) values (
      p_business_id,p_customer_id,posting_id,adjustment_id,item_no,item->>'metal',trim(item->>'purity'),
      trim(item->>'description'),weight,quality,factor,accepted,snapshot.id,rate,value,actor
    );
  end loop;
  return adjustment_id;
end
$function$;
revoke all on function public.ss_record_customer_outstanding_exchange(uuid,uuid,uuid,jsonb)
  from public,anon,authenticated;
grant execute on function public.ss_record_customer_outstanding_exchange(uuid,uuid,uuid,jsonb)
  to authenticated;

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
    select s.id,'sale.exchange'::text,'Old jewellery exchange for invoice #'||s.invoice_number::text,s.id,s.created_at,
      0::numeric,case when p.excess_action='refund' then coalesce(x.exchange_total,0)
        else least(s.subtotal,coalesce(x.exchange_total,0)) end::numeric,null::text,3
    from public.ss_sales s left join (
      select business_id,sale_id,sum(exchange_value)::numeric exchange_total
      from public.ss_sale_exchanges group by business_id,sale_id
    ) x on x.business_id=s.business_id and x.sale_id=s.id
    left join public.ss_sale_exchange_postings p on p.business_id=s.business_id and p.sale_id=s.id
    where s.business_id=p_business_id and s.customer_id=p_customer_id and coalesce(x.exchange_total,0)>0
    union all
    select a.id,'customer.advance'::text,'Customer advance credit for invoice #'||s.invoice_number::text,a.id,a.recorded_at,
      0::numeric,a.amount::numeric,null::text,4
    from public.ss_customer_account_adjustments a join public.ss_sales s on s.business_id=a.business_id and s.id=a.sale_id
    where a.business_id=p_business_id and a.customer_id=p_customer_id and a.entry_type='advance_credit'
    union all
    select a.id,'customer.payment'::text,'Payment against previous outstanding',a.id,a.recorded_at,
      0::numeric,a.amount::numeric,a.method,5
    from public.ss_customer_account_adjustments a
    where a.business_id=p_business_id and a.customer_id=p_customer_id and a.entry_type='outstanding_payment'
    union all
    select a.id,'customer.exchange_payment'::text,'Old jewellery exchanged against previous outstanding',a.id,a.recorded_at,
      0::numeric,a.amount::numeric,null::text,6
    from public.ss_customer_account_adjustments a
    where a.business_id=p_business_id and a.customer_id=p_customer_id and a.entry_type='outstanding_exchange'
    union all
    select a.id,'customer.exchange_refund'::text,'Excess exchange refunded for invoice #'||s.invoice_number::text,a.id,a.recorded_at,
      a.amount::numeric,0::numeric,a.method,7
    from public.ss_customer_account_adjustments a join public.ss_sales s on s.business_id=a.business_id and s.id=a.sale_id
    where a.business_id=p_business_id and a.customer_id=p_customer_id and a.entry_type='exchange_refund'
    union all
    select r.id,'sale.return'::text,'Returned items on invoice #'||s.invoice_number::text,r.id,r.recorded_at,
      0::numeric,r.original_line_amount::numeric,null::text,8
    from public.ss_sale_returns r join public.ss_sales s on s.business_id=r.business_id and s.id=r.sale_id
    where r.business_id=p_business_id and s.customer_id=p_customer_id
    union all
    select c.id,'sale.refund'::text,'Cash refund for invoice #'||s.invoice_number::text,c.id,c.recorded_at,
      c.amount::numeric,0::numeric,c.method,9
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
