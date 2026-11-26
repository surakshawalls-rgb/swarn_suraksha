import { CommonModule } from '@angular/common';
import { ChangeDetectorRef, Component, OnDestroy, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { IonicModule } from '@ionic/angular';
import { Subscription } from 'rxjs';
import { formatInr } from '../../core/financial/decimal';
import { BusinessWorkspace, WorkspaceService } from '../dashboard/workspace.service';

interface ReportRow {
  report_day: string; sales_total: number|string; returns_total:number|string; purchases_total: number|string; expenses_paid:number|string;
  cash_received: number|string; cash_refunded:number|string; cash_paid: number|string;
  gold_weight_change_g: number|string; silver_weight_change_g: number|string; other_weight_change_g: number|string;
  sales_count: number; returns_count:number; purchases_count: number; expenses_count:number;
}

@Component({
  standalone: true,
  imports: [CommonModule, FormsModule, IonicModule, RouterLink],
  template: `
      <header class="topbar"><div class="crumb"><a routerLink="/dashboard">Overview</a><span>›</span><b>Reports</b></div><div class="top-actions"><button class="text-btn" type="button" (click)="load()" [disabled]="loading || !canView">Refresh</button><button class="primary-btn" type="button" (click)="exportCsv()" [disabled]="!canExport || exporting || !canView">{{exporting?'Recording export…':'Export CSV'}}</button></div></header>
    <section class="content customers-page">
      <div class="welcome"><div><p class="eyebrow">BUSINESS REPORTS</p><h1>Operational reports</h1><p class="subtitle">Daily posted sales, returns, purchases, operating expenses, payment movements, and owned-stock weight changes.</p></div></div>
      <div class="config-banner" *ngIf="!canView" role="status"><span class="banner-icon">i</span><div><b>Owner or administrator access required</b><p>Reports contain workspace-wide financial information. Ask an owner to review access permissions.</p></div></div>
      <section class="panel customer-editor" *ngIf="canView"><div class="panel-head"><div><h2>Choose a date range</h2><p>Dates use Asia/Kolkata. Maximum range is 366 calendar days.</p></div></div>
        <form class="customer-form report-filters" (ngSubmit)="load()"><label>From<input type="date" [(ngModel)]="fromDate" (ngModelChange)="filtersChanged()" name="fromDate" required></label><label>Through<input type="date" [(ngModel)]="throughDate" (ngModelChange)="filtersChanged()" name="throughDate" required></label><button class="primary-btn" type="submit" [disabled]="loading">{{loading?'Loading…':'Run report'}}</button></form>
      </section>
      <div class="config-banner error-banner" *ngIf="errorMessage" role="alert"><span class="banner-icon">!</span><div><b>Report could not be loaded</b><p>{{errorMessage}}</p></div><button class="text-btn" type="button" (click)="load()">Retry</button></div>
      <div class="config-banner error-banner" *ngIf="exportError" role="alert"><span class="banner-icon">!</span><div><b>Export was not downloaded</b><p>{{exportError}}</p></div><button class="text-btn" type="button" (click)="exportCsv()">Retry export</button></div>
      <div class="status-card" *ngIf="loading"><span class="spinner"></span><div><b>Building report</b><p>Supabase aggregates the selected tenant and date range.</p></div></div>
      <section class="panel customer-list" *ngIf="canView && !loading && !errorMessage"><div class="panel-head"><div><h2>Daily summary</h2><p>{{rows.length}} days · totals are based on posted records only.</p></div></div>
        <div class="table-wrap" *ngIf="rows.length; else noReport"><table><thead><tr><th>Date</th><th>Sales billed</th><th>Returns</th><th>Purchases billed</th><th>Expenses paid</th><th>Cash received</th><th>Refunds</th><th>Cash paid</th><th>Gold Δ (g)</th><th>Silver Δ (g)</th><th>Sales</th><th>Returns</th><th>Purchases</th><th>Expenses</th></tr></thead><tbody>
          <tr *ngFor="let row of rows"><td>{{row.report_day | date:'d MMM y':'Asia/Kolkata'}}</td><td>{{money(row.sales_total)}}</td><td>{{money(row.returns_total)}}</td><td>{{money(row.purchases_total)}}</td><td>{{money(row.expenses_paid)}}</td><td>{{money(row.cash_received)}}</td><td>{{money(row.cash_refunded)}}</td><td>{{money(row.cash_paid)}}</td><td>{{row.gold_weight_change_g}}</td><td>{{row.silver_weight_change_g}}</td><td>{{row.sales_count}}</td><td>{{row.returns_count}}</td><td>{{row.purchases_count}}</td><td>{{row.expenses_count}}</td></tr>
        </tbody></table></div><ng-template #noReport><div class="empty-state"><b>No activity in this date range</b><p>Try a wider range or check another workspace.</p></div></ng-template>
        <p class="duplicate-warning" role="note">Cash received, refunds, and expenses are recorded on their posting dates. This is not a cash balance and excludes opening balances, girvi, owner funds, and other accounts. Stock change is weight movement, not a valuation.</p>
      </section>
    </section>
  `
})
export class ReportsComponent implements OnInit, OnDestroy {
  workspace: BusinessWorkspace|null=null; rows:ReportRow[]=[]; loading=false; exporting=false; errorMessage=''; exportError=''; loadedFromDate=''; loadedThroughDate='';
  fromDate=this.shiftDate(-29); throughDate=this.shiftDate(0);
  private subscription:Subscription|null=null; private requestId=0;
  constructor(private readonly workspaceService:WorkspaceService,private readonly cdr:ChangeDetectorRef){}
  get canView():boolean{return this.workspace?.role==='owner'||this.workspace?.role==='admin';}
  get canExport():boolean{return this.rows.length>0&&this.loadedFromDate===this.fromDate&&this.loadedThroughDate===this.throughDate;}
  ngOnInit():void{this.subscription=this.workspaceService.activeWorkspace$.subscribe(workspace=>{if(workspace&&workspace.id===this.workspace?.id&&workspace.role===this.workspace?.role)return;this.workspace=workspace;this.rows=[];this.errorMessage='';this.requestId++;if(workspace&&this.canView)void this.load();else this.cdr.markForCheck();});}
  ngOnDestroy():void{this.subscription?.unsubscribe();this.requestId++;}
  async load():Promise<void>{
    const workspace=this.workspace,client=this.workspaceService.client;
    if(!this.canView){this.errorMessage='Owner or administrator access is required.';this.loading=false;this.cdr.markForCheck();return;}
    if(!workspace||!client){this.errorMessage='Select a workspace and confirm Supabase is configured.';this.loading=false;this.cdr.markForCheck();return;}
    if(!this.fromDate||!this.throughDate||this.throughDate<this.fromDate||Date.parse(`${this.throughDate}T00:00:00Z`)-Date.parse(`${this.fromDate}T00:00:00Z`)>365*86400000){this.errorMessage='Choose a valid range of at most 366 days.';this.cdr.markForCheck();return;}
    const requestId=++this.requestId,controller=new AbortController();this.loading=true;this.errorMessage='';this.cdr.markForCheck();let timer:ReturnType<typeof setTimeout>|undefined;
    try{
      const request=client.rpc('ss_business_report_v3',{p_business_id:workspace.id,p_from:this.fromDate,p_through:this.throughDate}).abortSignal(controller.signal);
      const result=await Promise.race([Promise.resolve(request),new Promise<never>((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(new Error('Report timed out after 20 seconds. Retry when the connection is available.'));},20000);})]);
      if(result.error)throw new Error(`${result.error.code??'Supabase'}: ${result.error.message}`);
      if(requestId===this.requestId){this.rows=(result.data??[]) as ReportRow[];this.loadedFromDate=this.fromDate;this.loadedThroughDate=this.throughDate;}
    }catch(error){if(requestId===this.requestId)this.errorMessage=error instanceof Error?error.message:'Could not load report.';}
    finally{if(timer)clearTimeout(timer);if(requestId===this.requestId){this.loading=false;this.cdr.markForCheck();}}
  }
  money(value:number|string):string{return formatInr(String(value),2);}
  filtersChanged():void{this.rows=[];this.loadedFromDate='';this.loadedThroughDate='';this.exportError='';}
  async exportCsv():Promise<void>{
    if(!this.canView||!this.canExport||this.exporting)return;
    this.exportError='';
    const client=this.workspaceService.client,workspace=this.workspace;
    if(!client||!workspace){this.exportError='The workspace connection is unavailable. The report was not exported.';return;}
    this.exporting=true;
    try{
      const controller=new AbortController();let timer:ReturnType<typeof setTimeout>|undefined;
      const audit=await Promise.race([Promise.resolve(client.rpc('ss_audit_report_export',{p_business_id:workspace.id,p_from:this.loadedFromDate,p_through:this.loadedThroughDate}).abortSignal(controller.signal)),new Promise<never>((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(new Error('Export audit request timed out. Retry.'));},20000);})]);
      if(timer)clearTimeout(timer);
      if(audit.error)throw new Error(`${audit.error.code??'Supabase'}: ${audit.error.message}`);
      if(!audit.data)throw new Error('Supabase did not confirm the export audit event.');
    }catch(error){this.exportError=`The audit event could not be recorded. ${error instanceof Error?error.message:'Retry the export.'}`;this.cdr.markForCheck();this.exporting=false;return;}
    const headers=['Date','Sales billed (INR)','Returns (INR)','Purchases billed (INR)','Expenses paid (INR)','Cash received (INR)','Refunds (INR)','Cash paid (INR)','Gold weight change (g)','Silver weight change (g)','Other weight change (g)','Sales count','Returns count','Purchases count','Expenses count'];
    const cells=this.rows.map(row=>[row.report_day,row.sales_total,row.returns_total,row.purchases_total,row.expenses_paid,row.cash_received,row.cash_refunded,row.cash_paid,row.gold_weight_change_g,row.silver_weight_change_g,row.other_weight_change_g,row.sales_count,row.returns_count,row.purchases_count,row.expenses_count]);
    const csv=[headers,...cells].map(line=>line.map(value=>this.csvCell(value)).join(',')).join('\r\n');
    const blob=new Blob(['\uFEFF',csv],{type:'text/csv;charset=utf-8'}),url=URL.createObjectURL(blob),anchor=document.createElement('a');anchor.href=url;anchor.download=`swarnasuraksha-report-${this.loadedFromDate}-to-${this.loadedThroughDate}.csv`;anchor.click();setTimeout(()=>URL.revokeObjectURL(url),1000);this.exporting=false;
  }
  private csvCell(value:unknown):string{const text=String(value??'');const safe=/^[\s\u0000-\u001f]*[=+\-@]/.test(text)?`'${text}`:text;return `"${safe.replace(/"/g,'""')}"`;}
  private shiftDate(offset:number):string{const date=new Date();const local=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kolkata',year:'numeric',month:'2-digit',day:'2-digit'}).format(date);const [y,m,d]=local.split('-').map(Number);const target=new Date(Date.UTC(y,m-1,d+offset));return target.toISOString().slice(0,10);}
}
