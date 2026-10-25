const test = require("node:test"), assert = require("node:assert/strict");
const { loadPlan, gen } = require("./helpers.js");

test("every spoke range starts at the first ring avenue", () => { const o = gen(loadPlan());
  assert.ok(o.spokes.length > 0);
  for (const s of o.spokes) for (const [r0] of s.ranges) assert.ok(r0 >= 222, `spoke ${s.k} range starts at ${r0}`);
  assert.equal(o.spokes[0].ranges[0][0], 222); });
test("hero fill stays outside Old Town", () => { const o = gen(loadPlan());
  assert.ok(o.heroFill.length > 0);
  for (const q of o.heroFill) for (const [x, y] of q) assert.ok(Math.hypot(x, y) >= 459, `corner at r ${Math.hypot(x, y)}`); });
test("no spoke instance inside Old Town", () => { const o = gen(loadPlan());
  for (const it of o.instances) if (it.coll === "spokes") assert.ok(Math.hypot(it.x, it.y) >= 232, `instance at r ${Math.hypot(it.x, it.y)}`); });
