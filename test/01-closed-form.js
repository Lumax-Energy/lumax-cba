const E = require("./engine.js");

// ---- model builder -------------------------------------------------------
function mk({ lengths, supports, loads, I = 1e8, Z = 1e6, A = 1e4, Av = 1e4, sw = false, stations = 51, mat = "Steel" }) {
  const elements = lengths.map((L, i) => ({ id: `E${i}`, description: `E${i + 1}`, length: L, section: "Custom" }));
  const all = E.emptyLoads();
  loads.forEach((l, i) => { all[i] = { id: `L${i}`, active: true, description: "", ...l }; });
  return {
    nElements: lengths.length, material: mat, customE: 200000, customDensity: 7850,
    defaultSection: "Custom", customI: I, customZ: Z, customA: A, customAv: Av,
    includeSelfWeight: sw, stationsPerElement: stations, deflectionLimitN: 250,
    elements, supports, loads: all,
    combinations: [{ id: "u", name: "unit", class: "User", factors: { G: 1, Q1: 1, Q2: 1, "W+": 1, "W-": 1, O: 1 } , notes:""}],
    selectedComboId: "u",
  };
}

let fails = 0, passes = 0;
function chk(name, got, want, tol) {
  const ok = Math.abs(got - want) <= tol;
  if (ok) passes++; else fails++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name.padEnd(52)} got ${got.toExponential(6)}  want ${want.toExponential(6)}`);
}
function at(r, x) {  // station nearest x (interior preference)
  let best = r.stations[0], bd = Infinity, bi = 0;
  r.stations.forEach((s, i) => { const d = Math.abs(s.x - x); if (d < bd) { bd = d; best = s; bi = i; } });
  return { V: r.selected.V[bi], M: r.selected.M[bi], v: r.selected.v[bi], x: best.x };
}
function maxAbs(arr) { return arr.reduce((a, b) => Math.abs(b) > Math.abs(a) ? b : a, 0); }

const Emod = 200000e6; // Pa
const Ival = 1e8 * 1e-12; // m^4
const EI = Emod * Ival;  // N m^2

console.log("\n=== 1. Simply supported, L=10, UDL 10 kN/m ===");
{
  const r = E.analyze(mk({ lengths: [10], supports: ["Pinned", "Roller"],
    loads: [{ case: "Q1", type: "UDL", x1: 0, x2: 10, magnitude: 10 }] }));
  console.log("status", r.status);
  chk("R_left (kN)", r.reactions[0].vertical.Q1, 50, 1e-6);
  chk("R_right (kN)", r.reactions[1].vertical.Q1, 50, 1e-6);
  chk("M mid (kNm)", at(r, 5).M, 125, 1e-6);
  chk("V at 0+ (kN)", at(r, 0).V, 50, 1e-6);
  chk("delta mid (mm)", at(r, 5).v, -(5 * 10000 * 10 ** 4) / (384 * EI) * 1000, 1e-6);
}

console.log("\n=== 2. Cantilever fixed-left, tip point load 10 kN, L=5 ===");
{
  const r = E.analyze(mk({ lengths: [5], supports: ["Fixed", "Free"],
    loads: [{ case: "Q1", type: "Point", x1: 5, magnitude: 10 }] }));
  console.log("status", r.status);
  chk("R_vert (kN)", r.reactions[0].vertical.Q1, 10, 1e-6);
  chk("R_moment (kNm)", r.reactions[0].moment.Q1, 50, 1e-6);
  chk("M at fix (kNm)", at(r, 0).M, -50, 1e-6);
  chk("delta tip (mm)", at(r, 5).v, -(10000 * 125) / (3 * EI) * 1000, 1e-6);
}

console.log("\n=== 3. Cantilever fixed-left, full UDL 10 kN/m, L=5 ===");
{
  const r = E.analyze(mk({ lengths: [5], supports: ["Fixed", "Free"],
    loads: [{ case: "Q1", type: "UDL", x1: 0, x2: 5, magnitude: 10 }] }));
  chk("R_vert (kN)", r.reactions[0].vertical.Q1, 50, 1e-6);
  chk("M at fix (kNm)", at(r, 0).M, -125, 1e-6);
  chk("delta tip (mm)", at(r, 5).v, -(10000 * 5 ** 4) / (8 * EI) * 1000, 1e-6);
}

console.log("\n=== 4. Two equal spans L=8, UDL 12 kN/m ===");
{
  const L = 8, w = 12;
  const r = E.analyze(mk({ lengths: [L, L], supports: ["Pinned", "Roller", "Roller"],
    loads: [{ case: "Q1", type: "UDL", x1: 0, x2: 2 * L, magnitude: w }] }));
  chk("R_end (kN)", r.reactions[0].vertical.Q1, 3 * w * L / 8, 1e-6);
  chk("R_mid (kN)", r.reactions[1].vertical.Q1, 10 * w * L / 8, 1e-6);
  chk("M over support (kNm)", at(r, L).M, -w * L * L / 8, 1e-6);
  chk("M max sag (kNm)", maxAbs(r.selected.M.filter(m => m > 0)), 9 * w * L * L / 128, 1e-3);
}

console.log("\n=== 5. Propped cantilever fixed-pinned L=6, UDL 9 kN/m ===");
{
  const L = 6, w = 9;
  const r = E.analyze(mk({ lengths: [L], supports: ["Fixed", "Roller"],
    loads: [{ case: "Q1", type: "UDL", x1: 0, x2: L, magnitude: w }] }));
  chk("R_fixed (kN)", r.reactions[0].vertical.Q1, 5 * w * L / 8, 1e-6);
  chk("R_prop (kN)", r.reactions[1].vertical.Q1, 3 * w * L / 8, 1e-6);
  chk("M at fix (kNm)", at(r, 0).M, -w * L * L / 8, 1e-6);
}

console.log("\n=== 6. Simply supported L=10, point load 20 kN at 3 m ===");
{
  const L = 10, P = 20, a = 3, b = 7;
  const r = E.analyze(mk({ lengths: [10], supports: ["Pinned", "Roller"],
    loads: [{ case: "Q1", type: "Point", x1: a, magnitude: P }] }));
  chk("R_left (kN)", r.reactions[0].vertical.Q1, P * b / L, 1e-6);
  chk("R_right (kN)", r.reactions[1].vertical.Q1, P * a / L, 1e-6);
  chk("M under load (kNm)", at(r, a).M, P * a * b / L, 1e-6);
  chk("delta under load (mm)", at(r, a).v, -(P * 1000 * a * a * b * b) / (3 * EI * L) * 1000, 1e-6);
}

console.log("\n=== 7. Simply supported L=10, point load at 3 m, TWO elements split at 5 m ===");
{
  const L = 10, P = 20, a = 3, b = 7;
  const r = E.analyze(mk({ lengths: [5, 5], supports: ["Pinned", "Free", "Roller"],
    loads: [{ case: "Q1", type: "Point", x1: a, magnitude: P }] }));
  chk("R_left (kN)", r.reactions[0].vertical.Q1, P * b / L, 1e-6);
  chk("M under load (kNm)", at(r, a).M, P * a * b / L, 1e-6);
  chk("delta under load (mm)", at(r, a).v, -(P * 1000 * a * a * b * b) / (3 * EI * L) * 1000, 1e-6);
}

console.log("\n=== 8. Simply supported L=10, CCW moment 40 kNm at 4 m ===");
{
  const L = 10, M0 = 40, a = 4;
  const r = E.analyze(mk({ lengths: [10], supports: ["Pinned", "Roller"],
    loads: [{ case: "Q1", type: "Moment", x1: a, magnitude: M0 }] }));
  console.log("  reactions:", r.reactions.map(x => x.vertical.Q1));
  console.log("  M just left of a:", at(r, a - 1e-7).M, " just right:", r.selected.M[r.stations.findIndex(s => s.x > a + 1e-9)]);
  // For CCW applied moment M0 at a on simply supported beam (y up, x right):
  // Sum moments: R_left = -M0/L? check equilibrium of external moments.
  chk("sum of reactions = 0 (kN)", r.reactions[0].vertical.Q1 + r.reactions[1].vertical.Q1, 0, 1e-9);
}

console.log("\n=== 9. Partial UDL: SS L=10, w=10 kN/m over x=2..6 ===");
{
  const L = 10, w = 10, a = 2, b = 6;
  const W = w * (b - a), xc = (a + b) / 2;
  const r = E.analyze(mk({ lengths: [10], supports: ["Pinned", "Roller"],
    loads: [{ case: "Q1", type: "UDL", x1: a, x2: b, magnitude: w }] }));
  chk("R_left (kN)", r.reactions[0].vertical.Q1, W * (L - xc) / L, 1e-6);
  chk("R_right (kN)", r.reactions[1].vertical.Q1, W * xc / L, 1e-6);
  const Rl = W * (L - xc) / L;
  chk("M at 6 m (kNm)", at(r, 6).M, Rl * 6 - W * (6 - xc), 1e-6);
}

console.log("\n=== 10. Self-weight: SS L=10, IPE200-ish A=2850 mm2 ===");
{
  const A = 2850;
  const wsw = 7850 * A * 1e-6 * 9.80665 / 1000; // kN/m
  const r = E.analyze(mk({ lengths: [10], supports: ["Pinned", "Roller"], loads: [], A, sw: true }));
  chk("R_left self weight (kN)", r.reactions[0].vertical.G, wsw * 10 / 2, 1e-9);
  chk("M mid self weight (kNm)", at(r, 5).M, wsw * 100 / 8, 1e-9);
}

console.log("\n=== 11. Overhang: 0-2 free end, supports at 2 and 10, UDL 10 over whole ===");
{
  const r = E.analyze(mk({ lengths: [2, 8], supports: ["Free", "Pinned", "Roller"],
    loads: [{ case: "Q1", type: "UDL", x1: 0, x2: 10, magnitude: 10 }] }));
  chk("M at support 1 (kNm)", at(r, 2).M, -10 * 4 / 2, 1e-6);
  chk("sum reactions (kN)", r.reactions.reduce((s, x) => s + x.vertical.Q1, 0), 100, 1e-6);
}

console.log("\n=== 12. Equilibrium / continuity QA on presets ===");
for (const [n, m] of [["3-span", E.simpleThreeSpan()], ["12-span example", E.excelExample()]]) {
  const r = E.analyze(m);
  const eqBad = r.equilibrium.filter(e => !e.ok);
  const ctBad = r.continuity.filter(c => !c.ok);
  console.log(`${n}: status=${r.status} equilibriumFails=${eqBad.length} continuityFails=${ctBad.length} maxContDiff=${Math.max(...r.continuity.map(c => Math.abs(c.diffMm))).toExponential(3)}`);
  if (eqBad.length) { fails++; console.log("   ", eqBad); } else passes++;
}

console.log(`\n${passes} passed, ${fails} failed`);
