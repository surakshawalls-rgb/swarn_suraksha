import { CommonModule } from '@angular/common';
import { Component, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { AuthService } from '../../core/auth/auth.service';
import { SupabaseService } from '../../core/supabase/supabase.service';
@Component({standalone:true, imports:[CommonModule,FormsModule,RouterLink], styleUrls:['./account.scss'], template:`
<main class="access-page"><section class="access-card"><div class="brand-mark">S</div><p class="eyebrow">SWARNASURAKSHA</p><h1>Welcome</h1><p>Gold &amp; silver · Jewellery business management</p>
<p role="alert" class="error" *ngIf="error">{{error}}</p><p role="status" *ngIf="notice">{{notice}}</p>
<h2>Personal access</h2><a routerLink="/personal">Continue as guest</a><button (click)="google()" [disabled]="busy">Continue with Google</button>
<h2>Business / Super Admin access</h2><form (ngSubmit)="submit()"><label>Email<input type="email" name="email" [(ngModel)]="email" required autocomplete="email"></label><label>Password<input type="password" name="password" [(ngModel)]="password" required [attr.autocomplete]="register?'new-password':'current-password'"></label><button [disabled]="busy || !email || !password">{{register?'Create account':'Sign in with password'}}</button></form>
<button class="secondary" (click)="register=!register" [disabled]="busy">{{register?'Back to sign in':'Register your business'}}</button><p>Business access requires approval. Existing Google owners can continue during migration.</p><footer>Developed by <a href="https://www.surakshasoftware.in/">Suraksha Software</a></footer></section></main>`})
export class LoginComponent implements OnInit {
 email=''; password=''; register=false; busy=false; error=''; notice='';
 constructor(private auth:AuthService,private supabase:SupabaseService,private router:Router,private route:ActivatedRoute){}
 async ngOnInit(){try{this.error=this.route.snapshot.queryParamMap.get('error_description')||''; await this.auth.initialize();if(this.auth.user) await this.router.navigateByUrl('/account');}catch(e){this.error=this.message(e);}}
 message(e:unknown){return (e as {message?:string})?.message||'Request failed';}
 async google(){this.busy=true;this.error='';try{await this.auth.signInWithGoogle();}catch(e){this.error=this.message(e);this.busy=false;}}
 async submit(){if(this.busy)return;this.busy=true;this.error='';this.notice='';try{if(this.register){const client=this.supabase.client;if(!client)throw new Error('Supabase is not configured');const {data,error}=await client.auth.signUp({email:this.email.trim(),password:this.password,options:{emailRedirectTo:new URL('/auth/callback',location.origin).toString()}});if(error)throw error;if(!data.session){this.notice='Check your email to confirm your account, then sign in with your password.';return;}}else await this.auth.signInWithPassword(this.email.trim(),this.password);await this.router.navigateByUrl('/account');}catch(e){this.error=this.message(e);}finally{this.password='';this.busy=false;}}
}
