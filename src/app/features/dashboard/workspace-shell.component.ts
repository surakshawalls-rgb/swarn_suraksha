import { CommonModule } from '@angular/common';
import { ChangeDetectorRef, Component, HostListener, OnDestroy, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { IonicModule } from '@ionic/angular';
import { Subscription } from 'rxjs';
import { AuthService } from '../../core/auth/auth.service';
import { NetworkStatusService } from '../../core/network/network-status.service';
import { AppLanguage, ThemeMode, UiPrefsService } from '../../core/ui/ui-prefs.service';
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
        <div class="shell-prefs" data-no-translate>
          <div class="pref">
            <button type="button" class="pref-btn" (click)="toggleMenu('theme')" [attr.aria-expanded]="openMenu === 'theme'" aria-haspopup="listbox">
              <svg *ngIf="!ui.isNight" width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="12" cy="12" r="4" stroke="currentColor" stroke-width="1.7"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M18.4 5.6 17 7M7 17l-1.4 1.4" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>
              <svg *ngIf="ui.isNight" width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5Z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/></svg>
              <span class="pref-text"><small>{{ui.text('theme')}}</small><b>{{themeLabel}}</b></span>
              <svg class="pref-chevron" width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m6 9 6 6 6-6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
            </button>
            <div class="pref-menu" role="listbox" *ngIf="openMenu === 'theme'">
              <button type="button" role="option" *ngFor="let mode of themeModes" [class.on]="ui.theme === mode" [attr.aria-selected]="ui.theme === mode" (click)="chooseTheme(mode)">{{ui.text(mode)}}</button>
            </div>
          </div>
          <div class="pref">
            <button type="button" class="pref-btn" (click)="toggleMenu('language')" [attr.aria-expanded]="openMenu === 'language'" aria-haspopup="listbox">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="1.7"/><path d="M3 12h18M12 3c2.6 2.7 3.9 5.7 3.9 9s-1.3 6.3-3.9 9c-2.6-2.7-3.9-5.7-3.9-9S9.4 5.7 12 3Z" stroke="currentColor" stroke-width="1.5"/></svg>
              <span class="pref-text"><small>{{ui.text('language')}}</small><b>{{languageLabel(ui.language)}}</b></span>
              <svg class="pref-chevron" width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m6 9 6 6 6-6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
            </button>
            <div class="pref-menu" role="listbox" *ngIf="openMenu === 'language'">
              <button type="button" role="option" *ngFor="let lang of languages" [class.on]="ui.language === lang" [attr.aria-selected]="ui.language === lang" (click)="chooseLanguage(lang)">{{languageLabel(lang)}}</button>
            </div>
          </div>
        </div>
        <nav aria-label="Main navigation">
          <a routerLink="/dashboard" routerLinkActive="selected" [routerLinkActiveOptions]="{ exact: true }"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 11 12 4l8 7v8a1 1 0 0 1-1 1h-4v-6H9v6H5a1 1 0 0 1-1-1v-8Z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/></svg><span>Home</span></a>
          <a routerLink="/dashboard/sales" routerLinkActive="selected"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M7 3h10v18l-2.5-1.6L12 21l-2.5-1.6L7 21V3Z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><path d="M10 8h4M10 12h4" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg><span>Bill</span></a>
          <a routerLink="/dashboard/customers" routerLinkActive="selected"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="9" cy="8" r="3" stroke="currentColor" stroke-width="1.7"/><path d="M3.5 19v-1.5A4.5 4.5 0 0 1 8 13h2a4.5 4.5 0 0 1 4.5 4.5V19M16 5.5a3 3 0 0 1 0 5.8M17 13h.5a3 3 0 0 1 3 3V19" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg><span>Customers &amp; Khata</span></a>
          <a routerLink="/dashboard/girvi" routerLinkActive="selected"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true"><rect x="4" y="10" width="16" height="10" rx="2.5" stroke="currentColor" stroke-width="1.7"/><path d="M8 10V7a4 4 0 0 1 8 0v3" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/><circle cx="12" cy="15" r="1.4" fill="currentColor"/></svg><span>Girvi</span></a>
          <a routerLink="/dashboard/stock" routerLinkActive="selected"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 8.5 12 4l8 4.5-8 4.5-8-4.5ZM4 8.5V17l8 4 8-4V8.5M12 13v8M8 6.2l8 4.5" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round" stroke-linecap="round"/></svg><span>Stock</span></a>
          <a routerLink="/dashboard/suppliers" routerLinkActive="selected"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="9" cy="8" r="3" stroke="currentColor" stroke-width="1.7"/><path d="M3.5 19v-1.2A4.8 4.8 0 0 1 8.3 13h1.4a4.8 4.8 0 0 1 4.8 4.8V19M16 8h5m-2.5-2.5v5" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg><span>Suppliers</span></a>
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
  `,
  // Self-contained styles for the Theme / Language buttons, so they look right even without extra global stylesheets.
  styles: [`
    .shell-prefs { display: grid; gap: 10px; margin: 0 16px 18px; }
    .pref { position: relative; }
    .pref-btn {
      display: flex; align-items: center; gap: 12px; width: 100%; min-height: 54px; padding: 8px 12px; margin: 0;
      cursor: pointer; text-align: left; color: #f4efe0; font-family: 'DM Sans', sans-serif;
      border: 1px solid rgba(236, 209, 131, .28); border-radius: 14px;
      background: linear-gradient(180deg, rgba(255, 255, 255, .09), rgba(255, 255, 255, .03));
      box-shadow: 0 1px 0 rgba(255, 255, 255, .08) inset, 0 8px 16px -10px rgba(0, 0, 0, .7);
      transition: border-color .18s ease, background .18s ease, transform .18s ease;
    }
    .pref-btn:hover { border-color: rgba(236, 209, 131, .6); background: rgba(236, 209, 131, .1); transform: translateY(-1px); }
    .pref-btn:focus-visible { outline: 2px solid #ecd183; outline-offset: 2px; }
    .pref-btn svg:first-child {
      flex: none; box-sizing: content-box; width: 18px; height: 18px; padding: 8px; color: #3d2a05; border-radius: 10px;
      background: linear-gradient(180deg, #fbe9ae, #d9b25a); box-shadow: 0 1px 0 rgba(255, 255, 255, .6) inset;
    }
    .pref-text { display: grid; gap: 2px; flex: 1; min-width: 0; line-height: 1.15; }
    .pref-text small { color: #9fb0a4; font-size: 9px; font-weight: 700; letter-spacing: 1.2px; text-transform: uppercase; }
    .pref-text b { color: #fff; font-size: 14px; font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .pref-chevron { flex: none; width: 14px; height: 14px; color: #b8c7bc; transition: transform .18s ease; }
    .pref-btn[aria-expanded='true'] .pref-chevron { transform: rotate(180deg); }
    .pref-menu {
      position: absolute; z-index: 30; left: 0; right: 0; top: calc(100% + 6px); display: grid; gap: 3px; padding: 6px;
      border: 1px solid rgba(236, 209, 131, .35); border-radius: 14px; background: #1b2c23;
      box-shadow: 0 20px 40px -14px rgba(0, 0, 0, .8);
    }
    .pref-menu button {
      display: block; width: 100%; margin: 0; padding: 10px 12px; cursor: pointer; text-align: left;
      color: #e3eae5; font: 600 13px 'DM Sans', 'Noto Sans Devanagari', sans-serif;
      border: 0; border-radius: 9px; background: transparent;
    }
    .pref-menu button:hover { background: rgba(255, 255, 255, .09); }
    .pref-menu button.on { color: #2a1d06; background: linear-gradient(180deg, #f6e7b4, #d9b25a); }
    @media (max-width: 900px) {
      .shell-prefs { grid-template-columns: 1fr 1fr; margin: 0 12px 10px; }
      .pref-text small { display: none; }
    }
  `]
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

  constructor(private readonly auth: AuthService, private readonly workspace: WorkspaceService, private readonly router: Router, readonly network: NetworkStatusService, private readonly cdr: ChangeDetectorRef, readonly ui: UiPrefsService) {}

  openMenu: 'theme' | 'language' | null = null;
  readonly themeModes: ThemeMode[] = ['auto', 'day', 'night'];
  readonly languages: AppLanguage[] = ['en', 'hinglish', 'hi'];

  get themeLabel(): string { return this.ui.text(this.ui.theme === 'auto' ? 'autoNow' : this.ui.theme); }
  languageLabel(language: AppLanguage): string { return language === 'en' ? 'English' : language === 'hinglish' ? 'Hinglish' : 'हिन्दी'; }
  toggleMenu(menu: 'theme' | 'language'): void { this.openMenu = this.openMenu === menu ? null : menu; }
  chooseTheme(mode: ThemeMode): void { this.ui.setTheme(mode); this.openMenu = null; }
  chooseLanguage(language: AppLanguage): void { this.ui.setLanguage(language); this.openMenu = null; }
  @HostListener('document:click', ['$event']) closeMenus(event: Event): void {
    if (this.openMenu && !(event.target as HTMLElement | null)?.closest('.shell-prefs')) this.openMenu = null;
  }

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