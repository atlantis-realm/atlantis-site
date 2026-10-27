"""Bake the /city robots: VARIANTS seeded mechs from the Mech_00 pack (and its Mech_00A expansion), each one
skinned mesh on one shared rig with the pack's fluid walk and idle, and a strip of curated palettes.

Run it headless with no .blend (see README "Robot"):
    flatpak run --command=blender org.blender.Blender --factory-startup -b \
      --python "$PWD/export_robot.py" -- [out_dir=build/robot] [assets=/run/.../Assets/Robot]

The pack (Assets/Robot) is only read, never written. Writes OUT_DIR/robot_raw.glb, robot_palettes.png and
robot_meta.json; two runs give byte-identical files.

Stages
  parts        import MESH_FBXS (both on the same 87-bone rig, the same rests) and keep every body part and
               Core_* part; the OutLine faces (an inverted hull, half of every part) are deleted and each part
               moved to world space (metres). The attachment socket bones' rest matrices come from the rig.
  attachments  import every item robot_rig.ATTACH_FITS / BACK_ITEMS can roll (never a weapon: is_weapon), the
               outline gone. An item sits on its socket as the pack's prefabs have it (local identity): its
               vertices go through the socket's rest matrix (scale dropped), and are weighted fully to the
               socket's parent bone (the sockets don't move against their parents in any action).
  variants     roll_variants (robot_rig.py, seeded VARIANT_SEED): per variant a body set per slot and a
               mirrored pair or two of limb attachments, maybe a jetpack, at most VARIANT_MAX_TRIS. Each is
               copied from the parts and items and joined, in name order, into one mesh ROBOT_V<i>.
  rig          import ANIM_FBX for its armature and actions. Its bones rest where the mesh files' do (only
               the c_traj root differs), and its actions are authored for it, so every variant is skinned to
               it. The armature's object transform (90 deg about X, scale 0.01) is applied to the bones, the
               actions' object-level curves dropped and their bone locations scaled by the same 0.01. Bones
               no variant is weighted to (sockets, finger tips, lookAt) are deleted, keeping every ancestor of
               a weighted bone (keep_bones).
  actions      Mech_Walk (in place, not the _Root version) becomes 'walk' and Mech_Idle 'idle'; every other
               action is removed. Both loop (last frame = first) at the pack's 60 fps.
  material     one material ROBOT_Mech: PALETTES side by side in one strip (robot_palettes.png, each
               PALETTE_SIZE) as base colour, Closest filtering, roughness ROUGHNESS. The variants' UVs are
               squeezed into the first palette (u / len(PALETTES)); the page picks palette k by offsetting u
               by k / len(PALETTES). No emission: the palettes have no light cells.
  measure      per variant: height = the bind (T) pose's top above its lowest vertex; walk_cycle_m from the
               walk's planted feet (stance_cycle_m): the mean backward slide of a foot bone over neighbouring
               frames both within CONTACT_EPS of its lowest, times the loop's frames, so the page's ground
               speed walk_cycle_m / walk_duration_s keeps the feet from skating (skate_m logs the worst drift).
               Every variant has the shared Core_Feet on the same bones, so the cycles come out equal.
  export       glTF (+Y up, so the mech's Blender -Y facing becomes glTF +Z, feet on y = 0), the skin and both
               actions sampled every frame (linear), no morphs. robot_meta.json {version, height,
               walk_cycle_m, walk_duration_s, idle_duration_s, palettes, variants: [{name, height,
               walk_cycle_m, tris, main, slots, attachments}]}; the top-level height and walk_cycle_m are
               variant 0's.

The people's walk is deliberately stepped (6 keys, no blending); the robots' is the fluid one.
"""
import bpy, bmesh, json, os, sys
from mathutils import Matrix

_here = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, _here)
import robot_rig as rr  # noqa: E402

_args = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
OUT_DIR = os.path.abspath(_args[0]) if _args else os.path.join(_here, "build", "robot")
ASSETS = os.path.abspath(_args[1]) if len(_args) > 1 else "/run/media/dracky/e97d0aa9-5c45-460a-a682-b57cd6302030/Assets/Robot"

# ---------------------------------------------------------------- constants
VERSION = 2
MESH_FBXS = ("Char_Mesh/Mech_Char_Mesh.fbx", "Mech_00A.fbx")   # Base_ sets and core; the Base(A)_ expansion
ANIM_FBX = "Char_Anim/Mech_00_Anim.fbx"
ATTACH_DIR = "Attachments"
# Curated palettes (TexturePallets/, 80 x 48: two colour ramps and a grey one; the FBX's own path is a missing
# D:/ one): main colours round the hue wheel, every 3rd-5th of the 47 SimplePalettes (the pink and magenta
# mains past 0034 left out as garish for a civic city), and the grey with orange accents.
PALETTES = ("SimplePalette/SimplePalette0000.png", "SimplePalette/SimplePalette0004.png",
            "SimplePalette/SimplePalette0007.png", "SimplePalette/SimplePalette0014.png",
            "SimplePalette/SimplePalette0020.png", "SimplePalette/SimplePalette0025.png",
            "SimplePalette/SimplePalette0029.png", "SimplePalette/SimplePalette0034.png", "Gray_Col0025.png")
PALETTE_DIR = "TexturePallets"
PALETTE_SIZE = (80, 48)
VARIANTS = 8
VARIANT_SEED = 7
VARIANT_MAX_TRIS = 5000   # each robot is drawn twice (main + shadow), and two at once
OUTLINE = "OutLine"
ACTIONS = {"walk": "Mech_Walk", "idle": "Mech_Idle"}   # glTF animation name: pack action (after "<rig>|")
FPS = 60
FEET = ("foot.l", "foot.r")
CONTACT_EPS = 0.005     # m: a foot bone within this of its lowest counts as planted
ROUGHNESS, METALLIC = 0.85, 0.0
MATERIAL = "ROBOT_Mech"
HEIGHT_RANGE = (2.5, 4.5)   # m: the pack's size is kept unless it falls outside this


def new_objects(path):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.fbx(filepath=os.path.join(ASSETS, path))
    return sorted((o for o in bpy.data.objects if o not in before), key=lambda o: o.name)


def remove(objs):
    for o in objs:
        bpy.data.objects.remove(o, do_unlink=True)


def strip_outline(obj):
    bad = {i for i, m in enumerate(obj.data.materials) if m and m.name.startswith(OUTLINE)}
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    bmesh.ops.delete(bm, geom=[f for f in bm.faces if f.material_index in bad], context="FACES")
    bm.to_mesh(obj.data)
    bm.free()


def mesh_tris(obj):
    return sum(len(p.vertices) - 2 for p in obj.data.polygons)


def to_world(o):
    mw = o.matrix_world.copy()
    o.parent = None
    o.data.transform(mw)
    o.matrix_world = Matrix.Identity(4)
    o.modifiers.clear()
    o.data.materials.clear()


def parts():
    """{name: part object} of every body set and Core_ part (outline gone, in world space), and the socket
    bones' rest matrices {bone: (matrix, parent bone)} in the same space, scale dropped."""
    found, sockets = {}, {}
    for path in MESH_FBXS:
        new = new_objects(path)
        arm = next(o for o in new if o.type == "ARMATURE")
        if not sockets:
            bpy.context.view_layer.update()
            for b in arm.data.bones:
                if "_Attachment" in b.name:
                    loc, rot, _ = (arm.matrix_world @ b.matrix_local).decompose()
                    sockets[b.name] = (Matrix.LocRotScale(loc, rot, None), b.parent.name)
        keep = [o for o in new if o.type == "MESH" and o.name.startswith(rr.SETS + (rr.CORE,))
                and not rr.is_weapon(o.name)]
        for o in keep:
            if o.name in found:
                raise RuntimeError(f"{o.name} in two mesh files")
            strip_outline(o)
            to_world(o)
            found[o.name] = o
        remove([o for o in new if o not in keep])
    return found, sockets


def attachments():
    """{item: object} of every rollable attachment, outline gone, vertices in the item's own frame."""
    items = sorted({i for fits in rr.ATTACH_FITS.values() for i in fits} | set(rr.BACK_ITEMS))
    found = {}
    for item in items:
        new = new_objects(os.path.join(ATTACH_DIR, item + ".fbx"))
        meshes = [o for o in new if o.type == "MESH"]
        if len(meshes) != 1 or rr.is_weapon(item):
            raise RuntimeError(f"{item}: {len(meshes)} meshes")
        o = meshes[0]
        strip_outline(o)
        o.parent = None
        o.matrix_world = Matrix.Identity(4)   # its frame is the socket's (the prefabs place it at identity)
        o.modifiers.clear()
        o.data.materials.clear()
        o.vertex_groups.clear()
        found[item] = o
        remove([x for x in new if x is not o])
    return found


def build_variant(v, part_objs, items, sockets):
    """One mesh joined from copies of the variant's parts and its attachments on their sockets."""
    objs = []
    for name in v["parts"]:
        o = part_objs[name].copy()
        o.data = part_objs[name].data.copy()
        bpy.context.collection.objects.link(o)
        objs.append(o)
    for item, sock in v["attachments"]:
        m, bone = sockets[sock]
        o = items[item].copy()
        o.data = items[item].data.copy()
        bpy.context.collection.objects.link(o)
        o.data.transform(m)
        g = o.vertex_groups.new(name=bone)
        g.add(range(len(o.data.vertices)), 1.0, "REPLACE")
        objs.append(o)
    # One part at a time, in order: a single join appends the parts in the view layer's order, which isn't
    # kept from run to run, and the vertex order (so the glb bytes) would follow it.
    obj = objs[0]
    bpy.context.view_layer.objects.active = obj
    for o in objs[1:]:
        bpy.ops.object.select_all(action="DESELECT")
        obj.select_set(True)
        o.select_set(True)
        bpy.ops.object.join()
    obj.name = obj.data.name = v["name"]
    return obj


def channelbag_fcurves(act):
    return [(cb, fc) for layer in act.layers for strip in layer.strips for cb in strip.channelbags
            for fc in cb.fcurves]


def rig(meshes):
    new = new_objects(ANIM_FBX)
    arm = next(o for o in new if o.type == "ARMATURE")
    remove([o for o in new if o is not arm])
    if arm.animation_data:
        arm.animation_data_clear()   # its object-level curves would undo the applied transform
    bpy.context.view_layer.update()
    rest = {b.name: arm.matrix_world @ b.head_local for b in arm.data.bones}
    m = arm.matrix_world.copy()
    s = m.to_scale()[0]
    arm.data.transform(m)
    arm.matrix_world = Matrix.Identity(4)
    bpy.context.view_layer.update()
    worst = max((b.head_local - rest[b.name]).length for b in arm.data.bones)
    if worst > 1e-4:
        raise RuntimeError(f"applying the rig transform moved a bone {worst} m")

    # Actions: keep walk and idle, renamed; drop object curves and pruned bones; locations to metres.
    acts = {}
    for name, src in ACTIONS.items():
        act = next(a for a in bpy.data.actions if a.name.endswith("|" + src))
        acts[name] = act
    for a in [a for a in bpy.data.actions if a not in acts.values()]:
        bpy.data.actions.remove(a)

    weighted = {mesh.vertex_groups[g.group].name for mesh in meshes for v in mesh.data.vertices for g in v.groups
                if g.weight > 0}
    keep = rr.keep_bones({b.name: b.parent.name if b.parent else None for b in arm.data.bones}, weighted)
    bpy.ops.object.select_all(action="DESELECT")
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.mode_set(mode="EDIT")
    eb = arm.data.edit_bones
    for name in sorted(b.name for b in eb if b.name not in keep):
        eb.remove(eb[name])
    bpy.ops.object.mode_set(mode="OBJECT")
    for mesh in meshes:
        for g in [g for g in mesh.vertex_groups if g.name not in keep]:
            mesh.vertex_groups.remove(g)

    for name, act in acts.items():
        act.name = name
        for cb, fc in channelbag_fcurves(act):
            bone = fc.data_path.split('"')[1] if fc.data_path.startswith("pose.bones[") else None
            if bone not in keep:
                cb.fcurves.remove(fc)
            elif fc.data_path.endswith(".location"):
                for k in fc.keyframe_points:
                    k.co[1] *= s
                    k.handle_left[1] *= s
                    k.handle_right[1] *= s
        act.use_fake_user = False

    for mesh in meshes:
        mesh.parent = arm
        mesh.matrix_parent_inverse = Matrix.Identity(4)
        mod = mesh.modifiers.new("Armature", "ARMATURE")
        mod.object = arm
    arm.name = "ROBOT_Rig"
    return arm, acts, len(keep)


def play(arm, act):
    ad = arm.animation_data or arm.animation_data_create()
    ad.action = act
    if act.slots:
        ad.action_slot = act.slots[0]
    f0, f1 = (int(round(f)) for f in act.frame_range)
    return f0, f1


def measure_walk(arm, act, mesh):
    f0, f1 = play(arm, act)
    sc = bpy.context.scene
    feet = {f: ([], []) for f in FEET}
    ground = []
    for f in range(f0, f1 + 1):
        sc.frame_set(f)
        for name in FEET:
            p = arm.matrix_world @ arm.pose.bones[name].head
            feet[name][0].append(p.z)
            feet[name][1].append(-p.y)   # forward = Blender -Y
        ev = mesh.evaluated_get(bpy.context.evaluated_depsgraph_get())
        ground.append(min((ev.matrix_world @ v.co).z for v in ev.data.vertices))
    cycle = rr.stance_cycle_m(list(feet.values()), CONTACT_EPS)
    skate = rr.skate_m(list(feet.values()), CONTACT_EPS, cycle)
    return cycle, (f1 - f0) / FPS, (min(ground), max(ground)), skate


def palette_strip():
    """PALETTES side by side in one image, saved as OUT_DIR/robot_palettes.png (Blender's rows run bottom up,
    the same in every palette, so the strip's columns just follow on)."""
    w, h = PALETTE_SIZE
    n = len(PALETTES)
    px = [0.0] * (w * n * h * 4)
    for k, path in enumerate(PALETTES):
        im = bpy.data.images.load(os.path.join(ASSETS, PALETTE_DIR, path))
        if tuple(im.size) != PALETTE_SIZE or im.channels != 4:
            raise RuntimeError(f"{path}: {tuple(im.size)} x {im.channels}, not {PALETTE_SIZE} RGBA")
        src = list(im.pixels)
        for y in range(h):
            row = (y * w * n + k * w) * 4
            px[row:row + w * 4] = src[y * w * 4:(y + 1) * w * 4]
        bpy.data.images.remove(im)
    strip = bpy.data.images.new("robot_palettes", w * n, h, alpha=False)
    strip.pixels.foreach_set(px)
    strip.filepath_raw = os.path.join(OUT_DIR, "robot_palettes.png")
    strip.file_format = "PNG"
    strip.save()
    bpy.data.images.remove(strip)
    return os.path.join(OUT_DIR, "robot_palettes.png")


def squeeze_uvs(mesh, n):
    """Into the first of n palettes side by side: u / n (every UV must be inside the one palette)."""
    uv = mesh.data.uv_layers.active.data
    us = [d.uv[0] for d in uv]
    if min(us) < -1e-6 or max(us) > 1 + 1e-6:
        raise RuntimeError(f"{mesh.name}: u {min(us):.3f}..{max(us):.3f} outside the palette")
    for d in uv:
        d.uv[0] /= n


def material(strip_png):
    m = bpy.data.materials.new(MATERIAL)
    m.use_nodes = True
    nt = m.node_tree
    bsdf = next(n for n in nt.nodes if n.type == "BSDF_PRINCIPLED")
    bsdf.inputs["Roughness"].default_value = ROUGHNESS
    bsdf.inputs["Metallic"].default_value = METALLIC
    tex = nt.nodes.new("ShaderNodeTexImage")
    tex.image = bpy.data.images.load(strip_png)
    tex.image.name = "robot_palettes"
    tex.interpolation = "Closest"
    nt.links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
    return m


def run():
    os.makedirs(OUT_DIR, exist_ok=True)
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    sc.render.fps, sc.render.fps_base = FPS, 1.0

    part_objs, sockets = parts()
    items = attachments()
    tris = {n: mesh_tris(o) for n, o in list(part_objs.items()) + list(items.items())}
    variants = rr.roll_variants(sorted(part_objs), tris, VARIANTS, VARIANT_SEED, VARIANT_MAX_TRIS)
    meshes = [build_variant(v, part_objs, items, sockets) for v in variants]
    remove(list(part_objs.values()) + list(items.values()))
    arm, acts, bones = rig(meshes)
    for m in list(bpy.data.materials):
        bpy.data.materials.remove(m)
    for im in list(bpy.data.images):
        bpy.data.images.remove(im)
    mat = material(palette_strip())
    for mesh in meshes:
        squeeze_uvs(mesh, len(PALETTES))
        mesh.data.materials.append(mat)
    for me in [me for me in bpy.data.meshes if me.users == 0]:
        bpy.data.meshes.remove(me)

    lows = [min(v.co.z for v in mesh.data.vertices) for mesh in meshes]
    lo = min(lows)
    if max(lows) - lo > 1e-3:
        raise RuntimeError(f"variant soles at {min(lows):.4f}..{max(lows):.4f}: not all on Core_Feet")
    down = Matrix.Translation((0, 0, -lo))   # the soles sit ~2 cm up once the outline hull is gone
    for mesh in meshes:
        mesh.data.transform(down)
    arm.data.transform(down)
    for v, mesh in zip(variants, meshes):
        v["height"] = max(x.co.z for x in mesh.data.vertices)
        if not HEIGHT_RANGE[0] <= v["height"] <= HEIGHT_RANGE[1]:
            raise RuntimeError(f"{v['name']} {v['height']:.3f} m tall, outside {HEIGHT_RANGE}")
        v["walk"] = measure_walk(arm, acts["walk"], mesh)
    idle_f0, idle_f1 = (int(round(f)) for f in acts["idle"].frame_range)

    # The exporter takes the active action and every NLA strip's action as separate animations.
    play(arm, acts["walk"])
    track = arm.animation_data.nla_tracks.new()
    track.name = "idle"
    track.strips.new("idle", idle_f0, acts["idle"])
    sc.frame_set(1)

    valid = {p.identifier for p in bpy.ops.export_scene.gltf.get_rna_type().properties}
    opts = {"export_format": "GLB", "use_selection": False, "export_yup": True, "export_apply": False,
            "export_skins": True, "export_def_bones": False, "export_all_influences": False,
            "export_rest_position_armature": True, "export_reset_pose_bones": True,
            "export_animations": True, "export_animation_mode": "ACTIONS", "export_force_sampling": True,
            "export_frame_step": 1, "export_anim_slide_to_zero": True, "export_optimize_animation_size": False,
            "export_anim_single_armature": True, "export_bake_animation": False, "export_nla_strips": True,
            "export_morph": False, "export_materials": "EXPORT", "export_image_format": "AUTO",
            "export_texcoords": True, "export_normals": True, "export_tangents": False, "export_extras": False,
            "export_cameras": False, "export_lights": False, "export_vertex_color": "NONE",
            "export_leaf_bone": False}
    opts = {k: v for k, v in opts.items() if k in valid}
    glb = os.path.join(OUT_DIR, "robot_raw.glb")
    bpy.ops.export_scene.gltf(filepath=glb, **opts)
    v0 = variants[0]
    walk_s = v0["walk"][1]
    meta = {"version": VERSION, "height": round(v0["height"], 3), "walk_cycle_m": round(v0["walk"][0], 3),
            "walk_duration_s": round(walk_s, 4), "idle_duration_s": round((idle_f1 - idle_f0) / FPS, 4),
            "palettes": [os.path.splitext(os.path.basename(p))[0] for p in PALETTES],
            "variants": [{"name": v["name"], "height": round(v["height"], 3), "walk_cycle_m": round(v["walk"][0], 3),
                          "tris": mesh_tris(mesh), "main": v["main"], "slots": v["slots"],
                          "attachments": [list(a) for a in v["attachments"]]}
                         for v, mesh in zip(variants, meshes)]}
    with open(os.path.join(OUT_DIR, "robot_meta.json"), "w") as f:
        json.dump(meta, f, indent=1)
        f.write("\n")
    print(f"robot: {glb} {os.path.getsize(glb)} bytes; {bones} bones; rest feet at {lo:.4f}; "
          f"{len(PALETTES)} palettes; idle {meta['idle_duration_s']} s")
    for v, mesh in zip(variants, meshes):
        cycle, walk_s, ground, skate = v["walk"]
        print(f"  {v['name']}: {mesh_tris(mesh)} tris, {len(mesh.data.vertices)} verts, {v['height']:.3f} m, "
              f"main {v['main']}, mixed {sorted(k for k, x in v['slots'].items() if x != v['main'])}, "
              f"{[a for a, _ in v['attachments']]}; walk {cycle:.3f} m / {walk_s:.4f} s = {cycle / walk_s:.3f} m/s, "
              f"lowest vertex {ground[0]:.3f}..{ground[1]:.3f} m, planted feet drift {skate * 100:.1f} cm per stance")


if __name__ == "__main__":
    run()
