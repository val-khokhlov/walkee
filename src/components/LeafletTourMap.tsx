import React, { useEffect, useMemo, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { LocateFixed } from 'lucide-react';
import type {
  ComputedRoute,
  LatLngLiteral,
  MapProviderId,
  ResearchedBuilding,
} from '../types/tour';
import { buildCorridorPolygon } from '../utils/geo';

interface LeafletTourMapProps {
  provider: Extract<MapProviderId, 'osm' | 'carto' | 'apple'>;
  route: ComputedRoute | null;
  deviationMeters: number;
  buildings: ResearchedBuilding[];
  activeBuildingId: string | null;
  visitedBuildingIds: string[];
  userLocation: LatLngLiteral | null;
  onSelectBuilding?: (buildingId: string) => void;
  onMapClickLocation?: (coords: LatLngLiteral) => void;
  subtitleNotice?: string;
}

const DEFAULT_CENTER: [number, number] = [37.7955, -122.403];

function getTileConfig(provider: Extract<MapProviderId, 'osm' | 'carto' | 'apple'>): {
  url: string;
  attribution: string;
  label: string;
} {
  switch (provider) {
    case 'osm':
      return {
        url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
        attribution: '&copy; OpenStreetMap contributors',
        label: 'OpenStreetMap',
      };
    case 'apple':
      return {
        url: 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',
        attribution: '&copy; OpenStreetMap contributors &copy; CARTO',
        label: 'Apple Fallback · OSM',
      };
    case 'carto':
    default:
      return {
        url: 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png',
        attribution: '&copy; OpenStreetMap contributors &copy; CARTO',
        label: 'Carto Voyager · OSM',
      };
  }
}

export const LeafletTourMap: React.FC<LeafletTourMapProps> = ({
  provider,
  route,
  deviationMeters,
  buildings,
  activeBuildingId,
  visitedBuildingIds,
  userLocation,
  onSelectBuilding,
  onMapClickLocation,
  subtitleNotice,
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const tileLayerRef = useRef<L.TileLayer | null>(null);
  const overlayLayerRef = useRef<L.LayerGroup | null>(null);
  const onSelectRef = useRef(onSelectBuilding);
  const onMapClickRef = useRef(onMapClickLocation);

  onSelectRef.current = onSelectBuilding;
  onMapClickRef.current = onMapClickLocation;

  const visitedSet = useMemo(
    () => new Set(visitedBuildingIds),
    [visitedBuildingIds]
  );

  const activeBuilding = useMemo(
    () => buildings.find((b) => b.id === activeBuildingId) || null,
    [buildings, activeBuildingId]
  );

  const tileConfig = useMemo(() => getTileConfig(provider), [provider]);

  // Initialize Leaflet map instance
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const initialCenter: [number, number] = userLocation
      ? [userLocation.lat, userLocation.lng]
      : route?.origin
      ? [route.origin.lat, route.origin.lng]
      : DEFAULT_CENTER;

    const map = L.map(containerRef.current, {
      center: initialCenter,
      zoom: 15,
      zoomControl: false,
    });

    const overlayGroup = L.layerGroup().addTo(map);
    mapRef.current = map;
    overlayLayerRef.current = overlayGroup;

    map.on('click', (ev: L.LeafletMouseEvent) => {
      onMapClickRef.current?.({ lat: ev.latlng.lat, lng: ev.latlng.lng });
    });

    return () => {
      map.remove();
      mapRef.current = null;
      tileLayerRef.current = null;
      overlayLayerRef.current = null;
    };
  }, []);

  // Swap tile layer whenever provider changes
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    if (tileLayerRef.current) {
      map.removeLayer(tileLayerRef.current);
      tileLayerRef.current = null;
    }

    tileLayerRef.current = L.tileLayer(tileConfig.url, {
      attribution: tileConfig.attribution,
      maxZoom: 19,
    }).addTo(map);
  }, [tileConfig]);

  // Fit bounds when route changes
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !route || route.path.length === 0) return;

    const bounds = L.latLngBounds(
      route.path.map((pt) => [pt.lat, pt.lng] as [number, number])
    );
    map.fitBounds(bounds, { padding: [52, 52] });
  }, [route]);

  // Pan gently when active building changes
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !activeBuilding) return;
    map.panTo([activeBuilding.location.lat, activeBuilding.location.lng]);
  }, [activeBuilding]);

  // Render corridor, route polylines, waypoints, building pins, and walker location
  useEffect(() => {
    const group = overlayLayerRef.current;
    if (!group) return;
    group.clearLayers();

    if (route && route.path.length >= 2) {
      // 1. Corridor polygon
      const corridor = buildCorridorPolygon(route.path, deviationMeters);
      if (corridor.length >= 3) {
        L.polygon(
          corridor.map((c) => [c.lat, c.lng] as [number, number]),
          {
            color: '#0D9488',
            weight: 1.5,
            opacity: 0.45,
            fillColor: '#0D9488',
            fillOpacity: 0.1,
            interactive: false,
          }
        ).addTo(group);
      }

      // 2. Main route polyline
      L.polyline(
        route.path.map((p) => [p.lat, p.lng] as [number, number]),
        {
          color: '#0D9488',
          weight: 6,
          opacity: 0.92,
          interactive: false,
        }
      ).addTo(group);

      // 3. Completed segment up to userLocation
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
          L.polyline(
            route.path
              .slice(0, closestIdx + 1)
              .map((p) => [p.lat, p.lng] as [number, number]),
            {
              color: '#64748B',
              weight: 4,
              dashArray: '6, 8',
              opacity: 0.9,
              interactive: false,
            }
          ).addTo(group);
        }
      }

      // 4. Route Waypoints
      const wps =
        route.waypoints && route.waypoints.length > 0
          ? route.waypoints
          : [
              { label: route.originLabel, location: route.origin },
              { label: route.destinationLabel, location: route.destination },
            ];

      wps.forEach((wp, idx) => {
        const isFirst = idx === 0;
        const isLast = idx === wps.length - 1;
        const dotColor = isFirst
          ? 'bg-[#0D9488]'
          : isLast
          ? 'bg-[#E06D53]'
          : 'bg-[#D97706]';
        const badgeLabel = isFirst ? 'Start' : isLast ? 'Finish' : `Stop ${idx + 1}`;
        const icon = L.divIcon({
          className: '',
          iconSize: [74, 26],
          iconAnchor: [37, 13],
          html: `<div class="px-2.5 py-1 rounded-full bg-[#111c2d] text-white text-[11px] font-bold shadow-md border-2 border-white inline-flex items-center gap-1.5 whitespace-nowrap"><span class="w-2 h-2 rounded-full ${dotColor}"></span>${badgeLabel}</div>`,
        });
        L.marker([wp.location.lat, wp.location.lng], {
          icon,
          zIndexOffset: 400,
          title: `${badgeLabel}: ${wp.label}`,
        }).addTo(group);
      });
    }

    // 5. Building markers
    buildings.forEach((b, idx) => {
      const isActive = b.id === activeBuildingId;
      const isVisited = visitedSet.has(b.id);
      const bgClass = isActive
        ? 'bg-[#0D9488] text-white scale-110 ring-4 ring-[#0D9488]/30'
        : isVisited
        ? 'bg-[#64748B] text-white'
        : 'bg-[#E06D53] text-white';

      const icon = L.divIcon({
        className: '',
        iconSize: [32, 32],
        iconAnchor: [16, 16],
        html: `<button type="button" class="w-8 h-8 rounded-full border-2 border-white shadow-md flex items-center justify-center text-xs font-bold font-mono-timer cursor-pointer ${bgClass}">${idx + 1}</button>`,
      });

      const marker = L.marker([b.location.lat, b.location.lng], {
        icon,
        zIndexOffset: isActive ? 500 : 200,
        title: `${idx + 1}. ${b.displayName || b.streetAddress}`,
      });
      marker.on('click', (ev) => {
        L.DomEvent.stopPropagation(ev);
        onSelectRef.current?.(b.id);
      });
      marker.addTo(group);
    });

    // 6. Live walker beacon
    if (userLocation) {
      const beaconIcon = L.divIcon({
        className: '',
        iconSize: [24, 24],
        iconAnchor: [12, 12],
        html: `<div class="relative flex items-center justify-center w-6 h-6"><span class="absolute w-10 h-10 rounded-full bg-[#0D9488]/25 animate-ping"></span><span class="relative w-5 h-5 rounded-full bg-[#0D9488] border-[3px] border-white shadow-lg"></span></div>`,
      });
      L.marker([userLocation.lat, userLocation.lng], {
        icon: beaconIcon,
        zIndexOffset: 1000,
        interactive: false,
      }).addTo(group);
    }
  }, [route, deviationMeters, buildings, activeBuildingId, visitedSet, userLocation]);

  const handleRecenter = () => {
    const map = mapRef.current;
    if (!map) return;
    if (userLocation) {
      map.setView([userLocation.lat, userLocation.lng], 17);
    } else if (route && route.path.length > 0) {
      const bounds = L.latLngBounds(
        route.path.map((pt) => [pt.lat, pt.lng] as [number, number])
      );
      map.fitBounds(bounds, { padding: [48, 48] });
    }
  };

  return (
    <div className="relative w-full h-full">
      <div ref={containerRef} className="w-full h-full z-0" />

      {/* Provider Badge */}
      <div className="absolute top-3 left-3 z-[400] px-3 py-1.5 rounded-full bg-[#f8fafc]/92 backdrop-blur-md border border-[#1e293b]/10 shadow-xs text-[11px] font-semibold text-[#111c2d]">
        {tileConfig.label}
        {subtitleNotice ? ` · ${subtitleNotice}` : ''}
      </div>

      {/* Floating Re-center Button */}
      <div className="absolute bottom-8 right-4 z-[400] flex flex-col gap-2">
        <button
          type="button"
          onClick={handleRecenter}
          title="Re-center map"
          aria-label="Re-center map"
          className="w-11 h-11 rounded-full bg-[#f8fafc]/95 backdrop-blur-md border border-[#1e293b]/10 shadow-md flex items-center justify-center text-[#111c2d] hover:bg-white transition-colors"
        >
          <LocateFixed className="w-5 h-5 text-[#0D9488]" />
        </button>
      </div>

      {/* Corridor Legend */}
      {route && (
        <div className="hidden sm:flex absolute bottom-8 left-4 z-[400] items-center gap-3 px-3.5 py-2 rounded-full bg-[#f8fafc]/92 backdrop-blur-md border border-[#1e293b]/10 shadow-sm text-xs text-[#111c2d]">
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
