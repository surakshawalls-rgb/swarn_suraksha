import { CommonModule } from '@angular/common';
import { Component, OnInit, ChangeDetectorRef } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { AuthService } from '../../core/auth/auth.service';
import { AccountAccess, AccountAccessService, Application } from '../../core/auth/account-access.service';
import { Json } from '../../core/supabase/database.types';
interface AdminBusiness {business_id:string; business_name:string; status:string; active_members:number; id?:string;}
@Component({standalone:true,imports:[CommonModule,FormsModule,RouterLink],styleUrls:['./account.scss','./account-admin.scss'],template:`
<main class="access-page admin-access-page" data-no-translate><section class="access-card" [class.admin-card]="access?.platform_admin_access"><p class="eyebrow">SWARNASURAKSHA | ACCOUNT CENTER</p><h1>{{access?.platform_admin_access ? "Super Admin Dashboard" : "Account & Security"}}</h1><p>{{auth.user?.email}}</p><button class="secondary" (click)="refresh()" [disabled]="busy">Refresh access</button><button class="secondary" (click)="signOut()" [disabled]="busy">Sign out</button><a routerLink="/personal">Personal market page</a>
<p *ngIf="busy" role="status">Working...</p><p *ngIf="error" class="error" role="alert">{{error}}</p><p *ngIf="notice" role="status">{{notice}}</p>
<ng-container *ngIf="access as a"><ng-container *ngIf="!a.platform_admin_access"><h2>Authentication status</h2><p>Verified password account: {{a.has_verified_password_account?'Yes':'No'}} | Password session: {{a.is_password_session?'Yes':'No'}}</p>
<section *ngIf="!a.has_verified_password_account"><h2>Configure account password</h2><p>Use your existing account. No new workspace is created. Use a unique password with at least 8 characters, uppercase, lowercase, number and symbol.</p><form (ngSubmit)="configure()"><label>New password<input type="password" name="newPassword" [(ngModel)]="password" autocomplete="new-password" required></label><label>Confirm password<input type="password" name="confirmPassword" [(ngModel)]="confirmation" autocomplete="new-password" required></label><button [disabled]="busy || !password || !confirmation">Configure password</button></form></section>
<section *ngIf="!a.is_password_session"><h2>Verify password login</h2><p>Sign in again using your existing email and password to verify the same account.</p><form (ngSubmit)="verify()"><label>Password<input type="password" name="verifyPassword" [(ngModel)]="verificationPassword" autocomplete="current-password" required></label><button [disabled]="busy || !verificationPassword">Verify password login</button></form></section>
<h2>Business access</h2><a *ngIf="a.business_access" class="action" routerLink="/dashboard">Open business workspace</a><article *ngFor="let b of a.businesses"><b>{{b.business_name}}</b><p>{{b.business_status}} | {{b.membership_role}} | {{b.access_allowed?'Access allowed':'Access unavailable'}}</p><p *ngIf="b.legacy_access">Legacy access enabled. Migration is optional until password login is verified.</p><button *ngIf="b.legacy_access && a.is_password_session && a.has_verified_password_account && b.membership_role==='owner' && b.access_allowed" (click)="migrate(b.business_id)" [disabled]="busy">Complete password migration</button></article>
<h2>Business applications</h2><article *ngFor="let item of a.applications"><b>{{item.business_name}}</b><p>{{item.status}} {{item.rejection_reason}}</p><button *ngIf="item.status==='pending'" (click)="cancel(item.application_id)" [disabled]="busy">Cancel application</button></article>
<form *ngIf="a.can_apply_for_business" (ngSubmit)="submitApplication()"><h2>Apply for a business account</h2><div class="fields"><label>Business name<input name="business_name" [(ngModel)]="details['business_name']" required minlength="2"></label><label>Proprietor name<input name="contact_name" [(ngModel)]="details['contact_name']" required minlength="2"></label><label>Business type<select name="business_type" [(ngModel)]="details['business_type']"><option value="jewellery">Jewellery</option><option value="bullion">Bullion</option><option value="pawn">Pawn</option><option value="other">Other</option></select></label><label>Primary mobile<input name="phone" [(ngModel)]="details['phone']" required></label><label *ngFor="let field of optionalFields">{{field.label}}<input [name]="field.key" [(ngModel)]="details[field.key]"></label><label *ngFor="let field of addressFields">{{field.label}}<input [name]="field.key" [(ngModel)]="address[field.key]" [required]="field.required"></label></div><button [disabled]="busy">Submit for approval</button></form>
</ng-container>

<section *ngIf="a.platform_admin_access"
         class="admin-dashboard">

  <div class="admin-intro">
    <div>
      <p class="admin-eyebrow">
        PLATFORM ADMINISTRATION
      </p>
      <h2>Business Management</h2>
      <p>
        Manage registered businesses and review
        business membership applications.
      </p>
    </div>

    <button type="button"
            class="admin-refresh"
            (click)="loadAdmin()"
            [disabled]="busy">
      Refresh Dashboard
    </button>
  </div>

  <div class="admin-stats">

    <div class="admin-stat">
      <span>Total Businesses</span>
      <strong>{{adminBusinesses.length}}</strong>
    </div>

    <div class="admin-stat">
      <span>Active Businesses</span>
      <strong class="admin-green">
        {{activeBusinessCount}}
      </strong>
    </div>

    <div class="admin-stat">
      <span>Pending Applications</span>
      <strong>{{pendingApplicationCount}}</strong>
    </div>

    <div class="admin-stat">
      <span>Suspended Businesses</span>
      <strong>{{suspendedBusinessCount}}</strong>
    </div>

  </div>

  <section class="admin-panel">

    <div class="admin-panel-header">
      <h2>Business Directory</h2>
      <span>{{adminBusinesses.length}} businesses</span>
    </div>

    <p *ngIf="!busy && !error && !adminBusinesses.length"
       class="admin-empty">
      No registered businesses found.
    </p>

    <article *ngFor="let b of adminBusinesses"
             class="admin-business">

      <div class="admin-business-info">

        <div class="admin-business-icon">B</div>

        <div>
          <h3>{{b.business_name}}</h3>
          <p>{{b.active_members}} active members</p>
        </div>

        <span class="admin-status"
              [class.admin-status-active]="b.status==='active'"
              [class.admin-status-suspended]="b.status==='suspended'">
          {{b.status | titlecase}}
        </span>

      </div>

      <div class="admin-business-actions"
           *ngIf="b.status==='active'||b.status==='suspended'">

        <label>
          Reason for status change

          <input
            [(ngModel)]="reasons[b.business_id || b.id || '']"
            placeholder="Enter a reason (minimum 5 characters)">
        </label>

        <button type="button"
                [class.admin-danger]="b.status==='active'"
                (click)="changeStatus(b)"
                [disabled]="busy || (reasons[b.business_id || b.id || '']||'').trim().length < 5">

          {{b.status==='active'
            ? 'Suspend Business'
            : 'Activate Business'}}

        </button>

      </div>

    </article>

  </section>

  <section class="admin-panel">

    <div class="admin-panel-header">
      <h2>Business Applications</h2>
      <span>{{pendingApplicationCount}} pending</span>
    </div>

    <p *ngIf="!busy && !error && !adminApplications.length"
       class="admin-empty">
      No business applications received yet.
    </p>

    <article *ngFor="let item of adminApplications"
             class="admin-business">

      <div class="admin-business-info">

        <div class="admin-business-icon">A</div>

        <div>
          <h3>{{item.business_name}}</h3>
          <p>{{item.status | titlecase}}</p>
        </div>

      </div>

      <p *ngIf="item.rejection_reason">
        Reason: {{item.rejection_reason}}
      </p>

      <div *ngIf="item.status==='pending'"
           class="admin-application-actions">

        <button type="button"
                (click)="approve(item.application_id)"
                [disabled]="busy">
          Approve Application
        </button>

        <label>
          Rejection reason

          <input
            [(ngModel)]="reasons[item.application_id]"
            placeholder="Enter a rejection reason">
        </label>

        <button type="button"
                class="admin-danger"
                (click)="reject(item.application_id)"
                [disabled]="busy || (reasons[item.application_id]||'').trim().length < 5">
          Reject Application
        </button>

      </div>

    </article>

  </section>

</section>
</ng-container><footer>Developed by <a href="https://www.surakshasoftware.in/">Suraksha Software</a></footer></section></main>`})
export class AccountComponent implements OnInit {
get activeBusinessCount(): number {
    return this.adminBusinesses.filter(
        b => b.status === 'active'
    ).length;
}

get suspendedBusinessCount(): number {
    return this.adminBusinesses.filter(
        b => b.status === 'suspended'
    ).length;
}

get pendingApplicationCount(): number {
    return this.adminApplications.filter(
        a => a.status === 'pending'
    ).length;
}

 access:AccountAccess|null=null; busy=false; error=''; notice=''; password=''; confirmation=''; verificationPassword='';
 details:Record<string,string>={business_name:'',contact_name:'',business_type:'jewellery',phone:''}; address:Record<string,string>={};
 optionalFields=[['legal_name','Legal name'],['tagline','Tagline'],['established_year','Established year'],['alternate_phone','Alternate mobile'],['whatsapp_number','WhatsApp'],['business_email','Business email'],['website','Website'],['gst_number','GSTIN'],['pan_number','PAN'],['bis_registration_number','BIS registration'],['trade_licence_number','Trade licence']].map(([key,label])=>({key,label}));
 addressFields=[['shop_number','Shop number'],['building_name','Building'],['street','Street'],['landmark','Landmark'],['locality','Locality'],['city','City'],['district','District'],['state','State'],['postal_code','PIN code']].map(([key,label],i)=>({key,label,required:i>=4}));
 adminApplications:Application[]=[];adminBusinesses:AdminBusiness[]=[];reasons:Record<string,string>={};
 constructor(public auth:AuthService,private api:AccountAccessService,private cdr:ChangeDetectorRef){}
 ngOnInit(){void this.refresh();}
 async run(action:()=>Promise<void>){if(this.busy)return;this.busy=true;this.error='';this.notice='';try{await action();}catch(e){this.error=(e as {message?:string})?.message||'Request failed';}finally{this.busy=false;this.cdr.markForCheck();}}
 async reload(){this.access=null;const a=await this.api.load();if(a.user_id!==this.auth.user?.id)throw new Error('Session changed. Sign in again.');this.access=a;if(a.platform_admin_access){await this.adminReload();}if(!a.platform_admin_access){this.adminApplications=[];this.adminBusinesses=[];}}
 refresh(){return this.run(()=>this.reload());}
 signOut(){return this.run(()=>this.auth.signOut());}
 configure(){return this.run(async()=>{try{if(this.password!==this.confirmation||this.password.length<8||!/[A-Z]/.test(this.password)||!/[a-z]/.test(this.password)||!/[0-9]/.test(this.password)||! /[^A-Za-z0-9]/.test(this.password))throw new Error('Passwords must match and satisfy all requirements.');const id=this.auth.user?.id;const {data,error}=await this.api.client.auth.updateUser({password:this.password});if(error)throw error;if(data.user?.id!==id)throw new Error('Unexpected user ID');await this.reload();this.notice='Password configured. Verify password login before migration.';}finally{this.password='';this.confirmation='';}});}
 verify(){return this.run(async()=>{try{const id=this.auth.user?.id,email=this.auth.user?.email;if(!id||!email)throw new Error('Email account required');await this.auth.signInWithPassword(email,this.verificationPassword);if(this.auth.user?.id!==id){this.access=null;await this.auth.signOut();throw new Error('Account ID changed; migration stopped.');}await this.reload();this.notice=this.access?.has_verified_password_account&&this.access?.is_password_session?'Password login verified on the same account.':'Password login completed, but backend eligibility is not yet satisfied. Legacy access remains unchanged.';}finally{this.verificationPassword='';}});}
 migrate(id:string){if(!confirm('Disable Google business access for this workspace? Personal Google access remains available.'))return;return this.run(async()=>{const {error}=await this.api.client.rpc('ss_complete_legacy_password_migration',{p_business_id:id});if(error)throw error;await this.reload();this.notice='Migration completed.';});}
 submitApplication(){return this.run(async()=>{const {error}=await this.api.client.rpc('ss_submit_business_application',{p_details:{...this.details,address:{...this.address,country:'India'}} as Json});if(error)throw error;await this.reload();this.notice='Application submitted for approval.';});}
 cancel(id:string){if(!confirm('Cancel this pending application?'))return;return this.run(async()=>{const {error}=await this.api.client.rpc('ss_cancel_business_application',{p_application_id:id});if(error)throw error;await this.reload();});}
 async adminReload(){if(!this.access?.platform_admin_access)throw new Error('Super Admin authorization required');const {data,error}=await this.api.client.rpc('ss_admin_list_businesses',{});if(error)throw error;this.adminBusinesses=(data||[]) as unknown as AdminBusiness[];const result=await this.api.client.from('ss_business_applications').select('id,business_name,status,rejection_reason').order('created_at',{ascending:false});if(result.error)throw result.error;this.adminApplications=(result.data||[]).map(x=>({application_id:x.id,business_name:x.business_name,status:x.status,rejection_reason:x.rejection_reason}));}
 loadAdmin(){return this.run(()=>this.adminReload());}
 approve(id:string){if(!confirm('Approve this application and create a business workspace?'))return;return this.run(async()=>{const {error}=await this.api.client.rpc('ss_approve_business_application',{p_application_id:id});if(error)throw error;await this.adminReload();});}
 reject(id:string){return this.run(async()=>{const {error}=await this.api.client.rpc('ss_reject_business_application',{p_application_id:id,p_reason:this.reasons[id]||''});if(error)throw error;await this.adminReload();});}
 changeStatus(b:AdminBusiness){const id=b.business_id||b.id;if(!id||!confirm('Change business access status?'))return;return this.run(async()=>{const {error}=await this.api.client.rpc('ss_admin_set_business_status',{p_business_id:id,p_new_status:b.status==='active'?'suspended':'active',p_reason:this.reasons[id]||''});if(error)throw error;await this.adminReload();});}
}

