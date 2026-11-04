// Beam library: the section-property helper, the library bookkeeping, missing-section handling,
// and the Beams tab driven in a headless DOM against a mocked GitHub. Needs engine.js
// (extract-engine.sh) and jsdom.
const fs = require("fs");
const path = require("path");
const E = require("./engine.js");
const { testBeams } = require("./test-beams.js");

let fail = 0;
const ok = (name, cond, extra = "") => {
  if (!cond) fail++;
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${extra ? "  — " + extra : ""}`);
};
const rel = (a, b) => Math.abs(a - b) / Math.max(Math.abs(b), 1e-30);

// ---------------------------------------------------------------------------------------------
// 1. Section helper against an independent integration of the drawn outline (Green's theorem)
// ---------------------------------------------------------------------------------------------
function polygonProps(rings) {
  let A = 0, S = 0, J = 0, minY = Infinity, maxY = -Infinity;
  rings.forEach((ring, k) => {
    let a = 0, s = 0, j = 0;
    for (let i = 0; i < ring.length; i++) {
      const [x0, y0] = ring[i];
      const [x1, y1] = ring[(i + 1) % ring.length];
      const c = x0 * y1 - x1 * y0;
      a += c / 2;
      s += ((y0 + y1) * c) / 6;
      j += ((y0 * y0 + y0 * y1 + y1 * y1) * c) / 12;
      minY = Math.min(minY, y0);
      maxY = Math.max(maxY, y0);
    }
    const sign = Math.sign(a) * (k === 0 ? 1 : -1);
    A += sign * a;
    S += sign * s;
    J += sign * j;
  });
  const yc = S / A;
  const I = J - A * yc * yc;
  return { A, I, yc, Z: I / Math.max(maxY - yc, yc - minY) };
}

let seed = 20261103;
const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const between = (a, b) => a + rnd() * (b - a);
function randomDims(shape) {
  if (shape === "i") { const h = between(80, 600), b = between(50, 300), tw = between(3, 15), tf = between(4, 25); return { h, b, tw, tf, r: between(0, Math.min((b - tw) / 2, (h - 2 * tf) / 2) * 0.9) }; }
  if (shape === "channel") { const h = between(80, 400), b = between(40, 120), tw = between(4, 12), tf = between(6, 18); return { h, b, tw, tf, r: between(0, Math.min(b - tw, (h - 2 * tf) / 2) * 0.9) }; }
  if (shape === "lipped") { const t = between(1, 3), ri = between(0, 2 * t), Ro = ri + t, h = between(60, 300), b = between(2 * Ro + 10, 100); const lipped = rnd() < 0.8; return { h, b, t, ri, c: lipped ? between(Ro, Math.min(40, h / 2)) : 0 }; }
  if (shape === "rhs") { const h = between(30, 300), b = between(30, 300), t = between(1.5, Math.min(h, b) / 5); return { h, b, t, ro: between(0, Math.min(h, b) / 2) }; }
  if (shape === "chs") { const d = between(20, 500); return { d, t: between(1, d / 4) }; }
  return { h: between(10, 300), b: between(5, 200) };
}

{
  let worst = 0, n = 0, problems = 0;
  for (const shape of ["i", "channel", "lipped", "rhs", "chs", "rect"]) {
    for (let k = 0; k < 120; k++) {
      const d = randomDims(shape);
      const r = E.sectionFromShape(shape, d);
      if (!r.ok) { problems++; console.log("  rejected", shape, JSON.stringify(d), r.problems); continue; }
      const p = polygonProps(E.sectionOutline(shape, d, 2048));
      worst = Math.max(worst, rel(r.A, p.A), rel(r.I, p.I), rel(r.Z, p.Z), Math.abs(r.yc - p.yc) / r.h);
      n++;
    }
  }
  ok(`closed-form properties match the integrated outline for ${n} random sections (worst ${worst.toExponential(2)})`, worst < 1e-6 && problems === 0, `${problems} rejected`);
}

// Published nominal values (sections used here only as reference checks of the calculator).
const TABLES = [
  ["rolled I 200x100 (EN 10365 IPE 200)", "i", { h: 200, b: 100, tw: 5.6, tf: 8.5, r: 12 }, { A: 2848, I: 19.43e6, Z: 194.3e3 }],
  ["rolled H 190x200 (EN 10365 HE 200 A)", "i", { h: 190, b: 200, tw: 6.5, tf: 10, r: 18 }, { A: 5383, I: 36.92e6, Z: 388.6e3 }],
  ["rolled H 300x300 (EN 10365 HE 300 B)", "i", { h: 300, b: 300, tw: 11, tf: 19, r: 27 }, { A: 14910, I: 251.7e6, Z: 1678e3 }],
  ["parallel-flange channel 200x80 (UPE 200)", "channel", { h: 200, b: 80, tw: 6, tf: 11, r: 13 }, { A: 2900, I: 19.1e6, Z: 191e3 }],
  ["CHS 48.3x3.2 (EN 10219)", "chs", { d: 48.3, t: 3.2 }, { A: 453, I: 115.9e3, Z: 4.80e3 }],
  ["SHS 100x100x5 cold-formed (EN 10219)", "rhs", { h: 100, b: 100, t: 5, ro: 10 }, { A: 1836, I: 2.71e6, Z: 54.2e3 }],
];
for (const [label, shape, d, ref] of TABLES) {
  const r = E.sectionFromShape(shape, d);
  const worst = Math.max(rel(r.A, ref.A), rel(r.I, ref.I), rel(r.Z, ref.Z));
  ok(`${label}: A, I, Z within 0.2 % of the published table`, worst < 0.002, `A ${r.A.toFixed(1)} I ${r.I.toExponential(4)} Z ${r.Z.toExponential(4)} worst ${(worst * 100).toFixed(3)} %`);
}
{
  const r = E.sectionFromShape("lipped", { h: 150, b: 65, c: 20, t: 2, ri: 2 });
  // Thin-walled centre-line estimate with square corners: within a few percent of the exact value.
  const t = 2, hm = 148, bm = 63, cm = 19;
  const A = t * (hm + 2 * bm + 2 * cm);
  const I = (t * hm ** 3) / 12 + 2 * bm * t * (hm / 2) ** 2 + 2 * ((t * cm ** 3) / 12 + cm * t * (hm / 2 - cm / 2) ** 2);
  ok("lipped C150x65x20x2 agrees with the centre-line estimate", rel(r.A, A) < 0.03 && rel(r.I, I) < 0.03, `A ${r.A.toFixed(1)} vs ${A.toFixed(1)}, I ${r.I.toFixed(0)} vs ${I.toFixed(0)}`);
  ok("Av conventions: I = h·tw, C = h·t, RHS = 2ht, CHS = 2A/π",
    E.sectionFromShape("i", { h: 200, b: 100, tw: 5.6, tf: 8.5, r: 12 }).Av === 1120 &&
    r.Av === 300 &&
    E.sectionFromShape("rhs", { h: 100, b: 50, t: 3, ro: 6 }).Av === 600 &&
    rel(E.sectionFromShape("chs", { d: 60, t: 3 }).Av, (2 * E.sectionFromShape("chs", { d: 60, t: 3 }).A) / Math.PI) < 1e-12);
}
{
  const bad = [
    ["lipped", { h: 150, b: 65, c: 3, t: 2, ri: 2 }, /Lip must be/],
    ["lipped", { h: 150, b: 6, c: 20, t: 2, ri: 2 }, /Flange width/],
    ["lipped", { h: 30, b: 65, c: 20, t: 2, ri: 2 }, /overlap/],
    ["i", { h: 100, b: 100, tw: 6, tf: 50, r: 0 }, /flange thicknesses/],
    ["i", { h: 200, b: 100, tw: 5.6, tf: 8.5 }, /Root radius/],
    ["rhs", { h: 100, b: 50, t: 30, ro: 5 }, /Wall thickness/],
    ["chs", { d: 50, t: 25 }, /Wall thickness/],
    ["rect", { h: -5, b: 10 }, /greater than zero/],
  ];
  const caught = bad.filter(([s, d, re]) => { const r = E.sectionFromShape(s, d); return !r.ok && r.problems.some((p) => re.test(p)); });
  ok(`impossible dimensions are refused with a reason (${caught.length}/${bad.length})`, caught.length === bad.length);
  ok("suggested names", E.suggestBeamName("lipped", { h: 150, b: 65, c: 20, t: 2, ri: 2 }) === "C 150x65x20x2.0" &&
    E.suggestBeamName("rhs", { h: 100, b: 100, t: 5, ro: 10 }) === "SHS 100x100x5.0" &&
    E.suggestBeamName("chs", { d: 48.3, t: 3.2 }) === "CHS 48.3x3.2");
}

// ---------------------------------------------------------------------------------------------
// 2. Library bookkeeping
// ---------------------------------------------------------------------------------------------
{
  const f = E.normaliseBeamFile({
    revision: 4,
    beams: [
      { name: "A1", I: 1e6, Z: 1e4, A: 500, Av: 200, grade: "S355" },
      { name: "a1", I: 2e6, Z: 2e4, A: 600 },
      { name: "Custom", I: 1, Z: 1, A: 1 },
      { name: "", I: 1, Z: 1, A: 1 },
      { name: "Zero", I: 0, Z: 1, A: 1 },
      { name: "Str", I: "3e6", Z: "3e4", A: "700", Av: "300" },
    ],
  });
  ok("beams.json parsing keeps good entries, drops bad and repeated names", f.beams.map((b) => b.name).join() === "A1,Str" && f.skipped === 4 && f.revision === 4);
  ok("unknown fields written by hand survive", f.beams[0].grade === "S355");
  ok("not a library", E.normaliseBeamFile({ foo: 1 }) === null);

  const b = (name, I = 1e6) => E.normaliseBeam({ name, I, Z: 1e4, A: 500, Av: 100 });
  const base = [b("X"), b("Y"), b("Z")];
  const ops = [
    { op: "upsert", beam: b("N") },
    { op: "upsert", from: "Y", beam: b("Y2", 2e6) },
    { op: "delete", name: "Z" },
    { op: "upsert", beam: b("X", 5e6) },
  ];
  const out = E.applyBeamOps(base, ops);
  ok("ops: add, rename in place, delete, replace", out.map((x) => `${x.name}:${x.I}`).join() === "X:5000000,Y2:2000000,N:1000000");
  const d = E.beamDiff(base, out);
  ok("diff names what changed", d.added.join() === "Y2,N" && d.removed.join() === "Y,Z" && d.changed.join() === "X" && d.count === 5);
  const remote = [...base, b("Colleague")];
  const merged = E.applyBeamOps(remote, ops);
  ok("replaying on a newer GitHub copy keeps a colleague's beam", merged.some((x) => x.name === "Colleague") && merged.length === 4);
}

// ---------------------------------------------------------------------------------------------
// 3. Sections that are not in the library
// ---------------------------------------------------------------------------------------------
{
  E.setSectionLibrary([]);
  const legacy = { ...E.simpleThreeSpan(), defaultSection: "IPE 200" };
  legacy.elements = legacy.elements.map((el) => ({ ...el, section: "IPE 200" }));
  const r = E.analyze(legacy);
  ok("a section in neither the library nor the model stops the analysis", r.status === "MISSING SECTION" && !r.stations.length, r.status);
  ok("…and says which one", r.warnings.some((w) => /IPE 200.*not in the beam library/.test(w)));
  const beams = testBeams();
  const def = { ...beams[0] };
  delete def.name;
  const carried = { ...legacy, defaultSection: "TEST C150", elements: legacy.elements.map((el) => ({ ...el, section: "TEST C150" })), sectionDefs: { "TEST C150": def } };
  const r2 = E.analyze(carried);
  E.setSectionLibrary(beams);
  const r3 = E.analyze(carried);
  ok("the model's saved copy is used when the library lacks the beam", r2.status === "OK" && r2.warnings.some((w) => /saved with this model/.test(w)));
  ok("…and gives the same answers as the library entry", JSON.stringify(r2.envelope) === JSON.stringify(r3.envelope) && !r3.warnings.some((w) => /saved with this model/.test(w)));
  const alu = E.analyze({ ...carried, material: "Aluminium" });
  ok("a steel beam in an aluminium model is flagged", alu.warnings.some((w) => /listed as Steel/.test(w)));
  ok("Custom still uses the model's own properties", E.analyze(E.simpleThreeSpan()).sectionAt[0].I === 19430000);
}

// ---------------------------------------------------------------------------------------------
// 4. The Beams tab in a headless DOM, with GitHub mocked
// ---------------------------------------------------------------------------------------------
const { makeGitHub, boot, TOKEN } = require("./dom-harness.js");

const lib0 = { schema: "lumax-cba/beams@1", revision: 3, updated: "2026-11-01T10:00:00Z", beams: testBeams().slice(0, 2) };

(async () => {
  // --- loading -------------------------------------------------------------------------------
  const gh = makeGitHub(lib0);
  let P = boot(gh);
  await P.flush();
  P.tab("beams");
  ok("library loads from beams.json on the live site", P.rows().length === 2 && P.rows().every((r) => /On GitHub/i.test(r.status)), JSON.stringify(P.rows()));
  ok("first request is the same-origin copy", /^beams\.json\?t=/.test(gh.calls[0]?.url || ""), gh.calls[0]?.url);
  ok("status line names the revision", /revision 3/.test(P.$(".beams-grid").textContent));
  ok("library cached for offline use", JSON.parse(P.store("cba-beams-cache-v1")).beams.length === 2);
  P.tab("geometry");
  const opts = P.$$('[data-act="default-section"] option').map((o) => o.value);
  ok("geometry offers Custom plus the library, and no IPE", opts[0] === "Custom" && opts.includes("TEST C150") && !opts.some((o) => /IPE/.test(o)), opts.join(" | "));

  // --- add a beam with the helper -------------------------------------------------------------
  P.click(P.$('[data-act="new-beam"]'));
  ok("Add beam on the Geometry tab opens the form on the Beams tab", !!P.$("#beam-form") && P.$('[data-act="tab"][data-tab="beams"]').classList.contains("active"));
  ok("form starts on the lipped channel", P.$('[data-act="beam-shape"]').value === "lipped");
  const dim = (k) => P.$(`[data-act="beam-dim"][data-field="${k}"]`);
  ok("submit disabled until dimensions are complete", P.$('[data-act="beam-submit"]').disabled);
  P.type(dim("h"), "200"); P.type(dim("b"), "75"); P.type(dim("c"), "3"); P.type(dim("t"), "2.5"); P.type(dim("ri"), "2.5");
  ok("a lip shorter than the bend is explained", /Lip must be at least/.test(P.$("#beam-problems").textContent) && P.$('[data-act="beam-submit"]').disabled);
  const dimNode = dim("h");
  P.type(dim("c"), "20");
  ok("typing does not rebuild the form (the field keeps its node)", dim("h") === dimNode);
  ok("name suggested from the dimensions", P.$('[data-act="beam-text"][data-field="name"]').value === "C 200x75x20x2.5");
  const expect = E.sectionFromShape("lipped", { h: 200, b: 75, c: 20, t: 2.5, ri: 2.5 });
  ok("calculated I shown", P.$("#beam-calc").textContent.includes(Math.round(expect.I).toString()), P.$("#beam-calc").textContent.replace(/\s+/g, " ").slice(0, 160));
  ok("cross-section drawn", !!P.$("#beam-preview path.beam-shape") && P.$("#beam-preview path").getAttribute("d").length > 50);
  P.click(P.$('[data-act="beam-submit"]'));
  let rows = P.rows();
  ok("beam added to the table, marked not on GitHub", rows.some((r) => r.name === "C 200x75x20x2.5" && /Not on GitHub/i.test(r.status)), JSON.stringify(rows));
  ok("tab shows one unsaved change", P.$('[data-tab="beams"] .tab-dot')?.textContent === "1");
  ok("unsaved change kept in this browser", JSON.parse(P.store("cba-beams-pending-v1") || "[]").length === 1);
  const added = JSON.parse(P.store("cba-beams-pending-v1"))[0].beam;
  ok("stored properties are the calculator's (6 significant figures)", rel(added.I, expect.I) < 1e-5 && rel(added.Z, expect.Z) < 1e-5 && added.Av === 500 && added.material === "Steel" && rel(added.mass, expect.A * 7.85e-3) < 1e-3);

  // --- own values, duplicate names ------------------------------------------------------------
  P.click(P.$('[data-act="new-beam"]'));
  P.change(P.$('[data-act="beam-shape"]'), "i");
  P.type(dim("h"), "200"); P.type(dim("b"), "100"); P.type(dim("tw"), "5.6"); P.type(dim("tf"), "8.5"); P.type(dim("r"), "12");
  P.type(P.$('[data-act="beam-text"][data-field="name"]'), "c 200X75x20x2.5".replace("X", "x"));
  ok("a name already in the library is refused (any case)", /already a beam called/.test(P.$("#beam-problems").textContent));
  P.type(P.$('[data-act="beam-text"][data-field="name"]'), "Rolled 200");
  P.change(P.$('[data-act="beam-override"]'), true);
  const prop = (k) => P.$(`[data-act="beam-prop"][data-field="${k}"]`);
  ok("own values start from the calculated ones", prop("I") && rel(Number(prop("I").value), 19431683) < 1e-5, prop("I")?.value);
  P.type(prop("I"), "1943");
  ok("a value far from the calculated one is highlighted (cm⁴ typed as mm⁴)", !!P.$("#beam-calc td.off"));
  P.type(prop("I"), "19430000");
  ok("…and not once it agrees", !P.$("#beam-calc td.off"));
  P.click(P.$('[data-act="beam-submit"]'));
  ok("second beam added", P.rows().some((r) => r.name === "Rolled 200"));

  // --- use it in the model ---------------------------------------------------------------------
  P.click(P.$('[data-act="beam-use"][data-name="Rolled 200"]'));
  ok("Use makes it the default section", /default section Rolled 200/.test(P.$(".meta").textContent));
  const saved = JSON.parse(P.store("cba-model-v1"));
  ok("the model keeps a copy of the beam it uses", saved.sectionDefs && saved.sectionDefs["Rolled 200"]?.I === 19430000 && !("name" in saved.sectionDefs["Rolled 200"]));
  ok("the analysis runs on it", /^OK$/.test(P.$(".header .badge").textContent.trim()), P.$(".header .badge").textContent);

  // --- delete: two clicks; the model keeps its copy ------------------------------------------
  P.tab("beams");
  P.click(P.$('[data-act="beam-delete"][data-name="Rolled 200"]'));
  ok("first click asks for confirmation", /Confirm delete/.test(P.$('[data-act="beam-delete"][data-name="Rolled 200"]').textContent) && P.rows().length === 4);
  P.click(P.$('[data-act="beam-delete"][data-name="Rolled 200"]'));
  ok("second click deletes", !P.rows().some((r) => r.name === "Rolled 200"));
  ok("results unchanged: the model analyses with its saved copy", /^OK$/.test(P.$(".header .badge").textContent.trim()));
  P.tab("qa");
  ok("QA says the saved copy is in use", /not in the beam library; using the properties saved with this model/.test(P.text()));
  P.tab("beams");
  ok("Beams tab offers to put it back in the library", !!P.$('[data-act="beams-from-model"]'));
  P.click(P.$('[data-act="beams-from-model"]'));
  ok("…which restores it", P.rows().some((r) => r.name === "Rolled 200"));

  // delete a beam that is on GitHub, then undo
  P.click(P.$('[data-act="beam-delete"][data-name="TEST C100 plain"]'));
  P.click(P.$('[data-act="beam-delete"][data-name="TEST C100 plain"]'));
  ok("deleted GitHub beam listed with Undo", !!P.$('[data-act="beam-restore"][data-name="TEST C100 plain"]'));
  P.click(P.$('[data-act="beam-restore"][data-name="TEST C100 plain"]'));
  ok("Undo brings it back as it is on GitHub", P.rows().some((r) => r.name === "TEST C100 plain" && /On GitHub/i.test(r.status)));

  // --- paste a supplier's table ---------------------------------------------------------------
  P.click(P.$('[data-act="paste-toggle"]'));
  const area = P.$('[data-act="paste-text"]');
  P.type(area, "Designation\tA (cm2)\tIy (cm4)\tWel,y (cm3)\tAv\nPURLIN 1\t5.87\t203\t27.1\t3.0\nPURLIN 2\t6,10\t225\t29.9\t3.1\nBROKEN\tx\t1\t1\t1");
  P.click(P.$('[data-act="paste-check"]'));
  ok("mm units: tiny values flagged as probably cm", /switch the units to cm/.test(P.$(".beams-grid").textContent));
  P.change(P.$('[data-act="paste-units"]'), "cm");
  ok("bad row reported", /Row 4 \(BROKEN\)/.test(P.$(".beams-grid").textContent));
  P.click(P.$('[data-act="paste-apply"]'));
  const pending = JSON.parse(P.store("cba-beams-pending-v1"));
  const p1 = pending.find((o) => o.beam?.name === "PURLIN 1")?.beam;
  const p2 = pending.find((o) => o.beam?.name === "PURLIN 2")?.beam;
  ok("pasted cm values converted to mm", p1 && p1.A === 587 && p1.I === 2030000 && p1.Z === 27100 && p1.Av === 300, JSON.stringify(p1));
  ok("decimal commas accepted", p2 && p2.A === 610);

  // --- save to GitHub -----------------------------------------------------------------------
  const before = gh.calls.length;
  P.click(P.$('[data-act="beams-save"]'));
  await P.flush();
  ok("no token: asks for one and sends nothing", /Enter a GitHub token/.test(P.$(".beams-grid").textContent) && gh.calls.length === before);
  P.type(P.$('[data-act="gh-token"]'), TOKEN);
  ok("token not stored unless asked", P.store("cba-github-token-v1") === null);
  ok("token not echoed into the page", !P.doc.body.innerHTML.includes(TOKEN));
  // A colleague saved a beam meanwhile, and saves another while our first write is on its way.
  gh.colleagueSaves((f) => {
    f.beams.push(E.normaliseBeam({ name: "COLLEAGUE 1", I: 4e6, Z: 4e4, A: 800, Av: 300, material: "Steel" }));
    f.revision = 4;
  });
  let raceSha = null;
  gh.onPut = (g) => {
    g.colleagueSaves((f) => {
      f.beams.push(E.normaliseBeam({ name: "COLLEAGUE 2", I: 4e6, Z: 4e4, A: 800, Av: 300, material: "Steel" }));
      f.revision = 5;
    });
    raceSha = g.sha;
  };
  P.click(P.$('[data-act="beams-save"]'));
  await P.flush(); await P.flush();
  const gets = gh.calls.filter((c) => c.method === "GET" && c.url.startsWith("https://api.github.com/"));
  const puts = gh.calls.filter((c) => c.method === "PUT");
  ok("a write that races another save is retried after reading again", gets.length === 2 && puts.length === 2, `${gets.length} GET, ${puts.length} PUT`);
  const put = puts[puts.length - 1];
  ok("writes beams.json on main with the current sha", put.url === "https://api.github.com/repos/Lumax-Energy/lumax-cba/contents/beams.json" && put.body.branch === "main" && put.body.sha === raceSha);
  ok("authenticates with the token as a bearer header", put.headers.Authorization === `Bearer ${TOKEN}`);
  const written = gh.file;
  const names = written.beams.map((b) => b.name);
  ok("written file: colleagues' beams kept, ours added, revision bumped", names.includes("COLLEAGUE 1") && names.includes("COLLEAGUE 2") && names.includes("C 200x75x20x2.5") && names.includes("PURLIN 2") && written.revision === 6 && written.schema === "lumax-cba/beams@1", names.join(", "));
  ok("commit message lists the additions", /^Beam library: /.test(put.body.message) && /\+ C 200x75x20x2\.5/.test(put.body.message), put.body.message.split("\n")[0]);
  ok("success reported with a link to the commit", /Saved to GitHub as revision 6/.test(P.$(".beams-grid").textContent) && !!P.$('.beams-grid a[href$="c0ffee"]'));
  ok("nothing left unsaved", !P.$('[data-tab="beams"] .tab-dot') && P.store("cba-beams-pending-v1") === null && P.rows().every((r) => /On GitHub/i.test(r.status)), JSON.stringify(P.rows().filter((r) => !/On GitHub/i.test(r.status))));
  ok("the colleague's beam now shows here too", P.rows().some((r) => r.name === "COLLEAGUE 1"));
  ok("token absent from the saved model and the cache", !P.store("cba-model-v1").includes(TOKEN) && !P.store("cba-beams-cache-v1").includes(TOKEN));

  // A reload straight after saving, before Pages has republished, keeps the newer copy.
  const stale = JSON.parse(JSON.stringify(lib0));
  const gh2 = makeGitHub(stale);
  const P2 = boot(gh2, { "cba-beams-cache-v1": P.store("cba-beams-cache-v1"), "cba-model-v1": P.store("cba-model-v1") });
  await P2.flush();
  P2.tab("beams");
  ok("just after saving, an older beams.json from the live site does not undo the save", P2.rows().some((r) => r.name === "PURLIN 2") && /still publishing revision 6/.test(P2.$(".beams-grid").textContent));

  // --- failures -------------------------------------------------------------------------------
  {
    const g = makeGitHub(lib0);
    const Q = boot(g);
    await Q.flush();
    Q.tab("beams");
    Q.click(Q.$('[data-act="new-beam"]'));
    Q.change(Q.$('[data-act="beam-shape"]'), "chs");
    Q.type(Q.$('[data-act="beam-dim"][data-field="d"]'), "60.3");
    Q.type(Q.$('[data-act="beam-dim"][data-field="t"]'), "3.2");
    Q.click(Q.$('[data-act="beam-submit"]'));
    Q.type(Q.$('[data-act="gh-token"]'), "github_pat_wrong");
    Q.click(Q.$('[data-act="beams-save"]'));
    await Q.flush();
    ok("a rejected token is reported and the edit is kept", /did not accept the token/.test(Q.$(".beams-grid").textContent) && Q.$('[data-tab="beams"] .tab-dot')?.textContent === "1");
    Q.click(Q.$('[data-act="gh-forget"]'));
    Q.change(Q.$('[data-act="gh-remember"]'), true);
    Q.type(Q.$('[data-act="gh-token"]'), TOKEN);
    ok("Remember stores the token", Q.store("cba-github-token-v1") === TOKEN);
    g.rawContent = "{ not json";
    Q.click(Q.$('[data-act="beams-save"]'));
    await Q.flush();
    ok("a broken beams.json on GitHub is not overwritten", /not valid JSON/.test(Q.$(".beams-grid").textContent) && !g.calls.some((c) => c.method === "PUT"));
    g.rawContent = JSON.stringify({ revision: 9, beams: [{ name: "half typed", I: "12e" }] });
    Q.click(Q.$('[data-act="beams-save"]'));
    await Q.flush();
    ok("entries the app cannot read block saving, so they are not dropped", /cannot read/.test(Q.$(".beams-grid").textContent) && !g.calls.some((c) => c.method === "PUT"));
    g.rawContent = null;
    g.file = null; // GitHub answers 404 for a file this browser has seen, and for the repository:
    g.repoVisible = false; // the token cannot see it
    Q.click(Q.$('[data-act="beams-save"]'));
    await Q.flush();
    ok("a 404 for a file this browser has seen is reported as access, not as an empty library", /refused access/.test(Q.$(".beams-grid").textContent) && !g.calls.some((c) => c.method === "PUT") && Q.rows().length === 3, Q.$(".beams-grid").textContent.slice(0, 200));
    // A repository with no beams.json yet: the first save creates it.
    const g0 = makeGitHub(null);
    const Q0 = boot(g0, { "cba-github-token-v1": TOKEN });
    await Q0.flush();
    Q0.tab("beams");
    Q0.click(Q0.$('[data-act="new-beam"]'));
    Q0.change(Q0.$('[data-act="beam-shape"]'), "chs");
    Q0.type(Q0.$('[data-act="beam-dim"][data-field="d"]'), "60.3");
    Q0.type(Q0.$('[data-act="beam-dim"][data-field="t"]'), "3.2");
    Q0.click(Q0.$('[data-act="beam-submit"]'));
    Q0.click(Q0.$('[data-act="beams-save"]'));
    await Q0.flush(); await Q0.flush();
    const put = g0.calls.find((c) => c.method === "PUT");
    ok("first save creates beams.json (no sha)", put && !("sha" in put.body) && g0.file?.beams?.length === 1 && g0.file.beams[0].name === "CHS 60.3x3.2" && g0.file.revision === 1, JSON.stringify(g0.file?.beams?.map((b) => b.name)));
    ok("no runtime errors (first save)", Q0.errors.length === 0, Q0.errors.join("\n"));
    Q.click(Q.$('[data-act="gh-forget"]'));
    ok("Forget removes the stored token", Q.store("cba-github-token-v1") === null && !!Q.$('[data-act="gh-token"]'));
    ok("no runtime errors (failure paths)", Q.errors.length === 0, Q.errors.join("\n"));
  }

  // --- old saved models -------------------------------------------------------------------------
  {
    const old = { ...E.simpleThreeSpan(), defaultSection: "IPE 300" };
    old.elements = old.elements.map((el) => ({ ...el, section: "IPE 300" }));
    const R = boot(makeGitHub(lib0), { "cba-model-v1": JSON.stringify(old) });
    await R.flush();
    ok("a saved model that used an IPE section is stopped, not silently changed", /MISSING SECTION/.test(R.$(".header .badge").textContent));
    R.tab("geometry");
    ok("…and its select shows the missing name", R.$('[data-act="default-section"]').selectedOptions[0]?.textContent === "IPE 300 (missing)");
    R.change(R.$('[data-act="default-section"]'), "TEST C150");
    ok("choosing a library beam fixes it", /^OK$/.test(R.$(".header .badge").textContent.trim()));
  }

  // --- import a colleague's model that carries a beam we don't have -----------------------------
  {
    const S = boot(makeGitHub({ revision: 1, beams: [] }));
    await S.flush();
    const m = { ...E.simpleThreeSpan(), defaultSection: "THEIRS" };
    m.elements = m.elements.map((el) => ({ ...el, section: "THEIRS" }));
    m.sectionDefs = { THEIRS: { shape: "manual", material: "Steel", I: 5e6, Z: 5e4, A: 900, Av: 400 } };
    const file = new S.w.File([JSON.stringify(m)], "m.json", { type: "application/json" });
    const input = S.$("#import-file");
    Object.defineProperty(input, "files", { value: [file] });
    input.dispatchEvent(new S.w.Event("change", { bubbles: true }));
    await S.flush();
    ok("imported model analyses with the beam it carries", /^OK$/.test(S.$(".header .badge").textContent.trim()));
    S.tab("beams");
    S.click(S.$('[data-act="beams-from-model"]'));
    ok("…and the beam can be added to the library from it", S.rows().some((r) => r.name === "THEIRS"));
    S.w.URL.createObjectURL = () => "blob:stub";
    S.w.URL.revokeObjectURL = () => {};
    let exported = null;
    const origCreate = S.w.Blob;
    S.w.Blob = function (parts, opts) { exported = parts.join(""); return new origCreate(parts, opts); };
    S.click(S.$('[data-act="export-json"]'));
    ok("exported model JSON includes the beam definitions", exported && JSON.parse(exported).sectionDefs?.THEIRS?.I === 5e6);
    S.click(S.$('[data-act="beams-download"]'));
    ok("beams.json download has the library", exported && JSON.parse(exported).beams?.[0]?.name === "THEIRS" && JSON.parse(exported).schema === "lumax-cba/beams@1");
    ok("no runtime errors (import/export)", S.errors.length === 0, S.errors.join("\n"));
  }

  ok("no runtime errors (main flow)", P.errors.length === 0 && P2.errors.length === 0, [...P.errors, ...P2.errors].join("\n"));
  console.log(`\n${fail} failures`);
  process.exitCode = fail ? 1 : 0;
})().catch((e) => {
  console.log("THREW", e.stack);
  process.exitCode = 1;
});
