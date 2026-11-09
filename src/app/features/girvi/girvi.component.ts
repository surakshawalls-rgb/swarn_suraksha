import { CommonModule } from '@angular/common';
import { ChangeDetectorRef, Component, OnDestroy, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { IonicModule } from '@ionic/angular';
import { Subscription } from 'rxjs';
import { formatInr } from '../../core/financial/decimal';
import { completedMonthlyPeriods, girviBalancesAt } from '../../core/financial/girvi';
import { BusinessWorkspace, WorkspaceService } from '../dashboard/workspace.service';

type PaymentMethod = 'cash' | 'upi' | 'bank_transfer' | 'card';
interface Customer { id: string; full_name: string; phone: string | null; address?: unknown; }
interface Pledge {
  id: string; customer_id: string; girvi_number: number; metal: 'gold' | 'silver'; purity: string | null;
  weight_g: string; rate_per_gram: string; estimated_market_value: string; principal_amount: string;
  principal_balance: string; interest_balance: string; monthly_interest_percent: string; girvi_date: string;
  last_accrued_months: number; status: 'active' | 'closed'; closed_at: string | null; notes: string | null;
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
          <label>Find customer by name or mobile
            <input [(ngModel)]="customerSearch" name="customerSearch" (ngModelChange)="filterCustomers()" autocomplete="off" placeholder="Search customers">
          </label>
          <label>Customer<select [(ngModel)]="draft.customerId" name="customer" required>
            <option value="">Select a customer</option><option *ngFor="let customer of matchedCustomers" [value]="customer.id">{{customer.full_name}} · {{customer.phone || 'No mobile'}}</option>
          </select></label>
          <details class="quick-customer"><summary>Register a new customer</summary>
            <div class="payment-line"><label>Full name<input [(ngModel)]="newCustomer.name" name="newName"></label>
              <label>Mobile<input [(ngModel)]="newCustomer.phone" name="newPhone" inputmode="tel"></label>
              <label>Address / village<input [(ngModel)]="newCustomer.address" name="newAddress"></label>
              <button class="text-btn" type="button" (click)="addCustomer()" [disabled]="!newCustomer.name.trim()">Save customer</button></div>
            <p class="form-error" *ngIf="customerError">{{customerError}}</p>
          </details>
          <div class="field-row">
            <label>Metal<select [(ngModel)]="draft.metal" name="metal" (ngModelChange)="rate = null"><option value="gold">Gold</option><option value="silver">Silver</option></select></label>
            <label *ngIf="draft.metal === 'gold'">Purity<select [(ngModel)]="draft.purity" name="purity" (ngModelChange)="rate = null"><option>24K</option><option>22K</option><option>18K</option></select></label>
            <label>Weight (g)<input [(ngModel)]="draft.weight" name="weight" type="number" min="0.0001" step="0.0001" required (ngModelChange)="calculateValue()"></label>
          </div>
          <div class="payment-line">
            <button class="text-btn" type="button" (click)="fetchRate()" [disabled]="rateLoading">{{rateLoading ? 'Fetching rate…' : 'Fetch current rate'}}</button>
            <label>Market rate / gram<input [(ngModel)]="rate" name="rate" type="number" min="0.0001" step="0.0001" (ngModelChange)="calculateValue()"></label>
            <label>Estimated value<input [value]="estimatedValue" name="estimatedValue" readonly></label>
          </div>
          <div class="field-row">
            <label>Cash loan amount<input [(ngModel)]="draft.principal" name="principal" type="number" min="0.01" step="0.01" required></label>
            <label>Monthly interest<select [(ngModel)]="draft.interestPercent" name="interestPercent"><option *ngFor="let percent of interestOptions" [ngValue]="percent">{{percent}}%</option></select></label>
            <label>Girvi date<input [(ngModel)]="draft.date" name="date" type="date" required></label>
          </div>
          <label>Notes (optional)<textarea [(ngModel)]="draft.notes" name="notes" rows="2" maxlength="2000"></textarea></label>
          <p>Interest compounds monthly. Partial months accrue no interest; months are counted on the original date's monthly anniversary (month-end dates clamp to the last day).</p>
          <p class="form-error" *ngIf="formError" role="alert">{{formError}}</p>
          <div class="form-actions"><button class="primary-btn" type="submit" [disabled]="saving || !draft.customerId || rate === null">{{saving ? 'Saving…' : 'Create Girvi'}}</button></div>
        </form>
      </section>

      <section class="panel customer-editor" *ngIf="selected as pledge">
        <div class="panel-head"><div><h2>Girvi #{{pledge.girvi_number}}</h2><p>{{customerName(pledge.customer_id)}} · {{pledge.status | titlecase}}</p></div><button class="text-btn" type="button" (click)="selected = null">Close details</button></div>
        <div class="purchase-summary">
          <span>Metal / purity</span><b>{{pledge.metal | titlecase}} {{pledge.purity || ''}}</b>
          <span>Weight</span><b>{{pledge.weight_g}} g</b>
          <span>Original market rate</span><b>{{inr(pledge.rate_per_gram)}} / g</b>
          <span>Estimated value</span><b>{{inr(pledge.estimated_market_value)}}</b>
          <span>Original principal</span><b>{{inr(pledge.principal_amount)}}</b>
          <span>Monthly interest</span><b>{{pledge.monthly_interest_percent}}%</b>
          <span>Girvi date / completed months</span><b>{{pledge.girvi_date}} / {{completedMonths(pledge)}}</b>
          <span>Accrued interest</span><b>{{inr(currentInterest(pledge))}}</b>
          <span>Current outstanding</span><b>{{inr(currentOutstanding(pledge))}}</b>
          <span *ngIf="pledge.status === 'closed'">Jewellery returned</span><b *ngIf="pledge.status === 'closed'">Yes</b>
        </div>
        <div class="girvi-payment" *ngIf="pledge.status === 'active' && canPost">
          <h3>Record payment</h3><div class="payment-line">
            <label>Amount<input [(ngModel)]="paymentAmount" [ngModelOptions]="{standalone:true}" type="number" min="0.01" step="0.01"></label>
            <label>Method<select [(ngModel)]="paymentMethod" [ngModelOptions]="{standalone:true}"><option value="cash">Cash</option><option value="upi">UPI</option><option value="bank_transfer">Bank transfer</option><option value="card">Card</option></select></label>
            <label>Date<input [(ngModel)]="paymentDate" [ngModelOptions]="{standalone:true}" type="date"></label>
            <button class="primary-btn" type="button" (click)="recordPayment(pledge)" [disabled]="saving || !paymentAmount">Record payment</button>
          </div><p>Payments are allocated to accrued interest first, then principal. A full settlement closes the pledge and records jewellery return.</p>
        </div>
        <p class="form-error" *ngIf="paymentError" role="alert">{{paymentError}}</p>
        <div class="panel-head"><h3>Payment history</h3><button class="text-btn" type="button" (click)="printReceipt(pledge)">Print receipt</button></div>
        <div class="table-wrap" *ngIf="payments.length; else noPayments"><table><thead><tr><th>Date</th><th>Amount</th><th>Interest paid</th><th>Principal paid</th><th>Method</th></tr></thead><tbody><tr *ngFor="let item of payments"><td>{{item.payment_date | date:'d MMM y':'Asia/Kolkata'}}</td><td>{{inr(item.amount)}}</td><td>{{inr(item.interest_paid)}}</td><td>{{inr(item.principal_paid)}}</td><td>{{item.payment_method | titlecase}}</td></tr></tbody></table></div>
        <ng-template #noPayments><p>No payments recorded yet.</p></ng-template>
        <section class="print-receipt">
          <h1>{{workspace?.name || 'Jewellery Business'}}</h1><h2>Girvi Receipt #{{pledge.girvi_number}}</h2>
          <p>Customer: {{customerName(pledge.customer_id)}} · {{customerPhone(pledge.customer_id)}}</p>
          <p>Metal: {{pledge.metal | titlecase}} {{pledge.purity || ''}} · Weight: {{pledge.weight_g}} g</p>
          <p>Original market rate: {{inr(pledge.rate_per_gram)}} / gram · Estimated value: {{inr(pledge.estimated_market_value)}}</p>
          <p>Loan amount: {{inr(pledge.principal_amount)}} · Monthly interest: {{pledge.monthly_interest_percent}}%</p>
          <p>Girvi date: {{pledge.girvi_date}}</p><p>Terms: Interest compounds monthly. Partial months accrue no interest. Pledged jewellery is returned after full settlement.</p>
          <p class="receipt-signature">Customer acknowledgement / signature: ______________________________</p>
        </section>
      </section>

      <section class="panel customer-list">
        <div class="customer-toolbar"><label class="search-field">Search customer, mobile or Girvi number<input [(ngModel)]="search" name="search" (ngModelChange)="filterPledges()" placeholder="Search"></label></div>
        <div class="table-wrap" *ngIf="filteredPledges.length; else noPledges"><table><thead><tr><th>Girvi #</th><th>Customer / mobile</th><th>Metal</th><th>Weight</th><th>Principal</th><th>Interest / month</th><th>Date / months</th><th>Outstanding</th><th>Status</th></tr></thead>
          <tbody><tr *ngFor="let pledge of filteredPledges"><td><button class="text-btn" type="button" (click)="open(pledge)">#{{pledge.girvi_number}}</button></td><td>{{customerName(pledge.customer_id)}}<small>{{customerPhone(pledge.customer_id)}}</small></td><td>{{pledge.metal | titlecase}} {{pledge.purity || ''}}</td><td>{{pledge.weight_g}} g</td><td>{{inr(pledge.principal_amount)}}</td><td>{{pledge.monthly_interest_percent}}%</td><td>{{pledge.girvi_date}} · {{completedMonths(pledge)}} months</td><td>{{inr(currentOutstanding(pledge))}}</td><td>{{pledge.status | titlecase}}</td></tr></tbody></table></div>
        <ng-template #noPledges><div class="empty-state"><b>No Girvi records</b><p>New pledges will appear here.</p></div></ng-template>
      </section>
    </section>
  `,
  styles: [`
    .girvi-payment { margin: 20px 0; padding-top: 16px; border-top: 1px solid #edf0eb; }
    .girvi-payment h3 { margin: 0 0 12px; }
    .girvi-payment p { color: #78867c; font-size: 12px; }
    .quick-customer summary { cursor: pointer; padding: 10px 0; color: #52675a; }
    .activity-row small, td small { display: block; color: #859188; }
    @media (max-width: 700px) { .payment-line { display: grid; grid-template-columns: 1fr; } }
    .print-receipt { display: none; }
    @media print {
      .topbar, .welcome, .customer-toolbar, .customer-list, .girvi-payment, .form-actions, .text-btn, .table-wrap { display: none !important; }
      .print-receipt { display: block; padding: 28px; color: #111; }
      .print-receipt h1, .print-receipt h2 { margin: 0 0 12px; }
      .receipt-signature { margin-top: 70px; }
    }
  `]
})
export class GirviComponent implements OnInit, OnDestroy {
  workspace: BusinessWorkspace | null = null;
  customers: Customer[] = [];
  matchedCustomers: Customer[] = [];
  pledges: Pledge[] = [];
  filteredPledges: Pledge[] = [];
  payments: Payment[] = [];
  selected: Pledge | null = null;
  showCreate = false;
  saving = false;
  rateLoading = false;
  rate: number | null = null;
  estimatedValue = '';
  search = '';
  customerSearch = '';
  error = '';
  formError = '';
  customerError = '';
  paymentError = '';
  success = '';
  paymentAmount = '';
  paymentMethod: PaymentMethod = 'cash';
  paymentDate = this.today();
  readonly interestOptions = [2, 3, 4, 5, 6];
  newCustomer = { name: '', phone: '', address: '' };
  draft = this.emptyDraft();
  private readonly names = new Map<string,string>();
  private readonly phones = new Map<string,string>();
  private subscription?: Subscription;

  constructor(private readonly service: WorkspaceService, private readonly cdr: ChangeDetectorRef) {}

  get canPost(): boolean { return this.workspace?.role === 'owner' || this.workspace?.role === 'admin'; }

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
        client.from('ss_girvi' as any).select('*').eq('business_id',workspace.id).order('created_at',{ascending:false}).limit(1000)
      ]);
      if (customers.error) throw new Error(customers.error.message);
      if (pledges.error) throw new Error(pledges.error.message);
      this.customers = (customers.data ?? []) as Customer[];
      this.names.clear(); this.phones.clear();
      for (const customer of this.customers) {
        this.names.set(customer.id,customer.full_name);
        this.phones.set(customer.id,customer.phone ?? '');
      }
      this.matchedCustomers = this.customers;
      this.pledges = (pledges.data ?? []) as unknown as Pledge[];
      this.filterPledges();
    } catch (error) {
      this.error = error instanceof Error ? error.message : 'Could not load Girvi records.';
    } finally { this.cdr.markForCheck(); }
  }

  filterCustomers(): void {
    const query=this.customerSearch.trim().toLowerCase();
    this.matchedCustomers=this.customers.filter(c=>!query||c.full_name.toLowerCase().includes(query)||(c.phone??'').includes(query));
  }
  filterPledges(): void {
    const query=this.search.trim().toLowerCase();
    this.filteredPledges=this.pledges.filter(p=>!query||String(p.girvi_number).includes(query)||this.customerName(p.customer_id).toLowerCase().includes(query)||this.customerPhone(p.customer_id).includes(query));
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
      this.draft.customerId=customer.id;this.newCustomer={name:'',phone:'',address:''};this.filterCustomers();
    } catch(error) { this.customerError=error instanceof Error?error.message:'Could not register customer.'; }
  }

  async fetchRate(): Promise<void> {
    const client=this.service.client,workspace=this.workspace;
    if(!client||!workspace)return;
    this.rateLoading=true;this.formError='';
    try {
      const result=await client.functions.invoke('market-gold-rate',{body:{businessId:workspace.id,...(this.draft.metal==='gold'?{purity:this.draft.purity}:{metal:'silver'})}});
      if(result.error)throw new Error(result.error.message);
      const quote=result.data as {rate?:number;error?:string;unit?:string}|null;
      if(!quote||quote.error||quote.unit!=='gram'||typeof quote.rate!=='number'||!Number.isFinite(quote.rate)||quote.rate<=0)throw new Error(quote?.error||'The live rate was not a valid per-gram quote.');
      this.rate=quote.rate;this.calculateValue();
    } catch(error) { this.formError=error instanceof Error?error.message:'Could not fetch the live rate.'; }
    finally { this.rateLoading=false;this.cdr.markForCheck(); }
  }

  calculateValue(): void { this.estimatedValue=this.rate&&Number(this.draft.weight)>0?(Number(this.rate)*Number(this.draft.weight)).toFixed(2):''; }
  async create(): Promise<void> {
    const client=this.service.client,workspace=this.workspace;
    if(!client||!workspace||!this.canPost||this.saving)return;
    const rate=this.rate;
    if(rate===null){this.formError='Fetch a current market rate before creating the Girvi record.';return;}
    if(!window.confirm('Create this Girvi record with the saved rate and loan amount?'))return;
    this.saving=true;this.formError='';
    try {
      const result=await client.rpc('ss_girvi_create',{p_business_id:workspace.id,p_customer_id:this.draft.customerId,p_idempotency_key:crypto.randomUUID(),
        p_metal:this.draft.metal,p_purity:this.draft.metal==='gold'?this.draft.purity:null,p_weight_g:this.draft.weight,p_rate_per_gram:rate,
        p_principal:this.draft.principal,p_monthly_interest_percent:this.draft.interestPercent,p_girvi_date:this.draft.date,p_notes:this.draft.notes});
      if(result.error)throw new Error(result.error.message);
      this.success='Girvi record created.';this.showCreate=false;this.draft=this.emptyDraft();this.rate=null;this.estimatedValue='';await this.load();
    } catch(error) { this.formError=error instanceof Error?error.message:'Could not create Girvi.'; }
    finally { this.saving=false;this.cdr.markForCheck(); }
  }

  async open(pledge:Pledge):Promise<void> {
    this.selected=pledge;this.paymentError='';this.payments=[];
    const result=await this.service.client?.from('ss_girvi_payments' as any).select('id,amount,payment_method,interest_paid,principal_paid,payment_date')
      .eq('business_id',this.workspace!.id).eq('girvi_id',pledge.id).order('payment_date',{ascending:false});
    if(result?.error)this.paymentError=result.error.message;
    else this.payments=(result?.data??[]) as unknown as Payment[];
  }

  async recordPayment(pledge:Pledge):Promise<void> {
    const client=this.service.client,workspace=this.workspace;
    if(!client||!workspace||this.saving||!this.canPost)return;
    if(!window.confirm('Record this payment? Payments are allocated to interest first, then principal. A full settlement closes the pledge and returns the jewellery.'))return;
    this.saving=true;this.paymentError='';
    try {
      const result=await client.rpc('ss_girvi_record_payment',{p_business_id:workspace.id,p_girvi_id:pledge.id,p_idempotency_key:crypto.randomUUID(),p_amount:this.paymentAmount,p_method:this.paymentMethod,p_payment_date:this.paymentDate});
      if(result.error)throw new Error(result.error.message);
      this.success='Payment recorded.';this.paymentAmount='';await this.load();
      const updated=this.pledges.find(row=>row.id===pledge.id);if(updated)await this.open(updated);
    } catch(error) { this.paymentError=error instanceof Error?error.message:'Could not record payment.'; }
    finally { this.saving=false;this.cdr.markForCheck(); }
  }

  customerName(id:string):string{return this.names.get(id)??'Customer';}
  customerPhone(id:string):string{return this.phones.get(id)??'';}
  inr(value:string|number):string{return formatInr(String(value),2);}
  completedMonths(p:Pledge):number { return completedMonthlyPeriods(p.girvi_date,p.status==='closed'&&p.closed_at?p.closed_at.slice(0,10):this.today()); }
  currentInterest(p:Pledge):string { return this.growth(p).interest.toFixed(2); }
  currentOutstanding(p:Pledge):string { const g=this.growth(p);return (g.principal+g.interest).toFixed(2); }

  private growth(p:Pledge):{principal:number;interest:number} {
    const balances=girviBalancesAt(p.principal_balance,p.interest_balance,p.monthly_interest_percent,p.last_accrued_months,this.completedMonths(p));
    return {principal:Number(balances.principal),interest:Number(balances.interest)};
  }
  printReceipt(p:Pledge):void { this.selected=p;window.print(); }
  private emptyDraft():{customerId:string;metal:'gold'|'silver';purity:string;weight:string;principal:string;interestPercent:number;date:string;notes:string} {
    return {customerId:'',metal:'gold',purity:'22K',weight:'',principal:'',interestPercent:3,date:this.today(),notes:''};
  }
  private today():string { const date=new Date();return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`; }
}
