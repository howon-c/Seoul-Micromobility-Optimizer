import { ConsultantMetrics } from '../services/ConsultantService';
import { FinancialStats, TruckConfig } from '../services/ContextBuilder';

/**
 * App state snapshot for context building
 */
export interface AppStateSnapshot {
  truckConfig: TruckConfig;
  scooterCounts: {
    total: number;
    highRisk: number;
    lowBattery: number;
  };
  hasRoutes: boolean;
  depotName?: string;
}

/**
 * Formats currency for prompts
 */
function formatKrw(value: number): string {
  const sign = value < 0 ? '-' : '+';
  const absK = Math.abs(value / 1000);
  if (absK >= 1000) {
    return `${sign}₩${(absK / 1000).toFixed(1)}M`;
  }
  return `${sign}₩${absK.toFixed(0)}K`;
}

/**
 * Generates the system prompt for the AI Operations Manager
 */
export function generateSystemPrompt(
  metrics: ConsultantMetrics | null,
  financials: FinancialStats | null,
  appState: AppStateSnapshot,
  heuristicAdvice: string | null
): string {
  const lines: string[] = [];

  // Persona definition
  lines.push(`You are a Senior Logistics Operations Manager for a micromobility fleet in Seoul's Gangnam district.`);
  lines.push(`Be concise, professional, and data-driven. Use the provided simulation data to answer questions.`);
  lines.push(`When giving advice, reference specific numbers from the data. Keep responses under 150 words unless asked for detail.`);
  lines.push('');
  lines.push('---');
  lines.push('CURRENT SIMULATION STATE:');
  lines.push('');

  // Fleet Configuration
  lines.push(`Fleet Configuration:`);
  lines.push(`- Trucks Deployed: ${appState.truckConfig.truckCount}`);
  lines.push(`- Truck Capacity: ${appState.truckConfig.volumeCapacity} scooters (weighted: High-Risk=4, Low-Battery=1)`);
  lines.push(`- Shift Duration: ${appState.truckConfig.shiftDurationHours} hours`);
  lines.push(`- Cost per Truck: ₩${(appState.truckConfig.costPerTruck / 1000).toFixed(0)}K per shift`);
  lines.push('');

  // Scooter Distribution
  lines.push(`Scooter Distribution:`);
  lines.push(`- Total Scooters: ${appState.scooterCounts.total}`);
  lines.push(`- High Risk (State C): ${appState.scooterCounts.highRisk} @ ₩40K fine each if missed`);
  lines.push(`- Low Battery (State B): ${appState.scooterCounts.lowBattery} @ ₩2.5K opportunity cost each`);
  lines.push('');

  if (appState.depotName) {
    lines.push(`Depot Location: ${appState.depotName}`);
    lines.push('');
  }

  // Financial Results (if optimization has run)
  if (financials && appState.hasRoutes) {
    lines.push(`Financial Results:`);
    lines.push(`- Net Loss Prevented: ${formatKrw(financials.netLossPrevented)}`);
    lines.push(`- Fines Avoided: ${formatKrw(financials.finesAvoided)} (${financials.visitedHighRiskCount} high-risk rescued)`);
    lines.push(`- Inventory Saved: ${formatKrw(financials.inventorySaved)} (${financials.visitedLowBatteryCount} low-battery recovered)`);
    lines.push(`- Operational Cost: ${formatKrw(-financials.operationalCost)}`);
    lines.push(`- Remaining Risk: ${formatKrw(-financials.remainingRisk)} in unserved penalties`);
    
    if (financials.missedHighRiskCount > 0) {
      lines.push(`- ALERT: ${financials.missedHighRiskCount} high-risk scooters were NOT collected (₩${(financials.missedHighRiskCount * 40).toFixed(0)}K potential fines)`);
    }
    if (financials.missedLowBatteryCount > 0) {
      lines.push(`- ${financials.missedLowBatteryCount} low-battery scooters were NOT collected`);
    }
    lines.push('');
  }

  // Operational Metrics (if available)
  if (metrics && appState.hasRoutes) {
    lines.push(`Operational Metrics:`);
    if (metrics.fleetUtilization !== undefined) {
      const utilPct = (metrics.fleetUtilization * 100).toFixed(0);
      const efficiency = metrics.fleetUtilization >= 0.7 ? 'Good' : metrics.fleetUtilization >= 0.5 ? 'Moderate' : 'Low/Inefficient';
      lines.push(`- Fleet Utilization: ${utilPct}% (${efficiency})`);
    }
    if (metrics.depotDeviationMeters !== undefined) {
      const deviationKm = (metrics.depotDeviationMeters / 1000).toFixed(1);
      lines.push(`- Depot Distance from Demand Center: ${deviationKm}km`);
      if (metrics.depotDeviationMeters > 2000) {
        lines.push(`  (WARNING: Depot is far from where high-risk scooters are concentrated)`);
      }
    }
    lines.push('');
  }

  // Heuristic Advice from ConsultantService
  if (heuristicAdvice) {
    lines.push(`Heuristic Analysis:`);
    lines.push(heuristicAdvice);
    lines.push('');
  }

  // Instructions
  lines.push('---');
  lines.push('INSTRUCTIONS:');
  lines.push('- Answer questions about fleet performance, depot placement, and optimization results.');
  lines.push('- If asked "why did I lose money?", analyze the operational cost vs penalties prevented.');
  lines.push('- If asked about depot placement, reference the distance from demand center (CoG).');
  lines.push('- If utilization is low, suggest reducing fleet size. If high-risk nodes are missed, suggest adding trucks.');
  lines.push('- Do NOT make up data. Only use the numbers provided above.');

  return lines.join('\n');
}

/**
 * Generates an initial assistant message after optimization completes
 */
export function generateInitialSummary(
  metrics: ConsultantMetrics | null,
  financials: FinancialStats | null,
  appState: AppStateSnapshot
): string {
  if (!financials || !appState.hasRoutes) {
    return "Ready to analyze your fleet operations. Run an optimization first, then ask me questions about the results!";
  }

  const parts: string[] = [];
  
  // Headline
  if (financials.netLossPrevented >= 0) {
    parts.push(`✅ **Optimization complete!** Net loss prevented: ₩${(financials.netLossPrevented / 1000).toFixed(0)}K.`);
  } else {
    parts.push(`⚠️ **Optimization complete**, but operations are running at a loss: ₩${(financials.netLossPrevented / 1000).toFixed(0)}K.`);
  }

  // Key insights
  const insights: string[] = [];
  
  if (metrics?.fleetUtilization !== undefined && metrics.fleetUtilization < 0.6) {
    insights.push(`Fleet utilization is low (${(metrics.fleetUtilization * 100).toFixed(0)}%) — consider reducing trucks`);
  }
  
  if (financials.missedHighRiskCount > 0) {
    insights.push(`${financials.missedHighRiskCount} high-risk scooters missed (₩${(financials.missedHighRiskCount * 40).toFixed(0)}K in potential fines)`);
  }
  
  if (metrics?.depotDeviationMeters !== undefined && metrics.depotDeviationMeters > 2000) {
    insights.push(`Depot is ${(metrics.depotDeviationMeters / 1000).toFixed(1)}km from the demand center`);
  }

  if (insights.length > 0) {
    parts.push('\n\n**Key observations:**');
    insights.forEach(i => parts.push(`• ${i}`));
  }

  parts.push('\n\nAsk me anything about the results!');
  
  return parts.join('');
}

