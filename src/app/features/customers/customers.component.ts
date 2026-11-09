import { CommonModule } from '@angular/common';
import { ChangeDetectorRef, Component, OnDestroy, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { IonicModule } from '@ionic/angular';
import { RouterLink } from '@angular/router';
import { Subscription } from 'rxjs';
import { formatInr } from '../../core/financial/decimal';
import { CustomerLedgerPageAmounts, validateCustomerLedgerPage } from '../../core/financial/customer-statement';
import { BusinessWorkspace, WorkspaceService } from '../dashboard/workspace.service';

interface Customer {
  id: string;
  customer_code: string | null;
  full_name: string;
  phone: string | null;
  email: string | null;
  address: Record<string, unknown>;
  notes: string | null;
  status: string;
  created_at: string;
}
interface CustomerLedgerEntry { event_id:string;event_type:string;description:string;entity_id:string;happened_at:string;debit:string;credit:string;payment_method:string|null;running_balance:string; }
interface StatementPage extends CustomerLedgerPageAmounts { rows:CustomerLedgerEntry[]; }

@Component({
  standalone: true,
  imports: [CommonModule, FormsModule, IonicModule, RouterLink],
  template: `
    <header class="topbar"><div class="crumb"><a routerLink="/dashboard">Overview</a><span>›</span><b>Customers</b></div><div class="top-actions"><button class="primary-btn" type="button" (click)="startCreate()"><span>＋</span> Add customer</button></div></header>
    <section class="content customers-page">
      <div class="welcome"><div><p class="eyebrow">CUSTOMER KHATA</p><h1>Customers</h1><p class="subtitle">Search and maintain customer profiles. Financial history will appear as transactions are recorded.</p></div></div>
      <div class="status-card" *ngIf="loading"><span class="spinner"></span><div><b>Loading customer records</b><p>Only records permitted for the selected business are requested.</p></div></div>
      <div class="config-banner error-banner" *ngIf="!loading && errorMessage" role="alert"><span class="banner-icon">!</span><div><b>Could not load customers</b><p>{{errorMessage}}</p></div><button class="text-btn" type="button" (click)="load()">Retry</button></div>

      <section class="panel customer-editor" *ngIf="editing">
        <div class="panel-head"><div><h2>{{editId ? 'Edit customer profile' : 'New customer'}}</h2><p>Existing financial records are retained when a profile is archived.</p></div><button class="text-btn" type="button" (click)="cancelEdit()">Cancel</button></div>
        <form class="customer-form" (ngSubmit)="saveCustomer()">
          <label>Full name <input [(ngModel)]="form.name" name="customerName" required minlength="1" maxlength="160" autocomplete="name"></label>
          <label>Mobile number <input [(ngModel)]="form.mobile" name="customerMobile" inputmode="tel" autocomplete="tel"></label>
          <label>Email <input [(ngModel)]="form.email" name="customerEmail" type="email" autocomplete="email"></label>
          <label>Address or village <input [(ngModel)]="form.address" name="customerAddress" maxlength="500" autocomplete="street-address"></label>
          <label class="form-notes">Notes <textarea [(ngModel)]="form.notes" name="customerNotes" maxlength="2000" rows="3"></textarea></label>
          <p class="duplicate-warning" *ngIf="duplicateCustomer" role="status">A customer with this mobile number already exists: <b>{{duplicateCustomer.full_name}}</b> (ID {{duplicateCustomer.customer_code}}). Check the existing profile before continuing.</p>
          <p class="form-error" *ngIf="formError" role="alert">{{formError}}</p>
          <div class="form-actions"><button class="primary-btn" type="submit" [disabled]="saving || !form.name.trim()">{{saving ? 'Checking and saving…' : duplicateCustomer ? 'Save as separate customer' : 'Save customer'}}</button><button *ngIf="duplicateCustomer" class="text-btn" type="button" (click)="cancelEdit()">Use existing customer</button></div>
        </form>
      </section>

      <section class="panel customer-editor" *ngIf="statementCustomer">
        <div class="panel-head"><div><h2>Statement · {{statementCustomer.full_name}}</h2><p>Chronological account activity. Positive balance is due; a negative balance is a customer credit. Date filters use Asia/Kolkata transaction dates.</p></div><div><button class="text-btn" type="button" (click)="printStatement()" [disabled]="statementLoading || !statementTotals">Print</button><button class="text-btn" type="button" (click)="exportStatement()" [disabled]="statementLoading || !statementTotals">Export statement CSV</button><button class="text-btn" type="button" (click)="closeStatement()">Close</button></div></div>
        <div class="status-card" *ngIf="statementLoading"><span class="spinner"></span><div><b>Loading statement</b><p>Reading customer invoices, payments, returns, and refunds.</p></div></div>
        <div class="config-banner error-banner" *ngIf="!statementLoading && statementError" role="alert"><span class="banner-icon">!</span><div><b>Could not load statement</b><p>{{statementError}}</p></div><button class="text-btn" type="button" (click)="openStatement(statementCustomer)">Retry</button></div>
        <p class="form-error" *ngIf="statementActionError" role="alert">{{statementActionError}}</p>
        <ng-container *ngIf="!statementLoading && !statementError && statementTotals"><div class="panel cashbook-filter"><label>From date<input type="date" [(ngModel)]="statementFrom" name="statementFrom"></label><label>Through date<input type="date" [(ngModel)]="statementThrough" name="statementThrough"></label><button class="primary-btn" type="button" (click)="statementPage=0;openStatement(statementCustomer)" [disabled]="statementLoading">Apply range</button><button class="text-btn" type="button" (click)="statementFrom='';statementThrough='';statementPage=0;openStatement(statementCustomer)">All dates</button></div>
          <div class="purchase-summary"><span>Opening balance</span><b>{{statementMoney(statementTotals.opening_balance)}}</b><span>Debits</span><b>{{statementMoney(statementTotals.debits)}}</b><span>Credits</span><b>{{statementMoney(statementTotals.credits)}}</b><span>Closing balance</span><b>{{statementMoney(statementTotals.closing_balance)}}</b></div>
          <div class="table-wrap" *ngIf="statementSales.length; else noCustomerSales"><table><thead><tr><th>Date (IST)</th><th>Transaction</th><th>Method</th><th>Debit</th><th>Credit</th><th>Running balance</th></tr></thead><tbody><tr *ngFor="let row of statementSales"><td>{{row.happened_at | date:'d MMM y, h:mm a':'Asia/Kolkata'}}</td><td>{{row.description}}</td><td>{{row.payment_method || '—' | titlecase}}</td><td>{{statementMoney(row.debit)}}</td><td>{{statementMoney(row.credit)}}</td><td>{{statementMoney(row.running_balance)}}</td></tr></tbody></table></div>
          <ng-template #noCustomerSales><div class="empty-state"><b>No account activity in this date range</b><p>Customer invoices, receipts, returns, and refunds appear here when posted.</p></div></ng-template>
          <div class="list-footer"><span>{{statementTotalCount}} matching transactions · page {{statementPage+1}} · customer due is positive</span><div><button class="text-btn" type="button" (click)="previousStatementPage()" [disabled]="statementPage===0 || statementLoading">Previous</button><span>Page {{statementPage+1}}</span><button class="text-btn" type="button" (click)="nextStatementPage()" [disabled]="statementSales.length < statementPageSize || statementLoading">Next</button></div></div>
        </ng-container>
      </section>

      <section class="panel customer-list" *ngIf="!loading">
          <div class="customer-toolbar"><label class="search-field"><span>Search customer ID, name, mobile or address</span><input [(ngModel)]="search" name="customerSearch" (ngModelChange)="searchChanged()" placeholder="Search this business"></label><label class="archived-toggle"><input type="checkbox" [(ngModel)]="showArchived" name="showArchived" (change)="page=0; load()"> Include archived</label></div>
        <div class="table-wrap" *ngIf="filteredCustomers.length; else emptyCustomers">
          <table><thead><tr><th>Customer</th><th>Mobile</th><th>Address</th><th>Status</th><th><span class="sr-only">Actions</span></th></tr></thead>
            <tbody><tr *ngFor="let customer of filteredCustomers"><td><b>{{customer.full_name}}</b><small>Customer #{{customer.customer_code}}</small></td><td>{{customer.phone || '—'}}</td><td>{{formatAddress(customer.address) || '—'}}</td><td><span class="customer-status" [class.archived]="customer.status !== 'active'">{{customer.status === 'active' ? 'Active' : 'Archived'}}</span></td><td class="row-actions"><button class="text-btn" type="button" (click)="openStatement(customer)">Statement</button><button class="text-btn" type="button" (click)="editCustomer(customer)">Edit</button><button *ngIf="customer.status === 'active'" class="text-btn danger-text" type="button" (click)="archiveCustomer(customer)">Archive</button><button *ngIf="customer.status !== 'active'" class="text-btn" type="button" (click)="restoreCustomer(customer)">Restore</button></td></tr></tbody>
          </table>
        </div>
        <ng-template #emptyCustomers><div class="empty-state customer-empty"><span class="empty-art">◎</span><b>{{search ? 'No matching customers' : showArchived ? 'No customer records found' : 'No active customers yet'}}</b><p>{{search ? 'Try another customer ID, name, mobile number, or address.' : 'Create a customer profile to begin. Sales and pledge history will remain linked to this customer.'}}</p><button *ngIf="!search && !showArchived" class="text-btn" type="button" (click)="startCreate()">Add the first customer <span>→</span></button></div></ng-template>
        <div class="list-footer" *ngIf="customers.length"><span>{{filteredCustomers.length}} shown · records are scoped by business RLS</span><div><button class="text-btn" type="button" (click)="previousPage()" [disabled]="page === 0">Previous</button><span>Page {{page + 1}}</span><button class="text-btn" type="button" (click)="nextPage()" [disabled]="customers.length < pageSize">Next</button></div></div>
      </section>
    </section>
  `
})
export class CustomersComponent implements OnInit, OnDestroy {
  loading = true;
  saving = false;
  editing = false;
  errorMessage = '';
  formError = '';
  search = '';
  showArchived = false;
  page = 0;
  readonly pageSize = 50;
  customers: Customer[] = [];
  workspace: BusinessWorkspace | null = null;
  editId: string | null = null;
  duplicateCustomer: Customer | null = null;
  statementCustomer: Customer | null = null;
  statementSales: CustomerLedgerEntry[] = [];
  statementTotals: StatementPage['totals'] | null = null;
  statementPageOpeningBalance='0.00';
  statementTotalCount=0;statementPage=0;readonly statementPageSize=100;statementFrom='';statementThrough='';statementActionError='';
  statementLoading = false;
  statementError = '';
  form: { name: string; mobile: string; email: string; address: string; notes: string } = this.emptyForm();
  private workspaceSubscription: Subscription | null = null;
  private searchTimer: ReturnType<typeof setTimeout> | undefined;
  private loadRequestId=0;
  private statementRequestId=0;

  constructor(private readonly workspaceService: WorkspaceService, private readonly cdr: ChangeDetectorRef) {}

  get filteredCustomers(): Customer[] {
    return this.customers;
  }

  ngOnInit(): void {
    this.workspaceSubscription = this.workspaceService.activeWorkspace$.subscribe(workspace => {
      if (workspace && workspace.id === this.workspace?.id && workspace.role === this.workspace?.role) return;
      const workspaceChanged = workspace?.id !== this.workspace?.id;
      this.loadRequestId++;
      this.workspace = workspace;
      if (workspaceChanged) {
        this.customers = []; this.closeStatement(); this.editing = false; this.editId = null; this.form = this.emptyForm();
        this.page = 0;
      }
      if (workspace) void this.load();
      else { this.loading = false; this.errorMessage = 'Select a business workspace.'; this.cdr.markForCheck(); }
    });
  }

  ngOnDestroy(): void { this.workspaceSubscription?.unsubscribe(); this.loadRequestId++; if (this.searchTimer) clearTimeout(this.searchTimer); }

  searchChanged(): void {
    if (this.searchTimer) clearTimeout(this.searchTimer);
    this.page = 0;
    this.searchTimer = setTimeout(() => void this.load(), 250);
  }

  async load(): Promise<void> {
    const requestId=++this.loadRequestId;
    if (!this.workspace) {
      this.errorMessage = 'Choose a business workspace before loading customer records.';
      this.loading = false;
      this.cdr.markForCheck();
      return;
    }
    const client = this.workspaceService.client;
    if (!client) {
      this.errorMessage = 'Supabase is not configured.';
      this.loading = false;
      this.cdr.markForCheck();
      return;
    }
    this.loading = true;
    this.errorMessage = '';
    try {
      let query = client.from('customers')
        .select('id, customer_code, full_name, phone, email, address, notes, status, created_at')
        .eq('business_id', this.workspace.id)
        .order('created_at', { ascending: false });
      if (!this.showArchived) query = query.eq('status', 'active') as typeof query;
      const term = this.search.trim().replace(/[^\p{L}\p{N}\s+_-]/gu, ' ').replace(/\s+/g, ' ');
      if (term) {
        const filters = [`full_name.ilike.%${term}%`, `phone.ilike.%${term}%`, `address->>line1.ilike.%${term}%`, `address->>village.ilike.%${term}%`];
        if (/^\d+$/.test(term)) filters.unshift(`customer_code.eq.${term}`);
        query = query.or(filters.join(',')) as typeof query;
      }
      query = query.range(this.page * this.pageSize, (this.page + 1) * this.pageSize - 1) as typeof query;
      const controller = new AbortController();
      const result = await this.withTimeout(query.abortSignal(controller.signal), 'Loading customer records', () => controller.abort());
      if (result.error) throw new Error(`${result.error.code ?? 'Supabase'}: ${result.error.message}`);
      if(requestId!==this.loadRequestId)return;
      this.customers = (result.data ?? []) as Customer[];
    } catch (error) {
      if(requestId===this.loadRequestId)this.errorMessage = error instanceof Error ? error.message : 'Could not load customer records.';
    } finally {
      if(requestId===this.loadRequestId){this.loading = false;this.cdr.markForCheck();}
    }
  }

  startCreate(): void { this.editing = true; this.editId = null; this.form = this.emptyForm(); this.formError = ''; this.duplicateCustomer = null; }

  async openStatement(customer: Customer): Promise<void> {
    const client=this.workspaceService.client;const workspace=this.workspace;
    if(this.statementCustomer?.id!==customer.id){this.statementFrom='';this.statementThrough='';this.statementPage=0;}
    const requestId=++this.statementRequestId;
    this.statementCustomer=customer;this.statementLoading=true;this.statementError='';this.statementActionError='';this.statementSales=[];this.statementTotals=null;this.statementTotalCount=0;
    if(!client||!workspace){this.statementLoading=false;this.statementError='Supabase or the selected workspace is unavailable.';return;}
    if(this.statementFrom&&this.statementThrough&&this.statementFrom>this.statementThrough){this.statementLoading=false;this.statementError='The start date must be on or before the end date.';this.cdr.markForCheck();return;}
    this.cdr.markForCheck();
    try{
      const controller=new AbortController();
      const result=await this.withTimeout(client.rpc('ss_customer_ledger_page',{p_business_id:workspace.id,p_customer_id:customer.id,p_from:this.statementFrom||null,p_through:this.statementThrough||null,p_offset:this.statementPage*this.statementPageSize,p_limit:this.statementPageSize}).abortSignal(controller.signal),'Loading customer statement',()=>controller.abort());
      if(result.error)throw new Error(`${result.error.code??'Supabase'}: ${result.error.message}`);
      const page=result.data as unknown as StatementPage;
      if(!page||!page.totals||!Array.isArray(page.rows))throw new Error('The statement RPC returned an invalid response.');
      validateCustomerLedgerPage(page);
      if(requestId===this.statementRequestId&&this.statementCustomer?.id===customer.id&&this.workspace?.id===workspace.id){this.statementSales=page.rows;this.statementTotals=page.totals;this.statementPageOpeningBalance=page.page_opening_balance;this.statementTotalCount=Number(page.total_count);}
    }catch(error){if(requestId===this.statementRequestId&&this.statementCustomer?.id===customer.id&&this.workspace?.id===workspace.id)this.statementError=error instanceof Error?error.message:'Could not load statement.';}
    finally{if(requestId===this.statementRequestId&&this.statementCustomer?.id===customer.id&&this.workspace?.id===workspace.id){this.statementLoading=false;this.cdr.markForCheck();}}
  }
  closeStatement():void{this.statementRequestId++;this.statementCustomer=null;this.statementSales=[];this.statementTotals=null;this.statementPageOpeningBalance='0.00';this.statementTotalCount=0;this.statementError='';this.statementActionError='';}
  statementMoney(value:string):string{return formatInr(value,2);}
  previousStatementPage():void{if(this.statementPage>0){this.statementPage--;if(this.statementCustomer)void this.openStatement(this.statementCustomer);}}
  nextStatementPage():void{if((this.statementPage+1)*this.statementPageSize<this.statementTotalCount){this.statementPage++;if(this.statementCustomer)void this.openStatement(this.statementCustomer);}}
  exportStatement():void{
    const customer=this.statementCustomer,totals=this.statementTotals;if(!customer||!totals)return;
    const headers=['Date (IST)','Transaction','Reference','Payment method','Debit INR','Credit INR','Running balance INR'];
    const rows=this.statementSales.map(row=>[new Intl.DateTimeFormat('en-IN',{dateStyle:'medium',timeStyle:'medium',timeZone:'Asia/Kolkata'}).format(new Date(row.happened_at)),row.description,row.entity_id,row.payment_method??'',row.debit,row.credit,row.running_balance]);
    const summary=[['Opening balance',totals.opening_balance],['Total debits',totals.debits],['Total credits',totals.credits],['Closing balance',totals.closing_balance],['Page opening balance',this.statementPageOpeningBalance]];
    const csv=[...summary.map(row=>[row[0],row[1]]),[],headers,...rows].map(row=>row.map(value=>this.csvCell(value)).join(',')).join('\r\n');
    const blob=new Blob(['\uFEFF',csv],{type:'text/csv;charset=utf-8'}),url=URL.createObjectURL(blob),anchor=document.createElement('a');anchor.href=url;anchor.download=`customer-ledger-page-${this.statementPage+1}-${customer.customer_code}.csv`;anchor.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  printStatement():void{
    const customer=this.statementCustomer,totals=this.statementTotals;if(!customer||!totals)return;
    const target=window.open('','_blank');if(!target){this.statementActionError='The print window was blocked. Allow pop-ups for this site and retry.';return;}
    const doc=target.document;doc.title=`Customer statement ${customer.customer_code}`;
    const style=doc.createElement('style');style.textContent='body{font:14px Arial,sans-serif;color:#202124;margin:28px}h1{margin:0 0 6px;color:#8f6b25}p{margin:4px 0}.summary{display:flex;gap:20px;flex-wrap:wrap;margin:22px 0;padding:14px;background:#faf8f2}.summary b{display:block;margin-top:5px}table{width:100%;border-collapse:collapse;margin-top:18px}th,td{border-bottom:1px solid #d8d8d8;padding:8px;text-align:left}th{background:#f5f2eb}.small{font-size:11px;color:#666;margin-top:20px}@media print{body{margin:12mm}}';doc.head.replaceChildren(style);
    const heading=doc.createElement('h1');heading.textContent='SwarnaSuraksha · Customer statement';doc.body.append(heading);
    const detail=doc.createElement('p');detail.textContent=`${customer.full_name} · Customer #${customer.customer_code}`;doc.body.append(detail);
    if(customer.phone){const mobile=doc.createElement('p');mobile.textContent=`Mobile: ${customer.phone}`;doc.body.append(mobile);}
    if(customer.address){const address=doc.createElement('p');address.textContent=`Address: ${customer.address['line1'] || customer.address['village'] || String(customer.address)}`;doc.body.append(address);}
    const period=doc.createElement('p');period.textContent=`Transaction date range: ${this.statementFrom||'No start date'} to ${this.statementThrough||'No end date'} · Generated ${new Intl.DateTimeFormat('en-IN',{dateStyle:'medium',timeStyle:'short',timeZone:'Asia/Kolkata'}).format(new Date())}`;doc.body.append(period);
    const summary=doc.createElement('div');summary.className='summary';for(const [label,value] of [['Opening balance',totals.opening_balance],['Debits',totals.debits],['Credits',totals.credits],['Closing balance',totals.closing_balance]]){const block=doc.createElement('div'),name=doc.createElement('span'),amount=doc.createElement('b');name.textContent=label;amount.textContent=this.statementMoney(value);block.append(name,amount);summary.append(block);}doc.body.append(summary);
    const table=doc.createElement('table'),thead=doc.createElement('thead'),headRow=doc.createElement('tr');for(const label of ['Date (IST)','Transaction','Method','Debit','Credit','Running balance']){const th=doc.createElement('th');th.textContent=label;headRow.append(th);}thead.append(headRow);table.append(thead);const tbody=doc.createElement('tbody');
    for(const item of this.statementSales){const row=doc.createElement('tr'),values=[new Intl.DateTimeFormat('en-IN',{dateStyle:'medium',timeStyle:'short',timeZone:'Asia/Kolkata'}).format(new Date(item.happened_at)),item.description,item.payment_method??'—',this.statementMoney(item.debit),this.statementMoney(item.credit),this.statementMoney(item.running_balance)];for(const value of values){const cell=doc.createElement('td');cell.textContent=value;row.append(cell);}tbody.append(row);}table.append(tbody);doc.body.append(table);
    const note=doc.createElement('p');note.className='small';note.textContent=`Showing ${this.statementSales.length} transaction rows on page ${this.statementPage+1} of ${this.statementTotalCount}. The opening balance before this page is ${this.statementMoney(this.statementPageOpeningBalance)}. Positive closing balance means amount due; negative means customer credit.`;doc.body.append(note);
    target.focus();target.onafterprint=()=>target.close();setTimeout(()=>target.print(),250);
  }
  private csvCell(value:unknown):string{const text=String(value??'');const safe=/^[\s\u0000-\u001f]*[=+\-@]/.test(text)?`'${text}`:text;return `"${safe.replace(/"/g,'""')}"`;}

  editCustomer(customer: Customer): void {
    this.editing = true;
    this.editId = customer.id;
    const formattedAddress = this.formatAddress(customer.address);
    this.form = { name: customer.full_name, mobile: customer.phone ?? '', email: customer.email ?? '', address: formattedAddress, notes: customer.notes ?? '' };
    this.formError = '';
    this.duplicateCustomer = null;
  }

  cancelEdit(): void { this.editing = false; this.duplicateCustomer = null; this.formError = ''; }

  async saveCustomer(): Promise<void> {
    if (!this.workspace || this.saving || !this.form.name.trim()) return;
    this.saving = true;
    this.formError = '';
    const mobile = this.normalizeMobile(this.form.mobile);
    if (mobile && !this.duplicateCustomer) {
      try {
        const client = this.workspaceService.client;
        if (!client) throw new Error('Supabase is not configured.');
        const candidates: Customer[] = [];
        for (let offset = 0; ; offset += 500) {
          const request = client.from('customers').select('id, customer_code, full_name, phone, email, address, notes, status, created_at')
            .eq('business_id', this.workspace.id).eq('status', 'active').range(offset, offset + 499);
          const controller = new AbortController();
          const { data, error } = await this.withTimeout(request.abortSignal(controller.signal), 'Checking for duplicate customers', () => controller.abort());
          if (error) throw error;
          const page = (data ?? []) as Customer[];
          candidates.push(...page);
          if (page.length < 500) break;
        }
        this.duplicateCustomer = candidates.find(customer => customer.id !== this.editId && this.normalizeMobile(customer.phone ?? '') === mobile) ?? null;
        if (this.duplicateCustomer) return;
      } catch (error) {
        this.formError = error instanceof Error ? error.message : 'Could not check for a duplicate customer.';
        return;
      } finally {
        this.saving = false;
        this.cdr.markForCheck();
      }
    }
    await this.persistCustomer(mobile);
  }

  private async persistCustomer(mobile: string | null): Promise<void> {
    const client = this.workspaceService.client;
    if (!client || !this.workspace) return;
    this.saving = true;
    this.formError = '';
    const addressObj = this.form.address.trim() ? { line1: this.form.address.trim() } : {};
    const values = {
      full_name: this.form.name.trim(),
      phone: mobile,
      email: this.form.email.trim() || null,
      address: addressObj,
      notes: this.form.notes.trim() || null
    };
    try {
      const controller = new AbortController();
      const request = this.editId
        ? client.from('customers').update(values).eq('id', this.editId).eq('business_id', this.workspace.id).abortSignal(controller.signal).select('id').maybeSingle()
        : client.from('customers').insert({ ...values, business_id: this.workspace.id }).abortSignal(controller.signal).select('id').single();
      const result = await this.withTimeout(request, 'Saving customer profile', () => controller.abort());
      if (result.error) throw new Error(`${result.error.code ?? 'Supabase'}: ${result.error.message}`);
      if (!result.data) throw new Error('No customer record was changed. Refresh the list and confirm you still have access to this business.');
      this.editing = false;
      this.duplicateCustomer = null;
      await this.load();
    } catch (error) {
      this.formError = error instanceof Error ? error.message : 'Could not save this customer.';
    } finally {
      this.saving = false;
      this.cdr.markForCheck();
    }
  }

  async archiveCustomer(customer: Customer): Promise<void> { await this.setArchived(customer, 'archived'); }
  async restoreCustomer(customer: Customer): Promise<void> { await this.setArchived(customer, 'active'); }

  private async setArchived(customer: Customer, status: string): Promise<void> {
    const client = this.workspaceService.client;
    if (!client || !this.workspace) return;
    if (!window.confirm(`${status === 'active' ? 'Restore' : 'Archive'} ${customer.full_name}? Financial history will be preserved.`)) return;
    try {
      const controller = new AbortController();
      const request = client.from('customers').update({ status }).eq('id', customer.id).eq('business_id', this.workspace.id).abortSignal(controller.signal).select('id').maybeSingle();
      const { data, error } = await this.withTimeout(request, 'Updating customer status', () => controller.abort());
      if (error) throw error;
      if (!data) throw new Error('No customer record was changed. Refresh the list and confirm you still have access to this business.');
      await this.load();
    } catch (error) {
      this.errorMessage = error instanceof Error ? error.message : 'Could not update customer status.';
      this.cdr.markForCheck();
    }
  }

  previousPage(): void { if (this.page > 0) { this.page--; void this.load(); } }
  nextPage(): void { if (this.customers.length === this.pageSize) { this.page++; void this.load(); } }

  private normalizeMobile(value: string): string | null {
    const digits = value.replace(/\D/g, '');
    return digits || null;
  }

  private async withTimeout<T>(request: PromiseLike<T>, action: string, abort: () => void): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        Promise.resolve(request),
        new Promise<T>((_, reject) => {
          timer = setTimeout(() => {
            reject(new Error(`${action} timed out after 15 seconds. Check your connection and retry.`));
            abort();
          }, 15000);
        })
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  formatAddress(address: Record<string, unknown>): string {
    return Object.values(address)
      .filter((value): value is string => typeof value === 'string')
      .join(', ');
  }

  private emptyForm(): { name: string; mobile: string; email: string; address: string; notes: string } { return { name: '', mobile: '', email: '', address: '', notes: '' }; }
}
