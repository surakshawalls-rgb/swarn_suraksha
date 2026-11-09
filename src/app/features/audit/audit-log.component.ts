import { CommonModule } from '@angular/common';
import { ChangeDetectorRef, Component, OnDestroy, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { IonicModule } from '@ionic/angular';
import { Subscription } from 'rxjs';
import { BusinessWorkspace, WorkspaceService } from '../dashboard/workspace.service';

interface AuditEvent { event_id:string;event_type:string;entity_type:string;entity_id:string;actor_user_id:string;recorded_at:string;safe_metadata:Record<string,unknown>;total_count:number; }
type EventFilter=''|'purchase.posted'|'sale.posted'|'sale.returned'|'expense.posted'|'purchase_payment.recorded'|'sale_payment.recorded'|'daily_operations_csv'|'purchase.receipt_print_requested'|'sale.receipt_print_requested'|'sale_return.receipt_print_requested';

@Component({
  standalone:true,
  imports:[CommonModule,FormsModule,IonicModule,RouterLink],
  template:`
    <header class="topbar"><div class="crumb"><a routerLink="/dashboard">Overview</a><span>›</span><b>Audit log</b></div><div class="top-actions"><button class="text-btn" type="button" (click)="load()" [disabled]="loading || !canView">Refresh</button><button class="primary-btn" type="button" (click)="exportCsv()" [disabled]="!events.length || !canView">Export current page</button></div></header>
    <section class="content customers-page">
      <div class="welcome"><div><p class="eyebrow">WORKSPACE ACTIVITY</p><h1>Audit log</h1><p class="subtitle">Immutable posting, payment, expense, print-request, and report-export events for this workspace.</p></div></div>
      <div class="config-banner" *ngIf="!canView" role="status"><span class="banner-icon">i</span><div><b>Owner or administrator access required</b><p>Audit events can include financial metadata and are restricted to workspace administrators.</p></div></div>
      <div class="config-banner error-banner" *ngIf="errorMessage" role="alert"><span class="banner-icon">!</span><div><b>Audit events could not be loaded</b><p>{{errorMessage}}</p></div><button class="text-btn" type="button" (click)="load()">Retry</button></div>
      <div class="status-card" *ngIf="loading"><span class="spinner"></span><div><b>Loading audit events</b><p>Reading the administrator-only workspace activity feed.</p></div></div>
      <section class="panel cashbook-filter" *ngIf="canView"><label>From date<input type="date" [(ngModel)]="fromDate" name="auditFrom"></label><label>Through date<input type="date" [(ngModel)]="throughDate" name="auditThrough"></label><label>Event type<select [(ngModel)]="eventType" name="auditType"><option value="">All events</option><option value="purchase.posted">Purchase posted</option><option value="sale.posted">Sale posted</option><option value="sale.returned">Sale returned</option><option value="expense.posted">Expense posted</option><option value="purchase_payment.recorded">Purchase payment</option><option value="sale_payment.recorded">Sale payment</option><option value="daily_operations_csv">Report export</option><option value="purchase.receipt_print_requested">Purchase print requested</option><option value="sale.receipt_print_requested">Sale print requested</option><option value="sale_return.receipt_print_requested">Return print requested</option></select></label><button class="primary-btn" type="button" (click)="page=0;load()" [disabled]="loading">Apply filters</button></section>
      <section class="panel customer-list" *ngIf="canView && !loading && !errorMessage"><div class="panel-head"><div><h2>Workspace events</h2><p>{{rowCount}} matching events · page {{page+1}}</p></div><span class="page-size-note">{{pageSize}} rows per page</span></div>
        <div class="table-wrap" *ngIf="events.length; else noEvents"><table><thead><tr><th>Recorded (IST)</th><th>Event</th><th>Entity</th><th>Entity ID</th><th>Actor user ID</th><th>Safe metadata</th></tr></thead><tbody><tr *ngFor="let row of events"><td>{{row.recorded_at | date:'d MMM y, h:mm a':'Asia/Kolkata'}}</td><td>{{row.event_type}}</td><td>{{row.entity_type}}</td><td class="cash-reference">{{row.entity_id}}</td><td class="cash-reference">{{row.actor_user_id}}</td><td><code>{{row.safe_metadata | json}}</code></td></tr></tbody></table></div>
        <ng-template #noEvents><div class="empty-state"><b>No audit events match these filters</b><p>Committed operations and audited print/export requests appear here.</p></div></ng-template>
        <div class="list-footer"><span>Server-recorded event time · financial writes remain in source ledgers</span><div><button class="text-btn" type="button" (click)="previousPage()" [disabled]="page===0 || loading">Previous</button><span>Page {{page+1}}</span><button class="text-btn" type="button" (click)="nextPage()" [disabled]="!hasMore || loading">Next</button></div></div>
      </section>
    </section>
  `
})
export class AuditLogComponent implements OnInit,OnDestroy {
  workspace:BusinessWorkspace|null=null;events:AuditEvent[]=[];loading=true;errorMessage='';fromDate='';throughDate='';eventType:EventFilter='';page=0;readonly pageSize=100;rowCount=0;hasMore=false;
  private subscription:Subscription|null=null;private requestId=0;
  constructor(private readonly workspaceService:WorkspaceService,private readonly cdr:ChangeDetectorRef){}
  get canView():boolean{return this.workspace?.role==='owner'||this.workspace?.role==='admin';}
  ngOnInit():void{this.subscription=this.workspaceService.activeWorkspace$.subscribe(workspace=>{if(workspace&&workspace.id===this.workspace?.id&&workspace.role===this.workspace?.role)return;this.workspace=workspace;this.requestId++;this.events=[];this.page=0;if(workspace&&this.canView)void this.load();else{this.loading=false;this.errorMessage=workspace?'Owner or administrator access is required.':'Select a business workspace.';this.cdr.markForCheck();}});}
  ngOnDestroy():void{this.subscription?.unsubscribe();this.requestId++;}
  async load():Promise<void>{
    const workspace=this.workspace,client=this.workspaceService.client;
    if(!this.canView||!workspace||!client){this.loading=false;this.errorMessage=!workspace?'Select a business workspace.':!client?'Supabase is not configured.':'Owner or administrator access is required.';this.cdr.markForCheck();return;}
    if(this.fromDate&&this.throughDate&&this.fromDate>this.throughDate){this.loading=false;this.errorMessage='The start date must be on or before the end date.';this.cdr.markForCheck();return;}
    const id=++this.requestId,controller=new AbortController();this.loading=true;this.errorMessage='';this.cdr.markForCheck();const from=this.fromDate?`${this.fromDate}T00:00:00+05:30`:null,through=this.throughDate?`${this.throughDate}T23:59:59.999+05:30`:null;
    try{const request=client.rpc('ss_admin_audit_page',{p_business_id:workspace.id,p_from:from,p_through:through,p_event_type:this.eventType||null,p_offset:this.page*this.pageSize,p_limit:this.pageSize}).abortSignal(controller.signal);const result=await this.withTimeout(request,controller);if(result.error)throw new Error(`${result.error.code??'Supabase'}: ${result.error.message}`);if(id===this.requestId){this.events=(result.data??[]) as AuditEvent[];this.rowCount=Number(this.events[0]?.total_count??0);this.hasMore=this.rowCount>(this.page+1)*this.pageSize;}}
    catch(error){if(id===this.requestId){this.events=[];this.rowCount=0;this.hasMore=false;this.errorMessage=error instanceof Error?error.message:'Could not load audit events.';}}
    finally{if(id===this.requestId){this.loading=false;this.cdr.markForCheck();}}
  }
  previousPage():void{if(this.page>0){this.page--;void this.load();}}
  nextPage():void{if(this.hasMore){this.page++;void this.load();}}
  exportCsv():void{if(!this.events.length||!this.canView)return;const headers=['Recorded IST','Event type','Entity type','Entity ID','Actor user ID','Safe metadata'];const rows=this.events.map(e=>[new Intl.DateTimeFormat('en-IN',{dateStyle:'medium',timeStyle:'medium',timeZone:'Asia/Kolkata'}).format(new Date(e.recorded_at)),e.event_type,e.entity_type,e.entity_id,e.actor_user_id,JSON.stringify(e.safe_metadata)]);const cell=(v:unknown)=>{const s=String(v??''),safe=/^[\s\u0000-\u001f]*[=+\-@]/.test(s)?`'${s}`:s;return `"${safe.replace(/"/g,'""')}"`;};const csv=[headers,...rows].map(row=>row.map(cell).join(',')).join('\r\n');const blob=new Blob(['\uFEFF',csv],{type:'text/csv;charset=utf-8'}),url=URL.createObjectURL(blob),anchor=document.createElement('a');anchor.href=url;anchor.download=`workspace-audit-page-${this.page+1}.csv`;anchor.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
  private async withTimeout<T>(request:PromiseLike<T>,controller:AbortController):Promise<T>{let timer:ReturnType<typeof setTimeout>|undefined;try{return await Promise.race([Promise.resolve(request),new Promise<T>((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(new Error('Loading audit events timed out after 20 seconds. Retry.'));},20000);})]);}finally{if(timer)clearTimeout(timer);}}
}
