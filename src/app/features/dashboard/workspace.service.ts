import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';
import { User } from '@supabase/supabase-js';
import { SupabaseService } from '../../core/supabase/supabase.service';

export interface BusinessWorkspace {
  id: string;
  name: string;
  role: 'owner' | 'admin' | 'staff';
}

@Injectable({ providedIn: 'root' })
export class WorkspaceService {
  private readonly activeState = new BehaviorSubject<BusinessWorkspace | null>(null);
  private readonly profilesReady = new Set<string>();
  readonly activeWorkspace$ = this.activeState.asObservable();

  constructor(private readonly supabase: SupabaseService) {}

  get client() { return this.supabase.client; }

  async ensureProfile(): Promise<User> {
    const client = this.requireClient();
    const { data: sessionData, error: sessionError } = await this.withTimeout(
      client.auth.getSession(), 'Checking your signed-in session'
    );
    if (sessionError) throw new Error(`Could not verify your signed-in session: ${sessionError.message}`);
    const user = sessionData.session?.user;
    if (!user) throw new Error('Your sign-in session is missing or expired. Sign in again to continue.');
    if (this.profilesReady.has(user.id)) return user;
    const metadata = user.user_metadata ?? {};
    const displayName = (metadata['full_name'] ?? metadata['name']) as string | undefined;
    const profile = await this.runRequest('Saving your user profile', signal => client.from('user_profiles').upsert({
        user_id: user.id,
        ...(displayName ? { display_name: displayName } : {})
      }, { onConflict: 'user_id' }).abortSignal(signal));
    if (profile.error) throw this.describe('Saving your user profile', profile.error);
    this.profilesReady.add(user.id);
    return user;
  }

  async loadMemberships(): Promise<BusinessWorkspace[]> {
    const client = this.requireClient();
    const user = await this.ensureProfile();
    // Filter by status = 'active' since the live schema uses status column (not is_active)
    const membershipResult = await this.runRequest('Checking workspace memberships', signal => client.from('business_members')
      .select('business_id, role')
      .eq('user_id', user.id)
      .eq('status', 'active')
      .abortSignal(signal));
    if (membershipResult.error) throw this.describe('Checking workspace memberships', membershipResult.error);
    const memberships = membershipResult.data ?? [];
    if (memberships.length === 0) return [];

    const businessIds = memberships.map(row => row.business_id);
    const businessResult = await this.runRequest('Loading your workspaces', signal => client.from('business_profiles')
      .select('id, business_name')
      .in('id', businessIds)
      .abortSignal(signal));
    if (businessResult.error) throw this.describe('Loading your workspaces', businessResult.error);
    const byId = new Map((businessResult.data ?? []).map(business => [business.id, business.business_name]));
    // Membership rows alone do not authorize access. Only businesses returned
    // by the business_profiles query (and therefore permitted by its RLS) can
    // become selectable workspaces. Hidden/revoked memberships are excluded.
    const workspaces = memberships.flatMap(row => {
      const name = byId.get(row.business_id);
      if (!name) return [];
      return [{ id: row.business_id, name, role: row.role as BusinessWorkspace['role'] }];
    });

    const storedId = localStorage.getItem('swarn-suraksha.active-business');
    const active = workspaces.find(item => item.id === storedId) ?? (workspaces.length === 1 ? workspaces[0] : null);
    if (active) this.setActiveWorkspace(active);
    return workspaces;
  }

  async createWorkspace(values: {
    businessName: string;
    contactName: string;
    mobile: string;
    city: string;
    state: string;
  }): Promise<string> {
    await this.ensureProfile();

    const { data, error } = await this.runRequest(
      'Creating your workspace',
      signal =>
        this.requireClient()
          .rpc('create_business', {
            p_business_name: values.businessName.trim(),
            p_contact_name: values.contactName.trim() || null,
            p_phone: values.mobile.trim() || null,
            p_address: JSON.stringify({
              city: values.city.trim(),
              state: values.state.trim()
            })
          })
          .abortSignal(signal)
    );

    if (error) {
      throw this.describe('Creating your workspace', error);
    }

    if (typeof data !== 'string' || !data) {
      throw new Error(
        'Workspace creation returned no business ID. Check the create_business function.'
      );
    }

    return data;
  }
  setActiveWorkspace(workspace: BusinessWorkspace): void {
    localStorage.setItem('swarn-suraksha.active-business', workspace.id);
    this.activeState.next(workspace);
  }

  private requireClient() {
    if (!this.supabase.client) throw new Error('Supabase is not configured.');
    return this.supabase.client;
  }

  private async runRequest<T>(action: string, start: (signal: AbortSignal) => PromiseLike<T>): Promise<T> {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let didTimeout = false;
    try {
      return await Promise.race([
        Promise.resolve(start(controller.signal)),
        new Promise<T>((_, reject) => {
          timer = setTimeout(() => {
            didTimeout = true;
            reject(new Error(`${action} timed out after 15 seconds. Check the Supabase request in Network and retry.`));
            controller.abort();
          }, 15000);
        })
      ]);
    } catch (error) {
      if (didTimeout) throw new Error(`${action} timed out after 15 seconds. Check your connection and Supabase availability, then retry.`);
      throw error;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  private async withTimeout<T>(request: PromiseLike<T>, action: string): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        Promise.resolve(request),
        new Promise<T>((_, reject) => {
          timer = setTimeout(() => reject(new Error(`${action} timed out after 12 seconds. Retry or sign in again.`)), 12000);
        })
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  private describe(action: string, error: { message: string; code?: string; status?: number }): Error {
    if (error.code === '42P01' || error.code === 'PGRST205') {
      return new Error(`${action} failed (${error.code}): ${error.message}. Verify that the referenced table exists in the live schema and is exposed through Supabase REST.`);
    }
    if (error.code === '42501' && /permission denied for table/i.test(error.message)) {
      return new Error(`${action} failed (${error.code}): ${error.message}. The authenticated role needs the required table grant; inspect the named table's grants before changing SQL.`);
    }
    if (error.code === '42501' && /row-level security/i.test(error.message)) {
      return new Error(`${action} was blocked by RLS (${error.code}): ${error.message}. Check the named table's policy and authenticated user's ownership or tenant membership.`);
    }
    if (error.code === 'PGRST301' || error.status === 401 || error.status === 403) {
      return new Error(`${action} was denied${error.status ? ` (HTTP ${error.status})` : ''}${error.code ? ` (${error.code})` : ''}: ${error.message}. Verify that the current Supabase session is valid and inspect the named request's grants and RLS policy.`);
    }
    if (error.code === '42501') {
      return new Error(`${action} was denied (${error.code}): ${error.message}. Inspect privileges and RLS for the table named in the response.`);
    }
    if (error.code === '42P10') {
      return new Error(`${action} failed (${error.code}): ${error.message}. The upsert conflict target needs a matching unique constraint/index in the live schema.`);
    }
    if (error.code === 'PGRST202' || error.code === '42883') {
      return new Error(`${action} cannot find the required database function. Apply the latest versioned workspace migration.`);
    }
    return new Error(`${action} failed${error.status ? ` (HTTP ${error.status})` : ''}${error.code ? ` (${error.code})` : ''}: ${error.message}`);
  }
}



