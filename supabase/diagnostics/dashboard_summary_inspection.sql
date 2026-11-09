-- Read-only preflight and review for the tenant-scoped dashboard summary RPC.
select table_name,column_name,data_type,is_nullable
from information_schema.columns
where table_schema='public' and table_name in ('ss_sales','ss_purchases')
order by table_name,ordinal_position;

select schemaname,tablename,policyname,roles,cmd,qual,with_check
from pg_policies where schemaname='public' and tablename in ('ss_sales','ss_purchases')
order by tablename,policyname;

select p.proname,pg_get_function_identity_arguments(p.oid) as arguments,
       pg_get_function_result(p.oid) as result,pg_get_functiondef(p.oid) as definition
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.proname in ('is_business_member','ss_dashboard_summary')
order by p.proname;

select routine_name,grantee,privilege_type
from information_schema.routine_privileges
where routine_schema='public' and routine_name='ss_dashboard_summary'
order by grantee,privilege_type;
