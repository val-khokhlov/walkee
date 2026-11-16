import type { ComputedRoute, LatLngLiteral, RouteStep } from '../types/tour';
import { fetchWithTimeout, isAbortError } from './http';

export interface WaypointInput {
  label: string;
  coords?: LatLngLiteral;
}

export interface PlaceSuggestion {
  label: string;
  coords?: LatLngLiteral;
}

export function encodePolyline(points: LatLngLiteral[]): string {
  let encoded = '';
  let prevLat = 0;
  let prevLng = 0;
  const encodeSigned = (val: number) => {
    let v = val < 0 ? ~(val << 1) : val << 1;
    let chunk = '';
    while (v >= 0x20) {
      chunk += String.fromCharCode((0x20 | (v & 0x1f)) + 63);
      v >>= 5;
    }
    return chunk + String.fromCharCode(v + 63);
  };
  for (const pt of points) {
    const latE5 = Math.round(pt.lat * 1e5);
    const lngE5 = Math.round(pt.lng * 1e5);
    encoded += encodeSigned(latE5 - prevLat) + encodeSigned(lngE5 - prevLng);
    prevLat = latE5;
    prevLng = lngE5;
  }
  return encoded;
}

// Nominatim allows about one request per second, so remember what we already resolved.
const geocodeCache = new Map<string, LatLngLiteral>();

async function geocodeFree(query: string, signal?: AbortSignal): Promise<LatLngLiteral | null> {
  const cached = geocodeCache.get(query);
  if (cached) return cached;

  try {
    const u = new URL('https://nominatim.openstreetmap.org/search');
    u.searchParams.set('format', 'json');
    u.searchParams.set('limit', '1');
    u.searchParams.set('q', query);
    const r = await fetchWithTimeout(u.toString(), { headers: { 'Accept-Language': 'en' }, timeoutMs: 8000, signal });
    if (r.ok) {
      const items = (await r.json()) as Array<{ lat?: string; lon?: string }>;
      if (items[0]?.lat && items[0]?.lon) {
        const c = { lat: Number(items[0].lat), lng: Number(items[0].lon) };
        geocodeCache.set(query, c);
        return c;
      }
    }
  } catch (e) {
    if (isAbortError(e)) throw e;
  }

  try {
    const u = new URL('https://photon.komoot.io/api/');
    u.searchParams.set('q', query);
    u.searchParams.set('limit', '1');
    const r = await fetchWithTimeout(u.toString(), { timeoutMs: 8000, signal });
    if (r.ok) {
      const d = (await r.json()) as { features?: Array<{ geometry?: { coordinates?: [number, number] } }> };
      const co = d.features?.[0]?.geometry?.coordinates;
      if (co && co.length >= 2) {
        const c = { lat: co[1], lng: co[0] };
        geocodeCache.set(query, c);
        return c;
      }
    }
  } catch (e) {
    if (isAbortError(e)) throw e;
  }
  return null;
}

/** Address suggestions while typing (Photon first, Nominatim as backup). */
export async function autocompletePlaces(q: string, signal?: AbortSignal): Promise<PlaceSuggestion[]> {
  const query = q.trim();
  if (query.length < 3) return [];

  try {
    const u = new URL('https://photon.komoot.io/api/');
    u.searchParams.set('q', query);
    u.searchParams.set('limit', '6');
    const r = await fetchWithTimeout(u.toString(), { timeoutMs: 5000, signal });
    if (r.ok) {
      const data = (await r.json()) as {
        features?: Array<{
          geometry?: { coordinates?: [number, number] };
          properties?: { name?: string; housenumber?: string; street?: string; city?: string; state?: string; country?: string };
        }>;
      };
      const list: PlaceSuggestion[] = [];
      for (const f of data.features || []) {
        const co = f.geometry?.coordinates;
        if (!co || co.length < 2) continue;
        const p = f.properties || {};
        const streetPart = p.housenumber && p.street ? `${p.housenumber} ${p.street}` : p.street || '';
        const parts = [p.name, streetPart, p.city, p.state, p.country].filter(
          (v, idx, arr): v is string => Boolean(v) && arr.indexOf(v) === idx
        );
        list.push({ label: parts.join(', ') || query, coords: { lat: co[1], lng: co[0] } });
      }
      if (list.length > 0) return list;
    }
  } catch (e) {
    if (isAbortError(e)) throw e;
  }

  try {
    const u = new URL('https://nominatim.openstreetmap.org/search');
    u.searchParams.set('format', 'json');
    u.searchParams.set('limit', '6');
    u.searchParams.set('q', query);
    const r = await fetchWithTimeout(u.toString(), { headers: { 'Accept-Language': 'en' }, timeoutMs: 6000, signal });
    if (r.ok) {
      const items = (await r.json()) as Array<{ lat?: string; lon?: string; display_name?: string }>;
      return items
        .filter((it) => it.lat && it.lon && it.display_name)
        .map((it) => ({ label: it.display_name as string, coords: { lat: Number(it.lat), lng: Number(it.lon) } }));
    }
  } catch (e) {
    if (isAbortError(e)) throw e;
  }
  return [];
}

interface OsrmRoute {
  distance?: number;
  duration?: number;
  geometry?: { coordinates?: Array<[number, number]> };
  legs?: Array<{
    steps?: Array<{
      name?: string;
      distance?: number;
      duration?: number;
      maneuver?: { type?: string; modifier?: string; location?: [number, number] };
      geometry?: { coordinates?: Array<[number, number]> };
    }>;
  }>;
}

/** Walking route through two or more waypoints (OSRM foot profile). */
export async function computeFootRoute(waypoints: WaypointInput[], signal?: AbortSignal): Promise<ComputedRoute> {
  if (waypoints.length < 2) throw new Error('At least 2 waypoints are required.');

  const resolved: Array<{ label: string; location: LatLngLiteral }> = [];
  for (const wp of waypoints) {
    if (wp.coords) {
      resolved.push({ label: wp.label, location: wp.coords });
      continue;
    }
    const c = await geocodeFree(wp.label, signal);
    if (!c) throw new Error(`Could not find coordinates for waypoint: "${wp.label}"`);
    resolved.push({ label: wp.label, location: c });
  }

  const coordStr = resolved.map((w) => `${w.location.lng},${w.location.lat}`).join(';');
  const endpoints = [
    `https://routing.openstreetmap.de/routed-foot/route/v1/foot/${coordStr}?overview=full&geometries=geojson&steps=true`,
    `https://router.project-osrm.org/route/v1/foot/${coordStr}?overview=full&geometries=geojson&steps=true`,
  ];

  let route: OsrmRoute | null = null;
  for (const url of endpoints) {
    try {
      const r = await fetchWithTimeout(url, { timeoutMs: 10_000, signal });
      if (!r.ok) continue;
      const data = (await r.json()) as { routes?: OsrmRoute[] };
      if (data.routes?.[0]) {
        route = data.routes[0];
        break;
      }
    } catch (e) {
      if (isAbortError(e)) throw e;
    }
  }
  const coords = route?.geometry?.coordinates;
  if (!route || !coords || coords.length === 0) {
    throw new Error('Could not trace a walking route. Check the waypoints and your connection.');
  }

  const path: LatLngLiteral[] = coords.map(([lng, lat]) => ({ lat, lng }));

  const steps: RouteStep[] = (route.legs || []).flatMap((leg) =>
    (leg.steps || []).map((s) => {
      const mType = s.maneuver?.type || 'continue';
      const mMod = s.maneuver?.modifier ? ` ${s.maneuver.modifier}` : '';
      const street = s.name ? ` onto ${s.name}` : '';
      const instruction =
        mType === 'arrive'
          ? `Arrive at destination${s.name ? ` (${s.name})` : ''}`
          : mType === 'depart'
          ? `Head${mMod || ' straight'}${street}`
          : `${mType.charAt(0).toUpperCase() + mType.slice(1)}${mMod}${street}`;
      const sc = s.geometry?.coordinates || [];
      const first = sc[0];
      const last = sc[sc.length - 1];
      const startPt: LatLngLiteral = first
        ? { lat: first[1], lng: first[0] }
        : s.maneuver?.location
        ? { lat: s.maneuver.location[1], lng: s.maneuver.location[0] }
        : path[0];
      const endPt: LatLngLiteral = last ? { lat: last[1], lng: last[0] } : startPt;
      return {
        instruction,
        maneuver: s.maneuver?.type,
        distanceMeters: Math.round(Number(s.distance) || 0),
        durationSeconds: Math.round(Number(s.duration) || 0),
        startLocation: startPt,
        endLocation: endPt,
      };
    })
  );

  const lats = path.map((p) => p.lat);
  const lngs = path.map((p) => p.lng);

  return {
    originLabel: resolved[0].label,
    destinationLabel: resolved[resolved.length - 1].label,
    origin: resolved[0].location,
    destination: resolved[resolved.length - 1].location,
    waypoints: resolved,
    encodedPolyline: encodePolyline(path),
    path,
    distanceMeters: Math.round(Number(route.distance) || 0),
    durationSeconds: Math.round(Number(route.duration) || 0),
    steps,
    viewport: {
      low: { lat: Math.min(...lats), lng: Math.min(...lngs) },
      high: { lat: Math.max(...lats), lng: Math.max(...lngs) },
    },
  };
}
