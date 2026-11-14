import 'dotenv/config';
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GoogleGenAI, ThinkingLevel } from '@google/genai';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT) || 3000;
const GMP_SOLUTION_ID = 'gmp_mcp_codeassist_v1_aistudio';

interface LatLng {
  lat: number;
  lng: number;
}

interface BuildingCandidate {
  id: string;
  streetAddress: string;
  normalizedAddress: string;
  displayName?: string;
  neighborhood?: string;
  location: LatLng;
  distanceFromRouteMeters: number;
  routeProgressMeters: number;
  placeId?: string;
  googleMapsUri?: string;
  primaryType?: string;
}

type CategoryId =
  | 'historical'
  | 'famous_people'
  | 'architecture'
  | 'cultural'
  | 'folklore';

type MapProviderId = 'google' | 'osm' | 'carto' | 'apple';

function getMapsApiKey(): string {
  return process.env.GOOGLE_MAPS_API_KEY || process.env.VITE_GOOGLE_MAPS_API_KEY || '';
}

function getAppleMapsToken(): string {
  return process.env.APPLE_MAPS_TOKEN || process.env.VITE_APPLE_MAPS_TOKEN || '';
}

function getGenAIClient(): GoogleGenAI {
  return new GoogleGenAI({
    apiKey: process.env.GEMINI_API_KEY,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

/* Claude fragment */
const UA = 'WanderAudioCartographicGuide/1.0';
const RESEARCH_MODEL = process.env.GEMINI_RESEARCH_MODEL || 'gemini-3.5-flash-lite'; // same model your recap route uses
const MAX_CANDIDATES = Number(process.env.MAX_BUILDINGS_PER_ROUTE) || 250;
const sleepMs = (ms: number) => new Promise((r) => setTimeout(r, ms));

function createLimiter(max: number) {
  let active = 0;
  const queue: Array<() => void> = [];
  return async function run<T>(fn: () => Promise<T>): Promise<T> {
    if (active >= max) await new Promise<void>((r) => queue.push(r));
    else active++;
    try {
      return await fn();
    } finally {
      const next = queue.shift();
      if (next) next(); // hand the slot over
      else active--;
    }
  };
}

async function withRetry<T>(fn: () => Promise<T>, tries = 3): Promise<T> {
  for (let i = 0; ; i++) {
    try {
      return await fn();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const retryable = /429|RESOURCE_EXHAUSTED|503|UNAVAILABLE|overloaded/i.test(msg);
      if (!retryable || i >= tries - 1) throw e;
      await sleepMs(1500 * 2 ** i + Math.random() * 500);
    }
  }
}

function simplifyPath(path: LatLng[], maxPts: number): LatLng[] {
  if (path.length <= maxPts) return path;
  const step = (path.length - 1) / (maxPts - 1);
  return Array.from({ length: maxPts }, (_, i) => path[Math.round(i * step)]);
}

async function resolveAreaCity(pt: LatLng): Promise<string> {
  try {
    const u = new URL('https://nominatim.openstreetmap.org/reverse');
    u.searchParams.set('format', 'json');
    u.searchParams.set('zoom', '10');
    u.searchParams.set('addressdetails', '1');
    u.searchParams.set('lat', String(pt.lat));
    u.searchParams.set('lon', String(pt.lng));
    const r = await fetch(u.toString(), {
      headers: { 'User-Agent': UA, 'Accept-Language': 'en' },
      signal: AbortSignal.timeout(6000),
    });
    if (!r.ok) return '';
    const d = (await r.json()) as {
      address?: { city?: string; town?: string; village?: string; municipality?: string };
    };
    const a = d.address || {};
    return a.city || a.town || a.village || a.municipality || '';
  } catch {
    return '';
  }
}

/** Exhaustive address + landmark scan along the route polyline (no 20-result cap). */
async function scanOverpass(
  routePath: LatLng[],
  cumulative: number[],
  deviationMeters: number
): Promise<BuildingCandidate[]> {
  const radius = Math.round(deviationMeters + 30);
  const coords = simplifyPath(routePath, 200)
    .map((p) => `${p.lat.toFixed(5)},${p.lng.toFixed(5)}`)
    .join(',');
  const around = `(around:${radius},${coords})`;
  const query = `[out:json][timeout:60];(
nwr["addr:housenumber"]["addr:street"]${around};
nwr["historic"]["name"]${around};
nwr["tourism"~"museum|attraction|gallery|artwork"]["name"]${around};
nwr["building"]["wikidata"]${around};
nwr["building"]["wikipedia"]${around};
);out center tags qt;`;

  const areaCity = await resolveAreaCity(routePath[Math.floor(routePath.length / 2)]);

  type El = {
    type?: string; id?: number; lat?: number; lon?: number;
    center?: { lat?: number; lon?: number };
    tags?: Record<string, string>;
  };
  let elements: El[] | null = null;
  for (const endpoint of [
    'https://overpass-api.de/api/interpreter',
    'https://overpass.private.coffee/api/interpreter',
  ]) {
    try {
      const r = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json',
          'User-Agent': UA,
        },
        body: `data=${encodeURIComponent(query)}`,
        signal: AbortSignal.timeout(65000),
      });
      if (!r.ok) continue;
      elements = ((await r.json()) as { elements?: El[] }).elements || [];
      break;
    } catch {
      /* try next mirror */
    }
  }
  if (!elements) { console.warn('Overpass failed on all mirrors'); return []; }

  const found = new Map<string, { c: BuildingCandidate; score: number }>();
  for (const el of elements) {
    const lat = el.lat ?? el.center?.lat;
    const lng = el.lon ?? el.center?.lon;
    if (lat == null || lng == null) continue;
    const t = el.tags || {};
    const num = (t['addr:housenumber'] || '').trim();
    const street = (t['addr:street:en'] || t['addr:street'] || '').trim();
    const name = (t['name:en'] || t.name || '').trim();
    const hasAddress = Boolean(num && street);
    if (!hasAddress && !name) continue;
    if (!hasAddress && !(t.historic || t.tourism || t.building)) continue;

    const loc: LatLng = { lat, lng };
    const stats = pointToPolylineStats(loc, routePath, cumulative);
    if (stats.distanceMeters > deviationMeters) continue;

    const city = (t['addr:city:en'] || t['addr:city'] || areaCity).trim();
    const base = hasAddress ? `${num} ${street}` : name;
    const streetAddress = `${base}${city ? `, ${city}` : ''}`;
    const key = normalizeStreetKey(streetAddress);
    if (!key) continue;

    const score =
      (t.wikidata || t.wikipedia ? 3 : 0) + (t.historic ? 3 : 0) + (t.tourism ? 2 : 0) + (name ? 1 : 0);
    const prev = found.get(key);
    if (prev) {
      if (!prev.c.displayName && name) prev.c.displayName = name;
      prev.score = Math.max(prev.score, score);
      continue;
    }
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
      },
    });
  }

  // Cost guard: keep the likeliest-notable buildings if there are too many, then restore walking order
  return [...found.values()]
    .sort((a, b) => b.score - a.score || a.c.routeProgressMeters - b.c.routeProgressMeters)
    .slice(0, MAX_CANDIDATES)
    .map((x) => x.c)
    .sort((a, b) => a.routeProgressMeters - b.routeProgressMeters);
}
/* Claude fragment end */
/* Claude fragment2 start */
const researchLimiter = createLimiter(Number(process.env.GEMINI_CONCURRENCY) || 8);
const researchCache = new Map<string, { expiresAt: number; finding: Record<string, unknown> }>();

function cleanForSpeech(s: string): string {
  return s
    .replace(/\*\*?|__|`/g, '')
    .replace(/^#+\s*/gm, '')
    .replace(/^\s*[-•*]\s+/gm, '')
    .replace(/\[\d+(?:,\s*\d+)*\]/g, '')
    .replace(/https?:\/\/\S+/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

async function researchGrounded(
  catId: CategoryId,
  building: BuildingCandidate,
  buildingLabel: string,
  googleSearchUrl: string
): Promise<Record<string, unknown>> {
  const cacheKey = `${building.normalizedAddress}|${catId}`;
  const hit = researchCache.get(cacheKey);
  if (hit && hit.expiresAt > Date.now()) return hit.finding;

  const { query, guidance } = buildCategoryPrompt(catId, buildingLabel);
  const prompt = `You are the researcher for a walking-tour audio guide.
Location: ${buildingLabel}${building.neighborhood ? `, ${building.neighborhood}` : ''} (lat ${building.location.lat.toFixed(5)}, lng ${building.location.lng.toFixed(5)}).

Use Google Search to answer this question:
"${query}"

Rules:
- ${guidance}
- Use only facts found in search results about this exact address or building. Never invent names, dates or events. If the building is ordinary or you cannot verify the connection, answer NOTABLE: NO.
- Write flowing narrative prose for text-to-speech: no markdown, bullets, headings, citations or URLs.

Respond in exactly this format:
NOTABLE: YES or NO
HEADLINE: <one line, max 12 words>
NARRATIVE:
<the narrative, or one sentence explaining why it is not notable>`;

  const ai = getGenAIClient();
  const response = await withRetry(() =>
    researchLimiter(() =>
      ai.models.generateContent({
        model: RESEARCH_MODEL,
        contents: prompt,
        config: { tools: [{ googleSearch: {} }], temperature: 0.3 },
      })
    )
  );

  const raw = (response.text || '').replace(/\r/g, '').trim();
  const yes = /NOTABLE:\s*YES/i.test(raw);
  const headline = (raw.match(/HEADLINE:\s*(.+)/i)?.[1] || '').trim();
  const narrative = cleanForSpeech(raw.split(/NARRATIVE:\s*/i)[1] || '');
  const wordCount = narrative.split(/\s+/).filter(Boolean).length;
  const isNotable = yes && wordCount >= 80;

  const chunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks || [];
  const seen = new Set<string>();
  const sources = chunks
    .map((c) => ({ title: c.web?.title || c.web?.uri || '', uri: c.web?.uri || '' }))
    .filter((s) => s.uri && !seen.has(s.uri) && seen.add(s.uri))
    .slice(0, 6);

  const finding = {
    categoryId: catId,
    queryUsed: query,
    isNotable,
    headline: isNotable ? headline || building.displayName || building.streetAddress : 'No notable match found',
    summary: narrative || 'No verifiable information was found for this building.',
    wordCount: isNotable ? wordCount : 0,
    sources: isNotable ? sources : [],
    googleSearchUrl,
    searchProvider: 'Gemini + Google Search grounding',
  };
  researchCache.set(cacheKey, { expiresAt: Date.now() + 24 * 3600 * 1000, finding }); // caches negatives too
  return finding;
}
/* Claude fragment2 end */
/* Claude fragment3 */
async function researchBuildingGrounded(
  cats: Array<{ catId: CategoryId; query: string; googleSearchUrl: string }>,
  building: BuildingCandidate,
  buildingLabel: string
): Promise<Record<string, unknown>[]> {
  const todo = cats.filter((c) => {
    const hit = researchCache.get(`${building.normalizedAddress}|${c.catId}`);
    return !(hit && hit.expiresAt > Date.now());
  });
  const cached = cats
    .map((c) => researchCache.get(`${building.normalizedAddress}|${c.catId}`))
    .filter((h): h is NonNullable<typeof h> => Boolean(h && h.expiresAt > Date.now()))
    .map((h) => h.finding);
  if (todo.length === 0) return cached;

  const sections = todo
    .map((c) => `=== CATEGORY: ${c.catId} ===\nQuestion: "${c.query}"\nGuidance: ${buildCategoryPrompt(c.catId, buildingLabel).guidance}`)
    .join('\n\n');

  const prompt = `You are the researcher for a walking-tour audio guide.
Location: ${buildingLabel}${building.neighborhood ? `, ${building.neighborhood}` : ''} (lat ${building.location.lat.toFixed(5)}, lng ${building.location.lng.toFixed(5)}).

Use Google Search. Answer each category below separately.
Rules:
- Use only facts found in search results about this exact address or building. Never invent names, dates or events. If the building is ordinary or the connection can't be verified, answer NOTABLE: NO for that category.
- Narratives must be flowing prose for text-to-speech: no markdown, bullets, headings, citations or URLs.

${sections}

Respond for EVERY category in exactly this format:
=== CATEGORY: <id> ===
NOTABLE: YES or NO
HEADLINE: <one line, max 12 words>
NARRATIVE:
<narrative, or one sentence explaining why not notable>`;

  const ai = getGenAIClient();
  const response = await withRetry(
    () => researchLimiter(() => ai.models.generateContent({
      model: RESEARCH_MODEL,
      contents: prompt,
      config: { tools: [{ googleSearch: {} }], temperature: 0.3, maxOutputTokens: 8192 },
    })),
    5
  );

  const raw = (response.text || '').replace(/\r/g, '');
  const chunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks || [];
  const seen = new Set<string>();
  const sources = chunks
    .map((c) => ({ title: c.web?.title || c.web?.uri || '', uri: c.web?.uri || '' }))
    .filter((s) => s.uri && !seen.has(s.uri) && seen.add(s.uri))
    .slice(0, 6);

  const out: Record<string, unknown>[] = [...cached];
  for (const c of todo) {
    const m = raw.match(new RegExp(`=== CATEGORY:\\s*${c.catId}\\s*===([\\s\\S]*?)(?==== CATEGORY:|$)`, 'i'));
    const block = m?.[1] || '';
    const yes = /NOTABLE:\s*YES/i.test(block);
    const headline = (block.match(/HEADLINE:\s*(.+)/i)?.[1] || '').trim();
    const narrative = cleanForSpeech(block.split(/NARRATIVE:\s*/i)[1] || '');
    const wordCount = narrative.split(/\s+/).filter(Boolean).length;
    const isNotable = yes && wordCount >= 80;
    const finding = {
      categoryId: c.catId,
      queryUsed: c.query,
      isNotable,
      headline: isNotable ? headline || building.displayName || building.streetAddress : 'No notable match found',
      summary: narrative || 'No verifiable information was found for this building.',
      wordCount: isNotable ? wordCount : 0,
      sources: isNotable ? sources : [],
      googleSearchUrl: c.googleSearchUrl,
      searchProvider: 'Gemini + Google Search grounding',
    };
    if (block) researchCache.set(`${building.normalizedAddress}|${c.catId}`, { expiresAt: Date.now() + 24 * 3600 * 1000, finding });
    out.push(finding);
  }
  return out;
}
/* Claude fragment3 end */

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

function haversineMeters(a: LatLng, b: LatLng): number {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const sinDLat = Math.sin(dLat / 2);
  const sinDLng = Math.sin(dLng / 2);
  const h = sinDLat * sinDLat + Math.cos(lat1) * Math.cos(lat2) * sinDLng * sinDLng;
  return 2 * 6371000 * Math.asin(Math.min(1, Math.sqrt(h)));
}

function decodePolyline(encoded: string): LatLng[] {
  const points: LatLng[] = [];
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
    lat += result & 1 ? ~(result >> 1) : result >> 1;

    shift = 0;
    result = 0;
    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    lng += result & 1 ? ~(result >> 1) : result >> 1;

    points.push({ lat: lat / 1e5, lng: lng / 1e5 });
  }
  return points;
}

function pointToPolylineStats(
  p: LatLng,
  path: LatLng[],
  cumulative: number[]
): { distanceMeters: number; routeProgressMeters: number } {
  if (path.length === 0) return { distanceMeters: Infinity, routeProgressMeters: 0 };
  if (path.length === 1) {
    return { distanceMeters: haversineMeters(p, path[0]), routeProgressMeters: 0 };
  }

  let bestDist = Infinity;
  let bestProgress = 0;

  for (let i = 0; i < path.length - 1; i++) {
    const a = path[i];
    const b = path[i + 1];
    const meanLatRad = toRad((a.lat + b.lat + p.lat) / 3);
    const mPerDegLat = 111132.92;
    const mPerDegLng = 111319.9 * Math.cos(meanLatRad);

    const bx = (b.lng - a.lng) * mPerDegLng;
    const by = (b.lat - a.lat) * mPerDegLat;
    const px = (p.lng - a.lng) * mPerDegLng;
    const py = (p.lat - a.lat) * mPerDegLat;

    const abLenSq = bx * bx + by * by;
    const t = abLenSq > 1e-9 ? Math.max(0, Math.min(1, (px * bx + py * by) / abLenSq)) : 0;

    const dx = px - t * bx;
    const dy = py - t * by;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < bestDist) {
      bestDist = dist;
      const segLen = cumulative[i + 1] - cumulative[i];
      bestProgress = cumulative[i] + t * segLen;
    }
  }

  return { distanceMeters: bestDist, routeProgressMeters: bestProgress };
}

function samplePathEquidistant(
  path: LatLng[],
  maxSamples: number,
  stepMeters = 60
): LatLng[] {
  if (path.length <= 2) return path;
  const cum: number[] = [0];
  for (let i = 1; i < path.length; i++) {
    cum.push(cum[i - 1] + haversineMeters(path[i - 1], path[i]));
  }
  const total = cum[cum.length - 1];
  if (total < 10) return [path[0], path[path.length - 1]];

  const count = Math.max(3, Math.min(maxSamples, Math.ceil(total / stepMeters) + 1));
  const samples: LatLng[] = [];

  for (let s = 0; s < count; s++) {
    const target = (total * s) / (count - 1);
    for (let i = 0; i < path.length - 1; i++) {
      if (target <= cum[i + 1] || i === path.length - 2) {
        const segLen = Math.max(0.001, cum[i + 1] - cum[i]);
        const t = Math.max(0, Math.min(1, (target - cum[i]) / segLen));
        samples.push({
          lat: path[i].lat + t * (path[i + 1].lat - path[i].lat),
          lng: path[i].lng + t * (path[i + 1].lng - path[i].lng),
        });
        break;
      }
    }
  }
  return samples;
}

function transliterateHouseSuffix(input: string): string {
  const map: Record<string, string> = {
    а: 'a',
    б: 'b',
    в: 'v',
    г: 'g',
    д: 'd',
    е: 'e',
    к: 'k',
    м: 'm',
  };
  return input.replace(/(\d[\d/-]*\s?)([абвгдекм])(?=$|[\s,])/g, (_, num, ch) => {
    return `${num}${map[ch] || ch}`;
  });
}

function normalizeStreetKey(address: string): string {
  const parts = address
    .split(',')
    .map((p) =>
      transliterateHouseSuffix(p.trim().toLowerCase())
        .replace(/(?:^|\s)(будинок|буд\.?|bldg\.?|house)(?=$|\s)/gi, ' ')
        .trim()
    )
    .filter(Boolean);
  let targetSegment = parts[0] || '';
  if (
    parts.length >= 2 &&
    /^\d[\d/-]*(?:\s?[a-zа-я]{1,2})?$/i.test(targetSegment)
  ) {
    targetSegment = `${targetSegment} ${parts[1]}`;
  }

  let streetTypeSuffix = '';
  const extractType = (pattern: RegExp, canonical: string) => {
    if (pattern.test(targetSegment)) {
      if (!streetTypeSuffix) streetTypeSuffix = canonical;
      targetSegment = targetSegment.replace(pattern, ' ');
    }
  };

  targetSegment = targetSegment
    .replace(/тараса\s+шевченка/gi, 'tarasa shevchenka')
    .replace(/шевченка/gi, 'shevchenka')
    .replace(/богдана\s+хмельницького/gi, 'bohdana khmelnytskoho')
    .replace(/володимирська/gi, 'volodymyrska')
    .replace(/саксаганського/gi, 'saksahanskoho')
    .replace(/симона\s+петлюри/gi, 'symona petlyury')
    .replace(/shevchenko/gi, 'shevchenka');

  extractType(/(?:^|\s)(street|st\.?|вулиця|вул\.?)(?=$|\s)/gi, 'st');
  extractType(/(?:^|\s)(avenue|ave\.?|проспект|просп\.?)(?=$|\s)/gi, 'ave');
  extractType(/(?:^|\s)(boulevard|blvd\.?|bulvar|бульвар|б-р)(?=$|\s)/gi, 'blvd');
  extractType(/(?:^|\s)(square|sq\.?|площа|пл\.?)(?=$|\s)/gi, 'sq');
  extractType(/(?:^|\s)(road|rd\.?)(?=$|\s)/gi, 'rd');
  extractType(/(?:^|\s)(drive|dr\.?)(?=$|\s)/gi, 'dr');
  extractType(/(?:^|\s)(lane|ln\.?)(?=$|\s)/gi, 'ln');

  return `${targetSegment}${streetTypeSuffix}`.replace(/[^a-z0-9\u0400-\u04ff]/g, '');
}

function extractAddressParts(
  addressComponents: Array<{
    longText?: string;
    shortText?: string;
    long_name?: string;
    short_name?: string;
    types?: string[];
  }> = [],
  fallbackFormatted = ''
): { streetAddress: string; neighborhood?: string } {
  let streetNumber = '';
  let route = '';
  let locality = '';
  let neighborhood = '';

  for (const comp of addressComponents) {
    const types = comp.types || [];
    const longVal = comp.longText || comp.long_name || '';
    if (types.includes('street_number')) streetNumber = longVal;
    if (types.includes('route')) route = longVal;
    if (types.includes('neighborhood') || types.includes('sublocality_level_1')) {
      neighborhood = neighborhood || longVal;
    }
    if (types.includes('locality') || types.includes('postal_town')) {
      locality = locality || longVal;
    }
  }

  // Clean prefix noise like "будинок 4" -> "4"
  if (streetNumber) {
    streetNumber = streetNumber
      .replace(/^(будинок|буд\.?|bldg\.?|house)\s+/i, '')
      .trim();
  }

  if (streetNumber && route) {
    const cityPart = locality ? `, ${locality}` : '';
    return {
      streetAddress: `${streetNumber} ${route}${cityPart}`,
      neighborhood: neighborhood || locality || undefined,
    };
  }

  const parts = fallbackFormatted
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean);
  const houseNumberPattern = /^\d[\d/-]*(?:\s?[a-zA-Zа-яА-Я]{1,2})?$/;
  const pickCity = (candidate?: string) => {
    if (candidate && !/^\d{4,6}$/.test(candidate)) return candidate;
    return locality || '';
  };

  // Handle "48A, Tarasa Shevchenko Blvd, Kyiv" and "26 a, Tarasa Shevchenko Blvd, Kyiv"
  if (parts.length >= 2 && houseNumberPattern.test(parts[0])) {
    const city = pickCity(parts[2]);
    return {
      streetAddress: `${parts[0]} ${parts[1]}${city ? `, ${city}` : ''}`,
      neighborhood: neighborhood || city || undefined,
    };
  }
  // Handle European formatted addresses like "Tarasa Shevchenka Blvd, 50-52, Kyiv, Ukraine"
  if (parts.length >= 2 && houseNumberPattern.test(parts[1])) {
    const city = pickCity(parts[2]);
    return {
      streetAddress: `${parts[1]} ${parts[0]}${city ? `, ${city}` : ''}`,
      neighborhood: neighborhood || city || undefined,
    };
  }
  if (parts.length >= 2) {
    return {
      streetAddress: `${parts[0]}, ${parts[1]}`,
      neighborhood: neighborhood || parts[1],
    };
  }
  return {
    streetAddress: fallbackFormatted,
    neighborhood: neighborhood || undefined,
  };
}

function buildCategoryPrompt(
  categoryId: CategoryId,
  buildingLabel: string
): { query: string; guidance: string } {
  switch (categoryId) {
    case 'historical':
      return {
        query: `Is the building ${buildingLabel} an important historical site, and if so provide me in 800-1000 words a summary of its history`,
        guidance: 'Target 800-1000 words if notable. Cover founding era, historical milestones, transformations, and civic importance.',
      };
    case 'famous_people':
      return {
        query: `Is the building ${buildingLabel} related to famous people, and if so provide me in 600-800 words a summary on the person and how the person is related to that building`,
        guidance: 'Target 600-800 words if notable. Identify the person(s), their life/achievements, and their concrete connection to this exact address.',
      };
    case 'architecture':
      return {
        query: `Is the building ${buildingLabel} of notable architectural interest, if so please provide in 600-800 words details on its style and school, key architectural elements, who and when constructed it, maybe some interesting facts`,
        guidance: 'Target 600-800 words if notable. Detail architectural style/school, facade/structural elements, architect, construction year, and interesting facts.',
      };
    case 'cultural':
      return {
        query: `Is the building ${buildingLabel} significant in literature, cinema, music, or local culture, and if so provide me in 600-800 words a summary of its cultural heritage and notable stories`,
        guidance: 'Target 600-800 words if notable. Detail books, films, music, artistic movements, or cultural gatherings tied to this building.',
      };
    case 'folklore':
      return {
        query: `Are there notable local legends, hidden mysteries, or dramatic events connected to the building ${buildingLabel}, and if so provide me in 500-700 words an engaging narrative`,
        guidance: 'Target 500-700 words if notable. Share verified dramatic episodes, scandals, mysteries, or enduring local lore.',
      };
  }
}

function isQuotaErrorPayload(status: number, data: Record<string, unknown>): boolean {
  if (status === 429) return true;
  const errObj = data?.error as Record<string, unknown> | undefined;
  const errStatus = String(errObj?.status || '');
  const errMsg = String(errObj?.message || '');
  return (
    errStatus === 'RESOURCE_EXHAUSTED' ||
    errStatus === 'OVER_QUERY_LIMIT' ||
    errMsg.toLowerCase().includes('quota')
  );
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '2mb' }));

  // Client Maps config (reads server env so keys work even without VITE_ prefix)
  app.get('/api/maps/client-config', (_req, res) => {
    const mapsApiKey = getMapsApiKey();
    const appleMapsToken = getAppleMapsToken();
    res.json({
      mapsApiKey,
      appleMapsToken,
      providers: {
        google: Boolean(mapsApiKey),
        osm: true,
        carto: true,
        apple: Boolean(appleMapsToken),
      },
    });
  });

  // Helper: encode path to Google polyline format for shared client consumption
  function encodePolyline(points: LatLng[]): string {
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
      chunk += String.fromCharCode(v + 63);
      return chunk;
    };
    for (const pt of points) {
      const latE5 = Math.round(pt.lat * 1e5);
      const lngE5 = Math.round(pt.lng * 1e5);
      encoded += encodeSigned(latE5 - prevLat);
      encoded += encodeSigned(lngE5 - prevLng);
      prevLat = latE5;
      prevLng = lngE5;
    }
    return encoded;
  }

  // Helper: geocode free-text address using Nominatim with Photon fallback
  async function geocodeFreeWaypoint(query: string): Promise<{ coords: LatLng; label: string } | null> {
    try {
      const nUrl = new URL('https://nominatim.openstreetmap.org/search');
      nUrl.searchParams.set('format', 'json');
      nUrl.searchParams.set('addressdetails', '1');
      nUrl.searchParams.set('limit', '1');
      nUrl.searchParams.set('q', query);
      const nRes = await fetch(nUrl.toString(), {
        headers: {
          'User-Agent': 'WanderAudioCartographicGuide/1.0',
          'Accept-Language': 'en',
        },
        signal: AbortSignal.timeout(8000),
      });
      if (nRes.ok) {
        const items = (await nRes.json()) as Array<{
          lat?: string;
          lon?: string;
          display_name?: string;
        }>;
        if (items[0]?.lat && items[0]?.lon) {
          return {
            coords: { lat: Number(items[0].lat), lng: Number(items[0].lon) },
            label: query,
          };
        }
      }
    } catch {
      // Fallback to Photon
    }

    try {
      const pUrl = new URL('https://photon.komoot.io/api/');
      pUrl.searchParams.set('q', query);
      pUrl.searchParams.set('limit', '1');
      pUrl.searchParams.set('lang', 'en');
      const pRes = await fetch(pUrl.toString(), {
        headers: { 'User-Agent': 'WanderAudioCartographicGuide/1.0' },
        signal: AbortSignal.timeout(8000),
      });
      if (pRes.ok) {
        const pData = (await pRes.json()) as {
          features?: Array<{ geometry?: { coordinates?: [number, number] } }>;
        };
        const coords = pData.features?.[0]?.geometry?.coordinates;
        if (coords && coords.length >= 2) {
          return { coords: { lat: coords[1], lng: coords[0] }, label: query };
        }
      }
    } catch {
      // Ignore
    }
    return null;
  }

  // Free Autocomplete Proxy (Photon + Nominatim) for OpenStreetMap / Carto / Apple-fallback
  app.get('/api/maps/autocomplete', async (req, res) => {
    const q = String(req.query.q || '').trim();
    if (q.length < 3) {
      res.json({ suggestions: [] });
      return;
    }

    try {
      const pUrl = new URL('https://photon.komoot.io/api/');
      pUrl.searchParams.set('q', q);
      pUrl.searchParams.set('limit', '6');
      pUrl.searchParams.set('lang', 'en');
      const pRes = await fetch(pUrl.toString(), {
        headers: { 'User-Agent': 'WanderAudioCartographicGuide/1.0' },
        signal: AbortSignal.timeout(5000),
      });
      if (pRes.ok) {
        const data = (await pRes.json()) as {
          features?: Array<{
            geometry?: { coordinates?: [number, number] };
            properties?: {
              name?: string;
              housenumber?: string;
              street?: string;
              city?: string;
              state?: string;
              country?: string;
            };
          }>;
        };
        const suggestions = (data.features || [])
          .filter((f) => f.geometry?.coordinates && f.geometry.coordinates.length >= 2)
          .map((f) => {
            const p = f.properties || {};
            const streetPart =
              p.housenumber && p.street
                ? `${p.housenumber} ${p.street}`
                : p.street || '';
            const parts = [p.name, streetPart, p.city, p.state, p.country].filter(
              (v, idx, arr) => Boolean(v) && arr.indexOf(v) === idx
            );
            return {
              label: parts.join(', ') || q,
              coords: {
                lat: f.geometry!.coordinates![1],
                lng: f.geometry!.coordinates![0],
              },
            };
          });
        if (suggestions.length > 0) {
          res.json({ suggestions });
          return;
        }
      }
    } catch {
      // Fall through to Nominatim
    }

    try {
      const nUrl = new URL('https://nominatim.openstreetmap.org/search');
      nUrl.searchParams.set('format', 'json');
      nUrl.searchParams.set('addressdetails', '1');
      nUrl.searchParams.set('limit', '6');
      nUrl.searchParams.set('q', q);
      const nRes = await fetch(nUrl.toString(), {
        headers: {
          'User-Agent': 'WanderAudioCartographicGuide/1.0',
          'Accept-Language': 'en',
        },
        signal: AbortSignal.timeout(6000),
      });
      if (nRes.ok) {
        const items = (await nRes.json()) as Array<{
          lat?: string;
          lon?: string;
          display_name?: string;
        }>;
        const suggestions = items
          .filter((it) => it.lat && it.lon && it.display_name)
          .map((it) => ({
            label: it.display_name!,
            coords: { lat: Number(it.lat), lng: Number(it.lon) },
          }));
        res.json({ suggestions });
        return;
      }
    } catch {
      // Ignore
    }

    res.json({ suggestions: [] });
  });

  // Helper: compute pedestrian walking route via free OSRM foot routing
  async function computeOsrmFootRoute(
    normalizedWaypoints: Array<{ label: string; value: string | LatLng }>
  ) {
    const resolved: Array<{ label: string; location: LatLng }> = [];
    for (const wp of normalizedWaypoints) {
      if (typeof wp.value !== 'string') {
        resolved.push({ label: wp.label, location: wp.value });
      } else {
        const geo = await geocodeFreeWaypoint(wp.value);
        if (!geo) {
          throw new Error(`Could not find coordinates for waypoint: "${wp.label}"`);
        }
        resolved.push({ label: wp.label, location: geo.coords });
      }
    }

    const coordStr = resolved
      .map((w) => `${w.location.lng},${w.location.lat}`)
      .join(';');

    const osrmEndpoints = [
      `https://routing.openstreetmap.de/routed-foot/route/v1/foot/${coordStr}?overview=full&geometries=geojson&steps=true`,
      `https://router.project-osrm.org/route/v1/foot/${coordStr}?overview=full&geometries=geojson&steps=true`,
    ];

    interface OsrmRouteShape {
      distance?: number;
      duration?: number;
      geometry?: { coordinates?: Array<[number, number]> };
      legs?: Array<{
        steps?: Array<{
          name?: string;
          distance?: number;
          duration?: number;
          maneuver?: {
            type?: string;
            modifier?: string;
            location?: [number, number];
          };
          geometry?: { coordinates?: Array<[number, number]> };
        }>;
      }>;
    }

    let osrmRoute: OsrmRouteShape | null = null;

    for (const url of osrmEndpoints) {
      try {
        const r = await fetch(url, {
          headers: { 'User-Agent': 'WanderAudioCartographicGuide/1.0' },
          signal: AbortSignal.timeout(10000),
        });
        if (r.ok) {
          const data = (await r.json()) as { routes?: OsrmRouteShape[] };
          if (data.routes?.[0]) {
            osrmRoute = data.routes[0];
            break;
          }
        }
      } catch {
        // Try next OSRM mirror
      }
    }

    if (!osrmRoute?.geometry?.coordinates?.length) {
      throw new Error('Could not trace a pedestrian walking route via OpenStreetMap OSRM.');
    }

    const path: LatLng[] = osrmRoute.geometry.coordinates.map(([lng, lat]) => ({
      lat,
      lng,
    }));

    const steps = (osrmRoute.legs || []).flatMap((leg) =>
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
        const coords = s.geometry?.coordinates || [];
        const startPt = coords[0]
          ? { lat: coords[0][1], lng: coords[0][0] }
          : s.maneuver?.location
          ? { lat: s.maneuver.location[1], lng: s.maneuver.location[0] }
          : path[0];
        const endPt = coords[coords.length - 1]
          ? { lat: coords[coords.length - 1][1], lng: coords[coords.length - 1][0] }
          : startPt;
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
      distanceMeters: Math.round(Number(osrmRoute.distance) || 0),
      durationSeconds: Math.round(Number(osrmRoute.duration) || 0),
      steps,
      viewport: {
        low: { lat: Math.min(...lats), lng: Math.min(...lngs) },
        high: { lat: Math.max(...lats), lng: Math.max(...lngs) },
      },
    };
  }

  // Compute Pedestrian Route supporting Google Maps, OpenStreetMap/Carto (OSRM), and Apple Maps
  app.post('/api/maps/compute-route', async (req, res) => {
    try {
      const body = req.body as {
        waypoints?: Array<{ label?: string; coords?: LatLng } | string | LatLng>;
        origin?: string | LatLng;
        destination?: string | LatLng;
        provider?: MapProviderId;
      };
      const provider: MapProviderId = body.provider || 'google';

      let normalizedWaypoints: Array<{ label: string; value: string | LatLng }> = [];

      if (Array.isArray(body.waypoints) && body.waypoints.length >= 2) {
        normalizedWaypoints = body.waypoints.map((wp) => {
          if (typeof wp === 'string') return { label: wp, value: wp };
          if ('lat' in wp && 'lng' in wp) {
            return {
              label: `${wp.lat.toFixed(5)}, ${wp.lng.toFixed(5)}`,
              value: wp,
            };
          }
          const label = wp.label || '';
          return {
            label:
              label ||
              (wp.coords
                ? `${wp.coords.lat.toFixed(5)}, ${wp.coords.lng.toFixed(5)}`
                : ''),
            value: wp.coords || label,
          };
        });
      } else if (body.origin && body.destination) {
        const toItem = (wp: string | LatLng) =>
          typeof wp === 'string'
            ? { label: wp, value: wp }
            : { label: `${wp.lat.toFixed(5)}, ${wp.lng.toFixed(5)}`, value: wp };
        normalizedWaypoints = [toItem(body.origin), toItem(body.destination)];
      }

      if (normalizedWaypoints.length < 2) {
        res.status(400).json({ error: 'At least 2 waypoints are required.' });
        return;
      }

      // Free OpenStreetMap / Carto / Apple-fallback routing via Nominatim + OSRM
      if (provider !== 'google') {
        const routeResult = await computeOsrmFootRoute(normalizedWaypoints);
        res.json(routeResult);
        return;
      }

      const mapsKey = getMapsApiKey();
      if (!mapsKey) {
        res.status(500).json({
          error:
            'Google Maps API key is not configured. Switch Map Provider to OpenStreetMap or Carto Voyager in Settings for free routing.',
        });
        return;
      }

      const formatWaypoint = (wp: string | LatLng) =>
        typeof wp === 'string'
          ? { address: wp }
          : { location: { latLng: { latitude: wp.lat, longitude: wp.lng } } };

      const originWp = normalizedWaypoints[0];
      const destWp = normalizedWaypoints[normalizedWaypoints.length - 1];
      const intermediateWps = normalizedWaypoints.slice(1, -1);

      const routePayload: Record<string, unknown> = {
        origin: formatWaypoint(originWp.value),
        destination: formatWaypoint(destWp.value),
        travelMode: 'WALK',
        polylineQuality: 'HIGH_QUALITY',
        computeAlternativeRoutes: false,
        languageCode: 'en-US',
        units: 'METRIC',
      };

      if (intermediateWps.length > 0) {
        routePayload.intermediates = intermediateWps.map((wp) =>
          formatWaypoint(wp.value)
        );
      }

      const response = await fetch(
        'https://routes.googleapis.com/directions/v2:computeRoutes',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Goog-Api-Key': mapsKey,
            'X-Goog-FieldMask':
              'routes.duration,routes.distanceMeters,routes.polyline.encodedPolyline,routes.viewport,routes.legs.startLocation,routes.legs.endLocation,routes.legs.steps.navigationInstruction,routes.legs.steps.distanceMeters,routes.legs.steps.staticDuration,routes.legs.steps.startLocation,routes.legs.steps.endLocation',
            'X-Goog-Maps-Solution-ID': GMP_SOLUTION_ID,
          },
          body: JSON.stringify(routePayload),
        }
      );

      const data = (await response.json()) as Record<string, unknown>;
      if (!response.ok) {
        if (isQuotaErrorPayload(response.status, data)) {
          res.status(429).json({
            error: 'Google Maps Platform quota reached.',
            quotaExceeded: true,
          });
          return;
        }
        res.status(response.status).json({
          error:
            (data?.error as { message?: string })?.message ||
            'Failed to compute walking route.',
        });
        return;
      }

      const routes = (data.routes as Array<Record<string, unknown>>) || [];
      const primary = routes[0];
      if (!primary) {
        res.status(404).json({ error: 'No walking route found between those locations.' });
        return;
      }

      const encodedPolyline =
        (primary.polyline as { encodedPolyline?: string })?.encodedPolyline || '';
      const path = encodedPolyline ? decodePolyline(encodedPolyline) : [];

      const legs = (primary.legs as Array<Record<string, unknown>>) || [];
      const rawSteps = legs.flatMap(
        (leg) => (leg.steps as Array<Record<string, unknown>>) || []
      );

      const steps = rawSteps.map((s) => {
        const nav = (s.navigationInstruction as { instructions?: string; maneuver?: string }) || {};
        const startLoc = (s.startLocation as { latLng?: { latitude: number; longitude: number } })
          ?.latLng;
        const endLoc = (s.endLocation as { latLng?: { latitude: number; longitude: number } })
          ?.latLng;
        const durStr = String(s.staticDuration || '0s');
        const durationSeconds = Number(durStr.replace('s', '')) || 0;
        return {
          instruction: nav.instructions || 'Continue along path',
          maneuver: nav.maneuver,
          distanceMeters: Number(s.distanceMeters) || 0,
          durationSeconds,
          startLocation: startLoc
            ? { lat: startLoc.latitude, lng: startLoc.longitude }
            : path[0] || { lat: 0, lng: 0 },
          endLocation: endLoc
            ? { lat: endLoc.latitude, lng: endLoc.longitude }
            : path[path.length - 1] || { lat: 0, lng: 0 },
        };
      });

      const resolvedWaypoints: Array<{ label: string; location: LatLng }> = [];
      legs.forEach((leg, idx) => {
        const legStart = (
          leg.startLocation as { latLng?: { latitude: number; longitude: number } }
        )?.latLng;
        if (legStart) {
          resolvedWaypoints.push({
            label: normalizedWaypoints[idx]?.label || `Waypoint ${idx + 1}`,
            location: { lat: legStart.latitude, lng: legStart.longitude },
          });
        }
      });
      const lastLeg = legs[legs.length - 1] || {};
      const lastEnd = (
        lastLeg.endLocation as { latLng?: { latitude: number; longitude: number } }
      )?.latLng;
      if (lastEnd) {
        resolvedWaypoints.push({
          label: destWp.label,
          location: { lat: lastEnd.latitude, lng: lastEnd.longitude },
        });
      }

      const startPoint = resolvedWaypoints[0]?.location || path[0];
      const endPoint =
        resolvedWaypoints[resolvedWaypoints.length - 1]?.location ||
        path[path.length - 1];

      const rawViewport = primary.viewport as
        | {
            low?: { latitude: number; longitude: number };
            high?: { latitude: number; longitude: number };
          }
        | undefined;

      const totalDurationStr = String(primary.duration || '0s');
      const durationSeconds = Number(totalDurationStr.replace('s', '')) || 0;

      res.json({
        originLabel: originWp.label,
        destinationLabel: destWp.label,
        origin: startPoint,
        destination: endPoint,
        waypoints: resolvedWaypoints,
        encodedPolyline,
        path,
        distanceMeters: Number(primary.distanceMeters) || 0,
        durationSeconds,
        steps,
        viewport:
          rawViewport?.low && rawViewport?.high
            ? {
                low: { lat: rawViewport.low.latitude, lng: rawViewport.low.longitude },
                high: { lat: rawViewport.high.latitude, lng: rawViewport.high.longitude },
              }
            : undefined,
      });
    } catch (err) {
      console.error('compute-route error:', err);
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Internal routing error.',
      });
    }
  });

  const discoveryResultCache = new Map<
    string,
    { expiresAt: number; payload: { buildings: BuildingCandidate[]; totalScannedCandidates: number; quotaTriggered: boolean } }
  >();

  // Discover all buildings by street address along and inside deviationMeters corridor
  app.post('/api/maps/discover-buildings', async (req, res) => {
    try {
      const {
        path: routePath,
        deviationMeters = 250,
        provider = 'google',
      } = req.body as {
        path: LatLng[];
        deviationMeters: number;
        provider?: MapProviderId;
      };

      if (!Array.isArray(routePath) || routePath.length < 2) {
        res.status(400).json({ error: 'Valid route path coordinates are required.' });
        return;
      }

      const firstPt = routePath[0];
      const lastPt = routePath[routePath.length - 1];
      const midPt = routePath[Math.floor(routePath.length / 2)];
      const cacheKey = `v2|${provider}|${firstPt.lat.toFixed(4)},${firstPt.lng.toFixed(4)}|${midPt.lat.toFixed(4)},${midPt.lng.toFixed(4)}|${lastPt.lat.toFixed(4)},${lastPt.lng.toFixed(4)}|${routePath.length}|${deviationMeters}`;
      const cachedEntry = discoveryResultCache.get(cacheKey);
      if (cachedEntry && cachedEntry.expiresAt > Date.now()) {
        res.json(cachedEntry.payload);
        return;
      }

      const cumulative: number[] = [0];
      for (let i = 1; i < routePath.length; i++) {
        cumulative.push(cumulative[i - 1] + haversineMeters(routePath[i - 1], routePath[i]));
      }

      // Free OpenStreetMap / Carto / Apple-fallback street-address building scan (Overpass + Nominatim fallback)
      if (provider !== 'google') {
        const candidateMap = new Map<string, BuildingCandidate>();
        for (const c of await scanOverpass(routePath, cumulative, deviationMeters)) {
          candidateMap.set(c.normalizedAddress, c);
        }

        // Fallback to Nominatim reverse sampling if Overpass timed out or failed
        if (candidateMap.size === 0) {
          const nomNodes = samplePathEquidistant(routePath, 10, 170);
          for (let i = 0; i < nomNodes.length; i++) {
            if (i > 0) await new Promise((r) => setTimeout(r, 260));
            const node = nomNodes[i];
            try {
              const nUrl = new URL('https://nominatim.openstreetmap.org/reverse');
              nUrl.searchParams.set('format', 'json');
              nUrl.searchParams.set('addressdetails', '1');
              nUrl.searchParams.set('zoom', '18');
              nUrl.searchParams.set('lat', String(node.lat));
              nUrl.searchParams.set('lon', String(node.lng));
              const r = await fetch(nUrl.toString(), {
                headers: {
                  'User-Agent': 'WanderAudioCartographicGuide/1.0',
                  'Accept-Language': 'en',
                },
                signal: AbortSignal.timeout(6000),
              });
              if (!r.ok) continue;
              const d = (await r.json()) as {
                lat?: string;
                lon?: string;
                name?: string;
                osm_type?: string;
                osm_id?: number;
                address?: {
                  house_number?: string;
                  road?: string;
                  city?: string;
                  town?: string;
                  suburb?: string;
                };
              };
              const num = d.address?.house_number;
              const road = d.address?.road;
              if (!num || !road) continue;
              const coords: LatLng = {
                lat: Number(d.lat || node.lat),
                lng: Number(d.lon || node.lng),
              };
              const stats = pointToPolylineStats(coords, routePath, cumulative);
              if (stats.distanceMeters > deviationMeters) continue;

              const city = d.address?.city || d.address?.town || '';
              const streetAddress = `${num} ${road}${city ? `, ${city}` : ''}`;
              const normKey = normalizeStreetKey(streetAddress);
              if (normKey && !candidateMap.has(normKey)) {
                candidateMap.set(normKey, {
                  id: `bldg-${normKey}`,
                  streetAddress,
                  normalizedAddress: normKey,
                  displayName: d.name || undefined,
                  neighborhood: d.address?.suburb || city || undefined,
                  location: coords,
                  distanceFromRouteMeters: Math.round(stats.distanceMeters),
                  routeProgressMeters: Math.round(stats.routeProgressMeters),
                  placeId: d.osm_id ? `osm:${d.osm_type || 'node'}/${d.osm_id}` : undefined,
                });
              }
            } catch {
              // Ignore failed reverse node
            }
          }
        }

        const sorted = Array.from(candidateMap.values()).sort(
          (a, b) => a.routeProgressMeters - b.routeProgressMeters
        );
        const payload = {
          buildings: sorted,
          totalScannedCandidates: sorted.length,
          quotaTriggered: false,
        };
        if (sorted.length > 0) {
          discoveryResultCache.set(cacheKey, {
            expiresAt: Date.now() + 10 * 60 * 1000,
            payload,
          });
        }
        res.json(payload);
        return;
      }

      const mapsKey = getMapsApiKey();
      if (!mapsKey) {
        res.status(500).json({
          error:
            'Google Maps API key is not configured. Switch Map Provider to OpenStreetMap or Carto Voyager in Settings.',
        });
        return;
      }

      // Overlapping sampling scaled to corridor width so narrow walks have zero blind gaps
      // while avoiding redundant API bursts
      const nearbyStepMeters = Math.max(125, Math.min(300, Math.round(deviationMeters * 0.65 + 95)));
      const nearbyMaxSamples = deviationMeters <= 100 ? 14 : deviationMeters <= 300 ? 12 : 9;
      const sampleNodes = samplePathEquidistant(routePath, nearbyMaxSamples, nearbyStepMeters);
      const searchRadius = Math.min(Math.max(deviationMeters + 50, 130), 1500);
      const candidateMap = new Map<string, BuildingCandidate>();
      let quotaTriggered = false;
      const discoveryStats = {
        nearbyRequests: 0,
        nearbyOk: 0,
        nearby429: 0,
        nearbyAdded: 0,
        geoRequests: 0,
        geoOk: 0,
        geo429: 0,
        geoAdded: 0,
        lastQuotaMessage: '',
      };

      const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

      const runNearbyBatch = async (
        nodes: LatLng[],
        rankPreference: 'DISTANCE' | 'POPULARITY',
        radius: number
      ) => {
        const BATCH = 2;
        let consecutiveQuotaFails = 0;
        for (let i = 0; i < nodes.length; i += BATCH) {
          if (consecutiveQuotaFails >= 3) break;
          if (i > 0) await sleep(240);
          const slice = nodes.slice(i, i + BATCH);
          await Promise.all(
            slice.map(async (node) => {
              discoveryStats.nearbyRequests += 1;
              const callNearby = async () =>
                fetch('https://places.googleapis.com/v1/places:searchNearby', {
                  method: 'POST',
                  headers: {
                    'Content-Type': 'application/json',
                    'X-Goog-Api-Key': mapsKey,
                    'X-Goog-FieldMask':
                      'places.id,places.displayName,places.formattedAddress,places.shortFormattedAddress,places.addressComponents,places.location,places.primaryType,places.primaryTypeDisplayName,places.googleMapsUri',
                    'X-Goog-Maps-Solution-ID': GMP_SOLUTION_ID,
                  },
                  body: JSON.stringify({
                    maxResultCount: 20,
                    rankPreference,
                    languageCode: 'en',
                    locationRestriction: {
                      circle: {
                        center: { latitude: node.lat, longitude: node.lng },
                        radius,
                      },
                    },
                  }),
                });

              try {
                let response = await callNearby();
                if (response.status === 429) {
                  discoveryStats.nearby429 += 1;
                  if (consecutiveQuotaFails < 2) {
                    await sleep(900);
                    response = await callNearby();
                  }
                }

                const data = (await response.json()) as Record<string, unknown>;
                if (!response.ok) {
                  if (isQuotaErrorPayload(response.status, data)) {
                    quotaTriggered = true;
                    consecutiveQuotaFails += 1;
                    discoveryStats.lastQuotaMessage = String(
                      (data?.error as { message?: string })?.message || response.status
                    );
                  }
                  return;
                }
                consecutiveQuotaFails = 0;
                discoveryStats.nearbyOk += 1;

                const places = (data.places as Array<Record<string, unknown>>) || [];
                for (const p of places) {
                  const loc = p.location as { latitude?: number; longitude?: number } | undefined;
                  if (!loc?.latitude || !loc?.longitude) continue;

                  const coords: LatLng = { lat: loc.latitude, lng: loc.longitude };
                  const stats = pointToPolylineStats(coords, routePath, cumulative);
                  if (stats.distanceMeters > deviationMeters) continue;

                  const formatted = String(
                    p.formattedAddress || p.shortFormattedAddress || ''
                  );
                  const { streetAddress, neighborhood } = extractAddressParts(
                    (p.addressComponents as Array<{
                      longText?: string;
                      shortText?: string;
                      types?: string[];
                    }>) || [],
                    formatted
                  );

                  const primaryTypeRaw = String(p.primaryType || '');
                  if (
                    primaryTypeRaw === 'route' ||
                    primaryTypeRaw === 'locality' ||
                    primaryTypeRaw === 'sublocality' ||
                    primaryTypeRaw === 'neighborhood' ||
                    primaryTypeRaw === 'political'
                  ) {
                    continue;
                  }

                  if (!streetAddress) continue;
                  const hasStreetNumber = /\b\d+[a-zA-Zа-яА-Я/-]*\b/.test(
                    streetAddress.split(',')[0] || streetAddress
                  );
                  const displayName = (p.displayName as { text?: string })?.text;
                  if (!hasStreetNumber && !displayName) continue;

                  const normKey = normalizeStreetKey(streetAddress);
                  if (!normKey) continue;

                  const existing = candidateMap.get(normKey);
                  const primaryType = (
                    p.primaryTypeDisplayName as { text?: string } | undefined
                  )?.text;

                  if (!existing) {
                    discoveryStats.nearbyAdded += 1;
                    candidateMap.set(normKey, {
                      id: `bldg-${normKey}`,
                      streetAddress,
                      normalizedAddress: normKey,
                      displayName,
                      neighborhood,
                      location: coords,
                      distanceFromRouteMeters: Math.round(stats.distanceMeters),
                      routeProgressMeters: Math.round(stats.routeProgressMeters),
                      placeId: p.id ? String(p.id) : undefined,
                      googleMapsUri: p.googleMapsUri ? String(p.googleMapsUri) : undefined,
                      primaryType,
                    });
                  } else if (!existing.displayName && displayName) {
                    existing.displayName = displayName;
                    existing.googleMapsUri =
                      existing.googleMapsUri ||
                      (p.googleMapsUri ? String(p.googleMapsUri) : undefined);
                  }
                }
              } catch (err) {
                console.warn('Nearby search node error:', err);
              }
            })
          );
        }
      };

      // 1a. Overlapping DISTANCE search along the entire route (~115m spacing)
      await runNearbyBatch(sampleNodes, 'DISTANCE', searchRadius);

      // 1b. POPULARITY search at wider intervals when corridor >= 150m
      if (deviationMeters >= 150) {
        const popNodes = samplePathEquidistant(routePath, 5, 360);
        await runNearbyBatch(popNodes, 'POPULARITY', searchRadius);
      }

      // 2. Reverse Geocoding (Geocoding v4) along the route (~145m spacing)
      // to catch residential, civic, or multi-number buildings (e.g. "50-52") without Places listings
      const geocodeSamples = samplePathEquidistant(routePath, 12, 145);
      const GEO_BATCH = 2;
      let consecutiveGeoQuotaFails = 0;
      for (let i = 0; i < geocodeSamples.length; i += GEO_BATCH) {
        if (consecutiveGeoQuotaFails >= 3) break;
        if (i > 0) await sleep(240);
        const slice = geocodeSamples.slice(i, i + GEO_BATCH);
        await Promise.all(
          slice.map(async (node) => {
            const url = new URL('https://geocode.googleapis.com/v4/geocode/location');
            url.searchParams.append('location.latitude', String(node.lat));
            url.searchParams.append('location.longitude', String(node.lng));
            url.searchParams.append('languageCode', 'en');
            url.searchParams.append('types', 'street_address');

            const callGeo = async () =>
              fetch(url.toString(), {
                method: 'GET',
                headers: {
                  'Content-Type': 'application/json',
                  'X-Goog-Api-Key': mapsKey,
                  'X-Goog-FieldMask':
                    'results.placeId,results.formattedAddress,results.addressComponents,results.location',
                  'X-Goog-Maps-Solution-ID': GMP_SOLUTION_ID,
                },
              });

            try {
              discoveryStats.geoRequests += 1;
              let response = await callGeo();
              if (response.status === 429) {
                discoveryStats.geo429 += 1;
                if (consecutiveGeoQuotaFails < 2) {
                  await sleep(900);
                  response = await callGeo();
                }
              }

              if (!response.ok) {
                const errData = (await response.json().catch(() => ({}))) as Record<
                  string,
                  unknown
                >;
                if (isQuotaErrorPayload(response.status, errData)) {
                  quotaTriggered = true;
                  consecutiveGeoQuotaFails += 1;
                  discoveryStats.lastQuotaMessage = String(
                    (errData?.error as { message?: string })?.message || response.status
                  );
                }
                return;
              }
              consecutiveGeoQuotaFails = 0;
              discoveryStats.geoOk += 1;

              const data = (await response.json()) as {
                results?: Array<{
                  placeId?: string;
                  formattedAddress?: string;
                  addressComponents?: Array<{
                    longText?: string;
                    shortText?: string;
                    types?: string[];
                  }>;
                  location?: { latitude?: number; longitude?: number };
                }>;
              };

              for (const r of (data.results || []).slice(0, 5)) {
                if (!r.location?.latitude || !r.location?.longitude) continue;
                const coords: LatLng = {
                  lat: r.location.latitude,
                  lng: r.location.longitude,
                };
                const stats = pointToPolylineStats(coords, routePath, cumulative);
                if (stats.distanceMeters > deviationMeters) continue;

                const { streetAddress, neighborhood } = extractAddressParts(
                  r.addressComponents || [],
                  r.formattedAddress || ''
                );
                if (
                  !streetAddress ||
                  !/\b\d+[a-zA-Zа-яА-Я/-]*\b/.test(
                    streetAddress.split(',')[0] || streetAddress
                  )
                ) {
                  continue;
                }

                const normKey = normalizeStreetKey(streetAddress);
                if (normKey && !candidateMap.has(normKey)) {
                  discoveryStats.geoAdded += 1;
                  candidateMap.set(normKey, {
                    id: `bldg-${normKey}`,
                    streetAddress,
                    normalizedAddress: normKey,
                    neighborhood,
                    location: coords,
                    distanceFromRouteMeters: Math.round(stats.distanceMeters),
                    routeProgressMeters: Math.round(stats.routeProgressMeters),
                    placeId: r.placeId,
                  });
                }
              }
            } catch (err) {
              console.warn('Reverse geocode node error:', err);
            }
          })
        );
      }

      for (const c of await scanOverpass(routePath, cumulative, deviationMeters)) {
        const existing = candidateMap.get(c.normalizedAddress);
        if (!existing) candidateMap.set(c.normalizedAddress, c);
        else if (!existing.displayName && c.displayName) existing.displayName = c.displayName;
      }
      
      if (quotaTriggered && candidateMap.size === 0) {
        res.status(429).json({
          error: 'Google Maps Platform quota reached while scanning buildings.',
          quotaExceeded: true,
          discoveryStats,
        });
        return;
      }

      // Sort strictly in walking order along the route and keep all discovered buildings
      const sorted = Array.from(candidateMap.values()).sort(
        (a, b) => a.routeProgressMeters - b.routeProgressMeters
      );

      const payload = {
        buildings: sorted,
        totalScannedCandidates: sorted.length,
        quotaTriggered,
        discoveryStats,
      };
      if (sorted.length > 0 && !quotaTriggered) {
        discoveryResultCache.set(cacheKey, {
          expiresAt: Date.now() + 10 * 60 * 1000,
          payload,
        });
      }

      res.json(payload);
    } catch (err) {
      console.error('discover-buildings error:', err);
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Failed to discover buildings.',
      });
    }
  });

  // Helper: fetch Google Places editorial summary & details for a building
  async function fetchPlaceEditorialDetails(
    placeId: string | undefined,
    mapsKey: string
  ): Promise<{
    editorialSummary?: string;
    primaryType?: string;
    googleMapsUri?: string;
  }> {
    if (!placeId || !mapsKey || placeId.startsWith('osm:')) return {};
    try {
      const cleanId = placeId.replace(/^places\//, '');
      const r = await fetch(
        `https://places.googleapis.com/v1/places/${encodeURIComponent(cleanId)}`,
        {
          headers: {
            'X-Goog-Api-Key': mapsKey,
            'X-Goog-FieldMask':
              'displayName,editorialSummary,primaryTypeDisplayName,googleMapsUri',
            'X-Goog-Maps-Solution-ID': GMP_SOLUTION_ID,
          },
        }
      );
      if (!r.ok) return {};
      const data = (await r.json()) as {
        editorialSummary?: { text?: string };
        primaryTypeDisplayName?: { text?: string };
        googleMapsUri?: string;
      };
      return {
        editorialSummary: data.editorialSummary?.text,
        primaryType: data.primaryTypeDisplayName?.text,
        googleMapsUri: data.googleMapsUri,
      };
    } catch {
      return {};
    }
  }

  // Helper: query Google Custom Search JSON API when configured
  async function queryGoogleCustomSearch(
    query: string,
    cseKey: string,
    cseCx: string
  ): Promise<Array<{ title: string; link: string; snippet: string }>> {
    const url = new URL('https://www.googleapis.com/customsearch/v1');
    url.searchParams.set('key', cseKey);
    url.searchParams.set('cx', cseCx);
    url.searchParams.set('q', query);
    url.searchParams.set('num', '5');
    const r = await fetch(url.toString());
    if (!r.ok) {
      const errBody = await r.text().catch(() => '');
      throw new Error(`Google Custom Search HTTP ${r.status}: ${errBody.slice(0, 200)}`);
    }
    const data = (await r.json()) as {
      items?: Array<{ title?: string; link?: string; snippet?: string }>;
    };
    return (data.items || [])
      .filter((it) => it.link && it.title)
      .map((it) => ({
        title: String(it.title),
        link: String(it.link),
        snippet: String(it.snippet || '').replace(/\s+/g, ' ').trim(),
      }));
  }

  // Helper: fetch Wikipedia article matching a building
  async function fetchWikiArticleByTitle(title: string): Promise<{
    title: string;
    url: string;
    extract: string;
  } | null> {
    try {
      const eUrl =
        'https://en.wikipedia.org/w/api.php?action=query&prop=extracts|info&inprop=url&explaintext=1&exlimit=1&titles=' +
        encodeURIComponent(title) +
        '&format=json';
      const eRes = await fetch(eUrl, {
        headers: { 'User-Agent': 'WanderAudioCartographicGuide/1.0' },
      });
      if (!eRes.ok) return null;
      const eJson = (await eRes.json()) as {
        query?: {
          pages?: Record<
            string,
            { title?: string; fullurl?: string; extract?: string; missing?: string }
          >;
        };
      };
      const pages = Object.values(eJson.query?.pages || {});
      const page = pages[0];
      if (!page || page.missing !== undefined || !page.extract) return null;
      return {
        title: page.title || title,
        url:
          page.fullurl ||
          `https://en.wikipedia.org/wiki/${encodeURIComponent((page.title || title).replace(/ /g, '_'))}`,
        extract: page.extract,
      };
    } catch {
      return null;
    }
  }

  function doesArticleMatchBuilding(
    articleTitle: string,
    articleExtract: string,
    building: BuildingCandidate
  ): boolean {
    const titleLower = articleTitle.toLowerCase();
    const leadLower = articleExtract.slice(0, 1800).toLowerCase();
    const fullLower = articleExtract.toLowerCase();

    const streetFirst = building.streetAddress.split(',')[0].trim().toLowerCase();
    const streetNumMatch = streetFirst.match(/^(\d+[a-z]?)\s+(.+)$/i);
    if (streetNumMatch) {
      const num = streetNumMatch[1];
      const streetCore = streetNumMatch[2]
        .replace(/\b(street|st|avenue|ave|boulevard|blvd|road|rd|square|sq|drive|dr)\b\.?/gi, '')
        .trim();
      if (streetCore.length >= 3) {
        const pairRegex = new RegExp(`\\b${num}\\b[^.\\n]{0,25}\\b${streetCore.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i');
        if (pairRegex.test(leadLower) || pairRegex.test(titleLower)) {
          return true;
        }
      }
    }

    if (building.displayName) {
      const cleanName = building.displayName
        .toLowerCase()
        .replace(/[^\p{L}\p{N}\s]/gu, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      const cityWords = new Set(
        building.streetAddress
          .split(',')
          .slice(1)
          .join(' ')
          .toLowerCase()
          .split(/\s+/)
          .filter(Boolean)
      );
      const stopWords = new Set(['the', 'of', 'and', 'at', 'in', 'a', 'an', 'on', 'for']);
      const significantTokens = cleanName
        .split(' ')
        .filter((t) => t.length >= 3 && !stopWords.has(t) && !cityWords.has(t));

      if (cleanName.length >= 4 && titleLower.includes(cleanName)) {
        return true;
      }
      if (significantTokens.length >= 2) {
        const allInTitle = significantTokens.every((t) => titleLower.includes(t));
        const allInLead = significantTokens.every((t) => leadLower.includes(t));
        if (allInTitle || allInLead) return true;
      } else if (significantTokens.length === 1 && significantTokens[0].length >= 5) {
        if (titleLower.includes(significantTokens[0]) && fullLower.includes(building.streetAddress.split(',')[1]?.trim().toLowerCase() || '')) {
          return true;
        }
      }
    }

    return false;
  }

  function parseWikiSections(extract: string): {
    lead: string;
    sections: Array<{ heading: string; body: string }>;
  } {
    const clean = extract.replace(/\r/g, '').trim();
    const parts = clean.split(/\n==\s*([^=\n]+?)\s*==\n/);
    const lead = (parts[0] || '').trim();
    const sections: Array<{ heading: string; body: string }> = [];
    for (let i = 1; i < parts.length; i += 2) {
      const heading = (parts[i] || '').trim();
      const body = (parts[i + 1] || '')
        .replace(/\n===+\s*([^=\n]+?)\s*===+\n/g, '\n\n')
        .trim();
      if (
        heading &&
        body &&
        !/^(see also|references|external links|further reading|notes|bibliography|gallery)$/i.test(
          heading
        )
      ) {
        sections.push({ heading, body });
      }
    }
    return { lead, sections };
  }

  function buildCategoryNarrativeFromSearch(
    catId: CategoryId,
    parsed: { lead: string; sections: Array<{ heading: string; body: string }> },
    editorialSummary?: string
  ): { isNotable: boolean; headline: string; summary: string } {
    const patterns: Record<CategoryId, { heading: RegExp; text: RegExp; fallbackHeading: string }> = {
      historical: {
        heading: /history|origin|background|construction|heritage|timeline|founding|early/i,
        text: /\b(built|constructed|opened|founded|historic|landmark|century|war|earthquake|declared|dedicated|national register)\b/i,
        fallbackHeading: 'Historical Summary',
      },
      famous_people: {
        heading: /people|person|resident|architect|founder|owner|figure|notable|biography|occupant|tenant/i,
        text: /\b(architect|designed by|founded by|named after|commission|mayor|president|artist|writer|built by|owned by)\b/i,
        fallbackHeading: 'Notable People & Creators',
      },
      architecture: {
        heading: /architect|design|style|structure|height|facade|interior|exterior|feature|engineering|spire/i,
        text: /\b(architect|style|story|stories|tall|feet|meters|facade|pyramid|tower|steel|concrete|glass|modernist|neoclassical|gothic|beaux-arts|art deco)\b/i,
        fallbackHeading: 'Architectural Overview',
      },
      cultural: {
        heading: /cultur|popular|film|cinema|music|literat|art|media|appear|legacy|museum|exhibit|public/i,
        text: /\b(film|movie|novel|book|painting|mural|museum|music|cultural|symbol|icon|appeared in|featured in|art)\b/i,
        fallbackHeading: 'Cultural Significance',
      },
      folklore: {
        heading: /legend|myster|ghost|scandal|incident|attack|fire|controvers|crime|unusual|lore|trivia|disaster/i,
        text: /\b(controvers|protest|fire|earthquake|attack|mystery|rumor|legend|unusual|dramatic|collapse|scandal)\b/i,
        fallbackHeading: 'Notable Incidents & Lore',
      },
    };

    const spec = patterns[catId];
    const matchedSections = parsed.sections.filter((s) => spec.heading.test(s.heading));
    const chunks: string[] = [];

    if (matchedSections.length > 0) {
      for (const sec of matchedSections.slice(0, 3)) {
        chunks.push(sec.body);
      }
    }

    const leadMatches = spec.text.test(parsed.lead);
    if (chunks.length === 0 && leadMatches && parsed.lead.length > 120) {
      chunks.push(parsed.lead);
    } else if (chunks.length > 0 && parsed.lead.length > 60 && catId === 'historical') {
      chunks.unshift(parsed.lead);
    }

    if (editorialSummary && chunks.length > 0) {
      chunks.unshift(editorialSummary);
    }

    const combined = chunks
      .join('\n\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();

    if (!combined || combined.split(/\s+/).filter(Boolean).length < 25) {
      return {
        isNotable: false,
        headline: 'No category match in search results',
        summary: `No documented ${catId.replace('_', ' ')} details were returned for this building.`,
      };
    }

    // Cap to roughly 900 words max for smooth audio narration
    const words = combined.split(/\s+/);
    const trimmed =
      words.length > 950 ? words.slice(0, 950).join(' ') + '...' : combined;

    return {
      isNotable: true,
      headline: matchedSections[0]?.heading || spec.fallbackHeading,
      summary: trimmed,
    };
  }

  // Submit each category query as a search query (Google Custom Search when configured, or Wikipedia + Google Places Search)
  app.post('/api/buildings/research', async (req, res) => {
    const { building, categories } = req.body as {
      building?: BuildingCandidate;
      categories?: CategoryId[];
    };

    if (!building?.streetAddress || !Array.isArray(categories) || categories.length === 0) {
      res.status(400).json({ error: 'Building streetAddress and categories are required.' });
      return;
    }

    const mapsKey = getMapsApiKey();
    const cseKey = process.env.GOOGLE_CSE_API_KEY || '';
    const cseCx = process.env.GOOGLE_CSE_CX || '';

    const buildingLabel = building.displayName
      ? `${building.streetAddress} (${building.displayName})`
      : building.streetAddress;

    const categoryQueries = categories.map((catId) => {
      const { query } = buildCategoryPrompt(catId, buildingLabel);
      return {
        catId,
        query,
        googleSearchUrl: `https://www.google.com/search?q=${encodeURIComponent(query)}`,
      };
    });

    /* Claude addition */
    if (process.env.GEMINI_API_KEY) {
      const settled = await Promise.allSettled(
        categoryQueries.map((q) => researchGrounded(q.catId, building, buildingLabel, q.googleSearchUrl))
      );
      if (settled.some((s) => s.status === 'fulfilled')) {
        const findings = settled.map((s, i) =>
          s.status === 'fulfilled'
            ? s.value
            : {
                categoryId: categoryQueries[i].catId,
                queryUsed: categoryQueries[i].query,
                isNotable: false,
                headline: 'Research error',
                summary: s.reason instanceof Error ? s.reason.message : String(s.reason),
                wordCount: 0,
                sources: [],
                googleSearchUrl: categoryQueries[i].googleSearchUrl,
              }
        );
        res.json({
          findings,
          positiveCount: findings.filter((f) => (f as { isNotable: boolean }).isNotable).length,
          rawAiResponse: JSON.stringify(findings, null, 2),
        });
        return;
      }
      const reasons = settled
        .filter((s): s is PromiseRejectedResult => s.status === 'rejected')
        .map((s) => (s.reason instanceof Error ? s.reason.message : String(s.reason)).slice(0, 300));
      console.warn('Grounded research failed for all categories:', reasons[0]);
      //console.warn('Grounded research failed for all categories, falling back to Wikipedia/Places');
    }
    /* Claude addition end */
    /* Claude alternative addition - optimized * /
    if (process.env.GEMINI_API_KEY) {
      try {
        const findings = await researchBuildingGrounded(
          categoryQueries.map((q) => ({ catId: q.catId, query: q.query, googleSearchUrl: q.googleSearchUrl })),
          building,
          buildingLabel
        );
        res.json({
          findings,
          positiveCount: findings.filter((f) => (f as { isNotable: boolean }).isNotable).length,
          rawAiResponse: JSON.stringify(findings, null, 2),
        });
        return;
      } catch (e) {
        console.warn('Grounded research failed:', e instanceof Error ? e.message : e);
        // falls through to Wikipedia/Places
      }
    }
    /* Claude alternative addition end */
    
    try {
      // Mode 1: Live Google Custom Search JSON API (when GOOGLE_CSE_API_KEY & GOOGLE_CSE_CX are configured)
      if (cseKey && cseCx) {
        const findings = await Promise.all(
          categoryQueries.map(async ({ catId, query, googleSearchUrl }) => {
            const items = await queryGoogleCustomSearch(query, cseKey, cseCx);
            const sources = items.slice(0, 5).map((it) => ({
              title: it.title,
              uri: it.link,
            }));

            // Check if a Wikipedia article was returned by Google Search
            const wikiItem = items.find((it) =>
              /\/\/[a-z]{2}\.wikipedia\.org\/wiki\//i.test(it.link)
            );
            let matchedWiki: { title: string; url: string; extract: string } | null = null;
            if (wikiItem) {
              const titleSlug = decodeURIComponent(
                wikiItem.link.split('/wiki/')[1] || ''
              ).replace(/_/g, ' ');
              if (titleSlug) {
                const art = await fetchWikiArticleByTitle(titleSlug);
                if (art && doesArticleMatchBuilding(art.title, art.extract, building)) {
                  matchedWiki = art;
                }
              }
            }

            if (matchedWiki) {
              const parsed = parseWikiSections(matchedWiki.extract);
              const narrative = buildCategoryNarrativeFromSearch(catId, parsed);
              const snippetBlock = items
                .slice(0, 3)
                .map((it) => `${it.title}: ${it.snippet}`)
                .join('\n\n');
              const finalSummary = narrative.isNotable
                ? narrative.summary
                : snippetBlock || narrative.summary;
              const wordCount = finalSummary.split(/\s+/).filter(Boolean).length;
              return {
                categoryId: catId,
                queryUsed: query,
                isNotable: narrative.isNotable,
                headline: narrative.isNotable ? `${matchedWiki.title} — ${narrative.headline}` : 'No notable match',
                summary: finalSummary,
                wordCount,
                sources,
                googleSearchUrl,
                searchProvider: 'Google Custom Search API',
              };
            }

            const combinedSnippets = items
              .map((it) => `${it.title}\n${it.snippet}`)
              .join('\n\n');
            const matchesBuilding = items.some((it) =>
              doesArticleMatchBuilding(it.title, it.snippet, building)
            );
            const wordCount = combinedSnippets
              ? combinedSnippets.split(/\s+/).filter(Boolean).length
              : 0;

            return {
              categoryId: catId,
              queryUsed: query,
              isNotable: matchesBuilding && wordCount > 25,
              headline: matchesBuilding
                ? items[0]?.title || building.streetAddress
                : 'No dedicated landmark match in Google results',
              summary:
                combinedSnippets ||
                'No Google search results were returned for this query.',
              wordCount,
              sources,
              googleSearchUrl,
              searchProvider: 'Google Custom Search API',
            };
          })
        );

        const positiveCount = findings.filter((f) => f.isNotable).length;
        res.json({
          findings,
          positiveCount,
          rawAiResponse: JSON.stringify(findings, null, 2),
        });
        return;
      }

      // Mode 2: Web & Encyclopedia Search (Wikipedia Action API + Google Places Details)
      const placeDetails = await fetchPlaceEditorialDetails(building.placeId, mapsKey);
      const cityPart = building.streetAddress.split(',').slice(1).join(',').trim();

      const searchCandidates = [
        building.displayName ? `${building.displayName} ${cityPart}`.trim() : '',
        building.displayName || '',
        `${building.streetAddress.split(',')[0].trim()} ${cityPart}`.trim(),
      ].filter(Boolean);

      const candidateTitles: string[] = [];
      const seenTitles = new Set<string>();
      const searchSnippets: Array<{ title: string; snippet: string; uri: string }> = [];

      for (const sq of searchCandidates) {
        try {
          const sUrl =
            'https://en.wikipedia.org/w/api.php?action=query&list=search&srlimit=3&srsearch=' +
            encodeURIComponent(sq) +
            '&format=json';
          const sRes = await fetch(sUrl, {
            headers: { 'User-Agent': 'WanderAudioCartographicGuide/1.0' },
          });
          if (sRes.ok) {
            const sJson = (await sRes.json()) as {
              query?: { search?: Array<{ title: string; snippet: string }> };
            };
            for (const item of sJson.query?.search || []) {
              if (!seenTitles.has(item.title)) {
                seenTitles.add(item.title);
                candidateTitles.push(item.title);
                searchSnippets.push({
                  title: item.title,
                  snippet: item.snippet.replace(/<[^>]+>/g, '').trim(),
                  uri: `https://en.wikipedia.org/wiki/${encodeURIComponent(item.title.replace(/ /g, '_'))}`,
                });
              }
            }
          }
        } catch {
          // Continue to next search candidate
        }
        if (candidateTitles.length >= 3) break;
      }

      let matchedArticle: { title: string; url: string; extract: string } | null = null;
      for (const title of candidateTitles.slice(0, 3)) {
        const art = await fetchWikiArticleByTitle(title);
        if (art && doesArticleMatchBuilding(art.title, art.extract, building)) {
          matchedArticle = art;
          break;
        }
      }

      const parsedWiki = matchedArticle ? parseWikiSections(matchedArticle.extract) : null;
      const baseSources: Array<{ title: string; uri: string }> = [];
      if (matchedArticle) {
        baseSources.push({ title: `${matchedArticle.title} — Wikipedia`, uri: matchedArticle.url });
      }
      if (placeDetails.googleMapsUri || building.googleMapsUri) {
        baseSources.push({
          title: `${building.displayName || building.streetAddress} — Google Maps`,
          uri: (placeDetails.googleMapsUri || building.googleMapsUri)!,
        });
      }

      const findings = categoryQueries.map(({ catId, query, googleSearchUrl }) => {
        if (parsedWiki && matchedArticle) {
          const narrative = buildCategoryNarrativeFromSearch(
            catId,
            parsedWiki,
            catId === 'historical' ? placeDetails.editorialSummary : undefined
          );
          const wordCount = narrative.summary
            ? narrative.summary.split(/\s+/).filter(Boolean).length
            : 0;
          return {
            categoryId: catId,
            queryUsed: query,
            isNotable: narrative.isNotable,
            headline: narrative.isNotable
              ? `${matchedArticle.title} — ${narrative.headline}`
              : narrative.headline,
            summary: narrative.summary,
            wordCount,
            sources: narrative.isNotable ? baseSources : [],
            googleSearchUrl,
            searchProvider: 'Web Search (Wikipedia + Google Places)',
          };
        }

        // No exact encyclopedia article matched this building; check if Google Places has an editorial landmark summary
        const isLandmarkPlace =
          Boolean(placeDetails.editorialSummary) &&
          /museum|landmark|monument|church|cathedral|historic|library|palace|theater|memorial|university/i.test(
            `${placeDetails.primaryType || ''} ${placeDetails.editorialSummary || ''}`
          );

        if (isLandmarkPlace && catId === 'historical' && placeDetails.editorialSummary) {
          const summary = `${placeDetails.editorialSummary}${
            searchSnippets.length > 0
              ? `\n\nRelated search references:\n${searchSnippets
                  .slice(0, 2)
                  .map((s) => `${s.title}: ${s.snippet}`)
                  .join('\n')}`
              : ''
          }`;
          return {
            categoryId: catId,
            queryUsed: query,
            isNotable: true,
            headline: `${building.displayName || building.streetAddress} (${placeDetails.primaryType || 'Landmark'})`,
            summary,
            wordCount: summary.split(/\s+/).filter(Boolean).length,
            sources: baseSources,
            googleSearchUrl,
            searchProvider: 'Web Search (Wikipedia + Google Places)',
          };
        }

        const snippetPreview =
          searchSnippets.length > 0
            ? `No dedicated record matched "${buildingLabel}" for this category. Closest search hits:\n\n${searchSnippets
                .slice(0, 3)
                .map((s) => `• ${s.title}: ${s.snippet}`)
                .join('\n')}`
            : `No dedicated public historical, architectural, or biographical search records were found for "${buildingLabel}".`;

        return {
          categoryId: catId,
          queryUsed: query,
          isNotable: false,
          headline: 'No notable match found',
          summary: snippetPreview,
          wordCount: 0,
          sources: searchSnippets.slice(0, 2).map((s) => ({ title: s.title, uri: s.uri })),
          googleSearchUrl,
          searchProvider: 'Web Search (Wikipedia + Google Places)',
        };
      });

      const positiveCount = findings.filter((f) => f.isNotable).length;
      res.json({
        findings,
        positiveCount,
        rawAiResponse: JSON.stringify(
          {
            building: buildingLabel,
            searchMode: 'Wikipedia + Google Places (set GOOGLE_CSE_API_KEY & GOOGLE_CSE_CX for live Google Custom Search API)',
            matchedArticle: matchedArticle?.title || null,
            placeDetails,
            queriesSubmitted: categoryQueries,
          },
          null,
          2
        ),
      });
    } catch (err) {
      console.error('buildings/research search error:', err);
      const cleanMsg =
        err instanceof Error ? err.message : 'Search request failed unexpectedly.';
      const errorFindings = categoryQueries.map(({ catId, query, googleSearchUrl }) => ({
        categoryId: catId,
        queryUsed: query,
        isNotable: false,
        headline: 'Search Error',
        summary: cleanMsg,
        wordCount: 0,
        sources: [],
        googleSearchUrl,
      }));
      res.status(500).json({
        error: cleanMsg,
        findings: errorFindings,
        positiveCount: 0,
        rawAiResponse: cleanMsg,
      });
    }
  });

  // Brief 2-sentence recap for revisited buildings
  app.post('/api/buildings/recap', async (req, res) => {
    try {
      const { streetAddress, displayName, findings } = req.body as {
        streetAddress: string;
        displayName?: string;
        findings: Array<{ categoryId: string; headline: string; summary: string }>;
      };

      const ai = getGenAIClient();
      const digest = (findings || [])
        .map((f) => `${f.categoryId} (${f.headline}): ${f.summary.slice(0, 260)}`)
        .join('\n');

      const response = await ai.models.generateContent({
        model: 'gemini-4-hydrogen',
        contents: `Create a warm, natural 2-sentence audio recap for a walker passing ${
          displayName ? `${displayName} at ` : ''
        }${streetAddress} a second time. Remind them what made this stop notable based on:\n${digest}`,
        config: {
          thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
        },
      });

      res.json({
        recapText:
          response.text?.trim() ||
          `You are passing ${streetAddress} again, one of the notable stops earlier on your route.`,
      });
    } catch {
      res.json({
        recapText: `You are passing ${req.body?.streetAddress || 'this building'} again, which we covered earlier on your walking tour.`,
      });
    }
  });

  // Gemini Text-to-Speech (gemini-3.8-flash-lite-tts -> audio/wav)
  app.post('/api/tts', async (req, res) => {
    try {
      const { text, voiceName = 'Kore', style } = req.body as {
        text: string;
        voiceName?: string;
        style?: string;
      };

      if (!text || !text.trim()) {
        res.status(400).json({ error: 'Text is required for TTS.' });
        return;
      }

      const ai = getGenAIClient();
      const response = await ai.models.generateContent({
        model: 'gemini-3.8-flash-lite-tts',
        contents: [
          {
            role: 'user',
            parts: [
              {
                text: text.slice(0, 3500),
                speechMetadata: {
                  style:
                    style ||
                    'Warm, articulate, documentary audio walking tour guide with clear pacing',
                },
              },
            ],
          },
        ],
        config: {
          responseModalities: ['AUDIO'],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName },
            },
          },
        },
      });

      const base64Audio =
        response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;

      if (!base64Audio) {
        res.status(502).json({ error: 'TTS model returned no audio data.' });
        return;
      }

      res.json({
        audioBase64: base64Audio,
        mimeType: 'audio/wav',
      });
    } catch (err) {
      console.error('tts error:', err);
      res.status(500).json({
        error: err instanceof Error ? err.message : 'TTS generation failed.',
      });
    }
  });

  // Vite middleware in dev; static dist in production
  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('/{*splat}', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.get('/api/debug/research-test', async (_req, res) => {
      try {
        const ai = getGenAIClient();
        const r = await ai.models.generateContent({
          model: RESEARCH_MODEL,
          contents: 'Using Google Search, in two sentences: what is the Transamerica Pyramid in San Francisco?',
          config: { tools: [{ googleSearch: {} }] },
        });
        res.json({ ok: true, model: RESEARCH_MODEL, text: r.text, grounded: Boolean(r.candidates?.[0]?.groundingMetadata) });
      } catch (e) {
        res.status(500).json({ ok: false, model: RESEARCH_MODEL, error: e instanceof Error ? e.message : String(e) });
      }
  });
  
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`WanderAudio server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
