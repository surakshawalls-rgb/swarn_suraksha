-- Read-only preflight for 012_sales_returns. Inspect hosted objects first;
-- this query changes no data and reveals no business records.
select table_name,column_name,data_type,is_nullable,column_default
from information_schema.columns
where table_schema='public' and table_name in (
  'ss_sales','ss_sale_lines','ss_sale_payments','ss_sale_cashbook_entries',
  'ss_sale_inventory_movements','ss_payment_audit_events','ss_sale_returns','ss_sale_return_inventory_movements',
  'ss_sale_return_cashbook_entries','ss_sale_return_audit_events','ss_sale_return_receipt_events'
) order by table_name,ordinal_position;

select t.relname table_name,c.conname,c.contype,pg_get_constraintdef(c.oid) definition
from pg_constraint c join pg_class t on t.oid=c.conrelid join pg_namespace n on n.oid=t.relnamespace
where n.nspname='public' and t.relname in ('ss_sales','ss_sale_lines','ss_sale_payments','ss_sale_cashbook_entries','ss_sale_inventory_movements','ss_payment_audit_events','ss_sale_returns','ss_sale_return_inventory_movements','ss_sale_return_cashbook_entries','ss_sale_return_audit_events','ss_sale_return_receipt_events')
order by t.relname,c.contype,c.conname;

select schemaname,tablename,indexname,indexdef from pg_indexes
where schemaname='public' and tablename in ('ss_sales','ss_sale_lines','ss_sale_payments','ss_sale_cashbook_entries','ss_sale_inventory_movements','ss_sale_returns','ss_sale_return_inventory_movements','ss_sale_return_cashbook_entries','ss_sale_return_audit_events','ss_sale_return_receipt_events')
order by tablename,indexname;

select c.relname table_name,c.relrowsecurity rls_enabled,c.relforcerowsecurity rls_forced
from pg_class c join pg_namespace n on n.oid=c.relnamespace
where n.nspname='public' and c.relname in ('ss_sales','ss_sale_lines','ss_sale_payments','ss_sale_cashbook_entries','ss_sale_inventory_movements','ss_payment_audit_events','ss_sale_returns','ss_sale_return_inventory_movements','ss_sale_return_cashbook_entries','ss_sale_return_audit_events','ss_sale_return_receipt_events')
order by c.relname;

select schemaname,tablename,policyname,roles,cmd,qual,with_check
from pg_policies where schemaname='public' and tablename in
  ('ss_sales','ss_sale_lines','ss_sale_payments','ss_sale_cashbook_entries','ss_sale_inventory_movements','ss_payment_audit_events','ss_sale_returns','ss_sale_return_inventory_movements','ss_sale_return_cashbook_entries','ss_sale_return_audit_events','ss_sale_return_receipt_events')
order by tablename,policyname;

select table_name,grantee,privilege_type,is_grantable from information_schema.role_table_grants
where table_schema='public' and table_name in ('ss_sales','ss_sale_lines','ss_sale_payments','ss_sale_cashbook_entries','ss_sale_inventory_movements','ss_sale_returns','ss_sale_return_inventory_movements','ss_sale_return_cashbook_entries','ss_sale_return_audit_events','ss_sale_return_receipt_events')
  and grantee in ('anon','authenticated','PUBLIC') order by table_name,grantee,privilege_type;

select p.oid::regprocedure function_name,p.prosecdef security_definer,p.proconfig,pg_get_functiondef(p.oid) definition
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.proname in ('ss_post_sale','ss_record_sale_payment','is_business_member','has_business_role','ss_dashboard_summary','ss_business_report','ss_business_report_v2','ss_return_sale_line','ss_audit_sale_return_receipt_print')
order by function_name::text;

select event_object_table as table_name,trigger_name,event_manipulation,action_timing,action_statement
from information_schema.triggers
where event_object_schema='public' and event_object_table in
  ('ss_sales','ss_sale_lines','ss_sale_payments','ss_sale_cashbook_entries','ss_sale_inventory_movements','ss_sale_returns','ss_sale_return_inventory_movements','ss_sale_return_cashbook_entries','ss_sale_return_audit_events','ss_sale_return_receipt_events')
order by event_object_table,trigger_name;
