import { CommonModule } from '@angular/common';
import { ChangeDetectorRef, Component, OnDestroy, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { IonicModule } from '@ionic/angular';
import { Subscription } from 'rxjs';
import { LedgerPaymentComponent } from '../../core/financial/ledger-payment.component';
import { NetworkStatusService } from '../../core/network/network-status.service';
import { formatFixed, formatInr, parseFixed, purchaseLineTotal } from '../../core/financial/decimal';
import { BusinessWorkspace, WorkspaceService } from '../dashboard/workspace.service';

interface Supplier { id: string; name: string; is_active?: boolean; }
interface Purchase { id: string; supplier_id: string; purchase_number: number; subtotal: string; paid_total: string; created_at: string; }
interface PurchaseLine { purchase_id: string; item_description: string; metal: 'gold' | 'silver' | 'other'; purity: string | null; gross_weight_g:string; net_weight_g: string; unit_cost_per_gram:string; additional_cost:string; line_total: string; }
interface PurchasePayment { purchase_id: string; amount: string; method: string; reference?:string|null; recorded_at?:string; }
interface InventoryMovement { metal: string; purity: string | null; weight_delta_g: string; }
interface InventoryBalance { metal: string; purity: string | null; weight: bigint; }
interface PurchaseDraftLine { item_description: string; metal: 'gold' | 'silver' | 'other'; purity: string; gross_weight_g: string; net_weight_g: string; unit_cost_per_gram: string; additional_cost: string; }
interface PaymentDraft { method: 'cash' | 'upi' | 'bank_transfer' | 'card'; amount: string; reference: string; }
interface PendingPurchase { key: string; supplierId: string; lines: object[]; payments: object[]; }

@Component({
  standalone: true,
  imports: [CommonModule, FormsModule, IonicModule, RouterLink, LedgerPaymentComponent],
  template: `
    <header class="topbar"><div class="crumb"><a routerLink="/dashboard">Overview</a><span>›</span><b>Purchases</b></div><div class="top-actions"><button *ngIf="canPostPurchases" class="primary-btn" type="button" (click)="editing = !editing" [disabled]="!!pending"><svg class="btn-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg> Record purchase</button></div></header>
    <section class="content customers-page purchases-page">
      <div class="welcome"><div><p class="eyebrow">SUPPLIER PURCHASES · OWNED STOCK</p><h1>Purchases</h1><p class="subtitle">Posted purchases increase business-owned inventory. Customer pledged items are tracked separately.</p></div></div>
      <div class="config-banner" role="note"><span class="banner-icon">i</span><div><b>Amounts are captured at purchase time</b><p>Line cost is net grams × cost per gram plus additional charges, rounded to paise. Tax is not added because this business has no verified tax configuration.</p></div></div>
      <div class="config-banner error-banner" *ngIf="errorMessage" role="alert"><span class="banner-icon">!</span><div><b>Purchase data unavailable</b><p>{{errorMessage}}</p></div><button class="text-btn" type="button" (click)="load()">Retry</button></div>
      <p class="save-success" *ngIf="successMessage" role="status">{{successMessage}}</p>
      <div class="status-card" *ngIf="loading"><span class="spinner"></span><div><b>Loading purchase records</b><p>Reading tenant-scoped purchases and owned inventory movements.</p></div></div>

      <section class="panel customer-editor" *ngIf="editing && !pending">
        <div class="panel-head"><div><h2>Record a supplier purchase</h2><p>The purchase, item lines, stock movements, payments, and cashbook entries post atomically.</p></div><button class="text-btn" type="button" (click)="editing = false">Cancel</button></div>
        <form class="customer-form purchase-form" (ngSubmit)="post()">
          <label>Supplier <select [(ngModel)]="supplierId" name="supplier" required><option value="">Select active supplier</option><option *ngFor="let supplier of suppliers" [value]="supplier.id">{{supplier.name}}</option></select></label>
          <div class="purchase-lines">
            <div class="purchase-line" *ngFor="let line of lines; let i = index">
              <div class="line-heading"><b>Item {{i + 1}}</b><button *ngIf="lines.length > 1" class="text-btn danger-text" type="button" (click)="removeLine(i)">Remove</button></div>
              <label>Description<input [(ngModel)]="line.item_description" [name]="'description' + i" maxlength="180" required placeholder="e.g. 22K gold chain lot"></label>
              <label>Metal<select [(ngModel)]="line.metal" [name]="'metal' + i"><option value="gold">Gold</option><option value="silver">Silver</option><option value="other">Other</option></select></label>
              <label>Purity / grade<input [(ngModel)]="line.purity" [name]="'purity' + i" maxlength="40" placeholder="e.g. 22K"></label>
              <label>Gross weight (g)<input [(ngModel)]="line.gross_weight_g" [name]="'gross' + i" inputmode="decimal" required></label>
              <label>Net weight (g)<input [(ngModel)]="line.net_weight_g" [name]="'net' + i" inputmode="decimal" required></label>
              <label>Cost / gram (₹)<input [(ngModel)]="line.unit_cost_per_gram" [name]="'cost' + i" inputmode="decimal" required></label>
              <label>Additional cost (₹)<input [(ngModel)]="line.additional_cost" [name]="'extra' + i" inputmode="decimal" value="0"></label>
              <div class="line-total"><span>Line total</span><b>{{lineTotal(line)}}</b></div>
            </div>
            <button class="text-btn" type="button" (click)="addLine()" [disabled]="lines.length >= 100"><svg class="btn-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg> Add another item</button>
          </div>
          <div class="purchase-payments">
            <div class="line-heading"><b>Payments (optional; split payments supported)</b><button class="text-btn" type="button" (click)="addPayment()" [disabled]="payments.length >= 20"><svg class="btn-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg> Add payment</button></div>
            <div class="payment-line" *ngFor="let payment of payments; let i = index">
              <label>Method<select [(ngModel)]="payment.method" [name]="'paymentMethod' + i"><option value="cash">Cash</option><option value="upi">UPI</option><option value="bank_transfer">Bank transfer</option><option value="card">Card</option></select></label>
              <label>Amount (₹)<input [(ngModel)]="payment.amount" [name]="'paymentAmount' + i" inputmode="decimal"></label>
              <label>Reference (optional)<input [(ngModel)]="payment.reference" [name]="'paymentReference' + i" maxlength="120"></label>
              <button class="text-btn danger-text" type="button" (click)="removePayment(i)">Remove</button>
            </div>
          </div>
          <div class="purchase-summary"><span>Purchase total</span><b>{{totalLabel}}</b><span>Paid now</span><b>{{paidLabel}}</b><span>Balance payable</span><b>{{balanceLabel}}</b></div>
          <p class="duplicate-warning" role="note">Confirm supplier, metal, purity, gross/net weights, cost, and payments. Posting cannot be edited or deleted; corrections will be handled by a reversal workflow.</p>
          <p class="form-error" *ngIf="formError" role="alert">{{formError}}</p>
          <div class="form-actions"><button class="primary-btn" type="submit" [disabled]="saving || !(network.online$ | async) || !supplierId || !suppliers.length">{{saving ? 'Posting atomically…' : !(network.online$ | async) ? 'Offline — posting disabled' : 'Post purchase'}}</button><span>Amounts are validated again by the database.</span></div>
        </form>
      </section>
      <div class="config-banner" *ngIf="workspace?.role === 'staff'" role="status"><span class="banner-icon">i</span><div><b>Purchase posting is restricted</b><p>Only workspace owners and administrators can post supplier purchases until the business configures its staff permission policy.</p></div></div>
      <section class="panel customer-editor pending-purchase" *ngIf="pending">
        <b>Purchase result is not confirmed</b><p>The request may have reached Supabase. Retry the exact same payload safely; the idempotency key prevents a duplicate posting.</p>
        <p class="form-error" *ngIf="formError" role="alert">{{formError}}</p><button class="primary-btn" type="button" (click)="post()" [disabled]="saving || !(network.online$ | async)">{{saving ? 'Checking result…' : 'Retry same purchase safely'}}</button>
      </section>

      <section id="inventory" class="panel customer-list inventory-panel">
        <div class="panel-head"><div><h2>Owned inventory on hand</h2><p>Derived from purchase receipt movements. Pledged customer property is excluded.</p></div></div>
        <div class="inventory-grid" *ngIf="inventoryBalances.length; else noOwnedStock"><article class="inventory-balance" *ngFor="let row of inventoryBalances"><span>{{row.metal | titlecase}}{{row.purity ? ' · ' + row.purity : ''}}</span><b>{{formatFixed(row.weight, 4)}} g</b></article></div>
        <ng-template #noOwnedStock><div class="empty-state inventory-empty"><b>No owned-stock movement yet</b><p>Posted supplier purchases will add stock balances here.</p></div></ng-template>
      </section>

      <section class="panel customer-list purchase-history" *ngIf="!loading">
        <div class="panel-head"><div><h2>Recent posted purchases</h2><p>Each payment and stock movement is linked to its source purchase.</p></div><button class="text-btn" type="button" (click)="load()">Refresh</button></div>
        <div class="table-wrap" *ngIf="purchases.length; else emptyPurchases"><table><thead><tr><th>Purchase</th><th>Supplier</th><th>Items received</th><th>Total</th><th>Paid</th><th>Balance</th><th>Settlement</th><th>Receipt</th><th>Recorded</th></tr></thead><tbody>
          <tr *ngFor="let purchase of purchases"><td><b>#{{purchase.purchase_number}}</b></td><td>{{supplierName(purchase.supplier_id)}}</td><td><span *ngFor="let line of linesFor(purchase.id); let last = last">{{line.item_description}} · {{line.net_weight_g}} g{{last ? '' : '; '}}</span></td><td>{{inr(purchase.subtotal)}}</td><td>{{inr(purchase.paid_total)}}<small>{{paymentMethods(purchase.id)}}</small></td><td>{{balance(purchase)}}</td><td><ss-ledger-payment *ngIf="canPostPurchases" kind="purchase" [businessId]="workspace!.id" [transactionId]="purchase.id" [remaining]="balanceAmount(purchase)" (saved)="load()"></ss-ledger-payment></td><td><button *ngIf="canPostPurchases" class="text-btn" type="button" (click)="openReceipt(purchase)">Print voucher</button></td><td>{{purchase.created_at | date:'d MMM y, h:mm a':'Asia/Kolkata'}}</td></tr>
        </tbody></table></div>
        <ng-template #emptyPurchases><div class="empty-state customer-empty"><span class="empty-art">₹</span><b>No purchases recorded</b><p>Active suppliers are needed before receiving owned-stock purchase lines.</p><a class="text-btn" routerLink="/dashboard/suppliers">Open suppliers →</a></div></ng-template>
      </section>
    </section>
    <div class="receipt-overlay" *ngIf="receiptPurchase as receipt" role="dialog" aria-modal="true" aria-label="Supplier purchase voucher preview">
      <div class="receipt-screen"><div class="receipt-actions"><p *ngIf="receiptError" class="form-error" role="alert">{{receiptError}}</p><label>Layout<select [(ngModel)]="receiptFormat" name="purchaseReceiptFormat"><option value="a4">A4</option><option value="thermal">Thermal · 80 mm</option></select></label><button class="primary-btn" type="button" (click)="printReceipt()" [disabled]="receiptPrinting">{{receiptPrinting?'Preparing…':'Print voucher'}}</button><button class="text-btn" type="button" (click)="closeReceipt()" [disabled]="receiptPrinting">Close preview</button><span role="status">Print is requested from your device; completion is not confirmed by this app.</span></div>
        <article class="receipt-print" [class.receipt-thermal]="receiptFormat==='thermal'"><header><span class="brand-mark">S</span><h1>{{workspace?.name || 'SwarnaSuraksha Business'}}</h1><p>SUPPLIER PURCHASE VOUCHER</p></header><hr>
          <div class="receipt-meta"><span>Purchase</span><b>#{{receipt.purchase_number}}</b><span>Date</span><b>{{receipt.created_at | date:'d MMM y, h:mm a':'Asia/Kolkata'}}</b><span>Supplier</span><b>{{supplierName(receipt.supplier_id)}}</b></div>
          <table><thead><tr><th>Item</th><th>Gross / net wt.</th><th>Cost / g</th><th>Other</th><th>Amount</th></tr></thead><tbody><tr *ngFor="let line of linesFor(receipt.id)"><td>{{line.item_description}}<small>{{line.metal | titlecase}}{{line.purity ? ' · '+line.purity : ''}}</small></td><td>{{line.gross_weight_g}} / {{line.net_weight_g}} g</td><td>{{inr(line.unit_cost_per_gram)}}</td><td>{{inr(line.additional_cost)}}</td><td>{{inr(line.line_total)}}</td></tr></tbody></table>
          <div class="receipt-totals"><span>Subtotal</span><b>{{inr(receipt.subtotal)}}</b><span>Tax</span><b>Not configured</b><span>Paid</span><b>{{inr(receipt.paid_total)}}</b><span>Balance payable</span><b>{{balance(receipt)}}</b></div>
          <p class="receipt-note">Goods received and amounts are shown from the saved purchase records. Tax is not configured; this voucher is not a GST tax document.</p>
          <div class="receipt-payment" *ngIf="paymentsFor(receipt.id).length"><b>Payments recorded</b><p *ngFor="let payment of paymentsFor(receipt.id)">{{payment.recorded_at ? (payment.recorded_at | date:'d MMM y, h:mm a':'Asia/Kolkata')+' · ' : ''}}{{payment.method | titlecase}} · {{inr(payment.amount)}}{{payment.reference ? ' · Ref '+payment.reference : ''}}</p></div>
          <footer>Recorded in SwarnaSuraksha</footer>
        </article>
      </div>
    </div>
  `
})
export class PurchasesComponent implements OnInit, OnDestroy {
  loading = true;
  saving = false;
  editing = false;
  errorMessage = '';
  formError = '';
  suppliers: Supplier[] = [];
  allSuppliers: Supplier[] = [];
  purchases: Purchase[] = [];
  linesByPurchase = new Map<string, PurchaseLine[]>();
  paymentsByPurchase = new Map<string, PurchasePayment[]>();
  inventoryBalances: InventoryBalance[] = [];
  workspace: BusinessWorkspace | null = null;
  supplierId = '';
  lines: PurchaseDraftLine[] = [this.emptyLine()];
  payments: PaymentDraft[] = [];
  pending: PendingPurchase | null = null;
  successMessage = '';
  receiptPurchase:Purchase|null=null;receiptError='';receiptPrinting=false;receiptFormat:'a4'|'thermal'='a4';
  private workspaceSubscription: Subscription | null = null;
  private requestId = 0;

  constructor(private readonly workspaceService: WorkspaceService, readonly network: NetworkStatusService, private readonly cdr: ChangeDetectorRef) {}

  get canPostPurchases(): boolean { return this.workspace?.role === 'owner' || this.workspace?.role === 'admin'; }

  ngOnInit(): void {
    this.workspaceSubscription = this.workspaceService.activeWorkspace$.subscribe(workspace => {
      if (workspace && workspace.id === this.workspace?.id && workspace.role === this.workspace?.role) return;
      this.workspace = workspace;
      this.suppliers=[];this.allSuppliers=[];this.purchases=[];this.linesByPurchase.clear();this.paymentsByPurchase.clear();this.inventoryBalances=[];
      this.receiptPurchase=null;this.editing=false;this.pending=null;this.requestId++;
      if (workspace) void this.load();
      else { this.loading = false; this.errorMessage = 'Select a business workspace.'; this.cdr.markForCheck(); }
    });
  }
  ngOnDestroy(): void { this.workspaceSubscription?.unsubscribe(); this.requestId++; }

  async load(): Promise<void> {
    const workspace = this.workspace;
    const client = this.workspaceService.client;
    if (!workspace || !client) { this.errorMessage = !client ? 'Supabase is not configured.' : 'Select a workspace.'; this.loading = false; this.cdr.markForCheck(); return; }
    const requestId = ++this.requestId;
    this.loading = true; this.errorMessage = '';
    try {
      const suppliersController = new AbortController();
      const purchasesController = new AbortController();
      const inventoryController = new AbortController();
      const saleInventoryController = new AbortController();
      const returnInventoryController = new AbortController();
      const [supplierResult, purchaseResult, inventoryResult, saleInventoryResult, returnInventoryResult] = await Promise.all([
        this.withTimeout(client.from('ss_suppliers').select('id, name, is_active').eq('business_id', workspace.id).order('name').abortSignal(suppliersController.signal), 'Loading suppliers', () => suppliersController.abort()),
        this.withTimeout(client.from('ss_purchases').select('id, supplier_id, purchase_number, subtotal, paid_total, created_at').eq('business_id', workspace.id).order('created_at', { ascending: false }).limit(100).abortSignal(purchasesController.signal), 'Loading purchase history', () => purchasesController.abort()),
        this.withTimeout(client.from('ss_inventory_movements').select('metal, purity, weight_delta_g').eq('business_id', workspace.id).abortSignal(inventoryController.signal), 'Loading purchase inventory movements', () => inventoryController.abort()),
        this.withTimeout(client.from('ss_sale_inventory_movements').select('metal, purity, weight_delta_g').eq('business_id', workspace.id).abortSignal(saleInventoryController.signal), 'Loading sale inventory movements', () => saleInventoryController.abort()),
        this.withTimeout(client.from('ss_sale_return_inventory_movements').select('metal, purity, weight_delta_g').eq('business_id', workspace.id).abortSignal(returnInventoryController.signal), 'Loading sale return stock movements', () => returnInventoryController.abort())
      ]);
      if (supplierResult.error) throw new Error(`${supplierResult.error.code ?? 'Supabase'}: ${supplierResult.error.message}`);
      if (purchaseResult.error) throw new Error(`${purchaseResult.error.code ?? 'Supabase'}: ${purchaseResult.error.message}`);
      if (inventoryResult.error) throw new Error(`${inventoryResult.error.code ?? 'Supabase'}: ${inventoryResult.error.message}`);
      if (saleInventoryResult.error) throw new Error(`${saleInventoryResult.error.code ?? 'Supabase'}: ${saleInventoryResult.error.message}`);
      if (returnInventoryResult.error) throw new Error(`${returnInventoryResult.error.code ?? 'Supabase'}: ${returnInventoryResult.error.message}`);
      const purchases = (purchaseResult.data ?? []) as Purchase[];
      const ids = purchases.map(row => row.id);
      const linesController = new AbortController();
      const paymentsController = new AbortController();
      const [lineResult, paymentResult] = ids.length ? await Promise.all([
        this.withTimeout(client.from('ss_purchase_lines').select('purchase_id, item_description, metal, purity, gross_weight_g, net_weight_g, unit_cost_per_gram, additional_cost, line_total').eq('business_id', workspace.id).in('purchase_id', ids).abortSignal(linesController.signal), 'Loading purchase items', () => linesController.abort()),
        this.withTimeout(client.from('ss_purchase_payments').select('purchase_id, amount, method, reference, recorded_at').eq('business_id', workspace.id).in('purchase_id', ids).abortSignal(paymentsController.signal), 'Loading purchase payments', () => paymentsController.abort())
      ]) : [{ data: [], error: null }, { data: [], error: null }];
      if (lineResult.error) throw new Error(`${lineResult.error.code ?? 'Supabase'}: ${lineResult.error.message}`);
      if (paymentResult.error) throw new Error(`${paymentResult.error.code ?? 'Supabase'}: ${paymentResult.error.message}`);
      if (requestId !== this.requestId) return;
      this.allSuppliers = (supplierResult.data ?? []) as Supplier[];
      this.suppliers = this.allSuppliers.filter(row => row.is_active);
      this.purchases = purchases;
      this.linesByPurchase = this.groupByPurchase((lineResult.data ?? []) as PurchaseLine[]);
      this.paymentsByPurchase = this.groupByPurchase((paymentResult.data ?? []) as PurchasePayment[]);
      this.inventoryBalances = this.aggregateInventory([...(inventoryResult.data ?? []), ...(saleInventoryResult.data ?? []), ...(returnInventoryResult.data ?? [])] as InventoryMovement[]);
    } catch (error) {
      if (requestId === this.requestId) this.errorMessage = error instanceof Error ? error.message : 'Could not load purchase records.';
    } finally {
      if (requestId === this.requestId) { this.loading = false; this.cdr.markForCheck(); }
    }
  }

  addLine(): void { if (this.lines.length < 100) this.lines = [...this.lines, this.emptyLine()]; }
  removeLine(index: number): void { if (this.lines.length > 1) this.lines = this.lines.filter((_, i) => i !== index); }
  addPayment(): void { if (this.payments.length < 20) this.payments = [...this.payments, { method: 'cash', amount: '', reference: '' }]; }
  removePayment(index: number): void { this.payments = this.payments.filter((_, i) => i !== index); }

  get totalMinor(): bigint { return this.lines.reduce((sum, line) => sum + purchaseLineTotal(line.net_weight_g || '0', line.unit_cost_per_gram || '0', line.additional_cost || '0'), 0n); }
  get paidMinor(): bigint { return this.payments.reduce((sum, p) => sum + (p.amount.trim() ? parseFixed(p.amount, 2) : 0n), 0n); }
  get totalLabel(): string { try { return this.inr(formatFixed(this.totalMinor, 2)); } catch { return 'Complete item weights and costs'; } }
  get paidLabel(): string { try { return this.inr(formatFixed(this.paidMinor, 2)); } catch { return 'Invalid amount'; } }
  get balanceLabel(): string { try { return this.inr(formatFixed(this.totalMinor - this.paidMinor, 2)); } catch { return '—'; } }
  lineTotal(line: PurchaseDraftLine): string { try { return this.inr(formatFixed(purchaseLineTotal(line.net_weight_g || '0', line.unit_cost_per_gram || '0', line.additional_cost || '0'), 2)); } catch { return 'Enter valid weight and cost'; } }

  async post(): Promise<void> {
    if (this.saving || !this.workspace) return;
    if (!this.network.isOnline) { this.formError='You are offline. The purchase was not submitted; reconnect and retry.'; return; }
    const client = this.workspaceService.client;
    if (!client) { this.formError = 'Supabase is not configured.'; return; }
    if (!this.pending) {
      try {
        if (!this.supplierId) throw new Error('Choose a supplier.');
        const lines = this.lines.map((line, index) => {
          const gross = parseFixed(line.gross_weight_g, 4);
          const net = parseFixed(line.net_weight_g, 4);
          const cost = parseFixed(line.unit_cost_per_gram, 4);
          const extra = parseFixed(line.additional_cost || '0', 2);
          if (!line.item_description.trim() || gross <= 0n || net <= 0n || net > gross || cost < 0n || extra < 0n) throw new Error(`Check item ${index + 1}: description, gross/net weights, and non-negative cost are required.`);
          const total = purchaseLineTotal(line.net_weight_g, line.unit_cost_per_gram, line.additional_cost || '0');
          if (total <= 0n) throw new Error(`Item ${index + 1} total must be greater than zero.`);
          return { item_description: line.item_description.trim(), metal: line.metal, purity: line.purity.trim() || null, gross_weight_g: formatFixed(gross, 4), net_weight_g: formatFixed(net, 4), unit_cost_per_gram: formatFixed(cost, 4), additional_cost: formatFixed(extra, 2) };
        });
        const total = lines.reduce((sum, line) => sum + purchaseLineTotal(line.net_weight_g, line.unit_cost_per_gram, line.additional_cost), 0n);
        const payments = this.payments.filter(p => p.amount.trim()).map((p, index) => {
          const amount = parseFixed(p.amount, 2);
          if (amount <= 0n) throw new Error(`Payment ${index + 1} must be greater than zero.`);
          return { method: p.method, amount: formatFixed(amount, 2), reference: p.reference.trim() || null };
        });
        const paid = payments.reduce((sum, p) => sum + parseFixed(p.amount, 2), 0n);
        if (paid > total) throw new Error('Payments cannot exceed the purchase total.');
        this.pending = { key: crypto.randomUUID(), supplierId: this.supplierId, lines, payments };
      } catch (error) { this.formError = error instanceof Error ? error.message : 'Check the purchase values.'; return; }
    }
    this.saving = true; this.formError = '';
    let timedOut = false;
    let definitiveError = false;
    const controller = new AbortController();
    try {
      const request = client.rpc('ss_post_purchase', {
        p_business_id: this.workspace.id,
        p_supplier_id: this.pending.supplierId,
        p_idempotency_key: this.pending.key,
        p_lines: this.pending.lines,
        p_payments: this.pending.payments
      }).abortSignal(controller.signal);
      const result = await this.withTimeout(request, 'Posting purchase', () => { timedOut = true; controller.abort(); });
      if (result.error) { definitiveError = true; throw new Error(`${result.error.code ?? 'Supabase'}: ${result.error.message}`); }
      if (!result.data) throw new Error('The database did not confirm the purchase ID. Retry safely.');
      this.pending = null; this.editing = false; this.supplierId = ''; this.lines = [this.emptyLine()]; this.payments = [];
      this.successMessage = `Purchase ${result.data} was posted. Inventory and payment ledgers were updated together.`;
      await this.load();
    } catch (error) {
      this.formError = error instanceof Error ? error.message : 'Could not post the purchase.';
      if (definitiveError) this.pending = null;
      else if (!timedOut && !this.pending) this.pending = null;
    } finally { this.saving = false; this.cdr.markForCheck(); }
  }

  supplierName(id: string): string { return this.allSuppliers.find(row => row.id === id)?.name ?? this.suppliers.find(row => row.id === id)?.name ?? 'Supplier unavailable'; }
  linesFor(id: string): PurchaseLine[] { return this.linesByPurchase.get(id) ?? []; }
  paymentMethods(id: string): string { return (this.paymentsByPurchase.get(id) ?? []).map(p => p.method).join(', ') || 'Unpaid'; }
  paymentsFor(id:string):PurchasePayment[]{return this.paymentsByPurchase.get(id)??[];}
  openReceipt(purchase:Purchase):void{this.receiptPurchase=purchase;this.receiptError='';}
  closeReceipt():void{if(!this.receiptPrinting)this.receiptPurchase=null;}
  async printReceipt():Promise<void>{
    const client=this.workspaceService.client,workspace=this.workspace,purchase=this.receiptPurchase;
    if(!client||!workspace||!purchase||this.receiptPrinting)return;
    this.receiptPrinting=true;this.receiptError='';this.cdr.markForCheck();
    try{
      const result=await client.rpc('ss_audit_purchase_receipt_print',{p_business_id:workspace.id,p_purchase_id:purchase.id});
      if(result.error)throw new Error(`${result.error.code??'Supabase'}: ${result.error.message}`);
      if(!result.data)throw new Error('Supabase did not confirm the print audit event.');
      window.print();
    }catch(error){this.receiptError=error instanceof Error?error.message:'Could not record the voucher print request.';}
    finally{this.receiptPrinting=false;this.cdr.markForCheck();}
  }
  inr(value: string): string { return formatInr(value, 2); }
  formatFixed(value: bigint, scale: number): string { return formatFixed(value, scale); }
  balance(row: Purchase): string { return this.inr(formatFixed(parseFixed(row.subtotal, 2) - parseFixed(row.paid_total, 2), 2)); }
  balanceAmount(row: Purchase): string { return formatFixed(parseFixed(row.subtotal, 2) - parseFixed(row.paid_total, 2), 2); }

  private emptyLine(): PurchaseDraftLine { return { item_description: '', metal: 'gold', purity: '22K', gross_weight_g: '', net_weight_g: '', unit_cost_per_gram: '', additional_cost: '0.00' }; }
  private groupByPurchase<T extends { purchase_id: string }>(rows: T[]): Map<string, T[]> {
    const result = new Map<string, T[]>();
    for (const row of rows) result.set(row.purchase_id, [...(result.get(row.purchase_id) ?? []), row]);
    return result;
  }
  private aggregateInventory(rows: InventoryMovement[]): InventoryBalance[] {
    const balances = new Map<string, InventoryBalance>();
    for (const movement of rows) {
      const key = `${movement.metal}:${movement.purity ?? ''}`;
      const current = balances.get(key) ?? { metal: movement.metal, purity: movement.purity, weight: 0n };
      current.weight += parseFixed(movement.weight_delta_g, 4);
      balances.set(key, current);
    }
    return [...balances.values()].filter(row => row.weight !== 0n).sort((a, b) => a.metal.localeCompare(b.metal) || (a.purity ?? '').localeCompare(b.purity ?? ''));
  }
  private async withTimeout<T>(request: PromiseLike<T>, action: string, abort?: () => void): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try { return await Promise.race([Promise.resolve(request), new Promise<T>((_, reject) => { timer = setTimeout(() => { abort?.(); reject(new Error(`${action} timed out after 20 seconds. Retry the same purchase safely.`)); }, 20000); })]); }
    finally { if (timer) clearTimeout(timer); }
  }
}