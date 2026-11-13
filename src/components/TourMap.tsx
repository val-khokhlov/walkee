import React, { useEffect, useMemo, useRef } from 'react';
import {
  AdvancedMarker,
  Map as GoogleMap,
  useMap,
} from '@vis.gl/react-google-maps';
import { LocateFixed, Navigation2, WifiOff } from 'lucide-react';
import type {
  ComputedRoute,
  LatLngLiteral,
  MapProviderId,
  ResearchedBuilding,
} from '../types/tour';
import { buildCorridorPolygon } from '../utils/geo';
import { AppleTourMap } from './AppleTourMap';
import { LeafletTourMap } from './LeafletTourMap';

interface TourMapProps {
  provider?: MapProviderId;
  appleMapsToken?: string;
  route: ComputedRoute | null;
  deviationMeters: number;
  buildings: ResearchedBuilding[];
  activeBuildingId: string | null;
  visitedBuildingIds: string[];
  userLocation: LatLngLiteral | null;
  onSelectBuilding?: (buildingId: string) => void;
  onMapClickLocation?: (coords: LatLngLiteral) => void;
  isOffline?: boolean;
  mapsReady?: boolean;
}

const DEFAULT_CENTER: LatLngLiteral = { lat: 37.7955, lng: -122.403 };

interface MapOverlaysProps {
  route: ComputedRoute | null;
  deviationMeters: number;
  userLocation: LatLngLiteral | null;
  activeBuilding: ResearchedBuilding | null;
}

const MapOverlays: React.FC<MapOverlaysProps> = ({
  route,
  deviationMeters,
  userLocation,
  activeBuilding,
}) => {
  const map = useMap();
  const upcomingPolylineRef = useRef<google.maps.Polyline | null>(null);
  const completedPolylineRef = useRef<google.maps.Polyline | null>(null);
  const corridorPolygonRef = useRef<google.maps.Polygon | null>(null);

  // Fit map bounds whenever a new route loads
  useEffect(() => {
    if (!map || !route || route.path.length === 0) return;
    if (typeof google === 'undefined' || !google.maps) return;

    const bounds = new google.maps.LatLngBounds();
    route.path.forEach((pt) => bounds.extend(pt));
    map.fitBounds(bounds, { top: 64, right: 48, bottom: 64, left: 48 });
  }, [map, route]);

  // Center gently on active building when selected
  useEffect(() => {
    if (!map || !activeBuilding) return;
    map.panTo(activeBuilding.location);
  }, [map, activeBuilding]);

  // Draw route polylines & deviation corridor polygon
  useEffect(() => {
    if (!map || typeof google === 'undefined' || !google.maps) return;

    // Cleanup previous shapes
    upcomingPolylineRef.current?.setMap(null);
    completedPolylineRef.current?.setMap(null);
    corridorPolygonRef.current?.setMap(null);

    if (!route || route.path.length < 2) return;

    // 1. Allowable deviation corridor polygon
    const corridorCoords = buildCorridorPolygon(route.path, deviationMeters);
    if (corridorCoords.length >= 3) {
      corridorPolygonRef.current = new google.maps.Polygon({
        paths: corridorCoords,
        strokeColor: '#0D9488',
        strokeOpacity: 0.45,
        strokeWeight: 1.5,
        fillColor: '#0D9488',
        fillOpacity: 0.1,
        clickable: false,
        map,
      });
    }

    // 2. Upcoming & Completed polylines
    upcomingPolylineRef.current = new google.maps.Polyline({
      path: route.path,
      geodesic: true,
      strokeColor: '#0D9488',
      strokeOpacity: 0.92,
      strokeWeight: 6,
      clickable: false,
      map,
    });

    // Mark completed segment up to user's closest point along path
    if (userLocation && route.path.length > 2) {
      let closestIdx = 0;
      let bestDist = Infinity;
      for (let i = 0; i < route.path.length; i++) {
        const dLat = route.path[i].lat - userLocation.lat;
        const dLng = route.path[i].lng - userLocation.lng;
        const dist = dLat * dLat + dLng * dLng;
        if (dist < bestDist) {
          bestDist = dist;
          closestIdx = i;
        }
      }
      if (closestIdx > 0) {
        completedPolylineRef.current = new google.maps.Polyline({
          path: route.path.slice(0, closestIdx + 1),
          geodesic: true,
          strokeColor: '#94A3B8',
          strokeOpacity: 0,
          icons: [
            {
              icon: {
                path: 'M 0,-1 0,1',
                strokeOpacity: 0.9,
                strokeColor: '#64748B',
                scale: 3,
              },
              offset: '0',
              repeat: '12px',
            },
          ],
          clickable: false,
          map,
        });
      }
    }

    return () => {
      upcomingPolylineRef.current?.setMap(null);
      completedPolylineRef.current?.setMap(null);
      corridorPolygonRef.current?.setMap(null);
    };
  }, [map, route, deviationMeters, userLocation]);

  return null;
};

const RecenterButton: React.FC<{
  target: LatLngLiteral | null;
  route: ComputedRoute | null;
}> = ({ target, route }) => {
  const map = useMap();

  const handleRecenter = () => {
    if (!map) return;
    if (target) {
      map.panTo(target);
      map.setZoom(17);
    } else if (route && route.path.length > 0 && typeof google !== 'undefined') {
      const bounds = new google.maps.LatLngBounds();
      route.path.forEach((p) => bounds.extend(p));
      map.fitBounds(bounds, 48);
    }
  };

  return (
    <button
      type="button"
      onClick={handleRecenter}
      title="Re-center map"
      aria-label="Re-center map"
      className="w-11 h-11 rounded-full bg-[#f8fafc]/95 backdrop-blur-md border border-[#1e293b]/10 shadow-md flex items-center justify-center text-[#111c2d] hover:bg-white transition-colors"
    >
      <LocateFixed className="w-5 h-5 text-[#0D9488]" />
    </button>
  );
};

export const TourMap: React.FC<TourMapProps> = ({
  provider = 'google',
  appleMapsToken = '',
  route,
  deviationMeters,
  buildings,
  activeBuildingId,
  visitedBuildingIds,
  userLocation,
  onSelectBuilding,
  onMapClickLocation,
  isOffline = false,
  mapsReady = true,
}) => {
  const visitedSet = useMemo(
    () => new Set(visitedBuildingIds),
    [visitedBuildingIds]
  );

  const activeBuilding = useMemo(
    () => buildings.find((b) => b.id === activeBuildingId) || null,
    [buildings, activeBuildingId]
  );

  // Offline view takes priority for any provider
  if (isOffline) {
    return (
      <div className="relative w-full h-full bg-[#e7eeff] flex flex-col items-center justify-center p-6 text-center">
        <div className="w-12 h-12 rounded-2xl bg-white/90 border border-[#ddc0ba]/60 flex items-center justify-center mb-3 shadow-sm">
          <WifiOff className="w-6 h-6 text-[#9e3c26]" />
        </div>
        <h3 className="text-base font-bold text-[#111c2d] mb-1">
          Offline Cartographic View
        </h3>
        <p className="text-xs text-[#57423d] max-w-xs leading-relaxed">
          Map tiles require connectivity, but your cached route stops, proximity triggers, and audio narratives remain active.
        </p>
        {buildings.length > 0 && (
          <div className="mt-4 w-full max-w-sm bg-white/90 rounded-2xl p-3 border border-[#ddc0ba]/50 text-left space-y-1.5 max-h-48 overflow-y-auto">
            {buildings.map((b, idx) => {
              const isAct = b.id === activeBuildingId;
              return (
                <button
                  key={b.id}
                  type="button"
                  onClick={() => onSelectBuilding?.(b.id)}
                  className={`w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg text-xs transition-colors ${
                    isAct
                      ? 'bg-[#0D9488]/12 text-[#006a61] font-semibold'
                      : 'hover:bg-[#f0f3ff] text-[#111c2d]'
                  }`}
                >
                  <span className="font-mono-timer w-5 text-right">{idx + 1}.</span>
                  <span className="truncate">{b.streetAddress}</span>
                </button>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  // Free OpenStreetMap / Carto Voyager rendering via Leaflet
  if (provider === 'osm' || provider === 'carto') {
    return (
      <LeafletTourMap
        provider={provider}
        route={route}
        deviationMeters={deviationMeters}
        buildings={buildings}
        activeBuildingId={activeBuildingId}
        visitedBuildingIds={visitedBuildingIds}
        userLocation={userLocation}
        onSelectBuilding={onSelectBuilding}
        onMapClickLocation={onMapClickLocation}
      />
    );
  }

  // Apple Maps (MapKit JS when token configured, or clean Leaflet fallback)
  if (provider === 'apple') {
    return (
      <AppleTourMap
        appleMapsToken={appleMapsToken}
        route={route}
        deviationMeters={deviationMeters}
        buildings={buildings}
        activeBuildingId={activeBuildingId}
        visitedBuildingIds={visitedBuildingIds}
        userLocation={userLocation}
        onSelectBuilding={onSelectBuilding}
        onMapClickLocation={onMapClickLocation}
      />
    );
  }

  // Google Maps fallback if JS API key is missing
  if (!mapsReady) {
    return (
      <div className="relative w-full h-full bg-[#e7eeff] flex flex-col items-center justify-center p-6 text-center">
        <div className="w-12 h-12 rounded-2xl bg-white/90 border border-[#ddc0ba]/60 flex items-center justify-center mb-3 shadow-sm">
          <Navigation2 className="w-6 h-6 text-[#0D9488]" />
        </div>
        <h3 className="text-base font-bold text-[#111c2d] mb-1">
          Initializing Map Canvas
        </h3>
        <p className="text-xs text-[#57423d] max-w-xs leading-relaxed">
          Loading Google Maps Platform vector cartography... (Or switch to OpenStreetMap / Carto in Settings for zero-key maps.)
        </p>
        {buildings.length > 0 && (
          <div className="mt-4 w-full max-w-sm bg-white/90 rounded-2xl p-3 border border-[#ddc0ba]/50 text-left space-y-1.5 max-h-48 overflow-y-auto">
            {buildings.map((b, idx) => {
              const isAct = b.id === activeBuildingId;
              return (
                <button
                  key={b.id}
                  type="button"
                  onClick={() => onSelectBuilding?.(b.id)}
                  className={`w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg text-xs transition-colors ${
                    isAct
                      ? 'bg-[#0D9488]/12 text-[#006a61] font-semibold'
                      : 'hover:bg-[#f0f3ff] text-[#111c2d]'
                  }`}
                >
                  <span className="font-mono-timer w-5 text-right">{idx + 1}.</span>
                  <span className="truncate">{b.streetAddress}</span>
                </button>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  const center = userLocation || route?.origin || DEFAULT_CENTER;

  return (
    <div className="relative w-full h-full">
      <GoogleMap
        mapId="DEMO_MAP_ID"
        defaultCenter={center}
        defaultZoom={15}
        gestureHandling="greedy"
        disableDefaultUI
        internalUsageAttributionIds={['gmp_mcp_codeassist_v1_aistudio']}
        onClick={(ev) => {
          if (ev.detail.latLng && onMapClickLocation) {
            onMapClickLocation({
              lat: ev.detail.latLng.lat,
              lng: ev.detail.latLng.lng,
            });
          }
        }}
        className="w-full h-full"
      >
        <MapOverlays
          route={route}
          deviationMeters={deviationMeters}
          userLocation={userLocation}
          activeBuilding={activeBuilding}
        />

        {/* Route Waypoint Markers (2 or more) */}
        {route?.waypoints && route.waypoints.length > 0 ? (
          route.waypoints.map((wp, idx) => {
            const isFirst = idx === 0;
            const isLast = idx === route.waypoints!.length - 1;
            const dotColor = isFirst
              ? 'bg-[#0D9488]'
              : isLast
              ? 'bg-[#E06D53]'
              : 'bg-[#D97706]';
            const badgeLabel = isFirst
              ? 'Start'
              : isLast
              ? 'Finish'
              : `Stop ${idx + 1}`;
            return (
              <AdvancedMarker
                key={`wp-${idx}`}
                position={wp.location}
                zIndex={40}
                title={`${badgeLabel}: ${wp.label}`}
              >
                <div className="px-2.5 py-1 rounded-full bg-[#111c2d] text-white text-[11px] font-bold shadow-md border-2 border-white flex items-center gap-1.5">
                  <span className={`w-2 h-2 rounded-full ${dotColor}`} />
                  {badgeLabel}
                </div>
              </AdvancedMarker>
            );
          })
        ) : (
          <>
            {route?.origin && (
              <AdvancedMarker
                position={route.origin}
                title={`Start: ${route.originLabel}`}
              >
                <div className="px-2.5 py-1 rounded-full bg-[#111c2d] text-white text-[11px] font-bold shadow-md border-2 border-white flex items-center gap-1">
                  <span className="w-2 h-2 rounded-full bg-[#0D9488]" />
                  Start
                </div>
              </AdvancedMarker>
            )}

            {route?.destination && (
              <AdvancedMarker
                position={route.destination}
                title={`Finish: ${route.destinationLabel}`}
              >
                <div className="px-2.5 py-1 rounded-full bg-[#111c2d] text-white text-[11px] font-bold shadow-md border-2 border-white flex items-center gap-1">
                  <span className="w-2 h-2 rounded-full bg-[#E06D53]" />
                  Finish
                </div>
              </AdvancedMarker>
            )}
          </>
        )}

        {/* Discovered Notable Buildings */}
        {buildings.map((b, idx) => {
          const isActive = b.id === activeBuildingId;
          const isVisited = visitedSet.has(b.id);
          const bgClass = isActive
            ? 'bg-[#0D9488] text-white scale-115 ring-4 ring-[#0D9488]/30'
            : isVisited
            ? 'bg-[#64748B] text-white'
            : 'bg-[#E06D53] text-white';

          return (
            <AdvancedMarker
              key={b.id}
              position={b.location}
              zIndex={isActive ? 50 : 20}
              onClick={() => onSelectBuilding?.(b.id)}
              title={`${idx + 1}. ${b.displayName || b.streetAddress}`}
            >
              <button
                type="button"
                className={`w-8 h-8 rounded-full border-2 border-white shadow-md flex items-center justify-center text-xs font-bold font-mono-timer transition-transform cursor-pointer ${bgClass}`}
              >
                {idx + 1}
              </button>
            </AdvancedMarker>
          );
        })}

        {/* Live GPS / Simulated Walker Location Beacon */}
        {userLocation && (
          <AdvancedMarker position={userLocation} zIndex={100} title="Your location">
            <div className="relative flex items-center justify-center">
              <span className="absolute w-10 h-10 rounded-full bg-[#0D9488]/25 animate-ping" />
              <span className="relative w-5 h-5 rounded-full bg-[#0D9488] border-[3px] border-white shadow-lg" />
            </div>
          </AdvancedMarker>
        )}
      </GoogleMap>

      {/* Map Floating Controls (Elevation 1) */}
      <div className="absolute bottom-4 right-4 z-10 flex flex-col gap-2">
        <RecenterButton target={userLocation} route={route} />
      </div>

      {/* Corridor Legend */}
      {route && (
        <div className="hidden sm:flex absolute bottom-4 left-4 z-10 items-center gap-3 px-3.5 py-2 rounded-full bg-[#f8fafc]/92 backdrop-blur-md border border-[#1e293b]/10 shadow-sm text-xs text-[#111c2d]">
          <span className="flex items-center gap-1.5">
            <span className="w-3 h-1 rounded-full bg-[#0D9488]" />
            Trail
          </span>
          <span className="text-[#8a726c]" aria-hidden="true">
            ·
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded-sm bg-[#0D9488]/20 border border-[#0D9488]/60" />
            <span className="font-mono-timer">±{deviationMeters}m</span> range
          </span>
          {buildings.length > 0 && (
            <>
              <span className="text-[#8a726c]" aria-hidden="true">
                ·
              </span>
              <span className="font-medium">
                {buildings.length} {buildings.length === 1 ? 'stop' : 'stops'}
              </span>
            </>
          )}
        </div>
      )}
    </div>
  );
};
