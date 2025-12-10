# Sprint Update: Dynamic Scenarios & Penalty Minimization Logic

## ✅ Implementation Complete

### **1. UI Update: Dynamic Scooter Count Input**

**Location:** `frontend/src/App.tsx`

**Changes:**
- Added new state variable: `scooterCount` (default: 50, range: 10-200)
- Added numeric input field in the control panel under "Total Scooters (N)"
- Input includes validation to clamp values between 10-200
- Added helper text explaining the distribution logic

**UI Features:**
```typescript
<input 
  type="number" 
  min="10" 
  max="200" 
  value={scooterCount} 
  onChange={(e) => setScooterCount(Math.min(200, Math.max(10, parseInt(e.target.value) || 50)))}
/>
```

---

### **2. Logic Update: Prioritized State Assignment**

**Location:** `frontend/src/utils/ScenarioGenerator.ts`

**New Algorithm:**

The scenario generator now follows a **strict priority order** matching Seoul regulations:

#### **Priority 1: High Risk Zones (State C - Red Markers)**
- **Trigger:** Distance to nearest subway exit < 20 meters
- **Rationale:** GPS drift buffer (real regulation is 5m, but GPS error ~10-20m in urban areas)
- **Assignment:** Automatic (forced State C)
- **Parameters:**
  - Service Time: 10 minutes (rescue operation)
  - Penalty Value: ₩40,000 (Seoul towing fine)
  - Battery Display: 20-70% (visual only)

#### **Priority 2: Low Battery Zones (State B - Yellow Markers)**
- **Trigger:** Random selection from non-high-risk scooters
- **Ratio:** Randomly chosen between 30-40% per scenario run
- **Assignment:** Shuffled random selection
- **Parameters:**
  - Service Time: 2 minutes (battery swap)
  - Revenue Value: ₩5,000 (battery swap revenue)
  - Battery Display: 0-20% (visual only)

#### **Priority 3: Healthy Scooters (State A - Ignored)**
- All remaining scooters are considered "healthy"
- **Not included in optimization** (filtered out)

**Key Code Changes:**
```typescript
// Step 1: Generate all locations
const allLocations = [...]; // N random points

// Step 2: Classify by distance to subway
allLocations.forEach(node => {
  if (node.distanceToSubway < 20) {
    highRiskNodes.push(node);
  } else {
    potentialLowBatteryNodes.push(node);
  }
});

// Step 3: Random Low Battery ratio (30-40%)
const lowBatteryRatio = 0.30 + Math.random() * 0.10;
const lowBatteryCount = Math.floor(potentialLowBatteryNodes.length * lowBatteryRatio);

// Step 4: Build final list (only B and C states)
const scooters = [...highRiskNodes, ...selectedLowBatteryNodes];
```

**Console Output Example:**
```
=== Generating Scenario: 100 Scooters ===
High Risk (State C): 8 scooters (< 20m from subway)
Low Battery (State B): 33 scooters (35.9% of non-risk)
Healthy (State A): 59 scooters (ignored)
Total Scooters in Optimization: 41
Total Potential Value: ₩485K
Average Value per Scooter: ₩11.8K
```

---

### **3. Objective Function: Penalty Minimization**

**Location:** `frontend/src/services/api.ts`

**Conceptual Shift:**
- **Before:** "Maximize Revenue" (Team Orienteering Problem)
- **After:** "Minimize Penalties" (Penalty Avoidance Problem)

**Implementation:**
The Omelet VRP solver uses `unassigned_penalty` to represent the **cost of NOT visiting a node**:

```typescript
visits: scooters.map(s => ({
  name: s.id,
  coordinate: s.location,
  volume: 1.0,
  service_time: s.service_time,
  unassigned_penalty: s.score // State C: 40000, State B: 5000
}))
```

**Solver Behavior:**
- The solver minimizes: `Total Travel Cost + Unassigned Penalties`
- **High Risk (₩40K penalty):** Solver will detour significantly to avoid this penalty
- **Low Battery (₩5K penalty):** Solver will visit if convenient, skip if too costly
- **Penalty Ratio:** High Risk is **8x more critical** than Low Battery

**Example Decision:**
```
Scenario: Truck is 5km from depot, 2 options:
  Option A: Return to depot now (cost: ~5km travel)
  Option B: Detour 3km to rescue 1 High Risk scooter, then return (cost: ~8km travel + 10min service)

Decision: Option B is chosen because:
  - Cost of Option A: 5km travel + 40,000 penalty = ~40,005 cost units
  - Cost of Option B: 8km travel + 10min service = ~8,010 cost units
  - Savings: ~32,000 cost units (penalty avoided)
```

**Console Logging:**
```
=== Building VRP Request (Penalty Minimization Mode) ===
High Risk (State C): 8 scooters @ ₩40K penalty each
Low Battery (State B): 33 scooters @ ₩5K penalty each
Penalty Ratio: High Risk is 8x more critical than Low Battery
```

---

## 🧪 Verification Plan

### **Test Case 1: Scooter Distribution**
1. Set "Total Scooters (N)" to **100**
2. Click "Scenario" button
3. **Expected Results:**
   - Console shows: `High Risk (State C): ~5-15 scooters` (depends on random placement near subways)
   - Console shows: `Low Battery (State B): ~30-40 scooters` (30-40% of non-risk)
   - Console shows: `Healthy (State A): ~50-65 scooters (ignored)`
   - Map shows: Yellow markers scattered across Gangnam
   - Map shows: Red markers **clustered tightly** around subway station icons (within 20m radius)

### **Test Case 2: Penalty-Driven Routing**
1. Generate scenario with 100 scooters
2. Place Hub **far from subway stations** (e.g., southwest corner of Gangnam)
3. Set Fleet Size to **2 Trucks**
4. Click "Optimize"
5. **Expected Results:**
   - Routes should show trucks making **detours** to clear red markers first
   - High Risk scooters should be prioritized even if they require longer travel
   - Some yellow markers may remain unvisited (skipped due to low penalty)
   - Console shows: Route statistics with higher scores for routes that cleared red markers

### **Test Case 3: Edge Case - All High Risk**
1. Manually place Hub **directly on top of a subway station**
2. Generate scenario (most scooters will be High Risk)
3. Optimize with 3 trucks
4. **Expected Results:**
   - Most/all scooters should be collected (high penalties force collection)
   - Routes should be very short (all scooters nearby)
   - Total Score should be very high (₩40K per scooter)

---

## 📊 Key Metrics to Observe

After optimization, check the console for:

```
Route Truck-1 stats: {
  scooters: 20,
  distance: 28333,      // meters
  duration: 7061,       // seconds (~118 minutes)
  score: 140000         // ₩140K (likely mix of 3 High Risk + 17 Low Battery)
}
```

**Interpretation:**
- If `score` is high (₩100K+), route prioritized High Risk scooters ✅
- If `duration` approaches 7200 seconds (2 hours), truck is at time limit ⚠️
- If `scooters` is low but `score` is high, truck focused on quality over quantity ✅

---

## 🎯 Success Criteria

✅ **UI:** Numeric input for scooter count (10-200) is visible and functional  
✅ **Logic:** Red markers appear ONLY near subway exits (within 20m)  
✅ **Logic:** Yellow markers represent 30-40% of non-risk scooters  
✅ **Optimization:** Routes prioritize red markers (8x penalty weight)  
✅ **Console:** Clear logging shows penalty-driven decision making  

---

## 🔄 Next Steps (Future Sprints)

1. **Sprint 4:** Add "Time Window Constraints" for High Risk zones (e.g., "must be cleared by 10:00 AM")
2. **Sprint 5:** Add "Dynamic Pricing" (penalty increases over time for High Risk)
3. **Sprint 6:** Add "Multi-Depot" support for larger operational areas
4. **Sprint 7:** Export optimization results to CSV for reporting

---

## 📝 Technical Notes

### **Why 20m instead of 5m?**
Real Seoul regulation prohibits parking within 5m of subway exits. However:
- GPS accuracy in urban canyons: ±10-20m
- Safety buffer for operational compliance
- Visual clustering effect on map (easier to see "red zones")

### **Why random 30-40% ratio?**
Simulates real-world variability:
- Different times of day have different usage patterns
- Weather affects battery drain rates
- Weekday vs. weekend usage differs

### **Why "Penalty Minimization" instead of "Revenue Maximization"?**
Operational reality:
- **Primary Goal:** Avoid fines (legal compliance)
- **Secondary Goal:** Generate revenue (battery swaps)
- Penalty-based modeling better reflects risk-averse decision making

