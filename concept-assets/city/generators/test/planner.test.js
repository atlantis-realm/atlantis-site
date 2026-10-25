// The city planner page (plan_page/): built by assemble.py from head.part.html + citygen.js + script.part.js.
// A static check of the built HTML, plus a smoke run of its script against a minimal DOM stub.
const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("fs"), os = require("os"), path = require("path"), { execFileSync } = require("child_process");
const { CityGen, loadPlan, gen, core } = require("./helpers.js");

const ROOT = path.join(__dirname, "..");
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "planner-test-"));
const OUT = path.join(TMP, "plan.html");
execFileSync("python3", [path.join(ROOT, "plan_page", "assemble.py"), OUT], { stdio: "pipe" });
const HTML = fs.readFileSync(OUT, "utf8");
const SCRIPT = (HTML.match(/<script>\n([\s\S]*)<\/script>\s*$/) || [])[1];

const BANNED = /\b(island|temple|spire|circular manhattan|sable heights)\b/gi;
const bannedIn = (s) => [...String(s).matchAll(BANNED)].map((m) => m[0]);
// Internal ids the build may keep (spec §1): the `island` ring id, terrain/scene keys and the code that reads them.
const ALLOW = [
  (pre, w, post) => /^island$/i.test(w) && pre.endsWith('"') && post.startsWith('"'),          // "island" ring id
  (pre, w, post) => /^island$/i.test(w) && /[A-Za-z_]\.$/.test(pre),                             // T.island, terrain.island
  (pre, w, post) => /^temple$/i.test(w) && /^\.[A-Za-z_]/.test(post),                            // temple.r, temple.spire_top
  (pre, w, post) => /^temple$/i.test(w) && /scene\.$/.test(pre),                                 // scene.temple
  (pre, w, post) => /^temple$/i.test(w) && /const $/.test(pre) && /^ = plan\.scene\.temple/.test(post), // const temple = plan.scene.temple
];

test("assemble.py writes to the path it is given", () => {
  assert.ok(HTML.length > 10000);
  assert.ok(SCRIPT, "no <script> body in the built page");
});

test("built page carries the Old Town planner fields", () => {
  assert.ok(!HTML.includes(">Core<"), "a view button still says Core");
  for (const s of ["Old Town", "quarters.cultures.", "grid.forms.", "lantern.taper", "lantern.heart.0"]) assert.ok(HTML.includes(s), `missing ${s}`);
});

test("banned names only appear as internal ids", () => {
  const bad = [];
  for (const m of HTML.matchAll(BANNED)) {
    const pre = HTML.slice(Math.max(0, m.index - 40), m.index), post = HTML.slice(m.index + m[0].length, m.index + m[0].length + 40);
    if (!ALLOW.some((f) => f(pre, m[0], post))) bad.push(`…${pre}[${m[0]}]${post}…`);
  }
  assert.deepEqual(bad, [], `banned names outside the allowlist:\n${bad.join("\n")}`);
});

test("generator warnings use none of the banned names", () => {
  const p = loadPlan();
  for (const w of gen(p).warnings) assert.deepEqual(bannedIn(w), [], w);
  core(p).lantern.height = 300;
  const ws = gen(p).warnings;
  assert.ok(ws.length > 0, "a 300 m Lantern should warn");
  for (const w of ws) assert.deepEqual(bannedIn(w), [], w);
});

test("page script parses", () => {
  const f = path.join(TMP, "page.js");
  fs.writeFileSync(f, SCRIPT);
  execFileSync(process.execPath, ["--check", f], { stdio: "pipe" });
});

// ---------------------------------------------------------------- smoke run against a DOM stub
function bootPage(plan) {
  const els = new Map(), on = new Map(), canvasText = [], saved = [];
  const ctx = new Proxy({}, {
    get(t, k) { if (k in t) return t[k]; if (k === "fillText" || k === "strokeText") return (s) => canvasText.push(String(s)); if (k === "measureText") return () => ({ width: 10 }); return () => {}; },
    set(t, k, v) { t[k] = v; return true; },
  });
  const el = (id) => {
    if (!els.has(id)) els.set(id, {
      id, style: {}, dataset: {}, hidden: false, innerHTML: "", textContent: "", value: id === "colorBy" ? "height" : "", checked: id !== "lyr-cloud",
      childElementCount: 0, offsetWidth: 100, offsetHeight: 20, attrs: {}, classList: { add() {}, remove() {} },
      setAttribute(k, v) { this.attrs[k] = v; }, getAttribute(k) { return this.attrs[k]; },
      addEventListener(type, f) { on.set(`${id}:${type}`, f); }, getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }),
      getContext: () => ctx, querySelector: () => null, contains: () => false, append() {}, setPointerCapture() {}, focus() {},
    });
    return els.get(id);
  };
  const ref = {
    get: async () => ({ exists: true, data: () => plan }),
    set: async (b) => { saved.push(JSON.parse(JSON.stringify(b))); },
    onSnapshot(cb) { cb({ exists: true, metadata: { hasPendingWrites: false }, data: () => plan }); },
  };
  const sandbox = {
    setTimeout: (f, ms) => setTimeout(f, Math.min(ms, 5)),
    document: { getElementById: el, documentElement: {}, querySelectorAll: () => [], activeElement: null, body: {}, createElement: () => el("_tmp") },
    getComputedStyle: () => ({ getPropertyValue: () => "#808080" }),
    requestAnimationFrame: (f) => { f(); return 0; },
    ResizeObserver: class { observe() {} }, MutationObserver: class { observe() {} },
    navigator: { clipboard: { writeText: async () => {} } },
    devicePixelRatio: 1, matchMedia: () => ({ addEventListener() {} }),
    claude: { use: async (k) => (k === "db" ? { doc: () => ref } : null) },
  };
  sandbox.window = sandbox;
  // stubs as parameters, run in this realm (a vm context is ~10x slower for the generator)
  new Function(...Object.keys(sandbox), SCRIPT)(...Object.values(sandbox));
  return { el, on, canvasText, saved };
}
const visible = (html) => String(html).replace(/<(script|style)[\s\S]*?<\/\1>/g, " ")
  .replace(/<[^>]*?\b(?:title|placeholder|aria-label)="([^"]*)"[^>]*>/g, " $1 ").replace(/<[^>]*>/g, " ");
const tick = () => new Promise((r) => setTimeout(r, 20));

test("page runs: every tab, view and tooltip is free of banned names", async () => {
  const plan = loadPlan(), P = bootPage(plan);
  await tick();
  const texts = [];
  const take = (what, s) => texts.push([what, s]);
  take("head", visible(HTML.split("<script>")[0]));
  const ids = ["city", "neighbourhoods", ...plan.districts.map((d) => d.id)];
  for (const id of ids) {
    P.on.get("tabs:click")({ target: { closest: () => ({ dataset: { tab: id } }) } });
    take(`panel ${id}`, visible(P.el("panel").innerHTML));
  }
  take("tabs", visible(P.el("tabs").innerHTML));
  for (const mode of ["height", "use", "nb"]) { P.el("colorBy").value = mode; P.on.get("colorBy:change")(); }
  take("canvas", P.canvasText.join(" | "));
  take("section", visible(P.el("section").innerHTML));
  take("legend", P.el("rampMax").textContent + " " + visible(P.el("legendUse").innerHTML));
  // hover over the landmarks, a quarter tower and the Lantern
  const o = gen(plan), R = Math.max(...plan.scene.rings.map((r) => r.r1)) + 150, S = 600 / (2 * R), OX = (800 - 2 * R * S) / 2;
  const hover = (l) => {
    const [x, y] = l.poly.reduce(([a, b], [u, v]) => [a + u / l.poly.length, b + v / l.poly.length], [0, 0]);
    P.on.get("plan:pointermove")({ clientX: OX + (x + R) * S, clientY: (-y + R) * S });
    return P.el("tip").textContent;
  };
  const cl = o.lots.filter((l) => l.d === "core");
  const parl = cl.find((l) => l.landmark === "parliament"), qt = cl.find((l) => l.zone === "band" && l.culture && l.tower);
  assert.ok(parl && qt);
  const tipP = hover(parl), tipQ = hover(qt);
  assert.match(tipP, /Parliament/, `landmark tip: ${tipP}`);
  const cultureLabel = plan.neighbourhoods.types.find((t) => t.id === qt.culture).label;
  assert.ok(tipQ.includes(cultureLabel), `quarter tip "${tipQ}" lacks ${cultureLabel}`);
  take("tips", tipP + " " + tipQ);
  for (const [what, s] of texts) assert.deepEqual(bannedIn(s), [], `${what}: ${bannedIn(s).join(", ")}`);
  // the Old Town panel shows the new groups, and the section shows the Lantern
  P.on.get("tabs:click")({ target: { closest: () => ({ dataset: { tab: "core" } }) } });
  const panel = P.el("panel").innerHTML;
  for (const s of ['data-path="grid.block"', 'data-path="quarters.count"', 'data-path="quarters.cultures.14"', 'data-path="heights.band.1"',
    'data-path="lantern.height"', 'data-path="lantern.heart.1"', 'data-path="landmarks.guild_halls"', 'data-path="second_avenue"']) assert.ok(panel.includes(s), `panel lacks ${s}`);
  assert.ok(!/Ring avenue 2/.test(panel), "second avenue shown while off");
  assert.ok(!/data-path="layout"/.test(panel), "Old Town offers a block layout");
  assert.match(P.el("section").innerHTML, /Lantern \d/);
  assert.ok(!/ 0–250 m/.test(P.el("rampMax").textContent));
});

test("page edits: array settings stay arrays in the saved plan", async () => {
  const plan = loadPlan(), c = core(plan);
  delete c.heights; c.quarters = { count: 15 };  // an older store doc
  const P = bootPage(plan);
  await tick();
  P.on.get("tabs:click")({ target: { closest: () => ({ dataset: { tab: "core" } }) } });
  const input = (p, value, ds = {}) => P.on.get("panel:input")({ target: { dataset: { path: p, ...ds }, value, min: "", max: "", setAttribute() {} } });
  input("heights.band.1", "280");
  input("quarters.cultures.3", "works", { str: "1" });
  input("quarters.block.0", "32");
  await new Promise((r) => setTimeout(r, 100));
  assert.ok(P.saved.length > 0, "nothing saved");
  const d = P.saved.at(-1).districts.find((x) => x.id === "core");
  assert.deepEqual(d.heights.band, [200, 280]);
  assert.deepEqual(d.heights.grid, [120, 220]);
  assert.ok(Array.isArray(d.quarters.cultures) && d.quarters.cultures[3] === "works", JSON.stringify(d.quarters.cultures));
  assert.ok(d.quarters.cultures.slice(0, 3).every((x) => x === ""), JSON.stringify(d.quarters.cultures));
  assert.deepEqual(d.quarters.block, [32, 46]);
  assert.equal(d.quarters.count, 15);
  const cfg = CityGen.oldTownConfig(d);
  assert.deepEqual(cfg.heights.band, [200, 280]);
});
