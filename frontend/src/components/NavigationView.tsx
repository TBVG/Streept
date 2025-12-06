import React, { useState, useEffect, useRef } from 'react';
import { MapContainer, TileLayer, Polyline, Marker, Popup } from 'react-leaflet';
import * as Cesium from 'cesium';
import 'cesium/Build/Cesium/Widgets/widgets.css';
import './NavigationView.css';
import { getRoute, getParking, getReports, getBillboards } from '../services/api';
import { Location, Route3DHighlight, ParkingSpace, Report, Billboard } from '../types';
import L from 'leaflet';

interface NavigationViewProps {}

const NavigationView: React.FC<NavigationViewProps> = () => {
  const [splitView, setSplitView] = useState(false);
  const [userLocation, setUserLocation] = useState<Location | null>(null);
  const [destination, setDestination] = useState<Location | null>(null);
  const [route, setRoute] = useState<Route3DHighlight | null>(null);
  const [parkingSpaces, setParkingSpaces] = useState<ParkingSpace[]>([]);
  const [reports, setReports] = useState<Report[]>([]);
  const [billboards, setBillboards] = useState<Billboard[]>([]);
  const cesiumViewerRef = useRef<Cesium.Viewer | null>(null);
  const mapRef = useRef<L.Map | null>(null);

  useEffect(() => {
    // Initialize Cesium viewer
    if (!cesiumViewerRef.current) {
      cesiumViewerRef.current = new Cesium.Viewer('cesium-container', {
        terrainProvider: Cesium.createWorldTerrain(),
      });
    }

    // Get user location
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          const loc: Location = {
            lat: position.coords.latitude,
            lng: position.coords.longitude,
          };
          setUserLocation(loc);
        },
        (error) => {
          console.error('Error getting location:', error);
          // Default to San Francisco
          setUserLocation({ lat: 37.7749, lng: -122.4194 });
        }
      );
    }

    return () => {
      if (cesiumViewerRef.current) {
        cesiumViewerRef.current.destroy();
      }
    };
  }, []);

  useEffect(() => {
    if (userLocation) {
      // Load nearby data
      loadNearbyData(userLocation);
    }
  }, [userLocation]);

  useEffect(() => {
    if (userLocation && destination) {
      loadRoute(userLocation, destination);
    }
  }, [userLocation, destination]);

  useEffect(() => {
    if (route && cesiumViewerRef.current) {
      renderRoute3D(route);
    }
  }, [route]);

  const loadNearbyData = async (location: Location) => {
    try {
      const [parking, reportsData, billboardsData] = await Promise.all([
        getParking(location),
        getReports(location),
        getBillboards(location),
      ]);
      setParkingSpaces(parking);
      setReports(reportsData);
      setBillboards(billboardsData);
    } catch (error) {
      console.error('Error loading nearby data:', error);
    }
  };

  const loadRoute = async (from: Location, to: Location) => {
    try {
      const routeData = await getRoute(from, to);
      setRoute(routeData);
      // Check if route has turns/complex junctions to trigger split view
      checkSplitViewTrigger(routeData);
    } catch (error) {
      console.error('Error loading route:', error);
    }
  };

  const checkSplitViewTrigger = (route: Route3DHighlight) => {
    // Simple heuristic: if route has multiple segments, trigger split view
    if (route.segments.length > 1) {
      setSplitView(true);
    }
  };

  const renderRoute3D = (route: Route3DHighlight) => {
    if (!cesiumViewerRef.current) return;

    const viewer = cesiumViewerRef.current;
    viewer.entities.removeAll();

    route.segments.forEach((segment) => {
      if (segment.is_highlighted) {
        const positions = segment.coords.map((coord) => {
          return Cesium.Cartesian3.fromDegrees(coord.lng, coord.lat, coord.alt);
        });

        viewer.entities.add({
          polyline: {
            positions: positions,
            width: 8.0,
            material: Cesium.Color.fromCssColorString(segment.color),
            clampToGround: true,
          },
        });
      }
    });

    // Fly to route start
    if (route.segments.length > 0 && route.segments[0].coords.length > 0) {
      const firstCoord = route.segments[0].coords[0];
      viewer.camera.flyTo({
        destination: Cesium.Cartesian3.fromDegrees(
          firstCoord.lng,
          firstCoord.lat,
          500
        ),
        orientation: {
          heading: Cesium.Math.toRadians(0),
          pitch: Cesium.Math.toRadians(-45),
          roll: 0,
        },
      });
    }
  };

  const handleMapClick = (e: L.LeafletMouseEvent) => {
    const newDest: Location = {
      lat: e.latlng.lat,
      lng: e.latlng.lng,
    };
    setDestination(newDest);
  };

  return (
    <div className={`navigation-view ${splitView ? 'split-view' : ''}`}>
      {/* Left Pane: 2D Map */}
      <div className="map-pane">
        <MapContainer
          center={userLocation ? [userLocation.lat, userLocation.lng] : [37.7749, -122.4194]}
          zoom={13}
          style={{ height: '100%', width: '100%' }}
          whenCreated={(map) => {
            mapRef.current = map;
            map.on('click', handleMapClick);
          }}
        >
          <TileLayer
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          />
          {userLocation && (
            <Marker position={[userLocation.lat, userLocation.lng]}>
              <Popup>Your Location</Popup>
            </Marker>
          )}
          {destination && (
            <Marker position={[destination.lat, destination.lng]}>
              <Popup>Destination</Popup>
            </Marker>
          )}
          {route && route.segments.map((segment, idx) => {
            const positions = segment.coords.map((c) => [c.lat, c.lng] as [number, number]);
            return (
              <Polyline
                key={idx}
                positions={positions}
                color={segment.color}
                weight={6}
              />
            );
          })}
          {parkingSpaces.map((parking) => {
            const loc = parking.location as Location;
            return (
              <Marker
                key={parking.id}
                position={[loc.lat, loc.lng]}
                icon={L.icon({
                  iconUrl: 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjQiIGhlaWdodD0iMjQiIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPHBhdGggZD0iTTEyIDJMMTMuMDkgOC4yNkwyMCA5TDEzLjA5IDE1Ljc0TDEyIDIyTDEwLjkxIDE1Ljc0TDQgOUwxMC45MSA4LjI2TDEyIDJaIiBmaWxsPSIjMDAwMEZGIi8+Cjwvc3ZnPg==',
                  iconSize: [24, 24],
                })}
              >
                <Popup>
                  Parking {parking.is_available ? 'Available' : 'Occupied'}
                </Popup>
              </Marker>
            );
          })}
        </MapContainer>
        <div className="navigation-instructions">
          <h3>Turn-by-Turn</h3>
          {route && (
            <div>
              <p>Follow the highlighted route</p>
            </div>
          )}
        </div>
      </div>

      {/* Right Pane: 3D View (only in split view) */}
      {splitView && (
        <div className="cesium-pane">
          <div id="cesium-container" style={{ width: '100%', height: '100%' }} />
        </div>
      )}
    </div>
  );
};

export default NavigationView;

