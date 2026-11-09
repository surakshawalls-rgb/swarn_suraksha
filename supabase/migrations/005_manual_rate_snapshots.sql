-- Append-only manual market/shop rate snapshots. No external provider is implied.
-- All new data is stored in a new table; no existing data or policies are changed.
do $preflight$
begin
  if to_regclass('public.business_profiles') is null or to_regclass('public.business_members') is null then
    raise exception 'Business tables are missing; inspect the hosted schema before applying 005_manual_rate_snapshots';
  end if;
  if to_regprocedure('public.is_business_member(uuid)') is null
     or to_regprocedure('public.has_business_role(uuid,text[])') is null then
    raise exception 'Existing membership authorization helpers are missing; inspect hosted RLS before applying 005_manual_rate_snapshots';
  end if;
  perform public.is_business_member(null::uuid);
  perform public.has_business_role(null::uuid, array[]::text[]);
end
$preflight$;

create table if not exists public.ss_metal_rate_snapshots (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.business_profiles(id) on delete restrict,
  metal text not null check (metal in ('gold','silver')),
  purity text,
  unit text not null check (unit in ('gram','kilogram')),
  reference_rate numeric(14,4) not null check (reference_rate > 0),
  shop_buy_rate numeric(14,4) not null check (shop_buy_rate > 0),
  shop_sell_rate numeric(14,4) not null check (shop_sell_rate > 0),
  source_type text not null default 'manual' check (source_type = 'manual'),
  source_label text not null default 'Manual rate',
  reason text not null check (length(trim(reason)) between 5 and 1000),
  entered_by uuid not null references auth.users(id),
  recorded_at timestamptz not null default now(),
  check (
    (metal = 'gold' and purity is not null and length(trim(purity)) between 1 and 20 and unit = 'gram')
    or (metal = 'silver' and purity is null)
  )
);

create index if not exists ss_rates_latest_idx
  on public.ss_metal_rate_snapshots (business_id, metal, purity, recorded_at desc);

alter table public.ss_metal_rate_snapshots enable row level security;

create or replace function public.ss_lock_rate_snapshot()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  if tg_op = 'INSERT' then
    new.entered_by := (select auth.uid());
    new.recorded_at := clock_timestamp();
    new.source_type := 'manual';
    new.source_label := 'Manual rate';
    return new;
  end if;
  raise exception 'Rate snapshots are immutable; record a new snapshot with a reason';
end;
$function$;
revoke all on function public.ss_lock_rate_snapshot() from public, anon, authenticated;

do $triggers$
begin
  if not exists (
    select 1 from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relname='ss_metal_rate_snapshots'
      and t.tgname='ss_metal_rate_snapshots_immutable' and not t.tgisinternal
  ) then
    execute 'create trigger ss_metal_rate_snapshots_immutable before insert or update or delete on public.ss_metal_rate_snapshots for each row execute function public.ss_lock_rate_snapshot()';
  end if;
end
$triggers$;

do $policies$
begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='ss_metal_rate_snapshots' and policyname='ss_rates_read_member') then
    execute 'create policy ss_rates_read_member on public.ss_metal_rate_snapshots for select to authenticated using (public.is_business_member(business_id))';
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='ss_metal_rate_snapshots' and policyname='ss_rates_insert_owner_admin') then
    execute 'create policy ss_rates_insert_owner_admin on public.ss_metal_rate_snapshots for insert to authenticated with check (public.has_business_role(business_id, array[''owner'',''admin'']) and entered_by = (select auth.uid()))';
  end if;
end
$policies$;

revoke all privileges on table public.ss_metal_rate_snapshots from public, anon;
grant usage on schema public to authenticated;
grant select, insert on table public.ss_metal_rate_snapshots to authenticated;

