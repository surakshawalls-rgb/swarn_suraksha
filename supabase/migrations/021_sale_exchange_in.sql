-- Old jewellery received during a new sale is a distinct, append-only exchange-in
-- record. It is not a sales return and never creates an inventory movement.
do $preflight$
declare
  missing text[] := array[]::text[];
begin
  if to_regclass('public.ss_sales') is null then missing:=array_append(missing,'table public.ss_sales'); end if;
  if to_regclass('public.ss_sale_lines') is null then missing:=array_append(missing,'table public.ss_sale_lines'); end if;
  if to_regclass('public.ss_sale_payments') is null then missing:=array_append(missing,'table public.ss_sale_payments'); end if;
  if to_regclass('public.ss_sale_returns') is null then missing:=array_append(missing,'table public.ss_sale_returns'); end if;
  if to_regclass('public.ss_sale_return_cashbook_entries') is null then missing:=array_append(missing,'table public.ss_sale_return_cashbook_entries'); end if;
  if to_regclass('public.ss_sale_cashbook_entries') is null then missing:=array_append(missing,'table public.ss_sale_cashbook_entries'); end if;
  if to_regclass('public.ss_sale_audit_events') is null then missing:=array_append(missing,'table public.ss_sale_audit_events'); end if;
  if to_regclass('public.ss_metal_rate_snapshots') is null then missing:=array_append(missing,'table public.ss_metal_rate_snapshots'); end if;
  if to_regprocedure('public.ss_cashbook_page(uuid,timestamptz,timestamptz,integer,integer)') is null then
    missing:=array_append(missing,'function public.ss_cashbook_page(uuid,timestamptz,timestamptz,integer,integer)');
  end if;
  if to_regprocedure('public.ss_post_sale(uuid,uuid,uuid,jsonb,jsonb)') is null then
    missing:=array_append(missing,'function public.ss_post_sale(uuid,uuid,uuid,jsonb,jsonb)');
  end if;
  if to_regprocedure('public.ss_customer_ledger_page(uuid,uuid,date,date,integer,integer)') is null then
    missing:=array_append(missing,'function public.ss_customer_ledger_page(uuid,uuid,date,date,integer,integer)');
  end if;
  if to_regprocedure('public.has_business_role(uuid,text[])') is null then
    missing:=array_append(missing,'function public.has_business_role(uuid,text[])');
  end if;
  if to_regprocedure('public.is_business_member(uuid)') is null then
    missing:=array_append(missing,'function public.is_business_member(uuid)');
  end if;
  if cardinality(missing)>0 then
    raise exception 'Missing prerequisite objects for 021_sale_exchange_in: %',array_to_string(missing,', ');
  end if;
  perform public.has_business_role(null::uuid,array[]::text[]);
end
$preflight$;

create table public.ss_sale_exchange_postings (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.business_profiles(id) on delete restrict,
  sale_id uuid not null,
  idempotency_key uuid not null,
  request_payload jsonb not null,
  exchange_total numeric(14,2) not null check (exchange_total >= 0),
  previous_outstanding numeric(14,2) not null default 0 check (previous_outstanding >= 0),
  customer_advance_credit numeric(14,2) not null default 0 check (customer_advance_credit >= 0),
  total_payable numeric(14,2) not null default 0 check (total_payable >= 0),
  excess_action text not null check (excess_action in ('none','refund','advance_credit')),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  unique (business_id,idempotency_key),
  unique (business_id,sale_id),
  foreign key (business_id,sale_id) references public.ss_sales(business_id,id) on delete restrict
);

create table public.ss_sale_exchanges (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.business_profiles(id) on delete restrict,
  sale_id uuid not null,
  customer_id uuid not null,
  exchange_number smallint not null check (exchange_number between 1 and 100),
  metal text not null check (metal in ('gold','silver')),
  purity text not null check (length(trim(purity)) between 1 and 40),
  description text not null check (length(trim(description)) between 1 and 180),
  gross_weight_g numeric(14,4) not null check (gross_weight_g > 0),
  non_metal_deduction_g numeric(14,4) not null check (non_metal_deduction_g >= 0),
  net_weight_g numeric(14,4) not null check (net_weight_g > 0),
  quality_deduction_percent numeric(5,2) not null check (quality_deduction_percent between 0 and 50),
  purity_factor numeric(8,6) not null check (purity_factor > 0 and purity_factor <= 1),
  accepted_weight_g numeric(14,4) not null check (accepted_weight_g > 0),
  rate_snapshot_id uuid not null,
  rate_source text not null check (rate_source in ('reference','shop_buy','manual')),
  reference_rate_per_gram numeric(14,4) not null check (reference_rate_per_gram > 0),
  applied_rate_per_gram numeric(14,4) not null check (applied_rate_per_gram > 0),
  valuation_mode text not null check (valuation_mode in ('selected_purity','24k_equivalent')),
  calculated_exchange_value numeric(14,2) not null check (calculated_exchange_value > 0),
  exchange_value numeric(14,2) not null check (exchange_value > 0),
  manual_override_reason text,
  received_at timestamptz not null default now(),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  unique (sale_id,exchange_number),
  foreign key (business_id,sale_id) references public.ss_sales(business_id,id) on delete restrict,
  foreign key (business_id,customer_id) references public.customers(business_id,id) on delete restrict,
  foreign key (business_id,rate_snapshot_id) references public.ss_metal_rate_snapshots(business_id,id) on delete restrict,
  check (gross_weight_g - non_metal_deduction_g = net_weight_g),
  check (manual_override_reason is null or length(trim(manual_override_reason)) between 5 and 1000),
  check (exchange_value = calculated_exchange_value or manual_override_reason is not null),
  check (rate_source <> 'manual' or manual_override_reason is not null),
  check (metal <> 'gold' or valuation_mode <> '24k_equivalent' or purity ~ '^[0-9]+([.][0-9]+)?K$')
);

create table public.ss_customer_account_adjustments (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.business_profiles(id) on delete restrict,
  customer_id uuid not null,
  sale_id uuid,
  exchange_posting_id uuid unique references public.ss_sale_exchange_postings(id) on delete restrict,
  idempotency_key uuid not null,
  entry_type text not null check (entry_type in ('advance_credit','exchange_refund','outstanding_payment')),
  amount numeric(14,2) not null check (amount > 0),
  method text check (method in ('cash','upi','bank_transfer','card')),
  reference text check (reference is null or length(reference) <= 120),
  actor_user_id uuid not null references auth.users(id),
  recorded_at timestamptz not null default now(),
  foreign key (business_id,customer_id) references public.customers(business_id,id) on delete restrict,
  foreign key (business_id,sale_id) references public.ss_sales(business_id,id) on delete restrict,
  unique (business_id,customer_id,idempotency_key),
  check ((entry_type='advance_credit' and sale_id is not null and exchange_posting_id is not null and method is null)
      or (entry_type='exchange_refund' and sale_id is not null and exchange_posting_id is not null and method is not null)
      or (entry_type='outstanding_payment' and sale_id is null and exchange_posting_id is null and method is not null))
);

create table public.ss_sale_exchange_cashbook_entries (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.business_profiles(id) on delete restrict,
  sale_id uuid not null,
  exchange_posting_id uuid not null unique references public.ss_sale_exchange_postings(id) on delete restrict,
  direction text not null default 'out' check (direction='out'),
  amount numeric(14,2) not null check (amount > 0),
  method text not null check (method in ('cash','upi','bank_transfer','card')),
  actor_user_id uuid not null references auth.users(id),
  recorded_at timestamptz not null default now(),
  foreign key (business_id,sale_id) references public.ss_sales(business_id,id) on delete restrict
);

create table public.ss_sale_exchange_audit_events (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.business_profiles(id) on delete restrict,
  sale_id uuid not null,
  exchange_id uuid,
  actor_user_id uuid not null references auth.users(id),
  event_type text not null check (event_type in ('sale.exchange_received','customer.advance_credit.created','sale.exchange_refunded')),
  safe_metadata jsonb not null default '{}'::jsonb,
  recorded_at timestamptz not null default now(),
  foreign key (business_id,sale_id) references public.ss_sales(business_id,id) on delete restrict,
  foreign key (exchange_id) references public.ss_sale_exchanges(id) on delete restrict
);
create table public.ss_customer_account_cashbook_entries (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.business_profiles(id) on delete restrict,
  customer_adjustment_id uuid not null unique references public.ss_customer_account_adjustments(id) on delete restrict,
  direction text not null default 'in' check (direction='in'),
  amount numeric(14,2) not null check (amount > 0),
  method text not null check (method in ('cash','upi','bank_transfer','card')),
  actor_user_id uuid not null references auth.users(id),
  recorded_at timestamptz not null default now()
);
create index ss_sale_exchanges_sale_idx on public.ss_sale_exchanges(business_id,sale_id,exchange_number);
create index ss_customer_account_adjustments_customer_idx on public.ss_customer_account_adjustments(business_id,customer_id,recorded_at desc);
alter table public.ss_sale_exchange_postings enable row level security;
alter table public.ss_sale_exchanges enable row level security;
alter table public.ss_customer_account_adjustments enable row level security;
alter table public.ss_sale_exchange_cashbook_entries enable row level security;
alter table public.ss_sale_exchange_audit_events enable row level security;
alter table public.ss_customer_account_cashbook_entries enable row level security;

create policy ss_sale_exchange_postings_read_member on public.ss_sale_exchange_postings
  for select to authenticated using (public.is_business_member(business_id));
create policy ss_sale_exchanges_read_member on public.ss_sale_exchanges
  for select to authenticated using (public.is_business_member(business_id));
create policy ss_customer_account_adjustments_read_member on public.ss_customer_account_adjustments
  for select to authenticated using (public.is_business_member(business_id));
create policy ss_sale_exchange_cashbook_read_member on public.ss_sale_exchange_cashbook_entries
  for select to authenticated using (public.is_business_member(business_id));
create policy ss_sale_exchange_audit_read_admin on public.ss_sale_exchange_audit_events
  for select to authenticated using (public.has_business_role(business_id,array['owner','admin']));
create policy ss_customer_account_cashbook_read_member on public.ss_customer_account_cashbook_entries
  for select to authenticated using (public.is_business_member(business_id));
revoke all on public.ss_sale_exchange_postings,public.ss_sale_exchanges,
  public.ss_customer_account_adjustments,public.ss_sale_exchange_cashbook_entries,public.ss_sale_exchange_audit_events,
  public.ss_customer_account_cashbook_entries
  from public,anon,authenticated;
grant select on public.ss_sale_exchange_postings,public.ss_sale_exchanges,
  public.ss_customer_account_adjustments,public.ss_sale_exchange_cashbook_entries,public.ss_sale_exchange_audit_events,
  public.ss_customer_account_cashbook_entries to authenticated;

create or replace function public.ss_post_sale_with_exchange(
  p_business_id uuid,
  p_customer_id uuid,
  p_idempotency_key uuid,
  p_lines jsonb,
  p_exchanges jsonb,
  p_payments jsonb,
  p_excess_action text default 'none',
  p_excess_refund_method text default null
) returns uuid
language plpgsql security definer set search_path=''
as $function$
declare
  actor uuid := (select auth.uid());
  request jsonb;
  prior_payload jsonb;
  sale_id uuid;
  sale_total numeric(14,2);
  previous_balance numeric(14,2) := 0;
  previous_due numeric(14,2) := 0;
  available_advance numeric(14,2) := 0;
  total_payable numeric(14,2);
  ledger_result jsonb;
  exchange_total numeric(14,2) := 0;
  net_weight numeric(14,4);
  accepted_weight numeric(14,4);
  factor numeric(8,6);
  factor_input numeric;
  quality numeric(5,2);
  quality_input numeric;
  reference_rate numeric(14,4);
  applied_rate numeric(14,4);
  calculated_value numeric(14,2);
  final_value numeric(14,2);
  override_value numeric(14,2);
  override_input numeric;
  override_reason text;
  source text;
  mode text;
  selected_purity text;
  snapshot public.ss_metal_rate_snapshots%rowtype;
  item jsonb;
  item_no integer := 0;
  posting_id uuid;
  exchange_id uuid;
  excess numeric(14,2);
begin
  if actor is null then raise exception 'Authentication required' using errcode='42501'; end if;
  if not public.has_business_role(p_business_id,array['owner','admin']) then
    raise exception 'Not authorized to post sales for this business' using errcode='42501';
  end if;
  if p_idempotency_key is null or p_excess_action is null or jsonb_typeof(p_exchanges) is distinct from 'array'
     or jsonb_array_length(p_exchanges)>100 or p_excess_action not in ('none','refund','advance_credit') then
    raise exception 'Exchange details, idempotency key, or excess handling choice is invalid' using errcode='22023';
  end if;
  request:=jsonb_build_object('customer_id',p_customer_id,'lines',p_lines,'exchanges',p_exchanges,
    'payments',p_payments,'excess_action',p_excess_action,'excess_refund_method',p_excess_refund_method);
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_business_id::text||':'||p_idempotency_key::text,0));
  select posting.sale_id,posting.request_payload into sale_id,prior_payload from public.ss_sale_exchange_postings posting
    where posting.business_id=p_business_id and posting.idempotency_key=p_idempotency_key;
  if sale_id is not null then
    if prior_payload<>request then raise exception 'Idempotency key was already used for a different invoice or exchange' using errcode='22023'; end if;
    return sale_id;
  end if;
  if jsonb_array_length(p_exchanges)>0 and p_customer_id is null then
    raise exception 'A customer is required when receiving old jewellery' using errcode='22023';
  end if;
  if p_customer_id is not null then
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_business_id::text||':customer-ledger:'||p_customer_id::text,0));
    ledger_result:=public.ss_customer_ledger_page(p_business_id,p_customer_id,null,null,0,1);
    previous_balance:=coalesce((ledger_result->'totals'->>'closing_balance')::numeric,0);
    previous_due:=greatest(0,previous_balance);
    available_advance:=greatest(0,-previous_balance);
  end if;

  -- The existing stock-free sale RPC and all exchange writes share this transaction.
  sale_id:=public.ss_post_sale(p_business_id,p_customer_id,p_idempotency_key,p_lines,p_payments);
  select subtotal into sale_total from public.ss_sales where business_id=p_business_id and id=sale_id;

  for item in select value from jsonb_array_elements(p_exchanges) loop
    item_no:=item_no+1;
    selected_purity:=nullif(trim(item->>'purity'),'');
    mode:=item->>'valuation_mode';
    source:=item->>'rate_source';
    quality_input:=(item->>'quality_deduction_percent')::numeric;
    quality:=quality_input;
    factor_input:=(item->>'purity_factor')::numeric;
    factor:=factor_input;
    net_weight:=((item->>'gross_weight_g')::numeric-(coalesce((item->>'non_metal_deduction_g')::numeric,0)));
    if item->>'metal' is null or item->>'metal' not in ('gold','silver') or selected_purity is null
       or nullif(trim(item->>'description'),'') is null or length(trim(item->>'description'))>180
       or item->>'gross_weight_g' is null or item->>'quality_deduction_percent' is null
       or item->>'purity_factor' is null or item->>'applied_rate_per_gram' is null or mode is null or source is null
       or (item->>'gross_weight_g')::numeric<=0 or net_weight<=0 or quality is null or quality not between 0 and 50
       or factor is null or factor<=0 or factor>1 or mode not in ('selected_purity','24k_equivalent')
       or source not in ('reference','shop_buy','manual') then
      raise exception 'Exchange item % has invalid jewellery, weight or valuation details',item_no using errcode='22023';
    end if;
    if (item->>'gross_weight_g')::numeric*10000<>trunc((item->>'gross_weight_g')::numeric*10000)
       or coalesce((item->>'non_metal_deduction_g')::numeric,0)*10000<>trunc(coalesce((item->>'non_metal_deduction_g')::numeric,0)*10000)
       or quality_input*100<>trunc(quality_input*100) or factor_input*1000000<>trunc(factor_input*1000000)
       or (item->>'applied_rate_per_gram')::numeric*10000<>trunc((item->>'applied_rate_per_gram')::numeric*10000) then
      raise exception 'Exchange item % exceeds supported weight, rate or percentage precision',item_no using errcode='22023';
    end if;
    if item->>'metal'='gold' and mode='24k_equivalent' then
      if selected_purity !~ '^[0-9]+([.][0-9]+)?K$'
         or replace(selected_purity,'K','')::numeric not between 1 and 24 then
        raise exception '24K-equivalent valuation requires a supported K purity from 1K to 24K' using errcode='22023';
      end if;
      if abs(factor-(replace(selected_purity,'K','')::numeric/24))>0.000001 then
        raise exception 'Gold purity factor does not match the selected purity' using errcode='22023';
      end if;
    elsif item->>'metal'='gold' and factor<>1 then
      raise exception 'Selected-purity gold valuation must not apply purity twice' using errcode='22023';
    end if;
    if item->>'metal'='silver' and mode='24k_equivalent' then
      raise exception '24K-equivalent valuation only applies to gold' using errcode='22023';
    end if;

    select * into snapshot from public.ss_metal_rate_snapshots
      where business_id=p_business_id and id=(item->>'rate_snapshot_id')::uuid and unit='gram'
        and metal=item->>'metal'
        and (item->>'metal'='silver' or purity is not distinct from
          case when mode='24k_equivalent' then '24K' else selected_purity end);
    if not found then raise exception 'Exchange item % needs a matching saved gram-rate snapshot',item_no using errcode='22023'; end if;
    reference_rate:=snapshot.reference_rate;
    applied_rate:=case source when 'reference' then snapshot.reference_rate when 'shop_buy' then snapshot.shop_buy_rate
      else (item->>'applied_rate_per_gram')::numeric end;
    if source<>'manual' and applied_rate is distinct from (item->>'applied_rate_per_gram')::numeric then
      raise exception 'Exchange item % rate does not match its saved rate snapshot',item_no using errcode='22023';
    end if;
    override_reason:=nullif(trim(item->>'manual_override_reason'),'');
    if (source='manual' or nullif(item->>'manual_exchange_value','') is not null)
       and length(coalesce(override_reason,''))<5 then
      raise exception 'Manual rate or exchange amount override requires a reason of at least 5 characters' using errcode='22023';
    end if;
    net_weight:=round(net_weight,4);
    accepted_weight:=round(net_weight*factor*(1-quality/100),4);
    calculated_value:=round(accepted_weight*applied_rate,2);
    override_input:=nullif(item->>'manual_exchange_value','')::numeric;
    if override_input is not null and override_input*100<>trunc(override_input*100) then
      raise exception 'Manual exchange value must have at most 2 decimal places' using errcode='22023';
    end if;
    override_value:=override_input;
    final_value:=coalesce(override_value,calculated_value);
    if accepted_weight<=0 or applied_rate<=0 or final_value<=0 or final_value*100<>trunc(final_value*100) then
      raise exception 'Exchange item % valuation is invalid',item_no using errcode='22023';
    end if;
    exchange_total:=exchange_total+final_value;
    insert into public.ss_sale_exchanges(
      business_id,sale_id,customer_id,exchange_number,metal,purity,description,gross_weight_g,
      non_metal_deduction_g,net_weight_g,quality_deduction_percent,purity_factor,accepted_weight_g,
      rate_snapshot_id,rate_source,reference_rate_per_gram,applied_rate_per_gram,valuation_mode,
      calculated_exchange_value,exchange_value,manual_override_reason,created_by
    ) values (
      p_business_id,sale_id,p_customer_id,item_no,item->>'metal',selected_purity,trim(item->>'description'),
      (item->>'gross_weight_g')::numeric,coalesce((item->>'non_metal_deduction_g')::numeric,0),net_weight,
      quality,factor,accepted_weight,snapshot.id,source,reference_rate,applied_rate,mode,
      calculated_value,final_value,override_reason,actor
    ) returning id into exchange_id;
    insert into public.ss_sale_exchange_audit_events(
      business_id,sale_id,exchange_id,actor_user_id,event_type,safe_metadata
    ) values (
      p_business_id,sale_id,exchange_id,actor,'sale.exchange_received',
      jsonb_build_object('exchange_number',item_no,'metal',item->>'metal','gross_weight_g',(item->>'gross_weight_g')::numeric,
        'accepted_weight_g',accepted_weight,'exchange_value',final_value,'rate_source',source)
    );
  end loop;

  excess:=greatest(0,exchange_total-sale_total);
  if excess>0 and (p_excess_action='none' or p_customer_id is null) then
    raise exception 'Exchange value exceeds the new bill. Choose refund or customer advance credit.' using errcode='22023';
  end if;
  if excess>0 and p_excess_action='refund' and
     (p_excess_refund_method is null or p_excess_refund_method not in ('cash','upi','bank_transfer','card')) then
    raise exception 'Choose a valid method to refund the excess exchange amount' using errcode='22023';
  end if;
  if excess=0 and p_excess_action<>'none' then
    raise exception 'An excess handling choice is only valid when exchange value exceeds the bill' using errcode='22023';
  end if;
  total_payable:=greatest(0,greatest(0,sale_total-exchange_total)+previous_due-available_advance);
  insert into public.ss_sale_exchange_postings(
    business_id,sale_id,idempotency_key,request_payload,exchange_total,previous_outstanding,
    customer_advance_credit,total_payable,excess_action,created_by
  ) values (p_business_id,sale_id,p_idempotency_key,request,exchange_total,previous_due,
    available_advance,total_payable,p_excess_action,actor)
  returning id into posting_id;
  if excess>0 then
    insert into public.ss_customer_account_adjustments(
      business_id,customer_id,sale_id,exchange_posting_id,idempotency_key,entry_type,amount,method,actor_user_id
    ) values (
      p_business_id,p_customer_id,sale_id,posting_id,p_idempotency_key,
      case p_excess_action when 'refund' then 'exchange_refund' else 'advance_credit' end,
      excess,case when p_excess_action='refund' then p_excess_refund_method else null end,actor
    );
    if p_excess_action='refund' then
      insert into public.ss_sale_exchange_cashbook_entries(
        business_id,sale_id,exchange_posting_id,amount,method,actor_user_id
      ) values (p_business_id,sale_id,posting_id,excess,p_excess_refund_method,actor);
    end if;
    insert into public.ss_sale_exchange_audit_events(
      business_id,sale_id,actor_user_id,event_type,safe_metadata
    ) values (
      p_business_id,sale_id,actor,
      case p_excess_action when 'refund' then 'sale.exchange_refunded' else 'customer.advance_credit.created' end,
      jsonb_build_object('amount',excess,'method',case when p_excess_action='refund' then p_excess_refund_method else null end)
    );
  end if;
  return sale_id;
end
$function$;

revoke all on function public.ss_post_sale_with_exchange(uuid,uuid,uuid,jsonb,jsonb,jsonb,text,text)
  from public,anon,authenticated;
grant execute on function public.ss_post_sale_with_exchange(uuid,uuid,uuid,jsonb,jsonb,jsonb,text,text)
  to authenticated;

create or replace function public.ss_record_customer_outstanding_payment(
  p_business_id uuid,p_customer_id uuid,p_idempotency_key uuid,p_amount numeric,p_method text,p_reference text default null
) returns uuid
language plpgsql security definer set search_path=''
as $function$
declare
  actor uuid:=(select auth.uid());
  ledger_result jsonb;
  outstanding numeric(14,2);
  adjustment_id uuid;
  prior public.ss_customer_account_adjustments%rowtype;
  normalized_reference text:=nullif(trim(p_reference),'');
begin
  if actor is null then raise exception 'Authentication required' using errcode='42501'; end if;
  if p_business_id is null or p_customer_id is null
     or not public.has_business_role(p_business_id,array['owner','admin']) then
    raise exception 'Customer payment is not authorized for this business' using errcode='42501';
  end if;
  if p_idempotency_key is null or p_amount is null or p_amount<=0 or p_amount>999999999999.99
     or p_amount*100<>trunc(p_amount*100) or p_method not in ('cash','upi','bank_transfer','card')
     or length(coalesce(p_reference,''))>120 then
    raise exception 'Payment amount, method, reference, or idempotency key is invalid' using errcode='22023';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_business_id::text||':customer-ledger:'||p_customer_id::text,0));
  select * into prior from public.ss_customer_account_adjustments
    where business_id=p_business_id and customer_id=p_customer_id and idempotency_key=p_idempotency_key;
  if found then
    if prior.entry_type<>'outstanding_payment' or prior.amount<>p_amount or prior.method<>p_method
       or prior.reference is distinct from normalized_reference then
      raise exception 'Idempotency key was already used for a different customer transaction' using errcode='22023';
    end if;
    return prior.id;
  end if;
  perform 1 from public.customers where business_id=p_business_id and id=p_customer_id and is_active for update;
  if not found then raise exception 'Customer does not belong to this business or is archived' using errcode='23503'; end if;
  ledger_result:=public.ss_customer_ledger_page(p_business_id,p_customer_id,null,null,0,1);
  outstanding:=greatest(0,coalesce((ledger_result->'totals'->>'closing_balance')::numeric,0));
  if p_amount>outstanding then raise exception 'Payment exceeds the customer outstanding balance' using errcode='22023'; end if;
  insert into public.ss_customer_account_adjustments(
    business_id,customer_id,idempotency_key,entry_type,amount,method,reference,actor_user_id
  ) values (p_business_id,p_customer_id,p_idempotency_key,'outstanding_payment',p_amount,p_method,normalized_reference,actor)
  returning id into adjustment_id;
  insert into public.ss_customer_account_cashbook_entries(
    business_id,customer_adjustment_id,amount,method,actor_user_id
  ) values (p_business_id,adjustment_id,p_amount,p_method,actor);
  return adjustment_id;
end
$function$;
revoke all on function public.ss_record_customer_outstanding_payment(uuid,uuid,uuid,numeric,text,text)
  from public,anon,authenticated;
grant execute on function public.ss_record_customer_outstanding_payment(uuid,uuid,uuid,numeric,text,text)
  to authenticated;

create or replace function public.ss_record_sale_payment(
  p_sale_id uuid,p_idempotency_key uuid,p_amount numeric,p_method text,p_reference text default null
) returns uuid
language plpgsql security definer set search_path=''
as $function$
declare
  actor uuid := (select auth.uid());
  biz uuid; old_paid numeric(14,2); total numeric(14,2); payment_id uuid;
  exchange_total numeric(14,2); return_reduction numeric(14,2); remaining numeric(14,2);
  prior_amount numeric(14,2); prior_method text; prior_reference text; normalized_reference text;
begin
  if actor is null then raise exception 'Authentication required' using errcode='42501'; end if;
  if p_idempotency_key is null or p_amount is null or p_amount<=0 or p_amount*100<>trunc(p_amount*100)
     or p_method is null or p_method not in ('cash','upi','bank_transfer','card') or length(coalesce(p_reference,''))>120 then
    raise exception 'Payment amount, method, reference, or idempotency key is invalid' using errcode='22023';
  end if;
  select business_id,paid_total,subtotal into biz,old_paid,total
    from public.ss_sales where id=p_sale_id for update;
  if biz is null or not public.has_business_role(biz,array['owner','admin']) then
    raise exception 'Sale is missing or payment is not authorized' using errcode='42501';
  end if;
  normalized_reference:=nullif(trim(p_reference),'');
  select id,amount,method,reference into payment_id,prior_amount,prior_method,prior_reference
    from public.ss_sale_payments where sale_id=p_sale_id and idempotency_key=p_idempotency_key;
  if payment_id is not null then
    if prior_amount<>p_amount or prior_method<>p_method or prior_reference is distinct from normalized_reference then
      raise exception 'Idempotency key was already used for a different payment' using errcode='22023';
    end if;
    return payment_id;
  end if;
  select coalesce(sum(exchange_value),0) into exchange_total
    from public.ss_sale_exchanges where business_id=biz and sale_id=p_sale_id;
  select coalesce(sum(balance_reduction),0) into return_reduction
    from public.ss_sale_returns where business_id=biz and sale_id=p_sale_id;
  remaining:=greatest(0,total-old_paid-exchange_total-return_reduction);
  if p_amount>remaining then raise exception 'Payment exceeds the remaining bill balance' using errcode='22023'; end if;
  insert into public.ss_sale_payments (business_id,sale_id,method,amount,reference,received_by,idempotency_key)
    values (biz,p_sale_id,p_method,p_amount,normalized_reference,actor,p_idempotency_key) returning id into payment_id;
  update public.ss_sales set paid_total=paid_total+p_amount where id=p_sale_id;
  insert into public.ss_sale_cashbook_entries (business_id,sale_id,sale_payment_id,amount,method,actor_user_id)
    values (biz,p_sale_id,payment_id,p_amount,p_method,actor);
  insert into public.ss_payment_audit_events (business_id,event_type,sale_id,payment_id,actor_user_id,safe_metadata)
    values (biz,'sale_payment.recorded',p_sale_id,payment_id,actor,jsonb_build_object('amount',p_amount,'method',p_method));
  return payment_id;
end
$function$;
revoke all on function public.ss_record_sale_payment(uuid,uuid,numeric,text,text) from public,anon,authenticated;
grant execute on function public.ss_record_sale_payment(uuid,uuid,numeric,text,text) to authenticated;

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
    select a.id,'customer.exchange_refund'::text,'Excess exchange refunded for invoice #'||s.invoice_number::text,a.id,a.recorded_at,
      a.amount::numeric,0::numeric,a.method,6
    from public.ss_customer_account_adjustments a join public.ss_sales s on s.business_id=a.business_id and s.id=a.sale_id
    where a.business_id=p_business_id and a.customer_id=p_customer_id and a.entry_type='exchange_refund'
    union all
    select r.id,'sale.return'::text,'Returned items on invoice #'||s.invoice_number::text,r.id,r.recorded_at,
      0::numeric,r.original_line_amount::numeric,null::text,7
    from public.ss_sale_returns r join public.ss_sales s on s.business_id=r.business_id and s.id=r.sale_id
    where r.business_id=p_business_id and s.customer_id=p_customer_id
    union all
    select c.id,'sale.refund'::text,'Cash refund for invoice #'||s.invoice_number::text,c.id,c.recorded_at,
      c.amount::numeric,0::numeric,c.method,8
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

create or replace function public.ss_cashbook_page(
  p_business_id uuid,p_from timestamptz default null,p_through timestamptz default null,
  p_offset integer default 0,p_limit integer default 200
) returns table(
  id uuid,payment_id uuid,source text,direction text,amount numeric,method text,recorded_at timestamptz,total_count bigint
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
    union all
    select e.id,e.exchange_posting_id,'Old jewellery exchange refund'::text,'out'::text,e.amount,e.method,e.recorded_at
    from public.ss_sale_exchange_cashbook_entries e
    where e.business_id=p_business_id and (p_from is null or e.recorded_at>=p_from) and (p_through is null or e.recorded_at<=p_through)
    union all
    select e.id,e.customer_adjustment_id,'Customer outstanding payment'::text,'in'::text,e.amount,e.method,e.recorded_at
    from public.ss_customer_account_cashbook_entries e
    where e.business_id=p_business_id and (p_from is null or e.recorded_at>=p_from) and (p_through is null or e.recorded_at<=p_through)
  )
  select e.id,e.payment_id,e.source,e.direction,e.amount,e.method,e.recorded_at,count(*) over()::bigint
  from entries e order by e.recorded_at desc,e.id desc limit p_limit offset p_offset;
end
$function$;
revoke all on function public.ss_cashbook_page(uuid,timestamptz,timestamptz,integer,integer) from public,anon,authenticated;
grant execute on function public.ss_cashbook_page(uuid,timestamptz,timestamptz,integer,integer) to authenticated;
