-- Read-only preflight for 014_operating_expenses.sql.
-- Run in Supabase SQL Editor and review every result before applying migration 014.

-- Presence of all objects the migration changes or its report RPC references.
select n.nspname as schema_name,c.relname as object_name,c.relkind as object_kind
from pg_class c join pg_namespace n on n.oid=c.relnamespace
where n.nspname='public' and c.relname in (
  'business_profiles','ss_purchases','ss_sales','ss_sale_returns',
  'ss_inventory_movements','ss_sale_inventory_movements','ss_sale_return_inventory_movements',
  'ss_cashbook_entries','ss_sale_cashbook_entries','ss_sale_return_cashbook_entries'
)
order by c.relname;

-- Existing merged cashbook RPC signature and routine metadata.
select p.oid::regprocedure as signature,p.prosecdef,p.provolatile,p.proconfig,
       pg_get_functiondef(p.oid) as definition
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.proname='ss_cashbook_page';

-- Role helper signatures and definitions used by migration 014.
select p.oid::regprocedure as signature,p.prosecdef,p.proconfig,
       pg_get_functiondef(p.oid) as definition
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.proname in ('has_business_role','is_business_member')
order by p.proname,p.oid::regprocedure::text;

-- Current base ledger columns, keys, checks, foreign keys and indexes.
select table_name,column_name,ordinal_position,data_type,is_nullable,column_default
from information_schema.columns
where table_schema='public' and table_name in (
  'ss_purchases','ss_sales','ss_sale_returns','ss_inventory_movements',
  'ss_sale_inventory_movements','ss_sale_return_inventory_movements',
  'ss_cashbook_entries','ss_sale_cashbook_entries','ss_sale_return_cashbook_entries'
)
order by table_name,ordinal_position;

select tbl.relname as table_name,con.conname as constraint_name,con.contype as constraint_type,
       pg_get_constraintdef(con.oid) as definition
from pg_constraint con join pg_class tbl on tbl.oid=con.conrelid
join pg_namespace n on n.oid=tbl.relnamespace
where n.nspname='public' and tbl.relname in (
  'ss_purchases','ss_sales','ss_sale_returns','ss_inventory_movements',
  'ss_sale_inventory_movements','ss_sale_return_inventory_movements',
  'ss_cashbook_entries','ss_sale_cashbook_entries','ss_sale_return_cashbook_entries'
)
order by tbl.relname,con.contype,con.conname;

select schemaname,tablename,indexname,indexdef
from pg_indexes
where schemaname='public' and tablename in (
  'ss_purchases','ss_sales','ss_sale_returns','ss_inventory_movements',
  'ss_sale_inventory_movements','ss_sale_return_inventory_movements',
  'ss_cashbook_entries','ss_sale_cashbook_entries','ss_sale_return_cashbook_entries'
)
order by tablename,indexname;

-- Existing RLS status, policies and table grants on source ledgers.
select n.nspname as schema_name,c.relname as table_name,c.relrowsecurity as rls_enabled,
       c.relforcerowsecurity as force_rls
from pg_class c join pg_namespace n on n.oid=c.relnamespace
where n.nspname='public' and c.relname in (
  'ss_purchases','ss_sales','ss_sale_returns','ss_inventory_movements',
  'ss_sale_inventory_movements','ss_sale_return_inventory_movements',
  'ss_cashbook_entries','ss_sale_cashbook_entries','ss_sale_return_cashbook_entries'
)
order by c.relname;

select schemaname,tablename,policyname,permissive,roles,cmd,qual,with_check
from pg_policies where schemaname='public' and tablename in (
  'ss_purchases','ss_sales','ss_sale_returns','ss_inventory_movements',
  'ss_sale_inventory_movements','ss_sale_return_inventory_movements',
  'ss_cashbook_entries','ss_sale_cashbook_entries','ss_sale_return_cashbook_entries'
)
order by tablename,policyname;

select table_name,grantee,privilege_type
from information_schema.role_table_grants
where table_schema='public' and grantee in ('anon','authenticated') and table_name in (
  'ss_purchases','ss_sales','ss_sale_returns','ss_inventory_movements',
  'ss_sale_inventory_movements','ss_sale_return_inventory_movements',
  'ss_cashbook_entries','ss_sale_cashbook_entries','ss_sale_return_cashbook_entries'
)
order by table_name,grantee,privilege_type;

-- Triggers and functions that may already create or maintain profile/ledger rows.
select event_object_table as table_name,trigger_name,event_manipulation,action_timing,action_statement
from information_schema.triggers
where trigger_schema='public' and event_object_table in (
  'ss_purchases','ss_sales','ss_sale_returns','ss_cashbook_entries',
  'ss_sale_cashbook_entries','ss_sale_return_cashbook_entries'
)
order by event_object_table,trigger_name,event_manipulation;

select n.nspname as schema_name,p.proname as function_name,p.oid::regprocedure as signature,
       p.prosecdef,p.proconfig,pg_get_functiondef(p.oid) as definition
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.proname in (
  'ss_business_report','ss_business_report_v2','ss_cashbook_page',
  'ss_post_purchase','ss_post_sale','ss_post_sale_return'
)
order by p.proname,p.oid::regprocedure::text;
