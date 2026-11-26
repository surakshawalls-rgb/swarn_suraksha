import { createClient } from "npm:@supabase/supabase-js@2";

const PROVIDER = "nebula";
const GOLD_PURITIES = ["24K", "22K", "20K", "18K", "14K"];

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Max-Age": "86400",
};

function respond(
  body: unknown,
  status = 200,
  cacheControl = "no-store",
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...CORS_HEADERS,
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": cacheControl,
      "X-Content-Type-Options": "nosniff",
    },
  });
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function validNumber(value: unknown): number {
  if (
    value === null ||
    value === undefined ||
    (typeof value !== "number" &&
      typeof value !== "string") ||
    String(value).trim() === ""
  ) {
    throw new Error("INVALID_CACHED_RATE");
  }

  const result = Number(value);

  if (!Number.isFinite(result) || result < 0) {
    throw new Error("INVALID_CACHED_RATE");
  }

  return result;
}

function validTimestamp(value: unknown): number {
  if (typeof value !== "string") {
    throw new Error("INVALID_CACHED_TIMESTAMP");
  }

  const result = Date.parse(value);

  if (!Number.isFinite(result)) {
    throw new Error("INVALID_CACHED_TIMESTAMP");
  }

  return result;
}

function freshness(fetchedAt: number) {
  const now = Date.now();

  // IST is UTC + 05:30 throughout the year.
  const offset = 330 * 60 * 1000;

  const local = new Date(now + offset);

  const dayStart = Date.UTC(
    local.getUTCFullYear(),
    local.getUTCMonth(),
    local.getUTCDate(),
  ) - offset;

  const morning = dayStart + 9 * 60 * 60 * 1000;
  const afternoon = dayStart + 13 * 60 * 60 * 1000;

  const grace = 15 * 60 * 1000;

  const previousAfternoon =
    afternoon - 24 * 60 * 60 * 1000;

  let expectedRefresh = previousAfternoon;

  if (now >= afternoon + grace) {
    expectedRefresh = afternoon;
  } else if (now >= morning + grace) {
    expectedRefresh = morning;
  }

  const nextRefresh = now < morning
    ? morning
    : now < afternoon
    ? afternoon
    : morning + 24 * 60 * 60 * 1000;

  return {
    isStale: fetchedAt < expectedRefresh,
    ageMinutes: Math.max(
      0,
      Math.floor((now - fetchedAt) / 60000),
    ),
    expectedRefreshAt:
      new Date(expectedRefresh).toISOString(),
    nextScheduledRefreshAt:
      new Date(nextRefresh).toISOString(),
    refreshTimesIST: ["09:00", "13:00"],
    timezone: "Asia/Kolkata",
    gracePeriodMinutes: 15,
  };
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: CORS_HEADERS,
    });
  }

  if (req.method !== "GET") {
    return respond({
      success: false,
      error: "METHOD_NOT_ALLOWED",
    }, 405);
  }

  try {
    const url = Deno.env.get("SUPABASE_URL");
    const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!url || !key) {
      return respond({
        success: false,
        error: "SERVER_CONFIGURATION_ERROR",
      }, 500);
    }

    const supabase = createClient(url, key, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    });

    const { data: source, error: sourceError } =
      await supabase
        .from("metal_rate_sources")
        .select("provider_code,display_name,public_config")
        .eq("provider_code", PROVIDER)
        .single();

    if (sourceError || !source) {
      return respond({
        success: false,
        error: "MARKET_RATE_SERVICE_UNAVAILABLE",
      }, 503);
    }

    const config = source.public_config;

    if (config?.public_access_enabled !== true) {
      return respond({
        success: false,
        error: "PUBLIC_ACCESS_DISABLED",
      }, 403);
    }

    const city = config.default_city;

    if (typeof city !== "string" || !city.trim()) {
      return respond({
        success: false,
        error: "MARKET_CONFIGURATION_ERROR",
      }, 503);
    }

    const { data: rates, error: rateError } =
      await supabase
        .from("ss_market_rate_cache")
        .select(`
          market_city,
          metal_code,
          purity_code,
          currency_code,
          unit_code,
          base_price_per_gram,
          gst_amount_per_gram,
          final_price_per_gram,
          confidence,
          validation_passed,
          market_date,
          market_timestamp,
          fetched_at
        `)
        .eq("provider_code", PROVIDER)
        .eq("currency_code", "INR")
        .eq("unit_code", "gram")
        .eq("validation_passed", true)
        .in("market_city", [city, "India"]);

    if (rateError || !rates || rates.length === 0) {
      return respond({
        success: false,
        error: "MARKET_RATES_UNAVAILABLE",
      }, 503);
    }

    const gold: Record<string, unknown> = {};
    const timestamps: number[] = [];
    const marketTimestamps: number[] = [];
    const confidences: string[] = [];
    const marketDates: string[] = [];

    function normalizeRate(
      rate: NonNullable<typeof rates>[number],
      calculated = false,
    ) {
      const base = validNumber(rate.base_price_per_gram);
      const gst = validNumber(rate.gst_amount_per_gram);
      const final = validNumber(rate.final_price_per_gram);

      if (
        base <= 0 ||
        final < base ||
        Math.abs(final - base - gst) > 0.021
      ) {
        throw new Error("INVALID_CACHED_RATE");
      }

      if (
        rate.confidence !== "high" &&
        rate.confidence !== "medium"
      ) {
        throw new Error("INVALID_CACHED_CONFIDENCE");
      }

      timestamps.push(validTimestamp(rate.fetched_at));
      marketTimestamps.push(
        validTimestamp(rate.market_timestamp),
      );

      confidences.push(rate.confidence);
      marketDates.push(rate.market_date);

      return {
        basePricePerGram: round(base),
        gstAmountPerGram: round(gst),
        finalPricePerGram: round(final),
        confidence: rate.confidence,
        calculated,
        marketTimestamp: rate.market_timestamp,
      };
    }

    for (const purity of GOLD_PURITIES) {
      const rate = rates.find((item) =>
        item.metal_code === "gold" &&
        item.market_city === city &&
        item.purity_code === purity
      );

      if (!rate) {
        return respond({
          success: false,
          error: "INCOMPLETE_MARKET_RATES",
        }, 503);
      }

      const normalized = normalizeRate(
        rate,
        purity === "20K",
      );

      gold[purity] = {
        ...normalized,
        basePricePer10g: round(
          normalized.basePricePerGram * 10,
        ),
        finalPricePer10g: round(
          normalized.finalPricePerGram * 10,
        ),
      };
    }

    const silverRate = rates.find((item) =>
      item.metal_code === "silver" &&
      item.market_city === "India" &&
      item.purity_code === "999"
    );

    if (!silverRate) {
      return respond({
        success: false,
        error: "INCOMPLETE_MARKET_RATES",
      }, 503);
    }

    const silver = normalizeRate(silverRate);

    // Ensure the response represents one atomic cache update.
    if (new Set(timestamps).size !== 1) {
      return respond({
        success: false,
        error: "INCONSISTENT_RATE_SNAPSHOT",
      }, 503);
    }

    const fetchedAt = Math.min(...timestamps);

    const fresh = freshness(fetchedAt);

    return respond({
      success: true,
      schemaVersion: 1,
      provider: source.display_name,
      providerCode: PROVIDER,
      market: "India",
      city,
      currency: "INR",
      unit: "gram",
      indicative: true,
      gstIncluded: false,
      marketDate: marketDates.sort()[0],
      lastUpdatedAt: new Date(fetchedAt).toISOString(),
      marketTimestamp: new Date(
        Math.min(...marketTimestamps),
      ).toISOString(),
      confidence: confidences.includes("medium")
        ? "medium"
        : "high",
      freshness: fresh,
      gold,
      silver: {
        ...silver,
        market: "India",
        purityVerified: false,
        basePricePerKg: round(
          silver.basePricePerGram * 1000,
        ),
        finalPricePerKg: round(
          silver.finalPricePerGram * 1000,
        ),
      },
      disclaimer:
        "Indicative Indian market rates. Actual jewellery prices may vary.",
    }, 200, "no-store");

  } catch {
    return respond({
      success: false,
      error: "MARKET_RATE_SERVICE_UNAVAILABLE",
    }, 503);
  }
});