import { CommonModule } from '@angular/common';
import { ChangeDetectorRef, Component, Input, OnDestroy, OnInit } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Subscription } from 'rxjs';
import { WorkspaceService } from '../dashboard/workspace.service';
import { MarketRateService, MarketSnapshot, stale } from '../../core/market/market-rate.service';
@Component({selector:'app-rates',standalone:true,imports:[CommonModule,RouterLink],templateUrl:'./rates.component.html',styleUrl:'./rates.component.scss'})
export class RatesComponent implements OnInit,OnDestroy {
 @Input() embedded=false; @Input() personal=false;
 workspace:{id:string}|null=null; fetching=false; errorMessage=''; showOtherGoldRates=false;
 snapshot:MarketSnapshot|null=null; private sub?:Subscription; private request=0;
 readonly silverBharGrams=11.6638;
 constructor(private workspaceService:WorkspaceService,private cdr:ChangeDetectorRef,private market:MarketRateService){}
 get rates(){return this.snapshot?(this.showOtherGoldRates?['24K','22K','20K','18K','14K']:['24K']).map(purity=>({purity,rate:(this.snapshot!.gold[purity].displayPricePerGram ?? this.snapshot!.gold[purity].finalPricePerGram ?? Math.round(this.snapshot!.gold[purity].basePricePerGram * 103) / 100)})):[];}
 get latestQuoteTime(){return this.snapshot?.lastUpdatedAt??null;} get silverRate(){return this.snapshot ? (this.snapshot.silver.displayPricePerGram ?? this.snapshot.silver.finalPricePerGram ?? Math.round(this.snapshot.silver.basePricePerGram * 103) / 100) : null;}
 get silverFetchedAt(){return this.latestQuoteTime;} get silverFetching(){return this.fetching;} get silverErrorMessage(){return this.errorMessage;}
 get isStale(){return !!this.snapshot&&stale(this.snapshot);} get canRefresh(){return this.personal||!!this.workspace;}
 ngOnInit(){if(this.personal){void this.fetchGoldRates();return;}this.sub=this.workspaceService.activeWorkspace$.subscribe(w=>{this.workspace=w;this.snapshot=null;this.fetching=false;this.request++;if(w)void this.fetchGoldRates();});}
 ngOnDestroy(){this.request++;this.sub?.unsubscribe();}
 async fetchGoldRates(_force=false){if(!this.canRefresh||this.fetching)return;const id=++this.request;this.fetching=true;this.errorMessage='';try{const s=await this.market.load(this.personal?undefined:this.workspace!.id);if(id===this.request)this.snapshot=s;}catch(e){if(id===this.request){this.snapshot=null;this.errorMessage=e instanceof Error?e.message:'Rates unavailable';}}finally{if(id===this.request){this.fetching=false;this.cdr.markForCheck();}}}
 loadOtherGoldRates(){this.showOtherGoldRates=!this.showOtherGoldRates;}

 get nextScheduledRefresh(): Date {
   const now = Date.now();
   const offset = 19800000;
   const day = Math.floor((now + offset) / 86400000)
     * 86400000 - offset;

   const morning = day + 9 * 3600000;
   const afternoon = day + 13 * 3600000;

   if (now < morning) {
     return new Date(morning);
   }

   if (now < afternoon) {
     return new Date(afternoon);
   }

   return new Date(morning + 86400000);
 }
 formatRate(value:number){return new Intl.NumberFormat('en-IN',{minimumFractionDigits:2,maximumFractionDigits:2}).format(value);}
}
