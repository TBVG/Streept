import { describe, expect, it } from 'vitest';
import { buildSceneAttention } from './sceneAttention';
describe('scene attention',()=>{it('prioritizes navigation-critical objects',()=>{const s:any={roads:[{geometry:[{lat:0,lng:.001}],bridge:false,tunnel:false}],buildings:[],signals:[{lat:0,lng:.0005}],crossings:[],stops:[],trees:[]};const r=buildSceneAttention(s,{lat:0,lng:0}, {lat:0,lng:.0005}); expect(r[0].tier).toBe('critical');});});
