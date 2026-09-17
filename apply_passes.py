from pathlib import Path
root=Path('/mnt/data/streept10/frontend/src/navigation')

def write(name, text): (root/name).write_text(text)

write('parkingIntelligence.ts', r'''import { Location, ParkingLot } from '../types';

export interface ParkingIntelligence {
  lotId: string | null;
  availability: number;
  availableSpaces: number;
  occupancyRatio: number;
  distanceMeters: number | null;
  status: 'available' | 'busy' | 'near-full' | 'full' | 'unknown';
  confidence: number;
}

const clamp01 = (v:number) => Math.max(0, Math.min(1, Number.isFinite(v) ? v : 0));
const distanceMeters = (a:Location,b:Location) => {
  const lat=111320, lng=lat*Math.max(0.2,Math.cos(a.lat*Math.PI/180));
  return Math.hypot((a.lat-b.lat)*lat,(a.lng-b.lng)*lng);
};

/** Converts observed lot capacity into a conservative driver-facing state. */
export function assessParkingLot(lot: ParkingLot, location: Location|null): ParkingIntelligence {
  const total=Math.max(0, lot.total_spaces);
  const occupied=Math.max(0, Math.min(total, lot.occupied_spaces));
  const available=Math.max(0,total-occupied);
  const ratio=total>0?occupied/total:1;
  const status=total<=0?'unknown':available<=0?'full':ratio>=0.9?'near-full':ratio>=0.7?'busy':'available';
  const distance=location?distanceMeters(location,lot.location):null;
  const evidence=total>0?0.7:0;
  return { lotId:lot.id, availability:available, availableSpaces:available, occupancyRatio:ratio, distanceMeters:distance, status, confidence:clamp01(evidence+(location?0.2:0)) };
}

export function rankParkingLots(lots: ParkingLot[], location: Location|null, maxResults=5): Array<ParkingLot & { intelligence: ParkingIntelligence }> {
  return lots.map(lot=>({...lot,intelligence:assessParkingLot(lot,location)}))
    .sort((a,b)=>{
      const aAvail=a.intelligence.availableSpaces>0?1:0, bAvail=b.intelligence.availableSpaces>0?1:0;
      if(aAvail!==bAvail) return bAvail-aAvail;
      const ad=a.intelligence.distanceMeters??Infinity, bd=b.intelligence.distanceMeters??Infinity;
      return ad-bd || b.intelligence.availableSpaces-a.intelligence.availableSpaces;
    }).slice(0,Math.max(1,maxResults));
}
''')

write('billboardIntelligence.ts', r'''import { Billboard, Location } from '../types';
export interface BillboardRelevance { billboardId:string; active:boolean; distanceMeters:number|null; routeProximityScore:number; attentionScore:number; confidence:number; }
const dist=(a:Location,b:Location)=>{const lat=111320,lng=lat*Math.max(.2,Math.cos(a.lat*Math.PI/180));return Math.hypot((a.lat-b.lat)*lat,(a.lng-b.lng)*lng)};
const clamp=(v:number)=>Math.max(0,Math.min(1,Number.isFinite(v)?v:0));
const activeNow=(b:Billboard,now:number)=>{const s=b.display_start?Date.parse(b.display_start):-Infinity,e=b.display_end?Date.parse(b.display_end):Infinity;return b.is_purchased&&s<=now&&now<=e&&Boolean(b.ad_image_url)};
export function scoreBillboardRelevance(b:Billboard, location:Location|null, routeLocations:Location[]=[], now=Date.now()):BillboardRelevance {
  const active=activeNow(b,now), distance=location?dist(location,b.location):null;
  let routeProximityScore=routeLocations.length?Math.max(0,1-Math.min(...routeLocations.map(p=>dist(p,b.location)))/250):0;
  const attentionScore=active?clamp((distance==null?.15:Math.max(0,1-distance/180))*.7+routeProximityScore*.3):0;
  return {billboardId:b.id,active,distanceMeters:distance,routeProximityScore,attentionScore,confidence:active?clamp(.55+routeProximityScore*.35):.2};
}
export function rankBillboards(billboards:Billboard[], location:Location|null, routeLocations:Location[]=[], now=Date.now()): BillboardRelevance[] { return billboards.map(b=>scoreBillboardRelevance(b,location,routeLocations,now)).sort((a,b)=>b.attentionScore-a.attentionScore); }
''')

write('worldContext.ts', r'''import { Billboard, Location, ParkingLot, Report, TrafficVehicle } from '../types';
import { BillboardRelevance, rankBillboards } from './billboardIntelligence';
import { ParkingIntelligence, rankParkingLots } from './parkingIntelligence';
import { SpatialIntelligenceSnapshot } from './spatialIntelligence';
export interface SpatialWorldContext { spatial: SpatialIntelligenceSnapshot; parking: Array<ParkingLot & { intelligence: ParkingIntelligence }>; billboards: BillboardRelevance[]; reportsNearby:number; trafficNearby:number; confidence:number; }
export function buildSpatialWorldContext(spatial:SpatialIntelligenceSnapshot, location:Location|null, parkingLots:ParkingLot[], billboards:Billboard[], reports:Report[], traffic:TrafficVehicle[], routeLocations:Location[]=[], now=Date.now()):SpatialWorldContext {
 const parking=rankParkingLots(parkingLots,location,5), billboard=rankBillboards(billboards,location,routeLocations,now);
 const confidence=Math.min(1,spatial.confidence*.65+(parking.length?0.12:0)+(billboard.length?0.08:0)+(reports.length?0.08:0)+(traffic.length?0.07:0));
 return {spatial,parking,billboards:billboard,reportsNearby:spatial.nearbyReports,trafficNearby:spatial.nearbyTrafficVehicles,confidence};
}
''')

write('parkingIntelligence.test.ts', r'''import { describe, expect, it } from 'vitest';
import { assessParkingLot, rankParkingLots } from './parkingIntelligence';
const lot=(id:string,occ:number)=>({id,name:id,location:{lat:0,lng:0},total_spaces:100,occupied_spaces:occ});
describe('parking intelligence',()=>{it('classifies occupancy conservatively',()=>{expect(assessParkingLot(lot('a',95),null).status).toBe('near-full');expect(assessParkingLot(lot('b',100),null).status).toBe('full');});it('prefers available lots before full lots',()=>{const r=rankParkingLots([lot('full',100),lot('open',20)],{lat:0,lng:0});expect(r[0].id).toBe('open');});});
''')
write('billboardIntelligence.test.ts', r'''import { describe, expect, it } from 'vitest'; import { scoreBillboardRelevance } from './billboardIntelligence';
const b={id:'b',location:{lat:0,lng:0},is_purchased:true,purchased_by:'x',ad_image_url:'x',ad_target_url:null,display_start:null,display_end:null,click_count:0};
describe('billboard intelligence',()=>{it('requires an active purchased creative for attention',()=>{expect(scoreBillboardRelevance(b,{lat:0,lng:0}).active).toBe(true);expect(scoreBillboardRelevance({...b,is_purchased:false},{lat:0,lng:0}).attentionScore).toBe(0);});});
''')
