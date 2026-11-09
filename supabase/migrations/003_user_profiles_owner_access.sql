-- Versioned, additive access fix for one-profile-per-authenticated-user.
-- This migration changes policies/grants only; it preserves all profile rows.
-- It aborts unless user_id is UUID NOT NULL and is uniquely indexed by itself.
do $migration$
declare
  user_id_attnum smallint;
  user_id_type oid;
  user_id_not_null boolean;
  has_user_id_unique boolean;
begin
  if to_regclass('public.user_profiles') is null then
    raise exception 'public.user_profiles is missing; inspect the live schema before applying this migration';
  end if;

  select a.attnum, a.atttypid, a.attnotnull
    into user_id_attnum, user_id_type, user_id_not_null
  from pg_attribute a
  where a.attrelid = 'public.user_profiles'::regclass
    and a.attname = 'user_id' and a.attnum > 0 and not a.attisdropped;

  if user_id_attnum is null or user_id_type <> 'uuid'::regtype or not user_id_not_null then
    raise exception 'user_profiles.user_id must be UUID NOT NULL; inspect the live schema before applying this migration';
  end if;

  select exists (
    select 1
    from pg_index i
    where i.indrelid = 'public.user_profiles'::regclass
      and i.indisunique and i.indisvalid and i.indpred is null
      and i.indnkeyatts = 1 and i.indkey[0] = user_id_attnum
  ) into has_user_id_unique;

  if not has_user_id_unique then
    raise exception 'user_profiles.user_id has no single-column unique constraint/index; inspect duplicates and existing profile design before proceeding';
  end if;

  alter table public.user_profiles enable row level security;

  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'user_profiles' and policyname = 'ss_user_profiles_select_own') then
    execute 'create policy ss_user_profiles_select_own on public.user_profiles for select to authenticated using (user_id = (select auth.uid()))';
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'user_profiles' and policyname = 'ss_user_profiles_insert_own') then
    execute 'create policy ss_user_profiles_insert_own on public.user_profiles for insert to authenticated with check (user_id = (select auth.uid()))';
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'user_profiles' and policyname = 'ss_user_profiles_update_own') then
    execute 'create policy ss_user_profiles_update_own on public.user_profiles for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()))';
  end if;

  -- Restrictive policies ensure an existing permissive policy cannot broaden ownership.
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'user_profiles' and policyname = 'ss_user_profiles_select_own_restrict') then
    execute 'create policy ss_user_profiles_select_own_restrict on public.user_profiles as restrictive for select to authenticated using (user_id = (select auth.uid()))';
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'user_profiles' and policyname = 'ss_user_profiles_insert_own_restrict') then
    execute 'create policy ss_user_profiles_insert_own_restrict on public.user_profiles as restrictive for insert to authenticated with check (user_id = (select auth.uid()))';
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'user_profiles' and policyname = 'ss_user_profiles_update_own_restrict') then
    execute 'create policy ss_user_profiles_update_own_restrict on public.user_profiles as restrictive for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()))';
  end if;

  revoke all privileges on table public.user_profiles from public, anon;
  grant select, insert, update on table public.user_profiles to authenticated;
end
$migration$;
