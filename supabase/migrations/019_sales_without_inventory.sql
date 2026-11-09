-- Sales are financial transactions; this application does not track store stock.
do $preflight$
begin
  if to_regclass('public.ss_sales') is null
     or to_regclass('public.ss_sale_lines') is null
     or to_regclass('public.ss_sale_payments') is null
     or to_regclass('public.ss_sale_cashbook_entries') is null
     or to_regclass('public.ss_sale_audit_events') is null
     or to_regclass('public.ss_metal_rate_snapshots') is null
     or to_regprocedure('public.has_business_role(uuid,text[])') is null then
    raise exception 'Verified sales, payment, rate, audit tables and tenant role helper are required before 019_sales_without_inventory';
  end if;
  perform public.has_business_role(null::uuid, array[]::text[]);
end
$preflight$;

create or replace function public.ss_post_sale(
  p_business_id uuid,
  p_customer_id uuid,
  p_idempotency_key uuid,
  p_lines jsonb,
  p_payments jsonb
) returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  actor uuid := (select auth.uid());
  payload jsonb;
  old_payload jsonb;
  sale_id uuid;
  sale_line_id uuid;
  payment_id uuid;
  computed_subtotal numeric(14,2) := 0;
  computed_paid numeric(14,2) := 0;
  computed_line numeric(14,2);
  payment_amount numeric;
  payment_method text;
  gross_weight numeric;
  net_weight numeric;
  making numeric;
  rate_value numeric;
  line jsonb;
  payment jsonb;
  line_no integer := 0;
  customer_active boolean;
begin
  if actor is null then raise exception 'Authentication required' using errcode='42501'; end if;
  if not public.has_business_role(p_business_id,array['owner','admin']) then
    raise exception 'Not authorized to post sales for this business' using errcode='42501';
  end if;
  if p_idempotency_key is null then raise exception 'An idempotency key is required' using errcode='22023'; end if;
  if jsonb_typeof(p_lines) is distinct from 'array' or jsonb_array_length(p_lines) not between 1 and 100 then
    raise exception 'Sale requires between 1 and 100 item lines' using errcode='22023';
  end if;
  if jsonb_typeof(p_payments) is distinct from 'array' or jsonb_array_length(p_payments) > 20 then
    raise exception 'Payments must be an array with at most 20 entries' using errcode='22023';
  end if;

  payload := jsonb_build_object('customer_id',p_customer_id,'lines',p_lines,'payments',p_payments);
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_business_id::text || ':' || p_idempotency_key::text,0));
  select id,request_payload into sale_id,old_payload from public.ss_sales
    where business_id=p_business_id and idempotency_key=p_idempotency_key;
  if sale_id is not null then
    if old_payload <> payload then raise exception 'Idempotency key was already used for a different sale' using errcode='22023'; end if;
    return sale_id;
  end if;

  if p_customer_id is not null then
    select is_active into customer_active from public.customers
      where business_id=p_business_id and id=p_customer_id for share;
    if customer_active is distinct from true then raise exception 'Customer is missing or archived' using errcode='23503'; end if;
  end if;

  for line in select value from jsonb_array_elements(p_lines) loop
    line_no := line_no + 1;
    if nullif(trim(line->>'item_description'),'') is null or line->>'metal' not in ('gold','silver','other') then
      raise exception 'Item description or metal is invalid' using errcode='22023';
    end if;
    gross_weight := (line->>'gross_weight_g')::numeric;
    net_weight := (line->>'net_weight_g')::numeric;
    making := coalesce((line->>'making_charge')::numeric,0);
    if gross_weight <= 0 or net_weight <= 0 or net_weight > gross_weight or making < 0
       or gross_weight*10000 <> trunc(gross_weight*10000) or net_weight*10000 <> trunc(net_weight*10000)
       or making*100 <> trunc(making*100) then
      raise exception 'Item weights or making charge are invalid or exceed supported precision' using errcode='22023';
    end if;
    if line->>'rate_snapshot_id' is null then raise exception 'Select a manual rate snapshot for every line' using errcode='22023'; end if;
    select shop_sell_rate into rate_value from public.ss_metal_rate_snapshots
      where id=(line->>'rate_snapshot_id')::uuid and business_id=p_business_id
        and metal=line->>'metal' and purity is not distinct from nullif(line->>'purity','')
        and unit='gram' and source_type='manual';
    if rate_value is null or rate_value <= 0 then raise exception 'The selected rate snapshot does not match this item and workspace' using errcode='22023'; end if;
    computed_line := round(net_weight*rate_value+making,2);
    if computed_line <= 0 then raise exception 'Sale line total must be greater than zero' using errcode='22023'; end if;
    computed_subtotal := computed_subtotal+computed_line;
  end loop;
  if computed_subtotal <= 0 or computed_subtotal > 999999999999.99 then
    raise exception 'Sale total is outside the supported range' using errcode='22003';
  end if;

  for payment in select value from jsonb_array_elements(p_payments) loop
    payment_amount := (payment->>'amount')::numeric;
    payment_method := payment->>'method';
    if payment_amount <= 0 or payment_amount*100 <> trunc(payment_amount*100)
       or payment_method not in ('cash','upi','bank_transfer','card')
       or length(coalesce(payment->>'reference','')) > 120 then
      raise exception 'Payment amount, reference, or method is invalid' using errcode='22023';
    end if;
    computed_paid := computed_paid+payment_amount;
  end loop;
  if computed_paid > computed_subtotal then raise exception 'Payments cannot exceed the sale total' using errcode='22023'; end if;

  insert into public.ss_sales (business_id,customer_id,idempotency_key,request_payload,subtotal,paid_total,created_by)
    values (p_business_id,p_customer_id,p_idempotency_key,payload,computed_subtotal,computed_paid,actor)
    returning id into sale_id;

  line_no := 0;
  for line in select value from jsonb_array_elements(p_lines) loop
    line_no := line_no+1;
    gross_weight := (line->>'gross_weight_g')::numeric;
    net_weight := (line->>'net_weight_g')::numeric;
    making := coalesce((line->>'making_charge')::numeric,0);
    select shop_sell_rate into rate_value from public.ss_metal_rate_snapshots
      where id=(line->>'rate_snapshot_id')::uuid and business_id=p_business_id;
    computed_line := round(net_weight*rate_value+making,2);
    insert into public.ss_sale_lines (business_id,sale_id,line_number,item_description,metal,purity,gross_weight_g,net_weight_g,rate_snapshot_id,unit_rate_per_gram,making_charge,line_total)
      values (p_business_id,sale_id,line_no,line->>'item_description',line->>'metal',nullif(line->>'purity',''),
        gross_weight,net_weight,(line->>'rate_snapshot_id')::uuid,rate_value,making,computed_line)
      returning id into sale_line_id;
  end loop;

  for payment in select value from jsonb_array_elements(p_payments) loop
    insert into public.ss_sale_payments (business_id,sale_id,method,amount,reference,received_by)
      values (p_business_id,sale_id,payment->>'method',(payment->>'amount')::numeric,
        nullif(trim(payment->>'reference'),''),actor)
      returning id into payment_id;
    insert into public.ss_sale_cashbook_entries (business_id,sale_id,sale_payment_id,amount,method,actor_user_id)
      values (p_business_id,sale_id,payment_id,(payment->>'amount')::numeric,payment->>'method',actor);
  end loop;
  insert into public.ss_sale_audit_events (business_id,actor_user_id,event_type,sale_id,safe_metadata)
    values (p_business_id,actor,'sale.posted',sale_id,
      jsonb_build_object('invoice_number',(select invoice_number from public.ss_sales where id=sale_id),
        'line_count',jsonb_array_length(p_lines),'payment_count',jsonb_array_length(p_payments),
        'subtotal',computed_subtotal,'paid_total',computed_paid));
  return sale_id;
end
$function$;

revoke all on function public.ss_post_sale(uuid,uuid,uuid,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.ss_post_sale(uuid,uuid,uuid,jsonb,jsonb) to authenticated;
