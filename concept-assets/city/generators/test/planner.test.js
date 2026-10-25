// The city planner page (plan_page/): built by assemble.py from head.part.html + citygen.js + script.part.js.
// A static check of the built HTML, plus a smoke run of its script against a minimal DOM stub.
const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("fs"), os = require("os"), path = require("path"), { execFileSync } = require("child_process");
const { CityGen, loadPlan, gen, core, parkLots } = require("./helpers.js");

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
  for (const s of ["Old Town", "quarters.cultures.", "quarters.weights.", "grid.forms.", "lantern.taper", "lantern.heart.0"]) assert.ok(HTML.includes(s), `missing ${s}`);
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
  const els = new Map(), on = new Map(), canvasText = [], saved = [], fills = [];
  const ctx = new Proxy({}, {
    get(t, k) { if (k in t) return t[k]; if (k === "fillText" || k === "strokeText") return (s) => canvasText.push(String(s)); if (k === "fill") return () => fills.push(String(t.fillStyle)); if (k === "measureText") return () => ({ width: 10 }); return () => {}; },
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
  return { el, on, canvasText, saved, fills };
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

test("page edits: quarter culture weights are offered per culture, saved and honoured; blank clears", async () => {
  const plan = loadPlan(), P = bootPage(plan), ids = plan.neighbourhoods.types.map((t) => t.id);
  await tick();
  P.on.get("tabs:click")({ target: { closest: () => ({ dataset: { tab: "core" } }) } });
  const panel = P.el("panel").innerHTML;
  assert.match(panel, /Quarter cultures · relative weights/);
  for (const id of ids) {
    assert.ok(panel.includes(`data-path="quarters.weights.${id}"`), `panel lacks quarters.weights.${id}`);
    assert.ok(new RegExp(`data-path="(quarters\\.weights|grid\\.forms)\\.${id}"[^>]*data-blank="1"`).test(panel), `${id} weight field can't be blanked`);
  }
  const input = (p, value, ds = {}) => P.on.get("panel:input")({ target: { dataset: { path: p, ...ds }, value, min: "0", max: "20", setAttribute() {} } });
  input("quarters.weights.works", "5", { blank: "1" });
  input("grid.forms.gardens", "2", { blank: "1" });
  input("grid.forms.gardens", "", { blank: "1" });
  await new Promise((r) => setTimeout(r, 100));
  assert.ok(P.saved.length > 0, "nothing saved");
  const saved = P.saved.at(-1), d = saved.districts.find((x) => x.id === "core");
  assert.equal(d.quarters.weights.works, 5);
  assert.equal(d.quarters.count, 15, "editing a weight dropped the other quarter settings");
  assert.ok(!("gardens" in d.grid.forms), `a blanked weight stays in the plan: ${JSON.stringify(d.grid.forms)}`);
  // with works the only weighted culture, every seeded quarter is works
  const o = CityGen.generate(saved);
  assert.ok(o.quarters.length > 0);
  for (const q of o.quarters) assert.equal(q.culture, "works", `quarter ${q.k} is ${q.culture}`);
});

// ---------------------------------------------------------------- the park ring's three colleges
const COLLEGES = [["alder", "Alder College", "#4f9a7f"], ["indigo", "Indigo College", "#7a4fb5"], ["saffron", "Saffron College", "#c9962b"]];
const openTab = (P, id) => P.on.get("tabs:click")({ target: { closest: () => ({ dataset: { tab: id } }) } });
const zoomIn = (P) => P.on.get("plan:wheel")({ preventDefault() {}, clientX: 400, clientY: 300, deltaY: -3000 });
const parkId = (plan) => plan.districts.find((d) => d.type === "campus").id;
const selectOf = (panel, p) => (panel.match(new RegExp(`<select[^>]*data-path="${p.replace(/\./g, "\\.")}"[^>]*>[\\s\\S]*?<\\/select>`)) || [""])[0];
const pick = (P, p, value, ds) => { const target = { tagName: "SELECT", dataset: { path: p, ...ds }, value, min: "", max: "", setAttribute() {} }; P.on.get("panel:input")({ target }); P.on.get("panel:change")({ target }); };

test("planner: the college ring's tab shows each college's name, style, landmark and growth", async () => {
  const plan = loadPlan(), P = bootPage(plan);
  await tick();
  openTab(P, parkId(plan));
  const panel = P.el("panel").innerHTML;
  assert.match(panel, /<legend>Colleges · names, styles, landmarks and growth<\/legend>/);
  COLLEGES.forEach(([id, name], g) => {
    assert.ok(new RegExp(`data-path="@neighbourhoods\\.renames\\.park-${g}"[^>]*value="${name}"`).test(panel), `no name field for ${name}`);
    for (const k of ["style", "landmark", "grow"]) assert.ok(panel.includes(`data-path="colleges.${id}.${k}"`), `no ${k} select for ${id}`);
  });
  // each college's style select offers the three styles and Plain, with its own selected
  for (const [id, style] of [["alder", "physics"], ["indigo", "arts"], ["saffron", "earth"]]) {
    const sel = selectOf(panel, `colleges.${id}.style`);
    for (const v of ["physics", "arts", "earth", "plain"]) assert.ok(sel.includes(`<option value="${v}"`), `${id} style lacks ${v}`);
    assert.match(sel, new RegExp(`<option value="${style}" selected>`));
    assert.doesNotMatch(sel, / disabled/);
  }
  // Saffron has no landmark: its landmark select is fixed at None, not a live On/Off
  const saffronLm = selectOf(panel, "colleges.saffron.landmark");
  assert.match(saffronLm, / disabled/);
  assert.match(saffronLm, /<option value="none" selected>None/);
  assert.doesNotMatch(saffronLm, /value="true"/);
  assert.doesNotMatch(selectOf(panel, "colleges.alder.landmark"), / disabled/);
  // Saffron never grows: its select is fixed at Off
  const saffronGrow = selectOf(panel, "colleges.saffron.grow");
  assert.match(saffronGrow, / disabled/);
  assert.match(saffronGrow, /<option value="false" selected>Off/);
  assert.deepEqual(bannedIn(visible(panel)), []);
});

test("planner: an older plan without colleges shows citygen's defaults, and one edit keeps the rest", async () => {
  const plan = loadPlan(), park = plan.districts.find((d) => d.id === parkId(plan));
  delete park.colleges;
  const P = bootPage(plan);
  await tick();
  openTab(P, park.id);
  const panel = P.el("panel").innerHTML;
  assert.match(panel, /<select[^>]*data-path="colleges\.indigo\.landmark"[^>]*>[\s\S]*?<option value="true" selected>On/);
  P.on.get("panel:input")({ target: { dataset: { path: "colleges.indigo.landmark", bool: "1" }, value: "false", min: "", max: "", setAttribute() {} } });
  await new Promise((r) => setTimeout(r, 100));
  const d = P.saved.at(-1).districts.find((x) => x.id === park.id);
  assert.equal(d.colleges.indigo.landmark, false);
  assert.equal(d.colleges.alder.grow, true);
  assert.equal(d.colleges.saffron.color, "#c9962b");
});

test("planner: Alder's observatory is labelled when zoomed in, and goes when Alder stops growing", async () => {
  const plan = loadPlan(), P = bootPage(plan), id = parkId(plan);
  await tick();
  zoomIn(P); await tick();
  assert.ok(P.canvasText.includes("Alder Observatory"), "no Alder Observatory label when zoomed in");
  assert.ok(P.canvasText.includes("Indigo Opera"));
  openTab(P, id);
  P.on.get("panel:input")({ target: { dataset: { path: "colleges.alder.grow", bool: "1" }, value: "false", min: "", max: "", setAttribute() {} } });
  await new Promise((r) => setTimeout(r, 100));
  assert.ok(P.saved.length > 0, "nothing saved");
  const d = P.saved.at(-1).districts.find((x) => x.id === id);
  assert.equal(d.colleges.alder.grow, false);
  assert.equal(d.colleges.alder.landmark, true, "the edit dropped Alder's other settings");
  P.canvasText.length = 0;
  zoomIn(P); await tick();
  assert.ok(P.canvasText.length > 0, "nothing redrawn");
  assert.ok(!P.canvasText.includes("Alder Observatory"), "the observatory is still drawn");
  assert.ok(P.canvasText.includes("Indigo Opera"), "the other landmarks went too");
});

test("planner: colour by neighbourhood paints each college its own colour, listed in the legend", async () => {
  const plan = loadPlan(), P = bootPage(plan);
  await tick();
  P.fills.length = 0;
  P.el("colorBy").value = "nb"; P.on.get("colorBy:change")(); await tick();
  const legend = visible(P.el("legendUse").innerHTML);
  for (const [, name, col] of COLLEGES) {
    assert.ok(P.fills.includes(col), `no lots filled ${col} for ${name}`);
    assert.ok(legend.includes(name), `legend lacks ${name}`);
    assert.ok(P.el("legendUse").innerHTML.includes(col), `legend lacks the ${name} swatch`);
  }
  assert.deepEqual(bannedIn(legend), []);
});

test("planner: tooltips over college buildings read sensibly", async () => {
  const plan = loadPlan(), P = bootPage(plan), o = gen(plan);
  await tick();
  const R = Math.max(...plan.scene.rings.map((r) => r.r1)) + 150, S = 600 / (2 * R), OX = (800 - 2 * R * S) / 2;
  const hover = (l) => {
    const [x, y] = l.poly.reduce(([a, b], [u, v]) => [a + u / l.poly.length, b + v / l.poly.length], [0, 0]);
    P.on.get("plan:pointermove")({ clientX: OX + (x + R) * S, clientY: (-y + R) * S });
    return P.el("tip").textContent;
  };
  const park = o.lots.filter((l) => l.d === "park");
  const obs = park.find((l) => l.landmark === "observatory"), lab = park.find((l) => l.form === "lab_hall"), dye = park.find((l) => l.form === "dye_garden");
  assert.ok(obs && lab && dye);
  const tips = [hover(obs), hover(lab), hover(dye)];
  assert.match(tips[0], /Alder College · .* · Alder Observatory · 3 storeys/, tips[0]);
  assert.match(tips[1], /Alder College · .* · Lab hall · \d+ storeys/, tips[1]);
  assert.match(tips[2], /Indigo College · .* · Indigo Dye Garden · floor/, tips[2]);
  for (const t of tips) {
    assert.ok(!/_| form · |0 storeys/.test(t), `raw id or empty storeys in tip: ${t}`);
    assert.deepEqual(bannedIn(t), []);
  }
});

test("planner: a college's style is saved, and Plain gives Indigo today's look", async () => {
  const plan = loadPlan(), P = bootPage(plan), id = parkId(plan), before = parkLots(gen(plan), "indigo");
  assert.ok(before.some((l) => /^plaster_/.test(l.wall)), "Indigo should start with the arts palette");
  await tick();
  openTab(P, id);
  pick(P, "colleges.indigo.style", "plain", { str: "1" });
  await new Promise((r) => setTimeout(r, 100));
  assert.ok(P.saved.length > 0, "nothing saved");
  const saved = P.saved.at(-1), d = saved.districts.find((x) => x.id === id);
  assert.equal(d.colleges.indigo.style, "plain");
  assert.equal(d.colleges.alder.style, "physics", "the edit dropped another college's style");
  assert.match(selectOf(P.el("panel").innerHTML, "colleges.indigo.style"), /<option value="plain" selected>Plain/);
  const after = parkLots(CityGen.generate(saved), "indigo", saved);
  assert.ok(after.length > 0);
  assert.ok(!after.some((l) => /^plaster_/.test(l.wall) || l.college === "indigo"), "Indigo lots kept the arts palette");
  assert.ok(!after.some((l) => ["opera", "amphitheatre", "bigtop", "arcology"].includes(l.landmark)), "Indigo still has its venues");
});

test("planner: a college that doesn't grow shows its landmark Off and fixed", async () => {
  const plan = loadPlan(), P = bootPage(plan), id = parkId(plan);
  await tick();
  openTab(P, id);
  pick(P, "colleges.alder.grow", "false", { bool: "1" });
  await new Promise((r) => setTimeout(r, 100));
  const lm = selectOf(P.el("panel").innerHTML, "colleges.alder.landmark");
  assert.match(lm, / disabled/);
  assert.match(lm, /<option value="false" selected>Off/);
  assert.match(P.el("panel").innerHTML, /Alder College · landmark \(off: it doesn't grow\)/);
  // the stored setting is kept, so growing again brings the observatory back
  assert.equal(P.saved.at(-1).districts.find((x) => x.id === id).colleges.alder.landmark, true);
  pick(P, "colleges.alder.grow", "true", { bool: "1" });
  await new Promise((r) => setTimeout(r, 100));
  assert.doesNotMatch(selectOf(P.el("panel").innerHTML, "colleges.alder.landmark"), / disabled/);
});
