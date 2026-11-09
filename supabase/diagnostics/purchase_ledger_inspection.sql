-- Read-only metadata inspection for migration 006. Returns no business records.
select table_name, column_name, data_type, is_nullable, column_default
from information_schema.columns
where table_schema='public' and table_name in (
  'ss_suppliers','ss_purchases','ss_purchase_lines','ss_purchase_payments',
  'ss_inventory_movements','ss_cashbook_entries','ss_audit_events','ss_purchase_receipt_events'
)
order by table_name, ordinal_position;

select t.relname as table_name, c.conname, c.contype, pg_get_constraintdef(c.oid) as definition
from pg_constraint c join pg_class t on t.oid=c.conrelid join pg_namespace n on n.oid=t.relnamespace
where n.nspname='public' and t.relname in (
  'ss_suppliers','ss_purchases','ss_purchase_lines','ss_purchase_payments',
  'ss_inventory_movements','ss_cashbook_entries','ss_audit_events','ss_purchase_receipt_events'
)
order by t.relname, c.contype, c.conname;

select c.relname as table_name, c.relrowsecurity as rls_enabled, c.relforcerowsecurity as rls_forced
from pg_class c join pg_namespace n on n.oid=c.relnamespace
where n.nspname='public' and c.relname in (
  'ss_suppliers','ss_purchases','ss_purchase_lines','ss_purchase_payments',
  'ss_inventory_movements','ss_cashbook_entries','ss_audit_events','ss_purchase_receipt_events'
)
order by c.relname;

select schemaname, tablename, policyname, roles, cmd, qual, with_check
from pg_policies where schemaname='public' and tablename in (
  'ss_suppliers','ss_purchases','ss_purchase_lines','ss_purchase_payments',
  'ss_inventory_movements','ss_cashbook_entries','ss_audit_events','ss_purchase_receipt_events'
) order by tablename, policyname;

select table_name, grantee, privilege_type, is_grantable
from information_schema.role_table_grants
where table_schema='public' and table_name in (
  'ss_suppliers','ss_purchases','ss_purchase_lines','ss_purchase_payments',
  'ss_inventory_movements','ss_cashbook_entries','ss_audit_events','ss_purchase_receipt_events'
) and grantee in ('anon','authenticated','PUBLIC')
order by table_name, grantee, privilege_type;

select table_name, column_name, grantee, privilege_type, is_grantable
from information_schema.column_privileges
where table_schema='public' and table_name in (
  'ss_purchases','ss_purchase_lines','ss_purchase_payments','ss_inventory_movements',
  'ss_cashbook_entries','ss_audit_events','ss_purchase_receipt_events'
) and grantee in ('anon','authenticated','PUBLIC')
order by table_name,column_name,grantee,privilege_type;

select p.oid::regprocedure as function_name, p.prosecdef as security_definer,
       p.proconfig as settings, pg_get_functiondef(p.oid) as definition
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.proname in ('ss_post_purchase','ss_audit_purchase_receipt_print','is_business_member','has_business_role')
order by function_name::text;
