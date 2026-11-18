import { importProvidersFrom } from '@angular/core';
import { bootstrapApplication } from '@angular/platform-browser';
import { IonicModule } from '@ionic/angular';
import { provideRouter } from '@angular/router';
import { AppComponent } from './app/app.component';
import { routes } from './app/app.routes';

// The app imports IonicModule (not the /standalone components), so it must be paired with
// IonicModule.forRoot(). That call registers Ionic's web components (ion-app, ion-router-outlet ...).
// Without it the page renders but stays invisible, which shows as a blank screen in production.
bootstrapApplication(AppComponent, {
  providers: [importProvidersFrom(IonicModule.forRoot()), provideRouter(routes)]
}).catch(console.error);