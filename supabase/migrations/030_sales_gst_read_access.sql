do $preflight$
begin
  if to_regclass('public.ss_sales') is null
     or to_regclass('public.ss_sale_lines') is null
     or not exists (
       select 1 from information_schema.columns
       where table_schema='public' and table_name='ss_sales' and column_name='taxable_subtotal'
     )
     or not exists (
       select 1 from information_schema.columns
       where table_schema='public' and table_name='ss_sales' and column_name='gst_percent'
     )
     or not exists (
       select 1 from information_schema.columns
       where table_schema='public' and table_name='ss_sales' and column_name='gst_amount'
     )
     or not exists (
       select 1 from information_schema.columns
       where table_schema='public' and table_name='ss_sale_lines' and column_name='gst_amount'
     ) then
    raise exception 'GST sales columns and tables must exist before 030_sales_gst_read_access';
  end if;
end
$preflight$;

grant select (taxable_subtotal,gst_percent,gst_amount) on public.ss_sales to authenticated;
grant select (gst_amount) on public.ss_sale_lines to authenticated;
