import { createClient } from 'npm:@supabase/supabase-js@2';

import {
  asObject,
  jsonResponse,
  MarketRateError,
  normalizeNebula,
  secretsMatch,
  type MetalCode,
} from '../_shared/market-rates.ts';

type SyncMode = 'test' | 'scheduled';

Deno.serve(async (req: Request) => {

  // --------------------------------------------------
  // 1. HTTP method and authentication
  // --------------------------------------------------

  if (req.method !== 'POST') {
    return jsonResponse({
      error: 'METHOD_NOT_ALLOWED',
    }, 405);
  }

  const expected = Deno.env.get('NEBULA_SYNC_SECRET');

  const supplied = req.headers.get('x-sync-secret') ?? '';

  if (
    !expected ||
    !supplied ||
    !(await secretsMatch(supplied, expected))
  ) {
    return jsonResponse({
      error: 'UNAUTHORIZED',
    }, 401);
  }

  // --------------------------------------------------
  // 2. Server configuration
  // --------------------------------------------------

  const url = Deno.env.get('SUPABASE_URL');

  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

  const apiKey = Deno.env.get('NEBULA_API_KEY');

  const base = Deno.env
    .get('NEBULA_API_BASE_URL')
    ?.replace(/\/$/, '');

  const city = Deno.env.get('NEBULA_DEFAULT_CITY');

  if (
    !url ||
    !key ||
    !apiKey ||
    base !== 'https://workspace.nebulaapi.com' ||
    !city
  ) {
    return jsonResponse({
      error: 'CONFIGURATION_ERROR',
    }, 503);
  }

  const db = createClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
    global: {
      fetch: (input, init) =>
        fetch(input, {
          ...init,
          signal: AbortSignal.timeout(15000),
        }),
    },
  });

  let runId: number | null = null;

  let slotId: number | null = null;

  let mode: SyncMode | null = null;

  let count = 0;

  try {

    // ------------------------------------------------
    // 3. Validate execution mode
    // ------------------------------------------------

    const body = asObject(
      await req.json().catch(() => null),
    );

    const requestedMode = body['mode'];

    if (
      requestedMode !== 'test' &&
      requestedMode !== 'scheduled'
    ) {
      return jsonResponse({
        error: 'MODE_NOT_SUPPORTED',
      }, 400);
    }

    mode = requestedMode;

    // ------------------------------------------------
    // 4. Read provider configuration
    // ------------------------------------------------

    const {
      data: source,
      error: sourceError,
    } = await db
      .from('metal_rate_sources')
      .select('enabled,public_config')
      .eq('provider_code', 'nebula')
      .single();

    if (sourceError || !source) {
      throw new MarketRateError(
        'DATABASE_READ_FAILED',
      );
    }

    const config = asObject(source.public_config);

    // Preserve the existing controlled test behaviour.

    if (mode === 'test') {

      if (
        !source.enabled ||
        config['controlled_test_enabled'] !== true
      ) {
        return jsonResponse({
          outcome: 'skipped',
          reason: 'test_disabled',
        });
      }

    } else {

      if (!source.enabled) {
        return jsonResponse({
          outcome: 'skipped',
          mode,
          reason: 'provider_disabled',
        });
      }

      if (
        config['automatic_refresh_enabled'] !== true
      ) {
        return jsonResponse({
          outcome: 'skipped',
          mode,
          reason: 'automatic_refresh_disabled',
        });
      }

    }

    if (
      config['default_city'] !== city ||
      config['rate_type'] !== 'live' ||
      config['gst_included'] !== false
    ) {
      throw new MarketRateError(
        'CONFIGURATION_ERROR',
      );
    }

    // ------------------------------------------------
    // 5. Begin synchronization
    // ------------------------------------------------

    let begin;

    if (mode === 'scheduled') {

      // Database RPC handles:
      // - Provider and automatic refresh flags
      // - Scheduled execution window
      // - Duplicate slot protection
      // - Abandoned run recovery
      // - Atomic synchronization admission

      begin = await db.rpc(
        'ss_begin_scheduled_market_rate_sync',
      );

    } else {

      // Preserve existing controlled test flow.

      const recovery = await db.rpc(
        'ss_recover_abandoned_market_rate_sync',
        {
          p_provider_code: 'nebula',
        },
      );

      if (recovery.error) {
        throw new MarketRateError(
          'DATABASE_RECOVERY_FAILED',
        );
      }

      begin = await db.rpc(
        'ss_begin_market_rate_sync',
        {
          p_provider_code: 'nebula',
        },
      );

    }

    if (begin.error) {
      throw new MarketRateError(
        'DATABASE_BEGIN_FAILED',
      );
    }

    const started = asObject(begin.data);

    if (started['success'] !== true) {

      return jsonResponse({
        outcome: 'skipped',
        mode,
        reason: started['reason'],
      });

    }

    // ------------------------------------------------
    // 6. Validate admitted synchronization
    // ------------------------------------------------

    runId = Number(started['run_id']);

    if (
      !Number.isSafeInteger(runId) ||
      runId <= 0
    ) {
      runId = null;

      throw new MarketRateError(
        'DATABASE_BEGIN_FAILED',
      );
    }

    const active = asObject(started['config']);

    if (
      active['default_city'] !== city ||
      active['rate_type'] !== 'live' ||
      active['gst_included'] !== false
    ) {
      throw new MarketRateError(
        'CONFIGURATION_ERROR',
      );
    }

    if (mode === 'scheduled') {

      if (
        active['automatic_refresh_enabled'] !== true ||
        started['mode'] !== 'scheduled'
      ) {
        throw new MarketRateError(
          'CONFIGURATION_ERROR',
        );
      }

      slotId = Number(started['slot_id']);

      if (
        !Number.isSafeInteger(slotId) ||
        slotId <= 0
      ) {
        slotId = null;

        throw new MarketRateError(
          'DATABASE_BEGIN_FAILED',
        );
      }

    } else {

      if (
        active['controlled_test_enabled'] !== true
      ) {
        throw new MarketRateError(
          'CONFIGURATION_ERROR',
        );
      }

      // Consume the one-time test authorization.

      const disarm = await db
        .from('metal_rate_sources')
        .update({
          public_config: {
            ...active,
            controlled_test_enabled: false,
          },
        })
        .eq('provider_code', 'nebula')
        .eq(
          'public_config->>controlled_test_enabled',
          'true',
        )
        .select('provider_code')
        .single();

      if (disarm.error || !disarm.data) {
        throw new MarketRateError(
          'DATABASE_TEST_DISARM_FAILED',
        );
      }

    }

    // ------------------------------------------------
    // 7. Fetch provider rates
    // ------------------------------------------------

    async function fetchMetal(metal: MetalCode) {

      // Defensive request budget protection.

      if (count >= 2) {
        throw new MarketRateError(
          'REQUEST_LIMIT_EXCEEDED',
        );
      }

      const endpoint = new URL(
        `${base}/${metal}_price`,
      );

      endpoint.searchParams.set('city', city!);

      if (metal === 'gold') {
        endpoint.searchParams.set('rate', 'live');
      }

      count++;

      const response = await fetch(endpoint, {
        headers: {
          'x-api-key': apiKey!,
          Accept: 'application/json',
        },
        redirect: 'error',
        signal: AbortSignal.timeout(10000),
      });

      if (!response.ok) {

        const errorCodes: Record<number, string> = {
          401: 'API_UNAUTHORIZED',
          403: 'API_UNAUTHORIZED',
          402: 'INSUFFICIENT_CREDITS',
          429: 'RATE_LIMIT_EXCEEDED',
        };

        throw new MarketRateError(
          errorCodes[response.status] ??
            'PROVIDER_UNAVAILABLE',
          response.status,
        );

      }

      const payload = await response
        .json()
        .catch(() => {
          throw new MarketRateError(
            'INVALID_RESPONSE',
          );
        });

      return normalizeNebula(
        payload,
        metal,
        city!,
      );

    }

    // Exactly one gold and one silver request.
    // No automatic retries.

    const rates = [
      ...await fetchMetal('gold'),
      ...await fetchMetal('silver'),
    ];

    // ------------------------------------------------
    // 8. Atomic database commit
    // ------------------------------------------------

    const commit = await db.rpc(
      'ss_commit_market_rate_sync',
      {
        p_run_id: runId,
        p_rates: rates,
        p_request_count: count,
      },
    );

    if (
      commit.error ||
      commit.data?.success !== true
    ) {
      throw new MarketRateError(
        'DATABASE_COMMIT_FAILED',
      );
    }

    // The database trigger automatically completes
    // the scheduled slot when the run succeeds.

    return jsonResponse({
      outcome: 'success',
      mode,
      run_id: runId,
      slot_id: slotId,
      saved_rate_count: rates.length,
      request_count: count,
    });

  } catch (error) {

    // ------------------------------------------------
    // 9. Failure handling
    // ------------------------------------------------

    const code =
      error instanceof MarketRateError
        ? error.code
        : error instanceof Error &&
            ['TimeoutError', 'AbortError']
              .includes(error.name)
        ? 'API_TIMEOUT'
        : 'UNKNOWN_ERROR';

    let failureRecorded = false;

    if (runId !== null) {

      try {

        const result = await db.rpc(
          'ss_fail_market_rate_sync',
          {
            p_run_id: runId,
            p_error_code: code,
            p_request_count: count,
            p_http_status:
              error instanceof MarketRateError
                ? error.httpStatus
                : null,
          },
        );

        failureRecorded =
          !result.error &&
          result.data?.outcome === 'failed';

      } catch {
        // Recovery RPC can close abandoned runs.
      }

    }

    console.error('Nebula sync failed', {
      code,
      mode,
      runId,
      slotId,
      count,
      failureRecorded,
    });

    return jsonResponse({
      error: code,
      mode,
      run_id: runId,
      slot_id: slotId,
      request_count: count,
      failure_recorded: failureRecorded,
    }, 502);

  }

});