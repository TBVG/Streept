import { describe, expect, it } from 'vitest';
import { assessWorldContextQuality } from './worldContextQuality';
const base:any={spatial:{confidence:0.8},parking:[],billboards:[],reportsNearby:0,trafficNearby:0,confidence:0.8};
describe('worldContextQuality',()=>{it('degrades weak context',()=>expect(assessWorldContextQuality({...base,confidence:.2}).degraded).toBe(true));it('rewards strong evidence',()=>expect(assessWorldContextQuality({...base,parking:[{intelligence:{confidence:.9,availableSpaces:4}}]}).confidence).toBeGreaterThan(.8));});
