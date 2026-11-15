import { CommonModule } from '@angular/common';
import { ChangeDetectorRef, Component, OnDestroy, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { IonicModule } from '@ionic/angular';
import { Subscription } from 'rxjs';
import type { jsPDF } from 'jspdf';
import { formatFixed, formatInr, parseFixed } from '../../core/financial/decimal';
import { completedMonthlyPeriods, girviBalancesAt, girviCollateralValue } from '../../core/financial/girvi';
import { BusinessWorkspace, WorkspaceService } from '../dashboard/workspace.service';

type PaymentMethod = 'cash' | 'upi' | 'bank_transfer' | 'card';
interface Customer { id: string; full_name: string; phone: string | null; address?: unknown; }
interface CollateralItem {
  id: string; girvi_id: string; item_number: number; description: string; condition_notes: string | null; metal: 'gold' | 'silver';
  purity: string; weight_g: string; rate_per_gram: string; estimated_market_value: string;
}
interface DraftCollateralItem {
  description: string; conditionNotes: string; metal: 'gold' | 'silver'; purity: string; weight: string; rate: string; customPurityFactor: string;
}
interface Pledge {
  id: string; customer_id: string; girvi_number: number; metal: 'gold' | 'silver' | 'mixed'; purity: string | null;
  weight_g: string; rate_per_gram: string; estimated_market_value: string; principal_amount: string;
  principal_balance: string; interest_balance: string; monthly_interest_percent: string; girvi_date: string;
  maturity_date: string; customer_name_snapshot: string | null; customer_phone_snapshot: string | null;
  customer_address_snapshot: string | null; last_accrued_months: number; status: 'active' | 'closed';
  closed_at: string | null; notes: string | null;
}
interface Payment { id: string; amount: string; payment_method: PaymentMethod; interest_paid: string; principal_paid: string; payment_date: string; }

@Component({
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, IonicModule],
  template: `
    <header class="topbar"><div class="crumb"><a routerLink="/dashboard">Home</a><span>›</span><b>Girvi</b></div>
      <div class="top-actions"><button *ngIf="canPost" class="primary-btn" type="button" (click)="showCreate = !showCreate">{{showCreate ? 'Close' : '＋ New Girvi'}}</button></div>
    </header>
    <section class="content customers-page">
      <div class="welcome"><div><p class="eyebrow">PLEDGE MANAGEMENT</p><h1>Girvi</h1><p class="subtitle">Manage gold and silver pledges, payments and releases.</p></div></div>
      <div class="config-banner error-banner" *ngIf="error" role="alert"><span class="banner-icon">!</span><div><b>Girvi data unavailable</b><p>{{error}}</p></div><button class="text-btn" type="button" (click)="load()">Retry</button></div>
      <p class="save-success" *ngIf="success" role="status">{{success}}</p>
      <div class="config-banner" *ngIf="workspace?.role === 'staff'" role="status"><span class="banner-icon">i</span><div><b>Girvi posting is restricted</b><p>Only owners and administrators can post pledges and payments.</p></div></div>

      <section class="panel customer-editor" *ngIf="showCreate && canPost">
        <div class="panel-head"><div><h2>New Girvi</h2><p>The saved market rate and estimated value will not change later.</p></div></div>
        <form class="customer-form" (ngSubmit)="create()">
          <div class="customer-search-field">
            <label for="girvi-customer-search">Find customer by name, mobile or address</label>
            <input id="girvi-customer-search" [(ngModel)]="customerSearch" name="customerSearch"
              (ngModelChange)="customerSearchChanged()" autocomplete="off"
              [placeholder]="selectedCustomer ? 'Customer selected' : 'Start typing a name, mobile or address'"
              [disabled]="!!selectedCustomer">
            <span class="customer-search-results" *ngIf="customerSearch.trim() && !selectedCustomer"
              role="listbox" aria-label="Matching customers">
              <button *ngFor="let customer of filteredCustomers()" type="button" role="option"
                (click)="selectCustomer(customer)">
                <b>{{customer.full_name}}</b>
                <small>{{customer.phone || 'No mobile'}}{{customerAddress(customer) ? ' · ' + customerAddress(customer) : ''}}</small>
              </button>
              <span *ngIf="!filteredCustomers().length" class="customer-search-empty">No matching customer. Register a new customer below.</span>
            </span>
            <div class="selected-customer" *ngIf="selectedCustomer">
              <span>Selected customer <b>{{selectedCustomer.full_name}}</b> · {{selectedCustomer.phone || 'No mobile'}}</span>
              <button type="button" class="text-btn" (click)="clearCustomerSelection()">Change</button>
            </div>
          </div>
          <details class="quick-customer"><summary>Register a new customer</summary>
            <div class="payment-line"><label>Full name<input [(ngModel)]="newCustomer.name" name="newName"></label>
              <label>Mobile<input [(ngModel)]="newCustomer.phone" name="newPhone" inputmode="tel"></label>
              <label>Address / village<input [(ngModel)]="newCustomer.address" name="newAddress"></label>
              <button class="text-btn" type="button" (click)="addCustomer()" [disabled]="!newCustomer.name.trim()">Save customer</button></div>
            <p class="form-error" *ngIf="customerError">{{customerError}}</p>
          </details>
          <div class="girvi-collateral-head"><div><h3>Jewellery received</h3><p>Confirm the local agreed rate for each item; market quotes are indicative. Saved rates and item values will not change.</p></div>
            <button class="text-btn" type="button" (click)="addCollateralItem()" [disabled]="draft.items.length >= 100">＋ Add item</button></div>
          <article class="girvi-item" *ngFor="let item of draft.items; let i = index">
            <div class="girvi-item-head"><b>Item {{i + 1}}</b><button *ngIf="draft.items.length > 1" class="text-btn" type="button" (click)="removeCollateralItem(i)">Remove</button></div>
            <div class="field-row">
              <label>Description<input [(ngModel)]="item.description" [name]="'itemDescription'+i" maxlength="180" required placeholder="Ring, nose ring, chain…"></label>
              <label>Identifying marks / condition<textarea [(ngModel)]="item.conditionNotes" [name]="'itemCondition'+i" maxlength="500" rows="1" placeholder="Hallmark, stone, scratches or existing damage"></textarea></label>
              <label>Metal<select [(ngModel)]="item.metal" [name]="'itemMetal'+i" (ngModelChange)="collateralMetalChanged(item)"><option value="gold">Gold</option><option value="silver">Silver</option></select></label>
              <label>Purity<select [(ngModel)]="item.purity" [name]="'itemPurity'+i" (ngModelChange)="item.rate = ''">
                <ng-container *ngIf="item.metal === 'gold'"><option>24K</option><option>22K</option><option>20K</option><option>18K</option><option>16K</option></ng-container>
                <ng-container *ngIf="item.metal === 'silver'"><option>999</option><option>925</option><option>Custom</option></ng-container>
              </select></label>
              <label>Net weight (g)<input [(ngModel)]="item.weight" [name]="'itemWeight'+i" type="number" min="0.0001" step="0.0001" required></label>
              <label *ngIf="item.metal === 'silver' && item.purity === 'Custom'">Custom purity factor<input [(ngModel)]="item.customPurityFactor" [name]="'itemFactor'+i" type="number" min="0.000001" max="0.999999" step="0.000001" required></label>
            </div>
            <p class="girvi-rate-note" *ngIf="item.metal === 'gold' && item.purity === '16K'">16K reference rate is calculated proportionally from the 18K market quote; confirm or edit the agreed rate.</p>
            <div class="payment-line">
              <button class="text-btn" type="button" (click)="fetchRate(item)" [disabled]="rateLoading">{{rateLoading ? 'Fetching rate…' : 'Use current rate'}}</button>
              <label>Agreed rate / gram (₹)<input [(ngModel)]="item.rate" [name]="'itemRate'+i" type="number" min="0.0001" step="0.0001" required></label>
              <span class="girvi-item-value">Assessed value <b>{{inr(itemValue(item))}}</b></span>
            </div>
          </article>
          <div class="girvi-total"><span>Total assessed jewellery value</span><b>{{inr(estimatedValue)}}</b></div>
          <div class="field-row">
            <label>Cash given to customer (₹)<input [(ngModel)]="draft.principal" name="principal" type="number" min="0.01" [max]="estimatedValue" step="0.01" required></label>
            <label>Disbursement method<select [(ngModel)]="draft.disbursementMethod" name="disbursementMethod"><option value="cash">Cash</option><option value="upi">UPI</option><option value="bank_transfer">Bank transfer</option><option value="card">Card</option></select></label>
            <label>Interest per month (%)<input [(ngModel)]="draft.interestPercent" name="interestPercent" type="number" min="2" max="10" step="0.25" required></label>
            <label>Loan date<input [(ngModel)]="draft.date" name="date" type="date" required></label>
            <label>Agreed repayment date<input [(ngModel)]="draft.maturityDate" name="maturityDate" type="date" [min]="draft.date" required></label>
          </div>
          <label>Notes (optional)<textarea [(ngModel)]="draft.notes" name="notes" rows="2" maxlength="2000"></textarea></label>
          <p>Interest compounds monthly at the agreed rate of 2%–10%. Partial months accrue no interest. Payment is applied to accrued interest first, then principal; jewellery is released only after the full outstanding is paid.</p>
          <p class="form-error" *ngIf="formError" role="alert">{{formError}}</p>
          <div class="form-actions"><button class="primary-btn" type="submit" [disabled]="saving || !draft.customerId">{{saving ? 'Saving…' : 'Create Girvi'}}</button></div>
        </form>
      </section>

      <section class="panel customer-editor" *ngIf="selected as pledge">
        <div class="panel-head girvi-details-head">
          <div><p class="eyebrow">PLEDGE DETAILS</p><h2>Girvi #{{pledge.girvi_number}}</h2></div>
          <div class="girvi-details-actions"><span class="customer-status" [class.status-active]="pledge.status === 'active'">{{pledge.status | titlecase}}</span><button class="text-btn" type="button" (click)="selected = null">Close details</button></div>
        </div>
        <div class="girvi-overview">
          <article><span>Customer</span><b>{{pledge.customer_name_snapshot || customerName(pledge.customer_id)}}</b><small>{{pledge.customer_phone_snapshot || customerPhone(pledge.customer_id) || 'No mobile'}}</small></article>
          <article><span>Loan given</span><b>{{inr(pledge.principal_amount)}}</b><small>{{pledge.girvi_date}} · {{pledge.monthly_interest_percent}}% monthly</small></article>
          <article><span>Current outstanding</span><b>{{inr(currentOutstanding(pledge))}}</b><small>{{inr(currentInterest(pledge))}} accrued interest</small></article>
          <article><span>Repayment date</span><b>{{pledge.maturity_date}}</b><small>{{completedMonths(pledge)}} completed interest periods</small></article>
        </div>
        <section class="girvi-detail-section">
          <div class="girvi-section-title"><div><h3>Pledged jewellery</h3><p>Item descriptions, agreed purity, weight and saved valuation</p></div><b>{{inr(pledge.estimated_market_value)}} assessed</b></div>
          <div class="table-wrap"><table class="girvi-items-table"><thead><tr><th>Item / identifying condition</th><th>Metal · purity</th><th>Weight</th><th>Agreed rate</th><th>Value</th></tr></thead><tbody>
            <tr *ngFor="let item of collateralItems(pledge.id)"><td><b>{{item.description}}</b><small *ngIf="item.condition_notes">{{item.condition_notes}}</small></td><td>{{item.metal | titlecase}} · {{item.purity}}</td><td>{{item.weight_g}} g</td><td>{{inr(item.rate_per_gram)}} / g</td><td><b>{{inr(item.estimated_market_value)}}</b></td></tr>
          </tbody></table></div>
        </section>
        <div class="girvi-returned-note" *ngIf="pledge.status === 'closed'">Payment settled. Jewellery was returned on {{pledge.closed_at | date:'d MMM y':'Asia/Kolkata'}}.</div>
        <div class="girvi-payment" *ngIf="pledge.status === 'active' && canPost">
          <h3>Record payment</h3><div class="payment-line">
            <label>Amount<input [(ngModel)]="paymentAmount" [ngModelOptions]="{standalone:true}" type="number" min="0.01" step="0.01"></label>
            <label>Method<select [(ngModel)]="paymentMethod" [ngModelOptions]="{standalone:true}"><option value="cash">Cash</option><option value="upi">UPI</option><option value="bank_transfer">Bank transfer</option><option value="card">Card</option></select></label>
            <label>Date<input [(ngModel)]="paymentDate" [ngModelOptions]="{standalone:true}" type="date"></label>
            <button class="primary-btn" type="button" (click)="recordPayment(pledge)" [disabled]="saving || !paymentAmount">Record payment</button>
            <button class="text-btn" type="button" (click)="settleAndClose(pledge)" [disabled]="saving">Pay full &amp; return jewellery</button>
          </div><p>Payments are allocated to accrued interest first, then principal. A full settlement closes the pledge and records jewellery return.</p>
        </div>
        <p class="form-error" *ngIf="paymentError" role="alert">{{paymentError}}</p>
        <div class="girvi-document-actions" *ngIf="canPost">
          <div><h3>Customer agreement</h3><p>Generate a PDF copy of the agreed collateral and loan terms.</p></div>
          <button class="text-btn" type="button" (click)="downloadAgreementPdf(pledge)" [disabled]="agreementPrinting">{{agreementPrinting?'Preparing PDF…':'Download / Print PDF'}}</button>
          <button class="primary-btn" type="button" (click)="shareAgreementPdf(pledge)" [disabled]="agreementPrinting">{{agreementPrinting?'Preparing PDF…':'Share PDF on WhatsApp'}}</button>
        </div>
        <p class="form-error" *ngIf="agreementError" role="alert">{{agreementError}}</p>
        <p class="save-success" *ngIf="agreementMessage" role="status">{{agreementMessage}}</p>
        <div class="girvi-section-title payment-history-title"><div><h3>Payment history</h3><p>Each repayment is recorded with its date and interest/principal split.</p></div></div>
        <div class="table-wrap" *ngIf="payments.length; else noPayments"><table><thead><tr><th>Date</th><th>Amount</th><th>Interest paid</th><th>Principal paid</th><th>Method</th></tr></thead><tbody><tr *ngFor="let item of payments"><td>{{item.payment_date | date:'d MMM y':'Asia/Kolkata'}}</td><td>{{inr(item.amount)}}</td><td>{{inr(item.interest_paid)}}</td><td>{{inr(item.principal_paid)}}</td><td>{{item.payment_method | titlecase}}</td></tr></tbody></table></div>
        <ng-template #noPayments><p>No payments recorded yet.</p></ng-template>
      </section>

      <section class="panel customer-list">
        <div class="customer-toolbar"><label class="search-field">Search customer, mobile or Girvi number<input [(ngModel)]="search" name="search" (ngModelChange)="filterPledges()" placeholder="Search"></label></div>
        <div class="table-wrap" *ngIf="visiblePledges.length; else noPledges"><table><thead><tr><th>Girvi #</th><th>Customer / mobile</th><th>Jewellery received</th><th>Principal</th><th>Interest / month</th><th>Due date</th><th>Outstanding</th><th>Status</th></tr></thead>
          <tbody><tr *ngFor="let pledge of visiblePledges"><td><button class="text-btn" type="button" (click)="open(pledge)">#{{pledge.girvi_number}}</button></td><td>{{pledge.customer_name_snapshot || customerName(pledge.customer_id)}}<small>{{pledge.customer_phone_snapshot || customerPhone(pledge.customer_id)}}</small></td><td>{{collateralDescription(pledge.id)}}<small>{{pledge.weight_g}} g · assessed {{inr(pledge.estimated_market_value)}}</small></td><td>{{inr(pledge.principal_amount)}}</td><td>{{pledge.monthly_interest_percent}}%</td><td>{{pledge.maturity_date}}</td><td><b>{{inr(currentOutstanding(pledge))}}</b></td><td><span class="customer-status" [class.status-active]="pledge.status === 'active'">{{pledge.status | titlecase}}</span></td></tr></tbody></table></div>
        <ng-template #noPledges><div class="empty-state"><b>{{selected ? 'Selected pledge details are open above' : 'No Girvi records'}}</b><p>{{selected ? 'Close details to see it in the pledge list.' : 'New pledges will appear here.'}}</p></div></ng-template>
      </section>
    </section>
  `,
  styles: [`
    .girvi-payment { margin: 20px 0; padding-top: 16px; border-top: 1px solid #edf0eb; }
    .girvi-payment h3 { margin: 0 0 12px; }
    .girvi-payment p { color: #78867c; font-size: 12px; }
    .quick-customer summary { cursor: pointer; padding: 10px 0; color: #52675a; }
    .activity-row small, td small { display: block; color: #859188; }
    .girvi-collateral-head, .girvi-item-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
    .girvi-collateral-head { grid-column: 1 / -1; margin-top: 8px; }
    .girvi-collateral-head h3 { margin: 0 0 4px; color: #34443a; font-size: 14px; }
    .girvi-collateral-head p { margin: 0; color: #78867c; font-size: 11px; }
    .girvi-item { grid-column: 1 / -1; display: grid; gap: 12px; padding: 14px; border: 1px solid #e6ebe6; border-radius: 9px; background: #fcfdfb; }
    .girvi-item .field-row { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 12px; }
    .girvi-item-head { color: #35473b; font-size: 12px; }
    .girvi-item-value { align-self: end; padding: 10px 0; color: #6b796e; font-size: 11px; }
    .girvi-item-value b, .girvi-total b { color: #263a2d; }
    .girvi-rate-note { margin: -4px 0 0; color: #7c6a43; font-size: 10px; }
    .girvi-total { grid-column: 1 / -1; display: flex; justify-content: space-between; padding: 12px 14px; border-radius: 8px; background: #f5f2e9; color: #58675d; font-size: 12px; }
    .girvi-details-head { align-items: center; }
    .girvi-details-head h2, .girvi-document-actions h3, .girvi-section-title h3 { margin: 0; }
    .girvi-details-head .eyebrow { margin: 0 0 4px; }
    .girvi-details-actions { display: flex; align-items: center; gap: 12px; }
    .girvi-overview { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; margin: 16px 0 22px; }
    .girvi-overview article { min-width: 0; display: grid; gap: 5px; padding: 13px; border: 1px solid #e8ede8; border-radius: 9px; background: #fbfcfa; }
    .girvi-overview article > span, .girvi-overview small { color: #78867c; font-size: 11px; }
    .girvi-overview article > b { color: #293b30; font-size: 14px; overflow-wrap: anywhere; }
    .girvi-detail-section { margin: 0 0 20px; }
    .girvi-section-title { display: flex; justify-content: space-between; align-items: center; gap: 12px; margin-bottom: 10px; }
    .girvi-section-title p, .girvi-document-actions p { margin: 4px 0 0; color: #78867c; font-size: 11px; }
    .girvi-section-title > b { color: #34483a; font-size: 12px; white-space: nowrap; }
    .girvi-items-table { min-width: 560px; }
    .girvi-items-table td small { max-width: 260px; margin-top: 3px; white-space: normal; }
    .girvi-returned-note { padding: 12px 14px; margin: 0 0 16px; border-radius: 8px; background: #eff7f0; color: #3e6b48; font-size: 12px; }
    .girvi-document-actions { display: flex; align-items: center; justify-content: flex-end; gap: 10px; flex-wrap: wrap; padding: 16px 0; margin-top: 18px; border-top: 1px solid #edf0eb; }
    .girvi-document-actions > div { flex: 1 1 220px; margin-right: auto; }
    .payment-history-title { margin: 14px 0 10px; }
    @media (max-width: 850px) { .girvi-overview { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
    @media (max-width: 700px) {
      .payment-line { display: grid; grid-template-columns: 1fr; }
      .girvi-document-actions { align-items: stretch; }
      .girvi-document-actions button { width: 100%; }
      .girvi-details-head { align-items: flex-start; }
    }
  `]
})
export class GirviComponent implements OnInit, OnDestroy {
  workspace: BusinessWorkspace | null = null;
  customers: Customer[] = [];
  selectedCustomer: Customer | null = null;
  pledges: Pledge[] = [];
  filteredPledges: Pledge[] = [];
  payments: Payment[] = [];
  selected: Pledge | null = null;
  showCreate = false;
  saving = false;
  rateLoading = false;
  agreementPrinting = false;
  search = '';
  customerSearch = '';
  error = '';
  formError = '';
  customerError = '';
  paymentError = '';
  success = '';
  agreementError = '';
  agreementMessage = '';
  paymentAmount = '';
  paymentMethod: PaymentMethod = 'cash';
  paymentDate = this.today();
  newCustomer = { name: '', phone: '', address: '' };
  draft = this.emptyDraft();
  private readonly collateralByPledge = new Map<string,CollateralItem[]>();
  private pendingCreate: { fingerprint:string; key:string } | null = null;
  private pendingPayment: { fingerprint:string; key:string } | null = null;
  private readonly names = new Map<string,string>();
  private readonly phones = new Map<string,string>();
  private subscription?: Subscription;

  constructor(private readonly service: WorkspaceService, private readonly cdr: ChangeDetectorRef) {}

  get canPost(): boolean { return this.workspace?.role === 'owner' || this.workspace?.role === 'admin'; }
  get visiblePledges():Pledge[] { return this.filteredPledges.filter(pledge=>pledge.id!==this.selected?.id); }

  ngOnInit(): void {
    this.subscription = this.service.activeWorkspace$.subscribe(workspace => {
      this.workspace = workspace;
      this.selected = null;
      this.pledges = [];
      if (workspace) void this.load();
    });
  }
  ngOnDestroy(): void { this.subscription?.unsubscribe(); }

  async load(): Promise<void> {
    const workspace = this.workspace, client = this.service.client;
    if (!workspace || !client) return;
    this.error = '';
    try {
      const [customers, pledges] = await Promise.all([
        client.from('customers').select('id,full_name,phone,address').eq('business_id',workspace.id).eq('status','active').order('full_name'),
        client.from('ss_girvi').select('*').eq('business_id',workspace.id).order('created_at',{ascending:false}).limit(1000)
      ]);
      if (customers.error) throw new Error(customers.error.message);
      if (pledges.error) throw new Error(pledges.error.message);
      this.customers = (customers.data ?? []) as Customer[];
      this.names.clear(); this.phones.clear();
      for (const customer of this.customers) {
        this.names.set(customer.id,customer.full_name);
        this.phones.set(customer.id,customer.phone ?? '');
      }
      if(this.draft.customerId)this.selectedCustomer=this.customers.find(customer=>customer.id===this.draft.customerId)??null;
      this.pledges = (pledges.data ?? []) as Pledge[];
      const items=await client.from('ss_girvi_items').select('id,girvi_id,item_number,description,condition_notes,metal,purity,weight_g,rate_per_gram,estimated_market_value')
        .eq('business_id',workspace.id).order('item_number');
      if(items.error)throw new Error(items.error.message);
      this.collateralByPledge.clear();
      for(const row of (items.data??[]) as CollateralItem[]){
        this.collateralByPledge.set(row.girvi_id,[...(this.collateralByPledge.get(row.girvi_id)??[]),row]);
      }
      this.filterPledges();
    } catch (error) {
      this.error = error instanceof Error ? error.message : 'Could not load Girvi records.';
    } finally { this.cdr.markForCheck(); }
  }

  filteredCustomers(): Customer[] {
    const query=this.customerSearch.trim().toLocaleLowerCase();
    const phoneQuery=query.replace(/\D/g,'');
    if(!query)return this.customers.slice(0,20);
    return this.customers.filter(customer=>{
      const name=customer.full_name.toLocaleLowerCase();
      const phone=(customer.phone??'').toLocaleLowerCase();
      const phoneDigits=phone.replace(/\D/g,'');
      const address=this.customerAddress(customer).toLocaleLowerCase();
      return name.includes(query)||phone.includes(query)||address.includes(query)||(phoneQuery.length>0&&phoneDigits.includes(phoneQuery));
    }).slice(0,20);
  }
  customerSearchChanged():void{
    this.draft.customerId='';
    this.selectedCustomer=null;
  }
  selectCustomer(customer:Customer):void{
    this.draft.customerId=customer.id;
    this.selectedCustomer=customer;
    this.customerSearch=customer.full_name;
  }
  clearCustomerSelection():void{
    this.draft.customerId='';
    this.selectedCustomer=null;
    this.customerSearch='';
  }
  customerAddress(customer:Customer):string{
    if(typeof customer.address==='string')return customer.address;
    if(customer.address&&typeof customer.address==='object'){
      const address=customer.address as Record<string,unknown>;
      return Object.values(address).filter((value):value is string=>typeof value==='string').join(', ');
    }
    return '';
  }
  filterPledges(): void {
    const query=this.search.trim().toLowerCase();
    this.filteredPledges=this.pledges.filter(p=>!query||String(p.girvi_number).includes(query)||(p.customer_name_snapshot??this.customerName(p.customer_id)).toLowerCase().includes(query)||(p.customer_phone_snapshot??this.customerPhone(p.customer_id)).includes(query));
  }

  async addCustomer(): Promise<void> {
    const client=this.service.client,workspace=this.workspace,name=this.newCustomer.name.trim();
    if(!client||!workspace||!name)return;
    try {
      const result=await client.from('customers').insert({business_id:workspace.id,full_name:name,phone:this.newCustomer.phone.trim()||null,address:this.newCustomer.address.trim()?{line1:this.newCustomer.address.trim()}:{},status:'active'})
        .select('id,full_name,phone,address').single();
      if(result.error)throw new Error(result.error.message);
      const customer=result.data as Customer;
      this.customers=[...this.customers,customer];this.names.set(customer.id,customer.full_name);this.phones.set(customer.id,customer.phone??'');
      this.selectCustomer(customer);this.newCustomer={name:'',phone:'',address:''};
    } catch(error) { this.customerError=error instanceof Error?error.message:'Could not register customer.'; }
  }

  async fetchRate(item:DraftCollateralItem): Promise<void> {
    const client=this.service.client,workspace=this.workspace;
    if(!client||!workspace)return;
    this.rateLoading=true;this.formError='';
    try {
      const purityFactor=this.purityFactor(item)*(item.metal==='gold'&&item.purity==='16K'?16/18:1);
      const quotePurity=item.metal==='gold'&&item.purity==='16K'?'18K':item.purity;
      const result=await client.functions.invoke('market-gold-rate',{body:{businessId:workspace.id,...(item.metal==='gold'?{purity:quotePurity}:{metal:'silver'})}});
      if(result.error)throw new Error(result.error.message);
      const quote=result.data as {rate?:number;error?:string;unit?:string}|null;
      if(!quote||quote.error||quote.unit!=='gram'||typeof quote.rate!=='number'||!Number.isFinite(quote.rate)||quote.rate<=0)throw new Error(quote?.error||'The live rate was not a valid per-gram quote.');
      item.rate=(quote.rate*purityFactor).toFixed(4);
    } catch(error) { this.formError=error instanceof Error?error.message:'Could not fetch the live rate.'; }
    finally { this.rateLoading=false;this.cdr.markForCheck(); }
  }

  addCollateralItem():void{if(this.draft.items.length<100)this.draft.items.push(this.emptyCollateralItem());}
  removeCollateralItem(index:number):void{if(this.draft.items.length>1)this.draft.items.splice(index,1);}
  collateralMetalChanged(item:DraftCollateralItem):void{item.purity=item.metal==='gold'?'22K':'999';item.rate='';item.customPurityFactor='0.900000';}
  itemValue(item:DraftCollateralItem):string{
    try{
      if(!item.weight||!item.rate)return '0.00';
      return girviCollateralValue(item.weight,item.rate);
    }catch{return '0.00';}
  }
  get estimatedValue():string{
    return formatFixed(this.draft.items.reduce((sum,item)=>sum+parseFixed(this.itemValue(item),2),0n),2);
  }
  private purityFactor(item:DraftCollateralItem):number{
    if(item.metal==='gold')return 1;
    if(item.purity==='999')return 0.999;
    if(item.purity==='925')return 0.925;
    const factor=Number(item.customPurityFactor);
    if(!Number.isFinite(factor)||factor<=0||factor>=1)throw new Error('Custom silver purity factor must be greater than 0 and less than 1.');
    return factor;
  }
  async create(): Promise<void> {
    const client=this.service.client,workspace=this.workspace;
    if(!client||!workspace||!this.canPost||this.saving)return;
    let items:Record<string,string>[],principal:string;
    try{
      if(!this.draft.customerId||this.draft.items.length<1)throw new Error('Select a customer and record at least one jewellery item.');
      items=this.draft.items.map(item=>{
        const weight=parseFixed(item.weight,4),rate=parseFixed(item.rate,4);
        const factor=this.purityFactor(item);
        if(!item.description.trim()||item.description.trim().length>180||weight<=0n||rate<=0n)throw new Error('Enter each item description, positive weight, and agreed per-gram rate.');
        return {description:item.description.trim(),condition_notes:item.conditionNotes.trim(),metal:item.metal,purity:item.purity,weight_g:formatFixed(weight,4),
          rate_per_gram:formatFixed(rate,4),purity_factor:factor.toFixed(6)};
      });
      principal=formatFixed(parseFixed(this.draft.principal,2),2);
      if(parseFixed(principal,2)<=0n||parseFixed(principal,2)>parseFixed(this.estimatedValue,2))throw new Error('Loan amount must be positive and no greater than the total assessed jewellery value.');
      if(this.draft.date>this.today()||this.draft.maturityDate<this.draft.date)throw new Error('Choose a valid loan date and a repayment date on or after it.');
      const monthlyRate=Number(this.draft.interestPercent);
      if(!Number.isFinite(monthlyRate)||monthlyRate<2||monthlyRate>10||Math.round(monthlyRate*100)!==monthlyRate*100)throw new Error('Monthly interest must be from 2% to 10%, with no more than 2 decimal places.');
    }catch(error){this.formError=error instanceof Error?error.message:'Check the pledge details.';return;}
    const payload={customerId:this.draft.customerId,items,principal,interestPercent:this.draft.interestPercent,date:this.draft.date,
      maturityDate:this.draft.maturityDate,method:this.draft.disbursementMethod,notes:this.draft.notes.trim()};
    const fingerprint=JSON.stringify(payload);
    if(!this.pendingCreate||this.pendingCreate.fingerprint!==fingerprint)this.pendingCreate={fingerprint,key:crypto.randomUUID()};
    if(!window.confirm(`Create this pledge for ${this.inr(principal)} with ${items.length} item(s) and ${this.draft.interestPercent}% monthly compound interest?`))return;
    this.saving=true;this.formError='';
    try {
      const result=await client.rpc('ss_girvi_create_multi',{p_business_id:workspace.id,p_customer_id:this.draft.customerId,p_idempotency_key:this.pendingCreate.key,
        p_items:items,p_principal:principal,p_monthly_interest_percent:this.draft.interestPercent,p_girvi_date:this.draft.date,
        p_maturity_date:this.draft.maturityDate,p_disbursement_method:this.draft.disbursementMethod,p_notes:this.draft.notes});
      if(result.error)throw new Error(result.error.message);
      if(!result.data)throw new Error('The database did not confirm the new Girvi pledge. Retry safely.');
      const newPledgeId=result.data;
      this.pendingCreate=null;this.success='Girvi pledge created and loan disbursement recorded.';this.showCreate=false;this.draft=this.emptyDraft();await this.load();
      const created=this.pledges.find(pledge=>pledge.id===newPledgeId);if(created)await this.open(created);
    } catch(error) { this.formError=error instanceof Error?error.message:'Could not create Girvi.'; }
    finally { this.saving=false;this.cdr.markForCheck(); }
  }

  async open(pledge:Pledge):Promise<void> {
    this.selected=pledge;this.paymentError='';this.agreementError='';this.agreementMessage='';this.payments=[];
    const client=this.service.client,workspace=this.workspace;
    if(!client||!workspace)return;
    const result=await client.from('ss_girvi_payments').select('id,amount,payment_method,interest_paid,principal_paid,payment_date')
      .eq('business_id',workspace.id).eq('girvi_id',pledge.id).order('payment_date',{ascending:false});
    if(result?.error)this.paymentError=result.error.message;
    else this.payments=(result?.data??[]) as Payment[];
  }

  async recordPayment(pledge:Pledge):Promise<void> {
    const client=this.service.client,workspace=this.workspace;
    if(!client||!workspace||this.saving||!this.canPost)return;
    let amount:string;
    try{
      amount=formatFixed(parseFixed(this.paymentAmount,2),2);
      if(parseFixed(amount,2)<=0n||parseFixed(amount,2)>parseFixed(this.currentOutstanding(pledge),2))throw new Error('Payment must be positive and no greater than the current outstanding.');
    }catch(error){this.paymentError=error instanceof Error?error.message:'Enter a valid payment amount.';return;}
    const fingerprint=JSON.stringify({pledge:pledge.id,amount,method:this.paymentMethod,date:this.paymentDate});
    if(!this.pendingPayment||this.pendingPayment.fingerprint!==fingerprint)this.pendingPayment={fingerprint,key:crypto.randomUUID()};
    if(!window.confirm('Record this payment? It will first settle accrued interest, then principal. Paying the full outstanding closes the pledge and records jewellery return.'))return;
    this.saving=true;this.paymentError='';
    try {
      const result=await client.rpc('ss_girvi_record_payment',{p_business_id:workspace.id,p_girvi_id:pledge.id,p_idempotency_key:this.pendingPayment.key,p_amount:amount,p_method:this.paymentMethod,p_payment_date:this.paymentDate});
      if(result.error)throw new Error(result.error.message);
      this.pendingPayment=null;this.success='Payment recorded.';this.paymentAmount='';await this.load();
      const updated=this.pledges.find(row=>row.id===pledge.id);if(updated)await this.open(updated);
    } catch(error) { this.paymentError=error instanceof Error?error.message:'Could not record payment.'; }
    finally { this.saving=false;this.cdr.markForCheck(); }
  }

  settleAndClose(pledge:Pledge):void{
    this.paymentAmount=this.currentOutstanding(pledge);
    void this.recordPayment(pledge);
  }
  async downloadAgreementPdf(pledge:Pledge):Promise<void>{
    if(this.agreementPrinting)return;
    this.agreementPrinting=true;this.agreementError='';this.agreementMessage='';this.cdr.markForCheck();
    try{
      const pdf=await this.prepareAgreementPdf(pledge);
      pdf.save(this.agreementFileName(pledge));
      this.agreementMessage='Agreement PDF downloaded. Open it to print or save a copy.';
    }catch(error){this.agreementError=error instanceof Error?error.message:'Could not prepare the Girvi agreement PDF.';}
    finally{this.agreementPrinting=false;this.cdr.markForCheck();}
  }

  async shareAgreementPdf(pledge:Pledge):Promise<void>{
    if(this.agreementPrinting)return;
    this.agreementPrinting=true;this.agreementError='';this.agreementMessage='';this.cdr.markForCheck();
    let chatWindow:Window|null=null;
    try{
      const probe=new File(['agreement'],'girvi-agreement.pdf',{type:'application/pdf'});
      const supportsFileShare=typeof navigator.share==='function'&&typeof navigator.canShare==='function'&&navigator.canShare({files:[probe]});
      if(!supportsFileShare)chatWindow=window.open('about:blank','_blank');
      const pdf=await this.prepareAgreementPdf(pledge);
      const file=new File([pdf.output('blob')],this.agreementFileName(pledge),{type:'application/pdf'});
      const message=`Girvi pledge agreement #${pledge.girvi_number} from ${this.workspace?.name||'Jewellery Business'}. Loan: INR ${pledge.principal_amount}; agreed repayment date: ${pledge.maturity_date}.`;
      if(typeof navigator.share==='function'&&typeof navigator.canShare==='function'&&navigator.canShare({files:[file]})){
        await navigator.share({files:[file],title:`Girvi agreement #${pledge.girvi_number}`,text:message});
        this.agreementMessage='PDF ready to share. Choose WhatsApp in the share sheet if available.';
        return;
      }
      pdf.save(this.agreementFileName(pledge));
      const phone=this.whatsAppNumber(pledge.customer_phone_snapshot||this.customerPhone(pledge.customer_id));
      const whatsappUrl=`https://wa.me/${phone}?text=${encodeURIComponent(message)}`;
      if(chatWindow)chatWindow.location.href=whatsappUrl;
      else window.location.assign(whatsappUrl);
      this.agreementMessage='PDF downloaded and WhatsApp opened. Attach the downloaded PDF in the chat to send it.';
    }catch(error){
      chatWindow?.close();
      if(error instanceof DOMException&&error.name==='AbortError')this.agreementMessage='PDF sharing was cancelled.';
      else this.agreementError=error instanceof Error?error.message:'Could not prepare or share the Girvi agreement PDF.';
    }finally{this.agreementPrinting=false;this.cdr.markForCheck();}
  }

  private async prepareAgreementPdf(pledge:Pledge):Promise<jsPDF>{
    const client=this.service.client,workspace=this.workspace;
    if(!client||!workspace)throw new Error('Select an active business workspace before generating the agreement.');
    const audit=await client.rpc('ss_audit_girvi_agreement_print',{p_business_id:workspace.id,p_girvi_id:pledge.id});
    if(audit.error)throw new Error(`${audit.error.code??'Supabase'}: ${audit.error.message}`);
    const {jsPDF}=await import('jspdf');
    const pdf=new jsPDF({unit:'mm',format:'a4'}),left=15,width=180;
    let y=18;
    const ensure=(height=8):void=>{if(y+height>278){pdf.addPage();y=18;}};
    const text=(value:string,size=9,bold=false,indent=0):void=>{
      pdf.setFont('helvetica',bold?'bold':'normal');pdf.setFontSize(size);
      const lines=pdf.splitTextToSize(value,width-indent),lineHeight=size*0.48;
      ensure(lines.length*lineHeight+2);pdf.text(lines,left+indent,y);y+=lines.length*lineHeight+2;
    };
    const rule=():void=>{ensure(6);pdf.setDrawColor(210,218,211);pdf.line(left,y,left+width,y);y+=6;};
    const section=(title:string):void=>{ensure(12);y+=2;text(title.toUpperCase(),10,true);};
    pdf.setTextColor(43,61,49);
    text(this.workspace?.name||'Jewellery Business',18,true);
    text(`GIRVI PLEDGE AGREEMENT  |  #${pledge.girvi_number}`,11,true);
    rule();
    section('Customer and pledge');
    text(`Borrower: ${pledge.customer_name_snapshot||this.customerName(pledge.customer_id)}`,10,true);
    text(`Mobile: ${pledge.customer_phone_snapshot||this.customerPhone(pledge.customer_id)||'Not recorded'}`);
    if(pledge.customer_address_snapshot)text(`Address: ${pledge.customer_address_snapshot}`);
    text(`Agreement date: ${pledge.girvi_date}    Repayment date: ${pledge.maturity_date}`);
    rule();
    section('Jewellery received and agreed valuation');
    for(const [index,item] of this.collateralItems(pledge.id).entries()){
      text(`${index+1}. ${item.description} | ${item.metal.toUpperCase()} ${item.purity} | ${item.weight_g} g`,10,true);
      if(item.condition_notes)text(`Condition / identifying marks: ${item.condition_notes}`,8,false,4);
      text(`Agreed rate: INR ${item.rate_per_gram} per g    Assessed value: INR ${item.estimated_market_value}`,8,false,4);
    }
    if(!this.collateralItems(pledge.id).length)text('No collateral item details are available.');
    rule();
    section('Loan and interest terms');
    text(`Total assessed collateral value: INR ${pledge.estimated_market_value}`,9,true);
    text(`Loan amount disbursed to borrower: INR ${pledge.principal_amount}`,9,true);
    text(`Agreed interest: ${pledge.monthly_interest_percent}% compound interest per completed month.`);
    text('A partial month does not accrue interest. If unpaid by the agreed repayment date, the same agreed monthly rate continues per completed month; no separate penalty or fee is included.');
    text('Payments are allocated to accrued interest first and then principal. The pledged jewellery will be returned when the full outstanding amount is paid and recorded.');
    text('The borrower confirms the listed jewellery, metal, purity, weight and assessed values and acknowledges receipt of the loan amount. Any change to these terms must be recorded and accepted by both parties in writing.');
    if(pledge.notes){rule();section('Additional agreed notes');text(pledge.notes);}
    ensure(32);y+=12;
    pdf.setDrawColor(100,110,101);
    for(const [label,x] of [['Borrower signature',left],['Business representative',left+64],['Witness',left+128]] as const){
      pdf.line(x,y,x+48,y);pdf.setFont('helvetica','normal');pdf.setFontSize(8);pdf.text(label,x,y+5);
    }
    y+=18;text('Both parties should check this agreement before signing and keep a copy. Applicable local law governs.',8);
    pdf.setTextColor(0,0,0);
    return pdf;
  }

  private agreementFileName(pledge:Pledge):string{
    const name=(pledge.customer_name_snapshot||this.customerName(pledge.customer_id)).toLocaleLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'')||'customer';
    return `girvi-${pledge.girvi_number}-${name}.pdf`;
  }

  private whatsAppNumber(phone:string):string{
    const digits=phone.replace(/\D/g,'');
    return digits.length===10?`91${digits}`:digits;
  }
  collateralItems(pledgeId:string):CollateralItem[]{return this.collateralByPledge.get(pledgeId)??[];}
  collateralDescription(pledgeId:string):string{
    const items=this.collateralItems(pledgeId);
    return items.length?items.map(item=>`${item.description} · ${item.metal} ${item.purity}`).join(', '):'Loading item details';
  }
  customerName(id:string):string{return this.names.get(id)??'Customer';}
  customerPhone(id:string):string{return this.phones.get(id)??'';}
  inr(value:string|number):string{return formatInr(String(value),2);}
  completedMonths(p:Pledge):number { return completedMonthlyPeriods(p.girvi_date,p.status==='closed'&&p.closed_at?p.closed_at.slice(0,10):this.today()); }
  currentInterest(p:Pledge):string { return this.growth(p).interest; }
  currentOutstanding(p:Pledge):string { const g=this.growth(p);return formatFixed(parseFixed(g.principal,2)+parseFixed(g.interest,2),2); }

  private growth(p:Pledge):{principal:string;interest:string} {
    const balances=girviBalancesAt(p.principal_balance,p.interest_balance,p.monthly_interest_percent,p.last_accrued_months,this.completedMonths(p));
    return {principal:balances.principal,interest:balances.interest};
  }
  private emptyCollateralItem():DraftCollateralItem{return {description:'',conditionNotes:'',metal:'gold',purity:'22K',weight:'',rate:'',customPurityFactor:'0.900000'};}
  private emptyDraft():{customerId:string;items:DraftCollateralItem[];principal:string;interestPercent:number;date:string;maturityDate:string;disbursementMethod:PaymentMethod;notes:string} {
    return {customerId:'',items:[this.emptyCollateralItem()],principal:'',interestPercent:3,date:this.today(),maturityDate:this.dateAfterDays(30),disbursementMethod:'cash',notes:''};
  }
  private dateAfterDays(days:number):string{const date=new Date();date.setDate(date.getDate()+days);return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;}
  private today():string { const date=new Date();return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`; }
}
