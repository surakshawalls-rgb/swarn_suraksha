-- Read-only preflight for 008_account_payments.sql. Review results before applying.
select table_name,column_name,data_type,is_nullable,column_default
from information_schema.columns
where table_schema='public' and table_name in
 ('ss_purchases','ss_purchase_payments','ss_cashbook_entries','ss_sales','ss_sale_payments','ss_sale_cashbook_entries')
order by table_name,ordinal_position;

select c.relname as table_name,con.conname,con.contype,pg_get_constraintdef(con.oid) as definition
from pg_constraint con join pg_class c on c.oid=con.conrelid join pg_namespace n on n.oid=c.relnamespace
where n.nspname='public' and c.relname in ('ss_purchases','ss_purchase_payments','ss_cashbook_entries','ss_sales','ss_sale_payments','ss_sale_cashbook_entries')
order by c.relname,con.contype,con.conname;

select schemaname,tablename,policyname,roles,cmd,qual,with_check
from pg_policies where schemaname='public' and tablename in
 ('ss_purchases','ss_purchase_payments','ss_cashbook_entries','ss_sales','ss_sale_payments','ss_sale_cashbook_entries','ss_payment_audit_events')
order by tablename,policyname;

select c.relname as table_name,grantee,privilege_type
from information_schema.role_table_grants g join pg_class c on c.relname=g.table_name join pg_namespace n on n.oid=c.relnamespace
where g.table_schema='public' and n.nspname='public'
  and c.relname in ('ss_purchases','ss_purchase_payments','ss_cashbook_entries','ss_sales','ss_sale_payments','ss_sale_cashbook_entries','ss_payment_audit_events')
  and grantee in ('anon','authenticated')
order by c.relname,grantee,privilege_type;

select p.proname,pg_get_function_identity_arguments(p.oid) as arguments,
       pg_get_function_result(p.oid) as result,pg_get_functiondef(p.oid) as definition
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.proname in ('has_business_role','ss_post_purchase','ss_post_sale','ss_record_purchase_payment','ss_record_sale_payment')
order by p.proname;

select t.tgname,c.relname as table_name,pg_get_triggerdef(t.oid) as definition
from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace
where n.nspname='public' and not t.tgisinternal
  and c.relname in ('ss_purchases','ss_purchase_payments','ss_cashbook_entries','ss_sales','ss_sale_payments','ss_sale_cashbook_entries')
order by c.relname,t.tgname;
