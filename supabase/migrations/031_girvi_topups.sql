do $preflight$
begin
  if to_regclass('public.ss_girvi') is null
     or to_regclass('public.ss_girvi_cashbook_entries') is null
     or to_regclass('public.ss_girvi_audit_events') is null
     or to_regprocedure('public.has_business_role(uuid,text[])') is null
     or to_regprocedure('public.ss_girvi_completed_months(date,date)') is null
     or not exists (
       select 1 from information_schema.columns
       where table_schema='public' and table_name='ss_girvi' and column_name='last_accrued_date'
     ) then
    raise exception 'Girvi daily accrual, cashbook and verified tenant role helpers are required before 031_girvi_topups';
  end if;
end
$preflight$;

create table public.ss_girvi_topups (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null,
  girvi_id uuid not null,
  idempotency_key uuid not null,
  amount numeric(14,2) not null check (amount > 0),
  payment_method text not null check (payment_method in ('cash','upi','bank_transfer','card')),
  topup_date date not null,
  received_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  unique (business_id,id),
  unique (business_id,idempotency_key),
  foreign key (business_id,girvi_id) references public.ss_girvi(business_id,id) on delete restrict
);

create index ss_girvi_topups_history_idx
  on public.ss_girvi_topups(business_id,girvi_id,topup_date desc,created_at desc);
alter table public.ss_girvi_topups enable row level security;
create policy ss_girvi_topups_read_member on public.ss_girvi_topups
  for select to authenticated using (public.is_business_member(business_id));
revoke all on public.ss_girvi_topups from public,anon,authenticated;
grant select on public.ss_girvi_topups to authenticated;

alter table public.ss_girvi_cashbook_entries
  add column girvi_topup_id uuid references public.ss_girvi_topups(id) on delete restrict;

do $cashbook_constraints$
declare item record;
begin
  for item in
    select conname from pg_constraint
    where conrelid='public.ss_girvi_cashbook_entries'::regclass and contype='c'
      and pg_get_constraintdef(oid) ilike '%entry_type%'
  loop
    execute format('alter table public.ss_girvi_cashbook_entries drop constraint %I',item.conname);
  end loop;
  alter table public.ss_girvi_cashbook_entries
    add constraint ss_girvi_cashbook_entry_type_check
      check (entry_type in ('loan_disbursement','loan_top_up','payment')),
    add constraint ss_girvi_cashbook_entry_source_check
      check (
        (entry_type='loan_disbursement' and direction='out' and girvi_payment_id is null and girvi_topup_id is null)
        or (entry_type='loan_top_up' and direction='out' and girvi_payment_id is null and girvi_topup_id is not null)
        or (entry_type='payment' and direction='in' and girvi_payment_id is not null and girvi_topup_id is null)
      );
end
$cashbook_constraints$;

create unique index ss_girvi_cashbook_topup_unique
  on public.ss_girvi_cashbook_entries(business_id,girvi_topup_id)
  where girvi_topup_id is not null;

do $audit_constraint$
declare item record;
begin
  for item in
    select conname from pg_constraint
    where conrelid='public.ss_girvi_audit_events'::regclass and contype='c'
      and pg_get_constraintdef(oid) ilike '%event_type%'
  loop
    execute format('alter table public.ss_girvi_audit_events drop constraint %I',item.conname);
  end loop;
  alter table public.ss_girvi_audit_events
    add constraint ss_girvi_audit_event_type_check
      check (event_type in ('girvi.created','girvi.payment','girvi.closed','girvi.agreement_print_requested','girvi.top_up'));
end
$audit_constraint$;

create or replace function public.ss_girvi_record_topup(
  p_business_id uuid,p_girvi_id uuid,p_idempotency_key uuid,p_amount numeric,p_method text,
  p_topup_date date default current_date
) returns jsonb
language plpgsql security definer set search_path=''
as $function$
declare
  actor uuid:=(select auth.uid());
  pledge public.ss_girvi%rowtype;
  prior public.ss_girvi_topups%rowtype;
  topup_id uuid;
  months integer;
  interest_due numeric(14,2);
begin
  if actor is null then raise exception 'Authentication required' using errcode='42501'; end if;
  if p_business_id is null or not public.has_business_role(p_business_id,array['owner','admin']) then
    raise exception 'Girvi top-up is not authorized for this business' using errcode='42501';
  end if;
  if p_girvi_id is null or p_idempotency_key is null or p_amount is null or p_amount<=0
     or p_amount*100<>trunc(p_amount*100) or p_method is null
     or p_method not in ('cash','upi','bank_transfer','card') or p_topup_date is null
     or p_topup_date>current_date then
    raise exception 'Top-up amount, method, date or idempotency key is invalid' using errcode='22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_business_id::text||':'||p_idempotency_key::text,0)
  );
  select * into pledge from public.ss_girvi
    where business_id=p_business_id and id=p_girvi_id for update;
  if not found then raise exception 'Girvi record does not exist in this business' using errcode='42501'; end if;

  select * into prior from public.ss_girvi_topups
    where business_id=p_business_id and idempotency_key=p_idempotency_key;
  if found then
    if prior.girvi_id<>p_girvi_id or prior.amount<>p_amount
       or prior.payment_method<>p_method or prior.topup_date<>p_topup_date then
      raise exception 'Idempotency key was already used for a different top-up' using errcode='22023';
    end if;
    return jsonb_build_object('topup_id',prior.id,'status',pledge.status);
  end if;
  if pledge.status<>'active' then raise exception 'Closed Girvi records cannot receive top-ups' using errcode='22023'; end if;
  if p_topup_date<pledge.last_accrued_date then
    raise exception 'Top-up date cannot precede the last accrued date' using errcode='22023';
  end if;
  if pledge.principal_balance+p_amount>pledge.estimated_market_value then
    raise exception 'Top-up would make principal exceed the assessed jewellery value' using errcode='22023';
  end if;

  interest_due:=round(
    (pledge.principal_balance+pledge.interest_balance)
      *(power(1+pledge.monthly_interest_percent/100,
        (p_topup_date-pledge.last_accrued_date)::numeric/30)-1),
    2
  );
  pledge.interest_balance:=pledge.interest_balance+interest_due;
  months:=greatest(pledge.last_accrued_months,
    public.ss_girvi_completed_months(pledge.girvi_date,p_topup_date));

  insert into public.ss_girvi_topups(
    business_id,girvi_id,idempotency_key,amount,payment_method,topup_date,received_by
  ) values(p_business_id,p_girvi_id,p_idempotency_key,p_amount,p_method,p_topup_date,actor)
  returning id into topup_id;
  update public.ss_girvi set
    principal_balance=pledge.principal_balance+p_amount,
    interest_balance=pledge.interest_balance,
    last_accrued_months=months,
    last_accrued_date=p_topup_date,
    updated_at=now()
  where business_id=p_business_id and id=p_girvi_id;
  insert into public.ss_girvi_cashbook_entries(
    business_id,girvi_id,girvi_topup_id,entry_type,direction,amount,method,actor_user_id
  ) values(p_business_id,p_girvi_id,topup_id,'loan_top_up','out',p_amount,p_method,actor);
  insert into public.ss_girvi_audit_events(
    business_id,girvi_id,actor_user_id,event_type,safe_metadata
  ) values(p_business_id,p_girvi_id,actor,'girvi.top_up',
    jsonb_build_object('amount',p_amount,'principal_balance',pledge.principal_balance+p_amount,
      'topup_date',p_topup_date));

  return jsonb_build_object('topup_id',topup_id,'amount',p_amount,
    'principal_balance',pledge.principal_balance+p_amount,'interest_balance',pledge.interest_balance,
    'last_accrued_date',p_topup_date,'status','active');
end
$function$;

revoke all on function public.ss_girvi_record_topup(uuid,uuid,uuid,numeric,text,date) from public,anon,authenticated;
grant execute on function public.ss_girvi_record_topup(uuid,uuid,uuid,numeric,text,date) to authenticated;

create or replace function public.ss_cashbook_page(
  p_business_id uuid,p_from timestamptz default null,p_through timestamptz default null,
  p_offset integer default 0,p_limit integer default 200
) returns table(
  id uuid,payment_id uuid,source text,direction text,amount numeric,method text,recorded_at timestamptz,total_count bigint
)
language plpgsql stable security definer set search_path=''
as $function$
begin
  if (select auth.uid()) is null then raise exception 'Authentication required' using errcode='42501'; end if;
  if p_business_id is null or not public.is_business_member(p_business_id) then
    raise exception 'Workspace is missing or cashbook access is not authorized' using errcode='42501';
  end if;
  if p_offset is null or p_offset<0 or p_offset>100000 or p_limit is null or p_limit<1 or p_limit>200 then
    raise exception 'Cashbook page must contain 1 to 200 rows and use a valid offset' using errcode='22023';
  end if;
  if p_from is not null and p_through is not null and p_through<p_from then
    raise exception 'Cashbook end timestamp must not precede its start timestamp' using errcode='22023';
  end if;
  return query
  with entries as (
    select e.id,e.source_id as payment_id,'Purchase payment'::text as source,'out'::text as direction,
      e.amount,e.method,e.recorded_at from public.ss_cashbook_entries e
    where e.business_id=p_business_id and (p_from is null or e.recorded_at>=p_from) and (p_through is null or e.recorded_at<=p_through)
    union all
    select e.id,e.sale_payment_id,'Sale payment'::text,'in'::text,e.amount,e.method,e.recorded_at from public.ss_sale_cashbook_entries e
    where e.business_id=p_business_id and (p_from is null or e.recorded_at>=p_from) and (p_through is null or e.recorded_at<=p_through)
    union all
    select e.id,e.sale_return_id,'Sale refund'::text,'out'::text,e.amount,e.method,e.recorded_at from public.ss_sale_return_cashbook_entries e
    where e.business_id=p_business_id and (p_from is null or e.recorded_at>=p_from) and (p_through is null or e.recorded_at<=p_through)
    union all
    select e.id,e.expense_id,'Operating expense'::text,'out'::text,e.amount,e.method,e.recorded_at
      from public.ss_expense_cashbook_entries e
    where e.business_id=p_business_id and public.has_business_role(p_business_id,array['owner','admin'])
      and (p_from is null or e.recorded_at>=p_from) and (p_through is null or e.recorded_at<=p_through)
    union all
    select e.id,coalesce(e.girvi_payment_id,e.girvi_topup_id,e.girvi_id),
      case e.entry_type
        when 'loan_disbursement' then 'Girvi loan disbursement'
        when 'loan_top_up' then 'Girvi loan top-up'
        else 'Girvi repayment'
      end,
      e.direction,e.amount,e.method,e.recorded_at from public.ss_girvi_cashbook_entries e
    where e.business_id=p_business_id and (p_from is null or e.recorded_at>=p_from) and (p_through is null or e.recorded_at<=p_through)
  )
  select e.id,e.payment_id,e.source,e.direction,e.amount,e.method,e.recorded_at,count(*) over()::bigint
    from entries e order by e.recorded_at desc,e.id desc limit p_limit offset p_offset;
end
$function$;
