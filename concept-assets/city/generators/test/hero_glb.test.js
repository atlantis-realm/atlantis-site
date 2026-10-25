// Budget and content tests for the post-processed hero glb (hero_glb.mjs output). The glb is git-ignored
// until the look is approved, so every test skips when it is absent and CI without exports stays green.
const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("fs"), path = require("path");

const STATIC = path.join(__dirname, "..", "..", "..", "..", "static", "city");
const GLB = path.join(STATIC, "hero.glb"), PROPS = path.join(STATIC, "hero_props.json");
const SKIP = fs.existsSync(GLB) ? false : `no ${path.relative(process.cwd(), GLB)}; run export_hero.py and hero_glb.mjs first`;

// Budget (spec "Budget"; plan Global Constraints).
const MAX_BYTES = 10 * 1024 * 1024, MAX_TRIS = 1.5e6, MAX_DRAWS = 300;
const FPS = 24, FRAMES = [1, 250];
const LANTERN_PREFIXES = ["KIT_Temple_lantern", "NBHD_core_lantern"]; // = LANTERN_PREFIXES in export_hero.py
const NO_AO = ["HERO_tree_", "HERO_lamp_"];
const INSTANCING = "EXT_mesh_gpu_instancing";
const PROPS_KEYS = {
  "": ["version", "fps", "frames", "base_vfov_deg", "safe_half_tan", "sun", "lantern", "blimps", "walk_paths",
    "well_water", "night", "night_nodes"],
  safe_half_tan: ["f250", "f1"], sun: ["dir"], blimps: ["count", "radius", "altitude", "period_s", "len", "r"],
  night_nodes: ["NIGHT_MAT_AP_Cyan", "NIGHT_WellRing"],
};

let loaded;
function load() {
  return (loaded ||= (async () => {
    const { NodeIO } = await import("@gltf-transform/core");
    const { ALL_EXTENSIONS } = await import("@gltf-transform/extensions");
    const { MeshoptDecoder } = await import("meshoptimizer");
    await MeshoptDecoder.ready;
    const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ "meshopt.decoder": MeshoptDecoder });
    const doc = await io.read(GLB);
    const props = JSON.parse(fs.readFileSync(PROPS, "utf8"));
    const { stats } = await import("../hero_glb.mjs");
    return { doc, root: doc.getRoot(), props, stats };
  })());
}
const meshNodes = (root) => root.listNodes().filter((n) => n.getMesh());
const matNames = (n) => n.getMesh().listPrimitives().map((p) => p.getMaterial()?.getName() || "");

test("glb + props within 10 MB", { skip: SKIP }, () => {
  const bytes = fs.statSync(GLB).size + fs.statSync(PROPS).size;
  assert.ok(bytes <= MAX_BYTES, `${bytes} bytes`);
});

test("one HeroCamera and a Hero animation over frames 1-250", { skip: SKIP }, async () => {
  const { root } = await load();
  const cams = root.listNodes().filter((n) => n.getCamera());
  assert.deepEqual(cams.map((n) => n.getName()), ["HeroCamera"]);
  const anim = root.listAnimations().find((a) => a.getName() === "Hero");
  assert.ok(anim, "no Hero animation");
  const end = (FRAMES[1] - FRAMES[0]) / FPS;
  for (const s of anim.listSamplers()) {
    const input = s.getInput();
    assert.ok(Math.abs(input.getMin([])[0]) <= 1e-3, `starts at ${input.getMin([])[0]}`);
    assert.ok(Math.abs(input.getMax([])[0] - end) <= 1e-3, `ends at ${input.getMax([])[0]}`);
  }
});

test("Text node exists", { skip: SKIP }, async () => {
  const { root } = await load();
  assert.ok(root.listNodes().some((n) => n.getName() === "Text"));
});

test("every NIGHT_ material carries night_emissive as 4 numbers", { skip: SKIP }, async () => {
  const { root } = await load();
  const night = root.listMaterials().filter((m) => m.getName().startsWith("NIGHT_"));
  assert.ok(night.length > 0, "no NIGHT_ materials");
  for (const m of night) {
    const e = m.getExtras().night_emissive;
    assert.ok(Array.isArray(e) && e.length === 4 && e.every(Number.isFinite), `${m.getName()}: ${JSON.stringify(e)}`);
  }
});

test("Lantern and well-ring night materials only on their listed nodes", { skip: SKIP }, async () => {
  const { root, props } = await load();
  for (const [mat, allowed] of Object.entries(props.night_nodes)) {
    const users = meshNodes(root).filter((n) => matNames(n).includes(mat)).map((n) => n.getName());
    assert.ok(users.length > 0, `${mat} unused`);
    for (const name of users) assert.ok(allowed.includes(name), `${mat} on ${name}, not in night_nodes`);
    if (mat === "NIGHT_MAT_AP_Cyan")
      for (const name of users) assert.ok(LANTERN_PREFIXES.some((p) => name.startsWith(p)), `${mat} on ${name}`);
  }
});

test("no CANALS_ node uses a NIGHT_ material", { skip: SKIP }, async () => {
  const { root } = await load();
  for (const n of meshNodes(root).filter((n) => n.getName().startsWith("CANALS_")))
    assert.ok(!matNames(n).some((m) => m.startsWith("NIGHT_")), n.getName());
});

test("triangles within 1.5 M and draw calls within 300", { skip: SKIP }, async () => {
  const { doc, stats } = await load();
  const { triangles, draws } = stats(doc); // the same figures hero_glb.mjs prints
  assert.ok(triangles <= MAX_TRIS, `${triangles} triangles`);
  assert.ok(draws <= MAX_DRAWS, `${draws} draw calls`);
});

test("every primitive bar trees and lamps has COLOR_0", { skip: SKIP }, async () => {
  const { root } = await load();
  for (const n of meshNodes(root)) {
    if (n.getExtension(INSTANCING) || NO_AO.some((p) => n.getName().startsWith(p))) continue;
    for (const p of n.getMesh().listPrimitives()) assert.ok(p.getAttribute("COLOR_0"), `${n.getName()} lacks COLOR_0`);
  }
});

test("hero_props.json has the Task 3 schema", { skip: SKIP }, async () => {
  const { props } = await load();
  for (const [group, keys] of Object.entries(PROPS_KEYS)) {
    const obj = group ? props[group] : props;
    assert.ok(obj && typeof obj === "object", `missing ${group}`);
    for (const k of keys) assert.ok(k in obj, `missing ${group ? group + "." : ""}${k}`);
  }
  assert.ok(props.blimps.count >= 1);
  assert.ok(props.walk_paths.length >= 3);
});
