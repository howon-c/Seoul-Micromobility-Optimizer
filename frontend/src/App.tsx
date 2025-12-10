import { useState, useEffect } from 'react';
import MapComponent from './components/MapComponent';
import { generateScenario, GANGNAM_CENTER, fetchDistrictBoundaries, isPointInDistricts } from './utils/ScenarioGenerator';
import { Scooter, Hub, OptimizedRoute, RedZonePOI } from './types';
import { fetchSubwayStations } from './services/OverpassService';
import { MapPin, RefreshCw, Truck, Play, PlusCircle, AlertCircle, CheckCircle, Clock, Route, TrendingUp } from 'lucide-react';
import { solveVrp } from './services/api';

// Currency helpers for consistent ₩ formatting
const formatKrw = (value: number) =>
  `₩${Math.abs(value).toLocaleString('en-US')}`;

const formatKrwShort = (value: number) => {
  const sign = value < 0 ? '-' : '';
  return `${sign}₩${Math.abs(value / 1000).toLocaleString('en-US')}K`;
};

function App() {
  const [scooters, setScooters] = useState<Scooter[]>([]);
  const [hubs, setHubs] = useState<Hub[]>([]);
  const [routes, setRoutes] = useState<OptimizedRoute[]>([]);
  const [isOptimizing, setIsOptimizing] = useState(false);
  const [isLoadingScenario, setIsLoadingScenario] = useState(false);
  const [truckCount, setTruckCount] = useState(3);
  const [scooterCount, setScooterCount] = useState(150); // Increased for larger coverage area
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [subwayStations, setSubwayStations] = useState<RedZonePOI[]>([]);

  // Fetch subway stations on mount
  useEffect(() => {
    const loadSubwayStations = async () => {
      // Gangnam 3-gu Bounds (matches ScenarioGenerator.ts)
      const bounds = { south: 37.42, west: 126.90, north: 37.55, east: 127.18 };
      
      try {
        // Fetch boundaries first for filtering
        const districtGeoJSON = await fetchDistrictBoundaries();
        
        const stations = await fetchSubwayStations(bounds);
        
        // Filter stations to be strictly inside Gangnam 3-gu
        const filteredStations = stations.filter(station => 
          isPointInDistricts(station.location, districtGeoJSON)
        );

        // Deduplicate stations by name to prevent multiple markers for the same station
        const uniqueStations = Array.from(
          new Map(filteredStations.map(s => [s.name, s])).values()
        );
        
        setSubwayStations(uniqueStations);
        console.log(`✓ Filtered & Deduplicated subway stations: ${uniqueStations.length} (from ${stations.length} raw)`);
      } catch (err) {
        console.error("Failed to load subway stations", err);
      }
    };
    loadSubwayStations();
  }, []);
  
  const handleGenerateScenario = async () => {
    setErrorMessage(null);
    setIsLoadingScenario(true);
    try {
      const newScooters = await generateScenario(scooterCount);
      setScooters(newScooters);
      setRoutes([]);
    } catch (error) {
      console.error("Failed to generate scenario:", error);
      setErrorMessage("Failed to generate scenario. Check console for details.");
    } finally {
      setIsLoadingScenario(false);
    }
  };

  const handleMapClick = (lat: number, lng: number) => {
    // Only allow depot placement when not optimizing
    if (isOptimizing) {
      return;
    }
    
    const newHub: Hub = {
      id: `Hub-${Date.now()}`,
      name: "Main Hub",
      location: { lat, lng }
    };
    setHubs([newHub]);
    setErrorMessage(null);
    console.log(`✓ Depot placed at: (${lat.toFixed(4)}, ${lng.toFixed(4)})`);
  };

  const handleOptimize = async () => {
    if (hubs.length === 0) {
      setErrorMessage("Please place a Hub on the map first!");
      return;
    }
    if (scooters.length === 0) {
      setErrorMessage("Please generate scooters first!");
      return;
    }

    setIsOptimizing(true);
    setErrorMessage(null);
    
    try {
      console.log("🚀 Starting optimization with real APIs...");
      const resultRoutes = await solveVrp(scooters, hubs[0], truckCount);
      setRoutes(resultRoutes);
      console.log("✅ Optimization complete!");
    } catch (error) {
      console.error("Optimization failed:", error);
      setErrorMessage(error instanceof Error ? error.message : "Optimization failed");
    } finally {
      setIsOptimizing(false);
    }
  };

  // Financial Constants (2-Hour Peak Shift Model)
  const COST_PER_TRUCK = 60000;      // ₩60,000 per 2-hour shift (Labor ₩50k + Fuel/Amortization ₩10k)
  const REVENUE_PER_SWAP = 5000;     // ₩5,000 per battery swap
  const FINE_PER_INCIDENT = 40000;   // ₩40,000 Seoul towing fine
  
  // Calculate statistics
  const lowBatteryCount = scooters.filter(s => s.state === 'B').length;
  const highRiskCount = scooters.filter(s => s.state === 'C').length;
  const totalScootersInRoutes = routes.reduce((sum, route) => sum + route.scootersCollected, 0);
  
  // Financial calculations (2-Hour Peak Shift Model)
  const operationalCost = truckCount * COST_PER_TRUCK;
  const collectedRevenue = routes.reduce((sum, r) => sum + r.revenueCollected, 0);
  const finesAvoided = routes.reduce((sum, r) => sum + r.finesAvoided, 0);
  const visitedHighRiskCount = routes.reduce((sum, r) => sum + r.highRiskCollected, 0);
  const visitedLowBatteryCount = routes.reduce((sum, r) => sum + r.lowBatteryCollected, 0);
  
  // Calculate fines incurred (unvisited High Risk scooters)
  const finesIncurred = (highRiskCount - visitedHighRiskCount) * FINE_PER_INCIDENT;
  
  // Net Profit = Revenue - Fines - Operational Costs
  const netProfit = collectedRevenue - finesIncurred - operationalCost;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', width: '100vw', overflow: 'hidden' }}>
      
      {/* Top Header */}
      <header style={{ 
        height: '64px', 
        backgroundColor: '#000', 
        color: '#fff', 
        display: 'flex', 
        alignItems: 'center', 
        justifyContent: 'space-between',
        padding: '0 24px',
        boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
        zIndex: 30
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div style={{ backgroundColor: '#3b82f6', padding: '6px', borderRadius: '8px' }}>
            <MapPin size={20} />
          </div>
          <div>
            <h1 style={{ fontSize: '18px', fontWeight: 'bold', letterSpacing: '0.05em', margin: 0 }}>
              MICROMOBILITY FLEET OPTIMIZER
            </h1>
            <p style={{ fontSize: '11px', color: '#9ca3af', margin: 0 }}>
              Greater Gangnam Area (Gangnam 3-gu) Operations Demo
            </p>
          </div>
        </div>
        
        {routes.length > 0 && !isOptimizing && (
          <div style={{ 
            display: 'flex', 
            alignItems: 'center', 
            gap: '8px',
            backgroundColor: 'rgba(34, 197, 94, 0.2)',
            color: '#4ade80',
            padding: '6px 12px',
            borderRadius: '20px',
            border: '1px solid rgba(34, 197, 94, 0.4)',
            fontSize: '11px',
            fontWeight: '600'
          }}>
            <CheckCircle size={14} />
            <span>SYSTEM ACTIVE</span>
          </div>
        )}
      </header>

      {/* Main Content Area: Sidebar + Map */}
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        
        {/* Left Sidebar */}
        <aside style={{
          width: '400px',
          backgroundColor: '#fff',
          borderRight: '1px solid #e5e7eb',
          display: 'flex',
          flexDirection: 'column',
          zIndex: 20,
          boxShadow: '2px 0 8px rgba(0,0,0,0.05)'
        }}>
          <div style={{ 
            flex: 1, 
            overflowY: 'auto', 
            padding: '20px'
          }}>
            
            {/* Statistics Grid */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '16px' }}>
              <div style={{ backgroundColor: '#fef3c7', padding: '12px', borderRadius: '8px', border: '1px solid #fde68a' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '4px' }}>
                  <span style={{ fontSize: '10px', fontWeight: 'bold', color: '#92400e', textTransform: 'uppercase' }}>Low Battery</span>
                  <div style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: '#fbbf24' }}></div>
                </div>
                <p style={{ fontSize: '24px', fontWeight: 'bold', color: '#78350f', margin: 0 }}>{lowBatteryCount}</p>
                <p style={{ fontSize: '10px', color: '#b45309', margin: 0 }}>₩5K/scooter · 1min</p>
              </div>
              
              <div style={{ backgroundColor: '#fee2e2', padding: '12px', borderRadius: '8px', border: '1px solid #fecaca' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '4px' }}>
                  <span style={{ fontSize: '10px', fontWeight: 'bold', color: '#991b1b', textTransform: 'uppercase' }}>High Risk</span>
                  <div style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: '#ef4444' }}></div>
                </div>
                <p style={{ fontSize: '24px', fontWeight: 'bold', color: '#7f1d1d', margin: 0 }}>{highRiskCount}</p>
                <p style={{ fontSize: '10px', color: '#b91c1c', margin: 0 }}>-₩40K/scooter · 5min</p>
              </div>
              
              <div style={{ backgroundColor: '#dbeafe', padding: '12px', borderRadius: '8px', border: '1px solid #bfdbfe' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '4px' }}>
                  <span style={{ fontSize: '10px', fontWeight: 'bold', color: '#1e40af', textTransform: 'uppercase' }}>Trucks</span>
                  <Truck size={12} style={{ color: '#3b82f6' }} />
                </div>
                <p style={{ fontSize: '24px', fontWeight: 'bold', color: '#1e3a8a', margin: 0 }}>
                  {routes.length}<span style={{ fontSize: '14px', fontWeight: 'normal', color: '#60a5fa' }}>/{truckCount}</span>
                </p>
                <p style={{ fontSize: '10px', color: '#2563eb', margin: 0 }}>2hr shift limit</p>
              </div>
              
              <div style={{ backgroundColor: '#d1fae5', padding: '12px', borderRadius: '8px', border: '1px solid #a7f3d0' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '4px' }}>
                  <span style={{ fontSize: '10px', fontWeight: 'bold', color: '#065f46', textTransform: 'uppercase' }}>Collected</span>
                  <Route size={12} style={{ color: '#10b981' }} />
                </div>
                <p style={{ fontSize: '24px', fontWeight: 'bold', color: '#064e3b', margin: 0 }}>{totalScootersInRoutes}</p>
                <p style={{ fontSize: '10px', color: '#047857', margin: 0 }}>Scooters</p>
              </div>
            </div>
            
            {/* Financial Summary (Show when routes exist) */}
            {routes.length > 0 && (
              <>
                {/* Net Profit Card */}
                <div style={{ 
                  background: netProfit >= 0 
                    ? 'linear-gradient(135deg, #10b981 0%, #059669 100%)' 
                    : 'linear-gradient(135deg, #ef4444 0%, #dc2626 100%)',
                  padding: '16px', 
                  borderRadius: '12px', 
                  marginBottom: '12px',
                  boxShadow: netProfit >= 0 
                    ? '0 4px 12px rgba(16, 185, 129, 0.3)' 
                    : '0 4px 12px rgba(239, 68, 68, 0.3)'
                }}>
                  <span style={{ fontSize: '11px', fontWeight: 'bold', color: '#fff', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                    Net Profit (2-Hour Shift)
                  </span>
                  <p style={{ fontSize: '32px', fontWeight: 'bold', color: '#fff', margin: '4px 0 0 0', whiteSpace: 'nowrap' }}>
                    {formatKrwShort(netProfit)}
                  </p>
                  <p style={{ fontSize: '10px', color: netProfit >= 0 ? '#d1fae5' : '#fecaca', margin: '4px 0 0 0', fontWeight: 600 }}>
                    Revenue − Fines − Op. Cost
                  </p>
                </div>
                
                {/* Financial Breakdown: Revenue, Fines, Operational Costs (stacked for clarity) */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '16px' }}>
                  <div style={{ backgroundColor: '#ecfdf5', border: '1px solid #a7f3d0', borderRadius: '8px', padding: '10px' }}>
                    <div style={{ fontSize: '10px', color: '#065f46', fontWeight: 'bold', marginBottom: '4px' }}>REVENUE</div>
                    <div style={{ fontSize: '18px', fontWeight: 'bold', color: '#047857', whiteSpace: 'nowrap' }}>{formatKrwShort(collectedRevenue)}</div>
                    <div style={{ fontSize: '9px', color: '#059669' }}>{visitedLowBatteryCount} swaps</div>
                  </div>
                  <div style={{ backgroundColor: '#fef2f2', border: '1px solid #fecaca', borderRadius: '8px', padding: '10px' }}>
                    <div style={{ fontSize: '10px', color: '#991b1b', fontWeight: 'bold', marginBottom: '4px' }}>FINES</div>
                    <div style={{ fontSize: '18px', fontWeight: 'bold', color: '#dc2626', whiteSpace: 'nowrap' }}>{formatKrwShort(-finesIncurred)}</div>
                    <div style={{ fontSize: '9px', color: '#b91c1c' }}>{highRiskCount - visitedHighRiskCount} missed</div>
                  </div>
                  <div style={{ backgroundColor: '#fef3c7', border: '1px solid #fde68a', borderRadius: '8px', padding: '10px' }}>
                    <div style={{ fontSize: '10px', color: '#92400e', fontWeight: 'bold', marginBottom: '4px' }}>OP. COST</div>
                    <div style={{ fontSize: '18px', fontWeight: 'bold', color: '#b45309', whiteSpace: 'nowrap' }}>{formatKrwShort(-operationalCost)}</div>
                    <div style={{ fontSize: '9px', color: '#d97706' }}>{truckCount} trucks</div>
                  </div>
                </div>
                
                {/* Fines Avoided (Informational) */}
                <div style={{ backgroundColor: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: '8px', padding: '10px', marginBottom: '16px' }}>
                  <div style={{ fontSize: '10px', color: '#1e40af', fontWeight: 'bold', marginBottom: '4px' }}>FINES AVOIDED</div>
                  <div style={{ fontSize: '18px', fontWeight: 'bold', color: '#2563eb' }}>{formatKrwShort(finesAvoided)}</div>
                  <div style={{ fontSize: '9px', color: '#3b82f6' }}>{visitedHighRiskCount} rescues completed</div>
                </div>
              </>
            )}

            <div style={{ height: '1px', backgroundColor: '#e5e7eb', margin: '24px 0' }}></div>

            {/* Scenario Controls */}
            <div style={{ marginBottom: '20px' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
                <label style={{ fontSize: '11px', fontWeight: 'bold', color: '#374151', display: 'flex', alignItems: 'center', gap: '8px', textTransform: 'uppercase' }}>
                  <MapPin size={14} style={{ color: '#9ca3af' }} />
                  Total Scooters (N)
                </label>
                <input 
                  type="number" 
                  min="10" 
                  max="200" 
                  value={scooterCount} 
                  onChange={(e) => setScooterCount(Math.min(200, Math.max(10, parseInt(e.target.value) || 50)))}
                  style={{ 
                    width: '70px',
                    fontSize: '13px', 
                    fontWeight: 'bold', 
                    color: '#3b82f6', 
                    backgroundColor: '#eff6ff', 
                    padding: '4px 8px', 
                    borderRadius: '4px',
                    border: '1px solid #bfdbfe',
                    textAlign: 'center'
                  }}
                />
              </div>
              <p style={{ fontSize: '10px', color: '#6b7280', margin: 0, lineHeight: '1.4' }}>
                15% High Risk (₩40K fine) near subways/bus stops, 65% Commercial (₩5K revenue), 20% Residential/Alley (₩5K revenue), rest healthy (ignored).
              </p>
            </div>

            {/* Fleet Controls */}
            <div style={{ marginBottom: '24px' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
                <label style={{ fontSize: '11px', fontWeight: 'bold', color: '#374151', display: 'flex', alignItems: 'center', gap: '8px', textTransform: 'uppercase' }}>
                  <TrendingUp size={14} style={{ color: '#9ca3af' }} />
                  Fleet Size
                </label>
                <span style={{ fontSize: '13px', fontWeight: 'bold', color: '#3b82f6', backgroundColor: '#eff6ff', padding: '2px 8px', borderRadius: '4px' }}>
                  {truckCount} Trucks
                </span>
              </div>
              <p style={{ fontSize: '10px', color: '#b45309', margin: '0 0 12px 0', fontWeight: '600' }}>
                ₩60k / truck / 2hr shift
              </p>
              <input 
                type="range" 
                min="1" 
                max="10" 
                value={truckCount} 
                onChange={(e) => setTruckCount(parseInt(e.target.value))}
                style={{ 
                  width: '100%', 
                  height: '8px', 
                  backgroundColor: '#e5e7eb',
                  borderRadius: '4px',
                  cursor: 'pointer',
                  accentColor: '#000'
                }}
              />
            </div>

            {/* Loading Status for Scenario Generation */}
            {isLoadingScenario && (
              <div style={{ backgroundColor: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: '8px', padding: '12px', display: 'flex', gap: '12px', marginBottom: '16px' }}>
                <Clock size={16} style={{ color: '#3b82f6', flexShrink: 0, marginTop: '2px' }} />
                <div>
                  <p style={{ fontSize: '12px', fontWeight: 'bold', color: '#1e40af', margin: 0 }}>Loading POIs...</p>
                  <p style={{ fontSize: '10px', color: '#2563eb', margin: 0 }}>Fetching realistic spawn points from OpenStreetMap</p>
                </div>
              </div>
            )}

            {/* Action Buttons */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '24px' }}>
              <button 
                onClick={handleGenerateScenario}
                disabled={isLoadingScenario || isOptimizing}
                style={{
                  backgroundColor: '#f3f4f6',
                  color: '#1f2937',
                  padding: '10px 16px',
                  borderRadius: '8px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '8px',
                  border: '1px solid #d1d5db',
                  fontSize: '11px',
                  fontWeight: '600',
                  textTransform: 'uppercase',
                  cursor: (isLoadingScenario || isOptimizing) ? 'not-allowed' : 'pointer',
                  opacity: (isLoadingScenario || isOptimizing) ? 0.6 : 1,
                  transition: 'all 0.2s'
                }}
                onMouseOver={(e) => !isLoadingScenario && !isOptimizing && (e.currentTarget.style.backgroundColor = '#e5e7eb')}
                onMouseOut={(e) => !isLoadingScenario && !isOptimizing && (e.currentTarget.style.backgroundColor = '#f3f4f6')}
              >
                <RefreshCw size={14} className={isLoadingScenario ? 'animate-spin' : ''} />
                {isLoadingScenario ? 'Loading' : 'Scenario'}
              </button>
              
              <button 
                onClick={handleOptimize}
                disabled={isOptimizing}
                style={{
                  backgroundColor: isOptimizing ? '#6b7280' : '#000',
                  color: '#fff',
                  padding: '10px 16px',
                  borderRadius: '8px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '8px',
                  border: 'none',
                  fontSize: '11px',
                  fontWeight: 'bold',
                  textTransform: 'uppercase',
                  cursor: isOptimizing ? 'not-allowed' : 'pointer',
                  opacity: isOptimizing ? 0.5 : 1,
                  transition: 'all 0.2s'
                }}
                onMouseOver={(e) => !isOptimizing && (e.currentTarget.style.backgroundColor = '#374151')}
                onMouseOut={(e) => !isOptimizing && (e.currentTarget.style.backgroundColor = '#000')}
              >
                {isOptimizing ? <RefreshCw className="animate-spin" size={14} /> : <Play size={14} />}
                {isOptimizing ? 'Working' : 'Optimize'}
              </button>
            </div>

            {/* Status Messages */}
              {hubs.length === 0 && !errorMessage && (
                <div style={{ backgroundColor: '#fff7ed', border: '1px solid #fed7aa', borderRadius: '8px', padding: '12px', display: 'flex', gap: '12px', marginBottom: '16px' }}>
                  <PlusCircle size={16} style={{ color: '#ea580c', flexShrink: 0, marginTop: '2px' }} />
                  <div>
                    <p style={{ fontSize: '12px', fontWeight: 'bold', color: '#9a3412', margin: 0 }}>Setup Required</p>
                    <p style={{ fontSize: '10px', color: '#c2410c', margin: 0 }}>Click anywhere on the map to place the Depot Hub.</p>
                  </div>
                </div>
              )}
            
            {errorMessage && (
              <div style={{ backgroundColor: '#fef2f2', border: '1px solid #fecaca', borderRadius: '8px', padding: '12px', display: 'flex', gap: '12px', marginBottom: '16px' }}>
                <AlertCircle size={16} style={{ color: '#dc2626', flexShrink: 0, marginTop: '2px' }} />
                <div>
                  <p style={{ fontSize: '12px', fontWeight: 'bold', color: '#991b1b', margin: 0 }}>Error</p>
                  <p style={{ fontSize: '10px', color: '#b91c1c', margin: 0 }}>{errorMessage}</p>
                </div>
              </div>
            )}

            {isOptimizing && (
              <div style={{ backgroundColor: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: '8px', padding: '12px', display: 'flex', gap: '12px', marginBottom: '16px' }}>
                <Clock size={16} style={{ color: '#3b82f6', flexShrink: 0, marginTop: '2px' }} />
                <div>
                  <p style={{ fontSize: '12px', fontWeight: 'bold', color: '#1e40af', margin: 0 }}>Processing</p>
                  <p style={{ fontSize: '10px', color: '#2563eb', margin: 0 }}>Calculating routes and fetching road geometry...</p>
                </div>
              </div>
            )}

            {/* Route Details */}
            {routes.length > 0 && (
              <div style={{ marginBottom: '16px' }}>
                <h4 style={{ fontSize: '10px', fontWeight: 'bold', color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '12px' }}>
                  Route Details
                </h4>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {routes.map((route) => (
                    <div 
                      key={route.vehicleId} 
                      style={{ 
                        backgroundColor: '#f9fafb', 
                        padding: '10px', 
                        borderRadius: '8px',
                        borderLeft: `4px solid ${route.color}`
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                        <span style={{ fontSize: '11px', fontWeight: 'bold', color: '#374151' }}>
                          {route.vehicleId}
                        </span>
                        <span style={{ fontSize: '12px', fontWeight: 'bold', color: '#059669' }}>
                          {formatKrwShort(route.totalScore)}
                        </span>
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '8px', fontSize: '10px', color: '#6b7280' }}>
                        <div>
                          <div style={{ fontWeight: '600', color: '#374151' }}>{route.scootersCollected}</div>
                          <div>stops</div>
                        </div>
                        <div>
                          <div style={{ fontWeight: '600', color: '#374151' }}>{(route.distance / 1000).toFixed(1)}km</div>
                          <div>distance</div>
                        </div>
                        <div>
                          <div style={{ fontWeight: '600', color: '#374151' }}>{Math.floor(route.duration / 60)}min</div>
                          <div>time</div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Legend */}
            <div style={{ paddingTop: '16px', borderTop: '1px solid #f3f4f6' }}>
              <h4 style={{ fontSize: '10px', fontWeight: 'bold', color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '12px' }}>
                Map Legend
              </h4>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <div style={{ width: '12px', height: '12px', borderRadius: '50%', backgroundColor: '#fbbf24', border: '2px solid #d97706' }}></div>
                  <span style={{ fontSize: '11px', color: '#4b5563' }}>Battery Swap (₩5K)</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <div style={{ width: '12px', height: '12px', borderRadius: '50%', backgroundColor: '#ef4444', border: '2px solid #b91c1c' }}></div>
                  <span style={{ fontSize: '11px', color: '#4b5563' }}>Fine Risk (-₩40K)</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <div style={{ width: '12px', height: '12px', borderRadius: '50%', backgroundColor: '#3b82f6', border: '2px solid #1d4ed8' }}></div>
                  <span style={{ fontSize: '11px', color: '#4b5563' }}>Depot Hub</span>
                </div>
              </div>
            </div>

          </div>
        </aside>

        {/* Map Area */}
        <div style={{ flex: 1, position: 'relative', backgroundColor: '#f3f4f6' }}>
          <MapComponent 
            scooters={scooters} 
            hubs={hubs}
            routes={routes}
            center={GANGNAM_CENTER} 
            onMapClick={handleMapClick}
            isOptimizing={isOptimizing || isLoadingScenario}
            subwayStations={subwayStations}
          />
        </div>
      </div>
    </div>
  );
}

export default App;
