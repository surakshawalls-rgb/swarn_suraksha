import { createClient } from 'npm:@supabase/supabase-js@2';
import { asObject, jsonResponse, MarketRateError, normalizeNebula, secretsMatch, type MetalCode } from '../_shared/market-rates.ts';

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return jsonResponse({error:'METHOD_NOT_ALLOWED'},405);
  const expected = Deno.env.get('NEBULA_SYNC_SECRET');
  const supplied = req.headers.get('x-sync-secret') ?? '';
  if (!expected || !supplied || !(await secretsMatch(supplied, expected))) return jsonResponse({error:'UNAUTHORIZED'},401);
  const url = Deno.env.get('SUPABASE_URL');
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const apiKey = Deno.env.get('NEBULA_API_KEY');
  const base = Deno.env.get('NEBULA_API_BASE_URL')?.replace(/\/$/,'');
  const city = Deno.env.get('NEBULA_DEFAULT_CITY');
  if (!url || !key || !apiKey || base !== 'https://workspace.nebulaapi.com' || !city) return jsonResponse({error:'CONFIGURATION_ERROR'},503);
  const db = createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false},global:{fetch:(input,init)=>fetch(input,{...init,signal:AbortSignal.timeout(15000)})}});
  let runId: number | null = null;
  let count = 0;
  try {
    const body = asObject(await req.json().catch(()=>null));
    // Only controlled tests are supported in this patch. Scheduler remains disabled.
    if (body.mode !== 'test') return jsonResponse({error:'MODE_NOT_SUPPORTED'},400);
    const {data:source,error:sourceError} = await db.from('metal_rate_sources').select('enabled,public_config').eq('provider_code','nebula').single();
    if (sourceError || !source) throw new MarketRateError('DATABASE_READ_FAILED');
    const config = asObject(source.public_config);
    if (!source.enabled || config.controlled_test_enabled !== true) return jsonResponse({outcome:'skipped',reason:'test_disabled'});
    if (config.default_city !== city || config.rate_type !== 'live' || config.gst_included !== false) throw new MarketRateError('CONFIGURATION_ERROR');
    const recovery = await db.rpc('ss_recover_abandoned_market_rate_sync',{p_provider_code:'nebula'});
    if (recovery.error) throw new MarketRateError('DATABASE_RECOVERY_FAILED');
    const begin = await db.rpc('ss_begin_market_rate_sync',{p_provider_code:'nebula'});
    if (begin.error) throw new MarketRateError('DATABASE_BEGIN_FAILED');
    const started = asObject(begin.data);
    if (started.success !== true) return jsonResponse({outcome:'skipped',reason:started.reason});
    runId = Number(started.run_id);
    if (!Number.isSafeInteger(runId) || runId <= 0) {runId=null;throw new MarketRateError('DATABASE_BEGIN_FAILED');}
    const active = asObject(started.config);
    if (active.controlled_test_enabled !== true || active.default_city !== city || active.rate_type !== 'live') throw new MarketRateError('CONFIGURATION_ERROR');
    // Consume the explicit test authorization before any provider request.
    const disarm = await db.from('metal_rate_sources').update({public_config:{...active,controlled_test_enabled:false}}).eq('provider_code','nebula').eq('public_config->>controlled_test_enabled','true').select('provider_code').single();
    if (disarm.error || !disarm.data) throw new MarketRateError('DATABASE_TEST_DISARM_FAILED');
    async function fetchMetal(metal: MetalCode) {
      const endpoint = new URL(`${base}/${metal}_price`);
      endpoint.searchParams.set('city',city!);
      count++;
      const response = await fetch(endpoint,{headers:{'x-api-key':apiKey!,Accept:'application/json'},redirect:'error',signal:AbortSignal.timeout(10000)});
      if (!response.ok) throw new MarketRateError(({401:'API_UNAUTHORIZED',403:'API_UNAUTHORIZED',429:'RATE_LIMIT_EXCEEDED',402:'INSUFFICIENT_CREDITS'} as Record<number,string>)[response.status] ?? 'PROVIDER_UNAVAILABLE',response.status);
      const payload = await response.json().catch(()=>{throw new MarketRateError('INVALID_RESPONSE');});
      return normalizeNebula(payload,metal,city!);
    }
    const rates = [...await fetchMetal('gold'),...await fetchMetal('silver')];
    const commit = await db.rpc('ss_commit_market_rate_sync',{p_run_id:runId,p_rates:rates,p_request_count:count});
    if (commit.error || commit.data?.success !== true) throw new MarketRateError('DATABASE_COMMIT_FAILED');
    return jsonResponse({outcome:'success',run_id:runId,saved_rate_count:rates.length,request_count:count});
  } catch (error) {
    const code = error instanceof MarketRateError ? error.code : error instanceof Error && ['TimeoutError','AbortError'].includes(error.name) ? 'API_TIMEOUT' : 'UNKNOWN_ERROR';
    let failureRecorded = false;
    if (runId !== null) {
      try {
        const result = await db.rpc('ss_fail_market_rate_sync',{p_run_id:runId,p_error_code:code,p_request_count:count,p_http_status:error instanceof MarketRateError ? error.httpStatus : null});
        failureRecorded = !result.error && result.data?.outcome === 'failed';
      } catch { /* recovery RPC can close abandoned runs */ }
    }
    console.error('Nebula sync failed',{code,runId,count,failureRecorded});
    return jsonResponse({error:code,run_id:runId,request_count:count,failure_recorded:failureRecorded},502);
  }
});
