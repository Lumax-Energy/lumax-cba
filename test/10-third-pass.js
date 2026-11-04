// Regression tests for the third review pass of the beam library (round three): each block
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
  // A tee cut from a wide column section (AISC WT7x45: A 13.2 in², Ix 36.4 in⁴, A·I/Z² ≈ 12.7).
  const A = 8516, I = 1.515e7;
  const Z = Math.sqrt((A * I) / 12.7);
  ok("a genuine wide tee passes the A·I bound", E.beamPlausibility({ A, I, Z, h: 178 }).length === 0);
  ok("a ratio no beam section reaches is still refused, with the ratio stated plainly", E.beamPlausibility({ A, I, Z: Math.sqrt((A * I) / 25) }).some((p) => /A × I is 25 × Z²; beam sections stay under 20 × Z²/.test(p)));
  ok("names: runs of spaces and line breaks become one space", E.normaliseBeam({ name: "IPE\n200", I: 1e6, Z: 1e4, A: 500 }).name === "IPE 200" && E.normaliseBeam({ name: " C  150 ", I: 1e6, Z: 1e4, A: 500 }).name === "C 150");
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
const prop = (P, k) => P.$(`[data-act="beam-prop"][data-field="${k}"]`);

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

  // --- the form: the app's own pre-filled values are read as the app wrote them ---------------
  {
    const dims = { h: 200.406, b: 100.076, tw: 4.318, tf: 5.207, r: 10 };
    const c = E.sectionFromShape("i", dims);
    const w8 = { name: "W8x10", shape: "i", dims, material: "Steel", A: c.A, I: c.I, Z: c.Z, Av: c.Av, h: c.h, mass: c.A * 7.85e-3 };
    const { P } = await start({ revision: 1, beams: [w8] });
    P.click(P.btn("beam-edit", "W8x10"));
    P.type(P.$('[data-act="beam-dim"][data-field="r"]'), "7,6");
    P.click(P.btn("beam-submit"));
    const saved = pendingOps(P)[0]?.beam;
    const want = E.sectionFromShape("i", { ...dims, r: 7.6 });
    ok("a decimal comma typed in one dimension leaves the stored dimensions as they were", saved && saved.dims.h === 200.406 && saved.dims.r === 7.6 && rel(saved.A, want.A) < 1e-5, JSON.stringify(saved?.dims));
    // With nothing to tell the decimal mark, '1.808' for a section property is refused like '1,808'.
    P.click(P.btn("new-beam"));
    P.change(P.$('[data-act="beam-shape"]'), "manual");
    for (const [k, v] of Object.entries({ A: "5383", I: "36920000", Z: "388600", Av: "1.808", h: "190" })) P.type(prop(P, k), v);
    ok("a lone 'd.ddd' section property is refused as ambiguous", /could mean 1808 or 1\.808/.test(P.$("#beam-problems").textContent) && P.btn("beam-submit").disabled, P.$("#beam-problems").textContent);
    P.click(P.btn("beam-cancel"));
  }

  // --- pasting ----------------------------------------------------------------------------------
  {
    const { P } = await start({ revision: 1, beams: [b("IPE 200")] });
    let r = paste(P, "Name\tA\tI\tZ\tAv\nIPE 200\t2848\t19430000\t194300\t1.400");
    ok("a lone 'd.ddd' Av in a table with no decimal mark is refused", !r.beams.length && r.errors.some((e) => /could mean 1400 or 1\.400/.test(e)), r.errors.join());
    r = paste(P, "Designation\tA (mm2 x10^2)\tIy (mm4 x10^4)\tWel.y (mm3 x10^3)\nIPE 200\t28.48\t1943\t194.3", "cm");
    ok("'mm² ×10²' style titles are read as cm units", r.beams[0]?.I === 19430000 && !r.errors.length, r.errors.join());
    r = paste(P, "Designation\tA (mm2 x10^2)\tIy (mm4 x10^4)\tWel.y (mm3 x10^3)\nIPE 200\t28.48\t1943\t194.3", "kmm");
    ok("…and contradicting them names cm", !r.beams.length && /gives cm²/.test(r.errors[0] || ""), r.errors.join());
    r = paste(P, "Designation\tA\tIy\tWel,y\th\n\t[cm²]\t[cm⁴]\t[cm³]\t[cm]\nIPE 300\t53.81\t8356\t557.1\t30", "cm");
    ok("a units row in brackets converts h from cm", r.beams[0]?.h === 300 && !r.errors.length, r.errors.join());
    r = paste(P, "Name\tA\tI\tZ\th (nominal)\nIPE 300\t5381\t83560000\t557100\t300");
    ok("words in brackets that are not units do not refuse the table", r.beams[0]?.h === 300 && !r.errors.length, r.errors.join());
    r = paste(P, "Name\tA (in cm2)\tI (cm4)\tZ (cm3)\nIPE 300\t53.81\t8356\t557.1", "cm");
    ok("'in cm2' is cm, not inches", r.beams[0]?.A === 5381 && !r.errors.length, r.errors.join());
    r = paste(P, "Name\tA\tI\tZ\nUnits\tmm2\tmm4\tmm3\nIPE 300\t5381\t83560000\t557100", "cm");
    ok("a labelled units row is read, and contradicting it names mm", !r.beams.length && /gives mm²/.test(r.errors[0] || ""), r.errors.join());
    r = paste(P, "Name\tA\tI\tZ\n\tmm2\tmm4\tmm3\n\tx10^2\tx10^4\tx10^3\nIPE 220\t33.37\t2772\t252", "cm");
    ok("two units rows (unit, then multiplier) are combined", r.beams[0]?.I === 27720000 && !r.errors.length, r.errors.join());
    r = paste(P, 'Name\tA\tI\tZ\tSource\nIPE 220\t3337\t27720000\t252000\tCat\nIPE 240\t3912\t38920000\t324300\t"\nIPE 270\t4595\t57900000\t428900\t"\nIPE 300\t5381\t83560000\t557100\tCat');
    ok("ditto marks do not swallow rows", r.beams.map((x) => x.name).join() === "IPE 220,IPE 240,IPE 270,IPE 300" && !r.errors.length, r.beams.map((x) => x.name).join() + r.errors.join());
    r = paste(P, '"Serial\nsize"\tA (cm2)\tIy (cm4)\tWel,y (cm3)\nIPE 220\t33.37\t2772\t252', "cm");
    ok("a wrapped first title does not hide the tab delimiter", r.beams[0]?.name === "IPE 220" && !r.errors.length, r.errors.join());
    r = paste(P, 'Name\tA\tI\tZ\n"IPE\n200"\t2848\t19430000\t194300');
    ok("a wrapped name cell is the same name", r.beams[0]?.name === "IPE 200" && /Replaces/.test(P.grid()));
    r = paste(P, "Name\tA\tI\tZ\nIPE 300\t5381\t83560000\t557100", "cm");
    ok("an mm table read as cm, units unstated: the depth gives it away", r.beams.length === 1 && /very deep \(2·I\/Z: IPE 300 3000 mm\)/.test(r.unitHint) && /switch the units to mm²/.test(r.unitHint), r.unitHint);
    r = paste(P, "Name\tA\tI\tZ\nIPE 300\t53.81\t8356\t557.1\nIPE 400\t84.46\t23130\t1156", "mm");
    ok("a cm table left at mm, units unstated: likewise", /very shallow \(2·I\/Z: IPE 300 30 mm\)/.test(r.unitHint) && /switch the units to cm²/.test(r.unitHint), r.unitHint);
    ok("the preview shows each section's depth from 2I/Z", /depth 2I\/Z/.test(P.grid()));
  }
  {
    const { P } = await start({ revision: 1, beams: [b("C 150")] }, { "cba-model-v1": JSON.stringify(withSection(E.simpleThreeSpan(), "C  150")) });
    ok("a section name with a double space offers the library's beam", !!P.btn("beam-respell", "C  150") && !P.btn("beam-add-named"));
  }

  // --- an Edit form keeps the GitHub version it started from ------------------------------------
  {
    const { gh, P } = await start({ revision: 3, beams: [b("K"), b("P1")] }, remembered);
    P.click(P.btn("beam-edit", "K"));
    gh.colleagueSaves((f) => {
      f.beams[0].I = 20000000;
      f.revision = 4;
    });
    P.click(P.btn("beams-reload"));
    await P.flush();
    P.type(P.$('[data-act="beam-text"][data-field="notes"]'), "checked");
    P.click(P.btn("beam-submit"));
    const puts = gh.calls.filter((c) => c.method === "PUT").length;
    P.click(P.btn("beams-save"));
    await P.flush(); await P.flush();
    ok("a colleague's change arriving while the form is open is a conflict, not overwritten", P.$$('[data-act="conflict-mine"]').length === 1 && gh.calls.filter((c) => c.method === "PUT").length === puts && gh.file.beams[0].I === 20000000);
  }

  // --- a deleted beams.json; a lost reply; delete and undo meanwhile ------------------------------
  {
    const { gh, P } = await start({ revision: 3, beams: [b("P1")] }, remembered);
    gh.file = null; // deleted on GitHub; the repository is still there
    addManual(P, "NEW");
    P.click(P.btn("beams-save"));
    await P.flush(); await P.flush();
    ok("a deleted beams.json is created again from the copy shown, not blamed on the token", names(gh).join() === "P1,NEW" && gh.file.revision === 4, names(gh).join());
  }
  {
    const { gh, P } = await start({ revision: 3, beams: [b("P1")] }, remembered);
    addManual(P, "NEW X");
    let release;
    gh.hold = new Promise((r) => (release = r));
    gh.loseReply = true;
    P.click(P.btn("beams-save"));
    await P.flush();
    P.click(P.btn("beam-delete", "NEW X"));
    P.click(P.btn("beam-delete", "NEW X"));
    release();
    gh.hold = null;
    await P.flush(); await P.flush();
    ok("a save whose reply is lost is recognised as saved, and the delete made meanwhile stays pending", names(gh).includes("NEW X") && pendingOps(P).some((o) => o.op === "delete" && o.name === "NEW X") && /Saved to GitHub/.test(P.grid()), JSON.stringify(pendingOps(P)));
  }
  {
    const { gh, P } = await start({ revision: 3, beams: [b("K"), b("P1")] }, remembered);
    gh.colleagueSaves((f) => {
      f.beams[0].I = 20000000;
      f.revision = 4;
    });
    addManual(P, "X");
    let release;
    gh.hold = new Promise((r) => (release = r));
    P.click(P.btn("beams-save"));
    await P.flush();
    P.click(P.btn("beam-delete", "K"));
    P.click(P.btn("beam-delete", "K"));
    P.click(P.btn("beam-restore", "K"));
    release();
    gh.hold = null;
    await P.flush(); await P.flush();
    ok("deleting and restoring a beam during a save leaves the colleague's change alone", !P.$(".conflicts") && pendingOps(P).length === 0 && gh.file.beams.find((x) => x.name === "K").I === 20000000);
  }

  // --- models: empty element sections, copies made from the cache --------------------------------
  {
    const { P } = await start({ revision: 1, beams: [b("P1", { I: 20000000, Z: 200000 })] });
    const m = withSection(E.simpleThreeSpan(), "P1");
    m.elements[1] = { ...m.elements[1], section: "" };
    const file = new P.w.File([JSON.stringify(m)], "m.json", { type: "application/json" });
    const input = P.$("#import-file");
    Object.defineProperty(input, "files", { value: [file], configurable: true });
    input.dispatchEvent(new P.w.Event("change", { bubbles: true }));
    await P.flush();
    ok("an element with an empty section follows the default section", P.w.eval("analyze(model).sectionAt.map((s) => s.name).join()") === "P1,P1,P1");
  }
  {
    const cache = { schema: "lumax-cba/beams@1", revision: 1, beams: [raw(b("P1"))], savedAt: 0, source: "github" };
    const m = withSection(E.simpleThreeSpan(), "P1");
    const { P } = await start({ revision: 2, beams: [b("P1", { I: 20000000, Z: 200000 })] }, { "cba-beams-cache-v1": JSON.stringify(cache), "cba-model-v1": JSON.stringify(m) });
    ok("a copy start-up made from the cached library follows GitHub's newer beam", !P.btn("sections-accept") && P.w.eval("model.sectionDefs.P1.I") === 20000000 && P.w.eval("analyze(model).staleSections.length") === 0);
  }

  // --- a render waits while any field is in use -----------------------------------------------------
  {
    const { gh, P } = await start({ revision: 1, beams: [b("P1")] }, remembered);
    addManual(P, "Q1");
    P.click(P.btn("new-beam"));
    const name = P.$('[data-act="beam-text"][data-field="name"]');
    P.input(name, "C 9");
    let release;
    gh.hold = new Promise((r) => (release = r));
    P.click(P.btn("beams-save"));
    await P.flush();
    ok("while a field is in use, the status is updated in place", /Saving/.test(P.$("#lib-actions").textContent) && P.doc.activeElement === name);
    const renders = P.w.eval("ui.renderCount");
    release();
    gh.hold = null;
    await P.flush(); await P.flush();
    ok("…the save's result is shown and announced without rebuilding the page", P.w.eval("ui.renderCount") === renders && /Saved to GitHub/.test(P.$("#lib-notes").textContent) && /Saved to GitHub/.test(P.$("#sr-status").textContent) && name.isConnected && P.doc.activeElement === name);
    const notes = P.$('[data-act="beam-text"][data-field="notes"]');
    notes.focus();
    await wait(20);
    ok("moving to another field keeps waiting (caret and selection untouched)", P.w.eval("ui.renderCount") === renders && notes.isConnected && P.doc.activeElement === notes);
    notes.blur();
    await wait(20);
    ok("leaving the fields lets the page catch up", P.w.eval("ui.renderCount") > renders && !P.$('[data-tab="beams"] .tab-dot'));
  }

  for (const P of all) if (P.errors.length) ok("no runtime errors", false, P.errors.join("\n"));
  ok("no runtime errors in any page", all.every((P) => !P.errors.length));
  console.log(`\n${fail} failures`);
  process.exitCode = fail ? 1 : 0;
})().catch((e) => {
  console.log("THREW", e.stack);
  process.exitCode = 1;
});
