import React, { useCallback, useEffect, useRef, useState } from 'react';
import { APIProvider } from '@vis.gl/react-google-maps';
import { Wifi, WifiOff } from 'lucide-react';
import { ActiveGuideView } from './components/ActiveGuideView';
import { DebugView } from './components/DebugView';
import { OfflineCacheModal } from './components/OfflineCacheModal';
import { RoutePlannerView } from './components/RoutePlannerView';
import { SettingsView } from './components/SettingsView';
import { TourMap } from './components/TourMap';
import { CATEGORY_MAP, PRESET_ROUTES } from './constants/categories';
import type {
  CachedRouteBundle,
  CategoryFinding,
  ComputedRoute,
  DiscoveredBuilding,
  DiscoveryProgressState,
  GuideSettings,
  LatLngLiteral,
  ResearchedBuilding,
  WaypointItem,
} from './types/tour';
import {
  buildRouteCacheKey,
  getCachedBuildingByAddress,
  getCachedRouteBundle,
  getOfflineCacheStats,
  savePositiveBuildingToCache,
  saveRouteBundleToCache,
} from './utils/offlineCache';

const SETTINGS_STORAGE_KEY = 'wanderaudio_settings_v1';
const ALLOWED_DEVIATIONS = [50, 250, 500, 1000];
const ALLOWED_PROVIDERS = ['google', 'osm', 'carto', 'apple'] as const;

const DEFAULT_SETTINGS: GuideSettings = {
  mapProvider: 'google',
  deviationMeters: 250,
  selectedCategories: ['historical', 'famous_people', 'architecture'],
  cacheForOffline: true,
  revisitedBehavior: 'brief_recap',
  voiceName: 'Kore',
  playbackRate: 1.0,
  autoTriggerProximity: true,
};

function createWaypoint(label: string, coords?: LatLngLiteral): WaypointItem {
  return {
    id: `wp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    label,
    coords,
  };
}

function loadSavedSettings(): GuideSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<GuideSettings>;
    const normalizedDeviation =
      typeof parsed.deviationMeters === 'number' &&
      ALLOWED_DEVIATIONS.includes(parsed.deviationMeters)
        ? parsed.deviationMeters
        : DEFAULT_SETTINGS.deviationMeters;
    const normalizedProvider =
      parsed.mapProvider &&
      (ALLOWED_PROVIDERS as readonly string[]).includes(parsed.mapProvider)
        ? parsed.mapProvider
        : DEFAULT_SETTINGS.mapProvider;
    return {
      ...DEFAULT_SETTINGS,
      ...parsed,
      mapProvider: normalizedProvider,
      deviationMeters: normalizedDeviation,
      selectedCategories:
        Array.isArray(parsed.selectedCategories) &&
        parsed.selectedCategories.length > 0
          ? parsed.selectedCategories
          : DEFAULT_SETTINGS.selectedCategories,
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export default function App() {
  const [mapsApiKey, setMapsApiKey] = useState<string>(
    () => import.meta.env.VITE_GOOGLE_MAPS_API_KEY || ''
  );
  const [appleMapsToken, setAppleMapsToken] = useState<string>('');
  const [providerAvailability, setProviderAvailability] = useState<{
    google: boolean;
    apple: boolean;
  }>({
    google: Boolean(import.meta.env.VITE_GOOGLE_MAPS_API_KEY),
    apple: false,
  });
  const [quotaExceeded, setQuotaExceeded] = useState(false);

  const [browserOffline, setBrowserOffline] = useState(
    () => typeof navigator !== 'undefined' && !navigator.onLine
  );
  const [simulatedOffline, setSimulatedOffline] = useState(false);
  const isOffline = browserOffline || simulatedOffline;

  const [screen, setScreen] = useState<
    'planner' | 'guide' | 'settings' | 'debug'
  >('planner');
  const [waypoints, setWaypoints] = useState<WaypointItem[]>(() => [
    createWaypoint(PRESET_ROUTES[0].origin),
    createWaypoint(PRESET_ROUTES[0].destination),
  ]);

  const [settings, setSettings] = useState<GuideSettings>(loadSavedSettings);
  const [progress, setProgress] = useState<DiscoveryProgressState | null>(null);
  const [errorBanner, setErrorBanner] = useState<string | null>(null);

  const [activeRoute, setActiveRoute] = useState<ComputedRoute | null>(null);
  const [buildings, setBuildings] = useState<ResearchedBuilding[]>([]);
  const [analyzedBuildings, setAnalyzedBuildings] = useState<
    ResearchedBuilding[]
  >([]);
  const [activeBuildingId, setActiveBuildingId] = useState<string | null>(null);
  const [visitedBuildingIds, setVisitedBuildingIds] = useState<string[]>([]);
  const [userLocation, setUserLocation] = useState<LatLngLiteral | null>(null);

  const [cacheModalOpen, setCacheModalOpen] = useState(false);
  const [cacheStats, setCacheStats] = useState({
    routesCount: 0,
    buildingsCount: 0,
    audioClipsCount: 0,
  });

  const discoveryAbortRef = useRef<AbortController | null>(null);

  // Fetch Maps config (Google & Apple tokens) from server config
  useEffect(() => {
    fetch('/api/maps/client-config')
      .then((r) => r.json())
      .then(
        (data: {
          mapsApiKey?: string;
          appleMapsToken?: string;
          providers?: { google?: boolean; apple?: boolean };
        }) => {
          if (data.mapsApiKey && !mapsApiKey) setMapsApiKey(data.mapsApiKey);
          if (data.appleMapsToken) setAppleMapsToken(data.appleMapsToken);
          setProviderAvailability({
            google: Boolean(data.mapsApiKey || mapsApiKey),
            apple: Boolean(data.appleMapsToken),
          });
        }
      )
      .catch(() => {
        // Ignore when offline
      });
  }, [mapsApiKey]);

  // Listen to GMP quota exceeded event (Tier 1 & Tier 2)
  useEffect(() => {
    const onQuota = () => setQuotaExceeded(true);
    window.addEventListener('gmp-quota-exceeded', onQuota);
    return () => window.removeEventListener('gmp-quota-exceeded', onQuota);
  }, []);

  // Listen to browser online/offline transitions
  useEffect(() => {
    const onOnline = () => setBrowserOffline(false);
    const onOffline = () => setBrowserOffline(true);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, []);

  const refreshCacheStats = useCallback(async () => {
    const stats = await getOfflineCacheStats();
    setCacheStats(stats);
  }, []);

  useEffect(() => {
    void refreshCacheStats();
  }, [refreshCacheStats]);

  const handleUpdateSettings = useCallback((partial: Partial<GuideSettings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...partial };
      try {
        localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(next));
      } catch {
        // Ignore storage quota errors
      }
      return next;
    });
  }, []);

  const handleUpdateWaypoint = useCallback(
    (id: string, label: string, coords?: LatLngLiteral) => {
      setWaypoints((prev) =>
        prev.map((wp) => (wp.id === id ? { ...wp, label, coords } : wp))
      );
    },
    []
  );

  const handleAddWaypoint = useCallback(() => {
    setWaypoints((prev) => [...prev, createWaypoint('')]);
  }, []);

  const handleRemoveWaypoint = useCallback((id: string) => {
    setWaypoints((prev) =>
      prev.length > 2 ? prev.filter((wp) => wp.id !== id) : prev
    );
  }, []);

  const handleMoveWaypoint = useCallback(
    (fromIndex: number, toIndex: number) => {
      setWaypoints((prev) => {
        if (
          fromIndex < 0 ||
          toIndex < 0 ||
          fromIndex >= prev.length ||
          toIndex >= prev.length ||
          fromIndex === toIndex
        ) {
          return prev;
        }
        const next = [...prev];
        const [moved] = next.splice(fromIndex, 1);
        next.splice(toIndex, 0, moved);
        return next;
      });
    },
    []
  );

  const handleLoadPresetWaypoints = useCallback((labels: string[]) => {
    setWaypoints(labels.map((label) => createWaypoint(label)));
  }, []);

  const handleMarkBuildingVisited = useCallback((id: string) => {
    setVisitedBuildingIds((prev) => (prev.includes(id) ? prev : [...prev, id]));
  }, []);

  const handleLoadCachedBundle = useCallback((bundle: CachedRouteBundle) => {
    const restoredLabels =
      bundle.waypointLabels && bundle.waypointLabels.length >= 2
        ? bundle.waypointLabels
        : [bundle.originLabel, bundle.destinationLabel];
    setWaypoints(restoredLabels.map((lbl) => createWaypoint(lbl)));
    setActiveRoute(bundle.route);
    setBuildings(bundle.buildings);
    setAnalyzedBuildings(bundle.analyzedBuildings || bundle.buildings);
    setVisitedBuildingIds([]);
    setActiveBuildingId(bundle.buildings[0]?.id || null);
    setUserLocation(bundle.route.path[0] || bundle.route.origin);
    setErrorBanner(null);
    setProgress(null);
    setScreen('guide');
  }, []);

  const handleStartDiscovery = async () => {
    const filledWaypoints = waypoints.filter((w) => w.label.trim().length > 0);
    if (filledWaypoints.length < 2) {
      setErrorBanner('Please enter at least 2 waypoints to trace a walking route.');
      return;
    }

    setErrorBanner(null);
    discoveryAbortRef.current?.abort();
    const controller = new AbortController();
    discoveryAbortRef.current = controller;

    const waypointLabels = filledWaypoints.map((w) => w.label.trim());
    const originLabel = waypointLabels[0];
    const destinationLabel = waypointLabels[waypointLabels.length - 1];
    const keyOriginPart = waypointLabels.slice(0, -1).join(' -> ');

    const routeKey = buildRouteCacheKey(
      keyOriginPart,
      destinationLabel,
      settings.deviationMeters,
      settings.selectedCategories
    );

    // If offline, load directly from IndexedDB cache
    if (isOffline) {
      const cachedBundle = await getCachedRouteBundle(routeKey);
      if (cachedBundle) {
        handleLoadCachedBundle(cachedBundle);
        return;
      }
      setErrorBanner(
        'You are currently offline and this exact route is not in your offline cache. Open Offline Cache to launch a saved route.'
      );
      setCacheModalOpen(true);
      return;
    }

    try {
      // Phase 1: Trace walking route across all waypoints
      setProgress({
        phase: 'tracing',
        message: 'Tracing pedestrian walking route...',
        totalBuildings: 0,
        completedBuildings: 0,
        positiveBuildings: 0,
      });

      const routeRes = await fetch('/api/maps/compute-route', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          provider: settings.mapProvider,
          waypoints: filledWaypoints.map((w) => ({
            label: w.label.trim(),
            coords: w.coords,
          })),
        }),
      });

      const routeData = (await routeRes.json()) as ComputedRoute & {
        error?: string;
        quotaExceeded?: boolean;
      };

      if (
        settings.mapProvider === 'google' &&
        (routeRes.status === 429 || routeData.quotaExceeded)
      ) {
        window.dispatchEvent(new CustomEvent('gmp-quota-exceeded'));
      }
      if (!routeRes.ok || !routeData.path || routeData.path.length < 2) {
        throw new Error(
          routeData.error ||
            'Could not compute a walking route between those waypoints.'
        );
      }

      const computedRoute: ComputedRoute = {
        ...routeData,
        originLabel,
        destinationLabel,
      };
      setActiveRoute(computedRoute);
      setUserLocation(computedRoute.path[0] || computedRoute.origin);
      setVisitedBuildingIds([]);
      setBuildings([]);
      setAnalyzedBuildings([]);
      setActiveBuildingId(null);

      // Phase 2: Select buildings by street address within allowable deviation range
      setProgress({
        phase: 'scanning',
        message: `Scanning street addresses within ±${settings.deviationMeters}m...`,
        totalBuildings: 0,
        completedBuildings: 0,
        positiveBuildings: 0,
      });

      const scanRes = await fetch('/api/maps/discover-buildings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          provider: settings.mapProvider,
          path: computedRoute.path,
          deviationMeters: settings.deviationMeters,
        }),
      });

      const scanData = (await scanRes.json()) as {
        buildings?: DiscoveredBuilding[];
        error?: string;
        quotaExceeded?: boolean;
        quotaTriggered?: boolean;
      };

      if (
        settings.mapProvider === 'google' &&
        (scanRes.status === 429 ||
          scanData.quotaExceeded ||
          scanData.quotaTriggered)
      ) {
        window.dispatchEvent(new CustomEvent('gmp-quota-exceeded'));
      }
      if (!scanRes.ok) {
        throw new Error(
          scanData.error || 'Failed to discover buildings along the route.'
        );
      }

      const candidates = scanData.buildings || [];
      if (candidates.length === 0) {
        setProgress(null);
        setErrorBanner(
          `No street-addressed buildings were found within ±${settings.deviationMeters}m of this route. Try increasing the allowable deviation range in Settings.`
        );
        return;
      }

      // Phase 3: Submit search queries per building & selected categories
      setProgress({
        phase: 'researching',
        message: 'Searching building records...',
        totalBuildings: candidates.length,
        completedBuildings: 0,
        positiveBuildings: 0,
        currentAddress: candidates[0].streetAddress,
      });

      const analyzedCollected: ResearchedBuilding[] = [];
      const positiveCollected: ResearchedBuilding[] = [];
      let completedCount = 0;
      let firstResearchError: string | null = null;

      const researchOne = async (candidate: DiscoveredBuilding) => {
        if (controller.signal.aborted) return;

        // Check offline cache first for existing positive categories
        const cached = await getCachedBuildingByAddress(
          candidate.normalizedAddress
        );
        const cachedFindings = cached?.findings || [];
        const missingCategories = settings.selectedCategories.filter(
          (catId) => !cachedFindings.some((f) => f.categoryId === catId)
        );

        let allFindings: CategoryFinding[] = cachedFindings.filter((f) =>
          settings.selectedCategories.includes(f.categoryId)
        );
        let rawAiResponse: string | undefined;

        if (missingCategories.length > 0) {
          const buildingLabel = candidate.displayName
            ? `${candidate.streetAddress} (${candidate.displayName})`
            : candidate.streetAddress;

          try {
            const res = await fetch('/api/buildings/research', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              signal: controller.signal,
              body: JSON.stringify({
                building: candidate,
                categories: missingCategories,
              }),
            });

            const data = (await res.json().catch(() => ({}))) as {
              findings?: CategoryFinding[];
              rawAiResponse?: string;
              error?: string;
            };

            if (!res.ok && data.error && !firstResearchError) {
              firstResearchError = data.error;
            }

            if (Array.isArray(data.findings) && data.findings.length > 0) {
              allFindings = [...allFindings, ...data.findings];
            } else {
              const fallbackMsg =
                data.error || `Gemini API request failed (HTTP ${res.status}).`;
              if (!firstResearchError) firstResearchError = fallbackMsg;
              allFindings = [
                ...allFindings,
                ...missingCategories.map((catId) => ({
                  categoryId: catId,
                  queryUsed:
                    CATEGORY_MAP[catId]?.queryTemplate.replace(
                      '{ADDRESS}',
                      buildingLabel
                    ) || `${catId}: ${buildingLabel}`,
                  isNotable: false,
                  headline: `AI Error (${res.status})`,
                  summary: fallbackMsg,
                  wordCount: 0,
                  sources: [],
                })),
              ];
            }
            rawAiResponse = data.rawAiResponse || data.error;
          } catch (fetchErr: unknown) {
            if ((fetchErr as Error)?.name === 'AbortError') throw fetchErr;
            const errMsg =
              fetchErr instanceof Error
                ? fetchErr.message
                : 'Network error contacting research endpoint.';
            if (!firstResearchError) firstResearchError = errMsg;
            allFindings = [
              ...allFindings,
              ...missingCategories.map((catId) => ({
                categoryId: catId,
                queryUsed:
                  CATEGORY_MAP[catId]?.queryTemplate.replace(
                    '{ADDRESS}',
                    buildingLabel
                  ) || `${catId}: ${buildingLabel}`,
                isNotable: false,
                headline: 'Request Error',
                summary: errMsg,
                wordCount: 0,
                sources: [],
              })),
            ];
            rawAiResponse = errMsg;
          }
        }

        const positiveFindings = allFindings.filter((f) => f.isNotable);
        completedCount += 1;

        const researched: ResearchedBuilding = {
          ...candidate,
          findings: allFindings,
          positiveCount: positiveFindings.length,
          researchedAt: Date.now(),
          cachedOffline: settings.cacheForOffline || Boolean(cached),
          rawAiResponse,
        };

        analyzedCollected.push(researched);
        const orderedAnalyzed = [...analyzedCollected].sort(
          (a, b) => a.routeProgressMeters - b.routeProgressMeters
        );
        setAnalyzedBuildings(orderedAnalyzed);

        if (positiveFindings.length > 0) {
          positiveCollected.push(researched);
          const orderedPositive = [...positiveCollected].sort(
            (a, b) => a.routeProgressMeters - b.routeProgressMeters
          );
          setBuildings(orderedPositive);
          setActiveBuildingId((cur) => cur || orderedPositive[0]?.id || null);

          if (settings.cacheForOffline) {
            await savePositiveBuildingToCache(researched);
          }
        }

        setProgress({
          phase: 'researching',
          message: 'Searching building records...',
          totalBuildings: candidates.length,
          completedBuildings: completedCount,
          positiveBuildings: positiveCollected.length,
          currentAddress: candidate.streetAddress,
        });
      };

      const CONCURRENCY = 6;
      for (let i = 0; i < candidates.length; i += CONCURRENCY) {
        if (controller.signal.aborted) break;
        const batch = candidates.slice(i, i + CONCURRENCY);
        await Promise.all(batch.map((c) => researchOne(c)));
      }

      if (controller.signal.aborted) return;

      if (firstResearchError) {
        setErrorBanner(`Search notice: ${firstResearchError}`);
      }

      const finalAnalyzed = [...analyzedCollected].sort(
        (a, b) => a.routeProgressMeters - b.routeProgressMeters
      );
      const finalOrdered = [...positiveCollected].sort(
        (a, b) => a.routeProgressMeters - b.routeProgressMeters
      );
      setAnalyzedBuildings(finalAnalyzed);
      setBuildings(finalOrdered);

      // Phase 4: Cache route bundle for offline mode if enabled
      if (settings.cacheForOffline && finalOrdered.length > 0) {
        setProgress({
          phase: 'caching',
          message: 'Saving positive results to offline cache...',
          totalBuildings: candidates.length,
          completedBuildings: candidates.length,
          positiveBuildings: finalOrdered.length,
        });

        await saveRouteBundleToCache({
          id: routeKey,
          routeKey,
          originLabel,
          destinationLabel,
          waypointLabels,
          route: computedRoute,
          deviationMeters: settings.deviationMeters,
          selectedCategories: settings.selectedCategories,
          buildings: finalOrdered,
          analyzedBuildings: finalAnalyzed,
          mapProvider: settings.mapProvider,
          savedAt: Date.now(),
        });
        await refreshCacheStats();
      }

      setProgress({
        phase: 'ready',
        message: 'Discovery complete',
        totalBuildings: candidates.length,
        completedBuildings: candidates.length,
        positiveBuildings: finalOrdered.length,
      });

      setActiveBuildingId(finalOrdered[0]?.id || null);
      setScreen('guide');
    } catch (err: unknown) {
      if ((err as Error)?.name === 'AbortError') return;
      const msg =
        err instanceof Error ? err.message : 'Discovery failed unexpectedly.';
      setProgress({
        phase: 'error',
        message: 'Discovery stopped',
        totalBuildings: 0,
        completedBuildings: 0,
        positiveBuildings: 0,
        error: msg,
      });
      setErrorBanner(msg);
    }
  };

  const mapsReady = Boolean(mapsApiKey) && !isOffline;
  const isSplitScreen = screen === 'planner' || screen === 'guide';

  const content = (
    <div className="h-screen w-screen flex flex-col overflow-hidden bg-[#f9f9ff]">
      {/* Demo Key Tier 2 Quota Banner (only relevant while Google Maps is selected) */}
      {quotaExceeded && settings.mapProvider === 'google' && (
        <div className="bg-amber-50 border-b border-amber-200 text-amber-900 px-4 py-2.5 text-xs md:text-sm text-center sticky top-0 z-50 shadow-sm shrink-0">
          <span>
            Google Maps Platform quota reached. If you are the app owner, visit{' '}
            <a
              href="https://developers.google.com/maps/ai/ai-studio?utm_campaign=gmp_mcp_codeassist_v1_aistudio#quota_exceeded_errors"
              target="_blank"
              rel="noopener noreferrer"
              className="underline font-semibold text-amber-950 hover:text-amber-800"
            >
              maps developer site
            </a>{' '}
            for instructions to update your account.
          </span>
        </div>
      )}

      {/* Clean 3-Zone Top Bar */}
      <header className="h-14 px-4 sm:px-6 bg-white border-b border-[#e7eeff] flex items-center justify-between gap-4 sm:gap-8 shrink-0 z-30">
        {/* Zone 1: Single-line Wordmark */}
        <button
          type="button"
          onClick={() => setScreen('planner')}
          className="text-lg font-extrabold tracking-tight text-[#111c2d] whitespace-nowrap shrink-0 cursor-pointer"
        >
          WanderAudio
        </button>

        {/* Zone 2: Concise single-line navigation links */}
        <nav className="flex items-center gap-3 sm:gap-5 text-xs sm:text-sm font-semibold overflow-x-auto no-scrollbar">
          <button
            type="button"
            onClick={() => setScreen('planner')}
            className={`py-1 border-b-2 transition-colors whitespace-nowrap shrink-0 ${
              screen === 'planner'
                ? 'border-[#E06D53] text-[#111c2d]'
                : 'border-transparent text-[#57423d] hover:text-[#111c2d]'
            }`}
          >
            Route Setup
          </button>
          <button
            type="button"
            disabled={!activeRoute}
            onClick={() => activeRoute && setScreen('guide')}
            className={`py-1 border-b-2 transition-colors whitespace-nowrap shrink-0 disabled:opacity-40 ${
              screen === 'guide'
                ? 'border-[#0D9488] text-[#111c2d]'
                : 'border-transparent text-[#57423d] hover:text-[#111c2d]'
            }`}
          >
            Audio Guide
          </button>
          <button
            type="button"
            onClick={() => setScreen('settings')}
            className={`py-1 border-b-2 transition-colors whitespace-nowrap shrink-0 ${
              screen === 'settings'
                ? 'border-[#0D9488] text-[#111c2d]'
                : 'border-transparent text-[#57423d] hover:text-[#111c2d]'
            }`}
          >
            Settings
          </button>
          <button
            type="button"
            onClick={() => setScreen('debug')}
            className={`py-1 border-b-2 transition-colors whitespace-nowrap shrink-0 ${
              screen === 'debug'
                ? 'border-[#0D9488] text-[#111c2d]'
                : 'border-transparent text-[#57423d] hover:text-[#111c2d]'
            }`}
          >
            Debug
          </button>
          <button
            type="button"
            onClick={() => setCacheModalOpen(true)}
            className="py-1 border-b-2 border-transparent text-[#57423d] hover:text-[#111c2d] transition-colors whitespace-nowrap shrink-0"
          >
            Offline Cache
          </button>
        </nav>

        {/* Zone 3: Single Primary Action / Connectivity Toggle */}
        <div className="shrink-0">
          <button
            type="button"
            onClick={() => setSimulatedOffline((v) => !v)}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold inline-flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0 ${
              isOffline
                ? 'bg-[#ffdad6] text-[#93000a]'
                : 'bg-[#f0f3ff] text-[#111c2d] hover:bg-[#dee8ff]'
            }`}
            title="Toggle simulated offline mode to test cached routes without Internet"
          >
            {isOffline ? (
              <>
                <WifiOff className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Offline Active</span>
                <span className="sm:hidden">Offline</span>
              </>
            ) : (
              <>
                <Wifi className="w-3.5 h-3.5 text-[#0D9488]" />
                <span className="hidden sm:inline">Online</span>
              </>
            )}
          </button>
        </div>
      </header>

      {/* Main Workspace */}
      {isSplitScreen ? (
        <main className="flex-1 min-h-0 flex flex-col-reverse lg:flex-row">
          {/* Left / Bottom Panel: Route Setup or Active Audio Guide */}
          <div className="w-full lg:w-[480px] xl:w-[520px] h-[58%] lg:h-full border-t lg:border-t-0 lg:border-r border-[#e7eeff] min-h-0 flex flex-col shrink-0 z-20">
            {screen === 'planner' || !activeRoute ? (
              <RoutePlannerView
                waypoints={waypoints}
                onUpdateWaypoint={handleUpdateWaypoint}
                onAddWaypoint={handleAddWaypoint}
                onRemoveWaypoint={handleRemoveWaypoint}
                onMoveWaypoint={handleMoveWaypoint}
                onLoadPresetWaypoints={handleLoadPresetWaypoints}
                onStartDiscovery={() => void handleStartDiscovery()}
                onSkipToActiveGuide={
                  activeRoute ? () => setScreen('guide') : undefined
                }
                hasActiveTour={Boolean(activeRoute)}
                progress={progress}
                isOffline={isOffline}
                errorBanner={errorBanner}
                placesEnabled={mapsReady}
                mapProvider={settings.mapProvider}
              />
            ) : (
              <ActiveGuideView
                route={activeRoute}
                buildings={buildings}
                settings={settings}
                userLocation={userLocation}
                onUpdateUserLocation={setUserLocation}
                activeBuildingId={activeBuildingId}
                onSelectActiveBuilding={setActiveBuildingId}
                visitedBuildingIds={visitedBuildingIds}
                onMarkBuildingVisited={handleMarkBuildingVisited}
                onBackToPlanner={() => setScreen('planner')}
                onUpdateSettings={handleUpdateSettings}
                isOffline={isOffline}
              />
            )}
          </div>

          {/* Right / Top Panel: Interactive Map Canvas */}
          <div className="flex-1 h-[42%] lg:h-full min-h-[240px] relative">
            <TourMap
              provider={settings.mapProvider}
              appleMapsToken={appleMapsToken}
              route={activeRoute}
              deviationMeters={settings.deviationMeters}
              buildings={buildings}
              activeBuildingId={activeBuildingId}
              visitedBuildingIds={visitedBuildingIds}
              userLocation={userLocation}
              onSelectBuilding={(id) => {
                setActiveBuildingId(id);
                if (activeRoute) setScreen('guide');
              }}
              onMapClickLocation={(coords) => {
                if (screen === 'guide') {
                  setUserLocation(coords);
                }
              }}
              isOffline={isOffline}
              mapsReady={mapsReady}
            />
          </div>
        </main>
      ) : screen === 'settings' ? (
        <main className="flex-1 min-h-0 flex flex-col">
          <SettingsView
            settings={settings}
            onUpdateSettings={handleUpdateSettings}
            cacheStats={cacheStats}
            onOpenCacheModal={() => setCacheModalOpen(true)}
            providerAvailability={providerAvailability}
          />
        </main>
      ) : (
        <main className="flex-1 min-h-0 flex flex-col">
          <DebugView
            route={activeRoute}
            deviationMeters={settings.deviationMeters}
            analyzedBuildings={analyzedBuildings}
            selectedCategories={settings.selectedCategories}
          />
        </main>
      )}

      <OfflineCacheModal
        isOpen={cacheModalOpen}
        onClose={() => setCacheModalOpen(false)}
        onLoadCachedRoute={handleLoadCachedBundle}
        onCacheUpdated={() => void refreshCacheStats()}
      />
    </div>
  );

  if (!mapsApiKey) {
    return content;
  }

  return (
    <APIProvider
      apiKey={mapsApiKey}
      libraries={['places', 'marker']}
      language="en"
      region="US"
    >
      {content}
    </APIProvider>
  );
}
