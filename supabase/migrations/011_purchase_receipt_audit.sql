-- Audit printable supplier goods-received vouchers without granting browser table writes.
do $preflight$
begin
  if to_regclass('public.ss_purchases') is null or to_regclass('public.business_profiles') is null then
    raise exception 'Purchase and business tables are required before 011_purchase_receipt_audit';
  end if;
  if to_regprocedure('public.has_business_role(uuid,text[])') is null then
    raise exception 'Tenant role helper is required before 011_purchase_receipt_audit';
  end if;
  perform public.has_business_role(null::uuid,array[]::text[]);
end
$preflight$;

create table if not exists public.ss_purchase_receipt_events (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.business_profiles(id) on delete restrict,
  purchase_id uuid not null,
  actor_user_id uuid not null references auth.users(id),
  action text not null check (action='print_requested'),
  recorded_at timestamptz not null default now(),
  foreign key (business_id,purchase_id) references public.ss_purchases(business_id,id) on delete restrict
);
create index if not exists ss_purchase_receipt_business_date_idx on public.ss_purchase_receipt_events(business_id,recorded_at desc);
alter table public.ss_purchase_receipt_events enable row level security;
do $policy$
begin
  if not exists(select 1 from pg_policies where schemaname='public' and tablename='ss_purchase_receipt_events' and policyname='ss_purchase_receipt_events_read_admin') then
    create policy ss_purchase_receipt_events_read_admin on public.ss_purchase_receipt_events for select to authenticated
      using(public.has_business_role(business_id,array['owner','admin']));
  end if;
end
$policy$;
revoke all privileges on table public.ss_purchase_receipt_events from public,anon,authenticated;
grant select on public.ss_purchase_receipt_events to authenticated;

create or replace function public.ss_audit_purchase_receipt_print(p_business_id uuid,p_purchase_id uuid)
returns uuid language plpgsql security definer set search_path=''
as $function$
declare event_id uuid;
begin
  if (select auth.uid()) is null then raise exception 'Authentication required' using errcode='42501'; end if;
  if p_business_id is null or not public.has_business_role(p_business_id,array['owner','admin']) then
    raise exception 'Workspace is missing or receipt access is not authorized' using errcode='42501';
  end if;
  insert into public.ss_purchase_receipt_events(business_id,purchase_id,actor_user_id,action)
    values(p_business_id,p_purchase_id,(select auth.uid()),'print_requested') returning id into event_id;
  return event_id;
end
$function$;
revoke all on function public.ss_audit_purchase_receipt_print(uuid,uuid) from public,anon,authenticated;
grant execute on function public.ss_audit_purchase_receipt_print(uuid,uuid) to authenticated;
