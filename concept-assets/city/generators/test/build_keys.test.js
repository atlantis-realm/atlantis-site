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

const OLD_MAT = ["stone", "plinth", "lip", "roof", "paver", "water", "road", "stair", "glass", "tile", "panel", "fabric", "glow", "gold"];
const COLLEGE_MAT = ["ashlar", "copper", "timber", "brick", "plaster_a", "plaster_b", "plaster_c", "rooftile", "canvas", "dye"];

test("the first 14 MAT keys keep their old order", () => {
  assert.deepEqual(keysOf("MAT").slice(0, 14), OLD_MAT);
});

test("the college materials are appended after gold, in order", () => {
  assert.deepEqual(keysOf("MAT").slice(14), COLLEGE_MAT);
});

test("college_palette() is defined and called in main() before MATS is built", () => {
  assert.match(src, /^def college_palette\(\):/m);
  const main = src.slice(src.indexOf("def main():"));
  const call = main.indexOf("college_palette()"), mats = main.indexOf("MATS = [");
  assert.ok(call > 0 && call < mats, "college_palette() must run before MATS is built");
});

test("build_city.py builds a procedural pine and doesn't skip asset_Plant_pine", () => {
  assert.match(src, /^PROCEDURAL_TREES = \{[^}]*"asset_Plant_pine"/m);
  assert.match(src, /^def pine_distance_tree\(/m);
  assert.ok(src.includes("MAT_AP_LeafC") && src.includes("MAT_AP_Bark"), "pine materials missing");
  const build = src.slice(src.indexOf("def build():"), src.indexOf("def cut_canals"));
  assert.match(build, /asset not in bpy\.data\.collections and asset not in PROCEDURAL_TREES/);
});

test("college_palette() only colours the new college materials, never the shared kit ones", () => {
  // MAT_AP_LeafC and MAT_AP_Bark are shared by the kit trees city-wide; the pine uses them as they are
  const m = src.match(/^COLLEGE_COLORS = \{([\s\S]*?)\}/m);
  assert.ok(m, "COLLEGE_COLORS not found");
  const names = [...m[1].matchAll(/"(MAT_[^"]+)"\s*:/g)].map((k) => k[1]);
  for (const shared of ["MAT_AP_LeafC", "MAT_AP_Bark", "MAT_AP_Grout", "MAT_AP_Paver", "MAT_AP_Water", "MAT_AP_Glow"])
    assert.ok(!names.includes(shared), `college_palette() recolours ${shared}`);
  const fn = src.slice(src.indexOf("def college_palette():"), src.indexOf("def ground_material"));
  assert.ok(!/LeafC|Bark/.test(fn), "college_palette() touches the kit tree materials");
});
