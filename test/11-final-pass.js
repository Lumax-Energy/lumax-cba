// Regression tests for the last focused review of the beam library: each block reproduces one
// finding and checks the fixed behaviour. Needs engine.js (run-all.js) and jsdom.
const E = require("./engine.js");
const { makeGitHub, boot, TOKEN } = require("./dom-harness.js");

let fail = 0;
const ok = (name, cond, extra = "") => {
  if (!cond) fail++;
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${extra ? "  — " + extra : ""}`);
};
const b = (name, over = {}) => E.normaliseBeam({ name, A: 2850, I: 19430000, Z: 194300, Av: 1120, h: 200, material: "Steel", ...over });
const raw = (beam) => JSON.parse(JSON.stringify(beam));
const withSection = (m, name) => ({ ...m, defaultSection: name, elements: m.elements.map((el) => ({ ...el, section: name })) });
const remembered = { "cba-github-token-v1": TOKEN };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

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
    return { gh, P };
  };

  // --- the results never lag behind a library change ---------------------------------------------
  {
    const m = withSection(E.simpleThreeSpan(), "K");
    const { P } = await start({ revision: 1, beams: [b("K")] }, { "cba-model-v1": JSON.stringify(m) });
    const pick = P.$('[data-act="pick-combo"]');
    pick.focus();
    // Another tab changes K's I.
    P.w.localStorage.setItem("cba-beams-pending-v1", JSON.stringify([{ op: "upsert", beam: raw(b("K", { I: 4000000, Z: 40000 })), base: raw(b("K")) }]));
    P.w.dispatchEvent(new P.w.StorageEvent("storage", { key: "cba-beams-pending-v1" }));
    ok("with a closed select focused, a library change redraws the page at once, focus kept", /I = 4000000 mm⁴/.test(P.$(".meta").textContent) && P.doc.activeElement?.getAttribute("data-act") === "pick-combo", P.$(".meta").textContent);
    // A text field in use holds the page, but not the header's badge and summary line.
    P.tab("geometry");
    const desc = P.$('[data-act="element"][data-field="description"]');
    desc.focus();
    P.w.localStorage.setItem("cba-beams-pending-v1", JSON.stringify([{ op: "upsert", beam: raw(b("K", { I: 900000, Z: 18000, h: 100 })), base: raw(b("K")) }]));
    P.w.dispatchEvent(new P.w.StorageEvent("storage", { key: "cba-beams-pending-v1" }));
    ok("with a text field in use, the header line still follows the analysis", /I = 900000 mm⁴/.test(P.$(".meta").textContent) && desc.isConnected && P.doc.activeElement === desc, P.$(".meta").textContent);
  }

  // --- a deleted beams.json is written again from the copy shown -----------------------------------
  {
    const { gh, P } = await start({ revision: 7, beams: [b("C 150"), b("IPE 200"), b("IPE 240")] }, remembered);
    P.tab("beams");
    gh.file = null;
    P.click(P.btn("beams-reload"));
    await P.flush();
    ok("a deleted beams.json is reported, and Save offered", /no longer on GitHub/.test(P.grid()) && !P.btn("beams-save").disabled);
    addManual(P, "NEW");
    P.click(P.btn("beams-save"));
    await P.flush(); await P.flush();
    ok("…and saving writes the whole library shown, not just the edit", names(gh).join() === "C 150,IPE 200,IPE 240,NEW" && gh.file.revision === 8 && P.rows().length === 4, names(gh).join());
  }

  // --- a lost reply while the connection stays down -------------------------------------------------
  {
    const { gh, P } = await start({ revision: 3, beams: [b("P1"), b("OLD")] }, remembered);
    P.tab("beams");
    addManual(P, "NEW X");
    let release;
    gh.hold = new Promise((r) => (release = r));
    gh.loseReply = true;
    gh.offlineAfterLoss = true;
    P.click(P.btn("beams-save"));
    await P.flush();
    P.click(P.btn("beam-delete", "NEW X"));
    P.click(P.btn("beam-delete", "NEW X"));
    release();
    gh.hold = null;
    await P.flush(); await P.flush();
    ok("an unconfirmed save says so and keeps Save available", /confirm the save/.test(P.grid()) && !P.btn("beams-save").disabled && names(gh).includes("NEW X"));
    gh.offline = false;
    P.click(P.btn("beams-save"));
    await P.flush(); await P.flush();
    ok("once back online, the save is recognised and the delete made meanwhile is saved", !names(gh).includes("NEW X") && names(gh).includes("OLD") && pendingOps(P).length === 0 && !P.$(".conflicts"), names(gh).join());
  }

  // --- unit multipliers, and depths row by row --------------------------------------------------------
  {
    const { P } = await start({ revision: 1, beams: [] });
    P.tab("beams");
    let r = paste(P, "Designation\tA\tIy\tWel.y\n\tmm²\tmm⁴\tmm³\n\t10²\t10⁴\t10³\nIPE 200\t28.48\t1943\t194.3", "cm");
    ok("a multiplier row without 'x' is read", r.beams[0]?.I === 19430000 && !r.errors.length, r.errors.join());
    r = paste(P, "Designation\tA\tIy\tWel.y\n\t(10² mm²)\t(10⁴ mm⁴)\t(10³ mm³)\nIPE 200\t28.48\t1943\t194.3", "cm");
    ok("'(10² mm²)' in a units row is cm", r.beams[0]?.I === 19430000 && !r.errors.length, r.errors.join());
    r = paste(P, "Designation\tA (mm² ×100)\tIy (mm⁴ ×10000)\tWel.y (mm³ ×1000)\nIPE 200\t28.48\t1943\t194.3", "cm");
    ok("'×100' style multipliers are read", r.beams[0]?.I === 19430000 && !r.errors.length, r.errors.join());
    r = paste(P, "Designation\tA\tIy\tWel.y\n\tmm²\tmm⁴\tmm³\n\t10²\t10⁴\t10³\nIPE 200\t28.48\t1943\t194.3", "mm");
    ok("…and contradicting them names cm", !r.beams.length && /gives cm²/.test(r.errors[0] || ""), r.errors.join());
    const purlins = "Section\tA\tIx\tZel\nC 100x50x20x2.0\t419\t661000\t13200\nC 150x65x20x2.0\t589\t2182000\t29100\nC 200x75x20x2.5\t914\t5734000\t57300\nC 250x75x20x3.0\t1257\t11400000\t91200";
    r = paste(P, purlins, "cm");
    ok("an mm purlin table read as cm: the deep rows are named", /very deep \(2·I\/Z: C 150x65x20x2\.0 1500 mm/.test(r.unitHint) && /switch the units to mm²/.test(r.unitHint), r.unitHint);
    r = paste(P, `${purlins}\nC 300 typo\t1500\t9\t100000`, "cm");
    ok("…also when another row is implausible", /very deep/.test(r.unitHint) && r.errors.some((e) => /C 300 typo/.test(e)), r.unitHint);
  }

  for (const P of all) if (P.errors.length) ok("no runtime errors", false, P.errors.join("\n"));
  ok("no runtime errors in any page", all.every((P) => !P.errors.length));
  console.log(`\n${fail} failures`);
  process.exitCode = fail ? 1 : 0;
})().catch((e) => {
  console.log("THREW", e.stack);
  process.exitCode = 1;
});
