import React, { useEffect, useState } from 'react';
import { Database, Play, Trash2, X } from 'lucide-react';
import type { CachedRouteBundle, ResearchedBuilding } from '../types/tour';
import {
  clearOfflineCache,
  deleteCachedRoute,
  getAllCachedBuildings,
  getAllCachedRoutes,
} from '../utils/offlineCache';
import { formatDuration, formatMeters } from '../utils/geo';
import { CATEGORY_MAP } from '../constants/categories';

interface OfflineCacheModalProps {
  isOpen: boolean;
  onClose: () => void;
  onLoadCachedRoute: (bundle: CachedRouteBundle) => void;
  onCacheUpdated: () => void;
}

export const OfflineCacheModal: React.FC<OfflineCacheModalProps> = ({
  isOpen,
  onClose,
  onLoadCachedRoute,
  onCacheUpdated,
}) => {
  const [routes, setRoutes] = useState<CachedRouteBundle[]>([]);
  const [buildings, setBuildings] = useState<ResearchedBuilding[]>([]);
  const [loading, setLoading] = useState(true);

  const loadData = async () => {
    setLoading(true);
    const [r, b] = await Promise.all([
      getAllCachedRoutes(),
      getAllCachedBuildings(),
    ]);
    setRoutes(r);
    setBuildings(b);
    setLoading(false);
  };

  useEffect(() => {
    if (isOpen) {
      void loadData();
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleDeleteRoute = async (routeKey: string) => {
    await deleteCachedRoute(routeKey);
    await loadData();
    onCacheUpdated();
  };

  const handleClearAll = async () => {
    await clearOfflineCache();
    await loadData();
    onCacheUpdated();
  };

  return (
    <div className="fixed inset-0 z-50 bg-[#111c2d]/45 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="bg-[#f9f9ff] w-full sm:max-w-2xl rounded-t-3xl sm:rounded-2xl shadow-2xl border border-[#ddc0ba]/60 max-h-[85vh] flex flex-col overflow-hidden">
        <div className="px-6 py-4 bg-white border-b border-[#e7eeff] flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-[#0D9488]/10 text-[#0D9488] flex items-center justify-center">
              <Database className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-[#111c2d]">
                Offline Discovery Cache
              </h2>
              <p className="text-xs text-[#57423d]">
                {routes.length} saved {routes.length === 1 ? 'route' : 'routes'} ·{' '}
                {buildings.length} positive{' '}
                {buildings.length === 1 ? 'building' : 'buildings'} stored locally
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close offline cache"
            className="w-10 h-10 rounded-xl flex items-center justify-center text-[#57423d] hover:bg-[#f0f3ff] transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 overflow-y-auto carto-scroll space-y-5 flex-1">
          {loading ? (
            <div className="py-12 text-center text-sm text-[#57423d]">
              Reading offline storage...
            </div>
          ) : routes.length === 0 && buildings.length === 0 ? (
            <div className="py-10 text-center bg-white rounded-2xl border border-[#e7eeff] p-6">
              <p className="text-sm font-semibold text-[#111c2d] mb-1">
                No cached routes yet
              </p>
              <p className="text-xs text-[#57423d] max-w-sm mx-auto leading-relaxed">
                Enable “Cache for offline mode” in Settings before starting a
                discovery route to store positive building stories and audio for
                offline walking.
              </p>
            </div>
          ) : (
            <>
              {routes.length > 0 && (
                <section>
                  <h3 className="text-xs font-bold uppercase tracking-wider text-[#57423d] mb-3">
                    Saved Offline Routes
                  </h3>
                  <div className="space-y-2.5">
                    {routes.map((bundle) => (
                      <div
                        key={bundle.routeKey}
                        className="bg-white rounded-xl border border-[#ddc0ba]/50 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                      >
                        <div className="min-w-0">
                          <div className="text-sm font-bold text-[#111c2d] truncate">
                            {bundle.waypointLabels && bundle.waypointLabels.length > 2
                              ? bundle.waypointLabels
                                  .map((w) => w.split(',')[0])
                                  .join(' → ')
                              : `${bundle.originLabel.split(',')[0]} → ${bundle.destinationLabel.split(',')[0]}`}
                          </div>
                          <div className="text-xs text-[#57423d] mt-1 flex flex-wrap items-center gap-2">
                            <span className="font-mono-timer">
                              {formatMeters(bundle.route.distanceMeters)}
                            </span>
                            <span aria-hidden="true">·</span>
                            <span className="font-mono-timer">
                              {formatDuration(bundle.route.durationSeconds)}
                            </span>
                            <span aria-hidden="true">·</span>
                            <span>
                              {bundle.buildings.length} positive stops
                            </span>
                            <span aria-hidden="true">·</span>
                            <span className="font-mono-timer">
                              ±{bundle.deviationMeters}m
                            </span>
                          </div>
                          <div className="text-[11px] text-[#8a726c] mt-1">
                            {bundle.selectedCategories
                              .map((c) => CATEGORY_MAP[c]?.shortLabel || c)
                              .join(' · ')}
                          </div>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <button
                            type="button"
                            onClick={() => {
                              onLoadCachedRoute(bundle);
                              onClose();
                            }}
                            className="px-3.5 py-2 rounded-xl bg-[#0D9488] text-white text-xs font-semibold flex items-center gap-1.5 hover:bg-[#006a61] transition-colors min-h-[40px]"
                          >
                            <Play className="w-3.5 h-3.5" />
                            Open Guide
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDeleteRoute(bundle.routeKey)}
                            aria-label="Delete cached route"
                            className="w-10 h-10 rounded-xl border border-[#ddc0ba]/60 flex items-center justify-center text-[#57423d] hover:text-[#ba1a1a] hover:bg-[#ffdad6]/40 transition-colors"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {buildings.length > 0 && (
                <section>
                  <h3 className="text-xs font-bold uppercase tracking-wider text-[#57423d] mb-3">
                    Cached Positive Street Addresses ({buildings.length})
                  </h3>
                  <div className="bg-white rounded-xl border border-[#ddc0ba]/50 divide-y divide-[#f0f3ff] max-h-56 overflow-y-auto carto-scroll">
                    {buildings.map((b) => (
                      <div
                        key={b.normalizedAddress}
                        className="px-4 py-2.5 flex items-center justify-between gap-3 text-xs"
                      >
                        <div className="min-w-0">
                          <p className="font-semibold text-[#111c2d] truncate">
                            {b.displayName
                              ? `${b.displayName} — ${b.streetAddress}`
                              : b.streetAddress}
                          </p>
                          <p className="text-[#8a726c] truncate mt-0.5">
                            {b.findings
                              .filter((f) => f.isNotable)
                              .map((f) => CATEGORY_MAP[f.categoryId]?.shortLabel)
                              .join(' · ')}
                          </p>
                        </div>
                        <span className="font-mono-timer text-[11px] text-[#0D9488] shrink-0">
                          {b.findings.reduce((s, f) => s + f.wordCount, 0)} words
                        </span>
                      </div>
                    ))}
                  </div>
                </section>
              )}
            </>
          )}
        </div>

        {(routes.length > 0 || buildings.length > 0) && (
          <div className="px-6 py-3.5 bg-white border-t border-[#e7eeff] flex items-center justify-between">
            <span className="text-xs text-[#57423d]">
              Stored persistently in browser IndexedDB
            </span>
            <button
              type="button"
              onClick={handleClearAll}
              className="px-3.5 py-2 rounded-xl text-xs font-semibold text-[#ba1a1a] hover:bg-[#ffdad6]/50 transition-colors"
            >
              Clear All Cache
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
