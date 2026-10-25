const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("fs"), path = require("path");
const { loadPlan, gen } = require("./helpers.js");

// build_city.py's MAT and COLL tables, parsed out of the source (the material index is the key's position)
const src = fs.readFileSync(path.join(__dirname, "..", "build_city.py"), "utf8");
const keysOf = (name) => {
  const m = src.match(new RegExp(`^${name} = \\{([\\s\\S]*?)\\}`, "m"));
  assert.ok(m, `${name} table not found in build_city.py`);
  return [...m[1].matchAll(/"([^"]+)"\s*:/g)].map((k) => k[1]);
};

test("every generated prim material is a MAT key and every object coll a COLL key", () => {
  const MAT = new Set(keysOf("MAT")), COLL = new Set(keysOf("COLL"));
  const o = gen(loadPlan());
  const badM = new Set(), badC = new Set();
  for (const ob of o.objects) {
    if (!COLL.has(ob.coll)) badC.add(ob.coll);
    for (const p of ob.prims) if (!MAT.has(p.m)) badM.add(p.m);
  }
  assert.deepEqual([...badM], [], "prim materials missing from MAT");
  assert.deepEqual([...badC], [], "colls missing from COLL");
});

test("glow and gold are appended at the end of MAT, in that order", () => {
  assert.deepEqual(keysOf("MAT").slice(-2), ["glow", "gold"]);
});
