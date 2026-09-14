const E = require("./engine.js");

let s = 20260914;
const rnd = () => ((s = (s * 1103515245 + 12345) % 2147483648) / 2147483648);
const pick = (a) => a[Math.floor(rnd() * a.length)];
const SECS = E.SECTION_LIBRARY.map((x) => x.name);

let nRun = 0, nOk = 0, eqFail = 0, ctFail = 0, nanFail = 0, deflBad = 0;
const statuses = {};

for (let t = 0; t < 1000; t++) {
  const n = 1 + Math.floor(rnd() * 12);
  const lengths = Array.from({ length: n }, () => 0.5 + rnd() * 8);
  const total = lengths.reduce((a, b) => a + b, 0);
  const supports = Array.from({ length: n + 1 }, () => pick(["Free", "Pinned", "Pinned", "Roller", "Roller", "Fixed"]));
  const elements = lengths.map((L, i) => ({ id: "E" + i, description: "E" + i, length: L, section: pick(SECS) }));
  const loads = E.emptyLoads();
  for (let i = 0, nl = Math.floor(rnd() * 6); i < nl; i++) {
    const cse = pick(E.LOAD_CASES);
    const p = rnd();
    if (p < 0.35) loads[i] = { id: "L" + i, active: true, case: cse, type: "Point", x1: rnd() * total, x2: 0, magnitude: (rnd() - 0.3) * 40, description: "" };
    else if (p < 0.55) loads[i] = { id: "L" + i, active: true, case: cse, type: "Moment", x1: rnd() * total, x2: 0, magnitude: (rnd() - 0.5) * 50, description: "" };
    else { const a = rnd() * total, b = Math.min(total, a + rnd() * total + 1e-3); loads[i] = { id: "L" + i, active: true, case: cse, type: "UDL", x1: a, x2: b, magnitude: (rnd() - 0.3) * 25, description: "" }; }
  }
  const model = {
    nElements: n, material: pick(["Steel", "Aluminium", "Custom"]), customE: 70000 + rnd() * 150000, customDensity: 2000 + rnd() * 6000,
    defaultSection: pick(SECS), customI: 1e6 + rnd() * 1e8, customZ: 1e4 + rnd() * 1e6, customA: 300 + rnd() * 9000, customAv: 200 + rnd() * 5000,
    includeSelfWeight: rnd() < 0.6, stationsPerElement: pick([13, 26, 51]), deflectionLimitN: pick([150, 200, 250, 360]),
    elements, supports, loads,
    combinations: E.DEFAULT_COMBINATIONS.map((c) => ({ ...c, factors: { ...c.factors } })),
    selectedComboId: pick(["c1", "c4", "c7", "c10", "c12"]),
  };

  let r;
  try { r = E.analyze(model); } catch (e) { console.log("THREW:", e.message, JSON.stringify({ lengths, supports })); continue; }
  nRun++;
  statuses[r.status] = (statuses[r.status] || 0) + 1;
  if (r.status !== "OK") continue;
  nOk++;

  if (!r.equilibrium.every((e) => e.ok)) { eqFail++; console.log("EQ FAIL", JSON.stringify(r.equilibrium.filter((e) => !e.ok))); }
  if (!r.continuity.every((c) => c.ok)) { ctFail++; console.log("CONT FAIL", JSON.stringify(r.continuity.filter((c) => !c.ok))); }

  const nums = [
    ...r.selected.V, ...r.selected.M, ...r.selected.v, ...r.selected.slopeDeg,
    ...r.selected.tau, ...r.selected.sigmaTop, ...r.selected.sigmaBot,
    ...r.selected.extrema.map((x) => x.value), ...r.envelope.map((x) => x.value),
    r.deflectionCheck.utilisation, r.deflectionCheck.maxAbsMm,
  ];
  if (nums.some((v) => !Number.isFinite(v))) { nanFail++; console.log("NON-FINITE output"); }

  // deflection segments must tile the beam and each must use its own length
  const segs = r.deflectionCheck.spans;
  const covered = segs.reduce((a, x) => a + x.length, 0);
  if (segs.length && Math.abs(covered - r.totalLength) > 1e-6) { deflBad++; console.log("SEG COVERAGE", covered, r.totalLength); }
  for (const sg of segs) {
    const want = sg.length * 1000 / model.deflectionLimitN;
    if (Math.abs(sg.allowableMm - want) > 1e-9) { deflBad++; console.log("ALLOWABLE MISMATCH", sg); }
    if (sg.utilisation > r.deflectionCheck.utilisation + 1e-12) { deflBad++; console.log("GOVERNING NOT WORST", sg.utilisation, r.deflectionCheck.utilisation); }
  }

  // every extremum value must actually occur at the x it claims
  for (const ex of r.selected.extrema) {
    const idx = r.stations.findIndex((st) => Math.abs(st.x - ex.x) < 1e-9);
    if (idx < 0) { console.log("EXTREMUM X NOT A STATION", ex.label, ex.x); deflBad++; }
  }
}

console.log(`\nran ${nRun}, analysed OK ${nOk}`);
console.log("statuses:", JSON.stringify(statuses));
console.log(`equilibrium failures ${eqFail}, continuity failures ${ctFail}, non-finite outputs ${nanFail}, deflection-check inconsistencies ${deflBad}`);
