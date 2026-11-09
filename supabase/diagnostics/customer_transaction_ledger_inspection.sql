-- Read-only preflight for 018_customer_transaction_ledger.sql.
select n.nspname as schema_name,c.relname as table_name,c.relrowsecurity as rls_enabled,c.relforcerowsecurity as force_rls
from pg_class c join pg_namespace n on n.oid=c.relnamespace
where n.nspname='public' and c.relname in ('customers','ss_sales','ss_sale_payments','ss_sale_returns','ss_sale_return_cashbook_entries')
order by c.relname;

select table_name,column_name,ordinal_position,data_type,is_nullable
from information_schema.columns where table_schema='public'
  and table_name in ('customers','ss_sales','ss_sale_payments','ss_sale_returns','ss_sale_return_cashbook_entries')
order by table_name,ordinal_position;

select tbl.relname as table_name,con.conname as constraint_name,con.contype as constraint_type,pg_get_constraintdef(con.oid) as definition
from pg_constraint con join pg_class tbl on tbl.oid=con.conrelid join pg_namespace n on n.oid=tbl.relnamespace
where n.nspname='public' and tbl.relname in ('customers','ss_sales','ss_sale_payments','ss_sale_returns','ss_sale_return_cashbook_entries')
order by tbl.relname,con.contype,con.conname;

select schemaname,tablename,policyname,permissive,roles,cmd,qual,with_check from pg_policies
where schemaname='public' and tablename in ('customers','ss_sales','ss_sale_payments','ss_sale_returns','ss_sale_return_cashbook_entries')
order by tablename,policyname;

select table_name,grantee,privilege_type from information_schema.role_table_grants
where table_schema='public' and grantee in ('anon','authenticated')
  and table_name in ('customers','ss_sales','ss_sale_payments','ss_sale_returns','ss_sale_return_cashbook_entries')
order by table_name,grantee,privilege_type;

select p.oid::regprocedure as signature,p.prosecdef,p.proconfig,pg_get_functiondef(p.oid) as definition
from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='is_business_member';
