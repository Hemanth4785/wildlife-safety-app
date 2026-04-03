import { ANIMALS } from '../../constants';
import { safeArray, safeObject } from '../../utils/safety';

export type IntentType =
  | 'GREETING'
  | 'SAFE_PLACES'
  | 'ROUTE_PLAN'
  | 'AREA_RISK'
  | 'IMAGE_SEARCH'
  | 'LOCATION_ONLY'
  | 'ANIMAL_SAFETY'
  | 'UNKNOWN';

export interface IntentResult {
  intent: IntentType;
  confidence: number;
  entities?: {
    location?: string;
    origin?: string;
    dest?: string;
    animal?: string;
  };
}

export interface RouteQuery {
  origin?: string;
  dest?: string;
}

export interface PlacePrefs {
  policeCount: number;
  forestCount: number;
  order: 'police' | 'forest';
}

/**
 * Normalize text for easier matching
 */
const normalizeText = (text: string): string => {
  return text
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[.,!?;]/g, '')
    .trim();
};

/**
 * Parse route queries
 */
export const parseRouteQuery = (text: string): RouteQuery => {
  const t = normalizeText(text);

  const patterns = [
    /plan\s+safe\s+route\s+from\s+(.+?)\s+to\s+(.+)/,
    /from\s+(.+?)\s+to\s+(.+)/,
    /navigate\s+from\s+(.+?)\s+to\s+(.+)/,
    /directions\s+from\s+(.+?)\s+to\s+(.+)/,
    /(.+?)\s+(?:to|->)\s+(.+)/
  ];

  for (const p of patterns) {
    const m = t.match(p);
    if (m) {
      return { origin: m[1].trim(), dest: m[2].trim() };
    }
  }

  return {};
};

/**
 * Detect user intent
 */
export const detectIntent = (text: string): IntentResult => {
  const t = normalizeText(text);

  console.log("DEBUG:", ANIMALS);
  const animalNames = safeArray<any>(Object.values(safeObject<any>(ANIMALS))).map(a =>
    String(a?.common || '').toLowerCase()
  );

  /**
   * GREETING
   */
  if (/^(hi|hello|hey|hai|hola|namaste|vanakkam|good (morning|afternoon|evening))/.test(t)) {
    return { intent: 'GREETING', confidence: 0.95 };
  }

  /**
   * SAFE PLACES
   */
  const safeKeywords = [
    'safe place',
    'police',
    'forest office',
    'ranger',
    'station',
    'emergency',
    'help'
  ];

  if (safeKeywords.some(k => t.includes(k))) {
    return { intent: 'SAFE_PLACES', confidence: 0.8 };
  }

  /**
   * ROUTE PLAN
   */
  const route = parseRouteQuery(text);

  const routeKeywords = [
    'route',
    'navigate',
    'directions',
    'drive to',
    'travel to',
    'way to',
    'go to',
    'plan a safe route',
    'route planner'
  ];

  if (route.origin && route.dest) {
    return {
      intent: 'ROUTE_PLAN',
      confidence: 0.99,
      entities: route
    };
  }

  // Check for general route planning requests (even without locations)
  const routeIntentPattern = /plan.*route|safe route|help.*route|route planner|navigate|directions/i;
  if (routeIntentPattern.test(t)) {
    return {
      intent: 'ROUTE_PLAN',
      confidence: 0.8
    };
  }

  if (routeKeywords.some(k => t.includes(k))) {
    const destMatch = t.match(/(?:to|towards|into)\s+([a-z\s]+)/);
    return {
      intent: 'ROUTE_PLAN',
      confidence: 0.75,
      entities: { dest: destMatch?.[1]?.trim() }
    };
  }

  /**
   * IMAGE SEARCH
   */
  if (
    t.includes('image') ||
    t.includes('photo') ||
    t.includes('picture')
  ) {
    return { intent: 'IMAGE_SEARCH', confidence: 0.9 };
  }

  /**
   * ANIMAL SAFETY
   */
  const safetyKeywords = [
    'what to do',
    'danger',
    'risk',
    'nearby',
    'encounter',
    'spotted'
  ];

  const foundAnimal = animalNames.find(a => t.includes(a));

  if (foundAnimal && safetyKeywords.some(k => t.includes(k))) {
    return {
      intent: 'ANIMAL_SAFETY',
      confidence: 0.95,
      entities: { animal: foundAnimal }
    };
  }

  /**
   * AREA RISK
   */
  const areaKeywords = [
    'nearby risk',
    'wildlife risk',
    'animals near',
    'wildlife near',
    'check nearby risks',
    'nearby',
    'wildlife',
    'animals',
    'risks',
    'danger',
    'sightings'
  ];

  if (areaKeywords.some(k => t.includes(k)) || foundAnimal) {
    const locMatch = t.match(/(?:in|near|at|around)\s+([a-z\s]+)/);

    return {
      intent: 'AREA_RISK',
      confidence: 0.7,
      entities: { location: locMatch?.[1]?.trim() }
    };
  }

  /**
   * LOCATION ONLY
   */
  const words = t.split(' ');
  if (words.length <= 3) {
    return {
      intent: 'LOCATION_ONLY',
      confidence: 0.6,
      entities: { location: t }
    };
  }

  return { intent: 'UNKNOWN', confidence: 0 };
};

/**
 * Parse preferences for safe place search
 */
export const parsePlacePrefs = (text: string): PlacePrefs => {
  const t = normalizeText(text);

  let policeCount = 3;
  let forestCount = 3;
  let order: 'police' | 'forest' = 'police';

  if (t.includes('forest first')) order = 'forest';
  if (t.includes('police first')) order = 'police';

  const pm = t.match(/police\s*(\d+)/);
  if (pm) policeCount = Math.min(10, Math.max(1, Number(pm[1])));

  const fm = t.match(/forest\s*(\d+)/);
  if (fm) forestCount = Math.min(10, Math.max(1, Number(fm[1])));

  return { policeCount, forestCount, order };
};