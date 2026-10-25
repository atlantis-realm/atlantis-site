"""Rescale + regrade the Atlantian plaza scene and build the generated city from build/build.json.

    node citygen_cli.js plan.json build/build.json
    then in Blender: exec this file with BUILD_PATH set (or let it find build/build.json beside it)

regrade()  puts the hand-built scene on the plan: first the scale, then the terrain.
           scale    the hero opener (walkway + oculus, avenue kit, facades, trees, skywalk, camera)
                    moves outward along the hero avenue as one piece; the hand-built rings are remapped
                    radially (canals keep their width), small kit parts like bollards move whole
           terrain  decks/risers/canal walls: per-vertex ladder remap; water: lifted flat;
                    paving strips: follow the slope; buildings: level on a plinth; small things: on
                    the ground; temple: lifted with the plateau
           Every touched object keeps its original state (object prop / mesh attribute / curve prop),
           so rerunning with a different plan starts from the original scene.
build()    rebuilds the generated collections. Trees are point clouds instanced by Geometry Nodes.
ensure_glow()  MAT_AP_Glow, the Lantern's emissive cyan heart (MAT_AP_Cyan is shared and stays non-emissive).
hide_temple()  the old temple (05_TEMPLE, KIT_PlantI_temple_*) is hidden, never deleted: Old Town replaces it.
"""
import bpy, json, math, os
from mathutils import Vector

_here = os.path.dirname(globals().get("__file__", "") or ".")
BUILD = globals().get("BUILD_PATH") or os.path.join(_here, "build", "build.json")
with open(BUILD) as fh:
    B = json.load(fh)
CX, CY = B["center"]
T = B["terrain"]
STEP = T["step"]
OLD = T["old_levels"]
RS = T.get("rescale") or {"knots": [[0, 0], [1, 1]], "old_rings": {}, "hero_shift": 0, "hero_half": 0, "hero_r_min_old": 1e9}
HERO_DIR = Vector((math.cos(T["hero_angle"]), math.sin(T["hero_angle"]), 0))
WATER_BANDS = [tuple(b) for b in B["water_bands"]]

COLL = {"outer": "20_NBHD_OUTER", "belt": "21_NBHD_BELT", "park": "22_NBHD_PARK", "core": "23_NBHD_CORE",
        "spokes": "24_SPOKES", "avenues": "25_RING_AVENUES", "skywalks": "26_SKYWALKS", "regrade": "19_REGRADE_PLINTHS"}
MAT = {"stone": "MAT_AP_Stone", "plinth": "MAT_AP_StoneWell", "lip": "MAT_AP_StoneLip", "roof": "MAT_AP_Grass",
       "paver": "MAT_AP_Paver", "water": "MAT_AP_Water", "road": "MAT_AP_Grout", "stair": "MAT_AP_StoneLip",
       "glass": "MAT_AP_Cyan", "tile": "MAT_AP_Bronze", "panel": "MAT_AP_Cyan", "fabric": "MAT_AP_StoneLip",
       "glow": "MAT_AP_Glow", "gold": "MAT_AP_Gold"}  # new keys go at the END: the material index is the key's position
MAT_KEYS = list(MAT)


# ---------------------------------------------------------------- lookups
def table(name, r):
    t = T[name]
    f = min(max(r / STEP, 0), len(t) - 1.001)
    i = int(f)
    return t[i] + (t[i + 1] - t[i]) * (f - i)


def radius(x, y):
    return math.hypot(x - CX, y - CY)


def F(r):
    """Old radius -> new radius (piecewise linear through the plan's knots)."""
    k = RS["knots"]
    for (a, fa), (b, fb) in zip(k, k[1:]):
        if r <= b:
            return fa + (r - a) * (fb - fa) / (b - a)
    return r + (k[-1][1] - k[-1][0])


def remap_xy(x, y):
    r = radius(x, y)
    if r < 1e-6:
        return x, y
    s = F(r) / r
    return CX + (x - CX) * s, CY + (y - CY) * s


def old_level(r_old):
    """The flat deck level something stood on in the original scene, by its original radius."""
    rings = RS["old_rings"]
    for name, lvl in (("island", "island"), ("inner_water", "park"), ("park", "park"), ("canal2", "belt"),
                      ("belt", "belt"), ("canal1", "promenade")):
        if name in rings and r_old < rings[name][1]:
            return OLD[lvl]
    return OLD["promenade"]


def is_water_new(r):
    return any(r0 <= r < r1 for r0, r1 in WATER_BANDS)


def delta_new(x, y):
    """Things that keep their ring through the rescale: new ground minus the old deck there."""
    return table("delta", radius(x, y))


def delta_hero(x, y, r_old):
    """The relocated hero opener: new ground where it lands minus the deck it originally stood on."""
    r = radius(x, y)
    return table("delta", r) if is_water_new(r) else table("G", r) - old_level(r_old)


def ladder(r, z):
    """Old stepped deck levels -> new sloped decks at radius r, interpolating walls between them."""
    levels = [(OLD["promenade"], OLD["promenade"]), (OLD["belt"], table("belt", r)),
              (OLD["park"], table("park", r)), (OLD["island"], table("island", r))]
    if z <= levels[0][0]:
        return z
    for (lo, nlo), (hi, nhi) in zip(levels, levels[1:]):
        if z <= hi:
            return nlo + (z - lo) / (hi - lo) * (nhi - nlo)
    return z + (levels[-1][1] - levels[-1][0])


def world_matrix(o):
    if o.parent:
        return world_matrix(o.parent) @ o.matrix_parent_inverse @ o.matrix_basis
    return o.matrix_basis.copy()


def collection_of(o):
    return o.users_collection[0].name if o.users_collection else ""


GENERATED = set(COLL.values()) | {"27_CANAL_CUTS"}
RING_KIT = {"01_GROUND", "03_CANALS", "10_KIT_CANAL", "11_TERRACE", "06_DOCKS_MARSH"}
TERRAIN_COLLS = {"01_GROUND", "03_CANALS", "10_KIT_CANAL", "11_TERRACE", "08_BRIDGES"}
WATER = {"AP_canal_2": "canal2", "AP_inner_water": "inner_water", "KIT_Canal2_water": "canal2"}
STRIP_COLLS = {"07_STREET", "12_DECK_PAVE", "09_KIT_WALKWAY", "15_KIT_PLANT", "13_KIT_FACADE"}
LEVEL_PREFIX = ("KIT_Facade_civic_i_", "AP_block_", "KIT_PlantI_vine_", "AP_vine", "AP_arc_", "KIT_Facade_slot_")
SKIP = {"Camera_plan", "KIT_SkyBalcony_proto", "KIT_SkyWalk_L"}


def is_source(o):
    return any(c.name.startswith("asset_") for c in o.users_collection)


# ---------------------------------------------------------------- originals (makes the pass rerunnable)
SKIPPED = []


def regraded():
    return bool(bpy.context.scene.get("rg_done"))


def restore_location(o):
    """Back to the original transform. After the first regrade, an object with no stored original
    was added or edited since: leave it alone rather than remap it a second time."""
    if "rg_orig_loc" in o:
        o.location = Vector(o["rg_orig_loc"])
        return True
    if regraded():
        SKIPPED.append(o.name)
        return False
    o["rg_orig_loc"] = list(o.location)
    return True


def mesh_restore(me):
    a = me.attributes.get("rg_orig_co")
    co = [0.0] * (len(me.vertices) * 3)
    if a is not None and len(a.data) == len(me.vertices):
        a.data.foreach_get("vector", co)
        me.vertices.foreach_set("co", co)
        return True
    else:
        if regraded():  # geometry changed since the first regrade: don't treat it as original
            SKIPPED.append(me.name)
            return False
        if a is not None:
            me.attributes.remove(a)
        me.vertices.foreach_get("co", co)
        a = me.attributes.new("rg_orig_co", "FLOAT_VECTOR", "POINT")
        a.data.foreach_set("vector", co)
        return True


def components(me):
    """Loose parts of a mesh as lists of vertex indices (union-find over edges)."""
    parent = list(range(len(me.vertices)))

    def find(i):
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i
    ev = [0] * (len(me.edges) * 2)
    me.edges.foreach_get("vertices", ev)
    for a, b in zip(ev[0::2], ev[1::2]):
        ra, rb = find(a), find(b)
        if ra != rb:
            parent[ra] = rb
    groups = {}
    for i in range(len(parent)):
        groups.setdefault(find(i), []).append(i)
    return list(groups.values())


def transform_mesh(o, xy_fn, z_fn, rigid_parts=False):
    """Restore the original vertices, then move them in world space: xy by xy_fn (per vertex, or per
    loose part when rigid_parts so small kit pieces keep their shape), z by z_fn(x, y, z)."""
    me = o.data
    if me.users > 1:
        o.data = me = me.copy()
    if not mesh_restore(me):
        return
    mw = world_matrix(o)
    inv = mw.inverted()
    world = [mw @ v.co for v in me.vertices]
    new_xy = [None] * len(world)
    if rigid_parts:
        for part in components(me):
            pts = [world[i] for i in part]
            cx = sum(p.x for p in pts) / len(pts)
            cy = sum(p.y for p in pts) / len(pts)
            ext = max(max(p.x for p in pts) - min(p.x for p in pts), max(p.y for p in pts) - min(p.y for p in pts))
            if ext < 30:  # bollards, steps, posts: move whole
                nx, ny = xy_fn(cx, cy)
                for i in part:
                    new_xy[i] = (world[i].x + nx - cx, world[i].y + ny - cy)
            else:
                for i in part:
                    new_xy[i] = xy_fn(world[i].x, world[i].y)
    else:
        new_xy = [xy_fn(p.x, p.y) for p in world]
    for v, p, (x, y) in zip(me.vertices, world, new_xy):
        v.co = inv @ Vector((x, y, z_fn(x, y, p.z)))
    me.update()


def footprint_world(o):
    mw = world_matrix(o)
    if o.type == "EMPTY" and o.instance_collection:
        pts = [Vector(c) for ob in o.instance_collection.all_objects if ob.type == "MESH" for c in ob.bound_box]
        if not pts:
            return [mw.translation]
        xs, ys = [p.x for p in pts], [p.y for p in pts]
        corners = [Vector((x, y, 0)) for x in (min(xs), max(xs)) for y in (min(ys), max(ys))]
    elif o.type == "MESH" and o.data and len(o.data.vertices):
        bb = [Vector(c) for c in o.bound_box]
        corners = [Vector((x, y, 0)) for x in (min(p.x for p in bb), max(p.x for p in bb)) for y in (min(p.y for p in bb), max(p.y for p in bb))]
    else:
        return [mw.translation]
    return [mw @ c for c in corners]


def is_hero(o, p0):
    """Part of the hand-built hero opener: in the avenue corridor, south of the island, not a ring kit."""
    c = collection_of(o)
    if c in RING_KIT or c == "05_TEMPLE" or o.name.startswith("KIT_Temple"):
        return False
    rel = Vector((p0.x - CX, p0.y - CY, 0))
    along, across = rel.dot(HERO_DIR), abs(rel.x * HERO_DIR.y - rel.y * HERO_DIR.x)
    if not (along > RS["hero_r_min_old"] and across < RS["hero_half"]):
        return False
    # only pieces that land on the stretch the hand-built kit still covers; the rest keep their ring
    landed = along + RS["hero_shift"]
    return any(a - 5 <= landed <= b + 5 for a, b in RS.get("hero_windows", [[0, 1e9]]))


def depth(o):
    n = 0
    while o.parent:
        o, n = o.parent, n + 1
    return n


def regrade():
    stats = dict(hero=0, rings=0, water=0, strips=0, level=0, point=0, temple=0, curve=0)
    plinths = []
    shift = HERO_DIR * RS["hero_shift"]
    handled = set()
    for o in sorted(bpy.data.objects, key=depth):  # parents before children
        c = collection_of(o)
        if o.name in SKIP or c in GENERATED or o.get("citygen") or o.name.startswith("tmp_") or is_source(o) or (o.type == "LIGHT" and o.name != "Sun"):
            continue
        parent_done = o.parent is not None and o.parent.name in handled
        if not parent_done and not restore_location(o):
            continue
        p0 = world_matrix(o).translation.copy()
        r_old = radius(p0.x, p0.y)
        hero = bool(o.parent.get("rg_hero", False)) if parent_done else is_hero(o, p0)
        o["rg_hero"] = hero
        handled.add(o.name)

        # temple: stays at the centre, lifted with the plateau
        if c == "05_TEMPLE" or o.name.startswith("KIT_Temple"):
            if not parent_done:
                o.location.z += T["templeLift"]
            stats["temple"] += 1
            continue

        # the skypath drives the GN skywalk: move it with the opener and let it follow the slope
        if o.type == "CURVE" and o.name.startswith("KIT_SkyPath"):
            pts = [bp for s in o.data.splines for bp in s.bezier_points]
            if "rg_orig_pts" not in o:
                if regraded():
                    SKIPPED.append(o.name)
                    continue
                o["rg_orig_pts"] = [list(bp.co) + list(bp.handle_left) + list(bp.handle_right) for bp in pts]
            if len(o["rg_orig_pts"]) != len(pts):  # points added since: leave the curve as it is
                SKIPPED.append(o.name)
                continue
            mw = world_matrix(o)
            inv = mw.inverted()
            for bp, orig in zip(pts, o["rg_orig_pts"]):
                for attr, sl in (("co", slice(0, 3)), ("handle_left", slice(3, 6)), ("handle_right", slice(6, 9))):
                    w0 = mw @ Vector(orig[sl])
                    w = w0 + shift
                    setattr(bp, attr, inv @ Vector((w.x, w.y, w.z + delta_hero(w.x, w.y, radius(w0.x, w0.y)))))
            stats["curve"] += 1
            continue

        if hero:
            # the hero opener moves out as one piece, then sits on the new ground
            stats["hero"] += 1
            rold = lambda x, y: radius(x - shift.x, y - shift.y)
            if o.type == "MESH" and c in STRIP_COLLS and not o.name.startswith(LEVEL_PREFIX):
                move = (lambda x, y: (x, y)) if parent_done else (lambda x, y: (x + shift.x, y + shift.y))
                transform_mesh(o, move, lambda x, y, z: z + delta_hero(x, y, rold(x, y)))
                stats["strips"] += 1
                continue
            if not parent_done:
                o.location += shift
            if o.type == "EMPTY" and not o.instance_collection and o.children:
                continue
            if o.name.startswith(LEVEL_PREFIX):
                corners = footprint_world(o)
                ds = [delta_hero(p.x, p.y, rold(p.x, p.y)) for p in corners]
                z0 = world_matrix(o).translation.z
                o.location.z += max(ds)
                if max(ds) - min(ds) > 0.1 and not (o.hide_viewport or o.hide_get()):
                    plinths.append(([(p.x, p.y) for p in corners], z0 + min(ds) - 0.3, z0 + max(ds)))
                stats["level"] += 1
                continue
            if not parent_done:
                p = world_matrix(o).translation
                o.location.z += delta_hero(p.x, p.y, r_old)
            stats["point"] += 1
            continue

        # everything else keeps its ring and is remapped radially
        if o.type == "MESH" and o.name in WATER:
            transform_mesh(o, remap_xy, lambda x, y, z: z)
            mw = world_matrix(o)
            zs = [(mw @ v.co).z for v in o.data.vertices]
            o.location.z += T["water"][WATER[o.name]] - sum(zs) / len(zs)
            stats["water"] += 1
            continue
        if o.type == "MESH" and c in TERRAIN_COLLS and not o.name.startswith(LEVEL_PREFIX):
            transform_mesh(o, remap_xy, lambda x, y, z: ladder(radius(x, y), z), rigid_parts=True)
            stats["rings"] += 1
            continue
        if o.type == "EMPTY" and not o.instance_collection and o.children:
            continue  # kit parent empties stay; their children are remapped individually
        if not parent_done:
            nx, ny = remap_xy(p0.x, p0.y)
            o.location.x += nx - p0.x
            o.location.y += ny - p0.y
        if o.type == "MESH" and c in STRIP_COLLS:
            transform_mesh(o, lambda x, y: (x, y), lambda x, y, z: z + delta_new(x, y))
            stats["strips"] += 1
            continue
        if o.name.startswith(LEVEL_PREFIX):
            o.location.z += max(delta_new(p.x, p.y) for p in footprint_world(o))
            stats["level"] += 1
            continue
        if not parent_done:
            p = world_matrix(o).translation
            o.location.z += delta_new(p.x, p.y)
        stats["point"] += 1

    cam = bpy.data.objects.get("Camera_plan")  # the plan camera frames the whole city
    if cam and cam.data.type == "ORTHO":
        cam.data.ortho_scale = 2 * max(r1 for _, r1 in B["land_bands"]) + 400
    coll = reset_collection(COLL["regrade"])
    if plinths:
        mb = MeshBuilder()
        for corners, z0, z1 in plinths:
            cx = sum(x for x, _ in corners) / 4
            cy = sum(y for _, y in corners) / 4
            ring = sorted(corners, key=lambda p: math.atan2(p[1] - cy, p[0] - cx))
            mb.prism([(x - CX, y - CY) for x, y in ring], z0, z1, MAT_KEYS.index("plinth"))
        mb.emit("REGRADE_facade_plinths", coll)
    bpy.context.scene["rg_done"] = True
    print("regrade", stats, "plinths", len(plinths))
    if SKIPPED:
        print("skipped (no original state, edited after the first regrade):", SKIPPED[:20], "..." if len(SKIPPED) > 20 else "")


# ---------------------------------------------------------------- build
def get_mat(name):
    return bpy.data.materials.get(name) or bpy.data.materials.new(name)


def reset_collection(name):
    c = bpy.data.collections.get(name)
    if c is None:
        c = bpy.data.collections.new(name)
        bpy.context.scene.collection.children.link(c)
    for o in list(c.all_objects):
        me = o.data if o.type == "MESH" else None
        bpy.data.objects.remove(o)
        if me is not None and me.users == 0:
            bpy.data.meshes.remove(me)
    return c


MATS = []


def ensure_glow():
    """MAT_AP_Glow: emissive cyan. Creates or updates (idempotent); nodes found by type, never by name."""
    m = get_mat("MAT_AP_Glow")
    m.use_nodes = True
    bsdf = next((n for n in m.node_tree.nodes if n.type == "BSDF_PRINCIPLED"), None) or m.node_tree.nodes.new("ShaderNodeBsdfPrincipled")
    bsdf.inputs["Base Color"].default_value = (0.5, 0.95, 1.0, 1.0)
    bsdf.inputs["Emission Color"].default_value = (0.5, 0.95, 1.0, 1.0)
    bsdf.inputs["Emission Strength"].default_value = 8.0
    if not any(n.type == "OUTPUT_MATERIAL" for n in m.node_tree.nodes):
        out = m.node_tree.nodes.new("ShaderNodeOutputMaterial")
        m.node_tree.links.new(bsdf.outputs["BSDF"], out.inputs["Surface"])
    return m


def hide_temple():
    """Old Town replaces the temple: exclude 05_TEMPLE and hide its kit parts. Idempotent and recoverable."""
    lc = bpy.context.view_layer.layer_collection.children.get("05_TEMPLE")
    if lc is not None:
        lc.exclude = True
    for o in bpy.data.objects:
        if o.name.startswith("KIT_PlantI_temple_"):
            o.hide_viewport = True
            o.hide_render = True


class MeshBuilder:
    """Collects prisms/solids as plain vertex and face lists, then makes one mesh with from_pydata
    (much faster than bmesh at city scale). Footprints are wound counter-clockwise so normals face out."""

    def __init__(self):
        self.v, self.f, self.m = [], [], []

    def _faces(self, bot, top, mi):
        n = len(top)
        self.f.append(top)
        self.f.append(list(reversed(bot)))
        for i in range(n):
            j = (i + 1) % n
            self.f.append([bot[i], bot[j], top[j], top[i]])
        self.m.extend([mi] * (n + 2))

    def prism(self, poly, z0, z1, mi):
        n = len(poly)
        area = sum(poly[i][0] * poly[(i + 1) % n][1] - poly[(i + 1) % n][0] * poly[i][1] for i in range(n))
        if abs(area) < 1e-6:
            return
        if area < 0:
            poly = list(reversed(poly))
        k = len(self.v)
        self.v.extend((CX + x, CY + y, z0) for x, y in poly)
        self.v.extend((CX + x, CY + y, z1) for x, y in poly)
        self._faces(list(range(k, k + n)), list(range(k + n, k + 2 * n)), mi)

    def solid(self, top, bot, mi):
        """A prism whose corners each have their own top and bottom height (any number of corners)."""
        n = len(top)
        area = sum(top[i][0] * top[(i + 1) % n][1] - top[(i + 1) % n][0] * top[i][1] for i in range(n))
        if abs(area) < 1e-6:
            return
        pairs = list(zip(top, bot))
        if area < 0:
            pairs.reverse()
        k = len(self.v)
        self.v.extend((CX + x, CY + y, zb) for (x, y, _), zb in pairs)
        self.v.extend((CX + x, CY + y, z) for (x, y, z), _ in pairs)
        self._faces(list(range(k, k + n)), list(range(k + n, k + 2 * n)), mi)

    def loft(self, rings, mi):
        """Rings of equal length joined in order (quads between neighbours), capped at both ends."""
        if len(rings) < 2 or any(len(r) != len(rings[0]) for r in rings):
            return
        n, k = len(rings[0]), len(self.v)
        for r in rings:
            self.v.extend((CX + x, CY + y, z) for x, y, z in r)
        for i in range(len(rings) - 1):
            a, b = k + i * n, k + (i + 1) * n
            for j in range(n):
                self.f.append([a + j, a + (j + 1) % n, b + (j + 1) % n, b + j])
        self.f.append(list(range(k, k + n))[::-1])
        last = k + (len(rings) - 1) * n
        self.f.append(list(range(last, last + n)))
        self.m.extend([mi] * ((len(rings) - 1) * n + 2))

    def emit(self, name, coll, props=None):
        me = bpy.data.meshes.new(name)
        me.from_pydata(self.v, [], self.f)
        me.polygons.foreach_set("material_index", self.m)
        for mat in MATS:
            me.materials.append(mat)
        me.update()
        ob = bpy.data.objects.new(name, me)
        ob["citygen"] = True
        for key, val in (props or {}).items():
            ob[key] = val
        coll.objects.link(ob)
        return ob


def scatter_group(asset):
    """Geometry Nodes group that instances one plant collection on every point, using the points'
    rot (Z, radians) and scale attributes."""
    name = f"CITYGEN_scatter_{asset}"
    ng = bpy.data.node_groups.get(name)
    if ng:
        return ng
    ng = bpy.data.node_groups.new(name, "GeometryNodeTree")
    ng.interface.new_socket("Geometry", in_out="INPUT", socket_type="NodeSocketGeometry")
    ng.interface.new_socket("Geometry", in_out="OUTPUT", socket_type="NodeSocketGeometry")
    N, L = ng.nodes, ng.links
    gi, go = N.new("NodeGroupInput"), N.new("NodeGroupOutput")
    ci = N.new("GeometryNodeCollectionInfo")
    ci.inputs["Collection"].default_value = bpy.data.collections[asset]
    ci.inputs["Reset Children"].default_value = True
    iop = N.new("GeometryNodeInstanceOnPoints")
    rot = N.new("GeometryNodeInputNamedAttribute"); rot.data_type = "FLOAT"; rot.inputs["Name"].default_value = "rot"
    scl = N.new("GeometryNodeInputNamedAttribute"); scl.data_type = "FLOAT"; scl.inputs["Name"].default_value = "scale"
    comb = N.new("ShaderNodeCombineXYZ")
    L.new(gi.outputs[0], iop.inputs["Points"])
    L.new(ci.outputs[0], iop.inputs["Instance"])
    L.new(rot.outputs["Attribute"], comb.inputs["Z"])
    L.new(comb.outputs[0], iop.inputs["Rotation"])
    L.new(scl.outputs["Attribute"], iop.inputs["Scale"])
    L.new(iop.outputs[0], go.inputs[0])
    return ng


def build():
    colls = {k: reset_collection(v) for k, v in COLL.items() if k != "regrade"}
    for ob in B["objects"]:
        mb = MeshBuilder()
        for p in ob["prims"]:
            mi = MAT_KEYS.index(p["m"]) if p["m"] in MAT_KEYS else 0
            if p["t"] == "prism":
                mb.prism(p["poly"], p["z0"], p["z1"], mi)
            elif p["t"] == "loft":
                mb.loft(p["rings"], mi)
            else:
                mb.solid(p["top"], p["bot"], mi)
        if mb.f:
            mb.emit(ob["name"], colls[ob["coll"]], ob.get("props"))
    # trees: one point cloud per (collection, species), instanced by Geometry Nodes
    groups = {}
    for it in B["instances"]:
        groups.setdefault((it["coll"], it["asset"]), []).append(it)
    for (cname, asset), items in groups.items():
        if asset not in bpy.data.collections:
            print("missing plant collection", asset)
            continue
        me = bpy.data.meshes.new(f"TREES_{cname}_{asset}")
        me.from_pydata([(CX + it["x"], CY + it["y"], it["z"]) for it in items], [], [])
        for attr in ("rot", "scale"):
            a = me.attributes.new(attr, "FLOAT", "POINT")
            a.data.foreach_set("value", [it[attr] for it in items])
        ob = bpy.data.objects.new(f"TREES_{cname}_{asset}", me)
        ob["citygen"] = True
        ob.modifiers.new("scatter", "NODES").node_group = scatter_group(asset)
        colls[cname].objects.link(ob)
    for o in bpy.data.objects:
        if o.name.startswith("KIT_Facade_civic_i_AP_arc_"):
            o.hide_viewport = o.hide_render = True
    print("built", {v.name: len(v.objects) for v in colls.values()}, "trees", len(B["instances"]))


# the generated canals and harbour channels have to show through the hand-built ground decks and the
# ring-canal banks, walls and terraces: a hidden cutter mesh and a Boolean modifier on each of those
# (non-destructive, so a rebuild just refreshes the cutter)
CUT_TARGET_COLLS = ("01_GROUND", "10_KIT_CANAL", "11_TERRACE")
CUT_SKIP = ("gallery", "oculus")


def cut_canals():
    cuts = B.get("canal_cuts") or []
    old = bpy.data.objects.get("CANAL_CUTTER")
    if old:
        me_old = old.data
        bpy.data.objects.remove(old)
        if me_old and me_old.users == 0:
            bpy.data.meshes.remove(me_old)
    if not cuts:
        return
    mb = MeshBuilder()
    for c in cuts:
        mb.prism(c["poly"], c["z0"], c["z1"], 0)
    coll = bpy.data.collections.get("27_CANAL_CUTS") or bpy.data.collections.new("27_CANAL_CUTS")
    if coll.name not in bpy.context.scene.collection.children:
        bpy.context.scene.collection.children.link(coll)
    cutter = mb.emit("CANAL_CUTTER", coll, {"citygen": True})
    cutter.display_type = "WIRE"
    cutter.hide_render = True
    coll.hide_render = True
    n = 0
    for cn in CUT_TARGET_COLLS:
        c = bpy.data.collections.get(cn)
        if not c:
            continue
        for o in c.all_objects:
            if o.type != "MESH" or any(k in o.name.lower() for k in CUT_SKIP):
                continue
            m = o.modifiers.get("canal_cut") or o.modifiers.new("canal_cut", "BOOLEAN")
            m.operation, m.object, m.solver = "DIFFERENCE", cutter, "EXACT"
            m.use_self, m.use_hole_tolerant = True, True
            n += 1
    cutter.hide_set(True)
    print("canal cuts", len(cuts), "on", n, "objects")


def main():
    global MATS
    ensure_glow()
    MATS = [get_mat(MAT[k]) for k in MAT_KEYS]
    if globals().get("DO_REGRADE", True):
        regrade()
    if globals().get("DO_BUILD", True):
        hide_temple()
        build()
        cut_canals()


main()
