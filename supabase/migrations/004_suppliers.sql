-- Additive supplier directory. This migration never alters existing tables or rows.
-- It intentionally depends on the hosted project's existing authorization helpers.
do $preflight$
begin
  if to_regclass('public.business_profiles') is null or to_regclass('public.business_members') is null then
    raise exception 'Business tables are missing; inspect the hosted schema before applying 004_suppliers';
  end if;
  if to_regprocedure('public.is_business_member(uuid)') is null
     or to_regprocedure('public.has_business_role(uuid,text[])') is null then
    raise exception 'Existing business membership authorization helpers are missing; inspect the hosted RLS design before applying 004_suppliers';
  end if;
  -- Calls also verify that the installed helper bodies can execute against the live schema.
  perform public.is_business_member(null::uuid);
  perform public.has_business_role(null::uuid, array[]::text[]);
end
$preflight$;

create table if not exists public.ss_suppliers (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.business_profiles(id) on delete restrict,
  name text not null check (length(trim(name)) between 1 and 160),
  mobile_number text,
  email text,
  address text,
  notes text,
  is_active boolean not null default true,
  created_by uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists ss_suppliers_business_name_idx
  on public.ss_suppliers (business_id, lower(name));
create index if not exists ss_suppliers_business_mobile_idx
  on public.ss_suppliers (business_id, mobile_number);

alter table public.ss_suppliers enable row level security;

create or replace function public.ss_guard_supplier_identity()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  if new.id is distinct from old.id
     or new.business_id is distinct from old.business_id
     or new.created_by is distinct from old.created_by
     or new.created_at is distinct from old.created_at then
    raise exception 'Supplier identity and attribution are immutable';
  end if;
  new.updated_at := clock_timestamp();
  return new;
end;
$function$;
revoke all on function public.ss_guard_supplier_identity() from public, anon, authenticated;

do $trigger$
begin
  if not exists (
    select 1 from pg_trigger t
    join pg_class c on c.oid=t.tgrelid
    join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relname='ss_suppliers'
      and t.tgname='ss_suppliers_guard_identity' and not t.tgisinternal
  ) then
    execute 'create trigger ss_suppliers_guard_identity before update on public.ss_suppliers for each row execute function public.ss_guard_supplier_identity()';
  end if;
end
$trigger$;

do $policies$
begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='ss_suppliers' and policyname='ss_suppliers_read_member') then
    execute 'create policy ss_suppliers_read_member on public.ss_suppliers for select to authenticated using (public.is_business_member(business_id))';
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='ss_suppliers' and policyname='ss_suppliers_insert_member') then
    execute 'create policy ss_suppliers_insert_member on public.ss_suppliers for insert to authenticated with check (public.has_business_role(business_id, array[''owner'',''admin'',''staff'']) and created_by = (select auth.uid()))';
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='ss_suppliers' and policyname='ss_suppliers_update_member') then
    execute 'create policy ss_suppliers_update_member on public.ss_suppliers for update to authenticated using (public.has_business_role(business_id, array[''owner'',''admin'',''staff''])) with check (public.has_business_role(business_id, array[''owner'',''admin'',''staff'']))';
  end if;
end
$policies$;

revoke all privileges on table public.ss_suppliers from public, anon;
grant usage on schema public to authenticated;
grant select, insert, update on table public.ss_suppliers to authenticated;

