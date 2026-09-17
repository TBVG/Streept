import { Location, SceneContext } from '../types';

export type SceneAttentionTier = 'critical' | 'guidance' | 'world' | 'ambient';
export interface SceneAttention { location: Location; tier: SceneAttentionTier; score: number; reason: string; }
const d=(a:Location,b:Location)=>{const lat=111320,lng=lat*Math.max(.2,Math.cos(a.lat*Math.PI/180));return Math.hypot((a.lat-b.lat)*lat,(a.lng-b.lng)*lng)};
const score=(distance:number,boost:number)=>Math.max(0,Math.min(1,(1-distance/220)*.65+boost));
/** Creates a camera-local attention budget so navigation-critical geometry wins over ambient detail. */
export function buildSceneAttention(scene:SceneContext|null, center:Location|null, maneuver:Location|null):SceneAttention[] {
 if(!scene||!center)return [];
 const out:SceneAttention[]=[];
 const add=(p:Location,tier:SceneAttentionTier,boost:number,reason:string)=>{const distance=d(center,p); if(distance<=260) out.push({location:p,tier,score:score(distance,boost),reason});};
 for(const p of scene.signals??[]) add(p,'critical',.45,'traffic-signal');
 for(const p of scene.crossings??[]) add(p,'critical',.34,'pedestrian-crossing');
 if(maneuver) add(maneuver,'guidance',.38,'upcoming-maneuver');
 for(const r of scene.roads??[]) { const p=r.geometry[0]; if(p) add(p,'world',(r.bridge || r.tunnel) ? 0.12 : 0,'road-context'); }
 for(const p of scene.trees??[]) add(p,'ambient',-.08,'ambient-world');
 return out.sort((a,b)=>b.score-a.score||a.tier.localeCompare(b.tier));
}
