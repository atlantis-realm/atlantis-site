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
// = LAMP_POLE_H, LAMP_HEAD_H in export_hero.py; WALK_CAMERA_CLEARANCE, WALK_CHEST_H likewise.
const LAMP_POLE_H = 5.0, LAMP_HEAD_H = 0.6;
const WALK_CAMERA_CLEARANCE = 8.0, WALK_CHEST_H = 1.3;
// = SIT_DROP, IDLE_PATH_CLEARANCE, IDLE_SPACING, IDLE_MAX_SPOTS, IDLE_LEVEL, IDLE_BODY_REACH in export_hero.py.
const SIT_DROP = [0.35, 0.6], IDLE_PATH_CLEARANCE = 1.2, IDLE_SPACING = 1.0, IDLE_MAX_SPOTS = 400, IDLE_LEVEL = 3.0;
const IDLE_BODY_REACH = 0.4;
// = ROUTE_PAD, ROBOT_STEP_MAX, ROBOT_VIEW_H, ROBOT_CAMERA_CLEARANCE, ROUTE_LAMP_CLEAR, ROUTE_IDLE_CLEAR, LEAN_TOP_HS[-1],
// TALK_RADII, TALK_IDLE_GAP, TALK_SPACING in export_hero.py.
const ROUTE_PAD = 8.0, ROBOT_STEP_MAX = 0.7, ROBOT_VIEW_H = 2.0, ROBOT_CAMERA_CLEARANCE = 12.0;
const ROUTE_LAMP_CLEAR = 3.0, ROUTE_IDLE_CLEAR = 3.0, LEAN_TOP_MAX = 1.8;
const TALK_RADII = [2.2, 1.9, 1.6], TALK_IDLE_GAP = 1.0, TALK_SPACING = 3.0;
const PROPS_KEYS = {
  "": ["version", "fps", "frames", "base_vfov_deg", "safe_half_tan", "sun", "lantern", "blimps", "walk_paths",
    "well_water", "night", "night_nodes", "idle_spots", "robot_routes", "talk_spots"],
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

// y range of a primitive's POSITION in its mesh's local space (quantized or not: same scale per mesh).
function yRange(prim) {
  const pos = prim.getAttribute("POSITION"), el = [];
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < pos.getCount(); i++) {
    const y = pos.getElement(i, el)[1];
    lo = Math.min(lo, y); hi = Math.max(hi, y);
  }
  return [lo, hi];
}

test("lamp heads (NIGHT_Lamp) sit on top of the pole, every vertex at y >= LAMP_POLE_H", { skip: SKIP }, async () => {
  const { root } = await load();
  const lamps = root.listMeshes().filter((m) => m.listPrimitives().some((p) => p.getMaterial()?.getName() === "NIGHT_Lamp"));
  assert.ok(lamps.length > 0, "no lamp mesh");
  for (const mesh of lamps) {
    const prims = mesh.listPrimitives();
    const head = yRange(prims.find((p) => p.getMaterial()?.getName() === "NIGHT_Lamp"));
    const all = prims.map(yRange);
    const lo = Math.min(...all.map((r) => r[0])), hi = Math.max(...all.map((r) => r[1]));
    // Local units may be quantized: measure in metres from the lamp's full height.
    const m = (y) => ((y - lo) / (hi - lo)) * (LAMP_POLE_H + LAMP_HEAD_H);
    assert.ok(m(head[0]) >= LAMP_POLE_H - 1e-2, `${mesh.getName()}: head starts at ${m(head[0]).toFixed(3)} m`);
    const pole = prims.find((p) => p.getMaterial()?.getName() === "HERO_LampPole");
    if (pole) assert.ok(m(yRange(pole)[1]) <= LAMP_POLE_H + 1e-2, `${mesh.getName()}: pole reaches ${m(yRange(pole)[1]).toFixed(3)} m`);
  }
});

test("walk paths keep WALK_CAMERA_CLEARANCE from the camera over the whole move", { skip: SKIP }, async () => {
  const { root, props } = await load();
  const anim = root.listAnimations().find((a) => a.getName() === "Hero");
  const ch = anim.listChannels().find((c) => c.getTargetPath() === "translation");
  const out = ch.getSampler().getOutput(), cams = [], el = [];
  for (let i = 0; i < out.getCount(); i++) cams.push([...out.getElement(i, el)]);
  for (const [k, path] of props.walk_paths.entries()) {
    assert.ok(path.length >= 2, `path ${k} has ${path.length} points`);
    for (const [x, y, z] of path) {
      const d = Math.min(...cams.map(([cx, cy, cz]) => Math.hypot(x - cx, y + WALK_CHEST_H - cy, z - cz)));
      assert.ok(d >= WALK_CAMERA_CLEARANCE - 0.05, `path ${k} point ${[x, y, z]} is ${d.toFixed(2)} m from the camera`);
    }
  }
});

// Camera positions (glTF) at every baked frame of the Hero animation.
async function cameraPath() {
  const { root } = await load();
  const anim = root.listAnimations().find((a) => a.getName() === "Hero");
  const out = anim.listChannels().find((c) => c.getTargetPath() === "translation").getSampler().getOutput();
  const cams = [], el = [];
  for (let i = 0; i < out.getCount(); i++) cams.push([...out.getElement(i, el)]);
  return cams;
}

test("idle_spots: schema, both poses, unit headings", { skip: SKIP }, async () => {
  const { props } = await load();
  const spots = props.idle_spots;
  assert.ok(Array.isArray(spots) && spots.length >= 50 && spots.length <= IDLE_MAX_SPOTS, `${spots?.length} spots`);
  for (const pose of ["sit", "lean"]) assert.ok(spots.some((s) => s.pose === pose), `no ${pose} spot`);
  for (const [k, s] of spots.entries()) {
    assert.ok(["sit", "lean"].includes(s.pose), `spot ${k}: pose ${s.pose}`);
    assert.ok(s.pos.length === 3 && s.pos.every(Number.isFinite), `spot ${k}: pos ${s.pos}`);
    // radians in (-pi, pi], as Math.atan2 gives (walkerPose's convention), not degrees
    assert.ok(Number.isFinite(s.heading) && Math.abs(s.heading) <= Math.PI + 1e-3, `spot ${k}: heading ${s.heading}`);
    if (s.pose === "sit") assert.ok(s.drop >= SIT_DROP[0] - 1e-3 && s.drop <= SIT_DROP[1] + 1e-3, `spot ${k}: drop ${s.drop}`);
    else assert.equal(s.drop, undefined, `spot ${k}: lean with a drop`);
  }
});

test("idle_spots keep clear of the camera, the walk paths and each other, at street level", { skip: SKIP }, async () => {
  const { props } = await load();
  const cams = await cameraPath();
  const spots = props.idle_spots, walkPts = props.walk_paths.flat();
  for (const [k, s] of spots.entries()) {
    const [x, y, z] = s.pos, feet = y - (s.drop ?? 0);
    const street = walkPts.reduce((a, p) => (Math.hypot(p[0] - x, p[2] - z) < Math.hypot(a[0] - x, a[2] - z) ? p : a));
    assert.ok(Math.abs(feet - street[1]) <= IDLE_LEVEL + 1e-3, `spot ${k} feet at ${feet}, street at ${street[1]}`);
    const d = Math.min(...cams.map(([cx, cy, cz]) => Math.hypot(x - cx, feet + WALK_CHEST_H - cy, z - cz)));
    assert.ok(d >= WALK_CAMERA_CLEARANCE - 0.05, `spot ${k} is ${d.toFixed(2)} m from the camera`);
    // the spot and the body IDLE_BODY_REACH out along the facing (a leaner's origin, a sitter's feet)
    const reach = [x + Math.sin(s.heading) * IDLE_BODY_REACH, z + Math.cos(s.heading) * IDLE_BODY_REACH];
    for (const path of props.walk_paths)
      for (let i = 0; i + 1 < path.length; i++) {
        const [ax, , az] = path[i], [bx, , bz] = path[i + 1];
        const dx = bx - ax, dz = bz - az, ll = dx * dx + dz * dz;
        for (const [qx, qz] of [[x, z], reach]) {
          const t = ll ? Math.max(0, Math.min(1, ((qx - ax) * dx + (qz - az) * dz) / ll)) : 0;
          const e = Math.hypot(qx - ax - t * dx, qz - az - t * dz);
          assert.ok(e >= IDLE_PATH_CLEARANCE - 0.01, `spot ${k} is ${e.toFixed(2)} m from a walk path`);
        }
      }
    for (let j = 0; j < k; j++) {
      const o = spots[j].pos;
      assert.ok(Math.hypot(x - o[0], z - o[2]) >= IDLE_SPACING - 0.01, `spots ${j} and ${k} too close`);
    }
  }
});

test("most lean spots face their nearest walk path (headings not flipped)", { skip: SKIP }, async () => {
  // Heading h faces (sin h, 0, cos h). Leaners stand at the avenue's facades and the walkway railings with
  // their backs to them; the pavement and its walk paths lie in front of most of them.
  const { props } = await load();
  const leans = props.idle_spots.filter((s) => s.pose === "lean");
  let ahead = 0;
  for (const s of leans) {
    const [x, , z] = s.pos, fx = Math.sin(s.heading), fz = Math.cos(s.heading);
    const near = props.walk_paths.flat().reduce((best, p) => {
      const d = Math.hypot(p[0] - x, p[2] - z);
      return d < best.d ? { d, p } : best;
    }, { d: Infinity, p: null }).p;
    if ((near[0] - x) * fx + (near[2] - z) * fz > 0) ahead++;
  }
  assert.ok(ahead >= leans.length * 0.6, `${ahead} of ${leans.length} leaners face their nearest walk path`);
});

// Horizontal (x, z) distance from (x, z) to a glTF polyline.
function lineDist(x, z, line) {
  let best = Infinity;
  for (let i = 0; i + 1 < line.length; i++) {
    const [ax, , az] = line[i], [bx, , bz] = line[i + 1];
    const dx = bx - ax, dz = bz - az, ll = dx * dx + dz * dz;
    const t = ll ? Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / ll)) : 0;
    best = Math.min(best, Math.hypot(x - ax - t * dx, z - az - t * dz));
  }
  return best;
}

test("lean spots carry a wall top: null (tall) or a height up to the scan's 1.8 m", { skip: SKIP }, async () => {
  const { props } = await load();
  const leans = props.idle_spots.filter((s) => s.pose === "lean");
  for (const [k, s] of leans.entries())
    assert.ok(s.top === null || (s.top > 0 && s.top <= LEAN_TOP_MAX + 1e-3), `lean ${k}: top ${s.top}`);
  assert.ok(leans.some((s) => s.top !== null), "no lean spot with a top (the well railings have one)");
});

test("robot_routes: at least 3, walkable, clear of the camera, walking in and out unseen", { skip: SKIP }, async () => {
  const { props } = await load();
  const cams = await cameraPath();
  const routes = props.robot_routes;
  assert.ok(Array.isArray(routes) && routes.length >= 3, `${routes?.length} routes`);
  for (const r of routes) {
    assert.ok(r.points.length >= 2 && r.points.every((p) => p.length === 3 && p.every(Number.isFinite)), r.name);
    let len = 0;
    for (let i = 1; i < r.points.length; i++) {
      const [ax, ay, az] = r.points[i - 1], [bx, by, bz] = r.points[i];
      len += Math.hypot(bx - ax, bz - az);
      assert.ok(Math.abs(by - ay) <= ROBOT_STEP_MAX + 1e-3, `${r.name}: step of ${(by - ay).toFixed(2)} m at ${i}`);
    }
    assert.ok(Math.abs(len - r.len) <= 0.05, `${r.name}: len ${r.len}, points ${len.toFixed(2)}`);
    assert.ok(r.seen[0] >= ROUTE_PAD - 1e-3 && r.seen[1] <= r.len - ROUTE_PAD + 1e-3, `${r.name}: seen ${r.seen} of ${r.len}`);
    assert.ok(r.view.length > 0 && r.view.every(([f, a, b]) => f >= FRAMES[0] && f <= FRAMES[1] && a <= b), `${r.name}: view`);
    for (const [x, y, z] of r.points) {
      const d = Math.min(...cams.map(([cx, cy, cz]) => Math.hypot(x - cx, y + ROBOT_VIEW_H - cy, z - cz)));
      assert.ok(d >= ROBOT_CAMERA_CLEARANCE - 0.05, `${r.name}: ${[x, y, z]} is ${d.toFixed(2)} m from the camera`);
    }
  }
});

test("no lamp post and no idle spot on a robot route", { skip: SKIP }, async () => {
  const { root, props } = await load();
  const routes = props.robot_routes;
  // lamp feet: plain HERO_lamp_* nodes, or the instances of a lamp mesh (instance in hero_glb.mjs)
  const lamps = [];
  for (const n of meshNodes(root)) {
    if (!matNames(n).includes("NIGHT_Lamp")) continue;
    const inst = n.getExtension(INSTANCING), t = inst?.getAttribute("TRANSLATION"), el = [];
    if (t) for (let i = 0; i < t.getCount(); i++) lamps.push([...t.getElement(i, el)]);
    else lamps.push(n.getWorldTranslation());
  }
  assert.ok(lamps.length > 0, "no lamps");
  for (const [k, [x, , z]] of lamps.entries())
    for (const r of routes)
      assert.ok(lineDist(x, z, r.points) >= ROUTE_LAMP_CLEAR - 0.01, `lamp ${k} at ${[x, z]} is on ${r.name}`);
  for (const [k, s] of props.idle_spots.entries())
    for (const r of routes)
      assert.ok(lineDist(s.pos[0], s.pos[2], r.points) >= ROUTE_IDLE_CLEAR - 0.01, `idle spot ${k} is on ${r.name}`);
});

test("talk_spots: at least 12 circles, clear of the camera, paths, routes, idle spots and each other", { skip: SKIP }, async () => {
  const { props } = await load();
  const cams = await cameraPath();
  const spots = props.talk_spots;
  assert.ok(Array.isArray(spots) && spots.length >= 12, `${spots?.length} talk spots`);
  for (const [k, s] of spots.entries()) {
    const [x, y, z] = s.pos, r = s.radius;
    assert.ok(TALK_RADII.includes(r), `talk ${k}: radius ${r}`);
    const d = Math.min(...cams.map(([cx, cy, cz]) => Math.hypot(x - cx, y + WALK_CHEST_H - cy, z - cz)));
    assert.ok(d - r >= WALK_CAMERA_CLEARANCE - 0.05, `talk ${k} is ${d.toFixed(2)} m from the camera`);
    for (const path of props.walk_paths)
      assert.ok(lineDist(x, z, path) >= r + IDLE_PATH_CLEARANCE - 0.01, `talk ${k} on a walk path`);
    for (const route of props.robot_routes)
      assert.ok(lineDist(x, z, route.points) >= r + ROUTE_IDLE_CLEAR - 0.01, `talk ${k} on ${route.name}`);
    for (const i of props.idle_spots)
      assert.ok(Math.hypot(x - i.pos[0], z - i.pos[2]) >= r + TALK_IDLE_GAP - 0.01, `talk ${k} on an idle spot`);
    for (let j = 0; j < k; j++) {
      const o = spots[j];
      assert.ok(Math.hypot(x - o.pos[0], z - o.pos[2]) >= r + o.radius + TALK_SPACING - 0.01, `talk ${j} and ${k} overlap`);
    }
  }
});
