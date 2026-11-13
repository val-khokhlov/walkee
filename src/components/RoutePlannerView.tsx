import React, { useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  Compass,
  GripVertical,
  Loader2,
  Play,
  Plus,
  Trash2,
  WifiOff,
} from 'lucide-react';
import { MAP_PROVIDER_OPTIONS, PRESET_ROUTES } from '../constants/categories';
import type {
  DiscoveryProgressState,
  LatLngLiteral,
  MapProviderId,
  WaypointItem,
} from '../types/tour';
import { AddressAutocompleteInput } from './AddressAutocompleteInput';

interface RoutePlannerViewProps {
  waypoints: WaypointItem[];
  onUpdateWaypoint: (id: string, label: string, coords?: LatLngLiteral) => void;
  onAddWaypoint: () => void;
  onRemoveWaypoint: (id: string) => void;
  onMoveWaypoint: (fromIndex: number, toIndex: number) => void;
  onLoadPresetWaypoints: (labels: string[]) => void;
  onStartDiscovery: () => void;
  onSkipToActiveGuide?: () => void;
  hasActiveTour: boolean;
  progress: DiscoveryProgressState | null;
  isOffline: boolean;
  errorBanner: string | null;
  placesEnabled?: boolean;
  mapProvider?: MapProviderId;
}

export const RoutePlannerView: React.FC<RoutePlannerViewProps> = ({
  waypoints,
  onUpdateWaypoint,
  onAddWaypoint,
  onRemoveWaypoint,
  onMoveWaypoint,
  onLoadPresetWaypoints,
  onStartDiscovery,
  onSkipToActiveGuide,
  hasActiveTour,
  progress,
  isOffline,
  errorBanner,
  placesEnabled = false,
  mapProvider = 'google',
}) => {
  const activeProviderName =
    MAP_PROVIDER_OPTIONS.find((p) => p.id === mapProvider)?.name || 'Google Maps';
  const [gpsLoading, setGpsLoading] = useState(false);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);

  const isDiscovering =
    progress !== null &&
    progress.phase !== 'ready' &&
    progress.phase !== 'error';

  const handleUseGpsFirst = () => {
    if (!navigator.geolocation || waypoints.length === 0) return;
    setGpsLoading(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const coords = {
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
        };
        onUpdateWaypoint(
          waypoints[0].id,
          `${coords.lat.toFixed(5)}, ${coords.lng.toFixed(5)}`,
          coords
        );
        setGpsLoading(false);
      },
      () => {
        setGpsLoading(false);
      },
      { enableHighAccuracy: true, timeout: 8000 }
    );
  };

  const filledWaypoints = waypoints.filter((w) => w.label.trim().length > 0);
  const canStart = filledWaypoints.length >= 2 && !isDiscovering;

  return (
    <div className="flex flex-col h-full bg-[#f9f9ff]">
      <div className="flex-1 overflow-y-auto carto-scroll px-5 py-5 space-y-5">
        {/* Heading */}
        <div>
          <div className="flex items-center justify-between gap-2">
            <h1 className="text-2xl font-extrabold tracking-tight text-[#111c2d] text-balance">
              Route Setup
            </h1>
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-semibold text-[#0D9488] bg-[#0D9488]/10 px-2.5 py-1 rounded-lg">
                {activeProviderName}
              </span>
              {isOffline && (
                <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#9e3c26]">
                  <WifiOff className="w-3.5 h-3.5" />
                  Offline
                </span>
              )}
            </div>
          </div>
          <p className="text-sm text-[#57423d] mt-1 leading-relaxed">
            Add two or more waypoints and drag to arrange your walking order.
          </p>
        </div>

        {errorBanner && (
          <div className="p-3.5 rounded-xl bg-[#ffdad6] text-[#93000a] text-xs font-medium leading-relaxed">
            {errorBanner}
          </div>
        )}

        {/* Waypoints List (2+ reorderable waypoints) */}
        <section className="bg-white rounded-2xl border border-[#ddc0ba]/50 p-4 space-y-3 shadow-xs">
          <div className="flex items-center justify-between">
            <h2 className="text-xs font-bold uppercase tracking-wider text-[#57423d]">
              Waypoints ({waypoints.length})
            </h2>
            <button
              type="button"
              disabled={isDiscovering}
              onClick={onAddWaypoint}
              className="text-xs font-semibold text-[#0D9488] hover:text-[#006a61] inline-flex items-center gap-1 py-1.5 px-2.5 rounded-lg bg-[#0D9488]/10 hover:bg-[#0D9488]/20 transition-colors disabled:opacity-50"
            >
              <Plus className="w-3.5 h-3.5" />
              Add waypoint
            </button>
          </div>

          <div className="space-y-3">
            {waypoints.map((wp, idx) => {
              const isFirst = idx === 0;
              const isLast = idx === waypoints.length - 1;
              const roleLabel = isFirst
                ? 'Start'
                : isLast
                ? 'Destination'
                : `Waypoint ${idx + 1}`;
              const isDragging = dragIndex === idx;
              const isDragTarget = dragOverIndex === idx && dragIndex !== idx;

              return (
                <div
                  key={wp.id}
                  draggable={!isDiscovering}
                  onDragStart={() => setDragIndex(idx)}
                  onDragOver={(e) => {
                    e.preventDefault();
                    if (dragOverIndex !== idx) setDragOverIndex(idx);
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    if (dragIndex !== null && dragIndex !== idx) {
                      onMoveWaypoint(dragIndex, idx);
                    }
                    setDragIndex(null);
                    setDragOverIndex(null);
                  }}
                  onDragEnd={() => {
                    setDragIndex(null);
                    setDragOverIndex(null);
                  }}
                  className={`rounded-xl border p-2.5 transition-all bg-[#f9f9ff]/60 ${
                    isDragging
                      ? 'scale-[1.02] shadow-md border-[#0D9488] opacity-75'
                      : isDragTarget
                      ? 'border-[#E06D53] bg-[#ffdad2]/20'
                      : 'border-[#e7eeff]'
                  }`}
                >
                  <div className="flex items-start gap-2">
                    {/* Tactile 6-dot drag handle + accessible move up/down */}
                    <div className="flex flex-col items-center pt-6 gap-0.5 shrink-0">
                      <button
                        type="button"
                        disabled={isDiscovering || idx === 0}
                        onClick={() => onMoveWaypoint(idx, idx - 1)}
                        aria-label={`Move ${roleLabel} up`}
                        className="w-6 h-5 rounded flex items-center justify-center text-[#8a726c] hover:text-[#111c2d] hover:bg-[#e7eeff] disabled:opacity-25"
                      >
                        <ArrowUp className="w-3 h-3" />
                      </button>
                      <span
                        title="Drag to reorder waypoint"
                        className="w-6 h-6 flex items-center justify-center text-[#94a3b8] cursor-grab active:cursor-grabbing"
                      >
                        <GripVertical className="w-4 h-4" />
                      </span>
                      <button
                        type="button"
                        disabled={isDiscovering || idx === waypoints.length - 1}
                        onClick={() => onMoveWaypoint(idx, idx + 1)}
                        aria-label={`Move ${roleLabel} down`}
                        className="w-6 h-5 rounded flex items-center justify-center text-[#8a726c] hover:text-[#111c2d] hover:bg-[#e7eeff] disabled:opacity-25"
                      >
                        <ArrowDown className="w-3 h-3" />
                      </button>
                    </div>

                    <div className="flex-1 min-w-0">
                      <AddressAutocompleteInput
                        id={`wp-input-${wp.id}`}
                        label={roleLabel}
                        placeholder="Enter street address or landmark"
                        value={wp.label}
                        onChange={(val) => onUpdateWaypoint(wp.id, val)}
                        onSelectPlace={(label, coords) =>
                          onUpdateWaypoint(wp.id, label, coords)
                        }
                        allowGps={isFirst}
                        onUseGps={isFirst ? handleUseGpsFirst : undefined}
                        gpsLoading={isFirst ? gpsLoading : false}
                        disabled={isDiscovering}
                        accentColor={isFirst ? 'emerald' : 'terracotta'}
                        markerLabel={String(idx + 1)}
                        placesEnabled={placesEnabled}
                        mapProvider={mapProvider}
                      />
                    </div>

                    {waypoints.length > 2 && (
                      <button
                        type="button"
                        disabled={isDiscovering}
                        onClick={() => onRemoveWaypoint(wp.id)}
                        aria-label={`Remove ${roleLabel}`}
                        className="mt-7 w-9 h-9 rounded-lg flex items-center justify-center text-[#8a726c] hover:text-[#ba1a1a] hover:bg-[#ffdad6]/50 transition-colors shrink-0 disabled:opacity-40"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Curated quick-start routes */}
          <div className="pt-2 border-t border-[#f0f3ff]">
            <p className="text-[11px] font-semibold text-[#8a726c] mb-2">
              Quick iconic walks
            </p>
            <div className="flex flex-wrap gap-1.5">
              {PRESET_ROUTES.map((preset) => {
                const isSelected =
                  waypoints.length === 2 &&
                  waypoints[0]?.label === preset.origin &&
                  waypoints[1]?.label === preset.destination;
                return (
                  <button
                    key={preset.id}
                    type="button"
                    disabled={isDiscovering}
                    onClick={() =>
                      onLoadPresetWaypoints([preset.origin, preset.destination])
                    }
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                      isSelected
                        ? 'bg-[#111c2d] text-white'
                        : 'bg-[#f0f3ff] text-[#111c2d] hover:bg-[#dee8ff]'
                    }`}
                  >
                    {preset.city} · {preset.title.split(' ')[0]}
                  </button>
                );
              })}
            </div>
          </div>
        </section>

        {/* Discovery progress panel when running */}
        {progress && progress.phase !== 'ready' && (
          <section className="bg-[#263143] text-[#ecf1ff] rounded-2xl p-4 space-y-3 shadow-md">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2.5">
                {progress.phase === 'error' ? (
                  <Compass className="w-5 h-5 text-[#ffb4a3]" />
                ) : (
                  <Loader2 className="w-5 h-5 text-[#86f2e4] animate-spin" />
                )}
                <span className="text-sm font-bold">{progress.message}</span>
              </div>
              {progress.totalBuildings > 0 && (
                <span className="font-mono-timer text-xs text-[#86f2e4]">
                  {progress.completedBuildings}/{progress.totalBuildings}
                </span>
              )}
            </div>

            {progress.totalBuildings > 0 && (
              <div className="w-full h-2 rounded-full bg-white/10 overflow-hidden">
                <div
                  className="h-full bg-[#0D9488] transition-all duration-300"
                  style={{
                    width: `${Math.round(
                      (progress.completedBuildings / progress.totalBuildings) *
                        100
                    )}%`,
                  }}
                />
              </div>
            )}

            <div className="flex items-center justify-between text-xs text-[#cfdaf2]">
              <span className="truncate">
                {progress.currentAddress
                  ? `Searching: ${progress.currentAddress}`
                  : 'Preparing walking corridor...'}
              </span>
              {progress.positiveBuildings > 0 && (
                <span className="font-mono-timer shrink-0 text-[#ffb4a3]">
                  {progress.positiveBuildings} notable found
                </span>
              )}
            </div>

            {progress.positiveBuildings >= 1 &&
              progress.phase === 'researching' &&
              onSkipToActiveGuide && (
                <button
                  type="button"
                  onClick={onSkipToActiveGuide}
                  className="w-full py-2.5 rounded-xl bg-white/10 hover:bg-white/20 text-xs font-semibold text-white transition-colors"
                >
                  Open Active Audio Guide now (finish remaining in background)
                </button>
              )}
          </section>
        )}
      </div>

      {/* Bottom-Anchored Primary CTA */}
      <div className="p-4 bg-white/95 backdrop-blur-md border-t border-[#e7eeff] space-y-2">
        <button
          type="button"
          disabled={!canStart}
          onClick={onStartDiscovery}
          className="w-full min-h-[52px] px-6 py-3 rounded-2xl bg-[#E06D53] hover:bg-[#9e3c26] disabled:bg-[#cbd5e1] disabled:cursor-not-allowed text-white font-bold text-sm shadow-lg shadow-[#E06D53]/25 flex items-center justify-center gap-2.5 transition-all active:scale-[0.99]"
        >
          {isDiscovering ? (
            <>
              <Loader2 className="w-5 h-5 animate-spin" />
              Tracing & discovering buildings...
            </>
          ) : (
            <>
              <Compass className="w-5 h-5" />
              Start discovery route
            </>
          )}
        </button>

        {hasActiveTour && !isDiscovering && onSkipToActiveGuide && (
          <button
            type="button"
            onClick={onSkipToActiveGuide}
            className="w-full min-h-[42px] px-4 py-2 rounded-xl bg-[#f0f3ff] hover:bg-[#dee8ff] text-[#111c2d] font-semibold text-xs flex items-center justify-center gap-2 transition-colors"
          >
            <Play className="w-3.5 h-3.5 text-[#0D9488]" />
            Resume Active Audio Walking Guide
          </button>
        )}
      </div>
    </div>
  );
};
