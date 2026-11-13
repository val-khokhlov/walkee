import React, { useEffect, useMemo, useRef, useState } from 'react';
import { LocateFixed } from 'lucide-react';
import type {
  ComputedRoute,
  LatLngLiteral,
  ResearchedBuilding,
} from '../types/tour';
import { buildCorridorPolygon } from '../utils/geo';
import { LeafletTourMap } from './LeafletTourMap';

/* eslint-disable @typescript-eslint/no-explicit-any */
declare global {
  interface Window {
    mapkit?: any;
  }
}

interface AppleTourMapProps {
  appleMapsToken: string;
  route: ComputedRoute | null;
  deviationMeters: number;
  buildings: ResearchedBuilding[];
  activeBuildingId: string | null;
  visitedBuildingIds: string[];
  userLocation: LatLngLiteral | null;
  onSelectBuilding?: (buildingId: string) => void;
  onMapClickLocation?: (coords: LatLngLiteral) => void;
}

const DEFAULT_CENTER: LatLngLiteral = { lat: 37.7955, lng: -122.403 };
let mapKitLoadPromise: Promise<void> | null = null;

function loadMapKitScript(): Promise<void> {
  if (typeof window !== 'undefined' && window.mapkit) {
    return Promise.resolve();
  }
  if (!mapKitLoadPromise) {
    mapKitLoadPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'https://cdn.apple-mapkit.com/mk/5.x.x/mapkit.js';
      script.async = true;
      script.crossOrigin = 'anonymous';
      script.onload = () => resolve();
      script.onerror = () => reject(new Error('Failed to load Apple MapKit JS.'));
      document.head.appendChild(script);
    });
  }
  return mapKitLoadPromise;
}

export const AppleTourMap: React.FC<AppleTourMapProps> = ({
  appleMapsToken,
  route,
  deviationMeters,
  buildings,
  activeBuildingId,
  visitedBuildingIds,
  userLocation,
  onSelectBuilding,
  onMapClickLocation,
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<any>(null);
  const [fallbackMode, setFallbackMode] = useState(!appleMapsToken);

  const onSelectRef = useRef(onSelectBuilding);
  const onClickRef = useRef(onMapClickLocation);
  onSelectRef.current = onSelectBuilding;
  onClickRef.current = onMapClickLocation;

  const visitedSet = useMemo(
    () => new Set(visitedBuildingIds),
    [visitedBuildingIds]
  );

  const activeBuilding = useMemo(
    () => buildings.find((b) => b.id === activeBuildingId) || null,
    [buildings, activeBuildingId]
  );

  // Initialize Apple MapKit JS when token is available
  useEffect(() => {
    if (!appleMapsToken) {
      setFallbackMode(true);
      return;
    }

    let cancelled = false;
    loadMapKitScript()
      .then(() => {
        if (cancelled || !containerRef.current || !window.mapkit) return;
        const mk = window.mapkit;
        if (!mk._wanderAudioInited) {
          mk.init({
            authorizationCallback: (done: (token: string) => void) => {
              done(appleMapsToken);
            },
          });
          mk._wanderAudioInited = true;
        }
        const center = userLocation || route?.origin || DEFAULT_CENTER;
        const map = new mk.Map(containerRef.current, {
          center: new mk.Coordinate(center.lat, center.lng),
          showsCompass: mk.FeatureVisibility?.Hidden,
          showsMapTypeControl: false,
        });
        map.addEventListener('single-tap', (ev: any) => {
          if (ev?.pointOnPage && map.convertPointOnPageToCoordinate) {
            const coord = map.convertPointOnPageToCoordinate(ev.pointOnPage);
            if (coord) {
              onClickRef.current?.({ lat: coord.latitude, lng: coord.longitude });
            }
          }
        });
        mapRef.current = map;
        setFallbackMode(false);
      })
      .catch(() => {
        if (!cancelled) setFallbackMode(true);
      });

    return () => {
      cancelled = true;
      if (mapRef.current?.destroy) {
        mapRef.current.destroy();
      }
      mapRef.current = null;
    };
  }, [appleMapsToken]);

  // Fit region to route when route updates
  useEffect(() => {
    const map = mapRef.current;
    const mk = window.mapkit;
    if (!map || !mk || !route || route.path.length === 0) return;

    const lats = route.path.map((p) => p.lat);
    const lngs = route.path.map((p) => p.lng);
    const minLat = Math.min(...lats);
    const maxLat = Math.max(...lats);
    const minLng = Math.min(...lngs);
    const maxLng = Math.max(...lngs);
    const span = new mk.CoordinateSpan(
      Math.max(0.004, (maxLat - minLat) * 1.35),
      Math.max(0.004, (maxLng - minLng) * 1.35)
    );
    const center = new mk.Coordinate((minLat + maxLat) / 2, (minLng + maxLng) / 2);
    map.region = new mk.CoordinateRegion(center, span);
  }, [route]);

  // Center on active building
  useEffect(() => {
    const map = mapRef.current;
    const mk = window.mapkit;
    if (!map || !mk || !activeBuilding) return;
    map.setCenterAnimated(
      new mk.Coordinate(activeBuilding.location.lat, activeBuilding.location.lng),
      true
    );
  }, [activeBuilding]);

  // Render overlays and annotations
  useEffect(() => {
    const map = mapRef.current;
    const mk = window.mapkit;
    if (!map || !mk || fallbackMode) return;

    map.removeOverlays(map.overlays || []);
    map.removeAnnotations(map.annotations || []);

    const overlays: any[] = [];
    const annotations: any[] = [];

    if (route && route.path.length >= 2) {
      const corridor = buildCorridorPolygon(route.path, deviationMeters);
      if (corridor.length >= 3) {
        overlays.push(
          new mk.PolygonOverlay(
            corridor.map((c) => new mk.Coordinate(c.lat, c.lng)),
            {
              style: new mk.Style({
                strokeColor: '#0D9488',
                strokeOpacity: 0.45,
                lineWidth: 1.5,
                fillColor: '#0D9488',
                fillOpacity: 0.1,
              }),
            }
          )
        );
      }

      overlays.push(
        new mk.PolylineOverlay(
          route.path.map((p) => new mk.Coordinate(p.lat, p.lng)),
          {
            style: new mk.Style({
              strokeColor: '#0D9488',
              strokeOpacity: 0.92,
              lineWidth: 6,
            }),
          }
        )
      );

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
        const badgeLabel = isFirst ? 'Start' : isLast ? 'Finish' : `Stop ${idx + 1}`;
        annotations.push(
          new mk.MarkerAnnotation(
            new mk.Coordinate(wp.location.lat, wp.location.lng),
            {
              title: `${badgeLabel}: ${wp.label}`,
              color: isFirst ? '#0D9488' : isLast ? '#E06D53' : '#D97706',
              glyphText: isFirst ? 'A' : isLast ? 'B' : String(idx + 1),
            }
          )
        );
      });
    }

    buildings.forEach((b, idx) => {
      const isActive = b.id === activeBuildingId;
      const isVisited = visitedSet.has(b.id);
      const ann = new mk.MarkerAnnotation(
        new mk.Coordinate(b.location.lat, b.location.lng),
        {
          title: b.displayName || b.streetAddress,
          subtitle: `${b.distanceFromRouteMeters}m off route`,
          color: isActive ? '#0D9488' : isVisited ? '#64748B' : '#E06D53',
          glyphText: String(idx + 1),
        }
      );
      ann.addEventListener('select', () => {
        onSelectRef.current?.(b.id);
      });
      annotations.push(ann);
    });

    if (userLocation) {
      annotations.push(
        new mk.MarkerAnnotation(
          new mk.Coordinate(userLocation.lat, userLocation.lng),
          {
            title: 'Your location',
            color: '#0D9488',
            glyphText: '●',
          }
        )
      );
    }

    if (overlays.length > 0) map.addOverlays(overlays);
    if (annotations.length > 0) map.addAnnotations(annotations);
  }, [route, deviationMeters, buildings, activeBuildingId, visitedSet, userLocation, fallbackMode]);

  if (fallbackMode) {
    return (
      <LeafletTourMap
        provider="apple"
        route={route}
        deviationMeters={deviationMeters}
        buildings={buildings}
        activeBuildingId={activeBuildingId}
        visitedBuildingIds={visitedBuildingIds}
        userLocation={userLocation}
        onSelectBuilding={onSelectBuilding}
        onMapClickLocation={onMapClickLocation}
        subtitleNotice="No token set"
      />
    );
  }

  const handleRecenter = () => {
    const map = mapRef.current;
    const mk = window.mapkit;
    if (!map || !mk) return;
    if (userLocation) {
      map.setCenterAnimated(
        new mk.Coordinate(userLocation.lat, userLocation.lng),
        true
      );
    } else if (route && route.path.length > 0) {
      const lats = route.path.map((p) => p.lat);
      const lngs = route.path.map((p) => p.lng);
      const span = new mk.CoordinateSpan(
        Math.max(0.004, (Math.max(...lats) - Math.min(...lats)) * 1.35),
        Math.max(0.004, (Math.max(...lngs) - Math.min(...lngs)) * 1.35)
      );
      map.region = new mk.CoordinateRegion(
        new mk.Coordinate(
          (Math.min(...lats) + Math.max(...lats)) / 2,
          (Math.min(...lngs) + Math.max(...lngs)) / 2
        ),
        span
      );
    }
  };

  return (
    <div className="relative w-full h-full">
      <div ref={containerRef} className="w-full h-full" />
      <div className="absolute top-3 left-3 z-10 px-3 py-1.5 rounded-full bg-[#f8fafc]/92 backdrop-blur-md border border-[#1e293b]/10 shadow-xs text-[11px] font-semibold text-[#111c2d]">
        Apple Maps (MapKit JS)
      </div>
      <div className="absolute bottom-8 right-4 z-10 flex flex-col gap-2">
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
    </div>
  );
};
