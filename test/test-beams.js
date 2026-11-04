// A small beam library for the tests. The app ships with an empty library (beams live in
// beams.json on GitHub), so the tests build their own from the section calculator.
const E = require("./engine.js");

const SPECS = [
  ["TEST C150", "lipped", { h: 150, b: 65, c: 20, t: 2, ri: 2 }],
  ["TEST C100 plain", "lipped", { h: 100, b: 50, c: 0, t: 1.6, ri: 1.6 }],
  ["TEST RHS 100x50x3", "rhs", { h: 100, b: 50, t: 3, ro: 6 }],
  ["TEST I 300", "i", { h: 300, b: 150, tw: 7.1, tf: 10.7, r: 15 }],
  ["TEST PFC 200", "channel", { h: 200, b: 80, tw: 6, tf: 11, r: 13 }],
  ["TEST CHS 60", "chs", { d: 60.3, t: 3.2 }],
  ["TEST BAR 80x10", "rect", { h: 80, b: 10 }],
];

function testBeams() {
  return SPECS.map(([name, shape, dims]) => {
    const r = E.sectionFromShape(shape, dims);
    if (!r.ok) throw new Error(`${name}: ${r.problems.join(" ")}`);
    return E.normaliseBeam({ name, shape, dims, material: "Steel", h: r.h, mass: r.A * 7.85e-3, A: r.A, I: r.I, Z: r.Z, Av: r.Av, source: "test" });
  });
}

module.exports = { testBeams };
