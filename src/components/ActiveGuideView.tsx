import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  CheckCircle2,
  Database,
  ExternalLink,
  Footprints,
  LocateFixed,
  Navigation,
  Pause,
  Play,
  RotateCcw,
  SkipBack,
  SkipForward,
  Volume2,
  WifiOff,
} from 'lucide-react';
import { CATEGORY_MAP } from '../constants/categories';
import type {
  CategoryFinding,
  CategoryId,
  ComputedRoute,
  GuideSettings,
  LatLngLiteral,
  ResearchedBuilding,
} from '../types/tour';
import {
  computeCumulativeDistances,
  formatMeters,
  haversineMeters,
  interpolatePositionAlongPath,
  pointToPolylineDistance,
} from '../utils/geo';
import {
  getAudioClipFromCache,
  saveAudioClipToCache,
} from '../utils/offlineCache';

interface AudioSegment {
  id: string;
  buildingId: string;
  categoryId: CategoryId;
  categoryLabel: string;
  headline: string;
  text: string;
  isRecap?: boolean;
}

interface ActiveGuideViewProps {
  route: ComputedRoute;
  buildings: ResearchedBuilding[];
  settings: GuideSettings;
  userLocation: LatLngLiteral | null;
  onUpdateUserLocation: (coords: LatLngLiteral) => void;
  activeBuildingId: string | null;
  onSelectActiveBuilding: (id: string | null) => void;
  visitedBuildingIds: string[];
  onMarkBuildingVisited: (id: string) => void;
  onBackToPlanner: () => void;
  onUpdateSettings: (partial: Partial<GuideSettings>) => void;
  isOffline: boolean;
}

function splitTextIntoChunks(text: string, maxChars = 1100): string[] {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (!clean) return [];
  if (clean.length <= maxChars) return [clean];

  const sentences = clean.match(/[^.!?]+[.!?]+(\s|$)/g) || [clean];
  const chunks: string[] = [];
  let current = '';

  for (const s of sentences) {
    if ((current + s).length > maxChars && current.trim().length > 0) {
      chunks.push(current.trim());
      current = s;
    } else {
      current += s;
    }
  }
  if (current.trim().length > 0) {
    chunks.push(current.trim());
  }
  return chunks;
}

function buildBuildingPlaylist(
  building: ResearchedBuilding,
  isRecap = false,
  recapText?: string
): AudioSegment[] {
  const label = building.displayName
    ? `${building.displayName}, at ${building.streetAddress}`
    : building.streetAddress;

  if (isRecap && recapText) {
    const firstPos = building.findings.find((f) => f.isNotable);
    return [
      {
        id: `${building.id}::recap`,
        buildingId: building.id,
        categoryId: firstPos?.categoryId || 'historical',
        categoryLabel: 'Brief Recap',
        headline: `Revisited: ${building.streetAddress}`,
        text: recapText,
        isRecap: true,
      },
    ];
  }

  const positiveFindings = building.findings.filter((f) => f.isNotable);
  const segments: AudioSegment[] = [];

  positiveFindings.forEach((finding, fIdx) => {
    const catName = CATEGORY_MAP[finding.categoryId]?.label || finding.categoryId;
    const chunks = splitTextIntoChunks(finding.summary, 1100);
    chunks.forEach((chunkText, cIdx) => {
      const intro =
        cIdx === 0
          ? fIdx === 0
            ? `Approaching ${label}. ${catName}: ${finding.headline}. `
            : `Next category, ${catName}: ${finding.headline}. `
          : '';
      segments.push({
        id: `${building.id}::${finding.categoryId}::${cIdx}`,
        buildingId: building.id,
        categoryId: finding.categoryId,
        categoryLabel: catName,
        headline: finding.headline,
        text: `${intro}${chunkText}`,
      });
    });
  });

  return segments;
}

export const ActiveGuideView: React.FC<ActiveGuideViewProps> = ({
  route,
  buildings,
  settings,
  userLocation,
  onUpdateUserLocation,
  activeBuildingId,
  onSelectActiveBuilding,
  visitedBuildingIds,
  onMarkBuildingVisited,
  onBackToPlanner,
  onUpdateSettings,
  isOffline,
}) => {
  const [locationMode, setLocationMode] = useState<'gps' | 'sim'>('sim');
  const [simPlaying, setSimPlaying] = useState(false);
  const [simProgressMeters, setSimProgressMeters] = useState(0);

  const [selectedCategoryTab, setSelectedCategoryTab] =
    useState<CategoryId | null>(null);
  const [playlist, setPlaylist] = useState<AudioSegment[]>([]);
  const [segmentIndex, setSegmentIndex] = useState(0);
  const [isPlayingAudio, setIsPlayingAudio] = useState(false);
  const [isLoadingAudio, setIsLoadingAudio] = useState(false);
  const [audioSourceLabel, setAudioSourceLabel] = useState<
    'Gemini TTS' | 'Offline Cache' | 'Device Speech'
  >('Gemini TTS');
  const [audioProgressPct, setAudioProgressPct] = useState(0);
  const [audioTimeText, setAudioTimeText] = useState('00:00 / 00:00');

  const [revisitedPromptBuilding, setRevisitedPromptBuilding] =
    useState<ResearchedBuilding | null>(null);

  const audioElRef = useRef<HTMLAudioElement | null>(null);
  const audioUrlCacheRef = useRef<Record<string, string>>({});
  const lastTriggeredRef = useRef<string | null>(null);
  const isPlayingRef = useRef(false);
  const speechUtteranceRef = useRef<SpeechSynthesisUtterance | null>(null);

  const cumulative = useMemo(
    () => computeCumulativeDistances(route.path),
    [route.path]
  );
  const totalRouteMeters = cumulative[cumulative.length - 1] || route.distanceMeters;

  const visitedSet = useMemo(
    () => new Set(visitedBuildingIds),
    [visitedBuildingIds]
  );

  // Initialize starting user location at route origin if unset
  useEffect(() => {
    if (!userLocation && route.path.length > 0) {
      onUpdateUserLocation(route.path[0]);
      setSimProgressMeters(0);
    }
  }, [userLocation, route.path, onUpdateUserLocation]);

  // Real GPS watchPosition when locationMode === 'gps'
  useEffect(() => {
    if (locationMode !== 'gps' || !navigator.geolocation) return;
    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        onUpdateUserLocation({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
        });
      },
      (err) => {
        console.warn('GPS watch warning:', err.message);
      },
      { enableHighAccuracy: true, maximumAge: 3000, timeout: 10000 }
    );
    return () => navigator.geolocation.clearWatch(watchId);
  }, [locationMode, onUpdateUserLocation]);

  // Simulated Walker Auto-Walk loop
  useEffect(() => {
    if (locationMode !== 'sim' || !simPlaying) return;
    const timer = window.setInterval(() => {
      setSimProgressMeters((prev) => {
        const next = Math.min(totalRouteMeters, prev + 14);
        const interp = interpolatePositionAlongPath(route.path, next);
        onUpdateUserLocation(interp.position);
        if (next >= totalRouteMeters) {
          setSimPlaying(false);
        }
        return next;
      });
    }, 1000);
    return () => window.clearInterval(timer);
  }, [locationMode, simPlaying, totalRouteMeters, route.path, onUpdateUserLocation]);

  const stopAllAudio = useCallback(() => {
    isPlayingRef.current = false;
    setIsPlayingAudio(false);
    if (audioElRef.current) {
      audioElRef.current.pause();
      audioElRef.current.onended = null;
      audioElRef.current.ontimeupdate = null;
    }
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
  }, []);

  // Cleanup audio on unmount
  useEffect(() => {
    return () => {
      stopAllAudio();
    };
  }, [stopAllAudio]);

  // Helper to fetch/cache audio for a segment
  const resolveSegmentAudioUrl = useCallback(
    async (segment: AudioSegment): Promise<{ url: string; source: 'Gemini TTS' | 'Offline Cache' } | null> => {
      const cacheKey = `${segment.id}::${settings.voiceName}`;
      if (audioUrlCacheRef.current[cacheKey]) {
        return { url: audioUrlCacheRef.current[cacheKey], source: 'Offline Cache' };
      }

      // 1. Check IndexedDB offline cache first
      const cached = await getAudioClipFromCache(cacheKey);
      if (cached?.audioBase64) {
        const url = `data:${cached.mimeType || 'audio/wav'};base64,${cached.audioBase64}`;
        audioUrlCacheRef.current[cacheKey] = url;
        return { url, source: 'Offline Cache' };
      }

      if (isOffline) {
        return null;
      }

      // 2. Request Gemini TTS from server
      try {
        const res = await fetch('/api/tts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            text: segment.text,
            voiceName: settings.voiceName,
          }),
        });
        if (!res.ok) return null;
        const data = (await res.json()) as {
          audioBase64?: string;
          mimeType?: string;
        };
        if (!data.audioBase64) return null;

        if (settings.cacheForOffline) {
          void saveAudioClipToCache(
            cacheKey,
            data.audioBase64,
            data.mimeType || 'audio/wav'
          );
        }

        const url = `data:${data.mimeType || 'audio/wav'};base64,${data.audioBase64}`;
        audioUrlCacheRef.current[cacheKey] = url;
        return { url, source: 'Gemini TTS' };
      } catch {
        return null;
      }
    },
    [settings.voiceName, settings.cacheForOffline, isOffline]
  );

  const playSegmentAt = useCallback(
    async (list: AudioSegment[], idx: number) => {
      if (idx < 0 || idx >= list.length) {
        stopAllAudio();
        const finishedBuildingId = list[0]?.buildingId;
        if (finishedBuildingId) {
          onMarkBuildingVisited(finishedBuildingId);
        }
        return;
      }

      const segment = list[idx];
      setSegmentIndex(idx);
      setSelectedCategoryTab(segment.categoryId);
      setIsLoadingAudio(true);
      isPlayingRef.current = true;
      setIsPlayingAudio(true);

      // Stop any previous audio without resetting isPlayingRef
      if (audioElRef.current) {
        audioElRef.current.pause();
        audioElRef.current.onended = null;
      }
      if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
        window.speechSynthesis.cancel();
      }

      const resolved = await resolveSegmentAudioUrl(segment);
      if (!isPlayingRef.current) {
        setIsLoadingAudio(false);
        return;
      }

      // Prefetch next chunk in background
      if (idx + 1 < list.length) {
        void resolveSegmentAudioUrl(list[idx + 1]);
      }

      setIsLoadingAudio(false);

      if (resolved) {
        setAudioSourceLabel(resolved.source);
        const audio = audioElRef.current || new Audio();
        audioElRef.current = audio;
        audio.src = resolved.url;
        audio.playbackRate = settings.playbackRate;

        const fmt = (sec: number) => {
          if (!Number.isFinite(sec) || sec < 0) return '00:00';
          const m = Math.floor(sec / 60);
          const s = Math.floor(sec % 60);
          return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
        };

        audio.ontimeupdate = () => {
          if (audio.duration > 0) {
            const segPct = audio.currentTime / audio.duration;
            const overallPct = ((idx + segPct) / list.length) * 100;
            setAudioProgressPct(overallPct);
            setAudioTimeText(`${fmt(audio.currentTime)} / ${fmt(audio.duration)}`);
          }
        };

        audio.onended = () => {
          if (!isPlayingRef.current) return;
          if (idx + 1 < list.length) {
            void playSegmentAt(list, idx + 1);
          } else {
            stopAllAudio();
            onMarkBuildingVisited(segment.buildingId);
            setAudioProgressPct(100);
          }
        };

        try {
          await audio.play();
        } catch {
          // Autoplay blocked or error -> fall back to speechSynthesis
          setAudioSourceLabel('Device Speech');
          if ('speechSynthesis' in window) {
            const utt = new SpeechSynthesisUtterance(segment.text);
            utt.rate = settings.playbackRate;
            speechUtteranceRef.current = utt;
            utt.onend = () => {
              if (isPlayingRef.current) {
                void playSegmentAt(list, idx + 1);
              }
            };
            window.speechSynthesis.speak(utt);
          }
        }
      } else if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
        // Offline without pre-cached WAV -> seamless browser speech fallback
        setAudioSourceLabel('Device Speech');
        const utt = new SpeechSynthesisUtterance(segment.text);
        utt.rate = settings.playbackRate;
        speechUtteranceRef.current = utt;
        setAudioProgressPct(((idx + 0.5) / list.length) * 100);
        setAudioTimeText(`Part ${idx + 1}/${list.length}`);
        utt.onend = () => {
          if (!isPlayingRef.current) return;
          if (idx + 1 < list.length) {
            void playSegmentAt(list, idx + 1);
          } else {
            stopAllAudio();
            onMarkBuildingVisited(segment.buildingId);
            setAudioProgressPct(100);
          }
        };
        window.speechSynthesis.speak(utt);
      } else {
        setIsPlayingAudio(false);
        isPlayingRef.current = false;
      }
    },
    [
      resolveSegmentAudioUrl,
      settings.playbackRate,
      stopAllAudio,
      onMarkBuildingVisited,
    ]
  );

  // Sync playback rate live
  useEffect(() => {
    if (audioElRef.current) {
      audioElRef.current.playbackRate = settings.playbackRate;
    }
  }, [settings.playbackRate]);

  const startNarrationForBuilding = useCallback(
    (building: ResearchedBuilding, startCategory?: CategoryId) => {
      onSelectActiveBuilding(building.id);
      onMarkBuildingVisited(building.id);
      const list = buildBuildingPlaylist(building);
      setPlaylist(list);
      if (list.length === 0) return;

      let startIdx = 0;
      if (startCategory) {
        const foundIdx = list.findIndex((s) => s.categoryId === startCategory);
        if (foundIdx >= 0) startIdx = foundIdx;
      }
      void playSegmentAt(list, startIdx);
    },
    [onSelectActiveBuilding, onMarkBuildingVisited, playSegmentAt]
  );

  const startBriefRecapForBuilding = useCallback(
    async (building: ResearchedBuilding) => {
      onSelectActiveBuilding(building.id);
      const positive = building.findings.filter((f) => f.isNotable);
      let recapText = `You are passing ${
        building.displayName || building.streetAddress
      } again. Earlier we explored ${positive
        .map((f) => f.headline)
        .join(' and ')}.`;

      if (!isOffline) {
        try {
          const res = await fetch('/api/buildings/recap', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              streetAddress: building.streetAddress,
              displayName: building.displayName,
              findings: positive,
            }),
          });
          if (res.ok) {
            const data = (await res.json()) as { recapText?: string };
            if (data.recapText) recapText = data.recapText;
          }
        } catch {
          // Keep deterministic fallback recap
        }
      }

      const list = buildBuildingPlaylist(building, true, recapText);
      setPlaylist(list);
      void playSegmentAt(list, 0);
    },
    [isOffline, onSelectActiveBuilding, playSegmentAt]
  );

  // Proximity detection engine: watches userLocation and detects nearby buildings
  const triggerRadiusMeters = Math.max(30, Math.min(85, settings.deviationMeters));

  useEffect(() => {
    if (!userLocation || buildings.length === 0 || !settings.autoTriggerProximity) {
      return;
    }

    // Find closest building within triggerRadiusMeters
    let nearest: ResearchedBuilding | null = null;
    let nearestDist = Infinity;

    for (const b of buildings) {
      const d = haversineMeters(userLocation, b.location);
      if (d <= triggerRadiusMeters && d < nearestDist) {
        nearestDist = d;
        nearest = b;
      }
    }

    if (!nearest) {
      // Clear lastTriggeredRef once user moves outside all trigger radii so revisiting works!
      if (lastTriggeredRef.current) {
        const prevB = buildings.find((b) => b.id === lastTriggeredRef.current);
        if (prevB && haversineMeters(userLocation, prevB.location) > triggerRadiusMeters + 15) {
          lastTriggeredRef.current = null;
        }
      }
      return;
    }

    if (lastTriggeredRef.current === nearest.id) return;
    lastTriggeredRef.current = nearest.id;

    // Check if user has already been told about this building
    const alreadyVisited = visitedSet.has(nearest.id);
    if (!alreadyVisited) {
      startNarrationForBuilding(nearest);
      return;
    }

    // Apply "what to do with revisited sites" selector!
    switch (settings.revisitedBehavior) {
      case 'skip':
        onSelectActiveBuilding(nearest.id);
        break;
      case 'brief_recap':
        void startBriefRecapForBuilding(nearest);
        break;
      case 'replay':
        startNarrationForBuilding(nearest);
        break;
      case 'prompt':
        onSelectActiveBuilding(nearest.id);
        setRevisitedPromptBuilding(nearest);
        break;
    }
  }, [
    userLocation,
    buildings,
    triggerRadiusMeters,
    settings.autoTriggerProximity,
    settings.revisitedBehavior,
    visitedSet,
    startNarrationForBuilding,
    startBriefRecapForBuilding,
    onSelectActiveBuilding,
  ]);

  const activeBuilding = useMemo(
    () =>
      buildings.find((b) => b.id === activeBuildingId) || buildings[0] || null,
    [buildings, activeBuildingId]
  );

  // Sync category tab when active building changes
  useEffect(() => {
    if (!activeBuilding) return;
    const firstPositive = activeBuilding.findings.find((f) => f.isNotable);
    setSelectedCategoryTab(firstPositive?.categoryId || null);
  }, [activeBuilding]);

  const activeFinding: CategoryFinding | null = useMemo(() => {
    if (!activeBuilding) return null;
    const positive = activeBuilding.findings.filter((f) => f.isNotable);
    if (positive.length === 0) return null;
    return (
      positive.find((f) => f.categoryId === selectedCategoryTab) || positive[0]
    );
  }, [activeBuilding, selectedCategoryTab]);

  // Compute current walking step maneuver & next unvisited building distance
  const userProgress = useMemo(() => {
    if (!userLocation) return 0;
    return pointToPolylineDistance(userLocation, route.path, cumulative)
      .routeProgressMeters;
  }, [userLocation, route.path, cumulative]);

  const nextUnvisitedBuilding = useMemo(() => {
    return (
      buildings.find(
        (b) => !visitedSet.has(b.id) && b.routeProgressMeters >= userProgress - 20
      ) ||
      buildings.find((b) => !visitedSet.has(b.id)) ||
      null
    );
  }, [buildings, visitedSet, userProgress]);

  const nextStepCue = useMemo(() => {
    if (!userLocation || route.steps.length === 0) {
      return { instruction: 'Follow highlighted walking trail', distMeters: 0 };
    }
    let best = route.steps[0];
    let bestDist = Infinity;
    for (const st of route.steps) {
      const d = haversineMeters(userLocation, st.startLocation);
      if (d < bestDist) {
        bestDist = d;
        best = st;
      }
    }
    return { instruction: best.instruction, distMeters: best.distanceMeters };
  }, [userLocation, route.steps]);

  const handleTogglePlayPause = () => {
    if (!activeBuilding) return;
    if (isPlayingAudio) {
      isPlayingRef.current = false;
      setIsPlayingAudio(false);
      audioElRef.current?.pause();
      if ('speechSynthesis' in window) window.speechSynthesis.cancel();
    } else if (playlist.length > 0 && playlist[0]?.buildingId === activeBuilding.id) {
      if (audioElRef.current && audioElRef.current.src && audioSourceLabel !== 'Device Speech') {
        isPlayingRef.current = true;
        setIsPlayingAudio(true);
        void audioElRef.current.play();
      } else {
        void playSegmentAt(playlist, segmentIndex);
      }
    } else {
      startNarrationForBuilding(activeBuilding);
    }
  };

  const handleStepSimulatedWalk = (deltaMeters: number) => {
    setLocationMode('sim');
    const next = Math.max(0, Math.min(totalRouteMeters, simProgressMeters + deltaMeters));
    setSimProgressMeters(next);
    const interp = interpolatePositionAlongPath(route.path, next);
    onUpdateUserLocation(interp.position);
  };

  const handleJumpToBuilding = (b: ResearchedBuilding, playNow = true) => {
    setRevisitedPromptBuilding(null);
    if (locationMode === 'sim') {
      setSimProgressMeters(b.routeProgressMeters);
      onUpdateUserLocation(b.location);
    }
    lastTriggeredRef.current = b.id;
    if (playNow) {
      const alreadyVisited = visitedSet.has(b.id);
      if (alreadyVisited && settings.revisitedBehavior === 'brief_recap') {
        void startBriefRecapForBuilding(b);
      } else if (alreadyVisited && settings.revisitedBehavior === 'prompt') {
        onSelectActiveBuilding(b.id);
        setRevisitedPromptBuilding(b);
      } else {
        startNarrationForBuilding(b);
      }
    } else {
      onSelectActiveBuilding(b.id);
    }
  };

  const distanceToActive =
    userLocation && activeBuilding
      ? haversineMeters(userLocation, activeBuilding.location)
      : null;

  const positiveCategories = activeBuilding
    ? activeBuilding.findings.filter((f) => f.isNotable)
    : [];

  return (
    <div className="flex flex-col h-full bg-[#f9f9ff]">
      {/* Top Wayfinding & Location Mode Strip */}
      <div className="bg-[#263143] text-[#ecf1ff] px-4 py-3 space-y-2.5 shrink-0">
        <div className="flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={() => {
              stopAllAudio();
              onBackToPlanner();
            }}
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#cfdaf2] hover:text-white transition-colors py-1 pr-2"
          >
            <ArrowLeft className="w-4 h-4" />
            Route Setup
          </button>

          <div className="flex items-center gap-2">
            {isOffline && (
              <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#ffb4a3]">
                <WifiOff className="w-3.5 h-3.5" />
                Offline Mode
              </span>
            )}
            <div className="flex items-center p-0.5 bg-white/10 rounded-lg">
              <button
                type="button"
                onClick={() => setLocationMode('gps')}
                className={`px-2.5 py-1 rounded-md text-[11px] font-semibold transition-colors inline-flex items-center gap-1 ${
                  locationMode === 'gps'
                    ? 'bg-[#0D9488] text-white'
                    : 'text-[#cfdaf2] hover:text-white'
                }`}
              >
                <LocateFixed className="w-3 h-3" />
                Live GPS
              </button>
              <button
                type="button"
                onClick={() => setLocationMode('sim')}
                className={`px-2.5 py-1 rounded-md text-[11px] font-semibold transition-colors inline-flex items-center gap-1 ${
                  locationMode === 'sim'
                    ? 'bg-[#E06D53] text-white'
                    : 'text-[#cfdaf2] hover:text-white'
                }`}
              >
                <Footprints className="w-3 h-3" />
                Walk Sim
              </button>
            </div>
          </div>
        </div>

        {/* Turn cue + Next building distance */}
        <div className="flex items-center justify-between gap-3 bg-white/8 rounded-xl px-3 py-2">
          <div className="flex items-center gap-2 min-w-0">
            <Navigation className="w-4 h-4 text-[#86f2e4] shrink-0" />
            <span className="text-xs font-medium truncate">
              {nextStepCue.instruction}
            </span>
          </div>
          {nextUnvisitedBuilding && userLocation && (
            <span className="font-mono-timer text-[11px] text-[#86f2e4] shrink-0">
              Next stop:{' '}
              {formatMeters(
                haversineMeters(userLocation, nextUnvisitedBuilding.location)
              )}
            </span>
          )}
        </div>

        {/* Walk Simulator Scrubber (when in sim mode) */}
        {locationMode === 'sim' && (
          <div className="flex items-center gap-2.5 pt-0.5">
            <button
              type="button"
              onClick={() => setSimPlaying((p) => !p)}
              className="px-2.5 py-1 rounded-lg bg-[#0D9488] hover:bg-[#006a61] text-white text-[11px] font-semibold inline-flex items-center gap-1 shrink-0 min-h-[30px]"
            >
              {simPlaying ? (
                <>
                  <Pause className="w-3 h-3" /> Pause Walk
                </>
              ) : (
                <>
                  <Play className="w-3 h-3" /> Auto-Walk
                </>
              )}
            </button>
            <input
              type="range"
              min={0}
              max={Math.max(10, Math.round(totalRouteMeters))}
              value={Math.round(simProgressMeters)}
              onChange={(e) => {
                const next = Number(e.target.value);
                setSimProgressMeters(next);
                const interp = interpolatePositionAlongPath(route.path, next);
                onUpdateUserLocation(interp.position);
              }}
              aria-label="Simulate walking position along route"
              className="flex-1 carto-slider"
            />
            <button
              type="button"
              onClick={() => handleStepSimulatedWalk(35)}
              className="px-2 py-1 rounded-lg bg-white/12 hover:bg-white/20 text-[11px] font-mono-timer shrink-0"
            >
              +35m
            </button>
          </div>
        )}
      </div>

      {/* Main Scrollable Narrative & Stops Deck */}
      <div className="flex-1 overflow-y-auto carto-scroll px-5 py-4 space-y-5">
        {/* Revisited Site Prompt (when revisitedBehavior === 'prompt') */}
        {revisitedPromptBuilding && (
          <div className="bg-[#fffbff] border border-[#E06D53] rounded-2xl p-4 shadow-md space-y-3">
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="text-xs font-bold uppercase tracking-wider text-[#9e3c26]">
                  Revisited Building Detected
                </p>
                <p className="text-sm font-bold text-[#111c2d] mt-0.5">
                  You already heard about{' '}
                  {revisitedPromptBuilding.displayName ||
                    revisitedPromptBuilding.streetAddress}
                </p>
              </div>
              <RotateCcw className="w-4 h-4 text-[#E06D53] shrink-0 mt-1" />
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => {
                  const b = revisitedPromptBuilding;
                  setRevisitedPromptBuilding(null);
                  startNarrationForBuilding(b);
                }}
                className="px-3.5 py-2 rounded-xl bg-[#E06D53] text-white text-xs font-bold min-h-[40px]"
              >
                Replay Full Story
              </button>
              <button
                type="button"
                onClick={() => {
                  const b = revisitedPromptBuilding;
                  setRevisitedPromptBuilding(null);
                  void startBriefRecapForBuilding(b);
                }}
                className="px-3.5 py-2 rounded-xl bg-[#0D9488] text-white text-xs font-bold min-h-[40px]"
              >
                Brief Recap
              </button>
              <button
                type="button"
                onClick={() => setRevisitedPromptBuilding(null)}
                className="px-3.5 py-2 rounded-xl bg-[#f0f3ff] text-[#57423d] text-xs font-semibold min-h-[40px]"
              >
                Skip
              </button>
            </div>
          </div>
        )}

        {/* Active Building Narrative Reader */}
        {activeBuilding ? (
          <article className="bg-white rounded-2xl border border-[#ddc0ba]/50 p-5 space-y-4 shadow-xs">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2 text-xs text-[#57423d]">
                  <span className="font-mono-timer font-bold text-[#0D9488]">
                    Stop{' '}
                    {buildings.findIndex((b) => b.id === activeBuilding.id) + 1}{' '}
                    of {buildings.length}
                  </span>
                  {distanceToActive !== null && (
                    <>
                      <span aria-hidden="true">·</span>
                      <span className="font-mono-timer">
                        {formatMeters(distanceToActive)} away
                      </span>
                    </>
                  )}
                  <span aria-hidden="true">·</span>
                  <span className="font-mono-timer">
                    {activeBuilding.distanceFromRouteMeters}m off path
                  </span>
                  {visitedSet.has(activeBuilding.id) && (
                    <>
                      <span aria-hidden="true">·</span>
                      <span className="inline-flex items-center gap-1 text-[#006a61] font-semibold">
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        Told
                      </span>
                    </>
                  )}
                </div>

                <h2 className="text-xl font-extrabold tracking-tight text-[#111c2d] mt-1 text-balance">
                  {activeBuilding.displayName || activeBuilding.streetAddress}
                </h2>
                {activeBuilding.displayName && (
                  <p className="text-xs font-medium text-[#57423d] mt-0.5">
                    {activeBuilding.streetAddress}
                  </p>
                )}
              </div>

              {activeBuilding.cachedOffline && (
                <span
                  title="Saved in offline cache"
                  className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#006a61] shrink-0"
                >
                  <Database className="w-3.5 h-3.5" />
                  Cached
                </span>
              )}
            </div>

            {/* Category Tabs for all positive categories */}
            {positiveCategories.length > 0 && (
              <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
                {positiveCategories.map((f) => {
                  const isTabActive = activeFinding?.categoryId === f.categoryId;
                  return (
                    <button
                      key={f.categoryId}
                      type="button"
                      onClick={() => {
                        setSelectedCategoryTab(f.categoryId);
                        if (isPlayingAudio) {
                          const idx = playlist.findIndex(
                            (s) =>
                              s.buildingId === activeBuilding.id &&
                              s.categoryId === f.categoryId
                          );
                          if (idx >= 0) void playSegmentAt(playlist, idx);
                        }
                      }}
                      className={`px-3 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap shrink-0 transition-colors min-h-[34px] ${
                        isTabActive
                          ? 'bg-[#111c2d] text-white'
                          : 'bg-[#f0f3ff] text-[#57423d] hover:bg-[#dee8ff]'
                      }`}
                    >
                      {CATEGORY_MAP[f.categoryId]?.shortLabel || f.categoryId}
                    </button>
                  );
                })}
              </div>
            )}

            {/* Narrative Prose */}
            {activeFinding ? (
              <div className="space-y-3">
                <div className="flex items-baseline justify-between gap-2">
                  <h3 className="text-base font-bold text-[#9e3c26]">
                    {activeFinding.headline}
                  </h3>
                  <span className="font-mono-timer text-[11px] text-[#8a726c] shrink-0">
                    {activeFinding.wordCount} words
                  </span>
                </div>

                <div className="text-[15px] text-[#111c2d] leading-[1.68] space-y-3 max-w-[68ch]">
                  {activeFinding.summary
                    .split(/\n{2,}/)
                    .filter((p) => p.trim().length > 0)
                    .map((para, i) => (
                      <p key={i}>{para.trim()}</p>
                    ))}
                </div>

                {activeFinding.sources.length > 0 && (
                  <div className="pt-3 border-t border-[#f0f3ff]">
                    <p className="text-[11px] font-bold uppercase tracking-wider text-[#8a726c] mb-1.5">
                      Verified Sources
                    </p>
                    <div className="flex flex-wrap gap-x-3 gap-y-1">
                      {activeFinding.sources.map((src, i) => (
                        <a
                          key={i}
                          href={src.uri}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-xs text-[#0D9488] hover:underline"
                        >
                          <span className="truncate max-w-[200px]">
                            {src.title}
                          </span>
                          <ExternalLink className="w-3 h-3 shrink-0" />
                        </a>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <p className="text-sm text-[#57423d]">
                Select a stop below to inspect its stories.
              </p>
            )}
          </article>
        ) : (
          <div className="bg-white rounded-2xl border border-[#ddc0ba]/50 p-6 text-center">
            <p className="text-sm font-bold text-[#111c2d]">
              No notable buildings matched inside ±{settings.deviationMeters}m
            </p>
            <p className="text-xs text-[#57423d] mt-1">
              Try increasing the allowable deviation range or selecting
              additional discovery categories.
            </p>
          </div>
        )}

        {/* Route Stops Sequence */}
        <section className="space-y-2.5 pb-2">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-bold uppercase tracking-wider text-[#57423d]">
              Buildings Along Route ({buildings.length})
            </h3>
            <span className="text-[11px] text-[#8a726c]">
              Revisited: {settings.revisitedBehavior.replace('_', ' ')}
            </span>
          </div>

          <div className="space-y-2">
            {buildings.map((b, idx) => {
              const isAct = b.id === activeBuilding?.id;
              const isVis = visitedSet.has(b.id);
              const posCats = b.findings
                .filter((f) => f.isNotable)
                .map((f) => CATEGORY_MAP[f.categoryId]?.shortLabel || f.categoryId)
                .join(' · ');

              return (
                <button
                  key={b.id}
                  type="button"
                  onClick={() => handleJumpToBuilding(b, true)}
                  className={`w-full text-left p-3.5 rounded-2xl border transition-all flex items-center gap-3 min-h-[60px] ${
                    isAct
                      ? 'bg-white border-[#0D9488] shadow-sm'
                      : 'bg-white/80 border-[#e7eeff] hover:bg-white hover:border-[#ddc0ba]'
                  }`}
                >
                  <span
                    className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold font-mono-timer shrink-0 ${
                      isAct
                        ? 'bg-[#0D9488] text-white'
                        : isVis
                        ? 'bg-[#64748B] text-white'
                        : 'bg-[#E06D53]/15 text-[#9e3c26]'
                    }`}
                  >
                    {idx + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-bold text-[#111c2d] truncate">
                      {b.displayName || b.streetAddress}
                    </div>
                    <div className="text-xs text-[#57423d] truncate mt-0.5">
                      {b.displayName ? `${b.streetAddress} · ` : ''}
                      {posCats}
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="font-mono-timer text-[11px] text-[#57423d]">
                      {formatMeters(b.routeProgressMeters)}
                    </div>
                    <div className="text-[11px] text-[#0D9488] font-semibold">
                      {isVis ? 'Visited' : 'Listen'}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </section>
      </div>

      {/* Persistent Audio Player Dock (Elevation 3 with terracotta tinted shadow) */}
      <div className="bg-white border-t border-[#ddc0ba]/60 px-4 py-3.5 shadow-[0_8px_30px_rgba(224,109,83,0.18)] shrink-0 space-y-2.5">
        {/* Dual-color Scrubber Rail + Category Milestone Notches */}
        <div className="space-y-1">
          <div className="relative w-full h-2 bg-[#e2e8f0] rounded-full overflow-hidden">
            {/* Buffered geo-sync segment in Emerald */}
            <div
              className="absolute inset-y-0 left-0 bg-[#0D9488]/35 transition-all duration-300"
              style={{
                width: `${Math.min(
                  100,
                  playlist.length > 0
                    ? ((segmentIndex + 1) / playlist.length) * 100
                    : 0
                )}%`,
              }}
            />
            {/* Traversed audio segment in Terracotta */}
            <div
              className="absolute inset-y-0 left-0 bg-[#E06D53] transition-all duration-150"
              style={{ width: `${Math.min(100, audioProgressPct)}%` }}
            />
          </div>
          <div className="flex items-center justify-between text-[11px] text-[#57423d]">
            <span className="truncate font-medium">
              {isLoadingAudio
                ? 'Preparing voice narration...'
                : playlist[segmentIndex]
                ? `${playlist[segmentIndex].categoryLabel} · ${audioSourceLabel}`
                : activeBuilding
                ? `Ready: ${activeBuilding.streetAddress}`
                : 'Select a stop'}
            </span>
            <span className="font-mono-timer shrink-0 ml-2">{audioTimeText}</span>
          </div>
        </div>

        {/* Main Transport Controls */}
        <div className="flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={() => {
              const rates = [0.85, 1.0, 1.15, 1.25];
              const next =
                rates[(rates.indexOf(settings.playbackRate) + 1) % rates.length];
              onUpdateSettings({ playbackRate: next });
            }}
            className="min-w-[48px] min-h-[44px] px-2.5 rounded-xl bg-[#f0f3ff] hover:bg-[#e7eeff] text-xs font-mono-timer font-bold text-[#111c2d] transition-colors"
            title="Change narration speed"
          >
            {settings.playbackRate}x
          </button>

          <div className="flex items-center gap-3">
            <button
              type="button"
              disabled={!activeBuilding || segmentIndex === 0}
              onClick={() => {
                if (playlist.length > 0 && segmentIndex > 0) {
                  void playSegmentAt(playlist, segmentIndex - 1);
                }
              }}
              aria-label="Previous section"
              className="w-11 h-11 rounded-full border border-[#e2e8f0] bg-white hover:bg-[#f1f5f9] disabled:opacity-40 flex items-center justify-center text-[#111c2d] transition-colors"
            >
              <SkipBack className="w-4 h-4" />
            </button>

            {/* 56x56px Primary Terracotta Play/Pause Floating Beacon */}
            <button
              type="button"
              disabled={!activeBuilding}
              onClick={handleTogglePlayPause}
              aria-label={isPlayingAudio ? 'Pause narration' : 'Play narration'}
              className={`relative w-14 h-14 rounded-full bg-[#E06D53] hover:bg-[#9e3c26] disabled:bg-[#cbd5e1] text-white flex items-center justify-center shadow-lg shadow-[#E06D53]/30 transition-transform active:scale-95 ${
                isPlayingAudio ? 'ring-4 ring-[#0D9488]/40' : ''
              }`}
            >
              {isPlayingAudio ? (
                <Pause className="w-6 h-6 fill-current" />
              ) : (
                <Play className="w-6 h-6 fill-current ml-0.5" />
              )}
            </button>

            <button
              type="button"
              disabled={!activeBuilding}
              onClick={() => {
                if (playlist.length > 0 && segmentIndex + 1 < playlist.length) {
                  void playSegmentAt(playlist, segmentIndex + 1);
                } else if (activeBuilding) {
                  const curIdx = buildings.findIndex(
                    (b) => b.id === activeBuilding.id
                  );
                  if (curIdx >= 0 && curIdx + 1 < buildings.length) {
                    handleJumpToBuilding(buildings[curIdx + 1], true);
                  }
                }
              }}
              aria-label="Next section or stop"
              className="w-11 h-11 rounded-full border border-[#e2e8f0] bg-white hover:bg-[#f1f5f9] disabled:opacity-40 flex items-center justify-center text-[#111c2d] transition-colors"
            >
              <SkipForward className="w-4 h-4" />
            </button>
          </div>

          <div className="min-w-[48px] flex justify-end">
            <span
              title={`Voice: ${settings.voiceName}`}
              className="inline-flex items-center gap-1 text-xs font-semibold text-[#57423d]"
            >
              <Volume2 className="w-4 h-4 text-[#0D9488]" />
              {settings.voiceName}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};
