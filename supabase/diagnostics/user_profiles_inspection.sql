-- Read-only inspection. Run in the Supabase SQL Editor before migration 003.
-- Results contain schema metadata only; no profile rows or credentials.

-- Columns, types, nullability, defaults
select ordinal_position, column_name, data_type, udt_name, is_nullable, column_default
from information_schema.columns
where table_schema = 'public' and table_name = 'user_profiles'
order by ordinal_position;

-- Primary/unique/foreign-key constraints and definitions
select c.conname, c.contype, pg_get_constraintdef(c.oid) as definition
from pg_constraint c
join pg_class t on t.oid = c.conrelid
join pg_namespace n on n.oid = t.relnamespace
where n.nspname = 'public' and t.relname = 'user_profiles'
order by c.contype, c.conname;

-- Indexes, including unique indexes
select indexname, indexdef
from pg_indexes
where schemaname = 'public' and tablename = 'user_profiles'
order by indexname;

-- RLS enabled/forced and all policies
select c.relrowsecurity as rls_enabled, c.relforcerowsecurity as rls_forced
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relname = 'user_profiles';
select policyname, permissive, roles, cmd, qual, with_check
from pg_policies
where schemaname = 'public' and tablename = 'user_profiles'
order by policyname;

-- Table-level grants for anon/authenticated
select grantee, privilege_type, is_grantable
from information_schema.role_table_grants
where table_schema = 'public' and table_name = 'user_profiles'
  and grantee in ('anon', 'authenticated', 'PUBLIC')
order by grantee, privilege_type;

-- Triggers and their functions
select trigger_name, event_manipulation, action_timing, action_statement
from information_schema.triggers
where event_object_schema = 'public' and event_object_table = 'user_profiles'
order by trigger_name, event_manipulation;
select distinct p.oid::regprocedure as function_name, pg_get_functiondef(p.oid) as definition
from pg_proc p
join pg_trigger t on t.tgfoid = p.oid
join pg_class c on c.oid = t.tgrelid
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relname = 'user_profiles' and not t.tgisinternal;

