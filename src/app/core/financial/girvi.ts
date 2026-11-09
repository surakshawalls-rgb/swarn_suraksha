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

export function girviBalancesAt(
  principal: string,
  accruedInterest: string,
  monthlyInterestPercent: string | number,
  accruedMonths: number,
  completedMonths: number
): { principal: string; interest: string; outstanding: string } {
  if (!Number.isInteger(accruedMonths) || !Number.isInteger(completedMonths) || accruedMonths < 0 || completedMonths < accruedMonths) {
    throw new RangeError('Accrued months must not exceed completed months.');
  }
  const rate = Number(monthlyInterestPercent);
  if (!Number.isFinite(rate) || rate < 2 || rate > 6) {
    throw new RangeError('Girvi interest must be between 2% and 6% per month.');
  }
  let principalMinor = parseFixed(principal, 2);
  let interestMinor = parseFixed(accruedInterest, 2);
  const rateBasisPoints = BigInt(Math.round(rate * 100));
  for (let month = accruedMonths; month < completedMonths; month++) {
    const balance = principalMinor + interestMinor;
    interestMinor += (balance * rateBasisPoints + 5000n) / 10000n;
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
  accruedMonths: number,
  completedMonths: number
): { interestPaid: string; principalPaid: string; principalBalance: string; interestBalance: string } {
  const balances = girviBalancesAt(principal, accruedInterest, monthlyInterestPercent, accruedMonths, completedMonths);
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
