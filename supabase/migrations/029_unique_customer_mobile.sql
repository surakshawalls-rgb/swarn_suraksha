do $migration$
declare
  archive_status text;
  status_candidate text;
  merge_config jsonb := jsonb_build_array(
    jsonb_build_object(
      'business_id','82223c89-194b-4199-8f44-d8b109c972e3',
      'phone','8090272727',
      'survivor_id','7cfb7b01-324a-4134-a036-b4baa8927b37',
      'duplicate_id','5d53d0b3-2f43-4c34-88d7-70b79933f299'
    ),
    jsonb_build_object(
      'business_id','82223c89-194b-4199-8f44-d8b109c972e3',
      'phone','9506629814',
      'survivor_id','355f70a1-8fbb-4496-975d-5fe28f1d51a4',
      'duplicate_id','2454d790-ede0-4edd-835a-ac8ee59c2297'
    )
  );
begin
  if to_regclass('public.customers') is null
     or to_regclass('public.ss_sales') is null
     or to_regclass('public.ss_girvi') is null
     or to_regclass('public.ss_sale_exchanges') is null
     or to_regclass('public.ss_customer_account_adjustments') is null
     or to_regclass('public.ss_customer_outstanding_exchange_postings') is null
     or to_regclass('public.ss_customer_outstanding_exchanges') is null then
    raise exception 'Customer and financial history tables required before 029_unique_customer_mobile are missing';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_index i
    where i.indexrelid=to_regclass('public.customers_business_normalized_phone_uidx')
      and i.indisvalid
  ) then
    return;
  end if;

  if to_regclass('public.customers_business_normalized_phone_uidx') is not null then
    execute 'drop index public.customers_business_normalized_phone_uidx';
  end if;

  lock table public.customers,public.ss_sales,public.ss_girvi,public.ss_sale_exchanges,
    public.ss_customer_account_adjustments,public.ss_customer_outstanding_exchange_postings,
    public.ss_customer_outstanding_exchanges in share row exclusive mode;

  if exists (
    select 1
    from jsonb_to_recordset(merge_config) as m(business_id uuid,phone text,survivor_id uuid,duplicate_id uuid)
    where not exists (
      select 1 from public.customers c
      where c.business_id=m.business_id and c.id=m.survivor_id and c.status='active'
        and nullif(regexp_replace(coalesce(c.phone,''),'[^0-9]','','g'),'')=m.phone
    )
    or not exists (
      select 1 from public.customers c
      where c.business_id=m.business_id and c.id=m.duplicate_id and c.status='active'
        and nullif(regexp_replace(coalesce(c.phone,''),'[^0-9]','','g'),'')=m.phone
    )
  ) then
    raise exception 'Customer merge preflight failed: one or more selected customer profiles no longer match the expected active business/mobile pair';
  end if;

  if exists (
    with targets as (
      select distinct business_id,phone
      from jsonb_to_recordset(merge_config) as m(business_id uuid,phone text,survivor_id uuid,duplicate_id uuid)
    )
    select 1
    from targets t
    join public.customers c on c.business_id=t.business_id
      and nullif(regexp_replace(coalesce(c.phone,''),'[^0-9]','','g'),'')=t.phone
    group by t.business_id,t.phone
    having count(*)<>2
  ) then
    raise exception 'Customer merge preflight failed: an expected mobile number has additional or missing profiles';
  end if;

  if exists (
    select 1
    from public.customers c
    cross join lateral (
      select nullif(regexp_replace(coalesce(c.phone,''),'[^0-9]','','g'),'') as phone
    ) normalized
    where normalized.phone is not null
      and not exists (
        select 1 from jsonb_to_recordset(merge_config) as m(business_id uuid,phone text,survivor_id uuid,duplicate_id uuid)
        where m.business_id=c.business_id and m.phone=normalized.phone
      )
    group by c.business_id,normalized.phone
    having count(*)>1
  ) then
    raise exception 'Customer merge preflight failed: there are duplicate mobile numbers beyond the two approved pairs';
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(merge_config) as m(business_id uuid,phone text,survivor_id uuid,duplicate_id uuid)
    join public.ss_customer_account_adjustments source_row
      on source_row.business_id=m.business_id and source_row.customer_id=m.duplicate_id
    join public.ss_customer_account_adjustments survivor_row
      on survivor_row.business_id=m.business_id and survivor_row.customer_id=m.survivor_id
        and survivor_row.idempotency_key=source_row.idempotency_key
  ) or exists (
    select 1
    from jsonb_to_recordset(merge_config) as m(business_id uuid,phone text,survivor_id uuid,duplicate_id uuid)
    join public.ss_customer_outstanding_exchange_postings source_row
      on source_row.business_id=m.business_id and source_row.customer_id=m.duplicate_id
    join public.ss_customer_outstanding_exchange_postings survivor_row
      on survivor_row.business_id=m.business_id and survivor_row.customer_id=m.survivor_id
        and survivor_row.idempotency_key=source_row.idempotency_key
  ) then
    raise exception 'Customer merge preflight failed: financial idempotency keys would collide after consolidation';
  end if;

  with merge_map as (
    select * from jsonb_to_recordset(merge_config)
      as m(business_id uuid,phone text,survivor_id uuid,duplicate_id uuid)
  )
  update public.ss_sales row_to_merge
    set customer_id=m.survivor_id
    from merge_map m
    where row_to_merge.business_id=m.business_id and row_to_merge.customer_id=m.duplicate_id;

  with merge_map as (
    select * from jsonb_to_recordset(merge_config)
      as m(business_id uuid,phone text,survivor_id uuid,duplicate_id uuid)
  )
  update public.ss_girvi row_to_merge
    set customer_id=m.survivor_id
    from merge_map m
    where row_to_merge.business_id=m.business_id and row_to_merge.customer_id=m.duplicate_id;

  with merge_map as (
    select * from jsonb_to_recordset(merge_config)
      as m(business_id uuid,phone text,survivor_id uuid,duplicate_id uuid)
  )
  update public.ss_sale_exchanges row_to_merge
    set customer_id=m.survivor_id
    from merge_map m
    where row_to_merge.business_id=m.business_id and row_to_merge.customer_id=m.duplicate_id;

  with merge_map as (
    select * from jsonb_to_recordset(merge_config)
      as m(business_id uuid,phone text,survivor_id uuid,duplicate_id uuid)
  )
  update public.ss_customer_account_adjustments row_to_merge
    set customer_id=m.survivor_id
    from merge_map m
    where row_to_merge.business_id=m.business_id and row_to_merge.customer_id=m.duplicate_id;

  with merge_map as (
    select * from jsonb_to_recordset(merge_config)
      as m(business_id uuid,phone text,survivor_id uuid,duplicate_id uuid)
  )
  update public.ss_customer_outstanding_exchange_postings row_to_merge
    set customer_id=m.survivor_id
    from merge_map m
    where row_to_merge.business_id=m.business_id and row_to_merge.customer_id=m.duplicate_id;

  with merge_map as (
    select * from jsonb_to_recordset(merge_config)
      as m(business_id uuid,phone text,survivor_id uuid,duplicate_id uuid)
  )
  update public.ss_customer_outstanding_exchanges row_to_merge
    set customer_id=m.survivor_id
    from merge_map m
    where row_to_merge.business_id=m.business_id and row_to_merge.customer_id=m.duplicate_id;

  foreach status_candidate in array array['inactive','disabled','deleted','archived'] loop
    begin
      with merge_map as (
        select * from jsonb_to_recordset(merge_config)
          as m(business_id uuid,phone text,survivor_id uuid,duplicate_id uuid)
      )
      update public.customers source_customer
        set status=status_candidate,
            phone=null,
            notes=concat_ws(E'\n',nullif(source_customer.notes,''),format('Duplicate profile consolidated into customer %s by migration 029.',m.survivor_id))
        from merge_map m
        where source_customer.business_id=m.business_id and source_customer.id=m.duplicate_id;

      archive_status:=status_candidate;
      exit;
    exception when check_violation then
      null;
    end;
  end loop;

  if archive_status is null then
    raise exception 'Customer merge failed: none of the supported inactive status values is allowed by customers_status_check';
  end if;

  if exists (
    select 1
    from public.customers c
    cross join lateral (
      select nullif(regexp_replace(coalesce(c.phone,''),'[^0-9]','','g'),'') as phone
    ) normalized
    where normalized.phone is not null
    group by c.business_id,normalized.phone
    having count(*)>1
  ) then
    raise exception 'Customer merge failed: duplicate mobile numbers remain; all changes in migration 029 were rolled back';
  end if;

  execute $index$
    create unique index customers_business_normalized_phone_uidx
    on public.customers (
      business_id,
      (nullif(regexp_replace(coalesce(phone,''),'[^0-9]','','g'),''))
    )
    where nullif(regexp_replace(coalesce(phone,''),'[^0-9]','','g'),'') is not null
  $index$;
end
$migration$;
