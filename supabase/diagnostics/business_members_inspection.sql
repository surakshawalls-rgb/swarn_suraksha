-- Read-only metadata inspection for the hosted membership schema.
-- This does not select membership or customer data.

select column_name, data_type, is_nullable, column_default
from information_schema.columns
where table_schema = 'public' and table_name = 'business_members'
order by ordinal_position;

select c.conname, c.contype, pg_get_constraintdef(c.oid) as definition
from pg_constraint c
join pg_class t on t.oid = c.conrelid
join pg_namespace n on n.oid = t.relnamespace
where n.nspname = 'public' and t.relname = 'business_members'
order by c.contype, c.conname;

select c.relrowsecurity as rls_enabled, c.relforcerowsecurity as rls_forced
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relname = 'business_members';

select policyname, permissive, roles, cmd, qual, with_check
from pg_policies
where schemaname = 'public' and tablename = 'business_members'
order by policyname;

select grantee, privilege_type, is_grantable
from information_schema.role_table_grants
where table_schema = 'public' and table_name = 'business_members'
  and grantee in ('anon', 'authenticated', 'PUBLIC')
order by grantee, privilege_type;

-- Definitions of the business access helpers called from RLS policies.
select p.oid::regprocedure as function_name, pg_get_functiondef(p.oid) as definition
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('is_business_member', 'has_business_role')
order by function_name::text;
