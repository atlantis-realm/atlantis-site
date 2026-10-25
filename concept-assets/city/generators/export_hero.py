"""Export the /city hero view from v05: a culled, AO-baked raw glb plus hero_props.json.

Run it headless (the default and the only tested way; see README "Hero export"):
    node -e '<see README: writes build/hero/plan_blimps.json>'     (once per plan change; Blender has no node)
    flatpak run --command=blender org.blender.Blender --factory-startup -b ../Atlantian_plaza_blockout-v05.blend \
      --python-expr 'G="'$PWD'/"; exec(open(G+"export_hero.py").read(), {"__name__":"eh","__file__":G+"export_hero.py","OUT_DIR":G+"build/hero/"})'

A run inside the live Blender session (exec through the Blender MCP) is unverified: a related temp_override
pattern segfaulted Blender 5.2, and a crash loses unsaved work. run() refuses it unless the exec globals carry
"ALLOW_LIVE": True, which should only be passed after the user has saved and opted in.

Writes OUT_DIR/hero_raw.glb, hero_props.json and export_report.json. Never saves the .blend and never edits
the user's scene: everything it builds lives in a scratch scene HERO_EXPORT_SCENE (collection HERO_EXPORT,
world, camera, action, meshes, materials, every ID tagged `hero_export`) that is deleted at the end,
even on error. The user scene's current frame is restored.

Stages
  cameras()    Camera.001 world matrices for frames 1-250; cull samples every FRAME_STEP (hero_geom).
  safe frame   base vfov (16:9) and safe-frame half tangents: f250 from the `Text` bounds, f1 from the
               avenue frontage where it starts, both clamped to the 16:9 half width.
  collect()    every visible mesh instance of the evaluated depsgraph (meshes, GN and collection instances),
               skipping render-hidden objects/collections and SKIP_COLLECTIONS.
  cull         frustum: an instance (or, for non-trees, each TILE x TILE chunk of it, split by face
               centroid so city-wide meshes like SKYWALKS shrink to what is in view) is kept if its AABB is
               in any frustum over sample frames x cull aspects (margin CULL_MARGIN). Occlusion: rays from
               OCCLUSION_SAMPLES camera positions to the 8 AABB corners + centre against a BVH of the
               kept non-tree chunks; dropped only if every ray hits another chunk first.
  realise      everything goes to world-space meshes in HERO_EXPORT, joined per material per tile
               (near NEAR_TILE, mid MID_TILE, far FAR_TILE) by distance band (NEAR_DIST, FAR_DIST); near is
               joined too, for the draw-call budget, but keeps full detail.
               Mid: faces facing away from every sample camera are dropped. Far: Decimate (collapse).
               Named, never joined: `Text` (pale PBR), the Lantern (LANTERN_PREFIXES), the well ring
               lights (WELL_RING_LIGHTS), HERO_well_water. Trees (KIT_PlantD_*, asset_Plant_* parts)
               become linked duplicates of one mesh per species part, for glTF-Transform instancing.
  AO           near/mid meshes are subdivided (edges > SUBDIV_NEAR / SUBDIV_MID) and Cycles-baked to a
               byte corner colour attribute `AO`; far, water, trees and lamps get white.
  night        NIGHT_* materials carry custom property night_emissive -> glTF extras. The Lantern's
               MAT_AP_Cyan and MAT_AP_Glow (its cyan heart) faces both go to NIGHT_MAT_AP_Cyan.
  lamps        lamp posts every LAMP_AVENUE_SPACING m on both avenue pavements and every
               LAMP_RING_STEP_DEG round the plaza ring (clear of the camera), linked duplicates.
  camera       HeroCamera, no parent, world matrix keyed every frame 1-250 (linear), action `Hero`.
  props        sun (dir: from the scene toward the sun), Lantern, blimp orbit (radius searched for the
               visible sky above the frontage), walk paths, well water node, night material names and
               night_nodes (the nodes allowed NIGHT_MAT_AP_Cyan / NIGHT_WellRing). glTF space: (x, z, -y).

Pure cull geometry lives in hero_geom.py (tested). Tuning knobs are the constants below.
"""
import bpy, bmesh, importlib, json, math, os, struct, sys, time
import numpy as np
from mathutils import Matrix, Vector
from mathutils.bvhtree import BVHTree

_g = globals()
OUT_DIR = _g.get("OUT_DIR") or None
_here = (_g.get("GEN_DIR") or (os.path.dirname(_g["__file__"]) if _g.get("__file__") else None)
         or (os.path.normpath(os.path.join(OUT_DIR, "..", "..")) if OUT_DIR else "."))
OUT_DIR = OUT_DIR or os.path.join(_here, "build", "hero")
sys.path.insert(0, _here)
import hero_geom as hg  # noqa: E402
importlib.reload(hg)

# ---------------------------------------------------------------- constants
CAMERA = "Camera.001"
FPS = 24
RENDER_W, RENDER_H = 1280, 720
SKIP_COLLECTIONS = {"05_TEMPLE"}
TAG = "hero_export"                     # custom property on every ID this script creates
NAME_SUFFIX = "@hero"                   # copies named like scene objects (Text...) get this; stripped in the glb

CULL_MARGIN = 0.03                      # radians added to both FOVs (hero_geom.frustum_planes)
OCCLUSION_SAMPLES = 5                   # camera positions the occlusion rays start from
RAY_EPS = 0.05                          # m: hits this close to the target point don't block it
TILE = 100.0                            # m: chunk size for culling city-wide meshes
CAST_MAX_HOPS = 16                      # cast(): skipped hits before giving up
CAST_NUDGE = 0.01                       # m: cast() restarts this far past a skipped hit
NEAR_DIST, FAR_DIST = 150.0, 700.0      # m from the nearest sample camera: near < NEAR_DIST < mid < FAR_DIST < far
# m: join tiles per band. Near is joined per material per tile too (not kept as modelled, as the plan first
# said): per-object near meshes would blow the 300 draw-call budget. Near keeps its full detail (no
# back-face drop, no decimate) and the finest AO subdivision.
NEAR_TILE, MID_TILE, FAR_TILE = 100.0, 100.0, 400.0
FAR_DECIMATE = 0.25                     # Decimate (collapse) ratio for far meshes
SUBDIV_NEAR, SUBDIV_MID = 4.0, 12.0     # m: split edges longer than this before the AO bake
SUBDIV_MAX_EDGE = 200.0                 # m: faces with longer edges (sea, ground sheets) are not split
SUBDIV_MAX_PASSES = 6
AO_SAMPLES, AO_DISTANCE = 32, 8.0
NO_AO_MATERIALS = {"MAT_AP_Water"}      # water gets white AO and no subdivision

TREE_OBJECT_PREFIXES = ("KIT_PlantD_",)
TREE_COLLECTION_PREFIXES = ("asset_Plant_",)
LANTERN_PREFIXES = ("KIT_Temple_lantern", "NBHD_core_lantern")   # v05's Lantern is NBHD_core_lantern
LANTERN_OBJECT = "NBHD_core_lantern"
WELL_OBJECT = "KIT_Walkway_well_collar"
WELL_RING_LIGHTS = ("KIT_Walkway_inlay0", "KIT_Walkway_gallery_inlay")
TEXT_OBJECT = "Text"
TEXT_COLOR, TEXT_ROUGHNESS = (0.92, 0.9, 0.85), 0.5
WATER_MATERIAL = "MAT_AP_Water"
WELL_WATER_NAME = "HERO_well_water"
WELL_WATER_LIFT = 0.05                  # m above the sea plane it covers
WELL_WATER_PAD = 0.5                    # m added to the widest water hit seen through the well
WELL_PROBE_N, WELL_PROBE_STEP, WELL_PROBE_DIST = 12, 0.5, 200.0   # frame-250 rays: (2N+1)^2 grid, m apart
WELL_WATER_SEGMENTS = 48
PAVE_PROBE_STEP = 0.25                  # m between downward probes across the pavement

NIGHT_WINDOWS = ("MAT_AP_Void",)
NIGHT_BANDS = ("MAT_AP_Glow", "MAT_AP_Clerestory")
NIGHT_CYAN = "NIGHT_MAT_AP_Cyan"        # Lantern only: its MAT_AP_Cyan faces and its MAT_AP_Glow heart, which
                                        # is the Lantern's cyan heart (README), so it glows cyan, not as a band
NIGHT_WELL = "NIGHT_WellRing"
NIGHT_LAMP = "NIGHT_Lamp"
NIGHT_EMISSIVE = {"window": [1.0, 0.78, 0.5, 2.0], "band": [1, 0.9, 0.7, 1.5], "cyan": [0.3, 0.9, 1, 4],
                  "lamp": [1, 0.85, 0.6, 3]}

LAMP_POLE_H, LAMP_POLE_R, LAMP_HEAD_H, LAMP_HEAD_W = 5.0, 0.08, 0.6, 0.35
LAMP_POLE_COLOR = (0.12, 0.12, 0.12)
LAMP_HEAD_COLOR = (0.95, 0.9, 0.75)
LAMP_POLE_ROUGH, LAMP_POLE_METAL = 0.45, 0.6
LAMP_HEAD_ROUGH = 0.5
DEFAULT_COLOR, DEFAULT_ROUGH = (0.7, 0.7, 0.7), 0.6   # for source materials without a Principled BSDF
LAMP_AVENUE_SPACING = 18.0
LAMP_RING_STEP_DEG = 15.0
LAMP_KERB_INSET = 0.5                   # m in from the kerb edge of each pavement
LAMP_CAMERA_CLEARANCE = 10.0            # m: no lamp this close (horizontally) to the camera path
PLAZA_LAMP_R, PLAZA_WALK_R = 11.3, 10.0 # m round the well centre, on the walkway deck
WALK_RING_POINTS = 48
AVENUE_START, AVENUE_LEN, AVENUE_STEP = 20.0, 600.0, 20.0   # m along the avenue from the well centre
AVENUE_PROBE = 60.0                     # m along the avenue where the pavement is measured
PAVEMENT_OBJECT = "KIT_Ave_walk"
GROUND_TOP = 600.0                      # m: downward ground probes start here
FRONTAGE_RANGE = (20.0, 400.0)          # m along the avenue searched for where the frontage starts
FRONTAGE_STEP = 5.0                     # m between frontage probes
FRONTAGE_HEIGHT = 10.0                  # m above the camera's frame-1 height
FRONTAGE_SEARCH = 80.0                  # m sideways
FRONTAGE_SKIP = ("SKYWALK", "KIT_Sky", "KIT_Plant", "TREES_")   # not frontage: skywalks and trees
NOT_GROUND = FRONTAGE_SKIP + ("KIT_Care", "KIT_Street", "KIT_Facade", "Text")   # nor street furniture, facades

BLIMP_COUNT, BLIMP_PERIOD_S, BLIMP_ALTITUDE = 6, 240.0, 280.0
BLIMP_RADII = range(600, 1401, 50)
BLIMP_ORBIT_POINTS = 360
BLIMPS_JSON = "plan_blimps.json"        # CityGen.generate(plan).blimps, written by node (see README)


def gl(v):
    """Blender (Z up) -> glTF (Y up)."""
    return [round(float(v[0]), 4), round(float(v[2]), 4), round(float(-v[1]), 4)]


def tag(idb):
    idb[TAG] = 1
    return idb


# ---------------------------------------------------------------- cleanup
def cleanup():
    """Delete every ID this script created (tagged), in this or an earlier crashed run."""
    for coll in (bpy.data.scenes, bpy.data.objects, bpy.data.collections, bpy.data.cameras, bpy.data.actions,
                 bpy.data.worlds, bpy.data.meshes, bpy.data.materials):
        ids = [i for i in coll if i.get(TAG)]
        if ids:
            bpy.data.batch_remove(ids)


# ---------------------------------------------------------------- cameras + safe frame
def cameras(scene, cam):
    """{frame: Matrix} for every hero frame, and the cull samples [(frame, pos, fwd, up)]."""
    mats = {}
    for f in range(hg.FRAME_START, hg.FRAME_END + 1):
        scene.frame_set(f)
        mats[f] = cam.matrix_world.copy()
    samples = []
    for f in hg.sample_frames():
        m = mats[f].to_3x3().normalized()
        samples.append((f, tuple(mats[f].translation), tuple(-m.col[2]), tuple(m.col[1])))
    return mats, samples


def base_vfov(cam_data):
    if cam_data.sensor_fit == "VERTICAL":
        return 2 * math.atan(cam_data.sensor_height / 2 / cam_data.lens)
    half_h = cam_data.sensor_width / 2 / cam_data.lens
    return 2 * math.atan(half_h * RENDER_H / RENDER_W)


def cam_space(mat, p):
    """(x/-z, y/-z, depth) of world point p in the camera given by its world matrix."""
    q = mat.inverted() @ Vector(p)
    return q.x / -q.z, q.y / -q.z, -q.z


def safe_half_tans(scene, dg, mats, half16):
    """f250: the Text bounds at frame 250. f1: the avenue frontage where it starts, seen from frame 1."""
    text = bpy.data.objects[TEXT_OBJECT]
    corners = [text.matrix_world @ Vector(c) for c in text.bound_box]
    f250 = max(abs(cam_space(mats[hg.FRAME_END], c)[0]) for c in corners)
    m1 = mats[hg.FRAME_START]
    pos = m1.translation
    fwd = (-m1.to_3x3().normalized().col[2]).to_2d().normalized().to_3d()
    side = Vector((fwd.y, -fwd.x, 0))
    f1 = None
    for s in np.arange(FRONTAGE_RANGE[0], FRONTAGE_RANGE[1], FRONTAGE_STEP):
        o = pos + fwd * float(s) + Vector((0, 0, FRONTAGE_HEIGHT))
        hits = []
        for d in (side, -side):
            h = cast(lambda a, b, n: scene_ray(scene, dg, a, b, n), o, d, FRONTAGE_SEARCH, FRONTAGE_SKIP)
            if h is not None:
                hits.append(h[0])
        if len(hits) == 2:
            f1 = max(abs(cam_space(m1, h)[0]) for h in hits)
            break
    return min(f250, half16), min(f1 if f1 is not None else half16, half16)


def scene_ray(scene, dg, o, d, dist):
    r = scene.ray_cast(dg, o, d, distance=dist)
    return (r[1], r[4].name) if r[0] else None


def cast(ray, o, d, dist, skip):
    """(location, owner name) of the first hit along o + t d (t <= dist) whose owner name doesn't start
    with `skip`; None if none. `ray(o, d, dist)` returns (location, owner_name, ...) or None."""
    o, d = Vector(o), Vector(d)
    for _ in range(CAST_MAX_HOPS):
        h = ray(o, d, dist)
        if h is None:
            return None
        if not h[1].startswith(skip):
            return h[0], h[1]
        dist -= (h[0] - o).length + CAST_NUDGE
        o = h[0] + d * CAST_NUDGE
        if dist <= 0:
            return None
    return None


# ---------------------------------------------------------------- collect
def hidden_objects(view_layer):
    """Names of objects that don't render: hide_render, or linked only into hidden/excluded collections
    or SKIP_COLLECTIONS (an object also linked into a shown collection still renders)."""
    hidden, shown = set(), set()

    def walk(lc, off):
        off = off or lc.exclude or lc.hide_viewport or lc.collection.hide_render or lc.collection.name in SKIP_COLLECTIONS
        (hidden if off else shown).update(o.name for o in lc.collection.objects)
        for ch in lc.children:
            walk(ch, off)
    walk(view_layer.layer_collection, False)
    return (hidden - shown) | {o.name for o in bpy.data.objects if o.hide_render}


def is_tree(obj_orig):
    return obj_orig.name.startswith(TREE_OBJECT_PREFIXES) or any(
        c.name.startswith(TREE_COLLECTION_PREFIXES) for c in obj_orig.users_collection)


class Geo:
    """World-free mesh arrays of one evaluated mesh (shared by all its instances)."""

    def __init__(self, obj):
        me = obj.data
        nv, npoly, nl = len(me.vertices), len(me.polygons), len(me.loops)
        self.co = np.empty(nv * 3, np.float32); me.vertices.foreach_get("co", self.co)
        self.co = self.co.reshape(-1, 3).astype(np.float64)
        self.ls = np.empty(npoly, np.int64); me.polygons.foreach_get("loop_start", self.ls)
        self.lt = np.empty(npoly, np.int64); me.polygons.foreach_get("loop_total", self.lt)
        self.lv = np.empty(nl, np.int64); me.loops.foreach_get("vertex_index", self.lv)
        self.mi = np.empty(npoly, np.int64); me.polygons.foreach_get("material_index", self.mi)
        self.smooth = np.empty(npoly, bool); me.polygons.foreach_get("use_smooth", self.smooth)
        self.pn = np.empty(npoly * 3, np.float32); me.polygons.foreach_get("normal", self.pn)
        self.pn = self.pn.reshape(-1, 3).astype(np.float64)
        me.calc_loop_triangles()
        nt = len(me.loop_triangles)
        self.tris = np.empty(nt * 3, np.int64); me.loop_triangles.foreach_get("vertices", self.tris)
        self.tris = self.tris.reshape(-1, 3)
        self.tri_poly = np.empty(nt, np.int64); me.loop_triangles.foreach_get("polygon_index", self.tri_poly)
        mats = [s.material.name if s.material else None for s in obj.material_slots] or \
               [m.name if m else None for m in me.materials]
        self.mats = mats or [None]
        self.loop_poly = np.repeat(np.arange(npoly), self.lt)
        lo, hi = (self.co.min(0), self.co.max(0)) if nv else (np.zeros(3), np.zeros(3))
        self.corners = np.array([[x, y, z] for x in (lo[0], hi[0]) for y in (lo[1], hi[1]) for z in (lo[2], hi[2])])

    def mat_name(self, mi):
        return self.mats[min(int(mi), len(self.mats) - 1)]


class Inst:
    __slots__ = ("idx", "src", "coll", "geo", "M", "tree", "species", "special", "lo", "hi")


def collect(dg, view_layer):
    hidden = hidden_objects(view_layer)
    geos, out = {}, []
    for inst in dg.object_instances:
        obj = inst.object
        if obj.type != "MESH" or not len(obj.data.polygons):
            continue
        src = (inst.parent if inst.is_instance and inst.parent else obj).original
        if src.name in hidden:
            continue
        # GN geometry instances of one owner can share both names: the counts tell their meshes apart
        me = obj.data
        key = (obj.original.name, me.name, len(me.vertices), len(me.polygons), len(me.loops))
        g = geos.get(key)
        if g is None:
            g = geos[key] = Geo(obj)
        it = Inst()
        it.idx, it.src, it.geo = len(out), src.name, g
        it.coll = src.users_collection[0].name if src.users_collection else ""
        it.M = np.array(inst.matrix_world, dtype=np.float64)
        it.tree = is_tree(obj.original)
        it.species = obj.original.name
        name = obj.original.name
        it.special = (TEXT_OBJECT if name == TEXT_OBJECT else
                      "lantern" if name.startswith(LANTERN_PREFIXES) else
                      "well_ring" if name in WELL_RING_LIGHTS else None)
        wc = g.corners @ it.M[:3, :3].T + it.M[:3, 3]
        it.lo, it.hi = wc.min(0), wc.max(0)
        out.append(it)
    return out


# ---------------------------------------------------------------- cull
def make_frusta(samples, cam_data, vfov, sht):
    return [hg.frustum_planes(pos, fwd, up, v, a, cam_data.clip_start, cam_data.clip_end, margin=CULL_MARGIN)
            for (_, pos, fwd, up) in samples for (a, v) in hg.cull_aspects(vfov, sht)]


def in_view(lo, hi, frusta):
    lo, hi = tuple(lo), tuple(hi)
    return any(hg.aabb_in_frustum(lo, hi, p) for p in frusta)


class Chunk:
    """The faces of one instance whose centroids fall in one TILE: the unit of culling."""
    __slots__ = ("id", "inst", "polys", "lo", "hi", "co", "lv", "pn", "cent")


def world_arrays(it):
    """World vertices, loop vertex indices (winding fixed for mirrored instances), normals, centroids."""
    g, M = it.geo, it.M
    co = g.co @ M[:3, :3].T + M[:3, 3]
    lv = g.lv
    if np.linalg.det(M[:3, :3]) < 0:
        off = np.arange(len(lv)) - np.repeat(g.ls, g.lt)
        lv = lv[np.repeat(g.ls, g.lt) + (np.repeat(g.lt, g.lt) - 1 - off)]
    nm = np.linalg.inv(M[:3, :3]).T
    pn = g.pn @ nm.T
    pn /= np.maximum(np.linalg.norm(pn, axis=1), 1e-12)[:, None]
    cent = np.add.reduceat(co[lv], g.ls, axis=0) / g.lt[:, None]
    return co, lv, pn, cent


def chunk(it, chunks):
    co, lv, pn, cent = world_arrays(it)
    tiles = np.floor(cent[:, :2] / TILE).astype(np.int64)
    keys, inv = np.unique(tiles, axis=0, return_inverse=True)
    inv = inv.ravel()
    for k in range(len(keys)):
        polys = np.nonzero(inv == k)[0]
        lm = np.isin(it.geo.loop_poly, polys) if len(keys) > 1 else slice(None)
        v = co[lv[lm]]
        c = Chunk()
        c.id, c.inst, c.polys, c.lo, c.hi = len(chunks), it, polys, v.min(0), v.max(0)
        c.co, c.lv, c.pn, c.cent = co, lv, pn, cent
        chunks.append(c)


class Occluders:
    """BVH over chunk triangles. owner[i] = chunk id of triangle i; mat[i] its source material name."""

    def __init__(self, chunks):
        self.chunks = chunks
        self.bvh, self.owner, self.mat = build_bvh(chunks)
        self.src = [c.inst.src for c in chunks]

    def ray(self, o, d, dist):
        """(location, owner name, triangle) of the first hit, or None."""
        h = self.bvh.ray_cast(o, d, dist)
        return None if h[0] is None else (h[0], self.src[self.owner[h[2]]], h[2])


def build_bvh(chunks):
    verts, tris, owner, mat, base, done = [], [], [], [], 0, {}
    for c in chunks:
        it = c.inst
        if it.idx not in done:
            done[it.idx] = base
            verts.append(c.co)
            base += len(c.co)
        g = it.geo
        tm = np.isin(g.tri_poly, c.polys)
        t = g.tris[tm] + done[it.idx]
        tris.append(t)
        owner.append(np.full(len(t), c.id))
        names = np.array([g.mat_name(i) or "" for i in range(len(g.mats))], dtype=object)
        mat.append(names[np.minimum(g.mi[g.tri_poly[tm]], len(g.mats) - 1)])
    V = np.concatenate(verts)
    T = np.concatenate(tris)
    return (BVHTree.FromPolygons(V.tolist(), T.tolist(), all_triangles=True), np.concatenate(owner),
            np.concatenate(mat))


def visible_from(occ, eyes, lo, hi, self_id):
    """True unless every ray from every eye to the box's corners and centre hits another chunk first."""
    pts = [Vector((x, y, z)) for x in (lo[0], hi[0]) for y in (lo[1], hi[1]) for z in (lo[2], hi[2])]
    pts.append(Vector(((lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2)))
    for e in eyes:
        for p in pts:
            d = p - e
            dist = d.length
            if dist < RAY_EPS:
                return True
            hit = occ.bvh.ray_cast(e, d / dist, dist - RAY_EPS)
            if hit[0] is None or occ.owner[hit[2]] == self_id:
                return True
    return False


# ---------------------------------------------------------------- materials
def principled(m):
    return next((n for n in m.node_tree.nodes if n.type == "BSDF_PRINCIPLED"), None) if m and m.node_tree else None


def pbr(name, color, rough, metal, night=None):
    m = tag(bpy.data.materials.new(name))
    if principled(m) is None:
        m.use_nodes = True
    b = principled(m)
    b.inputs["Base Color"].default_value = (*color[:3], 1.0)
    b.inputs["Roughness"].default_value = rough
    b.inputs["Metallic"].default_value = metal
    if night is not None:
        m["night_emissive"] = [float(x) for x in night]
    return m


class Materials:
    """Simple-PBR export twins of the scene's materials, created on first use and cached by out-name."""

    def __init__(self):
        self.cache = {}

    def out_name(self, src, special):
        if special == "well_ring" and src == "MAT_AP_Cyan":
            return NIGHT_WELL
        if special == "lantern" and src in ("MAT_AP_Cyan", "MAT_AP_Glow"):
            return NIGHT_CYAN
        if special == TEXT_OBJECT:
            return "HERO_TextPale"
        if src in NIGHT_WINDOWS or src in NIGHT_BANDS:
            return "NIGHT_" + src
        return "HERO_" + (src or "default")

    def get(self, out, src):
        m = self.cache.get(out)
        if m:
            return m
        if out == "HERO_TextPale":
            m = pbr(out, TEXT_COLOR, TEXT_ROUGHNESS, 0.0)
        elif out == NIGHT_LAMP:
            m = pbr(out, LAMP_HEAD_COLOR, LAMP_HEAD_ROUGH, 0.0, NIGHT_EMISSIVE["lamp"])
        elif out == "HERO_LampPole":
            m = pbr(out, LAMP_POLE_COLOR, LAMP_POLE_ROUGH, LAMP_POLE_METAL)
        else:
            sm = bpy.data.materials.get(src) if src else None
            b = principled(sm)
            if b is not None:
                bc = b.inputs["Base Color"]
                color = tuple(sm.diffuse_color[:3]) if bc.is_linked else tuple(bc.default_value[:3])
                rough, metal = b.inputs["Roughness"].default_value, b.inputs["Metallic"].default_value
            else:
                color, rough, metal = (tuple(sm.diffuse_color[:3]) if sm else DEFAULT_COLOR), DEFAULT_ROUGH, 0.0
            night = (NIGHT_EMISSIVE["cyan"] if out in (NIGHT_CYAN, NIGHT_WELL) else
                     NIGHT_EMISSIVE["window"] if src in NIGHT_WINDOWS else
                     NIGHT_EMISSIVE["band"] if src in NIGHT_BANDS else None)
            m = pbr(out, color, rough, metal, night)
        self.cache[out] = m
        return m


# ---------------------------------------------------------------- mesh building
def poly_loops(ls, lt, sel):
    """Loop indices of polygons `sel` in order, and each selected polygon's new loop start."""
    n = lt[sel]
    starts = np.cumsum(n) - n
    return np.arange(n.sum()) - np.repeat(starts, n) + np.repeat(ls[sel], n), starts


class Builder:
    """Accumulates polygons from many chunks into one mesh."""

    def __init__(self):
        self.co, self.lv, self.ls, self.mi, self.smooth, self.mats, self.nv, self.nl = [], [], [], [], [], [], 0, 0

    def add(self, co, lv, ls, lt, sel, smooth, mat_idx):
        loops, starts = poly_loops(ls, lt, sel)
        vids = lv[loops]
        uniq, inv = np.unique(vids, return_inverse=True)
        self.co.append(co[uniq])
        self.lv.append(inv.ravel() + self.nv)
        self.ls.append(starts + self.nl)
        self.mi.append(mat_idx)
        self.smooth.append(smooth[sel])
        self.nv += len(uniq)
        self.nl += len(loops)

    def mat_index(self, m):
        if m not in self.mats:
            self.mats.append(m)
        return self.mats.index(m)

    def mesh(self, name):
        me = tag(bpy.data.meshes.new(name))
        co = np.concatenate(self.co)
        me.vertices.add(len(co)); me.vertices.foreach_set("co", co.astype(np.float32).ravel())
        lv = np.concatenate(self.lv)
        me.loops.add(len(lv)); me.loops.foreach_set("vertex_index", lv.astype(np.int32))
        ls = np.concatenate(self.ls)
        me.polygons.add(len(ls)); me.polygons.foreach_set("loop_start", ls.astype(np.int32))
        me.polygons.foreach_set("material_index", np.concatenate(self.mi).astype(np.int32))
        me.polygons.foreach_set("use_smooth", np.concatenate(self.smooth))
        me.update(calc_edges=True)
        if me.validate(verbose=False):
            print("export_hero: fixed invalid geometry in", name, flush=True)
        for m in self.mats:
            me.materials.append(m)
        return me


def ao_white(me):
    attr = me.color_attributes.get("AO") or me.color_attributes.new("AO", "BYTE_COLOR", "CORNER")
    attr.data.foreach_set("color", np.ones(len(me.loops) * 4, np.float32))
    me.color_attributes.active_color = attr
    me.color_attributes.render_color_index = me.color_attributes.active_color_index
    return attr


def subdivide_long(me, limit):
    bm = bmesh.new()
    bm.from_mesh(me)
    for _ in range(SUBDIV_MAX_PASSES):
        bm.edges.ensure_lookup_table()
        edges = [e for e in bm.edges if limit < e.calc_length() <= SUBDIV_MAX_EDGE]
        if not edges:
            break
        bmesh.ops.subdivide_edges(bm, edges=edges, cuts=1, use_grid_fill=True)
    bm.to_mesh(me)
    bm.free()


# ---------------------------------------------------------------- props helpers
def ground(occ, x, y, top=GROUND_TOP):
    """(z, owner name) of the first walkable surface below (x, y), skipping skywalks, trees, facades etc."""
    h = cast(occ.ray, (x, y, top), (0, 0, -1), 2 * top, NOT_GROUND)
    return (None, None) if h is None else (h[0].z, h[1])


def blimp_radius(occ, centre, mats, vfov, cam_data):
    """Radius in BLIMP_RADII whose orbit at BLIMP_ALTITUDE is most often in the frame-1 view, unoccluded."""
    m1 = mats[hg.FRAME_START]
    pos = m1.translation
    m3 = m1.to_3x3().normalized()
    planes = hg.frustum_planes(tuple(pos), tuple(-m3.col[2]), tuple(m3.col[1]), vfov, RENDER_W / RENDER_H,
                               cam_data.clip_start, cam_data.clip_end)
    best = (-1, None)
    for r in BLIMP_RADII:
        seen = 0
        for k in range(BLIMP_ORBIT_POINTS):
            a = 2 * math.pi * k / BLIMP_ORBIT_POINTS
            p = Vector((centre[0] + r * math.cos(a), centre[1] + r * math.sin(a), BLIMP_ALTITUDE))
            if not hg.aabb_in_frustum(tuple(p), tuple(p), planes):
                continue
            d = p - pos
            if occ.ray(pos, d.normalized(), d.length) is None:
                seen += 1
        if seen > best[0]:
            best = (seen, r)
    return best[1], best[0] / BLIMP_ORBIT_POINTS


def plan_blimps():
    path = os.path.join(OUT_DIR, BLIMPS_JSON)
    if not os.path.exists(path):
        raise RuntimeError(f"{path} missing: run the node -e line from the README (Hero export) first")
    with open(path) as fh:
        bl = json.load(fh)
    return float(np.median([b["len"] for b in bl])), float(np.median([b["r"] for b in bl]))


def lamp_mesh(mats):
    """One mesh: a pole (HERO_LampPole) with a head (NIGHT_Lamp) on top, origin at its foot."""
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, segments=8, radius1=LAMP_POLE_R, radius2=LAMP_POLE_R,
                          depth=LAMP_POLE_H, matrix=Matrix.Translation((0, 0, LAMP_POLE_H / 2)))
    npole = len(bm.faces)
    bmesh.ops.create_cube(bm, size=1.0, matrix=Matrix.Translation((0, 0, LAMP_POLE_H + LAMP_HEAD_H / 2)) @
                          Matrix.Diagonal((LAMP_HEAD_W, LAMP_HEAD_W, LAMP_HEAD_H, 1)))
    for i, f in enumerate(bm.faces):
        f.material_index = 0 if i < npole else 1
    me = tag(bpy.data.meshes.new("HERO_Lamp"))
    bm.to_mesh(me)
    bm.free()
    me.materials.append(mats.get("HERO_LampPole", None))
    me.materials.append(mats.get(NIGHT_LAMP, None))
    ao_white(me)
    return me


def patch_glb(path):
    """Rewrite the glb's JSON chunk: strip NAME_SUFFIX from names and the TAG from extras."""
    with open(path, "rb") as fh:
        data = fh.read()
    jlen = struct.unpack_from("<I", data, 12)[0]
    doc = json.loads(data[20:20 + jlen])
    for key in ("nodes", "meshes", "materials", "cameras", "animations", "scenes"):
        for item in doc.get(key, []):
            if item.get("name", "").endswith(NAME_SUFFIX):
                item["name"] = item["name"][:-len(NAME_SUFFIX)]
            ex = item.get("extras")
            if isinstance(ex, dict):
                ex.pop(TAG, None)
                if not ex:
                    del item["extras"]
    js = json.dumps(doc, separators=(",", ":")).encode()
    js += b" " * (-len(js) % 4)
    rest = data[20 + jlen:]
    out = struct.pack("<III", 0x46546C67, 2, 12 + 8 + len(js) + len(rest)) + struct.pack("<II", len(js), 0x4E4F534A) + js + rest
    with open(path, "wb") as fh:
        fh.write(out)


# ---------------------------------------------------------------- main
def run():
    if not bpy.app.background and not _g.get("ALLOW_LIVE"):
        raise RuntimeError("export_hero: run it headless (blender -b, see README 'Hero export'); a live run "
                           "needs \"ALLOW_LIVE\": True, only after the user has saved and opted in")
    t0 = time.time()
    timing = {}
    scene = bpy.context.scene
    view_layer = bpy.context.view_layer
    frame0 = scene.frame_current
    windows = [(w, w.scene) for w in bpy.context.window_manager.windows]   # the bake can switch them
    os.makedirs(OUT_DIR, exist_ok=True)
    cleanup()
    cam = bpy.data.objects[CAMERA]
    try:
        mats, samples = cameras(scene, cam)
        scene.frame_set(hg.FRAME_START)
        dg = bpy.context.evaluated_depsgraph_get()
        vfov = base_vfov(cam.data)
        half16 = math.tan(vfov / 2) * RENDER_W / RENDER_H
        sht250, sht1 = safe_half_tans(scene, dg, mats, half16)
        sht = max(sht250, sht1)
        frusta = make_frusta(samples, cam.data, vfov, sht)
        eyes = [Vector(samples[i][1]) for i in np.linspace(0, len(samples) - 1, OCCLUSION_SAMPLES).round().astype(int)]
        cams = np.array([s[1] for s in samples])
        timing["setup"] = time.time() - t0

        insts = collect(dg, view_layer)
        timing["collect"] = time.time() - t0
        report = {}

        def rep(it, key, n=1):
            r = report.setdefault(it.coll, {"instances": 0, "in_frustum": 0, "kept": 0, "chunks": 0, "chunks_kept": 0})
            r[key] += n

        in_frustum = []
        for it in insts:
            rep(it, "instances")
            if it.special or in_view(it.lo, it.hi, frusta):
                rep(it, "in_frustum")
                in_frustum.append(it)
        timing["frustum"] = time.time() - t0

        chunks = []
        for it in in_frustum:
            if not it.tree:
                chunk(it, chunks)
        # single-chunk instances passed the frustum test above; split ones are tested per chunk
        chunks = [c for c in chunks if c.inst.special or c.inst.geo.ls.size == len(c.polys)
                  or in_view(c.lo, c.hi, frusta)]
        for i, c in enumerate(chunks):
            c.id = i
        occ = Occluders(chunks)
        timing["bvh"] = time.time() - t0

        kept_chunks = [c for c in chunks if c.inst.special or visible_from(occ, eyes, c.lo, c.hi, c.id)]
        kept_trees = [it for it in in_frustum if it.tree and visible_from(occ, eyes, it.lo, it.hi, -1)]
        for c in chunks:
            rep(c.inst, "chunks")
        for c in kept_chunks:
            rep(c.inst, "chunks_kept")
        for it in {c.inst.idx: c.inst for c in kept_chunks}.values():
            rep(it, "kept")
        for it in kept_trees:
            rep(it, "kept")
        for r in report.values():
            r["dropped_frustum"] = r["instances"] - r["in_frustum"]
            r["dropped_occlusion"] = r["in_frustum"] - r["kept"]
        timing["occlusion"] = time.time() - t0
        if _g.get("STOP_AFTER") == "cull":
            print(json.dumps({"kept_chunks": len(kept_chunks), "kept_trees": len(kept_trees), "timing": timing,
                              "per_collection": report}, indent=1))
            return

        # ---- scratch scene
        hs = tag(bpy.data.scenes.new("HERO_EXPORT_SCENE"))
        hs.render.fps, hs.frame_start, hs.frame_end = FPS, hg.FRAME_START, hg.FRAME_END
        hs.render.resolution_x, hs.render.resolution_y = RENDER_W, RENDER_H
        coll = tag(bpy.data.collections.new("HERO_EXPORT"))
        hs.collection.children.link(coll)
        M = Materials()
        objs = []

        def link(name, me, matrix=None):
            ob = tag(bpy.data.objects.new(name, me))
            if matrix is not None:
                ob.matrix_world = matrix
            coll.objects.link(ob)
            objs.append(ob)
            return ob

        # ---- bands and buckets
        def band_of(lo, hi):
            d = np.min(np.linalg.norm(np.maximum(np.maximum(lo - cams, cams - hi), 0), axis=1))
            return "near" if d < NEAR_DIST else "mid" if d < FAR_DIST else "far"

        tile_size = {"near": NEAR_TILE, "mid": MID_TILE, "far": FAR_TILE}
        buckets, specials = {}, {}
        band_count = {"near": 0, "mid": 0, "far": 0}
        backfaces = 0
        for c in kept_chunks:
            it, g = c.inst, c.inst.geo
            if it.special:
                b = specials.setdefault(it.src if it.special != TEXT_OBJECT else TEXT_OBJECT, Builder())
                for m in np.unique(g.mi[c.polys]):
                    sel = c.polys[g.mi[c.polys] == m]
                    src = g.mat_name(m)
                    out = M.out_name(src, it.special)
                    b.add(c.co, c.lv, g.ls, g.lt, sel, g.smooth, np.full(len(sel), b.mat_index(M.get(out, src))))
                continue
            band = band_of(c.lo, c.hi)
            band_count[band] += 1
            polys = c.polys
            if band == "mid":
                cent, pn = c.cent[polys], c.pn[polys]
                front = np.zeros(len(polys), bool)
                for p in cams:
                    front |= np.einsum("ij,ij->i", p - cent, pn) >= 0
                backfaces += int((~front).sum())
                polys = polys[front]
            if not len(polys):
                continue
            ts = tile_size[band]
            tiles = np.floor(c.cent[polys, :2] / ts).astype(np.int64)
            mis = g.mi[polys]
            for (tx, ty, m) in {(int(a), int(b_), int(mm)) for a, b_, mm in zip(tiles[:, 0], tiles[:, 1], mis)}:
                sel = polys[(tiles[:, 0] == tx) & (tiles[:, 1] == ty) & (mis == m)]
                src = g.mat_name(m)
                out = M.out_name(src, None)
                b = buckets.setdefault((band, tx, ty, out), Builder())
                b.add(c.co, c.lv, g.ls, g.lt, sel, g.smooth, np.zeros(len(sel), np.int64))
                if not b.mats:
                    b.mat_index(M.get(out, src))
        timing["buckets"] = time.time() - t0

        bake, white, far = [], [], []
        for (band, tx, ty, out) in sorted(buckets):
            me = buckets[(band, tx, ty, out)].mesh(f"HERO_{band}_{tx}_{ty}_{out}")
            ob = link(me.name, me)
            src = out.split("_", 1)[1] if out.startswith(("HERO_", "NIGHT_")) else out
            if band == "far":
                far.append(ob)
            elif src in NO_AO_MATERIALS:
                white.append(ob)
            else:
                subdivide_long(me, SUBDIV_NEAR if band == "near" else SUBDIV_MID)
                bake.append(ob)
        for name in sorted(specials):
            me = specials[name].mesh(name + NAME_SUFFIX)
            ob = link(name + NAME_SUFFIX, me)
            (bake if name == TEXT_OBJECT or name in WELL_RING_LIGHTS else white).append(ob)

        # ---- trees: one mesh per species part, linked duplicates
        species = {}
        for it in kept_trees:
            me = species.get(it.species)
            if me is None:
                b = Builder()
                g = it.geo
                for m in np.unique(g.mi):
                    sel = np.nonzero(g.mi == m)[0]
                    src = g.mat_name(m)
                    b.add(g.co, g.lv, g.ls, g.lt, sel, g.smooth, np.full(len(sel), b.mat_index(M.get(M.out_name(src, None), src))))
                me = species[it.species] = b.mesh("HERO_tree_" + it.species)
                ao_white(me)
            link(f"HERO_tree_{it.species}_{it.idx}", me, Matrix(it.M.tolist()))
        timing["realise"] = time.time() - t0

        # ---- far: decimate
        for ob in far:
            mod = ob.modifiers.new("decimate", "DECIMATE")
            mod.decimate_type, mod.ratio = "COLLAPSE", FAR_DECIMATE
        vl = hs.view_layers[0]
        # Never pass window= here: overriding the window together with another scene crashes
        # Blender 5.2 on depsgraph evaluation (seen live and headless).
        with bpy.context.temp_override(scene=hs, view_layer=vl):
            hdg = bpy.context.evaluated_depsgraph_get()
        for ob in far:
            old = ob.data
            new = tag(bpy.data.meshes.new_from_object(ob.evaluated_get(hdg)))
            ob.modifiers.clear()
            ob.data = new
            bpy.data.meshes.remove(old)
            new.name = ob.name
            if new.validate(verbose=False):
                print("export_hero: fixed invalid geometry after decimate in", new.name, flush=True)
            ao_white(new)
        for ob in white:
            ao_white(ob.data)
        timing["decimate"] = time.time() - t0

        # ---- well water: a disc over the water seen through the well below the Text at frame 250
        wo = bpy.data.objects[WELL_OBJECT]
        well_c = sum((wo.matrix_world @ Vector(b) for b in wo.bound_box), Vector()) / 8
        e250 = mats[hg.FRAME_END].translation
        water_hits = []
        for i in range(-WELL_PROBE_N, WELL_PROBE_N + 1):
            for j in range(-WELL_PROBE_N, WELL_PROBE_N + 1):
                d = (Vector((well_c.x + i * WELL_PROBE_STEP, well_c.y + j * WELL_PROBE_STEP, well_c.z)) - e250).normalized()
                h = cast(occ.ray, e250, d, WELL_PROBE_DIST, (TEXT_OBJECT,))
                h = h[0] if h else None
                if h is not None:
                    tri = occ.bvh.ray_cast(h - d * 0.01, d, 0.1)[2]
                    if tri is not None and occ.mat[tri] == WATER_MATERIAL:
                        water_hits.append(h)
        if water_hits:
            wz = float(np.median([h.z for h in water_hits]))
            wr = max((h.to_2d() - well_c.to_2d()).length for h in water_hits) + WELL_WATER_PAD
            bm = bmesh.new()
            bmesh.ops.create_circle(bm, cap_ends=True, segments=WELL_WATER_SEGMENTS, radius=wr)
            me = tag(bpy.data.meshes.new(WELL_WATER_NAME))
            bm.to_mesh(me)
            bm.free()
            me.materials.append(M.get("HERO_" + WATER_MATERIAL, WATER_MATERIAL))
            ao_white(me)
            link(WELL_WATER_NAME, me, Matrix.Translation((well_c.x, well_c.y, wz + WELL_WATER_LIFT)))
            well_water = WELL_WATER_NAME
        else:
            well_water = "KIT_Walkway_ring1_water"

        # ---- lamp posts and walk paths
        m1 = mats[hg.FRAME_START]
        fwd = (-m1.to_3x3().normalized().col[2]).to_2d().normalized()
        side = Vector((fwd.y, -fwd.x))
        centre2 = well_c.to_2d()
        probe = centre2 + fwd * AVENUE_PROBE
        pave = {}
        for sgn in (1, -1):
            offs = []
            for k in range(int(FRONTAGE_SEARCH / PAVE_PROBE_STEP)):
                q = probe + side * (sgn * k * PAVE_PROBE_STEP)
                if (ground(occ, q.x, q.y)[1] or "").startswith(PAVEMENT_OBJECT):
                    offs.append(k * PAVE_PROBE_STEP)
                elif offs:
                    break
            if not offs:
                raise RuntimeError(f"no {PAVEMENT_OBJECT} found {AVENUE_PROBE} m up the avenue")
            pave[sgn] = (min(offs), max(offs))
        cam_xy = [Vector(s[1]).to_2d() for s in samples]

        def clear(q):
            return min((q - c).length for c in cam_xy) >= LAMP_CAMERA_CLEARANCE

        lamp_pts = []
        for sgn in (1, -1):
            off = pave[sgn][0] + LAMP_KERB_INSET
            lamp_pts += [centre2 + fwd * float(s) + side * (sgn * off)
                         for s in np.arange(AVENUE_START, AVENUE_START + AVENUE_LEN + 0.1, LAMP_AVENUE_SPACING)]
        for k in range(int(round(360 / LAMP_RING_STEP_DEG))):
            a = math.radians(k * LAMP_RING_STEP_DEG)
            lamp_pts.append(centre2 + Vector((math.cos(a), math.sin(a))) * PLAZA_LAMP_R)
        lmesh = None
        n_lamps = 0
        for q in lamp_pts:
            z = ground(occ, q.x, q.y)[0] if clear(q) else None
            if z is None:
                continue
            lo = (q.x - LAMP_HEAD_W / 2, q.y - LAMP_HEAD_W / 2, z)
            hi = (q.x + LAMP_HEAD_W / 2, q.y + LAMP_HEAD_W / 2, z + LAMP_POLE_H + LAMP_HEAD_H)
            if not in_view(lo, hi, frusta):
                continue
            lmesh = lmesh or lamp_mesh(M)
            link(f"HERO_lamp_{n_lamps:03d}", lmesh, Matrix.Translation((q.x, q.y, z)))
            n_lamps += 1

        def path(points):
            out = []
            for q in points:
                z = ground(occ, q.x, q.y)[0]
                if z is not None:
                    out.append(gl((q.x, q.y, z)))
            return out

        ring_path = path([centre2 + Vector((math.cos(a), math.sin(a))) * PLAZA_WALK_R
                          for a in np.linspace(0, 2 * math.pi, WALK_RING_POINTS, endpoint=False)])
        walk_paths = [ring_path + ring_path[:1]]
        for sgn in (1, -1):
            a, b_ = pave[sgn]
            for f in (1 / 3, 2 / 3):
                off = a + (b_ - a) * f
                walk_paths.append(path([centre2 + fwd * float(s) + side * (sgn * off)
                                        for s in np.arange(AVENUE_START, AVENUE_START + AVENUE_LEN + 0.1, AVENUE_STEP)]))
        timing["props_geo"] = time.time() - t0

        # ---- AO bake
        world = tag(bpy.data.worlds.new("HERO_EXPORT_World"))
        world.light_settings.distance = AO_DISTANCE
        hs.world = world
        try:
            hs.render.engine = "CYCLES"
        except TypeError as e:
            raise RuntimeError(f"Cycles unavailable: {e}")
        hs.cycles.samples = AO_SAMPLES
        hs.cycles.seed = 0
        hs.cycles.use_denoising = False
        targets = [i.identifier for i in bpy.types.BakeSettings.bl_rna.properties["target"].enum_items]
        vc_target = next(t for t in targets if "VERTEX" in t)
        hs.render.bake.target = vc_target
        for ob in bake:
            attr = ob.data.color_attributes.new("AO", "BYTE_COLOR", "CORNER")
            ob.data.color_attributes.active_color = attr
            ob.data.color_attributes.render_color_index = ob.data.color_attributes.active_color_index
        for ob in objs:
            ob.select_set(ob in bake, view_layer=vl)
        if bake:
            vl.objects.active = bake[0]
            with bpy.context.temp_override(scene=hs, view_layer=vl, active_object=bake[0],
                                           selected_objects=bake, selected_editable_objects=bake):
                bpy.ops.object.bake(type="AO", target=vc_target, use_clear=True)
        timing["bake"] = time.time() - t0

        # ---- camera
        cdata = tag(cam.data.copy())
        cdata.name = "HeroCamera"
        cdata.sensor_fit = "HORIZONTAL"
        hc = tag(bpy.data.objects.new("HeroCamera", cdata))
        hs.collection.objects.link(hc)
        hs.camera = hc
        hc.rotation_mode = "QUATERNION"
        prev = None
        for f in range(hg.FRAME_START, hg.FRAME_END + 1):
            loc, rot, _ = mats[f].decompose()
            if prev is not None:
                rot.make_compatible(prev)
            prev = rot
            hc.location, hc.rotation_quaternion = loc, rot
            hc.keyframe_insert("location", frame=f)
            hc.keyframe_insert("rotation_quaternion", frame=f)
        act = tag(hc.animation_data.action)
        act.name = "Hero"
        from bpy_extras import anim_utils
        for fc in anim_utils.action_get_channelbag_for_slot(act, hc.animation_data.action_slot).fcurves:
            for kp in fc.keyframe_points:
                kp.interpolation = "LINEAR"

        # ---- props
        lan = bpy.data.objects[LANTERN_OBJECT]
        lc = [lan.matrix_world @ Vector(b) for b in lan.bound_box]
        lantern = (sum(v.x for v in lc) / 8, sum(v.y for v in lc) / 8, min(v.z for v in lc))
        radius, frac = blimp_radius(occ, lantern, mats, vfov, cam.data)
        blen, br = plan_blimps()
        sun = next((o for o in scene.objects if o.type == "LIGHT" and o.data.type == "SUN"), None)
        sun_dir = sun.matrix_world.to_3x3().normalized().col[2] if sun else Vector((0, 0, 1))
        night = sorted({m.name for m in M.cache.values() if m.name.startswith("NIGHT_")})
        # the only nodes allowed to carry the Lantern / well-ring night materials (for the Task 4 glb test)
        night_nodes = {}
        for name in sorted(specials):
            for m in specials[name].mats:
                if m.name in (NIGHT_CYAN, NIGHT_WELL):
                    night_nodes.setdefault(m.name, []).append(name)
        props = {
            "version": 1, "fps": FPS, "frames": [hg.FRAME_START, hg.FRAME_END],
            "base_vfov_deg": round(math.degrees(vfov), 6),
            "safe_half_tan": {"f250": round(sht250, 6), "f1": round(sht1, 6)},
            "sun": {"dir": gl(sun_dir.normalized())},   # unit vector from the scene toward the sun (sun's +Z)
            "lantern": gl(lantern),
            "blimps": {"count": BLIMP_COUNT, "radius": radius, "altitude": BLIMP_ALTITUDE, "period_s": BLIMP_PERIOD_S,
                       "len": blen, "r": br},
            "walk_paths": walk_paths,
            "well_water": well_water,
            "night": night,
            "night_nodes": night_nodes,
        }
        with open(os.path.join(OUT_DIR, "hero_props.json"), "w") as fh:
            json.dump(props, fh, indent=1)

        # ---- export
        for ob in objs:
            ob.select_set(True, view_layer=vl)
        hc.select_set(True, view_layer=vl)
        valid = {p.identifier for p in bpy.ops.export_scene.gltf.get_rna_type().properties}
        opts = {"export_format": "GLB", "use_selection": True, "use_active_scene": True, "export_cameras": True,
                "export_animations": True, "export_apply": True, "export_extras": True, "export_yup": True,
                "export_vertex_color": "ACTIVE", "export_all_vertex_colors": False, "export_materials": "EXPORT",
                "export_image_format": "NONE", "export_texcoords": False, "export_normals": True,
                "export_lights": False, "export_frame_range": True, "export_anim_slide_to_zero": True,
                "export_force_sampling": True, "export_animation_mode": "ACTIONS", "export_optimize_animation_size": False}
        opts = {k: v for k, v in opts.items() if k in valid}
        glb = os.path.join(OUT_DIR, "hero_raw.glb")
        with bpy.context.temp_override(scene=hs, view_layer=vl):
            bpy.ops.export_scene.gltf(filepath=glb, **opts)
        patch_glb(glb)
        timing["export"] = time.time() - t0

        tri = 0
        for o in objs:
            o.data.calc_loop_triangles()
            tri += len(o.data.loop_triangles)
        out = {
            "counts": {
                "instances": len(insts), "in_frustum": len(in_frustum), "chunks": len(chunks),
                "chunks_kept": len(kept_chunks), "trees_kept": len(kept_trees), "tree_species": len(species),
                "bands": band_count, "mid_backfaces_dropped": backfaces, "objects": len(objs),
                "joined_meshes": len(buckets), "named": sorted(specials), "lamps": n_lamps, "triangles": tri,
                "materials": sorted(m.name for m in M.cache.values()),
                "blimp_orbit_visible": round(frac, 4),
            },
            "per_collection": dict(sorted(report.items())),
            "glb_bytes": os.path.getsize(glb),
            "timing_s": {k: round(v, 1) for k, v in timing.items()},
        }
        with open(os.path.join(OUT_DIR, "export_report.json"), "w") as fh:
            json.dump(out, fh, indent=1)
        print(json.dumps({k: out[k] for k in ("counts", "glb_bytes", "timing_s")}, indent=1))
    finally:
        for w, s in windows:
            if w.scene != s:
                w.scene = s
        cleanup()
        scene.frame_set(frame0)


if __name__ in ("eh", "__main__"):
    run()
