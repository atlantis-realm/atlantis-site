const fs = require("fs"), path = require("path");
const CityGen = require("../citygen.js");
const loadPlan = () => JSON.parse(fs.readFileSync(path.join(__dirname, "..", "plan.json"), "utf8"));
const gen = (plan) => CityGen.generate(plan, { solids: true });
const core = (plan) => plan.districts.find((d) => d.id === "core");
const centre = (plan) => plan.scene.center;
const ringR = (x, y) => Math.hypot(x, y);
const primsOf = (o, namePrefix) => o.objects.filter((ob) => ob.name.startsWith(namePrefix)).flatMap((ob) => ob.prims);
const primTop = (p) => (p.t === "prism" ? p.z1 : p.t === "solid" ? Math.max(...p.top.map((q) => q[2])) : Math.max(...p.rings.flat().map((q) => q[2])));
// Old Town stays under the Lantern's heart: every core lot and core prim (bar the Lantern itself) tops out
// at or below oldTownCap. Needs at least one non-Lantern core lot, so it can't pass on an empty Old Town.
function assertUnderCap(o, plan) {
  const assert = require("node:assert/strict");
  const cap = CityGen.oldTownCap(plan, CityGen.makeTerrain(plan), core(plan));
  const lots = o.lots.filter((l) => l.d === "core" && l.kind !== "lantern");
  assert.ok(lots.length > 0, "no Old Town lots to check against the cap");
  for (const l of lots) assert.ok(l.top <= cap + 1e-6, `lot ${l.key || l.kind} top ${l.top} over cap ${cap}`);
  for (const ob of o.objects) if (ob.coll === "core" && !ob.name.startsWith("NBHD_core_lantern"))
    for (const p of ob.prims) assert.ok(primTop(p) <= cap + 1e-6, `${ob.name} prim top ${primTop(p)} over cap ${cap}`);
}
module.exports = { CityGen, loadPlan, gen, core, ringR, primsOf, centre, primTop, assertUnderCap };
