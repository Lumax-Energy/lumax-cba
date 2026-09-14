const E = require("./engine.js");

function mk({ lengths, supports, loads, I = 1e8, sw = false, stations = 26 }) {
  const elements = lengths.map((L, i) => ({ id: `E${i}`, description: `E${i + 1}`, length: L, section: "Custom" }));
  const all = E.emptyLoads();
  loads.forEach((l, i) => { all[i] = { id: `L${i}`, active: true, description: "", x2: 0, ...l }; });
  return {
    nElements: lengths.length, material: "Steel", customE: 200000, customDensity: 7850,
    defaultSection: "Custom", customI: I, customZ: 1e6, customA: 1e4, customAv: 1e4,
    includeSelfWeight: sw, stationsPerElement: stations, deflectionLimitN: 250,
    elements, supports, loads: all,
    combinations: [{ id: "u", name: "unit", class: "User", notes: "", factors: { G: 1, Q1: 1, Q2: 1, "W+": 1, "W-": 1, O: 1 } }],
    selectedComboId: "u",
  };
}
const EI = 200000e6 * 1e8 * 1e-12; // N m^2

function vAt(r, x) {
  let bi = 0, bd = Infinity;
  r.stations.forEach((s, i) => { const d = Math.abs(s.x - x); if (d < bd - 1e-15) { bd = d; bi = i; } });
  return { v: r.selected.v[bi], slope: r.selected.slopeDeg[bi], dx: bd };
}

console.log("--- closed-form deflection checks ---");
{
  const L = 10, w = 10; // kN/m
  const r = E.analyze(mk({ lengths: [L], supports: ["Pinned", "Roller"], loads: [{ case: "Q1", type: "UDL", x1: 0, x2: L, magnitude: w }], stations: 51 }));
  let worst = 0;
  for (const s of r.stations) {
    const x = s.x;
    const exact = -(w * 1000 * x * (L ** 3 - 2 * L * x ** 2 + x ** 3)) / (24 * EI) * 1000;
    worst = Math.max(worst, Math.abs(exact - vAt(r, x).v));
  }
  console.log(`SS + full UDL, max |Δδ| over all stations = ${worst.toExponential(3)} mm`);
  // end slope: theta = wL^3/(24EI) rad, clockwise positive at the left end
  const th0 = r.selected.slopeDeg[0];
  console.log(`  end slope: got ${th0.toFixed(9)} deg, exact ${(w * 1000 * L ** 3 / (24 * EI) * 180 / Math.PI).toFixed(9)} deg`);
}
{
  const L = 10, P = 25, a = 3.7, b = L - 3.7;
  const r = E.analyze(mk({ lengths: [L], supports: ["Pinned", "Roller"], loads: [{ case: "Q1", type: "Point", x1: a, magnitude: P }], stations: 51 }));
  let worst = 0;
  for (const s of r.stations) {
    const x = s.x;
    let exact;
    if (x <= a) exact = -(P * 1000 * b * x * (L * L - b * b - x * x)) / (6 * EI * L);
    else exact = -(P * 1000 * a * (L - x) * (2 * L * x - a * a - x * x)) / (6 * EI * L);
    worst = Math.max(worst, Math.abs(exact * 1000 - vAt(r, x).v));
  }
  console.log(`SS + off-centre point load, max |Δδ| = ${worst.toExponential(3)} mm`);
}
{
  const L = 5, w = 8;
  const r = E.analyze(mk({ lengths: [L], supports: ["Fixed", "Free"], loads: [{ case: "Q1", type: "UDL", x1: 0, x2: L, magnitude: w }], stations: 51 }));
  let worst = 0;
  for (const s of r.stations) {
    const x = s.x;
    const exact = -(w * 1000 * x * x * (6 * L * L - 4 * L * x + x * x)) / (24 * EI) * 1000;
    worst = Math.max(worst, Math.abs(exact - vAt(r, x).v));
  }
  console.log(`Cantilever + UDL, max |Δδ| = ${worst.toExponential(3)} mm`);
}

console.log("\n--- mesh-refinement consistency (coarse vs 20x refined) ---");
function refine(model, k) {
  const els = [];
  const sup = [];
  for (let i = 0; i < model.nElements; i++) {
    sup.push(model.supports[i]);
    for (let j = 0; j < k; j++) {
      els.push({ ...model.elements[i], id: `R${i}_${j}`, length: model.elements[i].length / k });
      if (j < k - 1) sup.push("Free");
    }
  }
  sup.push(model.supports[model.nElements]);
  return { ...model, nElements: els.length, elements: els, supports: sup };
}
const suite = [
  ["3-span preset", E.simpleThreeSpan()],
  ["12-span example", E.excelExample()],
  ["overhangs + uplift", mk({ lengths: [2, 8, 2], supports: ["Free", "Pinned", "Roller", "Free"], loads: [{ case: "W-", type: "UDL", x1: 0, x2: 12, magnitude: -5 }] })],
  ["partial UDL + point + moment", mk({ lengths: [4, 6], supports: ["Fixed", "Roller", "Roller"], loads: [{ case: "Q1", type: "UDL", x1: 1.3, x2: 7.7, magnitude: 9 }, { case: "Q2", type: "Point", x1: 5.2, magnitude: 14 }, { case: "O", type: "Moment", x1: 8.4, magnitude: 22 }] })],
];
for (const [name, m] of suite) {
  const rc = E.analyze(m);
  const k = Math.max(1, Math.floor(24 / m.nElements));
  const rf = E.analyze(refine(m, k));
  let worstD = 0, worstM = 0, worstV = 0;
  for (let i = 0; i < rc.stations.length; i++) {
    const x = rc.stations[i].x;
    // nearest refined station, matching within 1e-6
    let bi = -1, bd = Infinity;
    rf.stations.forEach((s, j) => { const d = Math.abs(s.x - x); if (d < bd) { bd = d; bi = j; } });
    if (bd > 1e-6) continue;
    worstD = Math.max(worstD, Math.abs(rc.selected.v[i] - rf.selected.v[bi]));
    worstM = Math.max(worstM, Math.abs(rc.selected.M[i] - rf.selected.M[bi]));
    worstV = Math.max(worstV, Math.abs(rc.selected.V[i] - rf.selected.V[bi]));
  }
  const rAgree = rc.reactions.map((r, i) => {
    const match = rf.reactions.find((q) => Math.abs(q.x - r.x) < 1e-9);
    let a = 0, b = 0;
    for (const c of E.LOAD_CASES) { a += r.vertical[c] * (rc.selected.factors[c] ?? 0); b += match ? match.vertical[c] * (rf.selected.factors[c] ?? 0) : 0; }
    return Math.abs(a - b);
  });
  console.log(`${name.padEnd(30)} k=${k} nEl=${rf.nElements} max|Δδ|=${worstD.toExponential(2)} mm  max|ΔM|=${worstM.toExponential(2)} kNm  max|ΔV|=${worstV.toExponential(2)} kN  max|ΔR|=${Math.max(...rAgree).toExponential(2)} kN`);
}

console.log("\n--- extrema sampling error (peak between stations) ---");
for (const n of [13, 26, 51]) {
  const m = mk({ lengths: [8, 8], supports: ["Pinned", "Roller", "Roller"], loads: [{ case: "Q1", type: "UDL", x1: 0, x2: 16, magnitude: 12 }], stations: n });
  const r = E.analyze(m);
  const sag = r.selected.extrema.find((e) => e.label === "Maximum sagging moment");
  const exact = 9 * 12 * 64 / 128;
  console.log(`  stations/el=${String(n).padStart(2)}: reported max sag = ${sag.value.toFixed(4)} kNm at x=${sag.x.toFixed(3)} (exact ${exact.toFixed(4)} at x=3.000) -> ${(100 * (exact - sag.value) / exact).toFixed(3)}% under-reported`);
}
