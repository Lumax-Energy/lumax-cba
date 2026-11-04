// Shared by the jsdom tests of the Beams tab: a mocked GitHub (contents API, live-site copy of
// beams.json) and a page booted from index.html against it. The token below is a placeholder; no
// request leaves the process.
const fs = require("fs");
const path = require("path");
const util = require("util");
const { JSDOM, VirtualConsole } = require("jsdom");

const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
const TOKEN = "github_pat_TESTONLY_not_a_real_token_0000";
const b64 = (s) => Buffer.from(s, "utf8").toString("base64");
const unb64 = (s) => Buffer.from(s, "base64").toString("utf8");

// gh.file: beams.json as an object (null: not created yet). Test hooks:
//  rawContent  serve this text instead of gh.file (a broken file)
//  getStatus   answer every API read with this status
//  big         answer reads like GitHub does for files over 1 MB (content left out)
//  hold        a promise every write waits for (a save "in flight")
//  onPut       called once before the next write is handled (a colleague saving first)
//  putReplies  [status, body] answers for the next writes, regardless of the file
//  putFails    statuses for the next writes (kept for older tests)
//  liveFile    what the live site serves, when it lags behind gh.file
//  repoVisible false: the token cannot see the repository (its reads answer 404)
//  loseReply   the next write is committed, but its reply is lost (the request throws)
//  offline     every request throws, as with no connection; offlineAfterLoss sets it after a lost reply
function makeGitHub(initial) {
  const gh = {
    file: initial ? JSON.parse(JSON.stringify(initial)) : null, fileText: null, sha: "sha0", calls: [],
    putFails: [], putReplies: [], getStatus: null, rawContent: null, big: false, hold: null, onPut: null,
    repoVisible: true, loseReply: false, offline: false, offlineAfterLoss: false,
  };
  const res = (status, body, text) => ({
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    json: async () => (body !== undefined ? body : JSON.parse(text)),
    text: async () => (text !== undefined ? text : JSON.stringify(body)),
  });
  gh.fetch = async (url, opts = {}) => {
    const method = opts.method || "GET";
    if (gh.offline) throw new TypeError("Failed to fetch");
    gh.calls.push({ url: String(url), method, headers: opts.headers || {}, body: opts.body ? JSON.parse(opts.body) : null });
    if (String(url).startsWith("https://api.github.com/")) {
      if (opts.headers?.Authorization !== `Bearer ${TOKEN}`) return res(401, { message: "Bad credentials" });
      if (method === "GET" && !/\/contents\//.test(String(url))) {
        // The repository itself.
        return gh.repoVisible ? res(200, { full_name: "Lumax-Energy/lumax-cba" }) : res(404, { message: "Not Found" });
      }
      if (method === "GET") {
        if (gh.getStatus) return res(gh.getStatus, { message: "nope" });
        if (!gh.repoVisible) return res(404, { message: "Not Found" });
        const text = gh.rawContent !== null ? gh.rawContent : gh.fileText !== null ? gh.fileText : gh.file ? JSON.stringify(gh.file, null, 2) : null;
        if (text === null) return res(404, { message: "Not Found" });
        if (/raw/.test(opts.headers?.Accept || "")) return res(200, undefined, text);
        if (gh.big) return res(200, { sha: gh.sha, encoding: "none", content: "", size: text.length });
        return res(200, { sha: gh.sha, encoding: "base64", content: b64(text).replace(/(.{60})/g, "$1\n") });
      }
      if (method === "PUT") {
        if (gh.hold) await gh.hold;
        if (gh.onPut) {
          const f = gh.onPut;
          gh.onPut = null;
          f(gh);
        }
        const body = JSON.parse(opts.body);
        if (gh.putReplies.length) {
          const [status, reply] = gh.putReplies.shift();
          return res(status, reply);
        }
        if (gh.putFails.length) return res(gh.putFails.shift(), { message: "conflict" });
        if (gh.file && body.sha !== gh.sha) return res(409, { message: `beams.json does not match ${body.sha}` });
        gh.fileText = unb64(body.content);
        gh.file = JSON.parse(gh.fileText);
        gh.sha = `sha${gh.calls.length}`;
        if (gh.loseReply) {
          gh.loseReply = false;
          if (gh.offlineAfterLoss) gh.offline = true;
          throw new TypeError("Failed to fetch");
        }
        return res(200, { content: { sha: gh.sha }, commit: { sha: "c0ffee", html_url: "https://github.com/Lumax-Energy/lumax-cba/commit/c0ffee" } });
      }
    }
    // The live site's copy of beams.json (relative URL) or raw.githubusercontent.com.
    if (/beams\.json/.test(String(url))) {
      const live = gh.liveFile !== undefined ? gh.liveFile : gh.file;
      return live ? res(200, live) : res(404, {});
    }
    return res(404, {});
  };
  // A colleague's save: replace the file (as an object) and move the sha on.
  gh.colleagueSaves = (mutate) => {
    const next = JSON.parse(JSON.stringify(gh.file));
    mutate(next);
    gh.file = next;
    gh.fileText = null;
    gh.sha = `sha-colleague-${gh.calls.length}`;
  };
  return gh;
}

function boot(gh, storage = {}) {
  const errors = [];
  const vc = new VirtualConsole();
  vc.on("jsdomError", (e) => errors.push("jsdomError: " + (e.stack || e.message)));
  vc.on("error", (...a) => errors.push("console.error: " + a.join(" ")));
  const dom = new JSDOM(html, {
    runScripts: "dangerously", url: "https://lumax-energy.github.io/lumax-cba/", virtualConsole: vc, pretendToBeVisual: true,
    beforeParse(w) {
      w.fetch = gh.fetch;
      w.TextEncoder = util.TextEncoder;
      w.TextDecoder = util.TextDecoder;
      for (const [k, v] of Object.entries(storage)) w.localStorage.setItem(k, v);
    },
  });
  const w = dom.window;
  const doc = w.document;
  const api = {
    w, doc, errors,
    $: (s) => doc.querySelector(s),
    $$: (s) => [...doc.querySelectorAll(s)],
    click: (el) => el.dispatchEvent(new w.MouseEvent("click", { bubbles: true })),
    change: (el, v) => { if (v !== undefined) { if (el.type === "checkbox") el.checked = v; else el.value = v; } el.dispatchEvent(new w.Event("change", { bubbles: true })); },
    // Typing then leaving the field: input, then change.
    type: (el, v) => { el.value = v; el.dispatchEvent(new w.Event("input", { bubbles: true })); el.dispatchEvent(new w.Event("change", { bubbles: true })); },
    // Typing without leaving the field: input only.
    input: (el, v) => { el.focus(); el.value = v; el.dispatchEvent(new w.Event("input", { bubbles: true })); },
    tab: (t) => api.click(doc.querySelector(`[data-act="tab"][data-tab="${t}"]`)),
    flush: () => new Promise((r) => setTimeout(r, 15)),
    rows: () => [...doc.querySelectorAll(".beam-table tbody tr")].map((tr) => ({ name: tr.querySelector(".beam-name")?.textContent, status: tr.querySelector(".badge")?.textContent })),
    store: (k) => w.localStorage.getItem(k),
    text: () => doc.querySelector(".panel").textContent,
    grid: () => doc.querySelector(".beams-grid")?.textContent || "",
    btn: (act, name) => [...doc.querySelectorAll(`[data-act="${act}"]`)].find((el) => name === undefined || el.getAttribute("data-name") === name),
    badge: () => doc.querySelector(".header .badge").textContent.trim(),
  };
  return api;
}

module.exports = { makeGitHub, boot, TOKEN, b64, unb64 };
