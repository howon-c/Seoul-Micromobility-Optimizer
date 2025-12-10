import { Coordinate, OptimizedRoute, Scooter, Hub } from '../types';

// Simple haversine distance in meters
function haversineDistance(a: Coordinate, b: Coordinate): number {
  const R = 6371e3;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1) * Math.cos(lat2) *
    Math.sin(dLng / 2) * Math.sin(dLng / 2);
  return 2 * R * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

export interface ConsultantMetrics {
  centerOfGravity?: Coordinate;
  depotDeviationMeters?: number;
  missedHighRiskValue?: number;
  fleetUtilization?: number; // 0-1
}

export function generateAnalysis(
  routes: OptimizedRoute[],
  allScooters: Scooter[],
  truckCount: number,
  depot: Hub
): { report: string; metrics: ConsultantMetrics } {
  const metrics: ConsultantMetrics = {};

  // CoG of high-risk scooters (state C)
  const highRisk = allScooters.filter(s => s.state === 'C');
  if (highRisk.length > 0) {
    const sumLat = highRisk.reduce((s, p) => s + p.location.lat, 0);
    const sumLng = highRisk.reduce((s, p) => s + p.location.lng, 0);
    const cog: Coordinate = { lat: sumLat / highRisk.length, lng: sumLng / highRisk.length };
    metrics.centerOfGravity = cog;
    metrics.depotDeviationMeters = haversineDistance(depot.location, cog);
  }

  // Missed high-risk value
  const visitedHighRisk = routes.reduce((sum, r) => sum + r.highRiskCollected, 0);
  const missedHighRiskCount = Math.max(0, highRisk.length - visitedHighRisk);
  metrics.missedHighRiskValue = missedHighRiskCount * 40000;

  // Fleet utilization: total duration / (truckCount * 2h)
  const totalDuration = routes.reduce((sum, r) => sum + r.duration, 0); // seconds
  const denom = truckCount * 2 * 3600;
  metrics.fleetUtilization = denom > 0 ? totalDuration / denom : 0;

  // Build suggestions
  const suggestions: string[] = [];
  if (metrics.depotDeviationMeters !== undefined && metrics.depotDeviationMeters > 2000) {
    suggestions.push('Suggestion: Move your depot closer to the demand center to reduce empty driving time.');
  }
  if (missedHighRiskCount > 5) {
    suggestions.push(`Suggestion: Add 1-2 more trucks. You missed critical fines worth ₩${(metrics.missedHighRiskValue / 1000).toFixed(0)}K.`);
  }
  if (metrics.fleetUtilization !== undefined && metrics.fleetUtilization < 0.6) {
    suggestions.push('Suggestion: Reduce fleet size to save operational costs (utilization under 60%).');
  }

  const report = suggestions.length > 0
    ? suggestions.join(' ')
    : 'Operations look balanced. No immediate changes recommended.';

  return { report, metrics };
}

