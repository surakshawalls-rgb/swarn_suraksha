-- Read-only, tenant-checked stock summary and movement history over the
-- existing purchase, sale, and sale-return ledgers. Girvi custody is excluded.
do $preflight$
begin
  if to_regclass('public.ss_inventory_movements') is null
     or to_regclass('public.ss_sale_inventory_movements') is null
     or to_regclass('public.ss_sale_return_inventory_movements') is null
     or to_regprocedure('public.is_business_member(uuid)') is null then
    raise exception 'Verified owned inventory ledgers and membership helper are required before 015_owned_inventory_read_models';
  end if;
  perform public.is_business_member(null::uuid);
end
$preflight$;

create or replace function public.ss_owned_inventory_summary(p_business_id uuid)
returns table(metal text,purity text,owned_weight_g numeric)
language plpgsql stable security definer set search_path=''
as $function$
begin
  if (select auth.uid()) is null then raise exception 'Authentication required' using errcode='42501'; end if;
  if p_business_id is null or not public.is_business_member(p_business_id) then
    raise exception 'Workspace is missing or inventory access is not authorized' using errcode='42501';
  end if;
  return query
  select m.metal,m.purity,sum(m.weight_delta_g)::numeric
  from (
    select x.metal,x.purity,x.weight_delta_g from public.ss_inventory_movements x where x.business_id=p_business_id
    union all select x.metal,x.purity,x.weight_delta_g from public.ss_sale_inventory_movements x where x.business_id=p_business_id
    union all select x.metal,x.purity,x.weight_delta_g from public.ss_sale_return_inventory_movements x where x.business_id=p_business_id
  ) m group by m.metal,m.purity order by m.metal,m.purity nulls first;
end
$function$;
revoke all on function public.ss_owned_inventory_summary(uuid) from public,anon,authenticated;
grant execute on function public.ss_owned_inventory_summary(uuid) to authenticated;

create or replace function public.ss_owned_inventory_page(
  p_business_id uuid,p_metal text default null,p_from timestamptz default null,p_through timestamptz default null,
  p_offset integer default 0,p_limit integer default 100
) returns table(movement_id uuid,source_type text,source_id uuid,metal text,purity text,weight_delta_g numeric,recorded_at timestamptz,total_count bigint)
language plpgsql stable security definer set search_path=''
as $function$
begin
  if (select auth.uid()) is null then raise exception 'Authentication required' using errcode='42501'; end if;
  if p_business_id is null or not public.is_business_member(p_business_id) then
    raise exception 'Workspace is missing or inventory access is not authorized' using errcode='42501';
  end if;
  if p_metal is not null and p_metal not in ('gold','silver','other') then raise exception 'Unknown metal filter' using errcode='22023'; end if;
  if p_offset is null or p_offset<0 or p_offset>100000 or p_limit is null or p_limit<1 or p_limit>200 then
    raise exception 'Inventory page must contain 1 to 200 rows and use a valid offset' using errcode='22023';
  end if;
  if p_from is not null and p_through is not null and p_through<p_from then raise exception 'End timestamp must not precede start timestamp' using errcode='22023'; end if;
  return query
  with all_movements as (
    select x.id,'purchase'::text source_type,x.source_id,x.metal,x.purity,x.weight_delta_g,x.recorded_at from public.ss_inventory_movements x where x.business_id=p_business_id
    union all select x.id,'sale'::text,x.sale_id,x.metal,x.purity,x.weight_delta_g,x.recorded_at from public.ss_sale_inventory_movements x where x.business_id=p_business_id
    union all select x.id,'sale_return'::text,r.sale_id,x.metal,x.purity,x.weight_delta_g,x.recorded_at from public.ss_sale_return_inventory_movements x join public.ss_sale_returns r on r.business_id=x.business_id and r.id=x.sale_return_id where x.business_id=p_business_id
  ), filtered as (
    select x.* from all_movements x where (p_metal is null or x.metal=p_metal)
      and (p_from is null or x.recorded_at>=p_from) and (p_through is null or x.recorded_at<=p_through)
  )
  select f.id,f.source_type,f.source_id,f.metal,f.purity,f.weight_delta_g,f.recorded_at,count(*) over()::bigint
  from filtered f order by f.recorded_at desc,f.id desc limit p_limit offset p_offset;
end
$function$;
revoke all on function public.ss_owned_inventory_page(uuid,text,timestamptz,timestamptz,integer,integer) from public,anon,authenticated;
grant execute on function public.ss_owned_inventory_page(uuid,text,timestamptz,timestamptz,integer,integer) to authenticated;
