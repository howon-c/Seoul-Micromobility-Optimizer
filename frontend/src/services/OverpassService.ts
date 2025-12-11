import { Coordinate, RedZonePOI } from '../types';
import { DepotCandidate } from '../types';

// Cache for anchor points (keyed by bounds string)
const anchorCache: Map<string, Coordinate[]> = new Map();

export interface OverpassBounds {
  south: number;
  west: number;
  north: number;
  east: number;
}

interface OverpassNode {
  type: 'node';
  id: number;
  lat: number;
  lon: number;
  tags?: {
    [key: string]: string;
  };
}

interface OverpassResponse {
  elements: OverpassNode[];
}

// Red Zone POI (subway exit or bus stop) - Imported from types.ts

// Cache for Red Zone POIs
const redZonePOICache: Map<string, RedZonePOI[]> = new Map();

// Cache for Subway Stations
const subwayStationCache: Map<string, RedZonePOI[]> = new Map();
// Cache for depot candidates
const depotCandidateCache: Map<string, DepotCandidate[]> = new Map();

/**
 * Generate cache key from bounds
 */
function getCacheKey(bounds: OverpassBounds): string {
  return `${bounds.south.toFixed(3)},${bounds.west.toFixed(3)},${bounds.north.toFixed(3)},${bounds.east.toFixed(3)}`;
}

/**
 * Build Overpass QL query for commercial/safe battery swap anchor points
 * Fetches POIs with adequate sidewalk space or private frontage:
 * - Convenience Stores (CU, GS25) - ubiquitous, safe frontage
 * - Cafes (Starbucks, Ediya) - high demand, good sidewalk space
 * - Fast Food (McDonald's, Burger King) - common drop-off points
 * - Office Buildings - high demand, designated parking areas
 * - Bike Parking - actual designated parking (100% safe)
 */
function buildCommercialAnchorsQuery(bounds: OverpassBounds): string {
  const { south, west, north, east } = bounds;
  
  return `
    [out:json][timeout:60];
    (
      node["shop"="convenience"](${south},${west},${north},${east});
      node["amenity"="cafe"](${south},${west},${north},${east});
      node["amenity"="restaurant"](${south},${west},${north},${east});
      node["amenity"="fast_food"](${south},${west},${north},${east});
      node["office"](${south},${west},${north},${east});
      node["amenity"="bicycle_parking"](${south},${west},${north},${east});
    );
    out body;
  `.trim();
}

/**
 * Build Overpass QL query for residential/alleyway anchor points
 * Fetches residential areas where users end trips at home:
 * - Residential roads (highway=residential) - extracts nodes from ways
 * - Apartment buildings (building=apartments)
 */
function buildResidentialAnchorsQuery(bounds: OverpassBounds): string {
  const { south, west, north, east } = bounds;
  
  // Fetch ways and their nodes, plus apartment building nodes
  return `
    [out:json][timeout:60];
    (
      way["highway"="residential"](${south},${west},${north},${east});
      way["building"="apartments"](${south},${west},${north},${east});
      node["building"="apartments"](${south},${west},${north},${east});
      node["leisure"="park"](${south},${west},${north},${east});
      way["leisure"="park"](${south},${west},${north},${east});
    );
    (._;>;);
    out body;
  `.trim();
}

/**
 * Fetch commercial anchor points from Overpass API
 * Returns array of coordinates representing safe commercial spawn locations
 */
export async function fetchCommercialAnchors(bounds: OverpassBounds): Promise<Coordinate[]> {
  const cacheKey = `commercial_${getCacheKey(bounds)}`;
  
  // Check cache first
  if (anchorCache.has(cacheKey)) {
    console.log("✓ Using cached commercial anchor points:", anchorCache.get(cacheKey)!.length);
    return anchorCache.get(cacheKey)!;
  }
  
  console.log("Fetching commercial anchor points from Overpass API...");
  console.log(`  Bounds: (${bounds.south}, ${bounds.west}) to (${bounds.north}, ${bounds.east})`);
  
  try {
    const query = buildCommercialAnchorsQuery(bounds);
    
    // Use fallback servers
    const servers = [
      'https://overpass-api.de/api/interpreter',
      'https://overpass.kumi.systems/api/interpreter',
      'https://maps.mail.ru/osm/tools/overpass/api/interpreter'
    ];

    let data: OverpassResponse | null = null;
    let lastError;

    for (const url of servers) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 65000);

        console.log(`Trying Overpass server: ${url}`);
        const response = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: `data=${encodeURIComponent(query)}`,
          signal: controller.signal
        });
        clearTimeout(timeoutId);

        if (!response.ok) {
          throw new Error(`Server returned ${response.status}`);
        }

        const text = await response.text();
        try {
          data = JSON.parse(text);
          if (data) break;
        } catch (parseError) {
          throw new Error(`Invalid JSON response: ${text.substring(0, 50)}...`);
        }
      } catch (e) {
        lastError = e;
        console.warn(`Overpass server ${url} failed. Trying next server...`, e);
      }
    }

    if (!data) {
      throw lastError || new Error(`All Overpass servers failed.`);
    }
    
    if (!data.elements || data.elements.length === 0) {
      console.warn("No commercial anchor points found in this area");
      return [];
    }
    
    // Convert Overpass nodes to Coordinates
    const anchors: Coordinate[] = data.elements
      .filter(el => el.type === 'node')
      .map(node => ({
        lat: node.lat,
        lng: node.lon
      }));
    
    console.log(`✓ Fetched ${anchors.length} commercial anchor points from Overpass API`);
    console.log(`  Convenience stores, cafes, fast food, offices, and bike parking`);
    
    // Cache the results
    anchorCache.set(cacheKey, anchors);
    
    return anchors;
    
  } catch (error) {
    console.error("Failed to fetch commercial anchor points from Overpass API:", error);
    throw error;
  }
}

/**
 * Fetch residential/alleyway anchor points from Overpass API
 * Returns array of coordinates representing residential spawn locations
 */
export async function fetchResidentialAnchors(bounds: OverpassBounds): Promise<Coordinate[]> {
  const cacheKey = `residential_${getCacheKey(bounds)}`;
  
  // Check cache first
  if (anchorCache.has(cacheKey)) {
    console.log("✓ Using cached residential anchor points:", anchorCache.get(cacheKey)!.length);
    return anchorCache.get(cacheKey)!;
  }
  
  console.log("Fetching residential/alleyway anchor points from Overpass API...");
  
  try {
    const query = buildResidentialAnchorsQuery(bounds);
    
    // Use fallback servers
    const servers = [
      'https://overpass-api.de/api/interpreter',
      'https://overpass.kumi.systems/api/interpreter',
      'https://maps.mail.ru/osm/tools/overpass/api/interpreter'
    ];

    let data: OverpassResponse | null = null;
    let lastError;

    for (const url of servers) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 65000);

        console.log(`Trying Overpass server: ${url}`);
        const response = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: `data=${encodeURIComponent(query)}`,
          signal: controller.signal
        });
        clearTimeout(timeoutId);

        if (!response.ok) {
          throw new Error(`Server returned ${response.status}`);
        }

        const text = await response.text();
        try {
          data = JSON.parse(text);
          if (data) break;
        } catch (parseError) {
          throw new Error(`Invalid JSON response: ${text.substring(0, 50)}...`);
        }
      } catch (e) {
        lastError = e;
        console.warn(`Overpass server ${url} failed. Trying next server...`, e);
      }
    }

    if (!data) {
      throw lastError || new Error(`All Overpass servers failed.`);
    }
    
    if (!data.elements || data.elements.length === 0) {
      console.warn("No residential anchor points found in this area");
      return [];
    }
    
    // Extract coordinates from nodes (from ways and standalone nodes)
    // The query (._;>;) returns ways and all their member nodes
    const anchors: Coordinate[] = [];
    const seenCoords = new Set<string>();
    
    data.elements.forEach(el => {
      if (el.type === 'node' && el.lat && el.lon) {
        const key = `${el.lat.toFixed(6)},${el.lon.toFixed(6)}`;
        if (!seenCoords.has(key)) {
          seenCoords.add(key);
          anchors.push({ lat: el.lat, lng: el.lon });
        }
      }
    });
    
    console.log(`✓ Fetched ${anchors.length} residential anchor points from Overpass API`);
    console.log(`  Residential roads and apartment buildings`);
    
    // Cache the results
    anchorCache.set(cacheKey, anchors);
    
    return anchors;
    
  } catch (error) {
    console.error("Failed to fetch residential anchor points from Overpass API:", error);
    throw error;
  }
}

/**
 * Check if a coordinate is in a safe area (not on motorways, trunk roads, or water)
 * This is a client-side approximation - full safety requires checking against OSM data
 * For now, we rely on the anchor filtering to ensure safe spawn points
 */
export function isSafeLocation(_coord: Coordinate): boolean {
  // Placeholder: anchors are pre-filtered; extend with spatial checks if needed
  return true;
}

/**
 * Legacy function for backward compatibility
 * @deprecated Use fetchCommercialAnchors instead
 */
export async function fetchAnchors(bounds: OverpassBounds): Promise<Coordinate[]> {
  return fetchCommercialAnchors(bounds);
}

/**
 * Fetch all "Red Zone" POIs (subway exits + bus stops) from OpenStreetMap
 * These are locations where scooter parking is prohibited/high-risk
 * 
 * Red Zone Definition: Any coordinate within 5 meters of:
 * - Subway Exit (railway=subway_entrance)
 * - Bus Stop (highway=bus_stop)
 */
export async function fetchRedZonePOIs(bounds: OverpassBounds): Promise<RedZonePOI[]> {
  const cacheKey = `redzone_${getCacheKey(bounds)}`;
  
  // Check cache first
  if (redZonePOICache.has(cacheKey)) {
    const cached = redZonePOICache.get(cacheKey)!;
    console.log("✓ Using cached Red Zone POIs:", cached.length);
    return cached;
  }
  
  console.log("\n[Red Zone] Fetching subway exits and bus stops from OpenStreetMap...");
  
  try {
    // Fetch both subway exits and bus stops in a single query for efficiency
    // Increased timeout to 60s
    const query = `
      [out:json][timeout:60];
      (
        node["railway"="subway_entrance"](${bounds.south},${bounds.west},${bounds.north},${bounds.east});
        node["highway"="bus_stop"](${bounds.south},${bounds.west},${bounds.north},${bounds.east});
      );
      out body;
    `.trim();
    
    // Use fallback server if needed
    const servers = [
      'https://overpass-api.de/api/interpreter',
      'https://overpass.kumi.systems/api/interpreter',
      'https://maps.mail.ru/osm/tools/overpass/api/interpreter'
    ];

    let data: OverpassResponse | null = null;
    let lastError;

    // Retry loop
    for (const url of servers) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 65000); // Client-side timeout slightly longer than query timeout

        console.log(`Trying Overpass server: ${url}`);
        const response = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: `data=${encodeURIComponent(query)}`,
          signal: controller.signal
        });
        clearTimeout(timeoutId);

        if (!response.ok) {
          throw new Error(`Server returned ${response.status}`);
        }

        // Try to parse JSON - this catches the "Unexpected token <" error if server returns HTML error page
        const text = await response.text();
        try {
          data = JSON.parse(text);
          if (data) break; // Success!
        } catch (parseError) {
          throw new Error(`Invalid JSON response: ${text.substring(0, 50)}...`);
        }

      } catch (e) {
        lastError = e;
        console.warn(`Overpass server ${url} failed. Trying next server...`, e);
      }
    }
    
    if (!data) {
      throw lastError || new Error(`All Overpass servers failed.`);
    }
    
    if (!data.elements || data.elements.length === 0) {
      console.warn("No Red Zone POIs found in this area");
      return [];
    }
    
    // Convert Overpass nodes to RedZonePOI objects
    const pois: RedZonePOI[] = data.elements
      .filter(node => node.type === 'node')
      .map(node => {
        const isSubway = node.tags?.railway === 'subway_entrance';
        return {
          location: { lat: node.lat, lng: node.lon },
          name: node.tags?.name || node.tags?.['name:ko'] || (isSubway ? 'Subway Exit' : 'Bus Stop'),
          type: isSubway ? 'subway_exit' : 'bus_stop',
          ref: node.tags?.ref
        } as RedZonePOI;
      });
    
    // Count by type
    const subwayCount = pois.filter(p => p.type === 'subway_exit').length;
    const busStopCount = pois.filter(p => p.type === 'bus_stop').length;
    
    console.log(`✓ Fetched ${pois.length} Red Zone POIs from OpenStreetMap`);
    console.log(`  - Subway Exits: ${subwayCount}`);
    console.log(`  - Bus Stops: ${busStopCount}`);
    
    // Log some examples
    const subwayExamples = pois.filter(p => p.type === 'subway_exit').slice(0, 3);
    const busStopExamples = pois.filter(p => p.type === 'bus_stop').slice(0, 3);
    
    if (subwayExamples.length > 0) {
      console.log("  Sample subway exits:");
      subwayExamples.forEach(poi => {
        console.log(`    - ${poi.name} ${poi.ref ? `(Exit ${poi.ref})` : ''}`);
      });
    }
    
    if (busStopExamples.length > 0) {
      console.log("  Sample bus stops:");
      busStopExamples.forEach(poi => {
        console.log(`    - ${poi.name}`);
      });
    }
    
    // Cache the results
    redZonePOICache.set(cacheKey, pois);
    
    return pois;
    
  } catch (error) {
    console.error("Failed to fetch Red Zone POIs from Overpass API:", error);
    throw error;
  }
}

/**
 * Fetch subway stations from OpenStreetMap
 * Returns array of RedZonePOI objects with type 'subway_station'
 * Query: node["railway"="station"]["station"="subway"]
 */
export async function fetchSubwayStations(bounds: OverpassBounds): Promise<RedZonePOI[]> {
  const cacheKey = `subway_stations_${getCacheKey(bounds)}`;
  
  // Check cache first
  if (subwayStationCache.has(cacheKey)) {
    const cached = subwayStationCache.get(cacheKey)!;
    console.log("✓ Using cached subway stations:", cached.length);
    return cached;
  }
  
  console.log("\n[Subway Stations] Fetching subway stations from OpenStreetMap...");
  
  try {
    // Query for subway stations: railway=station AND station=subway
    // Increased timeout to 60s
    const query = `
      [out:json][timeout:60];
      (
        node["railway"="station"]["station"="subway"](${bounds.south},${bounds.west},${bounds.north},${bounds.east});
      );
      out body;
    `.trim();
    
    // Use fallback server if needed
    const servers = [
      'https://overpass-api.de/api/interpreter',
      'https://overpass.kumi.systems/api/interpreter',
      'https://maps.mail.ru/osm/tools/overpass/api/interpreter'
    ];

    let data: OverpassResponse | null = null;
    let lastError;

    // Retry loop
    for (const url of servers) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 65000); 

        console.log(`Trying Overpass server: ${url}`);
        const response = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: `data=${encodeURIComponent(query)}`,
          signal: controller.signal
        });
        clearTimeout(timeoutId);

        if (!response.ok) {
          throw new Error(`Server returned ${response.status}`);
        }

        // Try to parse JSON
        const text = await response.text();
        try {
          data = JSON.parse(text);
          if (data) break; // Success!
        } catch (parseError) {
          throw new Error(`Invalid JSON response: ${text.substring(0, 50)}...`);
        }

      } catch (e) {
        lastError = e;
        console.warn(`Overpass server ${url} failed. Trying next server...`, e);
      }
    }
    
    if (!data) {
      throw lastError || new Error(`All Overpass servers failed.`);
    }
    
    // Process the data that was already parsed in the loop
    // (No need to declare 'const data' again)
    
    if (!data.elements || data.elements.length === 0) {
      console.warn("No subway stations found in this area");
      return [];
    }
    
    // Convert Overpass nodes to RedZonePOI objects
    const stations: RedZonePOI[] = data.elements
      .filter(node => node.type === 'node')
      .map(node => ({
        location: { lat: node.lat, lng: node.lon },
        name: node.tags?.name || node.tags?.['name:ko'] || 'Subway Station',
        type: 'subway_station' as const,
        ref: node.tags?.ref
      }));
    
    console.log(`✓ Fetched ${stations.length} subway stations from OpenStreetMap`);
    
    // Log some examples
    if (stations.length > 0) {
      console.log("  Sample stations:");
      stations.slice(0, 5).forEach(station => {
        console.log(`    - ${station.name}${station.ref ? ` (${station.ref})` : ''}`);
      });
    }
    
    // Cache the results
    subwayStationCache.set(cacheKey, stations);
    
    return stations;
    
  } catch (error) {
    console.error("Failed to fetch subway stations from Overpass API:", error);
    throw error;
  }
}

/**
 * Fetch depot candidate sites (parking lots + bus stations) from OpenStreetMap
 * Returns array of DepotCandidate with type 'parking' or 'station'
 */
export async function fetchDepotCandidates(bounds: OverpassBounds): Promise<DepotCandidate[]> {
  const cacheKey = `depots_${getCacheKey(bounds)}`;

  if (depotCandidateCache.has(cacheKey)) {
    const cached = depotCandidateCache.get(cacheKey)!;
    console.log("✓ Using cached depot candidates:", cached.length);
    return cached;
  }

  console.log("\n[Depot Candidates] Fetching parking lots and bus stations from OpenStreetMap...");

  try {
    const query = `
      [out:json][timeout:60];
      (
        node["amenity"="parking"](${bounds.south},${bounds.west},${bounds.north},${bounds.east});
        node["amenity"="bus_station"](${bounds.south},${bounds.west},${bounds.north},${bounds.east});
      );
      out body;
    `.trim();

    // Use fallback server if needed
    const servers = [
      'https://overpass-api.de/api/interpreter',
      'https://overpass.kumi.systems/api/interpreter',
      'https://maps.mail.ru/osm/tools/overpass/api/interpreter'
    ];

    let data: OverpassResponse | null = null;
    let lastError;

    // Retry loop
    for (const url of servers) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 65000); 

        console.log(`Trying Overpass server: ${url}`);
        const response = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: `data=${encodeURIComponent(query)}`,
          signal: controller.signal
        });
        clearTimeout(timeoutId);

        if (!response.ok) {
          throw new Error(`Server returned ${response.status}`);
        }

        // Try to parse JSON
        const text = await response.text();
        try {
          data = JSON.parse(text);
          if (data) break; // Success!
        } catch (parseError) {
          throw new Error(`Invalid JSON response: ${text.substring(0, 50)}...`);
        }

      } catch (e) {
        lastError = e;
        console.warn(`Overpass server ${url} failed. Trying next server...`, e);
      }
    }
    
    if (!data) {
      throw lastError || new Error(`All Overpass servers failed.`);
    }

    if (!data.elements || data.elements.length === 0) {
      console.warn("No depot candidates found in this area");
      return [];
    }

    const candidates: DepotCandidate[] = data.elements
      .filter(node => node.type === 'node')
      .map(node => {
        const isParking = node.tags?.amenity === 'parking';
        return {
          id: `depot-${node.id}`,
          location: { lat: node.lat, lng: node.lon },
          type: isParking ? 'parking' : 'station',
          name: node.tags?.name || node.tags?.['name:ko'] || (isParking ? 'Parking Lot' : 'Bus Station')
        } as DepotCandidate;
      });

    console.log(`✓ Fetched ${candidates.length} depot candidates (parking + stations)`);
    depotCandidateCache.set(cacheKey, candidates);
    return candidates;

  } catch (error) {
    console.error("Failed to fetch depot candidates from Overpass API:", error);
    throw error;
  }
}

