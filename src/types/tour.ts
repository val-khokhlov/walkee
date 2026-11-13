export type CategoryId =
  | 'historical'
  | 'famous_people'
  | 'architecture'
  | 'cultural'
  | 'folklore';

export interface CategoryDefinition {
  id: CategoryId;
  label: string;
  shortLabel: string;
  description: string;
  targetWords: string;
  queryTemplate: string;
}

export type RevisitedBehavior = 'skip' | 'brief_recap' | 'replay' | 'prompt';

export type VoiceName = 'Kore' | 'Charon' | 'Puck' | 'Fenrir' | 'Zephyr';

export type MapProviderId = 'google' | 'osm' | 'carto' | 'apple';

export interface LatLngLiteral {
  lat: number;
  lng: number;
}

export interface WaypointItem {
  id: string;
  label: string;
  coords?: LatLngLiteral;
}

export interface RouteStep {
  instruction: string;
  maneuver?: string;
  distanceMeters: number;
  durationSeconds: number;
  startLocation: LatLngLiteral;
  endLocation: LatLngLiteral;
}

export interface ComputedRoute {
  originLabel: string;
  destinationLabel: string;
  origin: LatLngLiteral;
  destination: LatLngLiteral;
  waypoints?: Array<{ label: string; location: LatLngLiteral }>;
  encodedPolyline: string;
  path: LatLngLiteral[];
  distanceMeters: number;
  durationSeconds: number;
  steps: RouteStep[];
  viewport?: {
    low: LatLngLiteral;
    high: LatLngLiteral;
  };
}

export interface DiscoveredBuilding {
  id: string;
  streetAddress: string;
  normalizedAddress: string;
  displayName?: string;
  neighborhood?: string;
  location: LatLngLiteral;
  distanceFromRouteMeters: number;
  routeProgressMeters: number;
  placeId?: string;
  googleMapsUri?: string;
  primaryType?: string;
}

export interface GroundingSource {
  title: string;
  uri: string;
}

export interface CategoryFinding {
  categoryId: CategoryId;
  queryUsed: string;
  isNotable: boolean;
  headline: string;
  summary: string;
  wordCount: number;
  sources: GroundingSource[];
  googleSearchUrl?: string;
  searchProvider?: string;
}

export interface ResearchedBuilding extends DiscoveredBuilding {
  findings: CategoryFinding[];
  positiveCount: number;
  researchedAt: number;
  cachedOffline?: boolean;
  rawAiResponse?: string;
}

export interface GuideSettings {
  mapProvider: MapProviderId;
  deviationMeters: number;
  selectedCategories: CategoryId[];
  cacheForOffline: boolean;
  revisitedBehavior: RevisitedBehavior;
  voiceName: VoiceName;
  playbackRate: number;
  autoTriggerProximity: boolean;
}

export interface CachedRouteBundle {
  id: string;
  routeKey: string;
  originLabel: string;
  destinationLabel: string;
  waypointLabels?: string[];
  route: ComputedRoute;
  deviationMeters: number;
  selectedCategories: CategoryId[];
  buildings: ResearchedBuilding[];
  analyzedBuildings?: ResearchedBuilding[];
  mapProvider?: MapProviderId;
  savedAt: number;
}

export interface DiscoveryProgressState {
  phase: 'tracing' | 'scanning' | 'researching' | 'caching' | 'ready' | 'error';
  message: string;
  totalBuildings: number;
  completedBuildings: number;
  positiveBuildings: number;
  currentAddress?: string;
  error?: string;
}
