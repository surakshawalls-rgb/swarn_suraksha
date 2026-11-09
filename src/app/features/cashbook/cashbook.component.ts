import { CommonModule } from '@angular/common';
import { ChangeDetectorRef, Component, OnDestroy, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { IonicModule } from '@ionic/angular';
import { Subscription } from 'rxjs';
import { formatFixed, formatInr, parseFixed } from '../../core/financial/decimal';
import { BusinessWorkspace, WorkspaceService } from '../dashboard/workspace.service';

type Direction = 'in' | 'out';
interface CashEntry { id: string; payment_id: string; direction: Direction; amount: string; method: string; recorded_at: string; source: 'Purchase payment' | 'Sale payment' | 'Sale refund' | 'Operating expense'; }

@Component({
  standalone: true,
  imports: [CommonModule, FormsModule, IonicModule, RouterLink],
  template: `
    <header class="topbar"><div class="crumb"><a routerLink="/dashboard">Overview</a><span>›</span><b>Cashbook</b></div><div class="top-actions"><button class="text-btn" type="button" (click)="load()" [disabled]="loading">Refresh</button><button class="primary-btn" type="button" (click)="exportPage()" [disabled]="!entries.length">Export current page</button></div></header>
    <section class="content customers-page cashbook-page">
      <div class="welcome"><div><p class="eyebrow">SOURCE-LINKED PAYMENT MOVEMENTS</p><h1>Cashbook</h1><p class="subtitle">Purchase payments, operating expenses, and sale refunds are outflows; customer collections are inflows. Values come from posted transactions.</p></div></div>
      <div class="config-banner"><span class="banner-icon">i</span><div><b>Period net movement is not an account balance</b><p>No opening cash balance, bank accounts, transfers, or reconciliation rules have been configured. Totals below cover this page only; do not treat them as the business's available cash.</p></div></div>
      <div class="config-banner error-banner" *ngIf="errorMessage" role="alert"><span class="banner-icon">!</span><div><b>Cashbook entries could not be loaded</b><p>{{errorMessage}}</p></div><button class="text-btn" type="button" (click)="load()">Retry</button></div>
      <div class="status-card" *ngIf="loading"><span class="spinner"></span><div><b>Loading cashbook entries</b><p>Reading the merged purchase, collection, and refund ledger for this workspace.</p></div></div>
      <section class="panel cashbook-filter">
        <label>From date<input type="date" [(ngModel)]="fromDate" name="cashbookFrom"></label>
        <label>Through date<input type="date" [(ngModel)]="toDate" name="cashbookTo"></label>
        <button class="primary-btn" type="button" (click)="page=0;load()" [disabled]="loading">Apply dates</button>
        <button class="text-btn" type="button" (click)="clearDates()" [disabled]="loading">Clear dates</button>
      </section>
      <section class="cashbook-summary" *ngIf="!loading && !errorMessage">
        <article><span>Page inflows</span><b>{{inr(inflowMinor)}}</b></article>
        <article><span>Page outflows</span><b>{{inr(outflowMinor)}}</b></article>
        <article><span>Page net movement</span><b [class.negative-net]="isNegativeNet()">{{inr(netMinor)}}</b></article>
        <p *ngIf="page > 0 || hasMore">Other matching rows are on different pages. Totals below cover this page only.</p>
        <p *ngIf="page === 0 && !hasMore">Page 1 contains all matching rows, so page totals equal date-range totals.</p>
      </section>
      <section class="panel customer-list cashbook-list" *ngIf="!loading">
        <div class="panel-head"><div><h2>Payment entries</h2><p>{{rowCount}} matching entries · page {{page + 1}}</p></div><span class="page-size-note">{{pageSize}} rows per ledger per page</span></div>
        <div class="table-wrap" *ngIf="entries.length; else emptyCashbook"><table><thead><tr><th>Recorded (IST)</th><th>Source</th><th>Direction</th><th>Method</th><th>Payment ID</th><th>Amount</th></tr></thead><tbody>
          <tr *ngFor="let row of entries"><td>{{row.recorded_at | date:'d MMM y, h:mm a':'Asia/Kolkata'}}</td><td><a [routerLink]="row.source === 'Sale refund' || row.source === 'Sale payment' ? '/dashboard/sales' : row.source === 'Operating expense' ? '/dashboard/expenses' : '/dashboard/purchases'">{{row.source}}</a></td><td><span class="cash-direction" [class.cash-in]="row.direction === 'in'" [class.cash-out]="row.direction === 'out'">{{row.direction === 'in' ? 'Inflow' : 'Outflow'}}</span></td><td>{{row.method | titlecase}}</td><td class="cash-reference">{{row.payment_id}}</td><td [class.cash-in-text]="row.direction === 'in'" [class.cash-out-text]="row.direction === 'out'">{{row.direction === 'in' ? '+' : '−'}}{{inr(row.amount)}}</td></tr>
        </tbody></table></div>
        <ng-template #emptyCashbook><div class="empty-state customer-empty"><span class="empty-art">₹</span><b>No payment entries match these dates</b><p>Entries appear when an authorized user posts a purchase payment or a sale receipt.</p></div></ng-template>
        <div class="list-footer"><span>RLS-scoped source payments</span><div><button class="text-btn" type="button" (click)="previousPage()" [disabled]="page===0 || loading">Previous</button><span>Page {{page + 1}}</span><button class="text-btn" type="button" (click)="nextPage()" [disabled]="!hasMore || loading">Next</button></div></div>
      </section>
    </section>
  `
})
export class CashbookComponent implements OnInit, OnDestroy {
  loading = true; errorMessage = ''; entries: CashEntry[] = []; workspace: BusinessWorkspace | null = null;
  fromDate = ''; toDate = ''; page = 0; readonly pageSize = 200; rowCount = 0; hasMore = false;
  private subscription: Subscription | null = null; private requestId = 0;
  constructor(private readonly workspaceService: WorkspaceService, private readonly cdr: ChangeDetectorRef) {}
  ngOnInit(): void {
    this.subscription = this.workspaceService.activeWorkspace$.subscribe(workspace => {
      if (workspace && workspace.id === this.workspace?.id && workspace.role === this.workspace?.role) return;
      this.workspace = workspace;
      this.entries=[];this.rowCount=0;this.hasMore=false;this.page=0;this.requestId++;
      if (workspace) void this.load(); else { this.loading = false; this.errorMessage = 'Select a business workspace.'; this.cdr.markForCheck(); }
    });
  }
  ngOnDestroy(): void { this.subscription?.unsubscribe(); this.requestId++; }

  async load(): Promise<void> {
    const workspace = this.workspace; const client = this.workspaceService.client;
    if (!workspace || !client) { this.errorMessage = !client ? 'Supabase is not configured.' : 'Select a workspace.'; this.loading = false; this.cdr.markForCheck(); return; }
    if (this.fromDate && this.toDate && this.fromDate > this.toDate) { this.entries=[]; this.rowCount=0; this.hasMore=false; this.errorMessage = 'The start date must be on or before the end date.'; this.loading = false; this.cdr.markForCheck(); return; }
    const requestId = ++this.requestId; this.loading = true; this.errorMessage = '';
    const controller = new AbortController();
    try {
      const fromIso = this.fromDate ? `${this.fromDate}T00:00:00+05:30` : null;
      const toIso = this.toDate ? `${this.toDate}T23:59:59.999+05:30` : null;
      const request=client.rpc('ss_cashbook_page',{p_business_id:workspace.id,p_from:fromIso,p_through:toIso,p_offset:this.page*this.pageSize,p_limit:this.pageSize}).abortSignal(controller.signal);
      const result=await this.withTimeout(request,'Loading merged cashbook page',()=>controller.abort());
      if(result.error)throw new Error(`${result.error.code??'Supabase'}: ${result.error.message}`);
      if (requestId !== this.requestId) return;
      const rows=result.data??[];
      this.entries=rows.map(row=>({id:row.id,payment_id:row.payment_id,direction:row.direction,amount:String(row.amount),method:row.method,recorded_at:row.recorded_at,source:row.source as CashEntry['source']}));
      this.rowCount=Number(rows[0]?.total_count??0);
      this.hasMore=this.rowCount>(this.page+1)*this.pageSize;
    } catch(error) { if(requestId===this.requestId){this.entries=[];this.rowCount=0;this.hasMore=false;this.errorMessage=error instanceof Error?error.message:'Could not load cashbook entries.';} }
    finally { if(requestId===this.requestId){this.loading=false;this.cdr.markForCheck();} }
  }
  get inflowMinor():bigint{return this.entries.filter(e=>e.direction==='in').reduce((sum,e)=>sum+parseFixed(e.amount,2),0n);}
  get outflowMinor():bigint{return this.entries.filter(e=>e.direction==='out').reduce((sum,e)=>sum+parseFixed(e.amount,2),0n);}
  get netMinor():bigint{return this.inflowMinor-this.outflowMinor;}
  isNegativeNet():boolean{return this.netMinor<0n;}
  inr(value:string|bigint):string{return formatInr(typeof value==='bigint'?formatFixed(value,2):value,2);}
  previousPage():void{if(this.page>0){this.page--;void this.load();}}
  nextPage():void{if(this.hasMore){this.page++;void this.load();}}
  clearDates():void{this.fromDate='';this.toDate='';this.page=0;void this.load();}
  exportPage():void{
    if(!this.entries.length)return;
    const columns=['recorded_at_ist','source','direction','method','reference','amount_inr'];
    const safe=(value:string)=>{const raw=String(value);const guarded=/^\s*[=+\-@\t\r]/.test(raw)?`'${raw}`:raw;return `"${guarded.replace(/"/g,'""')}"`;};
    const rows=this.entries.map(row=>[new Intl.DateTimeFormat('en-IN',{dateStyle:'medium',timeStyle:'medium',timeZone:'Asia/Kolkata'}).format(new Date(row.recorded_at)),row.source,row.direction,row.method,row.payment_id,row.amount].map(safe).join(','));
    const blob=new Blob([[columns.map(safe).join(','),...rows].join('\r\n')],{type:'text/csv;charset=utf-8'});
    const url=URL.createObjectURL(blob);const anchor=document.createElement('a');anchor.href=url;anchor.download=`cashbook-page-${this.page+1}.csv`;anchor.click();setTimeout(()=>URL.revokeObjectURL(url),0);
  }
  private async withTimeout<T>(request:PromiseLike<T>,action:string,abort:()=>void):Promise<T>{let timer:ReturnType<typeof setTimeout>|undefined;try{return await Promise.race([Promise.resolve(request),new Promise<T>((_,reject)=>{timer=setTimeout(()=>{abort();reject(new Error(`${action} timed out after 15 seconds. Retry.`));},15000);})]);}finally{if(timer)clearTimeout(timer);}}
}
