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
          <a routerLink="/dashboard/sales" routerLinkActive="selected"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M7 3h10v18l-2.5-1.6L12 21l-2.5-1.6L7 21V3Z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><path d="M10 8h4M10 12h4" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg><span>Billing</span></a>
          <a routerLink="/dashboard/customers" routerLinkActive="selected"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="9" cy="8" r="3" stroke="currentColor" stroke-width="1.7"/><path d="M3.5 19v-1.5A4.5 4.5 0 0 1 8 13h2a4.5 4.5 0 0 1 4.5 4.5V19M16 5.5a3 3 0 0 1 0 5.8M17 13h.5a3 3 0 0 1 3 3V19" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg><span>Customers &amp; Khata</span></a>
          <a routerLink="/dashboard/girvi" routerLinkActive="selected"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true"><rect x="4" y="10" width="16" height="10" rx="2.5" stroke="currentColor" stroke-width="1.7"/><path d="M8 10V7a4 4 0 0 1 8 0v3" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/><circle cx="12" cy="15" r="1.4" fill="currentColor"/></svg><span>Girvi</span></a>
          <a routerLink="/dashboard/stock" routerLinkActive="selected"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 8.5 12 4l8 4.5-8 4.5-8-4.5ZM4 8.5V17l8 4 8-4V8.5M12 13v8M8 6.2l8 4.5" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round" stroke-linecap="round"/></svg><span>Stock</span></a>
        </nav>
        <a routerLink="/account" style="color:inherit;padding:12px">Account &amp; security</a><div class="shell-user"><span class="avatar">{{initials}}</span><span><b>{{userName}}</b><small>Signed in securely</small></span><button type="button" (click)="signOut()" [disabled]="busy">Sign out</button></div>
      </aside>
      <header class="mobile-top" *ngIf="activeWorkspace">
        <a class="mobile-top-brand" routerLink="/dashboard"><span class="brand-mark">S</span><b>SwarnaSuraksha</b></a>
        <span class="mobile-top-biz">{{activeWorkspace.name}}</span>
      </header>
      <div class="more-backdrop" *ngIf="moreOpen" (click)="moreOpen = false"></div>
      <section class="more-sheet" *ngIf="moreOpen" role="dialog" aria-label="More options" data-no-translate>
        <div class="more-grip"></div>
        <div class="more-user"><span class="avatar">{{initials}}</span><span><b>{{userName}}</b><small>{{activeWorkspace?.name || 'Signed in securely'}}</small></span></div>
        <label class="more-workspace" *ngIf="workspaces.length > 1">Business workspace
          <select [ngModel]="activeWorkspace?.id ?? ''" (ngModelChange)="selectWorkspace($event)">
            <option value="" disabled>Select a workspace</option>
            <option *ngFor="let item of workspaces" [value]="item.id">{{item.name}}</option>
          </select>
        </label>
        <a class="more-item" routerLink="/dashboard/stock" (click)="moreOpen = false"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 8.5 12 4l8 4.5-8 4.5-8-4.5ZM4 8.5V17l8 4 8-4V8.5M12 13v8M8 6.2l8 4.5" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round"/></svg><span>Stock</span></a>
        <a class="more-item" routerLink="/account" (click)="moreOpen = false"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="12" cy="8" r="4" stroke="currentColor" stroke-width="1.8"/><path d="M4 20a8 8 0 0 1 16 0" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg><span>Profile &amp; account security</span></a>
        <div class="more-group"><small>{{ui.text('theme')}}</small>
          <div class="more-seg"><button type="button" *ngFor="let mode of themeModes" [class.on]="ui.theme === mode" (click)="ui.setTheme(mode)">{{ui.text(mode)}}</button></div>
        </div>
        <div class="more-group"><small>{{ui.text('language')}}</small>
          <div class="more-seg"><button type="button" *ngFor="let lang of languages" [class.on]="ui.language === lang" (click)="ui.setLanguage(lang)">{{languageLabel(lang)}}</button></div>
        </div>
        <button type="button" class="more-item more-signout" (click)="moreOpen = false; signOut()" [disabled]="busy"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M9 4H5a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h4M16 8l4 4-4 4M20 12H9" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg><span>Sign out</span></button>
      </section>
      <nav class="bottom-nav" aria-label="Bottom navigation" *ngIf="activeWorkspace || workspaces.length">
        <a routerLink="/dashboard" routerLinkActive="selected" [routerLinkActiveOptions]="{ exact: true }" (click)="moreOpen = false"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 11 12 4l8 7v8a1 1 0 0 1-1 1h-4v-6H9v6H5a1 1 0 0 1-1-1v-8Z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg><span>Home</span></a>
        <a routerLink="/dashboard/sales" routerLinkActive="selected" (click)="moreOpen = false"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M7 3h10v18l-2.5-1.6L12 21l-2.5-1.6L7 21V3Z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M10 8h4M10 12h4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg><span>Bill</span></a>
        <a routerLink="/dashboard/customers" routerLinkActive="selected" (click)="moreOpen = false"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="9" cy="8" r="3" stroke="currentColor" stroke-width="1.8"/><path d="M3.5 19v-1.5A4.5 4.5 0 0 1 8 13h2a4.5 4.5 0 0 1 4.5 4.5V19M16 5.5a3 3 0 0 1 0 5.8M17 13h.5a3 3 0 0 1 3 3V19" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg><span>Khata</span></a>
        <a routerLink="/dashboard/girvi" routerLinkActive="selected" (click)="moreOpen = false"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true"><rect x="4" y="10" width="16" height="10" rx="2.5" stroke="currentColor" stroke-width="1.8"/><path d="M8 10V7a4 4 0 0 1 8 0v3" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><circle cx="12" cy="15" r="1.4" fill="currentColor"/></svg><span>Girvi</span></a>
        <button type="button" class="more-tab" [class.selected]="moreOpen" (click)="moreOpen = !moreOpen" aria-haspopup="dialog" [attr.aria-expanded]="moreOpen"><span class="more-avatar">{{initials}}</span><span>More</span></button>
      </nav>
      <main class="app-main"><div class="config-banner error-banner" *ngIf="!(network.online$ | async)" role="alert"><span class="banner-icon">!</span><div><b>You are offline</b><p>Financial posting is disabled until the connection returns. An interrupted request may still have reached Supabase; retry it using the same idempotency-safe action.</p></div></div><div class="workspace-prompt" *ngIf="workspaces.length > 1 && !activeWorkspace" role="status"><b>Select a business workspace</b><span>Choose one above to load tenant-scoped records.</span></div><router-outlet /><div class="developer-credit"><span>Designed &amp; developed by</span><a href="https://www.surakshasoftware.in/" target="_blank" rel="noopener noreferrer">Suraksha Software</a></div></main>
    </div>

    <main class="setup-page" *ngIf="loading || errorMessage || workspaces.length === 0">
      <header class="setup-brand"><span class="brand-mark">S</span><b>SwarnaSuraksha</b><button type="button" (click)="signOut()" [disabled]="busy">Sign out</button></header>
      <section class="setup-content">
        <p class="eyebrow">SECURE WORKSPACE</p>
        <div class="status-card" *ngIf="loading"><span class="spinner"></span><div><b>Checking your workspace</b><p>Verifying your membership with Supabase…</p></div></div>
        <div class="status-card error" *ngIf="!loading && errorMessage"><span class="status-symbol">!</span><div><b>Workspace check needs attention</b><p>{{errorMessage}}</p><button class="inline-button" type="button" (click)="load()">Try again</button></div></div>
        <section class="onboarding-card" *ngIf="!loading && !errorMessage && workspaces.length === 0">
          <h1>No authorized workspace</h1><p>Apply for a business account or check your access status.</p><a routerLink="/account">Open account center</a>
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

    .mobile-top, .bottom-nav, .more-sheet, .more-backdrop { display: none; }
    @media (max-width: 900px) {
      .app-sidebar { display: none !important; }
      .app-shell { display: block; }
      .app-main { padding-bottom: calc(76px + env(safe-area-inset-bottom, 0px)); }
      .mobile-top { display: flex; align-items: center; justify-content: space-between; gap: 10px; position: sticky; top: 0; z-index: 40; min-height: 52px; padding: 8px 14px; background: #17251f; color: #f7f4ec; border-bottom: 1px solid rgba(236,209,131,.2); }
      .mobile-top-brand { display: flex; align-items: center; gap: 10px; color: inherit; text-decoration: none; min-width: 0; }
      .mobile-top-brand .brand-mark { width: 30px; height: 30px; font-size: 17px; }
      .mobile-top-brand b { font: 700 16px 'Playfair Display', serif; white-space: nowrap; }
      .mobile-top-biz { color: #ecd183; font-size: 12px; font-weight: 700; max-width: 40%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .bottom-nav { display: flex; position: fixed; left: 0; right: 0; bottom: 0; z-index: 60; justify-content: space-around; align-items: stretch; padding: 6px 4px calc(6px + env(safe-area-inset-bottom, 0px)); background: #17251f; border-top: 1px solid rgba(236,209,131,.25); box-shadow: 0 -8px 24px -12px rgba(0,0,0,.5); }
      .bottom-nav a, .bottom-nav .more-tab { flex: 1 1 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 3px; min-height: 52px; padding: 4px 2px; margin: 0; border: 0; background: none; color: #aab8ae; font: 600 11px 'DM Sans', sans-serif; text-decoration: none; cursor: pointer; border-radius: 12px; -webkit-tap-highlight-color: transparent; }
      .bottom-nav a.selected, .bottom-nav .more-tab.selected { color: #ecd183; }
      .bottom-nav a.selected svg { stroke-width: 2.2; filter: drop-shadow(0 0 6px rgba(236,209,131,.5)); }
      .more-avatar { display: grid; place-items: center; width: 24px; height: 24px; border-radius: 50%; background: linear-gradient(180deg, #fbe9ae, #d9b25a); color: #2a1d06; font: 700 12px 'DM Sans', sans-serif; }
      .more-tab.selected .more-avatar { box-shadow: 0 0 0 2px #17251f, 0 0 0 4px #ecd183; }
      .more-backdrop { display: block; position: fixed; inset: 0; z-index: 70; background: rgba(0,0,0,.45); }
      .more-sheet { display: grid; gap: 6px; position: fixed; left: 8px; right: 8px; bottom: calc(72px + env(safe-area-inset-bottom, 0px)); z-index: 80; max-height: 75vh; overflow-y: auto; padding: 10px 12px 12px; border: 1px solid rgba(236,209,131,.35); border-radius: 20px; background: #1b2c23; color: #f4efe0; box-shadow: 0 -16px 40px -12px rgba(0,0,0,.7); animation: more-up .18s ease-out; }
      @keyframes more-up { from { transform: translateY(14px); opacity: 0; } to { transform: none; opacity: 1; } }
      .more-grip { width: 38px; height: 4px; margin: 0 auto 4px; border-radius: 4px; background: rgba(255,255,255,.25); }
      .more-user { display: flex; align-items: center; gap: 12px; padding: 6px 4px 10px; border-bottom: 1px solid rgba(255,255,255,.1); }
      .more-user .avatar { width: 40px; height: 40px; font-size: 15px; }
      .more-user > span:last-child { min-width: 0; }
      .more-user b, .more-user small { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .more-user b { font-size: 14px; color: #fff; }
      .more-user small { margin-top: 3px; font-size: 12px; color: #9fb0a4; }
      .more-workspace { display: grid; gap: 6px; padding: 6px 4px; font-size: 11px; color: #9fb0a4; }
      .more-workspace select { width: 100%; padding: 10px; border: 1px solid #435148; border-radius: 10px; color: #fff; background: #23332a; font-size: 14px; }
      .more-item { display: flex; align-items: center; gap: 14px; width: 100%; min-height: 48px; padding: 0 12px; margin: 0; border: 0; border-radius: 12px; background: transparent; color: #f4efe0; font: 600 15px 'DM Sans', sans-serif; text-align: left; text-decoration: none; cursor: pointer; }
      .more-item:active, .more-item:hover { background: rgba(255,255,255,.08); }
      .more-item svg { color: #ecd183; flex: none; }
      .more-signout { color: #ffb4a8; border-top: 1px solid rgba(255,255,255,.1); border-radius: 0 0 12px 12px; margin-top: 4px; }
      .more-signout svg { color: #ffb4a8; }
      .more-group { display: grid; gap: 6px; padding: 6px 4px; }
      .more-group small { font-size: 10px; font-weight: 700; letter-spacing: 1.2px; text-transform: uppercase; color: #9fb0a4; }
      .more-seg { display: grid; grid-auto-flow: column; grid-auto-columns: 1fr; gap: 4px; padding: 3px; border-radius: 12px; background: rgba(255,255,255,.07); }
      .more-seg button { min-height: 38px; margin: 0; border: 0; border-radius: 9px; background: transparent; color: #d7e0d9; font: 600 13px 'DM Sans', 'Noto Sans Devanagari', sans-serif; cursor: pointer; }
      .more-seg button.on { color: #2a1d06; background: linear-gradient(180deg, #f6e7b4, #d9b25a); }
    }
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

  moreOpen = false;
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

  @HostListener('document:keydown.escape') closeMore(): void { this.moreOpen = false; }

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