const fs = require("fs");
const { JSDOM, VirtualConsole } = require("jsdom");

const html = fs.readFileSync(require("path").join(__dirname, "..", "index.html"), "utf8");
const errors = [];
const vc = new VirtualConsole();
vc.on("jsdomError", (e) => errors.push("jsdomError: " + (e.stack || e.message)));
vc.on("error", (...a) => errors.push("console.error: " + a.join(" ")));
const dom = new JSDOM(html, { runScripts: "dangerously", url: "https://example.com/", virtualConsole: vc, pretendToBeVisual: true });
const { window } = dom;
const doc = window.document;
const click = (el) => el.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
const change = (el, v) => { if (v !== undefined) el.value = v; el.dispatchEvent(new window.Event("change", { bubbles: true })); };
const tab = (t) => click(doc.querySelector(`[data-act="tab"][data-tab="${t}"]`));

let fail = 0;
const ok = (name, cond, extra = "") => { if (!cond) fail++; console.log(`${cond ? "PASS" : "FAIL"}  ${name}${extra ? "  — " + extra : ""}`); };

// --- deflection card ---------------------------------------------------
tab("results");
let rows = doc.querySelectorAll('[data-act="probe"]');
const deflTable = [...doc.querySelectorAll("section.card")].find((s) => s.querySelector("h2")?.textContent === "Deflection check");
ok("deflection card renders a per-span table", !!deflTable?.querySelector("table tbody tr"));
const bodyRows = deflTable.querySelectorAll("table tbody tr");
ok("12-span example lists 12 segments (10 spans + 2 cantilevers)", bodyRows.length === 12, `got ${bodyRows.length}`);
ok("governing line present", /Governing:/.test(deflTable.textContent), deflTable.querySelector(".mono-note")?.textContent.trim());
ok("no 'Overhangs are excluded' claim left", !/Overhangs are excluded/.test(doc.body.textContent));

// --- header meta -------------------------------------------------------
ok("meta names the default section", /default section Custom, I = 966080/.test(doc.querySelector(".meta").textContent), doc.querySelector(".meta").textContent.trim());

// --- combinations ------------------------------------------------------
tab("combos");
const comboText = doc.querySelector(".combo-grid").textContent + [...doc.querySelectorAll(".combo-grid input")].map((i) => i.value).join(" ");
ok("no 'Unfactored service combination' mislabel", !/Unfactored service combination/.test(comboText));
ok("SLS combination shipped", /SLS G\+Q1/.test(comboText));
ok("factored combos flagged", (comboText.match(/FACTORED/g) || []).length >= 5);

// --- custom section fields --------------------------------------------
tab("geometry");
const customI = () => doc.querySelector('[data-act="patch"][data-field="customI"]');
ok("custom I editable when default section is Custom", !customI().disabled);
// switch default to a library section; elements follow, so custom becomes unused
change(doc.querySelector('[data-act="default-section"]'), "IPE 300");
ok("custom I disabled once nothing uses Custom", customI().disabled);
// set one element back to Custom -> field must become editable again
change(doc.querySelector('[data-act="element"][data-field="section"]'), "Custom");
ok("custom I re-enabled when one element uses Custom", !customI().disabled);
ok("meta follows the new default section", /default section IPE 300/.test(doc.querySelector(".meta").textContent), doc.querySelector(".meta").textContent.trim());

// --- warnings ----------------------------------------------------------
click(doc.querySelector('[data-act="preset"][data-preset="three"]'));
tab("loads");
const x2 = doc.querySelector('[data-act="load"][data-field="x2"]');
change(x2, "40"); // 3-span beam is 16 m long
tab("qa");
ok("UDL overrun is warned about", /only the part on the beam/.test(doc.querySelector(".qa-grid").textContent));

// --- exports still work ------------------------------------------------
window.URL.createObjectURL = () => "blob:stub";
window.URL.revokeObjectURL = () => {};
click(doc.querySelector('[data-act="preset"][data-preset="example"]'));
let csvOk = true;
try { click(doc.querySelector('[data-act="export-csv"]')); } catch (e) { csvOk = false; errors.push("csv: " + e.message); }
ok("CSV export runs", csvOk);
let jsonOk = true;
try { click(doc.querySelector('[data-act="export-json"]')); } catch (e) { jsonOk = false; errors.push("json: " + e.message); }
ok("JSON export runs", jsonOk);

// --- round trip through localStorage ----------------------------------
const stored = window.localStorage.getItem("cba-model-v1");
ok("model persisted", !!stored && JSON.parse(stored).elements.length === 12);

console.log(`\n${fail} failures, ${errors.length} runtime errors`);
errors.forEach((e) => console.log(e));
