import { drawBusinessLetterhead } from '../../core/financial/business-letterhead';
import { MarketRateService } from '../../core/market/market-rate.service';
import { CommonModule } from '@angular/common';
import { ChangeDetectorRef, Component, OnDestroy, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { IonicModule } from '@ionic/angular';
import { Subscription } from 'rxjs';
import type { jsPDF } from 'jspdf';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { formatFixed, formatInr, parseFixed } from '../../core/financial/decimal';
import { girviBalancesAt, girviCollateralValue, girviElapsedDays } from '../../core/financial/girvi';
import { BusinessWorkspace, WorkspaceService } from '../dashboard/workspace.service';

type PaymentMethod = 'cash' | 'upi' | 'bank_transfer' | 'card';
interface Customer { id: string; full_name: string; phone: string | null; address?: unknown; }
interface CollateralItem {
  id: string; girvi_id: string; item_number: number; description: string; condition_notes: string | null; metal: 'gold' | 'silver';
  purity: string; weight_g: string; rate_per_gram: string; estimated_market_value: string;
}
interface DraftCollateralItem {
  description: string; conditionNotes: string; metal: 'gold' | 'silver'; purity: string; weight: string; rate: string; customPurityFactor: string;
}
interface Pledge {
  id: string; customer_id: string; girvi_number: number; metal: 'gold' | 'silver' | 'mixed'; purity: string | null;
  weight_g: string; rate_per_gram: string; estimated_market_value: string; principal_amount: string;
  principal_balance: string; interest_balance: string; monthly_interest_percent: string; girvi_date: string;
  last_accrued_date?: string; maturity_date?: string; customer_name_snapshot: string | null; customer_phone_snapshot: string | null;
  customer_address_snapshot: string | null; last_accrued_months: number; status: 'active' | 'closed';
  closed_at: string | null; notes: string | null;
}
interface Payment { id: string; amount: string; payment_method: PaymentMethod; interest_paid: string; principal_paid: string; payment_date: string; }
interface TopUp { id: string; amount: string; payment_method: PaymentMethod; topup_date: string; }

@Component({
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, IonicModule],
  template: `
    <header class="topbar"><div class="crumb"><a routerLink="/dashboard">Home</a><span>›</span><b>Girvi</b></div>
      <div class="top-actions"><button *ngIf="canPost" class="primary-btn fab-action" type="button" (click)="showCreate = !showCreate">{{showCreate ? 'Close' : '＋ New Girvi'}}</button></div>
    </header>
    <section class="content customers-page">
      <div class="welcome"><div><p class="eyebrow">PLEDGE MANAGEMENT</p><h1>Girvi</h1><p class="subtitle">Manage gold and silver pledges, payments and releases.</p></div></div>
      <div class="config-banner error-banner" *ngIf="error" role="alert"><span class="banner-icon">!</span><div><b>Girvi data unavailable</b><p>{{error}}</p></div><button class="text-btn" type="button" (click)="load()">Retry</button></div>
      <p class="save-success" *ngIf="success" role="status">{{success}}</p>
      <div class="config-banner" *ngIf="workspace?.role === 'staff'" role="status"><span class="banner-icon">i</span><div><b>Girvi posting is restricted</b><p>Only owners and administrators can post pledges and payments.</p></div></div>

      <section class="panel customer-editor" *ngIf="showCreate && canPost">
        <div class="panel-head"><div><h2>New Girvi</h2><p>The saved market rate and estimated value will not change later.</p></div></div>
        <form class="customer-form" (ngSubmit)="create()">
          <div class="customer-search-field">
            <label for="girvi-customer-search">Find customer by name, mobile or address</label>
            <input id="girvi-customer-search" [(ngModel)]="customerSearch" name="customerSearch"
              (ngModelChange)="customerSearchChanged()" autocomplete="off"
              [placeholder]="selectedCustomer ? 'Customer selected' : 'Start typing a name, mobile or address'"
              [disabled]="!!selectedCustomer">
            <span class="customer-search-results" *ngIf="customerSearch.trim() && !selectedCustomer"
              role="listbox" aria-label="Matching customers">
              <button *ngFor="let customer of filteredCustomers()" type="button" role="option"
                (click)="selectCustomer(customer)">
                <b>{{customer.full_name}}</b>
                <small>{{customer.phone || 'No mobile'}}{{customerAddress(customer) ? ' · ' + customerAddress(customer) : ''}}</small>
              </button>
              <span *ngIf="!filteredCustomers().length" class="customer-search-empty">No matching customer. Register a new customer below.</span>
            </span>
            <div class="selected-customer" *ngIf="selectedCustomer">
              <span>Selected customer <b>{{selectedCustomer.full_name}}</b> · {{selectedCustomer.phone || 'No mobile'}}</span>
              <button type="button" class="text-btn" (click)="clearCustomerSelection()">Change</button>
            </div>
          </div>
          <details class="quick-customer"><summary>Register a new customer</summary>
            <div class="payment-line"><label>Full name<input [(ngModel)]="newCustomer.name" name="newName"></label>
              <label>Mobile<input [(ngModel)]="newCustomer.phone" name="newPhone" inputmode="tel"></label>
              <label>Address / village<input [(ngModel)]="newCustomer.address" name="newAddress"></label>
              <button class="text-btn" type="button" (click)="addCustomer()" [disabled]="!newCustomer.name.trim()">Save customer</button></div>
            <p class="form-error" *ngIf="customerError">{{customerError}}</p>
          </details>
          <div class="girvi-collateral-head"><div><h3>Jewellery received</h3><p>Confirm the local agreed rate for each item; market quotes are indicative. Saved rates and item values will not change.</p></div>
            <button class="text-btn" type="button" (click)="addCollateralItem()" [disabled]="draft.items.length >= 100">＋ Add item</button></div>
          <article class="girvi-item" *ngFor="let item of draft.items; let i = index">
            <div class="girvi-item-head"><b>Item {{i + 1}}</b><button *ngIf="draft.items.length > 1" class="text-btn" type="button" (click)="removeCollateralItem(i)">Remove</button></div>
            <div class="field-row">
              <label>Description<input [(ngModel)]="item.description" [name]="'itemDescription'+i" maxlength="180" required placeholder="Ring, nose ring, chain…"></label>
              <label>Identifying marks / condition<textarea [(ngModel)]="item.conditionNotes" [name]="'itemCondition'+i" maxlength="500" rows="1" placeholder="Hallmark, stone, scratches or existing damage"></textarea></label>
              <label>Metal<select [(ngModel)]="item.metal" [name]="'itemMetal'+i" (ngModelChange)="collateralMetalChanged(item)"><option value="gold">Gold</option><option value="silver">Silver</option></select></label>
              <label>Purity<select [(ngModel)]="item.purity" [name]="'itemPurity'+i" (ngModelChange)="item.rate = ''">
                <ng-container *ngIf="item.metal === 'gold'"><option>24K</option><option>22K</option><option>20K</option><option>18K</option><option>16K</option></ng-container>
                <ng-container *ngIf="item.metal === 'silver'"><option>999</option><option>925</option><option>Custom</option></ng-container>
              </select></label>
              <label>Net weight (g)<input [(ngModel)]="item.weight" [name]="'itemWeight'+i" type="number" min="0.0001" step="0.0001" required></label>
              <label *ngIf="item.metal === 'silver' && item.purity === 'Custom'">Custom purity factor<input [(ngModel)]="item.customPurityFactor" [name]="'itemFactor'+i" type="number" min="0.000001" max="0.999999" step="0.000001" required></label>
            </div>
            <p class="girvi-rate-note" *ngIf="item.metal === 'gold' && item.purity === '16K'">16K reference rate is calculated proportionally from the 18K market quote; confirm or edit the agreed rate.</p>
            <div class="payment-line">
              <button class="text-btn" type="button" (click)="fetchRate(item)" [disabled]="rateLoading">{{rateLoading ? 'Fetching rate…' : 'Use cached rate'}}</button>
              <label>Agreed rate / gram (₹)<input [(ngModel)]="item.rate" [name]="'itemRate'+i" type="number" min="0.0001" step="0.0001" required></label>
              <span class="girvi-item-value">Assessed value <b>{{inr(itemValue(item))}}</b></span>
            </div>
          </article>
          <div class="girvi-total"><span>Total assessed jewellery value</span><b>{{inr(estimatedValue)}}</b></div>
          <div class="field-row">
            <label>Cash given to customer (₹)<input [(ngModel)]="draft.principal" name="principal" type="number" min="0.01" [max]="estimatedValue" step="0.01" required></label>
            <label>Disbursement method<select [(ngModel)]="draft.disbursementMethod" name="disbursementMethod"><option value="cash">Cash</option><option value="upi">UPI</option><option value="bank_transfer">Bank transfer</option><option value="card">Card</option></select></label>
            <label>Interest per month (%)<input [(ngModel)]="draft.interestPercent" name="interestPercent" type="number" min="2" max="10" step="0.25" required></label>
            <label>Loan date<input [(ngModel)]="draft.date" name="date" type="date" required></label>
            <label>Agreed repayment date<input [(ngModel)]="draft.maturityDate" name="maturityDate" type="date" [min]="draft.date" required></label>
          </div>
          <label>Notes (optional)<textarea [(ngModel)]="draft.notes" name="notes" rows="2" maxlength="2000"></textarea></label>
          <p>Interest compounds daily at an effective monthly rate of 2%–10% over each 30-day rate period. Payments are applied to accrued interest first, then principal; jewellery is released only after the full outstanding is paid.</p>
          <p class="form-error" *ngIf="formError" role="alert">{{formError}}</p>
          <div class="form-actions"><button class="primary-btn" type="submit" [disabled]="saving || !draft.customerId">{{saving ? 'Saving…' : 'Create Girvi'}}</button></div>
        </form>
      </section>

      <section class="panel customer-editor girvi-detail-panel" *ngIf="selected as pledge">
        <div class="panel-head girvi-details-head">
          <div><p class="eyebrow">PLEDGE DETAILS</p><h2>Girvi <span>#{{pledge.girvi_number}}</span></h2></div>
          <div class="girvi-details-actions"><span class="customer-status" [class.status-active]="pledge.status === 'active'">{{pledge.status | titlecase}}</span><button class="girvi-close-btn" type="button" (click)="closeDetails()">Close details</button></div>
        </div>
        <div class="girvi-overview">
          <article><span>Customer</span><b>{{pledge.customer_name_snapshot || customerName(pledge.customer_id)}}</b><small>{{pledge.customer_phone_snapshot || customerPhone(pledge.customer_id) || 'No mobile'}}</small></article>
          <article><span>Original loan</span><b>{{inr(pledge.principal_amount)}}</b><small>{{pledge.girvi_date}} · {{pledge.monthly_interest_percent}}% monthly</small></article>
          <article><span>Additional advances</span><b>{{inr(totalTopUps())}}</b><small>{{inr(pledge.principal_balance)}} principal remaining</small></article>
          <article class="girvi-balance-card"><span>Current outstanding</span><b>{{inr(currentOutstanding(pledge))}}</b><small>{{inr(currentInterest(pledge))}} accrued interest · {{elapsedDays(pledge)}} days</small></article>
          <article><span>Repayment date</span><b>{{repaymentDate(pledge)}}</b><small>Interest compounds daily</small></article>
        </div>
        <div class="config-banner" *ngIf="!hasDailyAccrualSchema(pledge)" role="status"><span class="banner-icon">i</span><div><b>Database update required</b><p>Apply migration 026_girvi_daily_compounding.sql to enable daily interest and payments. Details are shown using the legacy pledge data.</p></div></div>
        <p class="form-error" *ngIf="detailError" role="alert">{{detailError}}</p>
        <section class="girvi-detail-section">
          <div class="girvi-section-title"><div><h3>Pledged jewellery</h3><p>Saved item descriptions, purity, weight and agreed valuation</p></div><span class="girvi-assessed-total"><small>Total assessed value</small><b>{{inr(pledge.estimated_market_value)}}</b></span></div>
          <div class="table-wrap girvi-collateral-wrap"><table class="girvi-items-table"><thead><tr><th>Item &amp; condition</th><th>Metal / purity</th><th>Weight</th><th>Agreed rate</th><th>Assessed value</th></tr></thead><tbody>
            <tr *ngFor="let item of detailCollateralItems(pledge)"><td data-label="Item & condition"><b>{{item.description}}</b><small *ngIf="item.condition_notes">{{item.condition_notes}}</small><small *ngIf="!item.condition_notes">No condition notes recorded</small></td><td data-label="Metal / purity"><span class="girvi-metal-pill">{{item.metal | titlecase}} · {{item.purity}}</span></td><td data-label="Weight"><b>{{item.weight_g}} g</b></td><td data-label="Agreed rate">{{inr(item.rate_per_gram)}} <small class="girvi-unit">per gram</small></td><td data-label="Assessed value"><b class="girvi-item-total">{{inr(item.estimated_market_value)}}</b></td></tr>
            <tr *ngIf="!detailCollateralItems(pledge).length"><td class="girvi-no-collateral" colspan="5">Item details are unavailable. Apply migration 025_girvi_multi_item_agreements.sql and reload this pledge.</td></tr>
          </tbody></table></div>
        </section>
        <div class="girvi-returned-note" *ngIf="pledge.status === 'closed'">Payment settled. Jewellery was returned on {{pledge.closed_at | date:'d MMM y':'Asia/Kolkata'}}.</div>
        <div class="girvi-payment" *ngIf="pledge.status === 'active' && canPost">
          <h3>Record a payment</h3><p class="girvi-payment-intro">Enter any amount for a part payment, or pay the full outstanding to close the pledge.</p><div class="payment-line">
            <label>Payment amount · partial or full<input [(ngModel)]="paymentAmount" [ngModelOptions]="{standalone:true}" type="number" min="0.01" step="0.01" [disabled]="!hasDailyAccrualSchema(pledge)" placeholder="Enter amount in ₹"></label>
            <label>Method<select [(ngModel)]="paymentMethod" [ngModelOptions]="{standalone:true}" [disabled]="!hasDailyAccrualSchema(pledge)"><option value="cash">Cash</option><option value="upi">UPI</option><option value="bank_transfer">Bank transfer</option><option value="card">Card</option></select></label>
            <label>Date<input [(ngModel)]="paymentDate" [ngModelOptions]="{standalone:true}" type="date" [disabled]="!hasDailyAccrualSchema(pledge)"></label>
            <button class="primary-btn" type="button" (click)="recordPayment(pledge)" [disabled]="saving || !paymentAmount || !hasDailyAccrualSchema(pledge)">Record part payment</button>
            <button class="text-btn" type="button" (click)="settleAndClose(pledge)" [disabled]="saving || !hasDailyAccrualSchema(pledge)">Pay full &amp; return jewellery</button>
          </div><p>Payments are applied to interest first, then principal. Full settlement returns the pledged jewellery.</p>
        </div>
        <div class="girvi-payment girvi-topup" *ngIf="pledge.status === 'active' && canPost">
          <h3>Give an additional amount</h3>
          <p class="girvi-payment-intro">Top up this active Girvi without returning the jewellery. Available against assessed value: <b>{{inr(topUpRoom(pledge))}}</b>.</p>
          <div class="payment-line">
            <label>Additional amount<input [(ngModel)]="topUpAmount" [ngModelOptions]="{standalone:true}" type="number" min="0.01" step="0.01" [max]="topUpRoom(pledge)" [disabled]="!hasDailyAccrualSchema(pledge) || !hasTopUpRoom(pledge)" placeholder="Enter amount in ₹"></label>
            <label>Method<select [(ngModel)]="topUpMethod" [ngModelOptions]="{standalone:true}" [disabled]="!hasDailyAccrualSchema(pledge)"><option value="cash">Cash</option><option value="upi">UPI</option><option value="bank_transfer">Bank transfer</option><option value="card">Card</option></select></label>
            <label>Date<input [(ngModel)]="topUpDate" [ngModelOptions]="{standalone:true}" type="date" [disabled]="!hasDailyAccrualSchema(pledge)"></label>
            <button class="primary-btn" type="button" (click)="recordTopUp(pledge)" [disabled]="saving || !topUpAmount || !hasDailyAccrualSchema(pledge) || !hasTopUpRoom(pledge)">Give additional amount</button>
          </div>
          <p>The extra amount is added to principal and starts accruing interest from the top-up date. Total principal cannot exceed the saved assessed jewellery value.</p>
        </div>
        <p class="form-error" *ngIf="paymentError" role="alert">{{paymentError}}</p>
        <p class="form-error" *ngIf="topUpError" role="alert">{{topUpError}}</p>
        <div class="config-banner" *ngIf="pledge.status === 'active' && canPost && !hasDailyAccrualSchema(pledge)" role="status"><span class="banner-icon">i</span><div><b>Part payments will be available after the database update</b><p>Apply migration 026_girvi_daily_compounding.sql to enable payment recording with daily interest.</p></div></div>
        <div class="girvi-document-actions" *ngIf="canPost">
          <div><h3>Customer agreement</h3><p>Generate a PDF copy of the agreed collateral and loan terms.</p></div>
          <button class="text-btn" type="button" (click)="previewAgreementPdf(pledge)" [disabled]="agreementPrinting">{{agreementPrinting?'Preparing PDF…':'Preview / Download PDF'}}</button>
          <button class="primary-btn btn-whatsapp" type="button" (click)="shareAgreementPdf(pledge)" [disabled]="agreementPrinting"><svg class="wa-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M17.47 14.38c-.3-.15-1.76-.87-2.03-.97-.27-.1-.47-.15-.67.15-.2.3-.77.97-.94 1.17-.17.2-.35.22-.64.07-.3-.15-1.26-.46-2.4-1.48-.89-.79-1.49-1.77-1.66-2.07-.17-.3-.02-.46.13-.61.14-.13.3-.35.45-.52.15-.17.2-.3.3-.5.1-.2.05-.37-.02-.52-.08-.15-.67-1.61-.92-2.2-.24-.58-.49-.5-.67-.51h-.57c-.2 0-.52.07-.8.37-.27.3-1.04 1.02-1.04 2.48 0 1.46 1.07 2.88 1.21 3.08.15.2 2.1 3.2 5.08 4.49.71.31 1.26.49 1.69.63.71.23 1.36.2 1.87.12.57-.09 1.76-.72 2.01-1.41.25-.7.25-1.29.17-1.41-.07-.12-.27-.2-.57-.35zM12.05 21.5h-.01a9.87 9.87 0 0 1-5.03-1.38l-.36-.21-3.74.98 1-3.65-.24-.37a9.86 9.86 0 0 1-1.51-5.26c0-5.45 4.44-9.88 9.89-9.88a9.82 9.82 0 0 1 6.99 2.9 9.82 9.82 0 0 1 2.89 6.99c0 5.45-4.44 9.88-9.88 9.88zM20.52 3.45A11.8 11.8 0 0 0 12.05 0C5.5 0 .16 5.34.16 11.89c0 2.1.55 4.14 1.59 5.95L.06 24l6.3-1.65a11.88 11.88 0 0 0 5.68 1.45h.01c6.55 0 11.89-5.34 11.89-11.89 0-3.18-1.24-6.17-3.48-8.41z"/></svg> {{agreementPrinting?'Preparing PDF…':'Share PDF on WhatsApp'}}</button>
        </div>
        <p class="form-error" *ngIf="agreementError" role="alert">{{agreementError}}</p>
        <p class="save-success" *ngIf="agreementMessage" role="status">{{agreementMessage}}</p>
        <div class="girvi-history-section">
          <div class="girvi-section-title payment-history-title"><div><h3>Additional advances</h3><p>Extra loan amounts disbursed against this pledge.</p></div><span class="girvi-payment-count">{{topUps.length}} {{topUps.length === 1 ? 'advance' : 'advances'}}</span></div>
          <div class="table-wrap girvi-history-wrap" *ngIf="topUps.length"><table class="girvi-history-table"><thead><tr><th>Date</th><th>Method</th><th>Amount advanced</th></tr></thead><tbody><tr *ngFor="let item of topUps"><td data-label="Date"><b>{{item.topup_date | date:'d MMM y':'Asia/Kolkata'}}</b></td><td data-label="Method"><span class="girvi-method-pill">{{item.payment_method | titlecase}}</span></td><td data-label="Amount advanced"><b class="girvi-history-amount">{{inr(item.amount)}}</b></td></tr></tbody></table></div>
          <div class="girvi-no-payments" *ngIf="!topUps.length"><span>₹</span><div><b>No additional advances</b><p>Any top-up given for this pledge will appear here.</p></div></div>
        </div>
        <div class="girvi-history-section">
          <div class="girvi-section-title payment-history-title"><div><h3>Payment history</h3><p>Recorded repayments and how each was applied.</p></div><span class="girvi-payment-count">{{payments.length}} {{payments.length === 1 ? 'payment' : 'payments'}}</span></div>
          <div class="table-wrap girvi-history-wrap" *ngIf="payments.length; else noPayments"><table class="girvi-history-table"><thead><tr><th>Date</th><th>Payment method</th><th>Amount received</th><th>Interest paid</th><th>Principal paid</th></tr></thead><tbody><tr *ngFor="let item of payments"><td data-label="Date"><b>{{item.payment_date | date:'d MMM y':'Asia/Kolkata'}}</b></td><td data-label="Payment method"><span class="girvi-method-pill">{{item.payment_method | titlecase}}</span></td><td data-label="Amount received"><b class="girvi-history-amount">{{inr(item.amount)}}</b></td><td data-label="Interest paid">{{inr(item.interest_paid)}}</td><td data-label="Principal paid">{{inr(item.principal_paid)}}</td></tr></tbody></table></div>
        </div>
        <ng-template #noPayments><div class="girvi-no-payments"><span>₹</span><div><b>No payments recorded yet</b><p>Any part or full payment recorded for this pledge will appear here.</p></div></div></ng-template>
      </section>

      <section class="panel customer-list">
        <div class="girvi-other-pledges" *ngIf="selected"><b>Other pledges</b><span>Close the selected details to search all customers and Girvi numbers.</span></div>
        <div class="customer-toolbar" *ngIf="!selected"><label class="search-field">Search customer, mobile or Girvi number<input [(ngModel)]="search" name="search" (ngModelChange)="filterPledges()" placeholder="Search"></label></div>
        <div class="table-wrap" *ngIf="visiblePledges.length; else noPledges"><table class="stack-table"><thead><tr><th>Girvi #</th><th>Customer / mobile</th><th>Jewellery received</th><th>Principal balance</th><th>Interest / month</th><th>Due date</th><th>Outstanding</th><th>Status</th><th>Action</th></tr></thead>
          <tbody><tr *ngFor="let pledge of visiblePledges"><td data-label="Girvi #"><b>#{{pledge.girvi_number}}</b></td><td data-label="Customer / mobile">{{pledge.customer_name_snapshot || customerName(pledge.customer_id)}}<small>{{pledge.customer_phone_snapshot || customerPhone(pledge.customer_id)}}</small></td><td data-label="Jewellery received">{{collateralDescription(pledge.id)}}<small>{{pledge.weight_g}} g · assessed {{inr(pledge.estimated_market_value)}}</small></td><td data-label="Principal balance">{{inr(pledge.principal_balance)}}</td><td data-label="Interest / month">{{pledge.monthly_interest_percent}}%</td><td data-label="Due date">{{repaymentDate(pledge)}}</td><td data-label="Outstanding"><b>{{inr(currentOutstanding(pledge))}}</b></td><td data-label="Status"><span class="customer-status" [class.status-active]="pledge.status === 'active'">{{pledge.status | titlecase}}</span></td><td class="girvi-row-action" data-label="Action"><button class="girvi-view-btn" type="button" (click)="open(pledge)" [attr.aria-label]="'View Girvi pledge ' + pledge.girvi_number">View details</button></td></tr></tbody></table></div>
        <ng-template #noPledges><div class="empty-state"><b>{{selected ? 'Selected pledge details are open above' : 'No Girvi records'}}</b><p>{{selected ? 'Close details to see it in the pledge list.' : 'New pledges will appear here.'}}</p></div></ng-template>
      </section>
    </section>
    <div class="girvi-pdf-overlay" *ngIf="agreementPdf" role="dialog" aria-modal="true" aria-label="Girvi agreement PDF preview">
      <section class="girvi-pdf-dialog">
        <header><div><p class="eyebrow">CUSTOMER AGREEMENT</p><h2>Girvi #{{agreementPledge?.girvi_number}} · PDF preview</h2></div>
          <button class="girvi-pdf-close" type="button" (click)="closeAgreementPreview()" aria-label="Close PDF preview">×</button></header>
        <div class="girvi-pdf-messages"><p class="girvi-pdf-error" *ngIf="agreementError" role="alert">{{agreementError}}</p>
          <p class="girvi-pdf-status" *ngIf="agreementMessage" role="status">{{agreementMessage}}</p></div>
        <iframe *ngIf="agreementPreviewUrl" [src]="agreementPreviewUrl" title="Girvi agreement PDF"></iframe>
        <footer><span>The PDF includes the compounded interest and outstanding balance as of {{agreementSnapshotDate}}.</span>
          <div><button class="text-btn" type="button" (click)="sharePreviewPdf()" [disabled]="agreementPrinting || !agreementPledge">Share PDF</button>
            <button class="primary-btn" type="button" (click)="downloadAgreementPdf()" [disabled]="agreementPrinting">{{agreementPrinting ? 'Preparing…' : 'Download PDF'}}</button></div>
        </footer>
      </section>
    </div>
  `,
  styles: [`
    .girvi-payment { margin: 20px 0; padding: 18px; border: 1px solid #e6ebe6; border-radius: 10px; background: #fbfcfa; }
    .girvi-payment h3 { margin: 0 0 4px; color: #2e4034; font: 700 14px 'Playfair Display'; }
    .girvi-payment p { color: #78867c; font-size: 11px; line-height: 1.55; }
    .girvi-payment .girvi-payment-intro { margin: 0 0 13px; }
    .girvi-payment .payment-line { display: grid; grid-template-columns: minmax(180px, 1.4fr) repeat(2, minmax(130px, 1fr)) auto auto; align-items: end; gap: 10px; }
    .girvi-topup .payment-line { grid-template-columns: minmax(180px, 1.4fr) repeat(2, minmax(130px, 1fr)) auto; }
    .girvi-payment label { display: grid; gap: 6px; color: #526057; font-size: 10px; font-weight: 600; }
    .girvi-payment input, .girvi-payment select { width: 100%; min-height: 40px; border: 1px solid #dfe5df; border-radius: 7px; padding: 9px 10px; background: #fff; color: #29362f; font: 11px 'DM Sans', sans-serif; }
    .girvi-payment input:disabled, .girvi-payment select:disabled { background: #f0f2ef; color: #929b94; cursor: not-allowed; }
    .girvi-payment button { min-height: 40px; white-space: nowrap; }
    .quick-customer summary { cursor: pointer; padding: 10px 0; color: #52675a; }
    .activity-row small, td small { display: block; color: #859188; }
    .girvi-collateral-head, .girvi-item-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
    .girvi-collateral-head { grid-column: 1 / -1; margin-top: 8px; }
    .girvi-collateral-head h3 { margin: 0 0 4px; color: #34443a; font-size: 14px; }
    .girvi-collateral-head p { margin: 0; color: #78867c; font-size: 11px; }
    .girvi-item { grid-column: 1 / -1; display: grid; gap: 12px; padding: 14px; border: 1px solid #e6ebe6; border-radius: 9px; background: #fcfdfb; }
    .girvi-item .field-row { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 12px; }
    .girvi-item-head { color: #35473b; font-size: 12px; }
    .girvi-item-value { align-self: end; padding: 10px 0; color: #6b796e; font-size: 11px; }
    .girvi-item-value b, .girvi-total b { color: #263a2d; }
    .girvi-rate-note { margin: -4px 0 0; color: #7c6a43; font-size: 10px; }
    .girvi-total { grid-column: 1 / -1; display: flex; justify-content: space-between; padding: 12px 14px; border-radius: 8px; background: #f5f2e9; color: #58675d; font-size: 12px; }
    .girvi-details-head { align-items: center; }
    .girvi-details-head h2, .girvi-document-actions h3, .girvi-section-title h3 { margin: 0; }
    .girvi-detail-panel { padding: 22px 24px; border-color: #e4e9e3; box-shadow: 0 5px 18px #25372a0a; }
    .girvi-details-head { padding-bottom: 15px; border-bottom: 1px solid #edf0ec; }
    .girvi-details-head h2 { color: #23352a; font-size: 20px; }
    .girvi-details-head h2 span { color: #849087; font: 500 15px 'DM Sans'; }
    .girvi-details-head .eyebrow { margin: 0 0 4px; }
    .girvi-details-actions { display: flex; align-items: center; gap: 12px; }
    .girvi-close-btn { padding: 8px 11px; border: 1px solid #e3e8e2; border-radius: 7px; background: #fff; color: #5e6d62; font: 600 10px 'DM Sans'; cursor: pointer; }
    .girvi-close-btn:hover { border-color: #bac9bc; background: #f8faf7; }
    .girvi-overview { display: grid; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); gap: 10px; margin: 16px 0 22px; }
    .girvi-overview article { min-width: 0; display: grid; gap: 5px; padding: 13px; border: 1px solid #e8ede8; border-radius: 9px; background: #fbfcfa; }
    .girvi-overview .girvi-balance-card { border-color: #dce8dd; background: #f3f8f2; }
    .girvi-overview article > span, .girvi-overview small { color: #78867c; font-size: 11px; }
    .girvi-overview article > b { color: #293b30; font-size: 14px; overflow-wrap: anywhere; }
    .girvi-detail-section { margin: 0 0 22px; }
    .girvi-section-title { display: flex; justify-content: space-between; align-items: center; gap: 12px; margin-bottom: 10px; }
    .girvi-section-title p, .girvi-document-actions p { margin: 4px 0 0; color: #78867c; font-size: 11px; }
    .girvi-section-title > b { color: #34483a; font-size: 12px; white-space: nowrap; }
    .girvi-collateral-wrap { overflow: hidden; border: 1px solid #e7ece7; border-radius: 10px; background: #fff; }
    .girvi-items-table { width: 100%; min-width: 620px; border-collapse: separate; border-spacing: 0; table-layout: fixed; text-align: left; }
    .girvi-items-table th { padding: 11px 14px; border-bottom: 1px solid #e7ece7; background: #f6f8f5; color: #7d8981; font-size: 9px; font-weight: 700; letter-spacing: .45px; text-transform: uppercase; }
    .girvi-items-table th:first-child { width: 30%; }
    .girvi-items-table th:nth-child(2) { width: 19%; }
    .girvi-items-table th:nth-child(3) { width: 13%; }
    .girvi-items-table th:nth-child(4) { width: 19%; }
    .girvi-items-table th:last-child { width: 19%; text-align: right; }
    .girvi-items-table td { padding: 14px; border-bottom: 1px solid #edf0ed; color: #56645a; font-size: 11px; vertical-align: middle; }
    .girvi-items-table tbody tr:last-child td { border-bottom: 0; }
    .girvi-items-table td:first-child b { display: block; color: #2c4033; font-size: 12px; }
    .girvi-items-table td small { display: block; max-width: 260px; margin-top: 4px; color: #89958d; font-size: 10px; line-height: 1.45; white-space: normal; }
    .girvi-items-table .girvi-unit { display: inline; margin: 0; white-space: nowrap; }
    .girvi-metal-pill { display: inline-block; padding: 5px 8px; border: 1px solid #e8e4d8; border-radius: 999px; background: #faf8f1; color: #796941; font-size: 10px; font-weight: 600; white-space: nowrap; }
    .girvi-items-table td:last-child { text-align: right; }
    .girvi-item-total { color: #2c4635; font-size: 12px; white-space: nowrap; }
    .girvi-no-collateral { padding: 20px !important; color: #78867c !important; text-align: center; line-height: 1.5; }
    .girvi-assessed-total { display: grid; gap: 3px; justify-items: end; padding: 8px 11px; border: 1px solid #e7eadf; border-radius: 8px; background: #f8f8f2; white-space: nowrap; }
    .girvi-assessed-total small { color: #7b877e; font-size: 9px; }
    .girvi-assessed-total b { color: #304638; font-size: 13px; }
    .girvi-no-payments { display: flex; align-items: center; gap: 12px; padding: 16px; border: 1px dashed #dfe6df; border-radius: 9px; background: #fafbf9; }
    .girvi-no-payments > span { display: grid; place-items: center; width: 36px; height: 36px; border-radius: 50%; background: #edf4ed; color: #608068; font-size: 16px; }
    .girvi-no-payments b { color: #44564a; font-size: 11px; }
    .girvi-no-payments p { margin: 4px 0 0; color: #849087; font-size: 10px; }
    .girvi-history-section { margin-top: 20px; padding-top: 18px; border-top: 1px solid #edf0ec; }
    .girvi-history-section .payment-history-title { margin: 0 0 12px; }
    .girvi-payment-count { padding: 5px 9px; border: 1px solid #e6ebe6; border-radius: 999px; background: #f7f9f6; color: #748177; font-size: 9px; font-weight: 600; white-space: nowrap; }
    .girvi-history-wrap { overflow: hidden; border: 1px solid #e6ebe6; border-radius: 9px; background: #fff; }
    .girvi-history-table { width: 100%; border-collapse: separate; border-spacing: 0; text-align: left; }
    .girvi-history-table th { padding: 11px 14px; border-bottom: 1px solid #e7ece7; background: #f6f8f5; color: #7d8981; font-size: 9px; font-weight: 700; letter-spacing: .4px; text-transform: uppercase; }
    .girvi-history-table td { padding: 13px 14px; border-bottom: 1px solid #edf0ed; color: #536157; font-size: 11px; vertical-align: middle; }
    .girvi-history-table tbody tr:last-child td { border-bottom: 0; }
    .girvi-history-table tbody tr:hover { background: #fbfcfa; }
    .girvi-history-table th:nth-child(n+3), .girvi-history-table td:nth-child(n+3) { text-align: right; font-variant-numeric: tabular-nums; }
    .girvi-history-table td:first-child b { color: #394b3f; font-weight: 600; white-space: nowrap; }
    .girvi-history-table .girvi-history-amount { color: #2e4937; font-weight: 700; white-space: nowrap; }
    .girvi-method-pill { display: inline-block; padding: 5px 8px; border-radius: 999px; background: #f0f4ef; color: #5b705f; font-size: 9px; font-weight: 600; }
    .girvi-returned-note { padding: 12px 14px; margin: 0 0 16px; border-radius: 8px; background: #eff7f0; color: #3e6b48; font-size: 12px; }
    .girvi-document-actions { display: flex; align-items: center; justify-content: flex-end; gap: 10px; flex-wrap: wrap; padding: 16px 0; margin-top: 18px; border-top: 1px solid #edf0eb; }
    .girvi-document-actions > div { flex: 1 1 220px; margin-right: auto; }
    .girvi-view-btn { border: 1px solid #dfe7df; border-radius: 6px; background: #f8faf7; padding: 7px 10px; color: #355b42; font: 600 10px 'DM Sans'; cursor: pointer; white-space: nowrap; }
    .girvi-view-btn:hover { border-color: #a9c0ab; background: #f0f6ef; }
    .girvi-other-pledges { display: flex; align-items: baseline; gap: 10px; margin-bottom: 14px; }
    .girvi-other-pledges b { color: #435449; font-size: 11px; }
    .girvi-other-pledges span { color: #89948d; font-size: 10px; }
    .girvi-pdf-overlay { position: fixed; inset: 0; z-index: 2100; display: grid; place-items: center; padding: 24px; background: #18241dcc; }
    .girvi-pdf-dialog { width: min(100%, 980px); height: min(92vh, 900px); display: grid; grid-template-rows: auto auto 1fr auto; gap: 12px; padding: 18px; border-radius: 12px; background: #fff; box-shadow: 0 18px 60px #10201855; }
    .girvi-pdf-dialog > header, .girvi-pdf-dialog > footer { display: flex; align-items: center; justify-content: space-between; gap: 14px; }
    .girvi-pdf-dialog h2 { margin: 0; color: #293b30; font: 700 17px 'Playfair Display'; }
    .girvi-pdf-dialog .eyebrow { margin-bottom: 4px; }
    .girvi-pdf-dialog iframe { width: 100%; height: 100%; min-height: 300px; border: 1px solid #e8ede8; border-radius: 7px; background: #f4f6f3; }
    .girvi-pdf-dialog > footer > span { color: #78867c; font-size: 11px; }
    .girvi-pdf-dialog > footer > div { display: flex; align-items: center; gap: 12px; }
    .girvi-pdf-close { width: 34px; height: 34px; border: 0; border-radius: 50%; background: #f1f4f0; color: #536258; font-size: 22px; cursor: pointer; }
    .girvi-pdf-messages:empty { display: none; }
    .girvi-pdf-error { color: #a33e35; font-size: 12px; }
    .girvi-pdf-status { margin: 0; color: #64746a; font-size: 11px; }
    .payment-history-title { margin: 14px 0 10px; }
    @media (max-width: 850px) { .girvi-overview { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
    @media (max-width: 1000px) { .girvi-payment .payment-line { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
    @media (max-width: 700px) {
      .girvi-detail-panel { padding: 16px 14px; }
      .payment-line, .girvi-payment .payment-line { display: grid; grid-template-columns: 1fr; }
      .girvi-document-actions { align-items: stretch; }
      .girvi-document-actions button { width: 100%; }
      .girvi-details-head { align-items: flex-start; }
      .girvi-section-title { align-items: flex-start; }
      .girvi-assessed-total { padding: 7px 8px; }
      .girvi-details-actions { gap: 7px; }
      .girvi-close-btn { padding: 7px 8px; }
      .girvi-collateral-wrap { overflow: visible; border: 0; background: transparent; }
      .girvi-items-table { min-width: 0; border-spacing: 0 9px; }
      .girvi-items-table thead { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0,0,0,0); white-space: nowrap; }
      .girvi-items-table, .girvi-items-table tbody, .girvi-items-table tr, .girvi-items-table td { display: block; width: 100%; }
      .girvi-items-table tbody tr { padding: 6px 12px; border: 1px solid #e6ebe6; border-radius: 9px; background: #fff; box-shadow: 0 2px 6px #21362808; }
      .girvi-items-table td { display: grid; grid-template-columns: minmax(95px, .75fr) 1.25fr; gap: 10px; padding: 9px 2px; border-bottom: 1px solid #f0f2ef; text-align: left !important; }
      .girvi-items-table td::before { content: attr(data-label); color: #859087; font-size: 9px; font-weight: 600; }
      .girvi-items-table td:first-child { display: block; padding: 9px 2px 11px; }
      .girvi-items-table td:first-child::before { display: none; }
      .girvi-items-table td:last-child { border-bottom: 0; }
      .girvi-items-table td small { max-width: none; }
      .girvi-items-table .girvi-no-collateral { display: block; padding: 12px !important; }
      .girvi-history-wrap { overflow: visible; border: 0; background: transparent; }
      .girvi-history-table, .girvi-history-table tbody, .girvi-history-table tr, .girvi-history-table td { display: block; width: 100%; }
      .girvi-history-table thead { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0,0,0,0); white-space: nowrap; }
      .girvi-history-table tbody tr { display: grid; grid-template-columns: 1fr 1fr; gap: 0 12px; margin-bottom: 9px; padding: 8px 12px; border: 1px solid #e6ebe6; border-radius: 9px; background: #fff; }
      .girvi-history-table td, .girvi-history-table th:nth-child(n+3) { display: grid; grid-template-columns: 1fr; gap: 5px; padding: 9px 2px; border-bottom: 1px solid #f0f2ef; text-align: left !important; }
      .girvi-history-table td::before { content: attr(data-label); color: #859087; font-size: 9px; font-weight: 600; }
      .girvi-history-table td:last-child { border-bottom: 0; }
      .girvi-history-table tbody tr:hover { background: #fff; }
      .girvi-pdf-overlay { padding: 8px; }
      .girvi-pdf-dialog { height: 96vh; padding: 12px; }
      .girvi-pdf-dialog > footer { align-items: stretch; flex-direction: column; }
      .girvi-pdf-dialog > footer > div { justify-content: flex-end; }
    }
  `]
})
export class GirviComponent implements OnInit, OnDestroy {
  workspace: BusinessWorkspace | null = null;
  customers: Customer[] = [];
  selectedCustomer: Customer | null = null;
  pledges: Pledge[] = [];
  filteredPledges: Pledge[] = [];
  payments: Payment[] = [];
  topUps: TopUp[] = [];
  selected: Pledge | null = null;
  showCreate = false;
  saving = false;
  rateLoading = false;
  agreementPrinting = false;
  search = '';
  customerSearch = '';
  error = '';
  formError = '';
  customerError = '';
  paymentError = '';
  topUpError = '';
  success = '';
  agreementError = '';
  agreementMessage = '';
  detailError = '';
  agreementPdf: jsPDF | null = null;
  agreementPreviewUrl: SafeResourceUrl | null = null;
  agreementPledge: Pledge | null = null;
  private agreementPreviewObjectUrl: string | null = null;
  paymentAmount = '';
  paymentMethod: PaymentMethod = 'cash';
  paymentDate = this.today();
  topUpAmount = '';
  topUpMethod: PaymentMethod = 'cash';
  topUpDate = this.today();
  newCustomer = { name: '', phone: '', address: '' };
  draft = this.emptyDraft();
  private readonly collateralByPledge = new Map<string,CollateralItem[]>();
  private pendingCreate: { fingerprint:string; key:string } | null = null;
  private pendingPayment: { fingerprint:string; key:string } | null = null;
  private pendingTopUp: { fingerprint:string; key:string } | null = null;
  private readonly names = new Map<string,string>();
  private readonly phones = new Map<string,string>();
  private subscription?: Subscription;

  constructor(
    private readonly service: WorkspaceService,
    private readonly cdr: ChangeDetectorRef,
    private readonly sanitizer: DomSanitizer, private readonly market: MarketRateService
  ) {}

  get canPost(): boolean { return this.workspace?.role === 'owner' || this.workspace?.role === 'admin'; }
  get visiblePledges():Pledge[] { return this.filteredPledges.filter(pledge=>pledge.id!==this.selected?.id); }
  get agreementSnapshotDate():string {
    return this.agreementPledge?this.balanceDate(this.agreementPledge):this.today();
  }

  ngOnInit(): void {
    this.subscription = this.service.activeWorkspace$.subscribe(workspace => {
      this.workspace = workspace;
      this.selected = null;
      this.pledges = [];
      if (workspace) void this.load();
    });
  }
  ngOnDestroy(): void { this.subscription?.unsubscribe(); this.releaseAgreementPreview(); }

  async load(): Promise<void> {
    const workspace = this.workspace, client = this.service.client;
    if (!workspace || !client) return;
    this.error = '';
    this.detailError = '';
    try {
      const [customers, pledges] = await Promise.all([
        client.from('customers').select('id,full_name,phone,address').eq('business_id',workspace.id).eq('status','active').order('full_name'),
        client.from('ss_girvi').select('*').eq('business_id',workspace.id).order('created_at',{ascending:false}).limit(1000)
      ]);
      if (customers.error) throw new Error(customers.error.message);
      if (pledges.error) throw new Error(pledges.error.message);
      this.customers = (customers.data ?? []) as Customer[];
      this.names.clear(); this.phones.clear();
      for (const customer of this.customers) {
        this.names.set(customer.id,customer.full_name);
        this.phones.set(customer.id,customer.phone ?? '');
      }
      if(this.draft.customerId)this.selectedCustomer=this.customers.find(customer=>customer.id===this.draft.customerId)??null;
      this.pledges = (pledges.data ?? []) as Pledge[];
      const items=await client.from('ss_girvi_items').select('id,girvi_id,item_number,description,condition_notes,metal,purity,weight_g,rate_per_gram,estimated_market_value')
        .eq('business_id',workspace.id).order('item_number');
      this.collateralByPledge.clear();
      if(items.error)this.detailError=`Collateral item details could not be loaded: ${items.error.message}`;
      else for(const row of (items.data??[]) as CollateralItem[]){
        this.collateralByPledge.set(row.girvi_id,[...(this.collateralByPledge.get(row.girvi_id)??[]),row]);
      }
      this.filterPledges();
    } catch (error) {
      this.error = error instanceof Error ? error.message : 'Could not load Girvi records.';
    } finally { this.cdr.markForCheck(); }
  }

  filteredCustomers(): Customer[] {
    const query=this.customerSearch.trim().toLocaleLowerCase();
    const phoneQuery=query.replace(/\D/g,'');
    if(!query)return this.customers.slice(0,20);
    return this.customers.filter(customer=>{
      const name=customer.full_name.toLocaleLowerCase();
      const phone=(customer.phone??'').toLocaleLowerCase();
      const phoneDigits=phone.replace(/\D/g,'');
      const address=this.customerAddress(customer).toLocaleLowerCase();
      return name.includes(query)||phone.includes(query)||address.includes(query)||(phoneQuery.length>0&&phoneDigits.includes(phoneQuery));
    }).slice(0,20);
  }
  customerSearchChanged():void{
    this.draft.customerId='';
    this.selectedCustomer=null;
  }
  selectCustomer(customer:Customer):void{
    this.draft.customerId=customer.id;
    this.selectedCustomer=customer;
    this.customerSearch=customer.full_name;
  }
  clearCustomerSelection():void{
    this.draft.customerId='';
    this.selectedCustomer=null;
    this.customerSearch='';
  }
  customerAddress(customer:Customer):string{
    if(typeof customer.address==='string')return customer.address;
    if(customer.address&&typeof customer.address==='object'){
      const address=customer.address as Record<string,unknown>;
      return Object.values(address).filter((value):value is string=>typeof value==='string').join(', ');
    }
    return '';
  }
  filterPledges(): void {
    const query=this.search.trim().toLowerCase();
    this.filteredPledges=this.pledges.filter(p=>!query||String(p.girvi_number).includes(query)||(p.customer_name_snapshot??this.customerName(p.customer_id)).toLowerCase().includes(query)||(p.customer_phone_snapshot??this.customerPhone(p.customer_id)).includes(query));
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
      this.selectCustomer(customer);this.newCustomer={name:'',phone:'',address:''};
    } catch(error) { this.customerError=error instanceof Error?error.message:'Could not register customer.'; } finally { this.cdr.markForCheck(); }
  }

  async fetchRate(item:DraftCollateralItem): Promise<void> {
    const client=this.service.client,workspace=this.workspace;
    if(!client||!workspace)return;
    this.rateLoading=true;this.formError='';
    try {
      const metal=item.metal,purity=item.purity,factor=this.purityFactor(item);
      await this.market.load(workspace.id);
      if(this.workspace?.id!==workspace.id||item.metal!==metal||item.purity!==purity)return;
      const quote=this.market.quote(workspace.id,metal,purity);
      if(!quote)throw new Error('No fresh market rate. Verify and enter a manual rate.');
      item.rate=(Number(quote.value)*factor).toFixed(4);
    } catch(error) { this.formError=error instanceof Error?error.message:'Could not fetch the live rate.'; }
    finally { this.rateLoading=false;this.cdr.markForCheck(); }
  }

  addCollateralItem():void{if(this.draft.items.length<100)this.draft.items.push(this.emptyCollateralItem());}
  removeCollateralItem(index:number):void{if(this.draft.items.length>1)this.draft.items.splice(index,1);}
  collateralMetalChanged(item:DraftCollateralItem):void{item.purity=item.metal==='gold'?'22K':'999';item.rate='';item.customPurityFactor='0.900000';}
  itemValue(item:DraftCollateralItem):string{
    try{
      if(!item.weight||!item.rate)return '0.00';
      return girviCollateralValue(item.weight,item.rate);
    }catch{return '0.00';}
  }
  get estimatedValue():string{
    return formatFixed(this.draft.items.reduce((sum,item)=>sum+parseFixed(this.itemValue(item),2),0n),2);
  }
  private purityFactor(item:DraftCollateralItem):number{
    if(item.metal==='gold')return 1;
    if(item.purity==='999')return 0.999;
    if(item.purity==='925')return 0.925;
    const factor=Number(item.customPurityFactor);
    if(!Number.isFinite(factor)||factor<=0||factor>=1)throw new Error('Custom silver purity factor must be greater than 0 and less than 1.');
    return factor;
  }
  async create(): Promise<void> {
    const client=this.service.client,workspace=this.workspace;
    if(!client||!workspace||!this.canPost||this.saving)return;
    let items:Record<string,string>[],principal:string;
    try{
      if(!this.draft.customerId||this.draft.items.length<1)throw new Error('Select a customer and record at least one jewellery item.');
      items=this.draft.items.map(item=>{
        const weight=parseFixed(item.weight,4),rate=parseFixed(item.rate,4);
        const factor=this.purityFactor(item);
        if(!item.description.trim()||item.description.trim().length>180||weight<=0n||rate<=0n)throw new Error('Enter each item description, positive weight, and agreed per-gram rate.');
        return {description:item.description.trim(),condition_notes:item.conditionNotes.trim(),metal:item.metal,purity:item.purity,weight_g:formatFixed(weight,4),
          rate_per_gram:formatFixed(rate,4),purity_factor:factor.toFixed(6)};
      });
      principal=formatFixed(parseFixed(this.draft.principal,2),2);
      if(parseFixed(principal,2)<=0n||parseFixed(principal,2)>parseFixed(this.estimatedValue,2))throw new Error('Loan amount must be positive and no greater than the total assessed jewellery value.');
      if(this.draft.date>this.today()||this.draft.maturityDate<this.draft.date)throw new Error('Choose a valid loan date and a repayment date on or after it.');
      const monthlyRate=Number(this.draft.interestPercent);
      if(!Number.isFinite(monthlyRate)||monthlyRate<2||monthlyRate>10||Math.round(monthlyRate*100)!==monthlyRate*100)throw new Error('Monthly interest must be from 2% to 10%, with no more than 2 decimal places.');
    }catch(error){this.formError=error instanceof Error?error.message:'Check the pledge details.';return;}
    const payload={customerId:this.draft.customerId,items,principal,interestPercent:this.draft.interestPercent,date:this.draft.date,
      maturityDate:this.draft.maturityDate,method:this.draft.disbursementMethod,notes:this.draft.notes.trim()};
    const fingerprint=JSON.stringify(payload);
    if(!this.pendingCreate||this.pendingCreate.fingerprint!==fingerprint)this.pendingCreate={fingerprint,key:crypto.randomUUID()};
    if(!window.confirm(`Create this pledge for ${this.inr(principal)} with ${items.length} item(s) and ${this.draft.interestPercent}% monthly compound interest?`))return;
    this.saving=true;this.formError='';
    try {
      const result=await client.rpc('ss_girvi_create_multi',{p_business_id:workspace.id,p_customer_id:this.draft.customerId,p_idempotency_key:this.pendingCreate.key,
        p_items:items,p_principal:principal,p_monthly_interest_percent:this.draft.interestPercent,p_girvi_date:this.draft.date,
        p_maturity_date:this.draft.maturityDate,p_disbursement_method:this.draft.disbursementMethod,p_notes:this.draft.notes});
      if(result.error)throw new Error(result.error.message);
      if(!result.data)throw new Error('The database did not confirm the new Girvi pledge. Retry safely.');
      const newPledgeId=result.data;
      this.pendingCreate=null;this.success='Girvi pledge created and loan disbursement recorded.';this.showCreate=false;this.draft=this.emptyDraft();await this.load();
      const created=this.pledges.find(pledge=>pledge.id===newPledgeId);if(created)await this.open(created);
    } catch(error) { this.formError=error instanceof Error?error.message:'Could not create Girvi.'; }
    finally { this.saving=false;this.cdr.markForCheck(); }
  }

  async open(pledge:Pledge):Promise<void> {
    this.closeAgreementPreview();
    this.selected=pledge;this.paymentError='';this.topUpError='';this.agreementError='';this.agreementMessage='';this.detailError='';this.payments=[];this.topUps=[];
    const client=this.service.client,workspace=this.workspace;
    if(!client||!workspace)return;
    try {
      const [payments,topUps,items]=await Promise.all([
        client.from('ss_girvi_payments').select('id,amount,payment_method,interest_paid,principal_paid,payment_date')
          .eq('business_id',workspace.id).eq('girvi_id',pledge.id).order('payment_date',{ascending:false}),
        client.from('ss_girvi_topups').select('id,amount,payment_method,topup_date')
          .eq('business_id',workspace.id).eq('girvi_id',pledge.id).order('topup_date',{ascending:false}),
        client.from('ss_girvi_items').select('id,girvi_id,item_number,description,condition_notes,metal,purity,weight_g,rate_per_gram,estimated_market_value')
          .eq('business_id',workspace.id).eq('girvi_id',pledge.id).order('item_number')
      ]);
      if(payments.error)this.paymentError=`Payment history could not be loaded: ${payments.error.message}`;
      else this.payments=(payments.data??[]) as Payment[];
      if(topUps.error)this.topUpError=`Additional advance history could not be loaded: ${topUps.error.message}`;
      else this.topUps=(topUps.data??[]) as TopUp[];
      if(items.error)this.detailError=`Collateral item details could not be loaded: ${items.error.message}`;
      else this.collateralByPledge.set(pledge.id,(items.data??[]) as CollateralItem[]);
    } catch(error) {
      this.detailError=error instanceof Error?error.message:'Could not load Girvi pledge details.';
    } finally { this.cdr.markForCheck(); }
  }
  closeDetails():void{this.closeAgreementPreview();this.selected=null;}

  async recordPayment(pledge:Pledge):Promise<void> {
    const client=this.service.client,workspace=this.workspace;
    if(!client||!workspace||this.saving||!this.canPost)return;
    let amount:string;
    try{
      amount=formatFixed(parseFixed(this.paymentAmount,2),2);
      if(!this.hasDailyAccrualSchema(pledge))throw new Error('Apply migration 026 before recording payments with daily-compounding interest.');
      if(this.paymentDate<this.accrualDate(pledge)||this.paymentDate>this.today())throw new Error('Payment date must be on or after the last accrual date and cannot be in the future.');
      if(parseFixed(amount,2)<=0n||parseFixed(amount,2)>parseFixed(this.currentOutstandingAt(pledge,this.paymentDate),2))throw new Error('Payment must be positive and no greater than the outstanding on the payment date.');
    }catch(error){this.paymentError=error instanceof Error?error.message:'Enter a valid payment amount.';return;}
    const fingerprint=JSON.stringify({pledge:pledge.id,amount,method:this.paymentMethod,date:this.paymentDate});
    if(!this.pendingPayment||this.pendingPayment.fingerprint!==fingerprint)this.pendingPayment={fingerprint,key:crypto.randomUUID()};
    if(!window.confirm('Record this payment? It will first settle accrued interest, then principal. Paying the full outstanding closes the pledge and records jewellery return.'))return;
    this.saving=true;this.paymentError='';
    try {
      const result=await client.rpc('ss_girvi_record_payment',{p_business_id:workspace.id,p_girvi_id:pledge.id,p_idempotency_key:this.pendingPayment.key,p_amount:amount,p_method:this.paymentMethod,p_payment_date:this.paymentDate});
      if(result.error)throw new Error(result.error.message);
      this.pendingPayment=null;this.success='Payment recorded.';this.paymentAmount='';await this.load();
      const updated=this.pledges.find(row=>row.id===pledge.id);if(updated)await this.open(updated);
    } catch(error) { this.paymentError=error instanceof Error?error.message:'Could not record payment.'; }
    finally { this.saving=false;this.cdr.markForCheck(); }
  }

  async recordTopUp(pledge:Pledge):Promise<void> {
    const client=this.service.client,workspace=this.workspace;
    if(!client||!workspace||this.saving||!this.canPost)return;
    let amount:string;
    try{
      amount=formatFixed(parseFixed(this.topUpAmount,2),2);
      if(!this.hasDailyAccrualSchema(pledge))throw new Error('Apply migration 026 before recording Girvi top-ups with daily-compounding interest.');
      if(pledge.status!=='active')throw new Error('Closed Girvi records cannot receive top-ups.');
      if(this.topUpDate<this.accrualDate(pledge)||this.topUpDate>this.today())throw new Error('Top-up date must be on or after the last accrual date and cannot be in the future.');
      if(parseFixed(amount,2)<=0n||parseFixed(amount,2)>parseFixed(this.topUpRoom(pledge),2))throw new Error('Top-up must be positive and cannot make principal exceed the assessed jewellery value.');
    }catch(error){this.topUpError=error instanceof Error?error.message:'Enter a valid additional amount.';return;}
    const fingerprint=JSON.stringify({pledge:pledge.id,amount,method:this.topUpMethod,date:this.topUpDate});
    if(!this.pendingTopUp||this.pendingTopUp.fingerprint!==fingerprint)this.pendingTopUp={fingerprint,key:crypto.randomUUID()};
    if(!window.confirm(`Disburse ${this.inr(amount)} more against Girvi #${pledge.girvi_number}? It will be added to principal, and total principal will remain within the assessed jewellery value.`))return;
    this.saving=true;this.topUpError='';
    try {
      const result=await client.rpc('ss_girvi_record_topup',{p_business_id:workspace.id,p_girvi_id:pledge.id,p_idempotency_key:this.pendingTopUp.key,p_amount:amount,p_method:this.topUpMethod,p_topup_date:this.topUpDate});
      if(result.error)throw new Error(result.error.message);
      if(!result.data)throw new Error('The database did not confirm the additional Girvi amount. Retry safely.');
      this.pendingTopUp=null;this.success='Additional Girvi amount disbursed.';this.topUpAmount='';await this.load();
      const updated=this.pledges.find(row=>row.id===pledge.id);if(updated)await this.open(updated);
    } catch(error) { this.topUpError=error instanceof Error?error.message:'Could not disburse the additional Girvi amount.'; }
    finally { this.saving=false;this.cdr.markForCheck(); }
  }

  settleAndClose(pledge:Pledge):void{
    this.paymentAmount=this.currentOutstandingAt(pledge,this.paymentDate);
    void this.recordPayment(pledge);
  }
  async previewAgreementPdf(pledge:Pledge):Promise<void>{
    if(this.agreementPrinting)return;
    this.agreementPrinting=true;this.agreementError='';this.agreementMessage='';this.cdr.markForCheck();
    try{
      const pdf=await this.prepareAgreementPdf(pledge);
      this.closeAgreementPreview();
      this.agreementPdf=pdf;
      this.agreementPledge=pledge;
      this.agreementPreviewObjectUrl=URL.createObjectURL(pdf.output('blob'));
      this.agreementPreviewUrl=this.sanitizer.bypassSecurityTrustResourceUrl(this.agreementPreviewObjectUrl);
    }catch(error){this.agreementError=error instanceof Error?error.message:'Could not prepare the Girvi agreement PDF.';}
    finally{this.agreementPrinting=false;this.cdr.markForCheck();}
  }

  downloadAgreementPdf():void{
    if(!this.agreementPdf||!this.agreementPledge){
      this.agreementError='Prepare the agreement preview before downloading the PDF.';
      return;
    }
    this.agreementPdf.save(this.agreementFileName(this.agreementPledge));
  }

  sharePreviewPdf():void{
    if(this.agreementPledge)void this.shareAgreementPdf(this.agreementPledge);
  }

  closeAgreementPreview():void{
    this.releaseAgreementPreview();
    this.agreementPdf=null;
    this.agreementPreviewUrl=null;
    this.agreementPledge=null;
  }

  private releaseAgreementPreview():void{
    if(this.agreementPreviewObjectUrl)URL.revokeObjectURL(this.agreementPreviewObjectUrl);
    this.agreementPreviewObjectUrl=null;
  }

  async shareAgreementPdf(pledge:Pledge):Promise<void>{
    if(this.agreementPrinting)return;
    this.agreementPrinting=true;this.agreementError='';this.agreementMessage='';this.cdr.markForCheck();
    let chatWindow:Window|null=null;
    try{
      const probe=new File(['agreement'],'girvi-agreement.pdf',{type:'application/pdf'});
      const supportsFileShare=typeof navigator.share==='function'&&typeof navigator.canShare==='function'&&navigator.canShare({files:[probe]});
      if(!supportsFileShare)chatWindow=window.open('about:blank','_blank');
      const pdf=this.agreementPdf&&this.agreementPledge?.id===pledge.id
        ?this.agreementPdf
        :await this.prepareAgreementPdf(pledge);
      const file=new File([pdf.output('blob')],this.agreementFileName(pledge),{type:'application/pdf'});
      const totalAdvanced=formatFixed(parseFixed(pledge.principal_amount,2)+parseFixed(this.totalTopUps(),2),2);
      const message=`Girvi pledge agreement #${pledge.girvi_number} from ${this.workspace?.name||'Jewellery Business'}. Total principal advanced: INR ${totalAdvanced}; principal outstanding: INR ${pledge.principal_balance}; agreed rate: ${pledge.monthly_interest_percent}% monthly.`;
      if(typeof navigator.share==='function'&&typeof navigator.canShare==='function'&&navigator.canShare({files:[file]})){
        await navigator.share({files:[file],title:`Girvi agreement #${pledge.girvi_number}`,text:message});
        this.agreementMessage='PDF ready to share. Choose WhatsApp in the share sheet if available.';
        return;
      }
      pdf.save(this.agreementFileName(pledge));
      const phone=this.whatsAppNumber(pledge.customer_phone_snapshot||this.customerPhone(pledge.customer_id));
      const whatsappUrl=`https://wa.me/${phone}?text=${encodeURIComponent(message)}`;
      if(chatWindow)chatWindow.location.href=whatsappUrl;
      else window.location.assign(whatsappUrl);
      this.agreementMessage='PDF downloaded and WhatsApp opened. Attach the downloaded PDF in the chat to send it.';
    }catch(error){
      chatWindow?.close();
      if(error instanceof DOMException&&error.name==='AbortError')this.agreementMessage='PDF sharing was cancelled.';
      else this.agreementError=error instanceof Error?error.message:'Could not prepare or share the Girvi agreement PDF.';
    }finally{this.agreementPrinting=false;this.cdr.markForCheck();}
  }

  private async prepareAgreementPdf(pledge:Pledge):Promise<jsPDF>{
    const client=this.service.client,workspace=this.workspace;
    if(!client||!workspace)throw new Error('Select an active business workspace before generating the agreement.');
    const audit=await client.rpc('ss_audit_girvi_agreement_print',{p_business_id:workspace.id,p_girvi_id:pledge.id});
    if(audit.error)throw new Error(`${audit.error.code??'Supabase'}: ${audit.error.message}`);
    const topUpsResult=await client.from('ss_girvi_topups').select('id,amount,payment_method,topup_date')
      .eq('business_id',workspace.id).eq('girvi_id',pledge.id).order('topup_date');
    if(topUpsResult.error)throw new Error(`Additional advances could not be loaded for the agreement: ${topUpsResult.error.message}`);
    this.topUps=(topUpsResult.data??[]) as TopUp[];
    const {jsPDF}=await import('jspdf');
    const pdf=new jsPDF({unit:'mm',format:'a4'}),left=15,width=180;
    let y=18;
    const header=()=>{y=drawBusinessLetterhead(pdf,workspace.letterhead??{name:workspace.name,lines:[]},'GIRVI PLEDGE AGREEMENT',`#${pledge.girvi_number}`);pdf.setTextColor(43,61,49);if(y>235)throw new Error('Business letterhead is too long for the agreement.');};
    header();
    const ensure=(height=8):void=>{if(y+height>274){pdf.addPage();header();}};
    const text=(value:string,size=9,bold=false,indent=0):void=>{
      pdf.setFont('helvetica',bold?'bold':'normal');pdf.setFontSize(size);
      const lines=pdf.splitTextToSize(value,width-indent),lineHeight=size*0.48;
      ensure(lines.length*lineHeight+2);pdf.text(lines,left+indent,y);y+=lines.length*lineHeight+2;
    };
    const rule=():void=>{ensure(6);pdf.setDrawColor(210,218,211);pdf.line(left,y,left+width,y);y+=6;};
    const section=(title:string):void=>{ensure(18);pdf.setFillColor(241,235,219);pdf.rect(left,y-4,width,8,'F');y+=1;text(title.toUpperCase(),10,true);y+=2;};
    pdf.setTextColor(43,61,49);
    section('Customer and pledge');
    text(`Borrower: ${pledge.customer_name_snapshot||this.customerName(pledge.customer_id)}`,10,true);
    text(`Mobile: ${pledge.customer_phone_snapshot||this.customerPhone(pledge.customer_id)||'Not recorded'}`);
    if(pledge.customer_address_snapshot)text(`Address: ${pledge.customer_address_snapshot}`);
    text(`Agreement date: ${pledge.girvi_date}    Repayment date: ${this.repaymentDate(pledge)}`);
    rule();
    section('Jewellery received and agreed valuation');
    for(const [index,item] of this.detailCollateralItems(pledge).entries()){
      text(`${index+1}. ${item.description} | ${item.metal.toUpperCase()} ${item.purity} | ${item.weight_g} g`,10,true);
      if(item.condition_notes)text(`Condition / identifying marks: ${item.condition_notes}`,8,false,4);
      text(`Agreed rate: INR ${item.rate_per_gram} per g    Assessed value: INR ${item.estimated_market_value}`,8,false,4);
    }
    if(!this.detailCollateralItems(pledge).length)text('No collateral item details are available.');
    rule();
    section('Loan and interest terms');
    text(`Total assessed collateral value: INR ${pledge.estimated_market_value}`,9,true);
    text(`Original loan disbursed: INR ${pledge.principal_amount}`,9,true);
    section('Additional advances');
    if(this.topUps.length){
      for(const advance of this.topUps){
        text(`${advance.topup_date} | ${advance.payment_method.replace('_',' ')} | INR ${advance.amount}`,9);
      }
    }else{
      text('No additional advances recorded.');
    }
    const totalAdvanced=formatFixed(parseFixed(pledge.principal_amount,2)+parseFixed(this.totalTopUps(),2),2);
    text(`Total principal disbursed: INR ${totalAdvanced}`,9,true);
    text(`Agreed interest: ${pledge.monthly_interest_percent}% effective monthly rate, compounded daily over a 30-day rate period.`);
    text('Interest accrues on the combined outstanding principal and accrued interest. Each additional advance joins the principal and accrues interest from its disbursement date. The effective rate over 30 days equals the agreed monthly rate. If unpaid by the agreed repayment date, the same agreed rate continues; no separate penalty or fee is included.');
    const balances=this.growth(pledge);
    rule();
    const snapshotDate=this.balanceDate(pledge);
    section(`Current balance snapshot as of ${snapshotDate}`);
    text(`Principal outstanding: INR ${balances.principal}`,9,true);
    text(`Accrued compound interest: INR ${balances.interest}`,9,true);
    text(`Total outstanding: INR ${formatFixed(parseFixed(balances.principal,2)+parseFixed(balances.interest,2),2)}`,10,true);
    text('Payments are allocated to accrued interest first and then principal. The pledged jewellery will be returned when the full outstanding amount is paid and recorded.');
    text('The borrower confirms the listed jewellery, metal, purity, weight and assessed values and acknowledges receipt of the original loan and any additional advances listed above. Any change to these terms must be recorded and accepted by both parties in writing.');
    if(pledge.notes){rule();section('Additional agreed notes');text(pledge.notes);}
    ensure(32);y+=12;
    pdf.setDrawColor(100,110,101);
    for(const [label,x] of [['Borrower signature',left],['Business representative',left+64],['Witness',left+128]] as const){
      pdf.line(x,y,x+48,y);pdf.setFont('helvetica','normal');pdf.setFontSize(8);pdf.text(label,x,y+5);
    }
    y+=18;text('Both parties should check this agreement before signing and keep a copy. Applicable local law governs.',8);
    const pages=pdf.getNumberOfPages();
    for(let page=1;page<=pages;page++){pdf.setPage(page);pdf.setDrawColor(166,125,48);pdf.line(left,281,left+width,281);pdf.setFont('helvetica','normal');pdf.setFontSize(8);pdf.setTextColor(90,85,75);pdf.text(`SwarnaSuraksha | Page ${page} of ${pages}`,left,286);pdf.text('Designed & developed by Suraksha Software | www.surakshasoftware.in',left,291);}
    pdf.setTextColor(0,0,0);
    return pdf;
  }

  private agreementFileName(pledge:Pledge):string{
    const name=(pledge.customer_name_snapshot||this.customerName(pledge.customer_id)).toLocaleLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'')||'customer';
    return `girvi-${pledge.girvi_number}-${name}.pdf`;
  }

  private whatsAppNumber(phone:string):string{
    const digits=phone.replace(/\D/g,'');
    return digits.length===10?`91${digits}`:digits;
  }
  collateralItems(pledgeId:string):CollateralItem[]{return this.collateralByPledge.get(pledgeId)??[];}
  detailCollateralItems(pledge:Pledge):CollateralItem[]{
    const items=this.collateralItems(pledge.id);
    if(items.length||(pledge.metal!=='gold'&&pledge.metal!=='silver'))return items;
    return [{
      id:`legacy-${pledge.id}`,girvi_id:pledge.id,item_number:1,description:'Pledged jewellery',
      condition_notes:null,metal:pledge.metal,purity:pledge.purity??(pledge.metal==='silver'?'999':''),
      weight_g:pledge.weight_g,rate_per_gram:pledge.rate_per_gram,estimated_market_value:pledge.estimated_market_value
    }];
  }
  collateralDescription(pledgeId:string):string{
    const items=this.collateralItems(pledgeId);
    return items.length?items.map(item=>`${item.description} · ${item.metal} ${item.purity}`).join(', '):'Loading item details';
  }
  customerName(id:string):string{return this.names.get(id)??'Customer';}
  customerPhone(id:string):string{return this.phones.get(id)??'';}
  inr(value:string|number):string{return formatInr(String(value),2);}
  hasDailyAccrualSchema(p:Pledge):boolean{
    if(!p.last_accrued_date)return false;
    try { girviElapsedDays(p.last_accrued_date,p.last_accrued_date);return true; }
    catch { return false; }
  }
  repaymentDate(p:Pledge):string{return p.maturity_date||this.dateAfterDaysFrom(p.girvi_date,30);}
  elapsedDays(p:Pledge):number { return girviElapsedDays(this.accrualDate(p),this.balanceDate(p)); }
  currentInterest(p:Pledge):string { return this.growth(p).interest; }
  currentOutstanding(p:Pledge):string { return this.currentOutstandingAt(p,this.balanceDate(p)); }
  topUpRoom(p:Pledge):string {
    const room=parseFixed(p.estimated_market_value,2)-parseFixed(p.principal_balance,2);
    return formatFixed(room>0n?room:0n,2);
  }
  hasTopUpRoom(p:Pledge):boolean{return parseFixed(this.topUpRoom(p),2)>0n;}
  totalTopUps():string {
    return formatFixed(this.topUps.reduce((sum,item)=>sum+parseFixed(item.amount,2),0n),2);
  }
  private currentOutstandingAt(p:Pledge,asOfDate:string):string {
    const g=this.growth(p,asOfDate);
    return formatFixed(parseFixed(g.principal,2)+parseFixed(g.interest,2),2);
  }

  private growth(p:Pledge,asOfDate=this.balanceDate(p)):{principal:string;interest:string} {
    const days=girviElapsedDays(this.accrualDate(p),asOfDate);
    const balances=girviBalancesAt(p.principal_balance,p.interest_balance,p.monthly_interest_percent,days);
    return {principal:balances.principal,interest:balances.interest};
  }
  private accrualDate(p:Pledge):string{
    if(this.hasDailyAccrualSchema(p))return p.last_accrued_date!;
    const match=/^(\d{4})-(\d{2})-(\d{2})$/.exec(p.girvi_date);
    if(!match)throw new RangeError('Girvi agreement date is missing or invalid.');
    const months=Number.isInteger(p.last_accrued_months)?Math.max(0,p.last_accrued_months):0;
    const absoluteMonth=Number(match[1])*12+Number(match[2])-1+months;
    const year=Math.floor(absoluteMonth/12),month=absoluteMonth%12;
    const day=Math.min(Number(match[3]),new Date(Date.UTC(year,month+1,0)).getUTCDate());
    return `${year}-${String(month+1).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
  }
  private balanceDate(p:Pledge):string{
    return p.status==='closed'?this.accrualDate(p):this.today();
  }
  private dateAfterDaysFrom(start:string,days:number):string{
    const match=/^(\d{4})-(\d{2})-(\d{2})$/.exec(start);
    if(!match)throw new RangeError('Girvi agreement date is missing or invalid.');
    const date=new Date(Date.UTC(Number(match[1]),Number(match[2])-1,Number(match[3])+days));
    return `${date.getUTCFullYear()}-${String(date.getUTCMonth()+1).padStart(2,'0')}-${String(date.getUTCDate()).padStart(2,'0')}`;
  }
  private emptyCollateralItem():DraftCollateralItem{return {description:'',conditionNotes:'',metal:'gold',purity:'22K',weight:'',rate:'',customPurityFactor:'0.900000'};}
  private emptyDraft():{customerId:string;items:DraftCollateralItem[];principal:string;interestPercent:number;date:string;maturityDate:string;disbursementMethod:PaymentMethod;notes:string} {
    return {customerId:'',items:[this.emptyCollateralItem()],principal:'',interestPercent:3,date:this.today(),maturityDate:this.dateAfterDays(30),disbursementMethod:'cash',notes:''};
  }
  private dateAfterDays(days:number):string{const date=new Date();date.setDate(date.getDate()+days);return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;}
  private today():string { const date=new Date();return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`; }
}