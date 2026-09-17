import { RouteLaneStrategy } from './routeLaneStrategy';
export interface RouteLaneStability { score:number; oscillationRisk:number; metadataCoverage:number; }
export function assessRouteLaneStability(strategy:RouteLaneStrategy):RouteLaneStability {
 const steps=strategy.steps.filter(s=>s.plannedLaneIndex!=null);
 const reversals=steps.reduce((n,s,i)=>{if(i===0)return n;const a=steps[i-1].plannedLaneIndex!,b=s.plannedLaneIndex!;const c=i>1?steps[i-2].plannedLaneIndex!:a;return n+(Math.sign(b-a)!==0&&Math.sign(a-c)!==0&&Math.sign(b-a)!==Math.sign(a-c)?1:0)},0);
 const metadataCoverage=steps.length/Math.max(1,strategy.steps.length);
 const oscillationRisk=Math.min(1,reversals/Math.max(1,steps.length-1));
 return {score:Math.max(0,Math.min(1,strategy.confidence*(1-oscillationRisk*.5))),oscillationRisk,metadataCoverage};
}
