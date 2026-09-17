import { Billboard, Location } from '../types';
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
