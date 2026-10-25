const test = require("node:test"), assert = require("node:assert/strict");
const { CityGen, loadPlan, gen, core, ringR, assertUnderCap } = require("./helpers.js");

const plan = loadPlan(), O = gen(plan), cfg = CityGen.oldTownConfig(core(plan)).grid;
const hero = CityGen.spokeAngles(plan).find((s) => s.hero), ha = hero.a;
const pitch = cfg.block + cfg.street, gridR = 232 - 20 / 2 - 2, rimR = gridR * Math.cos(Math.PI / 48);
const gridLots = (o) => o.lots.filter((l) => l.d === "core" && l.zone === "grid");
const towerLots = (o) => gridLots(o).filter((l) => l.kind !== "plaza");
// hero frame: u along the hero bearing, v across it
const uv = ([x, y], a = ha) => [x * Math.cos(a) + y * Math.sin(a), -x * Math.sin(a) + y * Math.cos(a)];
const area = (p) => Math.abs(p.reduce((s, a, i) => { const b = p[(i + 1) % p.length]; return s + a[0] * b[1] - b[0] * a[1]; }, 0)) / 2;
function segDist(p, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1], L2 = dx * dx + dy * dy, t = L2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L2)) : 0;
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
}
const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
const segsCross = (a, b, c, d) => cross(a, b, c) * cross(a, b, d) < 0 && cross(c, d, a) * cross(c, d, b) < 0;
function segPolyDist(a, b, poly) {
  let m = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const c = poly[i], d = poly[(i + 1) % poly.length];
    if (segsCross(a, b, c, d)) return 0;
    m = Math.min(m, segDist(a, c, d), segDist(b, c, d), segDist(c, a, b), segDist(d, a, b));
  }
  return m;
}
function check(o, p) {
  const c = CityGen.oldTownConfig(core(p)).grid, pt = c.block + c.street, n = Math.ceil(c.square / 2 / pt);
  const sq = (2 * n * pt) ** 2, est = (Math.PI * gridR ** 2 - sq) / pt ** 2, cnt = towerLots(o).length;
  return { est, cnt, ok: cnt >= 0.7 * est && cnt <= 1.4 * est };
}

test("oldTownGrid lays out keyed grid blocks and the square", () => {
  const g = CityGen.oldTownGrid(plan, core(plan), hero);
  assert.ok(Math.abs(g.gridR - gridR) < 1e-9);
  assert.ok(g.blocks.length > 0);
  for (const b of g.blocks) {
    assert.equal(b.key, `core|g|${b.i}|${b.j}`); assert.equal(b.zone, "grid"); assert.equal(typeof b.fragment, "boolean");
    assert.equal(b.fragment, area(b.poly) < 300);
  }
  assert.equal(g.square.length, 4);
});
test("trimmed, never dropped: every block cell reaching into the disc is kept", () => {
  const g = CityGen.oldTownGrid(plan, core(plan), hero), keys = new Set(g.blocks.map((b) => b.key)), n = Math.ceil(cfg.square / 2 / pitch), h = cfg.block / 2;
  const K = Math.ceil(gridR / pitch) + 1;
  for (let i = -K; i < K; i++) for (let j = -K; j < K; j++) {
    if (i >= -n && i < n && j >= -n && j < n) { assert.ok(!keys.has(`core|g|${i}|${j}`), `block ${i},${j} inside the square`); continue; }
    const cu = (i + 0.5) * pitch, cv = (j + 0.5) * pitch;
    const nu = Math.max(0, Math.abs(cu) - h), nv = Math.max(0, Math.abs(cv) - h);
    if (Math.hypot(nu, nv) < rimR - 1) assert.ok(keys.has(`core|g|${i}|${j}`), `block ${i},${j} dropped`);
  }
});
test("grid lot corners stay inside r 222", () => {
  assert.ok(gridLots(O).length > 0);
  for (const l of gridLots(O)) for (const [x, y] of l.poly) assert.ok(ringR(x, y) <= 222 + 1e-6, `${l.key} corner at r ${ringR(x, y)}`);
});
test("the square snaps to whole pitches, holds the Lantern and no grid lot", () => {
  const S = O.lantern.square, half = Math.max(...S.map((q) => Math.abs(uv(q)[0])));
  assert.ok(O.squares.includes(S), "square not in o.squares");
  assert.ok(Math.abs(half / pitch - Math.round(half / pitch)) < 1e-9, `half-size ${half}`);
  assert.equal(Math.round(half / pitch), Math.ceil(cfg.square / 2 / pitch));
  for (const q of S) { const [u, v] = uv(q); assert.ok(Math.abs(Math.abs(u) - half) < 1e-9 && Math.abs(Math.abs(v) - half) < 1e-9); }
  for (const l of gridLots(O)) {
    const P = l.poly.map((q) => uv(q)), us = P.map((q) => q[0]), vs = P.map((q) => q[1]);
    const apart = Math.min(...us) >= half || Math.max(...us) <= -half || Math.min(...vs) >= half || Math.max(...vs) <= -half;
    assert.ok(apart, `${l.key} reaches into the square`);
  }
});
test("grid lot edges run on the hero bearing or square to it", () => {
  const tol = CityGen.rad(0.5);
  for (const l of gridLots(O)) for (let i = 0; i < l.poly.length; i++) {
    const a = l.poly[i], b = l.poly[(i + 1) % l.poly.length], m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    if (Math.hypot(b[0] - a[0], b[1] - a[1]) < 0.5 || ringR(...m) >= rimR - 0.05) continue;  // circle-clip edge
    const ang = Math.atan2(b[1] - a[1], b[0] - a[0]) - ha, off = Math.abs(((ang % (Math.PI / 2)) + Math.PI / 2 + Math.PI / 4) % (Math.PI / 2) - Math.PI / 4);
    assert.ok(off <= tol, `${l.key} edge ${i} off by ${off * 180 / Math.PI}°`);
  }
});
test("grid tower footprints run on the hero bearing or square to it", () => {
  const tol = CityGen.rad(0.5);
  assert.ok(towerLots(O).length > 0);
  for (const l of towerLots(O)) for (let i = 0; i < l.tower.length; i++) {
    const a = l.tower[i], b = l.tower[(i + 1) % l.tower.length];
    if (Math.hypot(b[0] - a[0], b[1] - a[1]) < 0.5) continue;
    const ang = Math.atan2(b[1] - a[1], b[0] - a[0]) - ha, off = Math.abs(((ang % (Math.PI / 2)) + Math.PI / 2 + Math.PI / 4) % (Math.PI / 2) - Math.PI / 4);
    assert.ok(off <= tol, `${l.key} tower edge ${i} off by ${off * 180 / Math.PI}°`);
  }
});
test("the hero street runs clear through the grid on a street centreline", () => {
  const end = CityGen.polar(222, ha);
  for (const l of gridLots(O)) assert.ok(segPolyDist([0, 0], end, l.poly) >= 5, `${l.key} within 5 m of the hero street`);
  // block centres sit at (k + 0.5)·pitch across the hero bearing, so v = 0 is a street centreline
  const full = CityGen.oldTownGrid(plan, core(plan), hero).blocks.filter((b) => Math.abs(area(b.poly) - cfg.block ** 2) < 1e-6);
  assert.ok(full.length > 10);
  for (const b of full) {
    const c = b.poly.reduce((s, q) => [s[0] + q[0] / b.poly.length, s[1] + q[1] / b.poly.length], [0, 0]), v = uv(c)[1];
    const off = v / pitch - 0.5 - Math.round(v / pitch - 0.5);
    assert.ok(Math.abs(off) < 1e-9, `${b.key} centre off the grid by ${off * pitch} m`);
  }
});
test("coverage: grid lots fill the disc bar the streets and square", () => {
  const n = Math.ceil(cfg.square / 2 / pitch), sq = (2 * n * pitch) ** 2;
  const tot = gridLots(O).reduce((s, l) => s + area(l.poly), 0), want = 0.9 * (cfg.block / pitch) ** 2 * (Math.PI * gridR ** 2 - sq);
  assert.ok(tot >= want, `covered ${tot} < ${want}`);
});
test("fragments under 300 m² are plazas, never towers", () => {
  for (const l of gridLots(O)) if (area(l.poly) < 300) assert.equal(l.kind, "plaza", `${l.key} area ${area(l.poly)}`);
  for (const l of towerLots(O)) assert.ok(l.area >= 300, `${l.key} tower on ${l.area} m²`);
  for (const l of gridLots(O).filter((q) => q.kind === "plaza")) assert.ok(l.storeys <= 2 && !l.tower, `${l.key} plaza too tall`);
});
test("tower count matches the grid estimate", () => {
  const r = check(O, plan);
  assert.ok(r.ok, `${r.cnt} towers vs est ${r.est}`);
  const p = loadPlan(); Object.assign(core(p).grid, { block: 40, street: 10 });
  const r2 = check(gen(p), p);
  assert.ok(r2.ok, `block 40 / street 10: ${r2.cnt} towers vs est ${r2.est}`);
});
test("grid towers are 120–220 m before the cloud", () => {
  const C = plan.cloud, mx = Math.pow(2, (C.amount || 0) * (C.tower_share ?? 1));
  assert.ok(towerLots(O).length > 0);
  for (const l of towerLots(O)) {
    assert.ok(l.height <= 220 * mx + 1e-6 && l.height >= 0.6 * 120, `${l.key} height ${l.height}`);
    assert.ok(l.top > l.podiumTop && l.podiumTop > l.base, `${l.key} levels`);
    assert.equal(l.tower.length, 4); assert.ok(l.crown.length >= 3);
  }
  assert.ok(O.bands["core|grid"] && O.bands["core|grid"].n === towerLots(O).length);
});
test("Old Town stays under the cap", () => assertUnderCap(O, plan));
test("a 300 m Lantern still outranks the whole city", () => {
  const p = loadPlan(); core(p).lantern.height = 300; const o = gen(p);
  assertUnderCap(o, p);
  for (const l of o.lots) if (l.kind !== "lantern") assert.ok(l.top <= o.lantern.heart[1] + 1e-6, `${l.d} ${l.key} top ${l.top} over heart ${o.lantern.heart[1]}`);
  assert.ok(towerLots(o).some((l) => l.capped), "no tower was capped");
  assert.ok(o.warnings.some((w) => /heart/.test(w)), o.warnings.join("\n"));
});
test("same plan in, same lots out", () => {
  const a = gen(loadPlan()), b = gen(loadPlan());
  assert.deepEqual(a.lots, b.lots);
  assert.deepEqual(a.objects.filter((ob) => ob.coll === "core"), b.objects.filter((ob) => ob.coll === "core"));
});
