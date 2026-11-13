import type { LatLngLiteral } from '../types/tour';

const EARTH_RADIUS_METERS = 6371000;

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

export function haversineMeters(a: LatLngLiteral, b: LatLngLiteral): number {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);

  const sinDLat = Math.sin(dLat / 2);
  const sinDLng = Math.sin(dLng / 2);
  const h =
    sinDLat * sinDLat + Math.cos(lat1) * Math.cos(lat2) * sinDLng * sinDLng;
  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function decodePolyline(encoded: string): LatLngLiteral[] {
  const points: LatLngLiteral[] = [];
  let index = 0;
  let lat = 0;
  let lng = 0;

  while (index < encoded.length) {
    let shift = 0;
    let result = 0;
    let byte = 0;
    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    const dLat = result & 1 ? ~(result >> 1) : result >> 1;
    lat += dLat;

    shift = 0;
    result = 0;
    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    const dLng = result & 1 ? ~(result >> 1) : result >> 1;
    lng += dLng;

    points.push({ lat: lat / 1e5, lng: lng / 1e5 });
  }

  return points;
}

export function computeCumulativeDistances(path: LatLngLiteral[]): number[] {
  const cumulative = [0];
  for (let i = 1; i < path.length; i++) {
    cumulative.push(cumulative[i - 1] + haversineMeters(path[i - 1], path[i]));
  }
  return cumulative;
}

export function pointToSegmentProjection(
  p: LatLngLiteral,
  a: LatLngLiteral,
  b: LatLngLiteral
): { distanceMeters: number; t: number; projected: LatLngLiteral } {
  // Local equirectangular projection for sub-kilometer accuracy
  const meanLatRad = toRad((a.lat + b.lat + p.lat) / 3);
  const cosLat = Math.cos(meanLatRad);
  const mPerDegLat = 111132.92;
  const mPerDegLng = 111319.9 * cosLat;

  const ax = 0;
  const ay = 0;
  const bx = (b.lng - a.lng) * mPerDegLng;
  const by = (b.lat - a.lat) * mPerDegLat;
  const px = (p.lng - a.lng) * mPerDegLng;
  const py = (p.lat - a.lat) * mPerDegLat;

  const abLenSq = bx * bx + by * by;
  let t = 0;
  if (abLenSq > 1e-9) {
    t = Math.max(0, Math.min(1, ((px - ax) * bx + (py - ay) * by) / abLenSq));
  }

  const projX = ax + t * bx;
  const projY = ay + t * by;
  const dx = px - projX;
  const dy = py - projY;

  return {
    distanceMeters: Math.sqrt(dx * dx + dy * dy),
    t,
    projected: {
      lat: a.lat + t * (b.lat - a.lat),
      lng: a.lng + t * (b.lng - a.lng),
    },
  };
}

export function pointToPolylineDistance(
  p: LatLngLiteral,
  path: LatLngLiteral[],
  cumulative?: number[]
): {
  distanceMeters: number;
  routeProgressMeters: number;
  closestSegmentIndex: number;
} {
  if (path.length === 0) {
    return { distanceMeters: Infinity, routeProgressMeters: 0, closestSegmentIndex: 0 };
  }
  if (path.length === 1) {
    return {
      distanceMeters: haversineMeters(p, path[0]),
      routeProgressMeters: 0,
      closestSegmentIndex: 0,
    };
  }

  const cum = cumulative ?? computeCumulativeDistances(path);
  let bestDist = Infinity;
  let bestProgress = 0;
  let bestIdx = 0;

  for (let i = 0; i < path.length - 1; i++) {
    const segLen = cum[i + 1] - cum[i];
    const proj = pointToSegmentProjection(p, path[i], path[i + 1]);
    if (proj.distanceMeters < bestDist) {
      bestDist = proj.distanceMeters;
      bestProgress = cum[i] + proj.t * segLen;
      bestIdx = i;
    }
  }

  return {
    distanceMeters: bestDist,
    routeProgressMeters: bestProgress,
    closestSegmentIndex: bestIdx,
  };
}

export function interpolatePositionAlongPath(
  path: LatLngLiteral[],
  targetMeters: number
): { position: LatLngLiteral; bearing: number; totalMeters: number; splitIndex: number } {
  if (path.length === 0) {
    return { position: { lat: 0, lng: 0 }, bearing: 0, totalMeters: 0, splitIndex: 0 };
  }
  if (path.length === 1) {
    return { position: path[0], bearing: 0, totalMeters: 0, splitIndex: 0 };
  }

  const cum = computeCumulativeDistances(path);
  const totalMeters = cum[cum.length - 1];
  const clamped = Math.max(0, Math.min(totalMeters, targetMeters));

  for (let i = 0; i < path.length - 1; i++) {
    if (clamped <= cum[i + 1] || i === path.length - 2) {
      const segLen = Math.max(0.001, cum[i + 1] - cum[i]);
      const t = Math.max(0, Math.min(1, (clamped - cum[i]) / segLen));
      const a = path[i];
      const b = path[i + 1];
      const position = {
        lat: a.lat + t * (b.lat - a.lat),
        lng: a.lng + t * (b.lng - a.lng),
      };
      const bearing = computeBearing(a, b);
      return { position, bearing, totalMeters, splitIndex: i };
    }
  }

  return {
    position: path[path.length - 1],
    bearing: computeBearing(path[path.length - 2], path[path.length - 1]),
    totalMeters,
    splitIndex: path.length - 2,
  };
}

export function computeBearing(a: LatLngLiteral, b: LatLngLiteral): number {
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const dLng = toRad(b.lng - a.lng);
  const y = Math.sin(dLng) * Math.cos(lat2);
  const x =
    Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

/**
 * Generates an approximate corridor polygon around a walking polyline at `bufferMeters`.
 */
export function buildCorridorPolygon(
  path: LatLngLiteral[],
  bufferMeters: number
): LatLngLiteral[] {
  if (path.length < 2 || bufferMeters <= 0) return [];

  // Downsample path if very dense so polygon stays crisp and fast
  const step = Math.max(1, Math.floor(path.length / 60));
  const sampled: LatLngLiteral[] = [];
  for (let i = 0; i < path.length; i += step) {
    sampled.push(path[i]);
  }
  if (sampled[sampled.length - 1] !== path[path.length - 1]) {
    sampled.push(path[path.length - 1]);
  }

  const leftSide: LatLngLiteral[] = [];
  const rightSide: LatLngLiteral[] = [];

  for (let i = 0; i < sampled.length; i++) {
    const prev = sampled[Math.max(0, i - 1)];
    const next = sampled[Math.min(sampled.length - 1, i + 1)];
    const bearing = computeBearing(prev, next);
    const leftBearing = (bearing - 90 + 360) % 360;
    const rightBearing = (bearing + 90) % 360;

    leftSide.push(offsetByMeters(sampled[i], bufferMeters, leftBearing));
    rightSide.push(offsetByMeters(sampled[i], bufferMeters, rightBearing));
  }

  // Round start & end caps slightly
  const startCap = offsetByMeters(
    sampled[0],
    bufferMeters,
    (computeBearing(sampled[0], sampled[1]) + 180) % 360
  );
  const endCap = offsetByMeters(
    sampled[sampled.length - 1],
    bufferMeters,
    computeBearing(sampled[sampled.length - 2], sampled[sampled.length - 1])
  );

  return [startCap, ...leftSide, endCap, ...rightSide.reverse()];
}

export function offsetByMeters(
  origin: LatLngLiteral,
  distanceMeters: number,
  bearingDeg: number
): LatLngLiteral {
  const latRad = toRad(origin.lat);
  const bearingRad = toRad(bearingDeg);
  const dLat = (distanceMeters * Math.cos(bearingRad)) / 111132.92;
  const dLng =
    (distanceMeters * Math.sin(bearingRad)) / (111319.9 * Math.max(0.1, Math.cos(latRad)));
  return {
    lat: origin.lat + dLat,
    lng: origin.lng + dLng,
  };
}

export function formatMeters(meters: number): string {
  if (!Number.isFinite(meters)) return '—';
  if (meters < 1000) return `${Math.round(meters)} m`;
  return `${(meters / 1000).toFixed(2)} km`;
}

export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '0 min';
  const mins = Math.round(seconds / 60);
  if (mins < 60) return `${mins} min`;
  const hrs = Math.floor(mins / 60);
  const rem = mins % 60;
  return `${hrs}h ${rem}m`;
}
