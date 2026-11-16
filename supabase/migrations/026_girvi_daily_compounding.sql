do $preflight$
begin
  if to_regclass('public.ss_girvi') is null
     or to_regclass('public.ss_girvi_payments') is null
     or to_regclass('public.ss_girvi_audit_events') is null
     or to_regprocedure('public.has_business_role(uuid,text[])') is null
     or to_regprocedure('public.ss_girvi_completed_months(date,date)') is null then
    raise exception 'Girvi tables and verified tenant role helpers are required before daily compounding';
  end if;
end
$preflight$;

alter table public.ss_girvi add column last_accrued_date date;

update public.ss_girvi pledge
set last_accrued_date = greatest(
  (pledge.girvi_date + make_interval(months => pledge.last_accrued_months))::date,
  coalesce((
    select max(payment.payment_date)
    from public.ss_girvi_payments payment
    where payment.business_id = pledge.business_id
      and payment.girvi_id = pledge.id
  ), pledge.girvi_date)
);

alter table public.ss_girvi alter column last_accrued_date set not null;
alter table public.ss_girvi
  add constraint ss_girvi_last_accrued_date_check check (last_accrued_date >= girvi_date);

create function public.ss_girvi_initialize_accrual_date()
returns trigger language plpgsql set search_path=''
as $function$
begin
  if new.last_accrued_date is null then
    new.last_accrued_date:=new.girvi_date;
  end if;
  return new;
end
$function$;
revoke all on function public.ss_girvi_initialize_accrual_date() from public,anon,authenticated;
create trigger ss_girvi_initialize_accrual_date
before insert on public.ss_girvi
for each row execute function public.ss_girvi_initialize_accrual_date();

create or replace function public.ss_girvi_record_payment(
  p_business_id uuid,p_girvi_id uuid,p_idempotency_key uuid,p_amount numeric,p_method text,p_payment_date date default current_date
) returns jsonb
language plpgsql security definer set search_path=''
as $function$
declare
  actor uuid:=(select auth.uid());
  pledge public.ss_girvi%rowtype;
  prior public.ss_girvi_payments%rowtype;
  months integer;
  interest_due numeric(14,2);
  principal_paid numeric(14,2);
  interest_paid numeric(14,2);
  total_due numeric(14,2);
  payment_id uuid;
begin
  if actor is null then raise exception 'Authentication required' using errcode='42501'; end if;
  if p_business_id is null or not public.has_business_role(p_business_id,array['owner','admin']) then
    raise exception 'Girvi payment is not authorized for this business' using errcode='42501';
  end if;
  select * into pledge from public.ss_girvi where business_id=p_business_id and id=p_girvi_id for update;
  if not found then raise exception 'Girvi record does not exist in this business' using errcode='42501'; end if;
  if p_idempotency_key is null or p_amount is null or p_amount<=0 or p_amount*100<>trunc(p_amount*100)
     or p_method not in ('cash','upi','bank_transfer','card') or p_payment_date is null
     or p_payment_date>current_date or p_payment_date<pledge.last_accrued_date then
    raise exception 'Payment amount, method, date or idempotency key is invalid' using errcode='22023';
  end if;
  select * into prior from public.ss_girvi_payments
    where business_id=p_business_id and idempotency_key=p_idempotency_key;
  if found then
    if prior.girvi_id<>p_girvi_id or prior.amount<>p_amount or prior.payment_method<>p_method or prior.payment_date<>p_payment_date then
      raise exception 'Idempotency key was already used for a different payment' using errcode='22023';
    end if;
    return jsonb_build_object('payment_id',prior.id,'status',pledge.status);
  end if;
  if pledge.status<>'active' then raise exception 'Closed Girvi records cannot receive payments' using errcode='22023'; end if;

  interest_due:=round(
    (pledge.principal_balance+pledge.interest_balance)
      *(power(1+pledge.monthly_interest_percent/100,
        (p_payment_date-pledge.last_accrued_date)::numeric/30)-1),
    2
  );
  pledge.interest_balance:=pledge.interest_balance+interest_due;
  months:=greatest(pledge.last_accrued_months,
    public.ss_girvi_completed_months(pledge.girvi_date,p_payment_date));
  total_due:=pledge.principal_balance+pledge.interest_balance;
  if p_amount>total_due then raise exception 'Payment exceeds the current Girvi outstanding' using errcode='22023'; end if;
  interest_paid:=least(p_amount,pledge.interest_balance);
  principal_paid:=p_amount-interest_paid;
  pledge.interest_balance:=pledge.interest_balance-interest_paid;
  pledge.principal_balance:=pledge.principal_balance-principal_paid;
  insert into public.ss_girvi_payments(
    business_id,girvi_id,idempotency_key,amount,payment_method,interest_paid,principal_paid,payment_date,received_by
  ) values(p_business_id,p_girvi_id,p_idempotency_key,p_amount,p_method,interest_paid,principal_paid,p_payment_date,actor)
  returning id into payment_id;
  insert into public.ss_girvi_cashbook_entries(
    business_id,girvi_id,girvi_payment_id,entry_type,direction,amount,method,actor_user_id
  ) values(p_business_id,p_girvi_id,payment_id,'payment','in',p_amount,p_method,actor);
  if pledge.principal_balance=0 and pledge.interest_balance=0 then
    update public.ss_girvi set principal_balance=0,interest_balance=0,last_accrued_months=months,
      last_accrued_date=p_payment_date,status='closed',closed_at=now(),
      jewellery_returned=true,returned_at=now(),updated_at=now() where id=p_girvi_id;
    insert into public.ss_girvi_audit_events(business_id,girvi_id,actor_user_id,event_type,payment_id,safe_metadata)
      values(p_business_id,p_girvi_id,actor,'girvi.closed',payment_id,jsonb_build_object('payment',p_amount));
  else
    update public.ss_girvi set principal_balance=pledge.principal_balance,interest_balance=pledge.interest_balance,
      last_accrued_months=months,last_accrued_date=p_payment_date,updated_at=now() where id=p_girvi_id;
    insert into public.ss_girvi_audit_events(business_id,girvi_id,actor_user_id,event_type,payment_id,safe_metadata)
      values(p_business_id,p_girvi_id,actor,'girvi.payment',payment_id,jsonb_build_object('payment',p_amount,
        'interest_paid',interest_paid,'principal_paid',principal_paid));
  end if;
  return jsonb_build_object('payment_id',payment_id,'interest_paid',interest_paid,'principal_paid',principal_paid,
    'principal_balance',pledge.principal_balance,'interest_balance',pledge.interest_balance,
    'last_accrued_date',p_payment_date,
    'status',case when pledge.principal_balance=0 and pledge.interest_balance=0 then 'closed' else 'active' end);
end
$function$;

revoke all on function public.ss_girvi_record_payment(uuid,uuid,uuid,numeric,text,date) from public,anon,authenticated;
grant execute on function public.ss_girvi_record_payment(uuid,uuid,uuid,numeric,text,date) to authenticated;
