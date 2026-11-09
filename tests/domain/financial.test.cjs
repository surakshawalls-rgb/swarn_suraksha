const test = require('node:test');
const assert = require('node:assert/strict');
const { compoundTotalMinor, formatFixed, formatInr, parseFixed, purchaseLineTotal } = require('../../.test-build/app/core/financial/decimal.js');
const { allocateSaleReturn } = require('../../.test-build/app/core/financial/sales-return.js');
const { validateCustomerLedgerPage, validateCustomerStatementPage } = require('../../.test-build/app/core/financial/customer-statement.js');
const { allocateGirviPayment, completedMonthlyPeriods, girviBalancesAt } = require('../../.test-build/app/core/financial/girvi.js');

test('fixed decimal parsing and formatting preserve currency precision', () => {
  assert.equal(parseFixed('30000.00', 2), 3000000n);
  assert.equal(formatFixed(parseFixed('-12.30', 2), 2), '-12.30');
  assert.equal(parseFixed('1.2300', 2), 123n);
});

test('fixed decimal parser rejects values that require silent rounding', () => {
  assert.throws(() => parseFixed('1.239', 2), /at most 2 decimal places/);
});

test('INR formatting groups amounts using Indian digits without floating point', () => {
  assert.equal(formatInr('12345678.5000', 4), '₹1,23,45,678.5000');
});

test('purchase lines multiply grams and unit price exactly, then round once to paise', () => {
  assert.equal(formatFixed(purchaseLineTotal('10.1250', '6000.2500', '25.00'), 2), '60777.53');
  assert.equal(formatFixed(purchaseLineTotal('0.0001', '50.0000', '0.01'), 2), '0.02');
  assert.throws(() => purchaseLineTotal('0', '50', '0'), /weight must be positive/);
  assert.throws(() => purchaseLineTotal('1', '-1', '0'), /costs cannot be negative/);
});

test('illustrative 3 percent monthly compound schedule uses integer arithmetic', () => {
  const principal = parseFixed('30000.00', 2);
  const totals = [1, 2, 3, 4].map(month => formatFixed(compoundTotalMinor(principal, 300, month), 2));
  assert.deepEqual(totals, ['30900.00', '31827.00', '32781.81', '33765.26']);
});

test('compound schedule rejects negative principal and invalid periods', () => {
  assert.throws(() => compoundTotalMinor(-1n, 300, 1), /cannot be negative/);
  assert.throws(() => compoundTotalMinor(100n, 300, -1), /integer from 0 to 1200/);
});

test('Girvi compounding counts completed monthly anniversaries with month-end clamping', () => {
  assert.equal(completedMonthlyPeriods('2025-01-31', '2025-02-27'), 0);
  assert.equal(completedMonthlyPeriods('2025-01-31', '2025-02-28'), 1);
  assert.equal(completedMonthlyPeriods('2024-01-31', '2024-02-28'), 0);
  assert.equal(completedMonthlyPeriods('2024-01-31', '2024-02-29'), 1);
  assert.deepEqual(girviBalancesAt('50000.00', '0.00', 3, 0, 3), {
    principal: '50000.00', interest: '4636.35', outstanding: '54636.35'
  });
});

test('Girvi payments pay compounded interest before reducing principal', () => {
  assert.deepEqual(allocateGirviPayment('50000.00', '0.00', '2000.00', 3, 0, 1), {
    interestPaid: '1500.00', principalPaid: '500.00', principalBalance: '49500.00', interestBalance: '0.00'
  });
  assert.throws(() => allocateGirviPayment('50000.00', '0.00', '52000.00', 3, 0, 1), /exceeds the current Girvi outstanding/);
});

test('sales returns reduce unpaid invoice balance before creating a refund', () => {
  const result = allocateSaleReturn({ subtotalMinor: 10000n, paidMinor: 4000n, priorBalanceReductionsMinor: 0n, priorCashRefundsMinor: 0n, lineAmountMinor: 8000n });
  assert.deepEqual(result, { balanceReductionMinor: 6000n, cashRefundMinor: 2000n });
});

test('sales returns refund only collected cash after prior returns', () => {
  const result = allocateSaleReturn({ subtotalMinor: 10000n, paidMinor: 10000n, priorBalanceReductionsMinor: 0n, priorCashRefundsMinor: 2500n, lineAmountMinor: 3000n });
  assert.deepEqual(result, { balanceReductionMinor: 0n, cashRefundMinor: 3000n });
});

test('sales return allocation rejects refunds beyond net payments received', () => {
  assert.throws(() => allocateSaleReturn({ subtotalMinor: 10000n, paidMinor: 4000n, priorBalanceReductionsMinor: 6000n, priorCashRefundsMinor: 3000n, lineAmountMinor: 2000n }), /exceeds the amount paid/);
});

test('customer statements validate return, collection, and outstanding reconciliation', () => {
  assert.doesNotThrow(() => validateCustomerStatementPage({
    totals: { net_invoiced: '80.00', net_collected: '40.00', returned: '20.00', outstanding: '40.00' },
    total_count: 1,
    rows: [{ subtotal: '100.00', paid_total: '50.00', returned: '20.00', due_reduction: '10.00', refunded: '10.00', net_invoiced: '80.00', net_collected: '40.00', outstanding: '40.00' }]
  }));
});

test('customer statements reject inconsistent invoice or summary totals', () => {
  const page = {
    totals: { net_invoiced: '80.00', net_collected: '40.00', returned: '20.00', outstanding: '40.00' },
    total_count: 1,
    rows: [{ subtotal: '100.00', paid_total: '50.00', returned: '20.00', due_reduction: '10.00', refunded: '10.00', net_invoiced: '80.00', net_collected: '40.00', outstanding: '40.00' }]
  };
  assert.throws(() => validateCustomerStatementPage({ ...page, totals: { ...page.totals, outstanding: '39.99' } }), /do not reconcile/);
  assert.throws(() => validateCustomerStatementPage({ ...page, rows: [{ ...page.rows[0], refunded: '11.00' }] }), /does not reconcile/);
});

test('chronological customer ledger reconciles invoice, payment, return, and cash refund', () => {
  assert.doesNotThrow(() => validateCustomerLedgerPage({
    totals: { opening_balance: '0.00', debits: '110.00', credits: '70.00', closing_balance: '40.00' },
    page_opening_balance: '0.00', total_count: 4,
    rows: [
      { debit: '100.00', credit: '0.00', running_balance: '100.00' },
      { debit: '0.00', credit: '50.00', running_balance: '50.00' },
      { debit: '0.00', credit: '20.00', running_balance: '30.00' },
      { debit: '10.00', credit: '0.00', running_balance: '40.00' }
    ]
  }));
});

test('chronological customer ledger rejects bad page opening and row balances', () => {
  const ledger = {
    totals: { opening_balance: '10.00', debits: '5.00', credits: '0.00', closing_balance: '15.00' },
    page_opening_balance: '10.00', total_count: 1,
    rows: [{ debit: '5.00', credit: '0.00', running_balance: '15.00' }]
  };
  assert.throws(() => validateCustomerLedgerPage({ ...ledger, page_opening_balance: '9.00' }), /running balance does not reconcile/);
  assert.throws(() => validateCustomerLedgerPage({ ...ledger, totals: { ...ledger.totals, closing_balance: '14.00' } }), /totals do not reconcile/);
});
