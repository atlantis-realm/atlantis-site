"""Move the objects the hero camera never sees into a hidden collection `_culled` (v06 clean-up).

Run it headless on the .blend to clean (it saves that file unless --dry-run):
    cd concept-assets/city/generators
    flatpak run --command=blender org.blender.Blender --factory-startup -b ../Atlantian_plaza_blockout-v06.blend \
      --python oneoff/cull_unseen.py -- --dry-run --log /path/to/culled.json
Drop --dry-run to apply and save. (A --log outside the flatpak's reach needs `flatpak run --filesystem=<dir>`.)

What it samples: Camera.001 every half frame over hero_geom FRAME_START..FRAME_END, plus the page's floor drop
(the frame-1 camera straight down to the floor under it, levelling; see dropPose in src/lib/city/heroCamera.ts),
at every hero_geom.cull_aspects aspect with the widest safe frame (the 16:9 half width), so the phone's widened
vfov is covered. Frusta: hero_geom.frustum_planes with export_hero's CULL_MARGIN, far at least the camera's
clip_end, then every plane pushed MARGIN_M out (widen_planes). Bounds: world AABBs of the evaluated depsgraph
(modifiers applied); an instancer (collection instance, GN) is judged by everything it instances.

What may be culled: hierarchy trees (an object, its parents and children) of geometry and plain empties whose
every member is outside every sampled frustum. A tree is kept whole when any member is in view or protected:
cameras, lights and other non-geometry types; the names export_hero reads (camera, Text, Lantern, well collar and
ring lights, avenue pavement); anything already hidden (hide_render / hide_viewport / eye / hidden or excluded
collection: templates); members of instanced or node-referenced collections; anything another ID references
outside its own tree (modifier targets such as boolean cutters, constraints, drivers, node trees).

How: each culled object is linked only into `_culled` (a child of the scene collection, excluded in every view
layer, hide_render on), with its original collections in obj["cull_from"] ("A;B"), so restore() can put it back.
The log JSON lists every culled object with its collections and the per-top-level-collection counts.
It refuses to save when the culled share is outside SANITY (fraction of the candidate objects).
The file is saved in place with its compression kept, relative_remap off and no .blend1 (save_version 0).

The pure maths (widen_planes, drop_poses, boxes_in_any, select_culled) is tested in test/test_cull_unseen.py.
"""
import json
import math
import os
import sys

_here = os.path.dirname(os.path.abspath(__file__))
GEN_DIR = os.path.dirname(_here)
sys.path.insert(0, GEN_DIR)
import hero_geom as hg  # noqa: E402

try:
    import bpy  # noqa: F401
except ImportError:  # the pure functions are importable without Blender (tests)
    bpy = None

CULLED = "_culled"
PROP = "cull_from"
MARGIN_M = 30.0                 # m every frustum plane is pushed out (on top of export_hero's CULL_MARGIN)
SUBFRAMES = (0.0, 0.5)          # camera samples per frame
DROP_STEPS = 21                 # floor-drop poses, drop 0..1
SANITY = (0.05, 0.95)           # culled share of the candidates outside this: no save
GEOM_TYPES = {"MESH", "CURVE", "FONT", "SURFACE", "META", "CURVES", "POINTCLOUD", "VOLUME", "GREASEPENCIL"}


# ---------------------------------------------------------------- pure maths
def widen_planes(planes, dist):
    """Push every inward plane (nx, ny, nz, d) out by `dist` m (unit normals, as hero_geom builds them)."""
    return [(nx, ny, nz, d + dist) for nx, ny, nz, d in planes]


def _smooth(d):
    d = min(1.0, max(0.0, d))
    return d * d * (3 - 2 * d)


def _nrm(v):
    n = math.sqrt(sum(c * c for c in v))
    return tuple(c / n for c in v)


def _lerp(a, b, t):
    return tuple(x + (y - x) * t for x, y in zip(a, b))


def drop_poses(pos, fwd, up, ground_z, steps=DROP_STEPS):
    """[(pos, fwd, up)] along the page's floor drop: straight down from pos to ground_z (height eased d^2), the
    view levelling (smoothstep) toward the same heading with world up. Same curve as dropPose in heroCamera.ts;
    the in-between orientations are a normalised lerp, fine for a cull sample. steps >= 2, d = 0 and 1 included."""
    fwd, up = _nrm(fwd), _nrm(up)
    flat = _nrm((fwd[0], fwd[1], 0.0))
    out = []
    for k in range(steps):
        d = k / (steps - 1)
        z = max(ground_z, pos[2] + (ground_z - pos[2]) * d * d)
        e = _smooth(d)
        out.append(((pos[0], pos[1], z), _nrm(_lerp(fwd, flat, e)), _nrm(_lerp(up, (0.0, 0.0, 1.0), e))))
    return out


def boxes_in_any(lo, hi, planes, chunk=256):
    """numpy: bool per box (lo, hi: (N, 3)) true if hero_geom.aabb_in_frustum holds for any frustum of `planes`
    ((F, 6, 4) or a list of 6-plane lists)."""
    import numpy as np
    P = np.asarray(planes, dtype=np.float64)
    lo, hi = np.asarray(lo, dtype=np.float64), np.asarray(hi, dtype=np.float64)
    n, nrm, d = len(lo), P[..., :3], P[..., 3]
    pos = nrm >= 0                                        # (F, 6, 3): take hi where the normal is >= 0
    out = np.zeros(n, dtype=bool)
    for s in range(0, n, chunk):
        L, H = lo[s:s + chunk, None, None, :], hi[s:s + chunk, None, None, :]
        corner = np.where(pos[None], H, L)                # (n, F, 6, 3): the corner furthest along each normal
        inside = (corner * nrm[None]).sum(-1) + d[None] >= 0
        out[s:s + chunk] = inside.all(-1).any(-1)
    return out


def tree_root(name, parent):
    """The root of `name`'s parent chain; `parent` maps name -> parent name or None."""
    seen = set()
    while parent.get(name) and name not in seen:
        seen.add(name)
        name = parent[name]
    return name


def select_culled(objects):
    """Which objects to cull, by hierarchy tree.

    `objects`: {name: {"parent": name|None, "protected": reason|None, "seen": True|False|None}}, `seen` None for
    an object without bounds (a plain empty). A tree is culled whole only if no member is protected or seen and at
    least one member has bounds (seen False). Returns (culled names, {kept root: reason}).
    """
    parent = {n: o["parent"] for n, o in objects.items()}
    trees = {}
    for n in objects:
        trees.setdefault(tree_root(n, parent), []).append(n)
    culled, kept = set(), {}
    for root, members in trees.items():
        prot = next((objects[m]["protected"] for m in members if objects[m]["protected"]), None)
        if prot:
            kept[root] = "protected: " + prot
        elif any(objects[m]["seen"] for m in members):
            kept[root] = "in view"
        elif all(objects[m]["seen"] is None for m in members):
            kept[root] = "no bounds"
        else:
            culled.update(members)
    return culled, kept


def sanity(n_culled, n_candidates, lim=SANITY):
    """(ok, share): the culled share of the candidate objects and whether it lies within `lim`."""
    share = n_culled / n_candidates if n_candidates else 0.0
    return lim[0] <= share <= lim[1], share


# ---------------------------------------------------------------- Blender
def _export_lib():
    """export_hero.py's functions and constants, without running it."""
    ns = {"__name__": "eh_lib", "__file__": os.path.join(GEN_DIR, "export_hero.py"), "GEN_DIR": GEN_DIR,
          "OUT_DIR": os.path.join(GEN_DIR, "build", "hero")}
    with open(ns["__file__"]) as fh:
        exec(compile(fh.read(), ns["__file__"], "exec"), ns)
    return ns


def _protected_names(eh, obj):
    n = obj.name
    if n in (eh["CAMERA"], eh["TEXT_OBJECT"], eh["LANTERN_OBJECT"], eh["WELL_OBJECT"], eh["PAVEMENT_OBJECT"],
             eh["WELL_WATER_NAME"]) or n in eh["WELL_RING_LIGHTS"] or n.startswith(eh["LANTERN_PREFIXES"]) \
            or n.startswith(eh["PAVEMENT_OBJECT"]):
        return "read by export_hero"
    return None


def _visible_names(view_layer, skip):
    """Names of objects in at least one shown, rendered collection (not excluded / hidden / SKIP_COLLECTIONS)."""
    shown = set()

    def walk(lc, off):
        off = off or lc.exclude or lc.hide_viewport or lc.collection.hide_render or lc.collection.name in skip
        if not off:
            shown.update(o.name for o in lc.collection.objects)
        for ch in lc.children:
            walk(ch, off)
    walk(view_layer.layer_collection, False)
    return shown


def _frusta(eh, scene, cam, log):
    from mathutils import Vector
    cd = cam.data
    vfov = eh["base_vfov"](cd)
    half16 = math.tan(vfov / 2) * eh["RENDER_W"] / eh["RENDER_H"]   # widest safe frame the export can measure
    far = max(cd.clip_end, 8000.0)
    poses, step = [], 0.0
    prev = None
    for f in range(hg.FRAME_START, hg.FRAME_END + 1):
        for sub in SUBFRAMES:
            if f == hg.FRAME_END and sub:
                continue
            scene.frame_set(f, subframe=sub)
            m = cam.matrix_world.copy()
            r = m.to_3x3().normalized()
            p = tuple(m.translation)
            if prev is not None:
                step = max(step, (Vector(p) - Vector(prev)).length)
            prev = p
            poses.append((p, tuple(-r.col[2]), tuple(r.col[1])))
    scene.frame_set(hg.FRAME_START)
    dg = bpy.context.evaluated_depsgraph_get()
    m1 = cam.matrix_world.copy()
    r1 = m1.to_3x3().normalized()
    eye = m1.translation.copy()
    hit = scene.ray_cast(dg, eye, Vector((0, 0, -1)), distance=1000.0)
    ground = hit[1].z if hit[0] else None
    log["floor_drop"] = {"eye_z": round(eye.z, 4), "ground_z": round(ground, 4) if ground is not None else None,
                         "ground_object": hit[4].name if hit[0] else None}
    if ground is not None:
        poses += drop_poses(tuple(eye), tuple(-r1.col[2]), tuple(r1.col[1]), ground)
    frusta = []
    for (p, fw, up) in poses:
        for a, v in hg.cull_aspects(vfov, half16):
            frusta.append(widen_planes(hg.frustum_planes(p, fw, up, v, a, cd.clip_start, far,
                                                         margin=eh["CULL_MARGIN"]), MARGIN_M))
    log["frusta"] = {"poses": len(poses), "aspects": [round(a, 4) for a in hg.CULL_ASPECTS],
                     "vfov_deg": [round(math.degrees(v), 3) for _, v in hg.cull_aspects(vfov, half16)],
                     "far": far, "angular_margin": eh["CULL_MARGIN"], "margin_m": MARGIN_M,
                     "max_step_m": round(step, 3), "count": len(frusta)}
    return frusta, dg


def _bounds(dg, names):
    """{object name: [lo, hi]} world AABB of everything each scene object draws (instances attributed to their
    instancer, as export_hero.collect does); plus the count of instances whose instancer isn't a scene object."""
    from mathutils import Vector
    b, stray = {}, 0
    for inst in dg.object_instances:
        obj = inst.object
        if obj.type not in GEOM_TYPES:
            continue
        src = (inst.parent if inst.is_instance and inst.parent else obj).original
        if src.name not in names:
            stray += 1
            continue
        M = inst.matrix_world
        cs = [M @ Vector(c) for c in obj.bound_box]
        lo = [min(c[i] for c in cs) for i in range(3)]
        hi = [max(c[i] for c in cs) for i in range(3)]
        cur = b.get(src.name)
        b[src.name] = [lo, hi] if cur is None else [[min(a, c) for a, c in zip(cur[0], lo)],
                                                    [max(a, c) for a, c in zip(cur[1], hi)]]
    return b, stray


def plan(scene, view_layer, eh, log):
    """The cull decision for the open scene: (culled names, per-object info)."""
    import numpy as np
    cam = bpy.data.objects[eh["CAMERA"]]
    frusta, dg = _frusta(eh, scene, cam, log)
    objs = list(scene.objects)
    names = {o.name for o in objs}
    shown = _visible_names(view_layer, eh["SKIP_COLLECTIONS"])
    bounds, stray = _bounds(dg, names)
    log["stray_instances"] = stray

    parent = {o.name: (o.parent.name if o.parent and o.parent.name in names else None) for o in objs}
    root = {n: tree_root(n, parent) for n in names}

    # collections that are instanced or referenced by something other than a collection / scene: keep their objects
    umap = bpy.data.user_map(subset=list(bpy.data.collections) + objs)
    ref_colls = set()
    for c in bpy.data.collections:
        if any(not isinstance(u, (bpy.types.Collection, bpy.types.Scene)) for u in umap.get(c, ())):
            ref_colls.update(o.name for o in c.all_objects)

    info = {}
    for o in objs:
        prot = None
        if o.type not in GEOM_TYPES and o.type != "EMPTY":
            prot = "type " + o.type
        prot = prot or _protected_names(eh, o)
        if not prot and (o.hide_render or o.hide_viewport or o.hide_get(view_layer=view_layer) or o.name not in shown):
            prot = "already hidden"
        if not prot and o.name in ref_colls:
            prot = "in an instanced / referenced collection"
        if not prot:
            for u in umap.get(o, ()):
                if isinstance(u, (bpy.types.Collection, bpy.types.Scene)):   # membership (the scene: its master collection)
                    continue
                if isinstance(u, bpy.types.Object) and u.name in names and root[u.name] == root[o.name]:
                    continue
                prot = f"referenced by {type(u).__name__} {u.name}"
                break
        if not prot and o == scene.camera:
            prot = "scene camera"
        info[o.name] = {"parent": parent[o.name], "protected": prot, "seen": None}

    have = [n for n in info if n in bounds]
    if have:
        lo = np.array([bounds[n][0] for n in have])
        hi = np.array([bounds[n][1] for n in have])
        seen = boxes_in_any(lo, hi, frusta)
        for n, s in zip(have, seen):
            info[n]["seen"] = bool(s)
    culled, kept = select_culled(info)
    return culled, info, bounds, kept


def top_collection(scene):
    """{object name: top-level collection name} (the scene collection's child holding it, else 'Scene Collection')."""
    top = {}
    for c in scene.collection.children:
        for o in c.all_objects:
            top.setdefault(o.name, c.name)
    for o in scene.collection.objects:
        top.setdefault(o.name, "Scene Collection")
    return top


def apply(scene, culled):
    coll = bpy.data.collections.get(CULLED)
    if coll is None:
        coll = bpy.data.collections.new(CULLED)
    if coll.name not in scene.collection.children:
        scene.collection.children.link(coll)
    coll.hide_render = True
    for name in sorted(culled):
        o = bpy.data.objects[name]
        olds = [c for c in o.users_collection if c != coll]
        o[PROP] = ";".join(("" if c == scene.collection else c.name) for c in olds)
        if coll not in o.users_collection:
            coll.objects.link(o)
        for c in olds:
            c.objects.unlink(o)
    for vl in scene.view_layers:
        lc = vl.layer_collection.children.get(CULLED)
        if lc is not None:
            lc.exclude = True
    return coll


def restore(scene):
    """Put every object in `_culled` back into the collections in its cull_from ("" = the scene collection)."""
    coll = bpy.data.collections.get(CULLED)
    if coll is None:
        return 0
    n = 0
    for o in list(coll.objects):
        for cn in (o.get(PROP) or "").split(";"):
            c = scene.collection if cn == "" else bpy.data.collections.get(cn)
            if c is not None and o.name not in c.objects:
                c.objects.link(o)
        if len(o.users_collection) > 1:
            coll.objects.unlink(o)
            del o[PROP]
            n += 1
    return n


def _compressed(path):
    with open(path, "rb") as fh:
        head = fh.read(4)
    return head == b"\x28\xb5\x2f\xfd" or head[:2] == b"\x1f\x8b"


def main(argv):
    dry = "--dry-run" in argv
    log_path = argv[argv.index("--log") + 1] if "--log" in argv else os.path.join(GEN_DIR, "build", "cull", "culled.json")
    eh = _export_lib()
    scene, vl = bpy.context.scene, bpy.context.view_layer
    frame0 = scene.frame_current
    path = bpy.data.filepath
    if bpy.data.collections.get(CULLED) and len(bpy.data.collections[CULLED].objects):
        raise RuntimeError(f"{CULLED} already holds objects: run restore() first or cull by hand")
    log = {"file": path, "dry_run": dry}
    culled, info, bounds, kept = plan(scene, vl, eh, log)
    scene.frame_set(frame0)
    top = top_collection(scene)
    per = {}
    for n, o in info.items():
        r = per.setdefault(top.get(n, "?"), {"objects": 0, "culled": 0, "kept": 0})
        r["objects"] += 1
        r["culled" if n in culled else "kept"] += 1
    candidates = [n for n, o in info.items() if not o["protected"]]
    ok, share = sanity(len(culled), len(candidates))
    reasons = {}
    for o in info.values():
        if o["protected"]:
            key = o["protected"] if not o["protected"].startswith("referenced by") else "referenced by another ID"
            reasons[key] = reasons.get(key, 0) + 1
    log.update({
        "objects": len(info), "candidates": len(candidates), "culled_count": len(culled), "kept": len(info) - len(culled),
        "culled_share_of_candidates": round(share, 4), "sanity_ok": ok,
        "protected": reasons,
        "protected_named": sorted(n for n, o in info.items() if o["protected"] and not o["protected"].startswith(
            ("already hidden", "in an instanced"))),
        "kept_roots": {"in view": sum(1 for v in kept.values() if v == "in view"),
                       "no bounds": sum(1 for v in kept.values() if v == "no bounds")},
        "per_collection": dict(sorted(per.items())),
        "culled": [{"name": n, "type": bpy.data.objects[n].type,
                    "from": [c.name for c in bpy.data.objects[n].users_collection],
                    "bounds": [[round(v, 2) for v in b] for b in bounds[n]] if n in bounds else None}
                   for n in sorted(culled)],
    })
    os.makedirs(os.path.dirname(log_path), exist_ok=True)
    print(json.dumps({k: v for k, v in log.items() if k not in ("culled", "protected_named")}, indent=1))
    if not dry:
        if not ok:
            log["saved"] = False
            with open(log_path, "w") as fh:
                json.dump(log, fh, indent=1)
            raise RuntimeError(f"cull_unseen: culled share {share:.3f} outside {SANITY}, not saved")
        apply(scene, culled)
        prefs = bpy.context.preferences
        prefs.use_preferences_save = False
        prefs.filepaths.save_version = 0                  # no .blend1: keep the user's existing one
        bpy.ops.wm.save_mainfile(filepath=path, compress=_compressed(path), relative_remap=False)
        log["saved"] = True
    with open(log_path, "w") as fh:
        json.dump(log, fh, indent=1)
    print("CULL DONE", "dry run" if dry else "saved", len(culled), "culled", "log", log_path)


if bpy is not None and __name__ == "__main__":
    main(sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else [])
