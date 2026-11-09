import { CommonModule } from '@angular/common';
import { ChangeDetectorRef, Component, OnDestroy, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { IonicModule } from '@ionic/angular';
import { Subscription } from 'rxjs';
import { AuthService } from '../../core/auth/auth.service';
import { NetworkStatusService } from '../../core/network/network-status.service';
import { BusinessWorkspace, WorkspaceService } from './workspace.service';

@Component({
  standalone: true,
  imports: [CommonModule, FormsModule, IonicModule, RouterLink, RouterLinkActive, RouterOutlet],
  template: `
    <div class="app-shell" [class.shell-hidden]="loading || !!errorMessage || !workspaces.length">
      <aside class="app-sidebar">
        <a class="app-brand" routerLink="/dashboard"><span class="brand-mark">S</span><span><b>SwarnaSuraksha</b><small>JEWELLERY BUSINESS</small></span></a>
        <label class="shell-workspace" *ngIf="workspaces.length > 1">Business workspace
          <select [ngModel]="activeWorkspace?.id ?? ''" (ngModelChange)="selectWorkspace($event)">
            <option value="" disabled>Select a workspace</option>
            <option *ngFor="let item of workspaces" [value]="item.id">{{item.name}}</option>
          </select>
        </label>
        <div class="shell-active" *ngIf="activeWorkspace && workspaces.length === 1"><small>ACTIVE BUSINESS</small><b>{{activeWorkspace.name}}</b></div>
        <nav aria-label="Main navigation">
          <a routerLink="/dashboard" routerLinkActive="selected" [routerLinkActiveOptions]="{ exact: true }">Home</a>
          <a routerLink="/dashboard/sales" routerLinkActive="selected">Bill</a>
          <a routerLink="/dashboard/girvi" routerLinkActive="selected">Girvi</a>
        </nav>
        <div class="shell-user"><span class="avatar">{{initials}}</span><span><b>{{userName}}</b><small>Signed in securely</small></span><button type="button" (click)="signOut()" [disabled]="busy">Sign out</button></div>
      </aside>
      <main class="app-main"><div class="config-banner error-banner" *ngIf="!(network.online$ | async)" role="alert"><span class="banner-icon">!</span><div><b>You are offline</b><p>Financial posting is disabled until the connection returns. An interrupted request may still have reached Supabase; retry it using the same idempotency-safe action.</p></div></div><div class="workspace-prompt" *ngIf="workspaces.length > 1 && !activeWorkspace" role="status"><b>Select a business workspace</b><span>Choose one above to load tenant-scoped records.</span></div><router-outlet /></main>
    </div>

    <main class="setup-page" *ngIf="loading || errorMessage || workspaces.length === 0">
      <header class="setup-brand"><span class="brand-mark">S</span><b>SwarnaSuraksha</b><button type="button" (click)="signOut()" [disabled]="busy">Sign out</button></header>
      <section class="setup-content">
        <p class="eyebrow">SECURE WORKSPACE</p>
        <div class="status-card" *ngIf="loading"><span class="spinner"></span><div><b>Checking your workspace</b><p>Verifying your membership with Supabase…</p></div></div>
        <div class="status-card error" *ngIf="!loading && errorMessage"><span class="status-symbol">!</span><div><b>Workspace check needs attention</b><p>{{errorMessage}}</p><button class="inline-button" type="button" (click)="load()">Try again</button></div></div>
        <section class="onboarding-card" *ngIf="!loading && !errorMessage && workspaces.length === 0">
          <span class="onboard-icon" aria-hidden="true">+</span><p class="eyebrow">GET STARTED</p><h1>Create your business workspace</h1>
          <p class="onboard-copy">Your workspace starts empty and belongs to your business. You’ll be added as its owner.</p>
          <form (ngSubmit)="createWorkspace()">
            <label>Business name <input [(ngModel)]="businessName" name="businessName" required minlength="2" maxlength="160" autocomplete="organization" placeholder="e.g. Swarna Jewellers"></label>
            <label>Owner or contact name <input [(ngModel)]="contactName" name="contactName" autocomplete="name" placeholder="Your name"></label>
            <div class="field-row"><label>City <input [(ngModel)]="city" name="city" placeholder="City"></label><label>State <input [(ngModel)]="state" name="state" placeholder="State"></label></div>
            <p class="form-error" *ngIf="onboardingError" role="alert">{{onboardingError}}</p>
            <button class="create-button" type="submit" [disabled]="busy || businessName.trim().length < 2">{{busy ? 'Creating workspace…' : 'Create workspace'}}</button>
          </form>
        </section>
      </section>
    </main>
  `
})
export class WorkspaceShellComponent implements OnInit, OnDestroy {
  loading = true;
  busy = false;
  errorMessage = '';
  onboardingError = '';
  workspaces: BusinessWorkspace[] = [];
  activeWorkspace: BusinessWorkspace | null = null;
  businessName = '';
  contactName = '';
  city = '';
  state = '';
  private sessionSubscription: Subscription | null = null;

  constructor(private readonly auth: AuthService, private readonly workspace: WorkspaceService, private readonly router: Router, readonly network: NetworkStatusService, private readonly cdr: ChangeDetectorRef) {}

  get userName(): string { return this.auth.user?.email ?? this.auth.user?.phone ?? 'Signed in'; }
  get initials(): string { return this.userName.slice(0, 1).toUpperCase(); }

  async ngOnInit(): Promise<void> {
    try {
      await this.auth.initialize();
      if (!this.auth.session) throw new Error('Your sign-in session is missing or expired. Sign in again to continue.');
      const metadata = this.auth.user?.user_metadata ?? {};
      this.contactName = String(metadata['full_name'] ?? metadata['name'] ?? '');
      this.sessionSubscription = this.auth.session$.subscribe(session => {
        if (!session) void this.router.navigateByUrl('/login');
      });
      await this.load();
    } catch (error) {
      this.errorMessage = error instanceof Error ? error.message : 'Could not restore your Supabase session.';
      this.loading = false;
      this.cdr.markForCheck();
    }
  }

  ngOnDestroy(): void { this.sessionSubscription?.unsubscribe(); }

  async load(): Promise<void> {
    this.loading = true;
    this.errorMessage = '';
    try {
      if (!this.auth.session) throw new Error('Your session has expired. Sign in again to continue.');
      this.workspaces = await this.workspace.loadMemberships();
      const saved = localStorage.getItem('swarn-suraksha.active-business');
      this.activeWorkspace = this.workspaces.find(item => item.id === saved) ?? (this.workspaces.length === 1 ? this.workspaces[0] : null);
      if (this.activeWorkspace) this.workspace.setActiveWorkspace(this.activeWorkspace);
    } catch (error) {
      this.errorMessage = error instanceof Error ? error.message : 'Could not verify your workspace with Supabase.';
    } finally {
      this.loading = false;
      this.cdr.markForCheck();
    }
  }

  selectWorkspace(id: string): void {
    const workspace = this.workspaces.find(item => item.id === id);
    if (!workspace) return;
    this.activeWorkspace = workspace;
    this.workspace.setActiveWorkspace(workspace);
  }

  async createWorkspace(): Promise<void> {
    const businessName = this.businessName.trim();
    if (businessName.length < 2 || this.busy) return;
    this.busy = true;
    this.onboardingError = '';
    try {
      await this.workspace.createWorkspace({
        businessName,
        contactName: this.contactName,
        mobile: this.auth.user?.phone ?? '',
        city: this.city,
        state: this.state
      });
      await this.load();
    } catch (error) {
      this.onboardingError = error instanceof Error ? error.message : 'Could not create the workspace.';
    } finally {
      this.busy = false;
      this.cdr.markForCheck();
    }
  }

  async signOut(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try { await this.auth.signOut(); }
    catch (error) {
      this.errorMessage = error instanceof Error ? error.message : 'Could not sign out.';
      this.cdr.markForCheck();
    } finally {
      this.busy = false;
      this.cdr.markForCheck();
    }
  }
}
