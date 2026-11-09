import { CommonModule } from '@angular/common';
import { ChangeDetectorRef, Component, EventEmitter, Input, Output } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { IonicModule } from '@ionic/angular';
import { formatFixed, formatInr, parseFixed } from './decimal';
import { SupabaseService } from '../supabase/supabase.service';
import { NetworkStatusService } from '../network/network-status.service';

type LedgerKind = 'sale' | 'purchase';
type Method = 'cash' | 'upi' | 'bank_transfer' | 'card';
interface PendingPayment { key: string; amount: string; method: Method; reference: string | null; }

@Component({
  selector: 'ss-ledger-payment', standalone: true,
  imports: [CommonModule, FormsModule, IonicModule],
  template: `
    <div class="ledger-payment">
      <button *ngIf="!editing && !pending && isSettled" class="settled-pill" type="button" disabled>Settled</button>
      <button *ngIf="!editing && !pending && hasRemaining" class="text-btn" type="button" (click)="editing=true">Record payment</button>
      <div class="payment-editor" *ngIf="editing || pending">
        <p *ngIf="!pending">Remaining: <b>{{inr(remainingMinor)}}</b></p>
        <form *ngIf="!pending" (ngSubmit)="save()">
          <label>Amount (â‚¹)<input [(ngModel)]="amount" name="ledgerPaymentAmount" inputmode="decimal" required></label>
          <label>Method<select [(ngModel)]="method" name="ledgerPaymentMethod"><option value="cash">Cash</option><option value="upi">UPI</option><option value="bank_transfer">Bank transfer</option><option value="card">Card</option></select></label>
          <label>Reference (optional)<input [(ngModel)]="reference" name="ledgerPaymentReference" maxlength="120"></label>
          <p class="form-error" *ngIf="errorMessage" role="alert">{{errorMessage}}</p>
          <div class="form-actions"><button class="primary-btn" type="submit" [disabled]="saving || !(network.online$ | async)">{{saving?'Recordingâ€¦':!(network.online$ | async)?'Offline â€” disabled':'Save payment'}}</button><button class="text-btn" type="button" (click)="editing=false" [disabled]="saving">Cancel</button></div>
        </form>
        <div *ngIf="pending"><p class="payment-pending">Payment result is uncertain. Retry the exact same amount and method safely.</p><p class="form-error" *ngIf="errorMessage" role="alert">{{errorMessage}}</p><button class="primary-btn" type="button" (click)="save()" [disabled]="saving || !(network.online$ | async)">{{saving?'Checkingâ€¦':'Retry safely'}}</button></div>
      </div>
    </div>
  `
})
export class LedgerPaymentComponent {
  @Input({ required: true }) kind!: LedgerKind;
  @Input({ required: true }) transactionId!: string;
  @Input({ required: true }) businessId!: string;
  @Input({ required: true }) remaining = '0.00';
  @Output() saved = new EventEmitter<void>();
  editing = false; saving = false; amount = ''; method: Method = 'cash'; reference = ''; errorMessage = '';
  pending: PendingPayment | null = null;
  constructor(private readonly supabase: SupabaseService, readonly network: NetworkStatusService, private readonly cdr: ChangeDetectorRef) {}
  get remainingMinor(): bigint { try { return parseFixed(this.remaining,2); } catch { return 0n; } }
  get hasRemaining(): boolean { return this.remainingMinor > 0n; }
  get isSettled(): boolean { return !this.hasRemaining; }
  inr(value: bigint): string { return formatInr(formatFixed(value,2),2); }

  async save(): Promise<void> {
    if(this.saving)return;
    if(!this.network.isOnline){this.errorMessage='You are offline. The payment was not submitted; reconnect and retry.';return;}
    const client=this.supabase.client;if(!client){this.errorMessage='Supabase is not configured.';return;}
    if(!this.pending){
      try{
        const minor=parseFixed(this.amount,2);
        if(minor<=0n)throw new Error('Enter a payment greater than zero.');
        if(minor>this.remainingMinor)throw new Error('Payment exceeds the remaining bill balance. Refresh the bill and retry.');
        this.pending={key:crypto.randomUUID(),amount:formatFixed(minor,2),method:this.method,reference:this.reference.trim()||null};
      }catch(error){this.errorMessage=error instanceof Error?error.message:'Check the payment amount.';return;}
    }
    const submission=this.pending;
    if(!submission)return;
    this.saving=true;this.errorMessage='';let definitiveError=false;const controller=new AbortController();
    try{
      const rpc=this.kind==='sale'?'ss_record_sale_payment':'ss_record_purchase_payment';
      const args=this.kind==='sale'
        ? {p_business_id:this.businessId,p_sale_id:this.transactionId,p_idempotency_key:submission.key,p_amount:submission.amount,p_method:submission.method,p_reference:submission.reference}
        : {p_business_id:this.businessId,p_purchase_id:this.transactionId,p_idempotency_key:submission.key,p_amount:submission.amount,p_method:submission.method,p_reference:submission.reference};
      const result=await this.withTimeout(client.rpc(rpc,args).abortSignal(controller.signal),()=>controller.abort());
      if(result.error){definitiveError=true;throw new Error(`${result.error.code??'Supabase'}: ${result.error.message}`);}
      if(!result.data)throw new Error('The database did not confirm a payment ID. Retry safely.');
      this.pending=null;this.editing=false;this.amount='';this.reference='';this.saved.emit();
    }catch(error){this.errorMessage=error instanceof Error?error.message:'Could not record the payment.';if(definitiveError)this.pending=null;}
    finally{this.saving=false;this.cdr.markForCheck();}
  }
  private async withTimeout<T>(request:PromiseLike<T>,abort:()=>void):Promise<T>{let timer:ReturnType<typeof setTimeout>|undefined;try{return await Promise.race([Promise.resolve(request),new Promise<T>((_,reject)=>{timer=setTimeout(()=>{abort();reject(new Error('Payment request timed out after 20 seconds. Retry with the same key.'));},20000);})]);}finally{if(timer)clearTimeout(timer);}}
}


