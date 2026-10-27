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
const PALETTE_W = 80;                // px, one palette's width in the strip
const WEAPON = /Gun|Missile|Weapon|Sword|Hammer/;
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
async function bindBounds(node) {
  const { root } = await load();
  node ||= meshNodes(root)[0];
  const skin = node.getSkin();
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

test("one skinned mesh per variant, one primitive each, one shared material with a palette strip", { skip: SKIP }, async () => {
  const { root, meta } = await load();
  const nodes = meshNodes(root);
  assert.deepEqual(nodes.map((n) => n.getName()).sort(), meta.variants.map((v) => v.name).sort());
  assert.ok(nodes.length >= 6, `${nodes.length} variants`);
  for (const node of nodes) {
    assert.ok(node.getSkin(), `${node.getName()} has no skin`);
    assert.ok(node.getSkin().listJoints().length <= MAX_JOINTS, `${node.getSkin().listJoints().length} joints`);
    const prims = node.getMesh().listPrimitives();
    assert.equal(prims.length, 1, node.getName());
    for (const a of ["JOINTS_0", "WEIGHTS_0", "TEXCOORD_0", "NORMAL"]) assert.ok(prims[0].getAttribute(a), `${node.getName()} no ${a}`);
    // UVs inside the first palette of the strip.
    const uv = prims[0].getAttribute("TEXCOORD_0"), el = [];
    let hi = -Infinity, lo = Infinity;
    for (let i = 0; i < uv.getCount(); i++) { uv.getElement(i, el); hi = Math.max(hi, el[0]); lo = Math.min(lo, el[0]); }
    assert.ok(lo >= -1e-3 && hi <= 1 / meta.palettes.length + 1e-3, `${node.getName()} u ${lo}..${hi}`);
  }
  assert.equal(root.listMaterials().length, 1);
  assert.equal(root.listTextures().length, 1);
  const png = root.listTextures()[0].getImage();
  const w = (png[16] << 24) | (png[17] << 16) | (png[18] << 8) | png[19];
  assert.equal(w, PALETTE_W * meta.palettes.length, `strip ${w} px wide`);
  assert.ok(meshNodes(root)[0].getMesh().listPrimitives()[0].getMaterial().getBaseColorTexture(), "no baseColorTexture");
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
  for (const node of meshNodes(root)) {
    const { lo, hi } = await bindBounds(node);
    const h = hi[1] - lo[1], name = node.getName();
    assert.ok(Math.abs(lo[1]) <= 0.01, `${name} feet at ${lo[1].toFixed(3)}`);
    assert.ok(h >= HEIGHT[0] && h <= HEIGHT[1], `${name} ${h.toFixed(3)} m`);
    assert.ok(Math.abs(lo[0] + hi[0]) <= 0.05, `${name} x ${lo[0].toFixed(2)}..${hi[0].toFixed(2)}`);
  }
  const at = (name) => root.listNodes().find((n) => n.getName() === name).getWorldTranslation();
  for (const s of ["l", "r"]) assert.ok(at(`toes_01.${s}`)[2] > at(`foot.${s}`)[2] + 0.1, `toes ${s} not ahead (+Z) of the ankle`);
});

test("robot_meta.json matches the glb", { skip: SKIP }, async () => {
  const { root, meta } = await load();
  assert.equal(meta.version, 2);
  const dur = (name) => Math.max(...root.listAnimations().find((a) => a.getName() === name)
    .listSamplers().map((s) => s.getInput().getMax([])[0]));
  assert.ok(Math.abs(meta.walk_duration_s - dur("walk")) <= 1e-3, `walk_duration_s ${meta.walk_duration_s} vs ${dur("walk")}`);
  assert.ok(Math.abs(meta.idle_duration_s - dur("idle")) <= 1e-3, `idle_duration_s ${meta.idle_duration_s} vs ${dur("idle")}`);
  assert.ok(meta.palettes.length >= 4 && new Set(meta.palettes).size === meta.palettes.length, `${meta.palettes}`);
  assert.equal(meta.height, meta.variants[0].height);
  assert.equal(meta.walk_cycle_m, meta.variants[0].walk_cycle_m);
  for (const v of meta.variants) {
    const node = meshNodes(root).find((n) => n.getName() === v.name);
    const { lo, hi } = await bindBounds(node);
    assert.ok(Math.abs(v.height - (hi[1] - lo[1])) <= 0.01, `${v.name} height ${v.height}`);
    assert.ok(v.walk_cycle_m > 2 && v.walk_cycle_m < 6, `${v.name} walk_cycle_m ${v.walk_cycle_m}`);
    const speed = v.walk_cycle_m / meta.walk_duration_s;
    assert.ok(speed > 1 && speed < 5, `${v.name} walk speed ${speed.toFixed(2)} m/s`);
    const prim = node.getMesh().listPrimitives()[0];
    assert.equal(prim.getIndices().getCount() / 3, v.tris, `${v.name} tris`);
    for (const [item, socket] of v.attachments) {
      assert.doesNotMatch(item, WEAPON, `${v.name} carries ${item}`);
      assert.match(socket, /_Attachment/);
    }
    for (const part of Object.values(v.slots)) assert.match(part, /^Base(\(A\))?_[SML]_$/);
  }
});
