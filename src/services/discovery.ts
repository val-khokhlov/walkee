import type { DiscoveredBuilding, LatLngLiteral } from '../types/tour';
import { computeCumulativeDistances, pointToPolylineDistance } from '../utils/geo';
import { isHouseNumberAddress, normalizeStreetKey, samplePathEquidistant, simplifyPath } from './address';
import { fetchWithTimeout, isAbortError, sleepMs } from './http';

export interface DiscoveryResult {
  buildings: DiscoveredBuilding[];
  totalScannedCandidates: number;
}

interface OsmElement {
  type?: string;
  id?: number;
  lat?: number;
  lon?: number;
  center?: { lat?: number; lon?: number };
  tags?: Record<string, string>;
}

const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];

/** OSM tags worth handing to the writer model as facts. */
const FACT_KEYS = [
  'name', 'name:en', 'architect', 'start_date', 'building:architecture', 'heritage',
  'description', 'description:en', 'wikipedia', 'wikidata', 'building:levels',
];

async function resolveAreaCity(pt: LatLngLiteral, signal?: AbortSignal): Promise<string> {
  try {
    const u = new URL('https://nominatim.openstreetmap.org/reverse');
    u.searchParams.set('format', 'json');
    u.searchParams.set('zoom', '10');
    u.searchParams.set('addressdetails', '1');
    u.searchParams.set('lat', String(pt.lat));
    u.searchParams.set('lon', String(pt.lng));
    const r = await fetchWithTimeout(u.toString(), { headers: { 'Accept-Language': 'en' }, timeoutMs: 6000, signal });
    if (!r.ok) return '';
    const d = (await r.json()) as { address?: { city?: string; town?: string; village?: string; municipality?: string } };
    const a = d.address || {};
    return a.city || a.town || a.village || a.municipality || '';
  } catch (e) {
    if (isAbortError(e)) throw e;
    return '';
  }
}

async function queryOverpass(query: string, signal?: AbortSignal): Promise<OsmElement[] | null> {
  for (const endpoint of OVERPASS_ENDPOINTS) {
    try {
      const r = await fetchWithTimeout(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
        body: `data=${encodeURIComponent(query)}`,
        timeoutMs: 65_000,
        signal,
      });
      if (!r.ok) continue;
      const j = (await r.json()) as { elements?: OsmElement[]; remark?: string };
      // Overpass reports timeouts and out-of-memory as HTTP 200 with a remark and no elements.
      if (j.remark && /error|timed out|out of memory/i.test(j.remark)) continue;
      return j.elements || [];
    } catch (e) {
      if (isAbortError(e)) throw e;
      /* try the next mirror */
    }
  }
  return null;
}

/** Every street-addressed building within the corridor (no 20-result cap). */
async function scanOverpass(
  routePath: LatLngLiteral[],
  cumulative: number[],
  deviationMeters: number,
  signal?: AbortSignal
): Promise<Array<{ c: DiscoveredBuilding; score: number }>> {
  const radius = Math.round(deviationMeters + 30);
  const coords = simplifyPath(routePath, 200)
    .map((p) => `${p.lat.toFixed(5)},${p.lng.toFixed(5)}`)
    .join(',');
  const query = `[out:json][timeout:60];nwr["addr:housenumber"]["addr:street"](around:${radius},${coords});out center tags qt;`;

  const [areaCity, elements] = await Promise.all([
    resolveAreaCity(routePath[Math.floor(routePath.length / 2)], signal),
    queryOverpass(query, signal),
  ]);
  if (!elements) return [];

  const found = new Map<string, { c: DiscoveredBuilding; score: number }>();
  for (const el of elements) {
    const lat = el.lat ?? el.center?.lat;
    const lng = el.lon ?? el.center?.lon;
    if (lat == null || lng == null) continue;
    const t = el.tags || {};
    const num = (t['addr:housenumber'] || '').trim();
    const street = (t['addr:street:en'] || t['addr:street'] || '').trim();
    if (!num || !street) continue; // only buildings with a real street address

    const loc: LatLngLiteral = { lat, lng };
    const stats = pointToPolylineDistance(loc, routePath, cumulative);
    if (stats.distanceMeters > deviationMeters) continue;

    const name = (t['name:en'] || t.name || '').trim();
    const city = (t['addr:city:en'] || t['addr:city'] || areaCity).trim();
    const streetAddress = `${num} ${street}${city ? `, ${city}` : ''}`;
    const key = normalizeStreetKey(streetAddress);
    if (!key) continue;

    const score = (t.wikidata || t.wikipedia ? 3 : 0) + (t.historic ? 3 : 0) + (t.tourism ? 2 : 0) + (name ? 1 : 0);
    const prev = found.get(key);
    if (prev) {
      if (!prev.c.displayName && name) prev.c.displayName = name;
      if (!prev.c.osmFacts) {
        const facts = FACT_KEYS.filter((k) => t[k]).map((k) => `${k}: ${t[k]}`).join('\n');
        if (facts) prev.c.osmFacts = facts;
      }
      prev.score = Math.max(prev.score, score);
      continue;
    }
    const facts = FACT_KEYS.filter((k) => t[k]).map((k) => `${k}: ${t[k]}`).join('\n');
    found.set(key, {
      score,
      c: {
        id: `bldg-${key}`,
        streetAddress,
        normalizedAddress: key,
        displayName: name || undefined,
        neighborhood: city || undefined,
        location: loc,
        distanceFromRouteMeters: Math.round(stats.distanceMeters),
        routeProgressMeters: Math.round(stats.routeProgressMeters),
        placeId: el.type && el.id ? `osm:${el.type}/${el.id}` : undefined,
        primaryType: t.historic || t.tourism || t.building || undefined,
        osmFacts: facts || undefined,
      },
    });
  }
  return [...found.values()];
}

/** Slow backup used only when Overpass is down: reverse-geocode a few points along the route. */
async function nominatimFallback(
  routePath: LatLngLiteral[],
  cumulative: number[],
  deviationMeters: number,
  signal?: AbortSignal
): Promise<Array<{ c: DiscoveredBuilding; score: number }>> {
  const out = new Map<string, { c: DiscoveredBuilding; score: number }>();
  const nodes = samplePathEquidistant(routePath, 10, 170);
  for (let i = 0; i < nodes.length; i++) {
    if (i > 0) await sleepMs(1100); // Nominatim: at most one request per second
    const node = nodes[i];
    try {
      const u = new URL('https://nominatim.openstreetmap.org/reverse');
      u.searchParams.set('format', 'json');
      u.searchParams.set('addressdetails', '1');
      u.searchParams.set('zoom', '18');
      u.searchParams.set('lat', String(node.lat));
      u.searchParams.set('lon', String(node.lng));
      const r = await fetchWithTimeout(u.toString(), { headers: { 'Accept-Language': 'en' }, timeoutMs: 6000, signal });
      if (!r.ok) continue;
      const d = (await r.json()) as {
        lat?: string; lon?: string; name?: string; osm_type?: string; osm_id?: number;
        address?: { house_number?: string; road?: string; city?: string; town?: string; suburb?: string };
      };
      const num = d.address?.house_number;
      const road = d.address?.road;
      if (!num || !road) continue;
      const loc: LatLngLiteral = { lat: Number(d.lat || node.lat), lng: Number(d.lon || node.lng) };
      const stats = pointToPolylineDistance(loc, routePath, cumulative);
      if (stats.distanceMeters > deviationMeters) continue;
      const city = d.address?.city || d.address?.town || '';
      const streetAddress = `${num} ${road}${city ? `, ${city}` : ''}`;
      const key = normalizeStreetKey(streetAddress);
      if (!key || out.has(key)) continue;
      out.set(key, {
        score: 0,
        c: {
          id: `bldg-${key}`,
          streetAddress,
          normalizedAddress: key,
          displayName: d.name || undefined,
          neighborhood: d.address?.suburb || city || undefined,
          location: loc,
          distanceFromRouteMeters: Math.round(stats.distanceMeters),
          routeProgressMeters: Math.round(stats.routeProgressMeters),
          placeId: d.osm_id ? `osm:${d.osm_type || 'node'}/${d.osm_id}` : undefined,
        },
      });
    } catch (e) {
      if (isAbortError(e)) throw e;
    }
  }
  return [...out.values()];
}

export async function discoverBuildings(
  path: LatLngLiteral[],
  deviationMeters: number,
  opts: { maxBuildings: number; signal?: AbortSignal }
): Promise<DiscoveryResult> {
  if (path.length < 2) throw new Error('A route with at least two points is required.');
  const cumulative = computeCumulativeDistances(path);

  let scored = await scanOverpass(path, cumulative, deviationMeters, opts.signal);
  if (scored.length === 0) scored = await nominatimFallback(path, cumulative, deviationMeters, opts.signal);

  const valid = scored.filter((x) => isHouseNumberAddress(x.c.streetAddress));
  // Keep the likeliest-notable buildings when there are more than the user's cap, then restore walking order.
  const buildings = valid
    .sort((a, b) => b.score - a.score || a.c.routeProgressMeters - b.c.routeProgressMeters)
    .slice(0, Math.max(1, opts.maxBuildings))
    .map((x) => x.c)
    .sort((a, b) => a.routeProgressMeters - b.routeProgressMeters);

  return { buildings, totalScannedCandidates: valid.length };
}
