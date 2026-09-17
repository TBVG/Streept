import { Location, ParkingLot } from '../types';

export interface ParkingIntelligence {
  routeProximityScore: number;
  destinationProximityScore: number;
  lotId: string | null;
  availability: number;
  availableSpaces: number;
  occupancyRatio: number;
  distanceMeters: number | null;
  status: 'available' | 'busy' | 'near-full' | 'full' | 'unknown';
  confidence: number;
}

const clamp01 = (v:number) => Math.max(0, Math.min(1, Number.isFinite(v) ? v : 0));
const distanceMeters = (a:Location,b:Location) => {
  const lat=111320, lng=lat*Math.max(0.2,Math.cos(a.lat*Math.PI/180));
  return Math.hypot((a.lat-b.lat)*lat,(a.lng-b.lng)*lng);
};

/** Converts observed lot capacity into a conservative driver-facing state. */
export function assessParkingLot(lot: ParkingLot, location: Location|null, routeLocations: Location[] = []): ParkingIntelligence {
  const total=Math.max(0, lot.total_spaces);
  const occupied=Math.max(0, Math.min(total, lot.occupied_spaces));
  const available=Math.max(0,total-occupied);
  const ratio=total>0?occupied/total:1;
  const status=total<=0?'unknown':available<=0?'full':ratio>=0.9?'near-full':ratio>=0.7?'busy':'available';
  const distance=location?distanceMeters(location,lot.location):null;
  const evidence=total>0?0.7:0;
  const routeProximityScore = routeLocations.length ? clamp01(1 - Math.min(...routeLocations.map(p => distanceMeters(p, lot.location))) / 300) : 0;
  const destination = routeLocations.length ? routeLocations[routeLocations.length - 1] : null;
  const destinationProximityScore = destination ? clamp01(1 - distanceMeters(destination, lot.location) / 500) : 0;
  return { lotId:lot.id, routeProximityScore, destinationProximityScore, availability:available, availableSpaces:available, occupancyRatio:ratio, distanceMeters:distance, status, confidence:clamp01(evidence+(location?0.2:0)) };
}

export function rankParkingLots(lots: ParkingLot[], location: Location|null, maxResults=5, routeLocations: Location[] = []): Array<ParkingLot & { intelligence: ParkingIntelligence }> {
  return lots.map(lot=>({...lot,intelligence:assessParkingLot(lot,location,routeLocations)}))
    .sort((a,b)=>{
      const aAvail=a.intelligence.availableSpaces>0?1:0, bAvail=b.intelligence.availableSpaces>0?1:0;
      if(aAvail!==bAvail) return bAvail-aAvail;
      const aScore=a.intelligence.destinationProximityScore*.55+a.intelligence.routeProximityScore*.25+(a.intelligence.availableSpaces>0?.2:0);
      const bScore=b.intelligence.destinationProximityScore*.55+b.intelligence.routeProximityScore*.25+(b.intelligence.availableSpaces>0?.2:0);
      if (aScore !== bScore) return bScore-aScore;
      const ad=a.intelligence.distanceMeters??Infinity, bd=b.intelligence.distanceMeters??Infinity;
      return ad-bd || b.intelligence.availableSpaces-a.intelligence.availableSpaces;
    }).slice(0,Math.max(1,maxResults));
}
