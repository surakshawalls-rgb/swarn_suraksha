import { Injectable } from '@angular/core';
import { SupabaseService } from '../supabase/supabase.service';
import { environment } from '../../../environments/environment';
export interface MarketSnapshot { gold: Record<string,{basePricePerGram:number}>; silver:{basePricePerGram:number}; lastUpdatedAt:string; marketTimestamp:string; city:string; provider:string; confidence:string; automaticRefreshEnabled?:boolean; }
export function stale(s:MarketSnapshot):boolean {
 const offset=19800000, now=Date.now(), day=Math.floor((now+offset)/86400000)*86400000-offset;
 const expected=now>=day+47700000?day+46800000:now>=day+33300000?day+32400000:day-39600000;
 return s.automaticRefreshEnabled===false || Date.parse(s.lastUpdatedAt)<expected;
}
@Injectable({providedIn:'root'})
export class MarketRateService {
 private snapshots=new Map<string,MarketSnapshot>();
 private pending=new Map<string,Promise<MarketSnapshot>>();
 constructor(private supabase:SupabaseService) {}
 async load(businessId?:string):Promise<MarketSnapshot> {
 const key=businessId||'public'; const existing=this.pending.get(key); if(existing)return existing;
 const task=this.read(businessId).then(s=>{this.snapshots.set(key,s);return s;}).catch(e=>{this.snapshots.delete(key);throw e;}).finally(()=>this.pending.delete(key));
 this.pending.set(key,task);return task;
 }
 private async read(businessId?:string):Promise<MarketSnapshot> {
 let data:unknown;
 if(businessId){const client=this.supabase.client;if(!client)throw new Error('Supabase is not configured.');
 const result=await client.rpc('ss_get_business_market_rates' as any,{p_business_id:businessId}).abortSignal(AbortSignal.timeout(15000));if(result.error)throw new Error(result.error.message);data=result.data;
 }else{const response=await fetch(environment.supabaseUrl+'/functions/v1/market-rates',{headers:{apikey:environment.supabaseAnonKey},cache:'no-store',signal:AbortSignal.timeout(15000)});if(response.status===403)throw new Error('Public market rates are not available yet.');if(!response.ok)throw new Error('Market rates unavailable.');data=await response.json();}
 const s=data as MarketSnapshot; if(!s||!Number.isFinite(Date.parse(s.lastUpdatedAt))||!Number.isFinite(Date.parse(s.marketTimestamp))||!['high','medium'].includes(s.confidence)||!['24K','22K','20K','18K','14K'].every(k=>Number.isFinite(s.gold?.[k]?.basePricePerGram)&&s.gold[k].basePricePerGram>0)||!Number.isFinite(s.silver?.basePricePerGram)||s.silver.basePricePerGram<=0)throw new Error('Invalid market rate snapshot.');return s;
 }
 quote(businessId:string,metal:'gold'|'silver',purity:string){const s=this.snapshots.get(businessId);if(!s||stale(s))return null;const exact=metal==='silver'?s.silver.basePricePerGram:s.gold[purity]?.basePricePerGram;const rate=exact??(purity==='16K'?s.gold['18K'].basePricePerGram*16/18:0);return rate>0?{value:rate.toFixed(4),label:`${purity==='16K'||purity==='20K'?'Calculated · ':''}Nebula Metals · ${s.lastUpdatedAt} · indicative, ex GST`}:null;}
}
