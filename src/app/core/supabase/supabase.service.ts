import { Injectable } from '@angular/core';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { Database } from './database.types';
import { environment } from '../../../environments/environment';

@Injectable({ providedIn: 'root' })
export class SupabaseService {
  readonly configured = Boolean(environment.supabaseUrl && environment.supabaseAnonKey);
  readonly client: SupabaseClient<Database> | null = this.configured
    ? createClient<Database>(environment.supabaseUrl, environment.supabaseAnonKey, {
        auth: {
          persistSession: true,
          // Keep the session in local storage so the user stays signed in across app restarts until they sign out.
          storage: typeof window !== 'undefined' ? window.localStorage : undefined,
          autoRefreshToken: true,
          detectSessionInUrl: true
        }
      })
    : null;
}