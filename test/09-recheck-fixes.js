// Regression tests for the second review of the beam library, which re-ran the first review's
// reproductions against the fixes and looked for defects the fixes introduced. Each block
// reproduces one finding and checks the fixed behaviour. Needs engine.js (run-all.js) and jsdom.
const E = require("./engine.js");
const { makeGitHub, boot, TOKEN } = require("./dom-harness.js");

let fail = 0;
const ok = (name, cond, extra = "") => {
  if (!cond) fail++;
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${extra ? "  — " + extra : ""}`);
};
const rel = (a, b) => Math.abs(a - b) / Math.max(Math.abs(b), 1e-30);
const b = (name, over = {}) => E.normaliseBeam({ name, A: 2850, I: 19430000, Z: 194300, Av: 1120, h: 200, material: "Steel", ...over });
const raw = (beam) => JSON.parse(JSON.stringify(beam));
const withSection = (m, name, defs) => ({ ...m, defaultSection: name, elements: m.elements.map((el) => ({ ...el, section: name })), ...(defs ? { sectionDefs: defs } : {}) });
const remembered = { "cba-github-token-v1": TOKEN };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------------------------
// Engine
// ---------------------------------------------------------------------------------------------
{
  const P = E.beamPlausibility;
  ok("real sections pass both bounds", [
    { A: 5381, I: 83560000, Z: 557100, h: 300 }, // IPE 300
    { A: 1000, I: 833333, Z: 16667, h: 100 }, // bar 100x10
    { A: 453, I: 116000, Z: 4800, h: 48.3 }, // CHS 48.3x3.2
    { A: 1963.5, I: 306796, Z: 12272, h: 50 }, // round bar 50
  ].every((s) => P(s).length === 0));
  ok("a cm table read as 10³ mm²/10⁶ mm⁴ is caught: A·I far above Z²", P({ A: 53810, I: 8.356e9, Z: 557100 }).some((p) => /too large for this Z/.test(p)));
  ok("a mass that matches A passes", P({ A: 2848, I: 19430000, Z: 194300, h: 200, mass: 22.4, material: "Steel" }).length === 0);
  ok("a mass that does not match A is caught", P({ A: 28.48, I: 1943, Z: 194.3, mass: 22.4, material: "Steel" }).some((p) => /does not match A/.test(p)));
  E.setSectionLibrary([]);
  ok("'custom' in any capitals is the model's own section", E.analyze(withSection(E.simpleThreeSpan(), "custom")).status === "OK" && E.analyze(withSection(E.simpleThreeSpan(), " CUSTOM ")).status === "OK");
  ok("a delete finds a beam re-capitalised since", E.applyBeamOps([b("ABC"), b("KEEP")], [{ op: "delete", name: "abc" }]).map((x) => x.name).join() === "KEEP");
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
const storedModel = (P) => JSON.parse(P.store("cba-model-v1") || "null");
const paste = (P, text, units = "mm") => {
  if (!P.$('[data-act="paste-text"]')) P.click(P.btn("paste-toggle"));
  P.change(P.$('[data-act="paste-units"]'), units);
  P.type(P.$('[data-act="paste-text"]'), text);
  P.click(P.btn("paste-check"));
  return P.w.eval("ui.pasteResult");
};
const editProp = (P, beam, k, v) => {
  P.click(P.btn("beam-edit", beam));
  P.type(P.$(`[data-act="beam-prop"][data-field="${k}"]`), v);
  P.click(P.btn("beam-submit"));
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

  // --- an idle tab never writes its model because the library changed elsewhere ---------------
  {
    const { gh, P } = await start({ revision: 1, beams: [b("P1")] });
    P.click(P.btn("beam-use", "P1"));
    const newer = storedModel(P);
    newer.elements[0].description = "TAB A NEWER WORK";
    P.w.localStorage.setItem("cba-model-v1", JSON.stringify(newer));
    // Another tab edits only the notes of the beam this model uses.
    P.w.localStorage.setItem("cba-beams-pending-v1", JSON.stringify([{ op: "upsert", beam: raw(b("P1", { notes: "per supplier p.12" })), base: raw(b("P1")) }]));
    P.w.dispatchEvent(new P.w.StorageEvent("storage", { key: "cba-beams-pending-v1" }));
    ok("another tab's library edit does not make this idle tab write its model", storedModel(P).elements[0].description === "TAB A NEWER WORK");
    ok("…while this tab does show the edit", P.rows().some((r) => r.name === "P1" && /Edited here/.test(r.status)));
    P.w.localStorage.removeItem("cba-beams-pending-v1");
    P.w.dispatchEvent(new P.w.StorageEvent("storage", { key: "cba-beams-pending-v1" }));
    gh.colleagueSaves((f) => {
      f.beams[0].mass = 25.1;
      f.revision = 2;
    });
    P.click(P.btn("beams-reload"));
    await P.flush();
    ok("a reload bringing a colleague's change does not write the model either", storedModel(P).elements[0].description === "TAB A NEWER WORK" && /revision 2/.test(P.grid()));
  }

  // --- edits made during the save that undo what it writes ------------------------------------
  {
    const { gh, P } = await start({ revision: 3, beams: [b("P1"), b("OLD")] }, remembered);
    addManual(P, "NEW X");
    let release;
    gh.hold = new Promise((r) => (release = r));
    P.click(P.btn("beams-save"));
    await P.flush();
    P.click(P.btn("beam-delete", "NEW X"));
    P.click(P.btn("beam-delete", "NEW X"));
    release();
    gh.hold = null;
    await P.flush(); await P.flush();
    ok("a beam deleted while the save adding it is in flight stays deleted here, as a pending delete", names(gh).includes("NEW X") && !P.rows().some((r) => r.name === "NEW X") && pendingOps(P).some((o) => o.op === "delete" && o.name === "NEW X"), JSON.stringify(pendingOps(P)));
    P.click(P.btn("beam-delete", "OLD"));
    P.click(P.btn("beam-delete", "OLD"));
    gh.hold = new Promise((r) => (release = r));
    P.click(P.btn("beams-save"));
    await P.flush();
    P.click(P.btn("beam-restore", "OLD"));
    release();
    gh.hold = null;
    await P.flush(); await P.flush();
    ok("an Undo made while the delete is being saved keeps the beam, as a pending change", !names(gh).includes("OLD") && P.rows().some((r) => r.name === "OLD") && pendingOps(P).some((o) => o.beam?.name === "OLD"), JSON.stringify(pendingOps(P)));
  }

  // --- conflicts: case-only renames, lost replies, lagging live site ---------------------------
  {
    const { gh, P } = await start({ revision: 1, beams: [b("abc"), b("KEEP")] });
    P.click(P.btn("beam-delete", "abc"));
    P.click(P.btn("beam-delete", "abc"));
    gh.colleagueSaves((f) => {
      f.beams[0].name = "ABC";
      f.beams[0].I = 20000000;
      f.revision = 2;
    });
    P.click(P.btn("beams-reload"));
    await P.flush();
    ok("a pending delete of a beam re-capitalised and changed on GitHub becomes a choice", P.$$('[data-act="conflict-mine"]').length === 1 && pendingOps(P).length === 1);
  }
  {
    const { gh, P } = await start({ revision: 1, beams: [b("P1")] }, remembered);
    addManual(P, "NEW X");
    // The save went through but its reply was lost: GitHub already holds this browser's beam.
    gh.colleagueSaves((f) => {
      f.beams.push(raw(pendingOps(P)[0].beam));
      f.revision = 2;
    });
    P.click(P.btn("beams-save"));
    await P.flush(); await P.flush();
    ok("GitHub already holding this browser's version is no conflict", /already has these beams/.test(P.grid()) && !P.$(".conflicts") && pendingOps(P).length === 0);
  }
  {
    const { gh, P } = await start({ revision: 4, beams: [b("X")] }, remembered);
    editProp(P, "X", "I", "21000000");
    gh.liveFile = JSON.parse(JSON.stringify(gh.file)); // the live site stays on revision 4
    gh.colleagueSaves((f) => {
      f.beams[0].I = 22000000;
      f.revision = 5;
    });
    P.click(P.btn("beams-save"));
    await P.flush(); await P.flush();
    P.click(P.btn("conflict-mine", "X"));
    P.click(P.btn("beams-reload"));
    await P.flush();
    ok("after choosing, the live site's older copy does not bring the conflict back", !P.$(".conflicts") && !P.btn("beams-save").disabled && /still publishing revision 5/.test(P.grid()));
    gh.liveFile = undefined;
    P.click(P.btn("beams-save"));
    await P.flush(); await P.flush();
    ok("…and the save then writes the chosen version", gh.file.revision === 6 && gh.file.beams[0].I === 21000000);
  }

  // --- long text and large hand-added fields survive an edit ----------------------------------
  {
    const long = `${"checked against the supplier's table ".repeat(20)}end`;
    const history = Array.from({ length: 200 }, (_, i) => `rev ${i}: checked`);
    const { P } = await start({ revision: 1, beams: [{ ...raw(b("HAND 3")), notes: long, history }] });
    editProp(P, "HAND 3", "I", "20000000");
    const edited = pendingOps(P)[0]?.beam;
    ok("an edit keeps long notes and large hand-added fields whole", edited?.notes === long && edited.history?.length === 200 && edited.I === 20000000);
  }

  // --- a render queued while typing waits for the click that left the field ------------------
  {
    const { P } = await start({ revision: 1, beams: [b("P1")] });
    P.click(P.btn("new-beam"));
    const notes = P.$('[data-act="beam-text"][data-field="notes"]');
    notes.focus();
    P.w.eval("renderWhenIdle()"); // a save finishing, or a confirmation lapsing, while typing
    const cancel = P.btn("beam-cancel");
    cancel.dispatchEvent(new P.w.MouseEvent("mousedown", { bubbles: true }));
    notes.blur();
    await wait(10);
    const intact = cancel.isConnected;
    cancel.dispatchEvent(new P.w.MouseEvent("mouseup", { bubbles: true }));
    P.click(cancel);
    await P.flush();
    ok("the pressed button is still there when the click arrives", intact && !P.$("#beam-form"));
  }

  // --- focus and announcements ------------------------------------------------------------------
  {
    const { gh, P } = await start({ revision: 1, beams: [b("P1")] }, remembered);
    const text = "Name\tA\tI\tZ\nP2\t2850\t19430000\t194300";
    paste(P, text);
    P.btn("paste-apply").focus();
    P.click(P.btn("paste-apply"));
    ok("after adding pasted beams, focus moves to Paste table", P.doc.activeElement === P.btn("paste-toggle"));
    let mutations = 0;
    new P.w.MutationObserver((ms) => (mutations += ms.length)).observe(P.$("#sr-status"), { childList: true, characterData: true, subtree: true });
    paste(P, text.replace("P2", "P3"));
    P.click(P.btn("paste-apply"));
    await wait(120);
    ok("a second message with the same text is announced again", mutations >= 2 && /1 beam added/.test(P.$("#sr-status").textContent), `${mutations} mutations`);
    P.btn("beams-save").focus();
    let release;
    gh.hold = new Promise((r) => (release = r));
    P.click(P.btn("beams-save"));
    await P.flush();
    ok("while saving, the Save button keeps focus", P.doc.activeElement === P.btn("beams-save") && P.btn("beams-save").getAttribute("aria-disabled") === "true");
    release();
    gh.hold = null;
    await P.flush(); await P.flush();
    ok("after saving, focus moves on rather than to the top of the page", P.doc.activeElement === P.btn("new-beam") && names(gh).includes("P3"));
    P.btn("gh-forget").focus();
    P.click(P.btn("gh-forget"));
    ok("after Forget token, focus is on the token field", P.doc.activeElement === P.$('[data-act="gh-token"]'));
  }

  // --- sections nobody has: every offered button can complete ---------------------------------
  {
    const { P } = await start({ revision: 1, beams: [b("IPE 200")] }, { "cba-model-v1": JSON.stringify(withSection(E.simpleThreeSpan(), "ipe 200")) });
    ok("a missing name that differs from a library beam only in capitals offers that beam", !!P.btn("beam-respell", "ipe 200") && !P.btn("beam-add-named"));
    P.click(P.btn("beam-respell", "ipe 200"));
    ok("…which fixes the model", P.badge() === "OK" && /default section IPE 200,/.test(P.$(".meta").textContent));
  }
  {
    const { P } = await start({ revision: 1, beams: [b("P1")] }, { "cba-model-v1": JSON.stringify(withSection(E.simpleThreeSpan(), "C 150 ")) });
    P.click(P.btn("beam-add-named", "C 150 "));
    ok("Add opens the form under a name it can accept", P.$('[data-act="beam-text"][data-field="name"]').value === "C 150");
    P.change(P.$('[data-act="beam-shape"]'), "manual");
    for (const [k, v] of Object.entries({ A: "2850", I: "19430000", Z: "194300", Av: "1120" })) P.type(P.$(`[data-act="beam-prop"][data-field="${k}"]`), v);
    P.click(P.btn("beam-submit"));
    ok("…and points the model at the beam it adds", P.badge() === "OK" && /default section C 150,/.test(P.$(".meta").textContent) && !P.btn("beam-add-named"));
  }
  {
    const { P } = await start({ revision: 1, beams: [b("P1")] }, { "cba-model-v1": JSON.stringify(withSection(E.simpleThreeSpan(), "custom")) });
    P.tab("geometry");
    ok("a model whose section is spelled 'custom' analyses as Custom", P.badge() === "OK" && P.$('[data-act="default-section"]').value === "Custom");
  }

  // --- saved copies -------------------------------------------------------------------------------
  {
    const def = { shape: "manual", material: "Steel", A: 600, I: 2.03e6, Z: 2.7e4, Av: 300 };
    const m = withSection(E.simpleThreeSpan(), "C 150", { "C 150": def });
    const { P } = await start({ revision: 1, beams: [b("C 150", { A: 600, I: 1.2e6, Z: 1.6e4, h: 150 }), b("C 200")] }, { "cba-model-v1": JSON.stringify(m) });
    P.tab("geometry");
    P.change(P.$('[data-act="default-section"]'), "C 200");
    P.change(P.$('[data-act="default-section"]'), "C 150");
    P.tab("beams");
    ok("a saved copy differing from the library survives being briefly unused", storedModel(P).sectionDefs["C 150"].I === 2.03e6 && !!P.btn("sections-accept"));
  }
  {
    const { P } = await start({ revision: 1, beams: [b("GOOD 200"), b("WRONG 200", { I: 19000000 })] });
    P.click(P.btn("beam-use", "WRONG 200"));
    P.click(P.btn("beam-delete", "WRONG 200"));
    P.click(P.btn("beam-delete", "WRONG 200"));
    P.click(P.btn("beam-use", "GOOD 200"));
    ok("an unused saved copy is listed with a Remove button", /not used by it: WRONG 200/.test(P.grid()) && !!P.btn("copies-remove"));
    P.click(P.btn("copies-remove"));
    P.tab("geometry");
    const opts = P.$$('[data-act="default-section"] option').map((o) => o.value);
    ok("…which removes it from the model and the selects", !("WRONG 200" in storedModel(P).sectionDefs) && !opts.includes("WRONG 200"), opts.join(" | "));
  }

  // --- the form ------------------------------------------------------------------------------------
  {
    const { P } = await start({ revision: 1, beams: [] });
    P.click(P.btn("new-beam"));
    P.change(P.$('[data-act="beam-shape"]'), "manual");
    for (const [k, v] of Object.entries({ A: "5.383", I: "36.920.000", Z: "388.600", Av: "1.808" })) P.type(P.$(`[data-act="beam-prop"][data-field="${k}"]`), v);
    P.type(P.$('[data-act="beam-text"][data-field="name"]'), "HE 200 A");
    P.click(P.btn("beam-submit"));
    const saved = pendingOps(P)[0]?.beam;
    ok("dots grouping thousands in one field are read the same way in the others", saved?.A === 5383 && saved.I === 36920000 && saved.Z === 388600 && saved.Av === 1808, JSON.stringify(saved));
  }
  {
    const dims = { h: 150, b: 65, c: 20, t: 2, ri: 2 };
    const c = E.sectionFromShape("lipped", dims);
    const beam = { name: "C 150x65x20x2.0", shape: "lipped", dims, material: "Steel", A: c.A, I: c.I, Z: c.Z, Av: c.Av, h: c.h, mass: c.A * 7.85e-3 };
    const { P } = await start({ revision: 1, beams: [beam] });
    P.click(P.btn("beam-edit", beam.name));
    P.change(P.$('[data-act="beam-override"]'), true);
    P.type(P.$('[data-act="beam-dim"][data-field="t"]'), "2.5");
    const c25 = E.sectionFromShape("lipped", { ...dims, t: 2.5 });
    const prop = (k) => Number(P.$(`[data-act="beam-prop"][data-field="${k}"]`).value);
    ok("editing a calculated beam: own values not typed in follow a changed dimension", rel(prop("A"), c25.A) < 1e-5 && rel(prop("Z"), c25.Z) < 1e-5 && rel(prop("mass"), c25.A * 7.85e-3) < 1e-5);
  }

  // --- pasting --------------------------------------------------------------------------------------
  {
    const { P } = await start({ revision: 1, beams: [] });
    let r = paste(P, "Designation\tA (cm2)\tIy (cm4)\tWel,y (cm3)\nIPE 300\t53.81\t8356\t557.1", "kmm");
    ok("titles in cm with the units set to 10³ mm²: refused, naming the right units", !r.beams.length && /table gives cm²/.test(r.errors[0] || "") && /switch the units to cm²/.test(r.unitHint), r.errors.join() + r.unitHint);
    r = paste(P, "Designation\tA\tIy\tWel,y\nIPE 300\t53.81\t8356\t557.1", "kmm");
    ok("without units in the titles, the same slip is caught by A·I against Z²", !r.beams.length && r.errors.some((e) => /too large for this Z/.test(e)) && /fit mm².*cm²|check which units/.test(r.unitHint), r.errors.join() + " | " + r.unitHint);
    r = paste(P, "Designation\tA (cm2)\tIy (cm4)\tWel,y (cm3)\th (cm)\nIPE 300\t53.81\t8356\t557.1\t30", "cm");
    ok("a depth given in cm is converted", r.beams[0]?.h === 300 && !r.errors.length, JSON.stringify(r.beams[0]) + r.errors.join());
    r = paste(P, "Designation\tA\tIy\tWel,y\n\tcm2\tcm4\tcm3\nIPE 200\t28.48\t1943\t194.3", "mm");
    ok("a units row under the titles is read", !r.beams.length && /table gives cm²/.test(r.errors[0] || ""));
    r = paste(P, "Designation\tA\tIy\tWel,y\n\tcm2\tcm4\tcm3\nIPE 200\t28.48\t1943\t194.3", "cm");
    ok("…and skipped as data", r.beams.length === 1 && r.beams[0].I === 19430000 && !r.errors.length, r.errors.join());
    r = paste(P, "Name\tA\tI\tZ\tAv\nC 150\t1,250\t4100000\t54,700\tn.a.");
    ok("'n.a.' says nothing about the decimal mark", !r.beams.length && r.errors.some((e) => /could mean 1250 or 1\.250/.test(e)), r.errors.join(" | "));
    r = paste(P, "Name,A,I,Z\nIPE 300,5381,83,560,000,557,100");
    ok("a CSV row with more cells than titles is refused", !r.beams.length && /has 7 cells but the header has 4/.test(r.errors[0] || ""), r.errors.join());
    r = paste(P, 'Designation\t"A\n(cm2)"\t"Iy\n(cm4)"\t"Wel,y\n(cm3)"\tSource\nIPE 200\t28.48\t1943\t194.3\t"Catalogue 2024\np. 12"', "cm");
    ok("quoted cells with line breaks stay one cell", r.beams.length === 1 && r.beams[0].I === 19430000 && /p\. 12/.test(r.beams[0].source) && !r.errors.length, r.errors.join());
    r = paste(P, "Name\tA\tI\tZ\tmass\nIPE 200\t28.48\t1943\t194.3\t22.4", "mm");
    ok("a mass that does not match the area flags the units", !r.beams.length && r.errors.some((e) => /does not match A/.test(e)) && /switch the units to cm²/.test(r.unitHint), r.errors.join() + r.unitHint);
  }

  for (const P of all) if (P.errors.length) ok("no runtime errors", false, P.errors.join("\n"));
  ok("no runtime errors in any page", all.every((P) => !P.errors.length));
  console.log(`\n${fail} failures`);
  process.exitCode = fail ? 1 : 0;
})().catch((e) => {
  console.log("THREW", e.stack);
  process.exitCode = 1;
});
