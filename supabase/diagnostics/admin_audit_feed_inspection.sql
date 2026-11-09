-- Read-only preflight for 016_admin_audit_feed.sql.
-- Run before applying migration 016 and verify the expected hosted objects.
select n.nspname as schema_name,c.relname as table_name,c.relkind as object_kind,c.relrowsecurity as rls_enabled,c.relforcerowsecurity as force_rls
from pg_class c join pg_namespace n on n.oid=c.relnamespace
where n.nspname='public' and c.relname in (
  'ss_audit_events','ss_sale_audit_events','ss_payment_audit_events','ss_sale_return_audit_events','ss_expense_audit_events',
  'ss_purchase_receipt_events','ss_sale_receipt_events','ss_sale_return_receipt_events','ss_report_export_events'
) order by c.relname;

select table_name,column_name,ordinal_position,data_type,is_nullable
from information_schema.columns where table_schema='public' and table_name in (
  'ss_audit_events','ss_sale_audit_events','ss_payment_audit_events','ss_sale_return_audit_events','ss_expense_audit_events',
  'ss_purchase_receipt_events','ss_sale_receipt_events','ss_sale_return_receipt_events','ss_report_export_events'
) order by table_name,ordinal_position;

select schemaname,tablename,policyname,permissive,roles,cmd,qual,with_check from pg_policies
where schemaname='public' and tablename in (
  'ss_audit_events','ss_sale_audit_events','ss_payment_audit_events','ss_sale_return_audit_events','ss_expense_audit_events',
  'ss_purchase_receipt_events','ss_sale_receipt_events','ss_sale_return_receipt_events','ss_report_export_events'
) order by tablename,policyname;

select table_name,grantee,privilege_type from information_schema.role_table_grants
where table_schema='public' and grantee in ('anon','authenticated') and table_name in (
  'ss_audit_events','ss_sale_audit_events','ss_payment_audit_events','ss_sale_return_audit_events','ss_expense_audit_events',
  'ss_purchase_receipt_events','ss_sale_receipt_events','ss_sale_return_receipt_events','ss_report_export_events'
) order by table_name,grantee,privilege_type;

select p.oid::regprocedure as signature,p.prosecdef,p.proconfig,pg_get_functiondef(p.oid) as definition
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.proname='has_business_role';

select schemaname,tablename,indexname,indexdef from pg_indexes
where schemaname='public' and tablename in (
  'ss_audit_events','ss_sale_audit_events','ss_payment_audit_events','ss_sale_return_audit_events','ss_expense_audit_events',
  'ss_purchase_receipt_events','ss_sale_receipt_events','ss_sale_return_receipt_events','ss_report_export_events'
) order by tablename,indexname;
