import React, { useState } from 'react';
import { ChevronDown, ChevronUp, ExternalLink } from 'lucide-react';
import { CATEGORY_MAP } from '../constants/categories';
import type {
  CategoryFinding,
  CategoryId,
  ComputedRoute,
  ResearchedBuilding,
} from '../types/tour';
import { formatMeters } from '../utils/geo';

interface DebugViewProps {
  route: ComputedRoute | null;
  deviationMeters: number;
  analyzedBuildings: ResearchedBuilding[];
  selectedCategories: CategoryId[];
}

export const DebugView: React.FC<DebugViewProps> = ({
  route,
  deviationMeters,
  analyzedBuildings,
  selectedCategories,
}) => {
  const [expandedRawIds, setExpandedRawIds] = useState<Record<string, boolean>>(
    {}
  );
  const [expandedQueries, setExpandedQueries] = useState<
    Record<string, boolean>
  >({});

  const toggleRaw = (id: string) => {
    setExpandedRawIds((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const toggleQuery = (key: string) => {
    setExpandedQueries((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const firstThree = analyzedBuildings.slice(0, 3);
  const positiveTotal = analyzedBuildings.filter((b) => b.positiveCount > 0).length;

  const getDisplayFindings = (building: ResearchedBuilding): CategoryFinding[] => {
    if (building.findings && building.findings.length > 0) {
      return building.findings;
    }
    const buildingLabel = building.displayName
      ? `${building.streetAddress} (${building.displayName})`
      : building.streetAddress;
    return selectedCategories.map((catId) => ({
      categoryId: catId,
      queryUsed:
        CATEGORY_MAP[catId]?.queryTemplate.replace('{ADDRESS}', buildingLabel) ||
        `${catId}: ${buildingLabel}`,
      isNotable: false,
      headline: 'Pending or Unavailable Response',
      summary:
        building.rawAiResponse ||
        'No response payload was recorded for this query.',
      wordCount: 0,
      sources: [],
    }));
  };

  return (
    <div className="flex flex-col h-full bg-[#f9f9ff]">
      <div className="flex-1 overflow-y-auto carto-scroll px-5 py-6">
        <div className="max-w-5xl mx-auto space-y-6">
          {/* Header & Telemetry Summary */}
          <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3">
            <div>
              <h1 className="text-2xl font-extrabold tracking-tight text-[#111c2d]">
                Discovery Debug Inspector
              </h1>
              <p className="text-sm text-[#57423d] mt-1">
                Complete list of street addresses analyzed within the ±
                {deviationMeters >= 1000
                  ? `${deviationMeters / 1000} km`
                  : `${deviationMeters} m`}{' '}
                deviation range, plus search queries submitted for the first three
                buildings. Press any query to expand its response.
              </p>
            </div>
            {route && (
              <div className="text-xs font-mono-timer text-[#57423d] bg-white border border-[#ddc0ba]/50 rounded-xl px-3.5 py-2 shrink-0">
                {analyzedBuildings.length} analyzed · {positiveTotal} positive ·{' '}
                {formatMeters(route.distanceMeters)}
              </div>
            )}
          </div>

          {analyzedBuildings.length === 0 ? (
            <div className="bg-white rounded-2xl border border-[#ddc0ba]/50 p-8 text-center">
              <p className="text-sm font-bold text-[#111c2d]">
                No analyzed buildings yet
              </p>
              <p className="text-xs text-[#57423d] mt-1">
                Run “Start discovery route” from Route Setup to populate the
                analyzed building addresses and search query logs.
              </p>
            </div>
          ) : (
            <>
              {/* Section 1: All Building Addresses Analyzed */}
              <section className="bg-white rounded-2xl border border-[#ddc0ba]/50 overflow-hidden shadow-xs">
                <div className="px-5 py-4 border-b border-[#f0f3ff] flex items-center justify-between gap-3">
                  <div>
                    <h2 className="text-xs font-bold uppercase tracking-wider text-[#57423d]">
                      1. All Analyzed Building Addresses ({analyzedBuildings.length})
                    </h2>
                    <p className="text-xs text-[#8a726c] mt-0.5">
                      Ordered along the walking route inside ±
                      {deviationMeters >= 1000
                        ? `${deviationMeters / 1000}km`
                        : `${deviationMeters}m`}
                    </p>
                  </div>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="bg-[#f0f3ff]/70 text-[#57423d] border-b border-[#e7eeff]">
                        <th className="py-2.5 px-4 font-bold">#</th>
                        <th className="py-2.5 px-4 font-bold">Street Address</th>
                        <th className="py-2.5 px-4 font-bold">Place / Building</th>
                        <th className="py-2.5 px-4 font-bold">Off Route</th>
                        <th className="py-2.5 px-4 font-bold">Along Path</th>
                        <th className="py-2.5 px-4 font-bold">Coordinates</th>
                        <th className="py-2.5 px-4 font-bold">Analysis Result</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#f0f3ff]">
                      {analyzedBuildings.map((b, idx) => {
                        const posLabels = b.findings
                          .filter((f) => f.isNotable)
                          .map((f) => CATEGORY_MAP[f.categoryId]?.shortLabel || f.categoryId);
                        return (
                          <tr key={b.id} className="hover:bg-[#f9f9ff]">
                            <td className="py-2.5 px-4 font-mono-timer font-bold text-[#57423d]">
                              {idx + 1}
                            </td>
                            <td className="py-2.5 px-4 font-semibold text-[#111c2d]">
                              {b.streetAddress}
                            </td>
                            <td className="py-2.5 px-4 text-[#57423d]">
                              {b.displayName || '—'}
                            </td>
                            <td className="py-2.5 px-4 font-mono-timer text-[#0D9488]">
                              {b.distanceFromRouteMeters} m
                            </td>
                            <td className="py-2.5 px-4 font-mono-timer text-[#57423d]">
                              {formatMeters(b.routeProgressMeters)}
                            </td>
                            <td className="py-2.5 px-4 font-mono-timer text-[11px] text-[#8a726c]">
                              {b.location.lat.toFixed(5)}, {b.location.lng.toFixed(5)}
                            </td>
                            <td className="py-2.5 px-4">
                              {posLabels.length > 0 ? (
                                <span className="font-semibold text-[#006a61]">
                                  Positive ({posLabels.join(' · ')})
                                </span>
                              ) : (
                                <span className="text-[#8a726c]">
                                  No notable match ({b.findings.length} checked)
                                </span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </section>

              {/* Section 2: AI Queries & Responses for First 3 Buildings */}
              <section className="space-y-4">
                <div>
                  <h2 className="text-xs font-bold uppercase tracking-wider text-[#57423d]">
                    2. AI Queries & Responses — First {firstThree.length} Analyzed{' '}
                    {firstThree.length === 1 ? 'Building' : 'Buildings'}
                  </h2>
                  <p className="text-xs text-[#8a726c] mt-0.5">
                    Street addresses and all AI queries sent are listed below. Press
                    any query to expand its response.
                  </p>
                </div>

                {firstThree.map((building, bIdx) => {
                  const isRawOpen = Boolean(expandedRawIds[building.id]);
                  const findingsList = getDisplayFindings(building);
                  return (
                    <div
                      key={building.id}
                      className="bg-white rounded-2xl border border-[#ddc0ba]/50 p-5 space-y-4 shadow-xs"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-2 pb-3 border-b border-[#f0f3ff]">
                        <div>
                          <span className="font-mono-timer text-xs font-bold text-[#0D9488]">
                            Building #{bIdx + 1}
                          </span>
                          <h3 className="text-lg font-extrabold text-[#111c2d] mt-0.5">
                            {building.streetAddress}
                          </h3>
                          <p className="text-xs text-[#57423d] font-mono-timer mt-0.5">
                            {building.displayName ? `${building.displayName} · ` : ''}
                            {building.distanceFromRouteMeters} m off route ·{' '}
                            {formatMeters(building.routeProgressMeters)} along walk ·{' '}
                            {building.positiveCount}/{findingsList.length} positive
                          </p>
                        </div>

                        {building.rawAiResponse && (
                          <button
                            type="button"
                            onClick={() => toggleRaw(building.id)}
                            className="px-3 py-1.5 rounded-lg bg-[#f0f3ff] hover:bg-[#dee8ff] text-xs font-semibold text-[#111c2d] inline-flex items-center gap-1"
                          >
                            Raw AI Output
                            {isRawOpen ? (
                              <ChevronUp className="w-3.5 h-3.5" />
                            ) : (
                              <ChevronDown className="w-3.5 h-3.5" />
                            )}
                          </button>
                        )}
                      </div>

                      {isRawOpen && building.rawAiResponse && (
                        <pre className="p-3.5 rounded-xl bg-[#263143] text-[#ecf1ff] text-[11px] font-mono overflow-x-auto whitespace-pre-wrap leading-relaxed max-h-72 overflow-y-auto carto-scroll">
                          {building.rawAiResponse}
                        </pre>
                      )}

                      <div className="space-y-3">
                        {findingsList.map((finding, fIdx) => {
                          const queryKey = `${building.id}-${finding.categoryId}-${fIdx}`;
                          const isExpanded = Boolean(expandedQueries[queryKey]);
                          return (
                            <div
                              key={queryKey}
                              className={`rounded-xl border transition-colors overflow-hidden ${
                                isExpanded
                                  ? 'border-[#0D9488] bg-[#f9f9ff]'
                                  : 'border-[#ddc0ba]/60 bg-white hover:border-[#0D9488]/60'
                              }`}
                            >
                              <button
                                type="button"
                                aria-expanded={isExpanded}
                                onClick={() => toggleQuery(queryKey)}
                                className="w-full text-left p-4 flex items-start justify-between gap-3 cursor-pointer hover:bg-[#f0f3ff]/60 transition-colors"
                              >
                                <div className="min-w-0 flex-1 space-y-1.5">
                                  <div className="flex flex-wrap items-center justify-between gap-2">
                                    <span className="text-xs font-bold uppercase tracking-wider text-[#0D9488]">
                                      Query #{fIdx + 1} ·{' '}
                                      {CATEGORY_MAP[finding.categoryId]?.label ||
                                        finding.categoryId}
                                    </span>
                                    <span
                                      className={`text-xs font-mono-timer font-bold ${
                                        finding.isNotable
                                          ? 'text-[#006a61]'
                                          : 'text-[#8a726c]'
                                      }`}
                                    >
                                      {finding.isNotable
                                        ? `NOTABLE: YES · ${finding.wordCount} words`
                                        : 'NOTABLE: NO'}
                                    </span>
                                  </div>
                                  <p className="text-sm font-medium text-[#111c2d] leading-relaxed">
                                    “{finding.queryUsed}”
                                  </p>
                                </div>
                                <span
                                  aria-hidden="true"
                                  className="mt-0.5 px-2.5 h-8 rounded-lg bg-[#f0f3ff] text-[#111c2d] flex items-center gap-1 text-[11px] font-semibold shrink-0"
                                >
                                  <span>{isExpanded ? 'Hide' : 'Response'}</span>
                                  {isExpanded ? (
                                    <ChevronUp className="w-3.5 h-3.5" />
                                  ) : (
                                    <ChevronDown className="w-3.5 h-3.5" />
                                  )}
                                </span>
                              </button>

                              {isExpanded && (
                                <div className="px-4 pb-4 pt-3 border-t border-[#e7eeff] bg-[#f9f9ff] space-y-2.5">
                                  <div className="flex flex-wrap items-center justify-between gap-2">
                                    <span className="text-[11px] font-bold uppercase tracking-wider text-[#57423d]">
                                      Search Response — {finding.headline}
                                    </span>
                                    <div className="flex items-center gap-3">
                                      {finding.searchProvider && (
                                        <span className="text-[11px] text-[#8a726c]">
                                          {finding.searchProvider}
                                        </span>
                                      )}
                                      <a
                                        href={
                                          finding.googleSearchUrl ||
                                          `https://www.google.com/search?q=${encodeURIComponent(finding.queryUsed)}`
                                        }
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#0D9488] hover:underline"
                                      >
                                        Open in Google Search
                                        <ExternalLink className="w-3 h-3 shrink-0" />
                                      </a>
                                    </div>
                                  </div>
                                  <div className="text-xs text-[#111c2d] bg-white rounded-lg border border-[#e7eeff] p-3.5 leading-relaxed space-y-2 max-h-80 overflow-y-auto carto-scroll">
                                    {finding.summary
                                      .split(/\n{2,}/)
                                      .filter((p) => p.trim().length > 0)
                                      .map((para, pIdx) => (
                                        <p key={pIdx}>{para.trim()}</p>
                                      ))}
                                  </div>

                                  {finding.sources.length > 0 && (
                                    <div className="flex flex-wrap gap-x-3 gap-y-1 pt-1">
                                      {finding.sources.map((src, sIdx) => (
                                        <a
                                          key={sIdx}
                                          href={src.uri}
                                          target="_blank"
                                          rel="noopener noreferrer"
                                          className="inline-flex items-center gap-1 text-[11px] text-[#0D9488] hover:underline"
                                        >
                                          <span className="truncate max-w-[220px]">
                                            {src.title}
                                          </span>
                                          <ExternalLink className="w-3 h-3 shrink-0" />
                                        </a>
                                      ))}
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </section>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
