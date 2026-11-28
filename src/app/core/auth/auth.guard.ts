import { AccountAccessService } from './account-access.service';
import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from './auth.service';

export const authGuard: CanActivateFn = async (_route, state) => {
  const auth = inject(AuthService);
  const router = inject(Router);
  try {
    await auth.initialize();
  } catch {
    return router.createUrlTree(['/login'], { queryParams: { reason: 'session' } });
  }
  return auth.user ? true : router.createUrlTree(['/login'], { queryParams: { returnTo: state.url } });
};

// Decides where a fresh app open should land: signed-in users go straight to their workspace,
// everyone else sees the sign-in page.
export const startGuard: CanActivateFn = async () => {
  const auth = inject(AuthService);
  const router = inject(Router);
  try { await auth.initialize(); } catch { return router.createUrlTree(['/login']); }
  return router.createUrlTree([auth.user ? '/dashboard' : '/login']);
};

export const businessGuard: CanActivateFn = async () => {
 const auth=inject(AuthService), router=inject(Router), access=inject(AccountAccessService);
 try { await auth.initialize(); if (!auth.user) return router.createUrlTree(['/login']);
 return (await access.load()).business_access === true ? true : router.createUrlTree(['/account']);
 } catch { return router.createUrlTree(['/account']); }
};