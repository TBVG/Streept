import { DriverDecision } from './driverDecision';
export function explainDriverDecision(decision: DriverDecision): string {
 switch(decision.action){
  case 'reroute': return 'Route no longer matches the verified road constraints.';
  case 'high-alert': return decision.reason || 'Pay close attention to the road ahead.';
  case 'lane-change': return decision.laneChangeDirection && decision.laneChangeDirection !== 'unknown' ? `Prepare for a ${decision.laneChangeDirection} lane change.` : 'Prepare for the required lane change.';
  case 'slow': return decision.targetSpeedMps!=null ? `Reduce speed toward ${Math.round(decision.targetSpeedMps*3.6)} km/h.` : 'Reduce speed for the road situation ahead.';
  case 'prepare': return decision.reason || 'Prepare for the next maneuver.';
  case 'uncertain': return 'Road position or scene evidence is uncertain.';
  default: return 'Continue on the verified route.';
 }
}
