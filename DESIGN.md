# E-Scooter Rebalancing Demo - Design Document

**Version:** 1.0  
**Date:** December 2024  
**Status:** Planning Phase

---

## Table of Contents

1. [Project Overview](#1-project-overview)
2. [Architecture](#2-architecture)
3. [User Workflow & Application Flow](#3-user-workflow--application-flow)
4. [Data Models & State Management](#4-data-models--state-management)
5. [API Integration Strategy](#5-api-integration-strategy)
6. [Capacity Modeling](#6-capacity-modeling)
7. [UI/UX Design](#7-uiux-design)
8. [Implementation Plan](#8-implementation-plan)

---

## 1. Project Overview

### 1.1 Purpose

The E-Scooter Rebalancing Demo is a Single Page Application (SPA) that demonstrates optimized routing for collecting low-battery e-scooters in Seoul, South Korea. The application uses real routing APIs (Omelet VRP and iNavi Maps) to solve a practical logistics problem.

### 1.2 Key Features

- **Interactive Map**: Visualize scooters, hubs, and optimized routes
- **Random Scenario Generation**: Generate realistic scooter distributions in Seoul
- **Real-time Optimization**: Call external APIs to compute optimal truck routes
- **Visual Feedback**: Color-coded markers and route polylines

### 1.3 Technical Constraints

- **No Backend Server**: All logic runs in the browser
- **MCP Tools Integration**: The React app will interact with MCP tools (either via window/client interface or TypeScript mocks)
- **Region-Specific**: Designed for Seoul, South Korea (coordinates and APIs support this region)

---

## 2. Architecture

### 2.1 Technology Stack

#### Frontend Framework
- **React 18+** (with TypeScript)
- **Vite** as build tool and dev server

#### Mapping & Visualization
- **Leaflet** for interactive map rendering
- **React-Leaflet** for React bindings

#### Styling
- **Tailwind CSS** for utility-first styling
- Custom components for UI controls

#### API Integration
- **Direct HTTP calls** to Omelet and iNavi APIs (via TypeScript service layer)
- **MCP Tools Bridge**: TypeScript functions that abstract MCP tool calls
  - In production: Would call MCP server via window/client interface
  - For demo: Mock functions that simulate MCP responses or call APIs directly

### 2.2 Application Structure

```
src/
├── components/          # React components
│   ├── Map/            # Leaflet map component
│   ├── Controls/       # UI controls (sliders, buttons)
│   └── Markers/        # Scooter and hub markers
├── services/           # API integration layer
│   ├── omelet/         # Omelet VRP API client
│   ├── inavi/          # iNavi Maps API client
│   └── mcp-bridge.ts   # MCP tools bridge (or mocks)
├── types/              # TypeScript type definitions
│   ├── domain.ts       # Domain models (Scooter, Truck, etc.)
│   ├── api.ts          # API request/response types
│   └── state.ts        # Application state types
├── stores/             # State management (React Context or Zustand)
│   └── appState.ts     # Main application state store
├── utils/              # Utility functions
│   ├── coordinate.ts   # Coordinate transformations
│   ├── generation.ts   # Random scooter generation
│   └── mapping.ts      # Domain → API mapping functions
├── hooks/              # Custom React hooks
│   └── useOptimization.ts
└── App.tsx             # Root component
```

### 2.3 State Management Strategy

We will use **React Context + useReducer** for centralized state management, or **Zustand** for a simpler alternative. The state will be divided into:

1. **Scooter State**: List of scooters with locations and battery status
2. **Hub State**: User-placed rebalancing hubs (depots)
3. **Truck State**: Configuration and count of trucks
4. **Route State**: Optimized routes from VRP solver
5. **UI State**: Map viewport, loading states, error messages

---

## 3. User Workflow & Application Flow

### 3.1 Phase 1: Setup (Scooter Generation)

**User Action:**
- User enters a number (e.g., 500) in an input field
- User clicks "Generate Scooters"

**Application Logic:**
1. Validate input (e.g., 1-5000 scooters)
2. Generate random coordinates within Seoul boundaries:
   - Seoul approximate bounds: `lng: [126.7, 127.2]`, `lat: [37.4, 37.7]`
3. Assign battery status to each scooter:
   - **Low Battery (< 20%)**: ~30% of scooters → Mark as RED
   - **Normal Battery (≥ 20%)**: ~70% of scooters → Mark as GREEN
4. Store scooters in application state
5. Render markers on map with color coding

**UI Components:**
- Number input with validation
- "Generate Scooters" button
- Map with Leaflet markers

---

### 3.2 Phase 2: Strategic Setup (Hubs & Trucks)

**User Actions:**
1. Click on map to place "Rebalancing Hubs" (depots)
   - Each click creates a hub marker at that location
   - User can place multiple hubs (typically 1-3)
2. Adjust "Number of Trucks" slider (e.g., 1-10 trucks)
   - Slider updates truck count in state

**Application Logic:**
1. Store hub coordinates in state as user clicks
2. Store truck count from slider
3. For each truck, create a vehicle configuration:
   - Default capacity (e.g., 20 scooters per truck)
   - Default cost parameters
   - All trucks start from the same hub (or assign each truck to nearest hub)

**UI Components:**
- Map in "hub placement mode" (cursor changes to crosshair)
- Slider component for truck count
- "Clear Hubs" button (optional)
- Hub markers (distinct from scooter markers, e.g., blue icons)

---

### 3.3 Phase 3: Operational Optimization (Agent Logic)

**User Action:**
- User clicks "Optimize Collection" button

**Application Logic (Agent/Service Layer):**

#### Step 3.1: Filter Low Battery Scooters
```typescript
const lowBatteryScooters = scooters.filter(s => s.batteryLevel < 20);
```

#### Step 3.2: Map Domain Models to API Models

**Map Low Battery Scooters → Omelet Visits:**
- Each low-battery scooter becomes a `visit`
- Demand: `volume = 1.0` (one scooter unit)
- Service time: 2-3 minutes per pickup

**Map Hubs → Omelet Depot:**
- If multiple hubs: Use the first hub as the single depot (or create separate VRP problems per hub)
- For simplicity: Aggregate all trucks to one hub, or use the hub nearest to the scooter cluster

**Map Trucks → Omelet Vehicles:**
- Each truck becomes a `vehicle`
- `volume_capacity = truckCapacity` (e.g., 20 scooters)
- `vehicle_type = "car"`

#### Step 3.3: Build Location List for Distance Matrix

Create ordered list of coordinates:
```
[depot, scooter1, scooter2, ..., scooterN]
```

Total locations = 1 (depot) + N (low battery scooters)

#### Step 3.4: Call iNavi Distance Matrix API

**Request:**
- Convert coordinates to iNavi format: `{ posX: string, posY: string }`
- Send POST to `/maps/v3.0/appkeys/{appkey}/route-distance-matrix`
- Use traffic mode 0 (no traffic) or 1 (real-time) depending on preference

**Response Processing:**
- Extract distance matrix (meters)
- Extract duration matrix (seconds)
- Convert to integers as required by Omelet

#### Step 3.5: Build Omelet VRP Request

**Depot:**
```typescript
depot: {
  name: "Hub-1",
  coordinate: { lng: hub.lng, lat: hub.lat }
}
```

**Visits:**
```typescript
visits: lowBatteryScooters.map(scooter => ({
  name: scooter.id,
  coordinate: { lng: scooter.location.lng, lat: scooter.location.lat },
  volume: 1.0,  // One scooter unit
  service_time: 3  // 3 minutes to pick up scooter
}))
```

**Vehicles:**
```typescript
vehicles: Array.from({ length: truckCount }, (_, i) => ({
  name: `Truck-${i + 1}`,
  volume_capacity: 20,  // Can carry 20 scooters
  vehicle_type: "car",
  fixed_cost: 0,
  unit_distance_cost: 1.0,
  unit_duration_cost: 0.0
}))
```

**Matrices:**
```typescript
distance_matrix: distanceMatrix,  // From iNavi response
duration_matrix: durationMatrix   // From iNavi response
```

**Options:**
```typescript
option: {
  timelimit: 30,  // 30 seconds optimization time
  objective_type: "minsum",
  distance_type: "osrm",  // Since we're providing matrices, this is ignored but good to specify
  allow_unassigned_visits: true  // Allow some scooters to be unassigned if infeasible
}
```

#### Step 3.6: Call Omelet VRP API

**Request:**
- POST to `https://routing.oaasis.cc/api/vrp`
- Headers:
  - `Accept: application/vnd.omelet.v2+json`
  - `X-API-KEY: <OMELET_API_KEY>`
- Body: JSON payload built in Step 3.5

**Response Processing:**
- Extract routes (vehicle assignments)
- Extract unassigned visits (if any)
- Store in application state

#### Step 3.7: Error Handling

- Network errors: Display user-friendly message
- API errors: Parse error response and display
- Infeasible solution: Show warning and partial results

---

### 3.4 Phase 4: Visualization

**Application Logic:**

1. **Parse Route Results:**
   - Each route contains `route_name` array: `["Depot", "Scooter-1", "Scooter-2", ..., "Depot"]`
   - Map route names back to coordinates

2. **Draw Routes on Map:**
   - Create colored polylines for each truck route
   - Color scheme: `Truck-1` = Blue, `Truck-2` = Red, `Truck-3` = Green, etc.
   - Draw line segments connecting consecutive stops
   - Add arrows to show direction of travel

3. **Highlight Unassigned Scooters:**
   - If any scooters are unassigned, mark them with a warning icon or different color

4. **Display Statistics:**
   - Total distance traveled
   - Total time
   - Number of scooters collected
   - Number of unassigned scooters

**UI Components:**
- Route polylines on Leaflet map
- Legend showing truck colors
- Statistics panel/sidebar

---

## 4. Data Models & State Management

### 4.1 Domain Models (TypeScript Interfaces)

```typescript
// types/domain.ts

export interface Coordinate {
  lng: number;  // longitude (decimal degrees)
  lat: number;  // latitude (decimal degrees)
}

export type BatteryStatus = "low" | "normal" | "full";

export interface Scooter {
  id: string;
  location: Coordinate;
  batteryLevel: number;  // 0-100 (percentage)
  status: BatteryStatus; // Derived: <20% = "low"
}

export interface Hub {
  id: string;
  location: Coordinate;
  name?: string;
}

export interface TruckConfig {
  id: string;
  scooterCapacity: number;  // Max scooters this truck can carry
  fixedCost: number;
  unitDistanceCost: number;
  unitDurationCost: number;
}

export interface RouteStop {
  type: "depot" | "scooter";
  id: string;
  location: Coordinate;
  order: number;  // Sequence in route (0, 1, 2, ...)
}

export interface OptimizedRoute {
  truckId: string;
  color: string;  // For visualization
  stops: RouteStop[];
  totalDistance: number;  // meters
  totalDuration: number;  // seconds
  scootersCollected: number;
}
```

### 4.2 Application State Interface

```typescript
// types/state.ts

export interface AppState {
  // Phase 1: Scooters
  scooters: Scooter[];
  scooterGenerationCount: number | null;
  
  // Phase 2: Hubs & Trucks
  hubs: Hub[];
  truckCount: number;
  truckConfig: TruckConfig;  // Default config applied to all trucks
  
  // Phase 3: Optimization
  isOptimizing: boolean;
  optimizationError: string | null;
  
  // Phase 4: Results
  routes: OptimizedRoute[];
  unassignedScooterIds: string[];  // Scooters that couldn't be assigned
  
  // UI State
  mapCenter: Coordinate;
  mapZoom: number;
  phase: "setup" | "strategic" | "optimizing" | "results";
}
```

### 4.3 State Management Implementation

**Option 1: React Context + useReducer**

```typescript
// stores/appState.tsx

type AppAction =
  | { type: "GENERATE_SCOOTERS"; count: number }
  | { type: "ADD_HUB"; hub: Hub }
  | { type: "SET_TRUCK_COUNT"; count: number }
  | { type: "START_OPTIMIZATION" }
  | { type: "SET_ROUTES"; routes: OptimizedRoute[]; unassigned: string[] }
  | { type: "SET_ERROR"; error: string };

const initialState: AppState = {
  scooters: [],
  scooterGenerationCount: null,
  hubs: [],
  truckCount: 3,
  truckConfig: {
    id: "default",
    scooterCapacity: 20,
    fixedCost: 0,
    unitDistanceCost: 1.0,
    unitDurationCost: 0.0,
  },
  isOptimizing: false,
  optimizationError: null,
  routes: [],
  unassignedScooterIds: [],
  mapCenter: { lng: 126.978, lat: 37.5665 }, // Seoul center
  mapZoom: 12,
  phase: "setup",
};

function appReducer(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case "GENERATE_SCOOTERS":
      return {
        ...state,
        scooters: generateScooters(action.count),
        phase: "strategic",
      };
    // ... other cases
  }
}

export const AppStateProvider = ({ children }) => {
  const [state, dispatch] = useReducer(appReducer, initialState);
  return (
    <AppStateContext.Provider value={{ state, dispatch }}>
      {children}
    </AppStateContext.Provider>
  );
};
```

**Option 2: Zustand (Simpler Alternative)**

```typescript
// stores/appState.ts

import { create } from 'zustand';

interface AppStore extends AppState {
  generateScooters: (count: number) => void;
  addHub: (hub: Hub) => void;
  setTruckCount: (count: number) => void;
  // ... other actions
}

export const useAppStore = create<AppStore>((set) => ({
  ...initialState,
  generateScooters: (count) => set({ scooters: generateScooters(count) }),
  // ... other actions
}));
```

---

## 5. API Integration Strategy

### 5.1 MCP Tools Bridge

Since we're not using a backend, we need a TypeScript layer that bridges the React app to MCP tools. In a production environment, MCP tools might be accessible via a browser extension or window interface. For this demo, we'll create a service layer that either:

1. **Calls APIs directly** (if API keys are available in environment variables)
2. **Mocks the responses** (for development/demo purposes)

```typescript
// services/mcp-bridge.ts

const OMELET_API_KEY = import.meta.env.VITE_OMELET_API_KEY;
const INAVI_API_KEY = import.meta.env.VITE_INAVI_API_KEY;

/**
 * Bridge function that calls Omelet VRP API directly
 * In production, this might call an MCP tool instead
 */
export async function solveVrp(request: OmeletVrpRequest): Promise<OmeletVrpResponse> {
  const response = await fetch("https://routing.oaasis.cc/api/vrp", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Accept": "application/vnd.omelet.v2+json",
      "X-API-KEY": OMELET_API_KEY,
    },
    body: JSON.stringify(request),
  });
  
  if (!response.ok) {
    throw new Error(`Omelet API error: ${response.statusText}`);
  }
  
  return response.json();
}

/**
 * Bridge function for iNavi distance matrix
 */
export async function getDistanceMatrix(
  points: Coordinate[],
  traffic: 0 | 1 | 2 | 3 = 0
): Promise<DistanceMatrixResponse> {
  const inaviPoints = points.map(p => ({
    posX: p.lng.toString(),
    posY: p.lat.toString(),
  }));
  
  const response = await fetch(
    `https://dev-maps.inavi.com/maps/v3.0/appkeys/${INAVI_API_KEY}/route-distance-matrix`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        points: inaviPoints,
        traffic,
      }),
    }
  );
  
  if (!response.ok) {
    throw new Error(`iNavi API error: ${response.statusText}`);
  }
  
  return response.json();
}
```

### 5.2 Service Layer Organization

```typescript
// services/optimization.ts

import { solveVrp } from "./mcp-bridge";
import { getDistanceMatrix } from "./mcp-bridge";
import { mapScootersToVisits, mapHubsToDepot, mapTrucksToVehicles } from "../utils/mapping";

export async function optimizeCollection(
  scooters: Scooter[],
  hubs: Hub[],
  truckCount: number,
  truckConfig: TruckConfig
): Promise<{ routes: OptimizedRoute[]; unassigned: string[] }> {
  
  // Step 1: Filter low battery scooters
  const lowBatteryScooters = scooters.filter(s => s.batteryLevel < 20);
  
  // Step 2: Map to API models
  const depot = mapHubsToDepot(hubs[0]); // Use first hub
  const visits = mapScootersToVisits(lowBatteryScooters);
  const vehicles = mapTrucksToVehicles(truckCount, truckConfig, hubs[0]);
  
  // Step 3: Build location list
  const allLocations = [depot.coordinate, ...visits.map(v => v.coordinate)];
  
  // Step 4: Get distance/duration matrices from iNavi
  const matrixResponse = await getDistanceMatrix(allLocations);
  const { distanceMatrix, durationMatrix } = parseMatrixResponse(matrixResponse);
  
  // Step 5: Build Omelet request
  const vrpRequest: OmeletVrpRequest = {
    depot,
    visits,
    vehicles,
    distance_matrix: distanceMatrix,
    duration_matrix: durationMatrix,
    option: {
      timelimit: 30,
      objective_type: "minsum",
      allow_unassigned_visits: true,
    },
  };
  
  // Step 6: Call Omelet VRP
  const vrpResponse = await solveVrp(vrpRequest);
  
  // Step 7: Map response to domain models
  return mapVrpResponseToRoutes(vrpResponse, scooters, hubs);
}
```

---

## 6. Capacity Modeling

### 6.1 Collection Mode (Pure Pickup)

For the **Collection Mode** (truck starts empty, picks up broken/low-battery scooters, returns to hub), we model capacity as follows:

#### **Truck Capacity:**
- **`volume_capacity`** = Maximum number of scooters the truck can carry
  - Example: `volume_capacity = 20` means the truck can pick up 20 scooters
- **`weight_capacity`** = Not used in this model (or set to a high value if required)
- **Rationale**: We're modeling discrete scooter units, so volume is the simplest abstraction

#### **Scooter Demand:**
- Each low-battery scooter becomes a visit with **`volume = 1.0`**
  - This represents "1 scooter unit" that must be picked up
- **Service time**: `service_time = 3` minutes (time to load one scooter)

#### **VRP Constraint:**
The Omelet solver ensures that:
```
Sum of volumes on a route ≤ vehicle.volume_capacity
```

Example:
- Truck with `volume_capacity = 20`
- Route: [Depot → Scooter-1 (vol=1) → Scooter-2 (vol=1) → ... → Scooter-20 (vol=1) → Depot]
- Total volume = 20 ✓ (feasible)
- If we tried to add Scooter-21: Total volume = 21 ✗ (infeasible, violates capacity)

### 6.2 Detailed Capacity Mapping

```typescript
// utils/mapping.ts

export function mapTrucksToVehicles(
  truckCount: number,
  config: TruckConfig,
  hub: Hub
): OmeletVehicle[] {
  return Array.from({ length: truckCount }, (_, i) => ({
    name: `Truck-${i + 1}`,
    volume_capacity: config.scooterCapacity,  // e.g., 20 scooters
    weight_capacity: 0,  // Not used in this model
    vehicle_type: "car",
    fixed_cost: config.fixedCost,
    unit_distance_cost: config.unitDistanceCost,
    unit_duration_cost: config.unitDurationCost,
  }));
}

export function mapScootersToVisits(scooters: Scooter[]): OmeletVisit[] {
  return scooters.map(scooter => ({
    name: scooter.id,
    coordinate: {
      lng: scooter.location.lng,
      lat: scooter.location.lat,
    },
    volume: 1.0,  // Each scooter = 1 unit of volume
    weight: 0,    // Not used in this model
    service_time: 3,  // 3 minutes to pick up one scooter
  }));
}
```

### 6.3 Alternative: Using Weight Instead of Volume

If you prefer to model using weight:

```typescript
// Assume average scooter weight = 15 kg
const SCOOTER_WEIGHT_KG = 15;

// Truck capacity in kg
vehicle.weight_capacity = config.scooterCapacity * SCOOTER_WEIGHT_KG;  // e.g., 20 * 15 = 300 kg

// Scooter demand
visit.weight = SCOOTER_WEIGHT_KG;  // 15 kg per scooter
```

**Recommendation**: Use **volume** for simplicity in this demo, as it directly maps to "number of scooters" and is easier to reason about.

---

## 7. UI/UX Design

### 7.1 Layout Structure

```
┌─────────────────────────────────────────────────────────┐
│  Header: "E-Scooter Rebalancing Demo"                   │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  ┌──────────────┐  ┌────────────────────────────────┐  │
│  │              │  │                                │  │
│  │  Controls    │  │                                │  │
│  │  Panel       │  │        Map (Leaflet)           │  │
│  │              │  │                                │  │
│  │  - Scooter   │  │  [Scooters, Hubs, Routes]     │  │
│  │    Input     │  │                                │  │
│  │  - Truck     │  │                                │  │
│  │    Slider    │  │                                │  │
│  │  - Buttons   │  │                                │  │
│  │              │  │                                │  │
│  └──────────────┘  └────────────────────────────────┘  │
│                                                         │
│  ┌──────────────────────────────────────────────────┐  │
│  │  Statistics Panel (shown after optimization)     │  │
│  │  - Total Distance                                │  │
│  │  - Total Time                                    │  │
│  │  - Scooters Collected                            │  │
│  └──────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────┘
```

### 7.2 Color Scheme

- **Normal Battery Scooters**: Green marker (`#22c55e`)
- **Low Battery Scooters**: Red marker (`#ef4444`)
- **Rebalancing Hubs**: Blue marker (`#3b82f6`)
- **Truck Routes**: 
  - Truck 1: Blue polyline (`#3b82f6`)
  - Truck 2: Red polyline (`#ef4444`)
  - Truck 3: Green polyline (`#22c55e`)
  - Truck 4+: Rotate through colors
- **Unassigned Scooters**: Orange marker (`#f97316`)

### 7.3 Component Breakdown

1. **MapContainer** (React-Leaflet)
   - Main Leaflet map
   - Event handlers for clicks (hub placement)

2. **ScooterMarker**
   - Conditional styling based on battery status
   - Popup with scooter ID and battery level

3. **HubMarker**
   - Distinct icon (e.g., warehouse/building icon)
   - Popup with hub name

4. **RoutePolyline**
   - Colored line connecting route stops
   - Arrow markers for direction

5. **ControlPanel**
   - Scooter count input
   - "Generate Scooters" button
   - Truck count slider
   - "Optimize Collection" button
   - Loading spinner during optimization

6. **StatisticsPanel**
   - Display route statistics
   - List unassigned scooters (if any)

---

## 8. Implementation Plan

### Phase 1: Project Setup
- [ ] Initialize Vite + React + TypeScript project
- [ ] Install dependencies (Leaflet, React-Leaflet, Tailwind CSS)
- [ ] Set up project structure
- [ ] Configure environment variables for API keys

### Phase 2: Core Components
- [ ] Implement MapContainer with Leaflet
- [ ] Create ScooterMarker and HubMarker components
- [ ] Build ControlPanel with inputs and buttons
- [ ] Implement basic state management (Context or Zustand)

### Phase 3: Scooter Generation
- [ ] Implement random coordinate generation for Seoul
- [ ] Add battery status assignment logic
- [ ] Render scooters on map with color coding

### Phase 4: Hub Placement
- [ ] Add click handler for hub placement
- [ ] Render hub markers on map
- [ ] Implement truck count slider

### Phase 5: API Integration
- [ ] Implement MCP bridge functions (or direct API calls)
- [ ] Create mapping utilities (domain → API)
- [ ] Build optimization service layer
- [ ] Add error handling

### Phase 6: Optimization Flow
- [ ] Implement "Optimize Collection" button handler
- [ ] Call iNavi distance matrix API
- [ ] Call Omelet VRP API
- [ ] Parse and store results

### Phase 7: Visualization
- [ ] Draw route polylines on map
- [ ] Add route statistics display
- [ ] Highlight unassigned scooters
- [ ] Add route legend

### Phase 8: Polish
- [ ] Add loading states and spinners
- [ ] Improve error messages
- [ ] Add tooltips and help text
- [ ] Responsive design adjustments
- [ ] Testing and bug fixes

---

## 9. Key Decisions & Rationale

### 9.1 Why Single Hub (Depot)?

For simplicity, we use the first hub as the single depot. All trucks start and end at this hub. This simplifies the VRP problem and is sufficient for a demo.

**Future Enhancement**: Support multiple depots by creating separate VRP problems per hub.

### 9.2 Why Volume Instead of Weight?

Using `volume_capacity` and `volume` is simpler and directly maps to "number of scooters." Weight-based modeling is more realistic but adds complexity without benefit for this demo.

### 9.3 Why iNavi for Distance Matrix?

iNavi provides real road-based distances and times, which are more accurate than Euclidean or Manhattan distances for Seoul. Since we're already in Korea, this makes sense.

**Alternative**: If iNavi is unavailable, we can use Omelet's auto-calculation with `distance_type: "osrm"` (but this also requires Korea region).

### 9.4 Error Handling Strategy

- Network errors: Retry once, then show error message
- API errors: Parse error response and show user-friendly message
- Infeasible solutions: Show partial results with warning

---

## 10. API Keys & Configuration

### 10.1 Environment Variables

Create `.env` file:

```env
VITE_OMELET_API_KEY=your_omelet_key_here
VITE_INAVI_API_KEY=your_inavi_key_here
```

### 10.2 API Keys from MCP

The MCP server already has API keys stored. In a production environment, these would be retrieved from the MCP server. For this demo, we'll use environment variables for simplicity.

---

## Appendix A: Example API Requests

### A.1 iNavi Distance Matrix Request

```json
{
  "points": [
    { "posX": "126.978", "posY": "37.5665" },
    { "posX": "126.988", "posY": "37.5765" },
    { "posX": "126.968", "posY": "37.5565" }
  ],
  "traffic": 0
}
```

### A.2 Omelet VRP Request (Minimal Example)

```json
{
  "depot": {
    "name": "Hub-1",
    "coordinate": { "lng": 126.978, "lat": 37.5665 }
  },
  "visits": [
    {
      "name": "Scooter-1",
      "coordinate": { "lng": 126.988, "lat": 37.5765 },
      "volume": 1.0,
      "service_time": 3
    }
  ],
  "vehicles": [
    {
      "name": "Truck-1",
      "volume_capacity": 20,
      "vehicle_type": "car"
    }
  ],
  "distance_matrix": [[0, 1500], [1500, 0]],
  "duration_matrix": [[0, 120], [120, 0]],
  "option": {
    "timelimit": 30,
    "objective_type": "minsum"
  }
}
```

---

## Appendix B: Seoul Coordinate Bounds

For random scooter generation:

```typescript
const SEOUL_BOUNDS = {
  minLng: 126.7,
  maxLng: 127.2,
  minLat: 37.4,
  maxLat: 37.7,
};
```

---

**End of Design Document**

