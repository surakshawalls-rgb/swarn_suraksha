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
