// Regression tests for the independent review of the beam library. Each block reproduces one
// finding as a user would meet it and checks the fixed behaviour. Needs engine.js (run-all.js)
// and jsdom.
const E = require("./engine.js");
const { testBeams } = require("./test-beams.js");
const { makeGitHub, boot, TOKEN } = require("./dom-harness.js");

let fail = 0;
const ok = (name, cond, extra = "") => {
  if (!cond) fail++;
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${extra ? "  — " + extra : ""}`);
};
const rel = (a, b) => Math.abs(a - b) / Math.max(Math.abs(b), 1e-30);
// A rolled 200 mm I beam's properties under any name (consistent: I/Z = h/2).
const b = (name, over = {}) => E.normaliseBeam({ name, A: 2850, I: 19430000, Z: 194300, Av: 1120, h: 200, material: "Steel", ...over });
const raw = (beam) => JSON.parse(JSON.stringify(beam));
const withSection = (m, name, defs) => ({ ...m, defaultSection: name, elements: m.elements.map((el) => ({ ...el, section: name })), ...(defs ? { sectionDefs: defs } : {}) });
const remembered = { "cba-github-token-v1": TOKEN };

// ---------------------------------------------------------------------------------------------
// Engine
// ---------------------------------------------------------------------------------------------
{
  // The status is never decided by searching warning text, which quotes section names.
  E.setSectionLibrary([]);
  const odd = "Bar 50x6 non-positive camber";
  const def = { shape: "manual", material: "Steel", I: 19430000, Z: 194300, A: 2850, Av: 1120 };
  ok("a carried section named '…non-positive…' does not make the geometry invalid", E.analyze(withSection(E.simpleThreeSpan(), odd, { [odd]: def })).status === "OK");
  const alu = b("ALU I ≤ 0.5m", { material: "Aluminium" });
  E.setSectionLibrary([alu]);
  const r = E.analyze(withSection(E.simpleThreeSpan(), alu.name));
  ok("a library beam named 'I ≤ 0…' only gets the material warning", r.status === "OK" && r.warnings.some((w) => /listed as Aluminium/.test(w)), r.status);
  const bad = E.simpleThreeSpan();
  bad.elements[1] = { ...bad.elements[1], length: 0 };
  ok("a zero-length element still makes the geometry invalid", E.analyze(bad).status === "INVALID GEOMETRY");
}
{
  // Suggested names state the thickness exactly.
  ok("t = 0.75 named as 0.75", E.suggestBeamName("lipped", { h: 75, b: 35, c: 10, t: 0.75, ri: 0.75 }) === "C 75x35x10x0.75");
  ok("t = 2 named as 2.0", E.suggestBeamName("lipped", { h: 150, b: 65, c: 20, t: 2, ri: 3 }) === "C 150x65x20x2.0");
  ok("SHS t = 0.75", E.suggestBeamName("rhs", { h: 50, b: 50, t: 0.75, ro: 1.5 }) === "SHS 50x50x0.75");
  ok("CHS 48.3x3.2", E.suggestBeamName("chs", { d: 48.3, t: 3.2 }) === "CHS 48.3x3.2");
}
{
  // A default section that is not found is reported, and its I is unknown rather than 0.
  E.setSectionLibrary([]);
  const m = { ...E.simpleThreeSpan(), defaultSection: "IPE 200" };
  const r = E.analyze(m);
  ok("missing default section: warning, I unknown", r.status === "OK" && r.defaultI === null && r.warnings.some((w) => /default section "IPE 200"/.test(w)), `${r.status} ${r.defaultI}`);
  // A file with no section names at all means Custom, as its selects show.
  const bare = E.simpleThreeSpan();
  delete bare.defaultSection;
  bare.elements = bare.elements.map(({ section, ...el }) => el);
  const r2 = E.analyze(bare);
  ok("no section names: analysed as Custom", r2.status === "OK" && r2.sectionAt.every((s) => s.name === "Custom"), r2.status);
}
{
  // A library beam that differs from the copy saved with the model: library used, visibly.
  const lib = b("C 150", { A: 600, I: 1.2e6, Z: 1.6e4, h: 150 });
  E.setSectionLibrary([lib]);
  const m = withSection(E.simpleThreeSpan(), "C 150", { "C 150": { shape: "manual", material: "Steel", A: 600, I: 2.03e6, Z: 2.7e4, Av: 300 } });
  const r = E.analyze(m);
  ok("library differs from the saved copy: warned, library values used", r.staleSections.join() === "C 150" && r.sectionAt[0].I === 1.2e6 && r.warnings.some((w) => /differ from the copy saved/.test(w) && /I 1200000 vs 2030000/.test(w)), r.warnings.join(" | "));
}
{
  // Physical consistency of section properties.
  const ipe = { A: 2848, I: 19430000, Z: 194300, Av: 1120, h: 200 };
  ok("a real section passes", E.beamPlausibility(ipe).length === 0);
  ok("I misread 1000× too small is caught by I/Z against h", E.beamPlausibility({ ...ipe, I: 19430 }).some((p) => /between h\/2 and h/.test(p)));
  ok("Z² > A·I is caught without h", E.beamPlausibility({ A: 3.2, I: 23.5, Z: 232, Av: 0, h: null }).length === 1);
  ok("Av > A is caught", E.beamPlausibility({ ...ipe, Av: 5000 }).some((p) => /Av is larger/.test(p)));
  ok("materials matched without case", E.matchMaterial("steel") === "Steel" && E.matchMaterial("Aluminum") === "Aluminium" && E.matchMaterial("ALU") === "Aluminium" && E.matchMaterial("Stainless") === null);
  const kept = E.normaliseBeam({ name: "X", I: 1e6, Z: 1e4, A: 500, tags: ["purlin", "roof"], supplier: null, spec: { grade: "S355" } });
  ok("hand-added lists and objects survive normalising", JSON.stringify(kept.tags) === '["purlin","roof"]' && kept.supplier === null && kept.spec.grade === "S355");
}

// ---------------------------------------------------------------------------------------------
// Beams tab (jsdom, GitHub mocked)
// ---------------------------------------------------------------------------------------------
function addManual(P, name, props = {}) {
  const v = { A: 2850, I: 19430000, Z: 194300, Av: 1120, ...props };
  P.click(P.btn("new-beam"));
  P.change(P.$('[data-act="beam-shape"]'), "manual");
  for (const [k, x] of Object.entries(v)) P.type(P.$(`[data-act="beam-prop"][data-field="${k}"]`), String(x));
  P.type(P.$('[data-act="beam-text"][data-field="name"]'), name);
  P.click(P.btn("beam-submit"));
}
const names = (gh) => (gh.file?.beams || []).map((x) => x.name);
const pendingOps = (P) => JSON.parse(P.store("cba-beams-pending-v1") || "[]");
const paste = (P, text, units = "mm") => {
  if (!P.$('[data-act="paste-text"]')) P.click(P.btn("paste-toggle"));
  P.change(P.$('[data-act="paste-units"]'), units);
  P.type(P.$('[data-act="paste-text"]'), text);
  P.click(P.btn("paste-check"));
  return P.w.eval("ui.pasteResult");
};

(async () => {
  const all = [];
  const start = async (file, storage = {}) => {
    const gh = makeGitHub(file);
    const P = boot(gh, storage);
    all.push(P);
    await P.flush();
    P.tab("beams");
    return { gh, P };
  };

  // --- edits made while a save is in flight are kept ------------------------------------------
  {
    const { gh, P } = await start({ revision: 1, beams: [b("ON GH 1"), b("ON GH 2")] }, remembered);
    addManual(P, "FIRST NEW");
    let release;
    gh.hold = new Promise((r) => (release = r));
    P.click(P.btn("beams-save"));
    await P.flush();
    ok("while saving, Discard is disabled and Reload busy", P.btn("beams-discard")?.disabled && P.btn("beams-reload").getAttribute("aria-disabled") === "true");
    addManual(P, "ADDED WHILE SAVING");
    P.click(P.btn("beam-delete", "ON GH 2"));
    P.click(P.btn("beam-delete", "ON GH 2"));
    release();
    gh.hold = null;
    await P.flush(); await P.flush();
    ok("the save wrote what it read", names(gh).join() === "ON GH 1,ON GH 2,FIRST NEW", names(gh).join());
    const rows = P.rows();
    ok("an edit made during the save is still here", rows.some((r) => r.name === "ADDED WHILE SAVING" && /Not on GitHub/.test(r.status)) && !rows.some((r) => r.name === "ON GH 2"), JSON.stringify(rows));
    ok("…and still pending in storage", pendingOps(P).length === 2 && /2 later changes are still to save/.test(P.grid()));
    P.click(P.btn("beams-save"));
    await P.flush(); await P.flush();
    ok("…and saved by the next save", names(gh).join() === "ON GH 1,FIRST NEW,ADDED WHILE SAVING" && pendingOps(P).length === 0, names(gh).join());
  }

  // --- a colleague's change to a beam also edited here is never overwritten silently ---------
  {
    const { gh, P } = await start({ revision: 3, beams: [b("SHARED"), b("TO DELETE")] }, remembered);
    P.click(P.btn("beam-edit", "SHARED"));
    P.type(P.$('[data-act="beam-prop"][data-field="I"]'), "20000000");
    P.click(P.btn("beam-submit"));
    P.click(P.btn("beam-delete", "TO DELETE"));
    P.click(P.btn("beam-delete", "TO DELETE"));
    addManual(P, "NEW X");
    gh.colleagueSaves((f) => {
      f.beams[0].A = 2900;
      f.beams[1].I = 19500000;
      f.beams.push(raw(b("new x", { I: 19000000 })));
      f.revision = 4;
    });
    const before = gh.calls.filter((c) => c.method === "PUT").length;
    P.click(P.btn("beams-save"));
    await P.flush(); await P.flush();
    ok("nothing is written while colleagues' changes clash with ours", gh.calls.filter((c) => c.method === "PUT").length === before && /Not saved/.test(P.grid()));
    const clash = P.$$('[data-act="conflict-mine"]').map((x) => x.getAttribute("data-name")).sort();
    ok("each clashing beam is listed with both versions", clash.join() === "NEW X,SHARED,TO DELETE" && /deleted/.test(P.$(".conflicts").textContent), clash.join());
    ok("saving waits for a choice", P.btn("beams-save").disabled);
    P.click(P.btn("conflict-theirs", "SHARED"));
    P.click(P.btn("conflict-mine", "TO DELETE"));
    P.click(P.btn("conflict-mine", "NEW X"));
    ok("once chosen, saving is possible again", !P.$(".conflicts") && !P.btn("beams-save").disabled);
    P.click(P.btn("beams-save"));
    await P.flush(); await P.flush();
    const shared = gh.file.beams.find((x) => x.name === "SHARED");
    ok("written: their SHARED, our delete, our NEW X replacing their 'new x'", shared?.A === 2900 && shared.I === 19430000 && !names(gh).includes("TO DELETE") && names(gh).includes("NEW X") && !names(gh).includes("new x"), JSON.stringify(gh.file.beams.map((x) => [x.name, x.A, x.I])));
  }

  // --- beams nobody edited, and fields the app does not know, are written back as they were ---
  {
    const file = {
      schema: "lumax-cba/beams@1", revision: 2, units: "mm", maintainer: "structures team",
      beams: [
        { name: "HAND 1", I: 19430000, Z: 194300, A: 2850, material: "Stainless", mass: "22.4 kg/m", tags: ["purlin", "roof"], supplier: null, dims: { h: "200" } },
        { name: "HAND 2", I: 19430000, Z: 194300, A: 2850, material: "steel", grade: "S355", addedBy: "Bob" },
      ],
    };
    const { gh, P } = await start(file, remembered);
    ok("lower-case 'steel' is read as Steel", P.rows().length === 2 && /Steel/.test(P.$(".beam-table").textContent));
    addManual(P, "UNRELATED");
    P.click(P.btn("beams-save"));
    await P.flush(); await P.flush();
    ok("untouched beams written back unchanged", JSON.stringify(gh.file.beams[0]) === JSON.stringify(file.beams[0]) && JSON.stringify(gh.file.beams[1]) === JSON.stringify(file.beams[1]), JSON.stringify(gh.file.beams.slice(0, 2)));
    ok("top-level fields kept", gh.file.units === "mm" && gh.file.maintainer === "structures team" && gh.file.revision === 3);
    // Editing only the notes keeps the hand-added fields and who added it.
    P.click(P.btn("beam-edit", "HAND 2"));
    P.type(P.$('[data-act="beam-text"][data-field="notes"]'), "checked");
    P.click(P.btn("beam-submit"));
    const edited = pendingOps(P).find((o) => o.beam?.name === "HAND 2")?.beam;
    ok("an edit keeps hand-added fields", edited?.grade === "S355" && edited.addedBy === "Bob" && edited.notes === "checked", JSON.stringify(edited));
  }

  // --- a supplier's mass survives an edit of the notes ---------------------------------------
  {
    const dims = { h: 150, b: 65, c: 20, t: 2, ri: 3 };
    const c = E.sectionFromShape("lipped", dims);
    const purlin = { name: "PURLIN 1", shape: "lipped", dims, material: "Steel", A: c.A, I: c.I, Z: c.Z, Av: c.Av, h: c.h, mass: 5.1, source: "Supplier catalogue p.4 (galvanised mass)" };
    const { P } = await start({ revision: 1, beams: [purlin] });
    P.click(P.btn("beam-edit", "PURLIN 1"));
    ok("a beam whose mass differs from the calculation opens with own values", P.$('[data-act="beam-override"]').checked);
    P.type(P.$('[data-act="beam-text"][data-field="notes"]'), "galvanised");
    P.click(P.btn("beam-submit"));
    const edited = pendingOps(P)[0]?.beam;
    ok("…and keeps the supplier's mass", edited?.mass === 5.1 && rel(edited.I, c.I) < 1e-5, JSON.stringify(edited));
  }

  // --- own values follow the dimensions until typed; mass from the area used -------------------
  {
    const { P } = await start({ revision: 1, beams: [] });
    P.click(P.btn("new-beam"));
    const dim = (k) => P.$(`[data-act="beam-dim"][data-field="${k}"]`);
    const prop = (k) => P.$(`[data-act="beam-prop"][data-field="${k}"]`);
    for (const [k, v] of Object.entries({ h: "150", b: "65", c: "20", t: "2.0", ri: "2" })) P.type(dim(k), v);
    P.change(P.$('[data-act="beam-override"]'), true);
    const c2 = E.sectionFromShape("lipped", { h: 150, b: 65, c: 20, t: 2, ri: 2 });
    ok("own values start from the calculation", rel(Number(prop("A").value), c2.A) < 1e-5);
    const c25 = E.sectionFromShape("lipped", { h: 150, b: 65, c: 20, t: 2.5, ri: 2 });
    const supplierI = String(Math.round(c25.I * 0.98));
    P.type(prop("I"), supplierI);
    P.type(dim("t"), "2.5");
    ok("a dimension change updates the values not typed in", rel(Number(prop("A").value), c25.A) < 1e-5 && rel(Number(prop("Z").value), c25.Z) < 1e-5 && rel(Number(prop("mass").value), c25.A * 7.85e-3) < 1e-5);
    ok("…and leaves the typed one alone", prop("I").value === supplierI);
    P.change(P.$('[data-act="beam-material"]'), "Aluminium");
    ok("a material change updates the mass", rel(Number(prop("mass").value), c25.A * 2.7e-3) < 1e-5);
    P.change(P.$('[data-act="beam-material"]'), "Steel");
    P.type(prop("A"), "587");
    ok("a typed area sets the mass", rel(Number(prop("mass").value), 587 * 7.85e-3) < 1e-5, prop("mass").value);
    P.type(prop("Z"), "35,780");
    ok("'35,780' next to fields with decimal points is read as 35780", /35780/.test(P.$("#beam-calc").textContent) && !/could mean/.test(P.$("#beam-problems").textContent));
    P.type(prop("Z"), "");
    P.click(P.btn("beam-submit"));
    const saved = pendingOps(P)[0]?.beam;
    ok("saved with the values shown", saved && saved.name === "C 150x65x20x2.5" && saved.A === 587 && rel(saved.I, Number(supplierI)) < 1e-5 && rel(saved.Z, c25.Z) < 1e-5 && rel(saved.mass, 587 * 7.85e-3) < 1e-3, JSON.stringify(saved));
    // Physically impossible own values are refused (I in cm⁴ against Z in mm³).
    P.click(P.btn("new-beam"));
    P.change(P.$('[data-act="beam-shape"]'), "manual");
    for (const [k, v] of Object.entries({ A: "2850", I: "1943", Z: "194300", Av: "1120", h: "200" })) P.type(prop(k), v);
    P.type(P.$('[data-act="beam-text"][data-field="name"]'), "SLIP");
    ok("own values that cannot belong to one section are refused", /Z is too large/.test(P.$("#beam-problems").textContent) && P.btn("beam-submit").disabled);
    P.click(P.btn("beam-cancel"));
    // Clearing the name while editing never renames the beam to something unseen.
    P.click(P.btn("beam-edit", "C 150x65x20x2.5"));
    P.input(P.$('[data-act="beam-text"][data-field="name"]'), "");
    ok("an emptied name asks for one", /Give the beam a name/.test(P.$("#beam-problems").textContent) && P.btn("beam-submit").disabled);
    P.click(P.btn("beam-cancel"));
    // A new beam with the name cleared is not added under a name the field does not show.
    P.click(P.btn("new-beam"));
    for (const [k, v] of Object.entries({ h: "75", b: "35", c: "10", t: "0.75", ri: "0.75" })) P.type(dim(k), v);
    ok("thickness 0.75 in the suggested name", P.$('[data-act="beam-text"][data-field="name"]').value === "C 75x35x10x0.75");
    P.input(P.$('[data-act="beam-text"][data-field="name"]'), "");
    ok("…cleared: no name until one is typed", P.btn("beam-submit").disabled && P.$('[data-act="beam-text"][data-field="name"]').placeholder === "C 75x35x10x0.75");
    P.click(P.btn("beam-cancel"));
  }

  // --- pasting --------------------------------------------------------------------------------
  {
    const { P } = await start({ revision: 1, beams: [] });
    let r = paste(P, "Designation\tA (cm2)\tIy (cm4)\tWel,y (cm3)\nIPE 200\t28.5\t1,943\t194.3\nIPE 500\t115.5\t48,200\t1,928", "cm");
    const by = (n) => r.beams.find((x) => x.name === n);
    ok("thousands separators read as such when the table uses decimal points", by("IPE 200")?.I === 1.943e7 && by("IPE 500")?.I === 4.82e8 && by("IPE 500")?.Z === 1.928e6 && !r.errors.length, JSON.stringify(r.beams.map((x) => [x.name, x.I, x.Z])) + r.errors.join());
    r = paste(P, "Name\tA\tI\tZ\nX1\t2850\t19,430\t194,300");
    ok("with nothing to tell them apart, '19,430' is refused, not guessed", !r.beams.length && r.errors.some((e) => /could mean 19430 or 19\.430/.test(e)), r.errors.join(" | "));
    r = paste(P, "Name;A;I;Z\nIPE 300;53,81;8.356;557,1", "cm");
    ok("semicolon file with decimal commas: '8.356' is 8356", r.beams[0]?.I === 8.356e7 && rel(r.beams[0].A, 5381) < 1e-9, JSON.stringify(r.beams[0]));
    r = paste(P, 'Name,A,I,Z\n"C 150x65x20, galv",587,2030000,27100\nIPE 300,5381,"83,560,000","557,100"');
    ok("quoted CSV cells keep their commas", r.beams.map((x) => x.name).join("|") === "C 150x65x20, galv|IPE 300" && r.beams[1].I === 83560000 && r.beams[1].Z === 557100, JSON.stringify(r.beams.map((x) => [x.name, x.I, x.Z])) + r.errors.join());
    r = paste(P, "Name\tA\tIx\tZx\tSx\nW200x46.1\t5890\t45500000\t495000\t448000");
    ok("Zx and Sx are not taken for Z; the error says why", !r.beams.length && /Zx, Sx and W are not read as Z/.test(r.errors[0] || ""), r.errors.join());
    r = paste(P, "Name\tW (kg/m)\tA (cm2)\tI (cm4)\tWel (cm3)\tW (pl)\nIPE 220\t26.2\t33.4\t2772\t252\t285", "cm");
    ok("W (weight) and W (pl) ignored, Wel used", r.beams[0]?.Z === 252000 && r.notes.some((n) => /not used: W \(kg\/m\), W \(pl\)/.test(n)), JSON.stringify(r.beams[0]) + r.notes.join());
    r = paste(P, "Name\tA\tI\tZ\td\tMaterial\nIPE 300\t5381\t83560000\t557100\t248.6\taluminium");
    ok("'d' is not read as the depth; 'aluminium' is Aluminium", r.beams[0]?.h === null && r.beams[0].material === "Aluminium", JSON.stringify(r.beams[0]));
    r = paste(P, "Designation\tm\tA\tIx\tZex\th\n203x133x25\t25.1\t3.20\t23.5\t232\t203.2", "mm");
    ok("10³ mm² / 10⁶ mm⁴ / 10³ mm³ tables: refused in mm, with the right hint", !r.beams.length && /switch the units to 10³ mm²/.test(r.unitHint), r.unitHint);
    r = paste(P, "Designation\tm\tA\tIx\tZex\th\n203x133x25\t25.1\t3.20\t23.5\t232\t203.2", "kmm");
    ok("…and read correctly in those units", r.beams[0]?.A === 3200 && r.beams[0].I === 23.5e6 && r.beams[0].Z === 232000 && r.beams[0].mass === 25.1 && !r.errors.length, JSON.stringify(r.beams[0]));
  }

  // --- GitHub's own reasons are shown; a large file is read raw ---------------------------------
  {
    const { gh, P } = await start({ revision: 1, beams: [b("A1")] }, remembered);
    addManual(P, "B1");
    gh.putReplies = [[409, { message: "Repository rule violations found\n\nChanges must be made through a pull request." }]];
    P.click(P.btn("beams-save"));
    await P.flush(); await P.flush();
    const puts = gh.calls.filter((c) => c.method === "PUT").length;
    ok("a refusal that is not a race is not retried, and GitHub's reason is shown", puts === 1 && /Changes must be made through a pull request/.test(P.grid()), `${puts} PUT`);
    gh.big = true;
    P.click(P.btn("beams-save"));
    await P.flush(); await P.flush();
    ok("over 1 MB: the file is fetched raw and the save goes through", gh.calls.some((c) => c.method === "GET" && /raw/.test(c.headers.Accept || "")) && names(gh).includes("B1"), names(gh).join());
  }

  // --- undo, capitals, missing sections ----------------------------------------------------------
  {
    const { P } = await start({ revision: 1, beams: [b("abc")] });
    P.click(P.btn("beam-delete", "abc"));
    P.click(P.btn("beam-delete", "abc"));
    addManual(P, "ABC", { I: 20000000 });
    P.click(P.btn("beam-restore", "abc"));
    ok("Undo refuses to replace a newer beam named in other capitals", P.rows().some((r) => r.name === "ABC") && /Can't undo/.test(P.grid()), JSON.stringify(P.rows()));
  }
  {
    const lib = testBeams();
    const def = { ...lib[0] };
    delete def.name;
    const m = withSection(E.simpleThreeSpan(), lib[0].name.toLowerCase(), { [lib[0].name.toLowerCase()]: def });
    const { P } = await start({ revision: 1, beams: lib }, { "cba-model-v1": JSON.stringify(m) });
    ok("a section differing from a library beam only in capitals is pointed out", !!P.btn("beam-respell") && !P.btn("beams-from-model"));
    P.click(P.btn("beam-respell"));
    ok("…and the model can be pointed at the library's spelling", new RegExp(`default section ${lib[0].name},`).test(P.$(".meta").textContent) && !P.btn("beam-respell"), P.$(".meta").textContent);
  }
  {
    const old = withSection(E.simpleThreeSpan(), "IPE 300");
    const { P } = await start({ revision: 1, beams: testBeams() }, { "cba-model-v1": JSON.stringify(old) });
    ok("a section nobody has is named on the Beams tab", /neither the library nor saved with the model: IPE 300/.test(P.grid()));
    P.click(P.btn("beam-add-named", "IPE 300"));
    ok("…with a button that opens the form under that name", P.$('[data-act="beam-text"][data-field="name"]')?.value === "IPE 300");
  }

  // --- saved copies: kept while unused, not overwritten by a different local entry -------------
  {
    const def = { shape: "manual", material: "Steel", A: 600, I: 2.03e6, Z: 2.7e4, Av: 300 };
    const m = withSection(E.simpleThreeSpan(), "C 150 OLD", { "C 150 OLD": def });
    const { P } = await start({ revision: 1, beams: [b("C 200 LIB")] }, { "cba-model-v1": JSON.stringify(m) });
    P.tab("geometry");
    P.change(P.$('[data-act="default-section"]'), "C 200 LIB");
    const optionsNow = P.$$('[data-act="default-section"] option').map((o) => o.textContent);
    ok("a saved copy stays selectable after switching away", optionsNow.includes("C 150 OLD (saved copy)") && JSON.parse(P.store("cba-model-v1")).sectionDefs["C 150 OLD"]?.I === 2.03e6, optionsNow.join(" | "));
    P.change(P.$('[data-act="default-section"]'), "C 150 OLD");
    ok("…and choosing it again analyses as before", P.badge() === "OK" && /default section C 150 OLD, I = 2030000/.test(P.$(".meta").textContent), P.$(".meta").textContent);
  }
  {
    const { P } = await start({ revision: 1, beams: [b("C 150", { A: 600, I: 1.2e6, Z: 1.6e4, h: 150 })] });
    const m = withSection(E.simpleThreeSpan(), "C 150", { "C 150": { shape: "manual", material: "Steel", A: 600, I: 2.03e6, Z: 2.7e4, Av: 300 } });
    const file = new P.w.File([JSON.stringify(m)], "m.json", { type: "application/json" });
    const input = P.$("#import-file");
    Object.defineProperty(input, "files", { value: [file], configurable: true });
    input.dispatchEvent(new P.w.Event("change", { bubbles: true }));
    await P.flush();
    ok("an imported file keeps its own copy when the local library differs", JSON.parse(P.store("cba-model-v1")).sectionDefs["C 150"].I === 2.03e6);
    P.tab("qa");
    ok("…and the QA tab says the library's values are used", /differ from the copy saved with this model \(I 1200000 vs 2030000/.test(P.text()));
    P.tab("beams");
    P.click(P.btn("sections-accept"));
    ok("accepting the library's values updates the copy", JSON.parse(P.store("cba-model-v1")).sectionDefs["C 150"].I === 1.2e6 && !P.btn("sections-accept"));
  }

  // --- tabs and storage -------------------------------------------------------------------------
  {
    const { P } = await start({ revision: 1, beams: [b("A1")] });
    // Another tab adds a beam: its storage event brings the edit here.
    const op = { op: "upsert", beam: raw(b("FROM TAB 2")), base: null };
    P.w.localStorage.setItem("cba-beams-pending-v1", JSON.stringify([op]));
    P.w.dispatchEvent(new P.w.StorageEvent("storage", { key: "cba-beams-pending-v1" }));
    ok("another tab's unsaved beam appears here", P.rows().some((r) => r.name === "FROM TAB 2"));
    addManual(P, "FROM TAB 1");
    ok("…and this tab's edit is added to it, not written over it", pendingOps(P).map((o) => o.beam?.name).sort().join() === "FROM TAB 1,FROM TAB 2");
    // A library reload does not write this tab's (older) model over another tab's newer one.
    const newer = JSON.parse(P.w.eval("JSON.stringify(model)"));
    newer.elements[0].description = "TAB A NEWER WORK";
    P.w.localStorage.setItem("cba-model-v1", JSON.stringify(newer));
    P.click(P.btn("beams-reload"));
    await P.flush();
    ok("a library reload leaves the saved model alone", JSON.parse(P.store("cba-model-v1")).elements[0].description === "TAB A NEWER WORK");
  }

  // --- focus, keyboard, screen readers ----------------------------------------------------------
  {
    const { gh, P } = await start({ revision: 1, beams: [b("P1"), b("P2")] });
    ok("row buttons name their beam", P.btn("beam-edit", "P1").getAttribute("aria-label") === "Edit P1" && P.btn("beam-delete", "P2").getAttribute("aria-label") === "Delete P2");
    P.btn("beam-use", "P1").focus();
    P.click(P.btn("beam-use", "P1"));
    ok("after Use, focus moves to the row's Edit", P.doc.activeElement === P.btn("beam-edit", "P1"), P.doc.activeElement?.outerHTML?.slice(0, 80));
    P.btn("beam-delete", "P2").focus();
    P.click(P.btn("beam-delete", "P2"));
    P.click(P.doc.body);
    ok("a click elsewhere cancels the delete confirmation", P.btn("beam-delete", "P2").textContent === "Delete");
    P.click(P.btn("beam-delete", "P2"));
    P.click(P.btn("beam-delete", "P2"));
    ok("after a delete, focus moves to Add beam", P.doc.activeElement === P.btn("new-beam") && !P.rows().some((r) => r.name === "P2"));
    ok("the result is announced in the page's live region", /P2 deleted in this browser/.test(P.$("#sr-status").textContent) && !P.$('.beams-grid [role="status"]'));
    // The problems list is only rewritten when it changes.
    P.click(P.btn("new-beam"));
    const list = P.$("#beam-problems");
    let rewrites = 0;
    new P.w.MutationObserver((ms) => (rewrites += ms.length)).observe(list, { childList: true });
    for (const v of ["a", "ab", "abc"]) P.type(P.$('[data-act="beam-text"][data-field="notes"]'), v);
    await P.flush();
    ok("typing that changes no message leaves the problems list alone", rewrites === 0 && list.children.length > 0, `${rewrites} rewrites`);
    P.click(P.btn("beam-cancel"));
    // Pasting a token: its change event does not rebuild the page, so the click that caused it lands.
    addManual(P, "P3");
    const save = P.btn("beams-save");
    const field = P.$('[data-act="gh-token"]');
    P.input(field, TOKEN);
    field.dispatchEvent(new P.w.Event("change", { bubbles: true }));
    ok("committing the token keeps the Save button in place", P.btn("beams-save") === save);
    // A save finishing while a field is being typed in keeps the field and its text.
    let release;
    gh.hold = new Promise((r) => (release = r));
    P.click(save);
    await P.flush();
    P.tab("geometry");
    const len = P.$('[data-act="element"][data-field="length"]');
    len.focus();
    len.value = "7.5";
    release();
    gh.hold = null;
    await P.flush(); await P.flush();
    ok("a save finishing does not take the field being typed in", P.doc.activeElement === len && len.value === "7.5" && len.isConnected);
    len.blur();
    await P.flush();
    ok("…and the page catches up once the field is left", names(gh).includes("P3") && P.$$('[data-tab="beams"] .tab-dot').length === 0);
  }

  for (const P of all) if (P.errors.length) ok("no runtime errors", false, P.errors.join("\n"));
  ok("no runtime errors in any page", all.every((P) => !P.errors.length));
  console.log(`\n${fail} failures`);
  process.exitCode = fail ? 1 : 0;
})().catch((e) => {
  console.log("THREW", e.stack);
  process.exitCode = 1;
});
