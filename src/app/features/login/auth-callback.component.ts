import { CommonModule } from '@angular/common';
import { ChangeDetectorRef, Component, OnInit } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { IonicModule } from '@ionic/angular';
import { AuthService } from '../../core/auth/auth.service';
import { WorkspaceService } from '../dashboard/workspace.service';

@Component({
  standalone: true,
  imports: [CommonModule, IonicModule],
  template: `<main class="callback-page"><div class="callback-card"><span class="spinner" *ngIf="busy"></span><div class="brand-mark" *ngIf="!busy">S</div><h1>{{message}}</h1><p *ngIf="errorMessage" class="form-error">{{errorMessage}}</p><div class="callback-actions" *ngIf="profileSetupFailed"><button class="create-button" (click)="retryProfile()" [disabled]="busy">{{busy ? 'Retrying…' : 'Retry profile setup'}}</button><button class="inline-button" (click)="continueToWorkspace()" [disabled]="busy">Continue to workspace</button></div><div class="callback-actions" *ngIf="!busy && errorMessage && !profileSetupFailed"><button class="create-button" (click)="goToLogin()">Return to sign-in</button></div></div></main>`
})
export class AuthCallbackComponent implements OnInit {
  message = 'Completing secure sign-in…';
  errorMessage = '';
  busy = true;
  profileSetupFailed = false;

  constructor(
    private readonly auth: AuthService,
    private readonly workspace: WorkspaceService,
    private readonly route: ActivatedRoute,
    private readonly router: Router,
    private readonly changeDetector: ChangeDetectorRef
  ) {}

  async ngOnInit(): Promise<void> {
    const providerError = this.route.snapshot.queryParamMap.get('error_description')
      ?? this.route.snapshot.queryParamMap.get('error');
    if (providerError) {
      this.busy = false;
      this.auth.cancelOAuthAttempt();
      this.errorMessage = providerError === 'access_denied'
        ? 'Google sign-in was canceled. You can try again.'
        : `Google sign-in did not complete: ${providerError}`;
      this.message = 'Sign-in was not completed';
      await this.router.navigate(['/login'], { queryParams: { error_description: this.errorMessage } });
      return;
    }
    try {
      await this.auth.initialize();
      if (this.auth.user) {
        try {
          await this.workspace.ensureProfile();
          await this.router.navigateByUrl('/dashboard');
        } catch (error) {
          this.busy = false;
          this.profileSetupFailed = true;
          this.message = 'Google sign-in succeeded, but profile setup needs attention.';
          this.errorMessage = error instanceof Error ? error.message : 'Could not save your user profile.';
          this.changeDetector.markForCheck();
        }
      }
      else {
        this.busy = false;
        this.auth.cancelOAuthAttempt();
        await this.router.navigate(['/login'], { queryParams: { reason: 'session' } });
      }
    } catch (error) {
      this.busy = false;
      this.message = 'Could not finish secure sign-in.';
      this.errorMessage = error instanceof Error ? error.message : 'Session restoration failed. Return to sign-in and try again.';
      this.changeDetector.markForCheck();
    }
  }

  async retryProfile(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    this.errorMessage = '';
    try {
      await this.workspace.ensureProfile();
      this.profileSetupFailed = false;
      await this.router.navigateByUrl('/dashboard');
    } catch (error) {
      this.errorMessage = error instanceof Error ? error.message : 'Could not save your user profile.';
    } finally {
      this.busy = false;
      this.changeDetector.markForCheck();
    }
  }

  async continueToWorkspace(): Promise<void> {
    await this.router.navigateByUrl('/dashboard');
  }

  async goToLogin(): Promise<void> {
    this.auth.cancelOAuthAttempt();
    await this.router.navigate(['/login'], { queryParams: { error_description: this.errorMessage } });
  }
}
