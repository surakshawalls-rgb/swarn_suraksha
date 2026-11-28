import { CommonModule } from '@angular/common';
import { Component, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { AuthService } from '../../core/auth/auth.service';
import { SupabaseService } from '../../core/supabase/supabase.service';
import { LOGIN_COPY, copyText } from '../../core/ui/auth-copy';
import { AppLanguage, UiPrefsService } from '../../core/ui/ui-prefs.service';

@Component({standalone:true, imports:[CommonModule,FormsModule,RouterLink], styleUrls:['./login-premium.scss'], template:`
<main class="ss-login-page" data-no-translate>
  <div class="ss-login-container">

    <header class="ss-login-header">
      <div class="ss-logo" aria-hidden="true">S</div>
      <div class="ss-brand">SwarnaSuraksha</div>
      <div class="ss-eyebrow">{{t('tagline')}}</div>
    </header>

    <div class="ss-lang" role="group" [attr.aria-label]="t('language')">
      <span class="ss-lang-label">{{t('language')}}</span>
      <button type="button" *ngFor="let l of langs" [class.on]="ui.language===l.code"
              [attr.aria-pressed]="ui.language===l.code" (click)="ui.setLanguage(l.code)">{{l.label}}</button>
    </div>

    <section class="ss-card" aria-labelledby="ss-login-title">

      <h1 id="ss-login-title">{{register ? t('titleRegister') : t('titleLogin')}}</h1>
      <p class="ss-subtitle">{{register ? t('subRegister') : t('subLogin')}}</p>

      <div class="ss-alert error" role="alert" *ngIf="error">{{error}}</div>
      <div class="ss-alert success" role="status" *ngIf="notice">{{notice}}</div>

      <button type="button" class="ss-google" (click)="google()" [disabled]="busy">
        <svg viewBox="0 0 48 48" class="ss-google-icon" aria-hidden="true">
          <path fill="#4285F4" d="M43.6 24.5c0-1.4-.1-2.8-.4-4.1H24v7.8h11a9.4 9.4 0 0 1-4.1 6.2v5h6.6c3.9-3.6 6.1-8.8 6.1-14.9z"/>
          <path fill="#34A853" d="M24 44c5.5 0 10.1-1.8 13.5-4.6l-6.6-5c-1.8 1.2-4.1 1.9-6.9 1.9-5.3 0-9.8-3.6-11.4-8.4H5.8v5.2A20 20 0 0 0 24 44z"/>
          <path fill="#FBBC05" d="M12.6 27.9a12 12 0 0 1 0-7.8v-5.2H5.8a20 20 0 0 0 0 18.2z"/>
          <path fill="#EA4335" d="M24 11.7c3 0 5.6 1 7.7 3l5.8-5.8A19.2 19.2 0 0 0 24 4 20 20 0 0 0 5.8 14.9l6.8 5.2C14.2 15.3 18.7 11.7 24 11.7z"/>
        </svg>
        <span>{{t('google')}}</span>
      </button>

      <div class="ss-divider" role="separator"><span>{{t('divider')}}</span></div>

      <form (ngSubmit)="submit()" class="ss-form">

        <label for="ss-email">{{t('emailLabel')}}</label>
        <input id="ss-email" type="email" name="email" [(ngModel)]="email"
               [placeholder]="t('emailPh')" required autocomplete="email">

        <label for="ss-password">{{t('passLabel')}}</label>
        <input id="ss-password" type="password" name="password" [(ngModel)]="password"
               [placeholder]="t('passPh')" required
               [attr.autocomplete]="register ? 'new-password' : 'current-password'">

        <p class="ss-hint" *ngIf="register">{{t('hint')}}</p>

        <button type="submit" class="ss-primary" [disabled]="busy || !email || !password">
          {{busy ? t('wait') : register ? t('btnRegister') : t('btnLogin')}}
        </button>

      </form>

      <div class="ss-links">
        <button type="button" class="ss-link" *ngIf="!register" (click)="resend()" [disabled]="busy || !email">
          {{t('resend')}}
        </button>
        <button type="button" class="ss-link strong" (click)="register=!register" [disabled]="busy">
          {{register ? t('toLogin') : t('toRegister')}}
        </button>
      </div>

    </section>

    <div class="ss-guest-strip">
      <span>{{t('guestQ')}}</span>
      <a routerLink="/personal" class="ss-guest">{{t('guest')}}</a>
    </div>

    <div class="ss-security-note">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true">
        <path d="M12 22s8-4 8-11V5l-8-3-8 3v6c0 7 8 11 8 11z"/>
        <path d="m9 12 2 2 4-4"/>
      </svg>
      <span>{{t('note')}}</span>
    </div>

    <footer class="ss-login-footer">
      <span>{{t('devBy')}}</span>
      <a href="https://www.surakshasoftware.in/" target="_blank" rel="noopener noreferrer">Suraksha Software</a>
      <small>www.surakshasoftware.in</small>
    </footer>

  </div>
</main>
`})
export class LoginComponent implements OnInit {
 email=''; password=''; register=false; busy=false; error=''; notice='';
 readonly langs:{code:AppLanguage;label:string}[]=[{code:'en',label:'English'},{code:'hinglish',label:'Hinglish'},{code:'hi',label:'हिन्दी'}];
 constructor(private auth:AuthService,private supabase:SupabaseService,private router:Router,private route:ActivatedRoute,public ui:UiPrefsService){}
 t(key:string){return copyText(LOGIN_COPY,this.ui.language,key);}
 async ngOnInit(){try{this.error=this.route.snapshot.queryParamMap.get('error_description')||''; await this.auth.initialize();if(this.auth.user) await this.router.navigateByUrl('/dashboard',{replaceUrl:true});}catch(e){this.error=this.message(e);}}
 message(e:unknown){return (e as {message?:string})?.message||'Request failed';}
 async google(){this.busy=true;this.error='';try{await this.auth.signInWithGoogle();}catch(e){this.error=this.message(e);this.busy=false;}}
 async submit(){if(this.busy)return;this.busy=true;this.error='';this.notice='';try{if(this.register){const client=this.supabase.client;if(!client)throw new Error('Supabase is not configured');const {data,error}=await client.auth.signUp({email:this.email.trim(),password:this.password,options:{emailRedirectTo:new URL('/auth/callback',location.origin).toString()}});if(error)throw error;if(!data.session){this.notice='Account registration submitted. Check your inbox and spam folder for the verification link, then sign in. If no email arrives, use Resend verification email.';this.register=false;return;}}else await this.auth.signInWithPassword(this.email.trim(),this.password);await this.router.navigateByUrl('/account',{replaceUrl:true});}catch(e){this.error=(e as {code?:string})?.code==='email_not_confirmed'?'Verify your email before signing in. Use Resend verification email if needed.':this.message(e);}finally{this.password='';this.busy=false;}}
 async resend(){if(this.busy||!this.email.trim())return;this.busy=true;this.error='';this.notice='';try{const client=this.supabase.client;if(!client)throw new Error('Supabase is not configured');const {error}=await client.auth.resend({type:'signup',email:this.email.trim(),options:{emailRedirectTo:new URL('/auth/callback',location.origin).toString()}});if(error)throw error;this.notice='Verification request submitted. Check your inbox and spam folder.';}catch(e){this.error=this.message(e);}finally{this.busy=false;}}
}