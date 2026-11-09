# SwarnaSuraksha implementation plan

This plan converts the product guide into an incremental build order for the current Angular 21, Ionic, and Supabase starter. A feature is complete only after its database authorization, failure path, and end-to-end acceptance scenario are verified.

## Repository audit

- Existing foundation: Angular 21 standalone app, Ionic, Google OAuth, Supabase client, profile upsert, workspace membership resolver, onboarding through `create_business`, and the initial SQL foundation for profiles, businesses, settings, customers, rate snapshots, and audit records.
- Missing application areas: module navigation and permissions, current-rate UI and provider, customer directory/detail/statement, suppliers and purchases, sales bills/payments/partial-return workflow/receipts, separate inventory ledger, girvi custody/loan/repayment/release, cashbook, reports/exports, user administration, notifications, and operational audit workflows.
- Missing engineering foundations: centralized database types, transactional business RPCs for multi-row financial writes, idempotency, role/permission model, error/connection state, automated test runner, and backup/restore runbook.
- Known schema drift: the live `business_members` API returned SQLSTATE `42703` for `is_active`, while the repository's initial migration and helper functions define and use that column. The current client query no longer filters on it. Before any membership-policy migration, inspect hosted columns and the definitions of `is_business_member` / `has_business_role` using `supabase/diagnostics/business_members_inspection.sql`.
- Live database access is not available in the current development session. Repository migrations describe intended starting schema, not proof of hosted schema or applied migration history. Do not run the initial foundation migration against the hosted project blindly.

## Delivery order

### Phase 0: product foundation

- [x] Establish responsive navigation shell and workspace selection. The overview queries tenant-scoped customer/supplier counts and latest manual rate with per-source errors. Sales and due balances use additive RPC migration `009_dashboard_summary.sql`, pending hosted inspection/application.
- [x] Add first centralized Supabase table contracts and a Node unit-test command; fixed-decimal money parsing and illustrative compound schedule have unit coverage.
- [x] Preserve Google OAuth; resolve Angular 21 zoneless UI refresh and remove the confirmed unsupported `business_members.is_active` client filter without changing RLS.
- [ ] Complete role/permission model, shared formatters/validators, online/offline handling, audit conventions, and tenant/RLS automated tests.

### Phase 1: core business records

- [ ] Customers: searchable, paginated, tenant-filtered directory with duplicate warnings, create/edit, archive/restore, and a chronological invoice/payment/return/refund account ledger with opening/closing and running balances, date filters, pagination, print, and CSV are implemented in the client. Migrations `017_customer_statement_read_model.sql` and `018_customer_transaction_ledger.sql` are pending hosted review/application. Pledge history and a dedicated customer detail route remain.
- [ ] Suppliers: searchable directory, duplicate warnings, and archive/restore are implemented behind the additive `004_suppliers.sql` migration. The migration must pass its hosted membership-helper preflight; supplier statements now show up to 500 recent purchases with payment methods, balances, and formula-safe CSV export.
- [ ] Rates: a manual, append-only snapshot screen now records separate reference/buy/sell amounts with unit, purity, reason, and timestamp behind `005_manual_rate_snapshots.sql`. The migration is unapplied pending live helper/schema inspection. Provider-backed rates, freshness states, audited corrections, and sale pricing snapshots remain.
- [ ] Purchases: supplier purchase posting is an idempotent atomic transaction with item snapshots, split/partial payments, owned-stock movement, cashbook outflows, and audit event. Owners/admins can record later settlements through `ss_record_purchase_payment`; migration `008_account_payments.sql` adds idempotency keys and atomically updates payment, bill balance, cashbook, and audit. A4/thermal supplier vouchers use saved purchase snapshots and audit print requests through migration `011_purchase_receipt_audit.sql`. Migrations `006`–`008` and `011` remain unapplied pending hosted metadata review. Purchase reversals, tax configuration, and hosted concurrency/tenant tests remain.
- [ ] Sales: owners/admins post bills from gram-based manual shop-rate snapshots, optionally link a customer, accept partial/split payments, and atomically reduce owned stock and record cashbook/audit through `ss_post_sale`. Later collections use `ss_record_sale_payment` in migration `008_account_payments.sql`. Receipts render A4 or 80 mm thermal layouts from saved invoice snapshots; print requests are audited by migration `010_business_reports.sql`. Migrations `007`–`010` remain unapplied pending hosted metadata review. Full-line returns now reverse owned stock, reduce unpaid balance first, refund only from collected payments, add refund cashbook entries, provide audited A4/thermal return vouchers, and retain the immutable source invoice. Migration `012_sales_returns.sql` remains pending hosted preflight/application. Partial quantity returns, tax, staff permissions, and live cross-tenant/concurrency tests remain.
- [ ] Cashbook: a tenant-checked `ss_cashbook_page` RPC merges purchase outflows, sale inflows, return refunds, and owner/admin-only expense outflows before date-filtered pagination. Formula-safe current-page CSV export remains available. Review `supabase/diagnostics/cashbook_paging_inspection.sql` and `supabase/diagnostics/operating_expenses_inspection.sql` before applying additive migrations `013_cashbook_paging.sql` and `014_operating_expenses.sql`; opening balance, reconciliation, and other cash sources remain.
- [x] Operating expenses: owners/admins can post paid costs through an idempotent atomic RPC, with linked cashbook and audit entries, restricted read policies, recent-record list, and formula-safe CSV. The report now has an expense-aware `ss_business_report_v3`. Tax stays uncalculated. Migration `014_operating_expenses.sql` is pending hosted read-only inspection and application; expense adjustments/reversals and unpaid bills remain future workflows.
- [x] Owned inventory read view: current net weight by metal/purity and paginated, date/metal-filtered movement history combine purchase, sale, and return ledgers under a membership-checked server read model. Pledged custody remains separate. Review `supabase/diagnostics/owned_inventory_inspection.sql` and apply additive migration `015_owned_inventory_read_models.sql` only after hosted preflight. Item/location tracking, valuation, and approved adjustment posting remain future work.
- [x] Administrator audit feed: an owner/admin-only server RPC unifies existing immutable purchase/sale/payment/return/expense/receipt/export events, with date/event filters, paging, and CSV. Review `supabase/diagnostics/admin_audit_feed_inspection.sql` and apply additive migration `016_admin_audit_feed.sql` only after hosted preflight. Team/role administration, audit-feed export auditing, and coverage of future events remain.

### Phase 2: girvi

- [ ] Pledge intake with item-level custody, valuation snapshot, terms, approval, disbursement, receipt, repayment allocation, payoff, release checklist, and cancellation by reversal.
- [ ] Decimal-safe calculation engine with agreement-level incomplete-period, compounding, capitalization, repayment-allocation, and rounding rules. Posting remains disabled until the business configures those rules.

### Phase 3: inventory, reports, audit, and notifications

- [ ] Business-owned purchase/sale/return inventory is displayed separately from customer pledge custody. Migration `015_owned_inventory_read_models.sql` is pending hosted inspection/application; item/location-level stock and controlled adjustments remain.
- [ ] The owner/admin daily report aggregates sales, full-line returns, purchases, paid expenses, collections, refunds, and owned-stock movements; CSV export is audited. Migrations `010_business_reports.sql`, `012_sales_returns.sql`, and `014_operating_expenses.sql` remain pending hosted inspection/application. PDF/print output, broader payment-mode reports, non-sale/purchase cash sources, and live reconciliation tests remain.
- [ ] Permissioned append-only audit events exist in workflow-specific ledgers and are surfaced through an admin feed; additional user/role/configuration, rate changes, adjustments, notifications, and audit-export actions are not yet covered. Consent-aware reminders and provider delivery state remain unimplemented.

### Phase 4: Android hardening and release

- [ ] Capacitor integration, native device testing for camera, file access, PDF, print/share, notifications, back behavior, safe areas, offline indicators, and release signing.
- [ ] Backup/restore rehearsal, privacy/retention policy, crash monitoring, and deployment environment configuration.

## Decisions that remain configurable or block production posting

- Metal-rate provider, license, API limits, and refresh interval are not supplied. Use manual snapshots only; do not call a provider or label rates live until selected and configured.
- Applicable tax/GST settings and receipt content require business/accountant confirmation. Keep tax configurable and disabled until configured; do not hard-code a tax rate.
- Girvi legal permissions, disclosures, interest rules, incomplete-month treatment, repayment allocation, fees, waivers, and rounding require the business's reviewed policy. Pledge posting stays disabled until the business supplies its rules; no universal 3% policy is assumed.
- The initial app has business-level tenancy; branch scope, business role matrix, approval thresholds, and user provisioning policy require confirmation before they become security rules.
- Receipt numbering, printer models, enabled languages, data retention, backup retention, communication channels, consent/opt-out rules, and the deployment domain remain unspecified.

## Acceptance gate

For each workflow, cover authorized and unauthorized users, validation, server errors, retry/double submit, tenant isolation, mobile layout, and reconciliation. Do not label live rates, payment, WhatsApp delivery, backups, or hosted SQL as successful unless independently confirmed.
