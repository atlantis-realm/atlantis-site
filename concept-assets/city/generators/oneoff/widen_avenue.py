"""Widen the main avenue of Atlantian_plaza_blockout symmetrically about x = 0.

Cross-section mapping F(|x|) (metres from the centreline), applied only to the avenue corridor
(-95 < y < 840): median/tram stay put, lanes/plant strip/sidewalk scale ~1.46x, facades and
everything behind them shift out by FACADE_SHIFT, fading back to no change by 60 m.
Fixed-size things (buildings, trees, furniture, vines) are moved, never scaled.
"""
import bpy, re
from bisect import bisect_right
from mathutils import Vector

DRY_RUN = globals().get("DRY_RUN", True)
FACADE_SHIFT = 7.0          # 35 m -> 49 m facade to facade
Y_MIN, Y_MAX = -95.0, 840.0

# (old |x|, new |x|) knots, linear in between
KNOTS = [(0.0, 0.0), (2.2, 2.2),                      # median + tram unchanged
         (10.0, 13.57), (12.5, 17.21),                # lanes, plant strip
         (17.0, 17.0 + FACADE_SHIFT),                 # sidewalk up to the facade line
         (40.0, 40.0 + FACADE_SHIFT), (60.0, 60.0)]   # buildings behind, fade out


def F(u):
    if u >= KNOTS[-1][0]:
        return u
    i = bisect_right([k[0] for k in KNOTS], u) - 1
    (a, fa), (b, fb) = KNOTS[i], KNOTS[i + 1]
    return fa + (u - a) * (fb - fa) / (b - a)


def map_x(x, fn=F):
    return x if x == 0 else (fn(abs(x)) if x > 0 else -fn(-x))


# The oculus walkway: keep the rings round, only push the deck edges out with the avenue
WALK_KEEP = 8.45
WALK_SHIFT = F(9.0) - 9.0


def W(u):
    return u if u <= WALK_KEEP else u + WALK_SHIFT


def world_matrix(o):
    # matrix_world is stale for viewport-hidden objects, so rebuild it from the parent chain
    if o.parent:
        return world_matrix(o.parent) @ o.matrix_parent_inverse @ o.matrix_basis
    return o.matrix_basis.copy()


def in_corridor_y(y):
    return Y_MIN < y < Y_MAX


RIGID = re.compile(r"^(KIT_Facade_civic_i_|KIT_PlantI_|KIT_StreetI_|AP_block_|AP_canopy_|AP_under_|AP_vine_|KIT_Facade_slot_)")
VERTS = re.compile(r"^(KIT_Ave_|KIT_DeckPave_|KIT_Curb_grass_|KIT_Sky_(stone|cyan|bronze|plant)$|AP_road_|AP_median$|AP_tree_|AP_bridge_)")

report = {"rigid": 0, "mesh": 0, "verts": 0, "walkway": 0, "curve_pts": 0}


def move_rigid(o):
    mw = world_matrix(o)
    p = mw.translation
    if not in_corridor_y(p.y) or abs(p.x) > KNOTS[-1][0]:
        return
    dx = map_x(p.x) - p.x
    if abs(dx) < 1e-4:
        return
    report["rigid"] += 1
    if not DRY_RUN:
        # shift in world space, expressed through the parent if there is one
        delta = Vector((dx, 0, 0))
        if o.parent:
            delta = (world_matrix(o.parent) @ o.matrix_parent_inverse).to_3x3().inverted() @ delta
        o.location += delta


def map_mesh(o, fn=F, extra=lambda w: True):
    me = o.data
    if me.users > 1 and not DRY_RUN:
        o.data = me = me.copy()
    mw = world_matrix(o)
    inv = mw.inverted()
    n = 0
    for v in me.vertices:
        w = mw @ v.co
        if not in_corridor_y(w.y) or not extra(w):
            continue
        nx = map_x(w.x, fn)
        if abs(nx - w.x) > 1e-5:
            n += 1
            if not DRY_RUN:
                v.co = inv @ Vector((nx, w.y, w.z))
    if n:
        report["mesh"] += 1
        report["verts"] += n
        if not DRY_RUN:
            me.update()


for o in list(bpy.context.scene.objects):
    if any(c.name.startswith("asset_") for c in o.users_collection):
        continue
    if o.name.startswith("KIT_Walkway_") and o.type == 'MESH':
        before = report["verts"]
        map_mesh(o, fn=W)
        report["walkway"] += report["verts"] > before
    elif RIGID.match(o.name):
        move_rigid(o)
    elif o.type == 'MESH' and VERTS.match(o.name):
        map_mesh(o)
    elif o.name == "KIT_Canal_bollards":
        map_mesh(o, extra=lambda w: abs(w.x) < 20 and 100 < w.y < 200)

# Skywalk is generated from this curve (Geometry Nodes), so moving its points moves the walk
path = bpy.data.objects["KIT_SkyPath_L"]
mw = world_matrix(path); inv = mw.inverted()
for s in path.data.splines:
    for bp in s.bezier_points:
        for attr in ("co", "handle_left", "handle_right"):
            w = mw @ getattr(bp, attr)
            if in_corridor_y(w.y):
                if not DRY_RUN:
                    setattr(bp, attr, inv @ Vector((map_x(w.x), w.y, w.z)))
                report["curve_pts"] += attr == "co"

print("DRY RUN" if DRY_RUN else "APPLIED", report)
print("check: facade 17.5 ->", round(F(17.5), 2), "| trees 10 ->", round(F(10), 2),
      "| benches 15 ->", round(F(15), 2), "| skywalk 11.5 ->", round(F(11.5), 2),
      "| walkway deck 9 ->", round(W(9), 2))
