import { describe, expect, it } from 'vitest';
import { buildSpatialWorldContext } from './worldContext';
describe('world context',()=>{it('keeps amenity layers subordinate to navigation confidence',()=>{const spatial:any={confidence:.2,nearbyReports:1,nearbyTrafficVehicles:1};const r=buildSpatialWorldContext(spatial,{lat:0,lng:0},[{id:'p',name:'P',location:{lat:0,lng:0},total_spaces:10,occupied_spaces:2}],[],[],[]);expect(r.confidence).toBeLessThan(.5);expect(r.parking[0].intelligence.availableSpaces).toBe(8);});});
