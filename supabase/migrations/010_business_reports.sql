-- Aggregated, tenant-scoped operational reports. Never exposes unrestricted ledger reads.
do $preflight$
begin
  if to_regclass('public.ss_sales') is null or to_regclass('public.ss_purchases') is null
     or to_regclass('public.ss_sale_cashbook_entries') is null or to_regclass('public.ss_cashbook_entries') is null
     or to_regclass('public.ss_inventory_movements') is null or to_regclass('public.ss_sale_inventory_movements') is null then
    raise exception 'Sales, purchase, cashbook and owned-stock ledgers are required before 010_business_reports';
  end if;
  if to_regprocedure('public.has_business_role(uuid,text[])') is null then
    raise exception 'Tenant role helper is required before 010_business_reports';
  end if;
  perform public.has_business_role(null::uuid,array[]::text[]);
end
$preflight$;

create table if not exists public.ss_report_export_events (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.business_profiles(id) on delete restrict,
  actor_user_id uuid not null references auth.users(id),
  report_type text not null check (report_type='daily_operations_csv'),
  range_from date not null,
  range_through date not null,
  recorded_at timestamptz not null default now(),
  check (range_through>=range_from and range_through-range_from<=365)
);
create index if not exists ss_report_export_business_date_idx on public.ss_report_export_events(business_id,recorded_at desc);
alter table public.ss_report_export_events enable row level security;
do $policy$
begin
  if not exists(select 1 from pg_policies where schemaname='public' and tablename='ss_report_export_events' and policyname='ss_report_export_events_read_admin') then
    create policy ss_report_export_events_read_admin on public.ss_report_export_events for select to authenticated
      using(public.has_business_role(business_id,array['owner','admin']));
  end if;
end
$policy$;

create table if not exists public.ss_sale_receipt_events (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.business_profiles(id) on delete restrict,
  sale_id uuid not null,
  actor_user_id uuid not null references auth.users(id),
  action text not null check (action='print_requested'),
  recorded_at timestamptz not null default now(),
  foreign key (business_id,sale_id) references public.ss_sales(business_id,id) on delete restrict
);
create index if not exists ss_sale_receipt_business_date_idx on public.ss_sale_receipt_events(business_id,recorded_at desc);
alter table public.ss_sale_receipt_events enable row level security;
do $receipt_policy$
begin
  if not exists(select 1 from pg_policies where schemaname='public' and tablename='ss_sale_receipt_events' and policyname='ss_sale_receipt_events_read_admin') then
    create policy ss_sale_receipt_events_read_admin on public.ss_sale_receipt_events for select to authenticated
      using(public.has_business_role(business_id,array['owner','admin']));
  end if;
end
$receipt_policy$;
revoke all privileges on table public.ss_sale_receipt_events from public,anon,authenticated;
grant select on public.ss_sale_receipt_events to authenticated;

create or replace function public.ss_audit_sale_receipt_print(p_business_id uuid,p_sale_id uuid)
returns uuid language plpgsql security definer set search_path=''
as $function$
declare event_id uuid;
begin
  if (select auth.uid()) is null then raise exception 'Authentication required' using errcode='42501'; end if;
  if p_business_id is null or not public.has_business_role(p_business_id,array['owner','admin']) then
    raise exception 'Workspace is missing or receipt access is not authorized' using errcode='42501';
  end if;
  insert into public.ss_sale_receipt_events(business_id,sale_id,actor_user_id,action)
    values(p_business_id,p_sale_id,(select auth.uid()),'print_requested') returning id into event_id;
  return event_id;
end
$function$;
revoke all on function public.ss_audit_sale_receipt_print(uuid,uuid) from public,anon,authenticated;
grant execute on function public.ss_audit_sale_receipt_print(uuid,uuid) to authenticated;
revoke all privileges on table public.ss_report_export_events from public,anon,authenticated;
grant select on public.ss_report_export_events to authenticated;

create or replace function public.ss_audit_report_export(p_business_id uuid,p_from date,p_through date)
returns uuid
language plpgsql security definer set search_path=''
as $function$
declare event_id uuid;
begin
  if (select auth.uid()) is null then raise exception 'Authentication required' using errcode='42501'; end if;
  if p_business_id is null or not public.has_business_role(p_business_id,array['owner','admin']) then
    raise exception 'Workspace is missing or export access is not authorized' using errcode='42501';
  end if;
  if p_from is null or p_through is null or p_through<p_from or p_through-p_from>365 then
    raise exception 'Export range must be between one and 366 days' using errcode='22023';
  end if;
  insert into public.ss_report_export_events(business_id,actor_user_id,report_type,range_from,range_through)
    values(p_business_id,(select auth.uid()),'daily_operations_csv',p_from,p_through) returning id into event_id;
  return event_id;
end
$function$;
revoke all on function public.ss_audit_report_export(uuid,date,date) from public,anon,authenticated;
grant execute on function public.ss_audit_report_export(uuid,date,date) to authenticated;

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
language plpgsql
stable
security definer
set search_path=''
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
  select d.day,coalesce(s.total,0),coalesce(p.total,0),coalesce(sc.amount,0),coalesce(pc.amount,0),
         coalesce(max(st.change) filter(where st.metal='gold'),0),
         coalesce(max(st.change) filter(where st.metal='silver'),0),
         coalesce(max(st.change) filter(where st.metal='other'),0),
         coalesce(s.n,0),coalesce(p.n,0)
  from days d left join sales s on s.day=d.day left join purchases p on p.day=d.day
    left join sale_cash sc on sc.day=d.day left join purchase_cash pc on pc.day=d.day left join stock st on st.day=d.day
  group by d.day,s.total,p.total,sc.amount,pc.amount,s.n,p.n
  order by d.day desc;
end
$function$;

revoke all on function public.ss_business_report(uuid,date,date) from public,anon,authenticated;
grant execute on function public.ss_business_report(uuid,date,date) to authenticated;
