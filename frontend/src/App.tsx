import { useState, useEffect, useMemo } from 'react';
import MapComponent from './components/MapComponent';
import OpsChat from './components/Chat/OpsChat';
import { generateScenario, GANGNAM_CENTER, fetchDistrictBoundaries, isPointInDistricts } from './utils/ScenarioGenerator';
import { Scooter, Hub, OptimizedRoute, RedZonePOI, DepotCandidate } from './types';
import { fetchSubwayStations, fetchDepotCandidates } from './services/OverpassService';
import { MapPin, RefreshCw, Truck, Play, PlusCircle, AlertCircle, CheckCircle, Clock, Route, TrendingUp, Lightbulb, MessageCircle } from 'lucide-react';
import { generateAnalysis, ConsultantMetrics } from './services/ConsultantService';
import { extractFinancialStats, FinancialStats, TruckConfig } from './services/ContextBuilder';
import { generateSystemPrompt, generateInitialSummary, AppStateSnapshot } from './utils/promptEngineering';
import { solveVrp } from './services/api';

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
  const [depotCandidates, setDepotCandidates] = useState<DepotCandidate[]>([]);
  const [consultantReport, setConsultantReport] = useState<string | null>(null);
  const [consultantMetrics, setConsultantMetrics] = useState<ConsultantMetrics | null>(null);
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [chatInitialMessage, setChatInitialMessage] = useState<string | null>(null);

  // Fetch subway stations and depot candidates on mount
  useEffect(() => {
    const loadPOIs = async () => {
      // Gangnam 3-gu Bounds (matches ScenarioGenerator.ts)
      const bounds = { south: 37.42, west: 126.90, north: 37.55, east: 127.18 };
      
      try {
        // Fetch boundaries first for filtering
        const districtGeoJSON = await fetchDistrictBoundaries();
        
        const stations = await fetchSubwayStations(bounds);
        const depots = await fetchDepotCandidates(bounds);
        
        // Filter stations to be strictly inside Gangnam 3-gu
        const filteredStations = stations.filter(station => 
          isPointInDistricts(station.location, districtGeoJSON)
        );

        // Deduplicate stations by name to prevent multiple markers for the same station
        const uniqueStations = Array.from(
          new Map(filteredStations.map(s => [s.name, s])).values()
        );
        
        // Filter depot candidates to be inside districts
        const filteredDepots = depots.filter(d => isPointInDistricts(d.location, districtGeoJSON));

        setSubwayStations(uniqueStations);
        setDepotCandidates(filteredDepots);
        console.log(`✓ Filtered & Deduplicated subway stations: ${uniqueStations.length} (from ${stations.length} raw)`);
        console.log(`✓ Filtered depot candidates: ${filteredDepots.length} (from ${depots.length} raw)`);
      } catch (err) {
        console.error("Failed to load subway stations", err);
      }
    };
    loadPOIs();
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

  const handleDepotSelect = (candidate: DepotCandidate) => {
    if (isOptimizing) return;
    const newHub: Hub = {
      id: candidate.id,
      name: candidate.name || (candidate.type === 'parking' ? 'Parking Depot' : 'Station Depot'),
      location: candidate.location
    };
    setHubs([newHub]);
    setErrorMessage(null);
    console.log(`✓ Depot selected: ${newHub.name} @ (${candidate.location.lat.toFixed(4)}, ${candidate.location.lng.toFixed(4)})`);
  };

  // Financial Constants (2-Hour Peak Shift Model) - defined early for use in handlers
  const COST_PER_TRUCK = 60000;      // ₩60,000 per 2-hour shift (Labor ₩50k + Fuel/Amortization ₩10k)

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

      // Consultant analysis after optimization
      const { report, metrics } = generateAnalysis(resultRoutes, scooters, truckCount, hubs[0]);
      setConsultantReport(report);
      setConsultantMetrics(metrics);

      // Generate initial chat message for AI assistant
      const financials = extractFinancialStats(scooters, resultRoutes, truckCount, COST_PER_TRUCK);
      const appSnapshot: AppStateSnapshot = {
        truckConfig: { truckCount, volumeCapacity: 20, shiftDurationHours: 2, costPerTruck: COST_PER_TRUCK },
        scooterCounts: {
          total: scooters.length,
          highRisk: scooters.filter(s => s.state === 'C').length,
          lowBattery: scooters.filter(s => s.state === 'B').length
        },
        hasRoutes: true,
        depotName: hubs[0]?.name
      };
      const initialMsg = generateInitialSummary(metrics, financials, appSnapshot);
      setChatInitialMessage(initialMsg);
    } catch (error) {
      console.error("Optimization failed:", error);
      setErrorMessage(error instanceof Error ? error.message : "Optimization failed");
    } finally {
      setIsOptimizing(false);
    }
  };

  // Generate system prompt for AI chat (memoized)
  const systemPrompt = useMemo(() => {
    const financials = routes.length > 0 
      ? extractFinancialStats(scooters, routes, truckCount, COST_PER_TRUCK)
      : null;
    const appSnapshot: AppStateSnapshot = {
      truckConfig: { truckCount, volumeCapacity: 20, shiftDurationHours: 2, costPerTruck: COST_PER_TRUCK },
      scooterCounts: {
        total: scooters.length,
        highRisk: scooters.filter(s => s.state === 'C').length,
        lowBattery: scooters.filter(s => s.state === 'B').length
      },
      hasRoutes: routes.length > 0,
      depotName: hubs[0]?.name
    };
    return generateSystemPrompt(consultantMetrics, financials, appSnapshot, consultantReport);
  }, [scooters, routes, truckCount, hubs, consultantMetrics, consultantReport]);
  
  // Calculate statistics
  const lowBatteryCount = scooters.filter(s => s.state === 'B').length;
  const highRiskCount = scooters.filter(s => s.state === 'C').length;
  const totalScootersInRoutes = routes.reduce((sum, route) => sum + route.scootersCollected, 0);
  
  // Loss-prevention calculations
  const operationalCost = truckCount * COST_PER_TRUCK;
  const inventorySaved = routes.reduce((sum, r) => sum + r.revenueCollected, 0); // 2.5k per low-battery visited
  const finesAvoided = routes.reduce((sum, r) => sum + r.finesAvoided, 0); // 40k per high-risk visited
  const totalPenaltySaved = routes.reduce((sum, r) => sum + r.totalScore, 0); // total visited penaltyValue
  const visitedHighRiskCount = routes.reduce((sum, r) => sum + r.highRiskCollected, 0);
  const visitedLowBatteryCount = routes.reduce((sum, r) => sum + r.lowBatteryCollected, 0);

  const totalPotentialPenalty = scooters.reduce((sum, s) => sum + (s.penaltyValue || 0), 0);
  const remainingRisk = Math.max(0, totalPotentialPenalty - totalPenaltySaved);

  // Net Loss Prevented = Penalty saved by visits - operational cost
  const netLossPrevented = totalPenaltySaved - operationalCost;

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
        
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
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
          
          {/* AI Chat Button */}
          <button
            onClick={() => setIsChatOpen(true)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              backgroundColor: isChatOpen ? '#3b82f6' : 'rgba(59, 130, 246, 0.2)',
              color: isChatOpen ? '#fff' : '#3b82f6',
              padding: '6px 12px',
              borderRadius: '20px',
              border: '1px solid rgba(59, 130, 246, 0.4)',
              fontSize: '11px',
              fontWeight: '600',
              cursor: 'pointer',
              transition: 'all 0.2s'
            }}
          >
            <MessageCircle size={14} />
            <span>AI Chat</span>
          </button>
        </div>
      </header>

      {/* Main Content Area: Sidebar + Map */}
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        
        {/* Left Sidebar */}
        <aside style={{
          width: '420px',
          minWidth: '360px',
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
                <p style={{ fontSize: '24px', fontWeight: 'bold', color: '#78350f', margin: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={`${lowBatteryCount}`}>{lowBatteryCount}</p>
                <p style={{ fontSize: '10px', color: '#b45309', margin: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title="-₩2.5K/scooter · 1min">-₩2.5K/scooter · 1min</p>
              </div>
              
              <div style={{ backgroundColor: '#fee2e2', padding: '12px', borderRadius: '8px', border: '1px solid #fecaca' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '4px' }}>
                  <span style={{ fontSize: '10px', fontWeight: 'bold', color: '#991b1b', textTransform: 'uppercase' }}>High Risk</span>
                  <div style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: '#ef4444' }}></div>
                </div>
                <p style={{ fontSize: '24px', fontWeight: 'bold', color: '#7f1d1d', margin: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={`${highRiskCount}`}>{highRiskCount}</p>
                <p style={{ fontSize: '10px', color: '#b91c1c', margin: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title="-₩40K/scooter · 5min">-₩40K/scooter · 5min</p>
              </div>
              
              <div style={{ backgroundColor: '#dbeafe', padding: '12px', borderRadius: '8px', border: '1px solid #bfdbfe' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '4px' }}>
                  <span style={{ fontSize: '10px', fontWeight: 'bold', color: '#1e40af', textTransform: 'uppercase' }}>Trucks</span>
                  <Truck size={12} style={{ color: '#3b82f6' }} />
                </div>
                <p style={{ fontSize: '24px', fontWeight: 'bold', color: '#1e3a8a', margin: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={`${routes.length}/${truckCount}`}>
                  {routes.length}<span style={{ fontSize: '14px', fontWeight: 'normal', color: '#60a5fa' }}>/{truckCount}</span>
                </p>
                <p style={{ fontSize: '10px', color: '#2563eb', margin: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title="2hr shift limit · -₩60K/truck/shift">2hr shift limit · -₩60K/truck/shift</p>
              </div>
              
              <div style={{ backgroundColor: '#d1fae5', padding: '12px', borderRadius: '8px', border: '1px solid #a7f3d0' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '4px' }}>
                  <span style={{ fontSize: '10px', fontWeight: 'bold', color: '#065f46', textTransform: 'uppercase' }}>Collected</span>
                  <Route size={12} style={{ color: '#10b981' }} />
                </div>
                <p style={{ fontSize: '24px', fontWeight: 'bold', color: '#064e3b', margin: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={`${totalScootersInRoutes}`}>{totalScootersInRoutes}</p>
                <p style={{ fontSize: '10px', color: '#047857', margin: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title="Scooters">Scooters</p>
              </div>
            </div>
            
            {/* Financial Summary (Show when routes exist) */}
            {routes.length > 0 && (
              <>
                {/* Net Loss Prevented Card */}
                <div style={{ 
                  gridColumn: '1 / -1',
                  background: netLossPrevented >= 0 
                    ? 'linear-gradient(135deg, #10b981 0%, #059669 100%)' 
                    : 'linear-gradient(135deg, #ef4444 0%, #dc2626 100%)',
                  padding: '16px', 
                  borderRadius: '12px', 
                  marginBottom: '12px',
                  boxShadow: netLossPrevented >= 0 
                    ? '0 4px 12px rgba(16, 185, 129, 0.3)' 
                    : '0 4px 12px rgba(239, 68, 68, 0.3)'
                }}>
                  <span style={{ fontSize: '11px', fontWeight: 'bold', color: '#fff', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                    Net Loss Prevented (2-Hour Shift)
                  </span>
                  <p style={{ fontSize: '32px', fontWeight: 'bold', color: '#fff', margin: '4px 0 0 0', whiteSpace: 'nowrap' }}>
                    {formatKrwShort(netLossPrevented)}
                  </p>
                  <p style={{ fontSize: '10px', color: netLossPrevented >= 0 ? '#d1fae5' : '#fecaca', margin: '4px 0 0 0', fontWeight: 600 }}>
                    Penalty Prevented − Op. Cost
                  </p>
                </div>
                
                {/* Loss Prevention Breakdown */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '16px' }}>
                  <div style={{ backgroundColor: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: '8px', padding: '10px' }}>
                    <div style={{ fontSize: '10px', color: '#1e3a8a', fontWeight: 'bold', marginBottom: '4px' }}>POTENTIAL FINES AVOIDED</div>
                    <div style={{ fontSize: '18px', fontWeight: 'bold', color: '#1e40af', whiteSpace: 'nowrap' }}>{formatKrwShort(finesAvoided)}</div>
                    <div style={{ fontSize: '9px', color: '#2563eb' }}>{visitedHighRiskCount} high-risk rescued</div>
                  </div>
                  <div style={{ backgroundColor: '#ecfdf3', border: '1px solid #bbf7d0', borderRadius: '8px', padding: '10px' }}>
                    <div style={{ fontSize: '10px', color: '#047857', fontWeight: 'bold', marginBottom: '4px' }}>INVENTORY SAVED</div>
                    <div style={{ fontSize: '18px', fontWeight: 'bold', color: '#047857', whiteSpace: 'nowrap' }}>{formatKrwShort(inventorySaved)}</div>
                    <div style={{ fontSize: '9px', color: '#059669' }}>{visitedLowBatteryCount} low-battery recovered</div>
                  </div>
                  <div style={{ backgroundColor: '#fef2f2', border: '1px solid #fecaca', borderRadius: '8px', padding: '10px' }}>
                    <div style={{ fontSize: '10px', color: '#b91c1c', fontWeight: 'bold', marginBottom: '4px' }}>REMAINING RISK</div>
                    <div style={{ fontSize: '18px', fontWeight: 'bold', color: '#dc2626', whiteSpace: 'nowrap' }}>{formatKrwShort(-remainingRisk)}</div>
                    <div style={{ fontSize: '9px', color: '#b91c1c' }}>{(highRiskCount - visitedHighRiskCount)} high-risk & {(lowBatteryCount - visitedLowBatteryCount)} low-battery unserved</div>
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
              <p style={{ fontSize: '11px', color: '#6b7280', margin: 0, lineHeight: '1.4' }}>
              15% High Risk (within 5m of subway/bus stops), <br />
              65% Commercial low battery (within 15–30m of shops/cafes), <br />
              20% Residential/Alley (20–40m jitter), <br />
              healthy scooters ignored.</p>

            <div style={{ marginTop: '12px', padding: '10px', borderRadius: '8px', backgroundColor: '#e0f2fe', border: '1px solid #bfdbfe', color: '#0f172a', fontSize: '11px' }}>
              Select a valid Parking Lot or Bus Station to establish your Depot.
            </div>
            {consultantReport && (
              <div style={{ marginTop: '12px', padding: '14px', borderRadius: '10px', border: '1px solid #e5e7eb', backgroundColor: '#f8fafc', display: 'flex', gap: '10px', alignItems: 'flex-start' }}>
                <div style={{ color: '#f59e0b', flexShrink: 0, marginTop: '2px' }}>
                  <Lightbulb size={18} />
                </div>
                <div>
                  <div style={{ fontSize: '12px', fontWeight: '700', color: '#0f172a', marginBottom: '6px' }}>AI Consultant</div>
                  <div style={{ fontSize: '11px', color: '#334155', lineHeight: 1.5 }}>
                    {consultantReport}
                  </div>
                </div>
              </div>
            )}
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
                    <p style={{ fontSize: '10px', color: '#c2410c', margin: 0 }}>Click a blue depot candidate (Parking/Station) to set the Depot Hub.</p>
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
                  <span style={{ fontSize: '11px', color: '#4b5563' }}>Low Battery (Save ₩2.5K)</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <div style={{ width: '12px', height: '12px', borderRadius: '50%', backgroundColor: '#ef4444', border: '2px solid #b91c1c' }}></div>
                  <span style={{ fontSize: '11px', color: '#4b5563' }}>High Risk (Avoid ₩40K Fine)</span>
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
            isOptimizing={isOptimizing || isLoadingScenario}
            subwayStations={subwayStations}
            depotCandidates={depotCandidates}
            onDepotSelect={handleDepotSelect}
          />
        </div>
      </div>

      {/* AI Operations Manager Chat */}
      <OpsChat
        isOpen={isChatOpen}
        onClose={() => setIsChatOpen(false)}
        systemPrompt={systemPrompt}
        initialMessage={chatInitialMessage || undefined}
      />
    </div>
  );
}

export default App;
