const test = require("node:test"), assert = require("node:assert/strict");
const { CityGen, loadPlan, gen, core, ringR, assertUnderCap } = require("./helpers.js");

const plan = loadPlan(), O = gen(plan);
const DEG = Math.PI / 180, QUARTER = Math.PI / 2;
const bandLots = (o) => o.lots.filter((l) => l.d === "core" && l.zone === "band");
const bandTowers = (o) => bandLots(o).filter((l) => l.kind !== "plaza");
const towerLots = (o) => o.lots.filter((l) => l.d === "core" && (l.zone === "grid" || l.zone === "band") && l.kind !== "plaza");
const typeIds = plan.neighbourhoods.types.map((t) => t.id);
const centroid = (p) => {
  let A = 0, x = 0, y = 0;
  for (let i = 0; i < p.length; i++) { const a = p[i], b = p[(i + 1) % p.length], c = a[0] * b[1] - b[0] * a[1]; A += c; x += (a[0] + b[0]) * c; y += (a[1] + b[1]) * c; }
  return [x / (3 * A), y / (3 * A)];
};
// how far angle a is from b's grid directions (b or b + 90°), in [0, 45°]
const offGrid = (a, b) => { const m = (((a - b) % QUARTER) + QUARTER) % QUARTER; return Math.min(m, QUARTER - m); };
const edges = (p) => p.map((a, i) => [a, p[(i + 1) % p.length]]);
const edgeAng = ([a, b]) => Math.atan2(b[1] - a[1], b[0] - a[0]);
const len = ([a, b]) => Math.hypot(b[0] - a[0], b[1] - a[1]);
// distance from the origin to the line through an edge
const lineDist = ([a, b]) => Math.abs(a[0] * b[1] - a[1] * b[0]) / len([a, b]);
const withCore = (f) => { const p = loadPlan(); f(core(p), p); return p; };

function checkBounds(o, p) {
  const spokes = CityGen.spokeAngles(p);
  assert.ok(bandLots(o).length > 30, `only ${bandLots(o).length} band lots`);
  for (const l of bandLots(o)) for (const [x, y] of l.poly) {
    assert.equal(CityGen.inCorridor(p, spokes, x, y, 0), false, `${l.key} corner in a spoke corridor`);
    const r = ringR(x, y);
    assert.ok(r >= 242 - 1e-6 && r <= 448 + 1e-6, `${l.key} corner at r ${r}`);
  }
}

test("oldTownQuarters lays out the quarters and keyed band blocks", () => {
  const Q = CityGen.oldTownQuarters(plan, core(plan), CityGen.spokeAngles(plan));
  assert.equal(Q.quarters.length, 15);
  for (const q of Q.quarters) {
    for (const f of ["k", "a0", "a1", "angle", "block", "culture", "poly"]) assert.ok(f in q, `quarter missing ${f}`);
    assert.ok(typeIds.includes(q.culture), q.culture);
    assert.ok(q.angle >= 0 && q.angle < QUARTER, `angle ${q.angle}`);
  }
  assert.ok(Q.blocks.length > 0);
  for (const b of Q.blocks) {
    assert.equal(b.zone, "band"); assert.ok(b.key.startsWith(`core|q|${b.quarter}|`), b.key);
    assert.equal(b.culture, Q.quarters[b.quarter].culture);
  }
  assert.equal(O.quarters.length, 15);
  for (const q of O.quarters) for (const f of ["k", "culture", "poly", "angle"]) assert.ok(f in q);
  assert.ok(O.bands["core|band"] && O.bands["core|band"].n === bandTowers(O).length);
});

test("every spoke bearing is a quarter boundary", () => {
  for (const p of [plan, withCore((d, pl) => { pl.spokes.count = 5; })]) {
    const spokes = CityGen.spokeAngles(p), Q = CityGen.oldTownQuarters(p, core(p), spokes).quarters;
    for (const s of spokes) assert.ok(Q.some((q) => CityGen.angDist(q.a0, s.a) < 1e-6), `spoke ${s.k} not a boundary`);
  }
});

test("band lots stay clear of spoke corridors, the avenue and the quay", () => checkBounds(O, plan));

test("lots carry their quarter's culture and key", () => {
  for (const l of bandLots(O)) {
    assert.equal(l.culture, O.quarters[l.quarter].culture, l.key);
    assert.ok(l.key.startsWith(`core|q|${l.quarter}|`), l.key);
    assert.equal(l.form, l.culture);
  }
  assert.ok(new Set(O.quarters.map((q) => q.culture)).size >= 3);
  assert.ok(new Set(bandLots(O).map((l) => l.culture)).size >= 3);
});

test("patchwork angles: no quarter reads radial or ring-following", () => {
  const Q = CityGen.oldTownQuarters(plan, core(plan), CityGen.spokeAngles(plan)).quarters;
  for (const q of Q) {
    const [cx, cy] = centroid(q.poly), off = offGrid(q.angle, Math.atan2(cy, cx));
    assert.ok(off >= 12 * DEG - 1e-9, `quarter ${q.k} only ${off / DEG}° off radial`);
  }
  assert.ok(new Set(Q.map((q) => Math.round(q.angle / DEG))).size >= 3);
  assert.ok(new Set(Q.map((q) => Math.round(q.block))).size >= 3);
  for (const q of Q) assert.ok(q.block >= 30 - 1e-9 && q.block <= 46 + 1e-9, `block ${q.block}`);
});

test("lot edges follow the quarter grid, bar the clip edges", () => {
  const S = plan.spokes, rim = 448 - 2;
  // the lines the clips cut along, by distance from the centre: seam streets (half a 10 m street off the
  // slice ray), spoke corridors (blockHalf + 2), the first ring avenue (242 + 2) and the quay rim (a 96-gon)
  const clip = [5, S.corridor_half + 2, Math.max(S.hero_block_half, S.corridor_half) + 2, 244];
  let checked = 0;
  for (const l of bandLots(O)) {
    const qa = O.quarters[l.quarter].angle;
    for (const e of edges(l.poly)) {
      if (len(e) <= 4) continue;
      const d = lineDist(e);
      if (clip.some((c) => Math.abs(d - c) < 0.01) || (d >= rim * Math.cos(Math.PI / 96) - 0.01 && d <= rim + 0.01)) continue;
      checked++;
      assert.ok(offGrid(edgeAng(e), qa) <= 1 * DEG, `${l.key} edge ${offGrid(edgeAng(e), qa) / DEG}° off its quarter`);
    }
  }
  assert.ok(checked > 100, `only ${checked} grid edges checked`);
});

test("band tower footprints line up with their quarter", () => {
  for (const l of bandTowers(O)) {
    assert.equal(l.tower.length, 4);
    for (const e of edges(l.tower)) if (len(e) > 0.5)
      assert.ok(offGrid(edgeAng(e), O.quarters[l.quarter].angle) <= 0.5 * DEG, `${l.key} tower edge off its quarter`);
  }
});

test("band lots cover a fair share of the band", () => {
  const S = plan.spokes, band = Math.PI * (448 ** 2 - 242 ** 2);
  const spokesArea = (5 * 2 * S.corridor_half + 2 * Math.max(S.hero_block_half, S.corridor_half)) * (448 - 242);
  const tot = bandLots(O).reduce((s, l) => s + l.area, 0);
  assert.ok(tot >= 0.4 * (band - spokesArea), `covered ${tot} of ${band - spokesArea}`);
});

test("culture shows in block size and roofs", () => {
  const p = withCore((d) => { d.quarters.cultures = ["works", "gardens"]; }), o = gen(p);
  assert.equal(o.quarters[0].culture, "works"); assert.equal(o.quarters[1].culture, "gardens");
  const Q = CityGen.oldTownQuarters(p, core(p), CityGen.spokeAngles(p)).quarters;
  assert.ok(Q[0].block > Q[1].block, `works ${Q[0].block} vs gardens ${Q[1].block}`);
  assert.ok(Q[0].block >= 36 - 1e-9 && Q[1].block <= 33.5 + 1e-9);
});

test("culture shows in podium roofs: over seeds 1–10, each forced quarter's commonest is its culture's top roof", () => {
  const roofsOf = (id) => plan.neighbourhoods.types.find((t) => t.id === id).style.roofs;
  const topKind = (id) => Object.entries(roofsOf(id)).sort((a, b) => b[1] - a[1])[0][0];
  assert.equal(topKind("works"), "farm"); assert.equal(topKind("gardens"), "garden");
  // totals over the seeds, so one seed's draw (or a change in how much rng a tower consumes) can't flip it
  const n = { works: {}, gardens: {} };
  for (let seed = 1; seed <= 10; seed++) {
    const p = withCore((d) => { d.quarters.cultures = ["works", "gardens"]; d.quarters.seed = seed; }), o = CityGen.generate(p);
    for (const [k, id] of [[0, "works"], [1, "gardens"]])
      for (const l of o.lots) if (l.d === "core" && l.zone === "band" && l.quarter === k && l.podiumRoof) n[id][l.podiumRoof] = (n[id][l.podiumRoof] || 0) + 1;
  }
  for (const id of ["works", "gardens"]) {
    const ranked = Object.entries(n[id]).sort((a, b) => b[1] - a[1]);
    assert.ok(ranked.length, `no podium roofs in the ${id} quarters`);
    assert.equal(ranked[0][0], topKind(id), `${id} podium roofs ${JSON.stringify(n[id])}`);
    assert.ok(!ranked[1] || ranked[1][1] < ranked[0][1], `${id} tie ${JSON.stringify(n[id])}`);
  }
});

test("every multi-tier tower roofs a lower setback terrace from its culture's mix", () => {
  const style = (id) => plan.neighbourhoods.types.find((t) => t.id === id).style;
  const plans = new Set();
  for (const o of [O, gen(withCore((d) => { d.lantern.height = 300; }))]) {
    for (const l of towerLots(o)) {
      const st = style(l.form);
      if (!(st.tower.tiers > 1) || !l.plan) continue;
      plans.add(l.plan);
      assert.ok(l.terraces.length > 0, `${l.key} (${l.plan}, ${l.form}) has no roofed terrace`);
      for (const k of l.terraces) assert.ok(st.roofs[k] > 0, `${l.key} terrace roof ${k} not in the ${l.form} mix`);
    }
  }
  for (const pl of ["rect", "stepped", "round", "twin"]) assert.ok(plans.has(pl), `no multi-tier ${pl} tower`);
});

test("grid towers take a mix of culture forms", () => {
  const grid = (o) => towerLots(o).filter((l) => l.zone === "grid");
  for (const l of grid(O)) assert.ok(typeIds.includes(l.form), `${l.key} form ${l.form}`);
  assert.ok(new Set(grid(O).map((l) => l.form)).size >= 4);
  const p = withCore((d) => { d.grid.forms = { works: 1 }; }), o = gen(p);
  assert.ok(grid(o).length > 0);
  for (const l of grid(o)) assert.equal(l.form, "works");
});

test("tower massing differs by form", () => {
  const sig = new Set(), plans = new Set(), crowns = new Set();
  for (const l of towerLots(O)) {
    const ob = O.objects.find((b) => b.name === l.obj);
    assert.ok(ob, `${l.key} has no object`);
    sig.add(`${ob.prims.length}|${new Set(ob.prims.filter((q) => q.t === "prism").map((q) => Math.round(q.z1))).size}`);
    plans.add(l.plan); crowns.add(l.crownKind);
  }
  assert.ok(sig.size > 1);
  assert.ok(plans.size >= 4, `plans ${[...plans]}`);
  assert.ok(crowns.size >= 4, `crowns ${[...crowns]}`);
});

test("band towers are 200–300 m before the cloud, under the cap", () => {
  assertUnderCap(O, plan);
  const C = plan.cloud, mx = Math.pow(2, (C.amount || 0) * (C.tower_share ?? 0.5));
  assert.ok(bandTowers(O).length > 30);
  for (const l of bandTowers(O)) {
    if (l.capped) assert.ok(l.height <= 300 * mx + 1e-6, `${l.key} capped height ${l.height}`);
    else assert.ok(l.height >= 200 / mx - 1e-6 && l.height <= 300 * mx + 1e-6, `${l.key} height ${l.height}`);
    assert.ok(l.top > l.podiumTop && l.podiumTop > l.base, `${l.key} levels`);
  }
  assert.equal(O.warnings.length, 0, O.warnings.join("\n"));
});

test("eight spokes turned 15°: seams and clearances hold", () => {
  const p = withCore((d, pl) => { pl.spokes.count = 8; pl.spokes.offset_deg = 15; }), o = gen(p);
  checkBounds(o, p);
  const spokes = CityGen.spokeAngles(p), Q = CityGen.oldTownQuarters(p, core(p), spokes).quarters;
  for (const s of spokes) assert.ok(Q.some((q) => CityGen.angDist(q.a0, s.a) < 1e-6), `spoke ${s.k} not a boundary`);
  assertUnderCap(o, p);
});

test("a culture list that doesn't fit falls back to the seeded pick", () => {
  const p = withCore((d) => { d.quarters.cultures = ["works", "bogus"]; });
  let o;
  assert.doesNotThrow(() => { o = gen(p); });
  assert.equal(o.quarters[0].culture, "works");
  assert.ok(typeIds.includes(o.quarters[1].culture));
  const q = withCore((d) => { d.quarters.weights = { scholars: 1 }; });
  assert.ok(CityGen.oldTownQuarters(q, core(q), CityGen.spokeAngles(q)).quarters.every((x) => x.culture === "scholars"));
});

test("second avenue on: quarters stop either side of r 350", () => {
  const p = withCore((d) => { d.second_avenue = true; }), o = gen(p), w = 20;
  checkBounds(o, p);
  for (const l of bandLots(o)) for (const [a, b] of edges(l.poly)) for (let t = 0; t <= 1; t += 0.1) {
    const r = ringR(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t);
    assert.ok(Math.abs(r - 350) >= w / 2, `${l.key} reaches r ${r}`);
  }
  assert.ok(bandLots(o).some((l) => l.poly.every(([x, y]) => ringR(x, y) < 350)));
  assert.ok(bandLots(o).some((l) => l.poly.every(([x, y]) => ringR(x, y) > 350)));
});

test("an old store doc without quarter or tower settings still builds", () => {
  const p = loadPlan();
  delete core(p).quarters; delete core(p).grid;
  for (const t of p.neighbourhoods.types) delete t.style.tower;
  let o;
  assert.doesNotThrow(() => { o = gen(p); });
  assert.equal(o.quarters.length, 15);
  assertUnderCap(o, p);
});
