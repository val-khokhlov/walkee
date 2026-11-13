import type {
  CategoryDefinition,
  CategoryId,
  MapProviderId,
  RevisitedBehavior,
  VoiceName,
} from '../types/tour';

export const DISCOVERY_CATEGORIES: CategoryDefinition[] = [
  {
    id: 'historical',
    label: 'Historical Sites',
    shortLabel: 'History',
    description: 'Landmark events, civic heritage, and neighborhood evolution.',
    targetWords: '800–1000 words',
    queryTemplate:
      'Is the building {ADDRESS} an important historical site, and if so provide me in 800-1000 words a summary of its history',
  },
  {
    id: 'famous_people',
    label: 'Famous People',
    shortLabel: 'People',
    description: 'Notable residents, creators, leaders, and historical figures.',
    targetWords: '600–800 words',
    queryTemplate:
      'Is the building {ADDRESS} related to famous people, and if so provide me in 600-800 words a summary on the person and how the person is related to that building',
  },
  {
    id: 'architecture',
    label: 'Architecture & Design',
    shortLabel: 'Architecture',
    description: 'Style, school, key facade elements, architects, and build year.',
    targetWords: '600–800 words',
    queryTemplate:
      'Is the building {ADDRESS} of notable architectural interest, if so please provide in 600-800 words details on its style and school, key architectural elements, who and when constructed it, maybe some interesting facts',
  },
  {
    id: 'cultural',
    label: 'Cultural & Literary',
    shortLabel: 'Culture',
    description: 'Literature, film locations, music venues, and artistic legacy.',
    targetWords: '600–800 words',
    queryTemplate:
      'Is the building {ADDRESS} significant in literature, cinema, music, or local culture, and if so provide me in 600-800 words a summary of its cultural heritage and notable stories',
  },
  {
    id: 'folklore',
    label: 'Hidden Lore & Mysteries',
    shortLabel: 'Lore',
    description: 'Lesser-known anecdotes, dramatic moments, and urban legends.',
    targetWords: '500–700 words',
    queryTemplate:
      'Are there notable local legends, hidden mysteries, or dramatic events connected to the building {ADDRESS}, and if so provide me in 500-700 words an engaging narrative',
  },
];

export const CATEGORY_MAP: Record<CategoryId, CategoryDefinition> = DISCOVERY_CATEGORIES.reduce(
  (acc, item) => {
    acc[item.id] = item;
    return acc;
  },
  {} as Record<CategoryId, CategoryDefinition>
);

export const REVISITED_OPTIONS: {
  id: RevisitedBehavior;
  label: string;
  description: string;
}[] = [
  {
    id: 'skip',
    label: 'Skip automatically',
    description: 'Stay quiet when passing a building already narrated on this walk.',
  },
  {
    id: 'brief_recap',
    label: 'Brief recap',
    description: 'Speak a short 2-sentence reminder of the building highlights.',
  },
  {
    id: 'replay',
    label: 'Replay full story',
    description: 'Read all matching category stories from the start again.',
  },
  {
    id: 'prompt',
    label: 'Ask before repeating',
    description: 'Show a quick on-screen prompt to replay, recap, or skip.',
  },
];

export const VOICE_OPTIONS: { id: VoiceName; label: string; tone: string }[] = [
  { id: 'Kore', label: 'Kore', tone: 'Warm, articulate documentary' },
  { id: 'Charon', label: 'Charon', tone: 'Deep, authoritative historian' },
  { id: 'Puck', label: 'Puck', tone: 'Curious, brisk storyteller' },
  { id: 'Fenrir', label: 'Fenrir', tone: 'Measured architectural critic' },
  { id: 'Zephyr', label: 'Zephyr', tone: 'Calm, conversational guide' },
];

export interface PresetRoute {
  id: string;
  title: string;
  city: string;
  distanceHint: string;
  origin: string;
  destination: string;
}

export const PRESET_ROUTES: PresetRoute[] = [
  {
    id: 'sf-jackson-square',
    title: 'Jackson Square & Barbary Coast',
    city: 'San Francisco',
    distanceHint: '1.1 km',
    origin: 'Transamerica Pyramid, 600 Montgomery St, San Francisco, CA',
    destination: 'Coit Tower, 1 Telegraph Hill Blvd, San Francisco, CA',
  },
  {
    id: 'nyc-soho',
    title: 'SoHo Cast-Iron Historic Walk',
    city: 'New York',
    distanceHint: '1.0 km',
    origin: '478 Broadway, New York, NY',
    destination: '101 Spring St, New York, NY',
  },
  {
    id: 'london-bloomsbury',
    title: 'Bloomsbury Literary Squares',
    city: 'London',
    distanceHint: '1.2 km',
    origin: 'British Museum, Great Russell St, London, UK',
    destination: '48 Doughty St, London, UK',
  },
  {
    id: 'boston-beacon',
    title: 'Beacon Hill Freedom Trail',
    city: 'Boston',
    distanceHint: '0.9 km',
    origin: 'Massachusetts State House, 24 Beacon St, Boston, MA',
    destination: '85 Mount Vernon St, Boston, MA',
  },
];

export interface MapProviderOption {
  id: MapProviderId;
  name: string;
  badge: string;
  description: string;
  requiresToken?: boolean;
}

export const MAP_PROVIDER_OPTIONS: MapProviderOption[] = [
  {
    id: 'google',
    name: 'Google Maps',
    badge: 'API Key / Demo Tier',
    description:
      'Google Maps JS canvas, Routes API, Places (New), and Geocoding v4.',
  },
  {
    id: 'osm',
    name: 'OpenStreetMap',
    badge: 'Free · No Key',
    description:
      'Standard OSM tiles via Leaflet with free OSRM foot routing, Photon/Nominatim search & Overpass building scan.',
  },
  {
    id: 'carto',
    name: 'Carto Voyager (OSM)',
    badge: 'Free · No Key',
    description:
      'Minimalist Carto Voyager map tiles over OpenStreetMap data with free OSRM walking routes & Overpass address discovery.',
  },
  {
    id: 'apple',
    name: 'Apple Maps (MapKit JS)',
    badge: 'Free 250k/day Tier',
    description:
      'Apple MapKit JS when APPLE_MAPS_TOKEN is set; otherwise uses clean Light Carto + free OSM routing with zero setup.',
    requiresToken: true,
  },
];

