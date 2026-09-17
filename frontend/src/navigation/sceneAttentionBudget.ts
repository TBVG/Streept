import { SceneAttention, SceneAttentionTier } from './sceneAttention';
export interface SceneAttentionBudget { critical:number; guidance:number; world:number; ambient:number; }
const rank:Record<SceneAttentionTier,number>={critical:4,guidance:3,world:2,ambient:1};
export function allocateSceneAttention(items:SceneAttention[], budget:SceneAttentionBudget={critical:8,guidance:8,world:18,ambient:8}): SceneAttention[] {
 const used:Record<SceneAttentionTier,number>={critical:0,guidance:0,world:0,ambient:0};
 return [...items].sort((a,b)=>b.score-a.score||rank[b.tier]-rank[a.tier]).filter(i=>used[i.tier]++ < budget[i.tier]);
}
