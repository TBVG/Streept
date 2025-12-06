export interface Location {
  lat: number;
  lng: number;
}

export interface ParkingSpace {
  id: string;
  location: Location;
  is_available: boolean;
  occupied_by: string | null;
  occupied_at: string | null;
  photo_url: string | null;
  pending: boolean;
}

export interface Report {
  id: string;
  type: 'cop' | 'hazard' | 'construction' | 'accident' | 'traffic_jam' | 'closed_lane';
  location: Location;
  photo_url: string | null;
  reported_at: string;
  expires_at: string;
  reporter_id: string;
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
}

export interface Route3DHighlight {
  segments: RouteSegment[];
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

