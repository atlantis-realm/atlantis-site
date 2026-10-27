// Content and budget tests for the post-processed robot glb (robot_glb.mjs output). The glb is git-ignored
// until the look is approved, so every test skips when it is absent and CI without exports stays green.
const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("fs"), path = require("path");

const STATIC = path.join(__dirname, "..", "..", "..", "..", "static", "city");
const GLB = path.join(STATIC, "robot.glb"), META = path.join(STATIC, "robot_meta.json");
const SKIP = fs.existsSync(GLB) ? false : `no ${path.relative(process.cwd(), GLB)}; run export_robot.py and robot_glb.mjs first`;

const MAX_BYTES = 1.5 * 1024 * 1024;
const HEIGHT = [2.5, 4.5];            // m, bind (T) pose
const MAX_JOINTS = 64;
const ANIMS = ["idle", "walk"];
const LOOP_TOL = 0.01;               // m or quaternion/scale units, last key against the first

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
const mul = (a, b) => {   // column-major 4x4
  const o = new Array(16).fill(0);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
  return o;
};

// Bind-pose positions in metres: joint world matrix x inverse bind matrix maps the stored (maybe quantized)
// positions to the rest pose, whatever quantize folded into the inverse bind matrices.
async function bindBounds() {
  const { root } = await load();
  const [node] = meshNodes(root), skin = node.getSkin();
  const ibm = skin.getInverseBindMatrices().getElement(0, []);
  const m = mul(skin.listJoints()[0].getWorldMatrix(), ibm);
  const pos = node.getMesh().listPrimitives()[0].getAttribute("POSITION"), el = [];
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < pos.getCount(); i++) {
    const p = pos.getElement(i, el);
    for (let k = 0; k < 3; k++) {
      const v = m[k] * p[0] + m[4 + k] * p[1] + m[8 + k] * p[2] + m[12 + k];
      lo[k] = Math.min(lo[k], v); hi[k] = Math.max(hi[k], v);
    }
  }
  return { lo, hi };
}

test("robot glb within 1.5 MB", { skip: SKIP }, () => {
  assert.ok(fs.statSync(GLB).size <= MAX_BYTES, `${fs.statSync(GLB).size} bytes`);
});

test("one skinned mesh, one primitive, one material with a baseColorTexture", { skip: SKIP }, async () => {
  const { root } = await load();
  const nodes = meshNodes(root);
  assert.equal(nodes.length, 1, nodes.map((n) => n.getName()).join(", "));
  const [node] = nodes;
  assert.ok(node.getSkin(), "mesh has no skin");
  assert.ok(node.getSkin().listJoints().length <= MAX_JOINTS, `${node.getSkin().listJoints().length} joints`);
  const prims = node.getMesh().listPrimitives();
  assert.equal(prims.length, 1);
  for (const a of ["JOINTS_0", "WEIGHTS_0", "TEXCOORD_0", "NORMAL"]) assert.ok(prims[0].getAttribute(a), `no ${a}`);
  assert.equal(root.listMaterials().length, 1);
  assert.ok(prims[0].getMaterial().getBaseColorTexture(), "no baseColorTexture");
  assert.equal(root.listTextures().length, 1);
});

test("walk and idle animations, looping (first key = last key), on the skin's joints", { skip: SKIP }, async () => {
  const { root } = await load();
  assert.deepEqual(root.listAnimations().map((a) => a.getName()).sort(), ANIMS);
  const joints = new Set(meshNodes(root)[0].getSkin().listJoints());
  for (const anim of root.listAnimations()) {
    assert.ok(anim.listChannels().length > 0, anim.getName());
    for (const ch of anim.listChannels()) {
      assert.ok(joints.has(ch.getTargetNode()), `${anim.getName()} animates ${ch.getTargetNode().getName()}`);
      const s = ch.getSampler(), out = s.getOutput(), n = out.getCount();
      assert.notEqual(s.getInterpolation(), "STEP", `${anim.getName()} is stepped`);
      if (n < 2) continue;
      const a = out.getElement(0, []), b = out.getElement(n - 1, []);
      for (let k = 0; k < a.length; k++) assert.ok(Math.abs(a[k] - b[k]) <= LOOP_TOL, `${anim.getName()} ${ch.getTargetNode().getName()} ${ch.getTargetPath()} doesn't loop`);
    }
  }
});

test("bind pose 2.5-4.5 m tall, feet on y = 0, centred on x, facing +Z", { skip: SKIP }, async () => {
  const { root } = await load();
  const { lo, hi } = await bindBounds();
  const h = hi[1] - lo[1];
  assert.ok(Math.abs(lo[1]) <= 0.01, `feet at ${lo[1].toFixed(3)}`);
  assert.ok(h >= HEIGHT[0] && h <= HEIGHT[1], `${h.toFixed(3)} m`);
  assert.ok(Math.abs(lo[0] + hi[0]) <= 0.05, `x ${lo[0].toFixed(2)}..${hi[0].toFixed(2)}`);
  const at = (name) => root.listNodes().find((n) => n.getName() === name).getWorldTranslation();
  for (const s of ["l", "r"]) assert.ok(at(`toes_01.${s}`)[2] > at(`foot.${s}`)[2] + 0.1, `toes ${s} not ahead (+Z) of the ankle`);
});

test("robot_meta.json matches the glb", { skip: SKIP }, async () => {
  const { root, meta } = await load();
  assert.equal(meta.version, 1);
  const { lo, hi } = await bindBounds();
  assert.ok(Math.abs(meta.height - (hi[1] - lo[1])) <= 0.01, `height ${meta.height}`);
  assert.ok(meta.walk_cycle_m > 2 && meta.walk_cycle_m < 6, `walk_cycle_m ${meta.walk_cycle_m}`);
  const dur = (name) => Math.max(...root.listAnimations().find((a) => a.getName() === name)
    .listSamplers().map((s) => s.getInput().getMax([])[0]));
  assert.ok(Math.abs(meta.walk_duration_s - dur("walk")) <= 1e-3, `walk_duration_s ${meta.walk_duration_s} vs ${dur("walk")}`);
  assert.ok(Math.abs(meta.idle_duration_s - dur("idle")) <= 1e-3, `idle_duration_s ${meta.idle_duration_s} vs ${dur("idle")}`);
  const speed = meta.walk_cycle_m / meta.walk_duration_s;
  assert.ok(speed > 1 && speed < 5, `walk speed ${speed.toFixed(2)} m/s`);
});
