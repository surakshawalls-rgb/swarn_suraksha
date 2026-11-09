-- Read-only metadata inspection before migration 007. Returns no business records.
select table_name, column_name, data_type, is_nullable, column_default
from information_schema.columns
where table_schema='public' and table_name in (
  'customers','ss_metal_rate_snapshots','ss_suppliers','ss_purchases','ss_purchase_lines',
  'ss_purchase_payments','ss_inventory_movements','ss_cashbook_entries','ss_audit_events',
  'ss_sales','ss_sale_lines','ss_sale_payments','ss_sale_inventory_movements',
  'ss_sale_cashbook_entries','ss_sale_audit_events'
) order by table_name,ordinal_position;

select t.relname as table_name,c.conname,c.contype,pg_get_constraintdef(c.oid) as definition
from pg_constraint c join pg_class t on t.oid=c.conrelid join pg_namespace n on n.oid=t.relnamespace
where n.nspname='public' and t.relname in ('customers','ss_metal_rate_snapshots','ss_suppliers','ss_inventory_movements','ss_cashbook_entries','ss_audit_events')
order by t.relname,c.contype,c.conname;

select c.relname as table_name,c.relrowsecurity as rls_enabled,c.relforcerowsecurity as rls_forced
from pg_class c join pg_namespace n on n.oid=c.relnamespace
where n.nspname='public' and c.relname in ('customers','ss_metal_rate_snapshots','ss_suppliers','ss_purchases','ss_purchase_lines','ss_purchase_payments','ss_inventory_movements','ss_cashbook_entries','ss_audit_events')
order by c.relname;

select schemaname,tablename,policyname,roles,cmd,qual,with_check from pg_policies
where schemaname='public' and tablename in ('customers','ss_metal_rate_snapshots','ss_suppliers','ss_purchases','ss_purchase_lines','ss_purchase_payments','ss_inventory_movements','ss_cashbook_entries','ss_audit_events')
order by tablename,policyname;

select table_name,grantee,privilege_type,is_grantable from information_schema.role_table_grants
where table_schema='public' and table_name in ('customers','ss_metal_rate_snapshots','ss_suppliers','ss_purchases','ss_purchase_lines','ss_purchase_payments','ss_inventory_movements','ss_cashbook_entries','ss_audit_events')
and grantee in ('anon','authenticated','PUBLIC') order by table_name,grantee,privilege_type;

select table_name,column_name,grantee,privilege_type,is_grantable from information_schema.column_privileges
where table_schema='public' and table_name in ('ss_purchases','ss_purchase_lines','ss_purchase_payments','ss_inventory_movements','ss_cashbook_entries','ss_audit_events')
and grantee in ('anon','authenticated','PUBLIC') order by table_name,column_name,grantee,privilege_type;

select p.oid::regprocedure as function_name,p.prosecdef as security_definer,p.proconfig as settings,pg_get_functiondef(p.oid) as definition
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.proname in ('is_business_member','has_business_role','ss_post_purchase') order by function_name::text;
