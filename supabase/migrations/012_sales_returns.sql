-- Full-line sales returns. Original invoice rows remain immutable; reversal
-- movements and cash refunds are appended atomically by a trusted RPC.
do $preflight$
begin
  if to_regclass('public.ss_sales') is null or to_regclass('public.ss_sale_lines') is null
     or to_regclass('public.ss_sale_payments') is null
     or to_regclass('public.ss_sale_cashbook_entries') is null
     or to_regclass('public.ss_sale_inventory_movements') is null
     or to_regclass('public.ss_payment_audit_events') is null
     or to_regprocedure('public.is_business_member(uuid)') is null
     or to_regprocedure('public.has_business_role(uuid,text[])') is null then
    raise exception 'Verified sales ledgers and authorization helper are required before 012_sales_returns';
  end if;
  if exists (
    select 1 from unnest(array['ss_sales','ss_sale_lines','ss_sale_payments','ss_sale_cashbook_entries','ss_sale_inventory_movements']) as req(name)
    where not coalesce((select c.relrowsecurity from pg_class c where c.oid=to_regclass('public.'||req.name)),false)
  ) then
    raise exception 'Base sales tables must have RLS enabled; inspect hosted policies before applying 012_sales_returns';
  end if;
  perform public.has_business_role(null::uuid,array[]::text[]);
end
$preflight$;

create unique index if not exists ss_sale_lines_business_sale_id_unique
  on public.ss_sale_lines(business_id,sale_id,id);

create table if not exists public.ss_sale_returns (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.business_profiles(id) on delete restrict,
  sale_id uuid not null,
  sale_line_id uuid not null,
  idempotency_key uuid not null,
  original_line_amount numeric(14,2) not null check (original_line_amount > 0),
  balance_reduction numeric(14,2) not null check (balance_reduction >= 0),
  cash_refund numeric(14,2) not null check (cash_refund >= 0),
  refund_method text check (refund_method in ('cash','upi','bank_transfer','card')),
  reason text not null check (length(trim(reason)) between 3 and 300),
  actor_user_id uuid not null references auth.users(id),
  recorded_at timestamptz not null default now(),
  check (original_line_amount = balance_reduction + cash_refund),
  check ((cash_refund = 0 and refund_method is null) or (cash_refund > 0 and refund_method is not null)),
  unique (sale_line_id),
  unique (business_id,idempotency_key),
  foreign key (business_id,sale_id) references public.ss_sales(business_id,id) on delete restrict,
  foreign key (business_id,sale_id,sale_line_id) references public.ss_sale_lines(business_id,sale_id,id) on delete restrict
);

create table if not exists public.ss_sale_return_inventory_movements (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.business_profiles(id) on delete restrict,
  sale_return_id uuid not null unique references public.ss_sale_returns(id) on delete restrict,
  sale_line_id uuid not null references public.ss_sale_lines(id) on delete restrict,
  metal text not null check (metal in ('gold','silver','other')),
  purity text,
  weight_delta_g numeric(14,4) not null check (weight_delta_g > 0),
  actor_user_id uuid not null references auth.users(id),
  recorded_at timestamptz not null default now()
);

create table if not exists public.ss_sale_return_cashbook_entries (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.business_profiles(id) on delete restrict,
  sale_return_id uuid not null unique references public.ss_sale_returns(id) on delete restrict,
  sale_id uuid not null,
  direction text not null default 'out' check (direction='out'),
  amount numeric(14,2) not null check (amount > 0),
  method text not null check (method in ('cash','upi','bank_transfer','card')),
  actor_user_id uuid not null references auth.users(id),
  recorded_at timestamptz not null default now(),
  foreign key (business_id,sale_id) references public.ss_sales(business_id,id) on delete restrict
);

create table if not exists public.ss_sale_return_audit_events (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.business_profiles(id) on delete restrict,
  sale_return_id uuid not null unique references public.ss_sale_returns(id) on delete restrict,
  sale_id uuid not null,
  actor_user_id uuid not null references auth.users(id),
  event_type text not null default 'sale.returned' check (event_type='sale.returned'),
  safe_metadata jsonb not null default '{}'::jsonb,
  recorded_at timestamptz not null default now(),
  foreign key (business_id,sale_id) references public.ss_sales(business_id,id) on delete restrict
);

create table if not exists public.ss_sale_return_receipt_events (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.business_profiles(id) on delete restrict,
  sale_return_id uuid not null references public.ss_sale_returns(id) on delete restrict,
  actor_user_id uuid not null references auth.users(id),
  action text not null check (action='print_requested'),
  recorded_at timestamptz not null default now()
);

create index if not exists ss_sale_returns_business_date_idx on public.ss_sale_returns(business_id,recorded_at desc);
create index if not exists ss_sale_returns_sale_idx on public.ss_sale_returns(sale_id);
create index if not exists ss_sale_return_inventory_business_idx on public.ss_sale_return_inventory_movements(business_id,recorded_at desc);
create index if not exists ss_sale_return_cashbook_business_idx on public.ss_sale_return_cashbook_entries(business_id,recorded_at desc);
create index if not exists ss_sale_return_receipt_business_idx on public.ss_sale_return_receipt_events(business_id,recorded_at desc);
alter table public.ss_sale_returns enable row level security;
alter table public.ss_sale_return_inventory_movements enable row level security;
alter table public.ss_sale_return_cashbook_entries enable row level security;
alter table public.ss_sale_return_audit_events enable row level security;
alter table public.ss_sale_return_receipt_events enable row level security;
create policy ss_sale_returns_read_member on public.ss_sale_returns for select to authenticated using(public.is_business_member(business_id));
create policy ss_sale_return_inventory_read_member on public.ss_sale_return_inventory_movements for select to authenticated using(public.is_business_member(business_id));
create policy ss_sale_return_cashbook_read_member on public.ss_sale_return_cashbook_entries for select to authenticated using(public.is_business_member(business_id));
create policy ss_sale_return_audit_read_admin on public.ss_sale_return_audit_events for select to authenticated using(public.has_business_role(business_id,array['owner','admin']));
create policy ss_sale_return_receipt_read_admin on public.ss_sale_return_receipt_events for select to authenticated using(public.has_business_role(business_id,array['owner','admin']));
revoke all privileges on table public.ss_sale_returns,public.ss_sale_return_inventory_movements,
  public.ss_sale_return_cashbook_entries,public.ss_sale_return_audit_events,public.ss_sale_return_receipt_events from public,anon,authenticated;
grant select on public.ss_sale_returns,public.ss_sale_return_inventory_movements,public.ss_sale_return_cashbook_entries to authenticated;
grant select on public.ss_sale_return_audit_events to authenticated;
grant select on public.ss_sale_return_receipt_events to authenticated;

create or replace function public.ss_return_sale_line(
  p_business_id uuid,p_sale_id uuid,p_sale_line_id uuid,p_idempotency_key uuid,
  p_reason text,p_refund_method text default null
) returns uuid
language plpgsql security definer set search_path=''
as $function$
declare
  actor uuid := (select auth.uid());
  line public.ss_sale_lines%rowtype;
  sale_total numeric(14,2); sale_paid numeric(14,2); prior_reduction numeric(14,2); prior_refund numeric(14,2);
  outstanding numeric(14,2); paid_net numeric(14,2); reduce_due numeric(14,2); refund_amount numeric(14,2);
  old public.ss_sale_returns%rowtype; return_id uuid;
begin
  if actor is null then raise exception 'Authentication required' using errcode='42501'; end if;
  if p_business_id is null or not public.has_business_role(p_business_id,array['owner','admin']) then
    raise exception 'Return access is not authorized for this workspace' using errcode='42501';
  end if;
  if p_idempotency_key is null or length(trim(coalesce(p_reason,''))) not between 3 and 300
     or (p_refund_method is not null and p_refund_method not in ('cash','upi','bank_transfer','card')) then
    raise exception 'Return reason, refund method, or idempotency key is invalid' using errcode='22023';
  end if;
  select subtotal,paid_total into sale_total,sale_paid from public.ss_sales
    where id=p_sale_id and business_id=p_business_id for update;
  if not found then raise exception 'Sale not found in this workspace' using errcode='P0002'; end if;
  select * into old from public.ss_sale_returns where business_id=p_business_id and idempotency_key=p_idempotency_key;
  if found then
    if old.sale_id<>p_sale_id or old.sale_line_id<>p_sale_line_id or old.reason<>trim(p_reason)
       or old.refund_method is distinct from nullif(p_refund_method,'') then
      raise exception 'Idempotency key was used for a different return' using errcode='22023';
    end if;
    return old.id;
  end if;
  select * into line from public.ss_sale_lines where id=p_sale_line_id and sale_id=p_sale_id and business_id=p_business_id;
  if not found then raise exception 'Sale item not found on this invoice' using errcode='P0002'; end if;
  if exists(select 1 from public.ss_sale_returns where sale_line_id=p_sale_line_id) then
    raise exception 'This full invoice line has already been returned' using errcode='23505';
  end if;
  select coalesce(sum(balance_reduction),0),coalesce(sum(cash_refund),0)
    into prior_reduction,prior_refund from public.ss_sale_returns where sale_id=p_sale_id;
  outstanding:=greatest(sale_total-sale_paid-prior_reduction,0);
  paid_net:=greatest(sale_paid-prior_refund,0);
  reduce_due:=least(line.line_total,outstanding);
  refund_amount:=line.line_total-reduce_due;
  if refund_amount>paid_net then
    raise exception 'Return exceeds the amount paid after the unpaid balance reduction' using errcode='22023';
  end if;
  if refund_amount>0 and p_refund_method is null then
    raise exception 'Choose a method for the customer refund' using errcode='22023';
  end if;
  insert into public.ss_sale_returns(business_id,sale_id,sale_line_id,idempotency_key,original_line_amount,balance_reduction,cash_refund,refund_method,reason,actor_user_id)
    values(p_business_id,p_sale_id,p_sale_line_id,p_idempotency_key,line.line_total,reduce_due,refund_amount,nullif(p_refund_method,''),trim(p_reason),actor)
    returning id into return_id;
  insert into public.ss_sale_return_inventory_movements(business_id,sale_return_id,sale_line_id,metal,purity,weight_delta_g,actor_user_id)
    values(p_business_id,return_id,line.id,line.metal,line.purity,line.net_weight_g,actor);
  if refund_amount>0 then
    insert into public.ss_sale_return_cashbook_entries(business_id,sale_return_id,sale_id,amount,method,actor_user_id)
      values(p_business_id,return_id,p_sale_id,refund_amount,p_refund_method,actor);
  end if;
  insert into public.ss_sale_return_audit_events(business_id,sale_return_id,sale_id,actor_user_id,safe_metadata)
    values(p_business_id,return_id,p_sale_id,actor,jsonb_build_object('line_amount',line.line_total,'balance_reduction',reduce_due,'cash_refund',refund_amount));
  return return_id;
end
$function$;
revoke all on function public.ss_return_sale_line(uuid,uuid,uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.ss_return_sale_line(uuid,uuid,uuid,uuid,text,text) to authenticated;

create or replace function public.ss_audit_sale_return_receipt_print(p_business_id uuid,p_sale_return_id uuid)
returns uuid language plpgsql security definer set search_path=''
as $function$
declare event_id uuid;
begin
  if (select auth.uid()) is null then raise exception 'Authentication required' using errcode='42501'; end if;
  if p_business_id is null or not public.has_business_role(p_business_id,array['owner','admin']) then
    raise exception 'Workspace or return voucher access is not authorized' using errcode='42501';
  end if;
  insert into public.ss_sale_return_receipt_events(business_id,sale_return_id,actor_user_id,action)
    select p_business_id,r.id,(select auth.uid()),'print_requested' from public.ss_sale_returns r
    where r.id=p_sale_return_id and r.business_id=p_business_id returning id into event_id;
  if event_id is null then raise exception 'Sales return not found in this workspace' using errcode='P0002'; end if;
  return event_id;
end
$function$;
revoke all on function public.ss_audit_sale_return_receipt_print(uuid,uuid) from public,anon,authenticated;
grant execute on function public.ss_audit_sale_return_receipt_print(uuid,uuid) to authenticated;

-- Replace the collection RPC so a subsequent payment respects return credits.
create or replace function public.ss_record_sale_payment(
  p_sale_id uuid,p_idempotency_key uuid,p_amount numeric,p_method text,p_reference text default null
) returns uuid language plpgsql security definer set search_path=''
as $function$
declare
  actor uuid := (select auth.uid()); biz uuid; old_paid numeric(14,2); total numeric(14,2);
  credited numeric(14,2); payment_id uuid; prior_amount numeric(14,2); prior_method text;
  prior_reference text; normalized_reference text;
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
  select coalesce(sum(balance_reduction),0) into credited from public.ss_sale_returns where sale_id=p_sale_id;
  if p_amount>greatest(total-old_paid-credited,0) then raise exception 'Payment exceeds the remaining customer balance after returns' using errcode='22023'; end if;
  insert into public.ss_sale_payments(business_id,sale_id,method,amount,reference,received_by,idempotency_key)
    values(biz,p_sale_id,p_method,p_amount,normalized_reference,actor,p_idempotency_key) returning id into payment_id;
  update public.ss_sales set paid_total=paid_total+p_amount where id=p_sale_id;
  insert into public.ss_sale_cashbook_entries(business_id,sale_id,sale_payment_id,amount,method,actor_user_id)
    values(biz,p_sale_id,payment_id,p_amount,p_method,actor);
  insert into public.ss_payment_audit_events(business_id,event_type,sale_id,payment_id,actor_user_id,safe_metadata)
    values(biz,'sale_payment.recorded',p_sale_id,payment_id,actor,jsonb_build_object('amount',p_amount,'method',p_method));
  return payment_id;
end
$function$;
revoke all on function public.ss_record_sale_payment(uuid,uuid,numeric,text,text) from public,anon,authenticated;
grant execute on function public.ss_record_sale_payment(uuid,uuid,numeric,text,text) to authenticated;

-- Existing dashboard aggregate now excludes returned amounts from revenue and dues.
create or replace function public.ss_dashboard_summary(p_business_id uuid)
returns table(sales_total numeric,purchases_total numeric,customer_due numeric,supplier_due numeric,sale_count bigint,purchase_count bigint)
language plpgsql stable security definer set search_path=''
as $function$
begin
  if (select auth.uid()) is null then raise exception 'Authentication required' using errcode='42501'; end if;
  if p_business_id is null or not public.is_business_member(p_business_id) then raise exception 'Workspace access is not authorized' using errcode='42501'; end if;
  return query select
    coalesce((select sum(greatest(s.subtotal-coalesce(r.returned,0),0)) from public.ss_sales s left join lateral
      (select sum(x.original_line_amount) returned from public.ss_sale_returns x where x.sale_id=s.id) r on true where s.business_id=p_business_id),0)::numeric,
    coalesce((select sum(p.subtotal) from public.ss_purchases p where p.business_id=p_business_id),0)::numeric,
    coalesce((select sum(greatest(s.subtotal-s.paid_total-coalesce(r.credited,0),0)) from public.ss_sales s left join lateral
      (select sum(x.balance_reduction) credited from public.ss_sale_returns x where x.sale_id=s.id) r on true where s.business_id=p_business_id),0)::numeric,
    coalesce((select sum(p.subtotal-p.paid_total) from public.ss_purchases p where p.business_id=p_business_id),0)::numeric,
    (select count(*) from public.ss_sales s where s.business_id=p_business_id),
    (select count(*) from public.ss_purchases p where p.business_id=p_business_id);
end
$function$;
revoke all on function public.ss_dashboard_summary(uuid) from public,anon,authenticated;
grant execute on function public.ss_dashboard_summary(uuid) to authenticated;

create or replace function public.ss_business_report_v2(p_business_id uuid,p_from date,p_through date)
returns table(
  report_day date,sales_total numeric,returns_total numeric,purchases_total numeric,
  cash_received numeric,cash_refunded numeric,cash_paid numeric,
  gold_weight_change_g numeric,silver_weight_change_g numeric,other_weight_change_g numeric,
  sales_count bigint,returns_count bigint,purchases_count bigint
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
    select g.day_ts::date day from generate_series(p_from::timestamp,p_through::timestamp,interval '1 day') g(day_ts)
  ), sales as (
    select (s.created_at at time zone 'Asia/Kolkata')::date day,sum(s.subtotal)::numeric total,count(*)::bigint n
    from public.ss_sales s where s.business_id=p_business_id and s.created_at >= (p_from::timestamp at time zone 'Asia/Kolkata')
      and s.created_at < ((p_through+1)::timestamp at time zone 'Asia/Kolkata') group by 1
  ), sale_returns as (
    select (r.recorded_at at time zone 'Asia/Kolkata')::date day,sum(r.original_line_amount)::numeric total,count(*)::bigint n
    from public.ss_sale_returns r where r.business_id=p_business_id and r.recorded_at >= (p_from::timestamp at time zone 'Asia/Kolkata')
      and r.recorded_at < ((p_through+1)::timestamp at time zone 'Asia/Kolkata') group by 1
  ), purchases as (
    select (p.created_at at time zone 'Asia/Kolkata')::date day,sum(p.subtotal)::numeric total,count(*)::bigint n
    from public.ss_purchases p where p.business_id=p_business_id and p.created_at >= (p_from::timestamp at time zone 'Asia/Kolkata')
      and p.created_at < ((p_through+1)::timestamp at time zone 'Asia/Kolkata') group by 1
  ), sale_cash as (
    select (e.recorded_at at time zone 'Asia/Kolkata')::date day,sum(e.amount)::numeric total from public.ss_sale_cashbook_entries e
    where e.business_id=p_business_id and e.recorded_at >= (p_from::timestamp at time zone 'Asia/Kolkata')
      and e.recorded_at < ((p_through+1)::timestamp at time zone 'Asia/Kolkata') group by 1
  ), refund_cash as (
    select (e.recorded_at at time zone 'Asia/Kolkata')::date day,sum(e.amount)::numeric total from public.ss_sale_return_cashbook_entries e
    where e.business_id=p_business_id and e.recorded_at >= (p_from::timestamp at time zone 'Asia/Kolkata')
      and e.recorded_at < ((p_through+1)::timestamp at time zone 'Asia/Kolkata') group by 1
  ), purchase_cash as (
    select (e.recorded_at at time zone 'Asia/Kolkata')::date day,sum(e.amount)::numeric total from public.ss_cashbook_entries e
    where e.business_id=p_business_id and e.direction='out' and e.recorded_at >= (p_from::timestamp at time zone 'Asia/Kolkata')
      and e.recorded_at < ((p_through+1)::timestamp at time zone 'Asia/Kolkata') group by 1
  ), stock as (
    select (m.recorded_at at time zone 'Asia/Kolkata')::date day,m.metal,sum(m.weight_delta_g)::numeric change from (
      select business_id,recorded_at,metal,weight_delta_g from public.ss_inventory_movements
      union all select business_id,recorded_at,metal,weight_delta_g from public.ss_sale_inventory_movements
      union all select business_id,recorded_at,metal,weight_delta_g from public.ss_sale_return_inventory_movements
    ) m where m.business_id=p_business_id and m.recorded_at >= (p_from::timestamp at time zone 'Asia/Kolkata')
      and m.recorded_at < ((p_through+1)::timestamp at time zone 'Asia/Kolkata') group by 1,2
  )
  select d.day,coalesce(s.total,0),coalesce(sr.total,0),coalesce(p.total,0),coalesce(sc.total,0),coalesce(rc.total,0),coalesce(pc.total,0),
    coalesce(max(st.change) filter(where st.metal='gold'),0),coalesce(max(st.change) filter(where st.metal='silver'),0),
    coalesce(max(st.change) filter(where st.metal='other'),0),coalesce(s.n,0),coalesce(sr.n,0),coalesce(p.n,0)
  from days d left join sales s on s.day=d.day left join sale_returns sr on sr.day=d.day left join purchases p on p.day=d.day
    left join sale_cash sc on sc.day=d.day left join refund_cash rc on rc.day=d.day left join purchase_cash pc on pc.day=d.day
    left join stock st on st.day=d.day
  group by d.day,s.total,sr.total,p.total,sc.total,rc.total,pc.total,s.n,sr.n,p.n order by d.day desc;
end
$function$;
revoke all on function public.ss_business_report_v2(uuid,date,date) from public,anon,authenticated;
grant execute on function public.ss_business_report_v2(uuid,date,date) to authenticated;
