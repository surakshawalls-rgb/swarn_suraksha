/**
 * Centralized contract for the tables currently used by the client.
 * Refresh from the hosted schema before extending it; do not copy the local
 * foundation migration blindly because live business_members lacks is_active.
 */
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export interface Database {
  public: {
    Tables: {
      user_profiles: {
        Row: { user_id: string; display_name: string | null; mobile_number: string | null; created_at: string; updated_at: string };
        Insert: { user_id: string; display_name?: string | null; mobile_number?: string | null; created_at?: string; updated_at?: string };
        Update: { display_name?: string | null; mobile_number?: string | null; updated_at?: string };
        Relationships: [];
      };
      business_profiles: {
        Row: { id: string; owner_user_id: string; business_name: string; legal_name: string | null; business_type: string; phone: string | null; email: string | null; address: Record<string, unknown>; currency_code: string; timezone: string; created_at: string; updated_at: string };
        Insert: { id?: string; owner_user_id: string; business_name: string; legal_name?: string | null; business_type?: string; phone?: string | null; email?: string | null; address?: Record<string, unknown>; currency_code?: string; timezone?: string; created_at?: string; updated_at?: string };
        Update: { business_name?: string; legal_name?: string | null; business_type?: string; phone?: string | null; email?: string | null; address?: Record<string, unknown>; currency_code?: string; timezone?: string; updated_at?: string };
        Relationships: [];
      };
      business_members: {
        Row: { id: string; business_id: string; user_id: string; role: 'owner' | 'admin' | 'staff' | 'viewer'; status: string; created_at: string };
        Insert: { business_id: string; user_id: string; role?: 'owner' | 'admin' | 'staff' | 'viewer'; status?: string; created_at?: string };
        Update: { role?: 'owner' | 'admin' | 'staff' | 'viewer'; status?: string };
        Relationships: [];
      };
      customers: {
        Row: { id: string; business_id: string; customer_code: string | null; full_name: string; phone: string | null; email: string | null; address: Record<string, unknown>; notes: string | null; status: string; created_at: string };
        Insert: { id?: string; business_id: string; customer_code?: string | null; full_name: string; phone?: string | null; email?: string | null; address?: Record<string, unknown>; notes?: string | null; status?: string; created_at?: string };
        Update: { full_name?: string; phone?: string | null; email?: string | null; address?: Record<string, unknown>; notes?: string | null; status?: string };
        Relationships: [];
      };
      ss_suppliers: {
        Row: { id: string; business_id: string; name: string; mobile_number: string | null; email: string | null; address: string | null; notes: string | null; is_active: boolean; created_by: string; created_at: string; updated_at: string };
        Insert: { id?: string; business_id: string; name: string; mobile_number?: string | null; email?: string | null; address?: string | null; notes?: string | null; is_active?: boolean; created_by?: string; created_at?: string; updated_at?: string };
        Update: { name?: string; mobile_number?: string | null; email?: string | null; address?: string | null; notes?: string | null; is_active?: boolean; updated_at?: string };
        Relationships: [];
      };
      ss_metal_rate_snapshots: {
        Row: { id: string; business_id: string; metal: 'gold' | 'silver'; purity: string | null; unit: 'gram' | 'kilogram'; reference_rate: string; shop_buy_rate: string; shop_sell_rate: string; source_type: 'manual'; source_label: string; reason: string; entered_by: string; recorded_at: string };
        Insert: { id?: string; business_id: string; metal: 'gold' | 'silver'; purity?: string | null; unit: 'gram' | 'kilogram'; reference_rate: number | string; shop_buy_rate: number | string; shop_sell_rate: number | string; source_type?: 'manual'; source_label?: string; reason: string; entered_by?: string; recorded_at?: string };
        Update: never;
        Relationships: [];
      };
      ss_purchases: {
        Row: { id: string; business_id: string; supplier_id: string; purchase_number: number; idempotency_key: string; request_payload: unknown; subtotal: string; paid_total: string; created_by: string; created_at: string };
        Insert: never; Update: never; Relationships: [];
      };
      ss_purchase_lines: {
        Row: { id: string; business_id: string; purchase_id: string; line_number: number; item_description: string; metal: 'gold' | 'silver' | 'other'; purity: string | null; gross_weight_g: string; net_weight_g: string; unit_cost_per_gram: string; additional_cost: string; line_total: string; created_at: string };
        Insert: never; Update: never; Relationships: [];
      };
      ss_purchase_payments: {
        Row: { id: string; business_id: string; purchase_id: string; method: 'cash' | 'upi' | 'bank_transfer' | 'card'; amount: string; reference: string | null; received_by: string; recorded_at: string; idempotency_key: string };
        Insert: never; Update: never; Relationships: [];
      };
      ss_inventory_movements: {
        Row: { id: string; business_id: string; source_type: 'purchase'; source_id: string; source_line_id: string; metal: 'gold' | 'silver' | 'other'; purity: string | null; weight_delta_g: string; actor_user_id: string; recorded_at: string };
        Insert: never; Update: never; Relationships: [];
      };
      ss_cashbook_entries: {
        Row: { id: string; business_id: string; source_type: 'purchase_payment'; source_id: string; direction: 'in' | 'out'; amount: string; method: 'cash' | 'upi' | 'bank_transfer' | 'card'; actor_user_id: string; recorded_at: string };
        Insert: never; Update: never; Relationships: [];
      };
      ss_audit_events: {
        Row: { id: string; business_id: string; actor_user_id: string; event_type: 'purchase.posted'; entity_type: 'purchase'; entity_id: string; safe_metadata: unknown; recorded_at: string };
        Insert: never; Update: never; Relationships: [];
      };
      ss_sales: {
        Row: { id: string; business_id: string; customer_id: string | null; invoice_number: number; idempotency_key: string; request_payload: unknown; subtotal: string; paid_total: string; created_by: string; created_at: string };
        Insert: never; Update: never; Relationships: [];
      };
      ss_sale_lines: {
        Row: { id: string; business_id: string; sale_id: string; line_number: number; item_description: string; metal: 'gold' | 'silver' | 'other'; purity: string | null; gross_weight_g: string; net_weight_g: string; rate_snapshot_id: string; unit_rate_per_gram: string; making_charge: string; line_total: string; created_at: string };
        Insert: never; Update: never; Relationships: [];
      };
      ss_sale_payments: {
        Row: { id: string; business_id: string; sale_id: string; method: 'cash' | 'upi' | 'bank_transfer' | 'card'; amount: string; reference: string | null; received_by: string; recorded_at: string; idempotency_key: string };
        Insert: never; Update: never; Relationships: [];
      };
      ss_sale_inventory_movements: {
        Row: { id: string; business_id: string; sale_id: string; sale_line_id: string; metal: 'gold' | 'silver' | 'other'; purity: string | null; weight_delta_g: string; actor_user_id: string; recorded_at: string };
        Insert: never; Update: never; Relationships: [];
      };
      ss_sale_cashbook_entries: {
        Row: { id: string; business_id: string; sale_id: string; sale_payment_id: string; direction: 'in'; amount: string; method: 'cash' | 'upi' | 'bank_transfer' | 'card'; actor_user_id: string; recorded_at: string };
        Insert: never; Update: never; Relationships: [];
      };
      ss_sale_audit_events: {
        Row: { id: string; business_id: string; sale_id: string; actor_user_id: string; event_type: 'sale.posted'; safe_metadata: unknown; recorded_at: string };
        Insert: never; Update: never; Relationships: [];
      };
      ss_sale_returns: {
        Row: { id: string; business_id: string; sale_id: string; sale_line_id: string; idempotency_key: string; original_line_amount: string; balance_reduction: string; cash_refund: string; refund_method: 'cash' | 'upi' | 'bank_transfer' | 'card' | null; reason: string; actor_user_id: string; recorded_at: string };
        Insert: never; Update: never; Relationships: [];
      };
      ss_sale_return_inventory_movements: {
        Row: { id: string; business_id: string; sale_return_id: string; sale_line_id: string; metal: 'gold' | 'silver' | 'other'; purity: string | null; weight_delta_g: string; actor_user_id: string; recorded_at: string };
        Insert: never; Update: never; Relationships: [];
      };
      ss_sale_return_cashbook_entries: {
        Row: { id: string; business_id: string; sale_return_id: string; sale_id: string; direction: 'out'; amount: string; method: 'cash' | 'upi' | 'bank_transfer' | 'card'; actor_user_id: string; recorded_at: string };
        Insert: never; Update: never; Relationships: [];
      };
      ss_sale_return_receipt_events: {
        Row: { id: string; business_id: string; sale_return_id: string; actor_user_id: string; action: 'print_requested'; recorded_at: string };
        Insert: never; Update: never; Relationships: [];
      };
      ss_expenses: {
        Row: { id:string; business_id:string; expense_number:number; idempotency_key:string; request_payload:unknown; category:string; description:string; payee:string|null; amount:string; method:'cash'|'upi'|'bank_transfer'|'card'; reference:string|null; occurred_at:string; created_by:string; created_at:string };
        Insert: never; Update: never; Relationships: [];
      };
      ss_expense_cashbook_entries: {
        Row: { id:string; business_id:string; expense_id:string; direction:'out'; amount:string; method:'cash'|'upi'|'bank_transfer'|'card'; actor_user_id:string; recorded_at:string };
        Insert: never; Update: never; Relationships: [];
      };
      ss_payment_audit_events: {
        Row: { id: string; business_id: string; event_type: 'purchase_payment.recorded' | 'sale_payment.recorded'; purchase_id: string | null; sale_id: string | null; payment_id: string; actor_user_id: string; safe_metadata: unknown; recorded_at: string };
        Insert: never; Update: never; Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: {
      create_business: {
        Args: { p_business_name: string; p_owner_contact_name?: string | null; p_mobile_number?: string | null; p_address?: string | null; p_city?: string | null; p_state?: string | null; p_postal_code?: string | null };
        Returns: string;
      };
      ss_post_purchase: {
        Args: { p_business_id: string; p_supplier_id: string; p_idempotency_key: string; p_lines: unknown; p_payments: unknown };
        Returns: string;
      };
      ss_post_sale: {
        Args: { p_business_id: string; p_customer_id: string | null; p_idempotency_key: string; p_lines: unknown; p_payments: unknown };
        Returns: string;
      };
      ss_record_purchase_payment: {
        Args: { p_business_id: string; p_purchase_id: string; p_idempotency_key: string; p_amount: number | string; p_method: string; p_reference?: string | null };
        Returns: string;
      };
      ss_record_sale_payment: {
        Args: { p_business_id: string; p_sale_id: string; p_idempotency_key: string; p_amount: number | string; p_method: string; p_reference?: string | null };
        Returns: string;
      };
      ss_return_sale_line: {
        Args: { p_business_id: string; p_sale_id: string; p_sale_line_id: string; p_idempotency_key: string; p_reason: string; p_refund_method?: string | null };
        Returns: string;
      };
      ss_audit_sale_return_receipt_print: {
        Args: { p_business_id: string; p_sale_return_id: string };
        Returns: string;
      };
      ss_post_expense: {
        Args: { p_business_id:string; p_idempotency_key:string; p_category:string; p_description:string; p_payee?:string|null; p_amount:number|string; p_method:string; p_reference?:string|null; p_occurred_at:string };
        Returns:string;
      };
      ss_owned_inventory_summary: {
        Args: { p_business_id:string };
        Returns: { metal:string; purity:string|null; owned_weight_g:number }[];
      };
      ss_owned_inventory_page: {
        Args: { p_business_id:string; p_metal?:string|null; p_from?:string|null; p_through?:string|null; p_offset?:number; p_limit?:number };
        Returns: { movement_id:string; source_type:string; source_id:string; metal:string; purity:string|null; weight_delta_g:number; recorded_at:string; total_count:number }[];
      };
      ss_admin_audit_page: {
        Args: { p_business_id:string; p_from?:string|null; p_through?:string|null; p_event_type?:string|null; p_offset?:number; p_limit?:number };
        Returns: { event_id:string; event_type:string; entity_type:string; entity_id:string; actor_user_id:string; recorded_at:string; safe_metadata:Record<string,unknown>; total_count:number }[];
      };
      ss_customer_statement_page: {
        Args: { p_business_id:string; p_customer_id:string; p_from?:string|null; p_through?:string|null; p_offset?:number; p_limit?:number };
        Returns: Json;
      };
      ss_customer_ledger_page: {
        Args: { p_business_id:string; p_customer_id:string; p_from?:string|null; p_through?:string|null; p_offset?:number; p_limit?:number };
        Returns: Json;
      };
      ss_girvi_create: {
        Args: { p_business_id:string; p_customer_id:string; p_idempotency_key:string; p_metal:string; p_purity:string|null; p_weight_g:number|string; p_rate_per_gram:number|string; p_principal:number|string; p_monthly_interest_percent:number|string; p_girvi_date:string; p_notes?:string|null };
        Returns: string;
      };
      ss_girvi_record_payment: {
        Args: { p_business_id:string; p_girvi_id:string; p_idempotency_key:string; p_amount:number|string; p_method:string; p_payment_date?:string };
        Returns: Json;
      };
      ss_cashbook_page: {
        Args: { p_business_id: string; p_from?: string | null; p_through?: string | null; p_offset?: number; p_limit?: number };
        Returns: { id: string; payment_id: string; source: string; direction: 'in' | 'out'; amount: number; method: string; recorded_at: string; total_count: number }[];
      };
      ss_dashboard_summary: {
        Args: { p_business_id: string };
        Returns: { sales_total: number; purchases_total: number; customer_due: number; supplier_due: number; sale_count: number; purchase_count: number }[];
      };
      ss_business_report: {
        Args: { p_business_id: string; p_from: string; p_through: string };
        Returns: { report_day: string; sales_total: number; purchases_total: number; cash_received: number; cash_paid: number; gold_weight_change_g: number; silver_weight_change_g: number; other_weight_change_g: number; sales_count: number; purchases_count: number }[];
      };
      ss_business_report_v2: {
        Args: { p_business_id: string; p_from: string; p_through: string };
        Returns: { report_day: string; sales_total: number; returns_total: number; purchases_total: number; cash_received: number; cash_refunded: number; cash_paid: number; gold_weight_change_g: number; silver_weight_change_g: number; other_weight_change_g: number; sales_count: number; returns_count: number; purchases_count: number }[];
      };
      ss_business_report_v3: {
        Args: { p_business_id:string; p_from:string; p_through:string };
        Returns: { report_day:string; sales_total:number; returns_total:number; purchases_total:number; expenses_paid:number; cash_received:number; cash_refunded:number; cash_paid:number; gold_weight_change_g:number; silver_weight_change_g:number; other_weight_change_g:number; sales_count:number; returns_count:number; purchases_count:number; expenses_count:number }[];
      };
      ss_audit_report_export: {
        Args: { p_business_id: string; p_from: string; p_through: string };
        Returns: string;
      };
      ss_audit_sale_receipt_print: {
        Args: { p_business_id: string; p_sale_id: string };
        Returns: string;
      };
      ss_audit_purchase_receipt_print: {
        Args: { p_business_id: string; p_purchase_id: string };
        Returns: string;
      };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
}
