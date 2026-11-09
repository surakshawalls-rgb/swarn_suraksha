import { CommonModule } from '@angular/common';
import { ChangeDetectorRef, Component, OnDestroy, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { IonicModule } from '@ionic/angular';
import { Subscription } from 'rxjs';
import { formatFixed, parseFixed } from '../../core/financial/decimal';
import { BusinessWorkspace, WorkspaceService } from '../dashboard/workspace.service';

type Metal='gold'|'silver'|'other';
interface StockRow { metal:Metal; purity:string|null; owned_weight_g:string|number; }
interface Movement { movement_id:string; source_type:'purchase'|'sale'|'sale_return'; source_id:string; metal:Metal; purity:string|null; weight_delta_g:string|number; recorded_at:string; total_count:number; }

@Component({
  standalone:true,
  imports:[CommonModule,FormsModule,IonicModule,RouterLink],
  template:`
    <header class="topbar"><div class="crumb"><a routerLink="/dashboard">Overview</a><span>›</span><b>Owned inventory</b></div><div class="top-actions"><button class="text-btn" type="button" (click)="load()" [disabled]="loading">Refresh</button><button class="primary-btn" type="button" (click)="exportCsv()" [disabled]="!movements.length">Export current page</button></div></header>
    <section class="content customers-page">
      <div class="welcome"><div><p class="eyebrow">PURCHASED AND SALEABLE STOCK</p><h1>Owned inventory</h1><p class="subtitle">Stock is derived from purchase, sale, and return movements. Customer pledged items are kept outside this ledger.</p></div></div>
      <div class="config-banner" role="note"><span class="banner-icon">i</span><div><b>Weight is not a stock valuation</b><p>Net weight is grouped by metal and purity. This view does not include pledged custody, item counts, location, stone weight, or a market valuation.</p></div></div>
      <div class="config-banner error-banner" *ngIf="errorMessage" role="alert"><span class="banner-icon">!</span><div><b>Inventory could not be loaded</b><p>{{errorMessage}}</p></div><button class="text-btn" type="button" (click)="load()">Retry</button></div>
      <div class="status-card" *ngIf="loading"><span class="spinner"></span><div><b>Loading owned inventory</b><p>Reading the tenant-scoped stock movement ledgers.</p></div></div>
      <section class="panel customer-list" *ngIf="!loading && !errorMessage"><div class="panel-head"><div><h2>Current owned weight</h2><p>Calculated from all committed stock movements, not editable balances.</p></div></div>
        <div class="table-wrap" *ngIf="stock.length; else noStock"><table><thead><tr><th>Metal</th><th>Purity</th><th>Net owned weight (g)</th></tr></thead><tbody><tr *ngFor="let row of stock"><td>{{row.metal | titlecase}}</td><td>{{row.purity || 'Unspecified'}}</td><td>{{weight(row.owned_weight_g)}} g</td></tr></tbody></table></div>
        <ng-template #noStock><div class="empty-state"><b>No owned stock movements</b><p>Confirmed purchases add stock; sales reduce it and eligible returns restore it.</p></div></ng-template>
      </section>
      <section class="panel cashbook-filter"><label>Metal<select [(ngModel)]="metal" name="inventoryMetal"><option value="">All metals</option><option value="gold">Gold</option><option value="silver">Silver</option><option value="other">Other</option></select></label><label>From date<input type="date" [(ngModel)]="fromDate" name="inventoryFrom"></label><label>Through date<input type="date" [(ngModel)]="throughDate" name="inventoryThrough"></label><button class="primary-btn" type="button" (click)="page=0;load()" [disabled]="loading">Apply filters</button></section>
      <section class="panel customer-list" *ngIf="!loading && !errorMessage"><div class="panel-head"><div><h2>Movement history</h2><p>{{rowCount}} matching movements · page {{page+1}}</p></div><span class="page-size-note">{{pageSize}} rows per page</span></div>
        <div class="table-wrap" *ngIf="movements.length; else noMovements"><table><thead><tr><th>Recorded (IST)</th><th>Source</th><th>Reference</th><th>Metal</th><th>Purity</th><th>Weight change</th></tr></thead><tbody><tr *ngFor="let row of movements"><td>{{row.recorded_at | date:'d MMM y, h:mm a':'Asia/Kolkata'}}</td><td>{{sourceLabel(row.source_type)}}</td><td class="cash-reference">{{row.source_id}}</td><td>{{row.metal | titlecase}}</td><td>{{row.purity || 'Unspecified'}}</td><td [class.cash-in-text]="positive(row.weight_delta_g)" [class.cash-out-text]="!positive(row.weight_delta_g)">{{positive(row.weight_delta_g)?'+':''}}{{weight(row.weight_delta_g)}} g</td></tr></tbody></table></div>
        <ng-template #noMovements><div class="empty-state"><b>No movements match these filters</b><p>Clear the date or metal filter to see other stock changes.</p></div></ng-template>
        <div class="list-footer"><span>Source-linked append-only stock records</span><div><button class="text-btn" type="button" (click)="previousPage()" [disabled]="page===0 || loading">Previous</button><span>Page {{page+1}}</span><button class="text-btn" type="button" (click)="nextPage()" [disabled]="!hasMore || loading">Next</button></div></div>
      </section>
    </section>
  `
})
export class InventoryComponent implements OnInit,OnDestroy {
  workspace:BusinessWorkspace|null=null;stock:StockRow[]=[];movements:Movement[]=[];loading=true;errorMessage='';metal='';fromDate='';throughDate='';page=0;readonly pageSize=100;rowCount=0;hasMore=false;
  private subscription:Subscription|null=null;private requestId=0;
  constructor(private readonly workspaceService:WorkspaceService,private readonly cdr:ChangeDetectorRef){}
  ngOnInit():void{this.subscription=this.workspaceService.activeWorkspace$.subscribe(workspace=>{if(workspace&&workspace.id===this.workspace?.id&&workspace.role===this.workspace?.role)return;this.workspace=workspace;this.requestId++;this.stock=[];this.movements=[];this.page=0;if(workspace)void this.load();else{this.loading=false;this.errorMessage='Select a business workspace.';this.cdr.markForCheck();}});}
  ngOnDestroy():void{this.subscription?.unsubscribe();this.requestId++;}
  async load():Promise<void>{
    const workspace=this.workspace,client=this.workspaceService.client;
    if(!workspace||!client){this.loading=false;this.errorMessage=!client?'Supabase is not configured.':'Select a business workspace.';this.cdr.markForCheck();return;}
    if(this.fromDate&&this.throughDate&&this.fromDate>this.throughDate){this.loading=false;this.errorMessage='The start date must be on or before the end date.';this.cdr.markForCheck();return;}
    const id=++this.requestId,controller=new AbortController();this.loading=true;this.errorMessage='';this.cdr.markForCheck();
    const from=this.fromDate?`${this.fromDate}T00:00:00+05:30`:null,through=this.throughDate?`${this.throughDate}T23:59:59.999+05:30`:null;
    try{
      const summaryReq=client.rpc('ss_owned_inventory_summary',{p_business_id:workspace.id}).abortSignal(controller.signal);
      const pageReq=client.rpc('ss_owned_inventory_page',{p_business_id:workspace.id,p_metal:(this.metal||null) as Metal|null,p_from:from,p_through:through,p_offset:this.page*this.pageSize,p_limit:this.pageSize}).abortSignal(controller.signal);
      const [summary,history]=await this.withTimeout(Promise.all([summaryReq,pageReq]),'Loading inventory',()=>controller.abort());
      if(summary.error)throw new Error(`${summary.error.code??'Supabase'}: ${summary.error.message}`);
      if(history.error)throw new Error(`${history.error.code??'Supabase'}: ${history.error.message}`);
      if(id===this.requestId){this.stock=(summary.data??[]) as StockRow[];this.movements=(history.data??[]) as Movement[];this.rowCount=Number(this.movements[0]?.total_count??0);this.hasMore=this.rowCount>(this.page+1)*this.pageSize;}
    }catch(error){if(id===this.requestId){this.stock=[];this.movements=[];this.rowCount=0;this.hasMore=false;this.errorMessage=error instanceof Error?error.message:'Could not load owned inventory.';}}
    finally{if(id===this.requestId){this.loading=false;this.cdr.markForCheck();}}
  }
  weight(value:string|number):string{return formatFixed(parseFixed(String(value),4),4);}
  positive(value:string|number):boolean{return parseFixed(String(value),4)>0n;}
  sourceLabel(value:Movement['source_type']):string{return value==='sale_return'?'Sale return':value==='purchase'?'Purchase':'Sale';}
  previousPage():void{if(this.page>0){this.page--;void this.load();}}
  nextPage():void{if(this.hasMore){this.page++;void this.load();}}
  exportCsv():void{if(!this.movements.length)return;const headers=['Recorded IST','Source','Reference','Metal','Purity','Weight change g'];const rows=this.movements.map(x=>[new Intl.DateTimeFormat('en-IN',{dateStyle:'medium',timeStyle:'medium',timeZone:'Asia/Kolkata'}).format(new Date(x.recorded_at)),this.sourceLabel(x.source_type),x.source_id,x.metal,x.purity??'',x.weight_delta_g]);const cell=(v:unknown)=>{const s=String(v??''),safe=/^[\s\u0000-\u001f]*[=+\-@]/.test(s)?`'${s}`:s;return `"${safe.replace(/"/g,'""')}"`;};const csv=[headers,...rows].map(r=>r.map(cell).join(',')).join('\r\n');const blob=new Blob(['\uFEFF',csv],{type:'text/csv;charset=utf-8'}),url=URL.createObjectURL(blob),anchor=document.createElement('a');anchor.href=url;anchor.download=`owned-inventory-page-${this.page+1}.csv`;anchor.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
  private async withTimeout<T>(request:PromiseLike<T>,action:string,abort:()=>void):Promise<T>{let timer:ReturnType<typeof setTimeout>|undefined;try{return await Promise.race([Promise.resolve(request),new Promise<T>((_,reject)=>{timer=setTimeout(()=>{abort();reject(new Error(`${action} timed out after 20 seconds. Retry.`));},20000);})]);}finally{if(timer)clearTimeout(timer);}}
}
