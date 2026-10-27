"""Bake the /city robot: one skinned mech from the Mech_00 pack with its fluid walk and idle animations.

Run it headless with no .blend (see README "Robot"):
    flatpak run --command=blender org.blender.Blender --factory-startup -b \
      --python "$PWD/export_robot.py" -- [out_dir=build/robot] [assets=/run/.../Assets/Robot]

The pack (Assets/Robot) is only read, never written. Writes OUT_DIR/robot_raw.glb and robot_meta.json; two
runs give byte-identical files.

Stages
  parts        import MESH_FBX and keep pick_parts (robot_rig.py): the medium body set Base_M_* with the plain
               forearms (no LimbGun) and every shared Core_* part. The OutLine faces (an inverted hull, half
               of every part) are deleted and the parts joined into one mesh in world space (metres).
  rig          import ANIM_FBX for its armature and actions. Its bones rest where the mesh file's do (only
               the c_traj root differs), and its actions are authored for it, so the mesh is skinned to it.
               The armature's object transform (90 deg about X, scale 0.01) is applied to the bones, the
               actions' object-level curves dropped and their bone locations scaled by the same 0.01. Bones
               no part is weighted to (attachment sockets, finger tips, lookAt) are deleted, keeping
               every ancestor of a weighted bone (keep_bones).
  actions      Mech_Walk (in place, not the _Root version) becomes 'walk' and Mech_Idle 'idle'; every other
               action is removed. Both loop (last frame = first) at the pack's 60 fps.
  material     one material ROBOT_Mech: the pack's palette (PALETTE, 80 x 48) as base colour, Closest
               filtering, roughness ROUGHNESS. No emission: the palette has no light cells, so emitting it
               would only flatten the shading.
  measure      height = the bind (T) pose's top above its lowest vertex. walk_cycle_m from the walk's planted
               feet (stance_cycle_m): the mean backward slide of a foot bone over neighbouring frames both
               within CONTACT_EPS of its lowest, times the loop's frames, so the page's ground speed
               walk_cycle_m / walk_duration_s keeps the feet from skating (skate_m logs the worst drift).
  export       glTF (+Y up, so the mech's Blender -Y facing becomes glTF +Z, feet on y = 0), the skin and both
               actions sampled every frame (linear), no morphs. robot_meta.json {version, height,
               walk_cycle_m, walk_duration_s, idle_duration_s}.

The people's walk is deliberately stepped (6 keys, no blending); the robot's is the fluid one.
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
VERSION = 1
MESH_FBX = "Char_Mesh/Mech_Char_Mesh.fbx"
ANIM_FBX = "Char_Anim/Mech_00_Anim.fbx"
PALETTE = "TexturePallets/SimplePalette/SimplePalette0014.png"   # the FBX's own path is a missing D:/ one
OUTLINE = "OutLine"
ACTIONS = {"walk": "Mech_Walk", "idle": "Mech_Idle"}   # glTF animation name: pack action (after "<rig>|")
FPS = 60
FEET = ("foot.l", "foot.r")
CONTACT_EPS = 0.005     # m: a foot bone within this of its lowest counts as planted
ROUGHNESS, METALLIC = 0.85, 0.0
MATERIAL = "ROBOT_Mech"
MESH = "ROBOT_Mech"
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


def parts():
    """The picked parts, outline faces gone, joined into one mesh with its vertices in world space."""
    new = new_objects(MESH_FBX)
    keep = set(rr.pick_parts([o.name for o in new if o.type == "MESH"]))
    objs = [o for o in new if o.name in keep]
    for o in objs:
        strip_outline(o)
        mw = o.matrix_world.copy()
        o.parent = None
        o.data.transform(mw)
        o.matrix_world = Matrix.Identity(4)
        o.modifiers.clear()
        o.data.materials.clear()
    remove([o for o in new if o.name not in keep])
    # One part at a time, in name order: a single join appends the parts in the view layer's order, which
    # the FBX import doesn't keep from run to run, and the vertex order (so the glb bytes) would follow it.
    obj = objs[0]
    bpy.context.view_layer.objects.active = obj
    for o in objs[1:]:
        bpy.ops.object.select_all(action="DESELECT")
        obj.select_set(True)
        o.select_set(True)
        bpy.ops.object.join()
    obj.name = obj.data.name = MESH
    return obj


def channelbag_fcurves(act):
    return [(cb, fc) for layer in act.layers for strip in layer.strips for cb in strip.channelbags
            for fc in cb.fcurves]


def rig(mesh):
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

    weighted = {mesh.vertex_groups[g.group].name for v in mesh.data.vertices for g in v.groups if g.weight > 0}
    keep = rr.keep_bones({b.name: b.parent.name if b.parent else None for b in arm.data.bones}, weighted)
    bpy.ops.object.select_all(action="DESELECT")
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.mode_set(mode="EDIT")
    eb = arm.data.edit_bones
    for name in sorted(b.name for b in eb if b.name not in keep):
        eb.remove(eb[name])
    bpy.ops.object.mode_set(mode="OBJECT")
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


def material():
    m = bpy.data.materials.new(MATERIAL)
    m.use_nodes = True
    nt = m.node_tree
    bsdf = next(n for n in nt.nodes if n.type == "BSDF_PRINCIPLED")
    bsdf.inputs["Roughness"].default_value = ROUGHNESS
    bsdf.inputs["Metallic"].default_value = METALLIC
    tex = nt.nodes.new("ShaderNodeTexImage")
    tex.image = bpy.data.images.load(os.path.join(ASSETS, PALETTE))
    tex.image.name = "robot_palette"
    tex.interpolation = "Closest"
    nt.links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
    return m


def run():
    os.makedirs(OUT_DIR, exist_ok=True)
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    sc.render.fps, sc.render.fps_base = FPS, 1.0

    mesh = parts()
    arm, acts, bones = rig(mesh)
    for m in list(bpy.data.materials):
        bpy.data.materials.remove(m)
    for im in list(bpy.data.images):
        bpy.data.images.remove(im)
    mesh.data.materials.append(material())
    for me in [me for me in bpy.data.meshes if me.users == 0]:
        bpy.data.meshes.remove(me)

    zs = [v.co.z for v in mesh.data.vertices]
    lo, height = min(zs), max(zs) - min(zs)
    down = Matrix.Translation((0, 0, -lo))   # the soles sit ~2 cm up once the outline hull is gone
    mesh.data.transform(down)
    arm.data.transform(down)
    if not HEIGHT_RANGE[0] <= height <= HEIGHT_RANGE[1]:
        raise RuntimeError(f"robot {height:.3f} m tall, outside {HEIGHT_RANGE}")
    cycle, walk_s, ground, skate = measure_walk(arm, acts["walk"], mesh)
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
    meta = {"version": VERSION, "height": round(height, 3), "walk_cycle_m": round(cycle, 3),
            "walk_duration_s": round(walk_s, 4), "idle_duration_s": round((idle_f1 - idle_f0) / FPS, 4)}
    with open(os.path.join(OUT_DIR, "robot_meta.json"), "w") as f:
        json.dump(meta, f, indent=1)
        f.write("\n")
    tris = sum(len(p.vertices) - 2 for p in mesh.data.polygons)
    print(f"robot: {glb} {os.path.getsize(glb)} bytes; {tris} tris, {len(mesh.data.vertices)} verts, "
          f"{bones} bones; rest feet at {lo:.4f}; {json.dumps(meta)}; walk lowest vertex "
          f"{ground[0]:.3f}..{ground[1]:.3f} m, speed {cycle / walk_s:.3f} m/s, "
          f"planted feet drift {skate * 100:.1f} cm per stance")


if __name__ == "__main__":
    run()
