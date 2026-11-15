do $preflight$
declare
  missing text[]:=array[]::text[];
begin
  if to_regclass('public.ss_girvi') is null then missing:=array_append(missing,'table public.ss_girvi (migration 020)'); end if;
  if to_regclass('public.ss_girvi_payments') is null then missing:=array_append(missing,'table public.ss_girvi_payments (migration 020)'); end if;
  if to_regclass('public.ss_girvi_audit_events') is null then missing:=array_append(missing,'table public.ss_girvi_audit_events (migration 020)'); end if;
  if to_regclass('public.ss_expense_cashbook_entries') is null then missing:=array_append(missing,'table public.ss_expense_cashbook_entries (migration 014)'); end if;
  if to_regclass('public.ss_sales') is null then missing:=array_append(missing,'table public.ss_sales (migration 007)'); end if;
  if to_regclass('public.ss_sale_returns') is null then missing:=array_append(missing,'table public.ss_sale_returns (migration 012)'); end if;
  if to_regclass('public.ss_purchases') is null then missing:=array_append(missing,'table public.ss_purchases (migration 006)'); end if;
  if to_regclass('public.ss_expenses') is null then missing:=array_append(missing,'table public.ss_expenses (migration 014)'); end if;
  if to_regclass('public.ss_sale_cashbook_entries') is null then missing:=array_append(missing,'table public.ss_sale_cashbook_entries (migration 007)'); end if;
  if to_regclass('public.ss_sale_return_cashbook_entries') is null then missing:=array_append(missing,'table public.ss_sale_return_cashbook_entries (migration 012)'); end if;
  if to_regclass('public.ss_cashbook_entries') is null then missing:=array_append(missing,'table public.ss_cashbook_entries (migration 006)'); end if;
  if to_regclass('public.ss_inventory_movements') is null then missing:=array_append(missing,'table public.ss_inventory_movements (migration 006)'); end if;
  if to_regclass('public.ss_sale_inventory_movements') is null then missing:=array_append(missing,'table public.ss_sale_inventory_movements (migration 007)'); end if;
  if to_regclass('public.ss_sale_return_inventory_movements') is null then missing:=array_append(missing,'table public.ss_sale_return_inventory_movements (migration 012)'); end if;
  if to_regclass('public.customers') is null then missing:=array_append(missing,'table public.customers (migration 001)'); end if;
  if to_regprocedure('public.has_business_role(uuid,text[])') is null then missing:=array_append(missing,'function public.has_business_role(uuid,text[]) (migration 001)'); end if;
  if to_regprocedure('public.is_business_member(uuid)') is null then missing:=array_append(missing,'function public.is_business_member(uuid) (migration 001)'); end if;
  if to_regprocedure('public.ss_cashbook_page(uuid,timestamptz,timestamptz,integer,integer)') is null then missing:=array_append(missing,'function public.ss_cashbook_page(uuid,timestamptz,timestamptz,integer,integer) (migration 013/014)'); end if;
  if cardinality(missing)>0 then
    raise exception 'Missing prerequisite objects for 025_girvi_multi_item_agreements: %',array_to_string(missing,', ');
  end if;
end
$preflight$;

alter table public.ss_girvi
  add column if not exists maturity_date date,
  add column if not exists customer_name_snapshot text,
  add column if not exists customer_phone_snapshot text,
  add column if not exists customer_address_snapshot text;
update public.ss_girvi set maturity_date=girvi_date+30 where maturity_date is null;
alter table public.ss_girvi alter column maturity_date set not null;
alter table public.ss_girvi alter column maturity_date set default (current_date+30);
update public.ss_girvi g set customer_name_snapshot=coalesce(g.customer_name_snapshot,c.full_name),
  customer_phone_snapshot=coalesce(g.customer_phone_snapshot,c.phone),
  customer_address_snapshot=coalesce(g.customer_address_snapshot,
    nullif(coalesce(nullif(c.address->>'line1',''),nullif(c.address->>'street',''),nullif(c.address::text,'{}')),''))
from public.customers c where c.business_id=g.business_id and c.id=g.customer_id;

do $constraints$
declare item record;
begin
  for item in
    select conname from pg_constraint
    where conrelid='public.ss_girvi'::regclass and contype='c'
      and (pg_get_constraintdef(oid) ilike '%metal%' or pg_get_constraintdef(oid) ilike '%purity%')
  loop
    execute format('alter table public.ss_girvi drop constraint %I',item.conname);
  end loop;
  alter table public.ss_girvi
    add constraint ss_girvi_metal_purity_check check (
      (metal='mixed' and purity is null)
      or (metal='gold' and purity in ('24K','22K','20K','18K','16K'))
      or (metal='silver' and purity is null)
    );

  for item in
    select conname from pg_constraint
    where conrelid='public.ss_girvi'::regclass and contype='c'
      and pg_get_constraintdef(oid) ilike '%monthly_interest_percent%'
  loop
    execute format('alter table public.ss_girvi drop constraint %I',item.conname);
  end loop;
  alter table public.ss_girvi
    add constraint ss_girvi_monthly_interest_percent_check check (monthly_interest_percent between 2 and 10);
end
$constraints$;

create table if not exists public.ss_girvi_items (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.business_profiles(id) on delete restrict,
  girvi_id uuid not null,
  item_number smallint not null check (item_number between 1 and 100),
  description text not null check (length(trim(description)) between 1 and 180),
  condition_notes text check (condition_notes is null or length(condition_notes)<=500),
  metal text not null check (metal in ('gold','silver')),
  purity text not null check (purity in ('24K','22K','20K','18K','16K','999','925','Custom')),
  purity_factor numeric(8,6) not null check (purity_factor>0 and purity_factor<=1),
  weight_g numeric(14,4) not null check (weight_g>0),
  rate_per_gram numeric(14,4) not null check (rate_per_gram>0),
  estimated_market_value numeric(14,2) not null check (estimated_market_value>0),
  created_at timestamptz not null default now(),
  unique(business_id,girvi_id,item_number),
  foreign key (business_id,girvi_id) references public.ss_girvi(business_id,id) on delete restrict,
  check ((metal='gold' and purity in ('24K','22K','20K','18K','16K') and purity_factor=1)
      or (metal='silver' and purity in ('999','925','Custom')))
);

create index if not exists ss_girvi_items_pledge_idx on public.ss_girvi_items(business_id,girvi_id,item_number);
alter table public.ss_girvi_items enable row level security;
drop policy if exists ss_girvi_items_read_member on public.ss_girvi_items;
create policy ss_girvi_items_read_member on public.ss_girvi_items for select to authenticated
  using (public.is_business_member(business_id));
revoke all on public.ss_girvi_items from public,anon,authenticated;
grant select on public.ss_girvi_items to authenticated;

insert into public.ss_girvi_items(
  business_id,girvi_id,item_number,description,metal,purity,purity_factor,weight_g,rate_per_gram,estimated_market_value
)
select g.business_id,g.id,1,'Existing pledged jewellery (legacy record)',
  g.metal,case when g.metal='silver' then '999' else g.purity end,
  case when g.metal='silver' then 0.999 else 1 end,
  g.weight_g,g.rate_per_gram,g.estimated_market_value
from public.ss_girvi g
where g.metal in ('gold','silver')
  and not exists(select 1 from public.ss_girvi_items i where i.business_id=g.business_id and i.girvi_id=g.id);

create table if not exists public.ss_girvi_cashbook_entries (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.business_profiles(id) on delete restrict,
  girvi_id uuid not null,
  girvi_payment_id uuid references public.ss_girvi_payments(id) on delete restrict,
  entry_type text not null check (entry_type in ('loan_disbursement','payment')),
  direction text not null check (direction in ('in','out')),
  amount numeric(14,2) not null check (amount>0),
  method text not null check (method in ('cash','upi','bank_transfer','card','unknown')),
  actor_user_id uuid not null references auth.users(id),
  recorded_at timestamptz not null default now(),
  foreign key (business_id,girvi_id) references public.ss_girvi(business_id,id) on delete restrict,
  unique (business_id,girvi_payment_id),
  check ((entry_type='loan_disbursement' and direction='out' and girvi_payment_id is null)
      or (entry_type='payment' and direction='in' and girvi_payment_id is not null))
);
create index if not exists ss_girvi_cashbook_business_date_idx
  on public.ss_girvi_cashbook_entries(business_id,recorded_at desc);
create unique index if not exists ss_girvi_cashbook_disbursement_unique
  on public.ss_girvi_cashbook_entries(business_id,girvi_id) where entry_type='loan_disbursement';
alter table public.ss_girvi_cashbook_entries enable row level security;
drop policy if exists ss_girvi_cashbook_read_member on public.ss_girvi_cashbook_entries;
create policy ss_girvi_cashbook_read_member on public.ss_girvi_cashbook_entries for select to authenticated
  using (public.is_business_member(business_id));
revoke all on public.ss_girvi_cashbook_entries from public,anon,authenticated;
grant select on public.ss_girvi_cashbook_entries to authenticated;

insert into public.ss_girvi_cashbook_entries(
  business_id,girvi_id,entry_type,direction,amount,method,actor_user_id,recorded_at
)
select g.business_id,g.id,'loan_disbursement','out',g.principal_amount,'unknown',g.created_by,g.created_at
from public.ss_girvi g
where not exists(select 1 from public.ss_girvi_cashbook_entries e
  where e.business_id=g.business_id and e.girvi_id=g.id and e.entry_type='loan_disbursement')
on conflict do nothing;
insert into public.ss_girvi_cashbook_entries(
  business_id,girvi_id,girvi_payment_id,entry_type,direction,amount,method,actor_user_id,recorded_at
)
select p.business_id,p.girvi_id,p.id,'payment','in',p.amount,p.payment_method,p.received_by,p.created_at
from public.ss_girvi_payments p
where not exists(select 1 from public.ss_girvi_cashbook_entries e
  where e.business_id=p.business_id and e.girvi_payment_id=p.id)
on conflict do nothing;

do $audit_constraint$
declare item record;
begin
  for item in
    select conname from pg_constraint
    where conrelid='public.ss_girvi_audit_events'::regclass and contype='c'
      and pg_get_constraintdef(oid) ilike '%event_type%'
  loop
    execute format('alter table public.ss_girvi_audit_events drop constraint %I',item.conname);
  end loop;
  alter table public.ss_girvi_audit_events
    add constraint ss_girvi_audit_event_type_check
      check (event_type in ('girvi.created','girvi.payment','girvi.closed','girvi.agreement_print_requested'));
end
$audit_constraint$;

create or replace function public.ss_girvi_create_multi(
  p_business_id uuid,p_customer_id uuid,p_idempotency_key uuid,p_items jsonb,p_principal numeric,
  p_monthly_interest_percent numeric,p_girvi_date date,p_maturity_date date,
  p_disbursement_method text,p_notes text default null
) returns uuid
language plpgsql security definer set search_path=''
as $function$
declare
  actor uuid:=(select auth.uid());
  item jsonb;
  item_no integer:=0;
  item_count integer;
  total_weight numeric(14,4):=0;
  total_value numeric(14,2):=0;
  weight numeric(14,4);
  rate numeric(14,4);
  factor numeric(8,6);
  value numeric(14,2);
  parent_metal text;
  parent_purity text;
  parent_rate numeric(14,4);
  payload jsonb;
  existing uuid;
  old_payload jsonb;
  new_id uuid;
  customer_name text;
  customer_phone text;
  customer_address text;
begin
  if actor is null then raise exception 'Authentication required' using errcode='42501'; end if;
  if p_business_id is null or not public.has_business_role(p_business_id,array['owner','admin']) then
    raise exception 'Girvi posting is not authorized for this business' using errcode='42501';
  end if;
  if p_idempotency_key is null or jsonb_typeof(p_items) is distinct from 'array'
     or jsonb_array_length(p_items) not between 1 and 100
     or p_principal is null or p_principal<=0 or p_principal*100<>trunc(p_principal*100)
     or p_monthly_interest_percent is null or p_monthly_interest_percent not between 2 and 10
     or p_monthly_interest_percent*100<>trunc(p_monthly_interest_percent*100)
     or p_girvi_date is null or p_girvi_date>current_date
     or p_maturity_date is null or p_maturity_date<p_girvi_date
     or p_disbursement_method is null or p_disbursement_method not in ('cash','upi','bank_transfer','card')
     or length(coalesce(p_notes,''))>2000 then
    raise exception 'Girvi terms, disbursement method or item list are invalid' using errcode='22023';
  end if;

  item_count:=jsonb_array_length(p_items);
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_business_id::text||':'||p_idempotency_key::text,0));
  payload:=jsonb_build_object('customer_id',p_customer_id,'items',p_items,'principal',p_principal,
    'monthly_interest_percent',p_monthly_interest_percent,'girvi_date',p_girvi_date,'maturity_date',p_maturity_date,
    'disbursement_method',p_disbursement_method,'notes',nullif(trim(p_notes),''));  
  select id,request_payload into existing,old_payload from public.ss_girvi
    where business_id=p_business_id and idempotency_key=p_idempotency_key;
  if existing is not null then
    if old_payload is distinct from payload then raise exception 'Idempotency key was already used for a different Girvi agreement' using errcode='22023'; end if;
    return existing;
  end if;
  select c.full_name,c.phone,coalesce(nullif(c.address->>'line1',''),nullif(c.address->>'street',''),nullif(c.address::text,'{}'))
    into customer_name,customer_phone,customer_address
    from public.customers c where c.business_id=p_business_id and c.id=p_customer_id and c.status='active' for share;
  if not found then raise exception 'Customer does not belong to this business or is not active' using errcode='23503'; end if;

  for item in select e.value from jsonb_array_elements(p_items) as e(value) loop
    item_no:=item_no+1;
    weight:=(item->>'weight_g')::numeric;
    rate:=(item->>'rate_per_gram')::numeric;
    factor:=(item->>'purity_factor')::numeric;
    if nullif(trim(item->>'description'),'') is null or length(trim(item->>'description'))>180
       or length(coalesce(item->>'condition_notes',''))>500
       or item->>'metal' is null or item->>'metal' not in ('gold','silver') or nullif(trim(item->>'purity'),'') is null
       or weight is null or weight<=0 or weight*10000<>trunc(weight*10000)
       or rate is null or rate<=0 or rate*10000<>trunc(rate*10000)
       or factor is null or factor<=0 or factor>1 or factor*1000000<>trunc(factor*1000000) then
      raise exception 'Girvi item % has an invalid description, metal, purity, weight, rate or purity factor',item_no using errcode='22023';
    end if;
    if item->>'metal'='gold' and (item->>'purity' not in ('24K','22K','20K','18K','16K') or factor<>1) then
      raise exception 'Gold item % has an invalid purity or purity factor',item_no using errcode='22023';
    end if;
    if item->>'metal'='silver' and item->>'purity' not in ('999','925','Custom') then
      raise exception 'Silver item % has an unsupported purity',item_no using errcode='22023';
    end if;
    if item->>'metal'='silver' and item->>'purity'='999' and abs(factor-0.999)>0.000001 then
      raise exception '999 silver item % has an invalid purity factor',item_no using errcode='22023';
    end if;
    if item->>'metal'='silver' and item->>'purity'='925' and abs(factor-0.925)>0.000001 then
      raise exception '925 silver item % has an invalid purity factor',item_no using errcode='22023';
    end if;
    if item->>'metal'='silver' and item->>'purity'='Custom' and factor>=1 then
      raise exception 'Custom silver item % purity factor must be less than 1',item_no using errcode='22023';
    end if;
    value:=round(weight*rate,2);
    if value<=0 then raise exception 'Girvi item % has no positive assessed value',item_no using errcode='22023'; end if;
    total_weight:=total_weight+weight;
    total_value:=total_value+value;
  end loop;
  if p_principal>total_value then
    raise exception 'Loan amount cannot exceed the total assessed jewellery value' using errcode='22023';
  end if;

  if item_count=1 then
    parent_metal:=p_items->0->>'metal';
    parent_purity:=case when parent_metal='gold' then p_items->0->>'purity' else null end;
  else
    parent_metal:='mixed';
    parent_purity:=null;
  end if;
  parent_rate:=round(total_value/total_weight,4);
  insert into public.ss_girvi(
    business_id,customer_id,idempotency_key,request_payload,metal,purity,weight_g,rate_per_gram,
    estimated_market_value,principal_amount,principal_balance,monthly_interest_percent,girvi_date,maturity_date,
    customer_name_snapshot,customer_phone_snapshot,customer_address_snapshot,notes,created_by
  ) values (
    p_business_id,p_customer_id,p_idempotency_key,payload,parent_metal,parent_purity,total_weight,parent_rate,
    total_value,p_principal,p_principal,p_monthly_interest_percent,p_girvi_date,p_maturity_date,
    customer_name,customer_phone,customer_address,nullif(trim(p_notes),''),actor
  ) returning id into new_id;

  item_no:=0;
  for item in select e.value from jsonb_array_elements(p_items) as e(value) loop
    item_no:=item_no+1;
    weight:=(item->>'weight_g')::numeric;
    rate:=(item->>'rate_per_gram')::numeric;
    factor:=(item->>'purity_factor')::numeric;
    value:=round(weight*rate,2);
    insert into public.ss_girvi_items(
      business_id,girvi_id,item_number,description,condition_notes,metal,purity,purity_factor,weight_g,rate_per_gram,estimated_market_value
    ) values (
      p_business_id,new_id,item_no,trim(item->>'description'),nullif(trim(item->>'condition_notes'),''),item->>'metal',trim(item->>'purity'),factor,weight,rate,value
    );
  end loop;
  insert into public.ss_girvi_cashbook_entries(
    business_id,girvi_id,entry_type,direction,amount,method,actor_user_id
  ) values(p_business_id,new_id,'loan_disbursement','out',p_principal,p_disbursement_method,actor);
  insert into public.ss_girvi_audit_events(business_id,girvi_id,actor_user_id,event_type,safe_metadata)
    values(p_business_id,new_id,actor,'girvi.created',jsonb_build_object('principal',p_principal,
      'assessed_value',total_value,'item_count',item_count,'maturity_date',p_maturity_date));
  return new_id;
end
$function$;

create or replace function public.ss_girvi_record_payment(
  p_business_id uuid,p_girvi_id uuid,p_idempotency_key uuid,p_amount numeric,p_method text,p_payment_date date default current_date
) returns jsonb
language plpgsql security definer set search_path=''
as $function$
declare
  actor uuid:=(select auth.uid());
  pledge public.ss_girvi%rowtype;
  prior public.ss_girvi_payments%rowtype;
  months integer;
  i integer;
  interest_due numeric(14,2);
  principal_paid numeric(14,2);
  interest_paid numeric(14,2);
  total_due numeric(14,2);
  payment_id uuid;
begin
  if actor is null then raise exception 'Authentication required' using errcode='42501'; end if;
  if p_business_id is null or not public.has_business_role(p_business_id,array['owner','admin']) then
    raise exception 'Girvi payment is not authorized for this business' using errcode='42501';
  end if;
  select * into pledge from public.ss_girvi where business_id=p_business_id and id=p_girvi_id for update;
  if not found then raise exception 'Girvi record does not exist in this business' using errcode='42501'; end if;
  if p_idempotency_key is null or p_amount is null or p_amount<=0 or p_amount*100<>trunc(p_amount*100)
     or p_method not in ('cash','upi','bank_transfer','card') or p_payment_date is null
     or p_payment_date>current_date or p_payment_date<pledge.girvi_date then
    raise exception 'Payment amount, method, date or idempotency key is invalid' using errcode='22023';
  end if;
  select * into prior from public.ss_girvi_payments
    where business_id=p_business_id and idempotency_key=p_idempotency_key;
  if found then
    if prior.girvi_id<>p_girvi_id or prior.amount<>p_amount or prior.payment_method<>p_method or prior.payment_date<>p_payment_date then
      raise exception 'Idempotency key was already used for a different payment' using errcode='22023';
    end if;
    return jsonb_build_object('payment_id',prior.id,'status',pledge.status);
  end if;
  if pledge.status<>'active' then raise exception 'Closed Girvi records cannot receive payments' using errcode='22023'; end if;
  months:=public.ss_girvi_completed_months(pledge.girvi_date,p_payment_date);
  if months<pledge.last_accrued_months then raise exception 'Payment date cannot precede a previously accrued month' using errcode='22023'; end if;
  for i in pledge.last_accrued_months+1..months loop
    pledge.interest_balance:=pledge.interest_balance+round((pledge.principal_balance+pledge.interest_balance)*pledge.monthly_interest_percent/100,2);
  end loop;
  total_due:=pledge.principal_balance+pledge.interest_balance;
  if p_amount>total_due then raise exception 'Payment exceeds the current Girvi outstanding' using errcode='22023'; end if;
  interest_due:=pledge.interest_balance;
  interest_paid:=least(p_amount,interest_due);
  principal_paid:=p_amount-interest_paid;
  pledge.interest_balance:=pledge.interest_balance-interest_paid;
  pledge.principal_balance:=pledge.principal_balance-principal_paid;
  insert into public.ss_girvi_payments(
    business_id,girvi_id,idempotency_key,amount,payment_method,interest_paid,principal_paid,payment_date,received_by
  ) values(p_business_id,p_girvi_id,p_idempotency_key,p_amount,p_method,interest_paid,principal_paid,p_payment_date,actor)
  returning id into payment_id;
  insert into public.ss_girvi_cashbook_entries(
    business_id,girvi_id,girvi_payment_id,entry_type,direction,amount,method,actor_user_id
  ) values(p_business_id,p_girvi_id,payment_id,'payment','in',p_amount,p_method,actor);
  if pledge.principal_balance=0 and pledge.interest_balance=0 then
    update public.ss_girvi set principal_balance=0,interest_balance=0,last_accrued_months=months,
      status='closed',closed_at=now(),jewellery_returned=true,returned_at=now(),updated_at=now() where id=p_girvi_id;
    insert into public.ss_girvi_audit_events(business_id,girvi_id,actor_user_id,event_type,payment_id,safe_metadata)
      values(p_business_id,p_girvi_id,actor,'girvi.closed',payment_id,jsonb_build_object('payment',p_amount));
  else
    update public.ss_girvi set principal_balance=pledge.principal_balance,interest_balance=pledge.interest_balance,
      last_accrued_months=months,updated_at=now() where id=p_girvi_id;
    insert into public.ss_girvi_audit_events(business_id,girvi_id,actor_user_id,event_type,payment_id,safe_metadata)
      values(p_business_id,p_girvi_id,actor,'girvi.payment',payment_id,jsonb_build_object('payment',p_amount,
        'interest_paid',interest_paid,'principal_paid',principal_paid));
  end if;
  return jsonb_build_object('payment_id',payment_id,'interest_paid',interest_paid,'principal_paid',principal_paid,
    'principal_balance',pledge.principal_balance,'interest_balance',pledge.interest_balance,
    'status',case when pledge.principal_balance=0 and pledge.interest_balance=0 then 'closed' else 'active' end);
end
$function$;

create or replace function public.ss_audit_girvi_agreement_print(p_business_id uuid,p_girvi_id uuid)
returns uuid language plpgsql security definer set search_path=''
as $function$
declare event_id uuid;
begin
  if (select auth.uid()) is null then raise exception 'Authentication required' using errcode='42501'; end if;
  if p_business_id is null or not public.has_business_role(p_business_id,array['owner','admin']) then
    raise exception 'Girvi agreement access is not authorized for this business' using errcode='42501';
  end if;
  insert into public.ss_girvi_audit_events(business_id,girvi_id,actor_user_id,event_type,safe_metadata)
    values(p_business_id,p_girvi_id,(select auth.uid()),'girvi.agreement_print_requested','{}'::jsonb)
    returning id into event_id;
  return event_id;
end
$function$;

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
    select e.id,e.expense_id,'Operating expense'::text,'out'::text,e.amount,e.method,e.recorded_at
      from public.ss_expense_cashbook_entries e
    where e.business_id=p_business_id and public.has_business_role(p_business_id,array['owner','admin'])
      and (p_from is null or e.recorded_at>=p_from) and (p_through is null or e.recorded_at<=p_through)
    union all
    select e.id,coalesce(e.girvi_payment_id,e.girvi_id),
      case when e.entry_type='loan_disbursement' then 'Girvi loan disbursement' else 'Girvi repayment' end,
      e.direction,e.amount,e.method,e.recorded_at from public.ss_girvi_cashbook_entries e
    where e.business_id=p_business_id and (p_from is null or e.recorded_at>=p_from) and (p_through is null or e.recorded_at<=p_through)
  )
  select e.id,e.payment_id,e.source,e.direction,e.amount,e.method,e.recorded_at,count(*) over()::bigint
    from entries e order by e.recorded_at desc,e.id desc limit p_limit offset p_offset;
end
$function$;

create or replace function public.ss_business_report(p_business_id uuid,p_from date,p_through date)
returns table (
  report_day date,
  sales_total numeric,
  purchases_total numeric,
  cash_received numeric,
  cash_paid numeric,
  gold_weight_change_g numeric,
  silver_weight_change_g numeric,
  other_weight_change_g numeric,
  sales_count bigint,
  purchases_count bigint
)
language plpgsql stable security definer set search_path=''
as $function$
begin
  if (select auth.uid()) is null then raise exception 'Authentication required' using errcode='42501'; end if;
  if p_business_id is null or not public.has_business_role(p_business_id,array['owner','admin']) then
    raise exception 'Workspace is missing or report access is not authorized' using errcode='42501';
  end if;
  if p_from is null or p_through is null or p_through<p_from or p_through-p_from>365 then
    raise exception 'Report range must be between one and 366 days' using errcode='22023';
  end if;
  return query
  with days as (
    select g.day_ts::date as day from generate_series(p_from::timestamp,p_through::timestamp,interval '1 day') as g(day_ts)
  ), sales as (
    select (s.created_at at time zone 'Asia/Kolkata')::date as day,sum(s.subtotal)::numeric as total,count(*)::bigint as n
    from public.ss_sales s where s.business_id=p_business_id
      and s.created_at>=(p_from::timestamp at time zone 'Asia/Kolkata')
      and s.created_at<((p_through+1)::timestamp at time zone 'Asia/Kolkata')
    group by 1
  ), purchases as (
    select (p.created_at at time zone 'Asia/Kolkata')::date as day,sum(p.subtotal)::numeric as total,count(*)::bigint as n
    from public.ss_purchases p where p.business_id=p_business_id
      and p.created_at>=(p_from::timestamp at time zone 'Asia/Kolkata')
      and p.created_at<((p_through+1)::timestamp at time zone 'Asia/Kolkata')
    group by 1
  ), sale_cash as (
    select (e.recorded_at at time zone 'Asia/Kolkata')::date as day,sum(e.amount)::numeric as amount
    from public.ss_sale_cashbook_entries e where e.business_id=p_business_id and e.direction='in'
      and e.recorded_at>=(p_from::timestamp at time zone 'Asia/Kolkata')
      and e.recorded_at<((p_through+1)::timestamp at time zone 'Asia/Kolkata')
    group by 1
  ), purchase_cash as (
    select (e.recorded_at at time zone 'Asia/Kolkata')::date as day,sum(e.amount)::numeric as amount
    from public.ss_cashbook_entries e where e.business_id=p_business_id and e.direction='out'
      and e.recorded_at>=(p_from::timestamp at time zone 'Asia/Kolkata')
      and e.recorded_at<((p_through+1)::timestamp at time zone 'Asia/Kolkata')
    group by 1
  ), girvi_cash as (
    select (e.recorded_at at time zone 'Asia/Kolkata')::date as day,
      sum(e.amount) filter(where e.direction='in') as received,
      sum(e.amount) filter(where e.direction='out') as paid
    from public.ss_girvi_cashbook_entries e where e.business_id=p_business_id
      and e.recorded_at>=(p_from::timestamp at time zone 'Asia/Kolkata')
      and e.recorded_at<((p_through+1)::timestamp at time zone 'Asia/Kolkata')
    group by 1
  ), stock as (
    select (m.recorded_at at time zone 'Asia/Kolkata')::date as day,m.metal,sum(m.weight_delta_g)::numeric as change
    from (
      select business_id,recorded_at,metal,weight_delta_g from public.ss_inventory_movements
      union all
      select business_id,recorded_at,metal,weight_delta_g from public.ss_sale_inventory_movements
    ) m where m.business_id=p_business_id
      and m.recorded_at>=(p_from::timestamp at time zone 'Asia/Kolkata')
      and m.recorded_at<((p_through+1)::timestamp at time zone 'Asia/Kolkata')
    group by 1,2
  )
  select d.day,coalesce(s.total,0),coalesce(p.total,0),
    coalesce(sc.amount,0)+coalesce(gc.received,0),coalesce(pc.amount,0)+coalesce(gc.paid,0),
    coalesce(max(st.change) filter(where st.metal='gold'),0),
    coalesce(max(st.change) filter(where st.metal='silver'),0),
    coalesce(max(st.change) filter(where st.metal='other'),0),
    coalesce(s.n,0),coalesce(p.n,0)
  from days d left join sales s on s.day=d.day left join purchases p on p.day=d.day
    left join sale_cash sc on sc.day=d.day left join purchase_cash pc on pc.day=d.day
    left join girvi_cash gc on gc.day=d.day left join stock st on st.day=d.day
  group by d.day,s.total,p.total,sc.amount,pc.amount,gc.received,gc.paid,s.n,p.n
  order by d.day desc;
end
$function$;

create or replace function public.ss_business_report_v3(p_business_id uuid,p_from date,p_through date)
returns table(
  report_day date,sales_total numeric,returns_total numeric,purchases_total numeric,expenses_paid numeric,
  cash_received numeric,cash_refunded numeric,cash_paid numeric,
  gold_weight_change_g numeric,silver_weight_change_g numeric,other_weight_change_g numeric,
  sales_count bigint,returns_count bigint,purchases_count bigint,expenses_count bigint
)
language plpgsql stable security definer set search_path=''
as $function$
begin
  if (select auth.uid()) is null then raise exception 'Authentication required' using errcode='42501'; end if;
  if p_business_id is null or not public.has_business_role(p_business_id,array['owner','admin']) then
    raise exception 'Workspace is missing or report access is not authorized' using errcode='42501';
  end if;
  if p_from is null or p_through is null or p_through<p_from or p_through-p_from>365 then
    raise exception 'Report range must be between one and 366 days' using errcode='22023';
  end if;
  return query
  with days as (select g.day_ts::date as day from generate_series(p_from::timestamp,p_through::timestamp,interval '1 day') as g(day_ts)),
  sales as (
    select (s.created_at at time zone 'Asia/Kolkata')::date as day,sum(s.subtotal)::numeric total,count(*)::bigint n from public.ss_sales s
    where s.business_id=p_business_id and s.created_at >= (p_from::timestamp at time zone 'Asia/Kolkata') and s.created_at < ((p_through+1)::timestamp at time zone 'Asia/Kolkata') group by 1
  ), sale_returns as (
    select (r.recorded_at at time zone 'Asia/Kolkata')::date as day,sum(r.original_line_amount)::numeric total,count(*)::bigint n from public.ss_sale_returns r
    where r.business_id=p_business_id and r.recorded_at >= (p_from::timestamp at time zone 'Asia/Kolkata') and r.recorded_at < ((p_through+1)::timestamp at time zone 'Asia/Kolkata') group by 1
  ), purchases as (
    select (p.created_at at time zone 'Asia/Kolkata')::date as day,sum(p.subtotal)::numeric total,count(*)::bigint n from public.ss_purchases p
    where p.business_id=p_business_id and p.created_at >= (p_from::timestamp at time zone 'Asia/Kolkata') and p.created_at < ((p_through+1)::timestamp at time zone 'Asia/Kolkata') group by 1
  ), expenses as (
    select (x.occurred_at at time zone 'Asia/Kolkata')::date as day,sum(x.amount)::numeric total,count(*)::bigint n from public.ss_expenses x
    where x.business_id=p_business_id and x.occurred_at >= (p_from::timestamp at time zone 'Asia/Kolkata') and x.occurred_at < ((p_through+1)::timestamp at time zone 'Asia/Kolkata') group by 1
  ), sale_cash as (
    select (e.recorded_at at time zone 'Asia/Kolkata')::date as day,sum(e.amount)::numeric total from public.ss_sale_cashbook_entries e
    where e.business_id=p_business_id and e.recorded_at >= (p_from::timestamp at time zone 'Asia/Kolkata') and e.recorded_at < ((p_through+1)::timestamp at time zone 'Asia/Kolkata') group by 1
  ), refund_cash as (
    select (e.recorded_at at time zone 'Asia/Kolkata')::date as day,sum(e.amount)::numeric total from public.ss_sale_return_cashbook_entries e
    where e.business_id=p_business_id and e.recorded_at >= (p_from::timestamp at time zone 'Asia/Kolkata') and e.recorded_at < ((p_through+1)::timestamp at time zone 'Asia/Kolkata') group by 1
  ), purchase_cash as (
    select (e.recorded_at at time zone 'Asia/Kolkata')::date as day,sum(e.amount)::numeric total from public.ss_cashbook_entries e
    where e.business_id=p_business_id and e.direction='out' and e.recorded_at >= (p_from::timestamp at time zone 'Asia/Kolkata') and e.recorded_at < ((p_through+1)::timestamp at time zone 'Asia/Kolkata') group by 1
  ), girvi_cash as (
    select (e.recorded_at at time zone 'Asia/Kolkata')::date as day,
      sum(e.amount) filter(where e.direction='in') as received,sum(e.amount) filter(where e.direction='out') as paid
    from public.ss_girvi_cashbook_entries e where e.business_id=p_business_id
      and e.recorded_at >= (p_from::timestamp at time zone 'Asia/Kolkata') and e.recorded_at < ((p_through+1)::timestamp at time zone 'Asia/Kolkata')
    group by 1
  ), stock as (
    select (m.recorded_at at time zone 'Asia/Kolkata')::date as day,m.metal,sum(m.weight_delta_g)::numeric change from (
      select business_id,recorded_at,metal,weight_delta_g from public.ss_inventory_movements
      union all select business_id,recorded_at,metal,weight_delta_g from public.ss_sale_inventory_movements
      union all select business_id,recorded_at,metal,weight_delta_g from public.ss_sale_return_inventory_movements
    ) m where m.business_id=p_business_id and m.recorded_at >= (p_from::timestamp at time zone 'Asia/Kolkata') and m.recorded_at < ((p_through+1)::timestamp at time zone 'Asia/Kolkata') group by 1,2
  )
  select d.day,coalesce(s.total,0),coalesce(sr.total,0),coalesce(p.total,0),coalesce(x.total,0),
    coalesce(sc.total,0)+coalesce(gc.received,0),coalesce(rc.total,0),coalesce(pc.total,0)+coalesce(gc.paid,0),
    coalesce(max(st.change) filter(where st.metal='gold'),0),coalesce(max(st.change) filter(where st.metal='silver'),0),coalesce(max(st.change) filter(where st.metal='other'),0),
    coalesce(s.n,0),coalesce(sr.n,0),coalesce(p.n,0),coalesce(x.n,0)
  from days d left join sales s on s.day=d.day left join sale_returns sr on sr.day=d.day left join purchases p on p.day=d.day left join expenses x on x.day=d.day
    left join sale_cash sc on sc.day=d.day left join refund_cash rc on rc.day=d.day left join purchase_cash pc on pc.day=d.day
    left join girvi_cash gc on gc.day=d.day left join stock st on st.day=d.day
  group by d.day,s.total,sr.total,p.total,x.total,sc.total,rc.total,pc.total,gc.received,gc.paid,s.n,sr.n,p.n,x.n order by d.day desc;
end
$function$;

revoke all on function public.ss_girvi_create(uuid,uuid,uuid,text,text,numeric,numeric,numeric,numeric,date,text) from public,anon,authenticated;
revoke all on function public.ss_girvi_create_multi(uuid,uuid,uuid,jsonb,numeric,numeric,date,date,text,text) from public,anon,authenticated;
grant execute on function public.ss_girvi_create_multi(uuid,uuid,uuid,jsonb,numeric,numeric,date,date,text,text) to authenticated;
revoke all on function public.ss_girvi_record_payment(uuid,uuid,uuid,numeric,text,date) from public,anon,authenticated;
grant execute on function public.ss_girvi_record_payment(uuid,uuid,uuid,numeric,text,date) to authenticated;
revoke all on function public.ss_audit_girvi_agreement_print(uuid,uuid) from public,anon,authenticated;
grant execute on function public.ss_audit_girvi_agreement_print(uuid,uuid) to authenticated;
revoke all on function public.ss_cashbook_page(uuid,timestamptz,timestamptz,integer,integer) from public,anon,authenticated;
grant execute on function public.ss_cashbook_page(uuid,timestamptz,timestamptz,integer,integer) to authenticated;
revoke all on function public.ss_business_report(uuid,date,date) from public,anon,authenticated;
grant execute on function public.ss_business_report(uuid,date,date) to authenticated;
revoke all on function public.ss_business_report_v3(uuid,date,date) from public,anon,authenticated;
grant execute on function public.ss_business_report_v3(uuid,date,date) to authenticated;
