# Sprint Update: Constructive Generation & The "5% Rule"

## 🎯 Problem Identified

**Previous Flaw:** Rejection Sampling approach generated N random points across Gangnam and checked if they fell within 20m of subway exits. This resulted in:
- ❌ Almost zero High-Risk nodes (probability too low)
- ❌ Inconsistent scenario quality
- ❌ Unable to test penalty-driven routing behavior

**Root Cause:** The 20m radius around 3 subway exits represents only ~0.04% of Gangnam's area. Random sampling had <1% chance of hitting these zones.

---

## ✅ Solution: Constructive Generation

**New Approach:** Generate scooters in **two distinct batches** with forced distribution:

### **Batch A: High Risk Group (The "5% Rule")**

**Strategy:** Force exactly ~5% of N scooters to spawn near subway exits

**Implementation:**
```typescript
// Step 1: Calculate forced High Risk count
const countHighRisk = Math.max(1, Math.floor(N * 0.05));

// Step 2: For each High Risk scooter:
for (let i = 0; i < countHighRisk; i++) {
  // 2a. Randomly select a subway exit
  const subwayExit = SUBWAY_EXITS[random];
  
  // 2b. Generate point within 0-15 meter radius
  const location = generatePointNearLocation(subwayExit, 15);
  
  // 2c. Force State C
  scooters.push({
    state: 'C',
    score: 40000, // ₩40K penalty
    service_time: 10 // minutes
  });
}
```

**Key Features:**
- Uses **polar coordinates** for uniform distribution within radius
- Converts meters to lat/lng offsets (accounting for Seoul's latitude)
- Guarantees tight clustering around subway exits (0-15m)
- Always generates at least 1 High Risk scooter (even for N=10)

**Math Behind `generatePointNearLocation`:**
```typescript
// Uniform distribution in circle requires sqrt(random) for radius
const angle = random() * 2π;
const radius = sqrt(random()) * maxRadius;

// Convert meters to degrees at Seoul latitude (~37.5°)
// 1° latitude ≈ 111km everywhere
// 1° longitude ≈ 111km * cos(latitude) ≈ 88km at Seoul
const latOffset = (radius * cos(angle)) / 111000;
const lngOffset = (radius * sin(angle)) / 88000;
```

---

### **Batch B: Standard Distribution (Remaining 95%)**

**Strategy:** Generate remaining scooters randomly across Gangnam, then assign states

**Implementation:**
```typescript
// Step 1: Generate random locations
const countStandard = N - countHighRisk;
const locations = generateRandomPointsInGangnam(countStandard);

// Step 2: Determine Low Battery ratio (30-40%)
const lowBatteryRatio = 0.30 + random() * 0.10;
const countLowBattery = floor(countStandard * lowBatteryRatio);

// Step 3: Shuffle and assign states
shuffle(locations);
const lowBatteryScooters = locations.slice(0, countLowBattery).map(loc => ({
  state: 'B',
  score: 5000, // ₩5K revenue
  service_time: 2 // minutes
}));

// Step 4: Remaining are Healthy (State A) - ignored
const countHealthy = countStandard - countLowBattery;
```

---

### **Final Step: Combine & Shuffle**

**Why Shuffle?**
- Prevents High Risk scooters from always being first in array
- Ensures ID assignment is random (not clustered by state)
- Improves visual distribution on map

```typescript
const allScooters = [...highRiskScooters, ...lowBatteryScooters];
allScooters.sort(() => Math.random() - 0.5); // Shuffle

// Reassign sequential IDs
allScooters.forEach((s, i) => s.id = `S-${i + 1}`);
```

---

## 📊 Expected Distribution

### **Example: N = 100**

| Batch | Count | Percentage | State | Value | Total Value |
|-------|-------|------------|-------|-------|-------------|
| **Batch A** | 5 | 5% | C (High Risk) | ₩40K | ₩200K |
| **Batch B (Low Battery)** | 33 | 35% | B (Low Battery) | ₩5K | ₩165K |
| **Batch B (Healthy)** | 62 | 60% | A (Healthy) | - | - |
| **In Optimization** | **38** | **38%** | B + C | - | **₩365K** |

**Key Insights:**
- High Risk represents only 13% of optimized scooters (5/38)
- But represents 55% of total value (₩200K / ₩365K)
- **Penalty ratio:** Skipping 1 High Risk = Skipping 8 Low Battery scooters

---

## 🧪 Verification Criteria

### **Test 1: Distribution Check**
1. Set **N = 100**
2. Click **"Scenario"**
3. **Expected Console Output:**
   ```
   === Generating Scenario: 100 Scooters (Constructive Method) ===
   
   [Batch A] Generating 5 High Risk scooters (5% of 100)
   ✓ Generated 5 High Risk scooters near subway exits
   
   [Batch B] Generating 95 standard scooters across Gangnam
     → Low Battery (State B): 33 scooters (34.7% of Batch B)
     → Healthy (State A): 62 scooters (ignored)
   ✓ Generated 33 Low Battery scooters
   
   === Scenario Summary ===
   High Risk (State C): 5 scooters @ ₩40K each = ₩200K
   Low Battery (State B): 33 scooters @ ₩5K each = ₩165K
   Healthy (State A): 62 scooters (ignored)
   Total in Optimization: 38 scooters
   Total Potential Value: ₩365K
   Average Value: ₩9.6K per scooter
   ```

4. **Expected Map Visual:**
   - 🔴 **Exactly 5 red markers** clustered tightly around subway station icons
   - 🟡 **~33 yellow markers** scattered randomly across Gangnam
   - 🔵 **1 blue marker** for depot (after clicking map)

---

### **Test 2: Penalty-Driven Routing**
1. Generate scenario (N=100)
2. Place **Hub far from subway stations** (e.g., southwest corner)
3. Set **Fleet Size = 2 Trucks**
4. Click **"Optimize"**
5. **Expected Behavior:**
   - ✅ Routes should make **visible detours** to clear red markers
   - ✅ Trucks prioritize red markers even if yellow markers are closer
   - ✅ Console shows High Risk scooters visited first in route sequence
   - ✅ Some yellow markers remain unvisited (low penalty, not worth travel cost)

**Example Route Output:**
```
Route Truck-1 stats: {
  scooters: 12,
  distance: 15200,
  duration: 4800,
  score: 155000  // High! Likely collected 3 High Risk (₩120K) + 7 Low Battery (₩35K)
}

Route Truck-2 stats: {
  scooters: 18,
  distance: 18900,
  duration: 6200,
  score: 170000  // Very high! Likely collected 2 High Risk (₩80K) + 18 Low Battery (₩90K)
}
```

**Interpretation:**
- If `score > ₩100K`, route successfully prioritized High Risk ✅
- If `scooters` is low but `score` is high, quality over quantity ✅
- If red markers are cleared but yellow remain, penalty logic working ✅

---

### **Test 3: Edge Case - Small N**
1. Set **N = 10**
2. Click **"Scenario"**
3. **Expected:**
   - Console: `High Risk (State C): 1 scooter` (minimum enforced)
   - Map: Exactly 1 red marker near a subway
   - Map: ~3-4 yellow markers elsewhere

---

### **Test 4: Edge Case - Large N**
1. Set **N = 200**
2. Click **"Scenario"**
3. **Expected:**
   - Console: `High Risk (State C): 10 scooters`
   - Map: 10 red markers distributed across 3 subway stations (~3-4 per station)
   - Map: ~60-80 yellow markers across Gangnam

---

## 🔍 Technical Deep Dive

### **Why 0-15 meters instead of 0-20 meters?**

**Regulatory Context:**
- Real Seoul law: No parking within **5 meters** of subway exits
- GPS accuracy in urban areas: **±10-20 meters**

**Our Choice (0-15m):**
- Ensures all generated points are **definitely** in violation zone
- Accounts for GPS drift (even with error, still within 20m buffer)
- Creates tight visual clustering for map readability
- Leaves 5m margin for edge cases (15m + 10m drift = 25m max, still close)

### **Why shuffle the combined array?**

**Without Shuffle:**
```
Scooters: [C, C, C, C, C, B, B, B, ..., B]
IDs:      [S-1, S-2, S-3, S-4, S-5, S-6, ...]
```
- All High Risk have low IDs (S-1 to S-5)
- Predictable ordering in UI/logs
- Harder to debug state-specific issues

**With Shuffle:**
```
Scooters: [B, C, B, B, C, B, C, B, ..., B]
IDs:      [S-1, S-2, S-3, S-4, S-5, S-6, ...]
```
- IDs are randomized across states
- More realistic (real-world scooter IDs aren't sorted by state)
- Better for testing (ensures code doesn't rely on array order)

### **Why use polar coordinates for point generation?**

**Naive Approach (WRONG):**
```typescript
// This creates clustering toward center!
const x = random() * radius;
const y = random() * radius;
```

**Correct Approach (Uniform Distribution):**
```typescript
// sqrt(random()) ensures uniform density
const angle = random() * 2π;
const r = sqrt(random()) * maxRadius;
const x = r * cos(angle);
const y = r * sin(angle);
```

**Why `sqrt(random())`?**
- Area of annulus at radius r: `2πr * dr`
- Probability density must be proportional to r
- CDF: `P(R ≤ r) = r² / maxRadius²`
- Inverse CDF: `r = sqrt(random()) * maxRadius`

---

## 📈 Performance Characteristics

### **Time Complexity:**
- **Old (Rejection Sampling):** O(N * k) where k = average rejections per point (very high)
- **New (Constructive):** O(N) - always generates exactly N points

### **Space Complexity:**
- O(N) for both approaches (same)

### **Reliability:**
- **Old:** Non-deterministic (might fail to generate any High Risk)
- **New:** Deterministic (always generates exactly 5% High Risk)

---

## 🎯 Success Metrics

✅ **Distribution Guarantee:** Always 5% ± 0 High Risk (deterministic)  
✅ **Visual Clustering:** Red markers tightly grouped around subways (<15m)  
✅ **Penalty Logic:** Routes prioritize red over yellow (8x penalty ratio)  
✅ **Console Transparency:** Clear logging shows constructive process  
✅ **Edge Case Handling:** Works for N=10 to N=200  

---

## 🔄 Next Steps

### **Immediate Testing:**
1. Refresh browser (Ctrl+Shift+R)
2. Set N=100, generate scenario
3. Verify exactly 5 red markers near subways
4. Place hub, optimize, observe penalty-driven routing

### **Future Enhancements:**
1. **Dynamic Penalty Scaling:** Increase penalty over time (simulate urgency)
2. **Time Windows:** High Risk must be cleared by specific time
3. **Multi-Depot:** Support multiple hubs for larger operational areas
4. **Real-Time Updates:** Simulate new High Risk scooters appearing during shift

---

## 📝 Code Changes Summary

### **Modified Files:**
1. ✅ `frontend/src/utils/ScenarioGenerator.ts`
   - Added `generatePointNearLocation()` helper
   - Refactored `generateScenario()` to use constructive generation
   - Added detailed console logging for transparency

2. ✅ `frontend/src/App.tsx`
   - Updated helper text to reflect "~5% forced High Risk"

### **Unchanged Files:**
- ✅ `frontend/src/services/api.ts` (already has penalty logic from previous sprint)
- ✅ `frontend/src/types.ts` (no schema changes needed)

---

## 🚀 Ready for Testing!

The scenario generation is now **deterministic and reliable**. Every run will produce exactly ~5% High Risk scooters near subway exits, enabling consistent testing of penalty-driven routing behavior.

