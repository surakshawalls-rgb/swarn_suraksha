-- Read-only metadata inspection for 013_cashbook_paging.
select table_name,column_name,data_type,is_nullable,column_default
from information_schema.columns
where table_schema='public' and table_name in ('ss_cashbook_entries','ss_sale_cashbook_entries','ss_sale_return_cashbook_entries')
order by table_name,ordinal_position;

select t.relname table_name,c.conname,c.contype,pg_get_constraintdef(c.oid) definition
from pg_constraint c join pg_class t on t.oid=c.conrelid join pg_namespace n on n.oid=t.relnamespace
where n.nspname='public' and t.relname in ('ss_cashbook_entries','ss_sale_cashbook_entries','ss_sale_return_cashbook_entries')
order by t.relname,c.contype,c.conname;

select schemaname,tablename,indexname,indexdef from pg_indexes
where schemaname='public' and tablename in ('ss_cashbook_entries','ss_sale_cashbook_entries','ss_sale_return_cashbook_entries')
order by tablename,indexname;

select c.relname table_name,c.relrowsecurity rls_enabled,c.relforcerowsecurity rls_forced
from pg_class c join pg_namespace n on n.oid=c.relnamespace
where n.nspname='public' and c.relname in ('ss_cashbook_entries','ss_sale_cashbook_entries','ss_sale_return_cashbook_entries')
order by c.relname;

select schemaname,tablename,policyname,roles,cmd,qual,with_check from pg_policies
where schemaname='public' and tablename in ('ss_cashbook_entries','ss_sale_cashbook_entries','ss_sale_return_cashbook_entries')
order by tablename,policyname;

select p.oid::regprocedure function_name,p.prosecdef security_definer,p.proconfig,pg_get_functiondef(p.oid) definition
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.proname in ('is_business_member','ss_cashbook_page') order by function_name::text;
