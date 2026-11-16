do $preflight$
begin
  if to_regclass('public.ss_sales') is null
     or to_regclass('public.ss_sale_lines') is null
     or to_regprocedure('public.ss_post_sale(uuid,uuid,uuid,jsonb,jsonb)') is null
     or to_regprocedure('public.ss_return_sale_line(uuid,uuid,uuid,uuid,text,text)') is null
     or to_regprocedure('public.has_business_role(uuid,text[])') is null then
    raise exception 'Verified sales posting, returns, and authorization helpers are required before 027_sales_gst';
  end if;
  perform public.has_business_role(null::uuid,array[]::text[]);
end
$preflight$;

alter table public.ss_sales
  add column if not exists taxable_subtotal numeric(14,2) not null default 0,
  add column if not exists gst_percent numeric(5,2) not null default 0,
  add column if not exists gst_amount numeric(14,2) not null default 0;

alter table public.ss_sale_lines
  add column if not exists gst_amount numeric(14,2) not null default 0;

update public.ss_sales set taxable_subtotal=subtotal where taxable_subtotal=0;

do $constraints$
begin
  if not exists (select 1 from pg_constraint where conrelid='public.ss_sales'::regclass and conname='ss_sales_gst_percent_range') then
    alter table public.ss_sales add constraint ss_sales_gst_percent_range
      check (gst_percent between 0 and 10) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conrelid='public.ss_sales'::regclass and conname='ss_sales_tax_totals_reconcile') then
    alter table public.ss_sales add constraint ss_sales_tax_totals_reconcile
      check (subtotal=taxable_subtotal+gst_amount) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conrelid='public.ss_sale_lines'::regclass and conname='ss_sale_lines_gst_amount_nonnegative') then
    alter table public.ss_sale_lines add constraint ss_sale_lines_gst_amount_nonnegative
      check (gst_amount>=0) not valid;
  end if;
end
$constraints$;

alter table public.ss_sales validate constraint ss_sales_gst_percent_range;
alter table public.ss_sales validate constraint ss_sales_tax_totals_reconcile;
alter table public.ss_sale_lines validate constraint ss_sale_lines_gst_amount_nonnegative;

grant select (taxable_subtotal,gst_percent,gst_amount) on public.ss_sales to authenticated;
grant select (gst_amount) on public.ss_sale_lines to authenticated;

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
  computed_taxable_subtotal numeric(14,2) := 0;
  computed_gst numeric(14,2) := 0;
  computed_paid numeric(14,2) := 0;
  computed_line numeric(14,2);
  line_gst numeric(14,2);
  running_taxable numeric(14,2) := 0;
  running_gst numeric(14,2) := 0;
  payment_amount numeric;
  payment_method text;
  gross_weight numeric;
  net_weight numeric;
  making numeric;
  making_percent numeric;
  gst_percent numeric(5,2);
  line_gst_percent numeric(5,2);
  expected_making numeric(14,2);
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
    making_percent := (line->>'making_charge_percent')::numeric;
    line_gst_percent := (line->>'gst_percent')::numeric;
    if line_no=1 then gst_percent:=line_gst_percent;
    elsif line_gst_percent is distinct from gst_percent then
      raise exception 'Every invoice line must use the same GST rate' using errcode='22023';
    end if;
    if gross_weight <= 0 or net_weight <= 0 or net_weight > gross_weight or making < 0
       or making_percent is null or line_gst_percent is null
       or line_gst_percent not between 1 and 10 or line_gst_percent<>trunc(line_gst_percent)
       or line_gst_percent*100 <> trunc(line_gst_percent*100)
       or gross_weight*10000 <> trunc(gross_weight*10000) or net_weight*10000 <> trunc(net_weight*10000)
       or making*100 <> trunc(making*100) or making_percent*100 <> trunc(making_percent*100) then
      raise exception 'Item weights, charges, and GST rate are invalid or exceed supported precision' using errcode='22023';
    end if;
    if (line->>'metal'='gold' and making_percent not between 5 and 20)
       or (line->>'metal'<>'gold' and making_percent<>0) then
      raise exception 'Gold making charge must be between 5 and 20 percent; other metals must have no making charge' using errcode='22023';
    end if;
    if line->>'rate_snapshot_id' is null then raise exception 'A saved rate snapshot is required for every line' using errcode='22023'; end if;
    select shop_sell_rate into rate_value from public.ss_metal_rate_snapshots
      where id=(line->>'rate_snapshot_id')::uuid and business_id=p_business_id
        and metal=line->>'metal' and purity is not distinct from nullif(line->>'purity','')
        and unit='gram' and source_type='manual';
    if rate_value is null or rate_value <= 0 then raise exception 'The selected rate snapshot does not match this item and workspace' using errcode='22023'; end if;
    expected_making := case when line->>'metal'='gold'
      then round(net_weight*rate_value*making_percent/100,2) else 0 end;
    if making is distinct from expected_making then
      raise exception 'Making charge amount does not match the saved rate and percentage for item %',line_no using errcode='22023';
    end if;
    computed_line := round(net_weight*rate_value+making,2);
    if computed_line <= 0 then raise exception 'Sale line total must be greater than zero' using errcode='22023'; end if;
    computed_taxable_subtotal := computed_taxable_subtotal+computed_line;
  end loop;
  computed_gst:=round(computed_taxable_subtotal*gst_percent/100,2);
  computed_subtotal:=computed_taxable_subtotal+computed_gst;
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

  insert into public.ss_sales (business_id,customer_id,idempotency_key,request_payload,subtotal,taxable_subtotal,gst_percent,gst_amount,paid_total,created_by)
    values (p_business_id,p_customer_id,p_idempotency_key,payload,computed_subtotal,computed_taxable_subtotal,gst_percent,computed_gst,computed_paid,actor)
    returning id into sale_id;

  line_no := 0;
  for line in select value from jsonb_array_elements(p_lines) loop
    line_no := line_no+1;
    gross_weight := (line->>'gross_weight_g')::numeric;
    net_weight := (line->>'net_weight_g')::numeric;
    making_percent := (line->>'making_charge_percent')::numeric;
    line_gst_percent := (line->>'gst_percent')::numeric;
    select shop_sell_rate into rate_value from public.ss_metal_rate_snapshots
      where id=(line->>'rate_snapshot_id')::uuid and business_id=p_business_id;
    making := case when line->>'metal'='gold'
      then round(net_weight*rate_value*making_percent/100,2) else 0 end;
    computed_line := round(net_weight*rate_value+making,2);
    running_taxable:=running_taxable+computed_line;
    line_gst:=round(running_taxable*line_gst_percent/100,2)-running_gst;
    running_gst:=running_gst+line_gst;
    insert into public.ss_sale_lines (
      business_id,sale_id,line_number,item_description,metal,purity,gross_weight_g,net_weight_g,
      rate_snapshot_id,unit_rate_per_gram,making_charge,making_charge_percent,line_total,gst_amount
    ) values (
      p_business_id,sale_id,line_no,line->>'item_description',line->>'metal',nullif(line->>'purity',''),
      gross_weight,net_weight,(line->>'rate_snapshot_id')::uuid,rate_value,making,making_percent,computed_line,line_gst
    ) returning id into sale_line_id;
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
        'subtotal',computed_subtotal,'taxable_subtotal',computed_taxable_subtotal,
        'gst_percent',gst_percent,'gst_amount',computed_gst,'paid_total',computed_paid));
  return sale_id;
end
$function$;

revoke all on function public.ss_post_sale(uuid,uuid,uuid,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.ss_post_sale(uuid,uuid,uuid,jsonb,jsonb) to authenticated;

create or replace function public.ss_return_sale_line(
  p_business_id uuid,p_sale_id uuid,p_sale_line_id uuid,p_idempotency_key uuid,
  p_reason text,p_refund_method text default null
) returns uuid
language plpgsql security definer set search_path=''
as $function$
declare
  actor uuid := (select auth.uid());
  line public.ss_sale_lines%rowtype;
  sale_total numeric(14,2); sale_paid numeric(14,2); prior_reduction numeric(14,2); prior_refund numeric(14,2);
  line_amount numeric(14,2);
  outstanding numeric(14,2); paid_net numeric(14,2); reduce_due numeric(14,2); refund_amount numeric(14,2);
  old public.ss_sale_returns%rowtype; return_id uuid;
begin
  if actor is null then raise exception 'Authentication required' using errcode='42501'; end if;
  if p_business_id is null or not public.has_business_role(p_business_id,array['owner','admin']) then
    raise exception 'Return access is not authorized for this workspace' using errcode='42501';
  end if;
  if p_idempotency_key is null or length(trim(coalesce(p_reason,''))) not between 3 and 300
     or (p_refund_method is not null and p_refund_method not in ('cash','upi','bank_transfer','card')) then
    raise exception 'Return reason, refund method, or idempotency key is invalid' using errcode='22023';
  end if;
  select subtotal,paid_total into sale_total,sale_paid from public.ss_sales
    where id=p_sale_id and business_id=p_business_id for update;
  if not found then raise exception 'Sale not found in this workspace' using errcode='P0002'; end if;
  select * into old from public.ss_sale_returns where business_id=p_business_id and idempotency_key=p_idempotency_key;
  if found then
    if old.sale_id<>p_sale_id or old.sale_line_id<>p_sale_line_id or old.reason<>trim(p_reason)
       or old.refund_method is distinct from nullif(p_refund_method,'') then
      raise exception 'Idempotency key was used for a different return' using errcode='22023';
    end if;
    return old.id;
  end if;
  select * into line from public.ss_sale_lines where id=p_sale_line_id and sale_id=p_sale_id and business_id=p_business_id;
  if not found then raise exception 'Sale item not found on this invoice' using errcode='P0002'; end if;
  if exists(select 1 from public.ss_sale_returns where sale_line_id=p_sale_line_id) then
    raise exception 'This full invoice line has already been returned' using errcode='23505';
  end if;
  line_amount:=line.line_total+coalesce(line.gst_amount,0);
  select coalesce(sum(balance_reduction),0),coalesce(sum(cash_refund),0)
    into prior_reduction,prior_refund from public.ss_sale_returns where sale_id=p_sale_id;
  outstanding:=greatest(sale_total-sale_paid-prior_reduction,0);
  paid_net:=greatest(sale_paid-prior_refund,0);
  reduce_due:=least(line_amount,outstanding);
  refund_amount:=line_amount-reduce_due;
  if refund_amount>paid_net then
    raise exception 'Return exceeds the amount paid after the unpaid balance reduction' using errcode='22023';
  end if;
  if refund_amount>0 and p_refund_method is null then
    raise exception 'Choose a method for the customer refund' using errcode='22023';
  end if;
  insert into public.ss_sale_returns(business_id,sale_id,sale_line_id,idempotency_key,original_line_amount,balance_reduction,cash_refund,refund_method,reason,actor_user_id)
    values(p_business_id,p_sale_id,p_sale_line_id,p_idempotency_key,line_amount,reduce_due,refund_amount,nullif(p_refund_method,''),trim(p_reason),actor)
    returning id into return_id;
  insert into public.ss_sale_return_inventory_movements(business_id,sale_return_id,sale_line_id,metal,purity,weight_delta_g,actor_user_id)
    values(p_business_id,return_id,line.id,line.metal,line.purity,line.net_weight_g,actor);
  if refund_amount>0 then
    insert into public.ss_sale_return_cashbook_entries(business_id,sale_return_id,sale_id,amount,method,actor_user_id)
      values(p_business_id,return_id,p_sale_id,refund_amount,p_refund_method,actor);
  end if;
  insert into public.ss_sale_return_audit_events(business_id,sale_return_id,sale_id,actor_user_id,safe_metadata)
    values(p_business_id,return_id,p_sale_id,actor,jsonb_build_object('line_amount',line_amount,'balance_reduction',reduce_due,'cash_refund',refund_amount));
  return return_id;
end
$function$;

revoke all on function public.ss_return_sale_line(uuid,uuid,uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.ss_return_sale_line(uuid,uuid,uuid,uuid,text,text) to authenticated;
