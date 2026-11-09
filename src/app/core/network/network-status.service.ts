import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';

@Injectable({ providedIn: 'root' })
export class NetworkStatusService {
  private readonly state = new BehaviorSubject<boolean>(typeof navigator === 'undefined' ? true : navigator.onLine);
  readonly online$ = this.state.asObservable();
  private readonly onlineHandler = () => this.state.next(true);
  private readonly offlineHandler = () => this.state.next(false);
  constructor() {
    if (typeof window !== 'undefined') {
      window.addEventListener('online', this.onlineHandler);
      window.addEventListener('offline', this.offlineHandler);
    }
  }
  get isOnline(): boolean { return this.state.value; }
}
