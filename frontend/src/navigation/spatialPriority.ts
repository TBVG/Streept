import { SpatialWorldContext } from './worldContext';
export type SpatialPriority = 'critical-navigation'|'safety'|'parking'|'world-commerce'|'ambient';
export interface SpatialPriorityItem { priority:SpatialPriority; score:number; reason:string; }
export function deriveSpatialPriorities(context:SpatialWorldContext, maneuverDistanceMeters:number|null): SpatialPriorityItem[] {
 const out:SpatialPriorityItem[]=[];
 if (maneuverDistanceMeters!=null && maneuverDistanceMeters<120) out.push({priority:'critical-navigation',score:1,reason:'upcoming maneuver'});
 if (context.spatial.laneIntelligence.laneAlignment==='misaligned') out.push({priority:'safety',score:.98,reason:'lane misalignment'});
 if (context.spatial.nearbyReports>0) out.push({priority:'safety',score:.9,reason:'nearby road reports'});
 if (context.parking.some(p=>p.intelligence.availableSpaces>0)) out.push({priority:'parking',score:.55,reason:'parking available'});
 if (context.billboards.some(b=>b.active)) out.push({priority:'world-commerce',score:.25,reason:'active spatial billboard'});
 return out.sort((a,b)=>b.score-a.score);
}
