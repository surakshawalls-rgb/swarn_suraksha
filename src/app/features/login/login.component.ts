import { CommonModule } from '@angular/common';
import { Component, OnInit } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { IonicModule } from '@ionic/angular';
import { AuthService } from '../../core/auth/auth.service';
import { SupabaseService } from '../../core/supabase/supabase.service';

@Component({
  standalone: true,
  imports: [CommonModule, IonicModule],
  template: `
    <main class="auth-page">
      <section class="auth-card">
        <div class="brand-mark">S</div>
        <p class="eyebrow">JEWELLERY BUSINESS, SECURELY MANAGED</p>
        <h1>Welcome to SwarnaSuraksha</h1>
        <p class="login-copy">Sign in to manage your jewellery business workspace.</p>
        <div class="auth-alert" *ngIf="!supabase.configured"><b>Supabase is not configured.</b><br>Set the project URL and public anon key in the local environment file.</div>
        <div class="auth-alert error" *ngIf="errorMessage">{{errorMessage}}</div>
        <button class="google-button" (click)="signIn()" [disabled]="busy || !supabase.configured">
          <span class="google-g">G</span><span>{{busy ? 'Connecting to Google…' : 'Continue with Google'}}</span>
        </button>
        <p class="auth-note">Secure sign-in provided by Google and Supabase Auth.</p>
      </section>
      <footer class="login-footer">SwarnaSuraksha <span>·</span> INR workspace management</footer>
    </main>
  `
})
export class LoginComponent implements OnInit {
  busy = false;
  errorMessage = '';

  constructor(
    private readonly auth: AuthService,
    readonly supabase: SupabaseService,
    private readonly route: ActivatedRoute,
    private readonly router: Router
  ) {}

  async ngOnInit(): Promise<void> {
    const oauthError = this.route.snapshot.queryParamMap.get('error_description')
      ?? this.route.snapshot.queryParamMap.get('error');
    if (oauthError) {
      this.errorMessage = oauthError === 'access_denied'
        ? 'Google sign-in was canceled. You can try again when ready.'
        : `Google sign-in did not complete: ${oauthError}`;
    } else if (this.route.snapshot.queryParamMap.get('reason') === 'session') {
      this.errorMessage = 'Your session could not be restored. Please sign in again.';
    }
    try {
      await this.auth.initialize();
      if (this.auth.user) await this.router.navigateByUrl('/dashboard');
    } catch (error) {
      this.errorMessage = this.message(error);
    }
  }

  async signIn(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    this.errorMessage = '';
    try {
      await this.auth.signInWithGoogle();
    } catch (error) {
      this.errorMessage = this.message(error);
      this.busy = false;
    }
  }

  private message(error: unknown): string {
    return error instanceof Error ? error.message : 'Google sign-in failed. Please try again.';
  }
}
