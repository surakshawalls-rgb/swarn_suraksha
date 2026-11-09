/** Fixed-precision helpers for financial values. Inputs remain decimal strings or BigInts. */
export function parseFixed(value: string | number, scale: number): bigint {
  if (!Number.isInteger(scale) || scale < 0 || scale > 12) {
    throw new RangeError('Scale must be an integer from 0 to 12.');
  }

  if (typeof value === 'number' && !Number.isFinite(value)) {
    throw new TypeError('Enter a valid decimal amount.');
  }

  const input = String(value).trim();
  const match = /^([+-]?)(\d+)(?:\.(\d+))?$/.exec(input);

  if (!match) {
    throw new TypeError('Enter a valid decimal amount.');
  }

  const fraction = match[3] ?? '';

  if (fraction.length > scale && /[^0]/.test(fraction.slice(scale))) {
    throw new RangeError(`This value supports at most ${scale} decimal places.`);
  }

  const unit = 10n ** BigInt(scale);
  const fractionalUnits = BigInt(
    (fraction.slice(0, scale) + '0'.repeat(scale)).slice(0, scale) || '0'
  );
  const magnitude = BigInt(match[2]) * unit + fractionalUnits;

  return match[1] === '-' ? -magnitude : magnitude;
}

export function formatFixed(value: bigint, scale: number): string {
  if (!Number.isInteger(scale) || scale < 0 || scale > 12) {
    throw new RangeError('Scale must be an integer from 0 to 12.');
  }

  const negative = value < 0n;
  const magnitude = negative ? -value : value;
  const unit = 10n ** BigInt(scale);
  const whole = magnitude / unit;

  if (scale === 0) return `${negative ? '-' : ''}${whole}`;

  const fraction = (magnitude % unit).toString().padStart(scale, '0');

  return `${negative ? '-' : ''}${whole}.${fraction}`;
}

export function formatInr(value: string | number, scale = 2): string {
  const scaled = parseFixed(value, scale);
  const negative = scaled < 0n;
  const magnitude = negative ? -scaled : scaled;
  const unit = 10n ** BigInt(scale);
  const whole = magnitude / unit;

  const grouped = new Intl.NumberFormat('en-IN', {
    maximumFractionDigits: 0
  }).format(whole);

  const fraction = scale === 0
    ? ''
    : `.${(magnitude % unit).toString().padStart(scale, '0')}`;

  return `${negative ? '-' : ''}₹${grouped}${fraction}`;
}

/** Purchase value = net grams × cost per gram + additional cost, rounded once to paise. */
export function purchaseLineTotal(
  netWeightGrams: string,
  costPerGram: string,
  additionalCost: string
): bigint {
  const weight = parseFixed(netWeightGrams, 4);
  const unitCost = parseFixed(costPerGram, 4);
  const extraPaise = parseFixed(additionalCost || '0', 2);

  if (weight <= 0n || unitCost < 0n || extraPaise < 0n) {
    throw new RangeError('Purchase weight must be positive and costs cannot be negative.');
  }

  const numerator = weight * unitCost + extraPaise * 1_000_000n;
  const divisor = 1_000_000n;
  const quotient = numerator / divisor;
  const remainder = numerator % divisor;

  return quotient + (remainder * 2n >= divisor ? 1n : 0n);
}

/** Illustrative compound growth using integer minor currency units and basis points. */
export function compoundTotalMinor(
  principalMinor: bigint,
  monthlyRateBps: number,
  completedMonths: number
): bigint {
  if (principalMinor < 0n) {
    throw new RangeError('Principal cannot be negative.');
  }

  if (
    !Number.isInteger(monthlyRateBps) ||
    monthlyRateBps < 0 ||
    monthlyRateBps > 100_000
  ) {
    throw new RangeError('Rate must be a non-negative integer number of basis points.');
  }

  if (
    !Number.isInteger(completedMonths) ||
    completedMonths < 0 ||
    completedMonths > 1200
  ) {
    throw new RangeError('Completed months must be an integer from 0 to 1200.');
  }

  const denominator = 10_000n ** BigInt(completedMonths);
  const numerator = (10_000n + BigInt(monthlyRateBps)) ** BigInt(completedMonths);
  const scaled = principalMinor * numerator;
  const quotient = scaled / denominator;
  const remainder = scaled % denominator;

  return quotient + (remainder * 2n >= denominator ? 1n : 0n);
}