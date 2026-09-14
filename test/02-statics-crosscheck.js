const E = require("./engine.js");
const G = 9.80665;

// Independent statics: V and M at a cut, evaluated as a one-sided limit.
// side = -1 -> left limit (exclude anything exactly at x), +1 -> right limit (include it).
function statics(model, r, x, side) {
  const f = r.selected.factors;
  const fac = (c) => f[c] ?? 0;
  const inc = (xi) => (side > 0 ? xi < x + 1e-9 : xi < x - 1e-9);
  let V = 0, M = 0;
  for (const rc of r.reactions) {
    if (!inc(rc.x)) continue;
    let Rv = 0, Rm = 0;
    for (const c of E.LOAD_CASES) { Rv += rc.vertical[c] * fac(c); Rm += rc.moment[c] * fac(c); }
    V += Rv; M += Rv * (x - rc.x) - Rm;
  }
  for (const ld of model.loads) {
    if (!ld.active || !Number.isFinite(ld.magnitude) || ld.magnitude === 0) continue;
    const g = fac(ld.case); if (g === 0) continue;
    const mag = ld.magnitude * g;
    if (ld.type === "Point") { if (inc(ld.x1)) { V -= mag; M -= mag * (x - ld.x1); } }
    else if (ld.type === "Moment") { if (inc(ld.x1)) M -= mag; }
    else {
      const a = Math.max(0, Math.min(ld.x1, r.totalLength));
      const b = Math.max(0, Math.min(ld.x2, r.totalLength));
      const bb = Math.min(b, x);
      if (bb > a) { const W = mag * (bb - a); V -= W; M -= W * (x - (a + bb) / 2); }
    }
  }
  if (model.includeSelfWeight) {
    const g = fac("G");
    if (g !== 0) for (let e = 0; e < r.nElements; e++) {
      const a = r.nodeX[e], bb = Math.min(r.nodeX[e + 1], x);
      if (bb > a) {
        const w = r.density * r.sectionAt[e].A * 1e-6 * G / 1000 * g;
        const W = w * (bb - a); V -= W; M -= W * (x - (a + bb) / 2);
      }
    }
  }
  return { V, M };
}

function check(model, label, opts = {}) {
  const r = E.analyze(model);
  if (r.status !== "OK") { if (!opts.quiet) console.log(`${label}: ${r.status} (skipped)`); return null; }
  const sV = Math.max(1e-9, ...r.selected.V.map(Math.abs));
  const sM = Math.max(1e-9, ...r.selected.M.map(Math.abs));
  let wV = 0, wM = 0, xV = 0, xM = 0;
  for (let i = 0; i < r.stations.length; i++) {
    const x = r.stations[i].x;
    const L = statics(model, r, x, -1), R = statics(model, r, x, +1);
    const dV = Math.min(Math.abs(L.V - r.selected.V[i]), Math.abs(R.V - r.selected.V[i]));
    const dM = Math.min(Math.abs(L.M - r.selected.M[i]), Math.abs(R.M - r.selected.M[i]));
    if (dV > wV) { wV = dV; xV = x; }
    if (dM > wM) { wM = dM; xM = x; }
  }
  const out = { relV: wV / sV, relM: wM / sM, xV, xM, r };
  if (!opts.quiet) console.log(`${label.padEnd(34)} maxΔV=${(out.relV * 100).toFixed(8)}% @x=${xV.toFixed(3)}   maxΔM=${(out.relM * 100).toFixed(8)}% @x=${xM.toFixed(3)}`);
  return out;
}

// does the model show BOTH sides of each internal discontinuity?
function jumpCoverage(model, label) {
  const r = E.analyze(model);
  if (r.status !== "OK") return;
  const msgs = [];
  for (const ld of model.loads) {
    if (!ld.active || !ld.magnitude) continue;
    if (ld.type === "UDL") continue;
    const x = ld.x1;
    if (x <= 1e-9 || x >= r.totalLength - 1e-9) { /* end nodes */ }
    const L = statics(model, r, x, -1), R = statics(model, r, x, +1);
    const key = ld.type === "Moment" ? "M" : "V";
    const vals = r.stations.map((s, i) => ({ x: s.x, V: r.selected.V[i], M: r.selected.M[i] })).filter((s) => Math.abs(s.x - x) < 1e-7);
    const hasL = vals.some((s) => Math.abs(s[key] - L[key]) < 1e-6 * (1 + Math.abs(L[key])));
    const hasR = vals.some((s) => Math.abs(s[key] - R[key]) < 1e-6 * (1 + Math.abs(R[key])));
    if (!(hasL && hasR)) msgs.push(`  ${ld.type} at x=${x}: stations=${vals.length} leftLimit${hasL ? "✓" : "✗"} rightLimit${hasR ? "✓" : "✗"}  (L=${L[key].toFixed(4)}, R=${R[key].toFixed(4)}, got=${vals.map((v) => v[key].toFixed(4)).join("/")})`);
  }
  if (msgs.length) { console.log(`${label}: discontinuity coverage gaps`); msgs.forEach((m) => console.log(m)); }
}

function mk({ lengths, supports, loads, I = 1e8, Z = 1e6, A = 1e4, Av = 1e4, sw = false, stations = 26 }) {
  const elements = lengths.map((L, i) => ({ id: `E${i}`, description: `E${i + 1}`, length: L, section: "Custom" }));
  const all = E.emptyLoads();
  loads.forEach((l, i) => { all[i] = { id: `L${i}`, active: true, description: "", x2: 0, ...l }; });
  return {
    nElements: lengths.length, material: "Steel", customE: 200000, customDensity: 7850,
    defaultSection: "Custom", customI: I, customZ: Z, customA: A, customAv: Av,
    includeSelfWeight: sw, stationsPerElement: stations, deflectionLimitN: 250,
    elements, supports, loads: all,
    combinations: [{ id: "u", name: "unit", class: "User", notes: "", factors: { G: 1, Q1: 1, Q2: 1, "W+": 1, "W-": 1, O: 1 } }],
    selectedComboId: "u",
  };
}

console.log("--- station values vs independent statics (min of the two one-sided limits) ---");
const cases = [
  ["point load at interior node", mk({ lengths: [5, 5], supports: ["Pinned", "Free", "Roller"], loads: [{ case: "Q1", type: "Point", x1: 5, magnitude: 20 }] })],
  ["point load at x=0 (free end)", mk({ lengths: [5], supports: ["Free", "Fixed"], loads: [{ case: "Q1", type: "Point", x1: 0, magnitude: 10 }] })],
  ["moment at x=0 (support)", mk({ lengths: [6], supports: ["Pinned", "Roller"], loads: [{ case: "Q1", type: "Moment", x1: 0, magnitude: 30 }] })],
  ["moment mid-span", mk({ lengths: [6], supports: ["Pinned", "Roller"], loads: [{ case: "Q1", type: "Moment", x1: 2.5, magnitude: 30 }] })],
  ["interior fixed support", mk({ lengths: [4, 4, 4], supports: ["Pinned", "Fixed", "Free", "Roller"], loads: [{ case: "Q1", type: "UDL", x1: 0, x2: 12, magnitude: 8 }] })],
  ["uplift UDL with overhangs", mk({ lengths: [2, 8, 2], supports: ["Free", "Pinned", "Roller", "Free"], loads: [{ case: "W-", type: "UDL", x1: 0, x2: 12, magnitude: -5 }] })],
  ["fixed-fixed partial UDL", mk({ lengths: [3, 3], supports: ["Fixed", "Free", "Fixed"], loads: [{ case: "Q1", type: "UDL", x1: 1, x2: 5, magnitude: 12 }] })],
  ["preset 3-span", E.simpleThreeSpan()],
  ["preset 12-span example", E.excelExample()],
];
for (const [n, m] of cases) check(m, n);

console.log("\n--- discontinuity coverage (are both faces reported?) ---");
for (const [n, m] of cases) jumpCoverage(m, n);
jumpCoverage(mk({ lengths: [10], supports: ["Pinned", "Roller"], loads: [{ case: "Q1", type: "Point", x1: 5, magnitude: 20 }] }), "point at mid of single element");
jumpCoverage(mk({ lengths: [10], supports: ["Pinned", "Roller"], loads: [{ case: "Q1", type: "Point", x1: 10, magnitude: 20 }] }), "point at x=L");

console.log("\n--- randomised sweep (500 models) ---");
let s = 987654321;
const rnd = () => ((s = (s * 1103515245 + 12345) % 2147483648) / 2147483648);
let worst = { V: 0, M: 0 }, bad = [];
for (let t = 0; t < 500; t++) {
  const n = 1 + Math.floor(rnd() * 6);
  const lengths = Array.from({ length: n }, () => 1 + rnd() * 6);
  const total = lengths.reduce((a, b) => a + b, 0);
  const supports = Array.from({ length: n + 1 }, () => { const p = rnd(); return p < 0.2 ? "Free" : p < 0.5 ? "Pinned" : p < 0.8 ? "Roller" : "Fixed"; });
  if (!(supports.filter((x) => x !== "Free").length >= 2 || supports.includes("Fixed"))) supports[0] = "Fixed";
  const loads = [];
  for (let i = 0, nl = 1 + Math.floor(rnd() * 4); i < nl; i++) {
    const p = rnd(); const cse = ["G", "Q1", "Q2", "W+", "W-", "O"][Math.floor(rnd() * 6)];
    if (p < 0.4) loads.push({ case: cse, type: "Point", x1: rnd() * total, magnitude: (rnd() - 0.3) * 30 });
    else if (p < 0.6) loads.push({ case: cse, type: "Moment", x1: rnd() * total, magnitude: (rnd() - 0.5) * 40 });
    else { const a = rnd() * total; const b = Math.min(total, a + rnd() * (total - a) + 1e-3); loads.push({ case: cse, type: "UDL", x1: a, x2: b, magnitude: (rnd() - 0.3) * 20 }); }
  }
  const m = mk({ lengths, supports, loads, sw: rnd() < 0.5, A: 2000 + rnd() * 8000 });
  const o = check(m, "", { quiet: true });
  if (!o) continue;
  if (o.relV > worst.V) worst.V = o.relV;
  if (o.relM > worst.M) worst.M = o.relM;
  if (o.relV > 1e-6 || o.relM > 1e-6) bad.push({ relV: o.relV, relM: o.relM, xV: o.xV, xM: o.xM, lengths, supports, loads });
}
console.log(`worst relative ΔV = ${(worst.V * 100).toExponential(3)}%   worst relative ΔM = ${(worst.M * 100).toExponential(3)}%   models over 1e-6: ${bad.length}`);
bad.slice(0, 5).forEach((b) => console.log("  ", JSON.stringify(b).slice(0, 400)));
