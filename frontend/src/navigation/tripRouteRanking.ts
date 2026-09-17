import { TripIntelligenceSummary } from './tripIntelligence';
export type TripPreference = 'balanced'|'fastest'|'easiest'|'scenic'|'highway';
export interface TripRouteRank { routeIndex:number; score:number; label:string; reasons:string[]; }

export function bestDepartureWindow(summary: TripIntelligenceSummary): { hourOffset: number; pressure: number } | null {
  const candidates = summary.trafficForecast.filter(x => x.confidence >= 35);
  if (!candidates.length) return null;
  return candidates.reduce((best, item) => item.pressure < best.pressure ? item : best, candidates[0]);
}
const clamp=(n:number)=>Math.max(0,Math.min(100,n));
export function rankTripAlternatives(summaries:TripIntelligenceSummary[], preference:TripPreference='balanced'):TripRouteRank[]{return summaries.map((s,i)=>{const scenic=s.characters.find(x=>x.character==='scenic')?.percent??0, highway=(s.characters.find(x=>x.character==='motorway')?.percent??0)+(s.characters.find(x=>x.character==='highway')?.percent??0), time=(s.durationSeconds??0)/Math.max(1,...summaries.map(x=>x.durationSeconds??0)), reasons:string[]=[];let score=100-s.difficulty*.45-s.trafficPressure*.35+(s.roadQuality-50)*.2; if(preference==='fastest')score-=time*25; if(preference==='easiest')score+=(100-s.difficulty)*.35; if(preference==='scenic')score+=scenic*.55; if(preference==='highway')score+=highway*.35; if(s.trafficPressure>=70)reasons.push('heavy reported traffic'); if(s.roadQuality<50)reasons.push('lower road-quality confidence'); if(scenic>=25)reasons.push('scenic potential'); if(s.characters.some(x=>x.character==='mountain'))reasons.push('mountain driving'); if(highway>=60)reasons.push('mostly highway'); if(!reasons.length)reasons.push('balanced journey profile'); return{routeIndex:i,score:clamp(score),label:s.difficulty>=70?'Demanding':s.trafficPressure>=65?'Traffic-heavy':s.roadQuality>=78?'Good-road option':'Balanced',reasons};}).sort((a,b)=>b.score-a.score);}
