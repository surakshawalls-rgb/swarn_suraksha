import { Component } from '@angular/core';
import { IonicModule } from '@ionic/angular';
import { UiPrefsService } from './core/ui/ui-prefs.service';

@Component({
  selector: 'ss-root',
  standalone: true,
  imports: [IonicModule],
  template: '<ion-app><ion-router-outlet></ion-router-outlet></ion-app>'
})
export class AppComponent {
  constructor(ui: UiPrefsService) { ui.start(); }
}