import React, { useState } from 'react';
import {
  Check,
  ChevronDown,
  ChevronUp,
  Database,
  Map as MapIcon,
  SlidersHorizontal,
  Volume2,
} from 'lucide-react';
import {
  DISCOVERY_CATEGORIES,
  MAP_PROVIDER_OPTIONS,
  REVISITED_OPTIONS,
  VOICE_OPTIONS,
} from '../constants/categories';
import type {
  CategoryId,
  GuideSettings,
  MapProviderId,
  RevisitedBehavior,
  VoiceName,
} from '../types/tour';

interface SettingsViewProps {
  settings: GuideSettings;
  onUpdateSettings: (partial: Partial<GuideSettings>) => void;
  cacheStats: { routesCount: number; buildingsCount: number; audioClipsCount: number };
  onOpenCacheModal: () => void;
  providerAvailability?: { google: boolean; apple: boolean };
}

const DEVIATION_OPTIONS = [
  { meters: 50, label: '50m' },
  { meters: 250, label: '250m' },
  { meters: 500, label: '500m' },
  { meters: 1000, label: '1km' },
];

export const SettingsView: React.FC<SettingsViewProps> = ({
  settings,
  onUpdateSettings,
  cacheStats,
  onOpenCacheModal,
  providerAvailability,
}) => {
  const [showQueryPreview, setShowQueryPreview] = useState(false);

  const toggleCategory = (id: CategoryId) => {
    const exists = settings.selectedCategories.includes(id);
    if (exists && settings.selectedCategories.length === 1) return;
    const next = exists
      ? settings.selectedCategories.filter((c) => c !== id)
      : [...settings.selectedCategories, id];
    onUpdateSettings({ selectedCategories: next });
  };

  const formatDeviationLabel = (m: number) =>
    m >= 1000 ? `${(m / 1000).toFixed(m % 1000 === 0 ? 0 : 1)} km` : `${m} m`;

  return (
    <div className="flex flex-col h-full bg-[#f9f9ff]">
      <div className="flex-1 overflow-y-auto carto-scroll px-5 py-6">
        <div className="max-w-3xl mx-auto space-y-6">
          <div>
            <h1 className="text-2xl font-extrabold tracking-tight text-[#111c2d]">
              Settings
            </h1>
            <p className="text-sm text-[#57423d] mt-1">
              Configure discovery lenses, corridor range, offline caching, and
              audio narration preferences.
            </p>
          </div>

          {/* 1. Discovery Categories (First Section) */}
          <section className="bg-white rounded-2xl border border-[#ddc0ba]/50 p-5 space-y-4 shadow-xs">
            <div className="flex items-center justify-between gap-2">
              <div>
                <h2 className="text-xs font-bold uppercase tracking-wider text-[#57423d]">
                  Discovery Categories
                </h2>
                <p className="text-xs text-[#8a726c] mt-0.5">
                  Submits a search query for each street address along your route
                  across these selected categories.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowQueryPreview((v) => !v)}
                className="text-xs font-semibold text-[#9e3c26] hover:underline inline-flex items-center gap-1 shrink-0"
              >
                Query prompts
                {showQueryPreview ? (
                  <ChevronUp className="w-3.5 h-3.5" />
                ) : (
                  <ChevronDown className="w-3.5 h-3.5" />
                )}
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
              {DISCOVERY_CATEGORIES.map((cat) => {
                const active = settings.selectedCategories.includes(cat.id);
                return (
                  <button
                    key={cat.id}
                    type="button"
                    onClick={() => toggleCategory(cat.id)}
                    className={`w-full text-left p-3.5 rounded-xl border transition-all flex items-start gap-3 min-h-[64px] ${
                      active
                        ? 'bg-[#f0f3ff] border-[#0D9488] shadow-xs'
                        : 'bg-white border-[#e7eeff] hover:border-[#ddc0ba]'
                    }`}
                  >
                    <span
                      className={`mt-0.5 w-5 h-5 rounded-md flex items-center justify-center shrink-0 border transition-colors ${
                        active
                          ? 'bg-[#0D9488] border-[#0D9488] text-white'
                          : 'bg-white border-[#ddc0ba]'
                      }`}
                    >
                      {active && <Check className="w-3.5 h-3.5 stroke-[2.5]" />}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-bold text-[#111c2d]">
                          {cat.label}
                        </span>
                        <span className="font-mono-timer text-[11px] text-[#57423d]">
                          {cat.targetWords}
                        </span>
                      </div>
                      <p className="text-xs text-[#57423d] mt-0.5 leading-snug">
                        {cat.description}
                      </p>
                      {showQueryPreview && (
                        <p className="mt-2 text-[11px] text-[#8a726c] bg-white/90 rounded-lg p-2 border border-[#e7eeff] leading-relaxed">
                          “{cat.queryTemplate.replace('{ADDRESS}', '[Building #]')}”
                        </p>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          </section>

          {/* 2. Route & Guide Settings */}
          <section className="bg-white rounded-2xl border border-[#ddc0ba]/50 p-5 space-y-6 shadow-xs">
            <div className="flex items-center gap-2">
              <SlidersHorizontal className="w-4 h-4 text-[#57423d]" />
              <h2 className="text-xs font-bold uppercase tracking-wider text-[#57423d]">
                Route & Guide Settings
              </h2>
            </div>

            {/* Map Provider Selector */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <label
                  htmlFor="settings-map-provider"
                  className="flex items-center gap-1.5 text-sm font-semibold text-[#111c2d]"
                >
                  <MapIcon className="w-4 h-4 text-[#0D9488]" />
                  Map & Routing Provider
                </label>
                <span className="text-[11px] font-semibold text-[#0D9488]">
                  {MAP_PROVIDER_OPTIONS.find((p) => p.id === settings.mapProvider)?.name ||
                    'Google Maps'}
                </span>
              </div>

              <div
                id="settings-map-provider"
                className="grid grid-cols-1 sm:grid-cols-2 gap-2.5"
              >
                {MAP_PROVIDER_OPTIONS.map((opt) => {
                  const selected = settings.mapProvider === opt.id;
                  const appleMissingToken =
                    opt.id === 'apple' && providerAvailability && !providerAvailability.apple;
                  const googleMissingKey =
                    opt.id === 'google' && providerAvailability && !providerAvailability.google;
                  return (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() =>
                        onUpdateSettings({ mapProvider: opt.id as MapProviderId })
                      }
                      className={`text-left p-3.5 rounded-xl border transition-all min-h-[76px] flex flex-col justify-between ${
                        selected
                          ? 'bg-[#f0f3ff] border-[#0D9488] shadow-xs'
                          : 'bg-white border-[#e7eeff] hover:border-[#ddc0ba]'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2 w-full">
                        <span className="text-xs font-bold text-[#111c2d]">
                          {opt.name}
                        </span>
                        <span
                          className={`text-[10px] font-semibold px-2 py-0.5 rounded-md shrink-0 ${
                            opt.id === 'osm' || opt.id === 'carto'
                              ? 'bg-[#0D9488]/12 text-[#006a61]'
                              : 'bg-[#e7eeff] text-[#57423d]'
                          }`}
                        >
                          {opt.badge}
                        </span>
                      </div>
                      <p className="text-[11px] text-[#57423d] mt-1.5 leading-snug">
                        {opt.description}
                      </p>
                      {selected && appleMissingToken && (
                        <p className="text-[10px] text-[#8d4b00] bg-[#ffdcc3]/45 rounded-lg px-2 py-1 mt-2">
                          APPLE_MAPS_TOKEN is not set — automatically using clean Light Carto map + free OSM routing & building scan.
                        </p>
                      )}
                      {selected && googleMissingKey && (
                        <p className="text-[10px] text-[#93000a] bg-[#ffdad6]/60 rounded-lg px-2 py-1 mt-2">
                          Google Maps key not configured — switch to OpenStreetMap or Carto Voyager for free zero-key routing.
                        </p>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>

            <hr className="border-[#f0f3ff]" />

            {/* Allowable deviation range: 50m, 250m, 500m, 1km */}
            <div>
              <div className="flex items-center justify-between mb-2.5">
                <label className="text-sm font-semibold text-[#111c2d]">
                  Allowable deviation range
                </label>
                <span className="font-mono-timer text-sm font-bold text-[#0D9488]">
                  ±{formatDeviationLabel(settings.deviationMeters)}
                </span>
              </div>

              <div className="grid grid-cols-4 gap-2">
                {DEVIATION_OPTIONS.map((opt) => {
                  const selected = settings.deviationMeters === opt.meters;
                  return (
                    <button
                      key={opt.meters}
                      type="button"
                      onClick={() =>
                        onUpdateSettings({ deviationMeters: opt.meters })
                      }
                      className={`min-h-[44px] py-2 px-3 rounded-xl text-sm font-mono-timer font-bold border transition-all ${
                        selected
                          ? 'bg-[#0D9488] border-[#0D9488] text-white shadow-xs'
                          : 'bg-[#f0f3ff] border-transparent text-[#111c2d] hover:bg-[#dee8ff]'
                      }`}
                    >
                      {opt.label}
                    </button>
                  );
                })}
              </div>

              <p className="text-xs text-[#8a726c] mt-2">
                Includes buildings by street address located within ±
                {formatDeviationLabel(settings.deviationMeters)} of your traced
                walking route.
              </p>
            </div>

            <hr className="border-[#f0f3ff]" />

            {/* Cache for offline mode */}
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <span className="text-sm font-semibold text-[#111c2d]">
                  Cache for offline mode
                </span>
                <p className="text-xs text-[#57423d] mt-0.5 leading-relaxed">
                  Store positive building discoveries, route polylines, and audio
                  clips locally for walking without an active Internet connection.
                </p>
                <button
                  type="button"
                  onClick={onOpenCacheModal}
                  className="mt-2 inline-flex items-center gap-1.5 text-xs font-semibold text-[#0D9488] hover:underline"
                >
                  <Database className="w-3.5 h-3.5" />
                  Manage offline cache ({cacheStats.routesCount} routes ·{' '}
                  {cacheStats.buildingsCount} buildings)
                </button>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={settings.cacheForOffline}
                aria-label="Cache for offline mode"
                onClick={() =>
                  onUpdateSettings({
                    cacheForOffline: !settings.cacheForOffline,
                  })
                }
                className={`relative inline-flex h-7 w-12 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ${
                  settings.cacheForOffline ? 'bg-[#0D9488]' : 'bg-[#cbd5e1]'
                }`}
              >
                <span
                  className={`pointer-events-none inline-block h-6 w-6 transform rounded-full bg-white shadow-sm transition duration-200 ${
                    settings.cacheForOffline ? 'translate-x-5' : 'translate-x-0'
                  }`}
                />
              </button>
            </div>

            <hr className="border-[#f0f3ff]" />

            {/* What to do with revisited sites */}
            <div>
              <label
                htmlFor="settings-revisited-selector"
                className="block text-sm font-semibold text-[#111c2d] mb-2"
              >
                What to do with revisited sites
              </label>
              <div
                id="settings-revisited-selector"
                className="grid grid-cols-1 sm:grid-cols-2 gap-2.5"
              >
                {REVISITED_OPTIONS.map((opt) => {
                  const selected = settings.revisitedBehavior === opt.id;
                  return (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() =>
                        onUpdateSettings({
                          revisitedBehavior: opt.id as RevisitedBehavior,
                        })
                      }
                      className={`text-left p-3 rounded-xl border transition-colors min-h-[56px] ${
                        selected
                          ? 'bg-[#ffdad2]/40 border-[#E06D53] text-[#3d0600]'
                          : 'bg-white border-[#e7eeff] text-[#111c2d] hover:bg-[#f0f3ff]'
                      }`}
                    >
                      <div className="text-xs font-bold">{opt.label}</div>
                      <div className="text-[11px] text-[#57423d] mt-0.5 leading-snug">
                        {opt.description}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            <hr className="border-[#f0f3ff]" />

            {/* Narrator Voice & Narration Pace */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label
                  htmlFor="settings-voice-select"
                  className="flex items-center gap-1.5 text-xs font-semibold text-[#57423d] mb-1.5"
                >
                  <Volume2 className="w-3.5 h-3.5" />
                  Narrator Voice
                </label>
                <select
                  id="settings-voice-select"
                  value={settings.voiceName}
                  onChange={(e) =>
                    onUpdateSettings({ voiceName: e.target.value as VoiceName })
                  }
                  className="w-full min-h-[44px] px-3 py-2 text-xs font-medium bg-white border border-[#ddc0ba]/70 rounded-xl text-[#111c2d] focus:outline-none focus:border-[#0D9488]"
                >
                  {VOICE_OPTIONS.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.label} — {v.tone}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label
                  htmlFor="settings-pace-select"
                  className="block text-xs font-semibold text-[#57423d] mb-1.5"
                >
                  Narration Pace
                </label>
                <div
                  id="settings-pace-select"
                  className="flex items-center gap-1 p-1 bg-[#f0f3ff] rounded-xl min-h-[44px]"
                >
                  {[0.85, 1.0, 1.15, 1.25].map((rate) => (
                    <button
                      key={rate}
                      type="button"
                      onClick={() => onUpdateSettings({ playbackRate: rate })}
                      className={`flex-1 py-1.5 rounded-lg text-xs font-mono-timer transition-colors ${
                        settings.playbackRate === rate
                          ? 'bg-white text-[#111c2d] font-bold shadow-xs'
                          : 'text-[#57423d] hover:text-[#111c2d]'
                      }`}
                    >
                      {rate}x
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
};
