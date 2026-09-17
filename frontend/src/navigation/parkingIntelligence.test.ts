import { describe, expect, it } from 'vitest';
import { assessParkingLot, rankParkingLots } from './parkingIntelligence';
const lot=(id:string,occ:number)=>({id,name:id,location:{lat:0,lng:0},total_spaces:100,occupied_spaces:occ});
describe('parking intelligence',()=>{it('classifies occupancy conservatively',()=>{expect(assessParkingLot(lot('a',95),null).status).toBe('near-full');expect(assessParkingLot(lot('b',100),null).status).toBe('full');});it('prefers available lots before full lots',()=>{const r=rankParkingLots([lot('full',100),lot('open',20)],{lat:0,lng:0});expect(r[0].id).toBe('open');});});
