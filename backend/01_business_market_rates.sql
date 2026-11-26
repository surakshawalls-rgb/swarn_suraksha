BEGIN;
CREATE OR REPLACE FUNCTION public.ss_get_business_market_rates(p_business_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE result jsonb;
BEGIN
 IF auth.uid() IS NULL OR public.has_business_access(p_business_id) IS DISTINCT FROM true THEN
  RAISE EXCEPTION 'Business access denied' USING ERRCODE='42501';
 END IF;
 WITH source AS (SELECT display_name,public_config FROM public.metal_rate_sources WHERE provider_code='nebula'),
 rates AS (SELECT c.* FROM public.ss_market_rate_cache c CROSS JOIN source s
 WHERE c.provider_code='nebula' AND c.currency_code='INR' AND c.unit_code='gram' AND c.validation_passed IS TRUE
 AND c.confidence IN ('high','medium') AND c.base_price_per_gram>0 AND c.market_timestamp IS NOT NULL
 AND ((c.metal_code='gold' AND c.market_city=s.public_config->>'default_city' AND c.purity_code IN ('24K','22K','20K','18K','14K')) OR (c.metal_code='silver' AND c.market_city='India' AND c.purity_code='999'))),
 snapshot AS (SELECT count(*) AS n,count(DISTINCT fetched_at) AS versions,min(fetched_at) AS fetched,min(market_timestamp) AS market_time,
 CASE WHEN bool_or(confidence='medium') THEN 'medium' ELSE 'high' END AS confidence,
 jsonb_object_agg(purity_code,jsonb_build_object('basePricePerGram',base_price_per_gram)) FILTER (WHERE metal_code='gold') AS gold,
 max(base_price_per_gram) FILTER (WHERE metal_code='silver') AS silver FROM rates)
 SELECT jsonb_build_object('gold',a.gold,'silver',jsonb_build_object('basePricePerGram',a.silver),'lastUpdatedAt',a.fetched,'marketTimestamp',a.market_time,'confidence',a.confidence,'provider',s.display_name,'city',s.public_config->>'default_city','automaticRefreshEnabled',COALESCE(s.public_config->'automatic_refresh_enabled'='true'::jsonb,false)) INTO result
 FROM snapshot a CROSS JOIN source s WHERE a.n=6 AND a.versions=1 AND a.silver IS NOT NULL;
 IF result IS NULL THEN RAISE EXCEPTION 'Validated market rates unavailable'; END IF;
 RETURN result;
END; $$;
REVOKE ALL ON FUNCTION public.ss_get_business_market_rates(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.ss_get_business_market_rates(uuid) TO authenticated;
COMMIT;
