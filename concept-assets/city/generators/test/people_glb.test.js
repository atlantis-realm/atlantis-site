// Content and budget tests for the post-processed people glb (people_glb.mjs output). The glb is git-ignored
// until the look is approved, so every test skips when it is absent and CI without exports stays green.
const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("fs"), path = require("path");

const STATIC = path.join(__dirname, "..", "..", "..", "..", "static", "city");
const GLB = path.join(STATIC, "people.glb"), META = path.join(STATIC, "people_meta.json");
const SKIP = fs.existsSync(GLB) ? false : `no ${path.relative(process.cwd(), GLB)}; run export_people.py and people_glb.mjs first`;

const MAX_BYTES = 3 * 1024 * 1024;
const VARIANTS = 12, WALK_KEYS = 6;   // = PEOPLE_VARIANTS, WALK_KEYS in people_cast.py
const HEIGHT = [1.4, 2.0];            // m
const EXCLUDED = /Killer|Monster|Exotic/i;

let loaded;
function load() {
  return (loaded ||= (async () => {
    const { NodeIO } = await import("@gltf-transform/core");
    const { ALL_EXTENSIONS } = await import("@gltf-transform/extensions");
    const { MeshoptDecoder } = await import("meshoptimizer");
    await MeshoptDecoder.ready;
    const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ "meshopt.decoder": MeshoptDecoder });
    const doc = await io.read(GLB);
    return { doc, root: doc.getRoot(), meta: JSON.parse(fs.readFileSync(META, "utf8")) };
  })());
}
const meshNodes = (root) => root.listNodes().filter((n) => n.getMesh());

// Positions in metres: KHR_mesh_quantization stores them scaled, with the node transform undoing it.
function worldY(node, prim, target) {
  const m = node.getWorldMatrix(), el = [], base = prim.getAttribute("POSITION");
  const delta = target ? target.getAttribute("POSITION") : null, d = [];
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < base.getCount(); i++) {
    const p = base.getElement(i, el).slice();
    if (delta) { delta.getElement(i, d); for (let k = 0; k < 3; k++) p[k] += d[k]; }
    const y = m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13];
    lo = Math.min(lo, y); hi = Math.max(hi, y);
  }
  return [lo, hi];
}

test("people glb within 3 MB", { skip: SKIP }, () => {
  assert.ok(fs.statSync(GLB).size <= MAX_BYTES, `${fs.statSync(GLB).size} bytes`);
});

test("12 PEOPLE_ meshes, none of them a Killer, Monster or Exotic_dancer", { skip: SKIP }, async () => {
  const { root } = await load();
  const names = meshNodes(root).map((n) => n.getName());
  assert.equal(names.length, VARIANTS, names.join(", "));
  for (const name of names) {
    assert.match(name, /^PEOPLE_/);
    assert.doesNotMatch(name, EXCLUDED);
  }
});

test("every mesh has exactly WALK_KEYS morph targets (positions + normals)", { skip: SKIP }, async () => {
  const { root } = await load();
  for (const n of meshNodes(root))
    for (const p of n.getMesh().listPrimitives()) {
      const targets = p.listTargets();
      assert.equal(targets.length, WALK_KEYS, n.getName());
      for (const t of targets) {
        assert.ok(t.getAttribute("POSITION"), `${n.getName()} target lacks POSITION`);
        assert.ok(t.getAttribute("NORMAL"), `${n.getName()} target lacks NORMAL`);
      }
    }
});

test("one shared material with a baseColorTexture", { skip: SKIP }, async () => {
  const { root } = await load();
  const mats = new Set(meshNodes(root).flatMap((n) => n.getMesh().listPrimitives().map((p) => p.getMaterial())));
  assert.equal(mats.size, 1);
  const [mat] = mats;
  assert.ok(mat && mat.getBaseColorTexture(), "no baseColorTexture");
  assert.equal(root.listTextures().length, 1);
});

test("each person 1.4-2.0 m tall with feet on y = 0, in every walk key", { skip: SKIP }, async () => {
  const { root } = await load();
  for (const n of meshNodes(root)) {
    const [prim] = n.getMesh().listPrimitives();
    for (const t of [null, ...prim.listTargets()]) {
      const [lo, hi] = worldY(n, prim, t);
      assert.ok(Math.abs(lo) <= 0.01, `${n.getName()}: feet at ${lo.toFixed(3)}`);
      assert.ok(hi - lo >= HEIGHT[0] && hi - lo <= HEIGHT[1], `${n.getName()}: ${(hi - lo).toFixed(3)} m`);
    }
  }
});

test("people_meta.json matches the glb", { skip: SKIP }, async () => {
  const { root, meta } = await load();
  assert.equal(meta.keys, WALK_KEYS);
  assert.ok(meta.cycle_m > 1 && meta.cycle_m < 2, `cycle_m ${meta.cycle_m}`);
  assert.deepEqual(meta.variants.map((v) => "PEOPLE_" + v.name).sort(), meshNodes(root).map((n) => n.getName()).sort());
  for (const v of meta.variants) assert.ok(v.height >= HEIGHT[0] && v.height <= HEIGHT[1], `${v.name} ${v.height}`);
});
