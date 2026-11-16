import { CommonModule } from '@angular/common';
import { ChangeDetectorRef, Component, OnDestroy, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { IonicModule } from '@ionic/angular';
import { Subscription } from 'rxjs';
import { formatFixed, formatInr, parseFixed } from '../../core/financial/decimal';
import { Json } from '../../core/supabase/database.types';
import { NetworkStatusService } from '../../core/network/network-status.service';
import { BusinessWorkspace, WorkspaceService } from '../dashboard/workspace.service';

type Metal='gold'|'silver';
type PaymentMethod='cash'|'upi'|'bank_transfer'|'card';
type ItemStatus='available'|'sold'|'returned';
type ReturnReason='defect'|'customer_disliked'|'different_design'|'other';
interface Supplier {id:string;name:string;is_active:boolean;}
interface StockItem {id:string;business_id:string;intake_id:string;item_number:number;description:string;metal:Metal;purity:string|null;weight_g:string;purchase_cost:string;status:ItemStatus;sold_to:string|null;sold_date:string|null;return_reason:ReturnReason|null;return_note:string|null;returned_date:string|null;created_at:string;}
interface StockIntake {id:string;business_id:string;supplier_id:string;intake_number:number;received_date:string;item_count:number;total_cost:string;paid_total:string;}
interface StockPayment {id:string;intake_id:string;amount:string;method:PaymentMethod;reference:string|null;payment_date:string;created_at:string;}
interface StockSummary {metal:string;available_weight_g:number|string;available_items:number;}
interface IntakeLineDraft {description:string;metal:Metal;purity:string;weight_g:string;purchase_cost:string;}
type PendingAction=
  |{kind:'intake';key:string;supplierId:string;receivedDate:string;items:Json;initialPaid:string;paymentMethod:PaymentMethod|null;paymentDate:string|null;paymentReference:string|null}
  |{kind:'payment';key:string;intakeId:string;amount:string;method:PaymentMethod;paymentDate:string;reference:string|null}
  |{kind:'sold';key:string;itemId:string;soldTo:string;soldDate:string}
  |{kind:'returned';key:string;itemId:string;reason:ReturnReason;note:string|null;returnedDate:string};

@Component({
  standalone:true,
  imports:[CommonModule,FormsModule,IonicModule,RouterLink],
  template:`
    <header class="topbar"><div class="crumb"><a routerLink="/dashboard">Overview</a><span>›</span><b>Stock</b></div><div class="top-actions"><button class="text-btn" type="button" (click)="load()" [disabled]="loading">Refresh</button><button *ngIf="canManage" class="primary-btn" type="button" (click)="toggleIntake()" [disabled]="pending?.kind!==undefined && pending?.kind!=='intake'"><span>＋</span> Add stock</button></div></header>
    <section class="content customers-page stock-page">
      <div class="welcome"><div><p class="eyebrow">INDIVIDUAL ITEM INVENTORY</p><h1>Stock</h1><p class="subtitle">Track each piece from manufacturer intake to sale or return. This stock ledger is separate from billing and purchase inventory.</p></div></div>
      <div class="config-banner" role="note"><span class="banner-icon">i</span><div><b>Independent stock tracking</b><p>Items are added and sold individually. Marking stock sold does not create or change a customer bill. Returned pieces are removed from available stock and remain in the item history.</p></div></div>
      <div class="config-banner error-banner" *ngIf="errorMessage" role="alert"><span class="banner-icon">!</span><div><b>Stock data unavailable</b><p>{{errorMessage}}</p></div><button class="text-btn" type="button" (click)="load()">Retry</button></div>
      <p class="save-success" *ngIf="successMessage" role="status">{{successMessage}}</p>
      <div class="status-card" *ngIf="loading"><span class="spinner"></span><div><b>Loading stock</b><p>Reading item records and available metal weights for this business.</p></div></div>

      <section class="stock-summary" *ngIf="!loading && !errorMessage">
        <article class="stock-metal-card gold-stock"><span class="stock-metal-icon">Au</span><div><small>AVAILABLE GOLD</small><b>{{availableWeight('gold')}} <em>g</em></b><span>{{availableCount('gold')}} individual {{availableCount('gold')===1?'item':'items'}}</span></div></article>
        <article class="stock-metal-card silver-stock"><span class="stock-metal-icon">Ag</span><div><small>AVAILABLE SILVER</small><b>{{availableWeight('silver')}} <em>g</em></b><span>{{availableCount('silver')}} individual {{availableCount('silver')===1?'item':'items'}}</span></div></article>
      </section>

      <section class="panel stock-intake-panel" *ngIf="intakeOpen">
        <div class="stock-section-heading"><div><p class="eyebrow">MANUFACTURER INTAKE</p><h2>Add items to stock</h2><p>Each line is one individual item. Manufacturer payment can be made now or recorded later.</p></div><button class="text-btn" type="button" (click)="closeIntake()" [disabled]="saving">Cancel</button></div>
        <form class="stock-intake-form" (ngSubmit)="submitIntake()">
          <div class="stock-intake-meta">
            <label>Manufacturer<select [(ngModel)]="supplierId" name="supplierId" required [disabled]="saving || !!pending"><option value="">Select manufacturer</option><option *ngFor="let supplier of suppliers" [value]="supplier.id" [disabled]="!supplier.is_active">{{supplier.name}}{{supplier.is_active?'':' (inactive)'}}</option></select><small *ngIf="!suppliers.length">Add a manufacturer in Suppliers before recording stock.</small></label>
            <label>Date received<input type="date" [(ngModel)]="receivedDate" name="receivedDate" [max]="today" required [disabled]="saving || !!pending"></label>
          </div>
          <div class="stock-item-drafts">
            <article class="stock-item-draft" *ngFor="let item of draftItems;let i=index">
              <div class="stock-draft-heading"><span class="stock-draft-number">{{i+1}}</span><b>Item {{i+1}}</b><button *ngIf="draftItems.length>1" class="stock-remove" type="button" (click)="removeDraftItem(i)" [disabled]="saving || !!pending">Remove</button></div>
              <label>Item name<input [(ngModel)]="item.description" [name]="'itemName'+i" maxlength="180" required placeholder="e.g. Silver ring"></label>
              <label>Metal<select [(ngModel)]="item.metal" [name]="'itemMetal'+i"><option value="gold">Gold</option><option value="silver">Silver</option></select></label>
              <label>Purity / grade<input [(ngModel)]="item.purity" [name]="'itemPurity'+i" maxlength="40" placeholder="e.g. 22K"></label>
              <label>Weight (g)<input [(ngModel)]="item.weight_g" [name]="'itemWeight'+i" inputmode="decimal" required placeholder="0.0000"></label>
              <label>Purchase price (₹)<input [(ngModel)]="item.purchase_cost" [name]="'itemCost'+i" inputmode="decimal" required placeholder="0.00"></label>
            </article>
            <button class="stock-add-line" type="button" (click)="addDraftItem()" [disabled]="draftItems.length>=100 || saving || !!pending">＋ Add another item</button>
          </div>
          <div class="stock-payment-box">
            <div class="stock-section-heading"><div><h3>Manufacturer payment</h3><p>Leave amount at zero if this intake is unpaid. You can record one or more payments later.</p></div></div>
            <div class="stock-payment-fields">
              <label>Paid now (₹)<input [(ngModel)]="initialPaid" name="initialPaid" inputmode="decimal" [disabled]="saving || !!pending"></label>
              <label>Method<select [(ngModel)]="initialPaymentMethod" name="initialPaymentMethod" [disabled]="saving || !!pending || !initialPaymentAmount"><option value="cash">Cash</option><option value="upi">UPI</option><option value="bank_transfer">Bank transfer</option><option value="card">Card</option></select></label>
              <label>Payment date<input type="date" [(ngModel)]="initialPaymentDate" name="initialPaymentDate" [max]="today" [min]="receivedDate" [disabled]="saving || !!pending || !initialPaymentAmount"></label>
              <label>Reference (optional)<input [(ngModel)]="initialPaymentReference" name="initialPaymentReference" maxlength="120" [disabled]="saving || !!pending || !initialPaymentAmount"></label>
            </div>
          </div>
          <div class="stock-intake-total"><span>{{draftItems.length}} item{{draftItems.length===1?'':'s'}} · total purchase price</span><b>{{money(draftTotal)}}</b></div>
          <p class="form-error" *ngIf="formError" role="alert">{{formError}}</p>
          <div class="form-actions"><button class="primary-btn" type="submit" [disabled]="saving || !canManage || !network.isOnline || !suppliers.length || !supplierId">{{saving? 'Saving stock…' : pending?.kind==='intake'?'Retry same intake safely':'Add to stock'}}</button><span>Items are recorded separately from sales bills.</span></div>
        </form>
      </section>

      <section class="panel stock-list-panel" *ngIf="!loading && !errorMessage">
        <div class="stock-section-heading"><div><p class="eyebrow">ITEM REGISTER</p><h2>Individual stock items</h2><p>Available pieces can be marked sold or returned. Sold and returned items stay in this register.</p></div><span class="stock-result-count">{{itemCount}} matching items</span></div>
        <div class="stock-filters">
          <label>Metal<select [(ngModel)]="metalFilter" name="metalFilter" (ngModelChange)="page=0;load()"><option value="">All metals</option><option value="gold">Gold</option><option value="silver">Silver</option></select></label>
          <label>Status<select [(ngModel)]="statusFilter" name="statusFilter" (ngModelChange)="page=0;load()"><option value="">All statuses</option><option value="available">Available</option><option value="sold">Sold</option><option value="returned">Returned</option></select></label>
        </div>
        <div class="table-wrap stock-table-wrap" *ngIf="items.length;else emptyStock"><table class="stock-items-table"><thead><tr><th>Item</th><th>Metal / weight</th><th>Purchase price</th><th>Manufacturer</th><th>Payment</th><th>Status / details</th><th>Action</th></tr></thead><tbody>
          <tr *ngFor="let item of items"><td class="stock-item-name"><b>{{item.description}}</b><small *ngIf="item.purity">{{item.purity}}</small><small>Intake #{{intakeFor(item.intake_id)?.intake_number || '—'}} · {{intakeFor(item.intake_id)?.received_date | date:'d MMM y':'Asia/Kolkata'}}</small></td>
            <td><span class="stock-metal-label" [class.gold-label]="item.metal==='gold'">{{item.metal | titlecase}}</span><b class="stock-weight">{{weight(item.weight_g)}} g</b></td>
            <td class="stock-price">{{money(item.purchase_cost)}}</td>
            <td>{{supplierName(intakeFor(item.intake_id)?.supplier_id)}}</td>
            <td><span class="payment-status" [class.payment-paid]="paymentStatus(intakeFor(item.intake_id))==='Paid'" [class.payment-partial]="paymentStatus(intakeFor(item.intake_id))==='Part paid'">{{paymentStatus(intakeFor(item.intake_id))}}</span><small class="stock-payment-totals" *ngIf="intakeFor(item.intake_id) as intake">{{money(intake.paid_total)}} / {{money(intake.total_cost)}}</small><button *ngIf="canManage && hasOutstanding(intakeFor(item.intake_id))" class="stock-inline-action" type="button" (click)="openItemPayment(item)" [disabled]="saving">Record payment</button></td>
            <td><span class="item-status" [class.item-available]="item.status==='available'" [class.item-sold]="item.status==='sold'" [class.item-returned]="item.status==='returned'">{{item.status | titlecase}}</span><small *ngIf="item.status==='sold'">To {{item.sold_to}} · {{item.sold_date | date:'d MMM y':'Asia/Kolkata'}}</small><small *ngIf="item.status==='returned'">{{returnReasonLabel(item.return_reason)}} · {{item.returned_date | date:'d MMM y':'Asia/Kolkata'}}<span *ngIf="item.return_note"> · {{item.return_note}}</span></small></td>
            <td class="stock-row-actions"><ng-container *ngIf="item.status==='available' && canManage"><button class="stock-sold-action" type="button" (click)="openSold(item)" [disabled]="saving">Mark sold</button><button class="stock-return-action" type="button" (click)="openReturn(item)" [disabled]="saving">Mark returned</button></ng-container><span *ngIf="item.status!=='available'">—</span></td>
          </tr>
        </tbody></table></div>
        <ng-template #emptyStock><div class="stock-empty"><span>◇</span><b>{{metalFilter||statusFilter?'No items match these filters':'No stock items yet'}}</b><p>{{metalFilter||statusFilter?'Change the filters to see other items.':'Add each manufacturer item to start tracking available gold and silver.'}}</p><button *ngIf="canManage && !metalFilter && !statusFilter" class="primary-btn" type="button" (click)="intakeOpen=true">Add your first stock item</button></div></ng-template>
        <div class="list-footer"><span>Showing {{items.length}} of {{itemCount}} matching items · available weight excludes sold and returned items</span><div><button class="text-btn" type="button" (click)="previousPage()" [disabled]="page===0 || loading">Previous</button><span>Page {{page+1}}</span><button class="text-btn" type="button" (click)="nextPage()" [disabled]="(page+1)*pageSize>=itemCount || loading">Next</button></div></div>
      </section>
    </section>

    <div class="stock-modal-backdrop" *ngIf="actionItem && (actionMode==='sold' || actionMode==='returned')" role="presentation" (click)="closeAction()">
      <section class="stock-modal" role="dialog" aria-modal="true" [attr.aria-label]="actionMode==='sold'?'Confirm item sold':'Confirm item returned'" (click)="$event.stopPropagation()">
        <div class="stock-modal-heading"><span class="stock-modal-icon">{{actionMode==='sold'?'✓':'↩'}}</span><div><p class="eyebrow">{{actionMode==='sold'?'SALE CONFIRMATION':'MANUFACTURER RETURN'}}</p><h2>{{actionMode==='sold'?'Mark item as sold':'Mark item as returned'}}</h2><p><b>{{actionItem.description}}</b> · {{actionItem.metal | titlecase}} · {{weight(actionItem.weight_g)}} g</p></div></div>
        <form class="stock-modal-form" (ngSubmit)="submitItemAction()">
          <ng-container *ngIf="actionMode==='sold'"><label>Sold to<input [(ngModel)]="soldTo" name="soldTo" maxlength="160" required placeholder="Customer name"></label><label>Sale date<input type="date" [(ngModel)]="soldDate" name="soldDate" [min]="intakeFor(actionItem.intake_id)?.received_date" [max]="today" required></label></ng-container>
          <ng-container *ngIf="actionMode==='returned'"><label>Return reason<select [(ngModel)]="returnReason" name="returnReason" required><option value="defect">Defective item</option><option value="customer_disliked">Customer did not like it</option><option value="different_design">Customer wants a different design</option><option value="other">Other reason</option></select></label><label>Notes (optional)<textarea [(ngModel)]="returnNote" name="returnNote" maxlength="500" rows="3" placeholder="Add details about the return"></textarea></label><label>Return date<input type="date" [(ngModel)]="returnedDate" name="returnedDate" [min]="intakeFor(actionItem.intake_id)?.received_date" [max]="today" required></label></ng-container>
          <p class="stock-confirm-note">{{actionMode==='sold'?'This item will no longer count as available. This action does not create a bill.':'This item will be removed from available stock. The item and reason will remain in the register.'}}</p>
          <p class="form-error" *ngIf="formError" role="alert">{{formError}}</p><div class="stock-modal-actions"><button class="text-btn" type="button" (click)="closeAction()" [disabled]="saving">Cancel</button><button class="primary-btn" type="submit" [disabled]="saving || !network.isOnline">{{saving?'Saving…':pending?.kind===actionMode?'Retry same action safely':actionMode==='sold'?'Confirm sold':'Confirm return'}}</button></div>
        </form>
      </section>
    </div>

    <div class="stock-modal-backdrop" *ngIf="paymentIntake" role="presentation" (click)="closePayment()">
      <section class="stock-modal stock-payment-modal" role="dialog" aria-modal="true" aria-label="Record manufacturer payment" (click)="$event.stopPropagation()">
        <div class="stock-modal-heading"><span class="stock-modal-icon">₹</span><div><p class="eyebrow">MANUFACTURER SETTLEMENT</p><h2>Record payment</h2><p>Intake #{{paymentIntake.intake_number}} · {{supplierName(paymentIntake.supplier_id)}}</p></div></div>
        <div class="stock-payment-balance"><span>Purchase total <b>{{money(paymentIntake.total_cost)}}</b></span><span>Paid so far <b>{{money(paymentIntake.paid_total)}}</b></span><span>Remaining <b>{{money(outstanding(paymentIntake))}}</b></span></div>
        <div class="stock-payment-history" *ngIf="payments.length"><b>Payments recorded</b><div *ngFor="let payment of payments"><span>{{payment.payment_date | date:'d MMM y':'Asia/Kolkata'}} · {{payment.method | titlecase}}{{payment.reference?' · '+payment.reference:''}}</span><b>{{money(payment.amount)}}</b></div></div>
        <form class="stock-modal-form" (ngSubmit)="submitPayment()"><label>Payment amount (₹)<input [(ngModel)]="paymentAmount" name="paymentAmount" inputmode="decimal" required></label><div class="stock-payment-fields"><label>Method<select [(ngModel)]="paymentMethod" name="paymentMethod"><option value="cash">Cash</option><option value="upi">UPI</option><option value="bank_transfer">Bank transfer</option><option value="card">Card</option></select></label><label>Payment date<input type="date" [(ngModel)]="paymentDate" name="paymentDate" [min]="paymentIntake.received_date" [max]="today" required></label></div><label>Reference (optional)<input [(ngModel)]="paymentReference" name="paymentReference" maxlength="120"></label>
          <p class="form-error" *ngIf="formError" role="alert">{{formError}}</p><div class="stock-modal-actions"><button class="text-btn" type="button" (click)="closePayment()" [disabled]="saving">Close</button><button class="primary-btn" type="submit" [disabled]="saving || !network.isOnline">{{saving?'Saving…':pending?.kind==='payment'?'Retry same payment safely':'Save payment'}}</button></div>
        </form>
      </section>
    </div>
  `
})
export class StockComponent implements OnInit,OnDestroy {
  workspace:BusinessWorkspace|null=null;
  suppliers:Supplier[]=[];items:StockItem[]=[];intakes:StockIntake[]=[];payments:StockPayment[]=[];summary:StockSummary[]=[];
  loading=true;saving=false;errorMessage='';formError='';successMessage='';
  intakeOpen=false;draftItems:IntakeLineDraft[]=[this.emptyLine()];supplierId='';receivedDate=this.localDate();initialPaid='0.00';initialPaymentMethod:PaymentMethod='cash';initialPaymentDate=this.localDate();initialPaymentReference='';
  metalFilter:Metal|''='';statusFilter:ItemStatus|''='';page=0;itemCount=0;readonly pageSize=50;
  actionItem:StockItem|null=null;actionMode:'sold'|'returned'|null=null;soldTo='';soldDate=this.localDate();returnReason:ReturnReason='defect';returnNote='';returnedDate=this.localDate();
  paymentIntake:StockIntake|null=null;paymentAmount='';paymentMethod:PaymentMethod='cash';paymentDate=this.localDate();paymentReference='';
  pending:PendingAction|null=null;
  readonly today=this.localDate();
  private subscription:Subscription|null=null;private requestId=0;
  private intakeMap=new Map<string,StockIntake>();private supplierMap=new Map<string,string>();

  constructor(private readonly workspaceService:WorkspaceService,readonly network:NetworkStatusService,private readonly cdr:ChangeDetectorRef){}
  get canManage():boolean{return this.workspace?.role==='owner'||this.workspace?.role==='admin';}
  get initialPaymentAmount():boolean{try{return parseFixed(this.initialPaid||'0',2)>0n;}catch{return false;}}
  get draftTotalMinor():bigint{return this.draftItems.reduce((sum,item)=>{try{return sum+parseFixed(item.purchase_cost||'0',2);}catch{return sum;}},0n);}
  get draftTotal():string{return formatFixed(this.draftTotalMinor,2);}
  ngOnInit():void{
    this.subscription=this.workspaceService.activeWorkspace$.subscribe(workspace=>{
      if(workspace&&workspace.id===this.workspace?.id&&workspace.role===this.workspace?.role)return;
      this.workspace=workspace;this.requestId++;this.items=[];this.intakes=[];this.summary=[];this.pending=null;this.actionItem=null;this.paymentIntake=null;
      if(workspace)void this.load();else{this.loading=false;this.errorMessage='Select a business workspace.';this.cdr.markForCheck();}
    });
  }
  ngOnDestroy():void{this.subscription?.unsubscribe();this.requestId++;}
  async load():Promise<void>{
    const workspace=this.workspace,client=this.workspaceService.client;
    if(!workspace||!client){this.loading=false;this.errorMessage=!client?'Supabase is not configured.':'Select a business workspace.';this.cdr.markForCheck();return;}
    const id=++this.requestId,controller=new AbortController();this.loading=true;this.errorMessage='';this.cdr.markForCheck();
    try{
      let itemQuery=client.from('ss_stock_items').select('id,business_id,intake_id,item_number,description,metal,purity,weight_g,purchase_cost,status,sold_to,sold_date,return_reason,return_note,returned_date,created_at',{count:'exact'}).eq('business_id',workspace.id).order('created_at',{ascending:false});
      if(this.metalFilter)itemQuery=itemQuery.eq('metal',this.metalFilter) as typeof itemQuery;
      if(this.statusFilter)itemQuery=itemQuery.eq('status',this.statusFilter) as typeof itemQuery;
      const [supplierResult,summaryResult,itemResult]=await Promise.all([
        this.withTimeout(client.from('ss_suppliers').select('id,name,is_active').eq('business_id',workspace.id).order('name').abortSignal(controller.signal),'Loading manufacturers',()=>controller.abort()),
        this.withTimeout(client.rpc('ss_stock_summary',{p_business_id:workspace.id}).abortSignal(controller.signal),'Loading available stock weights',()=>controller.abort()),
        this.withTimeout(itemQuery.range(this.page*this.pageSize,(this.page+1)*this.pageSize-1).abortSignal(controller.signal),'Loading stock items',()=>controller.abort())
      ]);
      if(supplierResult.error)throw new Error(`${supplierResult.error.code??'Supabase'}: ${supplierResult.error.message}`);
      if(summaryResult.error)throw new Error(`${summaryResult.error.code??'Supabase'}: ${summaryResult.error.message}`);
      if(itemResult.error)throw new Error(`${itemResult.error.code??'Supabase'}: ${itemResult.error.message}`);
      if(id!==this.requestId)return;
      this.suppliers=(supplierResult.data??[]) as Supplier[];
      this.supplierMap=new Map(this.suppliers.map(row=>[row.id,row.name]));
      this.summary=(summaryResult.data??[]) as StockSummary[];
      this.items=(itemResult.data??[]) as StockItem[];this.itemCount=itemResult.count??this.items.length;
      const intakeIds=[...new Set(this.items.map(row=>row.intake_id))];
      if(intakeIds.length){
        const [intakeResult,paymentResult]=await Promise.all([
          this.withTimeout(client.from('ss_stock_intakes').select('id,business_id,supplier_id,intake_number,received_date,item_count,total_cost,paid_total').eq('business_id',workspace.id).in('id',intakeIds),'Loading stock intake details'),
          this.withTimeout(client.from('ss_stock_payments').select('id,intake_id,amount,method,reference,payment_date,created_at').eq('business_id',workspace.id).in('intake_id',intakeIds).order('payment_date',{ascending:false}),'Loading manufacturer payments')
        ]);
        if(intakeResult.error)throw new Error(`${intakeResult.error.code??'Supabase'}: ${intakeResult.error.message}`);
        if(paymentResult.error)throw new Error(`${paymentResult.error.code??'Supabase'}: ${paymentResult.error.message}`);
        if(id!==this.requestId)return;
        this.intakes=(intakeResult.data??[]) as StockIntake[];this.intakeMap=new Map(this.intakes.map(row=>[row.id,row]));
        this.payments=(paymentResult.data??[]) as StockPayment[];
      }else{this.intakes=[];this.intakeMap.clear();this.payments=[];}
    }catch(error){if(id===this.requestId){this.errorMessage=error instanceof Error?error.message:'Could not load stock data.';this.items=[];this.intakes=[];this.payments=[];}}
    finally{if(id===this.requestId){this.loading=false;this.cdr.markForCheck();}}
  }
  addDraftItem():void{if(this.draftItems.length<100)this.draftItems=[...this.draftItems,this.emptyLine()];}
  removeDraftItem(index:number):void{if(this.draftItems.length>1)this.draftItems=this.draftItems.filter((_,i)=>i!==index);}
  toggleIntake():void{if(this.intakeOpen)this.closeIntake();else this.intakeOpen=true;}
  closeIntake():void{if(this.saving)return;if(this.pending?.kind==='intake'){this.formError='Retry this intake to confirm its result before closing.';return;}this.intakeOpen=false;this.formError='';}
  async submitIntake():Promise<void>{
    if(!this.canManage||this.saving)return;
    if(!this.pending){
      try{
        if(!this.network.isOnline)throw new Error('You are offline. Reconnect before saving stock.');
        if(!this.supplierId)throw new Error('Choose a manufacturer.');
        const items=this.draftItems.map((item,index)=>{
          const weight=parseFixed(item.weight_g,4),cost=parseFixed(item.purchase_cost,2);
          if(!item.description.trim())throw new Error(`Enter a name for item ${index+1}.`);
          if(weight<=0n)throw new Error(`Enter a positive weight for item ${index+1}.`);
          if(cost<=0n)throw new Error(`Enter a positive purchase price for item ${index+1}.`);
          return{description:item.description.trim(),metal:item.metal,purity:item.purity.trim()||null,weight_g:formatFixed(weight,4),purchase_cost:formatFixed(cost,2)} as Json;
        }) as Json;
        const amount=parseFixed(this.initialPaid||'0',2);
        if(amount<0n||amount>this.draftTotalMinor)throw new Error('Initial payment must be between zero and the total purchase price.');
        if(amount>0n&&!this.initialPaymentDate)throw new Error('Choose the initial payment date.');
        this.pending={kind:'intake',key:crypto.randomUUID(),supplierId:this.supplierId,receivedDate:this.receivedDate,items,initialPaid:formatFixed(amount,2),
          paymentMethod:amount>0n?this.initialPaymentMethod:null,paymentDate:amount>0n?this.initialPaymentDate:null,paymentReference:amount>0n?(this.initialPaymentReference.trim()||null):null};
      }catch(error){this.formError=error instanceof Error?error.message:'Check the stock intake details.';return;}
    }
    await this.executePending();
  }
  async openPayment(intake:StockIntake):Promise<void>{
    this.paymentIntake=intake;this.paymentAmount=this.money(formatFixed(parseFixed(intake.total_cost,2)-parseFixed(intake.paid_total,2),2));
    this.paymentMethod='cash';this.paymentDate=this.localDate();this.paymentReference='';this.formError='';this.pending=null;
    this.payments=this.payments.filter(row=>row.intake_id===intake.id);
  }
  openItemPayment(item:StockItem):void{const intake=this.intakeFor(item.intake_id);if(intake)void this.openPayment(intake);}
  closePayment():void{if(this.saving)return;if(this.pending?.kind==='payment'){this.formError='Retry this payment to confirm its result before closing.';return;}this.paymentIntake=null;this.formError='';}
  async submitPayment():Promise<void>{
    if(!this.canManage||!this.paymentIntake||this.saving)return;
    if(!this.pending){
      try{
        if(!this.network.isOnline)throw new Error('You are offline. Reconnect before recording a payment.');
        const amount=parseFixed(this.paymentAmount,2);
        if(amount<=0n)throw new Error('Payment amount must be positive.');
        if(amount>parseFixed(this.outstanding(this.paymentIntake),2))throw new Error('Payment cannot exceed the remaining manufacturer balance.');
        this.pending={kind:'payment',key:crypto.randomUUID(),intakeId:this.paymentIntake.id,amount:formatFixed(amount,2),method:this.paymentMethod,paymentDate:this.paymentDate,reference:this.paymentReference.trim()||null};
      }catch(error){this.formError=error instanceof Error?error.message:'Check payment details.';return;}
    }
    await this.executePending();
  }
  openSold(item:StockItem):void{this.actionItem=item;this.actionMode='sold';this.soldTo='';this.soldDate=this.localDate();this.formError='';this.pending=null;}
  openReturn(item:StockItem):void{this.actionItem=item;this.actionMode='returned';this.returnReason='defect';this.returnNote='';this.returnedDate=this.localDate();this.formError='';this.pending=null;}
  closeAction():void{if(this.saving)return;if(this.pending?.kind==='sold'||this.pending?.kind==='returned'){this.formError='Retry this action to confirm its result before closing.';return;}this.actionItem=null;this.actionMode=null;this.formError='';}
  async submitItemAction():Promise<void>{
    if(!this.canManage||!this.actionItem||!this.actionMode||this.saving)return;
    if(!this.pending){
      try{
        if(!this.network.isOnline)throw new Error('You are offline. Reconnect before updating stock.');
        this.pending=this.actionMode==='sold'
          ?{kind:'sold',key:crypto.randomUUID(),itemId:this.actionItem.id,soldTo:this.soldTo.trim(),soldDate:this.soldDate}
          :{kind:'returned',key:crypto.randomUUID(),itemId:this.actionItem.id,reason:this.returnReason,note:this.returnNote.trim()||null,returnedDate:this.returnedDate};
        if(this.pending.kind==='sold'&&!this.pending.soldTo)throw new Error('Enter the customer name.');
      }catch(error){this.pending=null;this.formError=error instanceof Error?error.message:'Check the item update.';return;}
    }
    await this.executePending();
  }
  private async executePending():Promise<void>{
    const action=this.pending,client=this.workspaceService.client,workspace=this.workspace;
    if(!action||!client||!workspace||this.saving)return;
    if(!this.network.isOnline){this.formError='You are offline. The action was not submitted. Reconnect and retry safely.';return;}
    this.saving=true;this.formError='';let definitiveError=false;const controller=new AbortController();
    try{
      let request;
      if(action.kind==='intake')request=client.rpc('ss_stock_intake',{p_business_id:workspace.id,p_supplier_id:action.supplierId,p_idempotency_key:action.key,p_received_date:action.receivedDate,p_items:action.items,p_initial_paid:action.initialPaid,p_payment_method:action.paymentMethod,p_payment_date:action.paymentDate,p_payment_reference:action.paymentReference});
      else if(action.kind==='payment')request=client.rpc('ss_stock_record_payment',{p_business_id:workspace.id,p_intake_id:action.intakeId,p_idempotency_key:action.key,p_amount:action.amount,p_method:action.method,p_payment_date:action.paymentDate,p_reference:action.reference});
      else if(action.kind==='sold')request=client.rpc('ss_stock_mark_sold',{p_business_id:workspace.id,p_stock_item_id:action.itemId,p_idempotency_key:action.key,p_sold_to:action.soldTo,p_sold_date:action.soldDate});
      else request=client.rpc('ss_stock_mark_returned',{p_business_id:workspace.id,p_stock_item_id:action.itemId,p_idempotency_key:action.key,p_reason:action.reason,p_note:action.note,p_returned_date:action.returnedDate});
      const result=await this.withTimeout(request,`Saving ${action.kind}`,()=>controller.abort());
      if(result.error){definitiveError=true;throw new Error(`${result.error.code??'Supabase'}: ${result.error.message}`);}
      if(!result.data)throw new Error('The database did not confirm the stock update. Retry the same action safely.');
      this.pending=null;
      if(action.kind==='intake'){this.intakeOpen=false;this.draftItems=[this.emptyLine()];this.supplierId='';this.receivedDate=this.localDate();this.initialPaid='0.00';this.initialPaymentDate=this.localDate();this.initialPaymentReference='';this.successMessage='Stock intake and initial manufacturer payment saved.';}
      else if(action.kind==='payment'){this.paymentIntake=null;this.successMessage='Manufacturer payment recorded.';}
      else{this.actionItem=null;this.actionMode=null;this.successMessage=action.kind==='sold'?'Item marked sold.':'Item marked returned and removed from available stock.';}
      await this.load();
    }catch(error){this.formError=error instanceof Error?error.message:'Could not save the stock update.';if(definitiveError)this.pending=null;}
    finally{this.saving=false;this.cdr.markForCheck();}
  }
  intakeFor(id:string):StockIntake|undefined{return this.intakeMap.get(id);}
  supplierName(id:string|undefined):string{return id?this.supplierMap.get(id)??'Manufacturer unavailable':'—';}
  paymentStatus(intake:StockIntake|undefined):string{if(!intake)return'—';const paid=parseFixed(intake.paid_total,2),total=parseFixed(intake.total_cost,2);return paid===0n?'Unpaid':paid>=total?'Paid':'Part paid';}
  hasOutstanding(intake:StockIntake|undefined):boolean{return !!intake&&parseFixed(intake.paid_total,2)<parseFixed(intake.total_cost,2);}
  outstanding(intake:StockIntake):string{return formatFixed(parseFixed(intake.total_cost,2)-parseFixed(intake.paid_total,2),2);}
  availableWeight(metal:Metal):string{const row=this.summary.find(item=>item.metal===metal);return this.weight(row?.available_weight_g??0);}
  availableCount(metal:Metal):number{return this.summary.find(item=>item.metal===metal)?.available_items??0;}
  weight(value:string|number):string{return formatFixed(parseFixed(String(value),4),4);}
  money(value:string):string{return formatInr(value,2);}
  returnReasonLabel(reason:ReturnReason|null):string{return reason==='defect'?'Defective':reason==='customer_disliked'?'Customer did not like':reason==='different_design'?'Different design requested':reason==='other'?'Other reason':'Returned';}
  previousPage():void{if(this.page>0){this.page--;void this.load();}}
  nextPage():void{if((this.page+1)*this.pageSize<this.itemCount){this.page++;void this.load();}}
  private emptyLine():IntakeLineDraft{return{description:'',metal:'gold',purity:'',weight_g:'',purchase_cost:''};}
  private localDate():string{const now=new Date();return`${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;}
  private async withTimeout<T>(request:PromiseLike<T>,action:string,abort?:()=>void):Promise<T>{let timer:ReturnType<typeof setTimeout>|undefined;try{return await Promise.race([Promise.resolve(request),new Promise<T>((_,reject)=>{timer=setTimeout(()=>{abort?.();reject(new Error(`${action} timed out. Retry the same request; its idempotency key prevents duplicate updates.`));},20000);})]);}finally{if(timer)clearTimeout(timer);}}
}
