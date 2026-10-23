// All-combinations view: engine equivalence with the single view, then the UI driven in a
// headless DOM. Needs engine.js (extract-engine.sh) and jsdom.
const fs = require("fs");
const path = require("path");
const E = require("./engine.js");
const { JSDOM, VirtualConsole } = require("jsdom");

let fail = 0;
const ok = (name, cond, extra = "") => { if (!cond) fail++; console.log(`${cond ? "PASS" : "FAIL"}  ${name}${extra ? "  — " + extra : ""}`); };

// ---- engine: every combination's results equal the single view's for that combination ----
let s = 20261023;
const rnd = () => ((s = (s * 1103515245 + 12345) % 2147483648) / 2147483648);
const pick = (a) => a[Math.floor(rnd() * a.length)];
const SECS = E.SECTION_LIBRARY.map((x) => x.name);

function randomModel() {
  const n = 1 + Math.floor(rnd() * 10);
  const lengths = Array.from({ length: n }, () => 0.5 + rnd() * 7);
  const total = lengths.reduce((a, b) => a + b, 0);
  const supports = Array.from({ length: n + 1 }, () => pick(["Free", "Pinned", "Roller", "Fixed"]));
  const loads = E.emptyLoads();
  for (let i = 0, nl = 1 + Math.floor(rnd() * 6); i < nl; i++) {
    const cse = pick(E.LOAD_CASES);
    const p = rnd();
    if (p < 0.35) loads[i] = { id: "L" + i, active: true, case: cse, type: "Point", x1: rnd() * total, x2: 0, magnitude: (rnd() - 0.3) * 40, description: "" };
    else if (p < 0.55) loads[i] = { id: "L" + i, active: true, case: cse, type: "Moment", x1: rnd() * total, x2: 0, magnitude: (rnd() - 0.5) * 50, description: "" };
    else { const a = rnd() * total; loads[i] = { id: "L" + i, active: true, case: cse, type: "UDL", x1: a, x2: Math.min(total, a + rnd() * total + 1e-3), magnitude: (rnd() - 0.3) * 25, description: "" }; }
  }
  const combinations = E.DEFAULT_COMBINATIONS.map((c) => ({ ...c, factors: { ...c.factors } }));
  combinations[10].factors = { G: 0.9, Q1: 0, Q2: 0, "W+": 0, "W-": 1.5, O: 0 };
  return {
    nElements: n, material: "Steel", customE: 200000, customDensity: 7850,
    defaultSection: pick(SECS), customI: 1e7, customZ: 1e5, customA: 2000, customAv: 1000,
    includeSelfWeight: rnd() < 0.6, stationsPerElement: pick([13, 26, 51]), deflectionLimitN: pick([200, 250]),
    elements: lengths.map((L, i) => ({ id: "E" + i, description: "E" + i, length: L, section: pick(SECS) })),
    supports, loads, combinations, selectedComboId: pick(["c1", "c4", "c10", "c11"]),
  };
}

function sameResult(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

{
  const models = [E.simpleThreeSpan(), E.excelExample()];
  for (let t = 0; t < 150; t++) models.push(randomModel());
  let compared = 0, mismatched = 0, okModels = 0, selectedShared = 0, selectedNonZero = 0;
  for (const m of models) {
    const r = E.analyze(m);
    if (!r.stations.length) {
      if (r.comboResults.length !== 0) mismatched++;
      continue;
    }
    okModels++;
    const active = m.combinations.filter((c) => E.LOAD_CASES.some((k) => (c.factors[k] ?? 0) !== 0));
    if (r.comboResults.map((c) => c.id).join() !== active.map((c) => c.id).join()) mismatched++;
    if (r.deflectionCheck !== r.selected.deflectionCheck) mismatched++;
    if (active.some((c) => c.id === m.selectedComboId)) {
      selectedNonZero++;
      if (r.comboResults.find((c) => c.id === m.selectedComboId) === r.selected) selectedShared++;
    }
    for (const c of r.comboResults) {
      compared++;
      const single = E.analyze({ ...m, selectedComboId: c.id });
      if (!sameResult(c, single.selected)) mismatched++;
    }
  }
  ok(`comboResults equal the single-view result for every combination (${compared} over ${okModels} models)`, mismatched === 0, `${mismatched} mismatches`);
  ok("selected result is the same object as its comboResults entry", selectedShared === selectedNonZero, `${selectedShared}/${selectedNonZero}`);
  const unstable = E.analyze({ ...E.simpleThreeSpan(), supports: ["Free", "Free", "Free", "Free"] });
  ok("failed analysis returns an empty comboResults", Array.isArray(unstable.comboResults) && unstable.comboResults.length === 0);
  // A hand-edited file can repeat an id; each row must still get its own results.
  const zero = { G: 0, Q1: 0, Q2: 0, "W+": 0, "W-": 0, O: 0 };
  const dup = E.analyze({
    ...E.simpleThreeSpan(),
    combinations: [
      { id: "d", name: "First", class: "User", factors: { ...zero, G: 1 }, notes: "" },
      { id: "d", name: "Second", class: "User", factors: { ...zero, Q1: 1 }, notes: "" },
    ],
    selectedComboId: "d",
  });
  ok("repeated combination ids still get separate results", dup.comboResults.map((c) => c.name).join() === "First,Second" && dup.comboResults[0] !== dup.comboResults[1]);
}

// ---- UI ------------------------------------------------------------------
const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
const errors = [];
const vc = new VirtualConsole();
vc.on("jsdomError", (e) => errors.push("jsdomError: " + (e.stack || e.message)));
vc.on("error", (...a) => errors.push("console.error: " + a.join(" ")));
const dom = new JSDOM(html, { runScripts: "dangerously", url: "https://example.com/", virtualConsole: vc, pretendToBeVisual: true });
const { window } = dom;
const doc = window.document;
const $ = (sel) => doc.querySelector(sel);
const $$ = (sel) => [...doc.querySelectorAll(sel)];
const click = (el) => el.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
const change = (el, v) => { if (v !== undefined) { if (el.type === "checkbox") el.checked = v; else el.value = v; } el.dispatchEvent(new window.Event("change", { bubbles: true })); };
const tab = (t) => click($(`[data-act="tab"][data-tab="${t}"]`));
const state = () => window.eval("({ view: model.comboView, hidden: model.hiddenComboIds, selected: model.selectedComboId })");
const seriesCounts = () => $$(".diagram.multi").map((d) => d.querySelectorAll("path.series").length);

tab("results");
ok("single view by default, with a view toggle", $(".page-title").textContent !== "All combinations" && !!$('[data-act="view"][data-view="all"]'));

change($('header [data-act="pick-combo"]'), "__all__");
const nActive = window.eval("activeCombos(model).length");
ok("header select switches to the all-combinations view", state().view === "all" && $(".page-title").textContent === "All combinations");
ok("one legend chip per non-zero combination", $$('[data-act="toggle-combo"]').length === nActive, `${$$('[data-act="toggle-combo"]').length} vs ${nActive}`);
ok("six overlay diagrams", $$(".diagram.multi").length === 6);
ok("every diagram draws every shown combination", seriesCounts().every((n) => n === nActive), seriesCounts().join(","));
ok("extrema-by-combination table has a row per combination", [...$$("section.card")].find((sc) => /Extrema by combination/.test(sc.textContent))?.querySelectorAll("tbody tr").length === nActive);

const [firstId, secondId] = $$('[data-act="toggle-combo"]').map((c) => c.getAttribute("data-id"));
const strokeOf = (id) => $$(".diagram.multi")[0].querySelector(`path.series[data-combo="${id}"]`)?.getAttribute("stroke");
const secondColour = strokeOf(secondId);
click($(`[data-act="toggle-combo"][data-id="${firstId}"]`));
ok("clicking a chip hides that combination", state().hidden.includes(firstId) && seriesCounts().every((n) => n === nActive - 1));
ok("hidden chip is shown as not pressed", $(`[data-act="toggle-combo"][data-id="${firstId}"]`).getAttribute("aria-pressed") === "false");
ok("colour follows the combination, not its rank", strokeOf(secondId) === secondColour, `${secondColour} -> ${strokeOf(secondId)}`);
click($(`[data-act="toggle-combo"][data-id="${firstId}"]`));
ok("clicking it again shows it", !state().hidden.includes(firstId));

ok("no hidden-combinations warning while all are shown", !/hidden\. The governing values/.test($(".panel").textContent));
click($(`[data-act="toggle-combo"][data-id="${firstId}"]`));
ok("hiding a combination warns that governing values leave it out", /1 combination is hidden\. The governing values below leave it out/.test($(".panel").textContent));
click($(`[data-act="toggle-combo"][data-id="${firstId}"]`));

click($('[data-act="show-combos"][data-show="none"]'));
ok("Hide all leaves an explanatory empty state", /Nothing to plot/.test($(".panel").textContent) && $$(".diagram.multi").length === 0);
ok("Hide all hides every row, including zero-factor ones", state().hidden.length === window.eval("model.combinations.length"));
click($('[data-act="show-combos"][data-show="all"]'));
ok("Show all brings every combination back", seriesCounts().every((n) => n === nActive) && state().hidden.length === 0);

// A combination hidden while zero must not come back hidden after Show all
window.eval('model.hiddenComboIds = ["c2"]; model.combinations[1].factors.G = 0; model.combinations[1].factors.Q2 = 0; render();');
click($('[data-act="show-combos"][data-show="all"]'));
window.eval("model.combinations[1].factors.G = 1.2; render();");
ok("Show all also clears combinations that were zero at the time", $('[data-act="toggle-combo"][data-id="c2"]')?.getAttribute("aria-pressed") === "true");
window.eval("model.combinations[1].factors.Q2 = 1.6; render();");
const stored = JSON.parse(window.localStorage.getItem("cba-model-v1") || "{}");
ok("view settings are persisted", stored.comboView === "all" && Array.isArray(stored.hiddenComboIds));

click($(".ext-card"));
ok("pinning a station lists every shown combination", [...$$("section.card")].find((sc) => /Pinned x =/.test(sc.textContent))?.querySelectorAll("tbody tr").length === nActive);
ok("pin is drawn on every diagram", $$(".diagram.multi").every((d) => d.querySelectorAll("circle.series").length === nActive));

change($('[data-act="station-field"]'), "v");
const stTable = [...$$("section.card")].find((sc) => /Station results — all combinations/.test(sc.textContent));
ok("station table has one column per combination", stTable.querySelector("thead tr").children.length === 3 + nActive);

// Combinations tab
tab("combos");
const plots = $$('[data-act="plot-combo"]');
ok("Plot checkbox for each non-zero combination", plots.length === nActive);
ok("zero-factor combinations have a disabled Plot box", $$(".combo-row input.plot-check:disabled").length === window.eval("model.combinations.length") - nActive);
change(plots[0], false);
ok("unticking Plot hides the combination", state().hidden.includes(plots[0].getAttribute("data-id")));
ok("header Plot box goes indeterminate", $('[data-act="plot-all"]').indeterminate === true);
change($('[data-act="plot-all"]'), true);
ok("ticking the header Plot box shows all", state().hidden.length === 0 && $('[data-act="plot-all"]').checked);
click($('.combo-row[data-id="c3"] .plot-cell svg.key'));
ok("clicking the colour key in the Plot cell stays in the all view", state().view === "all");
click($('.combo-row[data-id="c3"] .plot-cell'));
ok("clicking the Plot cell padding stays in the all view", state().view === "all");
click($('.combo-row[data-id="c4"] td.muted'));
ok("clicking a row returns to that single combination", state().view === "single" && state().selected === "c4");
window.eval('model.selectedComboId = "gone"; render();');
ok("a stale selected id shows the combination actually analysed", $('header [data-act="pick-combo"]').value === window.eval("model.combinations[0].id"));
window.eval('model.selectedComboId = "c4"; render();');
change($('.combo-grid [data-act="pick-combo"]'), "__all__");
ok("Combinations-tab select also offers All combinations", state().view === "all");

// Presets and imports keep the view
click($('[data-act="preset"][data-preset="three"]'));
ok("loading a preset keeps the all-combinations view", state().view === "all");
window.setModel({ ...JSON.parse(window.eval("JSON.stringify(excelExample())")) });
ok("importing a file without view settings keeps the current view", state().view === "all");
window.setModel({ ...JSON.parse(window.eval("JSON.stringify(excelExample())")), hiddenComboIds: 5, comboView: "all" });
tab("results");
ok("malformed hiddenComboIds is tolerated", $$(".diagram.multi").length === 6);

// Hand-edited files: repeated and numeric ids become unique strings, so rows stay separate
{
  const base = JSON.parse(window.eval("JSON.stringify(simpleThreeSpan())"));
  base.combinations[1].id = base.combinations[0].id;
  base.combinations[2].id = 7;
  window.setModel({ ...base, comboView: "all", hiddenComboIds: [] });
  const ids = window.eval("model.combinations.map((c) => c.id)");
  ok("repeated and numeric combination ids are made unique strings on load", new Set(ids).size === ids.length && ids.every((x) => typeof x === "string"), ids.slice(0, 3).join(","));
  click($(`[data-act="toggle-combo"][data-id="${ids[1]}"]`));
  ok("a renamed duplicate can be hidden on its own", $(`[data-act="toggle-combo"][data-id="${ids[0]}"]`).getAttribute("aria-pressed") === "true" && $(`[data-act="toggle-combo"][data-id="${ids[1]}"]`).getAttribute("aria-pressed") === "false");
  ok("each row has its own colour", $$(".diagram.multi")[0].querySelector(`path.series[data-combo="${ids[0]}"]`).getAttribute("stroke") !== $(`[data-act="toggle-combo"][data-id="${ids[1]}"] line`).getAttribute("stroke"));
  window.setModel({ ...base, combinations: [], comboView: "single" });
  ok("with no combinations the select reads None, not All combinations", $('header [data-act="pick-combo"]').selectedOptions[0]?.textContent === "None");
  window.setModel({ ...JSON.parse(window.eval("JSON.stringify(excelExample())")), comboView: "all", hiddenComboIds: [] });
}

// Unsafe names are escaped everywhere they appear
const evil = '<img src=x onerror="window.__xss=1">, "q"';
window.eval(`model.combinations[0].name = ${JSON.stringify(evil)}; model.hiddenComboIds = []; render();`);
ok("combination names are escaped", !doc.querySelector(".panel img") && window.__xss === undefined && $(".chips").textContent.includes("<img"));

// CSV in the all view: long format, names quoted
window.URL.createObjectURL = () => "blob:stub";
window.URL.revokeObjectURL = () => {};
let csv = "";
const RealBlob = window.Blob;
window.Blob = function (parts, o) { csv = parts.join(""); return new RealBlob(parts, o); };
click($('[data-act="export-csv"]'));
const lines = csv.split("\n");
const nStations = window.eval("analyze(model).stations.length");
const nShown = window.eval("shownComboResults(model, analyze(model)).length");
ok("all-view CSV has combination, element and face columns", lines[0].startsWith("combination,x_m,element,face,"));
const keys = lines.slice(1).map((l) => l.split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/).slice(0, 4).join("|"));
ok("each CSV row is uniquely keyed by combination, x, element and face", new Set(keys).size === keys.length);
ok("all-view CSV has stations × combinations rows", lines.length === 1 + nStations * nShown, `${lines.length - 1} vs ${nStations}×${nShown}`);
ok("CSV quotes names with commas and quotes", lines[1].startsWith('"<img src=x onerror=""window.__xss=1"">, ""q"""'));

// Schematic: max over min as two short lines under each support
window.eval("model = excelExample(); model.comboView = 'all'; model.hiddenComboIds = []; render();");
const rxTexts = $$(".schematic text").filter((t) => t.getAttribute("fill") === "var(--color-shear)");
ok("schematic reaction labels are single numbers, max over min", rxTexts.length > 0 && rxTexts.every((t) => !t.textContent.includes("/")));

// A model that cannot be analysed still renders every tab
window.eval('model.supports = model.supports.map(() => "Free"); render();');
ok("unstable model in the all view shows the empty state", /cannot be analysed/.test($(".panel").textContent));
for (const t of ["geometry", "loads", "combos", "results", "qa"]) tab(t);
ok("every tab renders for an unstable model", errors.length === 0);

// Back to single view: the original results are unchanged
window.eval("model = excelExample(); model.comboView = 'single'; render();");
tab("results");
ok("single view still has the deflection card and envelope", [...$$("section.card h2")].some((h) => h.textContent === "Deflection check") && /All-combination envelope/.test($(".panel").textContent));

console.log(`\n${fail} failures, ${errors.length} runtime errors`);
errors.forEach((e) => console.log(e));
process.exitCode = fail || errors.length ? 1 : 0;
