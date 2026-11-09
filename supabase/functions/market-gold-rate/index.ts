import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const TROY_OUNCE_IN_GRAMS = 31.1034768;

const GOLD_PURITIES = ['18K', '20K', '22K', '24K'];

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    },
  });
}

function toPositiveNumber(value: unknown): number | undefined {
  const parsed =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && value.trim() !== ''
        ? Number(value)
        : NaN;

  return Number.isFinite(parsed) && parsed > 0
    ? parsed
    : undefined;
}

function validateTimestamp(timestamp: unknown): Date | null {
  if (
    typeof timestamp !== 'number' ||
    !Number.isFinite(timestamp) ||
    timestamp <= 0
  ) {
    return null;
  }

  const providerTimestamp = new Date(timestamp * 1000);
  const ageMs = Date.now() - providerTimestamp.getTime();

  if (
    !Number.isFinite(providerTimestamp.getTime()) ||
    ageMs < -5 * 60_000 ||
    ageMs > 24 * 60 * 60_000
  ) {
    return null;
  }

  return providerTimestamp;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return json({ error: 'Method not allowed.' }, 405);
  }

  const authorization = req.headers.get('Authorization');

  if (!authorization?.startsWith('Bearer ')) {
    return json({ error: 'Sign-in is required.' }, 401);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');

  const supabaseKey =
    Deno.env.get('SUPABASE_ANON_KEY') ??
    Deno.env.get('SUPABASE_PUBLISHABLE_KEY');

  const apiKey = Deno.env.get('GOLDAPI_KEY');

  if (!supabaseUrl || !supabaseKey || !apiKey) {
    return json(
      {
        error:
          'Market-rate service is not configured. Check the Supabase server secrets.',
      },
      503,
    );
  }

  const supabase = createClient(supabaseUrl, supabaseKey, {
    global: {
      headers: {
        Authorization: authorization,
      },
    },
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });

  try {
    // 1. Validate the signed-in user.
    const { data: userData, error: userError } =
      await supabase.auth.getUser();

    if (userError || !userData.user) {
      return json(
        {
          error: 'Your session is invalid or expired. Sign in again.',
        },
        401,
      );
    }

    // 2. Validate the request body.
    const body = (await req.json().catch(() => null)) as {
      businessId?: unknown;
      purity?: unknown;
      metal?: unknown;
    } | null;

    const businessId =
      typeof body?.businessId === 'string' ? body.businessId : '';

    // Existing requests without "metal" continue to work as gold requests.
    const metal =
      typeof body?.metal === 'string'
        ? body.metal.trim().toLowerCase()
        : 'gold';

    const purity =
      typeof body?.purity === 'string'
        ? body.purity.toUpperCase().replace(/\s/g, '')
        : '';

    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        businessId,
      )
    ) {
      return json(
        {
          error: 'A valid business workspace is required.',
        },
        400,
      );
    }

    if (!['gold', 'silver'].includes(metal)) {
      return json(
        {
          error: 'Choose gold or silver.',
        },
        400,
      );
    }

    if (metal === 'gold' && !GOLD_PURITIES.includes(purity)) {
      return json(
        {
          error: 'Choose 18K, 20K, 22K, or 24K gold.',
        },
        400,
      );
    }

    // 3. Verify business-owner or administrator access.
    const { data: allowed, error: accessError } = await supabase.rpc(
      'has_business_admin_access',
      {
        p_business_id: businessId,
      },
    );

    if (accessError || allowed !== true) {
      console.error('Business access verification failed:', {
        code: accessError?.code,
        message: accessError?.message,
      });

      return json(
        {
          error:
            'Only an active business owner or administrator can fetch market rates.',
        },
        403,
      );
    }

    // 4. Fetch the selected metal from GoldAPI.
    const symbol = metal === 'gold' ? 'XAU' : 'XAG';

    const endpoint =
      `https://www.goldapi.io/api/price/${symbol}/INR`;

    const upstream = await fetch(endpoint, {
      method: 'GET',
      headers: {
        'x-access-token': apiKey,
        Accept: 'application/json',
      },
      signal: AbortSignal.timeout(10000),
    });

    if (!upstream.ok) {
      const providerError = await upstream.text();

      console.error('GoldAPI error:', {
        status: upstream.status,
        metal,
        details: providerError.slice(0, 300),
      });

      return json(
        {
          error: `GoldAPI returned HTTP ${upstream.status} for ${metal}.`,
        },
        502,
      );
    }

    // 5. Parse and validate the provider response.
    const payload = (await upstream.json().catch(() => null)) as {
      timestamp?: number;
      metal?: string;
      currency?: string;
      price?: unknown;

      price_gram_24k?: unknown;
      price_gram_22k?: unknown;
      price_gram_20k?: unknown;
      price_gram_18k?: unknown;

      melt_price_per_gram?: Record<string, unknown> | null;
    } | null;

    if (
      !payload ||
      String(payload.metal ?? '').toUpperCase() !== symbol ||
      String(payload.currency ?? '').toUpperCase() !== 'INR'
    ) {
      console.error('Invalid GoldAPI response:', {
        metal,
        responseKeys: payload ? Object.keys(payload) : [],
        returnedMetal: payload?.metal,
        currency: payload?.currency,
      });

      return json(
        {
          error: `GoldAPI did not return a valid ${metal} quote in INR.`,
        },
        502,
      );
    }

    // 6. Validate the provider timestamp.
    const providerTimestamp = validateTimestamp(payload.timestamp);

    if (!providerTimestamp) {
      return json(
        {
          error:
            'The quote timestamp is missing, invalid, or older than 24 hours.',
        },
        502,
      );
    }

    const fetchedAt = new Date().toISOString();

    // 7. Return silver price per gram and per kilogram.
    if (metal === 'silver') {
      // GoldAPI's "price" is the price per troy ounce.
      const pricePerOunce = toPositiveNumber(payload.price);

      if (pricePerOunce === undefined) {
        console.error('Silver quote parsing failed:', {
          responseKeys: Object.keys(payload),
        });

        return json(
          {
            error: 'GoldAPI did not provide a valid silver price.',
          },
          502,
        );
      }

      const rate = pricePerOunce / TROY_OUNCE_IN_GRAMS;
      const ratePerKilogram = rate * 1000;

      return json({
        provider: 'GoldAPI',
        market: 'India',
        metal: 'silver',
        symbol: 'XAG/INR',
        currency: 'INR',
        unit: 'gram',
        rate,
        ratePerKilogram,
        providerTimestamp: providerTimestamp.toISOString(),
        fetchedAt,
      });
    }

    // 8. Return the requested gold purity.
    const meltPrices = payload.melt_price_per_gram ?? {};

    const rates: Record<string, number | undefined> = {
      '24K':
        toPositiveNumber(payload.price_gram_24k) ??
        toPositiveNumber(meltPrices['24k']) ??
        toPositiveNumber(meltPrices['24K']),

      '22K':
        toPositiveNumber(payload.price_gram_22k) ??
        toPositiveNumber(meltPrices['22k']) ??
        toPositiveNumber(meltPrices['22K']),

      '20K':
        toPositiveNumber(payload.price_gram_20k) ??
        toPositiveNumber(meltPrices['20k']) ??
        toPositiveNumber(meltPrices['20K']),

      '18K':
        toPositiveNumber(payload.price_gram_18k) ??
        toPositiveNumber(meltPrices['18k']) ??
        toPositiveNumber(meltPrices['18K']),
    };

    const rate = rates[purity];

    if (rate === undefined) {
      console.error('GoldAPI quote parsing failed:', {
        purity,
        responseKeys: Object.keys(payload),
        meltPriceKeys: Object.keys(meltPrices),
      });

      return json(
        {
          error: `GoldAPI did not provide a valid per-gram quote for ${purity}.`,
        },
        502,
      );
    }

    return json({
      provider: 'GoldAPI',
      market: 'India',
      metal: 'gold',
      purity,
      symbol: `XAU/INR-${purity}`,
      currency: 'INR',
      unit: 'gram',
      rate,
      providerTimestamp: providerTimestamp.toISOString(),
      fetchedAt,
    });
  } catch (error) {
    const isTimeout =
      error instanceof Error &&
      (error.name === 'TimeoutError' || error.name === 'AbortError');

    console.error(
      'Market-rate request failed:',
      error instanceof Error ? error.message : 'Unknown error',
    );

    return json(
      {
        error: isTimeout
          ? 'GoldAPI timed out. Please retry.'
          : 'Could not fetch a market quote. Please retry.',
      },
      502,
    );
  }
});