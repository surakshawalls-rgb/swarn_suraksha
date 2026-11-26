SwarnaSuraksha cache integration
1. Run backend/01_business_market_rates.sql in Supabase SQL Editor. It adds a read-only, business-authorized RPC; no provider flags or cron jobs are changed.
2. Back up your current src directory, then replace it with the included src directory.
3. Run npm run build and npm start from your existing project.
4. Business Home should display stored reference rates and a stale warning while automatic refresh is disabled. Billing and Girvi will not automatically apply stale market rates; saved shop/manual rates remain available. Personal dashboard remains unavailable until public access is authorized and enabled.
5. Test business access with approved and unapproved accounts, billing, exchange and Girvi before production.
No notifications or advertisements added. No Edge Function deployment needed for this patch. TypeScript syntax transpilation only; full Angular build and database execution not performed here. Provider rights and managed network grants remain unresolved. The UI clears displayed quotes on read failure rather than showing potentially unauthorized cached data. Existing database cache is not changed.
