import { CommonModule } from '@angular/common';
import { Component, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { AuthService } from '../../core/auth/auth.service';
import { SupabaseService } from '../../core/supabase/supabase.service';
@Component({standalone:true, imports:[CommonModule,FormsModule,RouterLink], styleUrls:['./login-premium.scss'], template:`
<main class="ss-login-page" data-no-translate>
  <div class="ss-login-container">

    <header class="ss-login-header">
      <div class="ss-logo">S</div>

      <div class="ss-brand">
        SwarnaSuraksha
      </div>

      <div class="ss-eyebrow">
        JEWELLERY BUSINESS MANAGEMENT
      </div>

      <h1>Welcome to SwarnaSuraksha</h1>

      <p>
        Your trusted digital companion for gold,
        silver and jewellery business management.
      </p>
    </header>

    <div class="ss-alert error"
         role="alert"
         *ngIf="error">
      {{error}}
    </div>

    <div class="ss-alert success"
         role="status"
         *ngIf="notice">
      {{notice}}
    </div>

    <div class="ss-login-grid">

      <!-- Personal access -->
      <section class="ss-panel">

        <div class="ss-panel-icon">
          <svg viewBox="0 0 24 24"
               fill="none"
               stroke="currentColor"
               stroke-width="1.7">
            <path d="M3 3v18h18"/>
            <path d="m6 15 5-5 4 4 6-7"/>
            <path d="M17 7h4v4"/>
          </svg>
        </div>

        <h2>Personal Access</h2>

        <p class="ss-description">
          Stay informed about the gold
          and silver market.
        </p>

        <ul class="ss-features">
          <li>Gold and silver market rates</li>
          <li>Personal account access</li>
          <li>Upcoming market notifications</li>
        </ul>

        <div class="ss-personal-actions">

          <button type="button"
                  class="ss-google"
                  (click)="google()"
                  [disabled]="busy">

            <svg viewBox="0 0 48 48"
                 class="ss-google-icon">
              <path fill="#4285F4"
                d="M43.6 24.5c0-1.4-.1-2.8-.4-4.1H24v7.8h11a9.4 9.4 0 0 1-4.1 6.2v5h6.6c3.9-3.6 6.1-8.8 6.1-14.9z"/>
              <path fill="#34A853"
                d="M24 44c5.5 0 10.1-1.8 13.5-4.6l-6.6-5c-1.8 1.2-4.1 1.9-6.9 1.9-5.3 0-9.8-3.6-11.4-8.4H5.8v5.2A20 20 0 0 0 24 44z"/>
              <path fill="#FBBC05"
                d="M12.6 27.9a12 12 0 0 1 0-7.8v-5.2H5.8a20 20 0 0 0 0 18.2z"/>
              <path fill="#EA4335"
                d="M24 11.7c3 0 5.6 1 7.7 3l5.8-5.8A19.2 19.2 0 0 0 24 4 20 20 0 0 0 5.8 14.9l6.8 5.2C14.2 15.3 18.7 11.7 24 11.7z"/>
            </svg>

            Continue with Google
          </button>

          <a routerLink="/personal"
             class="ss-guest">
            Continue as Guest
          </a>

          <p class="ss-small">
            No registration required for guest access.
          </p>

        </div>

      </section>

      <!-- Business access -->
      <section class="ss-panel">

        <div class="ss-panel-icon">
          <svg viewBox="0 0 24 24"
               fill="none"
               stroke="currentColor"
               stroke-width="1.7">
            <path d="M3 9l2-6h14l2 6"/>
            <path d="M3 9v3a3 3 0 0 0 6 0 3 3 0 0 0 6 0 3 3 0 0 0 6 0V9"/>
            <path d="M5 15v6h14v-6"/>
            <path d="M10 21v-5h4v5"/>
          </svg>
        </div>

        <h2>
          {{register ? 'Create Your Account' : 'Business Access'}}
        </h2>

        <p class="ss-description">
          {{register
            ? 'Create an account to apply for business membership.'
            : 'Manage your jewellery business securely.'}}
        </p>

        <form (ngSubmit)="submit()"
              class="ss-form">

          <label for="ss-email">
            Email address
          </label>

          <input id="ss-email"
                 type="email"
                 name="email"
                 [(ngModel)]="email"
                 placeholder="Enter your email address"
                 required
                 autocomplete="email">

          <label for="ss-password">
            Password
          </label>

          <input id="ss-password"
                 type="password"
                 name="password"
                 [(ngModel)]="password"
                 placeholder="Enter your password"
                 required
                 [attr.autocomplete]="register
                   ? 'new-password'
                   : 'current-password'">

          <p class="ss-small" *ngIf="register">
            Use at least 8 characters, including uppercase
            and lowercase letters, a number and a special character.
          </p>

          <button type="submit"
                  class="ss-primary"
                  [disabled]="busy || !email || !password">

            {{busy
              ? 'Please wait...'
              : register ? 'Create Account' : 'Sign In'}}

          </button>

        </form>

        <button type="button"
                class="ss-outline"
                (click)="register=!register"
                [disabled]="busy">

          {{register
            ? 'Back to Sign In'
            : 'Register Your Business'}}

        </button>

        <p class="ss-small">
          Free business membership. Approval required.
        </p>

      </section>

    </div>

    <div class="ss-security-note">

      <svg viewBox="0 0 24 24"
           fill="none"
           stroke="currentColor"
           stroke-width="1.7">
        <path d="M12 22s8-4 8-11V5l-8-3-8 3v6c0 7 8 11 8 11z"/>
        <path d="m9 12 2 2 4-4"/>
      </svg>

      <span>
        Existing business owners can continue with Google
        during the account migration period.
      </span>

    </div>

    <footer class="ss-login-footer">
      <span>Developed and maintained by</span>

      <a href="https://www.surakshasoftware.in/"
         target="_blank"
         rel="noopener noreferrer">
        Suraksha Software
      </a>

      <small>www.surakshasoftware.in</small>
    </footer>

  </div>
</main>
`})
export class LoginComponent implements OnInit {
 email=''; password=''; register=false; busy=false; error=''; notice='';
 constructor(private auth:AuthService,private supabase:SupabaseService,private router:Router,private route:ActivatedRoute){}
 async ngOnInit(){try{this.error=this.route.snapshot.queryParamMap.get('error_description')||''; await this.auth.initialize();if(this.auth.user) await this.router.navigateByUrl('/account');}catch(e){this.error=this.message(e);}}
 message(e:unknown){return (e as {message?:string})?.message||'Request failed';}
 async google(){this.busy=true;this.error='';try{await this.auth.signInWithGoogle();}catch(e){this.error=this.message(e);this.busy=false;}}
 async submit(){if(this.busy)return;this.busy=true;this.error='';this.notice='';try{if(this.register){const client=this.supabase.client;if(!client)throw new Error('Supabase is not configured');const {data,error}=await client.auth.signUp({email:this.email.trim(),password:this.password,options:{emailRedirectTo:new URL('/auth/callback',location.origin).toString()}});if(error)throw error;if(!data.session){this.notice='Check your email to confirm your account, then sign in with your password.';return;}}else await this.auth.signInWithPassword(this.email.trim(),this.password);await this.router.navigateByUrl('/account');}catch(e){this.error=this.message(e);}finally{this.password='';this.busy=false;}}
}
