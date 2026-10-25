const test = require("node:test"), assert = require("node:assert/strict");
const { CityGen, loadPlan, gen, core } = require("./helpers.js");

test("core is Old Town", () => { const p = loadPlan(), d = core(p);
  assert.equal(d.name, "Old Town"); assert.equal(d.type, "oldtown");
  assert.deepEqual(d.neighbourhood.names, ["Old Town"]);
  assert.equal(p.scene.rings.find(r => r.id === "island").label, "Old Town");
  assert.equal(p.scene.rings.find(r => r.id === "inner_water").label, "First ring canal"); });
test("one ring avenue by default", () => { const L = CityGen.ringLayout(loadPlan(), core(loadPlan()));
  assert.equal(L.avenues.length, 1); assert.equal(L.avenues[0].r, 232);
  assert.deepEqual(L.bands.map(b => [b.r0, b.r1]), [[0, 222], [242, 448]]); });
test("helpers exported", () => { for (const f of ["oldTownConfig","polar","inCorridor","edgeAngle"]) assert.equal(typeof CityGen[f], "function"); });
test("second avenue switch", () => { const p = loadPlan(); core(p).second_avenue = true;
  assert.equal(CityGen.ringLayout(p, core(p)).avenues.length, 2); });
test("defaults for an old store doc", () => { const p = loadPlan(), d = core(p);
  for (const k of ["grid","quarters","heights","lantern","landmarks","second_avenue"]) delete d[k];
  const c = CityGen.oldTownConfig(d); assert.equal(c.lantern.height, 500); assert.equal(c.lantern.taper, 0.82);
  assert.equal(c.quarters.count, 15); assert.deepEqual(c.grid.forms, {});
  assert.doesNotThrow(() => gen(p)); });
