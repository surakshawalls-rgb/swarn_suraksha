import { CommonModule } from '@angular/common';
import { ChangeDetectorRef, Component, OnDestroy, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { IonicModule } from '@ionic/angular';
import { Subscription } from 'rxjs';
import { NetworkStatusService } from '../../core/network/network-status.service';
import { formatFixed, formatInr, parseFixed } from '../../core/financial/decimal';
import { BusinessWorkspace, WorkspaceService } from '../dashboard/workspace.service';

type ExpenseMethod='cash'|'upi'|'bank_transfer'|'card';
interface Expense { id:string; expense_number:number; category:string; description:string; payee:string|null; amount:string; method:ExpenseMethod; reference:string|null; occurred_at:string; created_at:string; }
interface ExpenseDraft { category:string; description:string; payee:string; amount:string; method:ExpenseMethod; reference:string; occurredOn:string; }
interface PendingExpense { key:string; category:string; description:string; payee:string|null; amount:string; method:ExpenseMethod; reference:string|null; occurredAt:string; }

@Component({
  standalone:true,
  imports:[CommonModule,FormsModule,IonicModule,RouterLink],
  template:`
    <header class="topbar"><div class="crumb"><a routerLink="/dashboard">Overview</a><span>›</span><b>Expenses</b></div><div class="top-actions"><button *ngIf="canManage" class="primary-btn" type="button" (click)="editing=!editing" [disabled]="!!pending">＋ Record expense</button><button class="text-btn" type="button" (click)="load()" [disabled]="loading">Refresh</button></div></header>
    <section class="content customers-page purchases-page expenses-page">
      <div class="welcome"><div><p class="eyebrow">OPERATING COSTS · PAID EXPENSES</p><h1>Expenses</h1><p class="subtitle">Record business costs that have been paid and track the linked cashbook outflow.</p></div></div>
      <div class="config-banner"><span class="banner-icon">i</span><div><b>Expense tax is not configured</b><p>Amounts are recorded as entered; no GST or tax deduction is calculated. Expenses are immediate paid outflows, not unpaid supplier bills.</p></div></div>
      <div class="config-banner error-banner" *ngIf="errorMessage" role="alert"><span class="banner-icon">!</span><div><b>Expense records unavailable</b><p>{{errorMessage}}</p></div><button class="text-btn" type="button" (click)="load()">Retry</button></div>
      <p class="save-success" *ngIf="successMessage" role="status">{{successMessage}}</p>
      <div class="status-card" *ngIf="loading"><span class="spinner"></span><div><b>Loading expenses</b><p>Reading workspace expenses allowed by row-level security.</p></div></div>
      <div class="config-banner" *ngIf="workspace && !canManage" role="status"><span class="banner-icon">i</span><div><b>Owner or administrator access required</b><p>Expense details and posting are restricted to workspace owners and administrators.</p></div></div>

      <section class="panel customer-editor" *ngIf="editing && canManage && !pending">
        <div class="panel-head"><div><h2>Record a paid expense</h2><p>Posting is immutable. Corrections require a separately recorded adjustment.</p></div><button class="text-btn" type="button" (click)="editing=false">Cancel</button></div>
        <form class="customer-form purchase-form" (ngSubmit)="post()">
          <label>Category<input [(ngModel)]="draft.category" name="expenseCategory" required minlength="2" maxlength="80" placeholder="e.g. Rent, utilities, repairs"></label>
          <label>Description<input [(ngModel)]="draft.description" name="expenseDescription" required minlength="3" maxlength="300" placeholder="What was paid for?"></label>
          <label>Paid to (optional)<input [(ngModel)]="draft.payee" name="expensePayee" maxlength="160"></label>
          <label>Amount (₹)<input [(ngModel)]="draft.amount" name="expenseAmount" inputmode="decimal" required></label>
          <label>Payment method<select [(ngModel)]="draft.method" name="expenseMethod"><option value="cash">Cash</option><option value="upi">UPI</option><option value="bank_transfer">Bank transfer</option><option value="card">Card</option></select></label>
          <label>Payment reference (optional)<input [(ngModel)]="draft.reference" name="expenseReference" maxlength="120"></label>
          <label>Date paid<input type="date" [(ngModel)]="draft.occurredOn" name="expenseDate" required></label>
          <p class="form-error" *ngIf="formError" role="alert">{{formError}}</p>
          <p class="duplicate-warning" role="note">The expense and cashbook outflow post atomically. This does not create a tax calculation or an account balance.</p>
          <div class="form-actions"><button class="primary-btn" type="submit" [disabled]="saving || !(network.online$ | async)">{{saving?'Posting expense…':!(network.online$ | async)?'Offline — posting disabled':'Post expense'}}</button></div>
        </form>
      </section>
      <section class="panel customer-editor pending-purchase" *ngIf="pending"><b>Expense result is not confirmed</b><p>Retry the exact same expense safely; its idempotency key prevents a duplicate.</p><p class="form-error" *ngIf="formError" role="alert">{{formError}}</p><button class="primary-btn" type="button" (click)="post()" [disabled]="saving || !(network.online$ | async)">{{saving?'Checking result…':'Retry same expense safely'}}</button></section>

      <section class="panel customer-list" *ngIf="!loading && canManage">
        <div class="panel-head"><div><h2>Recent paid expenses</h2><p>{{expenses.length}} of up to 200 most recent records · totals below cover this list.</p></div><button class="text-btn" type="button" (click)="exportCsv()" [disabled]="!expenses.length">Export CSV</button></div>
        <div class="purchase-summary" *ngIf="expenses.length"><span>Shown expenses</span><b>{{inr(totalShown())}}</b></div>
        <div class="table-wrap" *ngIf="expenses.length; else noExpenses"><table><thead><tr><th>Expense</th><th>Date paid</th><th>Category / description</th><th>Paid to</th><th>Method</th><th>Amount</th></tr></thead><tbody>
          <tr *ngFor="let row of expenses"><td><b>#{{row.expense_number}}</b><small>Recorded {{row.created_at | date:'d MMM y, h:mm a':'Asia/Kolkata'}}</small></td><td>{{row.occurred_at | date:'d MMM y':'Asia/Kolkata'}}</td><td>{{row.category}}<small>{{row.description}}</small></td><td>{{row.payee || '—'}}</td><td>{{row.method | titlecase}}<small>{{row.reference || ''}}</small></td><td>{{inr(row.amount)}}</td></tr>
        </tbody></table></div>
        <ng-template #noExpenses><div class="empty-state customer-empty"><b>No paid expenses recorded</b><p>Record an operating cost after it has been paid.</p></div></ng-template>
      </section>
    </section>
  `
})
export class ExpensesComponent implements OnInit,OnDestroy {
  loading=true;saving=false;editing=false;errorMessage='';formError='';successMessage='';expenses:Expense[]=[];workspace:BusinessWorkspace|null=null;
  draft:ExpenseDraft={category:'',description:'',payee:'',amount:'',method:'cash',reference:'',occurredOn:this.todayInKolkata()};pending:PendingExpense|null=null;
  private subscription:Subscription|null=null;private requestId=0;
  constructor(private readonly workspaceService:WorkspaceService,readonly network:NetworkStatusService,private readonly cdr:ChangeDetectorRef){}
  get canManage():boolean{return this.workspace?.role==='owner'||this.workspace?.role==='admin';}
  ngOnInit():void{this.subscription=this.workspaceService.activeWorkspace$.subscribe(workspace=>{
    if(workspace&&workspace.id===this.workspace?.id&&workspace.role===this.workspace?.role)return;
    this.workspace=workspace;this.requestId++;this.expenses=[];this.pending=null;this.editing=false;
    if(workspace&&this.canManage)void this.load();else{this.loading=false;this.errorMessage=workspace?'Owner or administrator access is required.':'Select a business workspace.';this.cdr.markForCheck();}
  });}
  ngOnDestroy():void{this.subscription?.unsubscribe();this.requestId++;}
  async load():Promise<void>{
    const requestId=++this.requestId,workspace=this.workspace,client=this.workspaceService.client;
    if(!workspace||!client||!this.canManage){this.loading=false;this.errorMessage=!workspace?'Select a business workspace.':!client?'Supabase is not configured.':'Owner or administrator access is required.';this.cdr.markForCheck();return;}
    this.loading=true;this.errorMessage='';const controller=new AbortController();
    try{
      const request=client.from('ss_expenses').select('id,expense_number,category,description,payee,amount,method,reference,occurred_at,created_at').eq('business_id',workspace.id).order('occurred_at',{ascending:false}).order('expense_number',{ascending:false}).limit(200).abortSignal(controller.signal);
      const result=await this.withTimeout(request,'Loading expenses',()=>controller.abort());
      if(result.error)throw new Error(`${result.error.code??'Supabase'}: ${result.error.message}`);
      if(requestId===this.requestId)this.expenses=(result.data??[]) as Expense[];
    }catch(error){if(requestId===this.requestId){this.expenses=[];this.errorMessage=error instanceof Error?error.message:'Could not load expense records.';}}
    finally{if(requestId===this.requestId){this.loading=false;this.cdr.markForCheck();}}
  }
  async post():Promise<void>{
    if(this.saving||!this.workspace||!this.canManage)return;
    if(!this.network.isOnline){this.formError='You are offline. The expense was not submitted.';return;}
    const client=this.workspaceService.client;if(!client){this.formError='Supabase is not configured.';return;}
    if(!this.pending){
      try{
        const amount=parseFixed(this.draft.amount,2),category=this.draft.category.trim(),description=this.draft.description.trim(),payee=this.draft.payee.trim(),reference=this.draft.reference.trim();
        if(category.length<2||description.length<3)throw new Error('Enter an expense category and a description.');
        if(amount<=0n)throw new Error('Expense amount must be greater than zero.');
        if(!this.draft.occurredOn)throw new Error('Choose the date the expense was paid.');
        this.pending={key:crypto.randomUUID(),category,description,payee:payee||null,amount:formatFixed(amount,2),method:this.draft.method,reference:reference||null,occurredAt:`${this.draft.occurredOn}T12:00:00+05:30`};
      }catch(error){this.formError=error instanceof Error?error.message:'Check expense details.';return;}
    }
    this.saving=true;this.formError='';const controller=new AbortController();let timedOut=false;let definitiveError=false;
    try{
      const p=this.pending;
      const request=client.rpc('ss_post_expense',{p_business_id:this.workspace.id,p_idempotency_key:p.key,p_category:p.category,p_description:p.description,p_payee:p.payee,p_amount:p.amount,p_method:p.method,p_reference:p.reference,p_occurred_at:p.occurredAt}).abortSignal(controller.signal);
      const result=await this.withTimeout(request,'Posting expense',()=>{timedOut=true;controller.abort();});
      if(result.error){definitiveError=true;throw new Error(`${result.error.code??'Supabase'}: ${result.error.message}`);}
      if(!result.data)throw new Error('The database did not confirm the expense ID. Retry safely.');
      this.pending=null;this.editing=false;this.successMessage='Expense and cashbook outflow were posted together.';this.draft={category:'',description:'',payee:'',amount:'',method:'cash',reference:'',occurredOn:this.todayInKolkata()};await this.load();
    }catch(error){this.formError=error instanceof Error?error.message:'Could not post expense.';if(definitiveError)this.pending=null;else if(!timedOut&&!this.pending)this.pending=null;}
    finally{this.saving=false;this.cdr.markForCheck();}
  }
  totalShown():string{return formatFixed(this.expenses.reduce((sum,row)=>sum+parseFixed(row.amount,2),0n),2);}
  inr(value:string):string{return formatInr(value,2);}
  exportCsv():void{
    if(!this.expenses.length)return;
    const headers=['Expense','Date paid (IST)','Category','Description','Payee','Method','Reference','Amount INR'];
    const rows=this.expenses.map(row=>[row.expense_number,new Intl.DateTimeFormat('en-IN',{dateStyle:'medium',timeZone:'Asia/Kolkata'}).format(new Date(row.occurred_at)),row.category,row.description,row.payee??'',row.method,row.reference??'',row.amount]);
    const csv=[headers,...rows].map(row=>row.map(value=>this.csvCell(value)).join(',')).join('\r\n');
    const blob=new Blob(['\uFEFF',csv],{type:'text/csv;charset=utf-8'}),url=URL.createObjectURL(blob),anchor=document.createElement('a');anchor.href=url;anchor.download='swarnasuraksha-expenses.csv';anchor.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  private csvCell(value:unknown):string{const text=String(value??'');const safe=/^[\s\u0000-\u001f]*[=+\-@]/.test(text)?`'${text}`:text;return `"${safe.replace(/"/g,'""')}"`;}
  private todayInKolkata():string{return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kolkata',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());}
  private async withTimeout<T>(request:PromiseLike<T>,action:string,abort:()=>void):Promise<T>{let timer:ReturnType<typeof setTimeout>|undefined;try{return await Promise.race([Promise.resolve(request),new Promise<T>((_,reject)=>{timer=setTimeout(()=>{abort();reject(new Error(`${action} timed out after 20 seconds. Retry the same expense safely.`));},20000);})]);}finally{if(timer)clearTimeout(timer);}}
}
