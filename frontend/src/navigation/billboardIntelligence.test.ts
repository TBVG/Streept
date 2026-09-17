import { describe, expect, it } from 'vitest'; import { scoreBillboardRelevance } from './billboardIntelligence';
const b={id:'b',location:{lat:0,lng:0},is_purchased:true,purchased_by:'x',ad_image_url:'x',ad_target_url:null,display_start:null,display_end:null,click_count:0};
describe('billboard intelligence',()=>{it('requires an active purchased creative for attention',()=>{expect(scoreBillboardRelevance(b,{lat:0,lng:0}).active).toBe(true);expect(scoreBillboardRelevance({...b,is_purchased:false},{lat:0,lng:0}).attentionScore).toBe(0);});});
