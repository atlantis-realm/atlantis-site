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
  const lots = parkLots(O, "alder").filter((l) => l.kind !== "landmark");  // the observatory is a loft, tested below
  assert.ok(lots.length > 0);
  for (const l of lots) {
    assert.equal(l.college, "alder"); assert.equal(l.wall, "ashlar");
    // a lab hall's clerestory band is glass on the same footprint
    const walls = onFoot(l).filter((p) => p.m !== "plinth" && !(l.form === "lab_hall" && p.m === "glass"));
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

// ---------------------------------------------------------------- Alder: lab halls and the observatory (task 3)
const { ringR, primsOf, primTop } = require("./helpers.js");
const mid = (poly) => [poly.reduce((t, p) => t + p[0], 0) / poly.length, poly.reduce((t, p) => t + p[1], 0) / poly.length];
const observatories = (o) => o.lots.filter((l) => l.landmark === "observatory");
const withPlan = (edit) => { const p = loadPlan(); edit(p); return [p, gen(p)]; };

test("every Alder college lot is a lab hall with a glass clerestory", () => {
  const labs = parkLots(O, "alder").filter((l) => l.use === "college");
  assert.ok(labs.length > 0);
  for (const l of labs) {
    assert.equal(l.form, "lab_hall", `${l.key} form ${l.form}`);
    assert.ok(l.storeys >= 2 && l.storeys <= 4, `${l.key} storeys ${l.storeys}`);
    assert.ok(onFoot(l).some((p) => p.m === "glass"), `${l.key} has no glass band`);
    assert.ok(onFoot(l).some((p) => p.m === "ashlar"), `${l.key} has no ashlar body`);
  }
  // 1-3 halls per cell, each a long bar
  const perCell = new Map();
  for (const l of labs) { const c = l.key.split("|").slice(0, -1).join("|"); perCell.set(c, (perCell.get(c) || 0) + 1); }
  assert.ok([...perCell.values()].every((n) => n >= 1 && n <= 3), JSON.stringify([...perCell.values()]));
});

test("lab halls only appear in Alder", () => {
  assert.ok(O.lots.filter((l) => l.form === "lab_hall").every((l) => l.college === "alder" && l.use === "college"));
});

test("exactly one Alder Observatory, on the inner half of the grove band", () => {
  const obs = observatories(O);
  assert.equal(obs.length, 1);
  const l = obs[0], r = ringR(...mid(l.poly));
  assert.ok(r >= 540 && r <= 650, `observatory at r ${r}`);
  assert.equal(l.d, "park"); assert.equal(l.kind, "landmark"); assert.equal(l.college, "alder");
  assert.equal(l.label, "Alder Observatory"); assert.equal(l.nb, "park-0");
  for (const f of ["base", "top", "storeys", "area"]) assert.ok(Number.isFinite(l[f]), `${f} ${l[f]}`);
  const spokes = CityGen.spokeAngles(plan);
  assert.ok(l.poly.every(([x, y]) => !CityGen.inCorridor(plan, spokes, x, y, 6)), "observatory in a spoke corridor");
});

test("the observatory has a copper dome lofted at 8 latitudes over an ashlar drum", () => {
  const prims = primsOf(O, "NBHD_park_alder_observatory");
  const dome = prims.filter((p) => p.t === "loft" && p.m === "copper");
  assert.equal(dome.length, 1);
  assert.equal(dome[0].rings.length, 8);
  assert.ok(dome[0].rings.every((r) => r.length === dome[0].rings[0].length), "dome ring lengths differ");
  assert.ok(prims.some((p) => p.t === "loft" && p.m === "ashlar"), "no ashlar drum");
  assert.ok(prims.some((p) => p.m === "roof"), "no lawn");
});

test("no tree stands within 45 m of the observatory", () => {
  const [cx, cy] = mid(observatories(O)[0].poly);
  const near = O.instances.filter((i) => Math.hypot(i.x - cx, i.y - cy) < 45);
  assert.equal(near.length, 0, `${near.length} trees on the lawn`);
  assert.equal(O.trees.length, O.instances.length, "trees and instances out of step");
});

test("Alder not growing: no observatory, and nothing Alder outside the college band", () => {
  const [p, o] = withPlan((q) => { q.districts.find((d) => d.id === "park").colleges.alder.grow = false; });
  assert.equal(observatories(o).length, 0);
  assert.equal(primsOf(o, "NBHD_park_alder_observatory").length, 0);
  const lots = parkLots(o, "alder", p);
  assert.ok(lots.length > 0);
  const inBand = ([x, y]) => ringR(x, y) >= 770 - 1 && ringR(x, y) <= 950 + 1;
  for (const l of lots) assert.ok(l.poly.every(inBand), `${l.key} outside the college band`);
  const pts = (pr) => (pr.t === "prism" ? pr.poly : pr.t === "solid" ? pr.top : pr.rings.flat());
  const alderObs = o.objects.filter((ob) => ob.coll === "park" && ob.props.nb === "park-0" && !["harbour", "waterworks"].includes(ob.props.use));
  assert.ok(alderObs.length > 0);
  for (const ob of alderObs) for (const pr of ob.prims) assert.ok(pts(pr).every(inBand), `${ob.name} ${pr.m} prim outside the college band`);
  assert.ok(!o.noPlant.some((q) => ringR(...mid(q)) < 770), "a feature footprint in the grove band");
});

test("with eight spokes there is still exactly one observatory", () => {
  const [, o] = withPlan((q) => { q.spokes.count = 8; });
  const obs = observatories(o);
  assert.equal(obs.length, 1);
  const r = ringR(...mid(obs[0].poly));
  assert.ok(r >= 540 && r <= 650, `observatory at r ${r}`);
});

test("with a 300 m Lantern the observatory stays below the heart", () => {
  const [p, o] = withPlan((q) => { core(q).lantern = { ...(core(q).lantern || {}), height: 300 }; });
  const obs = observatories(o);
  assert.equal(obs.length, 1);
  assert.ok(obs[0].top < o.lantern.heart[1], `observatory top ${obs[0].top} vs heart ${o.lantern.heart[1]}`);
  for (const l of o.lots.filter((x) => x.college)) assert.ok(l.top < o.lantern.heart[1], `${l.key || l.label} top ${l.top}`);
  assert.ok(primsOf(o, "NBHD_park_alder_observatory").every((pr) => primTop(pr) < o.lantern.heart[1]));
});

test("the observatory is unchanged by the non-park digest", () => {
  const want = fs.readFileSync(path.join(__dirname, "fixtures", "nonpark.sha256"), "utf8").trim();
  assert.equal(nonParkDigest(O), want);
});

test("clearTrees drops trees inside a footprint from o.trees and o.instances alike", () => {
  const o = { trees: [[0, 0], [50, 0], [1, 1]], instances: [{ name: "a", x: 0, y: 0 }, { name: "b", x: 50, y: 0 }, { name: "c", x: 1, y: 1 }] };
  CityGen.clearTrees(o, [[-5, -5], [5, -5], [5, 5], [-5, 5]]);
  assert.deepEqual(o.trees, [[50, 0]]);
  assert.deepEqual(o.instances.map((i) => i.name), ["b"]);
});
