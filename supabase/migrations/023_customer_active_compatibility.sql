-- Sales posting routines use is_active, while some deployed customer schemas
-- expose archival state as status. Provide a read-only compatibility column.
do $migration$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='customers' and column_name='is_active'
  ) then
    if exists (
      select 1 from information_schema.columns
      where table_schema='public' and table_name='customers' and column_name='status'
    ) then
      alter table public.customers
        add column is_active boolean generated always as (status='active') stored;
    else
      raise exception 'Customer status column is required to add is_active compatibility for sales posting';
    end if;
  end if;
end
$migration$;
