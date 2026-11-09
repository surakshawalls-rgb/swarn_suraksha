-- Purpose: grant browser clients only operations already constrained by the
-- foundation migration's RLS policies. No anonymous access or delete privileges.
-- Safe to reapply; grants are additive and require authenticated users.

grant usage on schema public to authenticated;

grant select, insert, update on public.user_profiles to authenticated;
grant select, update on public.business_profiles to authenticated;
grant select on public.business_members to authenticated;
grant select, update on public.business_settings to authenticated;
grant select, insert, update on public.customers to authenticated;
grant select on public.audit_logs to authenticated;

-- No DELETE grants are given. RLS remains enabled and scopes every operation
-- to active business membership and role.
