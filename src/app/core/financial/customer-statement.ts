import { parseFixed } from './decimal';

export interface CustomerStatementLineAmounts {
  subtotal:string;paid_total:string;returned:string;due_reduction:string;refunded:string;
  net_invoiced:string;net_collected:string;outstanding:string;
}
export interface CustomerStatementAmounts {
  net_invoiced:string;net_collected:string;returned:string;outstanding:string;
}
export interface CustomerStatementPageAmounts {
  totals:CustomerStatementAmounts;rows:CustomerStatementLineAmounts[];total_count:number;
}
export interface CustomerLedgerLine {
  debit:string;credit:string;running_balance:string;description:string;event_type:string;entity_id:string;happened_at:string;
}
export interface CustomerLedgerPageAmounts {
  totals:{opening_balance:string;debits:string;credits:string;closing_balance:string};
  page_opening_balance:string;rows:CustomerLedgerLine[];total_count:number;
}

/** Validate opening/closing and per-row balances before displaying a ledger page. */
export function validateCustomerLedgerPage(page:CustomerLedgerPageAmounts):void {
  if(!page||!page.totals||!Array.isArray(page.rows)||!Number.isSafeInteger(page.total_count)||page.total_count<page.rows.length){
    throw new TypeError('The customer ledger response is incomplete or invalid. Refresh the statement.');
  }
  const opening=amount(page.totals.opening_balance),debits=amount(page.totals.debits),credits=amount(page.totals.credits),closing=amount(page.totals.closing_balance);
  if(debits<0n||credits<0n||opening+debits-credits!==closing){
    throw new RangeError('Customer ledger totals do not reconcile. Refresh the statement and contact an administrator if the mismatch continues.');
  }
  let running=amount(page.page_opening_balance);
  for(const row of page.rows){
    const debit=amount(row.debit),credit=amount(row.credit);
    if(debit<0n||credit<0n||(debit>0n&&credit>0n)||debit+credit===0n){
      throw new RangeError('A customer ledger row contains an invalid debit or credit. The statement was not displayed.');
    }
    running+=debit-credit;
    if(running!==amount(row.running_balance))throw new RangeError('A customer ledger running balance does not reconcile. The statement was not displayed.');
  }
}

/** Reject inconsistent monetary values before the UI prints or exports a statement. */
export function validateCustomerStatementPage(page:CustomerStatementPageAmounts):void {
  if(!page||!page.totals||!Array.isArray(page.rows)||!Number.isSafeInteger(page.total_count)||page.total_count<page.rows.length){
    throw new TypeError('The statement response is incomplete or invalid. Refresh the statement.');
  }
  const totals={
    invoiced:amount(page.totals.net_invoiced),collected:amount(page.totals.net_collected),
    returned:amount(page.totals.returned),outstanding:amount(page.totals.outstanding)
  };
  if(totals.invoiced<0n||totals.collected<0n||totals.returned<0n||totals.outstanding<0n
    ||totals.invoiced-totals.collected!==totals.outstanding){
    throw new RangeError('Statement totals do not reconcile. Refresh the statement and contact an administrator if the mismatch continues.');
  }
  for(const line of page.rows){
    const subtotal=amount(line.subtotal),paid=amount(line.paid_total),returned=amount(line.returned),reduction=amount(line.due_reduction),refund=amount(line.refunded);
    if(subtotal<0n||paid<0n||returned<0n||reduction<0n||refund<0n
      ||returned!==reduction+refund
      ||amount(line.net_invoiced)!==subtotal-returned
      ||amount(line.net_collected)!==paid-refund
      ||amount(line.outstanding)!==subtotal-paid-reduction){
      throw new RangeError('A customer invoice does not reconcile with its returns and payments. The statement was not displayed.');
    }
  }
}

function amount(value:string):bigint {
  if(typeof value!=='string')throw new TypeError('Statement amounts must be decimal strings.');
  return parseFixed(value,2);
}
