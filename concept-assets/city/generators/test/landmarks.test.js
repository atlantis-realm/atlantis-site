const test = require("node:test"), assert = require("node:assert/strict");
const { CityGen, loadPlan, gen, core, primTop, assertUnderCap } = require("./helpers.js");

const plan = loadPlan(), O = gen(plan), D = core(plan), cfg = CityGen.oldTownConfig(D);
const spokes = CityGen.spokeAngles(plan), hero = spokes.find((s) => s.hero), ha = hero.a;
const grid = CityGen.oldTownGrid(plan, D, hero), qs = CityGen.oldTownQuarters(plan, D, spokes);
const blocks = [...grid.blocks, ...qs.blocks], byKey = new Map(blocks.map((b) => [b.key, b]));
const cap = CityGen.oldTownCap(plan, CityGen.makeTerrain(plan), D);
const landmarks = (o) => o.lots.filter((l) => l.d === "core" && l.kind === "landmark");
const LM = landmarks(O), of = (k) => LM.filter((l) => l.landmark === k);
const objOf = (o, l) => o.objects.find((ob) => ob.name === l.obj);
const PARTS = ["colonnade", "forecourt"];

// hero frame: u along the hero bearing (positive towards the hero avenue), v across it
const uv = ([x, y]) => [x * Math.cos(ha) + y * Math.sin(ha), -x * Math.sin(ha) + y * Math.cos(ha)];
const area = (p) => Math.abs(p.reduce((s, a, i) => { const b = p[(i + 1) % p.length]; return s + a[0] * b[1] - b[0] * a[1]; }, 0)) / 2;
const centroid = (p) => {
  let A = 0, x = 0, y = 0;
  for (let i = 0; i < p.length; i++) { const a = p[i], b = p[(i + 1) % p.length], c = a[0] * b[1] - b[0] * a[1]; A += c; x += (a[0] + b[0]) * c; y += (a[1] + b[1]) * c; }
  return [x / (3 * A), y / (3 * A)];
};
function segDist(p, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1], L2 = dx * dx + dy * dy, t = L2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L2)) : 0;
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
}
// distance between two disjoint polygons (vertex to edge, both ways)
const edges = (p) => p.map((a, i) => [a, p[(i + 1) % p.length]]);
const polyDist = (P, Q) => Math.min(...P.flatMap((p) => edges(Q).map(([a, b]) => segDist(p, a, b))), ...Q.flatMap((q) => edges(P).map(([a, b]) => segDist(q, a, b))));
// distance from point p to the infinite line through a, b
const lineDist = (p, [a, b]) => Math.abs((b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0])) / Math.hypot(b[0] - a[0], b[1] - a[1]);

test("oldTownLandmarks assigns kinds to block keys, and the lots match", () => {
  const A = CityGen.oldTownLandmarks(plan, D, blocks, grid.square, hero);
  assert.ok(Array.isArray(A) && A.length > 0);
  for (const a of A) {
    for (const f of ["kind", "label", "keys", "culture"]) assert.ok(f in a, `assignment missing ${f}`);
    for (const k of a.keys) { assert.ok(byKey.has(k), `unknown key ${k}`); assert.equal(byKey.get(k).fragment, false, `${a.kind} on fragment ${k}`); }
  }
  assert.deepEqual(A.map((a) => [a.kind, a.keys.join(",")]), LM.map((l) => [l.landmark, l.keys.join(",")]));
  const all = A.flatMap((a) => a.keys);
  assert.equal(new Set(all).size, all.length, "a block claimed twice");
});
test("one parliament, one exchange, one courts, six embassies and six guild halls", () => {
  assert.equal(of("parliament").length, 1);
  assert.equal(of("exchange").length, 1);
  assert.equal(of("courts").length, 1);
  assert.equal(of("embassy").length, 6);
  assert.equal(of("guild").length, 6);
});
test("lot records: fields, names, no height key", () => {
  const n = {};
  assert.ok(LM.length > 0, "no landmark lots");
  for (const l of LM) {
    for (const f of ["d", "kind", "landmark", "keys", "label", "culture", "poly", "base", "eave", "top", "storeys", "area"]) assert.ok(f in l, `${l.landmark} lot missing ${f}`);
    assert.ok(!("height" in l), `${l.landmark} lot has a height key`);
    assert.ok(typeof l.label === "string" && l.label.length > 0);
    assert.ok(!/island|temple|spire/i.test(l.label), l.label);
    n[l.landmark] = n[l.landmark] || 0;
    assert.equal(l.obj, `NBHD_core_lm_${l.landmark}_${n[l.landmark]++}`);
    assert.ok(objOf(O, l), `no object ${l.obj}`);
  }
});
test("parliament, exchange and courts face the square", () => {
  for (const k of ["parliament", "exchange", "courts"])
    for (const key of of(k)[0].keys) {
      const dd = polyDist(byKey.get(key).poly, grid.square);
      assert.ok(dd <= cfg.grid.street + 1, `${k} block ${key} is ${dd} m from the square`);
    }
});
test("the parliament closes the hero axis on the far side of the square", () => {
  const P = of("parliament")[0], [u, v] = uv(centroid(P.poly));
  assert.equal(P.keys.length, 2);
  assert.ok(u < 0, `parliament along ${u}`);
  assert.ok(Math.abs(v) <= 2, `parliament ${v} m off the axis`);
  // merged across the axis street: the lot spans both sides of the axis
  const vs = P.poly.map((q) => uv(q)[1]);
  assert.ok(Math.min(...vs) < -cfg.grid.street && Math.max(...vs) > cfg.grid.street);
  assert.ok(area(P.poly) >= P.keys.reduce((s, k) => s + area(byKey.get(k).poly), 0), "merged lot smaller than its blocks");
});
test("the exchange stands beside the parliament on the same square-facing line", () => {
  const P = of("parliament")[0], X = byKey.get(of("exchange")[0].keys[0]);
  // the parliament's edge nearest the square
  const front = edges(P.poly).reduce((best, e) => { const m = [(e[0][0] + e[1][0]) / 2, (e[0][1] + e[1][1]) / 2]; const dd = Math.hypot(...m); return !best || dd < best.dd ? { e, dd } : best; }, null).e;
  assert.ok(edges(X.poly).some(([a, b]) => lineDist(a, front) < 0.01 && lineDist(b, front) < 0.01 && Math.hypot(b[0] - a[0], b[1] - a[1]) > 5), "exchange has no edge on the parliament's front line");
  assert.ok(uv(centroid(X.poly))[0] < 0, "exchange not on the far side");
});
test("the courts stand at hero − 90°", () => {
  const [u, v] = uv(centroid(of("courts")[0].poly));
  assert.ok(v < 0 && Math.abs(u) < Math.abs(v), `courts at u ${u}, v ${v}`);
});
test("embassies cover the quarter cultures, one per culture first", () => {
  const cultures = new Set(qs.quarters.map((q) => q.culture)), got = new Set(of("embassy").map((l) => l.culture));
  assert.ok(got.size >= Math.min(6, cultures.size), `embassies cover ${got.size} of ${cultures.size} cultures`);
  for (const l of [...of("embassy"), ...of("guild")]) {
    const b = byKey.get(l.keys[0]);
    assert.equal(l.keys.length, 1);
    assert.equal(b.zone, "band", `${l.landmark} on a ${b.zone} block`);
    assert.equal(b.fragment, false);
    assert.equal(l.culture, b.culture);
  }
  assert.ok(new Set(of("guild").map((l) => byKey.get(l.keys[0]).quarter)).size >= 4, "guild halls bunched in a few quarters");
});
test("heights: eave in heights.landmark, dome ≤ 20 m above it, under the cap", () => {
  const [lo, hi] = cfg.heights.landmark;
  assert.deepEqual([lo, hi], [25, 80]);
  for (const l of LM) {
    assert.ok(l.eave - l.base >= lo - 1e-6 && l.eave - l.base <= hi + 1e-6, `${l.obj} eave ${l.eave - l.base}`);
    assert.ok(l.top - l.eave <= 20 + 1e-6, `${l.obj} rises ${l.top - l.eave} above the eave`);
    assert.ok(l.top <= cap + 1e-6);
    const tops = objOf(O, l).prims.map(primTop);
    assert.ok(Math.max(...tops) <= l.top + 1e-6, `${l.obj} draws above its lot top`);
  }
  for (const k of ["parliament", "exchange"]) {
    const l = of(k)[0];
    assert.ok(objOf(O, l).prims.some((p) => p.t === "loft" && primTop(p) > l.eave + 3), `${k} has no dome or drum`);
  }
});
test("form: a broad mass over most of the block, with a colonnade or forecourt", () => {
  assert.ok(LM.length > 0, "no landmark lots");
  for (const l of LM) {
    // the parliament's block is its two blocks plus the axis street between them, i.e. its merged lot
    const blockArea = l.keys.length > 1 ? area(l.poly) : area(byKey.get(l.keys[0]).poly);
    assert.ok(Array.isArray(l.footprint), `${l.obj} has no footprint`);
    assert.ok(area(l.footprint) >= 0.75 * blockArea, `${l.obj} footprint ${area(l.footprint)} of ${blockArea}`);
    assert.ok(objOf(O, l).prims.some((p) => PARTS.includes(p.part)), `${l.obj} has no colonnade or forecourt`);
  }
});
test("embassy and guild-hall roofs come from their culture's mix", () => {
  const mix = (id) => plan.neighbourhoods.types.find((t) => t.id === id).style.roofs;
  assert.ok(of("embassy").length + of("guild").length > 0, "no embassies or guild halls");
  for (const l of [...of("embassy"), ...of("guild")]) {
    assert.ok(Array.isArray(l.roofs) && l.roofs.length > 0, `${l.obj} has no roof kinds`);
    for (const k of l.roofs) assert.ok(Object.keys(mix(l.culture)).includes(k), `${l.obj} roof ${k} not in ${l.culture}'s mix`);
  }
});
test("no double use: each non-fragment block is a landmark or a tower, never both", () => {
  const lmKeys = LM.flatMap((l) => l.keys), towerKeys = O.lots.filter((l) => l.d === "core" && l.key && l.kind !== "plaza" && l.kind !== "landmark" && l.kind !== "lantern").map((l) => l.key);
  assert.ok(lmKeys.length > 0, "no landmark keys");
  const lmSet = new Set(lmKeys), towerSet = new Set(towerKeys);
  assert.equal(lmSet.size, lmKeys.length); assert.equal(towerSet.size, towerKeys.length);
  for (const b of blocks) {
    const n = (lmSet.has(b.key) ? 1 : 0) + (towerSet.has(b.key) ? 1 : 0);
    if (b.fragment) assert.ok(!lmSet.has(b.key), `fragment ${b.key} claimed`);
    else assert.equal(n, 1, `${b.key} carries ${n} of landmark/tower`);
  }
});
test("Old Town stays under the cap with landmarks", () => assertUnderCap(O, plan));
test("landmark counts follow the settings", () => {
  const p = loadPlan();
  core(p).landmarks = { embassies: 2, guild_halls: 9 };
  const o = gen(p), L = landmarks(o);
  assert.equal(L.filter((l) => l.landmark === "embassy").length, 2);
  assert.equal(L.filter((l) => l.landmark === "guild").length, 9);
  assert.equal(new Set(L.filter((l) => l.landmark === "embassy").map((l) => l.culture)).size, 2);
  assertUnderCap(o, p);
});
