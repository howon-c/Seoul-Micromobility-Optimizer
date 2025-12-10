export interface Coordinate {
  lng: number;
  lat: number;
}

export type BatteryStatus = "low" | "normal" | "full";
export type ScooterState = "B" | "C"; // B = Low Battery, C = High Risk (near subway)

export interface Scooter {
  id: string;
  location: Coordinate;
  state: ScooterState;
  batteryLevel: number; // 0-100
  service_time: number; // minutes
  score: number; // Revenue + Fine Avoidance (for TOP)
}

export interface Hub {
  id: string;
  location: Coordinate;
  name: string;
}

// Red Zone POI (subway exit, bus stop, or subway station)
export interface RedZonePOI {
  location: Coordinate;
  name: string;
  type: 'subway_exit' | 'bus_stop' | 'subway_station';
  ref?: string;
}

// Depot candidate (parking lot or bus station)
export interface DepotCandidate {
  id: string;
  location: Coordinate;
  type: 'parking' | 'station';
  name?: string;
}

// Omelet VRP Types
export interface VrpVisit {
  name: string;
  coordinate: Coordinate;
  volume: number;
  service_time: number;
  unassigned_penalty: number; // Maps to score for TOP simulation
}

export interface VrpVehicle {
  name: string;
  volume_capacity: number;
  vehicle_type: "bike" | "car" | "walk";
  work_start_time?: string | null; // ISO 8601
  work_end_time?: string | null; // ISO 8601
}

export interface OmeletVrpRequest {
  depot: {
    name: string;
    coordinate: Coordinate;
    volume?: number;
  };
  visits: VrpVisit[];
  vehicles: VrpVehicle[];
  distance_matrix?: number[][];
  duration_matrix?: number[][];
  delivery_start_time?: string | null;
  option?: {
    timelimit?: number;
    distance_type?: "osrm" | "euclidean";
    allow_unassigned_visits?: boolean;
    objective_type?: "minsum" | "minmax" | "maximize_value";
  };
}

export interface OmeletRoute {
  vehicle_name: string;
  route_name: string[];
  route_cost_details: {
    distance_cost: number;
    duration_cost: number;
  };
}

export interface OmeletVrpResponse {
  routing_engine_result: {
    routes: OmeletRoute[];
    unassigned_visit_names: string[];
  };
  status: string;
}

// Internal Route Model for Visualization
export interface OptimizedRoute {
  vehicleId: string;
  path: Coordinate[]; // Ordered waypoints (scooter locations)
  roadGeometry?: Coordinate[][]; // Actual road paths between waypoints (from iNavi)
  color: string;
  distance: number; // meters
  duration: number; // seconds
  scootersCollected: number;
  totalScore: number; // Total financial value (revenue + fines avoided)
  revenueCollected: number; // Revenue from Low Battery scooters
  finesAvoided: number; // Fines avoided from High Risk scooters
  highRiskCollected: number; // Count of High Risk scooters collected
  lowBatteryCollected: number; // Count of Low Battery scooters collected
}
