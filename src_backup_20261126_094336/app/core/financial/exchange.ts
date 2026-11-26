import { formatFixed, parseFixed } from './decimal';

export interface ExchangeValuation {
  netWeight: string;
  acceptedWeight: string;
  exchangeValue: string;
}

export function calculateExchangeValue(
  grossWeight: string,
  nonMetalDeduction: string,
  qualityDeductionPercent: string,
  purityFactor: string,
  ratePerGram: string
): ExchangeValuation {
  const gross = parseFixed(grossWeight, 4);
  const deduction = parseFixed(nonMetalDeduction || '0', 4);
  const quality = parseFixed(qualityDeductionPercent, 2);
  const factor = parseFixed(purityFactor, 6);
  const rate = parseFixed(ratePerGram, 4);

  if (gross <= 0n || deduction < 0n || deduction >= gross) {
    throw new RangeError('Gross weight must exceed the non-metal deduction.');
  }
  if (quality < 0n || quality > 5000n) {
    throw new RangeError('Quality deduction must be between 0% and 50%.');
  }
  if (factor <= 0n || factor > 1_000_000n || rate <= 0n) {
    throw new RangeError('Purity factor and valuation rate must be positive.');
  }

  const net = gross - deduction;
  const acceptedNumerator = net * factor * (10000n - quality);
  const acceptedDenominator = 1_000_000n * 10000n;
  const accepted = (acceptedNumerator + acceptedDenominator / 2n) / acceptedDenominator;
  const valueNumerator = accepted * rate;
  const valueDenominator = 1_000_000n;
  const valueMinor = (valueNumerator + valueDenominator / 2n) / valueDenominator;

  return {
    netWeight: formatFixed(net, 4),
    acceptedWeight: formatFixed(accepted, 4),
    exchangeValue: formatFixed(valueMinor, 2)
  };
}
