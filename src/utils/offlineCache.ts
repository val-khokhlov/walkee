import type { CachedRouteBundle, ResearchedBuilding } from '../types/tour';

const DB_NAME = 'wander_audio_offline_cache';
const DB_VERSION = 1;
const STORE_BUILDINGS = 'buildings';
const STORE_ROUTES = 'routes';
const STORE_AUDIO = 'audio_clips';

interface AudioCacheRecord {
  key: string;
  audioBase64: string;
  mimeType: string;
  savedAt: number;
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB unavailable'));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_BUILDINGS)) {
        db.createObjectStore(STORE_BUILDINGS, { keyPath: 'normalizedAddress' });
      }
      if (!db.objectStoreNames.contains(STORE_ROUTES)) {
        db.createObjectStore(STORE_ROUTES, { keyPath: 'routeKey' });
      }
      if (!db.objectStoreNames.contains(STORE_AUDIO)) {
        db.createObjectStore(STORE_AUDIO, { keyPath: 'key' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('Failed to open IndexedDB'));
  });
}

export function buildRouteCacheKey(
  originLabel: string,
  destinationLabel: string,
  deviationMeters: number,
  categories: string[]
): string {
  const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');
  const cats = [...categories].sort().join(',');
  return `${norm(originLabel)}||${norm(destinationLabel)}||${deviationMeters}||${cats}`;
}

export async function savePositiveBuildingToCache(
  building: ResearchedBuilding
): Promise<void> {
  const positiveFindings = building.findings.filter((f) => f.isNotable);
  if (positiveFindings.length === 0) return;

  const positiveRecord: ResearchedBuilding = {
    ...building,
    findings: positiveFindings,
    positiveCount: positiveFindings.length,
    cachedOffline: true,
  };

  try {
    const db = await openDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_BUILDINGS, 'readwrite');
      const store = tx.objectStore(STORE_BUILDINGS);
      // Merge existing cached categories for this street address if present
      const getReq = store.get(positiveRecord.normalizedAddress);
      getReq.onsuccess = () => {
        const existing = getReq.result as ResearchedBuilding | undefined;
        if (existing) {
          const mergedMap: Record<string, (typeof positiveFindings)[number]> = {};
          for (const f of existing.findings) mergedMap[f.categoryId] = f;
          for (const f of positiveFindings) mergedMap[f.categoryId] = f;
          const mergedFindings = Object.values(mergedMap);
          store.put({
            ...positiveRecord,
            findings: mergedFindings,
            positiveCount: mergedFindings.length,
            cachedOffline: true,
          });
        } else {
          store.put(positiveRecord);
        }
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch (err) {
    console.warn('Offline building cache save failed:', err);
  }
}

export async function getCachedBuildingByAddress(
  normalizedAddress: string
): Promise<ResearchedBuilding | null> {
  try {
    const db = await openDB();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_BUILDINGS, 'readonly');
      const req = tx.objectStore(STORE_BUILDINGS).get(normalizedAddress);
      req.onsuccess = () => resolve((req.result as ResearchedBuilding) || null);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return null;
  }
}

export async function getAllCachedBuildings(): Promise<ResearchedBuilding[]> {
  try {
    const db = await openDB();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_BUILDINGS, 'readonly');
      const req = tx.objectStore(STORE_BUILDINGS).getAll();
      req.onsuccess = () => resolve((req.result as ResearchedBuilding[]) || []);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return [];
  }
}

export async function saveRouteBundleToCache(bundle: CachedRouteBundle): Promise<void> {
  const positiveOnlyBuildings = bundle.buildings
    .filter((b) => b.findings.some((f) => f.isNotable))
    .map((b) => ({
      ...b,
      findings: b.findings.filter((f) => f.isNotable),
      positiveCount: b.findings.filter((f) => f.isNotable).length,
      cachedOffline: true,
    }));

  const cleaned: CachedRouteBundle = {
    ...bundle,
    buildings: positiveOnlyBuildings,
  };

  try {
    const db = await openDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_ROUTES, 'readwrite');
      tx.objectStore(STORE_ROUTES).put(cleaned);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch (err) {
    console.warn('Offline route bundle cache save failed:', err);
  }
}

export async function getCachedRouteBundle(
  routeKey: string
): Promise<CachedRouteBundle | null> {
  try {
    const db = await openDB();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_ROUTES, 'readonly');
      const req = tx.objectStore(STORE_ROUTES).get(routeKey);
      req.onsuccess = () => resolve((req.result as CachedRouteBundle) || null);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return null;
  }
}

export async function getAllCachedRoutes(): Promise<CachedRouteBundle[]> {
  try {
    const db = await openDB();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_ROUTES, 'readonly');
      const req = tx.objectStore(STORE_ROUTES).getAll();
      req.onsuccess = () => {
        const list = (req.result as CachedRouteBundle[]) || [];
        resolve(list.sort((a, b) => b.savedAt - a.savedAt));
      };
      req.onerror = () => reject(req.error);
    });
  } catch {
    return [];
  }
}

export async function deleteCachedRoute(routeKey: string): Promise<void> {
  try {
    const db = await openDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_ROUTES, 'readwrite');
      tx.objectStore(STORE_ROUTES).delete(routeKey);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch (err) {
    console.warn('Failed to delete cached route:', err);
  }
}

export async function saveAudioClipToCache(
  key: string,
  audioBase64: string,
  mimeType: string
): Promise<void> {
  try {
    const db = await openDB();
    const record: AudioCacheRecord = {
      key,
      audioBase64,
      mimeType,
      savedAt: Date.now(),
    };
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_AUDIO, 'readwrite');
      tx.objectStore(STORE_AUDIO).put(record);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // Non-fatal
  }
}

export async function getAudioClipFromCache(
  key: string
): Promise<AudioCacheRecord | null> {
  try {
    const db = await openDB();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_AUDIO, 'readonly');
      const req = tx.objectStore(STORE_AUDIO).get(key);
      req.onsuccess = () => resolve((req.result as AudioCacheRecord) || null);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return null;
  }
}

export async function clearOfflineCache(): Promise<void> {
  try {
    const db = await openDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(
        [STORE_BUILDINGS, STORE_ROUTES, STORE_AUDIO],
        'readwrite'
      );
      tx.objectStore(STORE_BUILDINGS).clear();
      tx.objectStore(STORE_ROUTES).clear();
      tx.objectStore(STORE_AUDIO).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch (err) {
    console.warn('Failed to clear offline cache:', err);
  }
}

export async function getOfflineCacheStats(): Promise<{
  routesCount: number;
  buildingsCount: number;
  audioClipsCount: number;
}> {
  try {
    const db = await openDB();
    const countStore = (name: string) =>
      new Promise<number>((resolve) => {
        const tx = db.transaction(name, 'readonly');
        const req = tx.objectStore(name).count();
        req.onsuccess = () => resolve(req.result || 0);
        req.onerror = () => resolve(0);
      });

    const [routesCount, buildingsCount, audioClipsCount] = await Promise.all([
      countStore(STORE_ROUTES),
      countStore(STORE_BUILDINGS),
      countStore(STORE_AUDIO),
    ]);
    return { routesCount, buildingsCount, audioClipsCount };
  } catch {
    return { routesCount: 0, buildingsCount: 0, audioClipsCount: 0 };
  }
}
