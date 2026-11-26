export type MetalCode = 'gold' | 'silver';

export type MarketRate = {
  market_city: string;
  metal_code: MetalCode;
  purity_code: string;
  base_price_per_gram: number;
  gst_amount_per_gram: number | null;
  final_price_per_gram: number | null;
  confidence: 'high' | 'medium';
  validation_passed: boolean;
  market_date: string;
  market_timestamp: string;
  payload: Record<string, unknown>;
};

export class MarketRateError extends Error {
  constructor(
    public readonly code: string,
    public readonly httpStatus: number | null = null,
  ) {
    super(code);
    this.name = 'MarketRateError';
  }
}

export function asObject(
  value: unknown,
): Record<string, unknown> {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value)
  ) {
    throw new MarketRateError('INVALID_RESPONSE');
  }

  return value as Record<string, unknown>;
}

export function positiveNumber(value: unknown): number {
  const parsed =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && value.trim()
        ? Number(value)
        : NaN;

  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new MarketRateError('INVALID_RESPONSE');
  }

  return parsed;
}

export function roundPrice(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function getIndianMarketDate(date: Date): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);

  const year = parts.find(p => p.type === 'year')?.value;
  const month = parts.find(p => p.type === 'month')?.value;
  const day = parts.find(p => p.type === 'day')?.value;

  return `${year}-${month}-${day}`;
}

export function validateMarketTimestamp(
  value: unknown,
): Date {
  const timestamp =
    typeof value === 'number'
      ? new Date(value)
      : typeof value === 'string'
        ? new Date(value)
        : null;

  if (
    !timestamp ||
    !Number.isFinite(timestamp.getTime())
  ) {
    throw new MarketRateError('INVALID_RESPONSE');
  }

  const ageMs = Date.now() - timestamp.getTime();

  if (
    ageMs > 30 * 60_000 ||
    ageMs < -5 * 60_000
  ) {
    throw new MarketRateError('STALE_MARKET_DATA');
  }

  return timestamp;
}

export function validateConfidence(
  value: unknown,
): 'high' | 'medium' {
  const confidence = String(value ?? '')
    .trim()
    .toLowerCase();

  if (confidence === 'high' || confidence === 'medium') {
    return confidence;
  }

  throw new MarketRateError('LOW_CONFIDENCE');
}

export function createMarketRate(input: {
  city: string;
  metal: MetalCode;
  purity: string;
  basePrice: number;
  finalPrice: number | null;
  confidence: 'high' | 'medium';
  timestamp: Date;
  calculated?: boolean;
}): MarketRate {
  const basePrice = positiveNumber(input.basePrice);

  const finalPrice =
    input.finalPrice === null
      ? null
      : positiveNumber(input.finalPrice);

  if (
    finalPrice !== null &&
    finalPrice < basePrice
  ) {
    throw new MarketRateError('VALIDATION_FAILED');
  }

  return {
    market_city: input.city,
    metal_code: input.metal,
    purity_code: input.purity,
    base_price_per_gram: basePrice,

    gst_amount_per_gram:
      finalPrice === null
        ? null
        : roundPrice(finalPrice - basePrice),

    final_price_per_gram: finalPrice,

    confidence: input.confidence,
    validation_passed: true,

    market_date: getIndianMarketDate(input.timestamp),

    market_timestamp: input.timestamp.toISOString(),

    payload: {
      provider: 'nebula',
      market: 'India',
      currency: 'INR',
      unit: 'gram',
      gst_included_in_base_price: false,
      calculated: input.calculated ?? false,
      calculation_method: input.calculated
        ? 'gold24k_base_price * 20 / 24'
        : null,
    },
  };
}

export function calculate20KRate(
  gold24K: MarketRate,
): MarketRate {
  const basePrice = roundPrice(
    gold24K.base_price_per_gram * 20 / 24,
  );

  const finalPrice =
    gold24K.final_price_per_gram === null
      ? null
      : roundPrice(
          gold24K.final_price_per_gram * 20 / 24,
        );

  return createMarketRate({
    city: gold24K.market_city,
    metal: 'gold',
    purity: '20K',
    basePrice,
    finalPrice,
    confidence: gold24K.confidence,
    timestamp: new Date(gold24K.market_timestamp),
    calculated: true,
  });
}

export function jsonResponse(
  body: unknown,
  status = 200,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    },
  });
}

export async function secretsMatch(
  supplied: string,
  expected: string,
): Promise<boolean> {
  const encoder = new TextEncoder();

  const suppliedHash = new Uint8Array(
    await crypto.subtle.digest(
      'SHA-256',
      encoder.encode(supplied),
    ),
  );

  const expectedHash = new Uint8Array(
    await crypto.subtle.digest(
      'SHA-256',
      encoder.encode(expected),
    ),
  );

  let difference = 0;

  for (let i = 0; i < expectedHash.length; i++) {
    difference |= suppliedHash[i] ^ expectedHash[i];
  }

  return difference === 0;
}
// Provisional mapping: fail closed until provider fixtures are verified.
export function normalizeNebula(value: unknown, metal: MetalCode, city: string): MarketRate[] {
  const root = asObject(value);
  const metadata = asObject(root.metadata);
  const engine = asObject(asObject(metadata.source_details).engine);
  if (engine.stale !== false) throw new MarketRateError('STALE_MARKET_DATA');
  if ((metadata.validation_passed ?? root.validation_passed) !== true) throw new MarketRateError('VALIDATION_FAILED');
  const confidence = validateConfidence(metadata.confidence ?? root.confidence);
  const timestamp = validateMarketTimestamp(metadata.last_verified_against_market);
  const prices = asObject(root.prices);
  const keys = metal === 'gold' ? ['24K','22K','18K','14K'] : ['999'];
  const rates = keys.map(purity => {
    const p = asObject(prices[metal === 'gold' ? `gold${purity.toLowerCase()}` : 'silver']);
    const final = p.finalPricePerGram ?? p.pricePerGram;
    return createMarketRate({city: metal === 'silver' ? 'India' : city, metal, purity,
      basePrice: positiveNumber(p.basePricePerGram), finalPrice: final == null ? null : positiveNumber(final), confidence, timestamp});
  });
  if (metal === 'gold') rates.push(calculate20KRate(rates[0]));
  return rates;
}
