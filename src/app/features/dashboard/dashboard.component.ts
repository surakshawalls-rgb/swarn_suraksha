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
      <div class="crumb"><b>Home</b><span>›</span>{{ workspace?.name || 'Your jewellery business' }}</div>
    </header>

    <section class="content home-content">
      <div class="welcome home-welcome">
        <div>
          <p class="eyebrow">SWARNASURAKSHA HOME</p>
          <h1>Welcome back<span *ngIf="workspace">, {{ workspace.name }}</span></h1>
          <p class="subtitle">Your gold and silver rates are ready to view.</p>
        </div>
      </div>

      <app-rates [embedded]="true"></app-rates>

      <section class="panel home-quick-actions" aria-labelledby="home-actions-title">
        <div class="panel-head">
          <div>
            <h2 id="home-actions-title">Quick actions</h2>
            <p>Jump straight to the tasks you use most.</p>
          </div>
        </div>
        <div class="home-action-grid">
          <a routerLink="/dashboard/sales" class="home-action">
            <span class="home-action-icon sale-icon">＋</span>
            <span><b>Create New Bill</b><small>Record a jewellery sale</small></span>
            <span class="home-action-arrow">→</span>
          </a>
          <a routerLink="/dashboard/girvi" class="home-action">
            <span class="home-action-icon customer-icon">₹</span>
            <span><b>Create New Girvi</b><small>Record a gold or silver pledge</small></span>
            <span class="home-action-arrow">→</span>
          </a>
        </div>
      </section>

      <section class="panel home-activity" aria-labelledby="home-activity-title">
        <div class="panel-head">
          <div><h2 id="home-activity-title">Recent activity</h2><p>Your latest bills and Girvi transactions.</p></div>
          <button class="text-btn" type="button" (click)="loadRecentActivity()" [disabled]="activityLoading">Refresh</button>
        </div>
        <p class="form-error" *ngIf="activityError" role="alert">{{activityError}}</p>
        <div class="activity-grid" *ngIf="!activityLoading">
          <div>
            <h3>Latest bills</h3>
            <div class="activity-row" *ngFor="let bill of recentBills">
              <span><b>Bill #{{bill.invoice_number}}</b><small>{{customerName(bill.customer_id)}} · {{bill.created_at | date:'d MMM y':'Asia/Kolkata'}}</small></span>
              <strong>{{inr(bill.subtotal)}}</strong>
            </div>
            <p class="empty-activity" *ngIf="!recentBills.length">No bills yet.</p>
          </div>
          <div>
            <h3>Latest Girvi</h3>
            <div class="activity-row" *ngFor="let pledge of recentGirvi">
              <span><b>Girvi #{{pledge.girvi_number}}</b><small>{{customerName(pledge.customer_id)}} · {{pledge.metal | titlecase}} · {{pledge.girvi_date | date:'d MMM y':'Asia/Kolkata'}}</small></span>
              <strong>{{inr(pledge.principal_amount)}}</strong>
            </div>
            <p class="empty-activity" *ngIf="!recentGirvi.length">No Girvi transactions yet.</p>
          </div>
        </div>
        <p class="activity-loading" *ngIf="activityLoading">Loading recent activity…</p>
      </section>

      <footer class="home-footer">
        <span>Market rates are reference quotes. Confirm your shop's buying and selling rates separately.</span>
        <span>Currency: INR</span>
      </footer>
    </section>
  `,
  styles: [`
    .home-content { max-width: 1320px; }
    .home-welcome { margin-bottom: 18px; }
    .home-welcome h1 { overflow-wrap: anywhere; }
    .home-welcome h1 span { color: #8c978f; }
    .home-quick-actions { margin-top: 18px; }
    .home-action-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; margin-top: 15px; }
    .home-action { display: flex; align-items: center; gap: 11px; min-width: 0; padding: 14px; border: 1px solid #edf0eb; border-radius: 9px; text-decoration: none; color: inherit; transition: border-color .15s, transform .15s; }
    .home-action:hover { border-color: #c8d4ca; transform: translateY(-1px); }
    .home-action > span:nth-child(2) { min-width: 0; flex: 1; }
    .home-action b, .home-action small { display: block; }
    .home-action b { font-size: 12px; color: #34463a; }
    .home-action small { margin-top: 4px; color: #859188; font-size: 10px; line-height: 1.5; }
    .home-action-icon { display: grid; place-items: center; width: 35px; height: 35px; flex: 0 0 35px; border-radius: 9px; font-size: 17px; }
    .sale-icon { background: #f8f0e3; color: #ab8543; }
    .customer-icon { background: #eff3ea; color: #64804e; }
    .transaction-icon { background: #eaf3ee; color: #528368; }
    .home-action-arrow { color: #a1ada4; }
    .home-activity { margin-top: 18px; }
    .activity-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 24px; }
    .activity-grid h3 { margin: 0 0 8px; color: #506056; font-size: 12px; }
    .activity-row { display: flex; justify-content: space-between; gap: 10px; padding: 10px 0; border-top: 1px solid #edf0eb; font-size: 12px; }
    .activity-row span { min-width: 0; }
    .activity-row b, .activity-row small { display: block; }
    .activity-row small { margin-top: 4px; color: #859188; }
    .activity-row strong { white-space: nowrap; }
    .empty-activity, .activity-loading { color: #859188; font-size: 12px; }
    .home-footer { display: flex; justify-content: space-between; flex-wrap: wrap; gap: 8px; margin-top: 18px; color: #929c95; font-size: 10px; line-height: 1.5; }
    @media (max-width: 700px) {
      .home-content { padding: 18px 12px 20px; }
      .home-welcome { margin-bottom: 12px; }
      .home-welcome h1 { font-size: 23px; line-height: 1.3; }
      .home-action-grid { grid-template-columns: 1fr; gap: 8px; }
      .home-action { min-height: 66px; padding: 12px; }
      .home-quick-actions { margin-top: 12px; }
      .activity-grid { grid-template-columns: 1fr; gap: 18px; }
      .home-footer { flex-direction: column; }
    }
  `]
})
export class DashboardComponent implements OnInit, OnDestroy {
  workspace: BusinessWorkspace | null = null;
  recentBills: Array<{id:string;customer_id:string|null;invoice_number:number;subtotal:string;created_at:string}> = [];
  recentGirvi: Array<{id:string;customer_id:string;girvi_number:number;metal:string;principal_amount:string;girvi_date:string}> = [];
  private customers = new Map<string, string>();
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

  customerName(id: string | null): string { return id ? this.customers.get(id) ?? 'Customer' : 'Walk-in customer'; }
  inr(value: string): string { return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 }).format(Number(value)); }

  ngOnDestroy(): void {
    this.subscription?.unsubscribe();
  }
}
