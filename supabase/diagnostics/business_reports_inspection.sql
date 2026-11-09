-- Read-only preflight before migrations 009_dashboard_summary and 010_business_reports.
select table_name,column_name,data_type,is_nullable
from information_schema.columns
where table_schema='public' and table_name in (
 'ss_sales','ss_purchases','ss_sale_cashbook_entries','ss_cashbook_entries',
 'ss_inventory_movements','ss_sale_inventory_movements'
)
order by table_name,ordinal_position;

select schemaname,tablename,policyname,roles,cmd,qual,with_check
from pg_policies
where schemaname='public' and tablename in (
 'ss_sales','ss_purchases','ss_sale_cashbook_entries','ss_cashbook_entries',
 'ss_inventory_movements','ss_sale_inventory_movements','ss_report_export_events','ss_sale_receipt_events'
)
order by tablename,policyname;

select p.proname,pg_get_function_identity_arguments(p.oid) as arguments,
       pg_get_function_result(p.oid) as result,pg_get_functiondef(p.oid) as definition
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.proname in ('is_business_member','has_business_role','ss_dashboard_summary','ss_business_report','ss_audit_report_export','ss_audit_sale_receipt_print')
order by p.proname;

select routine_name,grantee,privilege_type
from information_schema.routine_privileges
where routine_schema='public' and routine_name in ('ss_dashboard_summary','ss_business_report','ss_audit_report_export','ss_audit_sale_receipt_print')
order by routine_name,grantee,privilege_type;
