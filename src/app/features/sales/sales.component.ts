import { MarketRateService } from '../../core/market/market-rate.service';
import { renderReceiptPdf } from '../../core/financial/receipt-pdf';
import { CommonModule } from '@angular/common';
import { ChangeDetectorRef, Component, OnDestroy, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { IonicModule } from '@ionic/angular';
import { Subscription } from 'rxjs';
import type { jsPDF } from 'jspdf';
import { LedgerPaymentComponent } from '../../core/financial/ledger-payment.component';
import { NetworkStatusService } from '../../core/network/network-status.service';
import { formatFixed, formatInr, parseFixed, percentageAmountMinor, percentageCharge, purchaseLineTotal } from '../../core/financial/decimal';
import { calculateExchangeValue } from '../../core/financial/exchange';
import { Json } from '../../core/supabase/database.types';
import { allocateSaleReturn } from '../../core/financial/sales-return';
import { BusinessWorkspace, WorkspaceService } from '../dashboard/workspace.service';

type Metal = 'gold' | 'silver' | 'other';
type Method = 'cash' | 'upi' | 'bank_transfer' | 'card';
interface Customer { id: string; full_name: string; phone: string | null; address?: unknown; }
interface Rate { id: string; metal: 'gold' | 'silver'; purity: string | null; unit: string; reference_rate: string; shop_buy_rate: string; shop_sell_rate: string; recorded_at: string; }
interface Sale { id: string; customer_id: string | null; invoice_number: number; subtotal: string; taxable_subtotal:string; gst_percent:string; gst_amount:string; paid_total: string; created_at: string; previous_outstanding?:string; customer_advance_credit?:string; total_payable?:string; }
interface SaleExchangePosting { sale_id:string; previous_outstanding:string; customer_advance_credit:string; total_payable:string; }
interface SaleLine { id:string; sale_id: string; item_description: string; metal: Metal; purity: string | null; gross_weight_g:string; net_weight_g: string; unit_rate_per_gram: string; making_charge: string; making_charge_percent?:string|null; line_total: string; gst_amount:string; }
interface SaleHistoryRecord { sale:Sale; lines:SaleLine[]; exchanges:SaleExchange[]; returns:SaleReturn[]; }
interface CustomerLedgerRow {event_id:string;event_type:string;description:string;entity_id:string;happened_at:string;debit:string;credit:string;payment_method:string|null;running_balance:string;}
interface OutstandingExchangeLine {id:string;customer_adjustment_id:string;metal:'gold'|'silver';purity:string;description:string;net_weight_g:string;quality_deduction_percent:string;accepted_weight_g:string;applied_rate_per_gram:string;exchange_value:string;}
interface SalePayment { sale_id: string; amount: string; method: string; reference?: string|null; recorded_at?: string; }
interface SaleReturn { id:string; sale_id:string; sale_line_id:string; original_line_amount:string; balance_reduction:string; cash_refund:string; refund_method:string|null; reason:string; recorded_at:string; }
interface SaleExchange { id:string; sale_id:string; customer_id:string; exchange_number:number; metal:'gold'|'silver'; purity:string; description:string; gross_weight_g:string; non_metal_deduction_g:string; net_weight_g:string; quality_deduction_percent:string; purity_factor:string; accepted_weight_g:string; rate_source:'reference'|'shop_buy'|'manual'; reference_rate_per_gram:string; applied_rate_per_gram:string; valuation_mode:'selected_purity'|'24k_equivalent'; calculated_exchange_value:string; exchange_value:string; manual_override_reason:string|null; received_at:string; }
interface ReturnTarget { sale:Sale; line:SaleLine; }
interface SaleDraftLine { item_description: string; metal: Metal; purity: string; net_weight_g: string; rate_per_gram: string; rate_source_label: string; rate_snapshot_id: string; making_charge_percent: string; }
interface ExchangeDraft { metal:'gold'|'silver'; purity:string; description:string; gross_weight_g:string; non_metal_deduction_g:string; quality_deduction_percent:string; purity_factor:string; valuation_mode:'selected_purity'|'24k_equivalent'; rate_source:'reference'|'shop_buy'|'manual'; rate_snapshot_id:string; manual_rate:string; manual_exchange_value:string; manual_override_reason:string; }
interface PaymentDraft { method: Method; amount: string; reference: string; }
interface PendingSale { key: string; customerId: string | null; lines: Json[]; exchanges: Json[]; payments: Json[]; excessAction:'none'|'refund'|'advance_credit'; excessRefundMethod:Method; }
interface PendingCustomerPayment { key:string; customerId:string; amount:string; method:Method; reference:string|null; }

@Component({
  standalone: true,
  imports: [CommonModule, FormsModule, IonicModule, RouterLink, LedgerPaymentComponent],
  template: `
    <header class="topbar"><div class="crumb"><a routerLink="/dashboard">Overview</a><span>›</span><b>Sales &amp; billing</b></div><div class="top-actions"><button *ngIf="canPost" class="primary-btn fab-action" type="button" (click)="editing = !editing" [disabled]="!!pending"><svg class="btn-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg> Create invoice</button></div></header>
    <section class="content customers-page purchases-page">
      <div class="welcome"><div><p class="eyebrow">BILLING · CUSTOMER PAYMENTS</p><h1>Bill</h1><p class="subtitle">Record jewellery sales and customer payments.</p></div></div>
      <div class="config-banner error-banner" *ngIf="errorMessage" role="alert"><span class="banner-icon">!</span><div><b>Sales data unavailable</b><p>{{errorMessage}}</p></div><button class="text-btn" type="button" (click)="load()">Retry</button></div>
      <p class="save-success" *ngIf="successMessage" role="status">{{successMessage}}</p>
      <div class="status-card" *ngIf="loading"><span class="spinner"></span><div><b>Loading sales ledger</b><p>Reading bills permitted for this workspace.</p></div></div>
      <div class="config-banner" *ngIf="workspace?.role === 'staff'" role="status"><span class="banner-icon">i</span><div><b>Sale posting is restricted</b><p>Only owners and administrators can post bills until a business staff permission policy is configured.</p></div></div>

      <section class="panel customer-editor" *ngIf="editing && !pending && canPost">
        <div class="panel-head"><div><h2>New invoice</h2><p>Choose an indicative cached rate or saved shop rate, confirm it for this bill, then record any payment received.</p></div><button class="text-btn" type="button" (click)="editing = false">Cancel</button></div>
        <p class="duplicate-warning" role="note">Nebula Metals rates are indicative, excluding GST. Older market rates are not automatically applied. Verify or edit each rate before posting; the confirmed rate and selected GST are saved with the invoice.</p>
        <form class="customer-form purchase-form" (ngSubmit)="post()">
          <div class="customer-search-field">
            <label for="customer-search">Find customer by name, mobile or address</label>
            <input id="customer-search" [(ngModel)]="customerSearch" name="customerSearch" autocomplete="off"
              placeholder="Start typing a name, mobile or address" (ngModelChange)="customerSearchChanged()" [disabled]="!!pendingCustomerPayment">
            <span class="customer-search-results" *ngIf="customerSearch.trim() && !customerId && !pendingCustomerPayment" role="listbox" aria-label="Matching customers">
              <button *ngFor="let customer of filteredCustomers()" type="button" role="option" (click)="selectCustomer(customer)">
                <b>{{customer.full_name}}</b><small>{{customer.phone || 'No mobile'}}{{customerAddress(customer) ? ' · ' + customerAddress(customer) : ''}}</small>
              </button>
              <span *ngIf="customerSearchLoading" class="customer-search-empty" role="status">Searching customers…</span>
              <span *ngIf="customerSearchError" class="customer-search-empty form-error" role="alert">{{customerSearchError}} <button class="text-btn" type="button" (click)="searchCustomersNow()">Retry search</button></span>
              <span *ngIf="!customerSearchLoading && !customerSearchError && !filteredCustomers().length" class="customer-search-empty">No matching customer. Add their details below.</span>
            </span>
          </div>
          <div class="selected-customer" *ngIf="customerId"><span>Selected customer <b>{{customerName(customerId)}}</b></span><button type="button" class="text-btn" (click)="clearCustomerSelection()" [disabled]="!!pendingCustomerPayment">Change</button></div>
          <div class="config-banner" *ngIf="customerId" role="status">
            <div><b>Previous outstanding</b><p>{{customerBalanceLoading ? 'Checking full customer ledger…' : inr(previousOutstandingForSelectedCustomer())}}</p><p *ngIf="customerCreditForSelectedCustomer() !== '0.00'">Available advance credit: {{inr(customerCreditForSelectedCustomer())}}</p><p class="form-error" *ngIf="customerBalanceError" role="alert">{{customerBalanceError}} <button class="text-btn" type="button" (click)="loadCustomerBalance(customerId)" [disabled]="customerBalanceLoading">Retry balance</button></p>
              <div class="customer-outstanding-payment" *ngIf="previousOutstandingForSelectedCustomer() !== '0.00'">
                <b>Settle previous outstanding — no new bill</b>
                <div class="customer-payment-fields">
                  <label>Amount (₹)<input [(ngModel)]="customerPaymentAmount" name="customerPaymentAmount" inputmode="decimal" [disabled]="!!pendingCustomerPayment"></label>
                  <label>Method<select [(ngModel)]="customerPaymentMethod" name="customerPaymentMethod" [disabled]="!!pendingCustomerPayment"><option value="cash">Cash</option><option value="upi">UPI</option><option value="bank_transfer">Bank transfer</option><option value="card">Card</option></select></label>
                  <label>Reference (optional)<input [(ngModel)]="customerPaymentReference" name="customerPaymentReference" maxlength="120" [disabled]="!!pendingCustomerPayment"></label>
                </div>
                <button class="text-btn" type="button" (click)="recordCustomerOutstandingPayment()" [disabled]="customerPaymentSaving || customerBalanceLoading || !!customerBalanceError || !network.isOnline">{{customerPaymentSaving?'Saving…':pendingCustomerPayment?'Retry same payment safely':'Record payment'}}</button>
                <p class="form-error" *ngIf="customerPaymentError" role="alert">{{customerPaymentError}}</p>
              </div>
              <section class="customer-outstanding-payment" *ngIf="previousOutstandingForSelectedCustomer() !== '0.00'">
                <div class="line-heading"><b>Settle by exchanging old jewellery</b><button class="text-btn" type="button" (click)="toggleOutstandingExchange()">{{outstandingExchangeEnabled?'Hide exchange':'Add gold / silver exchange'}}</button></div>
                <div *ngIf="outstandingExchangeEnabled" class="outstanding-exchange-form">
                  <article class="exchange-line" *ngFor="let item of outstandingExchanges;let i=index">
                    <div class="line-heading"><b>Exchange item {{i+1}}</b><button class="text-btn danger-text" type="button" (click)="removeOutstandingExchange(i)">Remove</button></div>
                    <label>Metal<select [(ngModel)]="item.metal" [name]="'outstandingMetal'+i" (ngModelChange)="exchangeMetalChanged(item)"><option value="gold">Gold</option><option value="silver">Silver</option></select></label>
                    <label>Purity<select [(ngModel)]="item.purity" [name]="'outstandingPurity'+i" (ngModelChange)="exchangePurityChanged(item)"><option *ngFor="let purity of exchangePurities(item.metal)" [value]="purity">{{purity}}</option></select></label>
                    <label>Description<input [(ngModel)]="item.description" [name]="'outstandingDescription'+i" maxlength="180" placeholder="Old gold chain"></label>
                    <label>Net weight (g)<input [(ngModel)]="item.gross_weight_g" [name]="'outstandingWeight'+i" inputmode="decimal" placeholder="0.0000"></label>
                    <label>Quality deduction<select [(ngModel)]="item.quality_deduction_percent" [name]="'outstandingQuality'+i"><option *ngFor="let percent of qualityOptions" [value]="percent">{{percent}}%</option></select></label>
                    <label *ngIf="item.metal==='silver'">Purity factor<input [(ngModel)]="item.purity_factor" [name]="'outstandingFactor'+i" type="number" min="0.000001" max="1" step="0.000001"></label>
                    <label>Rate (₹/g)<input [(ngModel)]="item.manual_rate" [name]="'outstandingRate'+i" inputmode="decimal"><small class="rate-source-note">{{item.rate_snapshot_id?'Saved shop buying rate':'Cached rate or manually confirmed rate'}}</small></label>
                    <div class="line-total"><span>Accepted weight · balance credit</span><b>{{exchangeBreakdown(item)}}</b></div>
                  </article>
                  <button class="text-btn add-item-btn" type="button" (click)="addOutstandingExchange()" [disabled]="outstandingExchanges.length>=100">＋ Add another exchange item</button>
                  <p><b>Exchange credit: {{inr(fixed(outstandingExchangeTotalMinor,2))}}</b> · Remaining due: {{inr(fixed(outstandingAfterExchangeMinor,2))}}</p>
                  <button class="text-btn" type="button" (click)="recordCustomerOutstandingExchange()" [disabled]="customerExchangeSaving || customerBalanceLoading || !!customerBalanceError || !network.isOnline || !!pendingCustomerExchange">{{customerExchangeSaving?'Saving exchange…':pendingCustomerExchange?'Retry same exchange safely':'Apply exchange to outstanding'}}</button>
                  <p class="form-error" *ngIf="customerExchangeError" role="alert">{{customerExchangeError}}</p>
                </div>
              </section>
            </div>
            <section class="outstanding-ledger">
              <div class="line-heading"><b>Customer account history</b><span>Each transaction shows due before and after</span></div>
              <p *ngIf="customerLedgerLoading">Loading transaction history…</p>
              <p class="form-error" *ngIf="customerLedgerError" role="alert">{{customerLedgerError}}</p>
              <p *ngIf="!customerLedgerLoading && !customerLedgerRows.length && !customerLedgerError">No customer transactions have been recorded.</p>
              <div class="table-wrap" *ngIf="!customerLedgerLoading && customerLedgerRows.length"><table class="stack-table"><thead><tr><th>Transaction date</th><th>Details</th><th>Previous due</th><th>Received / credit</th><th>Balance due</th></tr></thead><tbody><tr *ngFor="let event of customerLedgerRows"><td data-label="Transaction date">{{event.happened_at | date:'d MMM y, h:mm a':'Asia/Kolkata'}}</td><td data-label="Details">{{event.event_type === 'customer.exchange_payment' ? 'Jewellery exchange' : event.event_type === 'customer.payment' ? 'Payment received' : event.description}}<small *ngIf="event.payment_method">{{event.payment_method | titlecase}}</small><small *ngFor="let exchanged of ledgerExchangeItems(event.event_id)">{{exchanged.description}} · {{exchanged.metal | titlecase}} {{exchanged.purity}} · {{exchanged.net_weight_g}} g · {{inr(exchanged.exchange_value)}}</small></td><td data-label="Previous due">{{inr(ledgerPreviousBalance(event))}}</td><td data-label="Received / credit">{{ledgerCreditDisplay(event)}}</td><td data-label="Balance due"><b>{{inr(event.running_balance)}}</b></td></tr></tbody></table></div>
              <div class="ledger-pagination" *ngIf="customerLedgerTotalCount > customerLedgerPageSize"><button class="text-btn" type="button" (click)="loadCustomerLedgerPage(customerId,customerLedgerOffset-customerLedgerPageSize)" [disabled]="customerLedgerOffset<=0 || customerLedgerLoading">Older</button><span>{{customerLedgerOffset+1}}–{{customerLedgerOffset+customerLedgerRows.length}} of {{customerLedgerTotalCount}}</span><button class="text-btn" type="button" (click)="loadCustomerLedgerPage(customerId,customerLedgerOffset+customerLedgerPageSize)" [disabled]="customerLedgerOffset+customerLedgerPageSize>=customerLedgerTotalCount || customerLedgerLoading">Newer</button></div>
            </section>
            <a class="text-btn" routerLink="/dashboard/customers">View customer history</a>
          </div>
          <div class="quick-customer">
            <div class="line-heading"><b>{{customerId ? 'Selected customer details' : 'Add a new customer'}}</b><span>{{customerId ? 'From customer records' : 'Optional'}}</span></div>
            <div class="payment-line">
              <label>Full name<input [(ngModel)]="newCustomerName" name="newCustomerName" maxlength="120" autocomplete="name" [readonly]="!!customerId"></label>
              <label>Mobile number<input [(ngModel)]="newCustomerPhone" name="newCustomerPhone" maxlength="20" inputmode="tel" autocomplete="tel" [readonly]="!!customerId"></label>
              <label>Address<input [(ngModel)]="newCustomerAddress" name="newCustomerAddress" maxlength="250" autocomplete="street-address" [readonly]="!!customerId"></label>
              <button *ngIf="!customerId" class="text-btn btn-save" type="button" (click)="createCustomer()" [disabled]="creatingCustomer || !newCustomerName.trim()">
                {{creatingCustomer ? 'Saving…' : 'Save customer'}}
              </button>
            </div>
            <p class="form-error" *ngIf="customerError" role="alert">{{customerError}}</p>
          </div>
          <div class="purchase-lines">
            <div class="purchase-line" *ngFor="let line of lines; let i = index">
              <div class="line-heading"><b>Item {{i + 1}}</b><button *ngIf="lines.length > 1" class="text-btn danger-text" type="button" (click)="removeLine(i)">Remove</button></div>
              <label>Description<input [(ngModel)]="line.item_description" [name]="'description' + i" maxlength="180" required placeholder="e.g. 22K gold necklace"></label>
              <label>Metal<select [(ngModel)]="line.metal" [name]="'metal' + i" (ngModelChange)="metalChanged(line)"><option value="gold">Gold</option><option value="silver">Silver</option></select></label>
              <label>Purity<select [(ngModel)]="line.purity" [name]="'purity' + i" (ngModelChange)="rateChanged(line)"><option *ngFor="let purity of purities(line.metal)" [value]="purity">{{purity || 'Standard silver'}}</option></select></label>
              <label>Net weight (g)<input [(ngModel)]="line.net_weight_g" [name]="'net' + i" inputmode="decimal" required placeholder="0.0000"></label>
              <label>Rate (₹/g)<input [(ngModel)]="line.rate_per_gram" [name]="'rate' + i" inputmode="decimal" required (ngModelChange)="saleRateChanged(line)"><small class="rate-source-note">{{line.rate_source_label || 'Enter the rate for billing'}}</small></label>
              <label *ngIf="line.metal === 'gold'">Making charge (%)
                <select [(ngModel)]="line.making_charge_percent" [name]="'makingPercent' + i" required>
                  <option *ngFor="let percent of makingChargeOptions" [value]="percent">{{percent}}%</option>
                </select>
                <small class="rate-source-note">5%–20% of gold value · 12% default</small>
              </label>
              <div class="line-charge"><span>Making charge <b>{{line.metal === 'gold' ? line.making_charge_percent + '% of gold value' : 'Not applied'}}</b></span><strong>{{makingChargeDisplay(line)}}</strong></div>
              <div class="line-total"><span>Taxable line amount</span><b>{{lineTotal(line)}}</b></div>
            </div>
            <button class="text-btn add-item-btn" type="button" (click)="addLine()" [disabled]="lines.length >= 100"><svg class="btn-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg> Add another item</button>
          </div>
          <label class="gst-rate-field">GST rate
            <select [(ngModel)]="gstPercent" name="gstPercent" required>
              <option *ngFor="let percent of gstOptions" [value]="percent">{{percent}}%</option>
            </select>
            <small class="rate-source-note">Applied to the full jewellery subtotal, including making charges.</small>
          </label>
          <label class="exchange-toggle"><input [(ngModel)]="exchangeEnabled" name="exchangeEnabled" type="checkbox" (ngModelChange)="toggleExchange($event)"> Customer is exchanging old jewellery?</label>
          <section class="exchange-editor" *ngIf="exchangeEnabled">
            <div class="panel-head"><div><h3>Old jewellery received</h3><p>Credit uses the selected purity rate less a 10%–50% quality reduction. This is exchange-in, not a return of a previous sale.</p></div></div>
            <article class="exchange-line" *ngFor="let item of exchanges; let i = index">
              <div class="line-heading"><b>Exchange item {{i + 1}}</b><button class="text-btn danger-text" type="button" (click)="removeExchange(i)">Remove</button></div>
              <label>Metal<select [(ngModel)]="item.metal" [name]="'exchangeMetal' + i" (ngModelChange)="exchangeMetalChanged(item)"><option value="gold">Gold</option><option value="silver">Silver</option></select></label>
              <label>Purity<select [(ngModel)]="item.purity" [name]="'exchangePurity' + i" (ngModelChange)="exchangePurityChanged(item)"><option *ngFor="let purity of exchangePurities(item.metal)" [value]="purity">{{purity}}</option></select></label>
              <label>Description<input [(ngModel)]="item.description" [name]="'exchangeDescription' + i" maxlength="180" required placeholder="e.g. old gold chain"></label>
              <label>Net weight (g)<input [(ngModel)]="item.gross_weight_g" [name]="'exchangeGross' + i" inputmode="decimal" required placeholder="0.0000"></label>
              <label>Quality deduction
                <select [(ngModel)]="item.quality_deduction_percent" [name]="'exchangeQuality' + i">
                  <option *ngFor="let percent of qualityOptions" [value]="percent">{{percent}}%</option>
                </select>
              </label>
              <label *ngIf="item.metal === 'silver'">Silver purity factor<input [(ngModel)]="item.purity_factor" [name]="'exchangeFactor' + i" type="number" min="0.000001" max="1" step="0.000001"></label>
              <label>Rate source<select [(ngModel)]="item.rate_source" [name]="'exchangeSource' + i" (ngModelChange)="exchangeRateSourceChanged(item)"><option value="shop_buy">Current market/shop buy rate</option><option value="manual">Manual override</option></select></label>
              <label>Rate (₹/g)<input [(ngModel)]="item.manual_rate" [name]="'exchangeRate' + i" inputmode="decimal" required (ngModelChange)="exchangeRateChanged(item)"><small class="rate-source-note">{{item.rate_snapshot_id ? 'Saved shop buying rate' : 'Current cached market quote or manually entered rate'}}</small></label>
              <label>Override exchange value (optional)<input [(ngModel)]="item.manual_exchange_value" [name]="'exchangeManualValue' + i" inputmode="decimal" placeholder="Leave blank to use calculated value"><small class="rate-source-note">Calculated value: {{exchangeCalculatedValue(item)}} · Leave blank to use this amount.</small></label>
              <label *ngIf="item.rate_source === 'manual' || item.manual_exchange_value">Override reason<input [(ngModel)]="item.manual_override_reason" [name]="'exchangeOverrideReason' + i" maxlength="1000" required></label>
              <div class="line-total"><span>Net weight · accepted weight · exchange value</span><b>{{exchangeBreakdown(item)}}</b></div>
            </article>
            <button class="text-btn add-item-btn" type="button" (click)="addExchange()" [disabled]="exchanges.length >= 100"><svg class="btn-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg> Add another exchange item</button>
            <div class="excess-choice" *ngIf="exchangeTotalMinor > billTotalMinor">
              <b>Exchange exceeds this bill by {{inr(fixed(exchangeTotalMinor - billTotalMinor, 2))}}</b>
              <label>Handle excess<select [(ngModel)]="excessAction" name="excessAction"><option value="none">Choose how to handle excess</option><option value="refund">Refund to customer</option><option value="advance_credit">Save as customer advance credit</option></select></label>
              <label *ngIf="excessAction === 'refund'">Refund method<select [(ngModel)]="excessRefundMethod" name="excessRefundMethod"><option value="cash">Cash</option><option value="upi">UPI</option><option value="bank_transfer">Bank transfer</option><option value="card">Card</option></select></label>
            </div>
          </section>
          <div class="purchase-payments">
            <div class="line-heading"><b>Payments received (optional)</b><button class="text-btn" type="button" (click)="addPayment()" [disabled]="payments.length >= 20"><svg class="btn-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg> Add payment</button></div>
            <div class="payment-line" *ngFor="let payment of payments; let i = index">
              <label>Method<select [(ngModel)]="payment.method" [name]="'paymentMethod' + i"><option value="cash">Cash</option><option value="upi">UPI</option><option value="bank_transfer">Bank transfer</option><option value="card">Card</option></select></label>
              <label>Amount (₹)<input [(ngModel)]="payment.amount" [name]="'paymentAmount' + i" inputmode="decimal"></label>
              <label>Reference (optional)<input [(ngModel)]="payment.reference" [name]="'paymentReference' + i" maxlength="120"></label>
              <button class="text-btn danger-text" type="button" (click)="removePayment(i)">Remove</button>
            </div>
          </div>
          <div class="purchase-summary"><span>Taxable jewellery subtotal</span><b>{{totalLabel}}</b><span>GST ({{gstPercent}}%)</span><b>{{gstLabel}}</b><span>New jewellery total</span><b>{{billTotalLabel}}</b><span>Old jewellery exchange</span><b>{{inr(fixed(exchangeTotalMinor, 2))}}</b><span>Net sale amount</span><b>{{inr(fixed(netSaleMinor, 2))}}</b><span>Previous outstanding</span><b>{{inr(previousOutstandingForSelectedCustomer())}}</b><span>Total payable</span><b>{{totalPayableLabel}}</b><span>Paid now</span><b>{{paidLabel}}</b><span>Remaining balance</span><b>{{balanceLabel}}</b></div>
          <p class="duplicate-warning" role="note">Posting is final. A return reverses the complete saved invoice line, including its GST. It reduces unpaid balance first; only the remaining amount can be refunded, capped by payments received.</p>
          <p class="form-error" *ngIf="formError" role="alert">{{formError}}</p><div class="form-actions"><button class="primary-btn" type="submit" [disabled]="saving || !(network.online$ | async) || !lines.length">{{saving ? 'Posting invoice…' : !(network.online$ | async) ? 'Offline — posting disabled' : 'Post sale'}}</button><span>Pricing uses the saved shop selling rate you selected.</span></div>
        </form>
      </section>
      <section class="panel customer-editor pending-purchase" *ngIf="pending"><b>Sale result is not confirmed</b><p>Retry the exact same invoice payload safely. The database idempotency key prevents a duplicate.</p><p class="form-error" *ngIf="formError" role="alert">{{formError}}</p><button class="primary-btn" type="button" (click)="post()" [disabled]="saving || !(network.online$ | async)">{{saving ? 'Checking result…' : 'Retry same sale safely'}}</button></section>
      <section class="panel customer-list purchase-history" *ngIf="!loading">
        <div class="panel-head"><div><h2>Recent bills</h2><p>Open details to review items, exchanges, returns, and up to five earlier customer invoices.</p></div><button class="text-btn" type="button" (click)="load()">Refresh</button></div>
        <div class="bill-search" *ngIf="sales.length"><svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="11" cy="11" r="6.5" stroke="currentColor" stroke-width="2"/><path d="m16 16 4.5 4.5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg><input type="search" [(ngModel)]="billSearch" name="billSearch" autocomplete="off" placeholder="Search name, mobile no. or address" aria-label="Search recent bills"><button type="button" class="bill-search-clear" *ngIf="billSearch" (click)="billSearch = ''" aria-label="Clear search">×</button></div>
        <div class="table-wrap" *ngIf="sales.length; else emptySales" [style.display]="filteredSales().length ? null : 'none'"><table class="stack-table"><thead><tr><th>Invoice</th><th>Customer · date</th><th>Items</th><th>Total</th><th>Paid</th><th>Balance</th><th>Actions</th></tr></thead><tbody><ng-container *ngFor="let sale of filteredSales()"><tr>
          <td data-label="Invoice"><b>#{{sale.invoice_number}}</b></td><td data-label="Customer · date"><b>{{customerName(sale.customer_id)}}</b><small>{{sale.created_at | date:'d MMM y, h:mm a':'Asia/Kolkata'}}</small></td>
          <td data-label="Items">{{linesFor(sale.id).length}} new · {{exchangesFor(sale.id).length}} exchange<small *ngIf="returned(sale.id) !== '0.00'">Returned {{inr(returned(sale.id))}}</small></td>
          <td data-label="Total">{{inr(sale.subtotal)}}<small *ngIf="exchangeTotalLabel(sale.id) !== '0.00'">After exchange {{netSaleForSale(sale)}}</small></td>
          <td data-label="Paid">{{inr(sale.paid_total)}}<small>{{paymentMethods(sale.id)}}</small></td><td data-label="Balance"><b>{{balance(sale)}}</b></td>
          <td class="bill-actions" data-label="Actions"><button class="text-btn" type="button" (click)="toggleBillDetails(sale)">{{detailsSaleId===sale.id?'Hide details':'Details'}}</button><button *ngIf="canPost" class="text-btn" type="button" (click)="openReceipt(sale)">Print</button><button *ngIf="canPost" class="text-btn btn-pdf" type="button" (click)="downloadReceipt(sale)" [disabled]="receiptSharing"><svg class="btn-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 4v11m0 0 4-4m-4 4-4-4M5 19h14" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg> {{receiptSharing?'Preparing PDF…':'Download PDF'}}</button><button *ngIf="canPost" class="text-btn btn-whatsapp" type="button" (click)="shareReceipt(sale)" [disabled]="receiptSharing"><svg class="wa-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M17.47 14.38c-.3-.15-1.76-.87-2.03-.97-.27-.1-.47-.15-.67.15-.2.3-.77.97-.94 1.17-.17.2-.35.22-.64.07-.3-.15-1.26-.46-2.4-1.48-.89-.79-1.49-1.77-1.66-2.07-.17-.3-.02-.46.13-.61.14-.13.3-.35.45-.52.15-.17.2-.3.3-.5.1-.2.05-.37-.02-.52-.08-.15-.67-1.61-.92-2.2-.24-.58-.49-.5-.67-.51h-.57c-.2 0-.52.07-.8.37-.27.3-1.04 1.02-1.04 2.48 0 1.46 1.07 2.88 1.21 3.08.15.2 2.1 3.2 5.08 4.49.71.31 1.26.49 1.69.63.71.23 1.36.2 1.87.12.57-.09 1.76-.72 2.01-1.41.25-.7.25-1.29.17-1.41-.07-.12-.27-.2-.57-.35zM12.05 21.5h-.01a9.87 9.87 0 0 1-5.03-1.38l-.36-.21-3.74.98 1-3.65-.24-.37a9.86 9.86 0 0 1-1.51-5.26c0-5.45 4.44-9.88 9.89-9.88a9.82 9.82 0 0 1 6.99 2.9 9.82 9.82 0 0 1 2.89 6.99c0 5.45-4.44 9.88-9.88 9.88zM20.52 3.45A11.8 11.8 0 0 0 12.05 0C5.5 0 .16 5.34.16 11.89c0 2.1.55 4.14 1.59 5.95L.06 24l6.3-1.65a11.88 11.88 0 0 0 5.68 1.45h.01c6.55 0 11.89-5.34 11.89-11.89 0-3.18-1.24-6.17-3.48-8.41z"/></svg> WhatsApp PDF</button><ss-ledger-payment *ngIf="canPost && balanceAmount(sale) !== '0.00'" kind="sale" [businessId]="workspace!.id" [transactionId]="sale.id" [remaining]="balanceAmount(sale)" (saved)="load()"></ss-ledger-payment></td>
        </tr><tr *ngIf="detailsSaleId===sale.id"><td colspan="7"><section class="bill-details">
          <div class="bill-details-columns"><div><h3>This invoice · new jewellery</h3><p class="bd-line" *ngFor="let line of linesFor(sale.id)"><span class="bd-top"><b>{{line.item_description}}</b><em class="bd-amount">{{lineGrossAmount(line)}}</em></span><span class="bd-meta">{{line.metal | titlecase}}{{line.purity ? ' '+line.purity : ''}} · {{line.net_weight_g}} g × {{inr(line.unit_rate_per_gram)}}/g</span><small *ngIf="returnFor(line)">Returned {{inr(returnFor(line)!.original_line_amount)}} · {{returnFor(line)!.reason}} <button class="text-btn" type="button" (click)="openReturnReceiptForLine(line)">Voucher</button></small><button *ngIf="canPost && !isReturned(line)" class="text-btn" type="button" (click)="startReturn(sale,line)">Return item</button></p></div>
          <div><h3>Old jewellery exchanged</h3><p class="bd-line" *ngFor="let exchange of exchangesFor(sale.id)"><span class="bd-top"><b>{{exchange.description}}</b><em class="bd-amount">credit {{inr(exchange.exchange_value)}}</em></span><span class="bd-meta">{{exchange.metal | titlecase}} {{exchange.purity}} · {{exchange.net_weight_g}} g · {{exchange.quality_deduction_percent}}% deduction</span></p><p *ngIf="!exchangesFor(sale.id).length">No jewellery exchanged on this invoice.</p></div></div>
          <div class="bill-history"><h3>Previous customer invoices <span>(up to 5)</span></h3><p *ngIf="!sale.customer_id">This walk-in bill is not linked to a customer history.</p><p *ngIf="billHistoryLoading">Loading previous invoice details…</p><p class="form-error" *ngIf="billHistoryError" role="alert">{{billHistoryError}}</p><p *ngIf="sale.customer_id && !billHistoryLoading && !billHistoryError && !billHistory.length">No earlier invoices found for this customer.</p>
            <article *ngFor="let history of billHistory"><span class="bd-top"><b>Invoice #{{history.sale.invoice_number}}</b><em class="bd-date">{{history.sale.created_at | date:'d MMM y':'Asia/Kolkata'}}</em></span><span class="bd-meta">total {{inr(history.sale.subtotal)}} (GST {{history.sale.gst_percent}}%) · due {{historyBalance(history)}}</span><small *ngFor="let line of history.lines">{{line.item_description}} · {{line.metal | titlecase}} {{line.purity || ''}} · {{line.net_weight_g}} g · {{lineGrossAmount(line)}}<span *ngIf="historyReturn(history,line) as historyReturnRow"> · Returned: {{historyReturnRow.reason}} ({{inr(historyReturnRow.original_line_amount)}})</span></small><small *ngFor="let exchange of history.exchanges">Exchange received: {{exchange.description}} · {{exchange.metal | titlecase}} · {{inr(exchange.exchange_value)}}</small></article>
          </div>
        </section></td></tr></ng-container></tbody></table></div>
        <div class="empty-state customer-empty" *ngIf="sales.length && !filteredSales().length"><span class="empty-art">🔍</span><b>No matching bills</b><p>No recent bill matches “{{billSearch}}”. Try a different name, mobile number or address.</p><button class="text-btn" type="button" (click)="billSearch = ''">Clear search</button></div>
        <ng-template #emptySales><div class="empty-state customer-empty"><span class="empty-art">₹</span><b>No bills recorded</b><p>Create a bill to begin recording jewellery sales.</p></div></ng-template>
      </section>
    </section>
    <div class="receipt-overlay" *ngIf="receiptSale as receipt" role="dialog" aria-modal="true" aria-label="Sales receipt preview">
      <div class="receipt-screen"><div class="receipt-actions"><p *ngIf="receiptError" class="form-error" role="alert">{{receiptError}}</p><label>Layout<select [(ngModel)]="receiptFormat" name="receiptFormat"><option value="a4">A4</option><option value="thermal">Thermal · 80 mm</option></select></label><button class="primary-btn" type="button" (click)="printReceipt()" [disabled]="receiptPrinting">{{receiptPrinting?'Preparing…':'Print receipt'}}</button><button class="text-btn btn-pdf" type="button" (click)="downloadReceipt(receipt)" [disabled]="receiptSharing"><svg class="btn-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 4v11m0 0 4-4m-4 4-4-4M5 19h14" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg> {{receiptSharing?'Preparing PDF…':'Download PDF'}}</button><button class="text-btn btn-whatsapp" type="button" (click)="shareReceipt(receipt)" [disabled]="receiptSharing"><svg class="wa-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M17.47 14.38c-.3-.15-1.76-.87-2.03-.97-.27-.1-.47-.15-.67.15-.2.3-.77.97-.94 1.17-.17.2-.35.22-.64.07-.3-.15-1.26-.46-2.4-1.48-.89-.79-1.49-1.77-1.66-2.07-.17-.3-.02-.46.13-.61.14-.13.3-.35.45-.52.15-.17.2-.3.3-.5.1-.2.05-.37-.02-.52-.08-.15-.67-1.61-.92-2.2-.24-.58-.49-.5-.67-.51h-.57c-.2 0-.52.07-.8.37-.27.3-1.04 1.02-1.04 2.48 0 1.46 1.07 2.88 1.21 3.08.15.2 2.1 3.2 5.08 4.49.71.31 1.26.49 1.69.63.71.23 1.36.2 1.87.12.57-.09 1.76-.72 2.01-1.41.25-.7.25-1.29.17-1.41-.07-.12-.27-.2-.57-.35zM12.05 21.5h-.01a9.87 9.87 0 0 1-5.03-1.38l-.36-.21-3.74.98 1-3.65-.24-.37a9.86 9.86 0 0 1-1.51-5.26c0-5.45 4.44-9.88 9.89-9.88a9.82 9.82 0 0 1 6.99 2.9 9.82 9.82 0 0 1 2.89 6.99c0 5.45-4.44 9.88-9.88 9.88zM20.52 3.45A11.8 11.8 0 0 0 12.05 0C5.5 0 .16 5.34.16 11.89c0 2.1.55 4.14 1.59 5.95L.06 24l6.3-1.65a11.88 11.88 0 0 0 5.68 1.45h.01c6.55 0 11.89-5.34 11.89-11.89 0-3.18-1.24-6.17-3.48-8.41z"/></svg> Share PDF on WhatsApp</button><button class="text-btn" type="button" (click)="closeReceipt()" [disabled]="receiptPrinting">Close preview</button><span role="status">{{receiptShareMessage || 'The receipt includes new items and any old jewellery exchanged.'}}</span></div>
        <article class="receipt-print" [class.receipt-thermal]="receiptFormat==='thermal'"><header><span class="brand-mark">S</span><h1>{{workspace?.name || 'SwarnaSuraksha Business'}}</h1><p>SALES RECEIPT</p></header><hr>
          <div class="receipt-meta"><span>Invoice</span><b>#{{receipt.invoice_number}}</b><span>Date</span><b>{{receipt.created_at | date:'d MMM y, h:mm a':'Asia/Kolkata'}}</b><span>Customer</span><b>{{customerName(receipt.customer_id)}}{{customerPhone(receipt.customer_id) ? ' · '+customerPhone(receipt.customer_id) : ''}}</b></div>
          <table><thead><tr><th>Item</th><th>Net weight</th><th>Rate / g</th><th>Making charge</th><th>Amount</th></tr></thead><tbody><tr *ngFor="let line of linesFor(receipt.id)"><td>{{line.item_description}}<small>{{line.metal | titlecase}}{{line.purity ? ' · '+line.purity : ''}}</small></td><td>{{line.net_weight_g}} g</td><td>{{inr(line.unit_rate_per_gram)}}</td><td>{{inr(line.making_charge)}}{{line.making_charge_percent ? ' (' + line.making_charge_percent + '%)' : ''}}</td><td>{{lineGrossAmount(line)}}<small>Taxable {{inr(line.line_total)}} · GST {{inr(line.gst_amount)}}</small></td></tr></tbody></table>
          <section class="receipt-exchanges" *ngIf="exchangesFor(receipt.id).length"><h2>Old jewellery received</h2><table><thead><tr><th>Item / metal</th><th>Net weight</th><th>Quality reduction</th><th>Accepted</th><th>Rate / g</th><th>Calculated</th><th>Final value</th></tr></thead><tbody><tr *ngFor="let exchange of exchangesFor(receipt.id)"><td>{{exchange.description}} · {{exchange.metal | titlecase}} {{exchange.purity}}<small>{{exchange.rate_source | titlecase}} · {{exchange.valuation_mode === '24k_equivalent' ? '24K equivalent' : 'Selected purity'}}<span *ngIf="exchange.manual_override_reason"> · Override: {{exchange.manual_override_reason}}</span></small></td><td>{{exchange.net_weight_g}} g</td><td>{{exchange.quality_deduction_percent}}%</td><td>{{exchange.accepted_weight_g}} g</td><td>{{exchange.rate_source === 'manual' ? 'Reference ' + inr(exchange.reference_rate_per_gram) + ' · Applied ' : ''}}{{inr(exchange.applied_rate_per_gram)}}</td><td>{{inr(exchange.calculated_exchange_value)}}</td><td>{{inr(exchange.exchange_value)}}</td></tr></tbody></table></section>
          <section class="receipt-exchanges" *ngIf="returnsFor(receipt.id).length"><h2>Returned items</h2><table><thead><tr><th>Item</th><th>Reason</th><th>Value returned</th><th>Refund</th></tr></thead><tbody><tr *ngFor="let returnedItem of returnsFor(receipt.id)"><td>{{lineForReturn(returnedItem)?.item_description}}</td><td>{{returnedItem.reason}}</td><td>{{inr(returnedItem.original_line_amount)}}</td><td>{{inr(returnedItem.cash_refund)}}</td></tr></tbody></table></section>
          <div class="receipt-totals"><span>Taxable jewellery subtotal</span><b>{{inr(receipt.taxable_subtotal)}}</b><span>GST ({{receipt.gst_percent}}%)</span><b>{{inr(receipt.gst_amount)}}</b><span>New jewellery total</span><b>{{inr(receipt.subtotal)}}</b><span>Old jewellery exchange</span><b>{{exchangeTotalLabel(receipt.id)}}</b><span>Net after exchange</span><b>{{netSaleForSale(receipt)}}</b><span>Previous outstanding</span><b>{{inr(receipt.previous_outstanding || '0.00')}}</b><span>Total payable</span><b>{{inr(receipt.total_payable || receipt.subtotal)}}</b><span>Paid</span><b>{{inr(receipt.paid_total)}}</b><span>Returned</span><b>{{inr(returned(receipt.id))}}</b><span>Refunded</span><b>{{inr(refunded(receipt.id))}}</b><span>Balance due</span><b>{{balance(receipt)}}</b></div>
          <p class="receipt-note">GST is calculated at the rate saved on this invoice. Confirm your business registration and applicable tax-invoice requirements before issuing this receipt as a formal GST invoice.</p>
          <div class="receipt-payment" *ngIf="paymentsFor(receipt.id).length"><b>Payments recorded</b><p *ngFor="let payment of paymentsFor(receipt.id)">{{payment.recorded_at ? (payment.recorded_at | date:'d MMM y, h:mm a':'Asia/Kolkata')+' · ' : ''}}{{payment.method | titlecase}} · {{inr(payment.amount)}}{{payment.reference ? ' · Ref '+payment.reference : ''}}</p></div>
          <footer><div>Thank you · Recorded in SwarnaSuraksha</div><div>Designed &amp; developed by <a href="https://www.surakshasoftware.in/" target="_blank" rel="noopener noreferrer">Suraksha Software</a></div><div>www.surakshasoftware.in</div></footer>
        </article>
      </div>
    </div>
    <div class="receipt-overlay" *ngIf="returnTarget as target" role="dialog" aria-modal="true" aria-label="Return invoice item">
      <div class="receipt-screen return-dialog"><div class="receipt-actions"><b>Return item from invoice #{{target.sale.invoice_number}}</b><button class="text-btn" type="button" (click)="closeReturn()" [disabled]="returnSaving">Close</button></div>
        <article class="panel return-form"><p><b>{{target.line.item_description}}</b> · {{target.line.net_weight_g}} g · Original line total including GST {{lineGrossAmount(target.line)}}</p>
          <p>Outstanding balance reduction: {{inr(returnBreakdown(target).balanceReduction)}} · Refund due: {{inr(returnBreakdown(target).refund)}}</p>
          <p class="form-error" *ngIf="returnBreakdown(target).error" role="alert">{{returnBreakdown(target).error}}</p>
          <label>Reason for return<textarea [(ngModel)]="returnReason" name="returnReason" maxlength="300" rows="3" [disabled]="!!pendingReturn"></textarea></label>
          <label *ngIf="returnBreakdown(target).refund !== '0.00'">Refund method<select [(ngModel)]="refundMethod" name="refundMethod" [disabled]="!!pendingReturn"><option value="cash">Cash</option><option value="upi">UPI</option><option value="bank_transfer">Bank transfer</option><option value="card">Card</option></select></label>
          <p class="form-error" *ngIf="returnError" role="alert">{{returnError}}</p>
          <p *ngIf="pendingReturn" role="status">Result not confirmed. Retry the same return safely; the request key prevents duplicate posting.</p>
          <div class="form-actions"><button class="primary-btn" type="button" (click)="submitReturn()" [disabled]="returnSaving || !network.isOnline || !!returnBreakdown(target).error">{{returnSaving?'Posting return…':pendingReturn?'Retry return safely':'Confirm return'}}</button><span>Original invoice is retained; balance, refund, cashbook, and audit update atomically.</span></div>
        </article>
      </div>
    </div>
    <div class="receipt-overlay" *ngIf="receiptReturn as rr" role="dialog" aria-modal="true" aria-label="Sales return voucher preview">
      <div class="receipt-screen"><div class="receipt-actions"><p *ngIf="returnReceiptError" class="form-error" role="alert">{{returnReceiptError}}</p><label>Layout<select [(ngModel)]="receiptFormat" name="returnReceiptFormat"><option value="a4">A4</option><option value="thermal">Thermal · 80 mm</option></select></label><button class="primary-btn" type="button" (click)="printReturnReceipt()" [disabled]="returnReceiptPrinting">{{returnReceiptPrinting?'Preparing…':'Print return voucher'}}</button><button class="text-btn" type="button" (click)="closeReturnReceipt()" [disabled]="returnReceiptPrinting">Close preview</button><span role="status">Print is requested from your device; completion is not confirmed here.</span></div>
        <article class="receipt-print" [class.receipt-thermal]="receiptFormat==='thermal'"><header><span class="brand-mark">S</span><h1>{{workspace?.name || 'SwarnaSuraksha Business'}}</h1><p>SALES RETURN VOUCHER</p></header><hr>
          <div class="receipt-meta"><span>Invoice</span><b>#{{saleForReturn(rr)?.invoice_number}}</b><span>Return date</span><b>{{rr.recorded_at | date:'d MMM y, h:mm a':'Asia/Kolkata'}}</b><span>Customer</span><b>{{customerName(saleForReturn(rr)?.customer_id ?? null)}}</b><span>Item</span><b>{{lineForReturn(rr)?.item_description}}</b></div>
          <div class="receipt-totals"><span>Original saved line amount</span><b>{{inr(rr.original_line_amount)}}</b><span>Unpaid balance reduced</span><b>{{inr(rr.balance_reduction)}}</b><span>Refund paid</span><b>{{inr(rr.cash_refund)}}</b><span>Refund method</span><b>{{rr.refund_method ? (rr.refund_method | titlecase) : 'Not applicable'}}</b></div>
          <p class="receipt-note"><b>Reason:</b> {{rr.reason}}. This return reverses the complete saved invoice line, including its original GST. The original invoice remains in the ledger.</p><p class="receipt-note">Cash refund on this voucher is recorded in the business cashbook. Confirm applicable tax-document requirements before treating it as a formal GST credit note.</p><footer><div>Return recorded in SwarnaSuraksha</div><div>Designed &amp; developed by <a href="https://www.surakshasoftware.in/" target="_blank" rel="noopener noreferrer">Suraksha Software</a></div><div>www.surakshasoftware.in</div></footer>
        </article>
      </div>
    </div>
  `
})
export class SalesComponent implements OnInit, OnDestroy {
  loading = true; saving = false; editing = false;
  errorMessage = ''; formError = ''; successMessage = '';
  customers: Customer[] = []; rates: Rate[] = []; sales: Sale[] = [];
  linesBySale = new Map<string, SaleLine[]>(); paymentsBySale = new Map<string, SalePayment[]>();
  returnsBySale = new Map<string, SaleReturn[]>();
  workspace: BusinessWorkspace | null = null; customerId = '';
  billSearch = '';
  customerSearch = ''; newCustomerName = ''; newCustomerPhone = ''; newCustomerAddress = '';
  customerSearchResults:Customer[]=[];customerSearchLoading=false;customerSearchError='';
  customerError = ''; creatingCustomer = false;
  lines: SaleDraftLine[] = [this.emptyLine()]; payments: PaymentDraft[] = [];
  gstPercent='3';
  pending: PendingSale | null = null;
  receiptSale:Sale|null=null;receiptError='';receiptPrinting=false;receiptFormat:'a4'|'thermal'='a4';
  receiptShareMessage='';receiptSharing=false;
  detailsSaleId:string|null=null;billHistory:SaleHistoryRecord[]=[];billHistoryLoading=false;billHistoryError='';
  receiptReturn:SaleReturn|null=null;returnReceiptError='';returnReceiptPrinting=false;
  returnTarget:ReturnTarget|null=null;returnReason='';refundMethod:Method='cash';returnError='';returnSaving=false;pendingReturn:{key:string;reason:string;method:Method|null}|null=null;
  exchangeEnabled=false;
  exchanges:ExchangeDraft[]=[];
  excessAction:'none'|'refund'|'advance_credit'='none';
  excessRefundMethod:Method='cash';
  readonly qualityOptions=['10.00','15.00','20.00','25.00','30.00','35.00','40.00','45.00','50.00'];
  readonly makingChargeOptions=['5','6','7','8','9','10','11','12','13','14','15','16','17','18','19','20'];
  readonly gstOptions=['1','2','3','4','5','6','7','8','9','10'];
  exchangesBySale=new Map<string,SaleExchange[]>();
  customerBalanceLoading=false;customerBalanceError='';
  private readonly customerBalances=new Map<string,string>();
  private customerBalanceRequest=0;private customerLedgerRequest=0;private billHistoryRequest=0;
  customerLedgerRows:CustomerLedgerRow[]=[];customerLedgerLoading=false;customerLedgerError='';
  customerLedgerOffset=0;customerLedgerTotalCount=0;readonly customerLedgerPageSize=20;
  private customerLedgerPageOpening='0.00';private customerLedgerExchangeItems=new Map<string,OutstandingExchangeLine[]>();
  customerPaymentAmount='';customerPaymentMethod:Method='cash';customerPaymentReference='';
  customerPaymentSaving=false;customerPaymentError='';pendingCustomerPayment:PendingCustomerPayment|null=null;
  outstandingExchangeEnabled=false;outstandingExchanges:ExchangeDraft[]=[];
  customerExchangeSaving=false;customerExchangeError='';
  pendingCustomerExchange:{key:string;customerId:string;items:Json[]}|null=null;
  private subscription: Subscription | null = null; private requestId = 0;
  private customerSearchRequest=0;private customerSearchTimer:ReturnType<typeof setTimeout>|undefined;private customerSearchController:AbortController|null=null;
  constructor(private readonly workspaceService: WorkspaceService, readonly network: NetworkStatusService, private readonly cdr: ChangeDetectorRef, private readonly market: MarketRateService) {}
  get canPost(): boolean { return this.workspace?.role === 'owner' || this.workspace?.role === 'admin'; }
  fixed(value:bigint,scale:number):string{return formatFixed(value,scale);}

  ngOnInit(): void {
    this.subscription = this.workspaceService.activeWorkspace$.subscribe(workspace => {
      if (workspace && workspace.id === this.workspace?.id && workspace.role === this.workspace?.role) return;
      this.workspace = workspace;
      this.cancelCustomerSearch();
      this.customerSearchResults=[];this.customerSearchLoading=false;this.customerSearchError='';
      this.customerBalanceRequest++;
      this.customerBalanceLoading=false;this.customerBalanceError='';
      this.customerLedgerRequest++;this.customerLedgerLoading=false;this.customerLedgerRows=[];this.customerLedgerExchangeItems.clear();
      this.pendingCustomerPayment=null;this.pendingCustomerExchange=null;this.customerPaymentError='';this.customerPaymentAmount='';this.customerPaymentReference='';
      this.outstandingExchangeEnabled=false;this.outstandingExchanges=[];
      this.customers=[];this.rates=[];this.sales=[];this.linesBySale.clear();this.paymentsBySale.clear();this.returnsBySale.clear();this.exchangesBySale.clear();this.customerBalances.clear();
      this.receiptSale=null;this.receiptReturn=null;this.returnTarget=null;this.pendingReturn=null;this.pending=null;this.editing=false;this.requestId++;
      if (workspace) void this.load(); else { this.loading = false; this.errorMessage = 'Select a workspace.'; this.cdr.markForCheck(); }
    });
  }
  ngOnDestroy(): void { this.subscription?.unsubscribe();this.cancelCustomerSearch();this.requestId++; }
  async load(): Promise<void> {
    const workspace = this.workspace; const client = this.workspaceService.client;
    if (!workspace || !client) { this.errorMessage = !client ? 'Supabase is not configured.' : 'Select a workspace.'; this.loading = false; this.cdr.markForCheck(); return; }
    const requestId = ++this.requestId; this.loading = true; this.errorMessage = '';
    const customersController = new AbortController(); const ratesController = new AbortController(); const salesController = new AbortController();
    try {
      const [customerResult, rateResult, saleResult] = await Promise.all([
        this.withTimeout(client.from('customers').select('id,full_name,phone,address').eq('business_id',workspace.id).eq('status','active').order('full_name').abortSignal(customersController.signal),'Loading customers',()=>customersController.abort()),
        this.withTimeout(client.from('ss_metal_rate_snapshots' as any).select('id,metal,purity,unit,reference_rate,shop_buy_rate,shop_sell_rate,recorded_at').eq('business_id',workspace.id).eq('unit','gram').order('recorded_at',{ascending:false}).limit(100).abortSignal(ratesController.signal),'Loading saved rates',()=>ratesController.abort()),
        this.withTimeout(client.from('ss_sales' as any).select('id,customer_id,invoice_number,subtotal,taxable_subtotal,gst_percent,gst_amount,paid_total,created_at').eq('business_id',workspace.id).order('created_at',{ascending:false}).limit(100).abortSignal(salesController.signal),'Loading sales',()=>salesController.abort()),
        this.market.load(workspace.id).catch(()=>null)
      ]);
      if (customerResult.error) throw new Error(`${customerResult.error.code ?? 'Supabase'}: ${customerResult.error.message}`);
      if (rateResult.error) throw new Error(`${rateResult.error.code ?? 'Supabase'}: ${rateResult.error.message}`);
      if (saleResult.error) throw new Error(`${saleResult.error.code ?? 'Supabase'}: ${saleResult.error.message}`);
      const sales = (saleResult.data ?? []) as unknown as Sale[]; const ids = sales.map(s => s.id);
      const linesController = new AbortController(); const paymentsController = new AbortController(); const returnsController = new AbortController(); const exchangesController = new AbortController(); const postingsController = new AbortController();
      const [lineResult,paymentResult,returnResult,exchangeResult,postingResult] = ids.length ? await Promise.all([
        this.withTimeout(client.from('ss_sale_lines' as any).select('id,sale_id,item_description,metal,purity,gross_weight_g,net_weight_g,unit_rate_per_gram,making_charge,making_charge_percent,line_total,gst_amount').eq('business_id',workspace.id).in('sale_id',ids).abortSignal(linesController.signal),'Loading bill items',()=>linesController.abort()),
        this.withTimeout(client.from('ss_sale_payments' as any).select('sale_id,amount,method,reference,recorded_at').eq('business_id',workspace.id).in('sale_id',ids).abortSignal(paymentsController.signal),'Loading sale payments',()=>paymentsController.abort()),
        this.withTimeout(client.from('ss_sale_returns' as any).select('id,sale_id,sale_line_id,original_line_amount,balance_reduction,cash_refund,refund_method,reason,recorded_at').eq('business_id',workspace.id).in('sale_id',ids).abortSignal(returnsController.signal),'Loading sale returns',()=>returnsController.abort()),
        this.withTimeout(client.from('ss_sale_exchanges').select('id,sale_id,customer_id,exchange_number,metal,purity,description,gross_weight_g,non_metal_deduction_g,net_weight_g,quality_deduction_percent,purity_factor,accepted_weight_g,rate_source,reference_rate_per_gram,applied_rate_per_gram,valuation_mode,calculated_exchange_value,exchange_value,manual_override_reason,received_at').eq('business_id',workspace.id).in('sale_id',ids).order('exchange_number').abortSignal(exchangesController.signal),'Loading old jewellery exchange records',()=>exchangesController.abort()),
        this.withTimeout(client.from('ss_sale_exchange_postings').select('sale_id,previous_outstanding,customer_advance_credit,total_payable').eq('business_id',workspace.id).in('sale_id',ids).abortSignal(postingsController.signal),'Loading bill balances',()=>postingsController.abort())
      ]) : [{data:[],error:null},{data:[],error:null},{data:[],error:null},{data:[],error:null},{data:[],error:null}];
      if (lineResult.error) throw new Error(`${lineResult.error.code ?? 'Supabase'}: ${lineResult.error.message}`);
      if (paymentResult.error) throw new Error(`${paymentResult.error.code ?? 'Supabase'}: ${paymentResult.error.message}`);
      if (returnResult.error) throw new Error(`${returnResult.error.code ?? 'Supabase'}: ${returnResult.error.message}`);
      if (exchangeResult.error) throw new Error(`${exchangeResult.error.code ?? 'Supabase'}: ${exchangeResult.error.message}`);
      if (postingResult.error) throw new Error(`${postingResult.error.code ?? 'Supabase'}: ${postingResult.error.message}`);
      if (requestId !== this.requestId) return;
      this.customers = (customerResult.data ?? []) as unknown as Customer[];
      this.rates = (rateResult.data ?? []) as unknown as Rate[];
      for (const line of this.lines) if(!line.rate_per_gram) this.rateChanged(line);
      const postings=new Map(((postingResult.data??[]) as unknown as SaleExchangePosting[]).map(posting=>[posting.sale_id,posting]));
      this.sales = sales.map(sale=>({...sale,...postings.get(sale.id)}));
      this.linesBySale = this.group((lineResult.data ?? []) as unknown as SaleLine[]);
      this.paymentsBySale = this.group((paymentResult.data ?? []) as unknown as SalePayment[]);
      this.returnsBySale = this.group((returnResult.data ?? []) as unknown as SaleReturn[]);
      this.exchangesBySale = this.group((exchangeResult.data ?? []) as unknown as SaleExchange[]);
    } catch (error) { if (requestId === this.requestId) this.errorMessage = error instanceof Error ? error.message : 'Could not load sales.'; }
    finally { if (requestId === this.requestId) { this.loading = false; this.cdr.markForCheck(); } }
  }

  filteredCustomers(): Customer[] {
    const q = this.customerSearch.trim().toLocaleLowerCase();
    if (!q) return this.customers;
    const matches = this.customers.filter(c =>
      c.full_name.toLocaleLowerCase().includes(q) ||
      (c.phone ?? '').toLocaleLowerCase().includes(q) ||
      this.customerAddress(c).toLocaleLowerCase().includes(q)
    );
    const byId=new Map<string,Customer>();
    for(const customer of [...matches,...this.customerSearchResults])byId.set(customer.id,customer);
    return [...byId.values()].sort((a,b)=>a.full_name.localeCompare(b.full_name));
  }

  customerAddress(customer:Customer):string{
    if(typeof customer.address==='string')return customer.address;
    if(customer.address&&typeof customer.address==='object'){
      const address=customer.address as Record<string,unknown>;
      return Object.values(address).filter((value):value is string=>typeof value==='string').join(', ');
    }
    return '';
  }
  customerSearchChanged():void{
    if(this.customerId){
      this.customerId='';this.customerBalanceRequest++;this.customerBalanceLoading=false;this.customerBalanceError='';
      this.customerLedgerRequest++;this.customerLedgerRows=[];this.customerLedgerExchangeItems.clear();this.customerPaymentAmount='';this.newCustomerName='';this.newCustomerPhone='';this.newCustomerAddress='';
    }
    this.customerError='';this.customerSearchError='';
    if(this.customerSearch.trim())this.scheduleCustomerSearch();
    else{this.cancelCustomerSearch();this.customerSearchResults=[];this.customerSearchLoading=false;}
    this.cdr.markForCheck();
  }
  selectCustomer(customer:Customer):void{
    this.cancelCustomerSearch();
    this.customerId=customer.id;this.customerSearch=customer.full_name;
    if(!this.customers.some(row=>row.id===customer.id))this.customers=[...this.customers,customer];
    this.newCustomerName=customer.full_name;this.newCustomerPhone=customer.phone??'';
    this.newCustomerAddress=this.customerAddress(customer);
    this.customerChanged();
  }
  clearCustomerSelection():void{
    this.customerId='';this.customerSearch='';this.newCustomerName='';this.newCustomerPhone='';this.newCustomerAddress='';
    this.cancelCustomerSearch();this.customerSearchResults=[];this.customerSearchLoading=false;this.customerSearchError='';
    this.customerBalanceRequest++;this.customerLedgerRequest++;this.customerBalanceLoading=false;this.customerBalanceError='';this.customerLedgerRows=[];this.customerLedgerExchangeItems.clear();this.customerPaymentAmount='';this.customerPaymentReference='';this.outstandingExchanges=[];this.pendingCustomerExchange=null;this.cdr.markForCheck();
  }
  searchCustomersNow():void{
    if(this.customerSearchTimer)clearTimeout(this.customerSearchTimer);
    this.customerSearchTimer=undefined;
    void this.searchCustomers();
  }
  private scheduleCustomerSearch():void{
    if(this.customerSearchTimer)clearTimeout(this.customerSearchTimer);
    this.customerSearchRequest++;
    this.customerSearchController?.abort();
    this.customerSearchLoading=true;
    this.customerSearchTimer=setTimeout(()=>{this.customerSearchTimer=undefined;void this.searchCustomers();},250);
  }
  private cancelCustomerSearch():void{
    this.customerSearchRequest++;
    if(this.customerSearchTimer)clearTimeout(this.customerSearchTimer);
    this.customerSearchTimer=undefined;
    this.customerSearchController?.abort();
    this.customerSearchController=null;
    this.customerSearchLoading=false;
  }
  private async searchCustomers():Promise<void>{
    const workspace=this.workspace,client=this.workspaceService.client,term=this.customerSearch.trim().replace(/[^\p{L}\p{N}\s+_-]/gu,' ').replace(/\s+/g,' ');
    if(!workspace||!client){
      this.customerSearchLoading=false;this.customerSearchResults=[];
      this.customerSearchError=!client?'Supabase is not configured.':'Select a business workspace.';
      this.cdr.markForCheck();return;
    }
    if(!term){this.customerSearchLoading=false;this.customerSearchResults=[];this.cdr.markForCheck();return;}
    const requestId=++this.customerSearchRequest,controller=new AbortController();
    this.customerSearchController?.abort();this.customerSearchController=controller;this.customerSearchLoading=true;this.customerSearchError='';
    const filters=[`full_name.ilike.%${term}%`,`phone.ilike.%${term}%`,`address->>line1.ilike.%${term}%`,`address->>village.ilike.%${term}%`];
    if(/^\d+$/.test(term))filters.unshift(`customer_code.eq.${term}`);
    try{
      const request=client.from('customers').select('id,full_name,phone,address')
        .eq('business_id',workspace.id).eq('status','active').or(filters.join(','))
        .order('full_name').limit(50).abortSignal(controller.signal);
      const result=await this.withTimeout(request,'Searching customers',()=>controller.abort());
      if(result.error)throw new Error(`${result.error.code??'Supabase'}: ${result.error.message}`);
      if(requestId!==this.customerSearchRequest||workspace.id!==this.workspace?.id)return;
      this.customerSearchResults=(result.data??[]) as unknown as Customer[];
    }catch(error){
      if(requestId!==this.customerSearchRequest)return;
      this.customerSearchError=error instanceof Error?error.message:'Could not search customers.';
      this.customerSearchResults=[];
    }finally{
      if(requestId===this.customerSearchRequest){this.customerSearchLoading=false;this.customerSearchController=null;this.cdr.markForCheck();}
    }
  }
  customerChanged(): void {
    this.customerError = '';
    this.customerBalanceError = '';
    this.customerLedgerRows=[];this.customerLedgerExchangeItems.clear();this.customerLedgerError='';
    if(this.customerId)void this.loadCustomerBalance(this.customerId);
    this.cdr.markForCheck();
  }

  previousOutstandingForSelectedCustomer(): string {
    if (!this.customerId) return '0.00';
    const savedBalance=this.customerBalances.get(this.customerId);
    if(savedBalance!==undefined){const amount=parseFixed(savedBalance,2);return formatFixed(amount>0n?amount:0n,2);}
    const balance = this.sales
      .filter(s => s.customer_id === this.customerId)
      .reduce((sum, sale) => {
        const base = parseFixed(sale.subtotal, 2) - parseFixed(sale.paid_total, 2);
        const returnReduction = this.returnsFor(sale.id)
          .reduce((n, row) => n + parseFixed(row.balance_reduction, 2), 0n);
        return sum + base - returnReduction - this.exchangeTotalForSale(sale.id);
      }, 0n);
    return formatFixed(balance > 0n ? balance : 0n, 2);
  }

  customerCreditForSelectedCustomer():string{
    const balance=this.customerId?this.customerBalances.get(this.customerId):undefined;
    if(balance===undefined)return '0.00';
    const amount=parseFixed(balance,2);
    return formatFixed(amount<0n?-amount:0n,2);
  }

  async loadCustomerBalance(customerId:string):Promise<void>{
    const client=this.workspaceService.client,workspace=this.workspace;
    if(!client||!workspace)return;
    const requestId=++this.customerBalanceRequest;
    this.customerBalanceLoading=true;this.customerBalanceError='';this.cdr.markForCheck();
    try{
      const result=await client.rpc('ss_customer_ledger_page',{p_business_id:workspace.id,p_customer_id:customerId,p_from:null,p_through:null,p_offset:0,p_limit:1});
      if(result.error)throw new Error(`${result.error.code??'Supabase'}: ${result.error.message}`);
      const page=result.data as {totals?:{closing_balance?:string};total_count?:number}|null;
      if(!page?.totals||typeof page.totals.closing_balance!=='string')throw new Error('The customer ledger did not return a confirmed balance.');
      parseFixed(page.totals.closing_balance,2);
      this.customerBalances.set(customerId,page.totals.closing_balance);
      if(requestId===this.customerBalanceRequest){
        const totalCount=Number(page.total_count??0);
        const offset=Math.max(0,Math.floor((totalCount-1)/this.customerLedgerPageSize)*this.customerLedgerPageSize);
        await this.loadCustomerLedgerPage(customerId,offset);
      }
    }catch(error){
      if(requestId===this.customerBalanceRequest)this.customerBalanceError=error instanceof Error?error.message:'Could not load the complete customer ledger.';
    }finally{
      if(requestId===this.customerBalanceRequest){this.customerBalanceLoading=false;this.cdr.markForCheck();}
    }
  }

  async loadCustomerLedgerPage(customerId:string,offset:number):Promise<void>{
      const client=this.workspaceService.client,workspace=this.workspace;
      if(!client||!workspace||customerId!==this.customerId)return;
      const requestId=++this.customerLedgerRequest;
      const safeOffset=Math.max(0,Math.floor(offset/this.customerLedgerPageSize)*this.customerLedgerPageSize);
      this.customerLedgerLoading=true;this.customerLedgerError='';this.cdr.markForCheck();
      try{
        const result=await client.rpc('ss_customer_ledger_page',{p_business_id:workspace.id,p_customer_id:customerId,p_from:null,p_through:null,p_offset:safeOffset,p_limit:this.customerLedgerPageSize});
        if(result.error)throw new Error(`${result.error.code??'Supabase'}: ${result.error.message}`);
        const page=result.data as {page_opening_balance?:string;rows?:CustomerLedgerRow[];total_count?:number}|null;
        if(!page||!Array.isArray(page.rows)||typeof page.page_opening_balance!=='string')throw new Error('The customer ledger returned an invalid transaction page.');
        if(requestId!==this.customerLedgerRequest||customerId!==this.customerId)return;
        this.customerLedgerRows=page.rows;this.customerLedgerOffset=safeOffset;
        this.customerLedgerTotalCount=Number(page.total_count??0);this.customerLedgerPageOpening=page.page_opening_balance;
        const exchangeIds=page.rows.filter(row=>row.event_type==='customer.exchange_payment').map(row=>row.entity_id);
        this.customerLedgerExchangeItems.clear();
        if(exchangeIds.length){
          const details=await client.from('ss_customer_outstanding_exchanges').select('id,customer_adjustment_id,metal,purity,description,net_weight_g,quality_deduction_percent,accepted_weight_g,applied_rate_per_gram,exchange_value')
            .eq('business_id',workspace.id).in('customer_adjustment_id',exchangeIds).order('item_number');
          if(details.error)throw new Error(`${details.error.code??'Supabase'}: ${details.error.message}`);
          const rows=details.data as unknown as OutstandingExchangeLine[];
          for(const row of rows)this.customerLedgerExchangeItems.set(row.customer_adjustment_id,[...(this.customerLedgerExchangeItems.get(row.customer_adjustment_id)??[]),row]);
        }
      }catch(error){if(requestId===this.customerLedgerRequest)this.customerLedgerError=error instanceof Error?error.message:'Could not load customer transaction history.';}
      finally{if(requestId===this.customerLedgerRequest){this.customerLedgerLoading=false;this.cdr.markForCheck();}}
    }
  ledgerExchangeItems(adjustmentId:string):OutstandingExchangeLine[]{return this.customerLedgerExchangeItems.get(adjustmentId)??[];}
  ledgerPreviousBalance(event:CustomerLedgerRow):string{
    const due=parseFixed(event.running_balance,2)-parseFixed(event.debit,2)+parseFixed(event.credit,2);
    return this.inr(formatFixed(due>0n?due:0n,2));
  }
  ledgerCreditDisplay(event:CustomerLedgerRow):string{
    return parseFixed(event.credit,2)===0n?'—':this.inr(event.credit);
  }

  async recordCustomerOutstandingPayment():Promise<void>{
    const workspace=this.workspace,client=this.workspaceService.client,customerId=this.customerId;
    if(!workspace||!client||!customerId||!this.canPost||this.customerPaymentSaving)return;
    if(!this.network.isOnline){this.customerPaymentError='Reconnect to the internet before recording a payment.';return;}
    if(this.customerBalanceLoading||this.customerBalanceError){this.customerPaymentError='Load the verified customer balance before recording payment.';return;}
    if(!this.pendingCustomerPayment){
      try{
        const amount=parseFixed(this.customerPaymentAmount,2);
        const remaining=parseFixed(this.previousOutstandingForSelectedCustomer(),2);
        if(amount<=0n||amount>remaining)throw new Error('Enter a positive amount no greater than the previous outstanding.');
        const reference=this.customerPaymentReference.trim();
        if(reference.length>120)throw new Error('Payment reference must be 120 characters or fewer.');
        this.pendingCustomerPayment={key:crypto.randomUUID(),customerId,amount:formatFixed(amount,2),method:this.customerPaymentMethod,reference:reference||null};
      }catch(error){this.customerPaymentError=error instanceof Error?error.message:'Check the customer payment details.';return;}
    }
    if(this.pendingCustomerPayment.customerId!==customerId){this.customerPaymentError='The selected customer changed. Cancel and enter the payment again.';return;}
    this.customerPaymentSaving=true;this.customerPaymentError='';
    try{
      const request=client.rpc('ss_record_customer_outstanding_payment',{
        p_business_id:workspace.id,p_customer_id:customerId,p_idempotency_key:this.pendingCustomerPayment.key,
        p_amount:this.pendingCustomerPayment.amount,p_method:this.pendingCustomerPayment.method,p_reference:this.pendingCustomerPayment.reference
      });
      const result=await this.withTimeout(request,'Recording customer payment');
      if(result.error){
        this.pendingCustomerPayment=null;
        throw new Error(`${result.error.code??'Supabase'}: ${result.error.message}`);
      }
      if(!result.data)throw new Error('The database did not confirm the customer payment. Retry safely.');
      this.pendingCustomerPayment=null;this.customerPaymentAmount='';this.customerPaymentReference='';
      this.successMessage='Payment against the previous outstanding was recorded without creating a bill.';
      await this.loadCustomerBalance(customerId);
    }catch(error){this.customerPaymentError=error instanceof Error?error.message:'Could not record the customer payment.';}
    finally{this.customerPaymentSaving=false;this.cdr.markForCheck();}
  }
  toggleOutstandingExchange():void{
    this.outstandingExchangeEnabled=!this.outstandingExchangeEnabled;
    this.customerExchangeError='';
    if(this.outstandingExchangeEnabled&&!this.outstandingExchanges.length)this.addOutstandingExchange();
  }
  addOutstandingExchange():void{
    if(this.outstandingExchanges.length>=100)return;
    const item=this.emptyExchange();this.exchangePurityChanged(item);
    this.outstandingExchanges=[...this.outstandingExchanges,item];
  }
  removeOutstandingExchange(index:number):void{
    this.outstandingExchanges=this.outstandingExchanges.filter((_,i)=>i!==index);
    if(!this.outstandingExchanges.length)this.outstandingExchangeEnabled=false;
  }
  get outstandingExchangeTotalMinor():bigint{
    return this.outstandingExchanges.reduce((sum,item)=>sum+this.exchangeValueMinor(item),0n);
  }
  get outstandingAfterExchangeMinor():bigint{
    const outstanding=parseFixed(this.previousOutstandingForSelectedCustomer(),2)-this.outstandingExchangeTotalMinor;
    return outstanding>0n?outstanding:0n;
  }
  async recordCustomerOutstandingExchange():Promise<void>{
    const workspace=this.workspace,client=this.workspaceService.client,customerId=this.customerId;
    if(!workspace||!client||!customerId||!this.canPost||this.customerExchangeSaving)return;
    if(!this.network.isOnline){this.customerExchangeError='Reconnect to the internet before recording an exchange.';return;}
    if(this.customerBalanceLoading||this.customerBalanceError){this.customerExchangeError='Load the verified customer balance before recording an exchange.';return;}
    if(!this.pendingCustomerExchange){
      try{
        const total=this.outstandingExchangeTotalMinor,owing=parseFixed(this.previousOutstandingForSelectedCustomer(),2);
        if(total<=0n)throw new Error('Enter at least one exchange item with a positive calculated value.');
        if(total>owing)throw new Error('Exchange value cannot exceed the customer outstanding balance.');
        const items=this.outstandingExchanges.map((item,index)=>{
          if(!item.description.trim())throw new Error(`Enter a description for exchange item ${index+1}.`);
          const weight=parseFixed(item.gross_weight_g,4),quality=parseFixed(item.quality_deduction_percent,2),factor=parseFixed(item.purity_factor,6);
          const appliedRate=this.exchangeAppliedRate(item);
          if(weight<=0n||quality<1000n||quality>5000n||factor<=0n||factor>1_000_000n||parseFixed(appliedRate,4)<=0n)
            throw new Error(`Check weight, rate, quality deduction and purity for exchange item ${index+1}.`);
          return {
            metal:item.metal,purity:item.purity,description:item.description.trim(),
            net_weight_g:formatFixed(weight,4),quality_deduction_percent:formatFixed(quality,2),
            purity_factor:formatFixed(factor,6),applied_rate_per_gram:formatFixed(parseFixed(appliedRate,4),4),
            rate_snapshot_id:''
          };
        });
        for(let index=0;index<items.length;index++){
          const item=this.outstandingExchanges[index],payload=items[index];
          const snapshot=await this.createRateSnapshot(client,workspace.id,item.metal,item.metal==='silver'?null:item.purity,
            payload.applied_rate_per_gram,`Customer outstanding settlement rate for ${item.metal} ${item.purity}: confirmed at collection.`);
          payload.rate_snapshot_id=snapshot.id;
          payload.applied_rate_per_gram=snapshot.shop_buy_rate;
        }
        this.pendingCustomerExchange={key:crypto.randomUUID(),customerId,items:items as unknown as Json[]};
      }catch(error){this.customerExchangeError=error instanceof Error?error.message:'Check the exchange details.';return;}
    }
    if(this.pendingCustomerExchange.customerId!==customerId){this.customerExchangeError='The selected customer changed. Cancel and enter the exchange again.';return;}
    this.customerExchangeSaving=true;this.customerExchangeError='';
    try{
      const request=client.rpc('ss_record_customer_outstanding_exchange',{
        p_business_id:workspace.id,p_customer_id:customerId,p_idempotency_key:this.pendingCustomerExchange.key,
        p_items:this.pendingCustomerExchange.items
      });
      const result=await this.withTimeout(request,'Recording exchange against customer outstanding');
      if(result.error){if(!['57014','PGRST003','08000','08003','08006'].includes(result.error.code??''))this.pendingCustomerExchange=null;throw new Error(`${result.error.code??'Supabase'}: ${result.error.message}`);}
      if(!result.data)throw new Error('The database did not confirm the customer exchange. Retry safely.');
      this.pendingCustomerExchange=null;this.outstandingExchanges=[];this.outstandingExchangeEnabled=false;
      this.successMessage='Old jewellery was valued and applied to the customer outstanding balance.';
      await this.loadCustomerBalance(customerId);
    }catch(error){this.customerExchangeError=error instanceof Error?error.message:'Could not apply the exchange to the outstanding balance.';}
    finally{this.customerExchangeSaving=false;this.cdr.markForCheck();}
  }

  async createCustomer(): Promise<void> {
    const client = this.workspaceService.client;
    const workspace = this.workspace;
    const name = this.newCustomerName.trim();
    const phone = this.newCustomerPhone.replace(/\D/g, '');
    const addressLine = this.newCustomerAddress.trim();
    if (!client || !workspace) { this.customerError = 'Select a workspace first.'; return; }
    if (!this.canPost) { this.customerError = 'Only an owner or administrator can register customers here.'; return; }
    if (!name) { this.customerError = 'Customer name is required.'; return; }
    if (!this.network.isOnline) { this.customerError = 'Reconnect to the internet before saving a customer.'; return; }
    this.creatingCustomer = true;
    this.customerError = '';
    this.cdr.markForCheck();
    try {
      if (phone) {
        const candidates:{id:string;full_name:string;phone:string|null;address:unknown;status:string}[]=[];
        for(let offset=0;;offset+=500){
          const controller=new AbortController();
          const result=await this.withTimeout(
            client.from('customers').select('id,full_name,phone,address,status').eq('business_id',workspace.id).range(offset,offset+499).abortSignal(controller.signal),
            'Checking customer mobile number',()=>controller.abort()
          );
          if(result.error)throw new Error(`${result.error.code??'Supabase'}: ${result.error.message}`);
          const page=(result.data??[]) as unknown as typeof candidates;
          candidates.push(...page);
          if(page.length<500)break;
        }
        const duplicate=candidates.find(customer=>(customer.phone??'').replace(/\D/g,'')===phone);
        if(duplicate?.status==='active'){
          this.selectCustomer(duplicate);
          this.customerError='This mobile number is already registered. The existing customer has been selected.';
          return;
        }
        if(duplicate){
          this.customerError=`This mobile number belongs to archived customer ${duplicate.full_name}. Restore that customer from Customers before creating a bill.`;
          return;
        }
      }
      const address = addressLine ? { line1: addressLine } : {};
      const result = await client.from('customers').insert({
        business_id: workspace.id,
        full_name: name,
        phone: phone || null,
        address,
        status: 'active'
      }).select('id,full_name,phone,address').single();
      if (result.error) {
        if(result.error.code==='23505')throw new Error('This mobile number is already assigned to a customer. Search for and select the existing customer.');
        throw new Error(`${result.error.code ?? 'Supabase'}: ${result.error.message}`);
      }
      const customer = result.data as unknown as Customer;
      this.customers = [...this.customers, customer].sort((a,b) => a.full_name.localeCompare(b.full_name));
      this.selectCustomer(customer);
      this.successMessage = `Customer ${customer.full_name} was registered.`;
    } catch (error) {
      this.customerError = error instanceof Error ? error.message : 'Could not register the customer.';
    } finally {
      this.creatingCustomer = false;
      this.cdr.markForCheck();
    }
  }

  addLine(): void { if (this.lines.length < 100) { const line=this.emptyLine();this.rateChanged(line);this.lines=[...this.lines,line]; } }
  removeLine(i:number): void { if (this.lines.length > 1) this.lines = this.lines.filter((_,n)=>n!==i); }
  toggleExchange(enabled:boolean):void{this.exchangeEnabled=enabled;if(enabled&&!this.exchanges.length)this.addExchange();if(!enabled)this.excessAction='none';}
  addExchange():void{if(this.exchanges.length<100){const item=this.emptyExchange();this.exchangePurityChanged(item);this.exchanges=[...this.exchanges,item];}}
  removeExchange(i:number):void{this.exchanges=this.exchanges.filter((_,index)=>index!==i);if(!this.exchanges.length)this.exchangeEnabled=false;}
  exchangePurities(metal:'gold'|'silver'):string[]{return metal==='gold'?['24K','22K','20K','18K','16K']:['999','925','Custom'];}
  exchangeMetalChanged(item:ExchangeDraft):void{item.purity=item.metal==='gold'?'24K':'999';item.valuation_mode='selected_purity';this.exchangePurityChanged(item);}
  exchangePurityChanged(item:ExchangeDraft):void{
    if(item.metal==='gold'){
      item.purity_factor='1.000000';
    }
    else if(item.purity==='999')item.purity_factor='0.999000';
    else if(item.purity==='925')item.purity_factor='0.925000';
    else if(item.purity==='Custom'&&!item.purity_factor)item.purity_factor='1.000000';
    const market=this.marketRate(item.metal,item.purity);
    const saved=this.exchangeRatesFor(item)[0];
    item.manual_rate=market?.value??saved?.shop_buy_rate??'';
    item.rate_source=market?'shop_buy':'shop_buy';
    item.rate_snapshot_id=market?'':saved?.id??'';
    item.manual_override_reason='';
  }
  exchangeRateChanged(item:ExchangeDraft):void{item.rate_source='manual';item.rate_snapshot_id='';}
  exchangeRateSourceChanged(item:ExchangeDraft):void{
    item.rate_snapshot_id='';
    if(item.rate_source==='shop_buy'){
      const market=this.marketRate(item.metal,item.purity),saved=this.exchangeRatesFor(item)[0];
      item.manual_rate=market?.value??saved?.shop_buy_rate??'';
      item.manual_override_reason='';
    }
  }
  exchangeRatesFor(item:ExchangeDraft):Rate[]{const purity=item.valuation_mode==='24k_equivalent'?'24K':item.purity;return this.rates.filter(rate=>rate.metal===item.metal&&rate.unit==='gram'&&(item.metal==='silver'?rate.purity===null:rate.purity===purity));}
  private exchangeAppliedRate(item:ExchangeDraft):string{
    if(item.rate_source==='manual')return item.manual_rate.trim()?formatFixed(parseFixed(item.manual_rate,4),4):'0.0000';
    const snapshot=this.rates.find(rate=>rate.id===item.rate_snapshot_id);
    return snapshot?(item.rate_source==='reference'?snapshot.reference_rate:snapshot.shop_buy_rate):item.manual_rate.trim()?formatFixed(parseFixed(item.manual_rate,4),4):'0.0000';
  }
  private exchangeValuation(item:ExchangeDraft):{netWeight:string;acceptedWeight:string;exchangeValue:string}{
    const rate=this.exchangeAppliedRate(item);
    return calculateExchangeValue(item.gross_weight_g||'0','0',item.quality_deduction_percent||'0',item.purity_factor||'0',rate);
  }
  exchangeBreakdown(item:ExchangeDraft):string{
    try{const value=this.exchangeValuation(item);const amount=item.manual_exchange_value.trim()?formatFixed(parseFixed(item.manual_exchange_value,2),2):value.exchangeValue;return `${value.netWeight} g · ${value.acceptedWeight} g · ${this.inr(amount)}`;}
    catch{return 'Enter valid weights, purity and a saved rate';}
  }
  exchangeCalculatedValue(item:ExchangeDraft):string{
    try{return this.inr(this.exchangeValuation(item).exchangeValue);}
    catch{return 'Complete weight and rate';}
  }
  private exchangeValueMinor(item:ExchangeDraft):bigint{
    try{const calculated=this.exchangeValuation(item);return item.manual_exchange_value.trim()?parseFixed(item.manual_exchange_value,2):parseFixed(calculated.exchangeValue,2);}
    catch{return 0n;}
  }
  get exchangeTotalMinor():bigint{return this.exchangeEnabled?this.exchanges.reduce((sum,item)=>sum+this.exchangeValueMinor(item),0n):0n;}
  get netSaleMinor():bigint{const net=this.billTotalMinor-this.exchangeTotalMinor;return net>0n?net:0n;}
  get totalPayableMinor():bigint{const amount=this.netSaleMinor+parseFixed(this.previousOutstandingForSelectedCustomer(),2)-parseFixed(this.customerCreditForSelectedCustomer(),2);return amount>0n?amount:0n;}
  get totalPayableLabel():string{try{return this.inr(formatFixed(this.totalPayableMinor,2));}catch{return '—';}}
  addPayment(): void { if (this.payments.length < 20) this.payments = [...this.payments,{method:'cash',amount:'',reference:''}]; }
  removePayment(i:number): void { this.payments = this.payments.filter((_,n)=>n!==i); }
  purities(metal: Metal): string[] { if(metal==='silver') return ['']; return ['24K','22K','20K','18K','16K']; }
  ratesFor(line: SaleDraftLine): Rate[] { return this.rates.filter(r=>r.metal===line.metal && r.purity===(line.purity||null) && r.unit==='gram'); }
  rateChanged(line: SaleDraftLine): void {
    const available=this.purities(line.metal);
    if(!available.includes(line.purity)) line.purity=line.metal==='gold'?'24K':'';
    const matching=this.ratesFor(line);
    const market=line.metal==='other'?null:this.marketRate(line.metal,line.purity);
    if(market){line.rate_per_gram=market.value;line.rate_source_label=market.label;line.rate_snapshot_id='';}
    else if(matching.length){line.rate_per_gram=matching[0].shop_sell_rate;line.rate_source_label='Saved shop selling rate';line.rate_snapshot_id=matching[0].id;}
    else{line.rate_per_gram='';line.rate_source_label='No cached quote or saved shop rate';line.rate_snapshot_id='';}
  }
  metalChanged(line:SaleDraftLine):void{line.purity=line.metal==='gold'?'24K':'';line.making_charge_percent=line.metal==='gold'?'12':'0';line.rate_snapshot_id='';this.rateChanged(line);}
  saleRateChanged(line:SaleDraftLine):void{line.rate_snapshot_id='';line.rate_source_label='Entered billing rate';}
  private marketRate(metal:'gold'|'silver',purity:string):{value:string;label:string}|null{
    return this.workspace?this.market.quote(this.workspace.id,metal,purity):null;
  }
  private async createRateSnapshot(
    client:NonNullable<WorkspaceService['client']>,businessId:string,metal:'gold'|'silver',
    purity:string|null,rate:string,reason:string
  ):Promise<Rate>{
    const result=await client.from('ss_metal_rate_snapshots' as any).insert({
      business_id:businessId,metal,purity,unit:'gram',reference_rate:rate,
      shop_buy_rate:rate,shop_sell_rate:rate,reason
    }).select('id,metal,purity,unit,reference_rate,shop_buy_rate,shop_sell_rate,recorded_at').single();
    if(result.error)throw new Error(`Could not save the billing rate snapshot: ${result.error.code??'Supabase'}: ${result.error.message}`);
    const snapshot=result.data as unknown as Rate|null;
    if(!snapshot?.id||!snapshot.reference_rate||!snapshot.shop_buy_rate||!snapshot.shop_sell_rate)
      throw new Error('The database did not return the saved billing rate snapshot and its rates.');
    this.rates=[snapshot,...this.rates];
    return snapshot;
  }
  makingCharge(line:SaleDraftLine):string{
    return line.metal==='gold'?percentageCharge(line.net_weight_g||'0',line.rate_per_gram||'0',line.making_charge_percent||'0'):'0.00';
  }
  makingChargeDisplay(line:SaleDraftLine):string{try{return this.inr(this.makingCharge(line));}catch{return '—';}}
  lineTotal(line: SaleDraftLine): string {
    try { if(!line.rate_per_gram)return 'Enter a rate'; return this.inr(formatFixed(purchaseLineTotal(line.net_weight_g||'0',line.rate_per_gram,this.makingCharge(line)),2)); }
    catch { return 'Enter valid weights and charge'; }
  }
  get totalMinor(): bigint { return this.lines.reduce((sum,line)=>{try{return sum+(line.rate_per_gram?purchaseLineTotal(line.net_weight_g||'0',line.rate_per_gram,this.makingCharge(line)):0n);}catch{return sum;}},0n); }
  get gstMinor():bigint{return percentageAmountMinor(this.totalMinor,this.gstPercent);}
  get billTotalMinor():bigint{return this.totalMinor+this.gstMinor;}
  get paidMinor(): bigint { return this.payments.reduce((sum,p)=>sum+(p.amount.trim()?parseFixed(p.amount,2):0n),0n); }
  get totalLabel():string { try{return this.inr(formatFixed(this.totalMinor,2));}catch{return 'Complete item rates and weights';} }
  get gstLabel():string { try{return this.inr(formatFixed(this.gstMinor,2));}catch{return '—';} }
  get billTotalLabel():string { try{return this.inr(formatFixed(this.billTotalMinor,2));}catch{return '—';} }
  get paidLabel():string { try{return this.inr(formatFixed(this.paidMinor,2));}catch{return 'Invalid amount';} }
  get balanceLabel():string { try{const due=this.totalPayableMinor-this.paidMinor;return this.inr(formatFixed(due>0n?due:0n,2));}catch{return '—';} }

  async post():Promise<void> {
    if(this.saving||!this.workspace||!this.canPost)return;
    if(!this.network.isOnline){this.formError='You are offline. The sale was not submitted; reconnect and retry.';return;}
    const client=this.workspaceService.client;if(!client){this.formError='Supabase is not configured.';return;}
    if(this.customerId&&(this.customerBalanceLoading||this.customerBalanceError)){this.formError=this.customerBalanceLoading?'Wait for the complete customer balance to load before posting.':`Customer balance is unavailable: ${this.customerBalanceError}`;return;}
    if(!this.pending){
      try{
        const lines=this.lines.map((line,i)=>{
          const net=parseFixed(line.net_weight_g,4),rate=parseFixed(line.rate_per_gram,4);
          const makingPercent=parseFixed(line.making_charge_percent||'0',2),making=parseFixed(this.makingCharge(line),2);
          if(!line.item_description.trim()||net<=0n||rate<=0n)throw new Error(`Check item ${i+1}: description, net weight, and a positive rate are required.`);
          if(line.metal==='gold'&&(makingPercent<500n||makingPercent>2000n))throw new Error(`Gold making charge for item ${i+1} must be between 5% and 20%.`);
          if(line.metal!=='gold'&&makingPercent!==0n)throw new Error(`Making charge must be zero for non-gold item ${i+1}.`);
          if(purchaseLineTotal(line.net_weight_g,formatFixed(rate,4),formatFixed(making,2))<=0n)throw new Error(`Item ${i+1} total must be positive.`);
          const savedRate=this.rates.find(r=>r.id===line.rate_snapshot_id&&r.metal===line.metal&&r.purity===(line.purity||null)&&r.unit==='gram'&&r.shop_sell_rate===formatFixed(rate,4));
          return {item_description:line.item_description.trim(),metal:line.metal,purity:line.purity||null,gross_weight_g:formatFixed(net,4),net_weight_g:formatFixed(net,4),rate_snapshot_id:savedRate?.id??'',rate_per_gram:formatFixed(rate,4),making_charge_percent:formatFixed(makingPercent,2),making_charge:formatFixed(making,2),gst_percent:this.gstPercent};
        });
        for(let i=0;i<lines.length;i++){
          const line=lines[i] as {metal:'gold'|'silver';purity:string|null;rate_per_gram:string;rate_snapshot_id:string;making_charge_percent:string;making_charge:string};
          let snapshot=this.rates.find(rate=>rate.id===line.rate_snapshot_id&&rate.metal===line.metal&&rate.purity===(line.purity||null)&&rate.unit==='gram'&&rate.shop_sell_rate===line.rate_per_gram);
          if(!snapshot){
            snapshot=await this.createRateSnapshot(client,this.workspace.id,line.metal,line.purity,line.rate_per_gram,
              `Sales billing rate captured for ${line.metal}${line.purity?` ${line.purity}`:''}: ${this.lines[i].rate_source_label||'confirmed by user'}.`);
          }
          line.rate_snapshot_id=snapshot.id;
          line.rate_per_gram=snapshot.shop_sell_rate;
          this.lines[i].rate_snapshot_id=snapshot.id;
          this.lines[i].rate_per_gram=snapshot.shop_sell_rate;
          line.making_charge=this.makingCharge(this.lines[i]);
        }
        const taxableTotal=lines.reduce((sum,line)=>sum+purchaseLineTotal(line.net_weight_g,line.rate_per_gram,line.making_charge),0n);
        const tax=percentageAmountMinor(taxableTotal,this.gstPercent);
        const billTotal=taxableTotal+tax;
        if(this.exchangeEnabled&&!this.customerId)throw new Error('Select or register a customer before receiving old jewellery.');
        const exchanges=this.exchangeEnabled?this.exchanges.map((item,i)=>{
          if(!item.description.trim())throw new Error(`Enter a description for exchange item ${i+1}.`);
          const gross=parseFixed(item.gross_weight_g,4),deduction=0n;
          const quality=parseFixed(item.quality_deduction_percent,2),factor=parseFixed(item.purity_factor,6);
          if(gross<=0n)throw new Error(`Enter a valid net weight for exchange item ${i+1}.`);
          if(quality<1000n||quality>5000n)throw new Error(`Quality deduction for exchange item ${i+1} must be from 10% to 50%.`);
          if(factor<=0n||factor>1_000_000n)throw new Error(`Enter a valid purity factor for exchange item ${i+1}.`);
          const appliedRate=this.exchangeAppliedRate(item);
          if(parseFixed(appliedRate,4)<=0n)throw new Error(`Enter a valid valuation rate for exchange item ${i+1}.`);
          if((item.rate_source==='manual'||item.manual_exchange_value.trim())&&item.manual_override_reason.trim().length<5)throw new Error(`Enter an override reason of at least 5 characters for exchange item ${i+1}.`);
          const value=this.exchangeValuation(item);
          if(parseFixed(item.manual_exchange_value.trim()?item.manual_exchange_value:value.exchangeValue,2)<=0n)throw new Error(`Exchange value for item ${i+1} must be positive.`);
          return {
            metal:item.metal,purity:item.purity,description:item.description.trim(),
            gross_weight_g:formatFixed(gross,4),non_metal_deduction_g:formatFixed(deduction,4),
            quality_deduction_percent:formatFixed(quality,2),purity_factor:formatFixed(factor,6),
            valuation_mode:item.valuation_mode,rate_source:item.rate_source,rate_snapshot_id:item.rate_snapshot_id,
            applied_rate_per_gram:formatFixed(parseFixed(appliedRate,4),4),
            manual_exchange_value:item.manual_exchange_value.trim()?formatFixed(parseFixed(item.manual_exchange_value,2),2):null,
            manual_override_reason:item.manual_override_reason.trim()||null
          };
        }):[];
        const exchangeTotal=exchanges.reduce((sum,_item,index)=>sum+this.exchangeValueMinor(this.exchanges[index]),0n);
        if(exchangeTotal>billTotal&&this.excessAction==='none')throw new Error('Exchange value exceeds the new bill. Choose a refund or customer advance credit.');
        if(exchangeTotal<=billTotal&&this.excessAction!=='none')throw new Error('Choose an excess-handling option only when exchange value exceeds the new bill.');
        const payments=this.payments.filter(p=>p.amount.trim()).map((p,i)=>{const amount=parseFixed(p.amount,2);if(amount<=0n)throw new Error(`Payment ${i+1} must be positive.`);return {method:p.method,amount:formatFixed(amount,2),reference:p.reference.trim()||null};});
        const paid=payments.reduce((sum,p)=>sum+parseFixed(p.amount,2),0n);if(paid>(billTotal>exchangeTotal?billTotal-exchangeTotal:0n))throw new Error('Payments received now cannot exceed the amount due after exchange.');
        for(const line of lines)delete (line as {rate_per_gram?:string}).rate_per_gram;
        for(let i=0;i<exchanges.length;i++){
          const item=this.exchanges[i],exchange=exchanges[i] as {metal:'gold'|'silver';purity:string;rate_snapshot_id:string;applied_rate_per_gram:string};
          const snapshot=await this.createRateSnapshot(client,this.workspace.id,item.metal,item.metal==='silver'?null:item.purity,
            exchange.applied_rate_per_gram,`Exchange valuation rate captured for ${item.metal} ${item.purity}: ${item.rate_source==='manual'?'manual override':'cached market or saved billing quote'}.`);
          exchange.rate_snapshot_id=snapshot.id;
          if(item.rate_source==='reference')exchange.applied_rate_per_gram=snapshot.reference_rate;
          else if(item.rate_source==='shop_buy')exchange.applied_rate_per_gram=snapshot.shop_buy_rate;
          item.rate_snapshot_id=exchange.rate_snapshot_id;
        }
        this.pending={key:crypto.randomUUID(),customerId:this.customerId||null,lines,exchanges,payments,excessAction:this.excessAction,excessRefundMethod:this.excessRefundMethod};
      }catch(error){this.formError=error instanceof Error?error.message:'Check the sale values.';return;}
    }
    this.saving=true;this.formError='';let timedOut=false;let definitiveError=false;const controller=new AbortController();
    try{
      const request=client.rpc('ss_post_sale_with_exchange',{p_business_id:this.workspace.id,p_customer_id:this.pending.customerId,p_idempotency_key:this.pending.key,p_lines:this.pending.lines,p_exchanges:this.pending.exchanges,p_payments:this.pending.payments,p_excess_action:this.pending.excessAction,p_excess_refund_method:this.pending.excessAction==='refund'?this.pending.excessRefundMethod:null}).abortSignal(controller.signal);
      const result=await this.withTimeout(request,'Posting sale',()=>{timedOut=true;controller.abort();});
      if(result.error){definitiveError=true;throw new Error(`${result.error.code??'Supabase'}: ${result.error.message}`);}
      if(!result.data)throw new Error('The database did not confirm the invoice ID. Retry safely.');
      const invoice=result.data;this.pending=null;this.editing=false;this.customerId='';this.customerSearch='';this.lines=[this.emptyLine()];this.payments=[];this.gstPercent='3';this.exchanges=[];this.exchangeEnabled=false;this.excessAction='none';this.successMessage=`Invoice ${invoice} and its exchange/payment records were posted atomically.`;await this.load();
    }catch(error){this.formError=error instanceof Error?error.message:'Could not post the sale.';if(definitiveError)this.pending=null;}
    finally{this.saving=false;this.cdr.markForCheck();}
  }
  customerName(id:string|null):string{return id?this.customers.find(c=>c.id===id)?.full_name??'Customer unavailable':'Walk-in';}
  linesFor(id:string):SaleLine[]{return this.linesBySale.get(id)??[];}
  lineGrossAmount(line:SaleLine):string{return this.inr(formatFixed(this.lineGrossAmountMinor(line),2));}
  private lineGrossAmountMinor(line:SaleLine):bigint{return parseFixed(line.line_total,2)+parseFixed(line.gst_amount||'0',2);}
  paymentMethods(id:string):string{return(this.paymentsBySale.get(id)??[]).map(p=>p.method).join(', ')||'Unpaid';}
  paymentsFor(id:string):SalePayment[]{return this.paymentsBySale.get(id)??[];}
  returnsFor(id:string):SaleReturn[]{return this.returnsBySale.get(id)??[];}
  exchangesFor(id:string):SaleExchange[]{return this.exchangesBySale.get(id)??[];}
  exchangeTotalForSale(id:string):bigint{return this.exchangesFor(id).reduce((sum,item)=>sum+parseFixed(item.exchange_value,2),0n);}
  exchangeTotalLabel(id:string):string{return this.inr(formatFixed(this.exchangeTotalForSale(id),2));}
  netSaleForSale(sale:Sale):string{const net=parseFixed(sale.subtotal,2)-this.exchangeTotalForSale(sale.id);return this.inr(formatFixed(net>0n?net:0n,2));}
  saleForReturn(row:SaleReturn):Sale|undefined{return this.sales.find(s=>s.id===row.sale_id);}
  lineForReturn(row:SaleReturn):SaleLine|undefined{return this.linesFor(row.sale_id).find(line=>line.id===row.sale_line_id);}
  returnFor(line:SaleLine):SaleReturn|undefined{return this.returnsFor(line.sale_id).find(r=>r.sale_line_id===this.lineId(line));}
  isReturned(line:SaleLine):boolean{return !!this.returnFor(line);}
  returned(id:string):string{return formatFixed(this.returnsFor(id).reduce((n,r)=>n+parseFixed(r.original_line_amount,2),0n),2);}
  refunded(id:string):string{return formatFixed(this.returnsFor(id).reduce((n,r)=>n+parseFixed(r.cash_refund,2),0n),2);}
  private lineId(line:SaleLine):string{return line.id;}
  openReturnReceipt(row:SaleReturn):void{this.receiptReturn=row;this.returnReceiptError='';}
  openReturnReceiptForLine(line:SaleLine):void{const row=this.returnFor(line);if(row)this.openReturnReceipt(row);}
  closeReturnReceipt():void{if(!this.returnReceiptPrinting)this.receiptReturn=null;}
  async printReturnReceipt():Promise<void>{
    const client=this.workspaceService.client,workspace=this.workspace,row=this.receiptReturn;
    if(!client||!workspace||!row||this.returnReceiptPrinting)return;
    this.returnReceiptPrinting=true;this.returnReceiptError='';this.cdr.markForCheck();
    try{const result=await client.rpc('ss_audit_sale_return_receipt_print',{p_business_id:workspace.id,p_sale_return_id:row.id});
      if(result.error)throw new Error(`${result.error.code??'Supabase'}: ${result.error.message}`);
      if(!result.data)throw new Error('Supabase did not confirm the return voucher print request.');window.print();
    }catch(error){this.returnReceiptError=error instanceof Error?error.message:'Could not record the return voucher print request.';}
    finally{this.returnReceiptPrinting=false;this.cdr.markForCheck();}
  }
  startReturn(sale:Sale,line:SaleLine):void{this.returnTarget={sale,line};this.returnReason='';this.returnError='';this.refundMethod='cash';this.pendingReturn=null;}
  closeReturn():void{if(!this.returnSaving){this.returnTarget=null;this.pendingReturn=null;}}
  returnBreakdown(target:ReturnTarget):{balanceReduction:string;refund:string;error:string}{
    try{
      const rows=this.returnsFor(target.sale.id);
      const allocation=allocateSaleReturn({subtotalMinor:parseFixed(target.sale.subtotal,2),paidMinor:parseFixed(target.sale.paid_total,2),
        priorBalanceReductionsMinor:rows.reduce((n,r)=>n+parseFixed(r.balance_reduction,2),0n),
        priorCashRefundsMinor:rows.reduce((n,r)=>n+parseFixed(r.cash_refund,2),0n),lineAmountMinor:this.lineGrossAmountMinor(target.line)});
      return{balanceReduction:formatFixed(allocation.balanceReductionMinor,2),refund:formatFixed(allocation.cashRefundMinor,2),error:''};
    }catch(error){return{balanceReduction:'0.00',refund:'0.00',error:error instanceof Error?error.message:'This line cannot be returned.'};}
  }
  async submitReturn():Promise<void>{
    const target=this.returnTarget,client=this.workspaceService.client,workspace=this.workspace;
    if(!target||!client||!workspace||this.returnSaving||!this.canPost)return;
    if(!this.network.isOnline){this.returnError='You are offline. The return was not submitted.';return;}
    if(!this.pendingReturn){const reason=this.returnReason.trim();if(reason.length<3){this.returnError='Enter a return reason of at least 3 characters.';return;}
      const refund=this.returnBreakdown(target).refund;this.pendingReturn={key:crypto.randomUUID(),reason,method:refund==='0.00'?null:this.refundMethod};}
    this.returnSaving=true;this.returnError='';let timedOut=false;let definitiveError=false;const controller=new AbortController();
    try{
      const lineId=this.lineId(target.line);if(!lineId)throw new Error('The saved sale line ID is unavailable. Reload sales before returning this item.');
      const result=await this.withTimeout(client.rpc('ss_return_sale_line',{p_business_id:workspace.id,p_sale_id:target.sale.id,p_sale_line_id:lineId,p_idempotency_key:this.pendingReturn.key,p_reason:this.pendingReturn.reason,p_refund_method:this.pendingReturn.method}).abortSignal(controller.signal),'Posting item return',()=>{timedOut=true;controller.abort();});
      if(result.error){definitiveError=true;throw new Error(`${result.error.code??'Supabase'}: ${result.error.message}`);}
      if(!result.data)throw new Error('Supabase did not confirm the return. Retry safely.');
      const returnId=result.data;this.successMessage='The invoice line was returned. Its unpaid amount was reduced first and any eligible refund was recorded.';this.returnTarget=null;this.pendingReturn=null;await this.load();
      this.receiptReturn=this.returnsFor(target.sale.id).find(row=>row.id===returnId)??null;this.returnReceiptError='';
    }catch(error){this.returnError=error instanceof Error?error.message:'Could not post the item return.';if(definitiveError)this.pendingReturn=null;}
    finally{this.returnSaving=false;this.cdr.markForCheck();}
  }
  filteredSales():Sale[]{
    const term=this.billSearch.trim().toLowerCase();
    if(!term)return this.sales;
    const digits=term.replace(/\D/g,'');
    return this.sales.filter(sale=>{
      const customer=sale.customer_id?this.customers.find(row=>row.id===sale.customer_id):undefined;
      const name=(customer?.full_name??(sale.customer_id?'':'walk-in')).toLowerCase();
      const address=customer?this.customerAddress(customer).toLowerCase():'';
      const phone=(customer?.phone??'').replace(/\D/g,'');
      return name.includes(term)||address.includes(term)||(digits.length>0&&phone.includes(digits))||String(sale.invoice_number??'').toLowerCase().includes(term);
    });
  }
  customerPhone(id:string|null):string{return id?this.customers.find(customer=>customer.id===id)?.phone??'':'';}
  historyReturn(history:SaleHistoryRecord,line:SaleLine):SaleReturn|undefined{return history.returns.find(row=>row.sale_line_id===line.id);}
  historyBalance(history:SaleHistoryRecord):string{
    const due=parseFixed(history.sale.subtotal,2)-parseFixed(history.sale.paid_total,2)
      -history.returns.reduce((sum,row)=>sum+parseFixed(row.balance_reduction,2),0n)
      -history.exchanges.reduce((sum,row)=>sum+parseFixed(row.exchange_value,2),0n);
    return this.inr(formatFixed(due>0n?due:0n,2));
  }
  async toggleBillDetails(sale:Sale):Promise<void>{
    if(this.detailsSaleId===sale.id){this.detailsSaleId=null;this.billHistory=[];this.billHistoryRequest++;return;}
    const requestId=++this.billHistoryRequest;
    this.detailsSaleId=sale.id;this.billHistory=[];this.billHistoryError='';this.billHistoryLoading=false;
    if(!sale.customer_id)return;
    const client=this.workspaceService.client,workspace=this.workspace;
    if(!client||!workspace){this.billHistoryError='Select a workspace to load customer history.';return;}
    this.billHistoryLoading=true;this.cdr.markForCheck();
    try{
      const previous=await this.withTimeout(client.from('ss_sales' as any)
        .select('id,customer_id,invoice_number,subtotal,taxable_subtotal,gst_percent,gst_amount,paid_total,created_at')
        .eq('business_id',workspace.id).eq('customer_id',sale.customer_id).lt('created_at',sale.created_at)
        .order('created_at',{ascending:false}).limit(5),'Loading previous customer invoices');
      if(previous.error)throw new Error(`${previous.error.code??'Supabase'}: ${previous.error.message}`);
      if(requestId!==this.billHistoryRequest||this.detailsSaleId!==sale.id)return;
      const priorSales=(previous.data??[]) as unknown as Sale[],ids=priorSales.map(row=>row.id);
      if(!ids.length)return;
      const [lineResult,exchangeResult,returnResult]=await Promise.all([
        this.withTimeout(client.from('ss_sale_lines' as any).select('id,sale_id,item_description,metal,purity,gross_weight_g,net_weight_g,unit_rate_per_gram,making_charge,making_charge_percent,line_total,gst_amount').eq('business_id',workspace.id).in('sale_id',ids),'Loading previous invoice items'),
        this.withTimeout(client.from('ss_sale_exchanges').select('id,sale_id,customer_id,exchange_number,metal,purity,description,gross_weight_g,non_metal_deduction_g,net_weight_g,quality_deduction_percent,purity_factor,accepted_weight_g,rate_source,reference_rate_per_gram,applied_rate_per_gram,valuation_mode,calculated_exchange_value,exchange_value,manual_override_reason,received_at').eq('business_id',workspace.id).in('sale_id',ids).order('exchange_number'),'Loading previous exchanges'),
        this.withTimeout(client.from('ss_sale_returns' as any).select('id,sale_id,sale_line_id,original_line_amount,balance_reduction,cash_refund,refund_method,reason,recorded_at').eq('business_id',workspace.id).in('sale_id',ids),'Loading previous returns')
      ]);
      if(lineResult.error)throw new Error(`${lineResult.error.code??'Supabase'}: ${lineResult.error.message}`);
      if(exchangeResult.error)throw new Error(`${exchangeResult.error.code??'Supabase'}: ${exchangeResult.error.message}`);
      if(returnResult.error)throw new Error(`${returnResult.error.code??'Supabase'}: ${returnResult.error.message}`);
      if(requestId!==this.billHistoryRequest||this.detailsSaleId!==sale.id)return;
      const lines=lineResult.data as unknown as SaleLine[],exchanges=exchangeResult.data as unknown as SaleExchange[],returns=returnResult.data as unknown as SaleReturn[];
      this.billHistory=priorSales.map(prior=>({sale:prior,lines:lines.filter(line=>line.sale_id===prior.id),exchanges:exchanges.filter(exchange=>exchange.sale_id===prior.id),returns:returns.filter(row=>row.sale_id===prior.id)}));
    }catch(error){if(requestId===this.billHistoryRequest)this.billHistoryError=error instanceof Error?error.message:'Could not load previous customer invoices.';}
    finally{if(requestId===this.billHistoryRequest){this.billHistoryLoading=false;this.cdr.markForCheck();}}
  }
  openReceipt(sale:Sale):void{this.receiptSale=sale;this.receiptError='';this.receiptShareMessage='';}
  closeReceipt():void{if(!this.receiptPrinting)this.receiptSale=null;}
  async printReceipt():Promise<void>{
    const client=this.workspaceService.client,workspace=this.workspace,sale=this.receiptSale;
    if(!client||!workspace||!sale||this.receiptPrinting)return;
    this.receiptPrinting=true;this.receiptError='';this.cdr.markForCheck();
    try{
      const result=await client.rpc('ss_audit_sale_receipt_print',{p_business_id:workspace.id,p_sale_id:sale.id});
      if(result.error)throw new Error(`${result.error.code??'Supabase'}: ${result.error.message}`);
      if(!result.data)throw new Error('Supabase did not confirm the print audit event.');
      window.print();
    }catch(error){this.receiptError=error instanceof Error?error.message:'Could not record the receipt print request.';}
    finally{this.receiptPrinting=false;this.cdr.markForCheck();}
  }
  async downloadReceipt(sale:Sale):Promise<void>{
    if(this.receiptSharing)return;
    this.receiptSharing=true;this.receiptShareMessage='';this.cdr.markForCheck();
    try{
      const pdf=await this.createReceiptPdf(sale);
      pdf.save(this.receiptFileName(sale));
      this.setReceiptShareMessage(`Invoice #${sale.invoice_number} PDF downloaded.`);
    }catch(error){
      this.setReceiptShareMessage(error instanceof Error?error.message:'Could not prepare the invoice PDF.');
    }finally{this.receiptSharing=false;this.cdr.markForCheck();}
  }
  async shareReceipt(sale:Sale):Promise<void>{
    if(this.receiptSharing)return;
    this.receiptSharing=true;this.receiptShareMessage='';this.cdr.markForCheck();
    let chatWindow:Window|null=null;
    try{
      const shareProbe=new File(['receipt'],'receipt.pdf',{type:'application/pdf'});
      const nativeFileShare=typeof navigator.share==='function'&&typeof navigator.canShare==='function'&&navigator.canShare({files:[shareProbe]});
      if(!nativeFileShare)chatWindow=window.open('about:blank','_blank');
      const pdf=await this.createReceiptPdf(sale),blob=pdf.output('blob');
      const file=new File([blob],this.receiptFileName(sale),{type:'application/pdf'});
      const message=`Sales receipt #${sale.invoice_number} from ${this.workspace?.name||'SwarnaSuraksha'}. Total payable: ${this.inr(sale.total_payable||sale.subtotal)}.`;
      if(typeof navigator.share==='function'&&typeof navigator.canShare==='function'&&navigator.canShare({files:[file]})){
        await navigator.share({files:[file],title:`Sales receipt #${sale.invoice_number}`,text:message});
        this.setReceiptShareMessage('Receipt PDF shared. Choose WhatsApp in the share sheet if it is available.');
        return;
      }
      pdf.save(this.receiptFileName(sale));
      const phone=this.whatsAppNumber(this.customerPhone(sale.customer_id));
      const whatsappUrl=`https://wa.me/${phone}?text=${encodeURIComponent(message)}`;
      if(chatWindow)chatWindow.location.href=whatsappUrl;
      else window.location.assign(whatsappUrl);
      this.setReceiptShareMessage('PDF downloaded and WhatsApp opened. Attach the downloaded PDF to the chat to send it.');
    }catch(error){
      chatWindow?.close();
      if(error instanceof DOMException&&error.name==='AbortError')this.setReceiptShareMessage('PDF sharing was cancelled.');
      else this.setReceiptShareMessage(error instanceof Error?error.message:'Could not prepare or share the receipt PDF.');
    }finally{this.receiptSharing=false;this.cdr.markForCheck();}
  }
  private setReceiptShareMessage(message:string):void{
    this.receiptShareMessage=message;
    if(!this.receiptSale)this.successMessage=message;
  }
  private whatsAppNumber(phone:string):string{
    const digits=phone.replace(/\D/g,'');
    return digits.length===10?`91${digits}`:digits;
  }
  private receiptFileName(sale:Sale):string{
    const customer=this.customerName(sale.customer_id).toLocaleLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'')||'customer';
    return `invoice-${sale.invoice_number}-${customer}.pdf`;
  }
  private async createReceiptPdf(sale:Sale):Promise<jsPDF>{
    const {jsPDF}=await import('jspdf');
    const pdf=new jsPDF({unit:'mm',format:'a4'});
    const dateLabel=(value:string)=>new Intl.DateTimeFormat('en-IN',{dateStyle:'medium',timeStyle:'short',timeZone:'Asia/Kolkata'}).format(new Date(value));
    const net=parseFixed(sale.subtotal,2)-this.exchangeTotalForSale(sale.id);
    renderReceiptPdf(pdf,{
      business:this.workspace?.name||'Jewellery Business',invoiceNo:String(sale.invoice_number),dateLabel:dateLabel(sale.created_at),customer:this.customerName(sale.customer_id),mobile:this.customerPhone(sale.customer_id)||'',
      lines:this.linesFor(sale.id).map(i=>({description:i.item_description,metal:i.metal,purity:i.purity||'',weightG:i.net_weight_g,rate:i.unit_rate_per_gram,making:i.making_charge,makingPct:i.making_charge_percent||'',taxable:i.line_total,gst:i.gst_amount,total:this.fixed(this.lineGrossAmountMinor(i),2)})),
      exchanges:this.exchangesFor(sale.id).map(i=>({description:i.description,metal:i.metal,purity:i.purity,netG:i.net_weight_g,deductionPct:i.quality_deduction_percent,acceptedG:i.accepted_weight_g,rate:i.applied_rate_per_gram,credit:i.exchange_value})),
      returns:this.returnsFor(sale.id).map(i=>({item:this.lineForReturn(i)?.item_description||'Invoice item',reason:i.reason,value:i.original_line_amount,refund:i.cash_refund})),
      summary:{taxable:sale.taxable_subtotal,gstPercent:sale.gst_percent,gst:sale.gst_amount,newTotal:sale.subtotal,exchangeCredit:formatFixed(this.exchangeTotalForSale(sale.id),2),net:formatFixed(net>0n?net:0n,2),previous:sale.previous_outstanding||'0',totalPayable:sale.total_payable||sale.subtotal,paid:sale.paid_total,balance:this.balanceAmount(sale),returned:this.returned(sale.id),refunded:this.refunded(sale.id)},
      payments:this.paymentsFor(sale.id).map(i=>({method:i.method,amount:i.amount,reference:i.reference||'',date:i.recorded_at?dateLabel(i.recorded_at):''})),
      note:'GST is calculated at the saved invoice rate. Confirm applicable tax-invoice requirements before issuing this receipt as a formal GST invoice.'
    });
    return pdf;
  }
  balance(sale:Sale):string{return this.inr(this.balanceAmount(sale));}
  balanceAmount(sale:Sale):string{const due=parseFixed(sale.subtotal,2)-parseFixed(sale.paid_total,2)-this.returnsFor(sale.id).reduce((n,r)=>n+parseFixed(r.balance_reduction,2),0n)-this.exchangeTotalForSale(sale.id);return formatFixed(due>0n?due:0n,2);}
  inr(value:string):string{return formatInr(value,2);}
  private emptyLine():SaleDraftLine{return{item_description:'',metal:'gold',purity:'24K',net_weight_g:'',rate_per_gram:'',rate_source_label:'',rate_snapshot_id:'',making_charge_percent:'12'};}
  private emptyExchange():ExchangeDraft{return{metal:'gold',purity:'24K',description:'',gross_weight_g:'',non_metal_deduction_g:'0.0000',quality_deduction_percent:'20.00',purity_factor:'1.000000',valuation_mode:'selected_purity',rate_source:'shop_buy',rate_snapshot_id:'',manual_rate:'',manual_exchange_value:'',manual_override_reason:''};}
  private group<T extends {sale_id:string}>(rows:T[]):Map<string,T[]>{const m=new Map<string,T[]>();for(const row of rows)m.set(row.sale_id,[...(m.get(row.sale_id)??[]),row]);return m;}
  private async withTimeout<T>(request:PromiseLike<T>,action:string,abort?:()=>void):Promise<T>{let timer:ReturnType<typeof setTimeout>|undefined;try{return await Promise.race([Promise.resolve(request),new Promise<T>((_,reject)=>{timer=setTimeout(()=>{abort?.();reject(new Error(`${action} timed out after 20 seconds. Retry with the same details; do not start a duplicate transaction.`));},20000);})]);}finally{if(timer)clearTimeout(timer);}}
}