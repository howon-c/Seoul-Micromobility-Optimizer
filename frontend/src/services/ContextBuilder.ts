import { ConsultantMetrics } from './ConsultantService';

/**
 * Financial statistics from the optimization result
 */
export interface FinancialStats {
  netLossPrevented: number;       // Total penalty saved - operational cost
  totalPenaltySaved: number;      // Sum of all visited scooter penalties
  finesAvoided: number;           // ₩40k × high-risk visited
  inventorySaved: number;         // ₩2.5k × low-battery visited
  operationalCost: number;        // ₩60k × trucks deployed
  remainingRisk: number;          // Unvisited penalty value
  visitedHighRiskCount: number;
  visitedLowBatteryCount: number;
  missedHighRiskCount: number;
  missedLowBatteryCount: number;
}

/**
 * Truck/Fleet configuration
 */
export interface TruckConfig {
  truckCount: number;
  volumeCapacity: number;         // 20 by default
  shiftDurationHours: number;     // 2 hours
  costPerTruck: number;           // ₩60,000
}

/**
 * Formats a Korean Won value as a short string (e.g., ₩840K)
 */
function formatKrwShort(value: number): string {
  const sign = value < 0 ? '-' : '';
  const absK = Math.abs(value / 1000);
  if (absK >= 1000) {
    return `${sign}₩${(absK / 1000).toFixed(1)}M`;
  }
  return `${sign}₩${absK.toLocaleString('en-US', { maximumFractionDigits: 0 })}K`;
}

/**
 * Determines utilization efficiency label
 */
function utilizationLabel(utilization: number): string {
  if (utilization >= 0.85) return 'Excellent';
  if (utilization >= 0.7) return 'Good';
  if (utilization >= 0.5) return 'Moderate';
  return 'Inefficient';
}

/**
 * Builds a "Morning Briefing" context string for AI analysis
 */
export function buildContextBriefing(
  metrics: ConsultantMetrics,
  financials: FinancialStats,
  config: TruckConfig
): string {
  const lines: string[] = [];

  lines.push('Current Simulation State:');
  lines.push('');

  // Fleet Configuration
  lines.push(`- Fleet: ${config.truckCount} Trucks (Capacity ${config.volumeCapacity}).`);
  lines.push(`- Shift Duration: ${config.shiftDurationHours} hours.`);
  lines.push(`- Cost per Truck: ${formatKrwShort(config.costPerTruck)}/shift.`);
  lines.push('');

  // Performance Metrics
  lines.push('- Performance:');
  lines.push(`  - Net Loss Prevented: ${formatKrwShort(financials.netLossPrevented)}.`);
  lines.push(`  - Fines Avoided: ${formatKrwShort(financials.finesAvoided)} (${financials.visitedHighRiskCount} high-risk rescued).`);
  lines.push(`  - Inventory Saved: ${formatKrwShort(financials.inventorySaved)} (${financials.visitedLowBatteryCount} low-battery recovered).`);
  lines.push(`  - Operational Cost: ${formatKrwShort(-financials.operationalCost)}.`);
  
  if (financials.missedHighRiskCount > 0) {
    const missedFines = financials.missedHighRiskCount * 40000;
    lines.push(`  - Missed High Risk Nodes: ${financials.missedHighRiskCount} (Potential fines: ${formatKrwShort(missedFines)}).`);
  }
  
  if (financials.missedLowBatteryCount > 0) {
    const missedRevenue = financials.missedLowBatteryCount * 2500;
    lines.push(`  - Missed Low Battery Nodes: ${financials.missedLowBatteryCount} (Lost opportunity: ${formatKrwShort(missedRevenue)}).`);
  }

  if (metrics.fleetUtilization !== undefined) {
    const utilPct = (metrics.fleetUtilization * 100).toFixed(0);
    const label = utilizationLabel(metrics.fleetUtilization);
    lines.push(`  - Fleet Utilization: ${utilPct}% (${label}).`);
  }

  lines.push('');

  // Spatial Analysis
  lines.push('- Spatial Analysis:');
  if (metrics.depotDeviationMeters !== undefined) {
    const deviationKm = (metrics.depotDeviationMeters / 1000).toFixed(1);
    lines.push(`  - Depot is ${deviationKm}km away from the demand center (CoG).`);
  } else {
    lines.push('  - No high-risk nodes to calculate demand center.');
  }

  lines.push('');

  // Remaining Risk Summary
  if (financials.remainingRisk > 0) {
    lines.push(`- Remaining Risk: ${formatKrwShort(financials.remainingRisk)} in unserved penalties.`);
    lines.push('');
  }

  lines.push('- Heuristic Advice Generated.');

  return lines.join('\n');
}

/**
 * Helper to extract FinancialStats from App.tsx state
 */
export function extractFinancialStats(
  scooters: { state: string; penaltyValue: number }[],
  routes: {
    totalScore: number;
    revenueCollected: number;
    finesAvoided: number;
    highRiskCollected: number;
    lowBatteryCollected: number;
  }[],
  truckCount: number,
  costPerTruck: number
): FinancialStats {
  const highRiskCount = scooters.filter(s => s.state === 'C').length;
  const lowBatteryCount = scooters.filter(s => s.state === 'B').length;

  const totalPenaltySaved = routes.reduce((sum, r) => sum + r.totalScore, 0);
  const finesAvoided = routes.reduce((sum, r) => sum + r.finesAvoided, 0);
  const inventorySaved = routes.reduce((sum, r) => sum + r.revenueCollected, 0);
  const visitedHighRiskCount = routes.reduce((sum, r) => sum + r.highRiskCollected, 0);
  const visitedLowBatteryCount = routes.reduce((sum, r) => sum + r.lowBatteryCollected, 0);

  const operationalCost = truckCount * costPerTruck;
  const totalPotentialPenalty = scooters.reduce((sum, s) => sum + (s.penaltyValue || 0), 0);
  const remainingRisk = Math.max(0, totalPotentialPenalty - totalPenaltySaved);

  return {
    netLossPrevented: totalPenaltySaved - operationalCost,
    totalPenaltySaved,
    finesAvoided,
    inventorySaved,
    operationalCost,
    remainingRisk,
    visitedHighRiskCount,
    visitedLowBatteryCount,
    missedHighRiskCount: Math.max(0, highRiskCount - visitedHighRiskCount),
    missedLowBatteryCount: Math.max(0, lowBatteryCount - visitedLowBatteryCount),
  };
}

