import { Routes } from '@angular/router';
import { authGuard } from './core/auth/auth.guard';
import { DashboardComponent } from './features/dashboard/dashboard.component';
import { LoginComponent } from './features/login/login.component';
import { AuthCallbackComponent } from './features/login/auth-callback.component';
import { WorkspaceShellComponent } from './features/dashboard/workspace-shell.component';
import { CustomersComponent } from './features/customers/customers.component';
import { SalesComponent } from './features/sales/sales.component';
import { GirviComponent } from './features/girvi/girvi.component';

export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'dashboard' },
  { path: 'login', component: LoginComponent },
  { path: 'auth/callback', component: AuthCallbackComponent },
  {
    path: 'dashboard',
    component: WorkspaceShellComponent,
    canActivate: [authGuard],
    children: [
      { path: '', pathMatch: 'full', component: DashboardComponent },
      { path: 'customers', component: CustomersComponent },
      { path: 'sales', component: SalesComponent },
      { path: 'girvi', component: GirviComponent },
      { path: 'bill', pathMatch: 'full', redirectTo: 'sales' },

      // Legacy URLs redirect to Home. Their source files and database objects
      // are intentionally retained so removing navigation does not delete data.
      { path: 'cashbook', pathMatch: 'full', redirectTo: '' },
      { path: 'rates', pathMatch: 'full', redirectTo: '' },
      { path: 'suppliers', pathMatch: 'full', redirectTo: '' },
      { path: 'purchases', pathMatch: 'full', redirectTo: '' },
      { path: 'inventory', pathMatch: 'full', redirectTo: '' },
      { path: 'expenses', pathMatch: 'full', redirectTo: '' },
      { path: 'reports', pathMatch: 'full', redirectTo: '' },
      { path: 'audit', pathMatch: 'full', redirectTo: '' },
      { path: '**', redirectTo: '' }
    ]
  },
  { path: '**', redirectTo: 'dashboard' }
];
