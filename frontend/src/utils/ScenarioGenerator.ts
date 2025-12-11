import { Scooter, Coordinate, ScooterState, RedZonePOI } from '../types';
import * as turf from '@turf/turf';
import { fetchCommercialAnchors, fetchResidentialAnchors, fetchRedZonePOIs } from '../services/OverpassService';

// Bounding box for rejection sampling (covers all 3 districts)
const BOUNDS = {
  minLat: 37.42,
  maxLat: 37.55,
  minLng: 126.90,
  maxLng: 127.18,
};

// GeoJSON data cache
let cachedDistrictBoundaries: any = null;

// Cache for Red Zone POIs (separated by type)
let cachedSubwayExitPOIs: Coordinate[] | null = null;
let cachedBusStopPOIs: Coordinate[] | null = null;
// Cache for commercial and residential anchors
let cachedCommercialAnchors: Coordinate[] | null = null;
let cachedResidentialAnchors: Coordinate[] | null = null;

// Red Zone radius in meters (Seoul regulation: within 20m of subway station/exit or bus stop)
const RED_ZONE_RADIUS_METERS = 20;

// Real Seoul Regulation Parameters
// Distribution: 15% High Risk, 65% Commercial/Safe, 20% Residential/Alley
const HIGH_RISK_PERCENTAGE = 0.15; // 15% High Risk
const COMMERCIAL_PERCENTAGE = 0.65; // 65% Commercial/Safe (Low Battery)
const RESIDENTIAL_PERCENTAGE = 0.20; // 20% Residential/Alley (Low Battery)

// Penalty/Revenue Parameters (Korean Won)
const TOWING_FINE = 40000;        // ₩40,000 Seoul towing fine (penalty avoidance)
const BATTERY_SWAP_REVENUE = 5000; // ₩5,000 battery swap revenue
const HIGH_RISK_PENALTY = 40000;
const LOW_BATTERY_PENALTY = 2500;


/**
 * Generate random point within a radius of a center point
 * Uses polar coordinates for uniform distribution with minimum distance
 */
function generatePointNearLocation(center: Coordinate, minRadiusMeters: number, maxRadiusMeters: number): Coordinate {
  // Random angle (0 to 2π)
  const angle = Math.random() * 2 * Math.PI;
  
  // Random radius between min and max, using sqrt for uniform distribution
  // Formula: r = sqrt(random * (max^2 - min^2) + min^2)
  const radiusSquared = Math.random() * (maxRadiusMeters * maxRadiusMeters - minRadiusMeters * minRadiusMeters) + minRadiusMeters * minRadiusMeters;
  const radius = Math.sqrt(radiusSquared);
  
  // Convert meters to approximate lat/lng offset
  // At Seoul's latitude (~37.5°), 1 degree ≈ 111km for lat, ~88km for lng
  const latOffset = (radius * Math.cos(angle)) / 111000; // meters to degrees
  const lngOffset = (radius * Math.sin(angle)) / 88000;  // meters to degrees (adjusted for latitude)
  
  return {
    lat: center.lat + latOffset,
    lng: center.lng + lngOffset
  };
}

/**
 * Generate scenario using CONSTRUCTIVE GENERATION with true administrative boundaries
 * 
 * Strategy:
 * - Fetch real district boundaries (Gangnam, Seocho, Songpa)
 * - Batch A: High Risk nodes (15% of total, within 5m of Subway Exit or Bus Stop)
 *   - 75% of High Risk near Subway Exits
 *   - 25% of High Risk near Bus Stops
 *   - Jitter: 0-5m radius (tight clustering)
 * - Batch B: Low Battery generation (85% of total)
 *   - Commercial/Safe (65%): Shops, cafes, offices, bike parking
 *     - Jitter: 15-30m radius (sidewalk clutter simulation)
 *   - Residential/Alley (20%): Residential roads, apartment buildings
 *     - Jitter: 20-40m radius (less clustered, home drop-offs)
 * - Remaining → Healthy (ignored in optimization)
 * - Safety: All anchors filtered to exclude motorways, trunk roads, and water
 * - Shuffle combined array to randomize order
 */
export async function generateScenario(count: number = 50): Promise<Scooter[]> {
  // Fetch district boundaries first
  const districtGeoJSON = await fetchDistrictBoundaries();
  console.log(`\n=== Generating Scenario: ${count} Scooters (Constructive Method) ===`);
  
  // ========================================
  // FETCH RED ZONE POIs (Subway Exits + Bus Stops) - Separated by Type
  // ========================================
  let subwayExitPOIs: Coordinate[];
  let busStopPOIs: Coordinate[];

  if (cachedSubwayExitPOIs && cachedBusStopPOIs) {
    subwayExitPOIs = cachedSubwayExitPOIs;
    busStopPOIs = cachedBusStopPOIs;
    console.log(`✓ Using cached Red Zone POIs: ${subwayExitPOIs.length} subway exits + ${busStopPOIs.length} bus stops`);
  } else {
    console.log("\n[OSM] Fetching Red Zone POIs (subway exits + bus stops)...");
    const osmPOIs: RedZonePOI[] = await fetchRedZonePOIs({
      south: BOUNDS.minLat,
      west: BOUNDS.minLng,
      north: BOUNDS.maxLat,
      east: BOUNDS.maxLng
    });

    const validPOIs = osmPOIs.filter(poi => isPointInDistricts(poi.location, districtGeoJSON));
    const subwayPOIs = validPOIs.filter(p => p.type === 'subway_exit');
    const busPOIs = validPOIs.filter(p => p.type === 'bus_stop');

    subwayExitPOIs = subwayPOIs.map(poi => poi.location);
    busStopPOIs = busPOIs.map(poi => poi.location);

    cachedSubwayExitPOIs = subwayExitPOIs;
    cachedBusStopPOIs = busStopPOIs;

    console.log(`✓ Found ${validPOIs.length} Red Zone POIs inside Gangnam 3-gu`);
    console.log(`  - Subway Exits: ${subwayExitPOIs.length}`);
    console.log(`  - Bus Stops: ${busStopPOIs.length}`);
  }

  const subwayExitCount = subwayExitPOIs.length;
  const busStopCount = busStopPOIs.length;
  
  // ========================================
  // BATCH A: HIGH RISK (15% of total scooters)
  // Anchors: Subway Exits + Bus Stops
  // Jitter: 0-5m to simulate blocking entrances
  // ========================================

  const countHighRisk = Math.max(1, Math.floor(count * HIGH_RISK_PERCENTAGE));

  // Distribution among high risk: keep 75% subway, 25% bus for variety
  const BUS_STOP_RATIO = 0.25;
  const SUBWAY_RATIO = 0.75;

  const countNearBusStop = Math.max(0, Math.floor(countHighRisk * BUS_STOP_RATIO));
  const countNearSubway = countHighRisk - countNearBusStop;

  console.log(`\n[Batch A] Generating ${countHighRisk} High Risk scooters (${(HIGH_RISK_PERCENTAGE * 100).toFixed(0)}% of ${count})`);
  console.log(`  Anchors: subway exits + bus stops | Jitter: 0-5m | State: C`);
  console.log(`  Distribution: ${countNearSubway} near subway exits, ${countNearBusStop} near bus stops`);
  console.log(`  Available anchors: ${subwayExitCount} subway exits + ${busStopCount} bus stops`);

  const highRiskScooters: Scooter[] = [];

  for (let i = 0; i < countNearSubway; i++) {
    const selectedPOI = subwayExitPOIs[Math.floor(Math.random() * subwayExitPOIs.length)];
    const location = generateValidPointNearAnchor(selectedPOI, 0, 5, districtGeoJSON); // 0-5m jitter
    
    highRiskScooters.push({
      id: `S-HR-SUB-${i + 1}`,
      location,
      state: 'C',
      batteryLevel: Math.floor(Math.random() * 50) + 20,
      service_time: 5,
      penaltyValue: HIGH_RISK_PENALTY,
      score: HIGH_RISK_PENALTY
    });
  }

  for (let i = 0; i < countNearBusStop; i++) {
    const selectedPOI = busStopPOIs[Math.floor(Math.random() * busStopPOIs.length)];
    const location = generateValidPointNearAnchor(selectedPOI, 0, 5, districtGeoJSON); // 0-5m jitter
    
    highRiskScooters.push({
      id: `S-HR-BUS-${i + 1}`,
      location,
      state: 'C',
      batteryLevel: Math.floor(Math.random() * 50) + 20,
      service_time: 5,
      penaltyValue: HIGH_RISK_PENALTY,
      score: HIGH_RISK_PENALTY
    });
  }

  console.log(`✓ Generated ${highRiskScooters.length} High Risk scooters within 5m of subway/bus stops`);
  
  // ========================================
  // BATCH B: LOW BATTERY (Commercial + Residential)
  // Commercial: anchors = convenience/cafe/restaurant/fast_food/office/bike parking
  //   jitter: 15-30m, State B
  // Residential: anchors = residential roads, apartments, parks
  //   jitter: 20-40m, State B
  // ========================================
  const countCommercial = Math.floor(count * COMMERCIAL_PERCENTAGE);
  const countResidential = Math.floor(count * RESIDENTIAL_PERCENTAGE);
  const countLowBattery = countCommercial + countResidential;
  const countHealthy = count - countHighRisk - countLowBattery;

  console.log(`\n[Batch B] Generating ${countLowBattery} Low Battery scooters`);
  console.log(`  - Commercial: ${countCommercial} scooters (15–30m jitter near shops/cafes/restaurants)`);
  console.log(`  - Residential: ${countResidential} scooters (20–40m jitter in alleys/parks/apartments)`);
  console.log(`  - Healthy (State A): ${countHealthy} scooters (ignored)`);

  // Fetch commercial anchors (cached if available)
  if (!cachedCommercialAnchors) {
    console.log(`\n[Commercial] Fetching commercial anchor points...`);
    const commercialAnchors = await fetchCommercialAnchors({
      south: BOUNDS.minLat,
      west: BOUNDS.minLng,
      north: BOUNDS.maxLat,
      east: BOUNDS.maxLng
    });
    cachedCommercialAnchors = commercialAnchors.filter(a => isPointInDistricts(a, districtGeoJSON));
    console.log(`✓ Using ${cachedCommercialAnchors.length} commercial anchor points`);
  } else {
    console.log(`✓ Using cached commercial anchors: ${cachedCommercialAnchors.length}`);
  }

  // Fetch residential anchors (cached if available)
  if (!cachedResidentialAnchors) {
    console.log(`\n[Residential] Fetching residential/alleyway anchor points...`);
    const residentialAnchors = await fetchResidentialAnchors({
      south: BOUNDS.minLat,
      west: BOUNDS.minLng,
      north: BOUNDS.maxLat,
      east: BOUNDS.maxLng
    });
    cachedResidentialAnchors = residentialAnchors.filter(a => isPointInDistricts(a, districtGeoJSON));
    console.log(`✓ Using ${cachedResidentialAnchors.length} residential anchor points`);
  } else {
    console.log(`✓ Using cached residential anchors: ${cachedResidentialAnchors.length}`);
  }

  const commercialLocations: Coordinate[] = [];
  for (let i = 0; i < countCommercial; i++) {
    const anchor = cachedCommercialAnchors![Math.floor(Math.random() * cachedCommercialAnchors!.length)];
    const location = generateValidPointNearAnchor(anchor, 15, 30, districtGeoJSON);
    commercialLocations.push(location);
  }
  console.log(`✓ Generated ${commercialLocations.length} scooters near commercial POIs (15-30m jitter)`);

  const residentialLocations: Coordinate[] = [];
  for (let i = 0; i < countResidential; i++) {
    const anchor = cachedResidentialAnchors![Math.floor(Math.random() * cachedResidentialAnchors!.length)];
    const location = generateValidPointNearAnchor(anchor, 20, 40, districtGeoJSON);
    residentialLocations.push(location);
  }
  console.log(`✓ Generated ${residentialLocations.length} scooters near residential areas (20-40m jitter)`);

  const allLowBatteryLocations = [...commercialLocations, ...residentialLocations];

  const lowBatteryScooters: Scooter[] = allLowBatteryLocations.map((location, i) => ({
    id: `S-LB-${i + 1}`,
    location,
    state: 'B' as ScooterState,
    batteryLevel: Math.floor(Math.random() * 20),
    service_time: 1,
    penaltyValue: LOW_BATTERY_PENALTY,
    score: LOW_BATTERY_PENALTY
  }));
  
  // ========================================
  // COMBINE & SHUFFLE
  // ========================================
  const allScooters = [...highRiskScooters, ...lowBatteryScooters];
  
  // Shuffle to randomize order (so High Risk isn't always first)
  allScooters.sort(() => Math.random() - 0.5);
  
  // Reassign sequential IDs
  allScooters.forEach((scooter, i) => {
    scooter.id = `S-${i + 1}`;
  });
  
  // ========================================
  // SUMMARY
  // ========================================
  const totalPotentialValue = allScooters.reduce((sum, s) => sum + s.score, 0);
  
  console.log(`\n=== Scenario Summary ===`);
  console.log(`High Risk (State C): ${highRiskScooters.length} scooters @ ₩40K each = ₩${(highRiskScooters.length * TOWING_FINE / 1000).toFixed(0)}K`);
  console.log(`  - Subway exits (0-5m): ${countNearSubway}`);
  console.log(`  - Bus stops (0-5m): ${countNearBusStop}`);
  console.log(`Low Battery (State B): ${lowBatteryScooters.length} scooters @ ₩5K each = ₩${(lowBatteryScooters.length * BATTERY_SWAP_REVENUE / 1000).toFixed(0)}K`);
  console.log(`  - Commercial (15-30m): ${countCommercial}`);
  console.log(`  - Residential (20-40m): ${countResidential}`);
  console.log(`Healthy (State A): ${countHealthy} scooters (ignored)`);
  console.log(`Total in Optimization: ${allScooters.length} scooters`);
  console.log(`Total Potential Value: ₩${(totalPotentialValue / 1000).toFixed(0)}K`);
  console.log(`Average Value: ₩${(totalPotentialValue / allScooters.length / 1000).toFixed(1)}K per scooter\n`);
  
  return allScooters;
}

// Map center for Greater Gangnam Area (Gangnam 3-gu)
export const GANGNAM_CENTER: Coordinate = {
  lat: 37.50,
  lng: 127.055
};

/**
 * Get cached district boundaries (for map rendering)
 */
export function getCachedDistrictBoundaries(): any {
  return cachedDistrictBoundaries;
}

/**
 * Fetch and cache Seoul district boundaries from GitHub
 * Returns filtered GeoJSON containing only Gangnam, Seocho, and Songpa districts
 */
export async function fetchDistrictBoundaries(): Promise<any> {
  if (cachedDistrictBoundaries) {
    console.log("Using cached district boundaries");
    return cachedDistrictBoundaries;
  }

  console.log("Fetching Seoul district boundaries from GitHub...");
  
  try {
    const response = await fetch(
      'https://raw.githubusercontent.com/southkorea/seoul-maps/master/kostat/2013/json/seoul_municipalities_geo_simple.json'
    );
    
    if (!response.ok) {
      throw new Error(`Failed to fetch boundaries: ${response.status}`);
    }
    
    const seoulGeoJSON = await response.json();
    
    // Filter for Gangnam 3-gu only
    const targetDistricts = ['Gangnam-gu', 'Seocho-gu', 'Songpa-gu'];
    const filteredFeatures = seoulGeoJSON.features.filter((feature: any) => 
      targetDistricts.includes(feature.properties.name_eng)
    );
    
    cachedDistrictBoundaries = {
      type: 'FeatureCollection',
      features: filteredFeatures
    };
    
    console.log(`✓ Loaded ${filteredFeatures.length} districts:`, 
      filteredFeatures.map((f: any) => f.properties.name_eng).join(', '));
    
    return cachedDistrictBoundaries;
    
  } catch (error) {
    console.error("Failed to fetch district boundaries:", error);
    throw error;
  }
}

/**
 * Check if a point is inside any of the Gangnam 3-gu districts
 * Handles both Polygon and MultiPolygon geometries
 */
export function isPointInDistricts(point: Coordinate, districtGeoJSON: any): boolean {
  const turfPoint = turf.point([point.lng, point.lat]);
  
  for (const feature of districtGeoJSON.features) {
    if (turf.booleanPointInPolygon(turfPoint, feature)) {
      return true;
    }
  }
  
  return false;
}

/**
 * Generate random point within district boundaries using rejection sampling
 * Retries until a point falls inside one of the 3 districts
 */
function generateRandomPointInDistricts(districtGeoJSON: any, maxAttempts: number = 100): Coordinate {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const lat = BOUNDS.minLat + Math.random() * (BOUNDS.maxLat - BOUNDS.minLat);
    const lng = BOUNDS.minLng + Math.random() * (BOUNDS.maxLng - BOUNDS.minLng);
    const point: Coordinate = { lat, lng };
    
    if (isPointInDistricts(point, districtGeoJSON)) {
      return point;
    }
  }
  
  // Fallback to center if rejection sampling fails
  return GANGNAM_CENTER;
}

/**
 * Generate random point near an anchor with boundary validation
 * Ensures the jittered point stays within district boundaries
 */
function generateValidPointNearAnchor(
  anchor: Coordinate, 
  minRadius: number, 
  maxRadius: number,
  districtGeoJSON: any,
  maxAttempts: number = 10
): Coordinate {
  // Try to generate a valid jittered point
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const jitteredPoint = generatePointNearLocation(anchor, minRadius, maxRadius);
    
    if (isPointInDistricts(jitteredPoint, districtGeoJSON)) {
      return jitteredPoint;
    }
  }
  
  // If all jittered attempts fail, use the anchor itself
  return anchor;
}
