import { Scooter, Hub, OmeletVrpRequest, OmeletVrpResponse, OptimizedRoute, Coordinate } from '../types';

// API Keys from environment
const OMELET_API_KEY = (import.meta as any).env?.VITE_OMELET_API_KEY;
const INAVI_API_KEY = (import.meta as any).env?.VITE_INAVI_API_KEY;

// Mock Data for fallback
const MOCK_COLORS = ["#3b82f6", "#ef4444", "#22c55e", "#f97316"];

// Time constraints
const SHIFT_DURATION_HOURS = 2; // 2-hour shift per truck

/**
 * Main function to solve VRP with real APIs
 */
export async function solveVrp(
  scooters: Scooter[], 
  hub: Hub, 
  truckCount: number = 3
): Promise<OptimizedRoute[]> {
  
  console.log("=== Starting TOP Optimization ===");
  console.log(`Scooters: ${scooters.length}, Hub: ${hub.name}, Trucks: ${truckCount}`);
  console.log(`Total Potential Penalty: ₩${scooters.reduce((sum, s) => sum + s.penaltyValue, 0)}`);
  
  try {
    // Step 1: Build location list (Depot first, then scooters)
    let locations: Coordinate[] = [hub.location, ...scooters.map(s => s.location)];
    let workingScooters = scooters; // Keep track of scooters that match the locations
    
    // Truncate if exceeding iNavi limit (200 locations)
    if (locations.length > 200) {
      console.warn(`⚠️ Too many locations (${locations.length}) for iNavi, truncating to 200`);
      locations = locations.slice(0, 200);
      // Truncate scooters to match (locations[0] is hub, rest are scooters)
      workingScooters = scooters.slice(0, locations.length - 1);
      console.log(`✓ Truncated to ${workingScooters.length} scooters + 1 hub = ${locations.length} locations`);
    }
    
    console.log(`Total locations for distance matrix: ${locations.length}`);
    
    // Step 2: Call iNavi Distance Matrix API
    console.log("Calling iNavi Distance Matrix API...");
    const { distanceMatrix, durationMatrix } = await getDistanceMatrix(locations);
    console.log("Distance Matrix received:", distanceMatrix.length, "x", distanceMatrix[0]?.length);
    
    // Step 3: Build Omelet VRP Request with TOP scoring (use truncated scooters)
    const vrpRequest = buildVrpRequest(workingScooters, hub, truckCount, distanceMatrix, durationMatrix);
    console.log("VRP Request prepared (TOP mode):", vrpRequest);
    
    // Step 4: Call Omelet VRP API
    console.log("Calling Omelet VRP API...");
    const vrpResponse = await callOmeletVrp(vrpRequest);
    console.log("VRP Response received:", vrpResponse);
    
    // Step 5: Parse and visualize with road geometry (use truncated scooters)
    const routes = await parseVrpResponseWithGeometry(vrpResponse, workingScooters, hub, distanceMatrix, durationMatrix);
    console.log(`✅ Optimization complete: ${routes.length} routes generated`);
    console.log(`Total Score Collected: ₩${routes.reduce((sum, r) => sum + r.totalScore, 0)}`);
    return routes;
    
  } catch (error) {
    console.error("❌ API Error, falling back to Mock Mode:", error);
    return generateMockRoutes(scooters, hub, truckCount);
  }
}

/**
 * Call iNavi Distance Matrix API with Euclidean fallback
 * This function NEVER throws - it always returns a valid matrix (either from iNavi or Euclidean)
 */
async function getDistanceMatrix(locations: Coordinate[]): Promise<{
  distanceMatrix: number[][];
  durationMatrix: number[][];
}> {
  
  if (locations.length < 3) {
    console.warn("Less than 3 locations, using Euclidean fallback");
    return calculateEuclideanMatrices(locations);
  }
  
  // iNavi API supports up to 200 points (enforced in solveVrp truncation)
  // Try iNavi API if key is available
  if (INAVI_API_KEY) {
    try {
      // Build symmetric matrix request with 'points' (iNavi standard)
      // iNavi expects { posX: string, posY: string }
      const nodes = locations.map(loc => ({
        posX: loc.lng.toString(),
        posY: loc.lat.toString()
      }));
      
      const requestBody = {
        points: nodes,
        traffic: 0
      };
      
      const response = await fetch(`/api/inavi/maps/v3.0/appkeys/${INAVI_API_KEY}/route-distance-matrix`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(requestBody)
      });
      
      if (!response.ok) {
        const errorText = await response.text();
        console.warn(`⚠️ iNavi distance matrix failed: ${response.status} ${errorText}`);
        console.warn("Falling back to Euclidean distance calculation");
        return calculateEuclideanMatrices(locations);
      }
      
      const data = await response.json();
      console.log("iNavi Distance Matrix raw response (full):", JSON.stringify(data));
      console.log("Response status:", response.status);
      
      // Try multiple possible response structures
      let distanceMatrix: number[][] | undefined;
      let durationMatrix: number[][] | undefined;
      
      // Check various possible paths in the response
      if (data?.rows) {
        // Standard iNavi response: rows[i].elements[j].distance.value / duration.value
        distanceMatrix = data.rows.map((row: any) => row.elements.map((el: any) => el.distance.value));
        durationMatrix = data.rows.map((row: any) => row.elements.map((el: any) => el.duration.value));
      } else if (data?.route?.distance_matrix) {
        distanceMatrix = data.route.distance_matrix;
        durationMatrix = data.route.duration_matrix;
      } else if (data?.distance_matrix) {
        distanceMatrix = data.distance_matrix;
        durationMatrix = data.duration_matrix;
      } else if (data?.result?.distance_matrix) {
        distanceMatrix = data.result.distance_matrix;
        durationMatrix = data.result.duration_matrix;
      } else if (data?.distanceMatrix) {
        distanceMatrix = data.distanceMatrix;
        durationMatrix = data.durationMatrix;
      }
      
      // Validate matrices exist and are properly formatted
      if (distanceMatrix && durationMatrix && 
          Array.isArray(distanceMatrix) && distanceMatrix.length > 0 &&
          Array.isArray(durationMatrix) && durationMatrix.length > 0) {
        
        // Ensure all values are integers (Omelet API requirement)
        const intDistanceMatrix = distanceMatrix.map(row => 
          Array.isArray(row) ? row.map(val => Math.round(Number(val) || 0)) : []
        );
        const intDurationMatrix = durationMatrix.map(row => 
          Array.isArray(row) ? row.map(val => Math.round(Number(val) || 0)) : []
        );
        
        console.log(`✓ iNavi Distance matrix: ${intDistanceMatrix.length}x${intDistanceMatrix[0]?.length}`);
        console.log(`✓ iNavi Duration matrix: ${intDurationMatrix.length}x${intDurationMatrix[0]?.length}`);
        return { distanceMatrix: intDistanceMatrix, durationMatrix: intDurationMatrix };
      }
      
      console.warn("⚠️ iNavi response missing or invalid matrices");
      console.warn("Falling back to Euclidean distance calculation");
      return calculateEuclideanMatrices(locations);
      
    } catch (error) {
      console.warn("⚠️ iNavi distance matrix error:", error);
      console.warn("Falling back to Euclidean distance calculation");
      return calculateEuclideanMatrices(locations);
    }
  } else {
    console.log("ℹ️ INAVI_API_KEY not set, using Euclidean distance calculation");
    return calculateEuclideanMatrices(locations);
  }
}

/**
 * Calculate Euclidean distance and duration matrices
 * Helper function extracted for reuse
 */
function calculateEuclideanMatrices(locations: Coordinate[]): {
  distanceMatrix: number[][];
  durationMatrix: number[][];
} {
  console.log("📐 Calculating Euclidean distance matrix...");
  const n = locations.length;
  const distanceMatrix: number[][] = Array.from({ length: n }, () => Array(n).fill(0));
  const durationMatrix: number[][] = Array.from({ length: n }, () => Array(n).fill(0));
  
  // Assume average speed of 30 km/h for urban driving
  const avgSpeedMps = (30 * 1000) / 3600; // 30 km/h in meters per second
  
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      if (i === j) {
        distanceMatrix[i][j] = 0;
        durationMatrix[i][j] = 0;
      } else {
        const dist = haversineDistance(locations[i], locations[j]);
        distanceMatrix[i][j] = dist;
        durationMatrix[i][j] = dist / avgSpeedMps; // duration in seconds
      }
    }
  }
  
  console.log(`✓ Euclidean Distance matrix: ${n}x${n}`);
  return { distanceMatrix, durationMatrix };
}

/**
 * Build Omelet VRP Request
 */
function buildVrpRequest(
  scooters: Scooter[],
  hub: Hub,
  truckCount: number,
  distanceMatrix: number[][],
  durationMatrix: number[][]
): OmeletVrpRequest {
  const now = new Date();
  const startTime = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 9, 0, 0);
  const endTime = new Date(startTime.getTime() + SHIFT_DURATION_HOURS * 60 * 60 * 1000);
  
  const highRiskCount = scooters.filter(s => s.state === 'C').length;
  const lowBatteryCount = scooters.filter(s => s.state === 'B').length;
  console.log(`High Risk (State C): ${highRiskCount} scooters @ ₩40K penalty each (volume=0, unlimited/truck)`);
  console.log(`Low Battery (State B): ${lowBatteryCount} scooters @ ₩2.5K penalty each (volume=1, max 20/truck)`);
  
  // Omelet API requires INTEGER matrices - round all values
  const intDistanceMatrix = distanceMatrix.map(row => row.map(val => Math.round(val)));
  const intDurationMatrix = durationMatrix.map(row => row.map(val => Math.round(val)));
  console.log("✓ Converted matrices to integers for Omelet API");
  
  return {
    depot: {
      name: hub.name,
      coordinate: hub.location
    },
    // Volume capacity approach:
    // - High Risk (C): volume=0 → unlimited per truck (truck moves scooter in-place, no cargo)
    // - Low Battery (B): volume=1 → max 20 per truck (battery swap requires carrying batteries)
    visits: scooters.map(s => ({
      name: s.id,
      coordinate: s.location,
      volume: s.state === 'C' ? 0 : 1.0,
      service_time: s.service_time,
      unassigned_penalty: s.penaltyValue // Penalty of missing this scooter
    })),
    vehicles: Array.from({ length: truckCount }, (_, i) => ({
      name: `Truck-${i + 1}`,
      volume_capacity: 20,
      vehicle_type: "car",
      work_start_time: startTime.toISOString(),
      work_end_time: endTime.toISOString()
    })),
    distance_matrix: intDistanceMatrix,
    duration_matrix: intDurationMatrix,
    delivery_start_time: startTime.toISOString(),
    option: {
      timelimit: 30,
      allow_unassigned_visits: true,
      distance_type: "osrm"
    }
  };
}

/**
 * Call Omelet VRP API
 */
async function callOmeletVrp(request: OmeletVrpRequest): Promise<OmeletVrpResponse> {
  const response = await fetch('/api/omelet/vrp', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/vnd.omelet.v2+json',
      'X-API-KEY': OMELET_API_KEY
    },
    body: JSON.stringify(request)
  });
  
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Omelet API failed: ${response.status} ${errorText}`);
  }
  
  const data = await response.json();
  return data;
}

/**
 * Fetch road geometry between two coordinates (iNavi route-time)
 * Currently falls back to straight line on failure.
 */
async function fetchRoadGeometry(from: Coordinate, to: Coordinate): Promise<Coordinate[]> {
  try {
    const now = new Date();
    const params = {
      startX: from.lng.toString(),
      startY: from.lat.toString(),
      endX: to.lng.toString(),
      endY: to.lat.toString(),
      year: now.getFullYear(),
      month: now.getMonth() + 1,
      day: now.getDate(),
      hour: now.getHours(),
      minutes: now.getMinutes(),
      type: 0
    };
    
    const response = await fetch(`/api/inavi/maps/v3.0/appkeys/${INAVI_API_KEY}/route-time`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(params)
    });
    
    if (!response.ok) {
      throw new Error(`iNavi route-time failed: ${response.status}`);
    }
    
    const data = await response.json();
    const coords: Coordinate[] = [];
    
    // iNavi route-time returns detailed paths; extract coords
    const paths = data?.route?.data?.paths || [];
    paths.forEach((p: any) => {
      if (p.coords) {
        p.coords.forEach((c: any) => coords.push({ lng: c.x, lat: c.y }));
      }
    });
    
    // If we got coordinates, return them; otherwise fallback to straight line
    if (coords.length > 0) {
      return coords;
    }
    
    return [from, to];
    
  } catch (error) {
    console.warn("Failed to fetch road geometry, using straight line:", error);
    return [from, to];
  }
}

/**
 * Parse VRP response and build route objects. Uses road geometry per segment.
 */
async function parseVrpResponseWithGeometry(
  response: OmeletVrpResponse,
  scooters: Scooter[],
  hub: Hub,
  distanceMatrix: number[][],
  durationMatrix: number[][]
): Promise<OptimizedRoute[]> {
  console.log("Parsing VRP response with road geometry...");
  
  const nameToIndex: Record<string, number> = {
    [hub.name]: 0,
    ...scooters.reduce((acc, s, idx) => ({ ...acc, [s.id]: idx + 1 }), {})
  };
  
  const parsedRoutes = await Promise.all(
    response.routing_engine_result.routes.map(async (route, index) => {
      console.log(`Processing route ${route.vehicle_name}:`, route.route_name);
      
      // Map visit names to coordinates (waypoints)
      const waypoints: Coordinate[] = route.route_name.map(name => {
        if (name === hub.name) return hub.location;
        const scooter = scooters.find(s => s.id === name);
        return scooter ? scooter.location : hub.location;
      });
      
      // Fetch road geometry for each segment
      const roadGeometry: Coordinate[][] = [];
      for (let i = 0; i < waypoints.length - 1; i++) {
        const segmentGeometry = await fetchRoadGeometry(waypoints[i], waypoints[i + 1]);
        roadGeometry.push(segmentGeometry);
      }
      
      // Calculate stats
      let totalDistance = 0;
      let totalDuration = 0;
      let totalScore = 0;
      let revenueCollected = 0;
      let finesAvoided = 0;
      let highRiskCollected = 0;
      let lowBatteryCollected = 0;
      let visitedScooters = 0;
      
      for (let i = 0; i < route.route_name.length - 1; i++) {
        const fromName = route.route_name[i];
        const toName = route.route_name[i + 1];
        
        const fromIdx = nameToIndex[fromName];
        const toIdx = nameToIndex[toName];
        
        if (fromIdx !== undefined && toIdx !== undefined && distanceMatrix[fromIdx]) {
          totalDistance += distanceMatrix[fromIdx][toIdx] || 0;
          totalDuration += durationMatrix[fromIdx][toIdx] || 0;
        }
        
        if (toName !== hub.name) {
          const scooter = scooters.find(s => s.id === toName);
          if (scooter) {
            const penalty = scooter.penaltyValue;
            totalScore += penalty; // penalty prevented by visiting
            visitedScooters++;
            totalDuration += scooter.service_time * 60; // convert minutes to seconds
            
            if (scooter.state === 'B') {
              revenueCollected += penalty; // inventory saved
              lowBatteryCollected++;
            } else if (scooter.state === 'C') {
              finesAvoided += penalty; // fines avoided
              highRiskCollected++;
            }
          }
        }
      }
      
      console.log(`Route ${route.vehicle_name} stats:`, {
        scooters: visitedScooters,
        distance: totalDistance,
        duration: totalDuration,
        score: totalScore,
        revenue: revenueCollected,
        finesAvoided: finesAvoided,
        highRisk: highRiskCollected,
        lowBattery: lowBatteryCollected
      });

      return {
        vehicleId: route.vehicle_name,
        path: waypoints,
        roadGeometry: roadGeometry,
        color: MOCK_COLORS[index % MOCK_COLORS.length],
        distance: totalDistance,
        duration: totalDuration,
        scootersCollected: visitedScooters,
        totalScore: totalScore,
        revenueCollected: revenueCollected,
        finesAvoided: finesAvoided,
        highRiskCollected: highRiskCollected,
        lowBatteryCollected: lowBatteryCollected
      };
    })
  );
  
  console.log("Parsed routes with geometry:", parsedRoutes);
  return parsedRoutes;
}

/**
 * Mock fallback for offline testing
 */
function generateMockRoutes(scooters: Scooter[], hub: Hub, truckCount: number): OptimizedRoute[] {
  console.log("🔧 Using Mock Mode");
  
  // Sort scooters by penalty value (descending) for greedy selection
  const sortedScooters = [...scooters].sort((a, b) => b.penaltyValue - a.penaltyValue);
  
  const chunkSize = Math.ceil(sortedScooters.length / truckCount);
  const routes: OptimizedRoute[] = [];

  for (let i = 0; i < truckCount; i++) {
    const chunk = sortedScooters.slice(i * chunkSize, (i + 1) * chunkSize);
    if (chunk.length === 0) continue;

    const path = [
      hub.location,
      ...chunk.map(s => s.location),
      hub.location
    ];

    // Mock statistics
      const totalScore = chunk.reduce((sum, s) => sum + s.penaltyValue, 0);
      const revenueCollected = chunk.filter(s => s.state === 'B').reduce((sum, s) => sum + s.penaltyValue, 0);
      const finesAvoided = chunk.filter(s => s.state === 'C').reduce((sum, s) => sum + s.penaltyValue, 0);
    const highRiskCollected = chunk.filter(s => s.state === 'C').length;
    const lowBatteryCollected = chunk.filter(s => s.state === 'B').length;
    const totalDistance = chunk.length * 2000; // ~2km per scooter (mock)
    const totalDuration = chunk.reduce((sum, s) => sum + s.service_time * 60, 0) + chunk.length * 300; // service + travel

    routes.push({
      vehicleId: `Mock-Truck-${i + 1}`,
      path,
      color: MOCK_COLORS[i % MOCK_COLORS.length],
      distance: totalDistance,
      duration: totalDuration,
      scootersCollected: chunk.length,
      totalScore: totalScore,
      revenueCollected: revenueCollected,
      finesAvoided: finesAvoided,
      highRiskCollected: highRiskCollected,
      lowBatteryCollected: lowBatteryCollected
    });
  }
  
  return routes;
}

/**
 * Calculate Haversine distance between two coordinates (in meters)
 */
function haversineDistance(coord1: Coordinate, coord2: Coordinate): number {
  const R = 6371e3; // Earth radius in meters
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  
  const dLat = toRad(coord2.lat - coord1.lat);
  const dLng = toRad(coord2.lng - coord1.lng);
  
  const a = 
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(coord1.lat)) * Math.cos(toRad(coord2.lat)) *
    Math.sin(dLng / 2) * Math.sin(dLng / 2);
  
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}


