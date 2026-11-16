import { formatFixed, parseFixed } from './decimal';

export function completedMonthlyPeriods(startDate: string, asOfDate: string): number {
  const [startYear, startMonth, startDay] = startDate.split('-').map(Number);
  const [asOfYear, asOfMonth, asOfDay] = asOfDate.split('-').map(Number);
  let months = Math.max(0, (asOfYear - startYear) * 12 + asOfMonth - startMonth);
  const anniversaryMonth = startMonth - 1 + months;
  const anniversaryYear = startYear + Math.floor(anniversaryMonth / 12);
  const monthIndex = anniversaryMonth % 12;
  const anniversaryDay = Math.min(startDay, new Date(Date.UTC(anniversaryYear, monthIndex + 1, 0)).getUTCDate());
  if (
    anniversaryYear > asOfYear ||
    (anniversaryYear === asOfYear && monthIndex + 1 > asOfMonth) ||
    (anniversaryYear === asOfYear && monthIndex + 1 === asOfMonth && anniversaryDay > asOfDay)
  ) {
    months--;
  }
  return Math.max(0, months);
}

export function girviCollateralValue(weightGrams: string, ratePerGram: string): string {
  const weight = parseFixed(weightGrams, 4);
  const rate = parseFixed(ratePerGram, 4);
  if (weight <= 0n || rate <= 0n) throw new RangeError('Girvi item weight and rate must be positive.');
  return formatFixed((weight * rate + 500000n) / 1000000n, 2);
}

export function girviElapsedDays(startDate: string, asOfDate: string): number {
  const dateValue = (value: string): number => {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    if (!match) throw new RangeError('Girvi dates must use YYYY-MM-DD format.');
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const timestamp = Date.UTC(year, month - 1, day);
    const date = new Date(timestamp);
    if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
      throw new RangeError('Girvi dates must be valid calendar dates.');
    }
    return timestamp;
  };
  return Math.max(0, (dateValue(asOfDate) - dateValue(startDate)) / 86_400_000);
}

export function girviBalancesAt(
  principal: string,
  accruedInterest: string,
  monthlyInterestPercent: string | number,
  elapsedDays: number
): { principal: string; interest: string; outstanding: string } {
  if (!Number.isInteger(elapsedDays) || elapsedDays < 0) {
    throw new RangeError('Elapsed Girvi days must be a non-negative integer.');
  }
  const rate = Number(monthlyInterestPercent);
  if (!Number.isFinite(rate) || rate < 2 || rate > 10) {
    throw new RangeError('Girvi interest must be between 2% and 10% per month.');
  }
  let principalMinor = parseFixed(principal, 2);
  let interestMinor = parseFixed(accruedInterest, 2);
  if (elapsedDays > 0) {
    const balanceMinor = Number(principalMinor + interestMinor);
    const growthFactor = Math.pow(1 + rate / 100, elapsedDays / 30);
    const accruedTotalMinor = Math.round(balanceMinor * growthFactor);
    interestMinor = BigInt(accruedTotalMinor) - principalMinor;
  }
  return {
    principal: formatFixed(principalMinor, 2),
    interest: formatFixed(interestMinor, 2),
    outstanding: formatFixed(principalMinor + interestMinor, 2)
  };
}

export function allocateGirviPayment(
  principal: string,
  accruedInterest: string,
  paymentAmount: string,
  monthlyInterestPercent: string | number,
  elapsedDays: number
): { interestPaid: string; principalPaid: string; principalBalance: string; interestBalance: string } {
  const balances = girviBalancesAt(principal, accruedInterest, monthlyInterestPercent, elapsedDays);
  const paymentMinor = parseFixed(paymentAmount, 2);
  const principalMinor = parseFixed(balances.principal, 2);
  const interestMinor = parseFixed(balances.interest, 2);
  if (paymentMinor <= 0n) throw new RangeError('Payment must be greater than zero.');
  if (paymentMinor > principalMinor + interestMinor) throw new RangeError('Payment exceeds the current Girvi outstanding.');
  const interestPaid = paymentMinor < interestMinor ? paymentMinor : interestMinor;
  const principalPaid = paymentMinor - interestPaid;
  return {
    interestPaid: formatFixed(interestPaid, 2),
    principalPaid: formatFixed(principalPaid, 2),
    principalBalance: formatFixed(principalMinor - principalPaid, 2),
    interestBalance: formatFixed(interestMinor - interestPaid, 2)
  };
}
