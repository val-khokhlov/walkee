import React, { useEffect, useRef, useState } from 'react';
import { useMapsLibrary } from '@vis.gl/react-google-maps';
import { LocateFixed, MapPin, X } from 'lucide-react';
import type { LatLngLiteral, MapProviderId } from '../types/tour';

interface AddressAutocompleteInputProps {
  id: string;
  label: string;
  placeholder: string;
  value: string;
  onChange: (value: string) => void;
  onSelectPlace?: (label: string, coords?: LatLngLiteral) => void;
  allowGps?: boolean;
  onUseGps?: () => void;
  gpsLoading?: boolean;
  disabled?: boolean;
  accentColor?: 'emerald' | 'terracotta';
  markerLabel?: string;
  placesEnabled?: boolean;
  mapProvider?: MapProviderId;
}

interface UnifiedSuggestion {
  label: string;
  coords?: LatLngLiteral;
  googlePrediction?: google.maps.places.AutocompleteSuggestion;
}

interface PlacesFetcherProps {
  input: string;
  isFocused: boolean;
  disabled: boolean;
  skipNextFetchRef: React.MutableRefObject<boolean>;
  sessionTokenRef: React.MutableRefObject<google.maps.places.AutocompleteSessionToken | null>;
  onSuggestions: (list: google.maps.places.AutocompleteSuggestion[]) => void;
  onPlacesLibReady: (lib: google.maps.PlacesLibrary | null) => void;
}

const PlacesAutocompleteFetcher: React.FC<PlacesFetcherProps> = ({
  input,
  isFocused,
  disabled,
  skipNextFetchRef,
  sessionTokenRef,
  onSuggestions,
  onPlacesLibReady,
}) => {
  const placesLib = useMapsLibrary('places');

  useEffect(() => {
    onPlacesLibReady(placesLib);
  }, [placesLib, onPlacesLibReady]);

  useEffect(() => {
    if (!placesLib || !isFocused || disabled) return;
    if (skipNextFetchRef.current) {
      skipNextFetchRef.current = false;
      return;
    }

    const trimmed = input.trim();
    if (trimmed.length < 3) {
      onSuggestions([]);
      return;
    }

    const timer = window.setTimeout(async () => {
      try {
        const { AutocompleteSessionToken, AutocompleteSuggestion } = placesLib;
        if (!sessionTokenRef.current) {
          sessionTokenRef.current = new AutocompleteSessionToken();
        }
        const res = await AutocompleteSuggestion.fetchAutocompleteSuggestions({
          input: trimmed,
          sessionToken: sessionTokenRef.current,
        });
        onSuggestions(res.suggestions || []);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        if (
          msg.includes('RESOURCE_EXHAUSTED') ||
          msg.includes('OVER_QUERY_LIMIT') ||
          msg.includes('429')
        ) {
          window.dispatchEvent(new CustomEvent('gmp-quota-exceeded'));
        }
        onSuggestions([]);
      }
    }, 240);

    return () => window.clearTimeout(timer);
  }, [placesLib, input, isFocused, disabled, skipNextFetchRef, sessionTokenRef, onSuggestions]);

  return null;
};

export const AddressAutocompleteInput: React.FC<AddressAutocompleteInputProps> = ({
  id,
  label,
  placeholder,
  value,
  onChange,
  onSelectPlace,
  allowGps = false,
  onUseGps,
  gpsLoading = false,
  disabled = false,
  accentColor = 'emerald',
  markerLabel,
  placesEnabled = false,
  mapProvider = 'google',
}) => {
  const [placesLib, setPlacesLib] = useState<google.maps.PlacesLibrary | null>(null);
  const [suggestions, setSuggestions] = useState<UnifiedSuggestion[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [isFocused, setIsFocused] = useState(false);
  const sessionTokenRef =
    useRef<google.maps.places.AutocompleteSessionToken | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const skipNextFetchRef = useRef(false);

  useEffect(() => {
    const handleClickOutside = (ev: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(ev.target as Node)
      ) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleGoogleSuggestions = React.useCallback(
    (list: google.maps.places.AutocompleteSuggestion[]) => {
      const mapped: UnifiedSuggestion[] = list.map((item) => ({
        label: item.placePrediction?.text?.text || '',
        googlePrediction: item,
      }));
      setSuggestions(mapped);
      setIsOpen(mapped.length > 0);
    },
    []
  );

  // Free Photon/Nominatim autocomplete for OSM / Carto / Apple providers
  useEffect(() => {
    if (mapProvider === 'google' || !isFocused || disabled) return;
    if (skipNextFetchRef.current) {
      skipNextFetchRef.current = false;
      return;
    }

    const trimmed = value.trim();
    if (trimmed.length < 3) {
      setSuggestions([]);
      setIsOpen(false);
      return;
    }

    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/maps/autocomplete?q=${encodeURIComponent(trimmed)}&provider=${encodeURIComponent(mapProvider)}`,
          { signal: controller.signal }
        );
        if (!res.ok) return;
        const data = (await res.json()) as {
          suggestions?: Array<{ label: string; coords?: LatLngLiteral }>;
        };
        const list = (data.suggestions || []).map((s) => ({
          label: s.label,
          coords: s.coords,
        }));
        setSuggestions(list);
        setIsOpen(list.length > 0);
      } catch {
        // Ignore aborted or transient errors
      }
    }, 280);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [mapProvider, value, isFocused, disabled]);

  const handleSelectSuggestion = async (suggestion: UnifiedSuggestion) => {
    if (!suggestion.googlePrediction) {
      skipNextFetchRef.current = true;
      onChange(suggestion.label);
      setIsOpen(false);
      setSuggestions([]);
      onSelectPlace?.(suggestion.label, suggestion.coords);
      return;
    }

    const prediction = suggestion.googlePrediction.placePrediction;
    if (!prediction) return;

    const displayLabel = prediction.text?.text || value;
    skipNextFetchRef.current = true;
    onChange(displayLabel);
    setIsOpen(false);
    setSuggestions([]);

    try {
      if (!placesLib) {
        onSelectPlace?.(displayLabel);
        return;
      }
      const place = prediction.toPlace();
      await place.fetchFields({
        fields: ['formattedAddress', 'displayName', 'location'],
      });
      const resolvedLabel = place.formattedAddress || displayLabel;
      const loc = place.location
        ? { lat: place.location.lat(), lng: place.location.lng() }
        : undefined;
      skipNextFetchRef.current = true;
      onChange(resolvedLabel);
      onSelectPlace?.(resolvedLabel, loc);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (
        msg.includes('RESOURCE_EXHAUSTED') ||
        msg.includes('OVER_QUERY_LIMIT') ||
        msg.includes('429')
      ) {
        window.dispatchEvent(new CustomEvent('gmp-quota-exceeded'));
      }
      onSelectPlace?.(displayLabel);
    } finally {
      sessionTokenRef.current = null;
    }
  };

  const markerBg =
    accentColor === 'emerald'
      ? 'bg-[#0D9488] text-white'
      : 'bg-[#E06D53] text-white';

  return (
    <div ref={containerRef} className="relative">
      {placesEnabled && mapProvider === 'google' && (
        <PlacesAutocompleteFetcher
          input={value}
          isFocused={isFocused}
          disabled={disabled}
          skipNextFetchRef={skipNextFetchRef}
          sessionTokenRef={sessionTokenRef}
          onSuggestions={handleGoogleSuggestions}
          onPlacesLibReady={setPlacesLib}
        />
      )}

      <label
        htmlFor={id}
        className="block text-xs font-semibold text-[#57423d] mb-1.5"
      >
        {label}
      </label>
      <div className="relative flex items-center">
        <span
          className={`absolute left-3 w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-bold pointer-events-none ${markerBg}`}
        >
          {markerLabel || (accentColor === 'emerald' ? 'A' : 'B')}
        </span>
        <input
          id={id}
          type="text"
          value={value}
          disabled={disabled}
          onFocus={() => setIsFocused(true)}
          onBlur={() => setIsFocused(false)}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          autoComplete="off"
          className="w-full min-h-[46px] pl-11 pr-20 py-2.5 text-sm bg-white border border-[#ddc0ba]/70 rounded-xl text-[#111c2d] placeholder:text-[#8a726c]/70 focus:outline-none focus:border-[#0D9488] focus:ring-2 focus:ring-[#0D9488]/15 transition-colors disabled:opacity-60"
        />
        <div className="absolute right-2 flex items-center gap-1">
          {value && !disabled && (
            <button
              type="button"
              onClick={() => {
                onChange('');
                setSuggestions([]);
                setIsOpen(false);
              }}
              aria-label={`Clear ${label}`}
              className="w-8 h-8 rounded-lg flex items-center justify-center text-[#8a726c] hover:text-[#111c2d] hover:bg-[#f0f3ff] transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          )}
          {allowGps && onUseGps && (
            <button
              type="button"
              onClick={onUseGps}
              disabled={disabled || gpsLoading}
              title="Use current GPS location"
              aria-label="Use current GPS location"
              className="w-9 h-9 rounded-lg flex items-center justify-center text-[#0D9488] bg-[#0D9488]/10 hover:bg-[#0D9488]/20 transition-colors disabled:opacity-50"
            >
              <LocateFixed
                className={`w-4 h-4 ${gpsLoading ? 'animate-spin' : ''}`}
              />
            </button>
          )}
        </div>
      </div>

      {isOpen && suggestions.length > 0 && (
        <ul
          role="listbox"
          className="absolute z-40 left-0 right-0 mt-1.5 bg-white border border-[#ddc0ba]/70 rounded-xl shadow-lg overflow-hidden max-h-60 overflow-y-auto carto-scroll"
        >
          {suggestions.map((suggestion, idx) => {
            const text = suggestion.label;
            return (
              <li key={idx}>
                <button
                  type="button"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    void handleSelectSuggestion(suggestion);
                  }}
                  className="w-full text-left px-3.5 py-2.5 flex items-start gap-2.5 text-sm text-[#111c2d] hover:bg-[#f0f3ff] transition-colors border-b border-[#f0f3ff] last:border-b-0"
                >
                  <MapPin className="w-4 h-4 text-[#8a726c] mt-0.5 shrink-0" />
                  <span className="leading-snug">{text}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
};
