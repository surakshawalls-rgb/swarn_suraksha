import { CommonModule } from '@angular/common';
import { ChangeDetectorRef, Component, OnDestroy, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { IonicModule } from '@ionic/angular';
import { Subscription } from 'rxjs';
import { LedgerPaymentComponent } from '../../core/financial/ledger-payment.component';
import { NetworkStatusService } from '../../core/network/network-status.service';
import { formatFixed, formatInr, parseFixed, purchaseLineTotal } from '../../core/financial/decimal';
import { allocateSaleReturn } from '../../core/financial/sales-return';
import { BusinessWorkspace, WorkspaceService } from '../dashboard/workspace.service';

type Metal = 'gold' | 'silver' | 'other';
type Method = 'cash' | 'upi' | 'bank_transfer' | 'card';
interface Customer { id: string; full_name: string; phone: string | null; address?: unknown; }
interface Rate { id: string; metal: 'gold' | 'silver'; purity: string | null; unit: string; shop_sell_rate: string; recorded_at: string; }
interface Sale { id: string; customer_id: string | null; invoice_number: number; subtotal: string; paid_total: string; created_at: string; }
interface SaleLine { id:string; sale_id: string; item_description: string; metal: Metal; purity: string | null; gross_weight_g:string; net_weight_g: string; unit_rate_per_gram: string; making_charge: string; line_total: string; }
interface SalePayment { sale_id: string; amount: string; method: string; reference?: string|null; recorded_at?: string; }
interface SaleReturn { id:string; sale_id:string; sale_line_id:string; original_line_amount:string; balance_reduction:string; cash_refund:string; refund_method:string|null; reason:string; recorded_at:string; }
interface ReturnTarget { sale:Sale; line:SaleLine; }
interface SaleDraftLine { item_description: string; metal: Metal; purity: string; gross_weight_g: string; net_weight_g: string; rate_snapshot_id: string; making_charge: string; }
interface PaymentDraft { method: Method; amount: string; reference: string; }
interface PendingSale { key: string; customerId: string | null; lines: object[]; payments: object[]; }

@Component({
  standalone: true,
  imports: [CommonModule, FormsModule, IonicModule, RouterLink, LedgerPaymentComponent],
  template: `
    <header class="topbar"><div class="crumb"><a routerLink="/dashboard">Overview</a><span>›</span><b>Sales &amp; billing</b></div><div class="top-actions"><button *ngIf="canPost" class="primary-btn" type="button" (click)="editing = !editing" [disabled]="!!pending"><svg class="btn-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg> Create invoice</button></div></header>
    <section class="content customers-page purchases-page">
      <div class="welcome"><div><p class="eyebrow">BILLING · CUSTOMER PAYMENTS</p><h1>Bill</h1><p class="subtitle">Record jewellery sales and customer payments.</p></div></div>
      <div class="config-banner"><span class="banner-icon">i</span><div><b>Tax is not configured</b><p>This invoice does not calculate tax. Confirm the business tax configuration and receipt requirements before using this workflow for tax invoices.</p></div></div>
      <div class="config-banner error-banner" *ngIf="errorMessage" role="alert"><span class="banner-icon">!</span><div><b>Sales data unavailable</b><p>{{errorMessage}}</p></div><button class="text-btn" type="button" (click)="load()">Retry</button></div>
      <p class="save-success" *ngIf="successMessage" role="status">{{successMessage}}</p>
      <div class="status-card" *ngIf="loading"><span class="spinner"></span><div><b>Loading sales ledger</b><p>Reading bills permitted for this workspace.</p></div></div>
      <div class="config-banner" *ngIf="workspace?.role === 'staff'" role="status"><span class="banner-icon">i</span><div><b>Sale posting is restricted</b><p>Only owners and administrators can post bills until a business staff permission policy is configured.</p></div></div>

      <section class="panel customer-editor" *ngIf="editing && !pending && canPost">
        <div class="panel-head"><div><h2>New invoice</h2><p>Select a customer, add jewellery items with the saved shop rate, then record any payment received.</p></div><button class="text-btn" type="button" (click)="editing = false">Cancel</button></div>
        <form class="customer-form purchase-form" (ngSubmit)="post()">
          <label>Find customer by name or mobile
            <input [(ngModel)]="customerSearch" name="customerSearch" autocomplete="off"
              placeholder="Type customer name or mobile number">
          </label>
          <label>Customer<select [(ngModel)]="customerId" name="customer" (ngModelChange)="customerChanged()">
            <option value="">Walk-in customer</option>
            <option *ngFor="let customer of filteredCustomers()" [value]="customer.id">
              {{customer.full_name}}{{customer.phone ? ' · ' + customer.phone : ''}}
            </option>
          </select></label>
          <div class="config-banner" *ngIf="customerId" role="status">
            <div><b>Previous outstanding (preview)</b><p>{{inr(previousOutstandingForSelectedCustomer())}}</p></div>
            <a class="text-btn" routerLink="/dashboard/customers">View customer history</a>
          </div>
          <div class="quick-customer">
            <div class="line-heading"><b>Add a new customer</b><span>Optional</span></div>
            <div class="payment-line">
              <label>Full name<input [(ngModel)]="newCustomerName" name="newCustomerName" maxlength="120" autocomplete="name"></label>
              <label>Mobile number<input [(ngModel)]="newCustomerPhone" name="newCustomerPhone" maxlength="20" inputmode="tel" autocomplete="tel"></label>
              <label>Address<input [(ngModel)]="newCustomerAddress" name="newCustomerAddress" maxlength="250" autocomplete="street-address"></label>
              <button class="text-btn" type="button" (click)="createCustomer()" [disabled]="creatingCustomer || !newCustomerName.trim()">
                {{creatingCustomer ? 'Saving…' : 'Save customer'}}
              </button>
            </div>
            <p class="form-error" *ngIf="customerError" role="alert">{{customerError}}</p>
          </div>
          <div class="purchase-lines">
            <div class="purchase-line" *ngFor="let line of lines; let i = index">
              <div class="line-heading"><b>Item {{i + 1}}</b><button *ngIf="lines.length > 1" class="text-btn danger-text" type="button" (click)="removeLine(i)">Remove</button></div>
              <label>Description<input [(ngModel)]="line.item_description" [name]="'description' + i" maxlength="180" required placeholder="e.g. 22K gold necklace"></label>
              <label>Metal<select [(ngModel)]="line.metal" [name]="'metal' + i" (ngModelChange)="rateChanged(line)"><option value="gold">Gold</option><option value="silver">Silver</option></select></label>
              <label>Purity<select [(ngModel)]="line.purity" [name]="'purity' + i" (ngModelChange)="rateChanged(line)"><option *ngFor="let purity of purities(line.metal)" [value]="purity">{{purity || 'Standard silver'}}</option></select></label>
              <label>Gross weight (g)<input [(ngModel)]="line.gross_weight_g" [name]="'gross' + i" inputmode="decimal" required></label>
              <label>Net weight (g)<input [(ngModel)]="line.net_weight_g" [name]="'net' + i" inputmode="decimal" required></label>
              <label>Shop selling rate<select [(ngModel)]="line.rate_snapshot_id" [name]="'rate' + i" required><option value="">Select saved rate</option><option *ngFor="let rate of ratesFor(line)" [value]="rate.id">{{inr(rate.shop_sell_rate)}} / g · {{rate.recorded_at | date:'d MMM, h:mm a':'Asia/Kolkata'}}</option></select></label>
              <label>Making charge (₹)<input [(ngModel)]="line.making_charge" [name]="'making' + i" inputmode="decimal" value="0.00"></label>
              <div class="line-total"><span>Line total</span><b>{{lineTotal(line)}}</b></div>
            </div>
            <button class="text-btn" type="button" (click)="addLine()" [disabled]="lines.length >= 100"><svg class="btn-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg> Add another item</button>
          </div>
          <div class="purchase-payments">
            <div class="line-heading"><b>Payments received (optional)</b><button class="text-btn" type="button" (click)="addPayment()" [disabled]="payments.length >= 20"><svg class="btn-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg> Add payment</button></div>
            <div class="payment-line" *ngFor="let payment of payments; let i = index">
              <label>Method<select [(ngModel)]="payment.method" [name]="'paymentMethod' + i"><option value="cash">Cash</option><option value="upi">UPI</option><option value="bank_transfer">Bank transfer</option><option value="card">Card</option></select></label>
              <label>Amount (₹)<input [(ngModel)]="payment.amount" [name]="'paymentAmount' + i" inputmode="decimal"></label>
              <label>Reference (optional)<input [(ngModel)]="payment.reference" [name]="'paymentReference' + i" maxlength="120"></label>
              <button class="text-btn danger-text" type="button" (click)="removePayment(i)">Remove</button>
            </div>
          </div>
          <div class="purchase-summary"><span>Sale total (no tax)</span><b>{{totalLabel}}</b><span>Paid now</span><b>{{paidLabel}}</b><span>Balance receivable</span><b>{{balanceLabel}}</b></div>
          <p class="duplicate-warning" role="note">Posting is final. A return reverses a complete invoice line at its saved no-tax amount. It reduces unpaid balance first; only the remaining amount can be refunded, capped by payments received.</p>
          <p class="form-error" *ngIf="formError" role="alert">{{formError}}</p><div class="form-actions"><button class="primary-btn" type="submit" [disabled]="saving || !(network.online$ | async) || !lines.length">{{saving ? 'Posting invoice…' : !(network.online$ | async) ? 'Offline — posting disabled' : 'Post sale'}}</button><span>Pricing uses the saved shop selling rate you selected.</span></div>
        </form>
      </section>
      <section class="panel customer-editor pending-purchase" *ngIf="pending"><b>Sale result is not confirmed</b><p>Retry the exact same invoice payload safely. The database idempotency key prevents a duplicate.</p><p class="form-error" *ngIf="formError" role="alert">{{formError}}</p><button class="primary-btn" type="button" (click)="post()" [disabled]="saving || !(network.online$ | async)">{{saving ? 'Checking result…' : 'Retry same sale safely'}}</button></section>
      <section class="panel customer-list purchase-history" *ngIf="!loading">
        <div class="panel-head"><div><h2>Recent bills</h2><p>Saved item rates and payment records are retained with each bill.</p></div><button class="text-btn" type="button" (click)="load()">Refresh</button></div>
        <div class="table-wrap" *ngIf="sales.length; else emptySales"><table><thead><tr><th>Invoice</th><th>Customer</th><th>Items · saved rate</th><th>Total</th><th>Paid</th><th>Returned</th><th>Balance</th><th>Collection</th><th>Receipt</th><th>Recorded</th></tr></thead><tbody><tr *ngFor="let sale of sales"><td><b>#{{sale.invoice_number}}</b></td><td>{{customerName(sale.customer_id)}}</td><td><span class="sale-item-row" *ngFor="let line of linesFor(sale.id)">{{line.item_description}} · {{line.net_weight_g}} g @ {{inr(line.unit_rate_per_gram)}}/g = {{inr(line.line_total)}}<small *ngIf="isReturned(line)">Returned · {{returnFor(line)?.reason}} · {{returnFor(line)?.recorded_at | date:'d MMM y':'Asia/Kolkata'}}</small><button *ngIf="canPost && isReturned(line)" class="text-btn" type="button" (click)="openReturnReceiptForLine(line)">Return voucher</button><button *ngIf="canPost && !isReturned(line)" class="text-btn" type="button" (click)="startReturn(sale,line)">Return item</button></span></td><td>{{inr(sale.subtotal)}}</td><td>{{inr(sale.paid_total)}}<small>{{paymentMethods(sale.id)}}</small><small *ngIf="refunded(sale.id) !== '0.00'">Refunded {{inr(refunded(sale.id))}}</small></td><td>{{inr(returned(sale.id))}}</td><td>{{balance(sale)}}</td><td><ss-ledger-payment *ngIf="canPost && balanceAmount(sale) !== '0.00'" kind="sale" [businessId]="workspace!.id" [transactionId]="sale.id" [remaining]="balanceAmount(sale)" (saved)="load()"></ss-ledger-payment></td><td><button *ngIf="canPost" class="text-btn" type="button" (click)="openReceipt(sale)">Print receipt</button></td><td>{{sale.created_at | date:'d MMM y, h:mm a':'Asia/Kolkata'}}</td></tr></tbody></table></div>
        <ng-template #emptySales><div class="empty-state customer-empty"><span class="empty-art">₹</span><b>No bills recorded</b><p>Create a bill to begin recording jewellery sales.</p></div></ng-template>
      </section>
    </section>
    <div class="receipt-overlay" *ngIf="receiptSale as receipt" role="dialog" aria-modal="true" aria-label="Sales receipt preview">
      <div class="receipt-screen"><div class="receipt-actions"><p *ngIf="receiptError" class="form-error" role="alert">{{receiptError}}</p><label>Layout<select [(ngModel)]="receiptFormat" name="receiptFormat"><option value="a4">A4</option><option value="thermal">Thermal · 80 mm</option></select></label><button class="primary-btn" type="button" (click)="printReceipt()" [disabled]="receiptPrinting">{{receiptPrinting?'Preparing…':'Print receipt'}}</button><button class="text-btn" type="button" (click)="closeReceipt()" [disabled]="receiptPrinting">Close preview</button><span role="status">Printing opens your device print dialog; completion is not reported by this app.</span></div>
        <article class="receipt-print" [class.receipt-thermal]="receiptFormat==='thermal'"><header><span class="brand-mark">S</span><h1>{{workspace?.name || 'SwarnaSuraksha Business'}}</h1><p>SALES RECEIPT</p></header><hr>
          <div class="receipt-meta"><span>Invoice</span><b>#{{receipt.invoice_number}}</b><span>Date</span><b>{{receipt.created_at | date:'d MMM y, h:mm a':'Asia/Kolkata'}}</b><span>Customer</span><b>{{customerName(receipt.customer_id)}}</b></div>
          <table><thead><tr><th>Item</th><th>Gross / net wt.</th><th>Rate / g</th><th>Charge</th><th>Amount</th></tr></thead><tbody><tr *ngFor="let line of linesFor(receipt.id)"><td>{{line.item_description}}<small>{{line.metal | titlecase}}{{line.purity ? ' · '+line.purity : ''}}</small></td><td>{{line.gross_weight_g}} / {{line.net_weight_g}} g</td><td>{{inr(line.unit_rate_per_gram)}}</td><td>{{inr(line.making_charge)}}</td><td>{{inr(line.line_total)}}</td></tr></tbody></table>
          <div class="receipt-totals"><span>Subtotal</span><b>{{inr(receipt.subtotal)}}</b><span>Tax</span><b>Not configured</b><span>Paid</span><b>{{inr(receipt.paid_total)}}</b><span>Returned</span><b>{{inr(returned(receipt.id))}}</b><span>Refunded</span><b>{{inr(refunded(receipt.id))}}</b><span>Balance due</span><b>{{balance(receipt)}}</b></div>
          <p class="receipt-note">This receipt reflects the saved item rate and payment records. Tax is not configured; this document is not a GST tax invoice.</p>
          <div class="receipt-payment" *ngIf="paymentsFor(receipt.id).length"><b>Payments recorded</b><p *ngFor="let payment of paymentsFor(receipt.id)">{{payment.recorded_at ? (payment.recorded_at | date:'d MMM y, h:mm a':'Asia/Kolkata')+' · ' : ''}}{{payment.method | titlecase}} · {{inr(payment.amount)}}{{payment.reference ? ' · Ref '+payment.reference : ''}}</p></div>
          <footer>Thank you · Recorded in SwarnaSuraksha</footer>
        </article>
      </div>
    </div>
    <div class="receipt-overlay" *ngIf="returnTarget as target" role="dialog" aria-modal="true" aria-label="Return invoice item">
      <div class="receipt-screen return-dialog"><div class="receipt-actions"><b>Return item from invoice #{{target.sale.invoice_number}}</b><button class="text-btn" type="button" (click)="closeReturn()" [disabled]="returnSaving">Close</button></div>
        <article class="panel return-form"><p><b>{{target.line.item_description}}</b> · {{target.line.net_weight_g}} g · Original no-tax line amount {{inr(target.line.line_total)}}</p>
          <p>Outstanding balance reduction: {{inr(returnBreakdown(target).balanceReduction)}} · Refund due: {{inr(returnBreakdown(target).refund)}}</p>
          <p class="form-error" *ngIf="returnBreakdown(target).error" role="alert">{{returnBreakdown(target).error}}</p>
          <label>Reason for return<textarea [(ngModel)]="returnReason" name="returnReason" maxlength="300" rows="3" [disabled]="!!pendingReturn"></textarea></label>
          <label *ngIf="returnBreakdown(target).refund !== '0.00'">Refund method<select [(ngModel)]="refundMethod" name="refundMethod" [disabled]="!!pendingReturn"><option value="cash">Cash</option><option value="upi">UPI</option><option value="bank_transfer">Bank transfer</option><option value="card">Card</option></select></label>
          <p class="form-error" *ngIf="returnError" role="alert">{{returnError}}</p>
          <p *ngIf="pendingReturn" role="status">Result not confirmed. Retry the same return safely; the request key prevents duplicate posting.</p>
          <div class="form-actions"><button class="primary-btn" type="button" (click)="submitReturn()" [disabled]="returnSaving || !network.isOnline || !!returnBreakdown(target).error">{{returnSaving?'Posting return…':pendingReturn?'Retry return safely':'Confirm return'}}</button><span>Original invoice is retained; balance, refund, cashbook, and audit update atomically.</span></div>
        </article>
      </div>
    </div>
    <div class="receipt-overlay" *ngIf="receiptReturn as rr" role="dialog" aria-modal="true" aria-label="Sales return voucher preview">
      <div class="receipt-screen"><div class="receipt-actions"><p *ngIf="returnReceiptError" class="form-error" role="alert">{{returnReceiptError}}</p><label>Layout<select [(ngModel)]="receiptFormat" name="returnReceiptFormat"><option value="a4">A4</option><option value="thermal">Thermal · 80 mm</option></select></label><button class="primary-btn" type="button" (click)="printReturnReceipt()" [disabled]="returnReceiptPrinting">{{returnReceiptPrinting?'Preparing…':'Print return voucher'}}</button><button class="text-btn" type="button" (click)="closeReturnReceipt()" [disabled]="returnReceiptPrinting">Close preview</button><span role="status">Print is requested from your device; completion is not confirmed here.</span></div>
        <article class="receipt-print" [class.receipt-thermal]="receiptFormat==='thermal'"><header><span class="brand-mark">S</span><h1>{{workspace?.name || 'SwarnaSuraksha Business'}}</h1><p>SALES RETURN VOUCHER</p></header><hr>
          <div class="receipt-meta"><span>Invoice</span><b>#{{saleForReturn(rr)?.invoice_number}}</b><span>Return date</span><b>{{rr.recorded_at | date:'d MMM y, h:mm a':'Asia/Kolkata'}}</b><span>Customer</span><b>{{customerName(saleForReturn(rr)?.customer_id ?? null)}}</b><span>Item</span><b>{{lineForReturn(rr)?.item_description}}</b></div>
          <div class="receipt-totals"><span>Original saved line amount</span><b>{{inr(rr.original_line_amount)}}</b><span>Unpaid balance reduced</span><b>{{inr(rr.balance_reduction)}}</b><span>Refund paid</span><b>{{inr(rr.cash_refund)}}</b><span>Refund method</span><b>{{rr.refund_method ? (rr.refund_method | titlecase) : 'Not applicable'}}</b></div>
          <p class="receipt-note"><b>Reason:</b> {{rr.reason}}. This return reverses the complete saved invoice line at its original no-tax amount. The original invoice remains in the ledger.</p><p class="receipt-note">Tax is not configured; this is not a GST tax document. Cash refund on this voucher is recorded in the business cashbook.</p><footer>Return recorded in SwarnaSuraksha</footer>
        </article>
      </div>
    </div>
  `
})
export class SalesComponent implements OnInit, OnDestroy {
  loading = true; saving = false; editing = false;
  errorMessage = ''; formError = ''; successMessage = '';
  customers: Customer[] = []; rates: Rate[] = []; sales: Sale[] = [];
  linesBySale = new Map<string, SaleLine[]>(); paymentsBySale = new Map<string, SalePayment[]>();
  returnsBySale = new Map<string, SaleReturn[]>();
  workspace: BusinessWorkspace | null = null; customerId = '';
  customerSearch = ''; newCustomerName = ''; newCustomerPhone = ''; newCustomerAddress = '';
  customerError = ''; creatingCustomer = false;
  lines: SaleDraftLine[] = [this.emptyLine()]; payments: PaymentDraft[] = [];
  pending: PendingSale | null = null;
  receiptSale:Sale|null=null;receiptError='';receiptPrinting=false;receiptFormat:'a4'|'thermal'='a4';
  receiptReturn:SaleReturn|null=null;returnReceiptError='';returnReceiptPrinting=false;
  returnTarget:ReturnTarget|null=null;returnReason='';refundMethod:Method='cash';returnError='';returnSaving=false;pendingReturn:{key:string;reason:string;method:Method|null}|null=null;
  private subscription: Subscription | null = null; private requestId = 0;
  constructor(private readonly workspaceService: WorkspaceService, readonly network: NetworkStatusService, private readonly cdr: ChangeDetectorRef) {}
  get canPost(): boolean { return this.workspace?.role === 'owner' || this.workspace?.role === 'admin'; }

  ngOnInit(): void {
    this.subscription = this.workspaceService.activeWorkspace$.subscribe(workspace => {
      if (workspace && workspace.id === this.workspace?.id && workspace.role === this.workspace?.role) return;
      this.workspace = workspace;
      this.customers=[];this.rates=[];this.sales=[];this.linesBySale.clear();this.paymentsBySale.clear();this.returnsBySale.clear();
      this.receiptSale=null;this.receiptReturn=null;this.returnTarget=null;this.pendingReturn=null;this.pending=null;this.editing=false;this.requestId++;
      if (workspace) void this.load(); else { this.loading = false; this.errorMessage = 'Select a workspace.'; this.cdr.markForCheck(); }
    });
  }
  ngOnDestroy(): void { this.subscription?.unsubscribe(); this.requestId++; }
  async load(): Promise<void> {
    const workspace = this.workspace; const client = this.workspaceService.client;
    if (!workspace || !client) { this.errorMessage = !client ? 'Supabase is not configured.' : 'Select a workspace.'; this.loading = false; this.cdr.markForCheck(); return; }
    const requestId = ++this.requestId; this.loading = true; this.errorMessage = '';
    const customersController = new AbortController(); const ratesController = new AbortController(); const salesController = new AbortController();
    try {
      const [customerResult, rateResult, saleResult] = await Promise.all([
        this.withTimeout(client.from('customers').select('id,full_name,phone').eq('business_id',workspace.id).eq('status','active').order('full_name').abortSignal(customersController.signal),'Loading customers',()=>customersController.abort()),
        this.withTimeout(client.from('ss_metal_rate_snapshots' as any).select('id,metal,purity,unit,shop_sell_rate,recorded_at').eq('business_id',workspace.id).eq('unit','gram').order('recorded_at',{ascending:false}).limit(100).abortSignal(ratesController.signal),'Loading manual rates',()=>ratesController.abort()),
        this.withTimeout(client.from('ss_sales' as any).select('id,customer_id,invoice_number,subtotal,paid_total,created_at').eq('business_id',workspace.id).order('created_at',{ascending:false}).limit(100).abortSignal(salesController.signal),'Loading sales',()=>salesController.abort())
      ]);
      if (customerResult.error) throw new Error(`${customerResult.error.code ?? 'Supabase'}: ${customerResult.error.message}`);
      if (rateResult.error) throw new Error(`${rateResult.error.code ?? 'Supabase'}: ${rateResult.error.message}`);
      if (saleResult.error) throw new Error(`${saleResult.error.code ?? 'Supabase'}: ${saleResult.error.message}`);
      const sales = (saleResult.data ?? []) as unknown as Sale[]; const ids = sales.map(s => s.id);
      const linesController = new AbortController(); const paymentsController = new AbortController(); const returnsController = new AbortController();
      const [lineResult,paymentResult,returnResult] = ids.length ? await Promise.all([
        this.withTimeout(client.from('ss_sale_lines' as any).select('id,sale_id,item_description,metal,purity,gross_weight_g,net_weight_g,unit_rate_per_gram,making_charge,line_total').eq('business_id',workspace.id).in('sale_id',ids).abortSignal(linesController.signal),'Loading bill items',()=>linesController.abort()),
        this.withTimeout(client.from('ss_sale_payments' as any).select('sale_id,amount,method,reference,recorded_at').eq('business_id',workspace.id).in('sale_id',ids).abortSignal(paymentsController.signal),'Loading sale payments',()=>paymentsController.abort()),
        this.withTimeout(client.from('ss_sale_returns' as any).select('id,sale_id,sale_line_id,original_line_amount,balance_reduction,cash_refund,refund_method,reason,recorded_at').eq('business_id',workspace.id).in('sale_id',ids).abortSignal(returnsController.signal),'Loading sale returns',()=>returnsController.abort())
      ]) : [{data:[],error:null},{data:[],error:null},{data:[],error:null}];
      if (lineResult.error) throw new Error(`${lineResult.error.code ?? 'Supabase'}: ${lineResult.error.message}`);
      if (paymentResult.error) throw new Error(`${paymentResult.error.code ?? 'Supabase'}: ${paymentResult.error.message}`);
      if (returnResult.error) throw new Error(`${returnResult.error.code ?? 'Supabase'}: ${returnResult.error.message}`);
      if (requestId !== this.requestId) return;
      this.customers = (customerResult.data ?? []) as unknown as Customer[];
      this.rates = (rateResult.data ?? []) as unknown as Rate[];
      for (const line of this.lines) this.rateChanged(line);
      this.sales = sales;
      this.linesBySale = this.group((lineResult.data ?? []) as unknown as SaleLine[]);
      this.paymentsBySale = this.group((paymentResult.data ?? []) as unknown as SalePayment[]);
      this.returnsBySale = this.group((returnResult.data ?? []) as unknown as SaleReturn[]);
    } catch (error) { if (requestId === this.requestId) this.errorMessage = error instanceof Error ? error.message : 'Could not load sales.'; }
    finally { if (requestId === this.requestId) { this.loading = false; this.cdr.markForCheck(); } }
  }

  filteredCustomers(): Customer[] {
    const q = this.customerSearch.trim().toLocaleLowerCase();
    if (!q) return this.customers;
    return this.customers.filter(c =>
      c.full_name.toLocaleLowerCase().includes(q) ||
      (c.phone ?? '').toLocaleLowerCase().includes(q)
    );
  }

  customerChanged(): void {
    this.customerError = '';
    this.cdr.markForCheck();
  }

  previousOutstandingForSelectedCustomer(): string {
    if (!this.customerId) return '0.00';
    const amount = this.sales
      .filter(s => s.customer_id === this.customerId)
      .reduce((sum, sale) => {
        const base = parseFixed(sale.subtotal, 2) - parseFixed(sale.paid_total, 2);
        const returnReduction = this.returnsFor(sale.id)
          .reduce((n, row) => n + parseFixed(row.balance_reduction, 2), 0n);
        const remaining = base - returnReduction;
        return sum + (remaining > 0n ? remaining : 0n);
      }, 0n);
    return formatFixed(amount, 2);
  }

  async createCustomer(): Promise<void> {
    const client = this.workspaceService.client;
    const workspace = this.workspace;
    const name = this.newCustomerName.trim();
    const phone = this.newCustomerPhone.trim();
    const addressLine = this.newCustomerAddress.trim();
    if (!client || !workspace) { this.customerError = 'Select a workspace first.'; return; }
    if (!this.canPost) { this.customerError = 'Only an owner or administrator can register customers here.'; return; }
    if (!name) { this.customerError = 'Customer name is required.'; return; }
    if (!this.network.isOnline) { this.customerError = 'Reconnect to the internet before saving a customer.'; return; }
    this.creatingCustomer = true;
    this.customerError = '';
    this.cdr.markForCheck();
    try {
      if (phone) {
        const normalizedPhone = phone.replace(/\D/g, '');
        const duplicate = this.customers.find(c => (c.phone ?? '').replace(/\D/g, '') === normalizedPhone);
        if (duplicate) {
          this.customerId = duplicate.id;
          this.customerSearch = duplicate.full_name;
          this.customerError = 'This mobile number is already registered. The existing customer has been selected.';
          return;
        }
      }
      const address = addressLine ? { line1: addressLine } : {};
      const result = await client.from('customers').insert({
        business_id: workspace.id,
        full_name: name,
        phone: phone || null,
        address,
        status: 'active'
      }).select('id,full_name,phone,address').single();
      if (result.error) throw new Error(`${result.error.code ?? 'Supabase'}: ${result.error.message}`);
      const customer = result.data as unknown as Customer;
      this.customers = [...this.customers, customer].sort((a,b) => a.full_name.localeCompare(b.full_name));
      this.customerId = customer.id;
      this.customerSearch = customer.full_name;
      this.newCustomerName = '';
      this.newCustomerPhone = '';
      this.newCustomerAddress = '';
      this.successMessage = `Customer ${customer.full_name} was registered.`;
    } catch (error) {
      this.customerError = error instanceof Error ? error.message : 'Could not register the customer.';
    } finally {
      this.creatingCustomer = false;
      this.cdr.markForCheck();
    }
  }

  addLine(): void { if (this.lines.length < 100) this.lines = [...this.lines,this.emptyLine()]; }
  removeLine(i:number): void { if (this.lines.length > 1) this.lines = this.lines.filter((_,n)=>n!==i); }
  addPayment(): void { if (this.payments.length < 20) this.payments = [...this.payments,{method:'cash',amount:'',reference:''}]; }
  removePayment(i:number): void { this.payments = this.payments.filter((_,n)=>n!==i); }
  purities(metal: Metal): string[] { if(metal==='silver') return ['']; return [...new Set(this.rates.filter(r=>r.metal===metal).map(r=>r.purity).filter((v):v is string=>!!v))]; }
  ratesFor(line: SaleDraftLine): Rate[] { return this.rates.filter(r=>r.metal===line.metal && r.purity===(line.purity||null) && r.unit==='gram'); }
  rateChanged(line: SaleDraftLine): void {
    const available=this.purities(line.metal);
    if(!available.includes(line.purity)) line.purity=available[0]??'';
    if (!this.ratesFor(line).some(r=>r.id===line.rate_snapshot_id)) line.rate_snapshot_id='';
  }
  lineTotal(line: SaleDraftLine): string {
    try { const rate=this.rates.find(r=>r.id===line.rate_snapshot_id); if(!rate) return 'Select matching manual rate'; return this.inr(formatFixed(purchaseLineTotal(line.net_weight_g||'0',rate.shop_sell_rate,line.making_charge||'0'),2)); }
    catch { return 'Enter valid weights and charge'; }
  }
  get totalMinor(): bigint { return this.lines.reduce((sum,line)=>{const rate=this.rates.find(r=>r.id===line.rate_snapshot_id);return sum+(rate?purchaseLineTotal(line.net_weight_g||'0',rate.shop_sell_rate,line.making_charge||'0'):0n);},0n); }
  get paidMinor(): bigint { return this.payments.reduce((sum,p)=>sum+(p.amount.trim()?parseFixed(p.amount,2):0n),0n); }
  get totalLabel():string { try{return this.inr(formatFixed(this.totalMinor,2));}catch{return 'Complete item rates and weights';} }
  get paidLabel():string { try{return this.inr(formatFixed(this.paidMinor,2));}catch{return 'Invalid amount';} }
  get balanceLabel():string { try{return this.inr(formatFixed(this.totalMinor-this.paidMinor,2));}catch{return '—';} }

  async post():Promise<void> {
    if(this.saving||!this.workspace||!this.canPost)return;
    if(!this.network.isOnline){this.formError='You are offline. The sale was not submitted; reconnect and retry.';return;}
    const client=this.workspaceService.client;if(!client){this.formError='Supabase is not configured.';return;}
    if(!this.pending){
      try{
        const lines=this.lines.map((line,i)=>{
          const gross=parseFixed(line.gross_weight_g,4),net=parseFixed(line.net_weight_g,4),making=parseFixed(line.making_charge||'0',2);
          if(!line.item_description.trim()||gross<=0n||net<=0n||net>gross||making<0n)throw new Error(`Check item ${i+1}: description, weights, and non-negative making charge are required.`);
          const rate=this.rates.find(r=>r.id===line.rate_snapshot_id);
          if(!rate||rate.metal!==line.metal||rate.purity!==(line.purity||null)||rate.unit!=='gram')throw new Error(`Select a valid gram-based manual rate for item ${i+1}.`);
          if(purchaseLineTotal(line.net_weight_g,rate.shop_sell_rate,line.making_charge||'0')<=0n)throw new Error(`Item ${i+1} total must be positive.`);
          return {item_description:line.item_description.trim(),metal:line.metal,purity:line.purity||null,gross_weight_g:formatFixed(gross,4),net_weight_g:formatFixed(net,4),rate_snapshot_id:rate.id,making_charge:formatFixed(making,2)};
        });
        const total=lines.reduce((sum,line)=>{const r=this.rates.find(x=>x.id===line.rate_snapshot_id)!;return sum+purchaseLineTotal(line.net_weight_g,r.shop_sell_rate,line.making_charge);},0n);
        const payments=this.payments.filter(p=>p.amount.trim()).map((p,i)=>{const amount=parseFixed(p.amount,2);if(amount<=0n)throw new Error(`Payment ${i+1} must be positive.`);return {method:p.method,amount:formatFixed(amount,2),reference:p.reference.trim()||null};});
        const paid=payments.reduce((sum,p)=>sum+parseFixed(p.amount,2),0n);if(paid>total)throw new Error('Payments cannot exceed the sale total.');
        this.pending={key:crypto.randomUUID(),customerId:this.customerId||null,lines,payments};
      }catch(error){this.formError=error instanceof Error?error.message:'Check the sale values.';return;}
    }
    this.saving=true;this.formError='';let timedOut=false;let definitiveError=false;const controller=new AbortController();
    try{
      const request=client.rpc('ss_post_sale',{p_business_id:this.workspace.id,p_customer_id:this.pending.customerId,p_idempotency_key:this.pending.key,p_lines:this.pending.lines,p_payments:this.pending.payments}).abortSignal(controller.signal);
      const result=await this.withTimeout(request,'Posting sale',()=>{timedOut=true;controller.abort();});
      if(result.error){definitiveError=true;throw new Error(`${result.error.code??'Supabase'}: ${result.error.message}`);}
      if(!result.data)throw new Error('The database did not confirm the invoice ID. Retry safely.');
      const invoice=result.data;this.pending=null;this.editing=false;this.customerId='';this.customerSearch='';this.lines=[this.emptyLine()];this.payments=[];this.successMessage=`Invoice ${invoice} was posted with its payment ledger entries.`;await this.load();
    }catch(error){this.formError=error instanceof Error?error.message:'Could not post the sale.';if(definitiveError)this.pending=null;}
    finally{this.saving=false;this.cdr.markForCheck();}
  }
  customerName(id:string|null):string{return id?this.customers.find(c=>c.id===id)?.full_name??'Customer unavailable':'Walk-in';}
  linesFor(id:string):SaleLine[]{return this.linesBySale.get(id)??[];}
  paymentMethods(id:string):string{return(this.paymentsBySale.get(id)??[]).map(p=>p.method).join(', ')||'Unpaid';}
  paymentsFor(id:string):SalePayment[]{return this.paymentsBySale.get(id)??[];}
  returnsFor(id:string):SaleReturn[]{return this.returnsBySale.get(id)??[];}
  saleForReturn(row:SaleReturn):Sale|undefined{return this.sales.find(s=>s.id===row.sale_id);}
  lineForReturn(row:SaleReturn):SaleLine|undefined{return this.linesFor(row.sale_id).find(line=>line.id===row.sale_line_id);}
  returnFor(line:SaleLine):SaleReturn|undefined{return this.returnsFor(line.sale_id).find(r=>r.sale_line_id===this.lineId(line));}
  isReturned(line:SaleLine):boolean{return !!this.returnFor(line);}
  returned(id:string):string{return formatFixed(this.returnsFor(id).reduce((n,r)=>n+parseFixed(r.original_line_amount,2),0n),2);}
  refunded(id:string):string{return formatFixed(this.returnsFor(id).reduce((n,r)=>n+parseFixed(r.cash_refund,2),0n),2);}
  private lineId(line:SaleLine):string{return line.id;}
  openReturnReceipt(row:SaleReturn):void{this.receiptReturn=row;this.returnReceiptError='';}
  openReturnReceiptForLine(line:SaleLine):void{const row=this.returnFor(line);if(row)this.openReturnReceipt(row);}
  closeReturnReceipt():void{if(!this.returnReceiptPrinting)this.receiptReturn=null;}
  async printReturnReceipt():Promise<void>{
    const client=this.workspaceService.client,workspace=this.workspace,row=this.receiptReturn;
    if(!client||!workspace||!row||this.returnReceiptPrinting)return;
    this.returnReceiptPrinting=true;this.returnReceiptError='';this.cdr.markForCheck();
    try{const result=await client.rpc('ss_audit_sale_return_receipt_print',{p_business_id:workspace.id,p_sale_return_id:row.id});
      if(result.error)throw new Error(`${result.error.code??'Supabase'}: ${result.error.message}`);
      if(!result.data)throw new Error('Supabase did not confirm the return voucher print request.');window.print();
    }catch(error){this.returnReceiptError=error instanceof Error?error.message:'Could not record the return voucher print request.';}
    finally{this.returnReceiptPrinting=false;this.cdr.markForCheck();}
  }
  startReturn(sale:Sale,line:SaleLine):void{this.returnTarget={sale,line};this.returnReason='';this.returnError='';this.refundMethod='cash';this.pendingReturn=null;}
  closeReturn():void{if(!this.returnSaving){this.returnTarget=null;this.pendingReturn=null;}}
  returnBreakdown(target:ReturnTarget):{balanceReduction:string;refund:string;error:string}{
    try{
      const rows=this.returnsFor(target.sale.id);
      const allocation=allocateSaleReturn({subtotalMinor:parseFixed(target.sale.subtotal,2),paidMinor:parseFixed(target.sale.paid_total,2),
        priorBalanceReductionsMinor:rows.reduce((n,r)=>n+parseFixed(r.balance_reduction,2),0n),
        priorCashRefundsMinor:rows.reduce((n,r)=>n+parseFixed(r.cash_refund,2),0n),lineAmountMinor:parseFixed(target.line.line_total,2)});
      return{balanceReduction:formatFixed(allocation.balanceReductionMinor,2),refund:formatFixed(allocation.cashRefundMinor,2),error:''};
    }catch(error){return{balanceReduction:'0.00',refund:'0.00',error:error instanceof Error?error.message:'This line cannot be returned.'};}
  }
  async submitReturn():Promise<void>{
    const target=this.returnTarget,client=this.workspaceService.client,workspace=this.workspace;
    if(!target||!client||!workspace||this.returnSaving||!this.canPost)return;
    if(!this.network.isOnline){this.returnError='You are offline. The return was not submitted.';return;}
    if(!this.pendingReturn){const reason=this.returnReason.trim();if(reason.length<3){this.returnError='Enter a return reason of at least 3 characters.';return;}
      const refund=this.returnBreakdown(target).refund;this.pendingReturn={key:crypto.randomUUID(),reason,method:refund==='0.00'?null:this.refundMethod};}
    this.returnSaving=true;this.returnError='';let timedOut=false;let definitiveError=false;const controller=new AbortController();
    try{
      const lineId=this.lineId(target.line);if(!lineId)throw new Error('The saved sale line ID is unavailable. Reload sales before returning this item.');
      const result=await this.withTimeout(client.rpc('ss_return_sale_line',{p_business_id:workspace.id,p_sale_id:target.sale.id,p_sale_line_id:lineId,p_idempotency_key:this.pendingReturn.key,p_reason:this.pendingReturn.reason,p_refund_method:this.pendingReturn.method}).abortSignal(controller.signal),'Posting item return',()=>{timedOut=true;controller.abort();});
      if(result.error){definitiveError=true;throw new Error(`${result.error.code??'Supabase'}: ${result.error.message}`);}
      if(!result.data)throw new Error('Supabase did not confirm the return. Retry safely.');
      const returnId=result.data;this.successMessage='The invoice line was returned. Its unpaid amount was reduced first and any eligible refund was recorded.';this.returnTarget=null;this.pendingReturn=null;await this.load();
      this.receiptReturn=this.returnsFor(target.sale.id).find(row=>row.id===returnId)??null;this.returnReceiptError='';
    }catch(error){this.returnError=error instanceof Error?error.message:'Could not post the item return.';if(definitiveError)this.pendingReturn=null;}
    finally{this.returnSaving=false;this.cdr.markForCheck();}
  }
  openReceipt(sale:Sale):void{this.receiptSale=sale;this.receiptError='';}
  closeReceipt():void{if(!this.receiptPrinting)this.receiptSale=null;}
  async printReceipt():Promise<void>{
    const client=this.workspaceService.client,workspace=this.workspace,sale=this.receiptSale;
    if(!client||!workspace||!sale||this.receiptPrinting)return;
    this.receiptPrinting=true;this.receiptError='';this.cdr.markForCheck();
    try{
      const result=await client.rpc('ss_audit_sale_receipt_print',{p_business_id:workspace.id,p_sale_id:sale.id});
      if(result.error)throw new Error(`${result.error.code??'Supabase'}: ${result.error.message}`);
      if(!result.data)throw new Error('Supabase did not confirm the print audit event.');
      window.print();
    }catch(error){this.receiptError=error instanceof Error?error.message:'Could not record the receipt print request.';}
    finally{this.receiptPrinting=false;this.cdr.markForCheck();}
  }
  balance(sale:Sale):string{return this.inr(this.balanceAmount(sale));}
  balanceAmount(sale:Sale):string{return formatFixed(parseFixed(sale.subtotal,2)-parseFixed(sale.paid_total,2)-this.returnsFor(sale.id).reduce((n,r)=>n+parseFixed(r.balance_reduction,2),0n),2);}
  inr(value:string):string{return formatInr(value,2);}
  private emptyLine():SaleDraftLine{return{item_description:'',metal:'gold',purity:this.purities('gold')[0]??'22K',gross_weight_g:'',net_weight_g:'',rate_snapshot_id:'',making_charge:'0.00'};}
  private group<T extends {sale_id:string}>(rows:T[]):Map<string,T[]>{const m=new Map<string,T[]>();for(const row of rows)m.set(row.sale_id,[...(m.get(row.sale_id)??[]),row]);return m;}
  private async withTimeout<T>(request:PromiseLike<T>,action:string,abort?:()=>void):Promise<T>{let timer:ReturnType<typeof setTimeout>|undefined;try{return await Promise.race([Promise.resolve(request),new Promise<T>((_,reject)=>{timer=setTimeout(()=>{abort?.();reject(new Error(`${action} timed out after 20 seconds. Retry the same sale safely.`));},20000);})]);}finally{if(timer)clearTimeout(timer);}}
}