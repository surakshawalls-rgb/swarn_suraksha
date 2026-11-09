-- Record later supplier settlements and customer collections without editing posted bills.
-- Append-only payment rows update the cached bill paid_total in the same transaction.
do $preflight$
begin
  if to_regclass('public.ss_purchases') is null or to_regclass('public.ss_purchase_payments') is null
     or to_regclass('public.ss_cashbook_entries') is null or to_regclass('public.ss_sales') is null
     or to_regclass('public.ss_sale_payments') is null or to_regclass('public.ss_sale_cashbook_entries') is null then
    raise exception 'Purchase/sales payment ledgers are missing; inspect and apply prior migrations before 008_account_payments';
  end if;
  if to_regprocedure('public.has_business_role(uuid,text[])') is null then
    raise exception 'Tenant role helper is missing; inspect hosted RLS before applying 008_account_payments';
  end if;
  perform public.has_business_role(null::uuid,array[]::text[]);
end
$preflight$;

alter table public.ss_purchase_payments add column if not exists idempotency_key uuid not null default gen_random_uuid();
alter table public.ss_sale_payments add column if not exists idempotency_key uuid not null default gen_random_uuid();
create unique index if not exists ss_purchase_payment_idempotency_idx on public.ss_purchase_payments (purchase_id,idempotency_key);
create unique index if not exists ss_sale_payment_idempotency_idx on public.ss_sale_payments (sale_id,idempotency_key);

create table if not exists public.ss_payment_audit_events (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.business_profiles(id) on delete restrict,
  event_type text not null check (event_type in ('purchase_payment.recorded','sale_payment.recorded')),
  purchase_id uuid,
  sale_id uuid,
  payment_id uuid not null,
  actor_user_id uuid not null references auth.users(id),
  safe_metadata jsonb not null default '{}'::jsonb,
  recorded_at timestamptz not null default now(),
  check ((event_type='purchase_payment.recorded' and purchase_id is not null and sale_id is null)
      or (event_type='sale_payment.recorded' and sale_id is not null and purchase_id is null)),
  unique (event_type,payment_id)
);
create index if not exists ss_payment_audit_business_date_idx on public.ss_payment_audit_events (business_id,recorded_at desc);
alter table public.ss_payment_audit_events enable row level security;
do $policy$
begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='ss_payment_audit_events' and policyname='ss_payment_audit_events_read_admin') then
    execute 'create policy ss_payment_audit_events_read_admin on public.ss_payment_audit_events for select to authenticated using (public.has_business_role(business_id,array[''owner'',''admin'']))';
  end if;
end
$policy$;
revoke all privileges on table public.ss_payment_audit_events from public,anon,authenticated;
grant select on public.ss_payment_audit_events to authenticated;

create or replace function public.ss_record_purchase_payment(
  p_purchase_id uuid,p_idempotency_key uuid,p_amount numeric,p_method text,p_reference text default null
) returns uuid
language plpgsql security definer set search_path=''
as $function$
declare
  actor uuid := (select auth.uid());
  biz uuid; old_paid numeric(14,2); total numeric(14,2); payment_id uuid;
  prior_amount numeric(14,2); prior_method text; prior_reference text; normalized_reference text;
begin
  if actor is null then raise exception 'Authentication required' using errcode='42501'; end if;
  if p_idempotency_key is null or p_amount is null or p_amount<=0 or p_amount*100<>trunc(p_amount*100)
     or p_method is null or p_method not in ('cash','upi','bank_transfer','card') or length(coalesce(p_reference,''))>120 then
    raise exception 'Payment amount, method, reference, or idempotency key is invalid' using errcode='22023';
  end if;
  select business_id,paid_total,subtotal into biz,old_paid,total from public.ss_purchases where id=p_purchase_id for update;
  if biz is null or not public.has_business_role(biz,array['owner','admin']) then
    raise exception 'Purchase is missing or payment is not authorized' using errcode='42501';
  end if;
  normalized_reference:=nullif(trim(p_reference),'');
  select id,amount,method,reference into payment_id,prior_amount,prior_method,prior_reference
    from public.ss_purchase_payments where purchase_id=p_purchase_id and idempotency_key=p_idempotency_key;
  if payment_id is not null then
    if prior_amount<>p_amount or prior_method<>p_method or prior_reference is distinct from normalized_reference then
      raise exception 'Idempotency key was already used for a different payment' using errcode='22023';
    end if;
    return payment_id;
  end if;
  if p_amount>total-old_paid then raise exception 'Payment exceeds the remaining supplier balance' using errcode='22023'; end if;
  insert into public.ss_purchase_payments (business_id,purchase_id,method,amount,reference,received_by,idempotency_key)
    values (biz,p_purchase_id,p_method,p_amount,normalized_reference,actor,p_idempotency_key) returning id into payment_id;
  update public.ss_purchases set paid_total=paid_total+p_amount where id=p_purchase_id;
  insert into public.ss_cashbook_entries (business_id,source_type,source_id,direction,amount,method,actor_user_id)
    values (biz,'purchase_payment',payment_id,'out',p_amount,p_method,actor);
  insert into public.ss_payment_audit_events (business_id,event_type,purchase_id,payment_id,actor_user_id,safe_metadata)
    values (biz,'purchase_payment.recorded',p_purchase_id,payment_id,actor,jsonb_build_object('amount',p_amount,'method',p_method));
  return payment_id;
end
$function$;

create or replace function public.ss_record_sale_payment(
  p_sale_id uuid,p_idempotency_key uuid,p_amount numeric,p_method text,p_reference text default null
) returns uuid
language plpgsql security definer set search_path=''
as $function$
declare
  actor uuid := (select auth.uid());
  biz uuid; old_paid numeric(14,2); total numeric(14,2); payment_id uuid;
  prior_amount numeric(14,2); prior_method text; prior_reference text; normalized_reference text;
begin
  if actor is null then raise exception 'Authentication required' using errcode='42501'; end if;
  if p_idempotency_key is null or p_amount is null or p_amount<=0 or p_amount*100<>trunc(p_amount*100)
     or p_method is null or p_method not in ('cash','upi','bank_transfer','card') or length(coalesce(p_reference,''))>120 then
    raise exception 'Payment amount, method, reference, or idempotency key is invalid' using errcode='22023';
  end if;
  select business_id,paid_total,subtotal into biz,old_paid,total from public.ss_sales where id=p_sale_id for update;
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
  if p_amount>total-old_paid then raise exception 'Payment exceeds the remaining customer balance' using errcode='22023'; end if;
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

revoke all on function public.ss_record_purchase_payment(uuid,uuid,numeric,text,text) from public,anon,authenticated;
revoke all on function public.ss_record_sale_payment(uuid,uuid,numeric,text,text) from public,anon,authenticated;
grant execute on function public.ss_record_purchase_payment(uuid,uuid,numeric,text,text) to authenticated;
grant execute on function public.ss_record_sale_payment(uuid,uuid,numeric,text,text) to authenticated;
