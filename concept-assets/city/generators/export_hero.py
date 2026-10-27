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
               LAMP_RING_STEP_DEG round the plaza ring (clear of the camera and of the avenue mouth),
               linked duplicates.
  camera       HeroCamera, no parent, world matrix keyed every frame 1-250 (linear), action `Hero`.
  props        sun (dir: from the scene toward the sun), Lantern, blimp orbit (radius searched for the
               visible sky above the frontage), walk paths (the avenue pavements, cut where they pass
               within WALK_CAMERA_CLEARANCE of the camera path; no walkers circle the plaza), well water node, night material names and
               night_nodes (the nodes allowed NIGHT_MAT_AP_Cyan / NIGHT_WellRing). glTF space: (x, z, -y).
  robot routes robot_routes(): before the lamps, lines across the view on the ring avenues and cross streets that
               cross the hero avenue (cross lines walkable ROUTE_MIN_REACH both ways), trimmed to ROUTE_PAD past what
               the 16:9 sample views see; no lamp stands on one (props "robot_routes").
  idle spots   idle_spots(): ledge edges to sit on and walls/railings to lean on (with the wall top, for a forward
               lean), from an IDLE_GRID height map of the kept scene within IDLE_RANGE of the camera, refined with
               sideways rays; clear of the camera, the walk paths, the robot routes and water, IDLE_SPACING apart,
               in view (props "idle_spots").
  talk spots   talk_spots(): open flat discs of the same height map for conversation circles, clear of walls, the
               camera, walk paths, robot routes and idle spots, in view (props "talk_spots").

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
NEAR_TILE, MID_TILE, FAR_TILE = 200.0, 200.0, 800.0
FAR_DECIMATE = 0.25                     # Decimate (collapse) ratio for far meshes
SUBDIV_NEAR, SUBDIV_MID = 4.0, 12.0     # m: split edges longer than this before the AO bake
SUBDIV_MAX_EDGE = 200.0                 # m: faces with longer edges (sea, ground sheets) are not split
SUBDIV_MAX_PASSES = 6
SMOOTH_ANGLE_DEG = 30.0                  # smooth by angle: edges between faces closer than this shade smooth
AO_SAMPLES, AO_DISTANCE = 32, 8.0
AO_SMOOTH_PASSES = 2                    # neighbour-averaging passes over the baked AO (smooth_ao)
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
PLAZA_LAMP_R = 11.3                     # m round the well centre, on the walkway deck
WALK_CAMERA_CLEARANCE = 8.0             # m: walk path points this close to the camera path are dropped
WALK_CHEST_H = 1.3                      # m above the ground: where a walker is measured from the camera
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

# Idle people (sitting on ledges, leaning on walls): candidate spots found by ray probes (idle_spots()).
IDLE_RANGE = 150.0                      # m: spots this far (3D) from the camera path at most, for a readable size
IDLE_GRID = 0.5                         # m between the downward probes of the idle height map
IDLE_SKIP = FRONTAGE_SKIP + ("Text",)   # not seats or walls: skywalks, trees, the Text
IDLE_FLAT_NZ = 0.95                     # |normal z| of a level surface (ledge top, ground)
IDLE_WALL_NZ = 0.3                      # |normal z| below this: a vertical surface (riser, wall)
IDLE_TOL = 0.04                         # m: heights this close count as one level
SIT_DROP = (0.35, 0.6)                  # m: ledge top above the ground in front
SIT_BEHIND = (0.1, 0.25, 0.4)           # m behind the edge probed for a level seat
SIT_FRONT = (0.15, 0.3, 0.5)            # m in front of the edge probed for level ground under knees and feet
SIT_KNEE_CLEAR = 0.8                    # m in front of the knees that must be free
SIT_HEAD_CLEAR = 1.2                    # m above the seat that must be free
SIT_BACK_CLEAR = 0.3                    # m behind the seat edge free at back height (SIT_BACK_H)
SIT_BACK_H = 0.6
LEAN_CONTACT_HS = (0.9, 0.95, 1.0, 1.05, 1.1, 1.15, 1.2)   # m above the ground: where the back can rest
LEAN_LEG_HS = (0.3, 0.55, 0.75)         # m: nothing at leg height may stick out past the contact
LEAN_STICK_OUT = 0.05                   # m
LEAN_FRONT = (0.3, 0.6, 1.0)            # m in front of the wall probed for level standing ground
LEAN_CLEAR_HS, LEAN_CLEAR_D = (0.3, 1.0, 1.6), 1.0   # heights (m) of the rays that must run free out from the wall
LEAN_BODY_H, LEAN_BODY_D = 1.5, 0.3     # at shoulder height nothing sticks out past the contact either
IDLE_SIDE_D = 0.3                       # m either side of the body that must be free (rays) and level (seat, ground)
LEAN_SIDE_HS = (0.5, 1.0, 1.5)          # m above the ground: sideways rays from LEAN_BODY_D out of the wall
SIT_SIDE_HS = (0.15, 0.5, 0.9)          # m above the seat: sideways rays from SIT_SEAT_IN behind the edge
SIT_SEAT_IN = 0.15                      # m behind the edge: where the seat is probed sideways
IDLE_BODY_REACH = 0.4                   # m out along the facing: the body point also kept off the walk paths
IDLE_PATH_CLEARANCE = 1.2               # m from every walk path line
IDLE_LEVEL = 3.0                        # m: feet within this of the nearest walk path point's height (no roofs)
IDLE_SPACING = 1.0                      # m between spots at least
IDLE_MAX_SPOTS = 400                    # spots written at most (stride-picked per pose)
IDLE_VIEW_H = 0.8                       # m above the spot: the point that must be seen from a sample camera
WELL_AREA_R = 20.0                      # m round the well centre: area "well" (its walkway); along the avenue: "avenue"
AVENUE_AREA_PAD = 10.0                  # m past the outer pavement edge still counted as the avenue
LEAN_TOP_HS = tuple(round(0.9 + 0.05 * k, 2) for k in range(19))   # m: rays scanned up the wall for its top (to 1.8)
LEAN_TOP_REACH = 0.15                   # m past the contact surface the scan rays reach

# Robot routes: where the robot crosses the hero view, screen left to right or back, on the ring avenues and
# streets that cross the hero avenue (robot_routes()).
ROUTE_RANGE = (AVENUE_START, 500.0)     # m along the avenue searched for crossings
ROUTE_SCAN_STEP = 1.0                   # m along the avenue between the cross lines scanned
ROUTE_STEP = 2.0                        # m between route points (and between the probes across)
ROUTE_REACH = 90.0                      # m either side of the avenue axis a route may run
ROUTE_MIN_REACH = 60.0                  # m either side the ground must be walkable for a cross line to count: past
                                        # the avenue frontage (about 46 m out), so dead-end gaps between its buildings don't
ROUTE_MIN_W = 3.0                       # m of cross lines in a row: a crossing (the robot's width is checked per route)
ROBOT_STEP_MAX = 0.7                    # m: steps up to this (the avenue's 0.6 m pavement edge) are walkable
ROBOT_H, ROBOT_HALF_W = 4.5, 1.5        # m: room for the robot (4.06 m tall) above and to either side of a route
ROBOT_VIEW_H = 2.0                      # m above the route: the point that must be seen from a sample camera
ROBOT_CAMERA_CLEARANCE = 12.0           # m from the camera path to that point
ROUTE_TREE_CLEAR = 2.0                  # m from a tree's centre (its trunk) to the route line
ROUTE_PAD = 8.0                         # m a route runs on past what any sample camera sees, at both ends
ROUTE_LAMP_CLEAR = 3.0                  # m: no lamp post this close to a route
ROUTE_IDLE_CLEAR = 3.0                  # m: no idle spot (pos or body) or talk circle this close to a route
RING_LANES = (-0.25, 0.25)              # ring avenue routes: these fractions of the road width out from its radius
PLAN_JSON = "plan.json"                 # the plan (scene centre, ring avenue radii), next to this script

# Conversation circles: open flat ground where a few people stand and talk (talk_spots()).
TALK_RADII = (2.2, 1.9, 1.6)            # m of free flat ground round the centre; the largest that fits is kept
TALK_TOL = 0.06                         # m: every height-map cell of the disc within this of the centre's height
TALK_STRIDE = 2                         # height-map cells between the centres tried
TALK_CLEAR_HS = (0.3, 1.0, 1.7)         # m above the ground: rays out from the centre, free to the radius + 0.3
TALK_CLEAR_DIRS = 8
TALK_HEADROOM = 2.2                     # m above the centre and the disc's rim that must be free
TALK_IDLE_GAP = 1.0                     # m past the radius to the nearest idle spot
TALK_SPACING = 3.0                      # m between two circles' rims
TALK_MAX_SPOTS = 60                     # written at most (stride-picked)
TALK_NOT_GROUND = ("KIT_Ave_lane", "KIT_Ave_median", "KIT_Ave_tram", "KIT_Ave_plant", "RINGAVE_")   # roadway

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
    """f250: the Text bounds at frame 250. f1: the avenue frontage where it first enters the 16:9 frame,
    seen from frame 1 (both sides inside the frame's half-width)."""
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
            # Where the frontage first enters the 16:9 frame: nearer, it is still out past the edges.
            x = max(abs(cam_space(m1, h)[0]) for h in hits)
            if x <= half16:
                f1 = x
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
        self.co, self.lv, self.ls, self.mi, self.mats, self.nv, self.nl = [], [], [], [], [], 0, 0
        self.vmap = {}   # id(co) -> (co, new vertex index per source vertex, -1 = not added yet)

    def add(self, co, lv, ls, lt, sel, mat_idx):
        """Add the polygons `sel`. Adds that pass the same `co` array (chunks of one instance) share their
        vertices, so normals and AO stay continuous across the chunk boundaries."""
        loops, starts = poly_loops(ls, lt, sel)
        vids = lv[loops]
        uniq, inv = np.unique(vids, return_inverse=True)
        if id(co) not in self.vmap:   # co is kept in the entry so its id can't be reused
            self.vmap[id(co)] = (co, np.full(len(co), -1, np.int64))
        vmap = self.vmap[id(co)][1]
        fresh = uniq[vmap[uniq] < 0]
        vmap[fresh] = self.nv + np.arange(len(fresh))
        self.co.append(co[fresh])
        self.lv.append(vmap[uniq][inv.ravel()])
        self.ls.append(starts + self.nl)
        self.mi.append(mat_idx)
        self.nv += len(fresh)
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
        me.update(calc_edges=True)
        if me.validate(verbose=False):
            print("export_hero: fixed invalid geometry in", name, flush=True)
        smooth_by_angle(me)
        for m in self.mats:
            me.materials.append(m)
        return me


def smooth_by_angle(me):
    """Shade smooth, with edges sharper than SMOOTH_ANGLE_DEG kept hard. Replaces the source faces' own
    smooth flags: the merged meshes lose the sources' sharp edges, so a face flagged smooth otherwise
    blends its normals across 90-degree corners."""
    me.shade_smooth()
    me.set_sharp_from_angle(angle=math.radians(SMOOTH_ANGLE_DEG))


def smooth_ao(me, passes=AO_SMOOTH_PASSES):
    """Average the baked AO per vertex, then blend each vertex with its edge neighbours `passes` times.
    Cycles bakes vertex AO at the exact vertex position, so corners that touch other geometry (the foot of
    each well-ring riser) come out black or white by float luck; alternating neighbours drew a sawtooth."""
    attr = me.color_attributes.get("AO")
    nl, nv = len(me.loops), len(me.vertices)
    if attr is None or nl == 0:
        return
    col = np.empty(nl * 4, np.float32); attr.data.foreach_get("color", col)
    col = col.reshape(-1, 4)
    lv = np.empty(nl, np.int64); me.loops.foreach_get("vertex_index", lv)
    ev = np.empty(len(me.edges) * 2, np.int64); me.edges.foreach_get("vertices", ev)
    a, b = ev[0::2], ev[1::2]
    deg = np.bincount(a, minlength=nv) + np.bincount(b, minlength=nv)
    v = np.bincount(lv, col[:, 0], nv) / np.maximum(np.bincount(lv, minlength=nv), 1)
    for _ in range(passes):
        nsum = np.bincount(a, v[b], nv) + np.bincount(b, v[a], nv)
        v = np.where(deg > 0, 0.5 * v + 0.5 * nsum / np.maximum(deg, 1), v)
    col[:, :3] = v[lv, None]
    attr.data.foreach_set("color", col.ravel())


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


def probe(occ, o, d, dist, skip=IDLE_SKIP):
    """(location, normal, triangle, owner name) of the first hit along o + t d (t <= dist) whose owner doesn't
    start with `skip`, or None. The normal is turned to face back along the ray."""
    o, d = Vector(o), Vector(d)
    for _ in range(CAST_MAX_HOPS):
        loc, n, tri, t = occ.bvh.ray_cast(o, d, dist)
        if loc is None:
            return None
        name = occ.src[occ.owner[tri]]
        if not name.startswith(skip):
            return loc, (-n if n.dot(d) > 0 else n), tri, name
        dist -= t + CAST_NUDGE
        o = loc + d * CAST_NUDGE
        if dist <= 0:
            return None
    return None


class IdleProbes:
    """Downward and sideways probes for idle_spots(): `down` reports the level and the triangle under (x, y)."""
    DOWN = Vector((0, 0, -1))

    def __init__(self, occ, kept_ids):
        self.occ, self.kept = occ, kept_ids

    def down(self, x, y, top=GROUND_TOP):
        """(z, |normal z|, triangle, owner) of the first non-IDLE_SKIP surface below (x, y), or None."""
        h = probe(self.occ, (x, y, top), self.DOWN, 2 * top)
        return None if h is None else (h[0].z, abs(h[1].z), h[2], h[3])

    def z(self, q):
        h = self.down(q.x, q.y)
        return None if h is None or h[1] < IDLE_FLAT_NZ or not self.usable(h[2], h[3]) else h[0]

    def usable(self, tri, owner):
        """Exported geometry, not water, not a facade/roof or street furniture (NOT_GROUND)."""
        return (int(self.occ.owner[tri]) in self.kept and self.occ.mat[tri] != WATER_MATERIAL
                and not owner.startswith(NOT_GROUND))

    def free(self, o, d, dist):
        return probe(self.occ, o, d, dist) is None

    def sides_clear(self, base, z0, face, hs):
        """Room for a body at `base` (x, y) on the level `z0`: rays IDLE_SIDE_D to the left and right of `face`
        at heights `hs` above z0 run free, and the level IDLE_SIDE_D to either side is z0 (hero_geom.side_points)."""
        for sx, sy in hg.side_dirs(face.x, face.y):
            d = Vector((sx, sy, 0))
            if not all(self.free(Vector((base.x, base.y, z0 + h)), d, IDLE_SIDE_D) for h in hs):
                return False
        return hg.lean_profile(z0, [self.z(Vector(q)) for q in hg.side_points(base, face, IDLE_SIDE_D)], IDLE_TOL)


def idle_height_map(pr, cam_xy):
    """Grid (IDLE_GRID, world-aligned) of the first surface below each point within IDLE_RANGE (in x, y) of the
    camera path: (xs, ys, z, nz, ok, own) arrays, z NaN where nothing was hit. ok: level and usable (IdleProbes);
    own: the surface's owner name ("" where nothing was hit)."""
    lo, hi = cam_xy.min(0) - IDLE_RANGE, cam_xy.max(0) + IDLE_RANGE
    xs = np.arange(math.floor(lo[0] / IDLE_GRID), math.ceil(hi[0] / IDLE_GRID) + 1) * IDLE_GRID
    ys = np.arange(math.floor(lo[1] / IDLE_GRID), math.ceil(hi[1] / IDLE_GRID) + 1) * IDLE_GRID
    z = np.full((len(ys), len(xs)), np.nan)
    nz = np.zeros_like(z)
    ok = np.zeros(z.shape, bool)
    own = np.full(z.shape, "", dtype=object)
    for j, y in enumerate(ys):
        dy = cam_xy[:, 1] - y
        for i, x in enumerate(xs):
            if np.min((cam_xy[:, 0] - x) ** 2 + dy ** 2) > IDLE_RANGE ** 2:
                continue
            h = pr.down(float(x), float(y))
            if h is None:
                continue
            z[j, i], nz[j, i], own[j, i] = h[0], h[1], h[3]
            ok[j, i] = h[1] >= IDLE_FLAT_NZ and pr.usable(h[2], h[3])
    return xs, ys, z, nz, ok, own


def sit_spot(pr, top_z, low_xy, d):
    """A seat on the ledge whose riser is met going from `low_xy` (the lower side) along `d` (toward the ledge),
    or None: (edge point at the ledge top, facing out over the drop, drop)."""
    occ = pr.occ
    h = probe(occ, Vector((low_xy[0], low_xy[1], top_z - 0.1)), d, IDLE_GRID * 1.5)
    if h is None or abs(h[1].z) > IDLE_WALL_NZ:
        return None
    face = Vector((h[1].x, h[1].y)).normalized()
    edge = h[0].to_2d()
    top = pr.z(edge - face * 0.05)
    if top is None or abs(top - top_z) > IDLE_TOL:
        return None
    drop = hg.sit_profile(top, [pr.z(edge - face * b) for b in SIT_BEHIND],
                          [pr.z(edge + face * f) for f in SIT_FRONT], SIT_DROP, IDLE_TOL)
    if drop is None:
        return None
    e3 = Vector((edge.x, edge.y, top))
    f3 = face.to_3d()
    if not (pr.free(e3 + f3 * 0.02 + Vector((0, 0, 0.1)), f3, SIT_KNEE_CLEAR)
            and pr.free(e3 - f3 * 0.15 + Vector((0, 0, 0.05)), Vector((0, 0, 1)), SIT_HEAD_CLEAR)
            and pr.free(e3 + Vector((0, 0, SIT_BACK_H)), -f3, SIT_BACK_CLEAR)):
        return None
    if not pr.sides_clear(edge - face * SIT_SEAT_IN, top, face, SIT_SIDE_HS):
        return None
    return e3, face, drop


def lean_spot(pr, ground_z, xy, d):
    """A wall or railing to lean on, met going from the ground at `xy` along `d`, or None: (wall-foot point on
    the ground, facing away from the wall). The contact is the nearest vertical surface at LEAN_CONTACT_HS
    (a railing's handrail or a wall); nothing lower may stick out past it, so the legs stay clear."""
    occ = pr.occ
    hits = []
    for h_ in LEAN_CONTACT_HS:
        h = probe(occ, Vector((xy[0], xy[1], ground_z + h_)), d, IDLE_GRID * 1.5)
        if h is not None and abs(h[1].z) <= IDLE_WALL_NZ:
            hits.append(((h[0] - Vector((xy[0], xy[1], h[0].z))).length, h, h_))
    if not hits:
        return None
    dist, hit, contact_h = min(hits, key=lambda t: t[0])
    face = Vector((hit[1].x, hit[1].y)).normalized()
    if face.dot(Vector(d).to_2d()) > -0.7:
        return None
    for h_ in LEAN_LEG_HS:
        h = probe(occ, Vector((xy[0], xy[1], ground_z + h_)), d, dist)
        if h is not None and (h[0].to_2d() - Vector(xy)).length < dist - LEAN_STICK_OUT:
            return None
    foot2 = hit[0].to_2d() + face * 0.02
    gz = pr.z(foot2 + face * 0.1)
    if gz is None or abs(gz - ground_z) > IDLE_TOL:
        return None
    if not hg.lean_profile(gz, [pr.z(foot2 + face * f) for f in LEAN_FRONT], IDLE_TOL):
        return None
    foot = Vector((foot2.x, foot2.y, gz))
    f3 = face.to_3d()
    if not all(pr.free(foot + f3 * 0.05 + Vector((0, 0, h_)), f3, LEAN_CLEAR_D) for h_ in LEAN_CLEAR_HS):
        return None
    body = probe(occ, foot + f3 * LEAN_BODY_D + Vector((0, 0, LEAN_BODY_H)), -f3, LEAN_BODY_D)
    if body is not None and (body[0] - foot).to_2d().length > LEAN_STICK_OUT:
        return None
    if not pr.sides_clear(foot2 + face * LEAN_BODY_D, gz, face, LEAN_SIDE_HS):
        return None
    return foot, face, wall_top(pr, hit[0].to_2d(), face, gz, contact_h)


def wall_top(pr, contact, face, gz, contact_h):
    """Height (m above the ground gz) of the top of the wall or railing whose face is at `contact` (x, y),
    facing `face`, or None for a wall taller than LEAN_TOP_HS (for a forward lean, forearms on the top).
    Rays toward the face are scanned up from the contact height (hero_geom.wall_top); a downward ray just
    behind the face then finds the top itself (a railing too thin for it keeps the scan's estimate)."""
    f3 = face.to_3d()
    hs = [contact_h] + [h for h in LEAN_TOP_HS if h > contact_h]
    o = Vector((contact.x, contact.y, 0)) + f3 * LEAN_BODY_D
    hits = [probe(pr.occ, o + Vector((0, 0, gz + h)), -f3, LEAN_BODY_D + LEAN_TOP_REACH) is not None for h in hs]
    top = hg.wall_top(hs, hits)
    if top is None:
        return None
    q = contact - face * 0.03
    h = probe(pr.occ, Vector((q.x, q.y, gz + top + 0.02)), Vector((0, 0, -1)), 0.2)
    if h is not None and abs(h[1].z) >= 0.7:
        return round(h[0].z - gz, 3)
    return round(top - 0.025, 3)


def area_of(p2, well_c, fwd, side, pave_out):
    """'well' within WELL_AREA_R of the well centre, 'avenue' along it (to AVENUE_AREA_PAD past the pavement), else 'other'."""
    q = p2 - well_c.to_2d()
    along, across = q.dot(fwd), abs(q.dot(side))
    return ("well" if q.length < WELL_AREA_R else
            "avenue" if 0 <= along <= AVENUE_START + AVENUE_LEN and across <= pave_out + AVENUE_AREA_PAD else "other")


def seen_from(occ, eyes, tgt):
    """True if a ray from some eye reaches `tgt` unblocked."""
    for e in eyes:
        v = tgt - e
        if occ.bvh.ray_cast(e, v.normalized(), v.length - RAY_EPS)[0] is None:
            return True
    return False


def idle_spots(pr, hm, cam_path, samples, frusta, walk_lines, route_lines, well_c, fwd, side, pave_out, debug=None):
    """Candidate spots for idle people in the kept scene. Sit: a level ledge top with a SIT_DROP drop in front
    (any riser the height map crosses); lean: a vertical surface at LEAN_CONTACT_HS (a wall or a railing's
    handrail) with level free ground in front. Kept only clear of the camera (WALK_CAMERA_CLEARANCE at the
    chest, every frame), of the walk path lines (IDLE_PATH_CLEARANCE), of water and of each other
    (IDLE_SPACING), at street level (IDLE_LEVEL: no roofs), within IDLE_RANGE, in view and seen from at least one sample camera,
    and ROUTE_IDLE_CLEAR from the robot routes (Blender x, y lines). `pr`: IdleProbes; `hm`: idle_height_map().
    Returns (spots in glTF space, sorted by position; counts)."""
    occ = pr.occ
    cams = np.array([tuple(c) for c in cam_path])
    xs, ys, z, nz, ok, _own = hm
    counts = {"cells": int(np.isfinite(z).sum()), "level_cells": int(ok.sum())}
    if debug is not None:
        debug.update(xs=xs, ys=ys, z=z, ok=ok)
    raw = []
    dirs = ((1, 0), (-1, 0), (0, 1), (0, -1))
    for j, i in zip(*np.nonzero(ok)):
        x, y, zc = float(xs[i]), float(ys[j]), float(z[j, i])
        for di, dj in dirs:
            jj, ii = j + dj, i + di
            if not (0 <= jj < len(ys) and 0 <= ii < len(xs)) or not np.isfinite(z[jj, ii]):
                continue
            dz = float(z[jj, ii]) - zc
            d = Vector((di, dj, 0))
            if ok[jj, ii] and SIT_DROP[0] - IDLE_TOL <= -dz <= SIT_DROP[1] + IDLE_TOL:
                # (x, y) is on the ledge, the neighbour below it: probe from the neighbour back toward it
                s_ = sit_spot(pr, zc, (float(xs[ii]), float(ys[jj])), -d)
                if s_:
                    raw.append(("sit", s_[0], s_[1], s_[2], None))
            elif not ok[jj, ii] or abs(dz) > IDLE_TOL:
                # anything but more of the same ground: a wall, a railing (thin: its base or nothing is
                # what the height map sees), a drop
                l_ = lean_spot(pr, zc, (x, y), d)
                if l_:
                    raw.append(("lean", l_[0], l_[1], None, l_[2]))
    counts["raw"] = len(raw)
    if debug is not None:
        debug["raw"] = np.array([(pose == "sit", p.x, p.y, p.z, f.x, f.y, dr or 0) for pose, p, f, dr, _t in raw])
    eyes = [Vector(s[1]) for s in samples]
    walk_pts = np.array([q for line in walk_lines for q in line])
    out = []
    for pose, p, face, drop, top in raw:
        feet_z = p.z - (drop or 0.0)
        chest = np.array((p.x, p.y, feet_z + WALK_CHEST_H))
        dist = np.linalg.norm(cams - chest, axis=1)
        if dist.min() < WALK_CAMERA_CLEARANCE or np.linalg.norm(cams - np.array(p), axis=1).min() > IDLE_RANGE:
            continue
        reach = p.to_2d() + face * IDLE_BODY_REACH
        if any(min(hg.polyline_dist((p.x, p.y), line), hg.polyline_dist((reach.x, reach.y), line)) < IDLE_PATH_CLEARANCE
               for line in walk_lines):
            continue
        if any(min(hg.polyline_dist((p.x, p.y), line), hg.polyline_dist((reach.x, reach.y), line)) < ROUTE_IDLE_CLEAR
               for line in route_lines):
            continue
        street = walk_pts[np.argmin(np.sum((walk_pts[:, :2] - (p.x, p.y)) ** 2, axis=1)), 2]
        if abs(feet_z - street) > IDLE_LEVEL:
            continue
        lo, hi = (p.x - 0.4, p.y - 0.4, feet_z), (p.x + 0.4, p.y + 0.4, feet_z + 1.7)
        if not in_view(lo, hi, frusta):
            continue
        if not seen_from(occ, eyes, p + Vector((0, 0, IDLE_VIEW_H))):
            continue
        out.append((pose, p, face, drop, top, area_of(p.to_2d(), well_c, fwd, side, pave_out)))
    counts["clear"] = len(out)
    out.sort(key=lambda s: (round(s[1].x, 3), round(s[1].y, 3), s[0]))
    out = [out[k] for k in hg.thin_spots([(s[1].x, s[1].y) for s in out], IDLE_SPACING)]
    counts["spaced"] = len(out)
    picked = []
    for pose in ("sit", "lean"):
        picked += hg.stride_pick([s for s in out if s[0] == pose], IDLE_MAX_SPOTS // 2)
    picked.sort(key=lambda s: (round(s[1].x, 3), round(s[1].y, 3), s[0]))
    spots = []
    for pose, p, face, drop, top, area in picked:
        sp = {"pose": pose, "pos": gl(p), "heading": round(hg.gl_heading(face.x, face.y), 4)}
        if pose == "sit":
            sp["drop"] = round(drop, 3)
        else:
            sp["top"] = top
        sp["area"] = area
        spots.append(sp)
    for key in ("sit", "lean"):
        counts[key] = {a: sum(1 for s in spots if s["pose"] == key and s["area"] == a) for a in ("well", "avenue", "other")}
    tops = [s["top"] for s in spots if s["pose"] == "lean" and s["top"] is not None]
    counts["lean_top"] = {"null": sum(1 for s in spots if s["pose"] == "lean" and s["top"] is None),
                          "set": len(tops), "range": [min(tops), max(tops)] if tops else None}
    return spots, counts


def plan_rings():
    """(scene centre (x, y), [(name, radius, road width)]) of the plan's ring avenues, named as their objects
    (RINGAVE_<district>_<index>), from PLAN_JSON."""
    with open(os.path.join(_here, PLAN_JSON)) as fh:
        plan = json.load(fh)
    rings = []
    for d in plan["districts"]:
        if d.get("enabled") is False:
            continue
        for k, av in enumerate(sorted(d.get("avenues", []), key=lambda a: a["r"])):
            rings.append((f"ring_{d['id']}_{k}", float(av["r"]), float(min(av.get("road", 12), av["w"] - 4))))
    return tuple(plan["scene"]["center"]), rings


def route_z(pr, q, trees):
    """Ground height under q (x, y) the robot can stand on, or None: level, not water, not a facade or street
    furniture (exported or not: the robot also walks where it is hidden), headroom ROBOT_H, no tree trunk within
    ROUTE_TREE_CLEAR."""
    h = pr.down(q.x, q.y)
    if h is None or h[1] < IDLE_FLAT_NZ or pr.occ.mat[h[2]] == WATER_MATERIAL or h[3].startswith(NOT_GROUND):
        return None
    if len(trees) and np.min(np.sum((trees - (q.x, q.y)) ** 2, axis=1)) < ROUTE_TREE_CLEAR ** 2:
        return None
    if not pr.free(Vector((q.x, q.y, h[0] + 0.2)), Vector((0, 0, 1)), ROBOT_H):
        return None
    return h[0]


def robot_routes(pr, samples, view16, cam_path, trees, well_c, fwd, side, rings, debug=None):
    """Routes across the hero view for the robot: the ring avenues and cross streets that cross the hero avenue.

    Cross lines square to the avenue every ROUTE_SCAN_STEP over ROUTE_RANGE count where the ground is walkable
    (route_z, steps up to ROBOT_STEP_MAX: hero_geom.walk_run) ROUTE_MIN_REACH to both sides of the axis; runs of
    them at least ROUTE_MIN_W wide are the crossings (hero_geom.bands). A crossing holding a ring avenue gets one
    route per RING_LANES offset, following the ring's arc; any other gets one straight route down its middle.
    Each route is walkable to ROBOT_HALF_W either side, ROBOT_CAMERA_CLEARANCE from the camera, ordered screen
    left to right, and trimmed to ROUTE_PAD past the part some sample camera's 16:9 view sees (in frustum and
    unoccluded at ROBOT_VIEW_H); one that can't run ROUTE_PAD on past it on both sides (it would pop in) is
    dropped. Returns (routes in glTF space, their Blender x, y lines, counts)."""
    occ = pr.occ
    centre2 = well_c.to_2d()
    cams = np.array([tuple(c) for c in cam_path])
    ts = np.arange(-ROUTE_REACH, ROUTE_REACH + 1e-6, ROUTE_STEP)
    mid = int(np.argmin(np.abs(ts)))
    need = int(round(ROUTE_MIN_REACH / ROUTE_STEP))
    alongs = np.arange(ROUTE_RANGE[0], ROUTE_RANGE[1] + 1e-6, ROUTE_SCAN_STEP)
    flags, scan = [], []
    for a in alongs:
        zs = [route_z(pr, centre2 + fwd * float(a) + side * float(t), trees) for t in ts]
        scan.append([np.nan if z_ is None else z_ for z_ in zs])
        run = hg.walk_run(zs, mid, ROBOT_STEP_MAX)
        flags.append(run is not None and run[0] <= mid - need and run[1] >= mid + need)
    found = [(float(alongs[i]), float(alongs[j])) for i, j in hg.bands(flags, int(round(ROUTE_MIN_W / ROUTE_SCAN_STEP)))]
    counts = {"crossings": [[round(a, 1), round(b, 1)] for a, b in found], "dropped": {}}
    if debug is not None:
        debug.update(route_alongs=alongs, route_ts=ts, route_flags=np.array(flags), route_scan=np.array(scan),
                     route_trees=trees)

    lanes = []
    for a, b in found:
        hit = False
        for name, r, road, centre in rings:
            for k, f in enumerate(RING_LANES):
                rr = r + f * road
                s_r = hg.ring_crossing(tuple(centre2), tuple(fwd), centre, rr)
                if s_r is not None and a + ROBOT_HALF_W <= s_r <= b - ROBOT_HALF_W:
                    lanes.append((f"{name}_{'in' if f < 0 else 'out'}", "ring", s_r, (centre, rr)))
                    hit = True
        if not hit:
            lanes.append((f"street_{int(round((a + b) / 2))}", "street", (a + b) / 2, None))

    routes, lines = [], []
    for name, kind, s0, ring in lanes:
        x0 = centre2 + fwd * s0
        if ring is None:
            pts2 = [x0 + side * float(t) for t in ts]
        else:
            c, rr = Vector(ring[0]), ring[1]
            a0 = math.atan2(x0.y - c.y, x0.x - c.x)
            # +t runs screen right: the way round the ring whose tangent points along `side`
            sgn = 1 if Vector((-math.sin(a0), math.cos(a0))).dot(side) > 0 else -1
            pts2 = [c + Vector((math.cos(a0 + sgn * t / rr), math.sin(a0 + sgn * t / rr))) * rr for t in ts]
        zs = []
        for k, q in enumerate(pts2):
            z = route_z(pr, q, trees)
            if z is not None:
                tan = (pts2[min(k + 1, len(pts2) - 1)] - pts2[max(k - 1, 0)]).normalized()
                n = Vector((-tan.y, tan.x))
                for o in (n * ROBOT_HALF_W, -n * ROBOT_HALF_W):
                    zo = route_z(pr, q + o, ())   # trunks are kept ROUTE_TREE_CLEAR off the line itself
                    if zo is None or abs(zo - z) > ROBOT_STEP_MAX:
                        z = None
                        break
            if z is not None and np.min(np.linalg.norm(cams - (q.x, q.y, z + ROBOT_VIEW_H), axis=1)) < ROBOT_CAMERA_CLEARANCE:
                z = None
            zs.append(z)
        run = hg.walk_run(zs, mid, ROBOT_STEP_MAX)
        if run is None:
            counts["dropped"][name] = "blocked at the axis"
            continue
        pts = [Vector((pts2[k].x, pts2[k].y, zs[k])) for k in range(run[0], run[1] + 1)]
        arc = hg.arc_lengths([tuple(p) for p in pts])
        per = []
        for (f, pos, _fwd, _up), planes in zip(samples, view16):
            flags_f = []
            for p in pts:
                lo = (p.x - ROBOT_HALF_W, p.y - ROBOT_HALF_W, p.z)
                hi = (p.x + ROBOT_HALF_W, p.y + ROBOT_HALF_W, p.z + ROBOT_H)
                flags_f.append(hg.aabb_in_frustum(lo, hi, planes) and seen_from(occ, [Vector(pos)], p + Vector((0, 0, ROBOT_VIEW_H))))
            per.append((f, flags_f))
        view = hg.seen_ranges(arc, per)
        if not view:
            counts["dropped"][name] = "never seen"
            continue
        lo_s, hi_s = min(v[1] for v in view), max(v[2] for v in view)
        if lo_s - ROUTE_PAD < arc[0] - 1e-6 or hi_s + ROUTE_PAD > arc[-1] + 1e-6:
            counts["dropped"][name] = f"seen {lo_s:.0f}-{hi_s:.0f} m of {arc[-1]:.0f}: no room to walk in unseen"
            continue
        keep = [k for k, t in enumerate(arc) if lo_s - ROUTE_PAD - ROUTE_STEP < t < hi_s + ROUTE_PAD + ROUTE_STEP]
        pts = [pts[k] for k in keep]
        base = arc[keep[0]]
        arc = [arc[k] - base for k in keep]
        routes.append({
            "name": name, "kind": kind, "along": round(s0, 2),
            "points": [gl(p) for p in pts], "len": round(arc[-1], 2),
            "seen": [round(lo_s - base, 2), round(hi_s - base, 2)],
            "view": [[v[0], round(v[1] - base, 2), round(v[2] - base, 2)] for v in view],
        })
        lines.append([(p.x, p.y) for p in pts])
    counts["routes"] = {r["name"]: {"along": r["along"], "len": r["len"], "seen": r["seen"],
                                    "frames": [r["view"][0][0], r["view"][-1][0]]} for r in routes}
    return routes, lines, counts


def talk_spots(pr, hm, cam_path, samples, frusta, walk_lines, route_lines, idle, well_c, fwd, side, pave_out):
    """Centres of open flat ground for conversation circles, from the idle height map `hm`: every cell within
    the radius (the largest of TALK_RADII that fits) level, usable and within TALK_TOL of the centre, not roadway
    (TALK_NOT_GROUND); rays out from the centre at TALK_CLEAR_HS free to the radius + 0.3 (no wall or railing in
    the circle); TALK_HEADROOM free above the centre and the rim. Kept clear of the camera (WALK_CAMERA_CLEARANCE
    from the chest at the rim, every frame), of the walk paths (IDLE_PATH_CLEARANCE past the rim), of the robot
    routes (ROUTE_IDLE_CLEAR), of the idle spots (TALK_IDLE_GAP), at street level (IDLE_LEVEL), within
    IDLE_RANGE, in view and seen from a sample camera; TALK_SPACING between rims (largest circles first).
    Returns (spots in glTF space: {pos, radius, area}, counts)."""
    occ = pr.occ
    xs, ys, z, nz, ok, own = hm
    cams = np.array([tuple(c) for c in cam_path])
    eyes = [Vector(s[1]) for s in samples]
    walk_pts = np.array([q for line in walk_lines for q in line])
    idle_xy = np.array([(sp["pos"][0], -sp["pos"][2]) for sp in idle]) if idle else np.zeros((0, 2))
    road = np.vectorize(lambda o: o.startswith(TALK_NOT_GROUND))(own) if own.size else own
    good = ok & ~road
    discs = [(r, hg.disc_offsets(r, IDLE_GRID)) for r in TALK_RADII]
    up = Vector((0, 0, 1))
    cand, counts = [], {"tried": 0}
    for j in range(0, len(ys), TALK_STRIDE):
        for i in range(0, len(xs), TALK_STRIDE):
            if not good[j, i]:
                continue
            counts["tried"] += 1
            zc = float(z[j, i])
            c = Vector((float(xs[i]), float(ys[j]), zc))
            for r, offs in discs:
                if all(0 <= j + dj < len(ys) and 0 <= i + di < len(xs) and good[j + dj, i + di]
                       and abs(z[j + dj, i + di] - zc) <= TALK_TOL for di, dj in offs):
                    break
            else:
                continue
            dirs = [Vector((math.cos(2 * math.pi * k / TALK_CLEAR_DIRS), math.sin(2 * math.pi * k / TALK_CLEAR_DIRS), 0))
                    for k in range(TALK_CLEAR_DIRS)]
            if not all(pr.free(c + Vector((0, 0, h)), d, r + 0.3) for h in TALK_CLEAR_HS for d in dirs):
                continue
            if not all(pr.free(q + Vector((0, 0, 0.1)), up, TALK_HEADROOM) for q in [c] + [c + d * r for d in dirs]):
                continue
            chest = np.array((c.x, c.y, zc + WALK_CHEST_H))
            dist = np.linalg.norm(cams - chest, axis=1)
            if dist.min() - r < WALK_CAMERA_CLEARANCE or dist.min() > IDLE_RANGE:
                continue
            if any(hg.polyline_dist((c.x, c.y), line) < r + IDLE_PATH_CLEARANCE for line in walk_lines):
                continue
            if any(hg.polyline_dist((c.x, c.y), line) < r + ROUTE_IDLE_CLEAR for line in route_lines):
                continue
            if len(idle_xy) and np.min(np.linalg.norm(idle_xy - (c.x, c.y), axis=1)) < r + TALK_IDLE_GAP:
                continue
            street = walk_pts[np.argmin(np.sum((walk_pts[:, :2] - (c.x, c.y)) ** 2, axis=1)), 2]
            if abs(zc - street) > IDLE_LEVEL:
                continue
            if not in_view((c.x - r, c.y - r, zc), (c.x + r, c.y + r, zc + 1.8), frusta):
                continue
            if not seen_from(occ, eyes, c + Vector((0, 0, IDLE_VIEW_H))):
                continue
            cand.append((r, c))
    counts["clear"] = len(cand)
    cand.sort(key=lambda t: (-t[0], round(t[1].x, 3), round(t[1].y, 3)))
    kept = []
    for r, c in cand:
        if all((c.to_2d() - k.to_2d()).length >= r + rk + TALK_SPACING - 1e-9 for rk, k in kept):
            kept.append((r, c))
    counts["spaced"] = len(kept)
    kept = hg.stride_pick(sorted(kept, key=lambda t: (round(t[1].x, 3), round(t[1].y, 3))), TALK_MAX_SPOTS)
    spots = [{"pos": gl(c), "radius": r, "area": area_of(c.to_2d(), well_c, fwd, side, pave_out)} for r, c in kept]
    counts["areas"] = {a: sum(1 for s in spots if s["area"] == a) for a in ("well", "avenue", "other")}
    return spots, counts


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
    head = bmesh.ops.create_cube(bm, size=1.0, matrix=Matrix.Translation((0, 0, LAMP_POLE_H + LAMP_HEAD_H / 2)) @
                                 Matrix.Diagonal((LAMP_HEAD_W, LAMP_HEAD_W, LAMP_HEAD_H, 1)))
    # Tag the head by the cube's own verts: bm.faces is not ordered pole-then-head.
    head_verts = set(head["verts"])
    for f in bm.faces:
        f.material_index = 1 if all(v in head_verts for v in f.verts) else 0
    me = tag(bpy.data.meshes.new("HERO_Lamp"))
    bm.to_mesh(me)
    bm.free()
    smooth_by_angle(me)
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
        # Tiles are centred on the well, so no tile seam runs through the plaza in the hero shot.
        wo = bpy.data.objects[WELL_OBJECT]
        well_c = sum((wo.matrix_world @ Vector(b) for b in wo.bound_box), Vector()) / 8
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
                    b.add(c.co, c.lv, g.ls, g.lt, sel, np.full(len(sel), b.mat_index(M.get(out, src))))
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
            tiles = np.floor((c.cent[polys, :2] - np.array(well_c.to_2d())) / ts + 0.5).astype(np.int64)
            mis = g.mi[polys]
            for (tx, ty, m) in {(int(a), int(b_), int(mm)) for a, b_, mm in zip(tiles[:, 0], tiles[:, 1], mis)}:
                sel = polys[(tiles[:, 0] == tx) & (tiles[:, 1] == ty) & (mis == m)]
                src = g.mat_name(m)
                out = M.out_name(src, None)
                b = buckets.setdefault((band, tx, ty, out), Builder())
                b.add(c.co, c.lv, g.ls, g.lt, sel, np.zeros(len(sel), np.int64))
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
                    b.add(g.co, g.lv, g.ls, g.lt, sel, np.full(len(sel), b.mat_index(M.get(M.out_name(src, None), src))))
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
        cam_path = [mats[f].translation for f in range(hg.FRAME_START, hg.FRAME_END + 1)]
        pave_out = max(pave[1][1], pave[-1][1])

        # ---- robot routes: ring avenues and cross streets across the view (first: no lamp stands on them)
        pr = IdleProbes(occ, {c.id for c in kept_chunks})
        centre_xy, ring_list = plan_rings()
        rings = [(n, r, road, centre_xy) for n, r, road in ring_list]
        trees = np.array([((it.lo[0] + it.hi[0]) / 2, (it.lo[1] + it.hi[1]) / 2)
                          for it in in_frustum if it.tree]).reshape(-1, 2)
        a16, v16 = hg.cull_aspects(vfov, sht)[0]
        view16 = [hg.frustum_planes(pos, f_, up, v16, a16, cam.data.clip_start, cam.data.clip_end)
                  for (_, pos, f_, up) in samples]
        idle_debug = {} if _g.get("IDLE_DEBUG") else None
        routes, route_lines, route_counts = robot_routes(pr, samples, view16, cam_path, trees, well_c, fwd, side, rings,
                                                         idle_debug)
        timing["routes"] = time.time() - t0
        print("export_hero: robot routes", json.dumps(route_counts), flush=True)

        def clear(q):
            return (min((q - c).length for c in cam_xy) >= LAMP_CAMERA_CLEARANCE
                    and all(hg.polyline_dist((q.x, q.y), line) >= ROUTE_LAMP_CLEAR for line in route_lines))

        lamp_pts = []
        for sgn in (1, -1):
            off = pave[sgn][0] + LAMP_KERB_INSET
            lamp_pts += [centre2 + fwd * float(s) + side * (sgn * off)
                         for s in np.arange(AVENUE_START, AVENUE_START + AVENUE_LEN + 0.1, LAMP_AVENUE_SPACING)]
        for k in range(int(round(360 / LAMP_RING_STEP_DEG))):
            a = math.radians(k * LAMP_RING_STEP_DEG)
            d = Vector((math.cos(a), math.sin(a))) * PLAZA_LAMP_R
            # None across the avenue mouth: between the two pavements, on the avenue side.
            if d.dot(fwd) > 0 and abs(d.dot(side)) < min(pave[1][0], pave[-1][0]):
                continue
            lamp_pts.append(centre2 + d)
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

        # Walkers keep clear of the camera along the whole move (every frame, in 3D, cam_path), so none fills
        # the frame: pavement paths are cut where they pass near the camera.

        def walk_clear(p):
            chest = p + Vector((0, 0, WALK_CHEST_H))
            return min((chest - c).length for c in cam_path) >= WALK_CAMERA_CLEARANCE

        def paths(points, closed):
            pts = []
            for q in points:
                z = ground(occ, q.x, q.y)[0]
                if z is not None:
                    pts.append(Vector((q.x, q.y, z)))
            return [[gl(p) for p in run] for run in hg.clear_runs(pts, closed, walk_clear)]

        walk_paths = []   # avenue pavements only: no walkers circle the plaza
        for sgn in (1, -1):
            a, b_ = pave[sgn]
            for f in (1 / 3, 2 / 3):
                off = a + (b_ - a) * f
                walk_paths += paths([centre2 + fwd * float(s) + side * (sgn * off)
                                     for s in np.arange(AVENUE_START, AVENUE_START + AVENUE_LEN + 0.1, AVENUE_STEP)],
                                    False)
        timing["props_geo"] = time.time() - t0

        # ---- idle people: seats and walls in the kept scene, clear of the camera and the walkers
        walk_lines = [[(q[0], -q[2], q[1]) for q in line] for line in walk_paths]   # Blender x, y, z
        hm = idle_height_map(pr, np.array([tuple(c) for c in cam_path])[:, :2])
        idle, idle_counts = idle_spots(pr, hm, cam_path, samples, frusta, walk_lines, route_lines,
                                       well_c, fwd, side, pave_out, idle_debug)
        timing["idle"] = time.time() - t0
        print("export_hero: idle spots", json.dumps(idle_counts), flush=True)
        talk, talk_counts = talk_spots(pr, hm, cam_path, samples, frusta, walk_lines, route_lines, idle,
                                       well_c, fwd, side, pave_out)
        timing["talk"] = time.time() - t0
        print("export_hero: talk spots", json.dumps(talk_counts), flush=True)
        if idle_debug is not None:
            np.savez(_g["IDLE_DEBUG"], **idle_debug, cams=np.array([tuple(c) for c in cam_path]),
                     walk=np.array([q for line in walk_lines for q in line]))
        if _g.get("STOP_AFTER") == "idle":
            with open(os.path.join(OUT_DIR, "idle_spots.json"), "w") as fh:
                json.dump({"counts": idle_counts, "idle_spots": idle, "route_counts": route_counts,
                           "robot_routes": routes, "talk_counts": talk_counts, "talk_spots": talk}, fh, indent=1)
            return

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
        for ob in bake:
            smooth_ao(ob.data)
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
            "version": 2, "fps": FPS, "frames": [hg.FRAME_START, hg.FRAME_END],
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
            "idle_spots": idle,
            "robot_routes": routes,
            "talk_spots": talk,
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
                "idle_spots": idle_counts,
                "robot_routes": route_counts,
                "talk_spots": talk_counts,
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
