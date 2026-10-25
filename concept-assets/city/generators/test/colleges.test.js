const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("fs"), path = require("path");
const { CityGen, loadPlan, gen, core, nonParkDigest, parkLots } = require("./helpers.js");

const plan = loadPlan(), O = gen(plan);
const park = plan.districts.find((d) => d.id === "park"), oldTown = core(plan);

test("park-0/1/2 are pinned to the three college names", () => {
  const n = Object.fromEntries(O.neighbourhoods.map((s) => [s.id, s.name]));
  assert.equal(n["park-0"], "Alder College");
  assert.equal(n["park-1"], "Indigo College");
  assert.equal(n["park-2"], "Saffron College");
});

test("collegeConfig({}) returns the defaults", () => {
  const c = CityGen.collegeConfig({});
  assert.deepEqual(Object.keys(c).sort(), ["alder", "indigo", "saffron"]);
  const want = { alder: [0, "Alder College", "physics", true], indigo: [1, "Indigo College", "arts", true], saffron: [2, "Saffron College", "earth", false] };
  for (const [id, [group, name, style, grow]] of Object.entries(want)) {
    assert.equal(c[id].group, group); assert.equal(c[id].name, name); assert.equal(c[id].style, style);
    assert.equal(c[id].grow, grow); assert.equal(c[id].landmark, true);
    assert.match(c[id].color, /^#[0-9a-f]{6}$/);
  }
});

test("saffron never grows, whatever the plan says", () => {
  assert.equal(CityGen.collegeConfig({ colleges: { saffron: { grow: true } } }).saffron.grow, false);
});

test("plan.json carries the three colours", () => {
  const c = CityGen.collegeConfig(park);
  assert.equal(c.alder.color, "#8fa6c7"); assert.equal(c.indigo.color, "#7a4fb5"); assert.equal(c.saffron.color, "#c9962b");
});

test("collegeOf resolves by group id and by sector index", () => {
  assert.equal(CityGen.collegeOf(park, "park-1").id, "indigo");
  assert.equal(CityGen.collegeOf(park, 3).id, "indigo");
  assert.equal(CityGen.collegeOf(park, 0).id, "alder");
  assert.equal(CityGen.collegeOf(park, "park-9"), null);
});

test("collegeOf is null outside the park", () => {
  assert.equal(CityGen.collegeOf(oldTown, "park-1"), null);
  assert.equal(CityGen.collegeOf(oldTown, 3), null);
});

test("a plan without park.colleges still works", () => {
  const d = JSON.parse(JSON.stringify(park)); delete d.colleges;
  assert.doesNotThrow(() => CityGen.collegeConfig(d));
  assert.equal(CityGen.collegeOf(d, "park-2").id, "saffron");
  const p = loadPlan(); delete p.districts.find((x) => x.id === "park").colleges;
  assert.doesNotThrow(() => gen(p));
});

test("with neighbourhoods off, sector k still picks the college", () => {
  const p = loadPlan(); p.neighbourhoods.enabled = false;
  const o = gen(p);
  assert.equal(o.nb, null);
  assert.equal(CityGen.collegeOf(park, 4).id, "saffron");
});

test("parkLots picks lots by college group", () => {
  const lots = parkLots(O, "indigo");
  assert.ok(lots.length > 0);
  assert.ok(lots.every((l) => l.d === "park" && l.nb === "park-1"));
});

test("nothing outside the college ring changes", () => {
  const want = fs.readFileSync(path.join(__dirname, "fixtures", "nonpark.sha256"), "utf8").trim();
  assert.equal(nonParkDigest(O), want);
  const p = loadPlan(); p.neighbourhoods.renames["park-1"] = "Elsewhere";
  assert.equal(nonParkDigest(gen(p)), want, "renaming a college moved something outside the park");
});
