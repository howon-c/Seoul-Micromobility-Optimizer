import React, { useEffect, useMemo } from 'react';
import { MapContainer, TileLayer, Marker, Popup, Polyline, useMap, GeoJSON, Circle, LayersControl, LayerGroup } from 'react-leaflet';
import { Scooter, Coordinate, OptimizedRoute, Hub, RedZonePOI, DepotCandidate } from '../types';
import { getCachedDistrictBoundaries } from '../utils/ScenarioGenerator';
import * as turf from '@turf/turf';
import dissolve from '@turf/dissolve';
import L from 'leaflet';
// CSS is loaded in index.html

const DefaultIcon = L.icon({
  // Use CDN-hosted default Leaflet marker assets to avoid bundling PNGs
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
  iconSize: [25, 41],
  iconAnchor: [12, 41],
});
L.Marker.prototype.options.icon = DefaultIcon;

// Custom Icons... (keeping same icon defs)
const yellowIcon = new L.Icon({
  iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-gold.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/0.7.7/images/marker-shadow.png',
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41]
});

const redIcon = new L.Icon({
  iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-red.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/0.7.7/images/marker-shadow.png',
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41]
});

const blueIcon = new L.Icon({
  iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-blue.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/0.7.7/images/marker-shadow.png',
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41]
});

interface MapComponentProps {
  scooters: Scooter[];
  hubs: Hub[];
  routes: OptimizedRoute[];
  center: Coordinate;
  onMapClick?: (lat: number, lng: number) => void; // deprecated for depot; kept for compatibility
  depotCandidates?: DepotCandidate[];
  onDepotSelect?: (candidate: DepotCandidate) => void;
  isOptimizing?: boolean;
  subwayStations?: RedZonePOI[];
}

// Helper to create subway station icon (clean "M" marker)
// const createStationIcon = () => L.divIcon({ ... }); // Removed in favor of Geofence Circles

// Click handler component
import { useMapEvents } from 'react-leaflet';
const MapEvents = ({ onMapClick, isOptimizing }: { onMapClick?: (lat: number, lng: number) => void; isOptimizing?: boolean }) => {
  useMapEvents({
    click(e) {
      // Always allow clicking when not optimizing
      if (onMapClick && !isOptimizing) {
        onMapClick(e.latlng.lat, e.latlng.lng);
      }
    },
  });
  return null;
};

// Force redraw on resize (helps if container size changes)
const MapResizer = () => {
  const map = useMap();
  useEffect(() => {
    map.invalidateSize();
  }, [map]);
  return null;
};

// Memoized Scooter Markers (prevent re-render on unrelated state changes)
const ScooterMarkers = React.memo(({ scooters }: { scooters: Scooter[] }) => {
  return (
    <>
      {scooters.map((scooter) => (
        <Marker 
          key={scooter.id} 
          position={[scooter.location.lat, scooter.location.lng]}
          icon={scooter.state === 'C' ? redIcon : yellowIcon}
        >
          <Popup>
            <strong>{scooter.id}</strong><br />
            State: {scooter.state}<br />
            Battery: {scooter.batteryLevel}%<br />
            Service Time: {scooter.service_time} min
          </Popup>
        </Marker>
      ))}
    </>
  );
});

// Memoized Hub Markers
const HubMarkers = React.memo(({ hubs }: { hubs: Hub[] }) => {
  return (
    <>
      {hubs.map(hub => (
        <Marker key={hub.id} position={[hub.location.lat, hub.location.lng]} icon={blueIcon}>
          <Popup>{hub.name} (Depot)</Popup>
        </Marker>
      ))}
    </>
  );
});

// Depot candidate markers (small semi-transparent blue "P")
const candidateIcon = L.divIcon({
  className: 'candidate-icon',
  html: `<div style="
    background-color: rgba(37, 99, 235, 0.2);
    color: #1d4ed8;
    border: 1px solid #1d4ed8;
    border-radius: 50%;
    width: 14px;
    height: 14px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 9px;
    font-weight: 700;
  ">P</div>`,
  iconSize: [14, 14],
  iconAnchor: [7, 7]
});

const DepotCandidateMarkers = React.memo(({ candidates, onSelect }: { candidates: DepotCandidate[]; onSelect?: (c: DepotCandidate) => void }) => {
  if (!candidates || candidates.length === 0) return null;
  return (
    <>
      {candidates.map((c) => (
        <Marker
          key={c.id}
          position={[c.location.lat, c.location.lng]}
          icon={candidateIcon}
          eventHandlers={onSelect ? { click: () => onSelect(c) } : undefined}
        >
          <Popup>
            <strong>{c.name || (c.type === 'parking' ? 'Parking Lot' : 'Bus Station')}</strong><br />
            Type: {c.type}
          </Popup>
        </Marker>
      ))}
    </>
  );
});

// Memoized Route Polylines with Glow Effect
const RoutePolylines = React.memo(({ routes }: { routes: OptimizedRoute[] }) => {
  return (
    <>
      {routes.map(route => {
        // If we have road geometry, render each segment with glow effect
        if (route.roadGeometry && route.roadGeometry.length > 0) {
          return route.roadGeometry.map((segment, segmentIdx) => {
            const positions = segment.map(p => [p.lat, p.lng] as [number, number]);
            return (
              <React.Fragment key={`${route.vehicleId}-segment-${segmentIdx}`}>
                {/* Glow Layer: Wider, lower opacity */}
                <Polyline 
                  positions={positions}
                  pathOptions={{ 
                    color: route.color, 
                    weight: 6, 
                    opacity: 0.3 
                  }}
                />
                {/* Core Layer: Thinner, high opacity */}
                <Polyline 
                  positions={positions}
                  pathOptions={{ 
                    color: route.color, 
                    weight: 3, 
                    opacity: 1.0 
                  }}
                >
                  {segmentIdx === 0 && <Popup>{route.vehicleId}</Popup>}
                </Polyline>
              </React.Fragment>
            );
          });
        } else {
          // Fallback: straight lines between waypoints with glow effect
          const positions = route.path.map(p => [p.lat, p.lng] as [number, number]);
          return (
            <React.Fragment key={route.vehicleId}>
              {/* Glow Layer */}
              <Polyline 
                positions={positions}
                pathOptions={{ 
                  color: route.color, 
                  weight: 6, 
                  opacity: 0.3, 
                  dashArray: '10, 10' 
                }}
              />
              {/* Core Layer */}
              <Polyline 
                positions={positions}
                pathOptions={{ 
                  color: route.color, 
                  weight: 3, 
                  opacity: 0.8, 
                  dashArray: '10, 10' 
                }}
              >
                <Popup>{route.vehicleId} (Direct)</Popup>
              </Polyline>
            </React.Fragment>
          );
        }
      })}
    </>
  );
});

const MapComponent: React.FC<MapComponentProps> = ({ scooters, hubs, routes, center, onMapClick, depotCandidates, onDepotSelect, isOptimizing, subwayStations }) => {
  const districtBoundaries = getCachedDistrictBoundaries();
  
  // Merge all district polygons into a single unified service area
  const unifiedServiceArea = useMemo(() => {
    if (!districtBoundaries || !districtBoundaries.features || districtBoundaries.features.length === 0) {
      return null;
    }
    
    try {
      // Filter out invalid features (must have geometry and coordinates)
      const validFeatures = districtBoundaries.features.filter((f: any) => {
        if (!f || !f.geometry) return false;
        const geom = f.geometry as any;
        const hasCoords =
          (geom.type === 'Polygon' && Array.isArray(geom.coordinates) && geom.coordinates.length > 0) ||
          (geom.type === 'MultiPolygon' && Array.isArray(geom.coordinates) && geom.coordinates.length > 0);
        return hasCoords;
      });
      
      if (validFeatures.length === 0) {
        console.warn('No valid district boundary features found');
        return null;
      }
      
      // If only one valid feature, just wrap it
      if (validFeatures.length === 1) {
        return {
          type: 'FeatureCollection' as const,
          features: [validFeatures[0]]
        };
      }
      
      // Try dissolve first (handles MultiPolygon better)
      try {
        const dissolved = dissolve({
          type: 'FeatureCollection',
          features: validFeatures.map((f: any) => ({
            ...f,
            properties: { ...(f.properties || {}), group: 1 }
          }))
        }, { propertyName: 'group' });
        
        if (dissolved) {
          return dissolved as any;
        }
      } catch (err) {
        console.warn('Dissolve failed, falling back to incremental union', err);
      }
      
      // Start with the first valid feature
      let merged = validFeatures[0];
      
      // Union all remaining features with per-step safety
      for (let i = 1; i < validFeatures.length; i++) {
        try {
          const unionResult = turf.union(merged, validFeatures[i]);
          if (unionResult) {
            merged = unionResult;
          } else {
            console.warn(`Failed to union feature ${i}, skipping`);
          }
        } catch (err) {
          console.warn(`Union error on feature ${i}, skipping`, err);
        }
      }
      
      // If merge failed, fallback to the collection of valid features
      const finalFeature = merged || validFeatures[0];
      return {
        type: 'FeatureCollection' as const,
        features: [finalFeature]
      };
    } catch (error) {
      console.error('Failed to merge district boundaries:', error);
      // Fallback: return original boundaries if merge fails
      return districtBoundaries;
    }
  }, [districtBoundaries]);
  
  // Style for unified service area (bright cyan/blue glow for dark theme)
  const serviceAreaStyle = {
    fillColor: '#06b6d4', // Cyan
    fillOpacity: 0.15,
    color: '#22d3ee', // Bright cyan border
    weight: 3,
    opacity: 0.9
  };
  
  return (
    <MapContainer 
      center={[center.lat, center.lng]} 
      zoom={12} 
      preferCanvas={true}
      style={{ 
        height: '100vh', 
        width: '100vw', 
        cursor: isOptimizing ? 'wait' : 'crosshair',
        backgroundColor: '#f5f5f5' // Light background to match Voyager theme
      }} 
    >
      <LayersControl position="topright">
        <LayersControl.BaseLayer checked name="CartoDB Voyager">
          <TileLayer
            url="https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png"
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>'
          />
        </LayersControl.BaseLayer>

        <LayersControl.Overlay checked name="High Risk Zones (Subways)">
          <LayerGroup>
            {subwayStations && subwayStations.map((station, idx) => (
              <Circle
                key={`station-circle-${idx}`}
                center={[station.location.lat, station.location.lng]}
                radius={20} // 20 meters
                pathOptions={{ 
                  color: 'red', 
                  fillColor: 'red', 
                  fillOpacity: 0.1, 
                  weight: 1 
                }}
              >
                <Popup>
                  <strong>{station.name}</strong><br />
                  High Risk Zone (20m radius)
                </Popup>
              </Circle>
            ))}
          </LayerGroup>
        </LayersControl.Overlay>
      </LayersControl>
      
      <MapResizer />
      {/* Disable free-click depot placement by omitting onMapClick; keep component for map interactions if needed */}
      <MapEvents onMapClick={undefined} isOptimizing={isOptimizing} />
      
      {/* Unified Service Area Boundary (Non-interactive to allow map clicks for Hub placement) */}
      {unifiedServiceArea && (
        <GeoJSON 
          data={unifiedServiceArea} 
          style={serviceAreaStyle}
          interactive={false} 
        />
      )}

      {/* Memoized Markers and Routes for Performance */}
      <DepotCandidateMarkers candidates={depotCandidates || []} onSelect={onDepotSelect} />
      <HubMarkers hubs={hubs} />
      <ScooterMarkers scooters={scooters} />
      <RoutePolylines routes={routes} />

    </MapContainer>
  );
};

export default MapComponent;
