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

// ---------------------------------------------------------------- palettes and roofs (task 2)
// The prims drawn on a lot's own footprint (plinth and walls), and the gable solids on its corners.
const parkPrims = (o) => o.objects.filter((ob) => ob.coll === "park").flatMap((ob) => ob.prims);
const sameXY = (a, b) => Math.abs(a[0] - b[0]) < 1e-9 && Math.abs(a[1] - b[1]) < 1e-9;
function footprintPrims(o) {
  const by = new Map();
  for (const p of parkPrims(o)) if (p.t === "prism") { const k = JSON.stringify(p.poly); (by.get(k) || by.set(k, []).get(k)).push(p); }
  return (lot) => by.get(JSON.stringify(lot.poly)) || [];
}
const PLASTERS = ["plaster_a", "plaster_b", "plaster_c"];
const onFoot = footprintPrims(O);

test("every Alder lot is built in ashlar", () => {
  const lots = parkLots(O, "alder");
  assert.ok(lots.length > 0);
  for (const l of lots) {
    assert.equal(l.college, "alder"); assert.equal(l.wall, "ashlar");
    const walls = onFoot(l).filter((p) => p.m !== "plinth");
    assert.ok(walls.length > 0, `no wall prims for ${l.key}`);
    assert.ok(walls.every((p) => p.m === "ashlar"), `${l.key} walls ${walls.map((p) => p.m)}`);
  }
});

test("every Saffron lot is timber under a garden roof", () => {
  const lots = parkLots(O, "saffron");
  assert.ok(lots.length > 0);
  for (const l of lots) {
    assert.equal(l.college, "saffron"); assert.equal(l.wall, "timber"); assert.equal(l.roof, "garden");
    const walls = onFoot(l).filter((p) => p.m !== "plinth");
    assert.ok(walls.length > 0 && walls.every((p) => p.m === "timber"), `${l.key} walls ${walls.map((p) => p.m)}`);
  }
});

test("every Indigo lot is plastered, in at least 3 colours, over a brick plinth", () => {
  const lots = parkLots(O, "indigo");
  assert.ok(lots.length > 0);
  for (const l of lots) {
    assert.equal(l.college, "indigo"); assert.ok(PLASTERS.includes(l.wall), `${l.key} wall ${l.wall}`);
    const walls = onFoot(l).filter((p) => p.m !== "brick");
    assert.ok(walls.length > 0 && walls.every((p) => p.m === l.wall), `${l.key} walls ${walls.map((p) => p.m)}`);
  }
  assert.ok(new Set(lots.map((l) => l.wall)).size >= 3);
});

test("every 4-gon Indigo lot has a rooftile gable", () => {
  const gables = parkPrims(O).filter((p) => p.t === "solid" && p.m === "rooftile");
  const quads = parkLots(O, "indigo").filter((l) => l.poly.length === 4);
  assert.ok(quads.length > 0);
  for (const l of quads) {
    assert.ok(gables.some((g) => sameXY(g.top[0], l.poly[0])), `no rooftile gable on ${l.key}`);
    assert.equal(l.roof, undefined); assert.equal(l.roofTop, undefined);
  }
});

test("college palettes survive neighbourhoods being off (sector index picks the college)", () => {
  const p = loadPlan(); p.neighbourhoods.enabled = false;
  const lots = gen(p).lots.filter((l) => l.d === "park" && l.college);
  assert.deepEqual([...new Set(lots.map((l) => l.college))].sort(), ["alder", "indigo", "saffron"]);
});

test("a college with an unknown style keeps today's look", () => {
  const p = loadPlan(); p.districts.find((d) => d.id === "park").colleges.alder.style = "bogus";
  let o; assert.doesNotThrow(() => { o = gen(p); });
  const lots = parkLots(o, "alder", p);
  assert.ok(lots.length > 0);
  assert.ok(lots.every((l) => l.college === undefined && l.wall === undefined));
  assert.ok(parkLots(o, "indigo", p).every((l) => l.college === "indigo"));
});
