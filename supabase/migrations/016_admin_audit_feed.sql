-- Unified, read-only admin feed over immutable events already written by
-- financial posting, settlement, expense, receipt, and export workflows.
do $preflight$
begin
  if to_regclass('public.ss_audit_events') is null
     or to_regclass('public.ss_sale_audit_events') is null
     or to_regclass('public.ss_payment_audit_events') is null
     or to_regclass('public.ss_sale_return_audit_events') is null
     or to_regclass('public.ss_expense_audit_events') is null
     or to_regclass('public.ss_purchase_receipt_events') is null
     or to_regclass('public.ss_sale_receipt_events') is null
     or to_regclass('public.ss_sale_return_receipt_events') is null
     or to_regclass('public.ss_report_export_events') is null
     or to_regprocedure('public.has_business_role(uuid,text[])') is null then
    raise exception 'Verified audit-event tables and role helper are required before 016_admin_audit_feed';
  end if;
  perform public.has_business_role(null::uuid,array[]::text[]);
end
$preflight$;

create or replace function public.ss_admin_audit_page(
  p_business_id uuid,p_from timestamptz default null,p_through timestamptz default null,
  p_event_type text default null,p_offset integer default 0,p_limit integer default 100
) returns table(event_id uuid,event_type text,entity_type text,entity_id uuid,actor_user_id uuid,recorded_at timestamptz,safe_metadata jsonb,total_count bigint)
language plpgsql stable security definer set search_path=''
as $function$
begin
  if (select auth.uid()) is null then raise exception 'Authentication required' using errcode='42501'; end if;
  if p_business_id is null or not public.has_business_role(p_business_id,array['owner','admin']) then
    raise exception 'Workspace is missing or audit access is not authorized' using errcode='42501';
  end if;
  if p_offset is null or p_offset<0 or p_offset>100000 or p_limit is null or p_limit<1 or p_limit>200 then
    raise exception 'Audit page must contain 1 to 200 rows and use a valid offset' using errcode='22023';
  end if;
  if p_from is not null and p_through is not null and p_through<p_from then raise exception 'End timestamp must not precede start timestamp' using errcode='22023'; end if;
  return query
  with all_events as (
    select e.id,e.event_type,e.entity_type,e.entity_id,e.actor_user_id,e.recorded_at,e.safe_metadata from public.ss_audit_events e where e.business_id=p_business_id
    union all select e.id,e.event_type,'sale'::text,e.sale_id,e.actor_user_id,e.recorded_at,e.safe_metadata from public.ss_sale_audit_events e where e.business_id=p_business_id
    union all select e.id,e.event_type,case when e.purchase_id is not null then 'purchase_payment' else 'sale_payment' end,e.payment_id,e.actor_user_id,e.recorded_at,e.safe_metadata from public.ss_payment_audit_events e where e.business_id=p_business_id
    union all select e.id,e.event_type,'sale_return'::text,e.sale_return_id,e.actor_user_id,e.recorded_at,e.safe_metadata from public.ss_sale_return_audit_events e where e.business_id=p_business_id
    union all select e.id,e.event_type,'expense'::text,e.expense_id,e.actor_user_id,e.recorded_at,e.safe_metadata from public.ss_expense_audit_events e where e.business_id=p_business_id
    union all select e.id,'purchase.receipt_print_requested'::text,'purchase'::text,e.purchase_id,e.actor_user_id,e.recorded_at,jsonb_build_object('action',e.action) from public.ss_purchase_receipt_events e where e.business_id=p_business_id
    union all select e.id,'sale.receipt_print_requested'::text,'sale'::text,e.sale_id,e.actor_user_id,e.recorded_at,jsonb_build_object('action',e.action) from public.ss_sale_receipt_events e where e.business_id=p_business_id
    union all select e.id,'sale_return.receipt_print_requested'::text,'sale_return'::text,e.sale_return_id,e.actor_user_id,e.recorded_at,jsonb_build_object('action',e.action) from public.ss_sale_return_receipt_events e where e.business_id=p_business_id
    union all select e.id,e.report_type,'report_export'::text,e.id,e.actor_user_id,e.recorded_at,jsonb_build_object('from',e.range_from,'through',e.range_through) from public.ss_report_export_events e where e.business_id=p_business_id
  ), filtered as (
    select e.* from all_events e where (p_from is null or e.recorded_at>=p_from) and (p_through is null or e.recorded_at<=p_through)
      and (p_event_type is null or e.event_type=p_event_type)
  )
  select e.id,e.event_type,e.entity_type,e.entity_id,e.actor_user_id,e.recorded_at,e.safe_metadata,count(*) over()::bigint
  from filtered e order by e.recorded_at desc,e.id desc limit p_limit offset p_offset;
end
$function$;
revoke all on function public.ss_admin_audit_page(uuid,timestamptz,timestamptz,text,integer,integer) from public,anon,authenticated;
grant execute on function public.ss_admin_audit_page(uuid,timestamptz,timestamptz,text,integer,integer) to authenticated;
