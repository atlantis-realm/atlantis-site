const test = require("node:test"), assert = require("node:assert/strict");
const { CityGen, loadPlan, gen, core, ringR, primsOf, primTop } = require("./helpers.js");

const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;
const ptsOf = (p) => (p.t === "prism" ? p.poly : p.t === "solid" ? p.top : p.rings.flat());
const z0Of = (p) => (p.t === "prism" ? p.z0 : p.t === "solid" ? Math.min(...p.bot) : Math.min(...p.rings.flat().map((q) => q[2])));
function inPoly(x, y, q) {
  let ins = false;
  for (let a = 0, c = q.length - 1; a < q.length; c = a++) if ((q[a][1] > y) !== (q[c][1] > y) && x < (q[c][0] - q[a][0]) * (y - q[a][1]) / (q[c][1] - q[a][1]) + q[a][0]) ins = !ins;
  return ins;
}
const O = gen(loadPlan());

test("Lantern is 500 m tall and 60 m across", () => { const L = O.lantern;
  assert.ok(near(L.top - L.base, 500)); assert.ok(near(L.r_base, 30));
  assert.ok(near(L.base, CityGen.makeTerrain(loadPlan()).G(0))); });
test("heart spans 40–80 % of the height", () => { const L = O.lantern;
  assert.ok(near(L.heart[0], L.base + 200)); assert.ok(near(L.heart[1], L.base + 400)); });
test("heart glows", () => assert.ok(primsOf(O, "NBHD_core_lantern").some((p) => p.m === "glow")));
test("compute bands are gold", () => assert.ok(primsOf(O, "NBHD_core_lantern").filter((p) => p.m === "gold").length >= 10));
test("Lantern lot is the city's tallest", () => { const lot = O.lots.find((l) => l.kind === "lantern");
  assert.ok(lot); assert.equal(lot.d, "core"); assert.ok(near(lot.top, O.lantern.top));
  for (const l of O.lots) if (l !== lot) assert.ok(l.top < lot.top, `${l.key} top ${l.top}`); });
test("taper sets top radius", () => {
  assert.ok(near(O.lantern.r_top / O.lantern.r_base, 0.82));
  const p = loadPlan(); core(p).lantern.taper = 0.7; const o = gen(p);
  assert.ok(near(o.lantern.r_top / o.lantern.r_base, 0.7)); });
test("crown: radiator fins round a mast", () => { const L = O.lantern, H = L.top - L.base, P = primsOf(O, "NBHD_core_lantern");
  const fins = P.filter((p) => p.t === "prism" && p.m === "lip" && p.z0 >= L.base + 0.92 * H - 1e-6);
  assert.ok(fins.length >= 8, `${fins.length} fins`);
  assert.ok(P.some((p) => near(primTop(p), L.top)), "no mast reaches the top"); });
test("public hall at the foot, on the square", () => { const L = O.lantern, P = primsOf(O, "NBHD_core_lantern");
  const hall = P.filter((p) => near(z0Of(p), L.base, 0.5) && primTop(p) - z0Of(p) >= 15 && primTop(p) - z0Of(p) <= 25
    && ptsOf(p).every(([x, y]) => ringR(x, y) > L.r_base && inPoly(x, y, L.square)));
  assert.ok(hall.length >= 1); });
test("square snaps outward to the grid's street lines", () => { const L = O.lantern, g = core(loadPlan()).grid, pitch = g.block + g.street;
  const half = Math.ceil(g.square / 2 / pitch) * pitch;  // 58 m for the defaults
  assert.equal(L.square.length, 4);
  for (const [x, y] of L.square) assert.ok(near(ringR(x, y), half * Math.SQRT2)); });
test("oldTownCap", () => { const p = loadPlan(), ter = CityGen.makeTerrain(p);
  assert.ok(near(CityGen.oldTownCap(p, ter, core(p)), ter.G(0) + 500 * 0.8 - 60));
  assert.ok(near(CityGen.oldTownCap(p, ter, core(p)), 424)); });
test("ground stops at the canal edge", () => { const P = primsOf(O, "NBHD_core_ground");
  assert.ok(P.length > 0);
  for (const p of P) for (const [x, y] of ptsOf(p)) assert.ok(ringR(x, y) <= 460 + 1e-6, `ground at r ${ringR(x, y)}`); });
test("canal wall at r 458.8–460 down to the water", () => { const P = primsOf(O, "NBHD_core_ground");
  const wall = P.filter((p) => p.t === "prism" && near(p.z0, 57.5, 0.01) && p.poly.every(([x, y]) => ringR(x, y) >= 458.8 - 1e-6 && ringR(x, y) <= 460 + 1e-6));
  assert.ok(wall.length > 20, `${wall.length} wall segments`); });
test("canal wall breaks at the spokes", () => { const p = loadPlan(), sp = CityGen.spokeAngles(p);
  const wall = primsOf(O, "NBHD_core_ground").filter((q) => q.t === "prism" && near(q.z0, 57.5, 0.01));
  assert.ok(wall.length > 0);
  for (const w of wall) { const x = w.poly.reduce((t, q) => t + q[0], 0) / w.poly.length, y = w.poly.reduce((t, q) => t + q[1], 0) / w.poly.length;
    assert.ok(!CityGen.inCorridor(p, sp, x, y, 0), `wall in a spoke corridor at ${x},${y}`); } });
test("deck, quay wall and garden ring are gone", () => {
  assert.equal(O.objects.filter((ob) => ob.name === "NBHD_core_deck").length, 0);
  assert.ok(O.objects.some((ob) => ob.name === "NBHD_core_lantern" && ob.coll === "core"));
  assert.ok(O.objects.some((ob) => ob.name === "NBHD_core_ground" && ob.coll === "core")); });
