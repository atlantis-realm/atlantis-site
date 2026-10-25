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

// Indigo's venues and print works (task 5) have their own materials; the rest keep the arts palette
const SIGNATURE = ["opera", "amphitheatre", "bigtop", "print", "arcology", "dye_garden"];
test("every Indigo lot is plastered, in at least 3 colours, over a brick plinth", () => {
  const lots = parkLots(O, "indigo").filter((l) => !SIGNATURE.includes(l.form));
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
  const quads = parkLots(O, "indigo").filter((l) => l.poly.length === 4 && !SIGNATURE.includes(l.form));
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
  // scoped to Alder's sectors, so other colleges' features in their own bands can't trip it
  const spokes = CityGen.spokeAngles(p), n = spokes.length, step = CityGen.TAU / n, d = p.districts.find((x) => x.id === "park");
  const start = spokes[(d.neighbourhood.start_spoke || 0) % n].a;
  const isAlder = ([x, y]) => CityGen.collegeOf(d, Math.floor((((Math.atan2(y, x) - start) % CityGen.TAU + CityGen.TAU) % CityGen.TAU) / step) % n).id === "alder";
  assert.ok(!o.noPlant.some((q) => isAlder(mid(q)) && ringR(...mid(q)) < 770), "a feature footprint in Alder's grove band");
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

// ---------------------------------------------------------------- Saffron: grand tree-houses (task 4)
const saffronObs = (o) => o.objects.filter((ob) => ob.coll === "park" && ob.props.nb === "park-2");
const treehouses = (o, p = plan) => parkLots(o, "saffron", p).filter((l) => l.use === "college");
const ptsOf = (pr) => (pr.t === "prism" ? pr.poly : pr.t === "solid" ? pr.top : pr.rings.flat());

test("every Saffron college lot is a tree-house with at least 2 decks", () => {
  const lots = treehouses(O);
  assert.ok(lots.length > 0);
  for (const l of lots) {
    assert.equal(l.form, "treehouse", `${l.key} form ${l.form}`);
    assert.ok(Number.isInteger(l.decks) && l.decks >= 2 && l.decks <= 4, `${l.key} decks ${l.decks}`);
  }
  assert.ok(O.lots.filter((l) => l.form === "treehouse").every((l) => l.college === "saffron" && l.use === "college"));
});

test("each tree-house stands on 3-6 timber trunk columns rising from the ground", () => {
  const ter = CityGen.makeTerrain(plan);
  for (const l of treehouses(O)) {
    const ob = O.objects.find((x) => x.name === l.obj);
    assert.ok(ob, `no object for ${l.key}`);
    // a trunk: a timber prism 3-4 m square under the lot's lower deck, taller than the deck is high
    const area = (q) => Math.abs(q.reduce((t, p, i) => { const r = q[(i + 1) % q.length]; return t + p[0] * r[1] - r[0] * p[1]; }, 0)) / 2;
    const cols = ob.prims.filter((p) => p.t === "prism" && p.m === "timber" && area(p.poly) >= 9 - 1e-6 && area(p.poly) <= 16 + 1e-6 && p.z1 - p.z0 >= 8 && pointIn(...mid(p.poly), l.poly));
    assert.ok(cols.length >= 3 && cols.length <= 6, `${l.key} has ${cols.length} columns`);
    for (const c of cols) {
      const [x, y] = mid(c.poly), g = ter.G(Math.hypot(x, y));
      assert.ok(Math.abs(c.z0 - g) <= 1, `${l.key} column foot ${c.z0} vs ground ${g}`);
      assert.ok(c.z1 >= l.base + 8, `${l.key} column stops at ${c.z1}`);
    }
  }
});

test("every canopy walkway lies inside one Saffron college cell", () => {
  const cells = O.cells.filter((c) => c.nb === "park-2" && c.use === "college");
  const walks = saffronObs(O).filter((ob) => ob.props.walkway).flatMap((ob) => ob.prims);
  assert.ok(walks.length > 0, "no walkways");
  for (const w of walks) {
    assert.equal(w.m, "timber");
    // the four corners and points along each side, all in the same cell
    const pts = w.poly.flatMap((p, i) => { const q = w.poly[(i + 1) % w.poly.length]; return [0, 0.25, 0.5, 0.75].map((f) => [p[0] + (q[0] - p[0]) * f, p[1] + (q[1] - p[1]) * f]); });
    assert.ok(cells.some((c) => pts.every(([x, y]) => pointIn(x, y, c.poly))), `walkway ${JSON.stringify(w.poly)} leaves its cell`);
  }
});

test("no Saffron prim reaches past r 948 (decks stop short of the ring avenue)", () => {
  const obs = saffronObs(O);
  assert.ok(obs.length > 0);
  for (const ob of obs) for (const pr of ob.prims) for (const [x, y] of ptsOf(pr)) assert.ok(ringR(x, y) <= 948 + 1e-6, `${ob.name} ${pr.m} vertex at r ${ringR(x, y)}`);
  // some decks do overhang their cell toward the orchard
  assert.ok(obs.some((ob) => ob.prims.some((pr) => pr.t === "prism" && pr.poly.some(([x, y]) => ringR(x, y) > 940))), "no deck overhangs toward the orchard");
});

test("Saffron's orchard keeps every tree it had at Task 1", () => {
  // 4917: Saffron's trees (sectors k 4-5) at r 970-1170, from plan.json run through citygen.js at Task 1's commit 9a81230
  const d = park, spokes = CityGen.spokeAngles(plan), n = spokes.length, step = CityGen.TAU / n, start = spokes[(d.neighbourhood.start_spoke || 0) % n].a;
  const sector = (x, y) => Math.floor((((Math.atan2(y, x) - start) % CityGen.TAU + CityGen.TAU) % CityGen.TAU) / step) % n;
  const inOrchard = (i) => i.coll === "park" && ringR(i.x, i.y) >= 970 && ringR(i.x, i.y) <= 1170 && CityGen.collegeOf(d, sector(i.x, i.y)).id === "saffron";
  assert.equal(O.instances.filter(inOrchard).length, 4917);
});

test("with a 300 m Lantern every tree-house stays below the heart", () => {
  const [p, o] = withPlan((q) => { core(q).lantern = { ...(core(q).lantern || {}), height: 300 }; });
  const lots = treehouses(o, p);
  assert.ok(lots.length > 0);
  for (const l of lots) assert.ok(l.top < o.lantern.heart[1], `${l.key} top ${l.top} vs heart ${o.lantern.heart[1]}`);
});

function pointIn(x, y, q) {
  let ins = false;
  for (let a = 0, c = q.length - 1; a < q.length; c = a++) if ((q[a][1] > y) !== (q[c][1] > y) && x < (q[c][0] - q[a][0]) * (y - q[a][1]) / (q[c][1] - q[a][1]) + q[a][0]) ins = !ins;
  return ins;
}

// ---------------------------------------------------------------- Indigo: venues, print works and studios (task 5)
const VENUES = { opera: "Indigo Opera", amphitheatre: "Indigo Amphitheatre", bigtop: "Indigo Big Top" };
const FORMS = ["opera", "amphitheatre", "bigtop", "print", "studio"];
const indigoCollege = (o, p = plan) => parkLots(o, "indigo", p).filter((l) => l.use === "college");
const indigoCells = (o) => o.cells.filter((c) => c.nb === "park-1" && c.use === "college");
const lotPrims = (o, l) => { const ob = o.objects.find((x) => x.name === l.obj); assert.ok(ob, `no object for ${l.key}`); return ob.prims; };
const centreIn = (pr, l) => pointIn(...mid(ptsOf(pr)), l.poly);

test("Indigo has exactly one opera, amphitheatre and big top, as labelled landmark lots", () => {
  const lots = indigoCollege(O);
  assert.ok(lots.length > 0);
  for (const l of lots) assert.ok(FORMS.includes(l.form), `${l.key} form ${l.form}`);
  for (const [form, label] of Object.entries(VENUES)) {
    const v = lots.filter((l) => l.form === form);
    assert.equal(v.length, 1, `${form}: ${v.length}`);
    assert.equal(v[0].kind, "landmark"); assert.equal(v[0].label, label); assert.equal(v[0].college, "indigo");
    for (const f of ["base", "top", "storeys", "area"]) assert.ok(Number.isFinite(v[0][f]), `${form} ${f} ${v[0][f]}`);
  }
  // the forms belong to Indigo's college cells only
  assert.ok(O.lots.filter((l) => FORMS.includes(l.form)).every((l) => l.college === "indigo" && l.use === "college"));
});

test("about a third of the remaining Indigo college cells are print works, the rest studios", () => {
  const N = indigoCells(O).length, lots = indigoCollege(O), want = Math.ceil((N - 3) / 3);
  assert.ok(N > 3, `only ${N} Indigo college cells`);
  const prints = lots.filter((l) => l.form === "print").length;
  assert.ok(prints >= want - 1 && prints <= want + 1, `${prints} print lots, want about ${want} of ${N - 3}`);
  assert.ok(lots.some((l) => l.form === "studio"), "no studios");
});

test("the big top is a canvas cone over a 6 m wall, peaking at 18-24 m, with 4 masts", () => {
  const l = indigoCollege(O).find((x) => x.form === "bigtop"), prims = lotPrims(O, l);
  const canvas = prims.filter((p) => p.t === "loft" && p.m === "canvas" && centreIn(p, l));
  assert.ok(canvas.length > 0, "no canvas lofts");
  const peak = Math.max(...canvas.map(primTop));
  assert.ok(peak - l.base >= 18 - 1e-6 && peak - l.base <= 24 + 1e-6, `peak ${peak - l.base} above base`);
  assert.ok(canvas.some((p) => Math.abs(primTop(p) - (l.base + 6)) < 0.01), "no 6 m wall");
  const masts = prims.filter((p) => p.t === "prism" && centreIn(p, l) && p.z1 - p.z0 >= 18);
  assert.equal(masts.length, 4);
});

test("every print works has rooftile saw teeth and a brick chimney at least 18 m tall", () => {
  const prints = indigoCollege(O).filter((l) => l.form === "print");
  assert.ok(prints.length > 0);
  for (const l of prints) {
    const prims = lotPrims(O, l).filter((p) => centreIn(p, l));
    assert.ok(prims.some((p) => p.t === "solid" && p.m === "rooftile"), `${l.key} has no rooftile teeth`);
    const chim = prims.filter((p) => p.t === "prism" && p.m === "brick" && p.z1 - p.z0 >= 18);
    assert.ok(chim.length >= 1 && chim.length <= 2, `${l.key} has ${chim.length} chimneys`);
    assert.ok(chim.every((p) => p.z1 - p.z0 <= 25 + 1e-6));
    assert.equal(l.wall, "brick");
  }
});

test("the amphitheatre is a bowl of 5 ashlar rings under 15 m tall", () => {
  const l = indigoCollege(O).find((x) => x.form === "amphitheatre"), prims = lotPrims(O, l);
  assert.equal(prims.filter((p) => p.t === "loft" && p.m === "ashlar" && centreIn(p, l)).length, 5);
  assert.ok(l.top - l.base < 15, `amphitheatre ${l.top - l.base} m tall`);
});

test("the opera is a 4-storey plaster_a box under a copper drum and dome", () => {
  const l = indigoCollege(O).find((x) => x.form === "opera"), prims = lotPrims(O, l);
  assert.equal(l.storeys, 4); assert.equal(l.wall, "plaster_a");
  assert.ok(prims.some((p) => p.t === "prism" && p.m === "plaster_a" && centreIn(p, l)));
  assert.ok(prims.filter((p) => p.t === "loft" && p.m === "copper" && centreIn(p, l)).length >= 2, "no copper drum and dome");
});

test("with five spokes nothing throws and there is at most one of each venue", () => {
  let p, o;
  assert.doesNotThrow(() => { [p, o] = withPlan((q) => { q.spokes.count = 5; }); });
  for (const form of Object.keys(VENUES)) assert.ok(o.lots.filter((l) => l.form === form).length <= 1, form);
});

test("with a 300 m Lantern every venue stays below the heart", () => {
  const [p, o] = withPlan((q) => { core(q).lantern = { ...(core(q).lantern || {}), height: 300 }; });
  const v = indigoCollege(o, p).filter((l) => VENUES[l.form]);
  assert.equal(v.length, 3);
  for (const l of v) {
    assert.ok(l.top < o.lantern.heart[1], `${l.form} top ${l.top}`);
    assert.ok(lotPrims(o, l).filter((pr) => centreIn(pr, l)).every((pr) => primTop(pr) < o.lantern.heart[1]));
  }
});

// ---------------------------------------------------------------- Indigo: pine arcology and dye gardens (task 6)
const sectorCollege = (p, x, y) => {
  const d = p.districts.find((q) => q.id === "park"), spokes = CityGen.spokeAngles(p), n = spokes.length, step = CityGen.TAU / n;
  const start = spokes[(d.neighbourhood.start_spoke || 0) % n].a;
  return (CityGen.collegeOf(d, Math.floor((((Math.atan2(y, x) - start) % CityGen.TAU + CityGen.TAU) % CityGen.TAU) / step) % n) || {}).id;
};
const arcologies = (o) => o.lots.filter((l) => l.landmark === "arcology");
const dyeGardens = (o) => o.lots.filter((l) => l.form === "dye_garden");
const pines = (o) => o.instances.filter((i) => i.asset === "asset_Plant_pine");
const inOrchard = ([x, y]) => ringR(x, y) >= 970 - 1e-6 && ringR(x, y) <= 1170 + 1e-6;
const overlaps = (a, b) => a.some(([x, y]) => pointIn(x, y, b)) || b.some(([x, y]) => pointIn(x, y, a));
const side = (q, i) => Math.hypot(q[(i + 1) % q.length][0] - q[i][0], q[(i + 1) % q.length][1] - q[i][1]);

test("exactly one Indigo Pine Arcology, inside Indigo's orchard band and sector", () => {
  const a = arcologies(O);
  assert.equal(a.length, 1);
  const l = a[0];
  assert.equal(l.d, "park"); assert.equal(l.kind, "landmark"); assert.equal(l.college, "indigo");
  assert.equal(l.label, "Indigo Pine Arcology"); assert.equal(l.nb, "park-1");
  for (const f of ["base", "top", "storeys", "area"]) assert.ok(Number.isFinite(l[f]), `${f} ${l[f]}`);
  assert.ok(l.poly.every(inOrchard), "arcology outside the orchard band");
  assert.ok(l.poly.every(([x, y]) => sectorCollege(plan, x, y) === "indigo"), "arcology outside Indigo's sectors");
  const spokes = CityGen.spokeAngles(plan);
  assert.ok(l.poly.every(([x, y]) => !CityGen.inCorridor(plan, spokes, x, y, 6)), "arcology in a spoke corridor");
  assert.ok(Math.abs(side(l.poly, 0) - 60) < 1e-6, `base side ${side(l.poly, 0)}`);
});

test("the arcology is 6 stepped tiers of ashlar and glass, 12 m each, under roof terraces", () => {
  const l = arcologies(O)[0], prims = lotPrims(O, l);
  const roofs = prims.filter((p) => p.t === "prism" && p.m === "roof").sort((a, b) => a.z1 - b.z1);
  assert.equal(roofs.length, 6);
  roofs.forEach((p, i) => {
    assert.ok(Math.abs(side(p.poly, 0) - 60 * 0.8 ** i) < 1e-6, `tier ${i} side ${side(p.poly, 0)}`);
    assert.ok(Math.abs(p.z1 - (l.base + 12 * (i + 1))) < 1e-6, `tier ${i} top ${p.z1 - l.base}`);
  });
  assert.ok(prims.some((p) => p.m === "ashlar") && prims.some((p) => p.m === "glass"), "no ashlar walls or glass bands");
  assert.ok(Math.abs(l.top - (l.base + 72)) < 1e-6, `top ${l.top - l.base}`);
});

test("pines grow on the arcology's terraces, at least 20 of them over 10 m up", () => {
  const ter = CityGen.makeTerrain(plan), l = arcologies(O)[0], P = pines(O);
  const up = P.filter((i) => i.z > ter.G(ringR(i.x, i.y)) + 10);
  assert.ok(up.length >= 20, `${up.length} raised pines`);
  assert.ok(P.every((i) => i.coll === "park" && pointIn(i.x, i.y, l.poly)), "a pine off the arcology");
});

test("2-4 dye gardens of 40x60 m, striped with dye beds, in Indigo's orchard band", () => {
  const g = dyeGardens(O);
  assert.ok(g.length >= 2 && g.length <= 4, `${g.length} dye gardens`);
  const parkObs = O.objects.filter((ob) => ob.coll === "park");
  for (const l of g) {
    assert.equal(l.college, "indigo"); assert.equal(l.nb, "park-1"); assert.equal(l.d, "park");
    assert.ok(l.poly.every(inOrchard) && l.poly.every(([x, y]) => sectorCollege(plan, x, y) === "indigo"), `${l.key} out of place`);
    assert.deepEqual([side(l.poly, 0), side(l.poly, 1)].map((v) => Math.round(v)).sort(), [40, 60]);
    const dye = parkObs.flatMap((ob) => ob.prims).filter((p) => p.m === "dye" && pointIn(...mid(p.poly), l.poly));
    assert.ok(dye.length > 0, `${l.key} has no dye beds`);
    assert.ok(dye.every((p) => Math.abs(p.z1 - p.z0 - 0.3) < 1e-6));
  }
  for (let i = 0; i < g.length; i++) for (let j = i + 1; j < g.length; j++) assert.ok(!overlaps(g[i].poly, g[j].poly), "dye gardens overlap");
  assert.ok(g.every((l) => !overlaps(l.poly, arcologies(O)[0].poly)), "a dye garden overlaps the arcology");
});

test("no grove or orchard tree, solar farm or blimp pad stands on the arcology or a dye garden", () => {
  const feet = [...arcologies(O), ...dyeGardens(O)].map((l) => l.poly);
  const trees = O.instances.filter((i) => i.coll === "park" && i.asset !== "asset_Plant_pine");
  for (const q of feet) {
    assert.ok(!trees.some((i) => pointIn(i.x, i.y, q)), "a tree on a feature");
    assert.ok(!O.solar.some((s) => overlaps(s, q)), "a solar farm on a feature");
    const pad = (b) => Array.from({ length: 12 }, (_, j) => [b.x + 9 * Math.cos(j * CityGen.TAU / 12), b.y + 9 * Math.sin(j * CityGen.TAU / 12)]);
    assert.ok(!O.blimps.some((b) => overlaps(pad(b), q)), "a blimp pad on a feature");
  }
  assert.equal(O.trees.length, O.instances.length, "trees and instances out of step");
});

test("Indigo not growing: no arcology, no dye garden, no pine", () => {
  const [, o] = withPlan((q) => { q.districts.find((d) => d.id === "park").colleges.indigo.grow = false; });
  assert.equal(arcologies(o).length, 0);
  assert.equal(dyeGardens(o).length, 0);
  assert.equal(pines(o).length, 0);
  assert.ok(!o.objects.some((ob) => ob.prims.some((p) => p.m === "dye")), "dye beds without a garden");
});

test("Indigo's landmark off: no arcology or pines, but the dye gardens stay", () => {
  const [, o] = withPlan((q) => { q.districts.find((d) => d.id === "park").colleges.indigo.landmark = false; });
  assert.equal(arcologies(o).length, 0);
  assert.equal(pines(o).length, 0);
  const g = dyeGardens(o);
  assert.ok(g.length >= 2);
  // no bare reserved square where the arcology would have stood: the only 4-gon no-plant zones in Indigo's
  // orchard band are the gardens (solar patches and blimp pads have more corners)
  const quads = o.noPlant.filter((q) => q.length === 4 && inOrchard(mid(q)) && sectorCollege(plan, ...mid(q)) === "indigo");
  assert.equal(quads.length, g.length, `${quads.length} reserved squares for ${g.length} gardens`);
  assert.ok(quads.every((q) => g.some((l) => JSON.stringify(l.poly) === JSON.stringify(q))), "a reserved zone that isn't a garden");
});

test("with five or eight spokes nothing throws and there is at most one arcology", () => {
  for (const count of [5, 8]) {
    let o;
    assert.doesNotThrow(() => { [, o] = withPlan((q) => { q.spokes.count = count; }); });
    assert.ok(arcologies(o).length <= 1, `${count} spokes`);
    assert.ok(dyeGardens(o).length <= 4, `${count} spokes`);
  }
});

test("with a 300 m Lantern the arcology and its pines stay below the heart", () => {
  const [p, o] = withPlan((q) => { core(q).lantern = { ...(core(q).lantern || {}), height: 300 }; });
  const l = arcologies(o)[0];
  assert.ok(l, "no arcology");
  assert.ok(l.top < o.lantern.heart[1], `arcology top ${l.top} vs heart ${o.lantern.heart[1]}`);
  assert.ok(lotPrims(o, l).every((pr) => primTop(pr) < o.lantern.heart[1]));
  assert.ok(pines(o).every((i) => i.z + 10 * i.scale < o.lantern.heart[1]), "a pine pokes past the heart");
  for (const x of o.lots.filter((x) => x.college)) assert.ok(x.top < o.lantern.heart[1], `${x.key || x.label} top ${x.top}`);
  assert.ok(parkLots(o, "indigo", p).length > 0);
});
