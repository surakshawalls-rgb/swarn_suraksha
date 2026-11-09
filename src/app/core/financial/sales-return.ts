export interface SaleReturnAllocation {
  balanceReductionMinor: bigint;
  cashRefundMinor: bigint;
}

/** Allocate a full saved invoice line against an outstanding bill, then collected cash. */
export function allocateSaleReturn(input: {
  subtotalMinor: bigint;
  paidMinor: bigint;
  priorBalanceReductionsMinor: bigint;
  priorCashRefundsMinor: bigint;
  lineAmountMinor: bigint;
}): SaleReturnAllocation {
  const { subtotalMinor, paidMinor, priorBalanceReductionsMinor, priorCashRefundsMinor, lineAmountMinor } = input;
  if ([subtotalMinor, paidMinor, priorBalanceReductionsMinor, priorCashRefundsMinor, lineAmountMinor].some(value => value < 0n)) {
    throw new RangeError('Sale return amounts cannot be negative.');
  }
  if (lineAmountMinor <= 0n) throw new RangeError('A returned invoice line must have a positive saved amount.');
  if (paidMinor > subtotalMinor) throw new RangeError('Collected payments cannot exceed the original sale amount.');

  const outstandingMinor = subtotalMinor - paidMinor - priorBalanceReductionsMinor;
  const paidNetOfRefundsMinor = paidMinor - priorCashRefundsMinor;
  if (outstandingMinor < 0n || paidNetOfRefundsMinor < 0n) throw new RangeError('Existing returns exceed the sale balance or net payments.');

  const balanceReductionMinor = lineAmountMinor < outstandingMinor ? lineAmountMinor : outstandingMinor;
  const cashRefundMinor = lineAmountMinor - balanceReductionMinor;
  if (cashRefundMinor > paidNetOfRefundsMinor) {
    throw new RangeError('The return exceeds the amount paid after reducing the unpaid balance.');
  }
  return { balanceReductionMinor, cashRefundMinor };
}
