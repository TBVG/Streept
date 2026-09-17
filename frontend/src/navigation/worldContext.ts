import { Billboard, Location, ParkingLot, Report, TrafficVehicle } from '../types';
import { BillboardRelevance, rankBillboards } from './billboardIntelligence';
import { ParkingIntelligence, rankParkingLots } from './parkingIntelligence';
import { SpatialIntelligenceSnapshot } from './spatialIntelligence';
export interface SpatialWorldContext { spatial: SpatialIntelligenceSnapshot; parking: Array<ParkingLot & { intelligence: ParkingIntelligence }>; billboards: BillboardRelevance[]; reportsNearby:number; trafficNearby:number; confidence:number; }
export function buildSpatialWorldContext(spatial:SpatialIntelligenceSnapshot, location:Location|null, parkingLots:ParkingLot[], billboards:Billboard[], reports:Report[], traffic:TrafficVehicle[], routeLocations:Location[]=[], now=Date.now()):SpatialWorldContext {
 const parking=rankParkingLots(parkingLots,location,5,routeLocations), billboard=rankBillboards(billboards,location,routeLocations,now);
 const confidence=Math.min(1,spatial.confidence*.65+(parking.length?0.12:0)+(billboard.length?0.08:0)+(reports.length?0.08:0)+(traffic.length?0.07:0));
 return {spatial,parking,billboards:billboard,reportsNearby:spatial.nearbyReports,trafficNearby:spatial.nearbyTrafficVehicles,confidence};
}
