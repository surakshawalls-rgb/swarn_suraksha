import { Injectable } from '@angular/core';
import { SupabaseService } from '../supabase/supabase.service';
export interface Membership { business_id: string; business_name: string; business_status: string; membership_role: string; access_allowed: boolean; legacy_access: boolean; password_migration_required: boolean; }
export interface Application { application_id: string; business_name: string; status: string; rejection_reason: string | null; }
export interface AccountAccess { user_id: string; personal_access: boolean; business_access: boolean; platform_admin_access: boolean; has_verified_password_account: boolean; is_password_session: boolean; can_apply_for_business: boolean; businesses: Membership[]; applications: Application[]; }
@Injectable({providedIn:'root'})
export class AccountAccessService {
 constructor(private supabase: SupabaseService) {}
 get client() { if (!this.supabase.client) throw new Error('Supabase is not configured'); return this.supabase.client; }
 async load(): Promise<AccountAccess> {
   const {data,error}=await this.client.rpc('ss_get_account_access', {});
   if(error) throw error;
   if(!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Invalid account access response');
   return data as unknown as AccountAccess;
 }
}
