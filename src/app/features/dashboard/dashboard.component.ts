import { CommonModule } from '@angular/common';
import { ChangeDetectorRef, Component, OnDestroy, OnInit } from '@angular/core';
import { RouterLink } from '@angular/router';
import { IonicModule } from '@ionic/angular';
import { Subscription } from 'rxjs';
import { RatesComponent } from '../rates/rates.component';
import { BusinessWorkspace, WorkspaceService } from './workspace.service';

@Component({
  standalone: true,
  imports: [CommonModule, IonicModule, RouterLink, RatesComponent],
  template: `
    <header class="topbar home-topbar">
      <div class="crumb"><b>Home</b><span>/</span>{{ workspace?.name || 'Your jewellery business' }}</div>
      <div class="home-date">{{ today | date:'EEEE, d MMMM y':'Asia/Kolkata' }}</div>
    </header>

    <section class="content home-content">
      <div class="home-hero">
        <h1>Welcome back<span *ngIf="workspace">, {{ workspace.name }}</span></h1>
        <p class="subtitle">Check today’s rates, start a bill or record a girvi.</p>
      </div>

      <app-rates [embedded]="true"></app-rates>

      <section class="home-section" aria-labelledby="home-actions-title">
        <h2 id="home-actions-title" class="home-section-title">Quick actions</h2>
        <div class="home-action-grid">
          <a routerLink="/dashboard/sales" class="home-action">
            <span class="home-action-icon icon-gold" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none"><path d="M7 3h10v18l-2.5-1.6L12 21l-2.5-1.6L7 21V3Z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><path d="M10 8h4M10 12h4" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>
            </span>
            <span class="home-action-copy"><b>Create new bill</b><small>Record a jewellery sale</small></span>
            <span class="home-action-arrow" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none"><path d="M5 12h14m-6-6 6 6-6 6" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></svg></span>
          </a>
          <a routerLink="/dashboard/girvi" class="home-action">
            <span class="home-action-icon icon-green" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none"><rect x="4" y="10" width="16" height="10" rx="2.5" stroke="currentColor" stroke-width="1.7"/><path d="M8 10V7a4 4 0 0 1 8 0v3" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/><circle cx="12" cy="15" r="1.4" fill="currentColor"/></svg>
            </span>
            <span class="home-action-copy"><b>Create new girvi</b><small>Record a gold or silver pledge</small></span>
            <span class="home-action-arrow" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none"><path d="M5 12h14m-6-6 6 6-6 6" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></svg></span>
          </a>
        </div>
      </section>

      <section class="home-section" aria-labelledby="home-activity-title">
        <div class="home-section-head">
          <h2 id="home-activity-title" class="home-section-title">Recent activity</h2>
          <button class="text-btn" type="button" (click)="loadRecentActivity()" [disabled]="activityLoading">{{ activityLoading ? 'Loading…' : 'Refresh' }}</button>
        </div>

        <div class="activity-alert" *ngIf="activityError" role="alert">
          <span class="activity-alert-icon">!</span>
          <div>
            <b>{{ girviSetupMissing ? 'Girvi is not set up in the database yet' : 'Some activity could not load' }}</b>
            <p>{{ activityError }}</p>
            <p *ngIf="girviSetupMissing">Run migration <code>020_girvi_pledges.sql</code> in the Supabase SQL Editor to create the Girvi tables.</p>
          </div>
        </div>

        <div class="activity-grid" *ngIf="!activityLoading">
          <div class="activity-card">
            <h3>Latest bills</h3>
            <div class="activity-row" *ngFor="let bill of recentBills">
              <span><b>Bill #{{bill.invoice_number}}</b><small>{{customerName(bill.customer_id)}} · {{bill.created_at | date:'d MMM y':'Asia/Kolkata'}}</small></span>
              <strong>{{inr(bill.subtotal)}}</strong>
            </div>
            <div class="empty-activity" *ngIf="!recentBills.length">
              <b>No bills yet</b>
              <span>Your latest sales will show up here.</span>
              <a routerLink="/dashboard/sales">Create a bill</a>
            </div>
          </div>
          <div class="activity-card">
            <h3>Latest girvi</h3>
            <div class="activity-row" *ngFor="let pledge of recentGirvi">
              <span><b>Girvi #{{pledge.girvi_number}}</b><small>{{customerName(pledge.customer_id)}} · {{pledge.metal | titlecase}} · {{pledge.girvi_date | date:'d MMM y':'Asia/Kolkata'}}</small></span>
              <strong>{{inr(pledge.principal_amount)}}</strong>
            </div>
            <div class="empty-activity" *ngIf="!recentGirvi.length">
              <b>No girvi yet</b>
              <span>Your latest pledges will show up here.</span>
              <a routerLink="/dashboard/girvi">Record a girvi</a>
            </div>
          </div>
        </div>
        <p class="activity-loading" *ngIf="activityLoading">Loading recent activity…</p>
      </section>

      <footer class="home-footer">
        <span>Market rates are reference quotes. Confirm your shop’s buying and selling rates separately.</span>
        <span>Currency: INR</span>
      </footer>
    </section>
  `,
  styles: [`
    .home-content { max-width: 1360px; }
    .home-hero { margin-bottom: 26px; }
    .home-hero h1 { margin: 0; font: 700 36px/1.15 'Playfair Display', serif; letter-spacing: -.01em; color: #17241d; overflow-wrap: anywhere; }
    .home-hero h1 span { color: inherit; text-transform: capitalize; }
    .home-date { font-size: 14px; color: #6d7b73; }

    .home-section { margin-top: 38px; }
    .home-section-head { display: flex; align-items: center; justify-content: space-between; }
    .home-section-title { margin: 0 0 16px; font: 700 22px 'Playfair Display', serif; color: #17241d; }
    .home-section-head .home-section-title { margin-bottom: 16px; }

    /* Quick actions – raised keys */
    .home-action-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 22px; perspective: 1200px; }
    .home-action {
      display: flex; align-items: center; gap: 18px; min-width: 0; padding: 22px 24px; border-radius: 20px;
      text-decoration: none; color: inherit; border: 1px solid #e1e5dc;
      background: linear-gradient(180deg, #ffffff, #f9faf6);
      box-shadow: inset 0 1px 0 #fff, inset 0 -3px 0 rgba(18,33,26,.05), 0 2px 4px rgba(18,33,26,.05), 0 16px 26px -12px rgba(18,33,26,.22);
      transition: transform .25s cubic-bezier(.2,.7,.2,1), box-shadow .25s ease;
    }
    .home-action:hover { transform: perspective(900px) rotateX(2deg) translateY(-6px); box-shadow: inset 0 1px 0 #fff, inset 0 -3px 0 rgba(18,33,26,.06), 0 4px 8px rgba(18,33,26,.07), 0 26px 38px -14px rgba(18,33,26,.3); }
    .home-action:active { transform: translateY(1px); }
    .home-action-icon { display: grid; place-items: center; flex: 0 0 56px; width: 56px; height: 56px; border-radius: 16px; }
    .home-action-icon svg { width: 28px; height: 28px; }
    .icon-gold { color: #4b3408; background: linear-gradient(145deg, #f8e8ae, #d9b25a); box-shadow: inset 0 1px 0 rgba(255,255,255,.85), inset 0 -3px 0 rgba(112,78,16,.35), 0 8px 14px -6px rgba(138,100,32,.6); }
    .icon-green { color: #f6e7b4; background: linear-gradient(145deg, #3a6a51, #1f3d2e); box-shadow: inset 0 1px 0 rgba(255,255,255,.3), inset 0 -3px 0 rgba(0,0,0,.3), 0 8px 14px -6px rgba(23,48,31,.7); }
    .home-action-copy { min-width: 0; flex: 1; }
    .home-action-copy b, .home-action-copy small { display: block; }
    .home-action-copy b { font-size: 17px; color: #17241d; }
    .home-action-copy small { margin-top: 5px; font-size: 14px; color: #5b6a61; }
    .home-action-arrow { display: grid; place-items: center; width: 38px; height: 38px; border-radius: 50%; color: #2c5039; background: #eef2ea; transition: transform .2s, background .2s; }
    .home-action-arrow svg { width: 18px; height: 18px; }
    .home-action:hover .home-action-arrow { transform: translateX(4px); background: #e1eadc; }

    /* Recent activity */
    .activity-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 22px; }
    .activity-card { padding: 22px 24px; border-radius: 20px; border: 1px solid #e1e5dc; background: linear-gradient(180deg, #fff, #fafbf7); box-shadow: inset 0 1px 0 #fff, 0 16px 26px -14px rgba(18,33,26,.2); }
    .activity-card h3 { margin: 0 0 8px; font-size: 16px; color: #2c3d33; }
    .activity-row { display: flex; justify-content: space-between; gap: 12px; padding: 14px 0; border-top: 1px solid #edf0e8; font-size: 14px; }
    .activity-row span { min-width: 0; }
    .activity-row b, .activity-row small { display: block; }
    .activity-row small { margin-top: 4px; font-size: 13px; color: #6d7b73; }
    .activity-row strong { white-space: nowrap; font-size: 15px; font-variant-numeric: tabular-nums; }
    .empty-activity { display: flex; flex-direction: column; align-items: flex-start; gap: 4px; padding: 18px 0 6px; border-top: 1px solid #edf0e8; font-size: 14px; color: #5b6a61; }
    .empty-activity b { color: #2c3d33; font-size: 15px; }
    .empty-activity a { margin-top: 8px; font-weight: 700; color: #2c5039; text-decoration: none; }
    .empty-activity a:hover { text-decoration: underline; }
    .activity-loading { font-size: 14px; color: #5b6a61; }

    .activity-alert { display: flex; gap: 14px; margin-bottom: 18px; padding: 16px 20px; border-radius: 16px; border: 1px solid #f0d3cd; background: linear-gradient(180deg, #fff8f6, #fdf0ed); box-shadow: 0 10px 20px -14px rgba(163,57,45,.4); }
    .activity-alert-icon { display: grid; place-items: center; flex: none; width: 30px; height: 30px; border-radius: 50%; background: #f6dcd7; color: #a3392d; font-weight: 700; }
    .activity-alert b { font-size: 14px; color: #7a2f26; }
    .activity-alert p { margin: 4px 0 0; font-size: 13px; line-height: 1.55; color: #7a5a55; }
    .activity-alert code { padding: 2px 6px; border-radius: 6px; background: #f3dfda; font-size: 12px; }

    .home-footer { display: flex; justify-content: space-between; flex-wrap: wrap; gap: 8px; margin-top: 34px; padding-top: 18px; border-top: 1px solid #dfe4d9; color: #6d7b73; font-size: 13px; line-height: 1.5; }

    @media (max-width: 700px) {
      .home-content { padding: 18px 14px 28px; }
      .home-hero h1 { font-size: 27px; }
      .home-date { display: none; }
      .home-section { margin-top: 28px; }
      .home-action-grid, .activity-grid { grid-template-columns: 1fr; gap: 14px; }
      .home-action { padding: 18px; }
      .home-footer { flex-direction: column; }
    }
    @media (prefers-reduced-motion: reduce) {
      .home-action, .home-action-arrow { transition: none; }
      .home-action:hover { transform: none; }
    }
  `]
})
export class DashboardComponent implements OnInit, OnDestroy {
  workspace: BusinessWorkspace | null = null;
  recentBills: Array<{id:string;customer_id:string|null;invoice_number:number;subtotal:string;created_at:string}> = [];
  recentGirvi: Array<{id:string;customer_id:string;girvi_number:number;metal:string;principal_amount:string;girvi_date:string}> = [];
  private customers = new Map<string, string>();
  readonly today = new Date();
  activityLoading = false;
  activityError = '';
  private activityRequestId = 0;
  private subscription: Subscription | null = null;

  constructor(private readonly workspaceService: WorkspaceService, private readonly cdr: ChangeDetectorRef) {}

  ngOnInit(): void {
    this.subscription = this.workspaceService.activeWorkspace$.subscribe(workspace => {
      this.workspace = workspace;
      this.activityRequestId++;
      this.cdr.markForCheck();
      if (workspace) void this.loadRecentActivity();
      else {
        this.recentBills = [];
        this.recentGirvi = [];
        this.activityLoading = false;
        this.activityError = '';
      }
    });
  }

  async loadRecentActivity(): Promise<void> {
    const workspace = this.workspace;
    const client = this.workspaceService.client;
    if (!workspace || !client) return;
    const requestId = ++this.activityRequestId;
    this.activityLoading = true;
    this.activityError = '';
    try {
      const [sales, girvi] = await Promise.all([
        client.from('ss_sales' as any).select('id,customer_id,invoice_number,subtotal,created_at')
          .eq('business_id', workspace.id).order('created_at', { ascending: false }).limit(5),
        client.from('ss_girvi' as any).select('id,customer_id,girvi_number,metal,principal_amount,girvi_date')
          .eq('business_id', workspace.id).order('created_at', { ascending: false }).limit(5)
      ]);
      if (sales.error) throw new Error(`Bills: ${sales.error.message}`);
      if (girvi.error) throw new Error(`Girvi: ${girvi.error.message}`);
      if (requestId !== this.activityRequestId) return;
      const bills = (sales.data ?? []) as unknown as typeof this.recentBills;
      const pledges = (girvi.data ?? []) as unknown as typeof this.recentGirvi;
      const ids = [...new Set([...bills.map(row => row.customer_id), ...pledges.map(row => row.customer_id)].filter((id): id is string => !!id))];
      if (ids.length) {
        const customers = await client.from('customers').select('id,full_name').eq('business_id', workspace.id).in('id', ids);
        if (customers.error) throw new Error(`Customers: ${customers.error.message}`);
        if (requestId !== this.activityRequestId) return;
        this.customers = new Map((customers.data ?? []).map(row => [row.id, row.full_name]));
      } else {
        this.customers.clear();
      }
      this.recentBills = bills;
      this.recentGirvi = pledges;
    } catch (error) {
      if (requestId === this.activityRequestId) this.activityError = error instanceof Error ? error.message : 'Could not load recent activity.';
    } finally {
      if (requestId === this.activityRequestId) {
        this.activityLoading = false;
        this.cdr.markForCheck();
      }
    }
  }

  get girviSetupMissing(): boolean { return this.activityError.includes('ss_girvi'); }

  customerName(id: string | null): string { return id ? this.customers.get(id) ?? 'Customer' : 'Walk-in customer'; }
  inr(value: string): string { return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 }).format(Number(value)); }

  ngOnDestroy(): void {
    this.subscription?.unsubscribe();
  }
}