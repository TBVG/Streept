export interface Location {
  lat: number;
  lng: number;
}

export interface ParkingLot {
  id: string;
  name: string | null;
  location: Location;
  total_spaces: number;
  occupied_spaces: number;
}

export interface ParkedCar {
  id: string;
  lot_id: string;
  location: Location;
  parked_at: string;
}

export interface TrafficVehicle {
  id: string;
  location: Location;
  way_id: number | null;
  segment_id: string | null;
  lane_index: number | null;
  speed_mps: number | null;
  heading_degrees: number | null;
  observed_at: string;
  confidence: number;
  source: string;
}

export interface Report {
  id: string;
  type: 'cop' | 'hazard' | 'construction' | 'accident' | 'traffic_jam' | 'closed_lane';
  location: Location;
  photo_url: string | null;
  reported_at: string;
  expires_at: string;
  reporter_id: string;
  confirmations: number;
  dismissals: number;
  confidence?: number;
}

export interface Billboard {
  id: string;
  location: Location;
  is_purchased: boolean;
  purchased_by: string | null;
  ad_image_url: string | null;
  ad_target_url: string | null;
  display_start: string | null;
  display_end: string | null;
  click_count: number;
}

export interface SceneCoord { lat: number; lng: number; }
export interface SceneBuilding { geometry: SceneCoord[]; height: number | null; }
export interface SceneRoad { osm_id?: number | null; node_ids?: number[]; geometry: SceneCoord[]; highway: string | null; name: string | null; lanes: number | null; oneway: boolean; surface?: string | null; smoothness?: string | null; lit?: boolean; oneway_reverse?: boolean; maxspeed?: string | null; bridge?: boolean; tunnel?: boolean; turn_lanes?: string[] | null; change_lanes?: string[] | null; destination_lanes?: string[] | null; toll?: boolean; }
export interface ScenePoint { lat: number; lng: number; }
export interface SceneTree { lat: number; lng: number; }
export interface SceneRestriction {
  osm_id: number;
  restriction: string;
  from_way_ids?: number[];
  to_way_ids?: number[];
  via_node_ids?: number[];
  via_way_ids?: number[];
  except?: string | null;
}
export interface SceneContext { buildings: SceneBuilding[]; roads: SceneRoad[]; signals: ScenePoint[]; crossings: ScenePoint[]; stops: ScenePoint[]; trees: SceneTree[]; street_lamps?: ScenePoint[]; restrictions?: SceneRestriction[]; }

export interface RouteOptions {
  routes: Route3DHighlight[];
}

export interface Route3DHighlight {
  /** Provider that produced the geometry. Synthetic geometry is never accepted. */
  provider?: 'osrm';
  segments: RouteSegment[];
  maneuvers: Maneuver[];
  duration_seconds: number | null;
  distance_meters: number | null;
}

export interface RouteSegment {
  coords: RouteCoord[];
  is_highlighted: boolean;
  color: string;
  lane_index: number | null;
}

export interface RouteCoord {
  lat: number;
  lng: number;
  alt: number;
}

export interface LaneInfo {
  laneIndex?: number;
  indications: string[]; // e.g. ["left"], ["through", "right"]
  valid: boolean;
  recommended?: boolean;
  confidence?: number;
  change?: string | null;
  destination?: string | null;
}

export interface Maneuver {
  type: string; // "turn" | "roundabout" | "merge" | "fork" | "end of road" | ...
  modifier: string | null; // "left" | "right" | "sharp left" | "straight" | ...
  location: Location;
  bearing_before: number;
  instruction: string;
  is_complex: boolean;
  lanes?: LaneInfo[];
}

// Real-time events pushed over the /ws WebSocket connection. Mirrors the
// backend's WsEvent enum (models.rs) — kept in sync manually since there's
// no shared schema generation between the Rust and TypeScript sides.
export type WsEvent =
  | { type: 'report_created'; report: Report }
  | { type: 'report_updated'; report: Report }
  | { type: 'report_removed'; id: string; location: Location }
  | { type: 'parking_updated'; parking: ParkingLot }
  | { type: 'parking_car_updated'; car: ParkedCar }
  | { type: 'parking_car_removed'; id: string; lot_id: string; location: Location }
  | { type: 'traffic_vehicle_updated'; vehicle: TrafficVehicle }
  | { type: 'traffic_vehicle_removed'; id: string; location: Location };

export interface GeocodeResult {
  display_name: string;
  location: Location;
  /** Optional OpenStreetMap/Photon classification used for richer POI presentation. */
  category?: string;
  type?: string;
}
