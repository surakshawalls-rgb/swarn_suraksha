import {Component} from '@angular/core';
import {CommonModule} from '@angular/common';
import {RouterLink} from '@angular/router';
import {RatesComponent} from '../rates/rates.component';
import {AuthService} from '../../core/auth/auth.service';
@Component({standalone:true,imports:[CommonModule,RouterLink,RatesComponent],styleUrls:['./account.scss'],template:`<main class="access-page"><div style="width:min(100%,1100px)"><section class="access-card" style="width:100%;margin-bottom:20px"><h1>Personal market dashboard</h1><ng-container *ngIf="auth.session$ | async; else guest"><a class="action" routerLink="/account">Account center / Business registration</a></ng-container><ng-template #guest><a class="action" routerLink="/login">Sign in or create account</a><p>No account is required to view published market rates.</p></ng-template></section><app-rates [personal]="true" [embedded]="true"/></div></main>`})export class PersonalComponent{constructor(public auth:AuthService){void auth.initialize().catch(()=>{});}}
