import { CommonModule } from '@angular/common';
import { ChangeDetectorRef, Component, OnDestroy, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { IonicModule } from '@ionic/angular';
import { Subscription } from 'rxjs';
import { formatFixed, formatInr, parseFixed } from '../../core/financial/decimal';
import { BusinessWorkspace, WorkspaceService } from '../dashboard/workspace.service';

interface Supplier {
  id: string;
  name: string;
  mobile_number: string | null;
  email: string | null;
  address: string | null;
  notes: string | null;
  is_active: boolean;
  created_at: string;
}
interface SupplierPurchase { id:string; purchase_number:number; subtotal:string; paid_total:string; created_at:string; }
interface SupplierPayment { purchase_id:string; amount:string; method:string; }

@Component({
  standalone: true,
  imports: [CommonModule, FormsModule, IonicModule, RouterLink],
  template: `
    <header class="topbar"><div class="crumb"><a routerLink="/dashboard">Overview</a><span>›</span><b>Suppliers</b></div><div class="top-actions"><button class="primary-btn" type="button" (click)="startCreate()"><span>＋</span> Add supplier</button></div></header>
    <section class="content customers-page">
      <div class="welcome"><div><p class="eyebrow">SUPPLIER DIRECTORY</p><h1>Suppliers</h1><p class="subtitle">Maintain supplier contacts and review their purchase history and balances.</p></div></div>
      <div class="config-banner error-banner" *ngIf="!loading && errorMessage" role="alert"><span class="banner-icon">!</span><div><b>Supplier directory unavailable</b><p>{{errorMessage}}</p></div><button class="text-btn" type="button" (click)="load()">Retry</button></div>
      <div class="status-card" *ngIf="loading"><span class="spinner"></span><div><b>Loading supplier records</b><p>Records are restricted to the selected business by row-level security.</p></div></div>
      <section class="panel customer-editor" *ngIf="editing">
        <div class="panel-head"><div><h2>{{editId ? 'Edit supplier' : 'New supplier'}}</h2><p>Supplier financial records are retained if this profile is archived.</p></div><button class="text-btn" type="button" (click)="cancelEdit()">Cancel</button></div>
        <form class="customer-form" (ngSubmit)="save()">
          <label>Supplier name <input [(ngModel)]="form.name" name="supplierName" required minlength="1" maxlength="160" autocomplete="organization"></label>
          <label>Mobile number <input [(ngModel)]="form.mobile" name="supplierMobile" inputmode="tel" autocomplete="tel"></label>
          <label>Email <input [(ngModel)]="form.email" name="supplierEmail" type="email" autocomplete="email"></label>
          <label>Address <input [(ngModel)]="form.address" name="supplierAddress" maxlength="500"></label>
          <label class="form-notes">Notes <textarea [(ngModel)]="form.notes" name="supplierNotes" maxlength="2000" rows="3"></textarea></label>
          <p class="duplicate-warning" *ngIf="duplicateSupplier" role="status">A supplier with this mobile number already exists: <b>{{duplicateSupplier.name}}</b>. Review it before continuing.</p>
          <p class="form-error" *ngIf="formError" role="alert">{{formError}}</p>
          <div class="form-actions"><button class="primary-btn" type="submit" [disabled]="saving || !form.name.trim()">{{saving ? 'Checking and saving…' : duplicateSupplier ? 'Save as separate supplier' : 'Save supplier'}}</button><button *ngIf="duplicateSupplier" class="text-btn" type="button" (click)="cancelEdit()">Use existing supplier</button></div>
        </form>
      </section>
      <section class="panel customer-editor" *ngIf="statementSupplier">
        <div class="panel-head"><div><h2>Purchase statement · {{statementSupplier.name}}</h2><p>Latest 500 supplier invoices and linked settlements; totals below cover this displayed range.</p></div><div><button class="text-btn" type="button" (click)="exportStatement()" [disabled]="statementLoading || !statementPurchases.length">Export CSV</button><button class="text-btn" type="button" (click)="closeStatement()">Close</button></div></div>
        <div class="status-card" *ngIf="statementLoading"><span class="spinner"></span><div><b>Loading purchase statement</b><p>Reading supplier invoices and linked payments.</p></div></div>
        <div class="config-banner error-banner" *ngIf="!statementLoading && statementError" role="alert"><span class="banner-icon">!</span><div><b>Could not load purchase statement</b><p>{{statementError}}</p></div><button class="text-btn" type="button" (click)="openStatement(statementSupplier)">Retry</button></div>
        <ng-container *ngIf="!statementLoading && !statementError"><div class="purchase-summary"><span>Purchases</span><b>{{statementInvoiced()}}</b><span>Paid</span><b>{{statementPaid()}}</b><span>Balance payable</span><b>{{statementOutstanding()}}</b></div>
          <div class="table-wrap" *ngIf="statementPurchases.length; else noSupplierPurchases"><table><thead><tr><th>Purchase</th><th>Date</th><th>Amount</th><th>Paid</th><th>Balance</th><th>Payment methods</th></tr></thead><tbody><tr *ngFor="let purchase of statementPurchases"><td>#{{purchase.purchase_number}}</td><td>{{purchase.created_at | date:'d MMM y, h:mm a':'Asia/Kolkata'}}</td><td>{{money(purchase.subtotal)}}</td><td>{{money(purchase.paid_total)}}</td><td>{{purchaseBalance(purchase)}}</td><td>{{paymentMethodsFor(purchase.id)}}</td></tr></tbody></table></div>
          <ng-template #noSupplierPurchases><div class="empty-state"><b>No purchases recorded</b><p>Supplier purchases appear here after they are posted.</p></div></ng-template>
        </ng-container>
      </section>      <section class="panel customer-list" *ngIf="!loading">
        <div class="customer-toolbar"><label class="search-field"><span>Search name, mobile or address</span><input [(ngModel)]="search" name="supplierSearch" (ngModelChange)="searchChanged()" placeholder="Search this business"></label><label class="archived-toggle"><input type="checkbox" [(ngModel)]="showArchived" name="includeArchived" (change)="page=0; load()"> Include archived</label></div>
        <div class="table-wrap" *ngIf="suppliers.length; else emptySuppliers">
          <table><thead><tr><th>Supplier</th><th>Mobile</th><th>Email</th><th>Status</th><th><span class="sr-only">Actions</span></th></tr></thead>
            <tbody><tr *ngFor="let supplier of suppliers"><td><b>{{supplier.name}}</b><small>{{supplier.address || 'Address not provided'}}</small></td><td>{{supplier.mobile_number || '—'}}</td><td>{{supplier.email || '—'}}</td><td><span class="customer-status" [class.archived]="!supplier.is_active">{{supplier.is_active ? 'Active' : 'Archived'}}</span></td><td class="row-actions"><button class="text-btn" type="button" (click)="openStatement(supplier)">Statement</button><button class="text-btn" type="button" (click)="editSupplier(supplier)">Edit</button><button *ngIf="supplier.is_active" class="text-btn danger-text" type="button" (click)="archive(supplier)">Archive</button><button *ngIf="!supplier.is_active" class="text-btn" type="button" (click)="restore(supplier)">Restore</button></td></tr></tbody>
          </table>
        </div>
        <ng-template #emptySuppliers><div class="empty-state customer-empty"><span class="empty-art">◉</span><b>{{search ? 'No matching suppliers' : 'No suppliers yet'}}</b><p>{{search ? 'Try another name, mobile number or address.' : 'Add a supplier before recording purchase bills.'}}</p><button *ngIf="!search" class="text-btn" type="button" (click)="startCreate()">Add first supplier <span>→</span></button></div></ng-template>
        <div class="list-footer" *ngIf="suppliers.length"><span>{{suppliers.length}} records shown · scoped by business RLS</span><div><button class="text-btn" type="button" (click)="previousPage()" [disabled]="page === 0">Previous</button><span>Page {{page + 1}}</span><button class="text-btn" type="button" (click)="nextPage()" [disabled]="suppliers.length < pageSize">Next</button></div></div>
      </section>
    </section>
  `
})
export class SuppliersComponent implements OnInit, OnDestroy {
  loading = true;
  saving = false;
  editing = false;
  errorMessage = '';
  formError = '';
  search = '';
  showArchived = false;
  page = 0;
  readonly pageSize = 50;
  suppliers: Supplier[] = [];
  workspace: BusinessWorkspace | null = null;
  editId: string | null = null;
  duplicateSupplier: Supplier | null = null;
  statementSupplier:Supplier|null=null;statementPurchases:SupplierPurchase[]=[];statementPayments=new Map<string,SupplierPayment[]>();statementLoading=false;statementError='';
  form = this.emptyForm();
  private workspaceSubscription: Subscription | null = null;
  private searchTimer: ReturnType<typeof setTimeout> | undefined;
  private loadRequestId=0;

  constructor(private readonly workspaceService: WorkspaceService, private readonly cdr: ChangeDetectorRef) {}

  ngOnInit(): void {
    this.workspaceSubscription = this.workspaceService.activeWorkspace$.subscribe(workspace => {
      if (workspace && workspace.id === this.workspace?.id && workspace.role === this.workspace?.role) return;
      const workspaceChanged=workspace?.id!==this.workspace?.id;
      this.loadRequestId++;
      this.workspace = workspace;
      if(workspaceChanged){this.suppliers=[];this.closeStatement();this.editing=false;this.editId=null;this.form=this.emptyForm();this.page=0;}
      if(workspace)void this.load();
      else{this.loading=false;this.errorMessage='Select a business workspace.';this.cdr.markForCheck();}
    });
  }

  ngOnDestroy(): void { this.workspaceSubscription?.unsubscribe(); this.loadRequestId++; if (this.searchTimer) clearTimeout(this.searchTimer); }

  searchChanged(): void {
    if (this.searchTimer) clearTimeout(this.searchTimer);
    this.page = 0;
    this.searchTimer = setTimeout(() => void this.load(), 250);
  }

  async openStatement(supplier:Supplier):Promise<void>{
    const client=this.workspaceService.client,workspace=this.workspace;
    this.statementSupplier=supplier;this.statementPurchases=[];this.statementPayments.clear();this.statementLoading=true;this.statementError='';
    if(!client||!workspace){this.statementLoading=false;this.statementError='Supabase or the selected workspace is unavailable.';return;}
    this.cdr.markForCheck();
    try{
      const purchasesController=new AbortController();
      const result=await this.withTimeout(client.from('ss_purchases').select('id,purchase_number,subtotal,paid_total,created_at').eq('business_id',workspace.id).eq('supplier_id',supplier.id).order('created_at',{ascending:false}).limit(500).abortSignal(purchasesController.signal),'Loading supplier purchases',()=>purchasesController.abort());
      if(result.error)throw new Error(`${result.error.code??'Supabase'}: ${result.error.message}`);
      const purchases=(result.data??[]) as SupplierPurchase[];const ids=purchases.map(row=>row.id);
      const paymentsController=new AbortController();const paymentsResult=ids.length?await this.withTimeout(client.from('ss_purchase_payments').select('purchase_id,amount,method').eq('business_id',workspace.id).in('purchase_id',ids).abortSignal(paymentsController.signal),'Loading supplier payments',()=>paymentsController.abort()):{data:[],error:null};
      if(paymentsResult.error)throw new Error(`${paymentsResult.error.code??'Supabase'}: ${paymentsResult.error.message}`);
      if(this.statementSupplier?.id===supplier.id && this.workspace?.id===workspace.id){this.statementPurchases=purchases;for(const row of (paymentsResult.data??[]) as SupplierPayment[])this.statementPayments.set(row.purchase_id,[...(this.statementPayments.get(row.purchase_id)??[]),row]);}
    }catch(error){if(this.statementSupplier?.id===supplier.id && this.workspace?.id===workspace.id)this.statementError=error instanceof Error?error.message:'Could not load supplier statement.';}
    finally{if(this.statementSupplier?.id===supplier.id && this.workspace?.id===workspace.id){this.statementLoading=false;this.cdr.markForCheck();}}
  }
  closeStatement():void{this.statementSupplier=null;this.statementPurchases=[];this.statementPayments.clear();this.statementError='';}
  paymentMethodsFor(id:string):string{return(this.statementPayments.get(id)??[]).map(row=>row.method).join(', ')||'Unpaid';}
  money(value:string):string{return formatInr(value,2);}
  purchaseBalance(row:SupplierPurchase):string{return this.money(formatFixed(parseFixed(row.subtotal,2)-parseFixed(row.paid_total,2),2));}
  statementInvoiced():string{return formatInr(formatFixed(this.statementPurchases.reduce((n,row)=>n+parseFixed(row.subtotal,2),0n),2),2);}
  statementPaid():string{return formatInr(formatFixed(this.statementPurchases.reduce((n,row)=>n+parseFixed(row.paid_total,2),0n),2),2);}
  statementOutstanding():string{return formatInr(formatFixed(this.statementPurchases.reduce((n,row)=>n+parseFixed(row.subtotal,2)-parseFixed(row.paid_total,2),0n),2),2);}
  exportStatement():void{
    const supplier=this.statementSupplier;if(!supplier||!this.statementPurchases.length)return;
    const headers=['Purchase','Date (IST)','Amount INR','Paid INR','Balance payable INR','Payment methods'];
    const rows=this.statementPurchases.map(row=>[row.purchase_number,new Intl.DateTimeFormat('en-IN',{dateStyle:'medium',timeStyle:'medium',timeZone:'Asia/Kolkata'}).format(new Date(row.created_at)),row.subtotal,row.paid_total,formatFixed(parseFixed(row.subtotal,2)-parseFixed(row.paid_total,2),2),this.paymentMethodsFor(row.id)]);
    const csv=[headers,...rows].map(row=>row.map(value=>this.csvCell(value)).join(',')).join('\r\n');
    const blob=new Blob(['\uFEFF',csv],{type:'text/csv;charset=utf-8'}),url=URL.createObjectURL(blob),anchor=document.createElement('a');anchor.href=url;anchor.download=`supplier-statement-${supplier.id}.csv`;anchor.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  private csvCell(value:unknown):string{const text=String(value??'');const safe=/^[\s\u0000-\u001f]*[=+\-@]/.test(text)?`'${text}`:text;return `"${safe.replace(/"/g,'""')}"`;}

  async load(): Promise<void> {
    const requestId=++this.loadRequestId;
    const client = this.workspaceService.client;
    if (!client || !this.workspace) {
      this.errorMessage = !client ? 'Supabase is not configured.' : 'Choose a workspace before loading suppliers.';
      this.loading = false;
      this.cdr.markForCheck();
      return;
    }
    this.loading = true;
    this.errorMessage = '';
    try {
      let query = client.from('ss_suppliers').select('id, name, mobile_number, email, address, notes, is_active, created_at')
        .eq('business_id', this.workspace.id).order('name', { ascending: true });
      if (!this.showArchived) query = query.eq('is_active', true) as typeof query;
      const term = this.search.trim().replace(/[^\p{L}\p{N}\s+_-]/gu, ' ').replace(/\s+/g, ' ');
      if (term) query = query.or(`name.ilike.%${term}%,mobile_number.ilike.%${term}%,address.ilike.%${term}%`) as typeof query;
      query = query.range(this.page * this.pageSize, (this.page + 1) * this.pageSize - 1) as typeof query;
      const controller = new AbortController();
      const result = await this.withTimeout(query.abortSignal(controller.signal), 'Loading suppliers', () => controller.abort());
      if (result.error) throw new Error(`${result.error.code ?? 'Supabase'}: ${result.error.message}`);
      if(requestId!==this.loadRequestId)return;
      this.suppliers = (result.data ?? []) as Supplier[];
    } catch (error) {
      if(requestId===this.loadRequestId)this.errorMessage = error instanceof Error ? error.message : 'Could not load suppliers.';
    } finally {
      if(requestId===this.loadRequestId){this.loading = false;this.cdr.markForCheck();}
    }
  }

  startCreate(): void { this.editing = true; this.editId = null; this.form = this.emptyForm(); this.formError = ''; this.duplicateSupplier = null; }
  editSupplier(row: Supplier): void {
    this.editing = true;
    this.editId = row.id;
    this.form = { name: row.name, mobile: row.mobile_number ?? '', email: row.email ?? '', address: row.address ?? '', notes: row.notes ?? '' };
    this.formError = '';
    this.duplicateSupplier = null;
  }
  cancelEdit(): void { this.editing = false; this.duplicateSupplier = null; this.formError = ''; }

  async save(): Promise<void> {
    if (!this.workspace || this.saving || !this.form.name.trim()) return;
    this.saving = true;
    this.formError = '';
    const mobile = this.normalizeMobile(this.form.mobile);
    try {
      if (mobile && !this.duplicateSupplier) {
        const client = this.workspaceService.client;
        if (!client) throw new Error('Supabase is not configured.');
        const matches: Supplier[] = [];
        for (let offset = 0; ; offset += 500) {
          const request = client.from('ss_suppliers').select('id, name, mobile_number, email, address, notes, is_active, created_at')
            .eq('business_id', this.workspace.id).eq('is_active', true).range(offset, offset + 499);
          const controller = new AbortController();
          const result = await this.withTimeout(request.abortSignal(controller.signal), 'Checking duplicate suppliers', () => controller.abort());
          if (result.error) throw result.error;
          const rows = (result.data ?? []) as Supplier[];
          matches.push(...rows);
          if (rows.length < 500) break;
        }
        this.duplicateSupplier = matches.find(row => row.id !== this.editId && this.normalizeMobile(row.mobile_number ?? '') === mobile) ?? null;
        if (this.duplicateSupplier) return;
      }
      await this.persist(mobile);
    } catch (error) {
      this.formError = error instanceof Error ? error.message : 'Could not save supplier.';
    } finally {
      this.saving = false;
      this.cdr.markForCheck();
    }
  }

  private async persist(mobile: string | null): Promise<void> {
    const client = this.workspaceService.client;
    if (!client || !this.workspace) throw new Error('The selected workspace is unavailable.');
    const values = { name: this.form.name.trim(), mobile_number: mobile, email: this.form.email.trim() || null, address: this.form.address.trim() || null, notes: this.form.notes.trim() || null };
    const controller = new AbortController();
    const request = this.editId
      ? client.from('ss_suppliers').update(values).eq('id', this.editId).eq('business_id', this.workspace.id).abortSignal(controller.signal).select('id').maybeSingle()
      : client.from('ss_suppliers').insert({ ...values, business_id: this.workspace.id }).abortSignal(controller.signal).select('id').single();
    const result = await this.withTimeout(request, 'Saving supplier', () => controller.abort());
    if (result.error) throw new Error(`${result.error.code ?? 'Supabase'}: ${result.error.message}`);
    if (!result.data) throw new Error('No supplier record changed. Refresh and verify workspace access.');
    this.editing = false;
    this.duplicateSupplier = null;
    await this.load();
  }

  async archive(row: Supplier): Promise<void> { await this.setActive(row, false); }
  async restore(row: Supplier): Promise<void> { await this.setActive(row, true); }
  private async setActive(row: Supplier, is_active: boolean): Promise<void> {
    const client = this.workspaceService.client;
    if (!client || !this.workspace) return;
    if (!window.confirm(`${is_active ? 'Restore' : 'Archive'} ${row.name}? Existing purchase history is preserved.`)) return;
    try {
      const controller = new AbortController();
      const request = client.from('ss_suppliers').update({ is_active }).eq('id', row.id).eq('business_id', this.workspace.id)
        .abortSignal(controller.signal).select('id').maybeSingle();
      const result = await this.withTimeout(request, 'Updating supplier status', () => controller.abort());
      if (result.error) throw result.error;
      if (!result.data) throw new Error('No supplier record changed. Refresh and verify workspace access.');
      await this.load();
    } catch (error) {
      this.errorMessage = error instanceof Error ? error.message : 'Could not update supplier status.';
      this.cdr.markForCheck();
    }
  }

  previousPage(): void { if (this.page > 0) { this.page--; void this.load(); } }
  nextPage(): void { if (this.suppliers.length === this.pageSize) { this.page++; void this.load(); } }
  private normalizeMobile(value: string): string | null { return value.replace(/\D/g, '') || null; }
  private emptyForm() { return { name: '', mobile: '', email: '', address: '', notes: '' }; }

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
    } finally { if (timer) clearTimeout(timer); }
  }
}
