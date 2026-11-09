import { Injectable, OnDestroy } from '@angular/core';
import { Router } from '@angular/router';
import { BehaviorSubject } from 'rxjs';
import { Session, User } from '@supabase/supabase-js';
import { SupabaseService } from '../supabase/supabase.service';
import { environment } from '../../../environments/environment';

@Injectable({ providedIn: 'root' })
export class AuthService implements OnDestroy {
  private readonly sessionState = new BehaviorSubject<Session | null>(null);
  private readonly readyState = new BehaviorSubject(false);
  private authUnsubscribe: (() => void) | null = null;
  private initializeTask: Promise<void> | null = null;
  private oauthInProgress = false;
  readonly session$ = this.sessionState.asObservable();
  readonly ready$ = this.readyState.asObservable();

  constructor(private readonly supabase: SupabaseService, private readonly router: Router) {
    if (this.supabase.client) {
      const { data } = this.supabase.client.auth.onAuthStateChange((_event, session) => {
        this.sessionState.next(session);
      });
      this.authUnsubscribe = () => data.subscription.unsubscribe();
    }
  }

  get user(): User | null { return this.sessionState.value?.user ?? null; }
  get session(): Session | null { return this.sessionState.value; }

  initialize(): Promise<void> {
    if (!this.initializeTask) {
      this.initializeTask = this.restoreSession().catch(error => {
        // A failed restoration must be retryable instead of leaving a rejected
        // promise cached for the lifetime of the app.
        this.initializeTask = null;
        this.readyState.next(true);
        throw error;
      });
    }
    return this.initializeTask;
  }

  private async restoreSession(): Promise<void> {
    const client = this.supabase.client;
    if (!client) { this.readyState.next(true); return; }
    const { data, error } = await this.withTimeout(client.auth.getSession(), 'Restoring your Supabase session');
    if (error) throw error;
    this.sessionState.next(data.session);
    this.readyState.next(true);
  }

  private async withTimeout<T>(request: PromiseLike<T>, action: string): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        Promise.resolve(request),
        new Promise<T>((_, reject) => {
          timer = setTimeout(() => reject(new Error(`${action} timed out. Check your connection and retry.`)), 12000);
        })
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  async signInWithGoogle(): Promise<void> {
    const client = this.requireClient();
    if (this.oauthInProgress) return;
    this.oauthInProgress = true;
    const redirectTo = environment.oauthRedirectTo || new URL('/dashboard', window.location.origin).toString();
    const { error } = await client.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo }
    });
    if (error) {
      this.oauthInProgress = false;
      throw error;
    }
  }

  async signOut(): Promise<void> {
    const { error } = await this.requireClient().auth.signOut();
    if (error) throw error;
    this.sessionState.next(null);
    await this.router.navigateByUrl('/login');
  }

  cancelOAuthAttempt(): void { this.oauthInProgress = false; }

  private requireClient() {
    if (!this.supabase.client) throw new Error('Supabase is not configured. Add its project URL and publishable key to the environment configuration.');
    return this.supabase.client;
  }

  ngOnDestroy(): void { this.authUnsubscribe?.(); }
}
